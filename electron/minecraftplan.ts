// What her body should do next, decided by the same brain that decides
// everything else about her.
//
// This is the planning layer from the brief, and its one structural rule is the
// one that keeps a language model from being dangerous with a pickaxe: the
// model *chooses*, it never *composes*. It is handed a short list of things her
// body can do and a short description of the world, and it answers with one
// name from the list and its arguments. Anything else it says — a paragraph, a
// plan, an apology, a shell command — is read as "wait", because the only safe
// reading of an answer that is not on the list is that there is no answer.
//
// The model is Kimi, through the same route as her conversation. There is no
// Minecraft personality prompt and there must never be one: she is one Haru,
// and what she wants to build is what *she* wants, told in her own identity
// block like everything else she decides for herself.
//
// Pure. The observation comes in, the instruction goes out, the answer comes
// back and is parsed; the model call and the worker are both somebody else's.

import type { MinecraftObservation } from './minecraft';

/**
 * What her body can be told to do, in the words the worker understands.
 *
 * A copy of the worker's own table, and deliberately so: the worker validates
 * every name at its door regardless, so a drift here costs a clear error
 * rather than a silent one. What this list is for is the tool description —
 * the model cannot pick from a list it has not been shown — and refusing a
 * bad name before a round trip.
 */
export const SKILLS = {
  // Movement and the body.
  followPlayer: 'walk with a player and keep up with them (name, range?)',
  stopMoving: 'stop walking or following',
  moveTo: 'walk to coordinates (x, y, z, range?)',
  lookAt: 'turn to face a player or a point (name | x, y, z)',
  eat: 'eat something from her inventory when hungry',
  sleep: 'sleep in a nearby bed, at night',
  wake: 'get up',
  // Resources.
  collectBlock: 'mine or gather a kind of block nearby (type, amount) — refuses protected places',
  craftItem: 'craft something she has the ingredients for (item, amount?)',
  openContainer: 'look inside a chest (x, y, z? — nearest if omitted)',
  depositItems: 'put things into a chest (items {name: count} | item, count)',
  withdrawItems: 'take named things out of a chest (items | item, count) — never everything',
  equipItem: 'hold or wear something (item, destination?)',
  placeBlock: 'put one block down (x, y, z, block) — refuses protected places',
  // What she knows and what she is doing.
  rememberPlace: 'note where she is as a place (kind: home|chest|farm|landmark|structure|mine|portal, name, note?)',
  forgetPlace: 'forget a place by name',
  listPlaces: 'the places she knows, nearest first',
  returnHome: 'walk back to home',
  startProject: 'begin a project with goals (name, goals: [{what, item?, need?}])',
  updateProject: 'change a project (status | note | goal)',
  completeGoal: 'tick off a goal — a counted goal must have its number',
  checkpoint: 'note where she is up to on the current project (note)',
  listProjects: 'what she is working on and what is waiting',
  // Getting about on her own, building, and not dying.
  exploreArea: 'walk somewhere new and look around (radius 16-128, direction?) — remembers chests, villages, portals, diamonds she passes',
  buildBlueprint: 'build a blueprint she knows, at where she stands or an origin (id, x?, y?, z?) — needs the materials, refuses protected places, resumes if interrupted',
  defineBlueprint: 'design a small building as a list of blocks (id, name, blocks: [{dx, dy, dz, block}], up to 256)',
  listBlueprints: 'the buildings she knows how to make and what each needs',
  attackEntity: 'fight one hostile mob within reach (type?) — never a player',
  fleeThreat: 'run from the nearest hostile',
  // The session.
  stop: 'leave the server',
} as const;

export type SkillName = keyof typeof SKILLS;

/** Every skill, in the order shown to the model. */
export const SKILL_NAMES = Object.keys(SKILLS) as SkillName[];

/**
 * What the planner may choose on its own.
 *
 * Two are held back. Leaving the server is the scheduler's decision, not a
 * thing she decides in the middle of a session because a prompt got confusing.
 * Forgetting a place is destructive with no undo and no reason to ever do it
 * unasked. Both remain available when she is *told* to.
 */
export const AUTONOMOUS_SKILLS = SKILL_NAMES.filter(name => name !== 'stop' && name !== 'forgetPlace');

export function isSkillName(value: unknown): value is SkillName {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(SKILLS, value);
}

// -- the observation, in words --------------------------------------------------

/** How far she is from full, in words a model reads correctly. */
function vitals(self: NonNullable<MinecraftObservation['self']>): string {
  const parts: string[] = [];
  if (self.health <= 6) parts.push(`badly hurt (${self.health}/20)`);
  else if (self.health < 14) parts.push(`hurt (${self.health}/20)`);
  if (self.food <= 6) parts.push(`very hungry (${self.food}/20)`);
  else if (self.food < 14) parts.push(`getting hungry (${self.food}/20)`);
  if (self.asleep) parts.push('asleep');
  return parts.join(', ');
}

