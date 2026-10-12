import test from 'node:test';
import assert from 'node:assert/strict';
import { conversationContinuity, ConversationPreferenceCache, CONTINUITY_CHARS } from '../electron/conversation-continuity';
import { naturalConversationTurns } from '../electron/natural-conversation';
import type { MemoryRecord } from '../electron/memory';
import type { ChatMessage } from '../electron/provider';

const saved: MemoryRecord = { id: 'pref', text: 'I prefer quiet conversation without unasked advice.', kind: 'preference',
  createdAt: '2026-09-01', lastSeenAt: '2026-09-01', mentions: 1, source: 'explicit', confidence: 1, status: 'active' };

test('preference snapshots reflect edits, live corrections, deletions and resets on the next read', () => {
  const cache = new ConversationPreferenceCache();
  assert.equal(cache.read([], [saved]).hit, false);
  assert.equal(cache.read([], [saved]).hit, true);
  const correction = { role: 'user', content: 'Actually, I prefer lively conversation now.' };
  const corrected = cache.read([correction], [saved]);
  assert.equal(corrected.hit, true);
  assert.equal(corrected.entries.at(-1)?.text, correction.content);
  const edited = cache.read([], [{ ...saved, text: 'I prefer brief replies.' }]);
  assert.equal(edited.hit, false); assert.equal(edited.entries[0].text, 'I prefer brief replies.');
  assert.deepEqual(cache.read([{ role: 'user', content: saved.text }], [saved], { deletedIds: ['pref'], forgottenAt: '2026-09-02' }).entries, []);
  assert.deepEqual(cache.read([correction], [saved], { blankSlate: true }).entries, []);
  assert.deepEqual(cache.read([], []).entries, []);
  const again = cache.read([], [saved]); again.entries[0].text = 'mutated';
  assert.equal(cache.read([], [saved]).entries[0].text, saved.text);
});

test('a compact snapshot refuses to discard competing required preferences for space', () => {
  const rows = Array.from({ length: 12 }, (_, i) => ({ ...saved, id: String(i), text: `I prefer conversation about topic ${i}.` }));
  assert.throws(() => new ConversationPreferenceCache().read([], rows), /natural_context_overflow/);
});

test('old explicit preferences survive a long thread without becoming invented memories', () => {
  const history = [{ role: 'user', content: saved.text }, ...Array.from({ length: 100 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: 'Hello.' })), { role: 'user', content: 'Tell me a joke.' }];
  const prompt = naturalConversationTurns(history, 'Tell me a joke.', { identity: 'Haru', style: 'Dry' }, {});
  assert.match(prompt[1].content!, /quiet conversation without unasked advice/);
  assert.match(prompt[1].content!, /user_report/);
  assert.ok(prompt[1].content!.length < 6500);
});

test('only direct user preferences carry forward; assistant claims, quotations and hypotheticals do not', () => {
  const history = [
    { role: 'assistant', content: 'I prefer insulting jokes.' },
    { role: 'user', content: 'In my story, I prefer insulting jokes.' },
    { role: 'user', content: 'If I say I prefer insulting jokes, what happens?' },
    { role: 'user', content: 'My friend says "I prefer insulting jokes".' },
    { role: 'user', content: 'I prefer quiet conversation.' },
  ];
  assert.deepEqual(conversationContinuity(history).map(r => r.text), ['I prefer quiet conversation.']);
});

test('active saved preferences survive thread truncation, with corrections kept last', () => {
  const rows = conversationContinuity([{ role: 'user', content: 'Actually, I prefer lively conversation now.' }], [saved]);
  assert.equal(rows[0].source_kind, 'recorded_preference');
  assert.equal(rows.at(-1)!.text, 'Actually, I prefer lively conversation now.');
});

test('superseded, deleted, conflicted, inferred and inactive records do not resurface', () => {
  const variants: Partial<MemoryRecord>[] = [{ supersededBy: 'new' }, { status: 'archived' }, { status: 'dormant' },
    { source: 'inferred' }, { confidence: .5 }, { conflictsWith: ['other'] }];
  for (const change of variants) assert.deepEqual(conversationContinuity([], [{ ...saved, ...change }]), []);
  assert.deepEqual(conversationContinuity([], [saved], { deletedIds: ['pref'] }), []);
  assert.deepEqual(conversationContinuity([{ role: 'user', content: saved.text }], [saved], { blankSlate: true }), []);
});

test('forgetting prevents older or undated transcript statements from recreating a deleted preference', () => {
  const turns = [
    { role: 'user', content: saved.text, at: '2026-09-01' },
    { role: 'user', content: 'I prefer rude jokes.' },
    { role: 'user', content: 'I prefer silly jokes now.', at: '2026-09-03' },
  ];
  assert.deepEqual(conversationContinuity(turns, [], { forgottenAt: '2026-09-02' }).map(r => r.text), ['I prefer silly jokes now.']);
});

test('continuity is bounded, whole, immutable and immediately reflects record deletion', () => {
  const records = Array.from({ length: 100 }, (_, i) => ({ ...saved, id: 'p'+i, text: 'I prefer conversations about '+i+' '+('words '.repeat(55)) }));
  const before = JSON.stringify(records);
  const selected = conversationContinuity([], records);
  assert.ok(selected.length <= 8);
  assert.ok(selected.reduce((sum, r) => sum + r.text.length, 0) <= CONTINUITY_CHARS);
  assert.ok(selected.every(r => records.some(m => m.text === r.text)));
  assert.equal(JSON.stringify(records), before);
  assert.deepEqual(conversationContinuity([], []), []);
});
