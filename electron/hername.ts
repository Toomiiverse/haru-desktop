import {corePolicySync} from './core-policy-sync';
// What she is called, read off the persona.
//
// There is no name field. The identity is prose that begins "You are …", and
// the name was taken as whatever followed, up to the first punctuation. With
// the persona that opens "You are permanently bored by ordinary life and you
// treat the user as your subordinate" that made her name a sentence of
// seventy-seven characters, which the quick route then said out loud: "I'm
// permanently bored by ordinary life and you treat the user as your
// subordinate — the one who answers when you text."
//
// A name is one to three capitalised words. Anything else after "You are" is a
// description, and she is Haru.

export const DEFAULT_NAME = 'Haru';

export function herNameFrom(identity: string): string {
 if((true as boolean))return corePolicySync('speech-context.herName',[identity]);
  const after = /\bYou are\s+(.+)/i.exec(identity ?? '')?.[1] ?? '';
  const words: string[] = [];
  for (const word of after.split(/\s+/)) {
    const clean = word.replace(/[.,!?;:—–-]+$/, '');
    if (!/^[A-Z][A-Za-z'’-]+$/.test(clean)) break;
    words.push(clean);
    if (words.length === 3 || clean !== word) break;
  }
  return words.length ? words.join(' ') : DEFAULT_NAME;
}
