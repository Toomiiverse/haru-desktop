// Speech to speech, the pure part: the config, the session settings, what the
// brain hook makes of Hume's request, what it streams back, and the little
// translation between Hume's socket and the phone's. The socket itself is in
// the bridge test below; the routes are in webserver.test.ts.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  readEviConfig, DEFAULT_EVI, sessionSettingsFor, newSessionId, deviceFromSession, audioInput,
  relay, clmTurnFrom, withoutExpressionNote, sseChunk, sseStop, SSE_DONE, secondsUsedToday, noteUsage, underCap,
  callAside, CALL_ASIDE, spokenReply,
} from '../electron/evi';
import { INTERRUPTED_ASIDE } from '../electron/wake';
import { openEviSession } from '../electron/evibridge';

// -- config ----------------------------------------------------------------------

test('readEviConfig reads a partial record forward and refuses nonsense', () => {
  assert.deepEqual(readEviConfig(undefined), DEFAULT_EVI);
  assert.deepEqual(readEviConfig('no'), DEFAULT_EVI);
  const read = readEviConfig({ enabled: true, configId: ' abc ', publicUrl: 'https://x/api/evi/chat/completions', dailyMinutesCap: 12.7, usage: { day: 'x', seconds: 3 } });
  assert.equal(read.enabled, true);
  assert.equal(read.configId, 'abc');
  assert.equal(read.publicUrl, 'https://x/api/evi/chat/completions');
  assert.equal(read.dailyMinutesCap, 12);
  assert.equal(readEviConfig({ enabled: 'yes' }).enabled, false, 'only a real true switches it on');
  assert.equal(readEviConfig({ dailyMinutesCap: -4 }).dailyMinutesCap, 0);
  assert.equal(readEviConfig({ dailyMinutesCap: 'lots' }).dailyMinutesCap, DEFAULT_EVI.dailyMinutesCap);
});

// -- the socket to Hume ------------------------------------------------------------

test('session settings carry the audio format, the session id and the hook bearer', () => {
  const settings = sessionSettingsFor('dev.abc', 's3cret');
  assert.equal(settings.type, 'session_settings');
  assert.equal(settings.custom_session_id, 'dev.abc');
  assert.deepEqual(settings.audio, { encoding: 'linear16', sample_rate: 16000, channels: 1 });
  assert.equal(settings.language_model_api_key, 's3cret');
});

test('a session id names its device and survives the trip back', () => {
  const id = newSessionId('tok-en_1', 'a1b2c3');
  assert.equal(id, 'tok-en_1.a1b2c3');
  assert.equal(deviceFromSession(id), 'tok-en_1');
  // Characters that would upset a query string or a log line are dropped.
  assert.equal(newSessionId('a.b/c d', 'n?o'), 'abcd.no');
  assert.equal(deviceFromSession('plain'), 'plain');
});

test('audio goes up as base64 in an audio_input message', () => {
  const pcm = new Uint8Array([0, 1, 2, 250, 255]);
  const message = audioInput(pcm);
  assert.equal(message.type, 'audio_input');
  assert.deepEqual([...Buffer.from(message.data, 'base64')], [0, 1, 2, 250, 255]);
  // A view into a bigger buffer sends only its own bytes.
  const big = new Uint8Array([9, 9, 7, 8, 9, 9]);
  assert.deepEqual([...Buffer.from(audioInput(big.subarray(2, 4)).data, 'base64')], [7, 8]);
});

