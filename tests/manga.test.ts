import test from 'node:test';
import assert from 'node:assert/strict';
import {
  afterReading, alreadyFinished, feedUrl, FINISHED_KEPT, parseReadingTake, PAGES_A_NIGHT, readableChapters, readFinished,
  readingInstruction, readingNote, readReading, readToTheEnd, tonightsPages, withFinished, type ChapterRef, type Reading,
} from '../electron/manga';

test('the block says where she is up to, in pages she read herself', () => {
  // Asked what chapter she was on, she said she only read about it (2026-09-12).
  const note = readingNote({ seriesId: 's', title: 'Chainsaw Man', chapter: '2', chapterId: 'c', page: 0, pages: 26, startedAt: '', lastAt: '', finished: 1 });
  assert.match(note, /Chainsaw Man — 1 chapter finished, about to start chapter 2 \(26 pages\)/);
  assert.match(note, /read those pages yourself/);
  assert.match(readingNote({ seriesId: 's', title: 'Chainsaw Man', chapter: '1', chapterId: 'c', page: 46, pages: 53, startedAt: '', lastAt: '', finished: 0 }), /46 of 53 pages into chapter 1/);
  assert.equal(readingNote(null), '');
});

const reading = (over: Partial<Reading> = {}): Reading => ({
  seriesId: 'a77742b1', title: 'Chainsaw Man', chapter: '1', chapterId: '73af4d8d',
  page: 0, pages: 53, startedAt: '2026-09-08T12:00:00.000Z', lastAt: '2026-09-08T12:00:00.000Z', finished: 0,
  ...over,
});

// The real shape of a MangaDex feed. Of the first twenty Chainsaw Man entries,
// seven were a stub or a licensed chapter living at the publisher.
const FEED = [
  { id: 'stub-a', attributes: { chapter: '1', title: '', pages: 0 } },
  { id: 'licensed', attributes: { chapter: '1', title: 'Dog & Chainsaw', pages: 40, externalUrl: 'https://mangaplus.example/1' } },
  { id: 'real-1', attributes: { chapter: '1', title: 'A Dog and a Chainsaw', pages: 53 } },
  { id: 'dupe-1', attributes: { chapter: '1', title: 'another group', pages: 51 } },
  { id: 'real-3', attributes: { chapter: '3', title: 'Arrival in Tokyo', pages: 20 } },
  { id: 'real-2', attributes: { chapter: '2', title: 'Place Where Pochita Is', pages: 19 } },
];

test('only chapters the API will actually serve are readable', () => {
  const chapters = readableChapters(FEED);
  assert.deepEqual(chapters.map(c => c.id), ['real-1', 'real-2', 'real-3']);
  assert.deepEqual(chapters.map(c => c.chapter), ['1', '2', '3'], 'and in reading order');
});

test('a licensed chapter that lives at the publisher is left to the publisher', () => {
  assert.equal(readableChapters(FEED).some(c => c.id === 'licensed'), false);
});

test('one group per chapter number, not four', () => {
  assert.equal(readableChapters(FEED).filter(c => c.chapter === '1').length, 1);
});

test('the feed query keeps its brackets, or the API hands back every language', () => {
  // URLSearchParams escapes these, and encoded they are silently ignored.
  assert.match(feedUrl('abc'), /translatedLanguage\[\]=en/);
  assert.match(feedUrl('abc', 100), /offset=100/);
});

// ---- a night's reading ----

test('a sitting is a stretch, not a volume', () => {
  const { from, to } = tonightsPages(reading());
  assert.equal(from, 0);
  assert.equal(to, PAGES_A_NIGHT);
});

test('she picks up where she left off', () => {
  assert.deepEqual(tonightsPages(reading({ page: 12 })), { from: 12, to: 24 });
});

test('a few pages left is finished rather than left dangling over a night', () => {
  const { to } = tonightsPages(reading({ page: 40, pages: 53 }));
  assert.equal(to, 53, '13 left is one more sitting');
  assert.equal(tonightsPages(reading({ page: 50, pages: 53 })).to, 53);
});