/**
 * The world as a handful of lines.
 *
 * Never the raw observation. What a decision needs is where she is, how she is,
 * who is about, what she is carrying and what she was doing — and each of those
 * is a phrase, not a structure. A model handed JSON reasons about the JSON; a
 * model handed a paragraph reasons about the world.
 */
export function describeWorld(seen: MinecraftObservation, ownerName: string): string {
  if (seen.state !== 'online' || !seen.self) {
    return seen.currentProject
      ? `She is not in the world right now (${seen.state}). Her project is waiting: ${seen.currentProject}.`
      : `She is not in the world right now (${seen.state}).`;
  }
  const lines: string[] = [];
  const where = seen.where ? seen.where : `at ${seen.self.position.x}, ${seen.self.position.y}, ${seen.self.position.z}`;
  lines.push(`She is ${where} in the ${seen.self.dimension.replace(/_/g, ' ')}, ${seen.self.time}${seen.self.raining ? ', raining' : ''}.`);
  const how = vitals(seen.self);
  if (how) lines.push(`She is ${how}.`);
  if (seen.intent.kind !== 'idle') lines.push(`Right now she is ${describeIntent(seen.intent)}.`);
  const players = seen.nearby.players;
  if (players.length) {
    const him = players.find(name => name.toLowerCase() === ownerName.toLowerCase());
    const others = players.filter(name => name !== him);
    if (him) lines.push(`${him} is here${others.length ? `, and so ${others.length === 1 ? 'is' : 'are'} ${others.join(', ')}` : ''}.`);
    else lines.push(`${others.join(', ')} ${others.length === 1 ? 'is' : 'are'} nearby.`);
  }
  const carrying = Object.entries(seen.inventory).slice(0, 8).map(([name, count]) => `${count} ${name.replace(/_/g, ' ')}`);
  lines.push(carrying.length ? `Carrying ${carrying.join(', ')}${seen.freeSlots <= 3 ? ` (only ${seen.freeSlots} free slots)` : ''}.` : 'Carrying nothing.');
  if (seen.knownNearby.length) lines.push(`Known places near her: ${seen.knownNearby.join('; ')}.`);
  lines.push(seen.currentProject ? `Working on: ${seen.currentProject}.` : 'She has no project on the go.');
  return lines.join('\n');
}

function describeIntent(intent: MinecraftObservation['intent']): string {
  switch (intent.kind) {
    case 'following': return `following ${String(intent.player ?? 'someone')}`;
    case 'travelling': {
      const to = intent.to as { x: number; y: number; z: number } | undefined;
      return to ? `walking to ${to.x}, ${to.y}, ${to.z}` : 'walking somewhere';
    }
    case 'sleeping': return 'asleep';
    default: return 'standing about';
  }
}

// -- the instruction ----------------------------------------------------------

/** The one-line "in Minecraft" note for her own-life block. Empty when there is nothing to say. */
export function minecraftNote(seen: MinecraftObservation | null, workerUp: boolean): string {
  if (!seen) return '';
  if (seen.state === 'online' && seen.self) {
    const bits = [seen.where ?? `at ${seen.self.position.x}, ${seen.self.position.y}, ${seen.self.position.z}`];
    const how = vitals(seen.self);
    if (how) bits.push(how);
    if (seen.intent.kind !== 'idle') bits.push(describeIntent(seen.intent));
    if (seen.nearby.players.length) bits.push(`${seen.nearby.players.join(', ')} ${seen.nearby.players.length === 1 ? 'is' : 'are'} there`);
    const project = seen.currentProject ? ` Working on: ${seen.currentProject}.` : '';
    return `- In Minecraft right now: ${bits.join(', ')}.${project}`;
  }
  // Off the server but mid-project: she should still know it is waiting, or she
  // answers "what are you building" from nothing.
  if (seen.currentProject) return `- Your Minecraft project is waiting for you: ${seen.currentProject}.`;
  if (!workerUp) return '';
  return '';
}

export type PlanOptions = {
  /** Her identity block — the same one every other decision of hers uses. */
  identity: string;
  ownerName: string;
  /** What she was last told to do, so she does not undo it. */
  lastDecision?: string;
  /** What just went wrong, so she does not try it again immediately. */
  lastFailure?: string;
};

/**
 * The instruction for one planning step.
 *
 * Three parts: who she is, what the world looks like, and the exact shape of
 * an answer. The list of skills is the whole of what she may do, and the answer
 * format is stated twice — once as a rule, once as an example — because a model
 * that answers with a paragraph is not wrong, it is simply "wait".
 */