test('relay keeps what the phone needs and drops the rest', () => {
  assert.deepEqual(relay({ type: 'chat_metadata', chat_id: 'c1', chat_group_id: 'g1', request_id: 'r' }), { type: 'chat_metadata', chatId: 'c1', chatGroupId: 'g1' });
  assert.deepEqual(relay({ type: 'user_message', message: { role: 'user', content: 'hey' }, models: { prosody: { scores: { Joy: 0.5 } } }, interim: false }), { type: 'user_message', text: 'hey', interim: false });
  assert.deepEqual(relay({ type: 'user_message', message: { content: 'he' }, interim: true }), { type: 'user_message', text: 'he', interim: true });
  assert.deepEqual(relay({ type: 'assistant_message', id: 'm1', message: { content: 'What.' } }), { type: 'assistant_message', text: 'What.', id: 'm1' });
  assert.deepEqual(relay({ type: 'audio_output', id: 'm1', index: 2, data: 'UklGRg==' }), { type: 'audio_output', data: 'UklGRg==', id: 'm1', index: 2 });
  assert.equal(relay({ type: 'audio_output', id: 'm1', data: '' }), null, 'an empty audio message is nothing to play');
  assert.deepEqual(relay({ type: 'assistant_end' }), { type: 'assistant_end' });
  assert.deepEqual(relay({ type: 'user_interruption', time: 1 }), { type: 'user_interruption' });
  assert.deepEqual(relay({ type: 'error', message: 'nope', code: 'E1', slug: 'bad' }), { type: 'error', message: 'nope', code: 'E1', slug: 'bad' });
  assert.equal(relay({ type: 'tool_call' }), null);
  assert.equal(relay({ type: 'assistant_prosody' }), null);
  assert.equal(relay('x'), null);
  assert.equal(relay(null), null);
});

// -- the brain hook ------------------------------------------------------------------

/** What Hume actually posts: the whole call so far, OpenAI-shaped, prosody beside each spoken line. */
const HUME_BODY = {
  messages: [
    { role: 'system', content: 'You are Haru.' },
    { role: 'user', content: 'Hey Haru.', models: { prosody: { scores: { Joy: 0.3, Anger: 0.01 } } }, time: { begin: 0, end: 800 } },
    { role: 'assistant', content: 'What.' },
    { role: 'user', content: '  Are you even listening?  ', models: { prosody: { scores: { Anger: 0.42, Irritation: 0.31, Joy: 'no' } } }, time: { begin: 4000, end: 5900 } },
  ],
  stream: true,
};

test('the hook takes the newest thing they said, with how it sounded, and nothing else', () => {
  const turn = clmTurnFrom(HUME_BODY);
  assert.ok(turn);
  assert.equal(turn.text, 'Are you even listening?');
  assert.deepEqual(turn.prosody, { Anger: 0.42, Irritation: 0.31 }, 'scores that are not numbers are left out');
});

test('the note EVI writes about how they sounded is not something they said', () => {
  // Seen on the wire 2026-09-05: the expression summary rides inside the text.
  assert.equal(withoutExpressionNote('You are aware of that fine whatever. {extremely contemptuous, extremely angry, quite disappointed}'), 'You are aware of that fine whatever.');
  assert.equal(withoutExpressionNote('Fine. {calm}'), 'Fine.');
  assert.equal(withoutExpressionNote('Plain words.'), 'Plain words.');
  assert.equal(withoutExpressionNote('braces {in the middle} stay'), 'braces {in the middle} stay');
  assert.equal(withoutExpressionNote('{only a note}'), '', 'a note with no words is nothing said');
  const turn = clmTurnFrom({ messages: [{ role: 'user', content: 'Hey. {quite amused}', models: { prosody: { scores: { Amusement: 0.7 } } } }] });
  assert.deepEqual(turn, { text: 'Hey.', prosody: { Amusement: 0.7 } });
  assert.equal(clmTurnFrom({ messages: [{ role: 'user', content: '{extremely calm}' }] }), null);
});

