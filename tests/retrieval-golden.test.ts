// A golden set for memory retrieval: a fixed profile, fixed questions, and the
// memories that must come back for each one.
//
// The point is regression, not unit coverage — retrieval-v2.test.ts already
// checks the pieces. This file answers the question those cannot: after a tweak
// to the weights, the half-lives or the admission rules, does she still surface
// the right memory when asked the right question? Scores drift harmlessly all
// the time, so the assertions are about membership and about which memory wins
// its topic, never about exact scores or the order of the always-included.
//
// Calibrated by mutation, because a golden set that passes is worth nothing
// until it has been watched to fail. Breaking retrieval on purpose, one change
// at a time, this file catches: the relevance weights zeroed (8 cases), the
// dormant admission gate opened, the archived guard removed, the supersession
// guard removed, and the recurring-mention threshold raised out of reach.
//
// It does not catch recency being ignored — no two memories here are close
// enough on relevance for age to decide between them, and inventing a pair that
// were would cost the realism this set exists for. Recency is covered directly
// in retrieval-v2.test.ts; if the decay curve is ever reworked, that is the file
// to trust, not this one.

import test from 'node:test';
import assert from 'node:assert/strict';
import { ALWAYS_IMPORTANT, retrieveMemories, type MemoryRecord } from '../electron/memory';

const NOW = new Date('2026-08-20T00:00:00.000Z');
const ISO = (daysAgo: number) => new Date(NOW.getTime() - daysAgo * 86_400_000).toISOString();

function record(overrides: Partial<MemoryRecord> & { id: string; text: string; kind: MemoryRecord['kind'] }): MemoryRecord {
  return {
    createdAt: ISO(120),
    lastSeenAt: ISO(3),
    mentions: 1,
    confidence: 0.85,
    importance: 0.5,
    source: 'conversation',
    status: 'active',
    memoryType: 'semantic',
    ...overrides,
  };
}

/** One plausible profile, holding every case retrieval has to get right:
 *  standing traits, topical facts, ageing events, a dormant thread, and the
 *  two kinds of memory that must never be spoken again. */
const PROFILE: MemoryRecord[] = [
  // Standing traits — offered whatever the topic is.
  record({ id: 'pref-nagging', text: 'Hates being nagged about unfinished work', kind: 'preference', importance: 0.6 }),
  record({ id: 'pref-mornings', text: 'Prefers to be left alone before his first coffee', kind: 'preference', importance: 0.5 }),
  record({ id: 'rel-emma', text: 'Lives with Emma, his partner', kind: 'relationship', importance: 0.7 }),
  record({ id: 'rel-kate', text: 'His sister Kate lives in Leeds', kind: 'relationship', importance: 0.4, lastSeenAt: ISO(90) }),
  record({ id: 'fact-shellfish', text: 'Allergic to shellfish', kind: 'fact', importance: 0.85, confidence: 0.95 }),

  // Topical facts.
  record({ id: 'fact-gpu', text: 'Runs a 3090 in the server cupboard', kind: 'fact', confidence: 0.9 }),
  record({ id: 'fact-docker', text: 'Keeps Jellyfin and Sonarr running in docker', kind: 'fact' }),
  record({ id: 'fact-obsidian', text: 'Takes all his notes in an Obsidian vault', kind: 'fact', importance: 0.45 }),
  record({ id: 'fact-guitar', text: 'Learning guitar, about six months in', kind: 'fact' }),
  record({ id: 'fact-cats', text: 'Has two cats, Miso and Pepper', kind: 'fact' }),
  record({ id: 'fact-coffee', text: 'Drinks his coffee black, no sugar', kind: 'fact', importance: 0.3 }),
  record({ id: 'fact-sheffield', text: 'Lives in Sheffield', kind: 'fact', importance: 0.6 }),

  // Events, which age faster than facts do.
  record({ id: 'event-poster', text: 'Finished the Canva poster and sent it to the printers', kind: 'event', importance: 0.3, lastSeenAt: ISO(2) }),
  record({ id: 'event-interview', text: 'Had a job interview with Corvid Labs on the 14th', kind: 'event', importance: 0.6, lastSeenAt: ISO(6) }),

  // A thread that went quiet: back only on clear on-topic proof.
  record({ id: 'dormant-python', text: 'Was learning Python last year', kind: 'fact', importance: 0.3, status: 'dormant', lastSeenAt: ISO(200) }),

  // Something he mentions constantly, so it stays reachable on its own.
  record({ id: 'recurring-sleep', text: 'Keeps saying he sleeps badly', kind: 'fact', mentions: 5, lastSeenAt: ISO(4) }),

  // Half-remembered trivia — must never crowd out a real answer.
  record({ id: 'weak-bees', text: 'Watched a clip about beekeeping once', kind: 'fact', importance: 0.2, confidence: 0.45, lastSeenAt: ISO(40) }),

  // Must never be spoken again. Both are worded to overlap the questions below
  // that name their subject, so they would be admitted on relevance if the
  // guards ever stopped holding — the point of putting them here at all.
  record({ id: 'gone-archived', text: 'Works at Corvid Labs on the platform team', kind: 'fact', status: 'archived' }),
  record({ id: 'gone-superseded', text: 'Lives in Manchester', kind: 'fact', importance: 0.6, supersededBy: 'fact-sheffield' }),
];

/** Recomputed from the profile rather than hardcoded, so a new preference or
 *  important fact does not silently break the `wins` assertions below. */
const ALWAYS_IDS = new Set(PROFILE
  .filter(m => m.kind === 'preference' || m.kind === 'relationship' || (m.importance ?? 0) >= ALWAYS_IMPORTANT)
  .map(m => m.id));

