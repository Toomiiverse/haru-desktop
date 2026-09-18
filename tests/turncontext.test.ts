import test from 'node:test';
import assert from 'node:assert/strict';
import { createTurnContext } from '../electron/turncontext';

test('machine access needs an explicit desk turn, including when web callers request hands', () => {
  assert.equal(createTurnContext().handsAllowed(), false);
  assert.equal(createTurnContext({ hands: true }).handsAllowed(), true);
  const phone = createTurnContext({ hands: true, web: true, choices: true });
  assert.equal(phone.handsAllowed(), false);
  assert.equal(phone.onWeb(), true);
  assert.equal(phone.offeringChoices(), false);
});

test('reading a page permanently withdraws only that turn, across asynchronous work', async () => {
  const reading = createTurnContext({ hands: true });
  reading.markPageRead();
  await Promise.resolve();
  const next = createTurnContext({ hands: true });
  assert.equal(reading.pageWasRead(), true);
  assert.equal(reading.handsAllowed(), false);
  assert.equal(next.pageWasRead(), false);
  assert.equal(next.handsAllowed(), true);
  next.withdrawHands();
  assert.equal(reading.pageWasRead(), true);
});

test('search results, choices and restart requests belong to the reply that produced them', () => {
  const first = createTurnContext({ hands: true, choices: true });
  const second = createTurnContext({ hands: true });
  const result = { title: 'First', url: 'https://example.com/first', snippet: 'first result' };
  first.rememberSearch('first question', [result]);
  first.setPendingChoices(['Yes', 'Later']);
  first.requestRestart();
  second.rememberSearch('second question', [{ ...result, url: 'https://example.com/second' }]);
  second.setPendingChoices(['Keep going', 'Stop']);

  assert.equal(first.lastSearchQuery(), 'first question');
  assert.equal(first.lastResults()[0].url, 'https://example.com/first');
  assert.deepEqual(first.pendingChoices(), ['Yes', 'Later']);
  assert.equal(first.restartRequested(), true);
  assert.equal(second.lastSearchQuery(), 'second question');
  assert.equal(second.lastResults()[0].url, 'https://example.com/second');
  assert.deepEqual(second.pendingChoices(), ['Keep going', 'Stop']);
  assert.equal(second.restartRequested(), false);
  const next = createTurnContext();
  assert.equal(next.lastSearchQuery(), '');
  assert.deepEqual(next.lastResults(), []);
  assert.deepEqual(next.pendingChoices(), []);
  assert.equal(next.restartRequested(), false);

  // Returned results and caller-owned input cannot mutate the held turn.
  result.url = 'https://example.com/changed';
  first.lastResults()[0].url = result.url;
  first.pendingChoices().push('Injected');
  assert.equal(first.lastResults()[0].url, 'https://example.com/first');
  assert.deepEqual(first.pendingChoices(), ['Yes', 'Later']);
});
