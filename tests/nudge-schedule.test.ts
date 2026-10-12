import test from 'node:test';
import assert from 'node:assert/strict';
import { addAside, type Aside } from '../electron/asides';
import { conversationNudgeCandidates, taskNudgeCandidates } from '../electron/nudge-context';
import { learnNudgeResponse, rateNudge, type NudgeSignal } from '../electron/nudge-learning';
import { ownNudgeCandidates, type NudgeCandidate } from '../electron/nudges';
import {
  emptyPhoneNudges, finishPhoneDelivery, learnPhoneReply, migratePhoneDeliveries, PHONE_NUDGE_GAP_MS, PHONE_NUDGE_LIMIT,
  phoneCandidateRelevant, phoneDeliveryAllowed, phoneOpportunityDelay, phoneOpportunityId,
  phoneSilenceWeight, phoneWindowWeight, readPhoneNudges, reservePhoneDelivery, scanPhoneOpportunities,
  selectPhoneOpportunity, type PhoneNudgeState,
} from '../electron/nudge-schedule';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const now = Date.parse('2026-09-27T04:00:00Z'); // noon Perth
const iso = (at = now) => new Date(at).toISOString();
const localHour = (at: number) => (new Date(at).getUTCHours() + 8) % 24;
const state = (): PhoneNudgeState => ({ ...emptyPhoneNudges(), scannedAt: now - MINUTE });
const candidate = (key = 'camera optics', kind: NudgeCandidate['subject']['kind'] = 'own'): NudgeCandidate => ({
  weight: 1, subject: { key, kind, revision: `revision:${key}`, occurredAt: iso(), expiresAt: iso(now + 6 * HOUR),
    material: `Recorded thoughts about ${key}.`, instruction: '', keywords: key.split(' ') },
});
function scan(s = state(), candidates = [candidate()], at = now, extra: Partial<Parameters<typeof scanPhoneOpportunities>[0]> = {}) {
  return scanPhoneOpportunities({ state: s, candidates, asides: [], learning: [], messages: [], now: at,
    blocked: false, hourAt: localHour, random: () => 0, ...extra });
}
function due(candidates = [candidate()]) {
  const s = scan(state(), candidates);
  return { ...s, pending: s.pending.map(p => ({ ...p, dueAt: now })) };
}
function delivered(s: PhoneNudgeState, id: string, at: number, day = '2026-09-27', hour = localHour(at)) {
  const reserved = reservePhoneDelivery(s, id, at, day, hour);
  assert.ok(reserved);
  return finishPhoneDelivery(reserved, id, true);
}

test('fresh and casual timing use their distinct delay ranges', () => {
  assert.equal(phoneOpportunityDelay(true, () => 0), 5 * MINUTE);
  assert.equal(phoneOpportunityDelay(true, () => 1), 25 * MINUTE);
  assert.equal(phoneOpportunityDelay(false, () => 0), 30 * MINUTE);
  assert.equal(phoneOpportunityDelay(false, () => 1), 120 * MINUTE);
  assert.equal(scan().pending[0].dueAt, now + 5 * MINUTE);
  assert.equal(scan(state(), [candidate('callback topic', 'callback')]).pending[0].dueAt, now + 30 * MINUTE);
});

test('no material means no notification, even after hours or days of silence', () => {
  let s = state();
  for (let minute = 0; minute < 3 * 24 * 60; minute++) s = scan(s, [], now + minute * MINUTE);
  assert.deepEqual(s.pending, []);
  assert.equal(selectPhoneOpportunity(s, [], [], [], [], now + 3 * 24 * HOUR), null);
});

test('one event gets one admission roll; skipped events are never repeatedly tried', () => {
  const c = candidate();
  const skipped = scan(state(), [c], now, { random: () => 0.99 });
  assert.equal(skipped.pending.length, 0);
  assert.equal(scan(skipped, [c], now + MINUTE).pending.length, 0);
  const admitted = scan();
  assert.equal(scan(admitted, [c], now + MINUTE).pending.length, 1);
  const claimed = { ...admitted, pending: [] };
  assert.equal(scan(claimed, [c], now + MINUTE).pending.length, 0, 'PASS never requeues the event');
});