test('the hook reads a parts list, and refuses a body with nothing said', () => {
  const parts = clmTurnFrom({ messages: [{ role: 'user', content: [{ type: 'text', text: 'one ' }, { type: 'text', text: 'two' }] }] });
  assert.deepEqual(parts, { text: 'one two', prosody: null });
  assert.equal(clmTurnFrom({ messages: [{ role: 'assistant', content: 'Hm.' }] }), null);
  assert.equal(clmTurnFrom({ messages: [{ role: 'user', content: '   ' }] }), null);
  assert.equal(clmTurnFrom({ messages: 'x' }), null);
  assert.equal(clmTurnFrom(null), null);
  assert.deepEqual(clmTurnFrom({ messages: [{ role: 'user', content: 'hi', models: { prosody: { scores: {} } } }] }), { text: 'hi', prosody: null }, 'an empty score sheet is no reading');
});

test('what streams back is an OpenAI chunk per stretch, a stop, and DONE', () => {
  const chunk = sseChunk('Fine, ', 'haru-1', 1700000000);
  assert.ok(chunk.startsWith('data: ') && chunk.endsWith('\n\n'));
  const parsed = JSON.parse(chunk.slice(6)) as { object: string; id: string; created: number; choices: { delta: { content?: string; role?: string }; finish_reason: null | string }[] };
  assert.equal(parsed.object, 'chat.completion.chunk');
  assert.equal(parsed.id, 'haru-1');
  assert.equal(parsed.created, 1700000000);
  assert.equal(parsed.choices[0].delta.content, 'Fine, ');
  assert.equal(parsed.choices[0].finish_reason, null);
  const stop = JSON.parse(sseStop('haru-1', 1700000000).slice(6)) as typeof parsed;
  assert.equal(stop.choices[0].finish_reason, 'stop');
  assert.deepEqual(stop.choices[0].delta, {});
  assert.equal(SSE_DONE, 'data: [DONE]\n\n');
});

