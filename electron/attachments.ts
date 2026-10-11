import {attachmentPolicy} from './core-attachments';
// Files that are part of a message, rather than an errand of their own.
//
// Attaching something used to be a whole transaction: the picker ran the entire
// job on the spot, took whatever was in the draft box as the question, called a
// vision model and posted an answer. So you had to type before choosing the
// file, and attaching with an empty box left a bare line in the transcript
// naming a path nobody wanted to read.
//
// Worse, she never saw the thing. A separate model wrote two sentences about it
// and only those two sentences were kept — which is why "make sense of this"
// about a four-box diagram came back as "it looks like a screenshot of some text
// or a document". No wording fixes that. Two sentences cannot carry a diagram.
//
// So a file is now staged: copied, thumbnailed, and left sitting in the composer
// costing nothing until you press Send. Then it travels with the message through
// the ordinary chat path, which already has her character, the conversation, her
// tools and her memory — none of which the old one-shot call had.

import { PICTURE_HOLDS_MS } from './vision';

export type AttachmentKind = 'image' | 'audio' | 'video' | 'text' | 'document';

export type Attachment = {
  id: string;
  kind: AttachmentKind;
  /** The name it had when they picked it. What the bubble prints. */
  name: string;
  /** The kept copy. Read at send time, so no bytes cross the bridge or land in the store. */
  saved: string;
  /** haru-photo://… for the thumbnail. Pictures only; everything else shows a chip. */
  url: string;
  bytes: number;
};

const KINDS: AttachmentKind[] = ['image', 'audio', 'video', 'text', 'document'];

/**
 * Attachments round-trip through the transcript, which the renderer owns and
 * writes to disk, so what comes back has been on disk and is not to be trusted.
 */
export function readAttachments(saved: unknown): Attachment[] {
  {const n=attachmentPolicy<number>('missingIds',[saved]);return attachmentPolicy('read',[saved,Array.from({length:n},()=>Math.random().toString(36).slice(2,10))]);}
}

/** A message as far as this module cares: when it was said, and what came with it. */
export type WithAttachments = { role?: string; at?: string; attachments?: Attachment[] };

/**
 * How many attachment-bearing messages back she can still see.
 *
 * This is the cost bound, and it is the whole reason the rule exists. A picture
 * has to ride along again on the next turn or "what is in week three" cannot be
 * answered — but re-sending every image in a day's conversation on every message
 * is a bill nobody agreed to.
 */
export const ATTACHMENT_TURNS = 3;

/**
 * What she can still see this turn.
 *
 * Two limits, and the second is borrowed rather than invented: the app already
 * decided a picture stays worth talking about for half an hour (PICTURE_HOLDS_MS),
 * and having the new path disagree with the old one about that would be a second
 * answer to a question already settled.
 *
 * Keyed by position in the conversation rather than returned as a flat list, so
 * each file goes back onto the message it actually arrived with — the order is
 * the array's to keep, and walking backwards from the newest is only how the two
 * limits above are applied.
 */
export function attachmentsInPlay(
  messages: WithAttachments[],
  now: number,
  { turns = ATTACHMENT_TURNS, holdsMs = PICTURE_HOLDS_MS } = {},
): Map<number, Attachment[]> {
  return new Map(attachmentPolicy('inPlay',[messages,now,{turns,holdsMs}]));
}

const KIND_WORDS: Record<AttachmentKind, string> = {
  image: 'a picture',
  audio: 'a sound file',
  video: 'a video',
  text: 'a text file',
  document: 'a PDF',
};

export function kindWord(kind: AttachmentKind): string {
  return KIND_WORDS[kind] ?? 'a file';
}

/** An attachment and whatever had to be done to make it readable. */
export type Opened = { attachment: Attachment; readable?: string };

/**
 * What is attached, written for the model rather than for the screen.
 *
 * A picture she is actually being sent needs no description — saying "this is
 * what is in it" over the top of an image she can see invites her to answer from
 * the caption instead of from the picture, which is the exact failure this whole
 * change is undoing. It gets a name and nothing else.
 *
 * Everything else is here because it had to be reduced to words to travel at
 * all: no model takes an mp4. That reduction is the attachment, so it is set out
 * plainly and labelled with where it came from.
 */
export function describeAttached(files: Opened[]): string {
  return attachmentPolicy('describe',[files]);
}

/**
 * A fuller look than the two-sentence one, for when she cannot be sent the image.
 *
 * The plain LOOK_PROMPT in vision.ts is deliberately short — it is a caption for
 * a glance at a screen, and it is capped at two sentences for good reasons that
 * all belong to that job. Handed a diagram it produces "a screenshot of some
 * text", which is true and useless.
 *
 * This one is the opposite instruction: transcribe, do not summarise. It is the
 * fallback path, so it is the only thing standing between "no hosted model" and
 * "no answer", and it has to actually carry the content.
 */
export const READ_IT_ALL_PROMPT = [
  'Read this image out in full for someone who cannot see it.',
  'Transcribe every piece of text in it word for word, including headings, labels, buttons, captions and anything in small print — do not summarise the text, quote it.',
  'Describe the layout and how the parts relate: what is a heading, what is a list, what connects to what, what the columns or boxes are and what order they run in.',
  'If it is a diagram, a chart or a table, set out its structure and every value or label in it.',
  'Be exhaustive and plain. No preamble, no "this image shows", no comments on the photography, and do not say what you think it is for.',
].join(' ');
