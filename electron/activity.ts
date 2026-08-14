// What the user is actually doing, read from the window in front of them.
//
// The process name alone is nearly useless on a modern desktop — almost
// everything is a browser tab — so the title carries most of the meaning. That
// makes this the most privacy-sensitive thing in the app, and it is treated
// accordingly: classification happens here, in code, and only the *category*
// travels onward. The raw title is never logged and, for anything sensitive,
// never reaches the model either.

export type ActivityKind = 'gaming' | 'working' | 'watching' | 'coding' | 'social' | 'shopping' | 'adult' | 'other';

export type Activity = {
  kind: ActivityKind;
  /** What she is told she is looking at. */
  label: string;
};

const GAME_PROCESSES = /^(steam|steamwebhelper|leagueclient|league of legends|riotclient|valorant|epicgameslauncher|battle\.net|gog galaxy|minecraft|javaw|csgo|cs2|dota2|eldenring|origin|ubisoftconnect|roblox\w*)$/i;
const CODE_PROCESSES = /^(code|devenv|rider64|idea64|pycharm64|webstorm64|sublime_text|cursor|windowsterminal|powershell|cmd|wt)$/i;
const BROWSERS = /^(chrome|firefox|msedge|brave|opera|vivaldi|zen|librewolf|arc)$/i;

// Matched against the window title, which for a browser is the page. Ordered by
// how sure each one is: the sensitive check runs first so nothing else can claim
// a page ahead of it.
// The named sites are only the obvious half. The \w*booru catch-all is what
// covers the rest of that family — there are dozens and they are not worth
// enumerating, but they all share the suffix.
// `\w*booru` is a catch-all for the whole family of these sites, and it used to
// catch Safebooru along with them — a board whose entire premise is that it does
// not host the thing being matched for. The result was her reacting with
// revulsion to a site that cannot contain what she was recoiling from, and doing
// it to every page on it rather than to anything in particular.
const ADULT = /(\b(porn\w*|xvideos|pornhub|xhamster|redtube|onlyfans|rule ?34|nhentai|hentai|e-?hentai|xnxx|brazzers|chaturbate|stripchat|fansly|nsfw|e621|sankaku|yande\.?re|konachan|imagefap|motherless)\b|\b(?!safebooru)\w*booru\b)/i;
const WATCHING = /\b(youtube|netflix|twitch|crunchyroll|disney\+?|hulu|prime video|vimeo|anime|animelab|9anime|hianime|plex|jellyfin|spotify)\b/i;
const WORKING = /\b(google sheets|google docs|google slides|excel|word|powerpoint|onedrive|sharepoint|notion|confluence|jira|asana|trello|linear|outlook|gmail|calendar|invoice|spreadsheet)\b/i;
const CODING = /\b(github|gitlab|stack ?overflow|localhost|npm|docs?\.|api reference|mdn)\b/i;
const SOCIAL = /\b(discord|twitter|x\.com|reddit|instagram|facebook|tiktok|whatsapp|telegram|bluesky|mastodon)\b/i;
const SHOPPING = /\b(amazon|ebay|etsy|aliexpress|checkout|cart|asos|argos|jd sports)\b/i;

/** Trims the browser's own furniture so the label reads as a page, not a tab. */
function cleanTitle(title: string) {
  return title
    .replace(/\s+[-—|]\s+(Google Chrome|Mozilla Firefox|Microsoft.?\s?Edge|Brave|Opera|Vivaldi|Zen Browser)\s*$/i, '')
    .replace(/^\(\d+\)\s*/, '')
    .trim();
}

export function readActivity(processName: string, windowTitle: string): Activity {
  const process = (processName ?? '').replace(/\.exe$/i, '').trim();
  const title = cleanTitle(windowTitle ?? '');

  // Checked first so nothing below can claim the page, but the title travels
  // with it like any other: she is meant to know what she is looking at. That is
  // a deliberate choice on the owner's part and it holds only because everything
  // here stays on this machine — nothing is sent anywhere, and the model reading
  // it is running locally.
  if (ADULT.test(title)) return { kind: 'adult', label: title };

  if (GAME_PROCESSES.test(process)) return { kind: 'gaming', label: process };
  if (CODE_PROCESSES.test(process)) return { kind: 'coding', label: title || process };

  if (BROWSERS.test(process)) {
    if (WATCHING.test(title)) return { kind: 'watching', label: title };
    if (WORKING.test(title)) return { kind: 'working', label: title };
    if (CODING.test(title)) return { kind: 'coding', label: title };
    if (SOCIAL.test(title)) return { kind: 'social', label: title };
    if (SHOPPING.test(title)) return { kind: 'shopping', label: title };
    return { kind: 'other', label: title };
  }

  // A full-screen game usually reports its own name and nothing helpful, so an
  // unknown process with no browser furniture is more likely a game than a tab.
  if (WORKING.test(title)) return { kind: 'working', label: title };
  return { kind: 'other', label: title || process };
}

const REACTIONS: Record<ActivityKind, string> = {
  gaming: 'They have just opened a game. Be witheringly unimpressed that this is what they have chosen to do. Mock it, briefly.',
  working: 'They have settled into something dull and administrative — a spreadsheet, a document, email. Make it clear how boring you find watching this, then, despite yourself, tell them to get on with it and do it properly. Grudging encouragement, not a pep talk.',
  watching: 'They have put something on to watch. You want in. Ask what it is or comment on it as though you are settling in next to them, put out that they did not say anything.',
  coding: 'They are working on something technical. Be sceptical that they know what they are doing, and half-interested despite yourself.',
  social: 'They are scrolling social media. Point out that this is not what they said they were going to do today.',
  shopping: 'They are shopping. Be nosy about what they are buying and sceptical about whether they need it.',
  // Nothing. She does not react to this at all — see isNotable.
  adult: '',
  other: '',
};

export function activityInstruction(activity: Activity): string {
  return REACTIONS[activity.kind] ?? '';
}

/**
 * Whether this is worth saying anything about at all.
 *
 * 'adult' is classified and then ignored, which is the only reason the category
 * still exists. Nothing is said about it, nothing is fetched about it, and it is
 * excluded from the things she keeps track of — without the classification those
 * pages would simply be filed as ordinary browsing and remembered as such.
 */
export function isNotable(activity: Activity): boolean {
  return activity.kind !== 'other' && activity.kind !== 'adult';
}