test('a call turn asks for spoken sentences, and says so after being cut off too', () => {
  assert.equal(callAside(false), CALL_ASIDE);
  assert.ok(callAside(true).startsWith(INTERRUPTED_ASIDE));
  assert.ok(callAside(true).endsWith(CALL_ASIDE));
  // Nothing in the aside she could say back as a line of her own.
  assert.doesNotMatch(CALL_ASIDE, /["“”]/);
});

test('what goes to her voice is the reply made speakable', () => {
  assert.equal(spokenReply('**Fine.** Check the CPU, not the *fans*. 😒 See [this](https://x.y).'), 'Fine. Check the CPU, not the fans. See this.');
  assert.equal(spokenReply('HELLO there.'), 'Hello there.', 'a shouted word is lowered, not spelled');
});

// -- the cap -----------------------------------------------------------------------------

test('the day\'s minutes are counted on the chat\'s day and start over on the next', () => {
  assert.equal(secondsUsedToday(undefined, '2026-09-05'), 0);
  assert.equal(secondsUsedToday({ day: '2026-09-04', seconds: 900 }, '2026-09-05'), 0, 'yesterday does not count');
  assert.equal(secondsUsedToday({ day: '2026-09-05', seconds: 900 }, '2026-09-05'), 900);
  assert.deepEqual(noteUsage({ day: '2026-09-05', seconds: 900 }, '2026-09-05', 61.4), { day: '2026-09-05', seconds: 961 });
  assert.deepEqual(noteUsage({ day: '2026-09-04', seconds: 900 }, '2026-09-05', 10), { day: '2026-09-05', seconds: 10 });
  assert.equal(underCap({ day: '2026-09-05', seconds: 3599 }, '2026-09-05', 60), true);
  assert.equal(underCap({ day: '2026-09-05', seconds: 3600 }, '2026-09-05', 60), false);
  assert.equal(underCap(undefined, '2026-09-05', 0), false, 'a cap of nothing is off');
});

// -- the bridge --------------------------------------------------------------------------

/** A WebSocket as the bridge sees it: the four handlers and send/close. */
function fakeSocket() {
  const sent: string[] = [];
  const socket = {
    sent,
    closedWith: null as null | [number, string],
    onopen: null as null | (() => void),
    onmessage: null as null | ((event: { data: string }) => void),
    onerror: null as null | (() => void),
    onclose: null as null | ((event: { code: number; reason: string }) => void),
    send(data: string) { sent.push(data); },
    close(code: number, reason: string) { this.closedWith = [code, reason]; },
  };
  return socket;
}

test('the bridge holds early audio, sends settings first on open, and relays events', () => {
  const socket = fakeSocket();
  let url = '';
  const events: Record<string, unknown>[] = [];
  const closes: [string, number][] = [];
  const session = openEviSession({
    apiKey: 'k', configId: 'cfg', sessionId: 'dev.n', secret: 's',
    onEvent: event => events.push(event),
    onClose: (reason, seconds) => closes.push([reason, seconds]),
    connect: (at) => { url = at; return socket as unknown as WebSocket; },
  });
  assert.ok(url.startsWith('wss://api.hume.ai/v0/evi/chat?config_id=cfg&api_key=k'));
  assert.equal(session.open, false);
  session.sendAudio(new Uint8Array([1, 2]));
  session.sendAudio(new Uint8Array([3]));
  assert.equal(socket.sent.length, 0, 'nothing goes before the handshake');

  socket.onopen!();
  assert.equal(session.open, true);
  const first = JSON.parse(socket.sent[0]) as { type: string; custom_session_id: string; language_model_api_key: string };
  assert.equal(first.type, 'session_settings');
  assert.equal(first.custom_session_id, 'dev.n');
  assert.equal(first.language_model_api_key, 's');
  assert.equal(socket.sent.length, 3, 'the held frames follow the settings');
  assert.equal((JSON.parse(socket.sent[1]) as { type: string }).type, 'audio_input');

  session.sendAudio(new Uint8Array([4]));
  assert.equal(socket.sent.length, 4);

  socket.onmessage!({ data: JSON.stringify({ type: 'chat_metadata', chat_id: 'c', chat_group_id: 'g' }) });
  socket.onmessage!({ data: JSON.stringify({ type: 'assistant_prosody', scores: {} }) });
  socket.onmessage!({ data: 'not json' });
  socket.onmessage!({ data: JSON.stringify({ type: 'assistant_end' }) });
  assert.deepEqual(events.map(event => event.type), ['chat_metadata', 'assistant_end']);

  session.close('done here');
  assert.deepEqual(socket.closedWith, [1000, 'hung up']);
  assert.equal(closes.length, 1);
  assert.equal(closes[0][0], 'done here');
  assert.equal(session.open, false);
  // A close from the far side after ours is not a second ending.
  socket.onclose!({ code: 1000, reason: '' });
  assert.equal(closes.length, 1);
  session.sendAudio(new Uint8Array([5]));
  assert.equal(socket.sent.length, 4, 'nothing is sent after the close');
});

test('the bridge reports a handshake that never opened, once', () => {
  const socket = fakeSocket();
  const closes: string[] = [];
  openEviSession({
    apiKey: 'k', configId: 'cfg', sessionId: 'dev.n', secret: 's',
    onEvent: () => {}, onClose: reason => closes.push(reason),
    connect: () => socket as unknown as WebSocket,
  });
  socket.onerror!();
  socket.onclose!({ code: 1006, reason: '' });
  assert.deepEqual(closes, ['hume did not take the call']);
});

test('the bridge keeps only the last two seconds of audio it could not send', () => {
  const socket = fakeSocket();
  const session = openEviSession({
    apiKey: 'k', configId: 'cfg', sessionId: 'dev.n', secret: 's',
    onEvent: () => {}, onClose: () => {},
    connect: () => socket as unknown as WebSocket,
  });
  for (let i = 0; i < 80; i++) session.sendAudio(new Uint8Array([i]));
  socket.onopen!();
  assert.equal(socket.sent.length, 1 + 50);
  const oldest = JSON.parse(socket.sent[1]) as { data: string };
  assert.equal(Buffer.from(oldest.data, 'base64')[0], 30, 'the oldest frames are the ones dropped');
});
