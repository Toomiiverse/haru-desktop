// His own notes on a thing, brought in when the thing comes up.

import test from 'node:test';
import assert from 'node:assert/strict';
import { activeCards, keySaid, loreNote, parseLorePage, LORE_TEMPLATE } from '../electron/lore';

const PAGE = `---
tags: [haru/lore]
---

# Lore

> - **not, a card** — lines in a quote are instructions

- **rego, registration, car*** — The car registration renews on 6 October; the reminder is on his list.
- **psych*, Sam** — Sam is his psychologist; appointments are monthly.
- **Minecraft** — Haru has her own body on his Paper server.
- no bold keys here — not a card
- **empty** —
* **The PC Project, shop** — His business, co-founded with Sudin.
`;

test('the page: one bullet one card, keys lowercased, quotes and keyless lines skipped', () => {
  const cards = parseLorePage(PAGE);
  assert.deepEqual(cards.map(card => card.keys), [['rego', 'registration', 'car*'], ['psych*', 'sam'], ['minecraft'], ['the pc project', 'shop']]);
  assert.match(cards[0].text, /^The car registration renews on 6 October/);
  assert.deepEqual(parseLorePage(LORE_TEMPLATE), [], 'the template has instructions and no cards');
});

test('keys are whole words, a trailing star matches any ending, a plain key its plural', () => {
  assert.equal(keySaid('rego', 'need to do the rego thing'), true);
  assert.equal(keySaid('rego', 'oregon trail'), false);
  assert.equal(keySaid('car*', 'my cars and cards'), true);
  assert.equal(keySaid('psych*', 'Psychologist at 8:45'), true);
  assert.equal(keySaid('sam', 'samsung phone'), false);
  assert.equal(keySaid('the pc project', "at The PC Project's shop"), true);
  assert.equal(keySaid('shop', 'went to the shops'), true);
});

test('a card stays up for a few of his messages after its key, triggered cards first, within the budget', () => {
  const cards = parseLorePage(PAGE);
  let memory = new Map<string, number>();
  let turn = activeCards(cards, 'rego is due soon', memory);
  assert.deepEqual(turn.cards.map(card => card.keys[0]), ['rego']);
  assert.deepEqual(turn.triggered, ['rego|registration|car*']);
  memory = turn.memory;
  turn = activeCards(cards, 'yeah I know', memory);
  assert.deepEqual(turn.cards.map(card => card.keys[0]), ['rego'], 'still up the next message');
  memory = turn.memory;
  turn = activeCards(cards, 'psych tomorrow too', memory);
  assert.deepEqual(turn.cards.map(card => card.keys[0]), ['psych*', 'rego'], 'the new one first, the sticky one after');
  memory = turn.memory;
  turn = activeCards(cards, 'ok', memory);
  assert.deepEqual(turn.cards.map(card => card.keys[0]), ['psych*'], 'rego has run out');
  const tight = activeCards(cards, 'rego and psych and minecraft and the shop', new Map(), { maxCards: 2 });
  assert.equal(tight.cards.length, 2);
  assert.equal(activeCards(cards, 'rego', new Map(), { maxChars: 10 }).cards.length, 0);
});

test('the note marks the cards as his word and not for reading out', () => {
  assert.equal(loreNote([]), '');
  assert.match(loreNote(parseLorePage(PAGE).slice(0, 1)), /^From his own notes on what just came up[^\n]*\n- The car registration/);
});
