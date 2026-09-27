import test from 'node:test';
import assert from 'node:assert/strict';
import {
  readSendingConfig, DEFAULT_SENDING, resolveRecipient, verdictOn, showDraft, makeDraft,
  Outgoing, DRAFT_LIFE_MS, type Known, type Draft, type SendingConfig,
} from '../electron/sending';

const NOW = 1_758_000_000_000;

const roster: Known[] = [
  { jid: '61400000001@s.whatsapp.net', name: 'Sam' },
  { jid: '61400000002@s.whatsapp.net', name: 'Sam Whitfield' },
  { jid: '61400000003@s.whatsapp.net', name: 'Ryan' },
  { jid: '61400000004@s.whatsapp.net', name: 'Emma' },
  { jid: '120363000000000000@g.us', name: 'Gaming Cafe' },
];

const allowAll = roster.map(row => row.jid);

const config = (extra: Partial<SendingConfig> = {}): SendingConfig =>
  ({ toOthers: true, allow: allowAll, perHour: 10, ...extra });

const draft = (extra: Partial<Draft> = {}): Draft =>
  ({ jid: '61400000003@s.whatsapp.net', name: 'Ryan', text: 'running 20 late', madeAt: NOW, fromSelfChat: true, ...extra });

test('sending is off unless the config says otherwise', () => {
  // The whole tier defaults to refusing. A missing key must never read as yes.
  assert.deepEqual(readSendingConfig({}), DEFAULT_SENDING);
  assert.equal(readSendingConfig({ sending: { toOthers: 'yes' } }).toOthers, false, 'only a real true is true');
  assert.equal(readSendingConfig({ sending: { toOthers: true } }).toOthers, true);
  assert.deepEqual(readSendingConfig({ sending: { allow: ['a@s.whatsapp.net', '', 42, ' b@g.us '] } }).allow, ['a@s.whatsapp.net', 'b@g.us']);
  assert.equal(readSendingConfig({ sending: { perHour: 0 } }).perHour, 1, 'a cap of none is not a cap of unlimited');
  assert.equal(readSendingConfig({ sending: { perHour: 9999 } }).perHour, 60);
  assert.equal(readSendingConfig({ sending: { perHour: 'lots' } }).perHour, DEFAULT_SENDING.perHour);
});

test('a name becomes one chat, or none — never a guess', () => {
  assert.deepEqual(resolveRecipient('Ryan', roster, allowAll), { ok: true, jid: '61400000003@s.whatsapp.net', name: 'Ryan' });
  // Exact beats prefix: "Sam" is a person, even though "Sam Whitfield" also starts with it.
  assert.deepEqual(resolveRecipient('Sam', roster, allowAll), { ok: true, jid: '61400000001@s.whatsapp.net', name: 'Sam' });
  assert.equal(resolveRecipient('em', roster, allowAll).ok, true, 'a unique prefix is enough');
  assert.equal(resolveRecipient('whitfield', roster, allowAll).ok, true, 'and so is a unique substring');
  assert.equal(resolveRecipient('cafe', roster, allowAll).ok, true, 'a group is a chat like any other');
});

test('two people with the same name is a question, not a coin toss', () => {
  // The ordinary case in anybody's phone. Sending to the wrong Sam is the
  // failure this whole tier is built to make impossible.
  const two: Known[] = [
    { jid: '61400000001@s.whatsapp.net', name: 'Sam Carter' },
    { jid: '61400000002@s.whatsapp.net', name: 'Sam Whitfield' },
  ];
  const said = resolveRecipient('Sam', two, two.map(r => r.jid));
  assert.equal(said.ok, false);
  assert.match((said as { why: string }).why, /more than one/);
  assert.match((said as { why: string }).why, /Sam Carter, Sam Whitfield/, 'it names them so she can ask which');
});

test('the allowlist is what makes someone reachable, not the roster', () => {
  // The roster knows everyone who messages him, including people she may not
  // write to. Knowing a name must never be the same as being allowed to use it.
  assert.equal(resolveRecipient('Ryan', roster, ['61400000004@s.whatsapp.net']).ok, false);
  assert.match((resolveRecipient('Ryan', roster, ['61400000004@s.whatsapp.net']) as { why: string }).why, /no one on the sending allowlist/);
  assert.match((resolveRecipient('Ryan', roster, []) as { why: string }).why, /nobody is on the sending allowlist/);
  assert.match((resolveRecipient('', roster, allowAll) as { why: string }).why, /no one was named/);
  // A device suffix on the allowlist entry is the same person.
  assert.equal(resolveRecipient('Ryan', roster, ['61400000003:12@s.whatsapp.net']).ok, true);
});

test('only a bare yes sends', () => {
  for (const said of ['yes', 'Yeah', 'yep', 'ok', 'OK.', 'sure', 'go on', 'do it', 'send it', 'y']) {
    assert.equal(verdictOn(draft(), said, NOW).do, 'send', `"${said}" should send`);
  }
});

test('politeness is still a yes, and still nothing but a yes', () => {
  // The way he actually types. An agreement the matcher does not recognise
  // means she asks twice about a message he has already agreed to, which is
  // the failure that made this pattern compositional rather than a list.
  for (const said of ['yes please!', 'please do', 'go on then', 'send it please', 'ok thanks', 'yeah mate']) {
    assert.equal(verdictOn(draft(), said, NOW).do, 'send', `"${said}" should send`);
  }
  assert.deepEqual(verdictOn(draft(), 'no thanks', NOW), { do: 'drop', why: 'he said no' });
  // Politeness may wrap the agreement. It may not carry a second clause in.
  assert.deepEqual(verdictOn(draft(), 'yes please tell him about Friday', NOW), { do: 'drop', why: 'he said something else' });
});

