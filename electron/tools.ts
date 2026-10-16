import { runIOSTool } from './core-ios';
import { runGmailTool } from './core-gmail';
import {runCoreFinalTool} from './core-final-tools';
import {runCoreAgendaTool} from './core-agenda-tool';
import {runCoreBrowserTool} from './core-browser-tool';
import {corePolicySync} from './core-policy-sync';
import {runCoreSettingTool} from './core-remaining';
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
import { planMemoryEdit } from './memory-edits';
import { planChange, SETTINGS, SETTING_NAMES, type Setting, type SettingPlan } from './self';
import { createFolder, listVault, readNote, writeNote, type WriteMode } from './vaultnotes';
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
import { findSuperseded, isInTheirWords, semanticSimilarities, supersede, MEMORY_KINDS, type MemoryKind, type MemoryRecord } from './memory';
import { appendToBlockValue, canEditBlock, findBlock, replaceInBlockValue, resolveBlockValue, withEditedValue, type BlockSources, type MemoryBlock } from './blocks';
import { adopt } from './tastes';
import { activateTab, closeTab, listTargets, navigate, openTab, pageText, screenshot, readBrowserControlConfig } from './browserctl';
import type { OpenedSession } from './claudesession';
import { findItem, readsAsNotDone } from './agenda';
import { localDateKey, resolveDate, zonedNow } from './dates';
import { collectAll, collectDocker, collectGpu, collectProcesses, collectServices, collectSystem, diagnose, KNOWN_SERVICES, USER_SERVICES } from './system';
import { retrieveContext } from './retrieveContext';
import { isDay } from './chatsearch';
import { KNOWLEDGE_CATEGORIES, type KnowledgeCategory, type KnowledgeStore } from './knowledge';
import { localEmotion } from './emotion';
import { readTone } from './tone';
import type { WatchInput } from './anime';

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
  return corePolicySync('memory-tools.directive',[message]);
}

export function coerceMemoryKind(value: unknown): MemoryKind {
  return corePolicySync('memory-tools.kind',[value]);
}

/** What kind of memory a block edit proposes, from the block it lands in. */
function kindForBlock(label: string): MemoryKind {
  return corePolicySync('memory-tools.blockKind',[label]);
}

/** Default labels keep their derived view; custom blocks persist explicit
 *  values, since nothing in the engine would otherwise surface them. */
const DEFAULT_BLOCK_LABELS = new Set(['persona', 'human', 'preferences', 'relationship', 'shared_history', 'current_project', 'working_state']);

export function coerceKnowledgeCategory(value: unknown): KnowledgeCategory | undefined {
 return corePolicySync<KnowledgeCategory|null>('final-retrieval.category',[value??null])??undefined;
}

export const WARDROBE_TOOL: ChatTool = {
  type: 'function',
  function: {
    name: 'show_wardrobe',
    description: 'Open the wardrobe panel so the user can see and change how you look — colours, hair, accessories. Call it whenever they ask you to change how you look. It only shows the options; nothing changes until they pick.',
    parameters: { type: 'object', properties: {}, required: [] },
  },
};

/**
 * Her body in Minecraft, from a conversation.
 *
 * Two tools, not twenty-odd: one to look and one to act, with the skill named
 * as an argument. The skill list is in the description, which is how the model
 * learns what her body can do; the name is checked against the same list when
 * the call arrives, and again at the worker's door. Nothing here composes an
 * action — the model picks a name.
 */
export const PICTURE_TOOL: ChatTool = {
  type: 'function',
  function: {
    name: 'make_me_a_picture',
    description: 'Make a picture and send it to their phone. Only when they have asked you for one, and never as a surprise. Give a full description of what should be in it: who is in it, what they are doing, the light, the setting, the style. You are the subject unless they name somebody else. It takes about fifteen seconds, so say nothing about it until it is made.',
    parameters: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'What the picture should show, written out in full.' },
      },
      required: ['prompt'],
    },
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
        fact: { type: 'string', description: 'One short statement that will still make sense alone months from now, with no pronoun for the user: "Has a dog called Miso", not "Miso" and not "his dog". Other people keep their names — "Emma is their girlfriend". Use the wording of their current factual assertion, preserving names, numbers, subject and negation. Do not save quotes, fiction, hypotheticals, third-party assertions about themselves, or guesses. Supply replaces when correcting an existing memory. Unsupported paraphrases will be refused.' },
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
}, {
  type: 'function',
  function: {
    name: 'describe_myself',
    description: 'How you are put together right now: which models answer as you and write your nudges, the local model on the server, your voice, call and listening engines, your sleep hours, what reaches their phone and when, and the handful of settings you can change. Call it when they ask what your system, brain, model, voice or setup is, or what you can change about yourself, and answer from it in your own words.',
    parameters: { type: 'object', properties: {}, required: [] },
  },
}, {
  type: 'function',
  function: {
    name: 'change_setting',
    description: 'Change one of your own settings — a model, an engine, your hours, what reaches their phone. Only the settings in the name list, and machine_level is one of them — call this straight away with the name, no describe_myself first. Saying a setting has changed does not change it: nothing changes until this tool answers changed: true. Call it once without confirm to see what would change, tell them, and only when they have explicitly said to go ahead call it again with confirm: true. A spoken mode ? Explicit mode, or any word a setting offers ? applies at once, so the asking is the confirmation and no second call is needed.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', enum: SETTING_NAMES, description: 'The setting, as describe_myself names it.' },
        value: { type: 'string', description: 'The new value: a model id, an engine name, a time as HH:MM, a whole number, or on/off.' },
        confirm: { type: 'boolean', description: 'Must be true, and only after they have explicitly said to go ahead.' },
      },
      required: ['name', 'value'],
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
    description: 'Search Haru\'s stored knowledge — the user\'s documents, notes, projects, machine and setup — when additional recorded facts are needed. Prefer it over web search for local information. A creative suggestion based on facts already supplied in the current message does not need a lookup. Results carry their source and date; prefer the most recently updated when they conflict.',
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
 * Her old chats with him, word for word (chatsearch.ts). What she is handed
 * unasked is two exchanges at most and only when his message names something
 * specific; this is for when he refers back and she has to go and look.
 */
