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
import { mkdirSync, writeFileSync } from 'node:fs';
import type { ChatTool, ToolCall } from './provider';
import { addCheckIn, checkInsOn, type CheckInStore } from './checkins';
import { CHOICES_TOOL, readChoices } from './choices';
import { readJournalConfig, SCALE_MAX, type JournalEntry } from './journal';
import { formatMedia, formatMissing, lookUp, readAniListConfig, type MediaKind } from './anilist';
import { convertImage, FORMATS, normaliseFormat } from './convert';
import { cancelPower, closeApp, desktopSupported, findApps, isCancellable, launch, listRunning, matchApp, matchRunning, normalisePower, POWER_DELAY_S, readDesktopConfig, runPower } from './desktop';
import { formatPage, formatResults, readSearchConfig, readWebPage, SearchBlocked, searchWeb, type SearchConfig, type SearchResult } from './search';
import { fetchTranscript, formatTranscript, titleFrom, transcriptInstruction, videoIdFrom, watchUrl } from './transcripts';
import { findSuperseded, semanticSimilarities, supersede, MEMORY_KINDS, type MemoryKind, type MemoryRecord } from './memory';
import { appendToBlockValue, canEditBlock, findBlock, replaceInBlockValue, resolveBlockValue, withEditedValue, type BlockSources, type MemoryBlock } from './blocks';
import { adopt } from './tastes';
import { activateTab, closeTab, listTargets, navigate, openTab, pageText, screenshot } from './browserctl';
import { findItem, readsAsNotDone } from './agenda';
import { localDateKey, resolveDate, zonedNow } from './dates';
import { collectAll, collectDocker, collectGpu, collectProcesses, collectServices, collectSystem, diagnose, KNOWN_SERVICES, USER_SERVICES } from './system';
import { retrieveContext } from './retrieveContext';
import { KNOWLEDGE_CATEGORIES, type KnowledgeCategory, type KnowledgeStore } from './knowledge';
import { localEmotion } from './emotion';
import { readTone } from './tone';

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

export const WARDROBE_TOOL: ChatTool = {
  type: 'function',
  function: {
    name: 'show_wardrobe',
    description: 'Open the wardrobe panel so the user can see and change how you look — colours, hair, accessories. Call it whenever they ask you to change how you look. It only shows the options; nothing changes until they pick.',
    parameters: { type: 'object', properties: {}, required: [] },
  },
};

