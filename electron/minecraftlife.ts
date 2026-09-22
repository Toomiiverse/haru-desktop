// When she plays, and when she stops.
//
// The brief's shape, and the right one: Minecraft is something she chooses to
// do with time nobody else wants, not something that runs whenever it can. So
// a session starts only when he has been quiet a while, she is awake, and a
// dice roll lands — the same "a chance, not a rota" that her nights and her
// daytime reading use — and it ends when he speaks to her, when she has run
// out of things to decide, or when it has simply gone on long enough.
//
// Pure, like ownlife.ts, for the same reason: the timing rules are the part
// that is wrong in ways nobody notices. A session that never starts and one
// that starts every minute both look like "she is playing Minecraft" from the
// outside until someone reads the log.
//
// Nothing here touches the worker, the model or the store. main.ts holds the
// clock and does the doing; this decides.

export type PlayConfig = {
  /** Whether she may play on her own at all. Off until switched on. */
  enabled: boolean;
  /** How long he has to have been quiet before it is her time. */
  idleMinutes: number;
  /** The most one session may run, wall-clock. */
  sessionMinutes: number;
  /** How often the planner is asked while a session is on. */
  tickSeconds: number;
  /** Chance per idle tick that she starts. Low: over an idle hour it lands once or twice. */
  oddsPerTick: number;
  /** Consecutive "wait"s before she concludes there is nothing to do. */
  maxWaits: number;
  /** Sessions in one day, so an idle Sunday is not eight hours of Minecraft. */
  maxPerDay: number;
};

export const DEFAULT_PLAY: PlayConfig = {
  enabled: false,
  idleMinutes: 20,
  sessionMinutes: 45,
  tickSeconds: 45,
  oddsPerTick: 1 / 8,
  maxWaits: 3,
  maxPerDay: 3,
};

const clamp = (value: unknown, min: number, max: number, fallback: number) =>
  typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;

export function readPlayConfig(saved: unknown): PlayConfig {
  if (!saved || typeof saved !== 'object') return { ...DEFAULT_PLAY };
  const record = saved as Partial<PlayConfig>;
  return {
    enabled: record.enabled === true,
    idleMinutes: clamp(record.idleMinutes, 1, 24 * 60, DEFAULT_PLAY.idleMinutes),
    sessionMinutes: clamp(record.sessionMinutes, 5, 6 * 60, DEFAULT_PLAY.sessionMinutes),
    tickSeconds: clamp(record.tickSeconds, 20, 600, DEFAULT_PLAY.tickSeconds),
    oddsPerTick: clamp(record.oddsPerTick, 0, 1, DEFAULT_PLAY.oddsPerTick),
    maxWaits: clamp(record.maxWaits, 1, 20, DEFAULT_PLAY.maxWaits),
    maxPerDay: clamp(record.maxPerDay, 1, 48, DEFAULT_PLAY.maxPerDay),
  };
}

/** Everything the gate looks at, gathered by the caller at the moment of asking. */
export type Situation = {
  now: number;
  /** When he last did anything to her — spoke, typed, thumbed. 0 for never. */
  lastUserActivityAt: number;
  /** Her own sleep (hersleep.ts). Asleep is asleep; she does not mine in it. */
  asleep: boolean;
  /** Up because he knocked. Not her time either. */
  knockedAwake: boolean;
  /** Mid-sentence, on the desk or the phone. */
  speaking: boolean;
  /** On a voice call. */
  inCall: boolean;
  /** The worker is answering. */
  workerUp: boolean;
  /** Her body is actually in the world. */
  inWorld: boolean;
  /** The skill her body is in the middle of, or null. */
  bodyBusy: string | null;
  sessionsToday: number;
};

/**
 * Why she would not start now, or null when she may.
 *
 * Ordered by how cheap and how certain each answer is. The point of returning a
 * sentence rather than a boolean is the log: "not playing — he was talking to
 * her 4 min ago" is diagnosable, and "false" is not.
 */
export function whyNotStart(situation: Situation, config: PlayConfig): string | null {
  if (!config.enabled) return 'playing on her own is switched off';
  if (!situation.workerUp) return 'the worker is not running';
  if (!situation.inWorld) return 'she is not in the world';
  if (situation.asleep) return 'she is asleep';
  if (situation.knockedAwake) return 'she was knocked awake, and that is not her time';
  if (situation.speaking) return 'she is mid-sentence';
  if (situation.inCall) return 'she is on a call';
  if (situation.sessionsToday >= config.maxPerDay) return `she has played ${situation.sessionsToday} times today already`;
  const quietFor = situation.lastUserActivityAt ? situation.now - situation.lastUserActivityAt : Infinity;
  const needed = config.idleMinutes * 60_000;
  if (quietFor < needed) return `he was talking to her ${Math.round(quietFor / 60_000)} min ago (needs ${config.idleMinutes})`;
  return null;
}

/** The gate and the dice, together. */
export function wantsToStart(situation: Situation, config: PlayConfig, roll: number): boolean {
  return whyNotStart(situation, config) === null && roll < config.oddsPerTick;
}

// -- a session ------------------------------------------------------------------

export type Session = {
  startedAt: number;
  /** Planner ticks that actually asked. */
  ticks: number;
  /** Consecutive waits. Reset by a decision. */
  waits: number;
  /** What she did, in order, as short names. For the log and the diary. */
  did: string[];
  /** When he was last seen active at the start, so a later move is a yield. */
  quietSince: number;
};

export function newSession(now: number, lastUserActivityAt: number): Session {
  return { startedAt: now, ticks: 0, waits: 0, did: [], quietSince: lastUserActivityAt };
}