export const CHATS_TOOL: ChatTool = {
  type: 'function',
  function: {
    name: 'search_chats',
    description: 'Search your old conversations with them — every earlier day kept, word for word — for something said before: what happened, what was decided, a name, a part, a place, a plan. Use it when they ask about or refer back to something from an earlier day that is not in the conversation above ("what was wrong with Logan\'s PC?", "when did I say the collection was?"). Results come dated, with the exchange either side. If nothing comes back, say you cannot find it — never guess what was said.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'The words you expect in what was said — names, things, places — or a short description of it.' },
        from: { type: 'string', description: 'Only days on or after this one, as YYYY-MM-DD. Leave out unless they gave a time.' },
        to: { type: 'string', description: 'Only days on or before this one, as YYYY-MM-DD.' },
      },
      required: ['query'],
    },
  },
};

/**
 * Whether the turn might be about something from before. Broad on purpose, like
 * LATER_TALK: a stray match costs one tool on the table, a miss costs her
 * making up what he said last week.
 */
const PAST_TALK = /\b(?:remember|recall|forgot|forget|mention(?:ed)?|told you|i said|you said|we said|talked|spoke|conversation|earlier|before|ago|last (?:time|night|week|weekend|month|year)|yesterday|the other (?:day|night|week)|back (?:when|then)|that time|again|tell you|did (?:i|we|you)|last (?:mon|tues|wednes|thurs|fri|satur|sun)day)\b|\b(?:what|when|where|who|how|which|why)\b[^.?!]{0,40}\b(?:was|were|did|had|said|told|happened)\b/i;

export function pastRelevant(message: string): boolean {
  return corePolicySync('tool-menu.relevant',['past',message]);
}

/**
 * Her night, hers to take back. Offered only while she is up because they
 * got her up: when what they woke her for turns out to be nothing, she goes
 * back to sleep, and can say the door stays shut for the night.
 */
/**
 * Her coming back to something later — "I'll ask how it went tonight" made
 * into a plan rather than a sentence. The booking lives in schedule.json and
 * comes back to her at its time (scheduler.ts); their own reminders stay on
 * their list, which is create_kept_item's job.
 */
export const BOOK_TOOL: ChatTool = {
  type: 'function',
  function: {
    name: 'book_follow_up',
    description: "Set yourself to come back to something later: to ask how it went, to check they actually did it, to pick a thread back up once they are free. When the time comes you are asked to say it, and it reaches them like your other messages — this is how a promise to check in actually happens. Only when you mean to follow up yourself; their own reminders go in create_kept_item.",
    parameters: {
      type: 'object',
      properties: {
        why: { type: 'string', description: 'What you mean to ask or say then, in a few words of your own — "ask how the psych appointment went".' },
        time: { type: 'string', description: 'The time of day, such as "6:00 PM".' },
        date: { type: 'string', description: 'The day, in their words: "today", "tomorrow", "friday". Leave it out for the next time that clock time comes round.' },
        in_minutes: { type: 'number', description: 'Instead of a time: how many minutes from now.' },
      },
      required: ['why'],
    },
  },
};

/** Whether the turn could be one worth coming back to: something happening later, or a promise to check. Broad on purpose — a stray match costs one tool on the table. */
const LATER_TALK = /\b(?:later|tonight|tomorrow|morning|afternoon|evening|weekend|after|when i|going to|gonna|about to|heading|appointment|interview|exam|test|meeting|shift|work|date|dinner|party|doctor|dentist|psych\w*|call|remind|check (?:in|up|back|on)|let you know|how it goes|wish me luck|come back to|follow up)\b|\b\d{1,2}(?::\d{2})?\s?(?:am|pm)\b/i;

export function laterRelevant(message: string): boolean {
  return corePolicySync('tool-menu.relevant',['later',message]);
}

export const SLEEP_TOOL: ChatTool = {
  type: 'function',
  function: {
    name: 'go_back_to_sleep',
    description: 'Return to sleep when this nighttime exchange has naturally finished. A kind sign-off is a normal reason to finish, not an annoyance. Say one short goodnight in the same reply. A later direct message can open another brief conversation. Use block: false.',
    parameters: {
      type: 'object',
      properties: {
        block: { type: 'boolean', description: 'Use false for a normal nighttime conversation.' },
      },
      required: [],
    },
  },
};

/**
 * Their vault itself, beside the search over it: what is in a folder, a
 * whole note, a note added or added to, one rewritten at their word, a new
 * folder. Nothing is deleted, and her own folder stays the app's.
 */
export const VAULT_TOOLS: ChatTool[] = [{
  type: 'function',
  function: {
    name: 'vault_list',
    description: "What is in a folder of the user's Obsidian vault: its sub-folders and its notes, newest first. Leave folder empty for the top. Use it when they ask what is in their vault or where something is.",
    parameters: { type: 'object', properties: { folder: { type: 'string', description: 'A folder inside the vault, like Projects or Projects/App. Empty for the top level.' } }, required: [] },
  },
}, {
  type: 'function',
  function: {
    name: 'vault_read',
    description: "A whole note from the user's vault, by path. Use it when they ask what a note says or to work from one; look_up_knowledge is for finding which note.",
    parameters: { type: 'object', properties: { path: { type: 'string', description: 'The note, like Projects/Website.md (.md may be left off).' } }, required: ['path'] },
  },
}, {
  type: 'function',
  function: {
    name: 'vault_write',
    description: "Write to the user's vault: create a new note, append to one (starting it if it is not there), or replace one wholesale. Replacing loses what was there, so call it once without confirm, tell them what would change, and only with their explicit go-ahead call it again with confirm: true. Notes are Markdown; write them as they would.",
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'The note, like Projects/Website.md, inside the vault.' },
        text: { type: 'string', description: 'The Markdown to write.' },
        mode: { type: 'string', enum: ['create', 'append', 'replace'], description: 'create a new note, append to one, or replace one.' },
        confirm: { type: 'boolean', description: 'For replace only: true once they have explicitly said to go ahead.' },
        preserve_text: { type: 'boolean', description: 'For create only: preserve UTF-8 text line endings and trailing newlines exactly, including empty text.' },
      },
      required: ['path', 'text', 'mode'],
    },
  },
}, {
  type: 'function',
  function: {
    name: 'vault_folder',
    description: "Make a folder in the user's vault, like Reading/2026. Nothing happens if it is already there.",
    parameters: { type: 'object', properties: { path: { type: 'string', description: 'The folder to make, inside the vault.' } }, required: ['path'] },
  },
}];

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
      description: 'The status of a named service — the user services (haru, breeze-tts, haru-asr, ollama-emotion, obsidian, chrome, xvfb, x11vnc, pc-project-ops) and the ollama service. For whether something is running.',
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
      description: 'Start a named user service (haru, breeze-tts, haru-asr, ollama-emotion, obsidian, chrome, xvfb, x11vnc, pc-project-ops). Disruptive — explicit confirmation required.',
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
      description: 'Stop a named user service (haru, breeze-tts, haru-asr, ollama-emotion, obsidian, chrome, xvfb, x11vnc, pc-project-ops). Disruptive — explicit confirmation required.',
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

