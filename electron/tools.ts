// Haru's tools: what she is offered, and what happens when she reaches for one.
//
// Two halves that have to agree with each other, which is why they now live in
// one file. chatTools decides which tools appear on the table for this turn;
// runChatTool is what actually runs when one is called. A tool offered with no
// handler answers "Unknown tool"; a handler for a tool never offered is dead
// code nobody notices. Neither could be checked while the two sat 1,400 lines
// apart in main.ts, and there is a test for exactly that agreement now.
//
// The dispatcher takes its world through ToolDeps rather than reaching for it.
// Everything in there is state that belongs to the running app — the store, the
// agenda, the flags the turn moves underneath it — and it is destructured under
// the names the body already used, so this is a move rather than a rewrite.
//
// The permission checks are deliberately repeated here even though chatTools
// already gates the same things. A model can name a tool it was never offered,
// and this is the half that actually runs.

import path from 'node:path';
import type { ChatTool, ToolCall } from './provider';
import { addCheckIn, checkInsOn, type CheckInStore } from './checkins';
import { CHOICES_TOOL, readChoices } from './choices';
import { readJournalConfig, SCALE_MAX, type JournalEntry } from './journal';
import { formatMedia, formatMissing, lookUp, readAniListConfig, type MediaKind } from './anilist';
import { convertImage, FORMATS, normaliseFormat } from './convert';
import { cancelPower, closeApp, findApps, isCancellable, launch, listRunning, matchApp, matchRunning, normalisePower, POWER_DELAY_S, readDesktopConfig, runPower } from './desktop';
import { formatPage, formatResults, readSearchConfig, readWebPage, SearchBlocked, searchWeb, type SearchConfig, type SearchResult } from './search';
import { findSuperseded, semanticSimilarities, supersede, MEMORY_KINDS, type MemoryKind, type MemoryRecord } from './memory';
import { appendToBlockValue, canEditBlock, findBlock, replaceInBlockValue, resolveBlockValue, withEditedValue, type BlockSources, type MemoryBlock } from './blocks';
import { findItem, readsAsNotDone } from './agenda';
import { localDateKey, resolveDate, zonedNow } from './dates';
import { collectAll, collectDocker, collectGpu, collectProcesses, collectServices, collectSystem, diagnose, KNOWN_SERVICES, USER_SERVICES } from './system';
import { retrieveContext } from './retrieveContext';
import { KNOWLEDGE_CATEGORIES, type KnowledgeCategory, type KnowledgeStore } from './knowledge';

/**
 * The shape every module that fetches asks for. Each declares its own private
 * version of this and Electron's net satisfies all of them; this is the union,
 * so one injected fetch can be handed to any of them.
 */
type Fetcher = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<Response>;

function toolArguments(call: ToolCall): Record<string, unknown> {
  const args = call.function?.arguments;
  // Ollama hands back a parsed object, but older builds send a JSON string.
  if (typeof args === 'string') { try { return JSON.parse(args) as Record<string, unknown>; } catch { return {}; } }
  return args && typeof args === 'object' ? args as Record<string, unknown> : {};
}

/**
 * Whether the user was telling *her* to be different, rather than describing the
 * world at them.
 *
 * This is a code check because three attempts at wording it failed. A preference
 * is the most expensive kind of memory to get wrong — they are never pruned and
 * they sit in every prompt forever — and the model kept filing passing irritation
 * as one: "ugh this build is taking forever" became "Doesn't have patience for
 * slow processes", and "my boss has been on my back all week" became a standing
 * preference 2 runs out of 2.
 *
 * The signal that actually separates them is not the sentiment, it is who is
 * being addressed. "I hate it when you use emoji, stop doing that" is aimed at
 * her; "my boss has been on my back" is not aimed at anyone.
 */
