import {corePolicySync} from './core-policy-sync';
import { IRRITATION } from './mood';
// Deterministic answers for the messages a phone most often sends.
//
// Four tiers, cheapest first. Each tier tries to answer a message without the
// model: a canned FAQ, a template with live data, the data lookups the model
// would have made through its tools, and then — when nothing above is certain —
// nothing, meaning the caller lets the model answer. Deliberately free of
// electron imports, like dates.ts, so the routing can be exercised in plain
// Node.
//
// The trade that makes the layer worth having: a "what time is it" that takes
// 0.3ms instead of a cold model start is a reply that arrives while they are
// still looking at the screen. The trade that keeps it honest: the moment a
// question stops being mechanical — mood, memory, anything with judgement —
// this returns null and the model says what she would actually say.
//
// Mood gates the layer from outside: while she is ignoring, nothing here may
// answer, or the silence she is holding would become a scripted welcome.

export type AgendaLine = { title: string; time?: string; done: boolean };

export type QuickData = {
  now: Date;
  todayKey: string;
  nickname: string;
  herName: string;
  agenda: { today: AgendaLine[]; tomorrow: AgendaLine[] };
  checkInsToday: number;
  irritation: number;
  ignoring: boolean;
  /** The last thing she said, if anything: a lone word may be answering it. */
  lastOfHers?: string;
};

export type QuickHit = { reply: string; tier: 1 | 2 | 3 };

/**
 * `social`: whether the scripted greetings, "how are you" and the stray-word
 * jabs may answer. They were written for a cold local model, where "Hey.
 * What's up?" in 0.3ms beat her real voice arriving twelve seconds later.
 * With a hosted model answering in three, a scripted hello is the one flat
 * line in an otherwise live conversation — so the caller switches them off
 * and only the mechanical lookups (the time, the date, the list) stay instant.
 */
export function quickAnswer(text: string, data: QuickData, { social = true } = {}): QuickHit | null {
  return corePolicySync('quick.answer',[text,data,social]);
}

/**
 * A word on its own, out of nowhere: asked about, by script.
 *
 * "Seeds", "Belong", "Mountain" — a mistype, a mishearing, a thumb slip — and
 * the model welded each to the nearest thing on their list and then defended
 * it. Told not to, three ways, it did it again. So a lone word that answers
 * nothing is not put to the model at all: she asks what they meant, in her
 * voice, and nothing is invented. Not when she has just asked something — the
 * word may be the answer — and not the words that are whole replies on their
 * own, which the canned tier has already had first go at.
 */
const WHOLE_REPLIES = new Set(['yes', 'no', 'yep', 'nope', 'yeah', 'nah', 'ok', 'okay', 'fine', 'sure', 'thanks', 'thank', 'cheers', 'done', 'finished', 'good', 'great', 'cool', 'nice', 'wow', 'lol', 'haha', 'hi', 'hey', 'hello', 'bye', 'night', 'goodnight', 'morning', 'what', 'why', 'how', 'when', 'where', 'who', 'help', 'stop', 'wait', 'test', 'testing', 'again', 'retry', 'more', 'please', 'sorry', 'right', 'true', 'false', 'maybe', 'never', 'always', 'later', 'now', 'today', 'tomorrow', 'yesterday', 'same', 'nothing', 'nope', 'ready', 'go', 'gone', 'back', 'here', 'there', 'home', 'work', 'busy', 'tired', 'bored', 'sleepy', 'hungry', 'sick', 'well', 'better', 'worse', 'alive', 'dead', 'love', 'hate']);