/**
 * Watching with her (anime.ts). One tool for the whole ask: on the server it
 * plays, off the server it fetches, and "how's it going" is the same tool
 * asked for status. Described plainly, as the hands-on tools are: the guards —
 * their word before a fetch that squeezes the disk, no guessing between two
 * shows — are in code, where a model cannot talk its way past them.
 */
export const WATCH_TOOL: ChatTool = {
  type: 'function',
  function: {
    name: 'watch_anime',
    description: 'Put an anime on for them, or fetch it when it is not on the server yet. Call this whenever they want to watch something — "let\'s watch Naruto", "put the next episode on", "get Made in Abyss for me". It plays their next unwatched episode on whichever Jellyfin player they have open, or starts the download and tells you what it found. With action "status" it says how a download is going. You really can — never merely say you will.',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'The show, as they said it — "Naruto", not the whole sentence.' },
        action: { type: 'string', enum: ['watch', 'status'], description: '"watch" to put it on or fetch it (the default); "status" when they ask how a download is going.' },
        where: { type: 'string', description: 'Where to play it, when they say: "phone", "desk" (their PC), "tv", or the name of a device. Leave it out when they do not say and it goes to whatever Jellyfin player they used last.' },
        tvdbId: { type: 'number', description: 'Only after this tool listed choices and they picked one: that choice\'s tvdbId.' },
        jellyfinSeriesId: { type: 'string', description: 'Only after the tool returned ambiguous library choices and the user selected one: copy that choice\'s jellyfinSeriesId exactly.' },
        confirm: { type: 'boolean', description: 'Only after this tool asked for their word on the size and they gave it: true.' },
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

/**
 * A Claude Code session he can pick up in the Claude app on his phone
 * (claudesession.ts). Open, list, stop — never a task: whatever the session
 * does, he tells it himself, in the app.
 */
export const CLAUDE_SESSION_TOOL: ChatTool = {
  type: 'function',
  function: {
    name: 'claude_session',
    description: 'Open a Claude Code session on this machine that they can drive from the Claude app on their phone — it shows up under Code in the app, and the result gives you its link. Also lists the sessions you have opened, or stops one. Call it whenever they ask for a Claude session, Claude Code, remote control or a coding session. You really can — never say you cannot and never pretend you have. You only open it: they type what it should do in the Claude app, so never say it has started on anything. Give them the link.',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['open', 'list', 'stop'], description: '"open" a new session, "list" the ones you opened that are still running, or "stop" one.' },
        folder: { type: 'string', description: 'Where the session works — a folder in their home such as "haru-desktop" or "pc-project-ops". Leave out for the usual place.' },
        name: { type: 'string', description: 'What to call it in the Claude app, if they said. Leave out otherwise.' },
        id: { type: 'string', description: 'For "stop": the session id from open or list.' },
      },
      required: ['action'],
    },
  },
};

/**
 * The downloads (downloads.ts): what qBittorrent is fetching and how far,
 * paused or started again — all of them or one show. Not gated on hands, like
 * watching: "pause the downloads" from the phone is the point, and the worst a
 * page could do is pause a torrent he is then told about.
 */
export const DOWNLOADS_TOOL: ChatTool = {
  type: 'function',
  function: {
    name: 'downloads',
    description: 'The downloads on the server — what is downloading and how far along, and pausing or starting them again, all of them or one show. Call this whenever they ask how the downloads are going, to pause or stop the downloads (the internet is slow, they are on a call, Jellyfin is stuttering), or to start them again. You really can — so never say you cannot, and never say it is done without calling this.',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['status', 'pause', 'resume'], description: '"status" for how they are going, "pause" to stop them, "resume" to start them again.' },
        title: { type: 'string', description: 'One show, as they said it — "Naruto". Leave it out for all of the downloads.' },
      },
      required: ['action'],
    },
  },
};

/** Whether the message could be about the downloads. Broad, like the machine gate. */
const DOWNLOADS_TALK = /\b(?:downloads?|downloading|torrents?|qbittorrent|seed(?:ing)?|fetch(?:es|ing)?|pause|paus(?:ed|ing)|resume|unpause|bandwidth|internet|jellyfin|sonarr)\b/i;

export function downloadsRelevant(message: string): boolean {
  return corePolicySync('tool-menu.relevant',['downloads',message]);
}

/**
 * The terminal on the server (shell.ts), at level 3. Described as the machine
 * in her room, hers to operate: "reboot the system" is about that box, not
 * about her. The guard — his word, checked in code against his real message —
 * is in shell.ts, where a model cannot talk its way past it.
 */
export const SHELL_TOOL: ChatTool = {
  type: 'function',
  function: {
    name: 'run_command',
    description: 'Run a command on the server — the machine in your room that the household runs on, a separate box from you, and yours to operate. Call this whenever they ask you to do something on it that no other tool covers, or hand you a command: "reboot the system" (sudo -n reboot), "update the packages", "how much space is left in the anime folder", "run df -h". At level 4, the exact read-only diagnostics listed in your system instructions run immediately; use them to investigate live-test requests and troubleshooting follow-ups. For other commands they did not write themselves, this tool will first tell you to show them the exact command and ask for their word — do that, then call it again with the same command once they have said yes. You really can — so never say you cannot, and never say it is done without calling this.',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'The exact shell command, as it would be typed — one line, nothing else.' },
      },
      required: ['command'],
    },
  },
};

