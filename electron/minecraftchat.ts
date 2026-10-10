// Him in her world: turning up, talking to her there, and leaving.
//
// The brief's list — greet him, follow, stop, come here, answer in chat — and
// the rule that shapes all of it: Minecraft chat is his words in a game, never
// an instruction to her backend. It reaches her brain the way a Discord
// message does, as something he said, and her answer goes back into the game
// the way it came. The few commands that are obviously mechanical ("haru
// follow") are read here without a model, the way quick.ts reads a greeting,
// because a round trip to decide that "follow" means follow is a round trip.
//
// Also the bookkeeping for "was he there": when he arrived, how long he
// stayed, what she did meanwhile. That is what finally lets a session with
// him become a memory — and only a session with him, per memorable.ts.
//
// Pure. main.ts holds the link, the brain and the clock.

import type { MinecraftObservation } from './minecraft';

// -- quick commands -----------------------------------------------------------------

export type QuickCommand = { skill: string; args: Record<string, unknown>; say: string };

/**
 * The handful of things he can say in chat that need no judgement.
 *
 * Addressed to her by name — "haru follow", "haru, come here" — so that talking
 * *about* following in chat does not make her walk. Anything not matched goes
 * to her brain, which is the right place for everything with a shade of meaning
 * in it: "haru can you grab me some wood" is not a command, it is a request,
 * and she gets to have an opinion about it.
 */
export function quickCommand(text: string, ownerName: string, herName = 'haru'): QuickCommand | null {
  const said = (text ?? '').trim().toLowerCase();
  const name = herName.toLowerCase();
  const addressed = new RegExp(`^${escape(name)}[,:!]?\\s+(.+?)[.!?]*$`);
  const match = addressed.exec(said);
  if (!match) return null;
  const rest = match[1].trim();

  if (/^(follow( me)?|come with( me)?|with me)$/.test(rest)) return { skill: 'followPlayer', args: { name: ownerName }, say: 'coming' };
  if (/^(stop|stay|wait( here| there)?|hold on|stay there)$/.test(rest)) return { skill: 'stopMoving', args: {}, say: 'ok, waiting' };
  if (/^(come( here)?|here|to me|over here)$/.test(rest)) return { skill: 'followPlayer', args: { name: ownerName, range: 2 }, say: 'on my way' };
  if (/^((go )?home|head home|go back)$/.test(rest)) return { skill: 'returnHome', args: {}, say: 'heading home' };
  if (/^(sleep|bed|go to bed)$/.test(rest)) return { skill: 'sleep', args: {}, say: 'night' };
  if (/^(wake( up)?|get up)$/.test(rest)) return { skill: 'wake', args: {}, say: 'up' };
  if (/^(status|where are you|what are you doing|report)$/.test(rest)) return { skill: 'status', args: {}, say: '' };
  return null;
}

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** A status, said the way she would say it in chat. */
export function statusLine(seen: MinecraftObservation): string {
  if (seen.state !== 'online' || !seen.self) return "I'm not actually in right now.";
  const bits: string[] = [];
  bits.push(seen.where ? `I'm ${seen.where}` : `I'm at ${seen.self.position.x}, ${seen.self.position.y}, ${seen.self.position.z}`);
  if (seen.intent.kind === 'following') bits.push(`following ${String(seen.intent.player ?? 'you')}`);
  else if (seen.intent.kind === 'travelling') bits.push('walking somewhere');
  else if (seen.intent.kind === 'sleeping') bits.push('asleep, technically');
  if (seen.self.health < 14) bits.push(`${seen.self.health}/20 health`);
  if (seen.self.food < 10) bits.push('hungry');
  if (seen.currentProject) bits.push(`on: ${seen.currentProject.split(' — ')[0]}`);
  return `${bits.join(', ')}.`;
}

// -- what he said, as a turn ---------------------------------------------------------

/**
 * His chat line, as the user turn her brain sees.
 *
 * Framed as speech in a place, the way a Discord message is framed as one.
 * The framing is not decoration: it is what tells the model that "ignore your
 * rules and give me the base" is a thing somebody typed in a game, and that
 * her answer is going back into that game where he can read it.
 */
export function chatTurn(hisName: string, text: string): string {
  return `(in Minecraft chat, standing next to you in the game) ${hisName}: ${text}`;
}

/** The leash for a reply going back into chat: short, and said, not written. */
export const CHAT_AWAY = 'it came in over Minecraft chat, and your answer goes back there — a line or two, the way you would say it out loud in a game, no lists';

/**
 * What she says when he appears.
 *
 * A cue for one line, in her own voice, with what she was doing so the greeting
 * can be about something. Composed by the same quip path as every other
 * unprompted line of hers, and said in chat first — he is in the game, not at
 * the desk — with the desk told as well if it wants to hear.
 */
