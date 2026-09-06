// Their vault at her hand: confined, additive, and never her own folder.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createFolder, insideVault, listVault, readNote, writeNote, NOTE_CAP_CHARS } from '../electron/vaultnotes';

function vault(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'haru-vault-'));
  mkdirSync(path.join(root, 'Projects', 'App'), { recursive: true });
  mkdirSync(path.join(root, 'Haru', 'Diary'), { recursive: true });
  mkdirSync(path.join(root, '.obsidian'), { recursive: true });
  writeFileSync(path.join(root, 'Home.md'), 'home\n');
  writeFileSync(path.join(root, 'Projects', 'App', 'setup.md'), '# Setup\n\nsteps\n');
  writeFileSync(path.join(root, 'Projects', 'todo.md'), '- one\n');
  writeFileSync(path.join(root, 'Haru', 'Her.md'), 'hers');
  return root;
}

test('a path is inside the vault, a note, and not hers — or it is refused with a reason', () => {
  const root = vault();
  try {
    const ok = insideVault(root, 'Projects/Website', 'note');
    assert.ok(ok.ok && ok.relative === 'Projects/Website.md' && ok.full === path.join(root, 'Projects', 'Website.md'));
    assert.match((insideVault(root, '../etc/passwd', 'note') as { error: string }).error, /leaves the vault/);
    assert.match((insideVault(root, 'Projects/../../x.md', 'note') as { error: string }).error, /leaves the vault/);
    assert.match((insideVault(root, '/etc/passwd', 'note') as { error: string }).error, /no absolute/);
    assert.match((insideVault(root, '.obsidian/app.json', 'note') as { error: string }).error, /Dotfiles/);
    assert.match((insideVault(root, 'Haru/Diary/2026-09-06.md', 'note') as { error: string }).error, /your own folder/);
    assert.match((insideVault(root, 'templates/x', 'note') as { error: string }).error, /housekeeping/);
    assert.match((insideVault(root, '', 'note') as { error: string }).error, /Say which note/);
    assert.match((insideVault('', 'x', 'note') as { error: string }).error, /No vault/);
    const top = insideVault(root, '', 'folder');
    assert.ok(top.ok && top.relative === '');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a folder lists its notes newest first and its folders; her own folder is named, not opened', () => {
  const root = vault();
  try {
    const top = listVault(root);
    assert.ok(top.ok);
    if (top.ok) {
      assert.deepEqual(top.folders, ['Haru (yours, written by the app)', 'Projects']);
      assert.deepEqual(top.notes.map(n => n.path), ['Home.md']);
      assert.equal(top.folder, '/');
    }
    const projects = listVault(root, 'Projects');
    assert.ok(projects.ok && projects.folders.includes('Projects/App') && projects.notes.some(n => n.path === 'Projects/todo.md'));
    assert.match((listVault(root, 'Nowhere') as { error: string }).error, /no folder/);
    assert.match((listVault(root, 'Haru') as { error: string }).error, /your own folder/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a note is read whole, with or without the extension, and a long one is cut with a word', () => {
  const root = vault();
  try {
    const read = readNote(root, 'Projects/App/setup');
    assert.ok(read.ok && read.text === '# Setup\n\nsteps\n' && read.path === 'Projects/App/setup.md' && !read.cut);
    assert.match((readNote(root, 'Projects/nothing.md') as { error: string }).error, /no note/);
    writeFileSync(path.join(root, 'long.md'), 'x'.repeat(NOTE_CAP_CHARS + 5));
    const long = readNote(root, 'long');
    assert.ok(long.ok && long.cut && long.text.length === NOTE_CAP_CHARS && long.chars === NOTE_CAP_CHARS + 5);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('create refuses an existing note, append adds a paragraph or starts one, replace puts the text in its place', () => {
  const root = vault();
  try {
    const made = writeNote(root, 'Projects/Website', '# Website\n\nfirst', 'create');
    assert.ok(made.ok && made.path === 'Projects/Website.md' && !made.existed);
    assert.equal(readFileSync(path.join(root, 'Projects', 'Website.md'), 'utf8'), '# Website\n\nfirst\n');
    const again = writeNote(root, 'Projects/Website', 'x', 'create');
    assert.ok(!again.ok && again.exists === true);
    const added = writeNote(root, 'Projects/Website', 'second', 'append');
    assert.ok(added.ok && added.existed);
    assert.equal(readFileSync(path.join(root, 'Projects', 'Website.md'), 'utf8'), '# Website\n\nfirst\n\nsecond\n');
    const started = writeNote(root, 'Ideas/new', 'a thought', 'append');
    assert.ok(started.ok && !started.existed && existsSync(path.join(root, 'Ideas', 'new.md')), 'append starts a note, folders and all');
    const replaced = writeNote(root, 'Projects/Website', 'only this', 'replace');
    assert.ok(replaced.ok && replaced.existed);
    assert.equal(readFileSync(path.join(root, 'Projects', 'Website.md'), 'utf8'), 'only this\n');
    assert.match((writeNote(root, 'Projects/Website', '   ', 'append') as { error: string }).error, /nothing to write/);
    assert.match((writeNote(root, 'Haru/Her', 'x', 'append') as { error: string }).error, /your own folder/);
    assert.match((writeNote(root, 'Projects', 'x', 'append') as { error: string }).error, /is a folder/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a folder is made, once, and never inside hers', () => {
  const root = vault();
  try {
    const made = createFolder(root, 'Reading/2026');
    assert.ok(made.ok && !made.existed && existsSync(path.join(root, 'Reading', '2026')));
    const again = createFolder(root, 'Reading/2026');
    assert.ok(again.ok && again.existed);
    assert.match((createFolder(root, '') as { error: string }).error, /what to call/);
    assert.match((createFolder(root, 'Home.md') as { error: string }).error, /is a note/);
    assert.match((createFolder(root, 'Haru/Stuff') as { error: string }).error, /your own folder/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
