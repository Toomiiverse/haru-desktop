import {devicePolicy} from './core-device-activity';
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

/** Things that go fullscreen to play a film, not a game. */
const MEDIA_PLAYERS = /^(vlc|mpv|mpc-hc\w*|wmplayer|potplayer\w*|kodi|plex\w*|jellyfin\w*)$/i;

/** Apps that cover a monitor all day and are famously not games. The first
 *  run of this promotion made a game folder for the Claude window it was
 *  written in. */
const NOT_GAMES = /^(claude|discord|slack|teams|ms-teams|notion|obsidian|spotify|figma|telegram|whatsapp|signal|element|zoom|vesktop)$/i;

/**
 * The call remade once the window goes fullscreen.
 *
 * The process list above only knows launchers and Steam's biggest names, so a
 * game it has never heard of — Zenless Zone Zero arrives from HoYoPlay as
 * "ZenlessZoneZero", on no list — reads as 'other' and none of the gaming
 * machinery fires. Fullscreen is the evidence the list lacks — the helper
 * reports it one line before the window's own foreground line, so the
 * foreground handler applies this when the fullscreen title matches its own: a
 * fullscreen window from an unknown process is a game, unless the process is a
 * known film player. Browsers and code never reach this — they classified as
 * themselves, not 'other'. A label that is one CamelCase word is the exe's own
 * name, and gets its spaces back before anything says it out loud.
 */
export function promotedByFullscreen(activity: Activity, processName: string): Activity {
  if (activity.kind !== 'other') return activity;
  const process = (processName ?? '').replace(/\.exe$/i, '').trim();
  if (MEDIA_PLAYERS.test(process) || NOT_GAMES.test(process)) return activity;
  // A game titles its window as its own exe — ZenlessZoneZero, GenshinImpact.
  // A browser, a chat app, an editor titles it as the page or the document,
  // and that difference is what separates a game the list has never heard of
  // from any app that happens to cover a monitor.
  const strip = (text: string) => text.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!strip(activity.label) || strip(activity.label) !== strip(process)) return activity;
  // ponytail: a game whose title differs from its exe (Wuthering Waves ships as
  // Client-Win64-Shipping) is missed — add it to GAME_PROCESSES when it comes up.
  const label = /^[A-Za-z0-9]+$/.test(activity.label) ? activity.label.replace(/(?<=[a-z0-9])(?=[A-Z])/g, ' ') : activity.label;
  return { kind: 'gaming', label: label || activity.label };
}
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
 if(globalThis.process.env.HARU_CORE_DEVICE_ACTIVITY==='on')return devicePolicy('readActivity',[processName,windowTitle]);
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

/**
 * Windows that are a tool being used, not a thing being done.
 *
 * A snip overlay covers the whole screen and reports itself as fullscreen, so
 * she announced "A FULLSCREEN WINDOW OF... NOTHING!" at somebody taking a
 * screenshot. The same goes for the task manager, an installer, a file dialog —
 * these are means, and remarking on them is like commenting on someone reaching
 * for a pen.
 *
 * Matched on process and title both, because a snip overlay often has no title
 * at all, and an empty title is itself the giveaway that there is nothing there
 * to react to.
 */
const A_TOOL = /^(snippingtool|screenclippinghost|screensketch|snagit\w*|greenshot|sharex|lightshot|taskmgr|mmc|regedit|dwm|explorer|shellexperiencehost|searchhost|startmenuexperiencehost|applicationframehost|textinputhost|lockapp|consent|msiexec|systemsettings|installer|setup)$/i;
const TOOL_TITLE = /^(snipping tool|screen ?snip|screen ?sketch|snip & sketch|task manager|settings|open|save as|save|browse|select a file|choose|user account control|program compatibility|windows security)$/i;

/**
 * Whether this window is worth her noticing at all.
 *
 * Distinct from isNotable, which asks whether a *category* deserves a remark.
 * This asks whether there is really a window there — an untitled overlay is not
 * something they have opened, it is something passing across the screen.
 */
export function isJustATool(processName: string, windowTitle: string): boolean {
 if(globalThis.process.env.HARU_CORE_DEVICE_ACTIVITY==='on')return devicePolicy('isJustATool',[processName,windowTitle]);
  const process = (processName ?? '').replace(/\.exe$/i, '').trim();
  const title = (windowTitle ?? '').trim();
  if (A_TOOL.test(process)) return true;
  if (TOOL_TITLE.test(title)) return true;
  // Nothing to go on. A window with neither a name nor a recognisable process is
  // an overlay or a stray frame, and she has nothing to say about it that is not
  // invented.
  return !title && !process;
}

export function activityInstruction(activity: Activity): string {
 if(globalThis.process.env.HARU_CORE_DEVICE_ACTIVITY==='on')return devicePolicy('activityInstruction',[activity]);
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
 if(globalThis.process.env.HARU_CORE_DEVICE_ACTIVITY==='on')return devicePolicy('isNotable',[activity]);
  return activity.kind !== 'other' && activity.kind !== 'adult';
}
