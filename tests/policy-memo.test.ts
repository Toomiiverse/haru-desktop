import test from 'node:test';
import assert from 'node:assert/strict';
import { MEMO_OPS } from '../electron/core-policy-sync';
import { currentTurn, runTimedTurn } from '../electron/turn-timing';

test('only pure per-turn getters are memoised', () => {
  // 3710: 14 (3290/3410) + 34 verified pure of their arguments. Changing this list needs the same per-op purity review.
  assert.deepEqual([...MEMO_OPS].sort(), [
    'agenda-life.get',
    'anime-downloads.config',
    'asides.missingIds',
    'asides.read',
    'attachments.vision',
    'conversation-policy.fuseOf',
    'conversation-policy.readTraits',
    'conversation-program.todaysExamples',
    'conversation-program.weatherState',
    'credit-guard.conversationRoute',
    'device-activity.readFollowing',
    'device-activity.readsAsDropIt',
    'diary.context',
    'diary.parseEntries',
    'feelings.readFeelings',
    'final-anilist.config',
    'final-downloads.config',
    'final-search.config',
    'final-sessions.config',
    'final-shell.available',
    'final-system.config',
    'knowledge-index.config',
    'location.readWhereabouts',
    'manga-fetch.config',
    'memory-admin.known',
    'memory-admin.profile',
    'memory-admin.readSlate',
    'memory-tools.normalizeFile',
    'mood.currentTemperament',
    'mood.normalize',
    'natural-policy.contextDefault',
    'natural-policy.isRemote',
    'natural-turn.selectionObserved',
    'natural-turn.selectionStart',
    'own-time.nightlastNightDay',
    'own-time.nightnightsInstruction',
    'own-time.nightnightsOn',
    'projects.readInterests',
    'route-admission.allowed',
    'route-admission.local',
    'route-admission.taskPolicy',
    'self.explicitModeOn',
    'sleep.availability',
    'sleep.readHerSleepState',
    'tastes.tastesInstruction',
    'user-records.missingIds',
    'user-records.readCheckins',
    'user-records.readConfig']);
});

test('a turn has one identity for its whole run and none outside it', async () => {
  assert.equal(currentTurn(), undefined);
  const seen: unknown[] = [];
  await runTimedTurn('t', async () => { seen.push(currentTurn()); await Promise.resolve(); seen.push(currentTurn()); }, () => {});
  await runTimedTurn('u', async () => { seen.push(currentTurn()); }, () => {});
  assert.ok(seen[0] && seen[0] === seen[1] && seen[2] && seen[2] !== seen[0]);
  assert.equal(currentTurn(), undefined);
});

test('span lines are held until the turn ends; other stages go out at once', async () => {
  const { timingFor } = await import('../electron/turn-timing');
  const out: string[] = [];
  const mark = timingFor('t', e => out.push(e.stage + (e.operation ? ':' + e.operation : '')));
  mark('runner_start'); mark('policy_span', { operation: 'a.b', durationMs: 1 }); mark('storage_span', { step: 'commit', durationMs: 2 }); mark('dispatch');
  assert.deepEqual(out, ['runner_start', 'dispatch']);
  mark('runner_end', { status: 'ok', durationMs: 3 });
  assert.deepEqual(out, ['runner_start', 'dispatch', 'runner_end', 'policy_span:a.b', 'storage_span']);
  mark('storage_span', { step: 'behind', durationMs: 1 });
  assert.equal(out.length, 6);
});

test('a policy span carries the Core clock and the wire sizes when given, and drops junk', async () => {
  const { timingFor } = await import('../electron/turn-timing');
  const out: any[] = [];
  const mark = timingFor('t2', e => out.push(e));
  mark('policy_span', { operation: 'a.b', durationMs: 4, coreMs: 1.2, bytes: 900, replyBytes: 300 } as any);
  mark('policy_span', { operation: 'a.c', durationMs: 1, coreMs: -1, bytes: Number.NaN } as any);
  mark('runner_end', { status: 'ok', durationMs: 5 });
  const [first, second] = out.filter(e => e.stage === 'policy_span');
  assert.equal(first.coreMs, 1.2); assert.equal(first.bytes, 900); assert.equal(first.replyBytes, 300);
  assert.equal('coreMs' in second, false); assert.equal('bytes' in second, false);
});

test('3710: the verified-pure ops join the per-turn memo, and the ones with no repeat hits stay out', async () => {
  const { MEMO_OPS } = await import('../electron/core-policy-sync');
  for (const op of ['natural-policy.isRemote', 'feelings.readFeelings', 'route-admission.allowed', 'mood.currentTemperament', 'sleep.availability', 'diary.context', 'anime-downloads.config', 'credit-guard.conversationRoute'])
    assert.ok(MEMO_OPS.has(op), op);
  for (const op of ['route-admission.billingProbe', 'memory-admin.activeCharacter', 'route-admission.registry', 'inference-priority.interaction', 'route-admission.candidates', 'agenda-life.acknowledge'])
    assert.ok(!MEMO_OPS.has(op), op);
  assert.equal(MEMO_OPS.size, 14 + 34);
});