export function minutesPlayed(session: Session, now: number): number {
  return Math.max(0, (now - session.startedAt) / 60_000);
}

/**
 * He started talking to her.
 *
 * The one thing that ends a session at once rather than at the next natural
 * pause. Detected by his activity clock having moved since the session began:
 * no hook into the conversation is needed, and none is wanted — the planner
 * polls this on every tick, and the tick is the cadence at which she can
 * change what her body is doing anyway.
 */
export function heSpoke(session: Session, situation: Situation): boolean {
  return situation.lastUserActivityAt > session.quietSince;
}

/**
 * He spoke to her in the game.
 *
 * Talking to her in Minecraft chat goes through the same brain as everything
 * else, and so through noteUserSpoke — which the yield rule reads as "he started
 * talking to her elsewhere". It is the opposite: it is him playing with her,
 * and it must not end the session that makes her follow him about. So the
 * quiet-since mark is moved up to now, and the next tick sees no yield.
 */
export function heardInGame(session: Session, lastUserActivityAt: number): Session {
  return { ...session, quietSince: Math.max(session.quietSince, lastUserActivityAt) };
}

/**
 * Why she would not join him when he turns up, or null when she may.
 *
 * Him arriving is an invitation, and an invitation is not subject to the idle
 * rule, the dice, or the daily cap — those exist so that she does not spend her
 * own time on Minecraft when he might want her; if he is *in* Minecraft, that
 * is where he wants her. Only the hard reasons remain.
 */
export function whyNotJoinHim(situation: Situation, config: PlayConfig): string | null {
  if (!config.enabled) return 'playing on her own is switched off';
  if (!situation.workerUp) return 'the worker is not running';
  if (!situation.inWorld) return 'she is not in the world';
  if (situation.asleep) return 'she is asleep';
  if (situation.inCall) return 'she is on a call';
  return null;
}

/**
 * Why the session should end now, or null to carry on.
 *
 * Checked before every tick, in this order: him first, because that is the
 * rule that matters; then the clock; then her having nothing to do.
 */
export function whyStop(session: Session, situation: Situation, config: PlayConfig): string | null {
  if (heSpoke(session, situation)) return 'he started talking to her';
  if (situation.asleep) return 'she fell asleep';
  if (situation.inCall) return 'a call started';
  if (!situation.workerUp || !situation.inWorld) return 'she is no longer in the world';
  if (minutesPlayed(session, situation.now) >= config.sessionMinutes) return `she has played for ${Math.round(minutesPlayed(session, situation.now))} minutes`;
  if (session.waits >= config.maxWaits) return `she waited ${session.waits} times running — nothing to do`;
  return null;
}

/**
 * Whether this tick should ask the planner at all.
 *
 * Not while her body is busy: a new plan supersedes the running skill, and a
 * planner that fires over a three-minute collectBlock cancels it every 45
 * seconds forever. The body reports what it is doing; the tick waits its turn.
 */
export function shouldAsk(situation: Situation): { ask: true } | { ask: false; because: string } {
  if (situation.bodyBusy) return { ask: false, because: `her body is still ${situation.bodyBusy}` };
  return { ask: true };
}

/** What a tick produced, recorded. */
export function noteTick(session: Session, outcome: { kind: 'do'; skill: string } | { kind: 'wait' } | { kind: 'failed'; skill: string }): Session {
  if (outcome.kind === 'wait') return { ...session, ticks: session.ticks + 1, waits: session.waits + 1 };
  if (outcome.kind === 'failed') return { ...session, ticks: session.ticks + 1, waits: session.waits + 1, did: [...session.did, `${outcome.skill} (failed)`].slice(-40) };
  return { ...session, ticks: session.ticks + 1, waits: 0, did: [...session.did, outcome.skill].slice(-40) };
}

/**
 * The session in one line, for the log and for her diary.
 *
 * Skills are collapsed with counts so "collectBlock ×6, returnHome, sleep"
 * reads as an evening rather than a transcript.
 */
export function summarise(session: Session, now: number): string {
  const minutes = Math.round(minutesPlayed(session, now));
  const counts = new Map<string, number>();
  for (const name of session.did) counts.set(name, (counts.get(name) ?? 0) + 1);
  const done = [...counts.entries()].map(([name, count]) => count > 1 ? `${name} ×${count}` : name).join(', ');
  return done ? `played for ${minutes} min: ${done}` : `played for ${minutes} min and did nothing much`;
}

/**
 * What to do with her body when a session ends.
 *
 * Deterministic and cheap — no model. A checkpoint so the project remembers
 * where she got to; home, if she is far from it and has one; bed, if it is
 * night and she is home. Each is best-effort and the caller fires them one
 * after another without waiting for the walk, because ending a session is
 * about her attention, not her legs.
 */
export type WindDown = { skill: string; args: Record<string, unknown> }[];

export function windDown(input: { reason: string; lastDecision: string; hasHome: boolean; nearHome: boolean; night: boolean }): WindDown {
  const steps: WindDown = [];
  steps.push({ skill: 'stopMoving', args: {} });
  steps.push({ skill: 'checkpoint', args: { note: input.lastDecision ? `stopped (${input.reason}) after: ${input.lastDecision}`.slice(0, 200) : `stopped (${input.reason})` } });
  if (input.hasHome && !input.nearHome) steps.push({ skill: 'returnHome', args: {} });
  if (input.night && (input.nearHome || !input.hasHome)) steps.push({ skill: 'sleep', args: {} });
  return steps;
}
