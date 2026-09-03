// Hearing him, not just reading him.
//
// The room she reads is words: readsAsRough scans what he typed. Hume's
// expression measurement reads how he sounded — the tune, pace and pitch of the
// audio the phone already uploads — so the same "rough" signal can come from
// his voice. Fired on the audio that was going to ASR anyway, off the reply
// path: the reading lands on the next turn, the way an aside does.

export type HumeConfig = { expressionsEnabled: boolean };

export const DEFAULT_HUME: HumeConfig = { expressionsEnabled: true };

export function readHumeConfig(saved: unknown): HumeConfig {
  if (!saved || typeof saved !== 'object') return DEFAULT_HUME;
  return { expressionsEnabled: (saved as Partial<HumeConfig>).expressionsEnabled !== false };
}

/** The prosody scores Hume returns for a clip: expression name → 0..1. */
export type Prosody = Record<string, number>;

type ResponseLike = { ok: boolean; status: number; text(): Promise<string>; json(): Promise<unknown>; arrayBuffer(): Promise<ArrayBuffer> };

/**
 * Hume's expression measurement on one clip. The batch API is async — a job
 * is created, then polled — so this is fire-and-forget by construction; it is
 * never on the path of a reply. Returns the prosody scores, or null when the
 * job cannot be created or fails.
 */
export async function hearVoice(audio: Uint8Array, mime: string, apiKey: string, fetchImpl: (url: string, init: unknown) => Promise<ResponseLike>): Promise<Prosody | null> {
  const form = new FormData();
  const extension = mime.includes('wav') ? 'wav' : mime.includes('ogg') ? 'ogg' : 'webm';
  form.append('file', new Blob([audio as unknown as BlobPart], { type: mime }), `speech.${extension}`);
  let created: ResponseLike;
  try {
    created = await fetchImpl('https://api.hume.ai/v0/batch/jobs', { method: 'POST', headers: { 'X-Hume-Api-Key': apiKey }, body: form });
  } catch {
    return null;
  }
  if (!created.ok) return null;
  const { job_id: jobId } = await created.json() as { job_id?: string };
  if (!jobId) return null;
  // One short clip lands fast; a handful of polls is enough, and giving up is
  // quiet — a voice reading is never worth a delay or a retry.
  for (let attempt = 0; attempt < 6; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 1000));
    let poll: ResponseLike;
    try {
      poll = await fetchImpl(`https://api.hume.ai/v0/batch/jobs/${jobId}`, { method: 'GET', headers: { 'X-Hume-Api-Key': apiKey } });
    } catch {
      return null;
    }
    if (!poll.ok) continue;
    const payload = await poll.json() as {
      state?: string;
      results?: { predictions?: { models?: { prosody?: { group_predictions?: { emotions?: { name: string; score: number }[] }[] } } }[] };
    };
    if (payload.state === 'COMPLETED') {
      const emotions = payload.results?.predictions?.[0]?.models?.prosody?.group_predictions?.[0]?.emotions;
      if (!emotions) return {};
      const out: Prosody = {};
      for (const emotion of emotions) out[emotion.name] = emotion.score;
      return out;
    }
    if (payload.state === 'FAILED') return null;
  }
  return null;
}

/** The expression names that mean something to Haru's reading of the room. */
const DISTRESS = ['Distress', 'Anxiety', 'Fear', 'Pain'];
const ANGER = ['Anger', 'Irritation', 'Contempt'];
const WORN = ['Exhaustion', 'Sadness', 'Disappointment'];

function top(scores: Prosody, names: string[]): number {
  return Math.max(...names.map(name => scores[name] ?? 0));
}

/**
 * Reads the room from his voice, the way readsAsRough reads his words. A clip
 * with a strong reading becomes the same "ease off" signal, with the source
 * named so she knows it was his voice and not his words.
 */
export function readingFrom(scores: Prosody): { rough: boolean; why: string } {
  const distress = top(scores, DISTRESS);
  const anger = top(scores, ANGER);
  const worn = top(scores, WORN);
  const strongest = Math.max(distress, anger, worn);
  if (strongest < 0.15) return { rough: false, why: '' };
  if (anger >= distress && anger >= worn) return { rough: true, why: 'their voice sounded annoyed' };
  if (worn >= distress) return { rough: true, why: 'their voice sounded worn out' };
  return { rough: true, why: 'their voice sounded off' };
}