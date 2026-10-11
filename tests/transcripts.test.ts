// What was actually said in a video, and the one thing she must not claim.

import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchTranscript, formatTranscript, plainReason, titleFrom, TRANSCRIPT_CHARS, transcriptInstruction, videoIdFrom, watchUrl } from '../electron/transcripts';

test('every shape of link people actually paste', () => {
  const id = 'dQw4w9WgXcQ';
  for (const link of [
    `https://www.youtube.com/watch?v=${id}`,
    `https://youtube.com/watch?v=${id}&t=42s`,
    `https://m.youtube.com/watch?v=${id}`,
    `https://youtu.be/${id}`,
    `https://youtu.be/${id}?si=abc`,
    `https://www.youtube.com/shorts/${id}`,
    `https://www.youtube.com/embed/${id}`,
    `https://www.youtube.com/live/${id}`,
    `https://www.youtube-nocookie.com/embed/${id}`,
  ]) assert.equal(videoIdFrom(link), id, link);
  assert.equal(watchUrl(id), `https://www.youtube.com/watch?v=${id}`);
});

test('anything it cannot read is refused rather than guessed at', () => {
  // An id invented from a URL fetches somebody else's video.
  assert.equal(videoIdFrom('https://vimeo.com/12345'), null);
  assert.equal(videoIdFrom('https://www.youtube.com/watch?v=tooshort'), null);
  assert.equal(videoIdFrom('https://www.youtube.com/'), null);
  assert.equal(videoIdFrom('https://www.youtube.com/@somechannel'), null);
  assert.equal(videoIdFrom('not a url'), null);
  assert.equal(videoIdFrom(''), null);
  // Lookalike hostnames are not YouTube.
  assert.equal(videoIdFrom('https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ'), null);
  assert.equal(videoIdFrom('file:///etc/passwd'), null);
});

test('the title it was published under', () => {
  assert.equal(titleFrom('<meta name="title" content="How Bread Works - YouTube">'), 'How Bread Works');
  assert.equal(titleFrom('<title>Cats &amp; Dogs - YouTube</title>'), 'Cats & Dogs');
  assert.equal(titleFrom('<html></html>'), '');
});

test("the library's failures are said the way she would say them", () => {
  assert.equal(plainReason('NoTranscriptFound: \nCould not retrieve…'), 'There are no captions on it.');
  assert.equal(plainReason('TranscriptsDisabled: x'), 'Captions are turned off on that one.');
  assert.equal(plainReason('VideoUnavailable: x'), 'That video is not available.');
  assert.equal(plainReason('IpBlocked: x'), 'YouTube is refusing this machine right now.');
  assert.equal(plainReason('SomethingNew: x'), 'The transcript could not be read.');
});

// The bridge is a child process; here it is a function, so the shaping around
// it can be checked without YouTube in the loop.
type Run = Parameters<typeof fetchTranscript>[1];
const answering = (stdout: string, error: Error | null = null): Run =>
  ((_cmd: unknown, _args: unknown, _opts: unknown, cb: (e: Error | null, out: string) => void) => { cb(error, stdout); }) as unknown as Run;

test('what the bridge hands back is tidied, and empty is a failure not a silence', async () => {
  const got = await fetchTranscript('dQw4w9WgXcQ', answering(JSON.stringify({ language: 'en', generated: true, captions: [
    { atSeconds: 1, text: 'hello   there\nfriend' }, { atSeconds: 4, text: '   ' }, { atSeconds: 9, text: 'again' },
  ] })));
  assert.equal(got.language, 'en');
  assert.equal(got.generated, true);
  assert.deepEqual(got.captions, [{ atSeconds: 1, text: 'hello there friend' }, { atSeconds: 9, text: 'again' }]);
  await assert.rejects(fetchTranscript('dQw4w9WgXcQ', answering(JSON.stringify({ language: 'en', generated: false, captions: [] }))), /no captions/);
  await assert.rejects(fetchTranscript('dQw4w9WgXcQ', answering(JSON.stringify({ error: 'TranscriptsDisabled: nope' }))), /turned off/);
  await assert.rejects(fetchTranscript('dQw4w9WgXcQ', answering('not json', new Error('spawn failed'))), /reader failed/);
  await assert.rejects(fetchTranscript('dQw4w9WgXcQ', answering('{"weird": true}')), /nothing usable/);
  // A bad id never reaches the bridge.
  await assert.rejects(fetchTranscript('nope', answering('{}')), /not a video id/);
});