export const CHAT_TOOLS: ChatTool[] = [{
  type: 'function',
  function: {
    name: 'create_kept_item',
    description: "Save a reminder or appointment to the user's calendar. Call this whenever they ask to be reminded of something or mention an appointment — writing it in your reply does not save anything.",
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
    description: "Tick a task off the user's list once they say they have done it, so you stop asking. Only tasks — an event happens whether or not they attend.",
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Roughly what it was — e.g. "milk" or "the washing". A few words, never their whole message.' },
        undo: { type: 'boolean', description: 'Set true if they say it is not done after all, correcting something previously ticked off. Use this rather than deleting it — it still needs doing.' },
      },
      required: ['title'],
    },
  },
}, {
  type: 'function',
  function: {
    name: 'update_kept_item',
    description: "Change a task or event already on the user's list — its wording, day or time. For something moved or reworded, not for adding another one.",
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: "A few words from the item's own title, so it can be found — never the user's whole message." },
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
    description: "Remove a task or event from the list entirely, when they say it is cancelled or no longer needs doing. Never because something is simply not done yet — that still has to be done and stays on the list. Not how you tick off: use complete_kept_item for done.",
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: "A few words from the item's own title, so it can be found — never the user's whole message." },
      },
      required: ['title'],
    },
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
    description: "Save a lasting fact about the user — how they like to be spoken to, what they do, their people, pets and projects — so it is known later. When they tell you to stop doing something, do something differently, or that they like or hate how you behave, that is a preference: save it AND reply to it. Only when it is about you and would still be true tomorrow — grumbling about a slow build, a bad day or other people is passing irritation, not a preference. One-off logistics go in create_kept_item.",
    parameters: {
      type: 'object',
      properties: {
        // "I got a new dog, her name is Miso" was saved as the single word
        // "Miso" — true, useless, and unreadable a month later when nothing
        // says what a Miso is. And with the user's own pronoun unknown it was
        // guessed, the same person coming out "her girlfriend" in one record
        // and "his business partner" in the next.
        fact: { type: 'string', description: 'One short statement that will still make sense alone months from now, with no pronoun for the user: "Has a dog called Miso", not "Miso" and not "his dog". Other people keep their names — "Emma is their girlfriend". Only what they actually said.' },
        kind: { type: 'string', enum: [...MEMORY_KINDS], description: 'Exactly one: "preference" for how they want you to behave, "relationship" for a person or pet, "event" for something happening in their life, "fact" for anything else including habits.' },
        subject: { type: 'string', description: 'Who or what it concerns — a person, pet or project.' },
        predicate: { type: 'string', description: 'Optional: the relation, for relational facts — "has", "lives in", "works on", "created". Only for subject–relation–object facts.' },
        object: { type: 'string', description: 'Optional: what the subject relates to — "Miso", "Perth". Only alongside predicate.' },
        replaces: { type: 'string', description: 'Only if this makes an earlier fact wrong — name what changed using a word drawn from what you already knew: "Ubuntu", not "the old OS". Omit for anything new.' },
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
    description: "Append a line to a memory block, like writing into your own working memory. It is validated: a lasting fact about the user — not venting, small talk or true only of this moment — and not a duplicate; the block has a character limit. Recorded through the memory engine, not shown instantly. Prefer this over remember_about_user when updating a block as a whole. The persona block is read-only.",
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
    description: "Replace a specific piece of a memory block — the correction when something you were told has changed. The old text must appear exactly once in the block; if missing or ambiguous the change is refused. Goes through the same governance, superseding the outdated record. The persona block is read-only.",
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
}, {
  type: 'function',
  function: {
    name: 'core_memory_rethink',
    description: "Rewrite a whole memory block with a tighter, consolidated version — when a block has grown long and you can say the same thing in less, or it needs reorganising. It replaces the block's entire contents, so it is for reorganising, not small edits (use core_memory_replace for one line, core_memory_append to add one). The rewrite goes through the same memory governance as everything else, and the lines it replaces are marked outdated rather than lingering. The persona block is read-only.",
    parameters: {
      type: 'object',
      properties: {
        label: { type: 'string', description: 'The block to rewrite: human, preferences, relationship, current_project or working_state.' },
        new_value: { type: 'string', description: 'Everything the block should now say, compactly — with no pronoun for the user where it is about them, so each line still makes sense on its own.' },
      },
      required: ['label', 'new_value'],
    },
  },
}, {
  type: 'function',
  function: {
    name: 'adopt_interest',
    description: 'Take up an anime or game they told you about as one of your own interests, when it sounds like your thing. It becomes something you read up on and form a real view of over your nights. Refuses what is already yours; anime and games only — not manga, not a book.',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'The title of the show or game, as they called it.' },
        kind: { type: 'string', enum: ['anime', 'game'], description: 'Whether it is an anime or a game.' },
      },
      required: ['title', 'kind'],
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
    description: "Look things up online: current news, prices, results, opening times, release dates, who someone is, anything recent, or how to do something in an app or service (those move; yours are old). Use it whenever you would otherwise be guessing at a fact. Not for the user's own tasks and appointments, anything they told you, or chatting.",
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
    description: 'Search Haru\'s stored knowledge — the user\'s documents, notes, projects, machine and setup — for facts about their world not in your training. Use it for anything about their own stuff, and prefer it over web search for anything local. Results carry their source and date; prefer the most recently updated when they conflict.',
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
      description: 'Facts about the server you run on — OS, hostname, CPU, RAM, disk, network. Use it when they ask anything about the machine itself.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_gpu_info',
      description: 'The NVIDIA GPU — model, VRAM used and total, utilisation, temperature. For VRAM/GPU usage or why the machine is slow at graphics or inference.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_processes',
      description: 'The processes using the most CPU, with percent and memory. For "what is eating my CPU/RAM".',
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
      description: 'Docker and its containers — which are running, their health, CPU and memory. For whether Docker or a container is working.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_service_status',
      description: 'The status of a named service — the user services (haru, gpt-sovits, obsidian, xvfb, x11vnc, haru-asr, haru-discord-bot) and the ollama service. For whether something is running.',
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
      description: 'A verdict on one part of the machine rather than raw numbers: gpu, memory, disk, docker, network, haru, or all. For "is anything wrong" or "how is the machine doing".',
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
      description: 'Restart a Docker container by name (e.g. sonarr, jellyfin, haru-redis). Disruptive — only acts after explicit confirmation.',
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
      description: 'Start a named user service (haru, gpt-sovits, obsidian, xvfb, x11vnc, haru-asr, haru-discord-bot). Disruptive — explicit confirmation required.',
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
      description: 'Stop a named user service (haru, gpt-sovits, obsidian, xvfb, x11vnc, haru-asr, haru-discord-bot). Disruptive — explicit confirmation required.',
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
      description: 'Restart Haru herself. Disruptive — explicit confirmation required.',
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
    description: 'Open one of the pages your last search turned up and read it, when the summaries are not enough — a forecast, price, result, article detail. Prefer the summaries when they already answer; reading a page is slow.',
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
/**
 * The words in a video, when they hand her a link or one turns up in a search.
 *
 * Described as reading rather than watching, in the tool as well as in what
 * comes back, because the description is the first thing the model sees about
 * it and "watch" there would have her saying she watched. Takes a link, not an
 * index, unlike read_web_page: a video is most often something they paste.
 */
export const TRANSCRIPT_TOOL: ChatTool = {
  type: 'function',
  function: {
    name: 'read_video_transcript',
    description: 'Read the transcript of a YouTube video — the words spoken — when they send a link, ask what a video says, or a search result is one. You get the words, not the pictures; you have not seen it.',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'The YouTube link, exactly as they gave it or as it appeared in the search results.' },
      },
      required: ['url'],
    },
  },
};

