import test from 'node:test';
import assert from 'node:assert/strict';
import {
  baseConfidence, CONFIDENCE, guessMemoryType, mentionConfidence, migrateMemories,
  scoreImportance, withConfirmation, withContradiction, rememberInto, retrieveMemories,
} from '../electron/memory';

const NOW = '2026-08-01T00:00:00.000Z';

test('baseConfidence ranks sources by reliability', () => {
  assert.equal(baseConfidence('explicit'), CONFIDENCE.explicitBase);
  assert.equal(baseConfidence('conversation'), CONFIDENCE.conversationBase);
  assert.equal(baseConfidence('inferred'), CONFIDENCE.inferredBase);
  assert.equal(baseConfidence('activity'), CONFIDENCE.activityBase);
  assert.equal(baseConfidence('import'), CONFIDENCE.conversationBase);
});

test('mentionConfidence grows with repeats and caps', () => {
  assert.equal(mentionConfidence(1, 0.8), 0.8);
  assert.equal(mentionConfidence(2, 0.8), 0.83);
  assert.equal(mentionConfidence(10, 0.8), 0.98);
  assert.equal(mentionConfidence(50, 0.8), 0.98);
  assert.equal(mentionConfidence(1, 0.45), 0.45);
});

test('confirmation and contradiction adjust confidence within bounds', () => {
  assert.equal(withConfirmation(0.95), CONFIDENCE.max);
  assert.equal(withContradiction(0.05), CONFIDENCE.min);
  assert.equal(withConfirmation(0.8), 0.85);
  assert.equal(withContradiction(0.8), 0.5);
});

test('scoreImportance is high for preferences and relationships', () => {
  assert.equal(scoreImportance('preference', 'Dislikes being nagged'), 0.85);
  assert.equal(scoreImportance('relationship', 'Lives with Emma'), 0.8);
});

test('scoreImportance weighs fact content', () => {
  assert.equal(scoreImportance('event', 'Rental inspection on the 20th'), 0.45);
  assert.equal(scoreImportance('fact', 'Allergic to shellfish'), 0.8);
  assert.equal(scoreImportance('fact', 'Works on the PC Project'), 0.8);
  assert.equal(scoreImportance('fact', 'Watched a YouTube video'), 0.2);
  assert.equal(scoreImportance('fact', 'Lives in Perth'), 0.6);
  assert.equal(scoreImportance('fact', 'Feeling a bit tired'), 0.4);
});

test('guessMemoryType maps kinds and wording', () => {
  assert.equal(guessMemoryType('relationship', 'Emma is their girlfriend'), 'relational');
  assert.equal(guessMemoryType('event', 'Had a fight with Emma'), 'episodic');
  assert.equal(guessMemoryType('preference', 'Does not like to be nagged'), 'semantic');
  assert.equal(guessMemoryType('preference', 'Usually prefers short replies'), 'procedural');
  assert.equal(guessMemoryType('fact', 'Commonly uses OpenCode for implementation'), 'procedural');
  assert.equal(guessMemoryType('fact', 'Has a dog called Miso'), 'semantic');
});

test('rememberInto creates a fully-scored record', () => {
  const { memories, created, record } = rememberInto([], {
    text: 'Dislikes being nagged', kind: 'preference', id: 'm1', now: NOW, source: 'explicit',
  });
  assert.equal(created, true);
  assert.equal(record.confidence, 0.9);
  assert.equal(record.importance, 0.85);
  assert.equal(record.source, 'explicit');
  assert.equal(record.status, 'active');
  assert.equal(record.memoryType, 'semantic');
  assert.deepEqual(record.evidence, [{ at: NOW, kind: 'statement', source: 'explicit' }]);
  assert.equal(memories.length, 1);
});

test('rememberInto records triples when provided', () => {
  const { record } = rememberInto([], {
    text: 'Tommy created the PC Project', kind: 'relationship', subject: 'Tommy', predicate: 'created', object: 'the PC Project', id: 'm2', now: NOW,
  });
  assert.equal(record.predicate, 'created');
  assert.equal(record.object, 'the PC Project');
  assert.equal(record.memoryType, 'relational');
});

