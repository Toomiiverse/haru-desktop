// 4530: her replies keep the lookups behind them, so "where did you get that?" can be answered truthfully.
import test from 'node:test';
import assert from 'node:assert/strict';
import {lookupOf, lookupNote, withLookupNotes, dropLookupNote, priorLookups} from '../electron/lookup-notes';
import type {ToolReceipt} from '../electron/tool-receipt';

const receipt = (tool: string, scope: Record<string, unknown>, outcome: ToolReceipt['outcome'] = 'succeeded', access: ToolReceipt['access'] = 'read'): ToolReceipt =>
  ({receiptVersion: 1, executionId: 'x', tool, scope, access, outcome, startedAt: null, receivedAt: null, observedAt: null, data: null});

test('only a successful read is kept, described by its query or address', () => {
  assert.deepEqual(lookupOf(receipt('search_web', {query: 'Perth "traffic" [now]'})), {tool: 'search_web', about: 'Perth traffic now'});
  assert.deepEqual(lookupOf(receipt('browser_control', {url: 'https://mainroads.wa.gov.au'}, 'succeeded', 'mutation')), {tool: 'browser_control', about: 'https://mainroads.wa.gov.au'});
  assert.equal(lookupOf(receipt('search_web', {query: 'x'}, 'failed')), null);
  assert.equal(lookupOf(receipt('remember_about_user', {fact: 'x'}, 'succeeded', 'mutation')), null);
});

// 2026-10-19 03:09-03:10: she searched for the traffic, then was asked where it came from.
const traffic = [
  {role: 'user', content: "What's the traffic like?"},
  {role: 'assistant', content: 'Messy, from what I can see.', lookups: [{tool: 'search_web', about: 'Perth traffic today'}]},
  {role: 'user', content: 'Whoa, where did you get this information from?'},
];

test('the model is shown each reply with its note, and the next turn sees the reads behind it', () => {
  const shown = withLookupNotes(traffic);
  assert.equal(shown[1].content, 'Messy, from what I can see.\n\n[lookups behind this reply: search_web "Perth traffic today"]');
  assert.equal(shown[0], traffic[0]);   // user turns untouched
  assert.deepEqual(priorLookups(shown), ['search_web']);
  // A refused draft of this turn between them still leaves the reply's reads in view.
  assert.deepEqual(priorLookups([...shown, {role: 'assistant', content: 'I looked it up.'}, {role: 'user', content: 'No successful lookup supports that claim.'}]), ['search_web']);
});

test('no note, no earlier reads; a note five replies back no longer counts', () => {
  assert.deepEqual(priorLookups(traffic), []);
  const old = [...withLookupNotes(traffic), ...[1, 2, 3, 4].flatMap(i => [{role: 'assistant', content: `reply ${i}`}, {role: 'user', content: `q ${i}`}])];
  assert.deepEqual(priorLookups(old), []);
});

test('a note she copies onto a new reply is taken off; the note format stays parseable', () => {
  const note = lookupNote([{tool: 'search_web', about: 'a'}, {tool: 'read_web_page', about: ''}]);
  assert.equal(note, '[lookups behind this reply: search_web "a"; read_web_page]');
  assert.equal(dropLookupNote('Here you go.\n\n' + note), 'Here you go.');
  assert.equal(dropLookupNote('A [bracket] in the middle stays.'), 'A [bracket] in the middle stays.');
  // Words inside the quoted query are not tools.
  assert.deepEqual(priorLookups([{role: 'assistant', content: 'x\n\n[lookups behind this reply: search_web "read_web_page vault_read"]'}, {role: 'user', content: 'q'}]), ['search_web']);
});
