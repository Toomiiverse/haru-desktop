// Her Game Boy: Pokémon Red, played by her (2026-09-18).
//
// The body is a separate process (~/haru-pokemon: Nous Research's
// pokemon-agent, MIT — a headless emulator that reads the game's RAM into JSON
// and takes button presses over HTTP). This is her side of it: the link, the
// words the game state is put into for her brain, the one move she answers
// with, and the rules of a sitting. Her brain stays the only brain; the worker
// is hands with a radio, as the Minecraft one is.
//
// A sitting is hers: it runs in her own time, one move per tick from the
// local brain, ends when he speaks, when the time is up, or when she has
// played her share of the day — and leaves a line in her game memory so that
// "how is your run going" has a true answer.

export type PokemonConfig = {
  enabled: boolean;
  url: string;
  /** The longest one sitting runs. */
  sessionMinutes: number;
  /** One move this often. */
  tickSeconds: number;
  /** Her share of a day. */
  minutesPerDay: number;
  /** A save state every this many moves. */
  saveEvery: number;
};

export const DEFAULT_POKEMON: PokemonConfig = { enabled: true, url: 'http://127.0.0.1:8792', sessionMinutes: 30, tickSeconds: 15, minutesPerDay: 90, saveEvery: 10 };

/** The `games.pokemon` block, read forward. */
export function readPokemonConfig(games: unknown): PokemonConfig {
  const raw = ((games && typeof games === 'object' ? (games as Record<string, unknown>).pokemon : undefined) ?? {}) as Record<string, unknown>;
  const number = (value: unknown, fallback: number, min: number, max: number) =>
    typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : fallback;
  return {
    enabled: raw.enabled !== false,
    url: typeof raw.url === 'string' && raw.url.trim() ? raw.url.trim().replace(/\/+$/, '') : DEFAULT_POKEMON.url,
    sessionMinutes: number(raw.sessionMinutes, DEFAULT_POKEMON.sessionMinutes, 5, 180),
    tickSeconds: number(raw.tickSeconds, DEFAULT_POKEMON.tickSeconds, 5, 300),
    minutesPerDay: number(raw.minutesPerDay, DEFAULT_POKEMON.minutesPerDay, 5, 24 * 60),
    saveEvery: number(raw.saveEvery, DEFAULT_POKEMON.saveEvery, 1, 200),
  };
}

// -- what the worker says ------------------------------------------------------

export type PartyMon = { nickname?: string; species?: string; level?: number; hp?: number; max_hp?: number; status?: string | null; moves?: string[] };
/** The worker's state as it really comes (checked against a running game 2026-09-18, not its README). */
export type GameState = {
  player?: { name?: string; money?: number; badges?: string[]; badge_count?: number; facing?: string; position?: { x?: number; y?: number }; play_time?: string };
  map?: { map_id?: number; map_name?: string };
  party?: PartyMon[];
  bag?: { item?: string; quantity?: number }[];
  battle?: { in_battle?: boolean; type?: string; enemy?: { species?: string; level?: number; hp?: number; max_hp?: number } } | null;
  /** A flag only — and one that stays false through Oak's intro. The words come from text(). */
  dialog?: { active?: boolean } | null;
};

export type Fetcher = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

export class PokemonLink {
  constructor(private readonly config: PokemonConfig, private readonly fetch: Fetcher) {}

