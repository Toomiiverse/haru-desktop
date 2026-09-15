// Fly-inspired leaky competition, not a FlyWire simulation or a learned policy.
// Shadow only: no return value from this module is used to control Haru.
import { appendFileSync, existsSync, renameSync, statSync, unlinkSync } from 'node:fs';
import type { Vitals, Environment } from './vitals';

export type AttentionAction = 'attend' | 'investigate' | 'speak' | 'rest';
type Scores = Record<AttentionAction, number>;
export type AttentionInput = {
  now: number;
  vitals: Vitals;
  environment: Environment;
  activity: string; // Category only; never a window title or message.
  sinceInteractionMs: number;
  baselineReady: boolean;
  blocked: boolean;
};
export type AttentionState = {
  at: number; activity: string; novelty: number; action: AttentionAction;
  scores: Scores; lastProposalAt: number | null;
};
const zeroScores = (): Scores => ({ attend: 0, investigate: 0, speak: 0, rest: 0 });
export const newAttentionState = (): AttentionState => ({
  at: 0, activity: '', novelty: 0, action: 'rest', scores: zeroScores(), lastProposalAt: null,
});
const unit = (n: number) => Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0;
export function stepAttention(previous: AttentionState, input: AttentionInput): AttentionState {
  const now = Number.isFinite(input.now) ? Math.max(previous.at, input.now) : previous.at;
  const seconds = previous.at ? Math.min(300, Math.max(0, (now - previous.at) / 1000)) : 20;
  const v = input.vitals;
  const energy = unit(v.energy), curiosity = unit(v.curiosity), sleep = unit(v.sleepiness);
  const focus = unit(v.focus), stress = unit(v.stress);
  const active = Number.isFinite(input.environment.idleSeconds) && input.environment.idleSeconds < 300;
  const direct = Number.isFinite(input.sinceInteractionMs) && input.sinceInteractionMs >= 0 && input.sinceInteractionMs < 180_000;
  // Repeated readings habituate; a change of category renews interest.
  // ponytail: category-level novelty; add richer events only if replay shows value.
  const novelty = previous.activity && previous.activity !== input.activity
    ? 1 : previous.novelty * Math.exp(-seconds / 90);
  const targets: Scores = {
    attend: direct ? 1 : active ? 0.25 + focus * 0.4 : 0.1,
    investigate: active ? novelty * curiosity * (1 - stress) : 0,
    speak: active ? energy * curiosity * (1 - stress) * (1 - sleep) * 0.85 : 0,
    rest: Math.max(sleep, 1 - energy, active ? 0.1 : 0.7),
  };
  const alpha = 1 - Math.exp(-seconds / 30);
  const scores = zeroScores();
  for (const action of Object.keys(scores) as AttentionAction[]) {
    scores[action] = unit(previous.scores[action] + alpha * (targets[action] - previous.scores[action]));
  }
  const recentProposal = previous.lastProposalAt !== null && now - previous.lastProposalAt < 600_000;
  if (input.blocked || direct || recentProposal || !active) scores.speak = 0;
  let action = (Object.keys(scores) as AttentionAction[]).reduce((best, next) => scores[next] > scores[best] ? next : best, 'rest');
  // A challenger must win by a margin, so small input changes do not cause flicker.
  if (scores[previous.action] > 0 && scores[action] - scores[previous.action] < 0.08) action = previous.action;
  if (direct) action = 'attend';
  return {
    at: now, activity: input.activity, novelty, action, scores,
    lastProposalAt: action === 'speak' ? now : previous.lastProposalAt,
  };
}

// Two bounded files, metadata only. A failed diagnostic must never break a turn.
export class AttentionExperiment {
  private state = newAttentionState();
  private disabled = false;
  private sequence = 0;
  private readonly session = Date.now().toString(36);
  constructor(private readonly file: () => string, private readonly enabled = true, private readonly maxBytes = 2 * 1024 * 1024) {}
  observe(input: AttentionInput): void {
    if (!this.enabled || this.disabled) return;
    const started = performance.now();
    this.state = stepAttention(this.state, input);
    this.write({
      kind: 'sample', at: new Date(this.state.at).toISOString(),
      action: this.state.action, scores: this.state.scores, novelty: this.state.novelty,
      activity: input.activity, baselineReady: input.baselineReady,
      blocked: input.blocked, baselineEligible: input.baselineReady && !input.blocked,
      computeMs: performance.now() - started,
    });
  }
  event(kind: 'interaction' | 'feedback' | 'aside' | 'repeat-blocked', details: { id?: string; source?: string; reaction?: string | null } = {}): void {
    this.write({ kind, at: new Date().toISOString(), ...details });
  }
  private write(row: Record<string, unknown>): void {
    if (!this.enabled || this.disabled) return;
    try {
      const file = this.file();
      const line = JSON.stringify({ version: 1, mode: 'shadow', session: this.session, sequence: ++this.sequence, ...row }) + '\n';
      if (existsSync(file) && statSync(file).size + Buffer.byteLength(line) > this.maxBytes) {
        if (existsSync(file + '.1')) unlinkSync(file + '.1');
        renameSync(file, file + '.1');
      }
      appendFileSync(file, line, 'utf8');
    } catch {
      this.disabled = true;
      console.warn('[attention] diagnostics unavailable; shadow logging disabled for this session');
    }
  }
}