const DIRECTED_AT_HER = /\b(you|your|yourself)\b|\b(stop|quit|don'?t|do not|never|always|please|can you|could you|no more)\b/i;

export function readsAsDirective(message: string): boolean {
  return DIRECTED_AT_HER.test(message);
}

export function coerceMemoryKind(value: unknown): MemoryKind {
  const said = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (MEMORY_KINDS.includes(said as MemoryKind)) return said as MemoryKind;
  if (/^(habit|routine|behaviour|behavior|trait|schedule)$/.test(said)) return 'fact';
  if (/^(like|dislike|preferences?|opinion|taste|style)$/.test(said)) return 'preference';
  if (/^(person|people|pet|family|friend|partner|relationships?)$/.test(said)) return 'relationship';
  if (/^(events?|appointment|occasion|milestone)$/.test(said)) return 'event';
  return 'fact';
}

/** What kind of memory a block edit proposes, from the block it lands in. */
function kindForBlock(label: string): MemoryKind {
  if (label === 'preferences') return 'preference';
  if (label === 'relationship') return 'relationship';
  return 'fact';
}

/** Default labels keep their derived view; custom blocks persist explicit
 *  values, since nothing in the engine would otherwise surface them. */
const DEFAULT_BLOCK_LABELS = new Set(['persona', 'human', 'preferences', 'relationship', 'current_project', 'working_state']);

export function coerceKnowledgeCategory(value: unknown): KnowledgeCategory | undefined {
  if (typeof value !== 'string') return undefined;
  return (KNOWLEDGE_CATEGORIES as readonly string[]).includes(value) ? value as KnowledgeCategory : undefined;
}

export const CHAT_TOOLS: ChatTool[] = [{
  type: 'function',
  function: {
    name: 'create_kept_item',
    description: "Save a reminder or appointment to the user's calendar. Call this whenever the user asks to be reminded of something or mentions an appointment — writing it out in your reply does not save anything.",
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Short description of what to do, e.g. "Get milk".' },
        date: { type: 'string', description: 'When it happens, copied from how the user said it: "today", "tomorrow", a weekday such as "thursday" or "next monday", a day of the month such as "the 15th", or "in 3 days". Do not work the calendar date out yourself — pass the wording through and it will be resolved.' },
        time: { type: 'string', description: 'Time of day such as "8:00 AM". Omit for an all-day item.' },
        kind: { type: 'string', enum: ['task', 'event'], description: 'Use "event" for something happening at a set time, like an appointment or a meeting. Use "task" for something to be done and ticked off, like an errand or a chore.' },
      },
      required: ['title', 'date', 'kind'],
    },
  },
}, {
  type: 'function',
  function: {
    name: 'complete_kept_item',
    description: "Tick a task off the user's list once they say they have done it, so you stop asking about it. Only tasks can be ticked off — an event happens whether or not they attend, so this does not apply to appointments or meetings.",
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Roughly what it was, in their words or yours — e.g. "milk" or "the washing".' },
        undo: { type: 'boolean', description: 'Set true if they say it is not done after all, correcting something previously ticked off. Use this rather than deleting it — it still needs doing.' },
      },
      required: ['title'],
    },
  },
}, {
  type: 'function',
  function: {
    name: 'update_kept_item',
    description: "Change a task or event already on the user's list — its wording, its day, or its time. Use this when they want something moved or reworded rather than adding another one.",
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Roughly what it is now, so it can be found.' },
        newTitle: { type: 'string', description: 'The new wording, if they are renaming it.' },
        date: { type: 'string', description: 'The new day, in their words — "tomorrow", "friday", "the 15th".' },
        time: { type: 'string', description: 'The new time, such as "8:00 AM".' },
      },
      required: ['title'],
    },
  },
}, {
  type: 'function',
  function: {
    name: 'delete_kept_item',
    // "I never did get the milk" was deleting the task outright, which loses
    // something the user still needs doing. Not-done and cancelled are opposite
    // states and the description has to separate them.
    description: "Remove a task or event from the user's list entirely, when they say it is cancelled, called off, or no longer needs doing at all. Never use this because something has not been done yet — an errand they have not got to is still outstanding and must stay on the list. This is also not how you tick something off: use complete_kept_item when they have actually done it.",
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Roughly what it is, so it can be found.' },
      },
      required: ['title'],
    },
  },
}, {
  type: 'function',
  function: {
    name: 'show_wardrobe',
    description: 'Open the wardrobe panel so the user can see and change how you look — outfit colours, hair, accessories. Call this whenever they ask you to change your outfit, your hair, what you are wearing, or how you look. Opening it only shows them the options; you are not choosing anything and nothing changes until they pick.',
    parameters: { type: 'object', properties: {}, required: [] },
  },
}, {
  type: 'function',
  function: {
    name: 'remember_about_user',
    // The second sentence is the one that was missing. Measured across the five
    // kinds of thing worth keeping, this fired on four — and the one it missed
    // every time was "I hate it when you use emoji, stop doing that". Told to
    // save "how they like to be spoken to", a model hears a complaint as a
    // complaint and answers it, rather than as a standing preference to file.
    // That is the worst one to lose: preferences are the records that go into
    // every prompt and never get pruned.
    // The second sentence bought the preference case and immediately sold a
    // false positive: "ugh this build is taking forever" came back saved as
    // "Doesn't have much patience with long builds". Venting at the world is not
    // an instruction about you, and the third sentence is what separates them —
    // the test is whether it is addressed to you and would still be true
    // tomorrow, not whether it sounds like a complaint.
    description: "Save a lasting fact about the user — how they like to be spoken to, what they do, the people, pets and projects in their life — so it is still known in later conversations. Any time they tell you to stop doing something, to do something differently, or that they like or hate how you are behaving, that is a preference and you must save it, as well as replying to it. But only when it is about you and about how you should be from now on: grumbling about a slow build, a bad day, the weather or other people is passing irritation, not a standing preference, and saving it clutters what you know about them with a mood. Use it when they mention something worth carrying forward, not for one-off logistics, which belong in create_kept_item.",
    parameters: {
      type: 'object',
      properties: {
        // "I got a new dog, her name is Miso" was saved as the single word
        // "Miso" — true, useless, and unreadable a month later when nothing
        // says what a Miso is. And with the user's own pronoun unknown it was
        // guessed, the same person coming out "her girlfriend" in one record
        // and "his business partner" in the next.
        fact: { type: 'string', description: 'One short statement that will still make sense on its own months from now, with no pronoun for the user: "Has a dog called Miso", not "Miso" and not "his dog". Other people keep their own names — "Emma is their girlfriend". Write only what they actually said, without embellishing it.' },
        kind: { type: 'string', enum: [...MEMORY_KINDS], description: 'Exactly one of these four words and nothing else: "preference" for how they like things done or want you to behave, "relationship" for a person or pet, "event" for something happening in their life, "fact" for anything else including habits and routines.' },
        subject: { type: 'string', description: 'Who or what it concerns, if there is one — a person, a pet, a project.' },
        predicate: { type: 'string', description: 'Optional: the relation the subject stands in, for relational facts — "has", "lives in", "works on", "is allergic to", "created". Only for facts that can be written as subject–relation–object.' },
        object: { type: 'string', description: 'Optional: what the subject relates to — "Miso", "Perth", "the PC Project". Only alongside predicate.' },
        replaces: { type: 'string', description: 'Only if this fact makes an earlier one wrong or out of date — name what changed using a word actually drawn from what you already knew (it will be right there in what you were told about them), not a description of it: "Ubuntu", not "the old OS". Leave out entirely for anything new rather than a correction.' },
      },
      required: ['fact', 'kind'],
    },
  },
}, {
  type: 'function',
  function: {
    name: 'core_memory_append',
    // The memory blocks mirror the deterministic engine, so this is the block
    // face of the same write path — and the description has to say so, or the
    // model treats the block as free text it owns rather than a governed view.
    description: "Append one piece of information to a memory block, the way you would write a line into your own working memory. The append is validated: it must be a lasting fact about the user — not venting, small talk, or something true only of this moment — it must not duplicate what is already known, and the block has a character limit. What you append is recorded through the same memory engine the blocks come from, so it is checked against existing knowledge and surfaced when relevant rather than shown here instantly. Prefer this over remember_about_user when you are updating a block as a whole; use remember_about_user for a single fact with a specific kind. The persona block is read-only and cannot be appended to.",
    parameters: {
      type: 'object',
      properties: {
        label: { type: 'string', description: 'The block to append to: human, preferences, relationship, current_project or working_state.' },
        content: { type: 'string', description: 'One short statement to add, in the third person, with no pronoun for the user: "Works on the PC Project most evenings".' },
      },
      required: ['label', 'content'],
    },
  },
}, {
  type: 'function',
  function: {
    name: 'core_memory_replace',
    description: "Replace a specific existing piece of text in a memory block — the correction path when something you were told has changed and the old version is now wrong. The old text must appear exactly once in the block's current contents; if it is missing, or appears more than once, the replacement is refused rather than guessed. The change goes through the same memory governance as everything else, marking the outdated record as superseded. The persona block is read-only and cannot be replaced in.",
    parameters: {
      type: 'object',
      properties: {
        label: { type: 'string', description: 'The block to replace within: human, preferences, relationship, current_project or working_state.' },
        old_substring: { type: 'string', description: 'Exactly the text currently in the block that you want to change — copied, not paraphrased.' },
        new_substring: { type: 'string', description: 'What it should read instead.' },
      },
      required: ['label', 'old_substring', 'new_substring'],
    },
  },
}];

/**
 * Offered only while searching is switched on. Described as looking something up
 * rather than as a search engine, and pointedly fenced off from the two things
 * she already knows without asking: her own memory of the user, and the list,
 * which is right there in the prompt. Given a general "search the web" tool a
 * model will happily search for what is on the user's calendar.
 */
export const SEARCH_TOOL: ChatTool = {
  type: 'function',
  function: {
    name: 'search_web',
    description: "Look something up online, for things you cannot know from this conversation: current news, prices, sports results, opening times, release dates, who someone is, or anything that has happened recently. Also for how to do something in an app, site, service or product — where a setting lives, how to set something up, what the steps are — because those move and yours are as old as your training. Also use it when you would otherwise be guessing at a fact, rather than guessing. Do not use it for the user's own tasks and appointments, which you already have, for anything they have told you, or for chatting.",
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'What to search for, written as you would type it into a search box. Keywords, not a sentence addressed to the user.' },
      },
      required: ['query'],
    },
  },
};

/**
 * Offered only alongside a search, and only when page reading is on. Deliberately
 * not described as "open a url": given that, a model invents addresses it thinks
 * ought to exist and reads 404s. The address has to have come from somewhere.
 */
/**
 * Her own store, looked into rather than web-searched: the user's files, projects
 * and setup are exactly the things a general model invents when it is wrong.
 */