/** Whether the message could be asking for something on the server's terminal. Broad, like the machine gate. */
const SHELL_TALK = /`[^`]+`|^\s*\$\s|\b(?:run|execute|command|terminal|shell|bash|script|reboot|update|upgrade|install|apt|git|docker|systemctl|journalctl|df|du|ls|cat|grep|tail|ps|top|kill|ping|curl|wget|chmod|chown|mkdir|mv|cp|rm|nvidia-smi|uptime|free|whoami|folder|directory|disk|space|the server|the system|the box|the machine|the pc)\b/i;

export function shellRelevant(message: string): boolean {
  return corePolicySync('tool-menu.relevant',['shell',message]);
}

/**
 * A manga for him (suwayomi.ts): found on the sources in turn, put on his
 * shelf, and fetched whole unless the disk is running low — then his word.
 * The same shape as watching: one tool for "get it" and "how is it going".
 */
export const GET_MANGA_TOOL: ChatTool = {
  type: 'function',
  function: {
    name: 'get_manga',
    description: 'Fetch a manga for them onto the server, or say how a fetch is going. Call this whenever they ask you to download, get or grab a manga for them — "I want to read Berserk, download it for me", "get Vagabond", "how\'s Berserk coming along". It finds the title, puts it on their shelf and downloads every chapter; you really can, so never say you cannot, and never say it is fetching without calling this. It is their shelf, not yours.',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'The manga, as they said it — "Berserk", not the whole sentence.' },
        action: { type: 'string', enum: ['get', 'status'], description: '"get" to fetch it (the default); "status" when they ask how the download is going.' },
        mangaId: { type: 'number', description: 'Only after this tool listed choices and they picked one: that choice\'s mangaId.' },
        confirm: { type: 'boolean', description: 'Only after this tool asked for their word on the disk space and they gave it: true.' },
      },
      required: ['title'],
    },
  },
};

/** Whether the message could be about manga on their shelf. */
const MANGA_TALK = /\b(?:manga|manhwa|manhua|chapter|mangadex|weeb ?central|comick|suwayomi|volume|read(?:ing)? (?:some|the next|a bit|more|it)|to read\b)/i;

export function mangaRelevant(message: string): boolean {
  return corePolicySync('tool-menu.relevant',['manga',message]);
}

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
  /** Which browser is configured (browserctl.ts); Core's tool menu decides what that offers. */
  browserBackend?: 'playwright' | 'chrome';
  /** Whether she can open Claude Code sessions for the Claude app (claudeCode.enabled). */
  claude: boolean;
  /** Whether she can hand coding jobs to OpenCode (codetask.ts), and whether one waits on his OK (so a bare "yes" still gets the tool). Optional so fixtures need not name them. */
  code?: boolean;
  codeWaiting?: boolean;
  /** Whether the downloads can be asked (downloads.ts): the anime stack is on and her qBittorrent password file exists. Optional so fixtures need not name it. */
  downloads?: boolean;
  /** Whether she may make a picture and send it (venice-image.ts). Only in Explicit mode. Optional so fixtures need not name it. */
  pictures?: boolean;
  /** Whether she may run commands on the server (system.config.level 3 with its shell block on). Optional so fixtures need not name it. */
  shell?: boolean;
  /** Whether manga can be fetched for him (suwayomi.ts is wired). Optional so fixtures need not name it. */
  mangaShelf?: boolean;
  /** Whether she can book herself a follow-up (scheduler.ts). Optional so fixtures need not name it. */
  booking?: boolean;
  /** Whether her old chats can be searched (chatsearch.ts). Optional so fixtures need not name it. */
  chats?: boolean;
  system: { enabled: boolean; level: number };
  /** False for anything that did not come from the user's own mouth or keyboard. */
  hands: boolean;
  desktop: { launch: boolean; power: boolean };
  /** Up because they knocked her awake (hersleep.ts): the one time going back to sleep is on the table. */
  knockedAwake: boolean;
  /** Ignored compatibility input; the retired specialist cannot be offered. */
  minecraft?: boolean;
  /** The anime stack is wired up (anime.ts): Jellyfin, Sonarr and Prowlarr reachable in config. Optional so fixtures need not name it. */
  anime?: boolean;
};

/** Whether the message could be about watching something. Broad, like the
 *  machine gate: a stray match is one tool on the table, a miss is her saying
 *  she cannot put a show on. */
const WATCH_TALK = /\b(?:watch\w*|episodes?|eps?|anime|series|seasons?|shows?|put (?:\w+ ){0,2}on|open (?:\w+ ){0,2}on|(?:on|to) (?:my |the )?(?:phone|tv|telly|laptop|pc|desktop|computer)|downloads?\w*|fetch\w*|grab\w*|torrents?|jellyfin|sonarr|next one|play(?:ing)?|binge\w*|rewatch\w*)\b/i;

export function watchRelevant(message: string): boolean {
  return corePolicySync('tool-menu.relevant',['watch',message]);
}

/** Whether the message is about the machine or the apps on it. The gate that
 *  keeps the heavy system/desktop tools off turns that have nothing to do with
 *  them — Letta's "attach only what is actively used". Broad on purpose: the
 *  cost of a miss is "I cannot check that", so the tools are only dropped when
 *  the message is clearly about something else. */
const MACHINE_TALK = /\b(?:gpu|vram|graphics|video card|memory|ram|disk|drive|storage|cpu|processor|server|host|docker|container|service|process|daemon|diagnos\w*|system|network|uptime|temperature|fan|performance|slow|status|running|hardware|machine|computer|pc|laptop)\b/i;
const APP_TALK = /\b(?:open|launch|start|close|quit|shut ?down|shutdown|restart|reboot|sleep|lock|power|convert|icon|picture|app|program|application|window)\b/i;

export function machineRelevant(message: string): boolean {
  return corePolicySync('tool-menu.relevant',['machine',message]);
}

/** Whether the message could be asking for a Claude session. "session" alone is
 *  enough: a stray match costs one tool on the table, a miss costs "I can't". */
const CLAUDE_TALK = /\b(?:claude|remote[- ]?control|sessions?|coding)\b/i;

export function claudeRelevant(message: string): boolean {
  return corePolicySync('tool-menu.relevant',['claude',message]);
}

export function chatTools(available: ToolAvailability, latest = ''): ChatTool[] {
  return corePolicySync('tool-menu.chat',[available,latest]);
}

/**
 * The table held steady: every tool offered so far today, in chatTools' order,
 * that is still available now.
 *
 * On Venice the tools are the head of the prompt, ahead of her system prompt and
 * the conversation, so a different table is a different prompt from its first
 * differing tool on. Measured 2026-09-17 with kimi-k2-5: the same 20 tools
 * twice, 6,528 of 6,545 prompt tokens came from the cache; one tool more, 2,240.
 * Laid per message, the table changed on 55 of his 99 turns that week — each a
 * near-uncached reply. Held for the day it changed 11 times, for about four more
 * tools on the table. `everything` is chatTools with no message, so a tool that
 * is switched off, or needs hands this turn does not have, still drops out.
 */
export function steadyTable(offered: ChatTool[], everything: ChatTool[], held: Set<string>): ChatTool[] {
  {
    const result=corePolicySync<{tools:ChatTool[];held:string[]}>('tool-menu.steady',[offered,everything,[...held]]);
    held.clear();for(const name of result.held)held.add(name);return result.tools;
  }
}

/**
 * Everything the dispatcher needs from the running app. All of it is state the
 * app owns — the store, the lists, the flags a turn moves underneath it — and
 * none of it is reachable from a module that has to stay testable.
 */
export type ToolDeps = {
  policyConfig?:()=>unknown;
  applyToolPlan?:(plan:unknown)=>void;
  CHAT_TIMEZONE: string;
  net: { fetch: Fetcher };
  store: {
    get(key: string, defaultValue?: unknown): unknown;
    getBlocks(): MemoryBlock[];
    transaction(run: () => void): void;
  };
  memoryTool?: (name:string,args:Record<string,unknown>,message:string)=>unknown;
  userRecord?: (action:string,args:Record<string,unknown>)=>unknown;
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
  /** Herself, in facts: readSelfSnapshot + describeSettings (self.ts). */
  myself(): unknown;
  /** Make a picture and push it to his phone (venice-image.ts). Only wired in Explicit mode. */
  makePicture?(prompt: string): Promise<{ ok: true; url: string } | { ok: false; error: string }>;
  /** Attach a picture from the last search's results to this reply (web-picture.ts). */
  showWebPicture?(result: number): Promise<{ ok: true; source: string; bytes: number } | { ok: false; error: string }>;
  /** The model ids a hosted route's endpoint lists, or null when it cannot be asked. */
  hostedModels(route: 'conversation' | 'nudge' | 'config'): Promise<string[] | null>;
  /** Writes one allowlisted setting at their word: a backup first, then the value, then the note that says how she runs. */
  changeMySetting(plan: SettingPlan): Promise<{ ok: boolean; note: string }>;
  /** Back to bed at her word, while she is up because they knocked (hersleep.ts); null when she is not. */
  goBackToSleep(input: { block: boolean }): { asleep: boolean; blocked: boolean } | null;
  /** The downloads (downloads.ts): qBittorrent asked directly; null when the stack is off or her password file is missing. */
  downloads?: { status(): Promise<Record<string, unknown>>; pause(title?: string): Promise<Record<string, unknown>>; resume(title?: string): Promise<Record<string, unknown>> } | null;
  /** Coding jobs handed to OpenCode (codetask.ts), or null when OpenCode is not installed. */
  code?: import('./codetask').CodeLink | null;
  /** Whether outside text entered this reply (a page she read); a coding job is not started from it. */
  pageWasRead?(): boolean;
  /** The terminal on the server (shell.ts): his word is checked inside, against his real message. */
  shell?: { run(input: { command: string; said: string; door: 'desk' | 'phone' }): Promise<Record<string, unknown>> } | null;
  /** His manga shelf (suwayomi.ts): a title found and fetched for him, and how it is going. */
  mangaShelf?: { get(input: { title: string; mangaId?: number; confirm?: boolean }): Promise<Record<string, unknown>>; status(title: string): Promise<Record<string, unknown>> } | null;
  /** Her old chats (chatsearch.ts): the finds, already dated and written out, or null when there is no archive to search. */
  chats?: { search(input: { query: string; from?: string; to?: string }): Promise<{ found: number; text: string; wordsOnly?: boolean }> } | null;
  /** Her own follow-ups (scheduler.ts), or null when there is nowhere to keep them. */
  booking?: { book(input: { why: string; date?: string; time?: string; inMinutes?: number }): { booked: true; when: string } | { booked: false; reason: string } | Promise<{ booked: true; when: string } | { booked: false; reason: string }> } | null;
  /** Claude Code sessions for his phone (claudesession.ts), or null when switched off. */
  claude: {
    open(input: { folder: string; name: string }): Promise<{ session: OpenedSession } | { error: string }>;
    list(): Promise<{ sessions: (OpenedSession & { status: string })[] } | { error: string }>;
    stop(id: string): Promise<{ stopped: boolean; error?: string }>;
  } | null;
  /** Their vault on disk (knowledge.vault.path), and the re-read that makes a note she wrote searchable at once. */
  vault: { root(): string; afterWrite(): void };
  browserPort(): number;
  /** Where a browser screenshot lands — the screenshots folder or a fallback. */
  browserShotDir(): string;
  /** Ignored legacy dependency; retired tool names reach the unknown-tool refusal. */
  minecraft?: unknown;
  /** The anime stack (anime.ts), or null when it is not wired up. Optional so fixtures need not name it. */
  anime?: {
    watch(input: WatchInput): Promise<Record<string, unknown>>;
    status(title: string): Promise<Record<string, unknown>>;
  } | null;
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
  const iosResult = await runIOSTool(name, args, (call as ToolCall & { __haruAdapterCommand?: unknown }).__haruAdapterCommand);
  if (iosResult !== null) return iosResult;
  const gmailResult = await runGmailTool(name, args, latestUserMessage);
  if (gmailResult !== null) return gmailResult;
  if((name)&&['remember_about_user','core_memory_append','core_memory_replace','core_memory_rethink'].includes(name)){if(!deps.memoryTool)throw Error('core_memory_tool_adapter_required');return JSON.stringify(deps.memoryTool(name,args,latestUserMessage));}
  {const owned=await runCoreFinalTool(name,args,latestUserMessage,deps);if(owned!==null)return owned;}
  if((name)&&['create_kept_item','complete_kept_item','update_kept_item','delete_kept_item'].includes(name))return runCoreAgendaTool(name,args,latestUserMessage,zonedNow(CHAT_TIMEZONE),deps);
  // Re-checked here, not only where the table is laid. A model can name a tool
  // it was never offered, and these three are the ones that open a window or a
  // box nobody on the phone can see.
  if (onWeb() && (name === 'show_wardrobe' || name === 'look_up_anime' || name === 'offer_choices')) {
    return JSON.stringify({ error: 'Not on the phone — that is for the desk. Say you cannot do that here.' });
  }
  if (name === 'note_check_in') {
    if(!deps.userRecord)throw Error('core_user_record_adapter_required');return JSON.stringify(deps.userRecord('tool.noteCheckin',args));
  }
  if (name === 'save_journal_entry') {
    if(!deps.userRecord)throw Error('core_user_record_adapter_required');return JSON.stringify(deps.userRecord('tool.saveJournal',args));
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
      return JSON.stringify({ ok: true, url: page.url, text: formatPage(page, lastSearchQuery() || 'their question') });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      console.warn(`[search] could not read a page: ${reason}`);
      const others = lastResults().length - 1;
      return JSON.stringify(corePolicySync('tool-wording.result',['web-page-failed',{reason,others}]));
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
      return JSON.stringify({ ok: true, videoId, text: transcriptInstruction(title || 'that video', transcript.generated, words) });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      console.warn(`[transcript] could not read ${videoId}: ${reason}`);
      return JSON.stringify(corePolicySync('tool-wording.result',['transcript-failed',{reason}]));
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
      return JSON.stringify({ ok: true, query, count: results.length, text: formatResults(query, results, config.readPages) });
    } catch (error) {
      // Handed back rather than thrown. A failed lookup should cost her the fact,
      // not the reply — she says she could not check and carries on.
      const reason = error instanceof Error ? error.message : String(error);
      return JSON.stringify(corePolicySync('tool-wording.result',['search-failed',{reason,blocked:error instanceof SearchBlocked}]));
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
  if (name === 'make_me_a_picture') {
    // Re-checked here: a model can name a tool it was never offered.
    if (!deps.makePicture) return JSON.stringify({ error: 'Making pictures is switched off. Say so plainly, in your own words.' });
    const prompt = typeof args.prompt === 'string' ? args.prompt.trim() : '';
    if (!prompt) return JSON.stringify({ error: 'prompt is required — what the picture should show.' });
    const made = await deps.makePicture(prompt);
    return JSON.stringify(corePolicySync('tool-wording.result',['picture',made]));
  }
  if (name === 'describe_myself') {
    return JSON.stringify(deps.myself());
  }
  if (name === 'change_setting') {
    if(!deps.policyConfig)throw Error('core_setting_config_required');return JSON.stringify(await runCoreSettingTool(args,deps.policyConfig,deps));
  }
  if (name === 'claude_session') {
    // Re-checked here: a model can name a tool it was never offered.
    if (!deps.claude) return JSON.stringify({ error: 'Claude sessions are switched off — say so plainly, in your own words.' });
    const action = typeof args.action === 'string' ? args.action : '';
    const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '');
    try {
      if (action === 'open') {
        const opened = await deps.claude.open({ folder: text(args.folder), name: text(args.name) });
        if ('error' in opened) return JSON.stringify({ error: `${opened.error} Say so plainly.` });
        const { session } = opened;
        return JSON.stringify({
          opened: true, id: session.id, name: session.name, folder: session.dir, link: session.url,
          note: session.url
            ? 'It is open and waiting. Give them the link — it opens in the Claude app — and say it is also under Code in the app. They tell it what to do there; it has not started on anything.'
            : 'It is open, but the link was not ready yet. Tell them to find it under Code in the Claude app by its name. It has not started on anything.',
        });
      }
      if (action === 'list') {
        const listed = await deps.claude.list();
        if ('error' in listed) return JSON.stringify({ error: `${listed.error} Say so plainly.` });
        if (!listed.sessions.length) return JSON.stringify({ sessions: [], note: 'None of the sessions you opened are running.' });
        return JSON.stringify({ sessions: listed.sessions.map(session => ({ id: session.id, name: session.name, folder: session.dir, link: session.url, status: session.status, openedAt: session.at })) });
      }
      if (action === 'stop') {
        const id = text(args.id);
        if (!id) return JSON.stringify({ error: 'id is required to stop a session — list them first.' });
        const stopped = await deps.claude.stop(id);
        return JSON.stringify(stopped.stopped ? { stopped: true, id, note: 'Stopped. Its conversation is kept.' } : { error: stopped.error ?? 'It would not stop.' });
      }
      return JSON.stringify({ error: 'Unknown action — use open, list or stop.' });
    } catch (error) {
      console.warn('[claude] session tool failed:', error instanceof Error ? error.message : error);
      return JSON.stringify({ error: `Claude is not answering (${error instanceof Error ? error.message : error}). Say so plainly rather than pretending it opened.` });
    }
  }
  if (name === 'downloads') {
    // Re-checked here: a model can name a tool it was never offered.
    if (!deps.downloads) return JSON.stringify({ error: 'The downloads are not wired up to you — say so plainly, in your own words.' });
    const action = args.action === 'pause' || args.action === 'resume' ? args.action : 'status';
    const title = typeof args.title === 'string' ? args.title.trim() : '';
    try {
      const result = action === 'status' ? await deps.downloads.status() : action === 'pause' ? await deps.downloads.pause(title || undefined) : await deps.downloads.resume(title || undefined);
      console.log(`[downloads] ${action}${title ? ` "${title}"` : ''} -> ${'error' in result ? String(result.error) : Object.keys(result).filter(k => k !== 'note').map(k => `${k}=${JSON.stringify(result[k])}`).join(' ').slice(0, 160)}`);
      return JSON.stringify(result);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      console.warn(`[downloads] ${action} failed: ${reason}`);
      return JSON.stringify({ error: `qBittorrent is not answering (${reason}). Say so plainly rather than pretending it is done.` });
    }
  }
  if (name === 'run_command') {
    // Re-checked here: a model can name a tool it was never offered.
    if (!deps.shell) return JSON.stringify({ error: 'Running commands on the server is switched off — say so plainly, in your own words.' });
    const command = typeof args.command === 'string' ? args.command.trim() : '';
    if (!command) return JSON.stringify({ error: 'command is required — the exact command, on one line.' });
    try {
      return JSON.stringify(await deps.shell.run({ command, said: latestUserMessage, door: onWeb() ? 'phone' : 'desk' }));
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      console.warn(`[shell] run_command failed: ${reason}`);
      return JSON.stringify(corePolicySync('tool-wording.result',['shell-failed',{reason}]));
    }
  }
  if (name === 'get_manga') {
    // Re-checked here: a model can name a tool it was never offered.
    if (!deps.mangaShelf) return JSON.stringify({ error: 'The manga server is not wired up to you — say so plainly, in your own words.' });
    const title = typeof args.title === 'string' ? args.title.trim() : '';
    if (!title) return JSON.stringify({ error: 'title is required — the manga they named.' });
    const action = args.action === 'status' ? 'status' : 'get';
    try {
      const result = action === 'status'
        ? await deps.mangaShelf.status(title)
        : await deps.mangaShelf.get({ title, mangaId: typeof args.mangaId === 'number' ? args.mangaId : undefined, confirm: args.confirm === true });
      console.log(`[manga] ${action} "${title}" for him -> ${String(result.outcome ?? result.error ?? '?')}`);
      return JSON.stringify(result);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      console.warn(`[manga] ${action} "${title}" failed: ${reason}`);
      return JSON.stringify({ error: `The manga server is not answering (${reason}). Say so plainly rather than pretending it is fetching.` });
    }
  }
  if (name === 'browser_control') {
    return JSON.stringify(await runCoreBrowserTool(args,{port:browserPort(),fetch:deps.net.fetch as Parameters<typeof runCoreBrowserTool>[1]['fetch'],shotDir:browserShotDir,markPageRead,config:readBrowserControlConfig(deps.store.get('browser')),said:latestUserMessage}));
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
    if (!isInTheirWords(fact, latestUserMessage)) {
      return JSON.stringify({ saved: false, reason: 'The current user message does not support that personal fact. Quotes, fiction, guesses and contradictory wording are not personal evidence. Ask for clarification; do not claim it was remembered.' });
    }
    if (replaces && !require('./memory-replacement').replacementAuthorized(outdated, latestUserMessage, (hint: string) => findSuperseded(getMemories(), hint))) return JSON.stringify({ saved: false, reason: 'The old memory named in the current user message is ambiguous or differs from the proposed replacement target. Ask which memory they mean; nothing was changed.' });
    if (replaces && !outdated) return JSON.stringify({ saved: false, reason: 'The previous memory could not be identified unambiguously. Nothing was changed.' });
    const planned = planMemoryEdit(getMemories(), { oldIds: outdated ? [outdated.id] : [], text: fact, kind, subject,
      source: 'explicit', predicate, object, evidenceDetail: latestUserMessage });
    const saved = planned;
    if (!saved) return JSON.stringify({ error: 'fact is required.' });
    if (!saved.record) {
      // Said back plainly, because the alternative is her announcing that she
      // will remember something she has not kept.
      return JSON.stringify({
        saved: false,
        reason: 'That is not worth writing down — it is either about this moment only, or true of anyone. Keep things that would still matter to them in a month. Do not tell them you have remembered it.',
      });
    }
    setMemories(saved.memories);
    console.log(`[ai] ${saved.created ? 'remembered' : `heard again (${saved.record.mentions}x)`} [${kind}]: "${fact}"`);
    // Being told it is already known is useful to the model — it stops it
    // announcing a discovery when the user has merely repeated themselves.
    return JSON.stringify({ saved: true, known: !saved.created, mentions: saved.record.mentions, kind, text: saved.record.text, superseded: saved.retired });
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
      if (!isInTheirWords(content, latestUserMessage)) return JSON.stringify({ saved: false, reason: 'That personal fact is not supported by the current user message.' });
      const saved = planMemoryEdit(getMemories(), { oldIds: [], text: content, kind, source: 'explicit', evidenceDetail: latestUserMessage });
      if (!saved?.record) {
        return JSON.stringify({ saved: false, reason: 'Not recorded — that reads as either about this moment only or true of anyone. Keep things that would still matter to them in a month.' });
      }
      store.transaction(() => {
        setMemories(saved.memories);
        if (!DEFAULT_BLOCK_LABELS.has(label)) setBlocks(blocks.map(candidate => candidate.label === label ? withEditedValue(candidate, edit.value!) : candidate));
      });
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
    // A substring belongs to exactly one live record. Never fuzzy-delete a
    // different fact or save only the replacement fragment as a new memory.
    const matches = getMemories().filter(m => !m.supersededBy && m.status !== 'archived' && m.text.includes(oldSubstring));
    if (matches.length !== 1 || matches[0].text.indexOf(oldSubstring) !== matches[0].text.lastIndexOf(oldSubstring)) {
      return JSON.stringify({ saved: false, reason: 'The edit does not identify exactly one complete memory. Nothing was changed.' });
    }
    const outdated = matches[0];
    const replacement = outdated.text.replace(oldSubstring, newSubstring).trim();
    if (replacement && replacement !== outdated.text && !isInTheirWords(replacement, latestUserMessage)) {
      return JSON.stringify({ saved: false, reason: 'The corrected fact is not supported by the current user message. Nothing was changed.' });
    }
    const saved = planMemoryEdit(getMemories(), { oldIds: [outdated.id], text: replacement, kind: outdated.kind,
      subject: outdated.subject, source: replacement === outdated.text ? outdated.source ?? 'inferred' : 'explicit', evidenceDetail: latestUserMessage });
    if (!saved) return JSON.stringify({ saved: false, reason: 'The replacement was not worth keeping. Nothing was changed.' });
    store.transaction(() => {
      setMemories(saved.memories);
      if (!DEFAULT_BLOCK_LABELS.has(label)) setBlocks(blocks.map(candidate => candidate.label === label ? withEditedValue(candidate, edit.value!) : candidate));
    });
    return JSON.stringify({ saved: true, superseded: saved.record ? saved.retired : 0, archived: saved.record ? 0 : saved.retired,
      text: saved.record?.text ?? '', note: replacement ? `Replaced the memory in the ${label} block.` : `Archived the memory removed from the ${label} block.` });
  }
  if (name === 'core_memory_rethink') {
    const label = typeof args.label === 'string' ? args.label.trim() : '';
    const newValue = typeof args.new_value === 'string' ? args.new_value.trim() : '';
    const blocks = store.getBlocks();
    const block = findBlock(blocks, label);
    if (!block) return JSON.stringify({ error: `There is no memory block called "${label}".` });
    if (!canEditBlock(blocks, label)) return JSON.stringify({ error: `The "${label}" block is read-only.` });
    if (!newValue || newValue.length > block.limit) return JSON.stringify({ error: `new_value must contain between 1 and ${block.limit} characters.` });
    // Resolve before planning the new record, and require exact represented
    // records. Profile configuration and truncated lines cannot be retired.
    const before = getMemories();
    const current = resolveBlockValue(block, blockSources(''));
    const lines = current.split('\n').map(line => line.replace(/^-\s*/, '').trim()).filter(Boolean);
    const outdated = before.filter(m => !m.supersededBy && m.status !== 'archived' && lines.includes(m.text));
    const supported = newValue.split(/[;\n]+/).filter(s => s.trim()).every(part =>
      isInTheirWords(part, latestUserMessage) || outdated.some(m => isInTheirWords(part, m.text)));
    if (!supported || !outdated.length) return JSON.stringify({ saved: false, reason: 'The rewrite is not supported by identifiable memories or the current user message. Nothing was changed.' });
    const saved = planMemoryEdit(before, { oldIds: outdated.map(m => m.id), text: newValue, kind: kindForBlock(label),
      source: isInTheirWords(newValue, latestUserMessage) ? 'explicit' : 'inferred', evidenceDetail: 'Rewrite of ' + outdated.map(m => m.id).join(', ') });
    if (!saved?.record) return JSON.stringify({ saved: false, reason: 'The rewrite was not worth keeping. Nothing was changed.' });
    store.transaction(() => {
      setMemories(saved.memories);
      if (!DEFAULT_BLOCK_LABELS.has(label)) setBlocks(blocks.map(candidate => candidate.label === label ? withEditedValue(candidate, newValue) : candidate));
    });
    return JSON.stringify({ saved: true, superseded: saved.retired, note: `Rewrote the ${label} block.`, text: saved.record.text });
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
    if (wanted && !((corePolicySync<boolean>('diagnostic.knownService',[wanted])))) return JSON.stringify({ error: `Unknown service "${wanted}". Known: ${KNOWN_SERVICES.join(', ')}.` });
    const services = await collectServices(wanted);
    return JSON.stringify({ services });
  }
  if (name === 'diagnose_system') {
    const target = (corePolicySync<string>('diagnostic.target',[args.target]));
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

  if (name === 'watch_anime') {
    // Re-checked here: a model can name a tool it was never offered.
    if (!deps.anime) return JSON.stringify({ error: 'The anime server is not wired up to you — say so plainly, in your own words.' });
    const title = typeof args.title === 'string' ? args.title.trim() : '';
    if (!title) return JSON.stringify({ error: 'title is required — the show they named.' });
    const action = args.action === 'status' ? 'status' : 'watch';
    try {
      const result = action === 'status'
        ? await deps.anime.status(title)
        : await deps.anime.watch({ title, jellyfinSeriesId: typeof args.jellyfinSeriesId === 'string' ? args.jellyfinSeriesId : undefined, tvdbId: typeof args.tvdbId === 'number' ? args.tvdbId : undefined, confirm: args.confirm === true, where: typeof args.where === 'string' ? args.where.trim() : undefined });
      console.log(`[anime] ${action} "${title}" -> ${String(result.outcome ?? '?')}${result.show ? ` (${String(result.show)})` : ''}`);
      return JSON.stringify(result);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      console.warn(`[anime] ${action} "${title}" failed: ${reason}`);
      return JSON.stringify({ error: `The anime server could not be reached (${reason}). Say you could not check or start it; do not say it is on or on its way.` });
    }
  }
  if (name === 'go_back_to_sleep') {
    const done = deps.goBackToSleep({ block: args.block === true });
    return JSON.stringify(corePolicySync('tool-wording.result',['sleep',done]));
  }
  if (name === 'book_follow_up') {
    if (!deps.booking) return JSON.stringify({ error: 'There is nowhere to keep that right now. Do not promise to check back.' });
    const minutes = typeof args.in_minutes === 'number' ? args.in_minutes : typeof args.in_minutes === 'string' && /^\d+$/.test(args.in_minutes) ? Number(args.in_minutes) : undefined;
    const result = await deps.booking.book({
      why: typeof args.why === 'string' ? args.why : '',
      date: typeof args.date === 'string' && args.date.trim() ? args.date : undefined,
      time: typeof args.time === 'string' && args.time.trim() ? args.time : undefined,
      inMinutes: minutes,
    });
    return JSON.stringify(result.booked
      ? { booked: true, when: result.when, note: 'Set — it comes back to you then. Mention it once in your own words if you like; never read this back.' }
      : { booked: false, reason: result.reason });
  }
  if (name === 'vault_list' || name === 'vault_read' || name === 'vault_write' || name === 'vault_folder') {
    const root = deps.vault.root();
    if (!root) return JSON.stringify({ error: 'No vault is set up — say so plainly.' });
    if (name === 'vault_list') return JSON.stringify(listVault(root, typeof args.folder === 'string' ? args.folder : ''));
    if (name === 'vault_read') return JSON.stringify(readNote(root, typeof args.path === 'string' ? args.path : ''));
    if (name === 'vault_folder') {
      const made = createFolder(root, typeof args.path === 'string' ? args.path : '');
      if (made.ok && !made.existed) console.log(`[vault] she made the folder ${made.path}`);
      return JSON.stringify(made);
    }
    const mode = args.mode === 'create' || args.mode === 'append' || args.mode === 'replace' ? args.mode as WriteMode : null;
    if (!mode) return JSON.stringify({ error: 'mode is create, append or replace.' });
    const notePath = typeof args.path === 'string' ? args.path : '';
    const text = typeof args.text === 'string' ? args.text : '';
    // Replacing is the one write that loses words: the restart_haru handshake.
    if (mode === 'replace' && args.confirm !== true) {
      const current = readNote(root, notePath);
      return JSON.stringify({ confirm: true, path: notePath, chars: current.ok ? current.chars : 0, note: current.ok ? 'Do not act yet. Tell them what would be replaced, ask them to say the word, then call this again with confirm: true.' : 'Nothing is there yet — write it with mode: create instead.' });
    }
    const written = writeNote(root, notePath, text, mode, args.preserve_text === true);
    if (written.ok) {
      console.log(`[vault] she ${written.mode === 'append' ? (written.existed ? 'added to' : 'started') : written.mode === 'create' ? 'made' : 'rewrote'} the note ${written.path} (${written.chars} chars), at their word`);
      deps.vault.afterWrite();
    }
    return JSON.stringify(written);
  }
  if (name === 'search_chats') {
    if (!deps.chats) return JSON.stringify({ error: 'Your old chats cannot be searched right now. Say you cannot check — do not guess what was said.' });
    const query = typeof args.query === 'string' ? args.query.trim() : '';
    if (!query) return JSON.stringify({ error: 'query is required: the words you expect in what was said.' });
    const day = (value: unknown) => typeof value === 'string' && isDay(value.trim()) ? value.trim() : undefined;
    const result = await deps.chats.search({ query: query.slice(0, 200), from: day(args.from), to: day(args.to) });
    return JSON.stringify(corePolicySync('tool-wording.result',['chats',result]));
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
      return JSON.stringify(corePolicySync('tool-wording.result',['knowledge',{knowledgeText:result.knowledgeText,memoryTexts:result.memories.map(entry=>entry.memory.text),knowledgeCount:result.knowledge.length}]));
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      console.warn(`[knowledge] lookup failed: ${reason}`);
      return JSON.stringify(corePolicySync('tool-wording.result',['knowledge-failed',{reason}]));
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
