import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { MEMORY_IN_PROMPT_CHARS, gameMemoryForPrompt, gameSlug, memoryFile, noteInGameMemory, openGameMemory, timesThisWeek, welcomePrompt } from '../electron/games';
import type { Work } from '../electron/following';

test('a game name becomes a folder name that cannot escape or collide on case', () => {
  assert.equal(gameSlug('Zenless Zone Zero'), 'zenless-zone-zero');
  assert.equal(gameSlug('Overwatch® 2'), 'overwatch-2');
  assert.equal(gameSlug('../etc'), 'etc');
  assert.equal(gameSlug('!!!'), 'game');
});

test('the first boot makes the folder and file, seeded; the next boot reads it back', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'haru-games-'));
  try {
    const when = new Date('2026-09-03T20:00:00Z');
    const first = openGameMemory(root, 'Zenless Zone Zero', ['2026-09-01: read a guide, it is a gacha'], when);
    assert.equal(first.isNew, true);
    assert.ok(existsSync(memoryFile(root, 'Zenless Zone Zero')));
    assert.match(first.text, /^# Zenless Zone Zero/);
    assert.match(first.text, /it is a gacha/);
    const grown = noteInGameMemory(root, 'Zenless Zone Zero', 'Anby at 12% HP. You said: "Again?"', when);
    assert.match(grown, /2026-09-03 \d\d:\d\d — Anby at 12% HP/);
    const second = openGameMemory(root, 'Zenless Zone Zero', ['ignored on a second boot'], when);
    assert.equal(second.isNew, false);
    assert.equal(second.text, grown);
    assert.doesNotMatch(second.text, /ignored/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a long file keeps its head and its newest notes', () => {
  const lines = Array.from({ length: 200 }, (_, i) => `- 2026-09-01 10:${String(i % 60).padStart(2, '0')} — note number ${i} about a fight that went on for a while`);
  const text = ['# Game', '', 'First seen 2026-09-01.', ...lines].join('\n');
  const cut = gameMemoryForPrompt(text);
  assert.ok(cut.length <= MEMORY_IN_PROMPT_CHARS + 200);
  assert.match(cut, /^# Game/);
  assert.match(cut, /note number 199/);
  assert.doesNotMatch(cut, /note number 3 /);
  assert.equal(gameMemoryForPrompt('# Short\n\n- one note'), '# Short\n\n- one note');
});

test('how often this week counts distinct days, today included', () => {
  const work: Work = { key: 'game:zzz', title: 'Zenless Zone Zero', kind: 'game', firstSeen: '', lastSeen: '', days: ['2026-08-20', '2026-08-28', '2026-08-30', '2026-09-01', '2026-09-02', '2026-09-03'] };
  assert.equal(timesThisWeek(work, '2026-09-03'), 5);
  assert.equal(timesThisWeek(undefined, '2026-09-03'), 0);
});

test('the welcome names the game and how often, and hands over what she remembers', () => {
  const prompt = welcomePrompt('Zenless Zone Zero', 5, '# Zenless Zone Zero\n- it is a gacha', false);
  assert.match(prompt, /booted Zenless Zone Zero/);
  assert.match(prompt, /5th day this week/);
  assert.match(prompt, /it is a gacha/);
  assert.match(welcomePrompt('New Game', 1, '', true), /never seen them play it/);
});

test('fullscreen promotes an unknown process to a game, with its spaces back — but never a film player', async () => {
  const { promotedByFullscreen } = await import('../electron/activity');
  assert.deepEqual(promotedByFullscreen({ kind: 'other', label: 'ZenlessZoneZero' }, 'ZenlessZoneZero'), { kind: 'gaming', label: 'Zenless Zone Zero' });
  assert.deepEqual(promotedByFullscreen({ kind: 'other', label: 'film.mkv - VLC media player' }, 'vlc'), { kind: 'other', label: 'film.mkv - VLC media player' });
  assert.deepEqual(promotedByFullscreen({ kind: 'watching', label: 'a video' }, 'chrome'), { kind: 'watching', label: 'a video' });
  assert.equal(promotedByFullscreen({ kind: 'other', label: 'Claude' }, 'claude').kind, 'other');
  assert.equal(promotedByFullscreen({ kind: 'other', label: 'Some Long Article' }, 'chrome').kind, 'other');
});