export const KNOWLEDGE_TOOL: ChatTool = {
  type: 'function',
  function: {
    name: 'look_up_knowledge',
    description: 'Search Haru\'s own stored knowledge — documents and notes the user has given her, their project files, machine and setup notes, saved personal records — for facts about their world that are not in your training. Use it for anything about their own stuff: their machine, their projects, files they have given you, things they have documented for you. Prefer it over web search for anything local. Results come with their source and date; prefer the most recently updated when sources conflict.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'What to look for, written as keywords or a short question.' },
        category: { type: 'string', enum: [...KNOWLEDGE_CATEGORIES], description: 'Restrict the search to one category, when you are sure which one it is.' },
      },
      required: ['query'],
    },
  },
};

/**
 * The read-only half: facts about the machine she runs on, answered with
 * structured JSON rather than a terminal someone would have to read. Nothing
 * here changes anything, so nothing here needs permission beyond being on.
 */
export const SYSTEM_TOOLS: ChatTool[] = [
  {
    type: 'function',
    function: {
      name: 'get_system_info',
      description: 'Facts about the server you are running on — the OS, hostname, CPU model and load, RAM, disk usage and network status. Use it when they ask anything about the machine itself: what it runs, how much memory it has, whether the disk is full, whether it is online.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_gpu_info',
      description: 'The NVIDIA GPU — model, VRAM used and total, utilisation percent, temperature. Use it when they ask about VRAM, GPU usage, or why the machine is slow at graphics or inference.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_processes',
      description: 'The processes using the most CPU right now, with their CPU percent and memory. Use it for "what is eating my CPU/RAM" questions.',
      parameters: {
        type: 'object',
        properties: { limit: { type: 'number', description: 'How many processes to list. Default 10, max 50.' } },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_docker_status',
      description: 'The Docker daemon and its containers — which are running, their health, restart counts, CPU and memory. Use it when they ask whether Docker or a specific container is working.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_service_status',
      description: 'The status of a named service — the user services she runs under (haru, gpt-sovits, obsidian, xvfb, x11vnc, haru-asr, haru-discord-bot) and the system ollama service. Use it when they ask whether something is running.',
      parameters: {
        type: 'object',
        properties: { name: { type: 'string', description: 'The service name, e.g. "haru" or "ollama". Leave out to check them all.' } },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'diagnose_system',
      description: 'A concise diagnosis of one part of the machine, combining the relevant metrics into a verdict rather than raw numbers: "gpu", "memory", "disk", "docker", "network", "haru", or "all". Use it when they ask "is anything wrong" or "how is the machine doing", or to check on a specific part.',
      parameters: {
        type: 'object',
        properties: { target: { type: 'string', enum: ['gpu', 'memory', 'disk', 'docker', 'network', 'haru', 'all'], description: 'What to diagnose.' } },
        required: ['target'],
      },
    },
  },
];

/**
 * The level-2 half: actions that change something. Each one is gated by the
 * permission level and allowlist in system.config, and each one requires an
 * explicit in-conversation confirmation — the model must say the action is
 * wanted before the handler will run it. Nothing here ever takes a shell
 * command; arguments are validated against enumerated names.
 */
export const SYSTEM_ACTION_TOOLS: ChatTool[] = [
  {
    type: 'function',
    function: {
      name: 'restart_docker_container',
      description: 'Restart a Docker container by name (e.g. sonarr, jellyfin, haru-redis). Disruptive — requires explicit confirmation before it will act.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'The container name.' },
          confirm: { type: 'boolean', description: 'Must be true, and only after they have explicitly said to go ahead.' },
        },
        required: ['name', 'confirm'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'start_service',
      description: 'Start a named user service (haru, gpt-sovits, obsidian, xvfb, x11vnc, haru-asr, haru-discord-bot). Disruptive — requires explicit confirmation.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'The service name.' },
          confirm: { type: 'boolean', description: 'Must be true, and only after they have explicitly said to go ahead.' },
        },
        required: ['name', 'confirm'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'stop_service',
      description: 'Stop a named user service (haru, gpt-sovits, obsidian, xvfb, x11vnc, haru-asr, haru-discord-bot). Disruptive — requires explicit confirmation.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'The service name.' },
          confirm: { type: 'boolean', description: 'Must be true, and only after they have explicitly said to go ahead.' },
        },
        required: ['name', 'confirm'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'restart_haru',
      description: 'Restart Haru herself. She drops the connection for a moment and comes back. Disruptive — requires explicit confirmation.',
      parameters: {
        type: 'object',
        properties: { confirm: { type: 'boolean', description: 'Must be true, and only after they have explicitly said to go ahead.' } },
        required: ['confirm'],
      },
    },
  },
];

export const READ_PAGE_TOOL: ChatTool = {
  type: 'function',
  function: {
    name: 'read_web_page',
    description: 'Open one of the pages your last search turned up and read it, when the short summary is not enough to answer — a forecast, a price, a result, the detail of an article. Prefer answering from the summaries when they already say enough, since reading a page is slow.',
    parameters: {
      type: 'object',
      properties: {
        // A number, not an address. Given a url field she wrote one from the
        // hostname and a guessed path, and every attempt 404'd; an index can
        // only ever name a result that exists.
        result: { type: 'number', description: 'Which result to open, by its number in the list you were just given — 1 for the first.' },
      },
      required: ['result'],
    },
  },
};

/**
 * Its own tool rather than a web search, because the answers are different in
 * kind: a search returns pages about a series, this returns the series. Told to
 * find out how long something is, she would otherwise search the web and read a
 * shop listing.
 */
/**
 * Recording what they told her, when the journal came up in conversation. The
 * description leans hard on using their own words: the point of a journal is
 * what they said, and a model left to summarise turns "work was a nightmare and
 * I barely slept" into "had a difficult day", which is not their entry any more.
 */
export const JOURNAL_TOOL: ChatTool = {
  type: 'function',
  function: {
    name: 'save_journal_entry',
    description: "Write today's journal entry, when they have just told you how their day went or how they are feeling and you asked for it or they offered it. Use their own words as closely as you can — this is their diary, not your summary of them. Only call this once they have actually said something about their day; never invent an entry, and do not use it for ordinary conversation they did not mean as a journal.",
    parameters: {
      type: 'object',
      properties: {
        text: { type: 'string', description: "What they said about their day and how they are feeling, in their words, tidied only where speech-to-text mangled it. Write it as they said it — first person." },
        mood: { type: 'number', description: `How good they feel, 0–${SCALE_MAX}, only if they gave a number or said something plain enough to place on it. Leave it out rather than guessing.` },
        anxiety: { type: 'number', description: `How anxious they feel, 0–${SCALE_MAX}, where 0 is calm. Only if they said. Leave it out rather than guessing.` },
        energy: { type: 'number', description: `How much energy they have, 0–${SCALE_MAX}. Only if they said.` },
      },
      required: ['text'],
    },
  },
};

export const CHECKIN_TOOL: ChatTool = {
  type: 'function',
  function: {
    name: 'note_check_in',
    description: "Write down a short check-in when they mention how they are feeling in passing — a rough hour, a spike of anxiety, something that just happened. This is not the journal: it is a note taken while the day is still going, and it is what you read back at the end of the day to ask about it properly. Use it whenever they say something about their state, however briefly, even mid-conversation. Do not use it for a full account of a whole day — that is save_journal_entry.",
    parameters: {
      type: 'object',
      properties: {
        note: { type: 'string', description: 'What they said happened or how they feel, in their own words, short. First person, as they said it.' },
        anxiety: { type: 'number', description: 'How anxious, 1-10, only if they gave a number or said something plain enough to place on one. Leave it out rather than guessing — a note without a number is still worth keeping.' },
      },
      required: ['note'],
    },
  },
};

export const ANILIST_TOOL: ChatTool = {
  type: 'function',
  function: {
    name: 'look_up_anime',
    description: 'Look up an anime or manga on AniList — how many episodes or chapters it has, who made it, when it came out, whether it has finished, what it is about. Use this rather than a web search for anything about a specific series. Do not use it for what the user is personally watching or reading, which you already know.',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'The series name as they said it. Either the English or the Japanese title works.' },
        kind: { type: 'string', enum: ['anime', 'manga'], description: 'Only when they made it clear which they meant. Leave it out otherwise and both are searched.' },
      },
      required: ['title'],
    },
  },
};