test('rememberInto carries evidence detail through create and repeat', () => {
  const first = rememberInto([], {
    text: 'Tommy downloaded Linux Arch', kind: 'event', id: 'm3', now: NOW, source: 'conversation', evidenceDetail: "from 2026-08-13's conversation",
  });
  assert.equal(first.record.evidence?.[0].detail, "from 2026-08-13's conversation");
  const second = rememberInto(first.memories, {
    text: 'Tommy downloaded Linux Arch', kind: 'event', id: 'm4', now: NOW, evidenceDetail: "from 2026-08-14's conversation",
  });
  assert.equal(second.record.evidence?.length, 2);
  assert.equal(second.record.evidence?.[1].detail, "from 2026-08-14's conversation");
});

test('a repeat bumps confidence and adds evidence, keeping importance', () => {
  const first = rememberInto([], { text: 'Allergic to shellfish', kind: 'fact', id: 'm1', now: NOW });
  const second = rememberInto(first.memories, { text: 'Allergic to shellfish', kind: 'fact', id: 'm2', now: NOW });
  assert.equal(second.created, false);
  assert.equal(second.record.mentions, 2);
  assert.equal(second.record.confidence, 0.83);
  assert.equal(second.record.evidence?.length, 2);
  assert.equal(second.record.evidence?.[1].kind, 'repeat');
  assert.equal(second.record.importance, 0.8);
});

test('migrateMemories fills v2 fields for legacy records', () => {
  const legacy = [
    { id: 'old1', text: 'Dislikes being nagged', createdAt: '2026-07-01T00:00:00.000Z', mentions: 4 },
    { id: 'old2', text: 'Watched a YouTube video', kind: 'fact', createdAt: '2026-07-02T00:00:00.000Z' },
  ];
  const upgraded = migrateMemories(legacy, NOW);
  assert.equal(upgraded.length, 2);
  const [nagged, video] = upgraded;
  assert.equal(nagged.kind, 'fact');
  assert.equal(nagged.confidence, mentionConfidence(4, baseConfidence('conversation')));
  assert.equal(nagged.importance, scoreImportance('fact', 'Dislikes being nagged'));
  assert.equal(nagged.source, 'conversation');
  assert.equal(nagged.status, 'active');
  assert.equal(nagged.memoryType, 'semantic');
  assert.equal(nagged.evidence?.length, 1);
  assert.equal(nagged.evidence?.[0].kind, 'statement');
  assert.equal(video.mentions, 1);
  assert.equal(video.importance, 0.2);
});

test('migrateMemories is idempotent — existing v2 fields are kept', () => {
  const once = migrateMemories([{ id: 'old1', text: 'Allergic to shellfish', kind: 'fact', createdAt: NOW }], NOW);
  const twice = migrateMemories(once, NOW);
  assert.deepEqual(twice, once);
});

test('migrateMemories preserves provided v2 fields', () => {
  const given = [{ id: 'm1', text: 'Works on the PC Project', kind: 'fact', createdAt: NOW, confidence: 0.5, importance: 0.9, status: 'dormant', memoryType: 'semantic', source: 'activity' }];
  const migrated = migrateMemories(given, NOW);
  assert.equal(migrated[0].confidence, 0.5);
  assert.equal(migrated[0].importance, 0.9);
  assert.equal(migrated[0].status, 'dormant');
  assert.equal(migrated[0].source, 'activity');
});
test('migration carries supersession, so what was replaced stays replaced', () => {
  // It did not, and getMemories() migrates on every read: the replaced record
  // came back with its replacement, and the next write saved it that way. The
  // supersession survived exactly until something looked at it.
  const raw = [
    { id: 'now', text: 'Lives in Sheffield', kind: 'fact', createdAt: NOW, lastSeenAt: NOW, mentions: 1 },
    { id: 'old', text: 'Lives in Manchester', kind: 'fact', createdAt: NOW, lastSeenAt: NOW, mentions: 1, supersededBy: 'now' },
  ];
  const migrated = migrateMemories(raw, NOW);
  assert.equal(migrated.find(entry => entry.id === 'old')?.supersededBy, 'now');

  // The round trip is what matters: read, write, read again.
  const again = migrateMemories(migrated, NOW);
  assert.equal(again.find(entry => entry.id === 'old')?.supersededBy, 'now');

  // And the point of the field: it is never offered back.
  const recalled = retrieveMemories(again, 'is he still in manchester or is it sheffield now', { now: new Date(NOW) });
  assert.ok(!recalled.some(entry => entry.memory.id === 'old'), 'the replaced memory came back');
  assert.ok(recalled.some(entry => entry.memory.id === 'now'), 'the current one should still be there');
});