test('first run and restart establish a baseline and never catch up a backlog', () => {
  assert.equal(scan(emptyPhoneNudges()).pending.length, 0);
  const pending = scan();
  assert.equal(scan({ ...pending, scannedAt: 0 }).pending.length, 0);
  const rebooted = scan({ ...pending, scannedAt: 0 });
  assert.equal(scan(rebooted, [candidate()], now + MINUTE).pending.length, 0);
  assert.equal(scan(rebooted, [candidate('fresh newtopic')], now + MINUTE).pending.length, 1);
});

test('sleep, Focus, disabled notifications and missing phone discard rather than defer', () => {
  const blocked = scan(scan(), [candidate()], now + MINUTE, { blocked: true });
  assert.equal(blocked.pending.length, 0);
  assert.equal(scan(blocked, [candidate()], now + 2 * MINUTE).pending.length, 0);
  const unseenWhileBlocked = candidate('overnight article');
  const observed = scan(blocked, [unseenWhileBlocked], now + 2 * MINUTE, { blocked: true });
  assert.equal(scan(observed, [unseenWhileBlocked], now + 3 * MINUTE).pending.length, 0);
});

test('a stalled server and missed delivery window do not create a reconnect burst', () => {
  assert.equal(scan(scan(), [candidate()], now + 11 * MINUTE).pending.length, 0);
  const late = { ...due(), scannedAt: now + 10 * MINUTE };
  assert.equal(scan(late, [candidate()], now + 11 * MINUTE).pending.length, 0);
});

test('expired, future, undated and invalid material cannot enter the queue', () => {
  for (const changes of [{ expiresAt: iso(now) }, { occurredAt: iso(now + MINUTE) }, { occurredAt: undefined }, { occurredAt: 'invalid' }]) {
    const c = candidate(); c.subject = { ...c.subject, ...changes };
    assert.equal(scan(state(), [c]).pending.length, 0);
  }
  const tooShort = candidate(); tooShort.subject.expiresAt = iso(now + MINUTE);
  assert.equal(scan(state(), [tooShort]).pending.length, 0, 'random delay must fit before expiry');
});

test('an opportunity disappears when its source is gone or the task changed', () => {
  const task = taskNudgeCandidates([{ id: '1', kind: 'task', title: 'Repair kitchen shelves', underway: iso() }], now, 4 * HOUR)[0];
  const s = scan(state(), [task]);
  assert.equal(s.pending.length, 1);
  assert.equal(scan(s, [], now + MINUTE).pending.length, 0);
  const done = taskNudgeCandidates([{ id: '1', kind: 'task', title: 'Repair kitchen shelves', done: true, completedAt: iso(now + MINUTE) }], now + MINUTE, 4 * HOUR)[0];
  const updated = scan(s, [done], now + MINUTE);
  assert.equal(updated.pending.length, 1);
  assert.notEqual(updated.pending[0].id, s.pending[0].id);
});

test('phone reading expires sooner than background knowledge and needs an actual take', () => {
  const input = { nights: [], days: [{ at: iso(), day: '2026-09-27', about: 'Camera optics', note: 'Fixed focal lengths force better framing.', sources: [] }], finished: [], interests: [], asides: [], now };
  const c = ownNudgeCandidates(input)[0];
  assert.equal(phoneCandidateRelevant(c, [], [], [], now), true);
  assert.equal(phoneCandidateRelevant(c, [], [], [], now + 6 * HOUR), false);
  assert.equal(ownNudgeCandidates({ ...input, days: [{ ...input.days[0], note: '' }] }).length, 0);
});

test('a later topical message invalidates the old callback, unrelated chat does not', () => {
  const message = { role: 'user', at: iso(), content: 'I am redesigning the camera optics guide for beginners.' };
  const c = conversationNudgeCandidates([message], now)[0];
  assert.ok(c);
  const topical = { role: 'user', at: iso(now + MINUTE), content: 'The camera optics guide is published and finished.' };
  assert.equal(phoneCandidateRelevant(c, [], [], [message, topical], now + MINUTE), false);
  assert.equal(phoneCandidateRelevant(c, [], [], [message, { ...topical, content: 'Fresh pineapple arrived for lunch.' }], now + MINUTE), true);
});