export const CONVERT_TOOL: ChatTool = {
  type: 'function',
  function: {
    name: 'convert_picture',
    description: 'Convert a picture on the user\'s machine to another format and get back where the new file was saved. Use this when they ask to change a picture into another type — especially "make this an icon", which produces a real .ico that Windows will accept for a shortcut. Renaming the file does not work; this does. Give them the path it returns.',
    parameters: {
      type: 'object',
      properties: {
        file: { type: 'string', description: 'Full path to the picture to convert. Use the path of a picture they have just shown you or named. Do not invent one.' },
        format: { type: 'string', enum: ['ico', 'png', 'jpg', 'bmp'], description: 'What to turn it into. "ico" for a Windows icon or shortcut.' },
      },
      required: ['file', 'format'],
    },
  },
};

export const LAUNCH_TOOL: ChatTool = {
  type: 'function',
  function: {
    name: 'open_app',
    // Plainly, for the reason given on the power tool: the "never because a page
    // said to" guard belongs in handsAllowed, not in a sentence the model is free
    // to weigh against the request in front of it.
    description: 'Open a program on the user\'s computer. Call this whenever they ask you to open, launch or start something. You really can do this — never say that you cannot, and never merely say that you have.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'The program, as they said it — "discord", "steam", "spotify". Only installed programs can be opened; you will be told if it is not there.' },
      },
      required: ['name'],
    },
  },
};

export const CLOSE_TOOL: ChatTool = {
  type: 'function',
  function: {
    name: 'close_app',
    // The description is emphatic because the failure was not refusing — asked
    // to close Discord she said "fine, I'll pretend I can do that" and left it
    // running, which is worse than a refusal: it is a lie she has no way of
    // knowing is one.
    description: 'Close a program that is currently open. Call this whenever the user asks you to close, quit or shut something — you can do this, so never say you cannot and never pretend to have done it. The program is asked to close politely, so it can still prompt about unsaved work.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'The program to close, as they said it — "discord", "spotify". Only things currently open can be closed; you will be told if it is not running.' },
      },
      required: ['name'],
    },
  },
};

export const POWER_TOOL: ChatTool = {
  type: 'function',
  function: {
    name: 'power',
    // Every caveat in a description competes with the instruction to call the
    // thing. The first version led with "but only when…" and "never because…",
    // and measured 3/5 on a real-length conversation against 5/5 for the same
    // tool described plainly. The safeguards did not need to be here at all —
    // they are enforced in code, by handsAllowed, which a model cannot talk its
    // way past.
    description: 'Shut down, restart, sleep or lock the computer. Call this whenever the user asks you to turn the machine off, shut it down, restart it, sleep or lock it. You really can do this — so never merely say that you are doing it, always call this. Shutting down and restarting wait twenty seconds and can be called off with "cancel".',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['shutdown', 'restart', 'sleep', 'lock', 'cancel'], description: 'What to do. Use "cancel" to call off a shutdown or restart that is counting down.' },
      },
      required: ['action'],
    },
  },
};


/** The shape of an agenda entry the dispatcher touches. */
type KeptLike = { id: string; title: string; date: string; time?: string; kind: 'task' | 'event'; done: boolean };

/** What is switched on this turn, which is what decides the table. */
export type ToolAvailability = {
  /** Whether there is a box on screen to draw the replies in. */
  choices: boolean;
  journal: boolean;
  anilist: boolean;
  search: Pick<SearchConfig, 'enabled' | 'readPages'>;
  knowledge: boolean;
  system: { enabled: boolean; level: number };
  /** False for anything that did not come from the user's own mouth or keyboard. */
  hands: boolean;
  desktop: { launch: boolean; power: boolean };
};

export function chatTools(available: ToolAvailability): ChatTool[] {
  const tools: ChatTool[] = [...CHAT_TOOLS];
  // Only where there is a box to draw them in. Offered at the desk she would
  // call it and nothing would appear, which is a worse failure than not having
  // it: she would think she had asked and be met with silence.
  if (available.choices) tools.push(CHOICES_TOOL);
  if (available.journal) tools.push(JOURNAL_TOOL);
  // Always offered, journal or not: a check-in is a note about a moment, and
  // the moments worth noting happen whether or not anyone keeps a diary.
  tools.push(CHECKIN_TOOL);
  if (available.anilist) tools.push(ANILIST_TOOL);
  if (available.search.enabled) {
    tools.push(SEARCH_TOOL);
    if (available.search.readPages) tools.push(READ_PAGE_TOOL);
  }
  if (available.knowledge) tools.push(KNOWLEDGE_TOOL);
  if (available.system.enabled) {
    tools.push(...SYSTEM_TOOLS);
    if (available.system.level >= 2) tools.push(...SYSTEM_ACTION_TOOLS);
  }
  tools.push(CONVERT_TOOL);
  if (available.hands && available.desktop.launch) tools.push(LAUNCH_TOOL, CLOSE_TOOL);
  if (available.hands && available.desktop.power) tools.push(POWER_TOOL);
  return tools;
}

/**
 * Everything the dispatcher needs from the running app. All of it is state the
 * app owns — the store, the lists, the flags a turn moves underneath it — and
 * none of it is reachable from a module that has to stay testable.
 */
export type ToolDeps = {
  CHAT_TIMEZONE: string;
  net: { fetch: Fetcher };
  store: {
    get(key: string, defaultValue?: unknown): unknown;
    getBlocks(): MemoryBlock[];
    transaction(run: () => void): void;
  };
  getCheckIns(): CheckInStore;
  setCheckIns(entries: CheckInStore): void;
  getJournal(): JournalEntry[];
  writeJournal(text: string, ratings: { mood?: number; anxiety?: number; energy?: number; sleep?: number }, prompted: boolean): JournalEntry | undefined;
  /** Records that today's entry is written, so she stops asking for it. */
  noteJournalAsked(date: string): void;
  getKept(): KeptLike[];
  addKeptItem(item: { title: string; date: string; time?: string; kind: 'task' | 'event' }): KeptLike;
  toggleKept(id: string, force?: boolean): void;
  removeKept(id: string): void;
  updateKept(id: string, changes: Partial<Pick<KeptLike, 'title' | 'date' | 'time'>>): KeptLike | null;
  getMemories(): MemoryRecord[];
  setMemories(records: MemoryRecord[]): void;
  addMemory(text: string, kind: MemoryKind, subject?: string, options?: { source?: string; predicate?: string; object?: string }): { record: MemoryRecord | null; created: boolean } | null;
  setBlocks(blocks: MemoryBlock[]): void;
  blockSources(query: string): BlockSources;
  getWardrobeControls(): { name: string }[];
  sendToWindows(channel: string, payload?: unknown): void;
  readSystemConfig(): { enabled: boolean; level: number; allowlist: string[] };
  getKnowledgeConfig(): { enabled: boolean; contextChunks: number; threshold: number; contextChars: number };
  getKnowledgeEmbedder(): { embed(text: string): Promise<number[]> } | null | undefined;
  knowledgeStore(): KnowledgeStore;
  tryEmbedQuery(query: string): Promise<number[] | null | undefined>;
  memoryVectors(): Map<string, number[]>;
  touchChunks(ids: string[]): void;
  getSearchKey(): string;
  /** Whether the tools that touch the machine may run at all this turn. */
  handsAllowed(): boolean;
  /** A stranger's page has entered the conversation; withdraw everything. */
  markPageRead(): void;
  setPendingChoices(choices: unknown[]): void;
  /** Restart after the reply is delivered, never during it. */
  requestRestart(): void;
  lastResults(): SearchResult[];
  lastSearchQuery(): string;
  rememberSearch(query: string, results: SearchResult[]): void;
  /** Also used by the caller after a reply lands, so it is injected rather than moved. */
  runSystemCommand(file: string, args: string[]): Promise<{ ok: boolean; error?: string }>;
};