export function planInstruction(seen: MinecraftObservation, options: PlanOptions): string {
  const skills = AUTONOMOUS_SKILLS.map(name => `- ${name}: ${SKILLS[name]}`).join('\n');
  return [
    options.identity,
    'You are playing Minecraft on your own server, in your own time. This is your body there:',
    describeWorld(seen, options.ownerName),
    options.lastDecision ? `You last decided: ${options.lastDecision}.` : '',
    options.lastFailure ? `That did not work: ${options.lastFailure}. Do something different.` : '',
    'Decide the next single thing your body should do. Think about your project first — carry it on if you have one, and start one if you do not and want something to work toward. Eat when hungry, sleep when it is night and there is a bed. If your person is here, being with them beats any project.',
    'You can only do these, by name:',
    skills,
    'Answer with JSON and nothing else. One of these two shapes:',
    '{"skill": "<name from the list>", "args": {<its arguments>}, "why": "<a few words, in your own voice>"}',
    '{"wait": true, "why": "<a few words>"}',
    'No prose before or after the JSON. If nothing on the list fits, wait.',
  ].filter(Boolean).join('\n\n');
}

// -- the answer ---------------------------------------------------------------

export type Plan =
  | { kind: 'do'; skill: SkillName; args: Record<string, unknown>; why: string }
  | { kind: 'wait'; why: string };

/**
 * The model's answer, read strictly.
 *
 * Everything that is not a well-formed choice from the list is a wait, and the
 * reason says so. This is the single safety property the planner has: the
 * model cannot make her body do anything by describing it, only by naming it.
 */
export function readPlan(text: string, allowed: readonly SkillName[] = AUTONOMOUS_SKILLS): Plan {
  const body = extractJson(text ?? '');
  if (!body) return { kind: 'wait', why: 'no decision (the answer was not JSON)' };
  let parsed: unknown;
  try { parsed = JSON.parse(body); } catch { return { kind: 'wait', why: 'no decision (the JSON would not parse)' }; }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { kind: 'wait', why: 'no decision (not an object)' };
  const record = parsed as Record<string, unknown>;
  const why = typeof record.why === 'string' ? record.why.trim().slice(0, 200) : '';

  if (record.wait === true) return { kind: 'wait', why: why || 'nothing to do' };

  const skill = record.skill;
  if (!isSkillName(skill)) return { kind: 'wait', why: `no decision ("${String(skill).slice(0, 40)}" is not something her body can do)` };
  if (!allowed.includes(skill)) return { kind: 'wait', why: `no decision (${skill} is not hers to decide on her own)` };

  const args = record.args && typeof record.args === 'object' && !Array.isArray(record.args)
    ? sanitiseArgs(record.args as Record<string, unknown>)
    : {};
  return { kind: 'do', skill, args, why };
}

/**
 * The first JSON object in a reply, however it is wrapped.
 *
 * Models fence JSON in ```json, prefix it with "Sure!", or both. Taking the
 * outermost braces is the honest reading of all three; anything with no braces
 * at all is prose, which is a wait.
 */
function extractJson(text: string): string | null {
  const unfenced = text.replace(/```(?:json)?/gi, '');
  const start = unfenced.indexOf('{');
  const end = unfenced.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  return unfenced.slice(start, end + 1);
}

/** Arguments the worker will not choke on: flat-ish, bounded, no functions or prototypes. */
function sanitiseArgs(args: Record<string, unknown>, depth = 0): Record<string, unknown> {
  const clean: Record<string, unknown> = {};
  let count = 0;
  for (const [key, value] of Object.entries(args)) {
    if (++count > 24) break;
    if (!/^[a-zA-Z_][a-zA-Z0-9_]{0,31}$/.test(key)) continue;
    if (typeof value === 'string') clean[key] = value.slice(0, 200);
    else if (typeof value === 'number' && Number.isFinite(value)) clean[key] = value;
    else if (typeof value === 'boolean') clean[key] = value;
    else if (Array.isArray(value) && depth < 2) clean[key] = value.slice(0, 24).map(item => typeof item === 'object' && item ? sanitiseArgs(item as Record<string, unknown>, depth + 1) : typeof item === 'string' ? item.slice(0, 200) : item);
    else if (value && typeof value === 'object' && depth < 2) clean[key] = sanitiseArgs(value as Record<string, unknown>, depth + 1);
  }
  return clean;
}

/** A plan as one log line. */
export function describePlan(plan: Plan): string {
  if (plan.kind === 'wait') return `wait — ${plan.why}`;
  const args = Object.keys(plan.args).length ? ` ${JSON.stringify(plan.args)}` : '';
  return `${plan.skill}${args}${plan.why ? ` — ${plan.why}` : ''}`;
}