function strayWord(text: string, data: QuickData): string | null {
  const word = text.trim();
  if (!/^[\p{L}][\p{L}'’-]{1,24}$/u.test(word)) return null;
  if (WHOLE_REPLIES.has(word.toLowerCase().replace(/[’']/g, "'"))) return null;
  if ((data.lastOfHers ?? '').trim().endsWith('?')) return null;
  const lines = [
    `“${word}.” That is a word, not a message. What about it? 🙄`,
    `${word}? Try that again with a verb in it. 😒`,
    `You sent me “${word}” and nothing else. What am I meant to do with that? 👀`,
    `“${word}.” Riveting. Finish the thought. 😤`,
    `${word}. Is that a question, an order, or your thumb slipping? Pick one. 🙄`,
  ];
  // Deterministic per word, so the same slip does not get a different line
  // each time and read as her searching for one.
  let hash = 0; for (const char of word.toLowerCase()) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return lines[hash % lines.length];
}

/** Lowercase, one space runs, trailing punctuation gone, hyphens gone so
 *  "check-ins" and "checkins" are one word. Nothing else is changed: "what's"
 *  stays "what's", so an anchored rule can tell the word "whats" from a
 *  contraction it was not given. */
function normalize(text: string) {
  return text.trim().toLowerCase().replace(/[.,!?…]+$/g, '').replace(/-/g, '').replace(/\s+/g, ' ').trim();
}

/** Tier 1 — fixed questions, fixed answers. No data, no weather, no clock. */
function cannedFaq(said: string): string | null {
  if (/^(hi|hello|hey|heya|hiya|yo|hi there|hello there|hey there)( \w+)?$/.test(said)) {
    return "Hey. What's up?";
  }
  if (/^(are you (there|awake|up|here|online|alive)|you (there|awake|up|here|alive)|still (alive|there))( \w+)?$/.test(said)) {
    return "Obviously. Not dead yet. What do you need?";
  }
  if (/^(thank you|thanks|thankyou|thx|ty|tysm)$/.test(said)) {
    return 'Anytime.';
  }
  if (/^(i love you|love you)$/.test(said)) {
    return 'I know. Keep saying it and I might start believing you.';
  }
  if (/^(bye|goodbye|see you|see ya|later|gtg|gotta go|got to go)$/.test(said)) {
    return 'See you around.';
  }
  // Deliberately no "good night" here: signing off is mood state, and the mood
  // loop has to see the word to record the day she signed off on.
  return null;
}

/** Tier 2 — the fixed skeleton filled with live data: the clock, the date,
 *  the greeting, her name, and a mood-coloured "how are you". */
function templateReply(said: string, data: QuickData, social = true): string | null {
  if (/^(what time is it|what'?s the time|what time is it now|time)$/.test(said)) {
    const h = data.now.getHours();
    const m = data.now.getMinutes();
    const ampm = h < 12 ? 'AM' : 'PM';
    const display = h % 12 === 0 ? 12 : h % 12;
    return `It's ${display}:${String(m).padStart(2, '0')} ${ampm}.`;
  }
  if (/^(what day is it|what'?s the date|what'?s today|what day is today|what is the date|what is today)$/.test(said)) {
    const weekday = data.now.toLocaleDateString('en-US', { weekday: 'long' });
    const month = data.now.toLocaleDateString('en-US', { month: 'long' });
    return `It's ${weekday}, ${month} ${data.now.getDate()}.`;
  }
  // The rest of this function is small talk — hers to answer when she is quick enough to.
  if (!social) return null;
  if (/^good (morning|afternoon|evening)$/.test(said)) {
    const h = data.now.getHours();
    const morning = h < 12;
    const evening = h >= 17;
    if (/morning$/.test(said)) return morning ? 'Good morning. What are we getting into?' : 'Bit late for a morning, isn\'t it?';
    if (/afternoon$/.test(said)) return morning ? 'The afternoon hasn\'t started yet. Anxious?' : h >= 17 ? 'That was hours ago. Where\'ve you been?' : 'Good afternoon. What\'s the plan?';
    if (/evening$/.test(said)) return evening ? 'Good evening. Want to make it interesting?' : 'Evening? The day\'s not done yet.';
  }
  if (/^(what'?s my name|what is my name|do you know my name)$/.test(said)) {
    return data.nickname.trim() ? `You're ${data.nickname.trim()}. I don't forget that.` : "You've never told me your name. Fix that.";
  }
  if (/^(who are you|what are you|who'?s this|what are you supposed to be)$/.test(said)) {
    return `I'm ${data.herName} — the one who answers when you text. Beyond that, I'm me: ask me something interesting and you'll find out.`;
  }
  if (/^(what'?s your name|what is your name|who are you called)$/.test(said)) {
    return `I'm ${data.herName}. Try not to forget it — I'll know if you do.`;
  }
  if (/^(how are you|how are you doing|how are you today|you ok|you okay)$/.test(said)) {
    if (data.irritation >= IRRITATION.fedUp) return 'Fed up, honestly. Don\'t push it.';
    return "Good. Better now that you're talking to me.";
  }
  return null;
}

/** Tier 3 — the lookups the model would have done through its tools, answered
 *  from the data directly: the agenda, tomorrow, and today's check-ins. */
function lookedUp(said: string, data: QuickData): string | null {
  if (/^(what( do i have|'?s) (on|for) today|anything (on|for) today|what'?s on today|what'?s my agenda|what do i have today|any plans today|what'?s on my list today|what do i have)$/.test(said)) {
    return agendaLine('Today', data.agenda.today, data);
  }
  if (/^(what( do i have|'?s) (on|for) tomorrow|anything (on|for) tomorrow|what'?s on tomorrow|what'?s my agenda tomorrow|any plans tomorrow|what do i have tomorrow)$/.test(said)) {
    return agendaLine('Tomorrow', data.agenda.tomorrow, data);
  }
  if (/^(how many checkins? (today|did i do)|did i check in( today)?|how are my checkins?|checkin count|checkins? today)$/.test(said)) {
    return data.checkInsToday === 0
      ? 'No check-ins yet today. Go on, jot one down — that\'s what they\'re for.'
      : `You've checked in ${data.checkInsToday} ${data.checkInsToday === 1 ? 'time' : 'times'} today.`;
  }
  if (/^(any reminders|do i have any reminders|whats my reminders|remind me of anything)$/.test(said)) {
    const all = [...data.agenda.today, ...data.agenda.tomorrow];
    return agendaLine('Coming up', all, data);
  }
  return null;
}

function agendaLine(label: string, lines: AgendaLine[], data: QuickData): string {
  const open = lines.filter(line => !line.done).slice(0, 8);
  if (!open.length) return `${label}: nothing on the books.`;
  const listed = open.map(line => line.time ? `${line.time} — ${line.title}` : line.title).join('; ');
  return `${label}: ${listed}.`;
}

/**
 * "Set your machine level to 3", said outright: the one setting she would not
 * change at his word. Told to on 2026-09-18 she claimed it done (it was not),
 * then that it was already done, then "I don't take commands from you" —
 * anchored on her own earlier replies, with the true level in the prompt.
 * So the explicit sentence is read here and applied in code (main.ts), and
 * she is not asked. Only the machine level: it is the one with a history.
 * The sentence has to end there — a level with "tomorrow maybe?" after it is talk.
 */
export type SettingCommand =
  | { name: 'machine_level'; value: number }
  | { name: 'brain_model'; value: 'explicit' | 'normal' }
  | { name: 'escalation'; value: boolean };

export function settingCommand(text: string): SettingCommand | null {
  return corePolicySync('self.settingCommand',[text]);
}
