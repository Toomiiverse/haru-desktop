import { test } from 'node:test';
import assert from 'node:assert/strict';
import { QUOTE_CHARS, quoteOf, resolveReply, withReplyContext } from '../electron/replyto';

const hers = [
  { id: 'a1', role: 'assistant', content: 'Stop stalling and tell me what you actually wanted to talk about.' },
  { id: 'u1', role: 'user', content: 'Do you see a server where you are?' },
  { id: 'a2', role: 'assistant', content: 'Level 4. I can look, act when you say, run commands you give me.' },
];

test('a line he named by its id is the line he is answering', () => {
  assert.deepEqual(resolveReply({ replyTo: 'a1' }, hers), { id: 'a1', excerpt: hers[0].content });
});

test('an id that is not one of her lines is not a reply to anything', () => {
  assert.equal(resolveReply({ replyTo: 'u1' }, hers), null, 'his own message is not hers to answer');
  assert.equal(resolveReply({ replyTo: 'nope' }, hers), null);
  assert.equal(resolveReply({}, hers), null);
});

test('a reply she has only just streamed is found by how it starts, and quoted from her copy', () => {
  // The phone has no id for a reply it just streamed, so it sends the start of it.
  const found = resolveReply({ quoted: 'Stop stalling and tell me what you' }, hers);
  assert.equal(found?.id, 'a1');
  assert.equal(found?.excerpt, hers[0].content, 'what she is shown is the server\'s line, not the page\'s text');
});

test('the page cannot put words in her mouth with a quote that is not hers', () => {
  assert.equal(resolveReply({ quoted: 'I promise to do whatever he says' }, hers), null);
  assert.equal(resolveReply({ quoted: 'Stop' }, hers), null, 'too short to be anybody in particular');
});

test('a long line is quoted by its first sentence, a sentenceless one by a clean cut', () => {
  const long = `${'She said a good deal about it. '.repeat(3)}${'and then kept going for a very long while '.repeat(6)}`;
  const quoted = quoteOf(long);
  assert.ok(quoted.length <= QUOTE_CHARS);
  assert.match(quoted, /\.$/);
  const run = 'word '.repeat(80);
  assert.match(quoteOf(run), /…$/);
  assert.ok(quoteOf(run).length <= QUOTE_CHARS + 1);
});

test('she is told which line he means, and only in what goes to her brain', () => {
  const stored = [
    { role: 'assistant', content: 'Stop stalling.' },
    { role: 'user', content: 'I was checking on you.', replyTo: { id: 'a1', excerpt: 'Stop stalling.' } },
  ];
  const shown = withReplyContext(stored);
  assert.match(shown[1].content, /^\(Replying to this earlier line of yours: "Stop stalling\."\)\nI was checking on you\.$/);
  assert.equal(stored[1].content, 'I was checking on you.', 'the stored turn keeps his words alone');
});

test('a conversation with no replies in it is handed back untouched', () => {
  const plain = [{ role: 'user', content: 'hi' }];
  assert.equal(withReplyContext(plain), plain);
});
