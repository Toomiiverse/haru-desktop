// Showing her a picture.
//
// Two models, on purpose. Her own model cannot see, and the one that can does
// not sound like her — asked to be Haru about a photograph, gemma writes a
// polite caption with an exclamation mark on the end. So the seeing and the
// saying are split: the vision model reports plainly what is in the frame, and
// she reacts to that report in her own voice, the same way she answers from
// search results rather than reading them out.
//
// It also means the vision model is swappable without touching her character,
// and that her personality lives in exactly one place.

export type VisionConfig = {
  enabled: boolean;
  /** Send pictures they choose to show her to the hosted model instead of the
   *  local one. Screenshots ignore this and are always read locally — see
   *  screenshots.ts for why that is not negotiable. */
  remote: boolean;
  /** A model with the `vision` capability. gemma4:12b has it; qwen2.5 does not. */
  model: string;
  /** Where copies are kept. Empty means the default under Pictures. */
  folder: string;
};

export const DEFAULT_VISION: VisionConfig = { enabled: false, model: 'gemma4:12b', folder: '', remote: false };

export function readVisionConfig(saved: unknown): VisionConfig {
  if (!saved || typeof saved !== 'object') return DEFAULT_VISION;
  const record = saved as Partial<VisionConfig>;
  return {
    enabled: record.enabled === true,
    model: typeof record.model === 'string' && record.model.trim() ? record.model.trim() : DEFAULT_VISION.model,
    folder: typeof record.folder === 'string' ? record.folder.trim() : '',
    remote: record.remote === true,
  };
}

// Long enough for a 12B to work through an image on a busy card, short enough
// that a wedged server does not leave the user staring at nothing.
const LOOK_TIMEOUT_MS = 120_000;

/** What she is told is in the picture. Deliberately flat — this is evidence. */
export type Sighting = { description: string; model: string };

/**
 * The same look, done by a hosted model.
 *
 * Goes to /chat/completions rather than the /responses endpoint the docs point
 * at for images — measured, the chat endpoint takes them perfectly well, which
 * means this is a different content shape rather than a whole second API.
 *
 * Worth recording what the measurement actually said, since the choice rests on
 * it. On a 0.4MB upload: grok-4.5 5.3s, grok-4.3 6.1s, gemma locally 6.9s. The
 * gap in wording was the more interesting half — the hosted models read "a brown
 * rectangular building on a green field", gemma read "a brown rectangle". Both
 * are true; only one is what somebody meant to show you.
 */
export async function lookRemote(imageBase64: string, model: string, endpoint: string, headers: Record<string, string>, fetchImpl: Fetcher): Promise<Sighting> {
  const response = await fetchImpl(`${endpoint.replace(/\/+$/, '')}/chat/completions`, {
    method: 'POST',
    headers,
    signal: AbortSignal.timeout(LOOK_TIMEOUT_MS),
    body: JSON.stringify({
      model,
      stream: false,
      max_tokens: 200,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: LOOK_PROMPT },
          { type: 'image_url', image_url: { url: `data:image/png;base64,${imageBase64}` } },
        ],
      }],
    }),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`${model} could not look at it (${response.status})${detail ? `: ${detail.slice(0, 160)}` : ''}`);
  }
  const payload = await response.json() as { choices?: { message?: { content?: string } }[] };
  const description = (payload.choices?.[0]?.message?.content ?? '').trim();
  if (!description) throw new Error(`${model} returned nothing`);
  return { description, model };
}

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

/**
 * How the sighting reaches her. Framed as her own eyes rather than as a report
 * from elsewhere — she should not say "the description mentions a dog", she
 * should say she can see a dog.
 */
export function reactionPrompt(sighting: Sighting, note: string): string {
  return [
    'They have just shown you a picture. This is what is in it:',
    sighting.description,
    note ? `They said: "${note}"` : '',
    'React to it the way you would if they turned a phone round and showed you. One or two lines, your own voice.',
    'Talk about what is actually in it. Do not describe it back to them like a caption, do not say "the image shows", do not mention descriptions or models or that anything was analysed — as far as they are concerned you simply looked at it.',
  ].filter(Boolean).join(' ');
}

/**
 * Her reaction and the memory verdict in one request.
 *
 * They were two calls to the same model, one straight after the other, which is
 * a whole round trip spent asking a question that could have travelled with the
 * first. Both want exactly the same input — the description — so there was never
 * a reason to send it twice.
 *
 * The marker is on its own line and deliberately unlike anything she would write,
 * because the parse has to fail safely: no marker means the whole thing is her
 * reaction and nothing is remembered, which is the harmless direction.
 */
export const KEEP_MARKER = '<<KEEP>>';

export function reactAndRememberPrompt(sighting: Sighting, note: string): string {
  return [
    reactionPrompt(sighting, note),
    `\n\nThen, on a new line, write ${KEEP_MARKER} followed by one short third-person sentence if the picture says something lasting about them — a pet, a person, where they live, something they own, a hobby, a project — with no pronoun for them: "Has a black cat called Miso", "Drives a green Subaru".`,
    `If it is a screenshot, a meme, a passing joke or anything that will not matter next month, write ${KEEP_MARKER} nothing.`,
    'They never see that line, so keep it out of what you say to them.',
  ].join(' ');
}

/** Splits the two apart, tolerating a model that ignored the format entirely. */
export function splitReaction(reply: string): { reaction: string; fact: string } {
  const at = reply.indexOf(KEEP_MARKER);
  if (at < 0) return { reaction: reply.trim(), fact: '' };
  const fact = reply.slice(at + KEEP_MARKER.length).trim().replace(/^["']|["'.]$/g, '');
  return {
    reaction: reply.slice(0, at).trim(),
    fact: !fact || /^nothing\b/i.test(fact) || fact.length < 9 ? '' : fact,
  };
}

// How long a picture stays worth talking about. Long enough to go and make tea
// and come back to it, short enough that "what do you reckon" tomorrow morning
// is not answered about yesterday's photograph.
export const PICTURE_HOLDS_MS = 30 * 60_000;

/**
 * A picture she has looked at and is saying nothing about yet.
 *
 * Uploading is not itself a remark. Sending a photograph with no word attached
 * means "look at this", not "tell me what you think of this" — and answering the
 * second when the first was asked is the thing that makes her exhausting.
 */
export type HeldPicture = { description: string; name: string; at: number };

/**
 * What she is told about a picture she has been shown but not asked about.
 *
 * The instruction is nearly all restraint. She has the description, so she can
 * answer the moment they ask; the point is that she must not treat having seen
 * something as a reason to start talking about it.
 */
export function heldPicturePrompt(held: HeldPicture | null, now: number): string {
  if (!held || now - held.at > PICTURE_HOLDS_MS) return '';
  return [
    'They have shown you a picture. This is what is in it:',
    held.description,
    'They have not asked you anything about it. Do not comment on it, do not bring it up, and do not work it into a reply about something else — they may simply have wanted it kept.',
    'If they do ask, you have already seen it: answer about what is actually in it, in your own words, without mentioning descriptions or that anything was analysed.',
  ].join(' ');
}

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