test('a source revision remains stable when prompt linkage changes', () => {
  const c = candidate();
  assert.equal(phoneOpportunityId(c), phoneOpportunityId({ ...c, subject: { ...c.subject, material: `${c.subject.material}\nRelated human words.` } }));
  assert.notEqual(phoneOpportunityId(c), phoneOpportunityId({ ...c, subject: { ...c.subject, revision: 'new observation' } }));
});

test('feedback while waiting cancels a pending opportunity immediately', () => {
  const c = candidate();
  const previous = addAside([], 'Camera optics have improved.', 'idle', new Date(now - 25 * HOUR), '2026-09-26', '', c.subject.key, 'own', { nudgeKeywords: ['camera', 'optics'] }).aside;
  const pending = scan();
  for (const choice of ['less', 'discussed'] as const) {
    const rated = rateNudge([previous], [], previous.id, choice, now)!;
    assert.equal(scan(pending, [c], now + MINUTE, { asides: rated.asides, learning: rated.learning }).pending.length, 0);
    assert.equal(selectPhoneOpportunity(due(), [c], rated.asides, rated.learning, [], now), null);
  }
});

test('More like this increases admission odds; silence reduces them', () => {
  const c = candidate('camera optics', 'callback');
  const signal: NudgeSignal = { asideId: 'old', topic: c.subject.key, terms: ['camera', 'optics'], at: iso(now - HOUR), choice: 'more' };
  assert.equal(scan(state(), [c], now, { random: () => 0.5 }).pending.length, 0);
  assert.equal(scan(state(), [c], now, { learning: [signal], random: () => 0.5 }).pending.length, 1);
  const unanswered = delivered(state(), 'old', now - 5 * HOUR);
  assert.equal(phoneSilenceWeight(unanswered, [], now), 0.7);
  assert.equal(scan(unanswered, [c], now, { random: () => 0.3, state: { ...unanswered, scannedAt: now - MINUTE } }).pending.length, 0);
});

test('daily ceiling is three deliveries with at least 90 minutes between them', () => {
  assert.equal(PHONE_NUDGE_LIMIT, 3);
  let s = delivered(state(), 'one', now);
  assert.equal(phoneDeliveryAllowed(s, now + PHONE_NUDGE_GAP_MS - 1, '2026-09-27'), false);
  s = delivered(s, 'two', now + PHONE_NUDGE_GAP_MS);
  s = delivered(s, 'three', now + 2 * PHONE_NUDGE_GAP_MS);
  assert.equal(reservePhoneDelivery(s, 'four', now + 5 * HOUR, '2026-09-27', 17), null);
  assert.equal(phoneDeliveryAllowed(s, now + 24 * HOUR, '2026-09-28'), true);
});

test('midnight resets the local-day ceiling but never the minimum gap', () => {
  const s = delivered(state(), 'night', now, '2026-09-27', 23);
  assert.equal(phoneDeliveryAllowed(s, now + 30 * MINUTE, '2026-09-28'), false);
  assert.equal(phoneDeliveryAllowed(s, now + 90 * MINUTE, '2026-09-28'), true);
});

test('upgrade counts existing spontaneous deliveries but excludes requested alerts and failures', () => {
  const a: Aside = { id: 'one', at: iso(now - MINUTE), day: '2026-09-27', source: 'idle', text: 'Hello.', reached: true };
  const migrated = migratePhoneDeliveries([a, { ...a, id: 'event', source: 'reminder' }, { ...a, id: 'booking', source: 'booked' },
    { ...a, id: 'traffic', source: 'booked', about: 'traffic Perth' }, { ...a, id: 'failed', reached: false }], now,
    () => ({ day: '2026-09-27', hour: 12 }));
  assert.deepEqual(migrated.deliveries.map(d => d.id), ['one', 'booking']);
  assert.equal(phoneDeliveryAllowed(migrated, now, '2026-09-27'), false);
});

test('persisted reservations prevent overlapping senders and restart duplicates', async () => {
  let saved = state(); let resolve!: () => void;
  const network = new Promise<void>(done => { resolve = done; });
  async function send(id: string) {
    const reservation = reservePhoneDelivery(saved, id, now, '2026-09-27', 12);
    if (!reservation) return false;
    saved = reservation;
    await network;
    saved = finishPhoneDelivery(saved, id, true);
    return true;
  }
  const first = send('one');
  assert.equal(await send('two'), false);
  saved = readPhoneNudges(JSON.parse(JSON.stringify(saved)), now);
  assert.equal(reservePhoneDelivery(saved, 'one', now, '2026-09-27', 12), null);
  resolve(); assert.equal(await first, true);
  assert.equal(saved.deliveries.length, 1);
});

