// Fly-inspired leaky competition, not a FlyWire simulation or a learned policy.
// Shadow only: no return value from this module is used to control Haru.
import { appendFileSync, existsSync, renameSync, statSync, unlinkSync } from 'node:fs';
import type { Vitals, Environment } from './vitals';
import { shouldPipeUp } from './opening';
import type { ActivityObservation } from './activity-observation';

export const ATTENTION_POLICY = 3;

export type AttentionAction = 'attend' | 'investigate' | 'speak' | 'rest';
type Scores = Record<AttentionAction, number>;
export type AttentionInput = {
  now: number;
  vitals: Vitals;
  environment: Environment;
  activity: string; // Category only; never a window title or message.
  sinceInteractionMs: number;
  baselineReady: boolean | null;
  blocked: boolean;
  tickId?: number;
  blockReasons?: string[];
  observation?: ActivityObservation;
};
export type AttentionState = {
  at: number; activity: string; novelty: number; action: AttentionAction;
  scores: Scores; lastProposalAt: number | null;
  challenger: AttentionAction | null; challengerSince: number;
};
const zeroScores = (): Scores => ({ attend: 0, investigate: 0, speak: 0, rest: 0 });
export const newAttentionState = (): AttentionState => ({
  at: 0, activity: '', novelty: 0, action: 'rest', scores: zeroScores(), lastProposalAt: null,
  challenger: null, challengerSince: 0,
});
const unit = (n: number) => Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0;
export function stepAttention(previous: AttentionState, input: AttentionInput): AttentionState {
  const now = Number.isFinite(input.now) && input.now >= 0 && input.now <= 8.64e15 ? Math.max(previous.at, input.now) : previous.at;
  const seconds = previous.at ? Math.min(300, Math.max(0, (now - previous.at) / 1000)) : 20;
  const v = input.vitals;
  const energy = unit(v.energy), curiosity = unit(v.curiosity), sleep = unit(v.sleepiness);
  const focus = unit(v.focus), stress = unit(v.stress);
  const idle = input.environment.idleSeconds;
  const active = typeof idle === 'number' && Number.isFinite(idle) && idle >= 0 && idle <= 300;
  const direct = Number.isFinite(input.sinceInteractionMs) && input.sinceInteractionMs >= 0 && input.sinceInteractionMs < 180_000;
  // Repeated readings habituate; a change of category renews interest.
  // ponytail: category-level novelty; add richer events only if replay shows value.
  const novelty = previous.activity && previous.activity !== input.activity
    ? 1 : previous.novelty * Math.exp(-seconds / 90);
  const quietMs = Math.min(input.sinceInteractionMs, previous.lastProposalAt === null ? Infinity : now - previous.lastProposalAt);
  const quietDrive = quietMs === Infinity ? 1 : unit((quietMs / 60_000 - 15) / 15);
  const targets: Scores = {
    attend: direct ? 1 : active ? 0.25 + focus * 0.4 : 0.1,
    investigate: active ? novelty * curiosity * (1 - stress) : 0,
    speak: active ? unit(energy * curiosity * (1 - stress) * (1 - sleep)
      * (0.85 + quietDrive * (1 - focus) * 0.6)) : 0,
    rest: Math.max(sleep, 1 - energy, active ? 0.1 : 0.7),
  };
  const alpha = 1 - Math.exp(-seconds / 30);
  const scores = zeroScores();
  for (const action of Object.keys(scores) as AttentionAction[]) {
    scores[action] = unit(previous.scores[action] + alpha * (targets[action] - previous.scores[action]));
  }
  const recentProposal = previous.lastProposalAt !== null && now - previous.lastProposalAt < 600_000;
  // Reuse the established patience and sleep rules, without another random draw.
  const validSilence = input.sinceInteractionMs === Infinity
    || (Number.isFinite(input.sinceInteractionMs) && input.sinceInteractionMs >= 0);
  const patient = active && validSilence && shouldPipeUp({
    minutesSinceUserSpoke: input.sinceInteractionMs / 60_000,
    minutesSinceSheSpoke: previous.lastProposalAt === null ? Infinity : (now - previous.lastProposalAt) / 60_000,
    machineIdleSeconds: idle, curiosity, sleepiness: sleep,
  }, () => 0);
  if (input.blocked || direct || recentProposal || !active || !patient) scores.speak = 0;
  let action = (Object.keys(scores) as AttentionAction[]).reduce((best, next) => scores[next] > scores[best] ? next : best, 'rest');
  // Small advantages must persist for a minute, rather than being ignored forever.
  let challenger: AttentionAction | null = null;
  let challengerSince = now;
  if (action !== previous.action && scores[previous.action] > 0 && scores[action] - scores[previous.action] < 0.08) {
    challenger = action;
    challengerSince = previous.challenger === action ? previous.challengerSince : now;
    if (now - challengerSince < 60_000) action = previous.action;
  }
  if (direct) action = 'attend';
  if (direct || action === challenger) challenger = null;
  return {
    at: now, activity: input.activity, novelty, action, scores, challenger, challengerSince,
    lastProposalAt: action === 'speak' ? now : previous.lastProposalAt,
  };
}

