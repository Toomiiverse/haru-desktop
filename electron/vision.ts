// Her local eyes.
//
// Two models, on purpose. Her own model cannot see, and the one that can does
// not sound like her — asked to be Haru about a photograph, gemma writes a
// polite caption with an exclamation mark on the end. So the seeing and the
// saying are split: the vision model reports plainly what is in the frame, and
// she reacts to that report in her own voice, the same way she answers from
// search results rather than reading them out.
//
// That split is right for what is left here — the screen she is watching and the
// screenshots that appear in a folder, neither of which she was asked about and
// neither of which ever leaves the machine.
//
// It is wrong for a picture somebody hands her and asks about, and used to be
// done that way anyway: two sentences of caption were all that survived, so
// "make sense of this" about a diagram was answered from a description that had
// never contained the diagram. Those go to the answering model inside the
// conversation now, image and all — see ./attachments. This file only gets them
// back when there is no model to send them to.

export type VisionConfig = {
  enabled: boolean;
  /**
   * A model with the `vision` capability. gemma4:12b has it; qwen2.5 does not.
   *
   * This is her local pair of eyes, and it now has one job: screenshots and the
   * screen she is watching, which never leave the machine. A picture the user
   * attaches goes to the answering model inside the conversation instead, and
   * only comes back here when there is no hosted model to send it to.
   */
  model: string;
  /** Where copies are kept. Empty means the default under Pictures. */
  folder: string;
};

export const DEFAULT_VISION: VisionConfig = { enabled: false, model: 'gemma4:12b', folder: '' };

export function readVisionConfig(saved: unknown): VisionConfig {
  if (!saved || typeof saved !== 'object') return DEFAULT_VISION;
  const record = saved as Partial<VisionConfig>;
  return {
    enabled: record.enabled === true,
    model: typeof record.model === 'string' && record.model.trim() ? record.model.trim() : DEFAULT_VISION.model,
    folder: typeof record.folder === 'string' ? record.folder.trim() : '',
  };
}

// Long enough for a 12B to work through an image on a busy card, short enough
// that a wedged server does not leave the user staring at nothing.
const LOOK_TIMEOUT_MS = 120_000;

/** What she is told is in the picture. Deliberately flat — this is evidence. */
export type Sighting = { description: string; model: string };

type Fetcher = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) => Promise<Response>;

/**
 * Plain description, no personality. The instruction fights two habits every
 * vision model has: opening with "This image shows", and hedging every noun into
 * uselessness ("what appears to be a possible cat").
 */
const LOOK_PROMPT = [
  'Say plainly what is in this picture and what is happening, in two sentences.',
  'Name things rather than hedging about what they might be. Quote any readable text.',
  'No preamble, no "this image shows", no comments on the photography.',
].join(' ');

/** Overrides for the one caller that is not asking for a plain description. */
export type LookOptions = {
  /** Her character, when the same call is also meant to produce a line in her voice. */
  system?: string;
  /** Replaces the plain-description instruction. */
  ask?: string;
  /** Hotter than a description wants, for a call that has to say something. */
  temperature?: number;
  /** How long Ollama holds the model. The default drops it after five minutes. */
  keepAlive?: string;
};

export async function look(imageBase64: string | string[], config: VisionConfig, endpoint: string, headers: Record<string, string>, fetchImpl: Fetcher, options: LookOptions = {}): Promise<Sighting> {
  if (!config.enabled) throw new Error('Looking at pictures is switched off.');
  const response = await fetchImpl(`${endpoint.replace(/\/+$/, '')}/api/chat`, {
    method: 'POST',
    headers,
    signal: AbortSignal.timeout(LOOK_TIMEOUT_MS),
    body: JSON.stringify({
      model: config.model,
      messages: [
        ...(options.system ? [{ role: 'system', content: options.system }] : []),
        { role: 'user', content: options.ask ?? LOOK_PROMPT, images: Array.isArray(imageBase64) ? imageBase64 : [imageBase64] },
      ],
      ...(options.keepAlive ? { keep_alive: options.keepAlive } : {}),
      stream: false,
      // The whole of the wait was here. gemma4 is a reasoning model, and left to
      // itself it produced three and a half thousand characters of private
      // deliberation about a photograph before writing two sentences — measured
      // at 28.3s with it on against 5.2s with it off, and 2.3s once the prompt
      // was shortened too. The descriptions were no better for it; the most
      // precise of the four came from a run with it off.
      //
      // Harmless on a model that does not reason: Ollama ignores it.
      think: false,
      // Low: this is meant to be an accurate account, not an interesting one.
      options: { temperature: options.temperature ?? 0.2 },
    }),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    // The commonest failure by far, and the one with an obvious fix.
    if (/does not support|no vision|image/i.test(detail) && response.status === 400) {
      throw new Error(`${config.model} cannot see images. Pick a model with vision — gemma4:12b has it.`);
    }
    throw new Error(`the vision model returned ${response.status}${detail ? `: ${detail.slice(0, 200)}` : ''}`);
  }
  const payload = await response.json() as { message?: { content?: string } };
  const description = (payload.message?.content ?? '').trim();
  if (!description) throw new Error('the vision model returned nothing');
  return { description, model: config.model };
}

// How long a picture stays worth talking about. Long enough to go and make tea
// and come back to it, short enough that "what do you reckon" tomorrow morning
// is not answered about yesterday's photograph.
//
// It used to bound a description held to one side of the conversation. Now it
// bounds how long an attachment keeps riding along with the messages after it —
// see attachmentsInPlay in ./attachments. Same question, and it should not have
// two answers, so it kept the one it already had.
export const PICTURE_HOLDS_MS = 30 * 60_000;

/**
 * What she says while she is still looking.
 *
 * Written here rather than generated, and that is the whole point: measured, the
 * vision model takes twenty-odd seconds to think about an image, and a line that
 * needs a model of its own to produce would arrive after the thing it was meant
 * to cover. These are instant, and twenty seconds of nothing is what made the
 * feature feel broken rather than slow.
 */
const WHILE_LOOKING = [
  'Hang on, let me actually look at it.',
  'Right, give me a second with this.',
  'Hold on — squinting.',
  'One moment, I am looking.',
  'Let me see, then.',
  'Alright, looking now. Do not rush me.',
];

export function whileLooking(random: () => number = Math.random): string {
  return WHILE_LOOKING[Math.floor(random() * WHILE_LOOKING.length)];
}

/** A filename that sorts by date and cannot collide or escape the folder. */
export function photoName(original: string, when: Date): string {
  const stamp = [
    when.getFullYear(), String(when.getMonth() + 1).padStart(2, '0'), String(when.getDate()).padStart(2, '0'),
  ].join('-') + '-' + [String(when.getHours()).padStart(2, '0'), String(when.getMinutes()).padStart(2, '0'), String(when.getSeconds()).padStart(2, '0')].join('');
  // Only the basename, and only characters that cannot walk out of the folder.
  const base = original.replace(/^.*[\\/]/, '').replace(/[^a-zA-Z0-9._-]/g, '_').slice(-60) || 'photo.png';
  return `${stamp}-${base}`;
}