  private async call(path: string, body?: unknown): Promise<string> {
    const response = await this.fetch(`${this.config.url}${path}`, body === undefined ? undefined : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const text = await response.text();
    if (!response.ok) throw new Error(`the Game Boy answered ${response.status}${text ? `: ${text.slice(0, 160)}` : ''}`);
    return text;
  }

  /** Whether the worker is up with a game loaded. False, never a throw: no ROM yet is a switched-off feature. */
  async up(): Promise<boolean> {
    try { return (JSON.parse(await this.call('/health')) as { emulator_ready?: boolean }).emulator_ready === true; } catch { return false; }
  }

  async state(): Promise<GameState> {
    return JSON.parse(await this.call('/state')) as GameState;
  }

  /** The walkability grid around her, from the game's own collision data. */
  async map(): Promise<string> {
    try { return await this.call('/map/ascii'); } catch { return ''; }
  }

  /** The words on the screen right now — dialog, menus with their cursor ('>'), battle text (serve.py /screen/text). */
  async text(): Promise<string[]> {
    try {
      const lines = (JSON.parse(await this.call('/screen/text')) as { lines?: unknown }).lines;
      return Array.isArray(lines) ? lines.filter((line): line is string => typeof line === 'string') : [];
    } catch {
      return [];
    }
  }

  async act(actions: string[]): Promise<GameState | null> {
    const result = JSON.parse(await this.call('/action', { actions })) as { state_after?: GameState };
    return result.state_after ?? null;
  }

  async save(name: string): Promise<void> {
    await this.call('/save', { name });
  }
}

// -- the move -------------------------------------------------------------------

const BUTTONS = ['a', 'b', 'start', 'select', 'up', 'down', 'left', 'right'];
const DIRECTIONS = ['up', 'down', 'left', 'right'];

/** The worker's action grammar, and nothing else: a model's invention is dropped rather than sent. */
export function validAction(action: string): boolean {
  const text = action.trim().toLowerCase();
  if (text === 'a_until_dialog_end') return true;
  const press = /^press_([a-z]+)$/.exec(text);
  if (press) return BUTTONS.includes(press[1]);
  const walk = /^walk_([a-z]+)$/.exec(text);
  if (walk) return DIRECTIONS.includes(walk[1]);
  const hold = /^hold_([a-z]+)_(\d{1,3})$/.exec(text);
  if (hold) return BUTTONS.includes(hold[1]) && Number(hold[2]) >= 1 && Number(hold[2]) <= 240;
  const wait = /^wait_(\d{1,3})$/.exec(text);
  return wait ? Number(wait[1]) >= 1 && Number(wait[1]) <= 300 : false;
}

export const MOVES_PER_TURN = 8;

export type Move = { thought: string; actions: string[] };

/** Her answer, read leniently: the JSON object wherever it sits in the text. */
export function parseMove(raw: string): Move | null {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(raw.slice(start, end + 1)) as { thought?: unknown; actions?: unknown };
    const actions = (Array.isArray(parsed.actions) ? parsed.actions : []).filter((item): item is string => typeof item === 'string').map(item => item.trim().toLowerCase()).filter(validAction).slice(0, MOVES_PER_TURN);
    if (!actions.length) return null;
    return { thought: typeof parsed.thought === 'string' ? parsed.thought.trim().slice(0, 240) : '', actions };
  } catch {
    return null;
  }
}

/** The rules of play, after her persona. */
export const PLAY_RULES = [
  'This is your own time and your own game: Pokémon Red, on the Game Boy on your desk. Nobody is watching and nobody is being addressed.',
  'You are shown the game as it is right now — where you are, your party, the words on the screen (a menu's cursor is ">"), the battle if there is one, and a map of the screen (@ is you, . is walkable, # is blocked, up is north).',
  'Answer with one JSON object and nothing else: {"thought": "a short line in your own voice about what you are doing or what just happened", "actions": ["..."]}.',
  `Actions, at most ${MOVES_PER_TURN} a turn: walk_up, walk_down, walk_left, walk_right (one tile each); press_a, press_b, press_start, press_select, press_up, press_down, press_left, press_right (menus and battles); a_until_dialog_end (read through a text box); wait_60 (a second). Nothing else exists.`,
  'When there are words on the screen, read them and press_a to go on (press_b backs out of a menu; in a menu, press_up and press_down move the cursor). While words are up you cannot walk. In a battle, pick from the menu. If you walked into a wall last turn, go another way — the map does not lie.',
  'Play it the way you would: your own names, your own favourites, your own grudges against that one Rattata.',
].join(' ');

/** The game, in words, for one turn. */
export function describeGame(state: GameState, map: string, screen: string[], lastThought: string, stuck: boolean): string {
  const lines: string[] = [];
  const player = state.player ?? {};
  const position = player.position ?? {};
  lines.push(`Where: ${whereIs(state)} at (${position.x ?? '?'}, ${position.y ?? '?'}), facing ${player.facing ?? '?'}. Badges: ${badgeCount(state)}${player.badges?.length ? ` (${player.badges.join(', ')})` : ''}. Money: ${player.money ?? 0}.`);
  const party = state.party ?? [];
  lines.push(party.length
    ? `Party: ${party.map(mon => `${mon.nickname || mon.species || '?'} (${mon.species ?? '?'}) L${mon.level ?? '?'} ${mon.hp ?? '?'}/${mon.max_hp ?? '?'} HP${mon.status ? ` [${mon.status}]` : ''}${mon.moves?.length ? ` — ${mon.moves.join(', ')}` : ''}`).join('; ')}.`
    : 'Party: nobody yet.');
  const bag = (state.bag ?? []).filter(item => item.item).slice(0, 10);
  if (bag.length) lines.push(`Bag: ${bag.map(item => `${item.item} x${item.quantity ?? 1}`).join(', ')}.`);
  if (state.battle?.in_battle) {
    const enemy = state.battle.enemy ?? {};
    lines.push(`IN A BATTLE (${state.battle.type ?? '?'}): against ${enemy.species ?? 'something'} L${enemy.level ?? '?'}${enemy.hp !== undefined ? ` ${enemy.hp}/${enemy.max_hp ?? '?'} HP` : ''}.`);
  }
  if (screen.length) lines.push(`Words on the screen:\n${screen.map(line => `  ${line}`).join('\n')}`);
  else if (state.dialog?.active) lines.push('Something is being said (press_a to go on).');
  // With words up she cannot walk, and the grid is only noise.
  if (map.trim() && !screen.length) lines.push(`The screen:\n${map.trim()}`);
  if (lastThought) lines.push(`Last turn you thought: "${lastThought}"`);
  if (stuck) lines.push('You have not moved for a few turns. Whatever you were doing is not working: try something else.');
  return lines.join('\n');
}

