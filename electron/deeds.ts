// What she actually did.
//
// She has no record of her own conduct. Her memory holds his life in detail —
// twenty-one dated records of what he bought, built and worked on — and almost
// nothing about what *she* did, so a claim about her own behaviour has nothing
// behind it to check. Asked on 2026-09-08 why she had turned her notifications
// off, which she never did, she agreed both times and supplied a reason: once
// blaming his notifications, once an invented spam filter. Told she had said
// she hated Chainsaw Man she corrected the verb and then invented the sentence
// she had supposedly said instead.
//
// A prompt line does not fix that, and I measured it rather than assuming: a
// rule telling her not to take his word for her own conduct moved rejection of
// a false premise from 3 in 20 to 3 in 20. Exactly nothing. Rejecting a claim
// about what she did requires *knowing* what she did, and no wording supplies
// that. She was being asked to argue from absence.
//
// So this is the absence, filled. Every tool call that changes something is
// kept as a line in her own voice, and the recent ones go in front of her. "I
// didn't" becomes a lookup instead of an argument.
//
// Only things she *did*. Looking something up is not a deed and never needs
// defending — a ledger that also recorded every search would bury the one line
// that matters under forty that do not.

export type Deed = {
  at: string;
  /** The tool, for grouping and for the log. */
  tool: string;
  /** What she did, phrased as she would say it. */
  what: string;
};

/** A season of them. Enough that "last week" is answerable, bounded so the file cannot run. */
export const DEEDS_KEPT = 120;

/** How far back the ones in front of her reach. Older than this and he is asking about history, not this week. */
export const DEEDS_SHOWN_DAYS = 7;

/** How many reach the prompt. The block is a check, not a diary. */
export const DEEDS_SHOWN = 12;

const text = (value: unknown, fallback = ''): string => (typeof value === 'string' && value.trim() ? value.trim() : fallback);

/**
 * The tools that count, and how each one reads back.
 *
 * Anything absent from this table is looking rather than doing: the getters,
 * the searches, the reads, `describe_myself`. A deed is something he could
 * later be wrong about, which is the whole point of writing it down.
 */
const DEEDS: Record<string, (args: Record<string, unknown>) => string> = {
  change_setting: a => `changed your setting "${text(a.name, 'something')}" to ${text(a.value, String(a.value ?? '?'))}`,
  remember_about_user: a => `wrote down that ${text(a.fact, 'something about them')}`,
  core_memory_append: a => `added to your ${text(a.label, 'memory')} block`,
  core_memory_replace: a => `rewrote part of your ${text(a.label, 'memory')} block`,
  core_memory_rethink: a => `rewrote your ${text(a.label, 'memory')} block`,
  note_check_in: a => `noted down "${text(a.note, 'a check-in')}"`,
  save_journal_entry: () => 'wrote their journal entry for the day',
  adopt_interest: a => `took up ${text(a.name, 'something new')}`,
  complete_kept_item: a => `ticked off "${text(a.title, 'one of their items')}"`,
  delete_kept_item: a => `deleted "${text(a.title, 'one of their items')}" from their list`,
  update_kept_item: a => `changed "${text(a.title, 'one of their items')}" on their list`,
  vault_write: a => `${text(a.mode, 'wrote to')} the note "${text(a.path, 'one of their notes')}"`,
  go_back_to_sleep: a => (a.block === true ? 'went back to sleep and told them not to wake you again tonight' : 'went back to sleep'),
  restart_haru: () => 'restarted yourself',
  restart_docker_container: a => `restarted the ${text(a.name, 'container')} container`,
  start_service: a => `started the ${text(a.name, 'service')} service`,
  stop_service: a => `stopped the ${text(a.name, 'service')} service`,
  power: a => `told the machine to ${text(a.action, 'do something')}`,
  open_app: a => `opened ${text(a.name, 'an app')} for them`,
  close_app: a => `closed ${text(a.name, 'an app')}`,
  show_wardrobe: () => 'opened your wardrobe on their screen',
  browser_control: a => `used the browser to ${text(a.action, 'do something')}`,
  // Listing is looking; opening and stopping are the deeds.
  claude_session: a => (a.action === 'open' ? `opened a Claude Code session for them${text(a.folder) ? ` in ${text(a.folder)}` : ''}`
    : a.action === 'stop' ? 'stopped a Claude Code session' : ''),
  // Asking how they are going is looking; pausing and resuming are the deeds.
  downloads: a => (a.action === 'pause' || a.action === 'resume' ? `${a.action === 'pause' ? 'paused' : 'resumed'} the downloads${text(a.title) ? ` for ${text(a.title)}` : ''}` : ''),
  // Proposing and running both reach for it; the ledger has which.
  run_command: a => `used the terminal on the server${text(a.command) ? `: ${text(a.command).slice(0, 60)}` : ''}`,
  // Asking how it is going is looking; fetching it is the deed.
  get_manga: a => (a.action === 'status' ? '' : `saw to "${text(a.title, 'a manga')}" for them — put it on their shelf and started fetching it`),
  play_pokemon: a => (a.action === 'start' ? 'sat down to play your Pokémon Red' : a.action === 'stop' ? 'put the Game Boy down' : ''),
  read_manga: a => `sat down to read your manga${text(a.title) ? ` — ${text(a.title)}` : ''}`,
  convert_picture: a => `converted a picture to ${text(a.format, 'another format')}`,
};