export const JOURNAL_TOOL: ChatTool = {
  type: 'function',
  function: {
    name: 'save_journal_entry',
    description: "Write today's journal entry when they have told you how their day went or how they feel, after you asked or they offered. Use their words as closely as you can — it is their diary, not your summary of them. Only once they have actually said something; never invent an entry, and not for ordinary chat they did not mean as a journal.",
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
    description: "Write a short check-in when they mention how they are feeling in passing — a rough hour, a spike, something that just happened. Read back at the end of the day to ask about it properly. Not a full-day account — that is save_journal_entry.",
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
    description: 'Look up an anime or manga on AniList — episodes, chapters, makers, dates, whether it has finished, what it is about. Prefer it over a web search for a specific series. Not for what the user is personally watching or reading, which you already know.',
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
    description: 'Convert a picture on the user\'s machine to another format and give back where the new file is. Especially "make this an icon", which produces a real .ico. Renaming does not work; this does. Give them the path it returns.',
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
    description: 'Open a program on the user\'s computer. Call this whenever they ask you to open, launch or start something. You really can — never say you cannot, and never merely say that you have.',
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
    description: 'Close a program that is currently open. Call this whenever they ask you to close, quit or shut something — you can, so never say you cannot and never pretend to have done it. It is asked to close politely, so it can still prompt about unsaved work.',
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
    description: 'Shut down, restart, sleep or lock the computer. Call this whenever they ask you to turn the machine off, restart, sleep or lock it. You really can — so never merely say you are doing it, always call this. Shutdown and restart wait twenty seconds and can be called off with "cancel".',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['shutdown', 'restart', 'sleep', 'lock', 'cancel'], description: 'What to do. Use "cancel" to call off a shutdown or restart that is counting down.' },
      },
      required: ['action'],
    },
  },
};


/**
 * Driving the browser she lives next to. Chrome runs with a debug port; the
 * tool opens, navigates, reads and screenshots the actual pages, so "check
 * this site" is something she does rather than something she pretends to have
 * done. Desk-only, like the other hands-on tools.
 */