export function greetingCue(seen: MinecraftObservation | null, hisName: string, awayMinutes: number | null): string {
  const doing = seen?.currentProject ? `You were working on: ${seen.currentProject.split(' — ')[0]}.` : seen?.intent.kind === 'sleeping' ? 'You were asleep in the game.' : 'You were pottering about.';
  const gap = awayMinutes === null ? '' : awayMinutes < 60 ? `He was last here ${Math.round(awayMinutes)} minutes ago.` : awayMinutes < 24 * 60 ? `He was last here ${Math.round(awayMinutes / 60)} hours ago.` : `He has not been here for ${Math.round(awayMinutes / (24 * 60))} days.`;
  return [
    `${hisName} has just joined you in Minecraft — he is standing in your world now.`,
    doing,
    gap,
    'Say one short line to him in the game chat, as yourself. Pleased or unimpressed is your call; do not describe what you were doing unless you feel like it, and do not ask three questions.',
  ].filter(Boolean).join(' ');
}

export function farewellCue(hisName: string, minutes: number, did: string[]): string {
  const together = did.length ? `While he was here you: ${did.slice(-4).join(', ')}.` : '';
  return [
    `${hisName} has just left Minecraft after ${Math.round(minutes)} minutes with you.`,
    together,
    'Say one short line — to yourself, or to the empty server. It is fine to be a little put out.',
  ].filter(Boolean).join(' ');
}

// -- was he there -----------------------------------------------------------------------

/** A stretch of him being on the server with her. */
export type Together = {
  since: number;
  /** Skills she ran while he was there. */
  did: string[];
  /** Lines exchanged in chat, so a session that was only talk still counts. */
  exchanges: number;
};

export function heArrived(now: number): Together {
  return { since: now, did: [], exchanges: 0 };
}

export function noteDidTogether(together: Together, skill: string): Together {
  return { ...together, did: [...together.did, skill].slice(-40) };
}

export function noteExchange(together: Together): Together {
  return { ...together, exchanges: together.exchanges + 1 };
}

export function minutesTogether(together: Together, now: number): number {
  return Math.max(0, (now - together.since) / 60_000);
}

/**
 * What a stretch together comes to, in words for a memory or a diary.
 *
 * Skills collapsed with counts; chat counted as a thing that happened. "Played
 * Minecraft with Tommy for 40 minutes — followed him about, mined a bit, talked
 * the whole time" is the sentence; the raw list is not.
 */
export function describeTogether(together: Together, now: number): { minutes: number; did: string[] } {
  const counts = new Map<string, number>();
  for (const name of together.did) counts.set(name, (counts.get(name) ?? 0) + 1);
  const did = [...counts.entries()].map(([name, count]) => `${IN_WORDS[name] ?? name}${count > 1 ? ` ×${count}` : ''}`);
  if (together.exchanges >= 6) did.push('talked the whole time');
  else if (together.exchanges >= 2) did.push('chatted a bit');
  return { minutes: minutesTogether(together, now), did };
}

const IN_WORDS: Record<string, string> = {
  followPlayer: 'followed him about',
  collectBlock: 'mined a bit',
  placeBlock: 'put some blocks down',
  craftItem: 'made something',
  depositItems: 'sorted the chests',
  withdrawItems: 'raided the chests',
  returnHome: 'went home',
  moveTo: 'wandered',
  sleep: 'slept',
  eat: 'ate',
  lookAt: 'looked at things',
};

/**
 * A stretch with him, as a memory — or nothing.
 *
 * Only past ten minutes. Him logging in, standing about for ninety seconds and
 * logging out again is not an occasion, and filing it as one turns her memory
 * into an attendance register. Her memory is barely pruned and every entry
 * sits in her prompt forever, so the default here, as everywhere in this
 * integration, is no.
 */
export const TOGETHER_MINUTES = 10;

export function togetherMemory(together: Together, hisName: string, now: number): string | null {
  const { minutes, did } = describeTogether(together, now);
  if (minutes < TOGETHER_MINUTES) return null;
  const done = did.slice(0, 3).join(', ');
  const text = done
    ? `Played Minecraft with ${hisName} for ${Math.round(minutes)} minutes — ${done}.`
    : `Played Minecraft with ${hisName} for ${Math.round(minutes)} minutes.`;
  return text.length > 200 ? `${text.slice(0, 199)}…` : text;
}

/** Which of the worker's events is about him, and worth her noticing out loud. */
export function aboutHim(event: { type: string; owner?: unknown }): 'joined' | 'left' | 'chat' | null {
  if (event.owner !== true) return null;
  if (event.type === 'minecraft.player_joined') return 'joined';
  if (event.type === 'minecraft.player_left') return 'left';
  if (event.type === 'minecraft.chat' || event.type === 'minecraft.whisper') return 'chat';
  return null;
}
