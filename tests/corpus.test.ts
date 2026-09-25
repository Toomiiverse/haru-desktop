// Text-prep regression over real-shaped replies, and a live review report.
//
// The golden set below is hand-written in Haru's actual style — her history
// says "Alright morning Haru", talks about the HDMI cable and the API, and
// shouts STOP — so a change to speakableText/spokenCase/splitForSpeech that
// mangles a shape she actually produces fails here without anyone having to
// listen to audio.
//
// The live report is the other half and needs no engine either: with
// HARU_LIVE_CORPUS=1 the real conversation archive is piped through the same
// functions and printed for eyeball review — every transformation made, plus
// every all-caps token the rules left alone with its count. It is review-only,
// never compared, and skipped when the archives are not on this machine. Run
// it before and after any prep change:
//
//   HARU_LIVE_CORPUS=1 node --test dist-test/tests/corpus.test.js

import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { speakableText, splitForSpeech, spokenCase } from '../electron/voice';

/** The whole prep pipeline, the way speak() drives it. */
function spoken(reply: string): string {
  return splitForSpeech(speakableText(reply)).map(chunk => spokenCase(chunk)).join(' ');
}

test('her actual reply shapes come out as she would say them', () => {
  const golden: Array<[string, string]> = [
    ['Alright morning Haru', 'Alright morning Haru'],
    ['STOP that right now.', 'stop that right now.'],
    ['NO WAY, I am not doing that.', 'no Way, I am not doing that.'],
    ['The HDMI cable is behind the TV.', 'The HDMI cable is behind the TV.'],
    ['MIA again? What did she say this time?', 'MIA again? What did she say this time?'],
    ['The API at the URL is up, the SSD is fine.', 'The API at the URL is up, the SSD is fine.'],
    ['**Great** — see [the docs](https://example.com).', 'Great — see the docs.'],
    ['```js\nx = 1\n```\nAnyway.', 'Anyway.'],
    ['😂 fine, whatever. 🙄', 'fine, whatever.'],
    ['It costs 2.50 now.', 'It costs 2.50 now.'],
    ['> quoted\nplain line', 'quoted plain line'],
    ['- list item\n- another one', 'list item another one'],
    ['This is BRILLIANT, honestly.', 'This is Brilliant, honestly.'],
    ['Send it to the GB of the card, not the MB.', 'Send it to the GB of the card, not the MB.'],
    ['The RTX 3060 has 12 GB.', 'The RTX 3060 has 12 GB.'],
    ['Sure! Heres your reminder for tomorrow at 8:00 AM.', 'Sure! Heres your reminder for tomorrow at 8:00 AM.'],
  ];
  for (const [line, expected] of golden) {
    assert.equal(spoken(line), expected, `"${line}"`);
  }
});

test('a long reply splits at sentence ends, and each piece survives the pipeline', () => {
  const reply = 'First bit, with a clause. Second sentence right here. Third one, which is longer and carries on a while with more detail to test the splitter, and there is plenty more to come before it is done. Fourth, and a trailing piece long enough to push well past the chunk ceiling so the splitter actually has to cut. Fifth.';
  const chunks = splitForSpeech(speakableText(reply));
  assert.ok(chunks.length >= 2, 'expected a multi-chunk reply');
  assert.ok(chunks.every(chunk => chunk.trim().length > 0));
  assert.equal(chunks.join(' ').length, reply.length, 'nothing lost across the split');
});

// ---- the live report ----------------------------------------------------------

const LIVE = process.env.HARU_LIVE_CORPUS === '1';

function assistantReplies(): string[] {
  const out: string[] = [];
  const live = join(homedir(), '.config/haru-desktop/config.json');
  const archive = join(homedir(), 'haru-desktop/appdata/config.json');
  const pick = (path: string) => {
    if (!existsSync(path)) return;
    try {
      const root = JSON.parse(readFileSync(path, 'utf8'));
      const walk = (value: unknown) => {
        if (Array.isArray(value)) {
          for (const item of value) walk(item);
        } else if (value && typeof value === 'object') {
          const record = value as Record<string, unknown>;
          if (record.role === 'assistant' && typeof record.content === 'string') out.push(record.content);
          for (const item of Object.values(record)) walk(item);
        }
      };
      walk(root);
    } catch {
      /* a half-written file is not worth a failing report */
    }
  };
  pick(live);
  pick(archive);
  return out;
}

if (LIVE) {
  test('live corpus report', () => {
    const replies = assistantReplies();
    assert.ok(replies.length > 0, 'no assistant replies found in the archives');
    const touched = new Map<string, number>();
    const untouchedCaps = new Map<string, number>();
    const changedLines: Array<[string, string]> = [];
    for (const reply of replies) {
      const plain = speakableText(reply);
      const before = reply;
      if (plain !== before) changedLines.push([before, plain]);
      for (const chunk of splitForSpeech(plain)) {
        for (const token of chunk.split(/\s+/).filter(Boolean)) {
          const said = spokenCase(token);
          if (said !== token) touched.set(`${token} → ${said}`, (touched.get(`${token} → ${said}`) ?? 0) + 1);
        }
      }
      for (const token of plain.match(/\b[A-Z][A-Z0-9'’]{2,}\b/g) ?? []) {
        untouchedCaps.set(token, (untouchedCaps.get(token) ?? 0) + 1);
      }
    }
    const top = (counts: Map<string, number>, n: number) =>
      [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => `${k} (×${v})`).join(', ');
    console.log(`\n== corpus: ${replies.length} assistant replies, ${changedLines.length} changed by speakableText`);
    console.log(`tokens spokenCase rewrote: ${top(touched, 10) || 'none'}`);
    console.log(`all-caps left alone: ${top(untouchedCaps, 15) || 'none'}`);
    for (const [from, to] of changedLines.slice(0, 25)) {
      console.log(`\n  in:  ${from.slice(0, 160)}`);
      console.log(`  out: ${to.slice(0, 160)}`);
    }
    if (changedLines.length > 25) console.log(`\n  … and ${changedLines.length - 25} more changed lines`);
  });
}