export type AttentionMode = 'off' | 'shadow';
// Live modes remain unavailable until the separately evaluated nudge pilot.
export function readAttentionMode(value: string | undefined, legacyOff = false): AttentionMode {
  if (legacyOff) return 'off';
  return value === undefined || value === 'shadow' ? 'shadow' : 'off';
}
export class AttentionRuntime {
  private state = newAttentionState();
  constructor(private readonly mode: AttentionMode = 'shadow') {}
  advance(input: AttentionInput) {
    if (this.mode === 'off') return null;
    this.state = stepAttention(this.state, input);
    const unknown = typeof input.environment.idleSeconds !== 'number' || !Number.isFinite(input.environment.idleSeconds) || input.environment.idleSeconds < 0;
    const reasons = [...(input.blockReasons ?? [])];
    if (unknown) reasons.push('unknown-activity');
    if (input.blocked && !reasons.length) reasons.push('blocked');
    if (input.sinceInteractionMs >= 0 && input.sinceInteractionMs < 180_000) reasons.push('recent-conversation');
    return { action: this.state.action, proposedAction: unknown ? null : this.state.action,
      at: this.state.at, scores: { ...this.state.scores }, novelty: this.state.novelty, reasons };
  }
}

// Two bounded files, metadata only. A failed diagnostic must never break a turn.
export class AttentionExperiment {
  private runtime: AttentionRuntime;
  latest: ReturnType<AttentionRuntime['advance']> = null;
  private webState = newAttentionState();
  private lastWebInputAt: number | null = null;
  private disabled = false;
  private sequence = 0;
  private readonly session = Date.now().toString(36);
  constructor(private readonly file: () => string, private readonly enabled = true,
    private readonly maxBytes = 2 * 1024 * 1024, private readonly logging = true) {
    this.runtime = new AttentionRuntime(enabled ? 'shadow' : 'off');
  }
  // Authenticated browser-reported input, timestamped on receipt. No content,
  // client clock, device identifier or write to Haru's conversational state.
  webInput(now = Date.now()): void {
    if (!this.enabled || !Number.isFinite(now) || now < 0 || now > 8.64e15) return;
    if (this.lastWebInputAt === null || now >= this.lastWebInputAt) this.lastWebInputAt = now;
  }
  observe(input: AttentionInput): void {
    if (!this.enabled) return;
    const started = performance.now();
    const decision = this.runtime.advance(input);
    this.latest = decision;
    if (!decision) return;
    const computeMs = performance.now() - started;
    const webStarted = performance.now();
    const age = this.lastWebInputAt === null ? Infinity : input.now - this.lastWebInputAt;
    const recent = Number.isFinite(age) && age >= 0 && age <= 300_000;
    // Run the same policy with client input, holding vitals and other inputs
    // fixed. Unknown evidence cannot permit speech. Keep the state/cooldown
    // across unknown gaps, but do not report a guessed action for those gaps.
    this.webState = stepAttention(this.webState, { ...input,
      environment: { ...input.environment, idleSeconds: recent ? age / 1000 : Infinity },
      blocked: input.blocked || !recent,
    });
    const webComputeMs = performance.now() - webStarted;
    this.write({
      kind: 'sample', at: new Date(decision.at).toISOString(), tickId: input.tickId,
      action: decision.action, proposedAction: decision.proposedAction, reasons: decision.reasons,
      scores: decision.scores, novelty: decision.novelty, observation: input.observation,
      inputs: { vitals: input.vitals, environment: input.environment, sinceInteractionMs: Number.isFinite(input.sinceInteractionMs) ? input.sinceInteractionMs : null },
      activity: input.activity, baselineReady: input.baselineReady,
      blocked: input.blocked, baselineEligible: input.baselineReady === null ? null : input.baselineReady && !input.blocked,
      computeMs, webComputeMs,
      webInput: { status: recent ? 'recent-input' : 'unknown', ageMs: recent ? age : null },
      webShadow: recent ? { action: this.webState.action, scores: this.webState.scores, novelty: this.webState.novelty } : null,
    });
  }
  event(kind: 'interaction' | 'feedback' | 'aside' | 'repeat-blocked', details: { id?: string; source?: string; reaction?: string | null } = {}): void {
    this.write({ kind, at: new Date().toISOString(), ...details });
  }
  baseline(tickId: number, ready: boolean, blocked: boolean, reason: string | null): void {
    this.write({ kind: 'baseline', at: new Date().toISOString(), tickId, ready, blocked,
      baselineEligible: ready && !blocked, reason });
  }
  outcome(tickId: number, stage: 'attempted' | 'accepted' | 'suppressed' | 'failed'): void {
    // Accepted means written to Haru's chat, not heard, read, or delivered by push.
    this.write({ kind: 'outcome', at: new Date().toISOString(), tickId, source: 'idle', stage });
  }
  private write(row: Record<string, unknown>): void {
    if (!this.enabled || !this.logging || this.disabled) return;
    try {
      const file = this.file();
      const line = JSON.stringify({ version: 1, policy: ATTENTION_POLICY, mode: 'shadow', session: this.session, sequence: ++this.sequence, ...row }) + '\n';
      if (existsSync(file) && statSync(file).size + Buffer.byteLength(line) > this.maxBytes) {
        if (existsSync(file + '.1')) unlinkSync(file + '.1');
        renameSync(file, file + '.1');
      }
      appendFileSync(file, line, 'utf8');
    } catch {
      this.disabled = true;
      console.warn('[attention] diagnostics unavailable; logging disabled, runtime continues');
    }
  }
}