export function isADeed(tool: string): boolean {
  return Object.hasOwn(DEEDS, tool);
}

/**
 * A deed from a call, or nothing.
 *
 * `failed` matters more than it looks: a tool that errored is a thing she tried
 * and did not do, and writing it down as done would make the ledger lie in the
 * one direction it must not. Half these tools also refuse until he confirms,
 * so the first call of a pair changes nothing at all.
 */
export function deedFrom(tool: string, args: Record<string, unknown>, failed: boolean, atIso: string): Deed | null {
  if (failed || !isADeed(tool)) return null;
  const what = DEEDS[tool](args ?? {});
  if (!what) return null;
  return { at: atIso, tool, what };
}

export function readDeeds(saved: unknown): Deed[] {
  if (!Array.isArray(saved)) return [];
  return saved
    .filter((entry): entry is Deed => Boolean(entry) && typeof entry === 'object'
      && typeof (entry as Deed).what === 'string' && (entry as Deed).what.trim().length > 0
      && typeof (entry as Deed).at === 'string' && typeof (entry as Deed).tool === 'string')
    .slice(-DEEDS_KEPT);
}

export function keepDeed(deeds: Deed[], deed: Deed): Deed[] {
  return [...deeds, deed].slice(-DEEDS_KEPT);
}

export function recentDeeds(deeds: Deed[], nowMs: number, days = DEEDS_SHOWN_DAYS, limit = DEEDS_SHOWN): Deed[] {
  const floor = nowMs - days * 86_400_000;
  return deeds
    .filter(deed => { const at = Date.parse(deed.at); return Number.isFinite(at) && at >= floor; })
    .slice(-limit);
}

/**
 * Whether his message is a claim about something she did.
 *
 * The ledger is only worth its room when he is asserting her conduct, which is
 * rare — carried on every turn it is a dozen lines of trivia in front of a
 * model that already has plenty. Second person, past tense, about her: "why did
 * you turn", "you said", "you never". Generous rather than clever, because
 * missing one costs the whole feature and firing spuriously costs a few lines.
 */
const A_CLAIM = /\b(?:why (?:did|would|do|are) you|when did you|how come you|did ?n[o']t you|didn't you|you (?:said|told me|turned|deleted|changed|removed|stopped|started|forgot|ignored|blocked|muted|switched|shut|cancelled|canceled|promised|decided|kept)\b|you never\b|you always\b|you keep\b)/i;

export function claimsAboutHer(message: string): boolean {
  return A_CLAIM.test(message ?? '');
}

/**
 * The block she checks herself against.
 *
 * The last line is the one doing the work. Without it the list is trivia she
 * scrolls past; with it, it is the answer to a question he is about to ask
 * wrongly. It says what the list is *for*, and it says what silence means —
 * because the failure being fixed is her filling a silence with a reason.
 */
export function deedsInstruction(deeds: Deed[], nowMs: number, dayOf: (iso: string) => string): string {
  const recent = recentDeeds(deeds, nowMs);
  if (!recent.length) {
    return 'You have not done anything to their things or your own settings lately. If they say you did, they are mistaken — say so, and do not invent a reason for it.';
  }
  const lines = recent.map(deed => `- ${dayOf(deed.at)}: you ${deed.what}`);
  return [
    'Everything you have actually done lately, which is all of it:',
    lines.join('\n'),
    'That list is complete. When they tell you that you did something and it is not on it, you did not do it — say so plainly, and never supply a reason for a thing you did not do.',
  ].join('\n');
}