export const BROWSER_TOOL: ChatTool = {
  type: 'function',
  function: {
    name: 'browser_control',
    description: 'Drive the browser on this machine — open a page, navigate a tab, list what is open, read what is actually on a page, screenshot it, or close a tab. Use it whenever they ask you to open a website, check a page, look something up in a browser, or want a screenshot of a site. You really can do this — never say you cannot and never pretend you have.',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['open', 'navigate', 'list', 'read', 'screenshot', 'close', 'activate'], description: 'What to do. "list" first to get a tab id; "read" and "screenshot" work on the current page when no tab is given.' },
        url: { type: 'string', description: 'The address to open or navigate to — a full URL, or a name you can search for when opening (e.g. "youtube.com", "the weather in perth").' },
        tab: { type: 'string', description: 'The tab id from a list call. Leave out to act on the current page.' },
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
  /** True while she is answering someone on the web, where the desk tools are off the table. */
  web: boolean;
  search: Pick<SearchConfig, 'enabled' | 'readPages'> & {
    /** The transcript bridge is installed (transcripts.ts). A machine thing, not a preference. */
    transcripts: boolean;
  };
  knowledge: boolean;
  /** Whether she can drive the browser on this machine (browser.control). */
  browser: boolean;
  system: { enabled: boolean; level: number };
  /** False for anything that did not come from the user's own mouth or keyboard. */
  hands: boolean;
  desktop: { launch: boolean; power: boolean };
};

/** Whether the message is about the machine or the apps on it. The gate that
 *  keeps the heavy system/desktop tools off turns that have nothing to do with
 *  them — Letta's "attach only what is actively used". Broad on purpose: the
 *  cost of a miss is "I cannot check that", so the tools are only dropped when
 *  the message is clearly about something else. */
const MACHINE_TALK = /\b(?:gpu|vram|graphics|video card|memory|ram|disk|drive|storage|cpu|processor|server|host|docker|container|service|process|daemon|diagnos\w*|system|network|uptime|temperature|fan|performance|slow|status|running|hardware|machine|computer|pc|laptop)\b/i;
const APP_TALK = /\b(?:open|launch|start|close|quit|shut ?down|shutdown|restart|reboot|sleep|lock|power|convert|icon|picture|app|program|application|window)\b/i;

export function machineRelevant(message: string): boolean {
  return MACHINE_TALK.test(message ?? '') || APP_TALK.test(message ?? '');
}

export function chatTools(available: ToolAvailability, latest = ''): ChatTool[] {
  const tools: ChatTool[] = [...CHAT_TOOLS];
  // The machine and app tools are only worth a place on the table when the
  // message has anything to do with them; an empty `latest` (tests, or no user
  // turn yet) offers everything, the safe default.
  const machine = !latest || machineRelevant(latest);
  // The wardrobe is a window on the desk. There is nothing for her to open on
  // the phone, and a panel popping up on the desk mid-web-chat is a surprise
  // nobody there asked for.
  if (!available.web) tools.push(WARDROBE_TOOL);
  // Only where there is a box to draw them in. Offered at the desk she would
  // call it and nothing would appear, which is a worse failure than not having
  // it: she would think she had asked and be met with silence.
  if (available.choices && !available.web) tools.push(CHOICES_TOOL);
  if (available.journal) tools.push(JOURNAL_TOOL);
  // Always offered, journal or not: a check-in is a note about a moment, and
  // the moments worth noting happen whether or not anyone keeps a diary.
  tools.push(CHECKIN_TOOL);
  if (available.anilist && !available.web) tools.push(ANILIST_TOOL);
  if (available.search.enabled) {
    tools.push(SEARCH_TOOL);
    if (available.search.readPages) tools.push(READ_PAGE_TOOL);
    if (available.search.readPages && available.search.transcripts) tools.push(TRANSCRIPT_TOOL);
  }
  if (available.knowledge) tools.push(KNOWLEDGE_TOOL);
  if (available.system.enabled && machine) {
    tools.push(...SYSTEM_TOOLS);
    if (available.system.level >= 2) tools.push(...SYSTEM_ACTION_TOOLS);
  }
  if (machine) tools.push(CONVERT_TOOL);
  // `available.desktop` is already the platform's answer as well as the user's
  // — see supportedDesktop, applied where the availability is assembled. She is
  // told emphatically in both descriptions that she really can do this and must
  // never claim otherwise, which is right on Windows and a trap anywhere else.
  if (available.hands && available.desktop.launch && machine) tools.push(LAUNCH_TOOL, CLOSE_TOOL);
  if (available.hands && available.desktop.power && machine) tools.push(POWER_TOOL);
  if (available.browser && available.hands) tools.push(BROWSER_TOOL);
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
  addMemory(text: string, kind: MemoryKind, subject?: string, options?: { source?: string; predicate?: string; object?: string; emotion?: string; emotionIntensity?: number }): { record: MemoryRecord | null; created: boolean } | null;
  setBlocks(blocks: MemoryBlock[]): void;
  blockSources(query: string): BlockSources;
  getWardrobeControls(): { name: string }[];
  sendToWindows(channel: string, payload?: unknown): void;
  getInterests(): { id: string; kind: 'game' | 'anime'; name: string; because: string; since: string; nights: number; lastAt: string; stance: string }[];
  setInterests(interests: unknown[]): void;
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
  /** True while she is answering on the web; the desk-only tools refuse then. */
  onWeb(): boolean;
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
  /** The CDP port of the browser she controls (browser.control). */
  browserPort(): number;
  /** Where a browser screenshot lands — the screenshots folder or a fallback. */
  browserShotDir(): string;
};