type Case = {
  ask: string;
  /** Must come back. */
  expect?: string[];
  /** Must not come back. */
  reject?: string[];
  /** The best answer actually on this topic: the top-scoring memory that is not
   *  simply along for the ride as a preference, relationship or vital fact. */
  wins?: string;
  /**
   * Memories `wins` has to outrank. This is the assertion that exercises the
   * score formula rather than the admission rules: an allergy at importance
   * 0.85 is always offered and always outranks a fact on importance alone, so
   * an on-topic memory beating it can only have come from the relevance term.
   * Drop the keyword and semantic weights and every one of these fails.
   */
  over?: string[];
  /** id → semantic similarity, as retrieveContext supplies from the embedder. */
  semantic?: Record<string, number>;
};

const IMPORTANT_BUT_IRRELEVANT = ['fact-shellfish', 'rel-emma'];

const GOLDEN: Case[] = [
  { ask: 'how is the guitar going', wins: 'fact-guitar', over: IMPORTANT_BUT_IRRELEVANT, reject: ['weak-bees'] },
  { ask: 'is the 3090 in the cupboard still overheating', wins: 'fact-gpu', over: IMPORTANT_BUT_IRRELEVANT },
  { ask: 'is jellyfin still running or did docker fall over', wins: 'fact-docker', over: IMPORTANT_BUT_IRRELEVANT },
  { ask: 'did the canva poster ever reach the printers', wins: 'event-poster', over: IMPORTANT_BUT_IRRELEVANT },
  // Names Corvid Labs, which the archived job memory also names.
  { ask: 'how did the corvid labs interview go', wins: 'event-interview', over: IMPORTANT_BUT_IRRELEVANT, reject: ['gone-archived'] },
  { ask: 'where do the notes live, obsidian or somewhere else', wins: 'fact-obsidian', over: IMPORTANT_BUT_IRRELEVANT },
  { ask: 'are the cats fed', wins: 'fact-cats', over: IMPORTANT_BUT_IRRELEVANT },

  // No shared words at all — "sleeping" does not match "sleeps", so this one is
  // reachable only because he brings it up constantly. It has no relevance to
  // rank on, so it is not asked to outrank anything.
  { ask: 'sleeping any better lately', expect: ['recurring-sleep'] },

  // A dormant thread needs clear on-topic proof, and gets it here.
  { ask: 'anything ever come of python', expect: ['dormant-python'] },
  // The same thread, asked about nothing in particular, stays quiet.
  { ask: 'what shall we watch tonight', reject: ['dormant-python'] },

  // Standing traits ride along on a question that has nothing to do with them.
  { ask: 'what should we eat tonight', expect: ['fact-shellfish', 'pref-nagging', 'rel-emma'] },
  // ...and unrelated topical facts do not.
  { ask: 'what should we eat tonight', reject: ['fact-guitar', 'fact-gpu', 'event-poster'] },

  // The hybrid path: no shared words at all, carried entirely by the embedder.
  { ask: 'how is the fretwork coming along', wins: 'fact-guitar', over: IMPORTANT_BUT_IRRELEVANT, semantic: { 'fact-guitar': 0.9 } },

  // Names both cities, so the replaced memory is on topic and would come back
  // if supersession stopped being honoured. It is not outranked, it is gone.
  { ask: 'is he still in manchester or is it sheffield now', expect: ['fact-sheffield'], reject: ['gone-superseded'] },
];

for (const [index, item] of GOLDEN.entries()) {
  test(`golden ${index + 1}: ${item.ask}`, () => {
    const result = retrieveMemories(PROFILE, item.ask, {
      now: NOW,
      semantic: item.semantic ? new Map(Object.entries(item.semantic)) : undefined,
    });
    const ids = result.map(entry => entry.memory.id);

    for (const id of item.expect ?? []) {
      assert.ok(ids.includes(id), `expected "${item.ask}" to surface ${id}; got ${ids.join(', ') || '(nothing)'}`);
    }
    for (const id of item.reject ?? []) {
      assert.ok(!ids.includes(id), `expected "${item.ask}" not to surface ${id}; got ${ids.join(', ')}`);
    }
    if (item.wins) {
      const topical = result.filter(entry => !ALWAYS_IDS.has(entry.memory.id));
      assert.equal(topical[0]?.memory.id, item.wins,
        `expected ${item.wins} to be the best on-topic memory for "${item.ask}"; got ${topical.map(e => e.memory.id).join(', ') || '(nothing on topic)'}`);
    }
    for (const loser of item.over ?? []) {
      const winner = ids.indexOf(item.wins ?? '');
      const rank = ids.indexOf(loser);
      assert.ok(winner >= 0 && (rank < 0 || winner < rank),
        `expected ${item.wins} to outrank ${loser} for "${item.ask}"; got ${ids.join(', ')}`);
    }
  });
}

test('the forgotten stay forgotten, whatever is asked', () => {
  for (const item of GOLDEN) {
    const ids = retrieveMemories(PROFILE, item.ask, { now: NOW }).map(entry => entry.memory.id);
    assert.ok(!ids.includes('gone-archived'), `archived memory came back for "${item.ask}"`);
    assert.ok(!ids.includes('gone-superseded'), `superseded memory came back for "${item.ask}"`);
  }
});

test('every golden case returns something to work with', () => {
  for (const item of GOLDEN) {
    const result = retrieveMemories(PROFILE, item.ask, {
      now: NOW,
      semantic: item.semantic ? new Map(Object.entries(item.semantic)) : undefined,
    });
    assert.ok(result.length > 0, `"${item.ask}" retrieved nothing at all`);
  }
});
