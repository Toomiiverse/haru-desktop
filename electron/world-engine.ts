import { commandWorld, readWorld, moveToNeighborhood, tickWorld, worldActions, worldNote, worldView, type WorldActionId, type WorldState } from './world';

export const WORLD_THINK_GAP = 20 * 60_000;
export const WORLD_THINK_LIMIT = 6;

export type WorldEngineDeps = {
  load(): unknown;
  save(state: WorldState): void;
  now(): number;
  day(): string;
  /** Includes chat, voice, other autonomous work, and the availability of a local model. */
  quiet(): boolean;
  think(state: WorldState, signal: AbortSignal): Promise<WorldActionId | null>;
};

/** The main process is the only writer. Async plans merge into fresh state. */
export class WorldEngine {
  private thinking: AbortController | null = null;
  constructor(private deps: WorldEngineDeps) {}
  initialize() {
    const state = moveToNeighborhood(this.state(), this.deps.now());
    state.updatedAt = this.deps.now(); // no replay of time spent shut down
    this.deps.save(state);
  }
  state() {
    const saved = this.deps.load();
    let state = readWorld(saved, this.deps.now());
    if (saved == null) { state = moveToNeighborhood(state,this.deps.now()); this.deps.save(state); }
    return state;
  }
  view() { return worldView(this.state()); }
  command(raw: unknown) {
    const next = commandWorld(this.state(), raw, this.deps.now());
    this.thinking?.abort();
    this.deps.save(next);
    return worldView(next);
  }
  tick() {
    const before = this.state();
    const next = tickWorld(before, this.deps.now());
    if (next !== before) this.deps.save(next);
    if (this.thinking && (!next.running || !next.brain.enabled || !this.deps.quiet())) this.thinking.abort();
  }
  async plan() {
    if (this.thinking || !this.deps.quiet()) return;
    const s = this.state(), now = this.deps.now(), day = this.deps.day();
    const calls = s.brain.day === day ? s.brain.calls : 0;
    if (!s.running || !s.brain.enabled || s.suggested || calls >= WORLD_THINK_LIMIT
      || (s.brain.lastAt && now - s.brain.lastAt < WORLD_THINK_GAP)) return;
    const controller = new AbortController();
    this.thinking = controller;
    s.brain = { ...s.brain, day, calls: calls + 1, lastAt: now, status: 'Haru is choosing her next activity…' };
    this.deps.save(s); // charge the attempt before a network call, including failures
    const timeout = setTimeout(() => controller.abort(), 20_000);
    try {
      const choice = await this.deps.think(s, controller.signal);
      const latest = this.state();
      if (controller.signal.aborted || !this.deps.quiet() || !latest.running || !latest.brain.enabled
        || latest.startedAt !== s.startedAt || latest.controlVersion !== s.controlVersion || latest.suggested) return;
      if (choice && worldActions(latest).some(a => a.id === choice)) {
        latest.suggested = { id: choice, by: 'local-model' };
        latest.brain.status = `Haru chose: ${worldActions(latest).find(a => a.id === choice)!.label.toLowerCase()}.`;
      } else latest.brain.status = 'No new plan this time. Her routines continue.';
      this.deps.save(latest);
    } catch {
      const latest = this.state();
      if (latest.startedAt === s.startedAt && latest.controlVersion === s.controlVersion) {
        latest.brain.status = controller.signal.aborted ? 'Planning paused. Her routines continue.' : 'The local planner is unavailable. Her routines continue.';
        this.deps.save(latest);
      }
    } finally {
      clearTimeout(timeout);
      const latest = this.state();
      if (latest.startedAt === s.startedAt && latest.brain.status === 'Haru is choosing her next activity…') {
        latest.brain.status = 'Planning paused. Her routines continue.';
        this.deps.save(latest);
      }
      this.thinking = null;
    }
  }
}

export type WorldModelConfig = { provider: string; endpoint: string; model: string };
/** Never follows the app’s hosted-provider routing or falls back to a paid API. */
export function localWorldEndpoint(config: WorldModelConfig | null): string | null {
  if (!config?.model || config.provider !== 'ollama') return null;
  try {
    const u = new URL(config.endpoint);
    if (!['http:', 'https:'].includes(u.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(u.hostname)
      || u.username || u.password || u.search || u.hash || !['', '/'].includes(u.pathname)) return null;
    return `${u.origin}/api/chat`;
  } catch { return null; }
}

export async function chooseWorldAction(config: WorldModelConfig, character: { identity: string; style: string }, state: WorldState,
  fetcher: typeof fetch, signal: AbortSignal, numCtx = 4096): Promise<WorldActionId | null> {
  const endpoint = localWorldEndpoint(config);
  if (!endpoint) return null;
  const actions = worldActions(state);
  const response = await fetcher(endpoint, {
    method: 'POST', redirect: 'error', signal, headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: config.model, stream: false, think: false, keep_alive: -1,
      options: { num_predict: 100, num_ctx: numCtx, temperature: 0.7 },
      format: { type: 'object', properties: { action: { type: 'string', enum: actions.map(a => a.id) } }, required: ['action'], additionalProperties: false },
      messages: [{ role: 'system', content: `${character.identity.slice(0, 2400)}\n${character.style.slice(0, 1800)}\nYou are choosing your next activity in ${state.neighborhood ? 'your virtual Willowbrook neighborhood, with your own home, six neighbors, a park, café, library, studio and market' : 'your virtual cyberpunk apartment'}. Keep your own interests and sharp personality. Pick one available action; return only {"action":"id"}. You cannot change the world directly.` },
        { role: 'user', content: `${worldNote(state)}\nYou are feeling ${state.needs.energy < 30 ? 'physically exhausted' : state.needs.energy > 75 ? 'rested' : 'a little tired'}, ${state.needs.curiosity > 65 ? 'curious and ready for something interesting' : 'content with a quiet routine'}${state.needs.company > 70 ? ', and in need of some company' : ''}.\nRecent activities: ${state.recent.join(', ')}.\nAvailable: ${actions.map(a => `${a.id}: ${a.label}`).join('; ')}` }],
    }),
  });
  if (!response.ok) throw new Error('The local planner did not answer.');
  const body = await response.json() as { message?: { content?: string } };
  try {
    const parsed = JSON.parse(body.message?.content ?? '');
    return actions.some(a => a.id === parsed.action) ? parsed.action as WorldActionId : null;
  } catch { return null; }
}