test('finishing a chapter moves her to the next one and counts it', () => {
  const next: ChapterRef = { id: 'real-2', chapter: '2', title: 'Place Where Pochita Is', pages: 19 };
  const after = afterReading(reading({ page: 41 }), 53, next, '2026-09-09T12:00:00.000Z');
  assert.equal(after.chapter, '2');
  assert.equal(after.chapterId, 'real-2');
  assert.equal(after.page, 0);
  assert.equal(after.pages, 19);
  assert.equal(after.finished, 1);
});

test('mid-chapter she only moves the bookmark', () => {
  const after = afterReading(reading(), 12, null, '2026-09-09T12:00:00.000Z');
  assert.equal(after.page, 12);
  assert.equal(after.chapter, '1');
  assert.equal(after.finished, 0, 'a chapter is not finished until it is');
});

test('the last chapter of all leaves her at the end rather than nowhere', () => {
  const after = afterReading(reading({ page: 41 }), 53, null, '2026-09-09T12:00:00.000Z');
  assert.equal(after.page, 53);
  assert.equal(after.finished, 1);
  assert.equal(after.chapterId, '73af4d8d', 'she stays on it rather than losing her place');
});

// ---- read to the end ----
// Odd Taxi: one readable chapter on MangaDex, finished 2026-09-24, and three
// days of "the pages did not come back" after it.

test('the end of the last chapter is the end, not a place to read on from', () => {
  const after = afterReading(reading({ page: 41 }), 53, null, '2026-09-24T01:52:00.000Z');
  assert.ok(readToTheEnd(after), 'where afterReading leaves her with nothing next');
  assert.ok(readToTheEnd(reading({ page: 60, pages: 60, chapter: '35.5' })), 'the bookmark as it stood');
  assert.ok(!readToTheEnd(reading({ page: 46, pages: 53 })), 'mid-chapter is not the end');
  assert.ok(!readToTheEnd(reading({ page: 0, pages: 0 })), 'pages not yet counted (her shelf) is not the end');
  assert.equal(readToTheEnd(readReading({ seriesId: 'a', chapterId: 'b', page: 60, pages: 60 })!), true, 'and it survives the disk');
});

test('the block says she finished it, not that she is sixty pages into it', () => {
  const note = readingNote({ seriesId: 'd89a0256', title: 'Odd Taxi', chapter: '35.5', chapterId: '7450f889', page: 60, pages: 60, startedAt: '', lastAt: '', finished: 1 });
  assert.match(note, /Odd Taxi — read to the end: 1 chapter of it, finishing on chapter 35\.5/);
  assert.match(note, /nothing after it to read/);
  assert.doesNotMatch(note, /into chapter/, 'the old line read as a place to carry on from');
  assert.match(readingNote({ seriesId: 's', title: 'Chainsaw Man', chapter: '1', chapterId: 'c', page: 53, pages: 53, startedAt: '', lastAt: '', finished: 0 }), /chapter 1, which is all there is/);
});

test('a finished series is written down once, and the picker knows it by name or by id', () => {
  const odd = reading({ seriesId: 'd89a0256', title: 'Odd Taxi', chapter: '35.5', page: 60, pages: 60, finished: 1 });
  let list = withFinished([], odd, '2026-09-27T10:00:00.000Z');
  assert.deepEqual(list, [{ seriesId: 'd89a0256', title: 'Odd Taxi', chapters: 1, at: '2026-09-27T10:00:00.000Z' }]);
  list = withFinished(list, { ...odd, finished: 2 }, '2026-09-28T10:00:00.000Z');
  assert.equal(list.length, 1, 'finishing it again replaces the entry');
  assert.equal(list[0].chapters, 2);
  assert.ok(alreadyFinished(list, 'odd taxi'), 'by name, whatever the case');
  assert.ok(alreadyFinished(list, 'ODDTAXI', 'd89a0256'), 'by id when MangaDex spells the title its own way');
  assert.ok(!alreadyFinished(list, 'Chainsaw Man', 'a77742b1'));
  assert.ok(!alreadyFinished([], 'Odd Taxi'));
});