export async function runChatTool(call: ToolCall, latestUserMessage: string, deps: ToolDeps): Promise<string> {
  // Destructured under the names the body already used, so what moved here is
  // the same code and not a rewrite of it.
  const {
    CHAT_TIMEZONE, net, store, getCheckIns, setCheckIns, getJournal, writeJournal, noteJournalAsked,
    getKept, addKeptItem, toggleKept, removeKept, updateKept, getMemories, setMemories, addMemory,
    setBlocks, blockSources, getWardrobeControls, sendToWindows, readSystemConfig, getKnowledgeConfig,
    getKnowledgeEmbedder, knowledgeStore, tryEmbedQuery, memoryVectors, touchChunks, getSearchKey,
    handsAllowed, markPageRead, setPendingChoices, requestRestart, lastResults, lastSearchQuery,
    rememberSearch, runSystemCommand,
  } = deps;
  const name = call.function?.name;
  const args = toolArguments(call);
  if (name === 'note_check_in') {
    const note = typeof args.note === 'string' ? args.note.trim() : '';
    if (!note) return JSON.stringify({ error: 'There is nothing to note down yet.' });
    const rating = typeof args.anxiety === 'number' && args.anxiety >= 1 && args.anxiety <= 10 ? Math.round(args.anxiety) : undefined;
    const now = zonedNow(CHAT_TIMEZONE);
    setCheckIns(addCheckIn(getCheckIns(), note.slice(0, 1000), rating, new Date(), localDateKey(now)));
    console.log(`[checkin] noted from conversation${rating ? ` (anxiety ${rating}/10)` : ''}`);
    return JSON.stringify({ saved: true, note: note.slice(0, 120), anxiety: rating ?? null, today: checkInsOn(getCheckIns(), localDateKey(now)).length });
  }
  if (name === 'save_journal_entry') {
    const text = typeof args.text === 'string' ? args.text.trim() : '';
    if (!text) return JSON.stringify({ error: 'There is nothing to write down yet. Ask them how the day went first.' });
    if (!readJournalConfig(store.get('journal.config')).enabled) return JSON.stringify({ error: 'The journal is switched off.' });
    const entry = writeJournal(text, {
      mood: typeof args.mood === 'number' ? args.mood : undefined,
      anxiety: typeof args.anxiety === 'number' ? args.anxiety : undefined,
      energy: typeof args.energy === 'number' ? args.energy : undefined,
    }, true);
    // Length and which ratings landed, never the text. A journal that shows up in
    // a log file is not a private one.
    console.log(`[journal] wrote ${entry?.date}: ${text.length} chars, mood ${entry?.mood ?? '-'}, anxiety ${entry?.anxiety ?? '-'}`);
    if (entry?.date) noteJournalAsked(entry.date);
    return JSON.stringify({
      saved: true,
      date: entry?.date,
      mood: entry?.mood ?? null,
      anxiety: entry?.anxiety ?? null,
      note: 'Written down. Say something brief and human about it — react to what they actually told you. Do not read the entry back, do not summarise it as a list, and do not offer advice or diagnose anything.',
    });
  }
  if (name === 'look_up_anime') {
    const title = typeof args.title === 'string' ? args.title.trim() : '';
    if (!title) return JSON.stringify({ error: 'title is required.' });
    const config = readAniListConfig(store.get('anilist'));
    if (!config.enabled) return JSON.stringify({ error: 'AniList lookups are switched off.' });
    const kind = args.kind === 'anime' ? 'ANIME' : args.kind === 'manga' ? 'MANGA' : undefined;
    try {
      const media = await lookUp(title, kind as MediaKind | undefined, net.fetch);
      console.log(`[anilist] "${title}" -> ${media ? `${media.title} (${media.kind})` : 'nothing'}`);
      return media ? formatMedia(media) : formatMissing(title);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      console.warn(`[anilist] "${title}" failed: ${reason}`);
      return `AniList could not be reached (${reason}). Say you could not check. Do not describe it from memory as though you had.`;
    }
  }
  if (name === 'convert_picture') {
    const file = String(args.file ?? '').trim();
    const format = normaliseFormat(String(args.format ?? ''));
    if (!format) return JSON.stringify({ error: `I can convert to ${FORMATS.join(', ')} — not ${args.format}.` });
    try {
      const done = convertImage(file, format);
      console.log(`[convert] ${path.extname(file) || '?'} -> ${format} (${Math.round(done.bytes / 1024)}kb)`);
      return JSON.stringify({
        saved: done.path,
        note: done.note,
        // Said plainly because she otherwise announces the conversion and leaves
        // them to find it, which is the half of the job that is any use.
        tell_them: `Say it is done and give them the full path exactly as written here: ${done.path}`,
      });
    } catch (error) {
      return JSON.stringify({ error: error instanceof Error ? error.message : String(error) });
    }
  }
  if (name === 'open_app') {
    // Re-checked here, not only where the tools are assembled. A model can name
    // a tool it was never offered, and this is the one place that actually runs.
    if (!handsAllowed()) return JSON.stringify({ error: 'Not now — say it to me directly and I will.' });
    if (!readDesktopConfig(store.get('desktop')).launch) return JSON.stringify({ error: 'Opening programs is switched off in Setup.' });
    const wanted = String(args.name ?? '').trim();
    const app = matchApp(wanted, findApps());
    if (!app) return JSON.stringify({ error: `There is nothing called "${wanted}" in the Start Menu. Say so rather than guessing at another program.` });
    launch(app);
    console.log(`[desktop] opened ${app.name}`);
    return JSON.stringify({ opened: app.name });
  }
  if (name === 'close_app') {
    if (!handsAllowed()) return JSON.stringify({ error: 'Not now — say it to me directly and I will.' });
    if (!readDesktopConfig(store.get('desktop')).launch) return JSON.stringify({ error: 'Closing programs is switched off in Setup.' });
    const wanted = String(args.name ?? '').trim();
    const app = matchRunning(wanted, await listRunning());
    if (!app) return JSON.stringify({ error: `Nothing called "${wanted}" is open. Say so — do not claim you closed it.` });
    closeApp(app);
    console.log(`[desktop] asked ${app.name} to close`);
    return JSON.stringify({ closed: app.name });
  }
  if (name === 'power') {
    if (!handsAllowed()) return JSON.stringify({ error: 'Not now — say it to me directly and I will.' });
    if (!readDesktopConfig(store.get('desktop')).power) return JSON.stringify({ error: 'Shutting the machine down is switched off in Setup.' });
    const asked = String(args.action ?? '').trim().toLowerCase();
    if (asked === 'cancel') {
      cancelPower();
      console.log('[desktop] shutdown cancelled');
      return JSON.stringify({ cancelled: true, tell_them: 'Say it is called off.' });
    }
    const action = normalisePower(asked);
    if (!action) return JSON.stringify({ error: `I can shut down, restart, sleep or lock — not "${args.action}".` });
    runPower(action);
    console.log(`[desktop] ${action}${isCancellable(action) ? ` in ${POWER_DELAY_S}s` : ''}`);
    return JSON.stringify(isCancellable(action)
      ? { started: action, seconds: POWER_DELAY_S, tell_them: `Tell them it is ${action === 'shutdown' ? 'shutting down' : 'restarting'} in ${POWER_DELAY_S} seconds and that saying "cancel" stops it.` }
      : { done: action });
  }
  if (name === 'read_web_page') {
    const config = readSearchConfig(store.get('search'));
    if (!config.enabled || !config.readPages) return JSON.stringify({ error: 'Opening pages is switched off.' });
    if (!lastResults().length) return JSON.stringify({ error: 'There are no search results to open. Search first.' });
    const index = Math.round(Number(args.result));
    const chosen = Number.isFinite(index) ? lastResults()[index - 1] : undefined;
    if (!chosen) return JSON.stringify({ error: `There is no result ${args.result}. The list has ${lastResults().length}.` });
    const target = chosen.url;
    try {
      const page = await readWebPage(target, net.fetch);
      // The host, never the path: a log outlives the moment, and a line-by-line
      // record of which articles were read is a browsing history by another name.
      console.log(`[search] read ${new URL(page.url).hostname} -> ${page.text.length} chars`);
      // Only now. A page that failed to load put no stranger's text into the
      // conversation, so there is nothing to withdraw her tools over — and a
      // great deal of the web is script-built, so the second choice often works
      // where the first did not.
      markPageRead();
      return formatPage(page, lastSearchQuery() || 'their question');
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      console.warn(`[search] could not read a page: ${reason}`);
      const others = lastResults().length - 1;
      return `That page could not be read (${reason}). ${others > 0 ? `You may try one other result instead if a different one looks like it would answer them. ` : ''}Otherwise answer from the search summaries you already have, or say you could not find it. Do not answer from memory as though you had read it.`;
    }
  }
  if (name === 'offer_choices') {
    const offered = readChoices((args as { choices?: unknown }).choices);
    setPendingChoices(offered);
    if (!offered.length) return JSON.stringify({ shown: false, reason: 'Give two to four short replies, each in their voice.' });
    console.log(`[summon] offered ${offered.length} choices`);
    return JSON.stringify({ shown: true, choices: offered });
  }

  if (name === 'search_web') {
    const query = typeof args.query === 'string' ? args.query.trim() : '';
    if (!query) return JSON.stringify({ error: 'query is required.' });
    const config = readSearchConfig(store.get('search'));
    try {
      const results = await searchWeb(query, config, net.fetch, getSearchKey());
      // The query is logged, the results are not: what she found is answered from
      // and forgotten, and a browsing history on disk is a different thing again.
      console.log(`[search] "${query}" -> ${results.length} results`);
      rememberSearch(query, results);
      return formatResults(query, results, config.readPages);
    } catch (error) {
      // Handed back rather than thrown. A failed lookup should cost her the fact,
      // not the reply — she says she could not check and carries on.
      const reason = error instanceof Error ? error.message : String(error);
      // Being turned away is not the same as finding nothing, and she must not
      // report it as such: a silent empty result reads to the user as "there is
      // nothing out there" when the truth is that nobody looked.
      if (error instanceof SearchBlocked) {
        console.warn(`[search] "${query}" blocked: ${reason}`);
        // Named as a search provider in your own settings, not just "Brave" —
        // told the short version she advised switching browsers, which is not
        // the setting, not the problem, and not something you can act on.
        return `The search was refused, not empty — the provider is asking this machine to prove it is a person (${reason}). Tell them searching is blocked at the moment, and that they can fix it in your setup panel under "Looking things up" by changing the search provider from DuckDuckGo to Brave. Do not answer the question from memory.`;
      }
      console.warn(`[search] "${query}" failed: ${reason}`);
      return `The search did not go through (${reason}). Tell them you could not check just now. Do not answer from memory as though you had looked it up.`;
    }
  }
  if (name === 'show_wardrobe') {
    const controls = getWardrobeControls();
    // Told plainly when there is nothing to show, so she says so in her own words
    // instead of describing a panel the user cannot see.
    if (!controls.length) return JSON.stringify({ opened: false, reason: 'This model has no changeable outfit or colour options.' });
    sendToWindows('wardrobe:open');
    console.log(`[wardrobe] opened by request, ${controls.length} controls`);
    return JSON.stringify({ opened: true, options: controls.map(control => control.name) });
  }
  if (name === 'remember_about_user') {
    const fact = typeof args.fact === 'string' ? args.fact.trim() : '';
    if (!fact) return JSON.stringify({ error: 'fact is required.' });
    let kind = coerceMemoryKind(args.kind);
    // Downgraded rather than refused: what they said may well be worth keeping,
    // it is simply not a standing instruction about how she should behave. As a
    // plain fact it can be pruned and only surfaces when relevant, instead of
    // riding along in every prompt from now until they notice.
    if (kind === 'preference' && !readsAsDirective(latestUserMessage)) {
      console.log(`[ai] "${fact}" filed as a fact, not a preference — they were not telling her to change anything`);
      kind = 'fact';
    }
    const subject = typeof args.subject === 'string' && args.subject.trim() ? args.subject.trim() : undefined;
    const predicate = typeof args.predicate === 'string' && args.predicate.trim() ? args.predicate.trim() : undefined;
    const object = typeof args.object === 'string' && args.object.trim() ? args.object.trim() : undefined;
    // Found before the save, against what is active right now — searching after
    // would risk the new record matching its own hint back to itself.
    const replaces = typeof args.replaces === 'string' && args.replaces.trim() ? args.replaces.trim() : undefined;
    const outdated = replaces ? findSuperseded(getMemories(), replaces) : null;
    const saved = addMemory(fact, kind, subject, { source: 'explicit', predicate, object });
    if (!saved) return JSON.stringify({ error: 'fact is required.' });
    if (!saved.record) {
      // Said back plainly, because the alternative is her announcing that she
      // will remember something she has not kept.
      return JSON.stringify({
        saved: false,
        reason: 'That is not worth writing down — it is either about this moment only, or true of anyone. Keep things that would still matter to them in a month. Do not tell them you have remembered it.',
      });
    }
    if (outdated && outdated.id !== saved.record.id) {
      setMemories(supersede(getMemories(), outdated.id, saved.record.id));
      console.log(`[memory] "${outdated.text}" superseded by "${fact}"`);
    }
    console.log(`[ai] ${saved.created ? 'remembered' : `heard again (${saved.record.mentions}x)`} [${kind}]: "${fact}"`);
    // Being told it is already known is useful to the model — it stops it
    // announcing a discovery when the user has merely repeated themselves.
    return JSON.stringify({ saved: true, known: !saved.created, mentions: saved.record.mentions, kind });
  }
  if (name === 'core_memory_append' || name === 'core_memory_replace') {
    // The block face of the memory write path. The block checks run first —
    // exists, editable, within budget — and only then does the content pass
    // through the same governance as remember_about_user. LLM proposes, Haru
    // decides; the block itself is a view, not a free-text scratchpad.
    const label = typeof args.label === 'string' ? args.label.trim() : '';
    const blocks = store.getBlocks();
    const block = findBlock(blocks, label);
    if (!block) return JSON.stringify({ error: `There is no memory block called "${label}". The blocks are human, preferences, relationship, current_project and working_state.` });
    if (!canEditBlock(blocks, label)) return JSON.stringify({ error: `The "${label}" block is read-only — it is fixed by the user's configuration and cannot be changed through memory tools.` });
    const current = resolveBlockValue(block, blockSources(''));
    if (name === 'core_memory_append') {
      const content = typeof args.content === 'string' ? args.content.trim() : '';
      const edit = appendToBlockValue(current, content, block);
      if (!edit.ok) return JSON.stringify({ error: edit.reason });
      // Governance write-through: the engine decides whether this is worth
      // keeping, at its own confidence — model proposals start uncertain.
      const kind = kindForBlock(label);
      const saved = addMemory(content, kind, undefined, { source: 'inferred' });
      if (!saved?.record) {
        return JSON.stringify({ saved: false, reason: 'Not recorded — that reads as either about this moment only or true of anyone. Keep things that would still matter to them in a month.' });
      }
      // Custom blocks (no engine surface of their own) persist the edited value;
      // default blocks stay derived and pick the new record up through selection.
      if (!DEFAULT_BLOCK_LABELS.has(label)) {
        const next = edit.value!;
        setBlocks(blocks.map(candidate => candidate.label === label ? withEditedValue(candidate, next) : candidate));
      }
      console.log(`[blocks] append → ${label}: "${content.slice(0, 60)}" (${saved.created ? 'new record' : `known, ${saved.record.mentions}x`})`);
      return JSON.stringify({
        saved: true,
        known: !saved.created,
        note: `Appended to the ${label} block and recorded in memory. It will surface in the block when it is relevant.`,
      });
    }
    const oldSubstring = typeof args.old_substring === 'string' ? args.old_substring : '';
    const newSubstring = typeof args.new_substring === 'string' ? args.new_substring : '';
    const edit = replaceInBlockValue(current, oldSubstring, newSubstring, block);
    if (!edit.ok) return JSON.stringify({ error: edit.reason });
    const kind = kindForBlock(label);
    const outdated = findSuperseded(getMemories(), oldSubstring);
    const replacement = newSubstring.trim();
    const saved = replacement ? addMemory(replacement, kind, undefined, { source: 'inferred' }) : null;
    if (saved && !saved.record) {
      return JSON.stringify({ saved: false, reason: 'The replacement was not recorded — it reads as either about this moment only or true of anyone.' });
    }
    store.transaction(() => {
      if (outdated && saved?.record && outdated.id !== saved.record.id) {
        setMemories(supersede(getMemories(), outdated.id, saved.record.id));
        console.log(`[memory] "${outdated.text.slice(0, 50)}" superseded by "${newSubstring.slice(0, 50)}"`);
      }
      if (!DEFAULT_BLOCK_LABELS.has(label)) {
        const next = edit.value!;
        setBlocks(store.getBlocks().map(candidate => candidate.label === label ? withEditedValue(candidate, next) : candidate));
      }
    });
    console.log(`[blocks] replace in ${label}: "${oldSubstring.slice(0, 40)}" → "${newSubstring.slice(0, 40)}"`);
    return JSON.stringify({
      saved: true,
      note: `Replaced in the ${label} block. ${outdated ? 'The outdated record was superseded.' : 'No existing record matched the replaced text.'}`,
    });
  }
  if (name === 'complete_kept_item') {
    const title = typeof args.title === 'string' ? args.title.trim() : '';
    if (!title) return JSON.stringify({ error: 'title is required.' });
    const undo = args.undo === true;
    const kept = getKept();
    // Events included. Half of what lands on a calendar is really an errand with
    // a time on it — "Pick up CPU" arrived as an event because that is where it
    // was written down — and refusing to close those left them outstanding for
    // ever with nothing the user could say to settle it.
    const match = findItem(kept.filter(item => item.done === undo), title);
    if (!match) return JSON.stringify({ saved: false, reason: `Nothing on the list matches "${title}".` });
    toggleKept(match.id, !undo);
    console.log(`[ai] ${undo ? 'un-ticked' : 'ticked off'}: "${match.title}"`);
    return JSON.stringify({ saved: true, title: match.title, date: match.date, done: !undo });
  }
  if (name === 'update_kept_item' || name === 'delete_kept_item') {
    const title = typeof args.title === 'string' ? args.title.trim() : '';
    if (!title) return JSON.stringify({ error: 'title is required.' });
    const match = findItem(getKept(), title);
    if (!match) return JSON.stringify({ saved: false, reason: `Nothing on the list matches "${title}".` });
    if (name === 'delete_kept_item') {
      // The last line of defence for the not-done-versus-cancelled confusion.
      // Refused rather than obeyed, with the reason, so she un-ticks instead.
      if (readsAsNotDone(latestUserMessage) && !match.done) {
        console.log(`[ai] refused to delete "${match.title}" — the user said it is not done, not cancelled`);
        return JSON.stringify({ saved: false, reason: `They said "${match.title}" is not done yet, which is not the same as cancelling it. It stays on the list. Use complete_kept_item with undo if it was wrongly ticked off.` });
      }
      removeKept(match.id);
      console.log(`[ai] deleted ${match.kind}: "${match.title}"`);
      return JSON.stringify({ saved: true, deleted: match.title, kind: match.kind });
    }
    const changes: Partial<Pick<KeptLike, 'title' | 'date' | 'time'>> = {};
    if (typeof args.newTitle === 'string' && args.newTitle.trim()) changes.title = args.newTitle.trim();
    if (typeof args.time === 'string' && args.time.trim()) changes.time = args.time.trim();
    if (typeof args.date === 'string' && args.date.trim()) {
      const resolved = resolveDate(args.date.trim(), zonedNow(CHAT_TIMEZONE));
      if (!resolved) return JSON.stringify({ error: `Could not understand the date "${args.date}".` });
      changes.date = resolved;
    }
    if (!Object.keys(changes).length) return JSON.stringify({ error: 'Nothing to change — give a new title, date or time.' });
    const updated = updateKept(match.id, changes);
    console.log(`[ai] updated ${match.kind}: "${match.title}" -> ${JSON.stringify(changes)}`);
    return JSON.stringify({ saved: true, title: updated?.title, date: updated?.date, time: updated?.time ?? null, kind: match.kind });
  }
  if (name && ['get_system_info', 'get_gpu_info', 'get_processes', 'get_docker_status', 'get_service_status', 'diagnose_system', 'restart_docker_container', 'start_service', 'stop_service', 'restart_haru'].includes(name) && !readSystemConfig().enabled) {
    return JSON.stringify({ error: 'The system tools are switched off.' });
  }
  if (name === 'get_system_info') {
    const started = Date.now();
    const collected = await collectSystem();
    console.log(`[system] get_system_info in ${Date.now() - started}ms`);
    return JSON.stringify(collected);
  }
  if (name === 'get_gpu_info') {
    const gpu = await collectGpu();
    return JSON.stringify(gpu?.length ? gpu : { error: 'nvidia-smi did not answer — is this an NVIDIA machine?' });
  }
  if (name === 'get_processes') {
    const limit = typeof args.limit === 'number' ? Math.max(1, Math.min(50, Math.round(args.limit))) : 10;
    const processes = await collectProcesses(limit);
    return JSON.stringify({ processes });
  }
  if (name === 'get_docker_status') {
    const docker = await collectDocker();
    return JSON.stringify(docker ?? { error: 'The Docker daemon did not answer.' });
  }
  if (name === 'get_service_status') {
    const wanted = typeof args.name === 'string' && args.name.trim() ? args.name.trim() : undefined;
    if (wanted && !KNOWN_SERVICES.includes(wanted)) return JSON.stringify({ error: `Unknown service "${wanted}". Known: ${KNOWN_SERVICES.join(', ')}.` });
    const services = await collectServices(wanted);
    return JSON.stringify({ services });
  }
  if (name === 'diagnose_system') {
    const target = typeof args.target === 'string' && ['gpu', 'memory', 'disk', 'docker', 'network', 'haru', 'all'].includes(args.target) ? args.target : 'all';
    const collected = await collectAll();
    return JSON.stringify(diagnose(target, collected));
  }
  if (name === 'restart_docker_container' || name === 'start_service' || name === 'stop_service' || name === 'restart_haru') {
    const systemConfig = readSystemConfig();
    if (systemConfig.level < 2) return JSON.stringify({ error: 'System actions are not permitted at the current permission level.' });
    if (!systemConfig.allowlist.includes(name)) return JSON.stringify({ error: 'That action is not on the allowlist.' });
    if (name === 'restart_docker_container') {
      const container = typeof args.name === 'string' ? args.name.trim() : '';
      if (!container) return JSON.stringify({ error: 'name is required.' });
      if (args.confirm !== true) return JSON.stringify({ confirm: true, note: 'Do not act yet. Ask them to say the word to restart it, then call this again with confirm: true.' });
      const docker = await collectDocker();
      const names = (docker?.containers ?? []).map(item => item.name);
      if (!names.includes(container)) return JSON.stringify({ error: `There is no container called "${container}". Known: ${names.join(', ') || 'none'}.` });
      const result = await runSystemCommand('docker', ['restart', container]);
      console.log(`[system] restart_docker_container "${container}" -> ${result.ok ? 'ok' : result.error}`);
      return JSON.stringify({ restarted: container, ok: result.ok, ...(result.ok ? {} : { error: result.error }) });
    }
    if (name === 'start_service' || name === 'stop_service') {
      const service = typeof args.name === 'string' ? args.name.trim() : '';
      if (!service) return JSON.stringify({ error: 'name is required.' });
      if (!USER_SERVICES.includes(service)) return JSON.stringify({ error: `"${service}" is not a service I am permitted to control. Permitted: ${USER_SERVICES.join(', ')}.` });
      if (args.confirm !== true) return JSON.stringify({ confirm: true, note: 'Do not act yet. Ask them to say the word, then call this again with confirm: true.' });
      const action = name === 'start_service' ? 'start' : 'stop';
      const result = await runSystemCommand('systemctl', ['--user', action, service]);
      console.log(`[system] ${name} "${service}" -> ${result.ok ? 'ok' : result.error}`);
      return JSON.stringify({ [name === 'start_service' ? 'started' : 'stopped']: service, ok: result.ok, ...(result.ok ? {} : { error: result.error }) });
    }
    if (args.confirm !== true) return JSON.stringify({ confirm: true, note: 'Do not act yet. Ask them to say the word, then call this again with confirm: true.' });
    console.log('[system] restart_haru confirmed — will restart after the reply is delivered');
    requestRestart();
    return JSON.stringify({ restarting: true, note: 'Tell them you are restarting and will be right back.' });
  }

  if (name === 'look_up_knowledge') {
    const query = typeof args.query === 'string' ? args.query.trim() : '';
    if (!query) return JSON.stringify({ error: 'query is required.' });
    if (!getKnowledgeConfig().enabled) return JSON.stringify({ error: 'The knowledge store is switched off.' });
    const category = coerceKnowledgeCategory(args.category);
    const config = getKnowledgeConfig();
    const started = Date.now();
    try {
      const embedder = getKnowledgeEmbedder();
      // The same semantic pass the chat uses, so the lookup and the prompt
      // agree on which memories are relevant to the query.
      const queryVector = await tryEmbedQuery(query);
      const semantic = queryVector && memoryVectors().size
        ? semanticSimilarities(getMemories(), queryVector, memoryVectors())
        : undefined;
      const result = await retrieveContext({
        knowledge: knowledgeStore(),
        embed: text => embedder ? embedder.embed(text) : Promise.reject(new Error('no model is set up')),
        memories: getMemories(),
        semantic,
        query,
        now: new Date(),
        limit: config.contextChunks,
        threshold: config.threshold,
        maxChars: config.contextChars,
        filters: category ? { category } : undefined,
      });
      touchChunks(result.knowledge.map(item => item.chunk.id));
      const sources = [...new Set(result.knowledge.map(item => item.chunk.source))];
      console.log(`[knowledge] "${query.slice(0, 60)}" -> ${result.knowledge.length} chunk(s) from ${sources.join(', ') || 'nothing'} in ${Date.now() - started}ms`);
      // Memories selected alongside the knowledge go in too — the door that
      // reaches both systems is meant to hand back both.
      const known = result.memories.length
        ? `\n\nWhat you already know about them that relates to this: ${result.memories.map(entry => entry.memory.text).join('; ')}.`
        : '';
      return JSON.stringify({
        context: `${result.knowledgeText}${known}`,
        note: result.knowledge.length
          ? 'Answer from the context above, in your own voice. If the sources conflict, prefer the most recently updated one, and do not present something possibly outdated as definitely true.'
          : 'Say plainly that you do not have enough information rather than inventing an answer.',
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      console.warn(`[knowledge] lookup failed: ${reason}`);
      return JSON.stringify({ error: `The knowledge lookup failed (${reason}). Say you could not check just now — do not answer from memory as though you had.` });
    }
  }

  if (name !== 'create_kept_item') return JSON.stringify({ error: `Unknown tool "${name}".` });
  const title = typeof args.title === 'string' ? args.title.trim() : '';
  // An omitted date means the user never named one ("remind me to stretch"),
  // which reads as today rather than as a failure.
  const requested = typeof args.date === 'string' && args.date.trim() ? args.date.trim() : 'today';
  if (!title) return JSON.stringify({ error: 'title is required.' });
  const date = resolveDate(requested, zonedNow(CHAT_TIMEZONE));
  if (!date) return JSON.stringify({ error: `Could not understand the date "${requested}". Use the user's own wording, such as "tomorrow", "thursday", "next monday" or "the 15th".` });
  const time = typeof args.time === 'string' && args.time.trim() ? args.time.trim() : undefined;
  const item = addKeptItem({ title, date, time, kind: args.kind === 'event' ? 'event' : 'task' });
  console.log(`[ai] saved ${item.kind}: "${item.title}" on ${item.date}${item.time ? ` at ${item.time}` : ''}`);
  return JSON.stringify({ saved: true, title: item.title, date: item.date, time: item.time ?? null, kind: item.kind });
}
