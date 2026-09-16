import test from 'node:test';
import assert from 'node:assert/strict';
import {
  claimsAboutHer, deedFrom, deedsInstruction, DEEDS_KEPT, isADeed, keepDeed, readDeeds, recentDeeds, type Deed,
} from '../electron/deeds';

const NOW = Date.parse('2026-09-08T12:00:00.000Z');
const day = (iso: string) => iso.slice(0, 10);
const deed = (what: string, at = '2026-09-08T09:00:00.000Z', tool = 'change_setting'): Deed => ({ at, tool, what });

test('doing is a deed and looking is not', () => {
  for (const tool of ['change_setting', 'vault_write', 'stop_service', 'go_back_to_sleep', 'delete_kept_item']) {
    assert.equal(isADeed(tool), true, `${tool} should count`);
  }
  // A ledger that also recorded every search would bury the one line that matters.
  for (const tool of ['search_web', 'look_up_knowledge', 'get_system_info', 'vault_read', 'describe_myself']) {
    assert.equal(isADeed(tool), false, `${tool} is looking, not doing`);
  }
});

test('opening a Claude session is a deed and listing them is not', () => {
  assert.equal(deedFrom('claude_session', { action: 'open', folder: 'haru-desktop' }, false, '2026-09-16T10:00:00.000Z')!.what,
    'opened a Claude Code session for them in haru-desktop');
  assert.equal(deedFrom('claude_session', { action: 'stop', id: '2c4feebf' }, false, '2026-09-16T10:00:00.000Z')!.what, 'stopped a Claude Code session');
  assert.equal(deedFrom('claude_session', { action: 'list' }, false, '2026-09-16T10:00:00.000Z'), null);
  assert.equal(deedFrom('claude_session', { action: 'open' }, true, '2026-09-16T10:00:00.000Z'), null);
});

test('the deed reads like something she would say', () => {
  const made = deedFrom('change_setting', { name: 'random_pushes', value: false }, false, '2026-09-08T09:00:00.000Z');
  assert.match(made!.what, /changed your setting "random_pushes" to false/);
  assert.equal(deedFrom('go_back_to_sleep', { block: true }, false, NOW as unknown as string)!.what,
    'went back to sleep and told them not to wake you again tonight');
});

// The one direction the ledger must never lie in.
test('a tool that failed is not something she did', () => {
  assert.equal(deedFrom('stop_service', { name: 'obsidian' }, true, '2026-09-08T09:00:00.000Z'), null);
});

test('a look is never written down however it went', () => {
  assert.equal(deedFrom('search_web', { query: 'x' }, false, '2026-09-08T09:00:00.000Z'), null);
});

test('the ledger is bounded and keeps the newest', () => {
  let kept: Deed[] = [];
  for (let i = 0; i < DEEDS_KEPT + 20; i++) kept = keepDeed(kept, deed(`thing ${i}`));
  assert.equal(kept.length, DEEDS_KEPT);
  assert.equal(kept.at(-1)!.what, `thing ${DEEDS_KEPT + 19}`);
});

test('junk on disk is not a record of her conduct', () => {
  assert.deepEqual(readDeeds(null), []);
  assert.deepEqual(readDeeds([{ at: 'x' }]), []);
  assert.deepEqual(readDeeds([{ at: '2026-09-08T09:00:00.000Z', tool: 'change_setting', what: '  ' }]), []);
  assert.equal(readDeeds([deed('did a thing')]).length, 1);
});

test('last week is in front of her and last month is not', () => {
  const old = deed('changed something in August', '2026-08-01T09:00:00.000Z');
  const fresh = deed('changed something yesterday', '2026-09-07T09:00:00.000Z');
  assert.deepEqual(recentDeeds([old, fresh], NOW).map(d => d.what), ['changed something yesterday']);
});

// ---- the block, which is the only part that changes anything ----

test('the list says it is complete, or it is trivia she scrolls past', () => {
  const said = deedsInstruction([deed('changed your setting "random_pushes" to false')], NOW, day);
  assert.match(said, /2026-09-08: you changed your setting/);
  assert.match(said, /That list is complete/);
  assert.match(said, /never supply a reason for a thing you did not do/);
});

test('having done nothing is itself the answer', () => {
  // The failure being fixed is her filling a silence with a reason, so silence
  // has to say something.
  const said = deedsInstruction([], NOW, day);
  assert.match(said, /have not done anything/);
  assert.match(said, /they are mistaken/);
  assert.doesNotMatch(said, /That list is complete/);
});

// ---- the ledger only earns its room when he is claiming something ----

test('a claim about her conduct is recognised', () => {
  for (const said of [
    'why did you turn your notifications off',
    'you said yesterday you hated Chainsaw Man',
    'when did you decide to stop replying to me',
    'how come you deleted my reminder',
    'you never told me about that',
    "didn't you say you'd fixed it",
    'you keep forgetting my name',
  ]) assert.equal(claimsAboutHer(said), true, `missed: ${said}`);
});

test('an ordinary message does not drag the ledger in', () => {
  for (const said of [
    'How much power does a 5080 need',
    'Morning Haru',
    'I tried the other stick and it goes straight to C5',
    'what do you think of it so far',
    'can you check the weather',
  ]) assert.equal(claimsAboutHer(said), false, `wrongly matched: ${said}`);
});
