// Whether a launch is the user coming back, or the service coming back.
import test from 'node:test';
import assert from 'node:assert/strict';
import { isRelaunchNotReturn, RETURN_AFTER_MINUTES } from '../electron/opening';

const NOW = Date.parse('2026-08-29T07:41:00.000Z');
const minutesAgo = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString();

test('a relaunch forty minutes after they last spoke is not a return', () => {
  const messages = [
    { role: 'user', at: minutesAgo(40) },
    { role: 'assistant', at: minutesAgo(39) },
  ];
  assert.equal(isRelaunchNotReturn(messages, NOW), true);
});

test('a launch after they have been gone long enough is a return', () => {
  const messages = [{ role: 'user', at: minutesAgo(RETURN_AFTER_MINUTES + 1) }, { role: 'assistant', at: minutesAgo(RETURN_AFTER_MINUTES) }];
  assert.equal(isRelaunchNotReturn(messages, NOW), false);
});

test('her own recent lines do not count as them being here', () => {
  const messages = [{ role: 'user', at: minutesAgo(300) }, { role: 'assistant', at: minutesAgo(5) }];
  assert.equal(isRelaunchNotReturn(messages, NOW), false);
});

test('nothing dated means nothing to go on, and the opening proceeds', () => {
  assert.equal(isRelaunchNotReturn([{ role: 'user' }, { role: 'assistant' }], NOW), false);
  assert.equal(isRelaunchNotReturn([], NOW), false);
});