// -- a sitting ---------------------------------------------------------------------

export type Sitting = { startedAt: number; turns: number; lastThought: string; from: string; stillFor: number; lastSpot: string; moves: number; startedBy: 'her' | 'him' };

export function newSitting(now: number, state: GameState, startedBy: 'her' | 'him'): Sitting {
  return { startedAt: now, turns: 0, lastThought: '', from: whereIs(state), stillFor: 0, lastSpot: spot(state), moves: 0, startedBy };
}

const whereIs = (state: GameState) => state.map?.map_name ?? `map ${state.map?.map_id ?? '?'}`;
const badgeCount = (state: GameState) => state.player?.badge_count ?? state.player?.badges?.length ?? 0;
const spot = (state: GameState, screen: string[] = []) => `${state.map?.map_id}:${state.player?.position?.x},${state.player?.position?.y}:${screen.join('|')}:${state.battle?.in_battle ? 'b' : ''}`;

export function afterTurn(sitting: Sitting, move: Move | null, state: GameState, screen: string[] = []): Sitting {
  // The words count: a text box that moved on is not standing still.
  const here = spot(state, screen);
  return { ...sitting, turns: sitting.turns + 1, moves: sitting.moves + (move?.actions.length ?? 0), lastThought: move?.thought || sitting.lastThought, stillFor: here === sitting.lastSpot ? sitting.stillFor + 1 : 0, lastSpot: here };
}

export type Moment = { now: number; lastUserActivityAt: number; asleep: boolean; speaking: boolean; workerUp: boolean; playedTodayMs: number };

/** Why a sitting ends — or null, while it goes on. */
export function whyStop(sitting: Sitting, moment: Moment, config: PokemonConfig): string | null {
  if (!moment.workerUp) return 'the Game Boy went quiet';
  if (moment.lastUserActivityAt > sitting.startedAt + 5_000) return 'he is talking to her';
  if (moment.asleep) return 'bedtime';
  if (moment.now - sitting.startedAt >= config.sessionMinutes * 60_000) return `${config.sessionMinutes} minutes is a sitting`;
  if (moment.playedTodayMs + (moment.now - sitting.startedAt) >= config.minutesPerDay * 60_000) return 'that is her share of the day';
  return null;
}

/** Why she may not start one — or null. */
export function whyNotStart(moment: Moment, config: PokemonConfig, sitting: Sitting | null): string | null {
  if (!config.enabled) return 'Pokémon is switched off';
  if (sitting) return 'she is already playing';
  if (!moment.workerUp) return 'the Game Boy is not running (no ROM yet, or the worker is down)';
  if (moment.asleep) return 'she is asleep';
  if (moment.playedTodayMs >= config.minutesPerDay * 60_000) return 'she has played her share of the day';
  return null;
}

/** The line her game memory keeps about a sitting. */
export function sittingSummary(sitting: Sitting, state: GameState, now: number, why: string): string {
  const minutes = Math.max(1, Math.round((now - sitting.startedAt) / 60_000));
  const party = (state.party ?? []).map(mon => `${mon.nickname || mon.species} L${mon.level}`).join(', ') || 'no party yet';
  const to = whereIs(state);
  return `Played for ${minutes} min (${sitting.turns} turns): ${sitting.from === to ? `around ${to}` : `${sitting.from} → ${to}`}; ${badgeCount(state)} badge(s); party ${party}. Stopped because ${why}.${sitting.lastThought ? ` Last thought: "${sitting.lastThought}"` : ''}`;
}

/** One line for her own-life block: where her run stands. */
export function runNote(state: GameState | null, lastSummary: string, playing: boolean): string {
  if (!state) return '';
  const party = (state.party ?? []).map(mon => `${mon.nickname || mon.species} L${mon.level}`).join(', ');
  return `Your Pokémon Red run (yours, on your own Game Boy — these are facts, read off the game): ${badgeCount(state)} badge(s), ${party ? `party ${party}` : 'no Pokémon yet'}, last seen in ${whereIs(state)}.${playing ? ' You are in the middle of a sitting right now.' : ''}${lastSummary ? ` Last sitting: ${lastSummary}` : ''}`;
}
