// What Haru is told, and the order she is told it in.
//
// The order is asserted as a chain of positions rather than an exact string,
// because the fragments themselves are tested where they live. What could not
// be tested anywhere until prompt.ts existed is this file's actual job: which
// lines are included, and which of them outranks which.

import test from 'node:test';
import assert from 'node:assert/strict';
import { chatSystemPrompt, chatDynamicContext, feedbackSummary, freshStartInstruction, knowledgeInstruction, screenContext, searchInstruction, systemInstruction, NO_GUESSING, FIRST_PERSON_NOTE, type PromptState, LENGTH_RULE_LOCAL, LENGTH_RULE_HOSTED } from '../electron/prompt';
import { readSearchConfig } from '../electron/search';

const NOW = new Date('2026-08-20T19:30:00.000Z');

// Sentinels, so the pieces the caller renders can be found in the joined
// prompt without depending on anything they happen to say.
const IDENTITY = 'SENTINEL-IDENTITY';
const STYLE = 'SENTINEL-STYLE';
const PROFILE = 'SENTINEL-PROFILE';
const ANILIST = 'SENTINEL-ANILIST';
const MACHINE = 'SENTINEL-MACHINE';

function state(overrides: Partial<PromptState> = {}): PromptState {
  return {
    now: NOW,
    timezone: 'Europe/London',
    character: { identity: IDENTITY, style: STYLE },
    profile: PROFILE,
    aniList: ANILIST,
    journalConfig: { enabled: false, askHour: 20, askUnprompted: false },
    journal: [],
    checkInsToday: [],
    screen: {},
    asides: [],
    rated: [],
    kept: [],
    search: readSearchConfig({ enabled: false }),
    knowledgeEnabled: false,
    systemEnabled: false,
    machineNote: '',
    following: {},
    irritation: 0,
    ego: 0,
    goodnight: 'none',
    shout: 'none',
    latestMessage: 'what time is it',
    fresh: null,
    herRecentReplies: [],
    movedJustNow: null,
    pushback: undefined,
    ...overrides,
  };
}

/** Position of a fragment in the prompt; -1 if it never made it in. */
const at = (prompt: string, needle: string) => prompt.indexOf(needle);

test('the local length rule is in the brief verbatim, so a hosted brain can swap it for its own', () => {
  assert.match(LENGTH_RULE_LOCAL, /One thought/);
  assert.match(LENGTH_RULE_HOSTED, /As long as it needs and no longer/);
  assert.doesNotMatch(LENGTH_RULE_HOSTED, /short paragraph/);
});


// ---- cachedHead: the hosted-brain split, where the cacheable head comes first ----

const CLOCK = "in the user's timezone";

test('the no-guessing guard constrains guessing without denying the sense', () => {
  assert.doesNotMatch(NO_GUESSING, /you cannot see their screen/i);
  // The guard itself must survive: not guessing is the whole point of it.
  assert.match(NO_GUESSING, /never guess/i);
  assert.match(NO_GUESSING, /you do not know/i);
});
