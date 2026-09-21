// Whether a launch is the user coming back, or the service coming back.
import test from 'node:test';
import assert from 'node:assert/strict';
import { isRelaunchNotReturn, RETURN_AFTER_MINUTES, shouldPipeUp } from '../electron/opening';

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

test('a conversation with nothing but her own lines in it is still a relaunch', () => {
  // What a reset leaves: no word from him at all. The guard used to fall through
  // to false here, so every restart added another opening — and with her own line
  // the only thing in front of her, the model echoed it word for word.
  const messages = [{ role: 'assistant', at: minutesAgo(23) }];
  assert.equal(isRelaunchNotReturn(messages, NOW), true);
  assert.equal(isRelaunchNotReturn([{ role: 'assistant', at: minutesAgo(RETURN_AFTER_MINUTES + 1) }], NOW), false, 'but after two hours she may speak again');
});

test('nothing dated means nothing to go on, and the opening proceeds', () => {
  assert.equal(isRelaunchNotReturn([{ role: 'user' }, { role: 'assistant' }], NOW), false);
  assert.equal(isRelaunchNotReturn([], NOW), false);
});

test('her own boredom, and a day of his silence, shorten how long she sits waiting', () => {
  const idle = { minutesSinceSheSpoke: 30, machineIdleSeconds: 10, curiosity: 0.5, sleepiness: 0.2 };
  const always = () => 0;
  // At twelve minutes she is not due on an ordinary afternoon...
  assert.equal(shouldPipeUp({ ...idle, minutesSinceUserSpoke: 12, boredom: 0, missing: 0 }, always), false);
  // ...and she is, once a quiet room has got to her.
  assert.equal(shouldPipeUp({ ...idle, minutesSinceUserSpoke: 12, boredom: 90, missing: 0 }, always), true);
  assert.equal(shouldPipeUp({ ...idle, minutesSinceUserSpoke: 12, boredom: 0, missing: 100 }, always), true);
  // However bored, she never prods within five minutes of his last word.
  assert.equal(shouldPipeUp({ ...idle, minutesSinceUserSpoke: 4, boredom: 100, missing: 100 }, always), false);
  assert.equal(shouldPipeUp({ ...idle, minutesSinceUserSpoke: 6, boredom: 100, missing: 100 }, always), true);
  // With no counter passed, low curiosity stands in for it, as it always did.
  assert.equal(shouldPipeUp({ ...idle, minutesSinceUserSpoke: 12, curiosity: 0 }, always), true);
  assert.equal(shouldPipeUp({ ...idle, minutesSinceUserSpoke: 12, curiosity: 1 }, always), false);
});