/**
 * What to tell the model when a title matched nothing. The list itself rides
 * along because the model gets another round: pasting the user's whole sentence
 * as a title is its commonest miss — seen live with "Its not till later today
 * @5pm" handed over verbatim — and with the real titles in hand it can call
 * again with the right one instead of reading an error back out loud.
 */
function nothingMatched(title: string, candidates: { title: string }[]): string {
  const listed = candidates.slice(0, 8).map(item => `"${item.title}"`).join(', ');
  return JSON.stringify({
    saved: false,
    reason: listed
      ? `Nothing on the list matches "${title}". The list has: ${listed}. If they mean one of those, call this again with that item's own title. If not, ask which one they mean — in your own voice. Never read this message back to them.`
      : `Their list is empty — there is nothing to change. Say so in your own voice rather than reading this back.`,
  });
}

export async function runChatTool(call: ToolCall, latestUserMessage: string, deps: ToolDeps): Promise<string> {
  // Destructured under the names the body already used, so what moved here is
  // the same code and not a rewrite of it.
  const {
    CHAT_TIMEZONE, net, store, getCheckIns, setCheckIns, getJournal, writeJournal, noteJournalAsked,
    getKept, addKeptItem, toggleKept, removeKept, updateKept, getMemories, setMemories, addMemory,
    setBlocks, blockSources, getWardrobeControls, sendToWindows, readSystemConfig, getKnowledgeConfig,
    getKnowledgeEmbedder, knowledgeStore, tryEmbedQuery, memoryVectors, touchChunks, getSearchKey,
    handsAllowed, markPageRead, setPendingChoices, requestRestart, lastResults, lastSearchQuery,
    rememberSearch, runSystemCommand, onWeb, getInterests, setInterests, browserPort, browserShotDir,
  } = deps;
  const name = call.function?.name;
  const args = toolArguments(call);
  // Re-checked here, not only where the table is laid. A model can name a tool
  // it was never offered, and these three are the ones that open a window or a
  // box nobody on the phone can see.
  if (onWeb() && (name === 'show_wardrobe' || name === 'look_up_anime' || name === 'offer_choices')) {
    return JSON.stringify({ error: 'Not on the phone — that is for the desk. Say you cannot do that here.' });
  }
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
    if (!desktopSupported()) return JSON.stringify({ error: 'I cannot open programs on this machine — that only works on Windows. Say so plainly.' });
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
    if (!desktopSupported()) return JSON.stringify({ error: 'I cannot close programs on this machine — that only works on Windows. Say so plainly.' });
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
    if (!desktopSupported()) return JSON.stringify({ error: 'I cannot power this machine — that only works on Windows. Say so plainly.' });
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
  if (name === 'read_video_transcript') {
    const config = readSearchConfig(store.get('search'));
    if (!config.enabled || !config.readPages) return JSON.stringify({ error: 'Opening pages is switched off.' });
    const link = String((args as { url?: unknown }).url ?? '');
    const videoId = videoIdFrom(link);
    if (!videoId) return JSON.stringify({ error: 'That is not a YouTube video link. Only YouTube is supported, and only a link to one video.' });
    try {
      const [transcript, title] = await Promise.all([
        fetchTranscript(videoId),
        net.fetch(watchUrl(videoId), { headers: { 'accept-language': 'en' } }).then(r => r.text()).then(titleFrom).catch(() => ''),
      ]);
      const words = formatTranscript(transcript.captions);
      // The id, never the title: the log outlives the moment, and a list of
      // what was watched is a viewing history by another name.
      console.log(`[transcript] read ${videoId} (${transcript.language}${transcript.generated ? ', auto' : ''}) -> ${words.length} chars`);
      markPageRead();
      return transcriptInstruction(title || 'that video', transcript.generated, words);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      console.warn(`[transcript] could not read ${videoId}: ${reason}`);
      return `The transcript could not be read: ${reason} Say so. Do not describe the video from its title or from memory as though you had read it.`;
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
  if (name === 'adopt_interest') {
    const title = typeof args.title === 'string' ? args.title.trim() : '';
    const kind = args.kind === 'anime' || args.kind === 'game' ? args.kind : undefined;
    if (!title || !kind) return JSON.stringify({ error: 'title and kind (anime or game) are required.' });
    const interests = getInterests();
    if (interests.some(interest => interest.name.toLowerCase() === title.toLowerCase())) return JSON.stringify({ error: 'That is already one of yours.' });
    const now = zonedNow(CHAT_TIMEZONE);
    setInterests(adopt(interests, { kind, name: title, because: 'they told you about it, and it sounded like your thing. You are going to give it a shot.' }, localDateKey(now), now.toISOString()));
    console.log(`[taste] ${kind} "${title}" taken up because they told you about it`);
    return JSON.stringify({ saved: true, note: `Taken up: ${title}. You will read up on it and have a real view of it over your nights.` });
  }
  if (name === 'browser_control') {
    const action = typeof args.action === 'string' ? args.action : '';
    const url = typeof args.url === 'string' ? args.url.trim() : '';
    const tab = typeof args.tab === 'string' ? args.tab.trim() : '';
    const port = browserPort();
    const fetchImpl = deps.net.fetch as (url: string, init?: unknown) => Promise<{ ok: boolean; json(): Promise<unknown> }>;
    const currentTab = async (): Promise<string | null> => {
      if (tab) return tab;
      const targets = await listTargets(port, fetchImpl);
      return targets[0]?.id ?? null;
    };
    try {
      if (action === 'list') {
        const targets = await listTargets(port, fetchImpl);
        if (!targets.length) return JSON.stringify({ tabs: [], note: 'No tabs are open.' });
        return JSON.stringify({ tabs: targets.slice(0, 20).map(target => ({ id: target.id, title: target.title || '(untitled)', url: target.url })) });
      }
      if (action === 'open') {
        if (!url) return JSON.stringify({ error: 'url is required to open a page.' });
        const id = await openTab(port, url, fetchImpl);
        console.log(`[browser] opened ${url} (${id})`);
        return JSON.stringify({ opened: true, tab: id, note: `Opened ${url}.` });
      }
      if (action === 'navigate') {
        if (!url) return JSON.stringify({ error: 'url is required to navigate.' });
        const id = await currentTab();
        if (!id) return JSON.stringify({ error: 'no tab to navigate — open one first.' });
        await navigate(port, id, url, fetchImpl);
        console.log(`[browser] navigated ${id} to ${url}`);
        return JSON.stringify({ navigated: true, note: `Navigated to ${url}.` });
      }
      if (action === 'read') {
        const id = await currentTab();
        if (!id) return JSON.stringify({ error: 'no tab to read.' });
        const text = await pageText(port, id, fetchImpl);
        return JSON.stringify({ text: text.slice(0, 3000), note: 'This is what is on the page right now — answer from it, not from memory.' });
      }
      if (action === 'screenshot') {
        const id = await currentTab();
        if (!id) return JSON.stringify({ error: 'no tab to screenshot.' });
        const png = await screenshot(port, id, fetchImpl);
        if (!png) return JSON.stringify({ error: 'the screenshot came back empty.' });
        const dir = browserShotDir();
        mkdirSync(dir, { recursive: true });
        const name = `browser-${Date.now().toString(36)}.png`;
        writeFileSync(path.join(dir, name), Buffer.from(png));
        console.log(`[browser] screenshotted the page to ${path.join(dir, name)}`);
        return JSON.stringify({ saved: path.join(dir, name), note: 'Saved a screenshot of the page.' });
      }
      if (action === 'close') {
        const id = await currentTab();
        if (!id) return JSON.stringify({ error: 'no tab to close.' });
        await closeTab(port, id, fetchImpl);
        console.log(`[browser] closed ${id}`);
        return JSON.stringify({ closed: true, note: 'Closed the tab.' });
      }
      if (action === 'activate') {
        const id = await currentTab();
        if (!id) return JSON.stringify({ error: 'no tab to activate.' });
        await activateTab(port, id, fetchImpl);
        return JSON.stringify({ activated: true });
      }
      return JSON.stringify({ error: 'Unknown action — use open, navigate, list, read, screenshot, close or activate.' });
    } catch (error) {
      console.warn('[browser] could not control the browser:', error instanceof Error ? error.message : error);
      return JSON.stringify({ error: `The browser is not reachable (${error instanceof Error ? error.message : error}). Say so plainly rather than pretending you looked.` });
    }
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
    // The mood of what they said, stamped on the memory so retrieval can favour
    // it when the same mood comes round again — the moment matters as much as
    // the fact. Their own words carry it; the fact text stands in when there is
    // nothing of theirs to read.
    const told = latestUserMessage || fact;
    const saved = addMemory(fact, kind, subject, {
      source: 'explicit', predicate, object,
      emotion: localEmotion(told),
      emotionIntensity: readTone(told).heat,
    });
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
  if (name === 'core_memory_rethink') {
    // Whole-block consolidation, governed: the rewrite is proposed through the
    // memory engine (so it has to be a real, lasting fact), and the lines it
    // replaces are marked superseded rather than left to linger beside it. The
    // block itself stays derived — it keeps tracking live memory — so a rethink
    // is a consolidation of what the engine knows, not a freeze of the view.
    const label = typeof args.label === 'string' ? args.label.trim() : '';
    const newValue = typeof args.new_value === 'string' ? args.new_value.trim() : '';
    const blocks = store.getBlocks();
    const block = findBlock(blocks, label);
    if (!block) return JSON.stringify({ error: `There is no memory block called "${label}". The blocks are human, preferences, relationship, current_project and working_state.` });
    if (!canEditBlock(blocks, label)) return JSON.stringify({ error: `The "${label}" block is read-only — it is fixed by the user's configuration and cannot be changed through memory tools.` });
    if (!newValue) return JSON.stringify({ error: 'new_value is required.' });
    if (newValue.length > block.limit) return JSON.stringify({ error: `That would exceed the ${block.limit}-character limit for the block.` });
    const saved = addMemory(newValue, kindForBlock(label), undefined, { source: 'inferred' });
    if (!saved?.record) {
      return JSON.stringify({ saved: false, reason: 'Not recorded — that reads as either about this moment only or true of anyone. Keep things that would still matter to them in a month.' });
    }
    const current = resolveBlockValue(block, blockSources(''));
    const outdated = current.split('\n')
      .map(line => line.replace(/^-\s*/, '').trim())
      .filter(line => line.length >= 12)
      .map(line => findSuperseded(getMemories(), line))
      .filter((record): record is NonNullable<typeof record> => Boolean(record));
    if (outdated.length && saved.record) {
      let next = getMemories();
      for (const record of outdated) next = supersede(next, record.id, saved.record.id);
      setMemories(next);
      console.log(`[memory] rethink superseded ${outdated.length} line(s) of ${label}`);
    }
    console.log(`[blocks] rethink ${label}: ${current.length} chars → ${newValue.length} chars`);
    return JSON.stringify({ saved: true, superseded: outdated.length, note: `Rewrote the ${label} block. The lines it replaced are superseded; the block keeps its usual shape.` });
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
    const candidates = kept.filter(item => item.done === undo);
    const match = findItem(candidates, title);
    if (!match) return nothingMatched(title, candidates);
    toggleKept(match.id, !undo);
    console.log(`[ai] ${undo ? 'un-ticked' : 'ticked off'}: "${match.title}"`);
    return JSON.stringify({ saved: true, title: match.title, date: match.date, done: !undo });
  }
  if (name === 'update_kept_item' || name === 'delete_kept_item') {
    const title = typeof args.title === 'string' ? args.title.trim() : '';
    if (!title) return JSON.stringify({ error: 'title is required.' });
    const match = findItem(getKept(), title);
    if (!match) return nothingMatched(title, getKept());
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