test('transport failures free the budget but cannot retry the same message', () => {
  const reserved = reservePhoneDelivery(state(), 'one', now, '2026-09-27', 12)!;
  const failed = finishPhoneDelivery(reserved, 'one', false);
  assert.equal(phoneDeliveryAllowed(failed, now, '2026-09-27'), true);
  assert.equal(reservePhoneDelivery(failed, 'one', now, '2026-09-27', 12), null);
  assert.ok(reservePhoneDelivery(failed, 'new-event', now, '2026-09-27', 12));
});

test('only a matched reply teaches its actual local response window', () => {
  const a: Aside = { id: 'one', at: iso(), day: '2026-09-27', source: 'idle', text: 'Camera optics?', nudgeTopic: 'camera optics', reached: true, nudgeKeywords: ['camera', 'optics'] };
  const s = delivered(state(), 'one', now, '2026-09-27', 12);
  assert.equal(learnNudgeResponse([a], [], [{ role: 'user', content: 'Hello again', at: iso(now + HOUR) }], now + HOUR), null);
  const response = learnNudgeResponse([a], [], [{ role: 'user', content: 'Those camera optics are impressive.', at: iso(now + HOUR) }], now + HOUR)!;
  const learned = learnPhoneReply(s, response.learning[0].asideId, 15, now + HOUR);
  assert.equal(learned.deliveries[0].repliedHour, 15);
  assert.ok(phoneWindowWeight(learned, response.learning, 15, now + HOUR) > phoneWindowWeight(learned, response.learning, 9, now + HOUR));
  assert.equal(learnPhoneReply(learned, 'one', 18, now + 2 * HOUR).deliveries[0].repliedHour, 15, 'credit once');
  assert.equal(learnPhoneReply(s, 'one', 19, now + 4 * HOUR).deliveries[0].repliedHour, undefined, 'late replies are not timing evidence');
});

test('unanswered and disliked windows reduce odds without making silence a debt', () => {
  const s = delivered(state(), 'one', now - 5 * HOUR, '2026-09-27', 12);
  assert.ok(phoneWindowWeight(s, [], 12, now) < 1);
  assert.equal(phoneWindowWeight(s, [], 9, now), 1);
  assert.equal(phoneSilenceWeight(finishPhoneDelivery(s, 'one', false), [], now), 1);
  const feedback: NudgeSignal[] = [{ asideId: 'one', topic: 'camera', terms: [], at: iso(), choice: 'less' }];
  assert.ok(phoneWindowWeight(s, feedback, 12, now) < phoneWindowWeight(s, [], 12, now));
});

test('wildcards can choose a lower-priority grounded topic but never blocked material', () => {
  const main = { ...candidate('priority subject', 'task'), priority: 1 };
  const side = candidate('quiet hobby', 'own');
  const s = due([main, side]);
  const rolls = [0, 0.99];
  assert.equal(selectPhoneOpportunity(s, [main, side], [], [], [], now, () => rolls.shift()!)?.candidate, side);
  assert.equal(selectPhoneOpportunity(s, [main, side], [], [], [], now, () => 0.5)?.candidate, main);
  side.subject.expiresAt = iso(now);
  assert.equal(selectPhoneOpportunity(s, [main, side], [], [], [], now, () => 0)?.candidate, main);
});

test('state reading bounds history and rejects malformed timing records', () => {
  const s = readPhoneNudges({ version: 1, scannedAt: NaN, pending: [null, { id: 'bad', topic: 'bad', dueAt: 'soon', expiresAt: now + HOUR }],
    seen: [{ id: 'old', at: now - 8 * 24 * HOUR }, { id: 'future', at: now + 1 }],
    deliveries: [{ id: 'bad', at: now, day: '2026-09-27', hour: 24, status: 'sent' }, null] }, now);
  assert.deepEqual(s, emptyPhoneNudges());
  assert.deepEqual(readPhoneNudges(null, now), emptyPhoneNudges());
});
