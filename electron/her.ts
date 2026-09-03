// Her, for the Her tab.
//
// The standing screen says where they stand with her. This is the other half:
// what she has of her own — the things she has taken up, the nights she has
// spent on them, what she rates, what she wants — read straight from the
// records those features keep (tastes.ts, nightlife.ts, diary.ts). Nothing is
// composed here: a dashboard that asked a model to summarise her would be a
// model's idea of her, and the point of the records is that they are what
// actually happened.

import type { Interest } from './tastes';
import type { Night } from './nightlife';
import type { Entry } from './diary';

export type HerThing = {
  name: string;
  kind: Interest['kind'];
  since: string;
  nights: number;
  because: string;
  stance: string;
  favourite?: string;
  wants?: string;
  stands?: string;
};

export type Adventure = {
  day: string;
  at: string;
  /** What she went looking for. */
  about: string;
  /** "one of her things", "sizing up his game", or "on a whim". */
  why: string;
  note: string;
  sources: string[];
};

export type Her = {
  things: HerThing[];
  adventures: Adventure[];
  /** Everything she rates, across her things. */
  likes: { name: string; of: string }[];
  /** Everything she wants, across her things. */
  wants: { wish: string; of: string }[];
  diary: { entries: number; since?: string; latest?: { day: string; title: string } };
  /** How many nights she has been at it, and the first. */
  nightsOut: { count: number; first?: string };
};

export function herFrom(input: { interests: Interest[]; nights: Night[]; diary: Entry[] }): Her {
  const interests = [...input.interests].sort((a, b) => b.nights - a.nights || a.since.localeCompare(b.since));
  const things: HerThing[] = interests.map(i => ({
    name: i.name, kind: i.kind, since: i.since, nights: i.nights, because: i.because, stance: i.stance,
    ...(i.favourite ? { favourite: i.favourite } : {}), ...(i.wants ? { wants: i.wants } : {}), ...(i.stands ? { stands: i.stands } : {}),
  }));
  const adventures: Adventure[] = [...input.nights].sort((a, b) => b.at.localeCompare(a.at)).map(n => ({
    day: n.day, at: n.at, about: n.about,
    why: n.interest ? `one of her things: ${n.interest}` : n.game ? `sizing up ${n.game}, which he plays` : 'on a whim',
    note: n.note, sources: (n.sources ?? []).filter(Boolean),
  }));
  const likes = interests.filter(i => i.favourite).map(i => ({ name: i.favourite!, of: i.name }));
  const wants = interests.filter(i => i.wants).map(i => ({ wish: i.wants!, of: i.name }));
  const days = input.diary.map(e => e.day).sort();
  const latest = [...input.diary].sort((a, b) => b.day.localeCompare(a.day))[0];
  const nightDays = [...new Set(input.nights.map(n => n.day))].sort();
  return {
    things, adventures, likes, wants,
    diary: { entries: input.diary.length, ...(days[0] ? { since: days[0] } : {}), ...(latest ? { latest: { day: latest.day, title: latest.title } } : {}) },
    nightsOut: { count: nightDays.length, ...(nightDays[0] ? { first: nightDays[0] } : {}) },
  };
}