test('the finished list survives the disk and stays short', () => {
  assert.deepEqual(readFinished(null), []);
  assert.deepEqual(readFinished([{ title: 'no id' }, null, 'junk', { seriesId: 'x', title: 'Kept', chapters: -3 }]), [{ seriesId: 'x', title: 'Kept', chapters: 0, at: '' }]);
  let list = readFinished([]);
  for (let i = 0; i < FINISHED_KEPT + 5; i++) list = withFinished(list, reading({ seriesId: `s${i}`, title: `Series ${i}` }), '');
  assert.equal(list.length, FINISHED_KEPT);
  assert.equal(list[0].seriesId, 's5', 'the oldest go first');
});

test('junk on disk is not a bookmark', () => {
  assert.equal(readReading(null), null);
  assert.equal(readReading({ title: 'Chainsaw Man' }), null, 'no ids, no place');
  assert.equal(readReading({ seriesId: 'a', chapterId: 'b', page: -4 })?.page, 0);
});

// ---- what she is asked, and what she says back ----

test('she is told where she is, so a view cannot outlive the story', () => {
  // The want "to see the finale resolve" survived the finale once, off a stance
  // built entirely out of reviews.
  const said = readingInstruction(reading({ finished: 4, chapter: '5' }), 12, 24, 'PAGE 13\nsome dialogue');
  assert.match(said, /finished 4 chapters/);
  assert.match(said, /chapter 5/);
  assert.match(said, /pages 13 to 24 of 53/);
  assert.match(said, /some dialogue/, 'the pages go in as they came back');
  assert.match(said, /not from anything you know about the series/);
});

test('the first night reads as a first night', () => {
  assert.match(readingInstruction(reading(), 0, 12, 'x'), /just started it/);
});

test('she is not asked for a page number the bookmark already holds', () => {
  // Asked for it on the first live run she wrote "Pages 1-12 of 53" for a
  // sitting of ten, and that becomes the one fact her view rests on.
  const said = readingInstruction(reading(), 0, 10, 'x');
  assert.match(said, /state of the thing itself/);
  assert.match(said, /Not your page number/);
});

test('her take comes back as the note and where she is up to', () => {
  const take = parseReadingTake('Denji sold a kidney to service a debt and it is played as a joke.\nThat is bleaker than it looks.\nSTANDS: Chapter 1 of 97, ongoing, barely started.');
  assert.match(take!.note, /^Denji sold a kidney/);
  assert.doesNotMatch(take!.note, /STANDS/, 'the bookmark is not part of the thought');
  assert.match(take!.stands, /Chapter 1 of 97/);
});

test('a take with no bookmark is still a take', () => {
  assert.equal(parseReadingTake('I did not expect the chainsaw dog to be the emotional core of it.')?.stands, '');
});

test('nothing worth keeping is nothing', () => {
  assert.equal(parseReadingTake(''), null);
  assert.equal(parseReadingTake('ok'), null);
  assert.equal(parseReadingTake('STANDS: chapter 3'), null, 'a bookmark alone is not a thought');
});

test('a bookmark on her shelf keeps its source and manga id', () => {
  const kept = readReading({ seriesId: '1', title: 'Chainsaw Man', chapter: '1', chapterId: '1', page: 0, pages: 53, startedAt: '', lastAt: '', finished: 0, source: 'suwayomi', mangaId: 1 })!;
  assert.equal(kept.source, 'suwayomi');
  assert.equal(kept.mangaId, 1);
  const old = readReading({ seriesId: 'abc', chapterId: 'def' })!;
  assert.equal(old.source, undefined);
  assert.equal(old.mangaId, undefined);
});