test('a revision is not agreement', () => {
  // The case that makes a naive "starts with yes" check dangerous: he agrees
  // with the idea and not with the words, and the words are what would go.
  assert.deepEqual(verdictOn(draft(), 'yeah but say it nicer', NOW), { do: 'drop', why: 'he said something else' });
  assert.deepEqual(verdictOn(draft(), 'yes, and tell him about Friday too', NOW), { do: 'drop', why: 'he said something else' });
  assert.deepEqual(verdictOn(draft(), 'ok what did Emma say', NOW), { do: 'drop', why: 'he said something else' });
});

test('a no drops it, and so does changing the subject', () => {
  for (const said of ['no', 'nah', 'wait', 'hold on', 'cancel', "don't", 'never mind']) {
    assert.deepEqual(verdictOn(draft(), said, NOW), { do: 'drop', why: 'he said no' }, `"${said}" should drop`);
  }
  assert.deepEqual(verdictOn(draft(), 'what time is it', NOW), { do: 'drop', why: 'he said something else' });
  assert.deepEqual(verdictOn(null, 'yes', NOW), { do: 'nothing' }, 'a yes with nothing waiting does nothing at all');
});

test('a draft cannot be released late, or from anywhere but his own chat', () => {
  assert.deepEqual(verdictOn(draft(), 'yes', NOW + DRAFT_LIFE_MS + 1), { do: 'drop', why: 'it sat too long' });
  // Defence in depth. Only his chat becomes a turn at all, so this should be
  // unreachable -- which is exactly why it is worth a test rather than a
  // comment: if that ever stops being true, this is what still refuses.
  assert.deepEqual(verdictOn(draft({ fromSelfChat: false }), 'yes', NOW), { do: 'drop', why: 'that draft did not come from his own chat' });
});

test('one draft waits, never a queue of them', () => {
  // A list of things he half agreed to, released by a single "yes", is the
  // shape of mistake this tier exists to avoid.
  const out = new Outgoing();
  out.hold(draft({ text: 'first' }));
  out.hold(draft({ text: 'second' }));
  assert.equal(out.waiting(NOW)?.text, 'second');
  out.clear();
  assert.equal(out.waiting(NOW), null);
});

test('a draft nobody answered is gone by the clock alone', () => {
  const out = new Outgoing();
  out.hold(draft());
  assert.equal(out.waiting(NOW + DRAFT_LIFE_MS - 1)?.text, 'running 20 late');
  assert.equal(out.waiting(NOW + DRAFT_LIFE_MS + 1), null);
});

test('the cap counts a rolling hour and only counts what went', () => {
  const out = new Outgoing(2);
  assert.equal(out.capReached(NOW), false);
  out.noteSent(NOW);
  out.noteSent(NOW + 1000);
  assert.equal(out.capReached(NOW + 2000), true);
  // An hour after the first, there is room for one again.
  assert.equal(out.sentInHour(NOW + 3_600_001), 1);
  assert.equal(out.capReached(NOW + 3_600_001), false);
});

test('every refusal comes before he is shown anything', () => {
  const out = new Outgoing();
  const base = { roster, fromSelfChat: true, out };
  const refused = (c: SendingConfig, said = { to: 'Ryan', text: 'hi' }) => makeDraft(said, { ...base, config: c }, NOW) as { ok: false; why: string };

  assert.match(refused(config({ toOthers: false })).why, /switched off/);
  assert.match((makeDraft({ to: 'Ryan', text: 'hi' }, { ...base, config: config(), fromSelfChat: false }, NOW) as { why: string }).why, /only start in his own chat/);
  assert.match(refused(config(), { to: 'Ryan', text: '   ' }).why, /nothing to send/);
  assert.match(refused(config(), { to: 'Ryan', text: 'x'.repeat(1001) }).why, /too long/);
  assert.match(refused(config(), { to: 'Nobody', text: 'hi' }).why, /no one on the sending allowlist/);
  // Nothing was held on to along the way.
  assert.equal(out.waiting(NOW), null);
});

test('the cap refuses last, because it is the one that fixes itself', () => {
  const out = new Outgoing(1);
  out.noteSent(NOW);
  const said = makeDraft({ to: 'Ryan', text: 'hi' }, { roster, config: config({ perHour: 1 }), fromSelfChat: true, out }, NOW);
  assert.equal(said.ok, false);
  assert.match((said as { why: string }).why, /already 1 messages in his name this hour/);
  // But a name that could not be resolved is reported before the cap, because
  // waiting an hour will not fix a wrong name.
  const wrong = makeDraft({ to: 'Nobody', text: 'hi' }, { roster, config: config({ perHour: 1 }), fromSelfChat: true, out }, NOW);
  assert.match((wrong as { why: string }).why, /no one on the sending allowlist/);
});

test('a made draft is frozen to a chat, not to a name', () => {
  // The name is resolved once. If "Sam" would mean somebody else by the time
  // he says yes -- a new contact, a renamed chat -- it still goes where he was
  // shown it would go.
  const out = new Outgoing();
  const made = makeDraft({ to: 'Ryan', text: '  running 20 late  ' }, { roster, config: config(), fromSelfChat: true, out }, NOW);
  assert.equal(made.ok, true);
  const held = (made as { draft: Draft }).draft;
  assert.equal(held.jid, '61400000003@s.whatsapp.net');
  assert.equal(held.text, 'running 20 late', 'what he is shown is trimmed, and is what goes');
  assert.equal(held.fromSelfChat, true);
  assert.equal(out.waiting(NOW), held, 'and it is the one waiting');
});

test('what he is shown says who and says exactly what', () => {
  const shown = showDraft(draft());
  assert.match(shown, /^To Ryan: "running 20 late"/);
  assert.match(shown, /Send it\?$/);
});
