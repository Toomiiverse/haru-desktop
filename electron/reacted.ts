// Being reacted to, rather than replied to.
//
// A thumbs-up in her own window has always meant something — it moves her mood
// and earns a remark. On Discord the same gesture is an emoji, and until now it
// meant nothing at all: she said something, you put a heart on it, and she never
// knew. Which is the wrong way round, because an emoji is often the whole reply.
// Nobody types "that was funny" under something that was funny; they put 😂 on
// it and move on.
//
// So the emoji is read as what it is — a short answer with a tone — and she gets
// to have an opinion about it. The tone is picked here and the sentence is left
// to her, the same division as everywhere else: this file decides that 🙏 is
// gratitude or pleading, and she decides what she thinks about being thanked.

/** How she should take it. Not an emotion of hers — an assessment of yours. */
export type Taken =
  | 'adored'      // hearts, and the faces that are basically hearts
  | 'amused'      // she was funny, which she will take as proof of something
  | 'pleased'     // plain approval
  | 'thanked'     // 🙏, which is also begging, and she can tell the difference
  | 'impressed'   // fire, stars, applause
  | 'saddened'    // she landed badly, or the news did
  | 'scolded'     // thumbs down and the angry faces
  | 'doubted'     // side-eye, the thinking face, the unimpressed ones
  | 'startled'    // shock, disbelief
  | 'noted'       // acknowledged and nothing more
  | 'unreadable'; // a custom emoji, or something nobody has a word for

/** Which way it moves her, in the terms mood.ts already understands. */
export type MoodShift = 'liked' | 'disliked' | null;

type Reading = { taken: Taken; shift: MoodShift; instruction: string };

/**
 * The variation selector and skin tones, off.
 *
 * ❤️ arrives as U+2764 U+FE0F and ❤ as U+2764 alone, and they are the same
 * reaction to anybody who is not a parser. Same for 👍🏽 against 👍.
 */
export function bareEmoji(name: string): string {
  return (name ?? '').replace(/[\uFE0E\uFE0F]/g, '').replace(/[\u{1F3FB}-\u{1F3FF}]/gu, '');
}

/**
 * Grouped by what they mean rather than listed one by one, because the list is
 * long and the meanings are few — and because a heart is a heart whichever
 * colour somebody reached for.
 */
const MEANINGS: { taken: Taken; shift: MoodShift; emoji: string[] }[] = [
  { taken: 'adored', shift: 'liked', emoji: ['❤', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '🤎', '💖', '💕', '💗', '💓', '💞', '💘', '😍', '🥰', '😘', '💝'] },
  { taken: 'amused', shift: 'liked', emoji: ['😂', '🤣', '😹', '😆', '😅', '💀', '☠', '🤪', '😝'] },
  { taken: 'pleased', shift: 'liked', emoji: ['😊', '😄', '😃', '😁', '😀', '🙂', '☺', '👍', '✅', '👌', '🙌', '💯', '😌'] },
  { taken: 'thanked', shift: 'liked', emoji: ['🙏', '🥹'] },
  { taken: 'impressed', shift: 'liked', emoji: ['🔥', '⭐', '🌟', '✨', '🎉', '🎊', '👏', '🤩', '😎', '🏆'] },
  { taken: 'saddened', shift: null, emoji: ['😢', '😭', '😞', '😔', '🥺', '😥', '😿', '💔', '😩', '😖'] },
  { taken: 'scolded', shift: 'disliked', emoji: ['👎', '😡', '😠', '🤬', '❌', '🙅', '😤', '💢'] },
  { taken: 'doubted', shift: 'disliked', emoji: ['🙄', '😒', '🤨', '🤔', '😑', '😐', '🫤', '😬'] },
  { taken: 'startled', shift: null, emoji: ['😮', '😲', '🤯', '😱', '‼', '⁉', '👀', '😳'] },
  { taken: 'noted', shift: null, emoji: ['🫡', '🤝', '👋', '✔', '☑'] },
];

/**
 * What she is told about it.
 *
 * One line each, and all of them the same shape: what the gesture was, and the
 * one thing not to do about it. The last clause matters more than the first —
 * left to herself she answers an emoji with a paragraph, which is exactly the
 * wrong weight of reply to a gesture somebody made instead of typing.
 */
const INSTRUCTIONS: Record<Taken, string> = {
  adored: 'They put a heart on something you said. Take it as your due and be a little too pleased with yourself about it, without going soft.',
  amused: 'They laughed at something you said. Take the credit — you are funny and this is evidence — but do not explain the joke or try to do it again.',
  pleased: 'They approved of something you said. Accept it the way somebody accepts a thing they already knew.',
  thanked: 'They thanked you, or they are begging. Work out which from what you said and answer that one — brush off gratitude, and be smug about being begged at.',
  impressed: 'They are impressed by something you said. Agree with them.',
  saddened: 'They reacted sadly to something you said. Do not be flippant about this one. Something either landed badly or was bad news; ask which, briefly, and mean it.',
  scolded: 'They reacted badly to something you said — annoyed, or a flat no. Do not apologise. Find out what they actually objected to.',
  doubted: 'They are unconvinced by something you said. Stand by it or admit the hole in it, but do not hedge.',
  startled: 'They are taken aback by something you said. Enjoy it, and say what they have just worked out.',
  noted: 'They acknowledged something you said and nothing more. Let it be — a nod does not need an answer, so keep it to a few words at most.',
  unreadable: 'They reacted with an emoji you do not recognise. Do not guess at what it meant or name it. React to being reacted to at all.',
};

/**
 * A reaction on Discord, read.
 *
 * Custom server emoji arrive as a name and an id rather than a character. The
 * name is often meaningful — `:haru_stare:` — but guessing from it is how she
 * ends up confidently misreading somebody's in-joke, so it is treated as the
 * unreadable case and she reacts to the gesture rather than the picture.
 */
export function readReaction(name: string, custom = false): Reading {
  const emoji = bareEmoji(name);
  const found = custom ? undefined : MEANINGS.find(group => group.emoji.includes(emoji));
  const taken = found?.taken ?? 'unreadable';
  return { taken, shift: found?.shift ?? null, instruction: INSTRUCTIONS[taken] };
}

/**
 * What she is asked, with the line being reacted to attached.
 *
 * The line matters more than the emoji does. 😢 on "your appointment is
 * tomorrow" and 😢 on "I deleted it" are not the same reaction, and without the
 * text she can only answer the emoji — which reads as a bot with an emoji
 * lookup table, because that is what it would be.
 */
export function reactedPrompt(reading: Reading, herLine: string): string {
  return [
    reading.instruction,
    `This is what you had said: "${herLine.replace(/\s+/g, ' ').slice(0, 400)}"`,
    'Answer in one short line, in your own voice. They reacted rather than typing, so match that weight — no paragraph, no follow-up questions unless the reaction was a sad one, and never mention emoji, reactions or that you noticed one.',
  ].join(' ');
}

/**
 * How long she leaves it before a reaction earns another line.
 *
 * Reacting is cheap and people do it in handfuls — three emoji on one message,
 * or a sweep back through the morning. Each one is not a conversation, and a
 * reply to every one of them is a bot spamming a channel.
 */
export const REACTION_COOLDOWN_MS = 90_000;
