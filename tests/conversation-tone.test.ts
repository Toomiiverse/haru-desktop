import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkNaturalReply, answerNaturalConversation, naturalConversationTurns } from '../electron/natural-conversation';
import { blankSlateInstruction, blankSlateOpening, strangerIdentityNote } from '../electron/blankslate';
import { roomInstruction, HOSTED_VOICE, LAST_WORD, herSubjectNote, JUST_TALKING_NOTE } from '../electron/room';
import { dropClosingOrder } from '../electron/reply';
import { GROUNDED_REPLY_RULES } from '../electron/local-reply';

for (const [latest, content] of [
  ['Hey Haru!', '[annoyed] What now?'],
  ['Hi.', '[annoyed] Make it quick.'],
  ['Thanks!', "[smug] Don't make a habit of it."],
  ["I'm feeling tired today.", '[neutral] Then sit down and stop doing things.'],
  ['Tell me a joke.', '[smug] The joke is your life.'],
  ['Roast me!', '[smug] Your personality is a loading screen.'],
]) test(`tone passes unchanged: ${latest} / ${content}`, () => {
  const draft = { role: 'assistant' as const, content };
  assert.equal(checkNaturalReply(draft, latest), draft);
});

test('sharp natural replies do not trigger a repair generation', async () => {
  let attempts = 0;
  const draft = { role: 'assistant' as const, content: '[annoyed] Make it quick.' };
  assert.equal(await answerNaturalConversation([{ role: 'user', content: 'Hi.' }], 'Hi.', undefined,
    async () => { attempts++; return draft; }), draft);
  assert.equal(attempts, 1);
});

test('tone removal retains grounding, audio and tool/delivery validation', () => {
  assert.throws(() => checkNaturalReply({ role: 'assistant', content: '[neutral] I hear your voice.' }, 'Hey!'));
  assert.throws(() => checkNaturalReply({ role: 'assistant', content: '[neutral] Welcome back.' }, 'Hey!'));
  assert.throws(() => checkNaturalReply({ role: 'assistant', content: '[fake] Fuck off.' }, 'Hey!'));
  assert.throws(() => checkNaturalReply({ role: 'assistant', content: '' }, 'Hey!'));
  assert.throws(() => checkNaturalReply({ role: 'assistant', content: '[neutral] Done.', tool_calls: [{ id: 'x', function: { name: 'invented_tool', arguments: '{}' } }] }, 'Hey!'));
});

test('stranger and rough-day instructions do not temper her personality', () => {
  const now = Date.parse('2026-10-02T09:00:00Z'), slate = { at: new Date(now).toISOString() };
  for (const known of [0, 9]) assert.doesNotMatch(blankSlateInstruction(slate, known, now), /So be careful|not yours to help|guarded to the point|no mocking|Warmth is theirs to earn/i);
  assert.match(blankSlateInstruction(slate, 0, now), /Never pretend to remember/);
  assert.doesNotMatch(strangerIdentityNote(slate, 0, now), /You do not push him|No ordering|no mocking|guarded rather than demanding/i);
  assert.match(strangerIdentityNote(slate, 0, now), /no memory of him/);
  assert.doesNotMatch(blankSlateOpening(slate, 0, now), /Wary rather|do not open by demanding/i);
  assert.doesNotMatch(roomInstruction({ rough: true } as Parameters<typeof roomInstruction>[0]), /Ease off|no needling|allowed to be kind|go and be productive/i);
  assert.doesNotMatch(HOSTED_VOICE + LAST_WORD + GROUNDED_REPLY_RULES + herSubjectNote('fixture') + JUST_TALKING_NOTE, /no personal insult|no repeated argument, sneer|Ordinary differences in taste need no insult|no criticism, snark|without insulting the user|not one order|No telling them to go to bed|Do not ask what they really want/i);
});

test('compact prompt contains no automatic politeness instructions', () => {
  const messages = naturalConversationTurns([{ role: 'user', content: "I'm feeling tired today." }], "I'm feeling tired today.", { identity: 'Haru fixture', style: 'Blunt.' }, {});
  const instructions = messages.filter(m => m.role === 'system').map(m => m.content).join('\n');
  assert.doesNotMatch(instructions, /without being curt|Brevity must not become brusqueness|Only a roast invites|only a roast invites|without demands like|without a complaint|No advice, speculative follow-up/);
  assert.match(instructions, /No tools ran/);
});

test('closing-order compatibility hook preserves complete generated reply', () => {
  const reply = "Power. Obviously. Now stop asking me to explain art to you and go to sleep.";
  assert.equal(dropClosingOrder(reply), reply);
});
