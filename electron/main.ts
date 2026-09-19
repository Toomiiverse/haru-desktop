import { app, BrowserWindow, dialog, ipcMain, Menu, type MenuItemConstructorOptions, nativeImage, nativeTheme, net, powerMonitor, protocol, safeStorage, screen, shell, desktopCapturer } from 'electron';
import path from 'node:path';
import os from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { appendFileSync, copyFileSync, existsSync, readdirSync, mkdirSync, readFileSync, rmSync, statSync, statfsSync, watch, writeFileSync, type FSWatcher } from 'node:fs';
import { execFile, spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import AdmZip from 'adm-zip';
import { HaruStore } from './store';
import { formatTimeOfDay, localDateKey, parseTimeOfDay, resolveDate, zonedNow } from './dates';
import { connectGoogle, disconnectGoogle, googleStatus, pullEvents, pullTasks, pushItem, pushTask, removeItem, removeTask, saveCredentials } from './google';
import { afterCooldown, afterEgoCooldown, afterPoke, egoInstruction, goodnightInstruction, IGNORE_THRESHOLD, IRRITATION_MAX, isGoodnight, isIgnoring, isLowEffort, isRedo, leverageInstruction, moodInstruction, nextEgo, nextIrritation, notTwiceInstruction, shoutInstruction, shoutState, type ShoutState, EGO, IRRITATION, IRRITATION_NOTCH, rescaleOldMood } from './mood';
import { nextPokeCount, pokeEmotion, pokeInstruction, pokeIrritation, pokeTier, type PokeKind } from './poke';
import { applyEvent, chooseIdleAction, cueLog, DEFAULT_VITALS, driftVitals, nextTickDelayMs, shouldPersistVitals, type Environment, type Lean, type Vitals } from './vitals';
import { classificationPrompt, EMOTION_SCHEMA, EMOTIONS, NEUTRAL_EMOTION, parseEmotion, type Emotion, type EmotionName, faceForEmotion, localEmotion } from './emotion';
import { withDiscoveredExpressions } from './expressions';
import { reportCapabilities, seesItsOwnScreen } from './capabilities';
import { followCalendar, chaseableOverdue, findItem, shiftDays, formatAgenda, itemStatus, missedInstruction, movedSaid, putOffInstruction, putOffUntil, relevantItems, readsAsAnswerToHer, readsAsBareReport, tickOffInstruction, readsAsDone, doneClause, readsAsNotDone, relativeDay, staleItemNamed, inventedTimeFor, raisedRecently, type ItemStatus, underwayClause, isUnderway, FOLLOW_UP_MS } from './agenda';
import { isRelaunchNotReturn, openingAngles, pickAngle, shouldPipeUp, PIPE_UP_CHANCE } from './opening';
import { allDayDueMinutes, isEveningCheck, reminderInstruction, reminderTier, reminderVolume, shouldRemind, type ReminderState } from './reminders';
import { isHeated, readTone, sharpen, toneGesture, tonePose } from './tone';
import { isSilenced, nextPushback, PUSHBACK_LIMIT, pushbackInstruction, readsAsDropIt, type Pushback } from './pushback';
import { activityInstruction, isJustATool, isNotable, readActivity, type Activity, type ActivityKind } from './activity';
import { belongsToPlace, expireHaunts, familiarity, markRemembered, noteExchange, noteVisit, readHaunts, rememberSaid, worthRemembering } from './familiar';
import { discoverWardrobe, type ParameterRange, type WardrobeControl } from './wardrobe';
import { looksLikeNothing, readListenConfig, transcribe, type ListenConfig } from './listen';
import { spokenVocabulary } from './vocabulary';
import { herNameFrom } from './hername';
import { apnsPayload, apnsSigner, readApnsConfig, readApnsDevices, sendApns, type ApnsDevice } from './apns';
import { answersHerOwnQuestion, looksLikeAnEcho, parseSecondThought, readsAsTheirAnswer, secondThoughtDelay, secondThoughtNote, wantsSecondThought, SECOND_THOUGHT_GAP_MS, SECOND_THOUGHT_ODDS } from './secondthought';
import { applyRevoices, dueForRevoice, exchangesFrom as revoiceExchanges, grounded, parseRevoices, readRevoiceState, revoicePrompt, withRewrites, REVOICE_EVERY, type Revoice } from './revoice';
import { decide, readEscalateConfig, type EscalateConfig } from './escalate';
import { describeFailure, fromOpenAIReply, isOpenAIShaped, promptUsage, toOpenAIBody, DEFAULT_ENDPOINTS, type ChatTool, type Provider } from './provider';
import { formatPage, formatResults, readSearchConfig, lookItUpInstruction, readWebPage, SearchBlocked, searchWeb, type SearchConfig, type SearchResult } from './search';
import { mayWander, pickDestination, readRoamConfig, refugeFrom, speedFor, step, nextWanderDelay, type Point, type RoamConfig } from './roam';
import { angleFor, mayNotice, noteNoticed, readNotices, type Page as NoticedPage, type PageState } from './noticing';
import { CAPTURE_HEIGHT, CAPTURE_WIDTH, readWatchingConfig, recentScene, sceneAsk, shouldLook, watchingPrompt, worthMentioning, type WatchingConfig } from './watching';
import { gameMemoryForPrompt, noteInGameMemory, openGameMemory, timesThisWeek, welcomePrompt } from './games';
import { buildGameIndex, gameFor } from './steam';
import { pdfPrompt, readPdf } from './pdf';
import { classify, discard, extractAudio, extractFrames, findFfmpeg, OPENABLE, readText, type FileKind } from './attach';
import { markTimeGaps, sinceLast, earlierDaysContext, earlierTurns, DAYS_OF_HISTORY, HISTORY_BUDGET_CHARS } from './history';
import { exchangesFrom, pickRecalled, recallNote, RECALL_FLOOR, RECALL_LIMIT, type Exchange } from './recall';
import { buildChatIndex, chatHitsNote, embedFormat, embedText, mentionsAny, rareTerms, searchChats, type ChatIndex } from './chatsearch';
import { applyExtraction, dayChunks, emptyGraph, EXTRACTION_SCHEMA, extractionInput, extractionPrompt, knownBlock, linkedFacts, linkedNote, readExtraction } from './factgraph';
import { admitBooking, bookedNote, bookedPrompt, BOOKED_KIND, createScheduler, describeWhen, resolveBookingTime, zonedEpoch, type Job, type Outcome } from './scheduler';
import { describeGap, isRumination, keepThoughts, lastSpoken, mayAsk, mayInitiate, mindNote, noteAsked, pendingTrigger, readThoughts, roundVector, scoreThought, spend, spokenOn as thoughtsSpokenOn, THINKING_RULES, thinkingInput, THOUGHT_LIMITS, thoughtPrompt, withoutClock, type ThinkingState, type Thought, type ThoughtState, type Trigger } from './thoughts';
import { vitalsInstruction } from './vitals';
import { activeCards, loreNote, parseLorePage, LORE_PAGE, type LoreCard } from './lore';
import { examplePool, examplesNote, pickExamples, reusedExample, type Example, type ExampleTurn } from './examples';
import { applyGraphPage, GRAPH_PAGE, pageReportLine, readGraphPage, renderGraphPage } from './graphpage';
import { correct, narrow, noteUsed, readHearing, remember } from './hearing';
import { assumeItIsTheirs, identifyWork, noteWork, readFollowing, recogniseNow, summariseFollowing } from './following';
import { lookUpPlace, readWindowsLocation, searchPlaces, type FoundPlace } from './location';
import { INTERRUPTED_ASIDE, wakeAck } from './wake';
import { acceptedOffer, promisedTitle, reminderAsk, reminderPromised, reminderSavedAside } from './remindme';
import { describeWeather, readForecast, weatherEvents, weatherToDrawOn, weatherUrl, WEATHER_A_DAY, WEATHER_POLL_MS, type WeatherSample, disputesRain } from './weather';
import { HANGING_COOLDOWN_MS, isClosing, leftHanging, saidTheyWereLeaving } from './hanging';
import { awakeHoursSince, theyAreUp, awakeMinutesSince, quietEndedAt } from './awake';
import { describeTold, placeToldFrom, toldTheyAreBusy, toldStillStands, type Told, errandsToldFrom, errandToAskAfter, type Errand } from './told';
import { markMentioned, upcomingToMention } from './upcoming';
import { directionsAskFrom, directionsNote, dropRouteTalk, matchNamedPlace, startingPoint, withDirections, withoutMapsLinks, type DirectionsAsk, claimsTraffic, withoutTrafficDenials } from './directions';
import { absorb, describeWhereabouts, distanceM, forgetPlace, homeOf, namePlace, placeAt, readSpot, readWhereabouts, whereForPage, type Whereabouts, SPOT_STALE_MS, saidTheyWereGoing, unannouncedArrivalNote, withoutWhereDenials, type Arrival } from './whereabouts';
import { bodyForPage, describeBody, readBody as readBodyState, readBodyReport, type Body } from './body';
import { convertImage, normaliseFormat, FORMATS } from './convert';
import { cancelPower, closeApp, findApps, isCancellable, launch, listRunning, matchApp, matchRunning, normalisePower, POWER_DELAY_S, readDesktopConfig, runPower, supportedDesktop, type DesktopConfig } from './desktop';
import { looksLikeScreenshot, maySpeak, readScreenshotConfig, screenshotPrompt, SETTLE_MS, SETTLE_TRIES, type ScreenshotConfig } from './screenshots';
import { look, photoName, readShotDescription, readVisionConfig, whileLooking, type VisionConfig } from './vision';
import { CAPTION_MAX_CHARS, describedShots, forgetCaptions, moreThanOnePass, noteCaption, noteFailure, readCaptions, shotsNeedingALook } from './seen';
import { breaksMute, brokeMuteNote, isMuted, muteNote, readMuteAsk, unmuteNote, weighMute, type MuteState } from './mute';
import { LAYER, compileLog, type Candidate } from './compile';
import { charterTraits, feelingsShowAt, growMonth, growthNote, readTraits, traitLean, traitMeter, travelled, TRAIT_NAMES, type GrowthStep, type MonthSignals, type Traits } from './growth';
import { apologyOdds, muteLean, sway, type Sway } from './dice';
import { NO_FEELINGS, FELT, feel, feelingsInstruction, feelingsLog, feelingsOverTime, readFeelings, readsAsBanter, readsAsEnding, readsAsScare, type FeelingEvent, type Feelings } from './feelings';
import { addLeans, bruiseFrom, eventSize, fadeBruise, howHisReturnLands, rollTemperament, stepWander, temperamentLean, temperamentLine, temperamentWord, type Temperament, type TemperamentKind } from './temperament';
import { EXPRESSIVE, HOSTED_VOICE, LAST_WORD, NATURAL, NO_INVENTED_HISTORY, NO_ABANDON_THREAD, readsAsRough, roomInstruction, HER_EMOJI, emojiRut, roomToRant, askingAboutHer, herSubjectNote, namesIn, justTalking, JUST_TALKING_NOTE } from './room';
import { journalStance } from './journal';
import { haruNote, rangeStats, type HaruNote, type RangeName, type RangeStats } from './journal';
import { describeRating, entryFor, journalPrompt, readEntries, readJournalConfig, readRating, recentTrend, shouldAsk, upsertEntry, SCALE_MAX, type JournalConfig, type JournalEntry } from './journal';
import { formatList, formatMedia, formatMissing, lookUp, readAniListConfig, userList, type AniListConfig, type ListEntry, type MediaKind } from './anilist';
import { createDesktopShortcut, desktopShortcutPath, isAutoStartEnabled, setAutoStart, startedHidden } from './startup';
import { answersThePrompt, CUE_NOTE, isCue, stageNote, dropRoleHeader, dropTackedOnParagraphs, dropInventedContact, dropInventedScreenTalk, dropRepeatedAgendaMentions, dropRepeatedParagraphs, dropStageDirections, dropRepeatedOpener, dropEchoOpener, dropRepeatedSentences, fixStatedClock, fixStatedReminderTime, fixStatedMinutes, dropOverusedEmoji, oneEmojiAtMost, dropClosingOrder, thinksAloud } from './reply';
import { runToolLoop } from './toolloop';
import { chatTools, coerceKnowledgeCategory, downloadsRelevant, machineRelevant, runChatTool, shellRelevant, steadyTable, type ToolAvailability, type ToolDeps } from './tools';
import { describeMyself, describeSettings, planChange, readSelfSnapshot, SETTINGS, type SettingPlan } from './self';
import { pickBreath } from './breaths';
import { createMemoryStore } from './memorystore';
import { createKnowledgeStore } from './knowledgestore';
import { behaviourOf, chatSystemPrompt, chatDynamicContext, FIRST_PERSON_NOTE, freshStartInstruction, type FreshStart, type RatedReply, LENGTH_RULE_LOCAL, LENGTH_RULE_HOSTED } from './prompt';
import { hasShout, readVoiceConfig, referenceFor, shoutReference, spokenCase, speakableText, splitForSpeech, streamedSentences, synthesise, synthesiseBreezeStream, type SpeechClip, type VoiceConfig, looksClipped, HUME_DESCRIPTIONS, HUME_STREAM_URL } from './voice';
import { hearVoice, readHumeConfig, readingFrom } from './hume';
import { readEviConfig, newSessionId, secondsUsedToday, noteUsage, underCap, callAside } from './evi';
import { readCallConfig, pickFiller } from './call';
import { openLocalCall, withoutWavHeader, oneChunk, wavSampleRate } from './localcall';
import { openEviSession } from './evibridge';
import { setDefaultAutoSelectFamilyAttemptTimeout } from 'node:net';
import { readBrowserControlConfig } from './browserctl';
import { listSessions, openSession, readClaudeCodeConfig, readOpenedSessions, resolveSessionDir, sessionName, SESSIONS_KEPT as CLAUDE_SESSIONS_KEPT, stopSession, type SessionHost } from './claudesession';
import { ShellGate, SERVER_NOTE, denied, ledgerEntry, readShellConfig, runCommand } from './shell';
import { PokemonLink, PLAY_RULES as POKEMON_PLAY_RULES, afterTurn, describeGame, newSitting, parseMove, readPokemonConfig, runNote, sittingSummary, whyNotStart as whyNotStartPokemon, whyStop as whyStopPokemon, type GameState, type Moment as PokemonMoment, type Sitting } from './pokemon';
import { HANDS_TURN, HER_HANDS_TOOLS, didNothing, handsInstruction, handsNote, handsToday, keepHands, readHands, readHandsConfig, whyNotAct } from './herhands';
import { Suwayomi, fetchFits, fetchSummary, hisReading, hisReadingNote, matchManga, onHisShelf, readerLink, readSuwayomiConfig, spiteful, type HisTitle, type ShelfChapter, SPITE_ODDS } from './suwayomi';
import { serverLookNote } from './prompt';
import { Downloads, downloadsReady, readDownloadsConfig } from './downloads';
import { applyDecay, DEEP_RECALL_LIMIT, findSuperseded, formationPrompt, formationWindows, MEMORIES_PER_DAY, readFormation, type FormedNote, formatMemoryPrompt, isExplicitRecall, closeEvents, isWorthAnEvent, isWorthKeeping, isWorthRemembering, MEMORY_KINDS, migrateMemories, monthFoldPrompt, pruneMemories, readsAsSecondPerson, rememberInto, retrieveMemories, semanticSimilarities, summaryPrompt, supersede, THIRD_PERSON_AGAIN, vectorSimilarity, type ForgettingEntry, type MemoryKind, type MemoryRecord, type MemorySource, type RetrievalFactors, type ScoredMemory, type SessionSummary } from './memory';
import { consolidateMemories, type ConsolidationChange } from './consolidation';
import { appendToBlockValue, canEditBlock, findBlock, formatMemoryBlocks, replaceInBlockValue, resolveBlockValue, resetBlockToDerived, withEditedValue, type BlockSources, type MemoryBlock } from './blocks';
import { forgetDevice, forgetEveryDevice, readWebAccess, setPassword, weakPassword, type WebAccess } from './web';
import { conversationMayLeave, mayLeaveTheMachine } from './sensitivity';
import { addCheckIn, checkInInstruction, checkInsOn, readCheckIns, type CheckIn } from './checkins';
import { standingFrom } from './standing';
import { herFrom } from './her';
import { computeRoute, fixStatedRoute, routeWords, type Route } from './routes';
import { easedEnough, easedFallback, easedPrompt, gaveUpFallback, gaveUpPrompt, stopsTrafficWatch, trafficWatchAsk, TRAFFIC_WATCH_KIND, WATCH_EVERY_MS, WATCH_FOR_MS, watchJob, watchNote } from './trafficwatch';
import { placeAsk, placeNote, placeWords, searchGooglePlaces, type GooglePlace } from './placeinfo';
import { addAside, alreadySaidRecently, echoesAside, asideContext, asidesOn, spliceRecentAsides, markReached, pruneAsides, readAsides, type Aside, type AsideSource, markAsked, openAsk, answerAsk, askedRecently, unansweredAsksNote } from './asides';
import { attachmentsInPlay, describeAttached, READ_IT_ALL_PROMPT, readAttachments, type Attachment, type Opened } from './attachments';
import { forOllama, withoutOldest } from './ollamaturns';
import { seedEmoji, seedOffTheOrders } from './seed';
import { pickToBringUp, REMEMBERED_PICKS } from './bored';
import { ANSWER_WINDOW_MS, grudgeAfterApology, grudgeInstruction, irritationAfterTally, nextGrudge, NOT_HELD_AGAINST_THEM, tallyDue, tallyInstruction, unanswered, type Said } from './grudge';
import { groundedInstruction, placeQuery } from './places';
import { daySaid, TOLD_ENOUGH, type DaySaid, DEFAULT_BEDTIME_MINUTES, howTheDayWent, nightfallDue, sulkGrudge, sulkInstruction, sulkStillStands, type DayVerdict } from './nightfall';
import { keepNights, lastNightDay, nightNoteInstruction, nightsInstruction, nightsOn, nightsToDrawOn, pickInstruction, tidyPick, timeForSomething, type Night, nightToRaise, NIGHT_ODDS } from './nightlife';
import { gamesPlayedLately, GUIDE_ODDS, guideNoteInstruction, guideQuery, pickGame, withSteam, type Played } from './gamenight';
import { addressesSomeone, adopt, ADOPT_ODDS, adoptInstruction, deepen, deepenInstruction, isOneOfTheirs, MAX_INTERESTS, nightQuery, NOBODY_HERE, parseAdoption, parseDeepening, pickTonight, tastesInstruction, unaddressed, type Interest } from './tastes';
import { readSteamWebConfig, recentlyPlayed } from './steamweb';
import { appendDream, appendEntry, diaryContext, diaryDueFor, diaryInstruction, recentEntries, type Dream, type Entry } from './diary';
import { DIARY_VOICE, fragmentsInstruction, liftedFrom, NOT_THOSE_LINES, NOT_THOSE_NAMES, unknownNames } from './diaryvoice';
import { fetchTranscript, formatTranscript, titleFrom, transcriptInstruction, transcriptsAvailable, videoIdFrom, watchUrl } from './transcripts';
import { feedbackEntry, recordFeedback } from './feedback';
import { describePull, isTailnetAddress, mergeCheckIns, readCheckInSource } from './checkinsource';
import { describeMerge } from './memorysync';
import { describeShot, mergeActivity, noteActivity, noteScreenshot, summariseDay } from './activitylog';
import { heldShots, keepShot, localShots, missingFrom, pruneShots, readShot, MAX_SHOT_BYTES } from './shotstore';
import { startWebServer, type WebDeps } from './webserver';
import { openingInstruction, openingsDueNow, type DueOpening } from './standingtime';
import { parseVaultMemoryPage, VAULT_MEMORY_PAGES, type VaultMemoryPage } from './vaultmemories';
import { planRetirement, readAdmitted, recordsToRetire, type Admitted } from './vaultretire';
import { afterReading, feedUrl, pagesUrl, parseReadingTake, PAGE_PROMPT, readableChapters, readingInstruction, readingNote, readReading, REQUEST_GAP_MS, searchUrl, tonightsPages, USER_AGENT, type ChapterRef, type Reading } from './manga';
import { cleaningChunks, deliveryReminder, deliveryRule, hasDeliveryLabel, splitDelivery, stripDelivery, MOOD_ALIASES } from './delivery';
import { deedFrom, isADeed, keepDeed, readDeeds } from './deeds';
import { isHerStanding } from './herstanding';
import { enoughToStandOn, herStandings, keepSlight, parseStanding, readSlights, recentIncidents, slightsAsIncidents, standingDue, standingPrompt, HER_SUBJECT, type Incident, type Slight } from './herstanding';
import { blockedLine, asleepLine, backToSleep, dayAfter, decideTimesSystem, dozeOffDue, enoughKnocking, fallbackSchedule, foldAsleepExchanges, goodnightDue, groggyFor, groggyNote, herAsleep, isAsleepLine, knockedAwake, messagesWhileAsleep, parseDecidedTimes, pointlessWake, pointlessWakesLately, readsAsGoodnight, readHerSleep, readHerSleepState, readWakes, sleepNote, sleepWindowOn, wakeIrritation, wakeNote, wokenAt, clockMinutes, BLOCKED_LINE, BLOCK_AFTER_POINTLESS, KNOCK_WINDOW_MS, WAKES_KEPT, type HerSleepSchedule, type Wake } from './hersleep';
import { parseBalances, balanceWarning } from './venicebalance';
import { advanceWant, dayNote, dayNoteInstruction, dayPassDue, dayPickInstruction, firstsNote, keepDay, markRecFollowed, noteRecommendation, pickRecommend, pickWantToWork, readDays, readRecs, readWants, readWeek, recDueForFollowUp, reconcileWants, recsAnsweredBy, recsOnDay, wantInstruction, wantOutcome, wantQuery, wantsNote, weekKey, weekNote, weekReflectionInstruction, weekSummaryDue, WANT_ODDS, type HerDay, type HerWeek, type Rec, type Want, DAY_ODDS } from './ownlife';
import { inQuietHours, newVapidKeys, pushRequest, readPushDevices, readPushPrefs, type PushDevice, type PushPrefs, nextNudgeDelay, NUDGE_GAP_MS, NUDGE_RETRY_MS, nudgeOverdue, PUSH_BREATHER_MS, tooSoonToPush, heldBack, withoutDevice, isPhoneWebApp, coveredByNativeApp } from './push';
import { CHECK_EVERY_MS, describeUpdate, progressStep, whyNotCheck, type UpdateState } from './updates';
import { BREVITY, summonedLine } from './summoned';
import { CHOICES_TOOL, readChoices } from './choices';
import { quickAnswer, settingCommand, type AgendaLine } from './quick';
import { newTrace } from './trace';
import { KNOWLEDGE_CATEGORIES, knowledgeStats, type KnowledgeCategory } from './knowledge';
import type { IngestResult } from './ingestion';
import type { Embedder } from './embeddings';
import { retrieveContext } from './retrieveContext';
import type { VaultSyncReport } from './obsidian';
import { diaryNotes, herNote, indexNote, memoriesNote, nightNotes, placesNote, standingNote, writeNotes } from './vault';
import { categoryOf, LEGACY_KIND, namesSomeoneElse, readSorting, sortInput, sortPrompt, type SortNote, type Sorted } from './categories';
import { collectAll, collectDocker, collectDockerLight, collectGpu, collectGpuApps, collectProcesses, collectServices, collectSystem, diagnose, KNOWN_SERVICES, USER_SERVICES, type Diagnosis } from './system';
import { carriedSamples, checkEvents, sampleFromCollectors, type EventThresholds, type SystemSample } from './systemState';

type Bounds = { x: number; y: number; width: number; height: number };
type Live2DModel = { path: string; name: string; url: string };
// A task is something you tick off; an event happens whether or not you turn up.
// Only tasks can be completed, which is why the two are kept apart rather than
// being one list with a flag. Older records used "reminder" for what is now a
// task and are read forward on load.
// completedAt is when a task was ticked off, not when it was due — the two come
// apart whenever something is confirmed late, and it is the former she needs to
// know how freshly she was told. Absent on anything ticked before it was kept.
type KeptItem = { id: string; title: string; date: string; time?: string; kind: 'task' | 'event'; done: boolean; completedAt?: string; heardAbout?: string; underway?: string; googleEventId?: string; googleTaskId?: string };
type Profile = { nickname: string; occupation: string; about: string };
type Memory = { id: string; text: string; createdAt: string };

/**
 * Whether we are on the way out, which changes what a thrown error costs — and
 * what it means. Declared up here because the helper below is the main reader
 * of it, and that one is called from the top of the file downwards.
 */
let quitting = false;

/**
 * A failure in words, told apart from the app being shut out from under it.
 *
 * Every net::ERR_FAILED in the log — eighty-eight of them, from the emotion
 * classifier, the screenshot reader and the calendar sync — sat within a few
 * lines of a restart. Chromium's network stack goes away when before-quit
 * fires, and anything still in flight dies with it. Reported as a network
 * fault it reads as a model that cannot be reached and sends the next reader
 * to Setup, which is the one place the fault is not: nothing was wrong, she
 * was interrupted mid-thought. Said plainly, it is one line nobody chases.
 */
const TORN_DOWN = /net::ERR_(?:FAILED|ABORTED|CONNECTION_(?:ABORTED|CLOSED|RESET))|Network service crashed|The operation was aborted/i;
function whyItFailed(error: unknown): string {
  const detail = error instanceof Error ? error.message : String(error);
  return quitting && TORN_DOWN.test(detail) ? 'she was interrupted — the app was shutting down' : detail;
}

const COMPANION_DEFAULT_WIDTH = 300;
const COMPANION_ASPECT = 360 / 300;
const COMPANION_MIN_WIDTH = 140;
const COMPANION_MAX_WIDTH = 900;
const COMPANION_MARGIN = 60;
const CURSOR_POLL_MS = 33;
const CHAT_TIMEZONE = 'Australia/Perth'; // UTC+8 year-round, no DST
const CHAT_RESET_HOUR = 5;
const CHAT_RESET_POLL_MS = 60_000;
const GOOGLE_SYNC_DAYS = 30;
const GOOGLE_SYNC_INTERVAL_MS = 15 * 60_000;
// Long enough for the window to be up and the first paint done, so a slow network
// call is not competing with startup.
const GOOGLE_SYNC_STARTUP_DELAY_MS = 10_000;
const GOOGLE_FOCUS_SYNC_MIN_GAP_MS = 30_000;
// Raw transcripts are kept for a year, then rolled into their day summaries
// only. It was a season at first — an archive that never shrank would hold the
// sensitive past for ever — and on 2026-09-17 he chose a year: long enough to
// read old days again with a better model (factgraph.ts), to keep the pool of
// her best exchanges growing (examples.ts) and for recall to reach that far
// back, and still not for ever. The activity log of window titles and the
// screenshots stay on the season's clock: the most sensitive record there is,
// and spent once the day is distilled.
const ARCHIVE_RETENTION_DAYS = 365;
const ACTIVITY_RETENTION_DAYS = 90;
// Summaries outlive the transcripts they distil by two months. pruneOldArchives
// deletes a day only while its summary is still held, and with both at 365 a
// day was deletable for a single 04:30 run — missed once (the app down that
// night), it stayed for good, and every restart paid to summarise it again
// (review, 2026-09-17). Sixty runs to catch it instead of one.
const SESSIONS_KEPT = ARCHIVE_RETENTION_DAYS + 60;

const live2dRoots = new Map<string, string>();
let mainWindow: BrowserWindow | null = null;
let companionWindow: BrowserWindow | null = null;

/** Where screenshots pushed from a desk are kept. A folder per day under here,
 *  which is the folder the activity log is describing. */
function shotStoreRoot(): string { return path.join(app.getPath('userData'), 'screenshots'); }

/**
 * What the desk was showing, read on this machine.
 *
 * The desk syncs the pictures into shotStoreRoot(); nothing here opened them,
 * so the server held a folder of screenshots it could not see. This looks at a
 * few each pass, oldest first, and keeps one plain description of each.
 *
 * It is the only thing that looks unasked. The screen watcher has no screen on
 * a headless box and its own switch is off; a picture sent in conversation goes
 * to the answering model, not here. So the eyes cost nothing until the desk
 * sends something, and then they cost one small model on the other card for as
 * long as the pass takes — see ollama-vision.service, which unloads it after.
 */
const SHOT_LOOK_TICK_MS = 5 * 60_000;
/**
 * Read it out first, then say what it is.
 *
 * The first version of this asked for two plain sentences and forbade the
 * failures — no preamble, no hedging, quote anything readable. A 3B model
 * ignores all three: what came back for a screen full of his own search terms
 * was "The user is using a search engine or a similar tool to analyze search
 * results", which is true of the screenshot and useless to her.
 *
 * Transcribing first fixes it, on the same model, in the same time. Asked to
 * read the screen before describing it, the same picture came back as
 * "gaming cafe perth +57 | Total: 73 impressions" and four more like it — every
 * query and every number, correct. The description is then written against what
 * it just read rather than against the general shape of the image.
 *
 * Which is the day's recurring lesson from the other end: the summariser wrote
 * in the second person because the transcript said You:, the tally quoted a
 * timestamp because the sample carried one, and this hedged because nothing
 * made it look properly. Shape the input; a rule in the prompt about what not
 * to do is the weakest instrument here.
 */
// The two labels used to be demonstrated with angle-bracket placeholders —
// `Text: <everything you read>` — and a 12B on a CPU copied them back as the
// answer, brackets and all, several times on 2026-09-07. A worked example is
// harder to mistake for the thing being asked for than a slot is; readShotDescription
// catches what still comes back as the template. Same lesson as the paragraph
// above: shape the input.
const SHOT_LOOK_PROMPT = [
  'Read this screenshot of a computer screen.',
  'First read out every piece of text you can see: headings, list items, numbers, buttons.',
  'Then say in one sentence which program it is and what is being done in it.',
  'Answer in exactly two labelled lines and nothing else, like this:',
  'Text: Inbox - 3 unread. Reply. Archive. Settings.',
  'Doing: Reading email in Gmail.',
].join('\n');

// One pass at a time. A backlog is worked through a shot at a time on a CPU, at
// twenty-odd seconds each and a two-minute ceiling on a wedged one, so a pass
// over the 190-odd held here runs far longer than the five minutes between
// ticks. Unguarded, the next tick started a second pass from the same stored
// captions and walked the same queue: 294 looks for 192 shots in one log, a
// third of them repeating a shot looked at in the previous twelve — and the
// pairs disagreed, because a model asked the same picture twice answers twice.
let lookingAtShots = false;

async function lookAtSyncedShots() {
  const vision = readVisionConfig(store.get('vision'));
  if (!vision.enabled) return;
  if (lookingAtShots) return;
  // Her reading gets the card. Both passes go to the same vision model, the
  // backlog runs around the clock, and a page costs about a hundred seconds —
  // so a twenty-minute sitting queued behind old screenshots is an hour and a
  // half of nothing. The backlog has waited three weeks; it can wait an hour.
  if (readingMangaNow) return;
  const root = shotStoreRoot();
  if (!existsSync(root)) return;
  const captions = readCaptions(store.get('shots.captions'));
  const held = heldShots(root);
  // Nothing the desk has already described. Its vision model looked at that
  // burst anyway and wrote the answer onto the entry, and the entry travels
  // here with the log — so this pass exists for what arrived with nothing said
  // about it, not to say it again on a CPU.
  const described = describedShots(store.getActivityLog());
  const next = shotsNeedingALook(held, captions, described);
  if (!next.length) return;
  // Held between passes only while there is a backlog to come back to: the
  // eyes run on the CPU here, where a cold start costs 16 seconds against 6
  // for a caption.
  const keepAlive = moreThanOnePass(held, captions, described) ? '10m' : '0';
  const provider = store.get('ai.config') as ProviderConfig | undefined;
  const endpoint = visionEndpoint(provider, vision);
  // Written through after every shot rather than banked to the end of the pass.
  // A pass over a long backlog runs for hours, and this app is restarted often;
  // held to the end, an interrupted pass threw away every caption it had earned
  // and the next one started again from the top of the same queue.
  let saved = captions;
  const remember = (next: typeof saved) => { saved = next; store.set('shots.captions', saved); };
  lookingAtShots = true;
  try {
    for (const shot of next) {
      const bytes = readShot(root, shot.day, shot.name);
      if (!bytes) continue;
      try {
        const sighting = await look(bytes.toString('base64'), vision, endpoint, modelHeaders(endpoint), net.fetch, {
          ask: SHOT_LOOK_PROMPT,
          keepAlive,
        });
        const text = readShotDescription(sighting.description).slice(0, CAPTION_MAX_CHARS);
        // Nothing usable said about it. Counted as a failure rather than skipped, or
        // the same shot comes back every pass and the queue never moves past it.
        if (!text) {
          remember(noteFailure(saved, shot.day, shot.name, new Date().toISOString()));
          console.warn(`[shot] nothing readable came back for ${shot.day}/${shot.name}`);
          continue;
        }
        remember(noteCaption(saved, { day: shot.day, name: shot.name, at: new Date().toISOString(), text }));
        // Onto the entry as well, which is the road a description already travels
        // to reach her: summariseDay carries it into the day pass, and the day
        // pass is what turns a day into memories. Left only in the store beside
        // it, a caption was written and read by nothing. describeShot returns the
        // log unchanged when the shot has no entry to attach to — true of the
        // backlog that arrived before the log did — and the store keeps it then.
        const attached = describeShot(store.getActivityLog(), shot.day, shot.name, text);
        if (attached !== store.getActivityLog()) store.setActivityLog(attached);
        console.log(`[shot] ${shot.day}/${shot.name}: ${text.slice(0, 90)}`);
      } catch (error) {
        const why = whyItFailed(error);
        console.warn(`[shot] could not look at ${shot.day}/${shot.name}:`, why);
        // A refusal about this picture — too large for the window, a format it
        // cannot read — is about this picture. Left as a break it stalled the
        // whole queue for ever: the shot was never captioned, so the next pass
        // started on the same one and stopped there again. Anything else means
        // the model or the machine is unavailable and the rest would fail the
        // same way, so those still keep for the next pass.
        // Counted rather than classified. Whether it was refused, timed out or
        // came back malformed, a shot that fails MAX_LOOK_TRIES times is left
        // alone and the queue moves on. A machine that is not answering fails
        // every shot equally, so the pass still stops after the first one.
        remember(noteFailure(saved, shot.day, shot.name, new Date().toISOString()));
        if ((error as { aboutThisImage?: boolean })?.aboutThisImage) continue;
        break;
      }
    }
  } finally {
    lookingAtShots = false;
  }
}

const knowledgeFile = process.env.HARU_KNOWLEDGE_FILE ? process.env.HARU_KNOWLEDGE_FILE : path.join(app.getPath('userData'), 'knowledge.json');

// The one persistence facade. It owns both store files; nothing else reads or
// writes them. Opening can fail on a corrupt file, in which case the newest
// backup is restored and we try once more before giving up.
let store: HaruStore;
let storeWasRecovered = false;
try {
  store = new HaruStore({ knowledgeFile });
} catch (error) {
  console.warn('[store] could not open the store:', error instanceof Error ? error.message : error);
  if (!HaruStore.recoverBackups({ knowledgeFile })) throw error;
  // Files of hers came back damaged and were replaced from a backup: whatever
  // was between the backup and now, she does not have any more (feelings.ts).
  storeWasRecovered = true;
  store = new HaruStore({ knowledgeFile });
}
store.migrate();
store.hardenPermissions();

protocol.registerSchemesAsPrivileged([
  { scheme: 'haru-model', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
  // How an attached picture reaches the window. file:// is not loadable from the
  // renderer and a data: URI would mean carrying the whole image through the
  // bridge and into the stored transcript — for a thumbnail.
  { scheme: 'haru-photo', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
]);

// Her replies play without anyone having clicked anything, which is exactly what
// Chromium's autoplay policy exists to stop. Must be set before the app is ready.
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

function modelResult(modelPath: string): Live2DModel {
  const id = createHash('sha256').update(modelPath).digest('hex');
  const root = path.dirname(modelPath);
  live2dRoots.set(id, root);
  // The id lives in the path, not the host: a 64-char sha256 hex id used as a
  // hostname exceeds the 63-octet DNS label limit, and Chromium's URL host
  // canonicalization silently drops the last character when resolving relative
  // resource URLs (moc3, textures) against it. Paths have no such limit.
  return { path: modelPath, name: path.basename(modelPath), url: `haru-model://local/${id}/${encodeURIComponent(path.basename(modelPath))}` };
}

type ZipEntry = ReturnType<InstanceType<typeof AdmZip>['getEntries']>[number];

// ZIPs written by localized Windows tools store filenames in the machine's own
// codepage without setting the UTF-8 flag. Decoding those as UTF-8 mangles any
// non-ASCII name — irreversibly, since the bad bytes become U+FFFD — so the
// assets model3.json points at stop matching what lands on disk and every
// texture 404s. The model's own references are the ground truth for what the
// names should be, so try the plausible codepages and keep whichever resolves
// the most of them.
const ZIP_NAME_ENCODINGS = ['utf-8', 'gbk', 'shift_jis', 'euc-kr', 'big5'];

function decodeEntryName(raw: Buffer, encoding: string) {
  try {
    return new TextDecoder(encoding).decode(raw).replace(/\\/g, '/');
  } catch {
    return raw.toString('utf8').replace(/\\/g, '/');
  }
}

function modelReferences(json: unknown): string[] {
  const files = (json as { FileReferences?: Record<string, unknown> } | null)?.FileReferences;
  if (!files) return [];
  const references: string[] = [];
  const add = (value: unknown) => { if (typeof value === 'string') references.push(value); };
  add(files.Moc); add(files.Physics); add(files.Pose); add(files.DisplayInfo); add(files.UserData);
  if (Array.isArray(files.Textures)) files.Textures.forEach(add);
  if (Array.isArray(files.Expressions)) files.Expressions.forEach(entry => add((entry as { File?: unknown })?.File));
  if (files.Motions && typeof files.Motions === 'object') {
    for (const group of Object.values(files.Motions as Record<string, unknown>)) {
      if (Array.isArray(group)) group.forEach(entry => add((entry as { File?: unknown })?.File));
    }
  }
  return references;
}

// References inside model3.json are relative to its own folder, which is not the
// archive root when the ZIP wraps everything in a directory — so they are scored
// against that prefix, not against bare entry names.
function pickNameEncoding(entries: ZipEntry[], model: ZipEntry, references: string[]) {
  if (!references.length) return 'utf-8';
  let best = { encoding: 'utf-8', score: -1 };
  for (const encoding of ZIP_NAME_ENCODINGS) {
    const names = new Set(entries.map(entry => decodeEntryName(entry.rawEntryName, encoding)));
    const modelName = decodeEntryName(model.rawEntryName, encoding);
    const prefix = modelName.slice(0, modelName.lastIndexOf('/') + 1);
    const score = references.filter(reference => names.has(prefix + reference)).length;
    if (score > best.score) best = { encoding, score };
  }
  return best.encoding;
}

function unpackModel(archivePath: string) {
  const zip = new AdmZip(archivePath);
  const entries = zip.getEntries();
  // Matched on the raw bytes: the suffix is ASCII, so it survives any codepage.
  const model = entries.find(entry => !entry.isDirectory && entry.rawEntryName.toString('latin1').toLowerCase().endsWith('.model3.json'));
  if (!model) throw new Error('This ZIP does not contain a .model3.json Live2D model.');
  let references: string[] = [];
  try {
    references = modelReferences(JSON.parse(zip.readAsText(model).replace(/^﻿/, '')));
  } catch {
    // Unreadable model3.json still extracts; the loader reports the real problem.
  }
  const encoding = pickNameEncoding(entries, model, references);
  const destination = path.join(app.getPath('userData'), 'live2d-models', createHash('sha256').update(`${archivePath}:${Date.now()}`).digest('hex').slice(0, 16));
  mkdirSync(destination, { recursive: true });
  for (const entry of entries) {
    if (entry.isDirectory) continue;
    const target = path.resolve(destination, decodeEntryName(entry.rawEntryName, encoding));
    if (target !== destination && !target.startsWith(destination + path.sep)) throw new Error('This ZIP contains an unsafe path and was not imported.');
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, entry.getData());
  }
  return path.join(destination, decodeEntryName(model.rawEntryName, encoding));
}

// Walking, in main because main owns the window. A 30ms tick rather than 16:
// setBounds crosses the process boundary every frame, and at 60fps that is a
// measurable amount of IPC for movement nobody can see the difference in.
const ROAM_TICK_MS = 30;
let roamTimer: NodeJS.Timeout | null = null;
// Open means the box at her feet is up and waiting to be typed into. She holds
// still while it is: wandering off mid-sentence takes the box with her.
let summonOpen = false;
// Whether the choices tool is on the table this turn, and what she picked if she
// used it. Module-level for the same reason handsAllowed is: chatTools() is
// called deep inside the reply loop and threading a flag through every composer
// to reach it would be worse than this.
let offeringChoices = false;
let pendingChoices: string[] = [];
let lastSummonLine = '';
let walkingTo: Point | null = null;
let lastWalkAt = 0;
let lastUserMovedAt = Date.now();
let nextWanderAt = 0;

function roamState() {
  return readRoamConfig(store.get('roam'));
}

/** Tells the renderer to move her legs, or stop. Sent on change only. */
let wasWalking: { moving: boolean; facing: number } = { moving: false, facing: 0 };
function reportWalk(moving: boolean, facing: number) {
  if (wasWalking.moving === moving && wasWalking.facing === facing) return;
  wasWalking = { moving, facing };
  sendToWindows('companion:walking', wasWalking);
}

/** Sends her somewhere. Used by the wander timer and by getting out of the way. */
function walkTo(point: Point) {
  if (!companionWindow || companionWindow.isDestroyed()) return;
  walkingTo = point;
  lastWalkAt = Date.now();
}

function stopWalking() {
  walkingTo = null;
  reportWalk(false, 0);
}

function roamTick() {
  const window_ = companionWindow;
  if (!window_ || window_.isDestroyed() || !window_.isVisible()) { stopWalking(); return; }
  const config = roamState();
  const bounds = window_.getBounds();
  const now = Date.now();

  if (walkingTo) {
    // Interrupted rather than finished: whatever she was crossing the desktop
    // for matters less than not talking over herself while doing it.
    if (speakingNow || now - lastUserMovedAt < 1_000) { stopWalking(); return; }
    const delta = Math.min(now - lastWalkAt, 250);
    lastWalkAt = now;
    const vitals = store.get('vitals') as { energy?: number } | undefined;
    const walk = step({ x: bounds.x, y: bounds.y }, walkingTo, speedFor(vitals?.energy ?? 0.6), delta);
    const { x, y } = clampCompanionPosition(walk.position.x, walk.position.y, bounds.width, bounds.height);
    window_.setBounds({ ...bounds, x: Math.round(x), y: Math.round(y) });
    reportWalk(!walk.arrived, walk.facing);
    if (walk.arrived) { walkingTo = null; console.log(`[roam] arrived at ${Math.round(x)}`); }
    return;
  }

  // Being talked to holds her in place. Everything below is about whether she
  // feels like moving; this is about the box moving with her if she does.
  if (summonOpen) { nextWanderAt = 0; return; }

  if (!mayWander({
    enabled: config.enabled,
    speaking: speakingNow,
    dragging: now - lastUserMovedAt < 1_000,
    listening: false,
    fullscreen: false,
    sinceUserMovedMs: now - lastUserMovedAt,
  })) { nextWanderAt = 0; return; }

  if (!nextWanderAt) { nextWanderAt = now + nextWanderDelay(config.restlessness); return; }
  if (now < nextWanderAt) return;
  nextWanderAt = 0;
  const work = screen.getDisplayMatching(bounds).workArea;
  const destination = pickDestination(work, bounds);
  if (!destination) return;
  console.log(`[roam] wandering from ${bounds.x} to ${destination.x}`);
  walkTo(destination);
}

function startRoaming() {
  if (roamTimer) return;
  roamTimer = setInterval(roamTick, ROAM_TICK_MS);
}

/**
 * Out of the way of whatever just went fullscreen. Separate from wandering and
 * not gated on it: someone who has turned roaming off has said they want her to
 * stay where they put her, but they have not said they want her stood in the
 * middle of a film. Only the avoid-fullscreen switch governs this.
 */
function stepAsideForFullscreen() {
  const window_ = companionWindow;
  if (!window_ || window_.isDestroyed() || !window_.isVisible()) return;
  if (!roamState().avoidFullscreen) return;
  const bounds = window_.getBounds();
  const work = screen.getDisplayMatching(bounds).workArea;
  // Only if she is actually in the way. Already tucked into a corner, walking to
  // the other corner would be movement for its own sake.
  const inset = Math.min(bounds.x - work.x, (work.x + work.width) - (bounds.x + bounds.width));
  if (inset <= bounds.width * 0.35) return;
  const refuge = refugeFrom(work, bounds);
  console.log(`[roam] something went fullscreen — stepping aside to ${refuge.x}`);
  walkTo(refuge);
}

function broadcastLive2DChange(model: Live2DModel | null) {
  for (const win of BrowserWindow.getAllWindows()) win.webContents.send('live2d:changed', model);
}

function broadcastChatReset() {
  for (const win of BrowserWindow.getAllWindows()) win.webContents.send('chat:reset');
}

// The "chat day" runs from CHAT_RESET_HOUR to CHAT_RESET_HOUR the next day, not
// midnight to midnight — chatting with Haru at 1am shouldn't get wiped by a plain
// date rollover mid-conversation.
function currentChatDayKey(): string {
  const now = zonedNow(CHAT_TIMEZONE);
  if (now.getHours() < CHAT_RESET_HOUR) now.setDate(now.getDate() - 1);
  return localDateKey(now);
}

// Archives under the day key, suffixing when that day already has an entry —
// starting a chat manually and then letting the 5am reset fire would otherwise
// have the second archive overwrite the first.
// Distilled as the day is archived, because the raw transcript is far too big to
// carry forward and too dull to reread. One line per day is what lets her say
// "you were dealing with that thing on Tuesday" months later.
/**
 * What they spent the day doing, in the one line a model should get.
 *
 * This is the point of keeping the log. The day pass below already knows how to
 * turn a day into memories; until now the only thing it was ever given was what
 * was said out loud, so a day spent entirely in Blender with the chat quiet
 * produced nothing, because nothing had been said about it.
 */
function activityDigest(day: string): string {
  if (store.get('activityLog', true) !== true) return '';
  const digest = summariseDay(store.getActivityLog()[day] ?? []);
  return digest ? `What they had open that day, longest first: ${digest}` : '';
}

function summariseSession(messages: { role?: string; content?: string }[], day: string, { replace = false, attempt = 0 } = {}) {
  const config = store.get('ai.config') as ProviderConfig | undefined;
  const doing = activityDigest(day);
  // A day is worth distilling if it was talked through or worked through. The
  // second half is new: the bar was four messages, so a Saturday spent in
  // Blender without a word said about it left no trace at all.
  if (!config?.model || (messages.length < 4 && !doing)) return;
  // Skipping a day that already has a summary was right when a day produced one
  // archive and wrong the moment it produced fourteen: the first fragment got
  // distilled, the other thirteen were filed and never read again. Now the day
  // is summarised once, at the roll, over all of it — and re-summarising has to
  // be able to replace what the old behaviour left behind.
  if (!replace && getSessions().some(session => session.day === day)) return;
  const lines = dayLines(messages);
  // The summary reads the start of the day; forming memories reads all of it (formDayMemories).
  const said = lines.join('\n').slice(0, 6000);
  // Appended after the conversation is capped, so a long day at the keyboard
  // cannot push the day's talking out of the window.
  const transcript = [said, doing].filter(Boolean).join('\n\n');
  ollamaPost(
    [{ role: 'system', content: attempt ? `${summaryPrompt()} ${THIRD_PERSON_AGAIN}` : summaryPrompt() }, { role: 'user', content: transcript }],
    config,
    { tools: false, temperature: 0.2, maxTokens: 80 },
  ).then(message => {
    const summary = (message.content ?? '').trim().replace(/^["']|["']$/g, '');
    if (!isWorthKeeping(summary)) { console.log(`[memory] nothing worth keeping from ${day}`); return; }
    // A note that says "you" is a note about the wrong person once it is in her
    // prompt. Ask once more, and if it comes back addressed again, keep nothing
    // — there will be another day, and a wrong one would be read every turn.
    if (readsAsSecondPerson(summary)) {
      if (attempt) { console.warn(`[memory] ${day} summary stayed in the second person, dropping it: ${summary}`); return; }
      console.log(`[memory] ${day} summary came back addressed to somebody — asking again`);
      summariseSession(messages, day, { replace, attempt: 1 });
      return;
    }
    // Only the recent stretch is kept; older days have already contributed
    // whatever mattered as long-term records.
    const kept = [...getSessions().filter(session => session.day !== day), { day, summary, createdAt: new Date().toISOString() }]
      .sort((a, b) => a.day.localeCompare(b.day))
      .slice(-SESSIONS_KEPT);
    store.setSessions(kept);
    console.log(`[memory] summarised ${day} from ${messages.length} messages: ${summary}`);
    void formDayMemories(lines, doing, day, config, messages.length);
  }).catch(error => console.warn('[memory] could not summarise session:', error instanceof Error ? error.message : error));
}

/** How many month folds are kept before the oldest goes. */
const MONTH_NOTES_KEPT = 24;

/**
 * The L1 fold: a finished month's day notes, condensed to one line of her own.
 *
 * Runs when the rollover crosses a month boundary (and on startup for any
 * completed month that never got one), so "what happened at the start of the
 * month" is answerable from context rather than from the raw archive. Nothing
 * is discarded: the day notes stay in sessions, the raw days stay in the
 * archive, and recall still searches both — this is the compact layer the
 * prompt reads for anything older than the recent-day window.
 */
function foldMonth(month: string, config: ProviderConfig, { attempt = 0 } = {}) {
  const notes = getSessions()
    .filter(session => session.day.slice(0, 7) === month)
    .map(session => session.summary.trim())
    .filter(Boolean);
  if (!notes.length) return;
  const transcript = notes.join('\n').slice(0, 4000);
  ollamaPost(
    [{ role: 'system', content: attempt ? `${monthFoldPrompt(month)} ${THIRD_PERSON_AGAIN}` : monthFoldPrompt(month) }, { role: 'user', content: transcript }],
    config,
    { tools: false, temperature: 0.2, maxTokens: 60 },
  ).then(message => {
    const summary = (message.content ?? '').trim().replace(/^["']|["']$/g, '');
    if (!isWorthKeeping(summary)) { console.log(`[memory] nothing worth keeping from the fold of ${month}`); return; }
    if (readsAsSecondPerson(summary)) {
      if (attempt) { console.warn(`[memory] ${month} fold stayed in the second person, dropping it: ${summary}`); return; }
      console.log(`[memory] ${month} fold came back addressed to somebody — asking again`);
      foldMonth(month, config, { attempt: 1 });
      return;
    }
    const kept = [...getMonthNotes().filter(note => note.month !== month), { month, summary, createdAt: new Date().toISOString() }]
      .sort((a, b) => a.month.localeCompare(b.month))
      .slice(-MONTH_NOTES_KEPT);
    setMonthNotes(kept);
    console.log(`[memory] folded ${month} from ${notes.length} day notes: ${summary}`);
  }).catch(error => console.warn('[memory] could not fold the month:', error instanceof Error ? error.message : error));
}

/**
 * A day's conversation as the distilling passes read it. Labelled `They:` and
 * `Haru:` rather than `Them:` and `You:`: the note the model is about to write
 * goes into her own system prompt, where "you" is her — so the input must not
 * contain a second person at all, and the word the note should use for the
 * user is the word its lines already carry.
 */
function dayLines(messages: { role?: string; content?: string }[]): string[] {
  return foldAsleepExchanges(messages)
    .filter(message => message.role === 'user' || message.role === 'assistant')
    .map(message => `${message.role === 'user' ? 'They' : 'Haru'}: ${String(message.content ?? '').slice(0, 300)}`);
}

/** Sort notes into categories on this machine's own model (categories.ts): new memories, and a day's formed notes as a second opinion. */
async function sortNotes(notes: SortNote[]): Promise<Map<string, Sorted> | null> {
  const config = store.get('ai.config') as ProviderConfig | undefined;
  if (!config?.model || !notes.length) return null;
  const message = await ollamaPost(
    [{ role: 'system', content: sortPrompt(getProfile().nickname) }, { role: 'user', content: sortInput(notes, iso => localDateKey(zonedNow(CHAT_TIMEZONE, new Date(iso)))) }],
    config,
    { tools: false, temperature: 0, maxTokens: 40 * notes.length + 100 },
  );
  return readSorting(message.content ?? '', notes);
}

/**
 * The second pass over a finished day: what it taught her about him, of every
 * kind (memory.ts formationPrompt), read a window at a time over the whole day,
 * gated, and kept with its category and day. Runs after the summary lands, in
 * the same quiet background rhythm — never urgent.
 */
async function formDayMemories(lines: string[], doing: string, day: string, config: ProviderConfig, messageCount: number) {
  if (forming) return;
  if (lines.length < 4 && !doing) { markFormed(day, messageCount); return; }
  forming = true;
  try {
    if (await formFrom(lines, doing, day, config)) markFormed(day, messageCount);
  } finally {
    forming = false;
  }
}

/** Days already read for memories, with how many messages they had: a day that has grown is read again. */
function formedDays(): Record<string, number> {
  const saved = store.get('memory.formed');
  return saved && typeof saved === 'object' && !Array.isArray(saved) ? saved as Record<string, number> : {};
}

function markFormed(day: string, messageCount: number): void {
  store.set('memory.formed', { ...formedDays(), [day]: messageCount });
}

let forming = false;
/** Older than this, a day's rules for her are left to his Preferences page (formFrom). */
const OLD_RULE_DAYS = 7;
/** How often the past is read for memories, a day at a time. */
const FORMING_TICK_MS = 2 * 60_000;
/** Nor while he is talking to her: each window is a call on the model her replies share. */
const FORMING_QUIET_MS = 10 * 60_000;

/**
 * The days before typed memories existed, and any the day roll missed, read
 * one at a time in the background — newest first, since the recent past is
 * what she is most likely to be asked about. The same pass as the roll's.
 */
async function formingTick(): Promise<void> {
  if (forming) return;
  const config = store.get('ai.config') as ProviderConfig | undefined;
  if (!config?.model) return;
  const last = Date.parse(getMood().lastMessageAt ?? '');
  if (Number.isFinite(last) && Date.now() - last < FORMING_QUIET_MS) return;
  const today = currentChatDayKey();
  const archive = store.getArchive();
  const done = formedDays();
  const day = Object.keys(archive).filter(key => !key.includes('#') && key < today).sort().reverse()
    .find(key => done[key] !== (archive[key] ?? []).length);
  if (!day) return;
  const messages = (archive[day] ?? []) as { role?: string; content?: string }[];
  await formDayMemories(dayLines(messages), activityDigest(day), day, config, messages.length);
}

/** One day's windows, gated, second-guessed and kept. False when the model could not be reached, so the day is tried again. */
async function formFrom(lines: string[], doing: string, day: string, config: ProviderConfig): Promise<boolean> {
  const userName = getProfile().nickname;
  // A rule for her from more than a week back is not taken from the transcript:
  // his Preferences page says what he wants now, and a rule he has since taken
  // off it would come back from the day he first said it — and sit in every prompt.
  const stale = Date.parse(`${day}T00:00:00Z`) < Date.now() - OLD_RULE_DAYS * 86_400_000;
  // What she already holds that lasts, so a day does not write it down again.
  const known = getMemories()
    .filter(memory => !memory.supersededBy && memory.status !== 'archived' && ['identity', 'person', 'preference', 'instruction', 'shared', 'knowledge', 'ongoing'].includes(categoryOf(memory)))
    .map(memory => memory.text)
    .slice(-80);
  const knownExactly = new Set(known.map(text => text.trim().toLowerCase()));
  // The activity digest rides on the last window, so a long day of talk cannot push it out.
  const windows = formationWindows(lines);
  if (doing) {
    if (windows.length) windows[windows.length - 1] += `\n\n${doing}`;
    else windows.push(doing);
  }
  // Every window first, gated as ever; a person has to be somebody.
  const candidates: FormedNote[] = [];
  for (const part of windows) {
    try {
      const message = await ollamaPost([{ role: 'system', content: formationPrompt(day, known, userName) }, { role: 'user', content: part }], config, { tools: false, temperature: 0.2, maxTokens: 700 });
      for (const note of readFormation(message.content ?? '')) {
        if (knownExactly.has(note.note.trim().toLowerCase())) continue;   // copied off the list, not said that day
        if (readsAsSecondPerson(note.note)) continue;
        if (note.category === 'event' && !isWorthAnEvent(note.note)) continue;
        if (note.category === 'person' && !namesSomeoneElse(note.note, userName)) continue;
        candidates.push(note);
      }
    } catch (error) {
      console.warn('[memory] could not form memories:', error instanceof Error ? error.message : error);
      return false;
    }
  }
  // Then a second opinion from the sorter, which reads each note on its own:
  // what it calls passing is dropped ("Apologized for slow replies while at
  // work" had come back as an instruction, which would sit in every prompt),
  // and where the two disagree on the kind its answer is taken — replayed, it
  // was the better of the two ("Building a website" is under way, not a plan).
  // Unreachable, the notes stand as formed.
  const asked: SortNote[] = candidates.map((note, index) => ({ id: String(index), text: note.note, kind: LEGACY_KIND[note.category as keyof typeof LEGACY_KIND], createdAt: `${day}T12:00:00.000Z` }));
  const second = await sortNotes(asked).catch(() => null);
  let formed = 0;
  let repeated = 0;
  for (const [index, note] of candidates.entries()) {
    if (formed >= MEMORIES_PER_DAY) break;
    const opinion = second?.get(String(index));
    if (opinion?.category === 'passing') { console.log(`[memory] set aside from ${day} as passing: "${note.note.slice(0, 80)}"`); continue; }
    const category = opinion?.category ?? note.category;
    if (category === 'instruction' && stale) { console.log(`[memory] set aside from ${day}, a rule too old to take from the transcript: "${note.note.slice(0, 80)}"`); continue; }
    if (category === 'person' && !namesSomeoneElse(note.note, userName)) continue;
    const when = category === 'plan' || category === 'event' ? opinion?.when ?? note.when : undefined;
    const saved = addMemory(note.note, LEGACY_KIND[category as keyof typeof LEGACY_KIND], undefined, {
      source: 'conversation', evidenceDetail: `from ${day}'s conversation`, category, when,
      emotion: localEmotion(note.note), emotionIntensity: readTone(note.note).heat,
    });
    if (!saved?.record) continue;
    if (saved.created) { formed += 1; console.log(`[memory] ${category} from ${day}: "${note.note.slice(0, 80)}"`); }
    else repeated += 1;
  }
  if (!formed) console.log(`[memory] nothing new from ${day}${repeated ? ` (${repeated} already known)` : ''}`);
  return true;
}

/**
 * Raw transcripts have a shelf life: once a day has its summary, the transcript
 * has given what it has to give, and keeping the sensitive past verbatim is a
 * retention problem with no recall benefit. Runs at startup and on the daily
 * tick; a day without a summary is never touched.
 */
function pruneOldArchives() {
  const archive = store.getArchive();
  const cutoff = localDateKey(new Date(Date.now() - ARCHIVE_RETENTION_DAYS * 86_400_000));
  const sessions = getSessions();
  let dropped = 0;
  for (const day of Object.keys(archive)) {
    if (day >= cutoff) continue;
    if (!sessions.some(session => session.day === day)) continue;
    delete archive[day];
    dropped += 1;
  }
  if (dropped) {
    store.setArchive(archive);
    console.log(`[memory] pruned ${dropped} archived day(s) older than ${ARCHIVE_RETENTION_DAYS} days — summaries kept`);
  }
  pruneOldActivity();
}

/**
 * The activity log on the same clock as the transcripts, and for the same
 * reason: once a day has been distilled into a summary and whatever events
 * survived the gate, the minute-by-minute record has given what it has to give.
 * Keeping a browsing history past that point is retention with no recall behind
 * it — the more so for this file, which is the one holding raw titles.
 */
function pruneOldActivity() {
  const log = store.getActivityLog();
  const cutoff = localDateKey(new Date(Date.now() - ACTIVITY_RETENTION_DAYS * 86_400_000));
  const sessions = getSessions();
  let dropped = 0;
  for (const day of Object.keys(log)) {
    if (day >= cutoff) continue;
    // A day that was never distilled is kept, exactly as the archive keeps it:
    // dropping it would lose the day outright rather than compressing it.
    if (!sessions.some(session => session.day === day)) continue;
    delete log[day];
    dropped += 1;
  }
  if (dropped) {
    store.setActivityLog(log);
    console.log(`[activity] pruned ${dropped} logged day(s) older than ${ACTIVITY_RETENTION_DAYS} days`);
  }
  // The images go on the same clock, and by the cutoff alone rather than by
  // which days survived above: a day kept because it was never distilled still
  // does not need its screenshots held for ever, and they are the largest thing
  // on the disk by a wide margin.
  const shotsDropped = pruneShots(shotStoreRoot(), cutoff);
  if (shotsDropped) console.log(`[activity] pruned ${shotsDropped} day(s) of screenshots older than ${ACTIVITY_RETENTION_DAYS} days`);
  // And what she made of them, on the same clock. The list is capped at 400 so
  // this was never a leak, but a caption whose picture and whose day are both
  // gone is a note about nothing.
  const captions = readCaptions(store.get('shots.captions'));
  const kept = forgetCaptions(captions, cutoff);
  if (kept.length !== captions.length) {
    store.set('shots.captions', kept);
    console.log(`[activity] forgot ${captions.length - kept.length} caption(s) whose day has gone`);
  }
}

/**
 * Everything said on one day, in one record.
 *
 * It used to start a new key every time — `2026-08-05`, then `#2`, and so on to
 * `#14` — so pressing New chat carved the day into pieces. That is the wrong
 * unit. A day is one day whether you cleared the screen at lunchtime, rebooted,
 * or wandered off and came back; what changed was the view, not the day.
 *
 * So this appends, and nothing is summarised here. The distillation happens once
 * at the 5am roll, over the whole day, which is the only moment the day is
 * actually finished.
 */
function archiveMessages(messages: unknown[], dayKey: string) {
  const archive = store.getArchive();
  archive[dayKey] = [...(archive[dayKey] ?? []), ...messages];
  store.setArchive(archive);
}

/**
 * Folds the old `#2`, `#3` … fragments back into one record per day, and
 * summarises the days that never got one.
 *
 * Runs once. Six days of real conversation were sitting in twenty-six pieces
 * here, three of those days with no summary at all and the other three
 * summarised from their first fragment only — on 5 August, one line distilled
 * from the opening of a 325-message day. The transcripts were never lost, only
 * orphaned, so this is recoverable rather than merely preventable.
 */
function mergeArchiveFragments() {
  const archive = store.getArchive();
  const fragmented = Object.keys(archive).filter(key => key.includes('#'));
  if (fragmented.length) {
    // The keys belonging to each day, not their contents — this map is the plan,
    // and the transcripts are only pulled through once the order is settled.
    const merged: Record<string, string[]> = {};
    for (const key of Object.keys(archive)) {
      const [day] = key.split('#');
      (merged[day] = merged[day] ?? []).push(key);
    }
    const rebuilt: Record<string, unknown[]> = {};
    for (const [day, keys] of Object.entries(merged)) {
      // Numeric, not lexical: sorted as strings, "#10" lands between "#1" and
      // "#2" and the day comes back in the wrong order.
      keys.sort((a, b) => (Number(a.split('#')[1] ?? 1)) - (Number(b.split('#')[1] ?? 1)));
      rebuilt[day] = keys.flatMap(key => archive[key] ?? []);
    }
    store.setArchive(rebuilt);
    console.log(`[memory] merged ${Object.keys(archive).length} archive fragments into ${Object.keys(rebuilt).length} days`);
  }

  // Now the days that never got distilled — fragments or not. The rollover
  // summarises the day it closes, and if the model was down that night or the
  // app was not running, no summary exists. Every archived day without one is
  // backfilled here, sequentially and deliberately unhurried: each is a model
  // call, and nothing here is urgent enough to stall a launch over.
  const sessions = getSessions();
  const days = Object.keys(store.getArchive()).sort();
  let delay = 0;
  for (const day of days) {
    if (sessions.some(session => session.day === day)) continue;
    delay += 20_000;
    const transcript = store.getArchive()[day] ?? [];
    setTimeout(() => summariseSession(transcript as { role?: string; content?: string }[], day, { replace: true }), delay);
  }
  if (delay) console.log(`[memory] backfilling ${delay / 20_000} day summaries in the background`);
  // The same for months: a month completed while she was down never folded.
  // Each fold waits for the day summaries of its month to land first — the
  // backfills above run sequentially at 20s apart, so the month folds follow
  // on the same clock.
  const todayKey = localDateKey(zonedNow(CHAT_TIMEZONE));
  const currentMonth = todayKey.slice(0, 7);
  const monthsWithNotes = new Set(getMonthNotes().map(note => note.month));
  const monthDays = (month: string) => sessions.filter(session => session.day.slice(0, 7) === month);
  const config = store.get('ai.config') as ProviderConfig | undefined;
  for (const session of sessions) {
    const month = session.day.slice(0, 7);
    if (month >= currentMonth || monthsWithNotes.has(month)) continue;
    if (!monthDays(month).length) continue;
    monthsWithNotes.add(month);
    delay += 20_000;
    setTimeout(() => { if (config?.model) foldMonth(month, config); }, delay);
  }
  if (delay) console.log(`[memory] backfilling ${Math.round(delay / 20_000)} day summaries and month folds in the background`);
}

function startNewConversation() {
  const messages = store.get('chat.messages') as unknown[] | undefined;
  const hadMessages = Boolean(messages?.length);
  if (hadMessages) archiveMessages(messages!, currentChatDayKey());
  store.delete('chat.messages' as never);
  // Recorded so the next reply knows the empty history is the user's own doing.
  // Set only here: the 5am reset in performChatResetIfDue is the app's
  // housekeeping rather than their decision, and asking them why they did
  // something they did not do is worse than saying nothing at all.
  store.set('chat.freshStart', { at: new Date().toISOString(), hadMessages, reason: 'manual' } satisfies FreshStart);
  // She should not still be talking about a conversation that is no longer there.
  stopSpeaking();
  broadcastChatReset();
}

function performChatResetIfDue() {
  const key = currentChatDayKey();
  const previousKey = store.get('chat.dayKey') as string | undefined;
  if (previousKey === key) return;
  const previousMessages = store.get('chat.messages') as unknown[] | undefined;
  if (previousKey && previousMessages?.length) archiveMessages(previousMessages, previousKey);
  // The key moves before the day is distilled: killed between the two, the next
  // start would otherwise file the same messages under the old day again.
  store.set('chat.dayKey', key);
  store.delete('chat.messages' as never);
  // The day is over, so now it becomes one line. Over everything the day
  // collected — what was on screen at 5am plus whatever was cleared away earlier
  // — because a day summarised from only its last stretch is as partial as one
  // summarised from only its first.
  if (previousKey) {
    const whole = store.getArchive()[previousKey] ?? [];
    try {
      summariseSession(whole as { role?: string; content?: string }[], previousKey, { replace: true });
    } catch (error) {
      console.warn('[memory] could not start the day summary:', error instanceof Error ? error.message : error);
    }
    // A rollover that crosses a month boundary closes the month: its day notes
    // fold into one line, the L1 layer the prompt reads for anything older
    // than the recent-day window.
    if (previousKey.slice(0, 7) !== key.slice(0, 7)) {
      const config = store.get('ai.config') as ProviderConfig | undefined;
      if (config?.model) foldMonth(previousKey.slice(0, 7), config);
      // And the month leaves its mark on who she is (growth.ts).
      growAtFold(previousKey.slice(0, 7));
    }
  }
  // The day is counted once more before its lines are trimmed — see settleTally.
  if (previousKey) settleTally(previousKey, (previousMessages ?? []) as { role: string; at?: string }[]);
  // Her log is trimmed rather than cleared. The conversation starts fresh every
  // day because a conversation is a thing you are in the middle of; the log is a
  // record, and a record you can only ever see today's page of is not one. A few
  // days of it is what makes "what was she going on about on Tuesday" answerable.
  store.set('chat.asides', pruneAsides(getAsides()));
  // Overwrites any manual marker still pending: whatever the user did last night,
  // the reason this history is empty now is the clock. Same misreading to head
  // off, different explanation — she cannot ask them why they cleared this one.
  store.set('chat.freshStart', { at: new Date().toISOString(), hadMessages: Boolean(previousMessages?.length), reason: 'daily' } satisfies FreshStart);
  broadcastChatReset();
}

function currentModelPath(): string | null {
  const model = store.get('live2d.model') as { path?: string } | undefined;
  return typeof model?.path === 'string' ? model.path : null;
}

// Reported by the companion window once the model is loaded, since only the
// runtime knows a parameter's real bounds. Held in memory rather than persisted:
// it belongs to the model currently on screen, and re-reading it costs nothing.
let parameterRanges: Record<string, ParameterRange> = {};

function getWardrobeControls(): WardrobeControl[] {
  const modelPath = currentModelPath();
  return modelPath ? discoverWardrobe(modelPath, parameterRanges) : [];
}

// Keyed by model, so importing a different character cannot inherit the previous
// one's choices through a parameter id that happens to collide.
function allWardrobeValues(): Record<string, Record<string, number>> {
  return (store.get('wardrobe.values') as Record<string, Record<string, number>> | undefined) ?? {};
}

function getWardrobeValues(): Record<string, number> {
  const modelPath = currentModelPath();
  return modelPath ? allWardrobeValues()[modelPath] ?? {} : {};
}

function setWardrobeValue(id: string, value: number): Record<string, number> {
  const modelPath = currentModelPath();
  const control = getWardrobeControls().find(entry => entry.id === id);
  // Refused rather than clamped into existence: a parameter this model does not
  // have would sit in the store forever and be pushed at every future model.
  if (!modelPath || !control) return getWardrobeValues();
  // Snapped to the nearest value the control actually offers, rather than
  // clamped into a range it may not cover. Clamping is what silently collapsed
  // two options onto one when the range ran negative.
  const chosen = control.values.reduce((best, candidate) => Math.abs(candidate - value) < Math.abs(best - value) ? candidate : best, control.values[0] ?? 0);
  const all = allWardrobeValues();
  const values = { ...(all[modelPath] ?? {}), [id]: chosen };
  store.set('wardrobe.values', { ...all, [modelPath]: values });
  console.log(`[wardrobe] ${control.name} -> ${chosen}`);
  sendToWindows('wardrobe:changed', values);
  return values;
}

// Kept items live in the main process because the chat tool loop runs here —
// the model's tool calls write straight to the store, and every window is told
// to re-read rather than each keeping its own copy.
function getKept(): KeptItem[] {
  const saved = (store.get('kept.items') as (KeptItem & { kind?: string })[] | undefined) ?? [];
  return saved.map(item => ({ ...item, kind: item.kind === 'event' ? 'event' : 'task' }));
}

function setKept(items: KeptItem[]) {
  store.set('kept.items', items);
  for (const win of BrowserWindow.getAllWindows()) win.webContents.send('kept:changed', items);
}

function addKeptItem(item: Omit<KeptItem, 'id' | 'done'>): KeptItem {
  // The same ask can arrive twice — read from the message and then called for
  // by the model's tool, or a retry of the same turn — and is still one item.
  const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
  const existing = getKept().find(kept => !kept.done && kept.date === item.date && (kept.time ?? '') === (item.time ?? '') && same(kept.title, item.title));
  if (existing) return existing;
  const created: KeptItem = { ...item, id: randomUUID(), done: false };
  setKept([...getKept(), created]);
  // Pushed in the background: a slow or failed Google call should not hold up
  // the chat reply confirming the reminder was saved locally.
  void syncItemToGoogle(created);
  return created;
}

// Ticking a task pushes the change back, so completing it here marks it complete
// in Google too rather than the two drifting apart.
/**
 * Events can be closed too, and refusing that was the bug.
 *
 * A calendar event has no completed state — Google has nowhere to put one — so
 * this used to decline them outright. But `itemStatus` calls anything past and
 * unfinished overdue, and an event could never become finished, so "Pick up CPU"
 * was permanently outstanding: chased in the agenda, brought up unprompted, and
 * impossible to answer because nothing the user could do would close it.
 *
 * Marking it done is local only. Nothing is pushed back for an event, because
 * there is no field to push it to; what it settles is whether she keeps asking.
 */
function toggleKept(id: string, force?: boolean) {
  const target = getKept().find(item => item.id === id);
  if (!target) return null;
  const done = force ?? !target.done;
  // Stamped on the way into done and cleared on the way out: un-ticking means
  // the completion did not happen, so there is no moment left to refer back to.
  // Something already done keeps its original stamp rather than being freshened
  // by a toggle that changed nothing.
  const completedAt = done ? (target.done ? target.completedAt : new Date().toISOString()) : undefined;
  const updated = { ...target, done, completedAt };
  setKept(getKept().map(item => item.id === id ? updated : item));
  // The memory of the thing, not just the line on the list. Nothing was
  // listening for "it is finished" before this, so a finished event kept its
  // place in the prompt until decay noticed it had gone quiet — six weeks after
  // it stopped being news.
  const closing = closeEvents(getMemories(), updated.title, new Date().toISOString(), done);
  if (closing.changed.length) {
    setMemories(closing.memories);
    for (const memory of closing.changed) console.log(`[memory] "${memory.text.slice(0, 60)}" is ${done ? 'finished — she will stop bringing it up' : 'open again'}`);
  }
  // Only tasks have a completion Google can hold. Pushing an event here would
  // rewrite the calendar entry for a state it cannot represent.
  if (updated.kind === 'task') void syncItemToGoogle(updated);
  return updated;
}

function removeKept(id: string) {
  const removed = getKept().find(item => item.id === id);
  if (!removed) return null;
  setKept(getKept().filter(item => item.id !== id));
  if (googleStatus(store).connected) {
    if (removed.kind === 'task' && removed.googleTaskId) void removeTask(store, removed.googleTaskId).catch(error => console.error('[google] task delete failed:', error));
    if (removed.kind === 'event' && removed.googleEventId) void removeItem(store, removed.googleEventId).catch(error => console.error('[google] event delete failed:', error));
  }
  return removed;
}

function updateKept(id: string, changes: Partial<Pick<KeptItem, 'title' | 'date' | 'time' | 'underway'>>) {
  const target = getKept().find(item => item.id === id);
  if (!target) return null;
  const updated = { ...target, ...changes };
  setKept(getKept().map(item => item.id === id ? updated : item));
  void syncItemToGoogle(updated);
  return updated;
}

async function syncItemToGoogle(item: KeptItem) {
  const status = googleStatus(store);
  if (!status.connected) return;
  // Tasks and events live in different Google products, so which API an item
  // belongs to follows from its kind rather than from where it came from.
  if (item.kind === 'task') {
    if (!status.tasksGranted) return;
    try {
      const googleTaskId = await pushTask(store, { ...item, googleTaskId: item.googleTaskId });
      setKept(getKept().map(current => current.id === item.id ? { ...current, googleTaskId } : current));
      store.delete('google.lastError' as never);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('[google] task push failed:', message);
      // Recorded rather than thrown: the item is already saved locally, and a
      // Google problem should not make creating a task look like it failed.
      store.set('google.lastError', `Saved here, but not sent to Google Tasks: ${message}`);
      broadcastGoogleStatus();
    }
    return;
  }
  try {
    const googleEventId = await pushItem(store, item, CHAT_TIMEZONE);
    // Re-read rather than closing over the old array: the tool loop may have
    // added another item while this request was in flight.
    setKept(getKept().map(current => current.id === item.id ? { ...current, googleEventId } : current));
    store.delete('google.lastError' as never);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[google] push failed:', message);
    store.set('google.lastError', message);
  }
}

// Pulls Google's events in as kept items, matched on the remote id so repeated
// syncs update rather than duplicate. Items Haru created are refreshed in place;
// anything already deleted locally is not resurrected.
// ---------------------------------------------------------------------------
// The life loop. Runs whether or not anyone is talking to her: reads the
// machine, drifts her state, and usually decides to do nothing. Stillness is
// most of the behaviour — movement only reads as deliberate if it is rare.
// ---------------------------------------------------------------------------

let vitals: Vitals = { ...DEFAULT_VITALS };
let lastTickAt = Date.now();
let tickTimer: ReturnType<typeof setTimeout> | undefined;

function readEnvironment(): Environment {
  return {
    hour: zonedNow(CHAT_TIMEZONE).getHours(),
    // Idle time across the whole machine, not just this window — she should
    // know the difference between being alone and being ignored.
    idleSeconds: powerMonitor.getSystemIdleTime(),
    onBattery: powerMonitor.isOnBatteryPower(),
    windowFocused: BrowserWindow.getAllWindows().some(win => win.isFocused()),
  };
}

function broadcastLife(action: string | null, environment: Environment) {
  const payload = { vitals, action, night: environment.hour >= 23 || environment.hour < 6 };
  for (const win of BrowserWindow.getAllWindows()) win.webContents.send('life:tick', payload);
}

// The weather of her day and what is left of the last thing that happened
// (temperament.ts). Kept with her vitals, so a restart is not a fresh start.
let wander: Lean = {};
let bruise: Lean = {};

function getTemperament(): Temperament | null {
  const saved = store.get('her.temperament') as Temperament | undefined;
  return saved && saved.day === currentChatDayKey() ? saved : null;
}

/**
 * The mood she woke up in, rolled the first time she is awake on a new day —
 * so it is decided at her wake, not at the 05:00 roll she sleeps through.
 */
function ensureTemperament() {
  if (getTemperament() || herAsleepNow()) return;
  const before = store.get('her.temperament') as Temperament | undefined;
  const mood = getMood();
  const night = getHerSleepSchedule();
  const rolled = rollTemperament(currentChatDayKey(), {
    history: before?.history ?? (before ? [before.kind] : []),
    went: mood.owedMorning?.went,
    grudge: mood.grudge ?? 0,
    wokenInNight: Boolean(night?.wokenEarly || night?.knockedAt),
  });
  store.set('her.temperament', rolled);
  console.log(`[temperament] ${rolled.day}: ${rolled.kind} ${rolled.intensity}${rolled.because ? ` — ${rolled.because}` : ''}`);
}

function lifeTick() {
  const now = Date.now();
  const environment = readEnvironment();
  const seconds = (now - lastTickAt) / 1000;
  ensureTemperament();
  passFeelings(now);
  wander = stepWander(wander, seconds);
  bruise = fadeBruise(bruise, seconds);
  vitals = driftVitals(vitals, environment, seconds, addLeans(traitLean(getTraits()), temperamentLean(getTemperament()), wander, bruise));
  lastTickAt = now;
  persistVitals();
  broadcastLife(chooseIdleAction(vitals, environment), environment);
  // Reminders outrank idle chatter: something she was asked to chase beats
  // something she thought of, and both at once would be two voices at once.
  void considerReminding(environment).then(reminded => { if (!reminded) void considerPipingUp(environment); });
  considerRevoicing();
  // Rescheduled each time rather than set on an interval, so the gap itself
  // varies with how alert she is.
  tickTimer = setTimeout(lifeTick, nextTickDelayMs(vitals));
}

/**
 * The saved copy of her state, and when it was last written. Held here rather
 * than read back from the store because the question is not what is on disk —
 * it is how far she has drifted since the last time anything was.
 */
let savedVitals: Vitals | null = null;
let savedVitalsAt = 0;

/** Writes only when she has actually moved, or every five minutes regardless.
 *  `force` is for shutdown, where the next read is the one that matters. */
function persistVitals(force = false) {
  if (!force && !shouldPersistVitals(vitals, savedVitals, Date.now() - savedVitalsAt)) return;
  store.set('vitals', vitals);
  store.set('her.weather', { wander, bruise });
  // Stamped every time her state is written, so a gap she cannot account for is
  // visible the next time she comes up (feelings.ts 'lost-time').
  store.set('her.lastAliveAt', new Date().toISOString());
  savedVitals = { ...vitals };
  savedVitalsAt = Date.now();
}

function startLifeLoop() {
  const saved = store.get('vitals') as Vitals | undefined;
  // Resuming where she left off means closing and reopening the app does not
  // hand back a factory-fresh mood.
  if (saved) vitals = { ...DEFAULT_VITALS, ...saved };
  const weather = store.get('her.weather') as { wander?: Lean; bruise?: Lean } | undefined;
  backfillMonths();
  // What she missed. A deploy is seconds and a crash that took her out for half
  // a day is not, and the difference is the whole point.
  const aliveAt = Date.parse(String(store.get('her.lastAliveAt') ?? ''));
  const goneHours = Number.isFinite(aliveAt) ? (Date.now() - aliveAt) / 3_600_000 : 0;
  if (storeWasRecovered || goneHours >= GONE_TOO_LONG_HOURS) {
    feelNow('lost-time');
    console.log(`[feelings] ${storeWasRecovered ? 'her files came back damaged and were replaced from a backup' : `${goneHours.toFixed(1)}h she cannot account for`}`);
  }
  wander = weather?.wander ?? {};
  bruise = weather?.bruise ?? {};
  lastTickAt = Date.now();
  // What is on disk right now, so the first tick is measured against it rather
  // than against nothing and written out immediately. Null when there was
  // nothing saved, which is the one case where the first tick should write.
  savedVitals = saved ? { ...vitals } : null;
  savedVitalsAt = Date.now();
  clearTimeout(tickTimer);
  tickTimer = setTimeout(lifeTick, 4_000);
}

function nudgeVitals(event: Parameters<typeof applyEvent>[1]) {
  // Bigger than it was, by the day she is having and a roll; and half of it
  // stays as a push on where she settles, so the next few ticks do not erase it.
  const before = vitals;
  vitals = applyEvent(vitals, event, eventSize(getTemperament(), event));
  bruise = bruiseFrom(bruise, before, vitals);
  broadcastLife(null, readEnvironment());
}

let currentEmotion: Emotion = NEUTRAL_EMOTION;
// Alternated so repeated praise does not produce the same face every time.
let lastPraiseWasSmug = false;

/**
 * Her face, and only her face.
 *
 * This used to fold the reading into her vitals as well, which meant her own
 * prose set her mood: she writes a sharp line, the classifier reads it back as
 * `annoyed`, and that lowered happiness and raised stress — so the next reply
 * was written by a Haru her last reply had made unhappy. The 2026-09-07 fix
 * damped it (each shift scaled by the headroom left, so a run of same-labelled
 * replies converged instead of climbing to 1.00) but the loop itself remained.
 *
 * Measured over 2026-09-06..08, 108 of her real replies through the real
 * classifier: her own prose alone moved happiness -0.16, stress +0.12,
 * energy -0.10. Her mood now moves on things that happen to her — his
 * messages, his praise and criticism, being poked, being woken — through
 * nudgeVitals, and never on what she just said about them.
 */
function broadcastBeat(emotion: Emotion, gesture?: 'nod' | 'shake' | 'stare') {
  currentEmotion = emotion;
  for (const win of BrowserWindow.getAllWindows()) win.webContents.send('emotion:changed', { emotion, gesture });
}

// Still fire-and-forget as far as the reply is concerned — it is already on
// screen — but the promise is returned so the voice can pick a clip that matches
// the mood this line was actually said in. Callers that only want the expression
// can go on ignoring it.
/** A line classified lately, so the phone's face and the desk's mood share one call rather than queue two. */
const recentClassifications = new Map<string, { at: number; result: Promise<Emotion | null> }>();
const CLASSIFY_MEMO_MS = 2 * 60_000;

function classifyEmotion(reply: string, config: ProviderConfig): Promise<Emotion | null> {
  const key = reply.slice(0, 600);
  const cached = recentClassifications.get(key);
  if (cached && Date.now() - cached.at < CLASSIFY_MEMO_MS) return cached.result;
  const result = classifyEmotionNow(reply, config);
  recentClassifications.set(key, { at: Date.now(), result });
  while (recentClassifications.size > 20) recentClassifications.delete(recentClassifications.keys().next().value!);
  return result;
}

function classifyEmotionNow(reply: string, config: ProviderConfig): Promise<Emotion | null> {
  const system = classificationPrompt(getMood());
  return ollamaPost(
    [{ role: 'system', content: system }, { role: 'user', content: `The line she just said: "${reply.slice(0, 600)}"` }],
    config,
    // Low temperature because this is a label, not writing; the schema is what
    // guarantees it comes back parseable. The classifier reads a 600-char line
    // and nothing else; it runs in the side jobs' shared context rather than
    // one of its own, so it never trades runners with them — see sideNumCtx.
    { tools: false, temperature: 0.1, format: EMOTION_SCHEMA, maxTokens: 120, numCtx: sideNumCtx() },
  ).then(message => {
    const parsed = parseEmotion(message.content ?? '');
    if (!parsed) { console.warn(`[emotion] unparseable classification, keeping previous: ${JSON.stringify(message.content ?? '')}`); return null; }
    // How hard she said it, which the classifier does not answer: asked to label
    // a line full of swearing it will report the intent, quite correctly, and
    // that intent is often placid. Her face should follow the delivery.
    const tone = readTone(reply);
    const emotion = sharpen(parsed, tone);
    const gesture = toneGesture(tone);
    console.log(`[emotion] ${emotion.emotion} (confidence ${emotion.confidence.toFixed(2)}, energy ${emotion.energy.toFixed(2)}, intent ${emotion.intent}, focus ${emotion.focus})${isHeated(tone) ? ` [heat ${tone.heat.toFixed(2)}${gesture ? ', head shake' : ''}]` : ''}`);
    broadcastBeat(emotion, gesture);
    const pose = tonePose(tone);
    if (pose) sendToWindows('companion:pose', pose);
    broadcastLife(null, readEnvironment());
    return emotion;
  }).catch(error => { console.warn('[emotion] classification failed:', error instanceof Error ? error.message : error); return null; });
}

function getVoiceConfig(): VoiceConfig {
  return readVoiceConfig(store.get('voice'));
}

// Which reply is currently being spoken. Bumping it abandons everything still
// queued for the previous one, which is what stops her finishing the last answer
// over the top of the new one.
let speechTurn = 0;
let openingInFlight: Promise<string | null> | null = null;

function sendToWindows(channel: string, payload?: unknown) {
  for (const win of BrowserWindow.getAllWindows()) win.webContents.send(channel, payload);
}

/**
 * True while something she said unprompted is still being spoken.
 *
 * When she starts the conversation — the opening line, a reaction to a window
 * changing, a reminder, being poked — the natural thing is to answer her out
 * loud. Requiring her name back, or a button, when she is the one who spoke
 * first is the wrong way round. So the end of an unprompted line opens a
 * listening window.
 *
 * Held until she stops rather than opened with the line, because the microphone
 * is in the same room as the speakers: open it while she is still talking and
 * the first thing it transcribes is her.
 */
let answerExpected = false;
let answerFallback: ReturnType<typeof setTimeout> | undefined;

/**
 * Arrange for the microphone to open once she has stopped talking.
 *
 * Two things ask for this. She does, when she starts a conversation herself; and
 * the window does, when the message she is answering was spoken rather than
 * typed — a spoken exchange that needs the button pressed again for the second
 * sentence is not a conversation, it is dictation with extra steps.
 */
function expectAnswerWhenDone() {
  console.log(`[reply-window] armed — waiting for her to stop speaking`);
  answerExpected = true;
  clearTimeout(answerFallback);
  // No voice means no end-of-speech to wait for.
  if (getVoiceConfig().engine === 'off') { openAnswerWindow(); return; }
  // And if speech never starts, or dies part-way, the window still opens rather
  // than being quietly lost.
  answerFallback = setTimeout(openAnswerWindow, 25_000);
}

function openAnswerWindow() {
  if (!answerExpected) return;
  console.log('[reply-window] opening the microphone for their answer');
  answerExpected = false;
  clearTimeout(answerFallback);
  sendToWindows('chat:expectReply');
}

/**
 * The quietest she will be between one unprompted line and the next.
 *
 * Every source has its own cooldown and none of them knew about the others, so
 * they stacked: the opening line, an idle remark seventeen quiet minutes in the
 * making, and a reaction to a window appearing all landed within a minute of
 * each other. Individually each was reasonable. Together they read as someone
 * who will not stop talking.
 *
 * One gate, at the single point they all pass through, so a new source added
 * later inherits it rather than becoming the fourth thing shouting at once.
 */
const INTERJECT_GAP_MS = 4 * 60_000;
let lastInterjectionAt = 0;

/**
 * Her log, which is not the transcript.
 *
 * Everything she says off her own back is written here instead of into the
 * conversation. Two separate complaints, one cause: the chat filled with
 * commentary nobody had asked for, and — worse — every line of it went back into
 * the model on the next message, so a day of her narrating the screen became the
 * bulk of what she thought had been said between them.
 *
 * Owned by this process rather than by the renderer, unlike chat.messages.
 * Every one of these is written here, so there is nothing for the window to own;
 * it is handed each line as it happens and shows the log it is given.
 */
function getAsides(): Aside[] {
  return readAsides(store.get('chat.asides'));
}

/** Everything she says without having been spoken to is written here. */
/** Set by boredNudge when the line it composed is a question about their day; stamped on the aside as it is recorded. */
let pendingAsk: string | null = null;

function noteAside(text: string, source: AsideSource, about = ''): Aside | null {
  const line = text.trim();
  if (!line) return null;
  const made = addAside(getAsides(), line, source, new Date(), localDateKey(zonedNow(CHAT_TIMEZONE)), about);
  const aside = made.aside;
  const asides = pendingAsk && source === 'idle' && /\?/.test(line) ? markAsked(made.asides, aside.id, pendingAsk) : made.asides;
  if (pendingAsk && source === 'idle') { if (/\?/.test(line)) console.log(`[push] she asked ${pendingAsk} — the next thing they say answers it`); pendingAsk = null; }
  store.set('chat.asides', asides);
  sendToWindows('chat:aside', aside);
  // Fire-and-forget: a push hiccup must not hold up the desk or the phone over
  // a line that has already been said there.
  void forwardAsideToPush(aside);
  return aside;
}

// Enough of the day to carry a thread without crowding out the instruction that
// follows it. Ten turns is roughly the last exchange plus what led into it.
const UNPROMPTED_CONTEXT_TURNS = 10;

/**
 * The day so far, for a line she is about to say off her own back.
 *
 * Every unprompted line used to be composed from a system prompt and nothing
 * else — no history, no idea what she had already said. So she opened every
 * time as though arriving fresh: two remarks fifteen minutes apart were two
 * strangers, and an unanswered question was simply forgotten rather than
 * followed up.
 *
 * Today's archive is included ahead of the live conversation because the two are
 * one day. Clearing the screen at lunchtime should not make her forget the
 * morning; that is the whole point of the day being the unit.
 */
/**
 * What has been said, and when it was said.
 *
 * At five in the morning this returned an empty string: the day had rolled over,
 * today's archive was empty, and last night's seventy-eight messages sat one key
 * away untouched. So she spoke up with no idea what had already passed between
 * them, and rather than saying nothing she invented the continuity she was
 * missing — "you never told me how the rental inspection went yesterday",
 * about an inspection that is still two days off and has never happened.
 *
 * The first hours of a day are exactly when she has least to go on and is most
 * likely to fill the gap herself, so an empty today falls back to the last day
 * that had anything in it. Labelled as what it is, never as today: knowing what
 * was said is only half of it, and a companion who thinks last night was this
 * morning is its own kind of wrong.
 */
function spokenOn(day: string, today: string): { role?: string; content?: string }[] {
  const archived = (store.getArchive()[day] ?? []) as { role?: string; content?: string }[];
  // The live list is whatever has not been archived yet, which is always today.
  const live = day === today ? ((store.get('chat.messages') as { role?: string; content?: string }[] | undefined) ?? []) : [];
  return [...archived, ...live].filter(message => message.role === 'user' || message.role === 'assistant');
}

function todaySoFar(limit = UNPROMPTED_CONTEXT_TURNS): string {
  const now = zonedNow(CHAT_TIMEZONE);
  const today = localDateKey(now);
  const render = (spoken: { role?: string; content?: string; at?: string }[]) => foldAsleepExchanges(spoken).slice(-limit).map(message =>
    `${message.role === 'user' ? 'Them' : 'You'}: ${String(message.content ?? '').replace(/\s+/g, ' ').slice(0, 200)}`).join('\n');

  const todays = spokenOn(today, today);
  if (todays.length) return `What has already been said today, oldest first:\n${render(todays)}`;

  const archive = store.getArchive();
  const earlier = Object.keys(archive).filter(day => day < today).sort().pop();
  if (!earlier) return '';
  const last = spokenOn(earlier, today);
  if (!last.length) return '';
  const when = relativeDay(earlier, today, new Intl.DateTimeFormat('en-US', { weekday: 'long' }));
  return `Nothing has been said between you yet today. The last time you spoke was ${when}, and it ended like this, oldest first:\n${render(last)}\nThat was ${when}, not today. Do not talk about any of it as though it has just happened, and do not assume anything has happened since.`;
}

/**
 * Whether she is still waiting on an answer, and for how long.
 *
 * lastInterjectionAt is zeroed the moment they say anything, so a non-zero value
 * means the last word was hers and it went unanswered — which is exactly the
 * thing she should notice rather than cheerfully starting a new subject.
 */
function stillWaiting(): string {
  if (!lastInterjectionAt) return '';
  const minutes = Math.round((Date.now() - lastInterjectionAt) / 60_000);
  if (minutes < 1) return '';
  return `You spoke up ${minutes} minute${minutes === 1 ? '' : 's'} ago and they still have not answered. Take that up with them rather than opening a new subject — you are following up, not starting again.`;
}

/** The whole continuity block, for whichever composer is about to speak. */
/**
 * The time, for every line she says off her own back.
 *
 * Four composers stated it and the rest did not, and the ones that did not are
 * the ones that speak about what is on screen. Given no clock the model does not
 * decline to mention the time — it invents one, and it reaches for the small
 * hours, because "up at 3am" is the stock way of saying somebody is doing
 * something odd. So she told someone at breakfast that it was the middle of the
 * night.
 *
 * Stating it is also the cheaper half of the fix: told the hour she mostly does
 * not mention it at all, which is what you want from a remark about a game.
 */
function rightNow(): string {
  const now = zonedNow(CHAT_TIMEZONE);
  return `It is ${formatTimeOfDay(now.getHours(), now.getMinutes())}. Do not guess at the time or imply it is late unless that is actually what the clock says.`;
}

/**
 * Her night and her things are in the her_own block every composer already
 * gets; listed here as well they went into each brief twice (2026-09-06).
 * What the block cannot know is what she has said tonight, so only the
 * guard survives here.
 */
function nightRaisedAlready(recentLines: string[]): string {
  const nights = nightsOn(getNights(), lastNightKey());
  if (!nights.length) return '';
  return nightsToDrawOn(nights, recentLines) ? '' : 'You have already told them about your night today — do not bring it up again unless they ask.';
}

function unpromptedContext(): string {
  // What they are partway through, on every path where she speaks first. Added
  // here rather than at each call site because there are four of them and the
  // one that was missed is exactly where the complaint came from — she remarked
  // on a manga she had watched them read for days as though she had never seen
  // it, because that particular composer had never been given the list.
  const today = localDateKey(zonedNow(CHAT_TIMEZONE));
  const asides = getAsides();
  const spokenToday = asidesOn(asides, today);
  // When they last said anything to her, from any device: what she has remarked
  // since then is still hanging; what she remarked before it is not.
  const theirLastWordAt = () => { const at = Date.parse(getMood().lastMessageAt ?? ''); return Number.isFinite(at) ? at : undefined; };
  // Her own remarks, beside the conversation rather than mixed into it. They are
  // not part of what was said between them and printing them as though they were
  // is how she came to answer her own asides — but she does have to know she has
  // already made the point, or she makes it again an hour later.
  //
  // On the clock rather than on the day, unlike the check below: what she must
  // not repeat at one in the morning is what she said at half eleven.
  // Where their phone says they are rides along too: a nudge that knows they
  // are at the shops has something to needle with.
  const parts = [summariseFollowing(getFollowing(), Date.now()), todaySoFar(), alreadySaidRecently(asides, CHAT_TIMEZONE, Date.now(), theirLastWordAt()), stillWaiting(), describeWhereabouts(getWhereabouts()), toldNow(), arrivalNote(), unansweredAsksNote(asides, CHAT_TIMEZONE, Date.now()), weatherToDrawOn(getWeather().last, weatherWhere(), asides.map(aside => aside.text), Date.now(), getWeather().disputedAt), nightRaisedAlready(asides.map(aside => aside.text)), sleepNote(getHerSleepSchedule(), zonedNow(CHAT_TIMEZONE))].filter(Boolean);
  if (!parts.length) return '';
  // "Do not repeat a point you have already made" was read as "change the
  // subject": once a thread was answered and settled she abandoned the day
  // entirely and opened with generic filler — "Lazy Sunday much?" — which is the
  // opposite of the intent. Returning to what happened today is the good case;
  // only saying the same line twice is the bad one, and the two have to be
  // separated or avoiding the second costs you the first.
  // "Do not act as though this is the first thing you have said all day" is
  // false at six in the morning, and telling her to pick something up from
  // today when today is empty is how she came to invent one.
  // Her own remarks count. Twelve of them and no reply is not "the first thing
  // you have said today", and told that it was she opened the afternoon with a
  // greeting on top of a morning of her own commentary.
  const fresh = !spokenOn(today, today).length && !spokenToday.length;
  return `${parts.join('\n')}\n${fresh
    ? 'This is the first thing you have said today. Open on what is actually in front of them — what is on their list, or something they left unfinished last time — and do not ask how anything went unless it has already happened.'
    : 'Carry on from that. Pick up something from today — what they told you, what they were doing, how a thing they mentioned turned out — rather than opening on nothing. Do not greet them, do not say a line you have already said, and do not act as though this is the first thing you have said all day.'}`;
}

/**
 * `aboutTheGame` exempts a line from the gaming hush, and only that hush.
 *
 * Without it the screen-watching feature would have been silent by construction:
 * it only ever fires while a game is running, which is exactly when the hush
 * drops everything. The hush exists so she does not talk *over* a game about
 * something else — a remark about the scene in front of them is the one kind of
 * interruption that is welcome, and it is the whole point of the feature.
 */
/**
 * Whether an unprompted remark would be allowed through right now.
 *
 * Split out of interject so that work can be declined before it is done rather
 * than after. Looking at the screen costs a capture and several seconds of the
 * graphics card, and it was being spent on lines that interject then dropped —
 * measured doing exactly that, six seconds of GPU during a game for a sentence
 * nobody ever saw. Asking first is free.
 */
function whyNotInterject({ aboutTheGame = false } = {}): string | null {
  const now = Date.now();
  const since = now - lastInterjectionAt;
  if (since < INTERJECT_GAP_MS) return `she spoke unprompted ${Math.round(since / 1000)}s ago`;
  // The gap above only counts her own last outburst, and noteUserSpoke resets it
  // to zero — so talking to her actually cleared the one cooldown there was, and
  // she was at her most likely to butt in immediately after an exchange. Thumbing
  // a reply up and getting an unrelated remark about a tab is that bug.
  const sinceUser = now - lastUserActivityAt;
  if (lastUserActivityAt && sinceUser < QUIET_AFTER_USER_MS) return `they were talking to her ${Math.round(sinceUser / 1000)}s ago`;
  // Playing. Being talked at over a game is worse than being talked at over
  // anything else — you cannot pause to answer, and the voice arrives on top of
  // the one you are listening to. She still replies when spoken to.
  if (!aboutTheGame && readGamingConfig(store.get('gaming')).quiet && gameIsRunning()) return 'they are playing something';
  return null;
}

/**
 * Returns whether the line actually went out, which callers must respect.
 *
 * Every site paired this with an unconditional `speak()`, so a line the rate
 * limiter refused was still said aloud and still captioned over her model — it
 * simply never reached the transcript. That is how the bubble and the chat came
 * to be showing different conversations: not a sync bug, a dropped write with
 * the speech left running.
 *
 * Refusing here has to mean refusing altogether. The limiter exists so she does
 * not butt in; a version of it that silences only the written half prevents
 * nothing and loses the record.
 */
function interject(line: string, { aboutTheGame = false, source = 'other' as AsideSource, about = '' } = {}): boolean {
  const now = Date.now();
  if (herAsleepNow()) { console.log('[interject] dropped — she is asleep'); return false; }
  if (herKnockedAwakeNow()) { console.log('[interject] dropped — she was got up, she is not making conversation'); return false; }
  const refusal = whyNotInterject({ aboutTheGame });
  if (refusal) {
    console.log(`[interject] dropped — ${refusal}`);
    return false;
  }
  // A line off her own back that names something done, or an event long gone,
  // is not said: twenty days after Ammie's party she announced it was tomorrow,
  // and no block in the prompt had named it. Checked on the line, not the
  // prompt — see staleItemNamed.
  const stale = staleItemNamed(line, getKept(), localDateKey(zonedNow(CHAT_TIMEZONE)));
  const invented = inventedTimeFor(line, getKept());
  if (invented) { console.log(`[interject] dropped — it gave "${invented.title}" a time, and it has none saved`); return false; }
  if (stale) {
    console.log(`[interject] dropped — it named "${stale.title}", which is ${stale.done ? 'done' : 'long past'}`);
    return false;
  }
  // Nor is a line of today's conversation said again. At 13:30 on 2026-09-16 she
  // piped up with "7900X is already overkill for most of what you do. Spend the
  // money on Emma…" — her own reply from two hours before; echoesAside only
  // looks at her asides. Of the 23 kept asides it is the only one this catches.
  // Her own replies only: a phrase of his inside her line ("how was your day")
  // is her asking back, not her repeating herself.
  const conversation = ((store.get('chat.messages') as { role?: string; content?: string }[] | undefined) ?? []).slice(-14).filter(message => message.role === 'assistant').map(message => message.content ?? '');
  if (looksLikeAnEcho(line, conversation)) {
    console.log('[interject] dropped — it repeats something already said in the conversation');
    return false;
  }
  // A line she has already said, or one copied out of the list of them
  // ("9:36 PM — “...”"), is not a new line: see echoesAside.
  if (echoesAside(line, getAsides(), now)) {
    console.log('[interject] dropped — it repeats a line she already said');
    return false;
  }
  lastInterjectionAt = now;
  // Before it goes out, so that whatever she has just demanded an account of is
  // on record by the time they reply.
  noteSheAsked(line);
  // Into her own log, not the transcript. This function is the definition of an
  // unprompted line — it exists to rate-limit exactly the things nobody asked
  // for — so it is also the right and only place to decide where they are
  // written. Anything that reaches the conversation instead does so by not
  // coming through here, which is a short and deliberate list: see the two
  // "hold on, I'm looking" sites, which answer a button the user just pressed.
  noteAside(line, source, about);
  expectAnswerWhenDone();
  return true;
}

/**
 * Answering resets the clock. A conversation is not her talking at them, so the
 * gap only measures silence she broke herself.
 */
/**
 * The last time the user did anything deliberate — sent a message, thumbed a
 * reply up or down. Not the same as the mouse moving or a window changing;
 * those are things that happen near her, and this is them addressing her.
 */
let lastUserActivityAt = 0;

// How long she holds off after that. An exchange is a conversation, and having
// something unrelated shoved into it — a remark about a tab, a nudge about the
// journal — is what turns a companion into an interruption. Long enough that
// thanking her and getting a tangent back cannot happen; short enough that
// wandering off for a few minutes still leaves her free to speak.
const QUIET_AFTER_USER_MS = 3 * 60_000;

function noteUserSpoke() {
  // Zeroed so she is free to follow up on her own next line; see stillWaiting,
  // which reads a non-zero value as "they never answered me".
  lastInterjectionAt = 0;
  lastUserActivityAt = Date.now();
}

function stopSpeaking() {
  speechTurn++;
  sendToWindows('speech:stop');
}

// Long enough for the classifier to land on a normal run, short enough that a
// hung one is not audible as a delay before she starts talking.
const EMOTION_WAIT_MS = 2500;

/** Resolves null if the promise has not settled in time. The timer is cleared
 *  either way so a slow classification cannot hold the process open. */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout>;
  const expiry = new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), ms); });
  return Promise.race([promise, expiry]).finally(() => clearTimeout(timer));
}

/**
 * Speaks a line, a chunk at a time. Synthesis is sequential rather than parallel
 * so the first sentence starts playing while the rest is still being made —
 * a local model takes seconds over a long reply, and waiting for all of it
 * before any of it is the difference between a companion and a recording.
 *
 * Fire-and-forget, like the emotion classifier: the text is already on screen,
 * so a TTS server that is down costs her voice rather than the message.
 */
/**
 * The line she is part-way through saying out loud.
 *
 * Interrupting somebody is only rude if they were saying something, and until
 * now nothing anywhere held what that something was — so being poked mid-sentence
 * produced a generic "ow, stop it" that could have been written before she opened
 * her mouth. This is what lets the complaint be about the thing she was cut off
 * in the middle of.
 */
let speakingLine = '';

/** A picture she has seen and been asked nothing about. See vision.ts. */

let screenshotWatcher: FSWatcher | null = null;
let screenshotSpokeAt = 0;
/** The newest file seen, so a burst produces one remark about the last one. */
let pendingShot: { path: string; at: number } | null = null;
let settleTimer: ReturnType<typeof setTimeout> | null = null;

/** Where a local Ollama lives when the chat model has gone somewhere else. */
const LOCAL_MODELS = 'http://localhost:11434';

/**
 * The address the eyes use.
 *
 * Every look() call used to take `provider.endpoint` — the chat model's address
 * — and two of them are screenshots and screen-watching, which are meant to
 * never leave this machine. That held only because the chat endpoint happened to
 * be localhost. Pointing the chat model at a rented GPU would have moved the
 * whole screen to a third party as a side effect of changing which model writes
 * her sentences, and the line above the screenshot call would still have read
 * "always the local vision model".
 *
 * So the guarantee is enforced here instead of assumed: eyes follow the chat
 * model only while it is on this machine, and fall back to the local Ollama the
 * moment it is not. For anyone whose chat model is local — everyone, until now —
 * this changes nothing.
 */
/**
 * How long a look holds the eyes. A vision model with its own Ollama may let
 * go after a while; when the eyes are her brain — the same model at the same
 * address as ai.config, since 2026-09-16 — a short hold overrides the brain's
 * keep-forever, and after a manga read or a game scene the next thing she said
 * paid a twenty-second cold load of the 27B.
 */
function eyesHold(vision: VisionConfig, wanted: string): string | number {
  const brain = store.get('ai.config') as ProviderConfig | undefined;
  if (!brain?.model || vision.model !== brain.model) return wanted;
  return trimEndpoint(visionEndpoint(brain, vision)) === trimEndpoint(brain.endpoint ?? '') ? OLLAMA_KEEP_ALIVE : wanted;
}

function visionEndpoint(provider: ProviderConfig | undefined, vision?: VisionConfig): string {
  // Her own address first, when she has been given one — a second Ollama on
  // another card, say. Held to the same rule as the chat model below it: a
  // vision endpoint that is not this machine is refused, not obeyed, because
  // the guarantee is about where the screen goes and not about which field
  // asked for it.
  const own = vision?.endpoint?.trim();
  if (own && !isRemote(own)) return own;
  const chat = provider?.endpoint?.trim();
  return chat && !isRemote(chat) ? chat : LOCAL_MODELS;
}

let lastLookAt = 0;
let lastSceneSeen = '';
let lastSceneAt = 0;
/** What she last saw on their screen, while it is still what they are looking at. */
function sceneNow(): string {
  return recentScene(lastSceneSeen, lastSceneAt, Date.now());
}

/** The game that is up, and her file on it. Stays open until another game boots. */
let currentGame: { name: string; memory: string } | null = null;
let lastGamingPollAt = 0;
/** A game seen again after this long away is a boot, not an alt-tab back. */
const GAME_BOOT_GAP_MS = 60 * 60_000;
function gamesRoot() { return path.join(app.getPath('userData'), 'games'); }
/** Her notes on the game, while it is running. */
function gameMemoryNow(): string {
  return currentGame && gameIsRunning() ? gameMemoryForPrompt(currentGame.memory) : '';
}

/**
 * The game has come up: open its folder, make one if it is new, and say hello.
 *
 * The folder is seeded with whatever she had already read about the game on a
 * night pass, so a game she has notes on is not a stranger the first time it
 * gets a file. The welcome goes through interject like every other unprompted
 * line, so the rules about when she may speak still hold.
 */
async function bootGame(name: string) {
  const now = Date.now();
  const booted = currentGame?.name !== name || now - lastGamingPollAt > GAME_BOOT_GAP_MS;
  lastGamingPollAt = now;
  if (!name.trim() || !booted) return;
  const seed = getNights().filter(night => night.game?.toLowerCase() === name.toLowerCase()).map(night => `${night.day}: ${night.note}`);
  const opened = openGameMemory(gamesRoot(), name, seed, new Date());
  currentGame = { name, memory: opened.text };
  console.log(`[game] ${opened.isNew ? 'new game — started a folder for' : 'opened the folder for'} ${name} (${opened.text.length} chars)`);
  const provider = store.get('ai.config') as ProviderConfig | undefined;
  if (!provider?.model) return;
  const refusal = whyNotInterject({ aboutTheGame: true });
  if (refusal) { console.log(`[game] no welcome — ${refusal}`); return; }
  try {
    const character = getActiveCharacter();
    const work = Object.values(getFollowing()).find(entry => entry.kind === 'game' && entry.title.toLowerCase() === name.toLowerCase());
    const line = toLength(await ollamaQuip(
      [character.identity, character.style, rightNow()].join(' '),
      welcomePrompt(name, timesThisWeek(work, localDateKey(zonedNow(CHAT_TIMEZONE))), gameMemoryForPrompt(opened.text), opened.isNew),
      provider,
    ), 220);
    if (line.trim() && interject(line, { aboutTheGame: true, source: 'screen', about: name })) void speak(line, classifyEmotion(line, provider));
  } catch (error) {
    console.warn('[game] no welcome:', error instanceof Error ? error.message : error);
  }
}
let watchTimer: ReturnType<typeof setInterval> | null = null;
/**
 * The monitor they are actually looking at.
 *
 * getSources returns every display and the first one is the primary, which on a
 * two-monitor desk is right half the time by luck. The cursor is the best cheap
 * guess at where someone is — you play where your mouse is — so the display
 * under it wins, and the primary is only the fallback when the ids do not line
 * up, which happens on some drivers.
 */
function activeScreen<T extends { display_id: string }>(sources: T[]): T | undefined {
  if (sources.length <= 1) return sources[0];
  try {
    const here = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    return sources.find(source => source.display_id === String(here.id)) ?? sources[0];
  } catch {
    return sources[0];
  }
}

let foregroundProcess = '';
/**
 * Built once at startup, because it costs a directory walk per installed game
 * and only changes when something is installed. Empty until then, which reads
 * as "not a Steam game" — the safe answer, since the fallback is the window
 * title she has always had.
 */
let steamGames = new Map<string, string>();

/** What they are actually playing, if Steam knows it. */
function gameNow(): string {
  return gameFor(foregroundProcess, steamGames) ?? '';
}

/**
 * Glances at the screen and, if anything is happening, says something.
 *
 * Captured through desktopCapturer at a thumbnail size rather than full
 * resolution — a 1280-wide frame is enough to read a scene and several times
 * cheaper to think about, which matters because this runs while a game has the
 * card.
 *
 * Always the local vision model. A frame of somebody's screen, taken on a timer
 * without them choosing the moment, is the last thing that should be posted to a
 * company — the same reasoning as screenshots, and equally not a setting.
 */
async function glanceAtScreen() {
  const config = readWatchingConfig(store.get('watching'));
  const vision = readVisionConfig(store.get('vision'));
  if (!vision.enabled) return;
  if (!shouldLook(config, lastLookAt, Date.now(), gameIsRunning(), speakingNow)) return;
  // Asked before the capture, not after the inference. Nothing here would reach
  // them anyway, and during a game the graphics card is the scarce thing.
  const refusal = whyNotInterject({ aboutTheGame: true });
  if (refusal) {
    console.log(`[watch] not looking — ${refusal}`);
    // Not treated as a look: the clock should start from a glance that happened,
    // or a busy half hour would push the next one half an hour further out.
    return;
  }
  const provider = store.get('ai.config') as ProviderConfig | undefined;
  if (!provider?.model) return;
  lastLookAt = Date.now();
  try {
    const startedAt = Date.now();
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: CAPTURE_WIDTH, height: CAPTURE_HEIGHT },
    });
    const frame = activeScreen(sources)?.thumbnail;
    if (!frame || frame.isEmpty()) return;
    const encoded = frame.toPNG().toString('base64');
    const title = gameNow() || watchingTitle || currentActivity?.label || '';
    // The eyes report game state, plainly; she reacts to the report in her own
    // voice with the chat model, and the report stays in her context so a
    // question about the fight is answered from the screen. See sceneAsk.
    const sighting = await look(encoded, vision, visionEndpoint(provider, vision), modelHeaders(visionEndpoint(provider, vision)), net.fetch, {
      ask: sceneAsk(title),
      keepAlive: eyesHold(vision, '30m'),
      numPredict: 160,
    });
    const scene = sighting.description;
    const mentionable = worthMentioning(scene, lastSceneSeen);
    // The scene is logged, never the frame. Kept whether or not she speaks:
    // what is on screen is context either way.
    lastSceneSeen = scene;
    lastSceneAt = Date.now();
    console.log(`[watch] saw: ${toLength(scene, 160)} (${Date.now() - startedAt}ms)`);
    if (!mentionable) return;
    const character = getActiveCharacter();
    const line = toLength(await ollamaQuip(
      [
        character.identity,
        character.style,
        // She is looking at a game she may have watched them play for a week.
        rightNow(),
        recogniseNow(getFollowing(), currentActivity ? identifyWork(currentActivity, gameNow()) : null),
        assumeItIsTheirs(getFollowing(), Date.now()),
      ].filter(Boolean).join(' '),
      watchingPrompt(scene, title),
      provider,
    ), 220);
    if (!line.trim()) return;
    // Into the game's own file, so the next boot remembers this one.
    if (currentGame) currentGame.memory = noteInGameMemory(gamesRoot(), currentGame.name, `${scene} You said: "${line}"`, new Date());
    console.log(`[watch] remarked on what is on screen (${line.length} chars, ${Date.now() - startedAt}ms)`);
    // Spoken only if it was also written down — see interject.
    if (interject(line, { aboutTheGame: true, source: 'screen' })) void speak(line, classifyEmotion(line, provider));
  } catch (error) {
    console.warn('[watch] could not look at the screen:', error instanceof Error ? error.message : error);
  }
}

function startWatchingScreen() {
  if (watchTimer) clearInterval(watchTimer);
  const config = readWatchingConfig(store.get('watching'));
  // Said once at boot rather than on every tick. Every reason glanceAtScreen has
  // for declining is silent by design, so without this line an unstarted watcher
  // and a watcher that is simply being quiet look exactly the same.
  console.log(`[watch] ${config.enabled ? `on, every ${config.everyMinutes} min${config.gamesOnly ? ' while gaming' : ''}` : 'off'}`);
  // Checked every minute; shouldLook does the deciding, so this costs nothing on
  // the minutes it declines.
  watchTimer = setInterval(() => { void glanceAtScreen(); }, 60_000);
}

function screenshotFolder() {
  const chosen = readScreenshotConfig(store.get('screenshots')).folder;
  return chosen || path.join(app.getPath('pictures'), 'Screenshots');
}

/**
 * Waits for the file to stop growing.
 *
 * The watcher fires when the file appears, which on Windows is before it has
 * been written — read then and the decoder gets a truncated PNG and she looks at
 * half a picture, or nothing at all.
 */
async function settled(file: string): Promise<boolean> {
  let last = -1;
  for (let tries = 0; tries < SETTLE_TRIES; tries++) {
    await new Promise(resolve => setTimeout(resolve, SETTLE_MS));
    let size = -1;
    try { size = statSync(file).size; } catch { return false; }
    if (size > 0 && size === last) return true;
    last = size;
  }
  return false;
}

/**
 * She noticed. Looks locally, says one line, and never sends the image anywhere
 * — see screenshots.ts for why that is not a setting.
 */
async function remarkOnScreenshot() {
  const shot = pendingShot;
  pendingShot = null;
  if (!shot) return;
  const config = readScreenshotConfig(store.get('screenshots'));
  const vision = readVisionConfig(store.get('vision'));
  if (!vision.enabled) return;
  const provider = store.get('ai.config') as ProviderConfig | undefined;
  if (!provider?.model) return;
  if (!await settled(shot.path)) { console.warn('[shot] the file never finished being written'); return; }

  // Looking and speaking come apart here, and they used to be one decision.
  // Whether she may remark is a question about the last few minutes; whether
  // this is worth writing down is a question about the day. Gated together, a
  // screenshot taken inside the quiet window was never described at all — so
  // the log reached the server saying one had been taken and nothing about what
  // it was of, which is not a fact about anybody's day. The burst debounce still
  // means one look per burst, not one per file.
  const mayRemark = maySpeak(config, screenshotSpokeAt, Date.now());
  try {
    const bytes = readFileSync(shot.path);
    // Always the local vision model, whatever the chat model is set to, and
    // asked as a screen rather than as a picture — the same SHOT_LOOK_PROMPT
    // the server pass uses, so a shot described here and one described there
    // come back in the same shape.
    const sighting = await look(bytes.toString('base64'), vision, visionEndpoint(provider, vision), modelHeaders(visionEndpoint(provider, vision)), net.fetch, { ask: SHOT_LOOK_PROMPT });
    const name = path.basename(shot.path);
    console.log(`[shot] ${name} (${(bytes.length / 1024 | 0)}KB) -> ${sighting.description.length} chars${mayRemark ? '' : ', quiet hours — noted not said'}`);
    // Written down whether or not she says anything, and here rather than only
    // on the server: this is the desk's own copy, and it is what the desk's day
    // pass reads. The server captions the same picture into its own store once
    // the image reaches it (seen.ts) — that pass is for the backlog the desk
    // never looked at, not for shots it has already described.
    if (store.get('activityLog', true) === true) {
      const described = describeShot(store.getActivityLog(), currentChatDayKey(), name, sighting.description);
      if (described !== store.getActivityLog()) store.setActivityLog(described);
    }
    if (!mayRemark) return;
    screenshotSpokeAt = Date.now();
    const character = getActiveCharacter();
    // A screenshot arrives as a description, never a title — so without this she
    // is reacting to "a black and white comic panel" with no idea it is the
    // thing she has watched them read all week, which is where "what is this, a
    // bad translation" came from.
    const line = await ollamaQuip(
      [character.identity, character.style, rightNow(), summariseFollowing(getFollowing(), Date.now()), assumeItIsTheirs(getFollowing(), Date.now())].filter(Boolean).join(' '),
      screenshotPrompt(sighting.description, path.basename(shot.path)),
      provider,
    );
    if (!line.trim()) return;
    // Through interject, so every rule about when she may speak applies —
    // including staying quiet while they are gaming or mid-conversation.
    // Spoken only if it was also written down — see interject.
    if (interject(line, { source: 'screenshot' })) void speak(line, classifyEmotion(line, provider));
  } catch (error) {
    console.warn('[shot] could not react:', whyItFailed(error));
  }
}

function watchScreenshots() {
  screenshotWatcher?.close();
  screenshotWatcher = null;
  const config = readScreenshotConfig(store.get('screenshots'));
  if (!config.enabled) return;
  const folder = screenshotFolder();
  if (!existsSync(folder)) { console.warn(`[shot] no folder at ${folder} — nothing to watch`); return; }
  try {
    screenshotWatcher = watch(folder, (event, name) => {
      if (!name || !looksLikeScreenshot(String(name))) return;
      const file = path.join(folder, String(name));
      // Only genuinely new ones: the watcher also fires for renames and for
      // anything a backup tool touches.
      try { if (Date.now() - statSync(file).birthtimeMs > 30_000) return; } catch { return; }
      pendingShot = { path: file, at: Date.now() };
      // Noted here rather than in remarkOnScreenshot, which only runs when she
      // is allowed to speak and the vision model is on. Taking a screenshot is
      // a thing they did whether or not she had anything to say about it, and
      // what was in front of them at the time is most of what makes it worth
      // remembering — the file name alone says nothing.
      if (store.get('activityLog', true) === true) {
        store.setActivityLog(noteScreenshot(store.getActivityLog(), currentChatDayKey(), {
          name: String(name),
          doing: currentActivity ?? undefined,
        }, new Date()));
      }
      // Debounced across a burst, so five in a row earn one remark about the last.
      if (settleTimer) clearTimeout(settleTimer);
      settleTimer = setTimeout(() => { void remarkOnScreenshot(); }, 1200);
    });
    console.log(`[shot] watching ${folder}`);
  } catch (error) {
    console.warn('[shot] could not watch the folder:', error instanceof Error ? error.message : error);
  }
}

let saidDesktopIsMute = false;

async function speak(reply: string, mood?: Promise<Emotion | null>) {
  const config = getVoiceConfig();
  const text = speakableText(reply);
  if (!text) return;
  speakingLine = text;
  // The caption goes out before the voice is even considered, and from here
  // rather than from each caller, because every line she says passes through
  // this function. It has to work with the voice switched off too — reading her
  // without the chat window open is the whole point of it.
  if (store.get('companion.subtitles', true)) sendToWindows('companion:say', text);
  if (config.engine === 'off') return;
  // Thirty-six syntheses in a day, on a headless box, for a window nobody
  // watches: the phone keeps its voice (voice.webEnabled), the desk gives up its own.
  if (!config.desktopEnabled) { if (!saidDesktopIsMute) { saidDesktopIsMute = true; console.log('[voice] desk speech is off (voice.desktopEnabled) — the phone still speaks'); } return; }
  const turn = ++speechTurn;
  sendToWindows('speech:stop');
  // Waited on rather than read from currentEmotion, which at this point still
  // holds the *previous* reply's reading — classification runs alongside this,
  // not before it. The wait is close to free in practice: classifying is a much
  // smaller call than the synthesis it precedes, so it has almost always landed
  // by the time the first chunk would have been sent anyway. The timeout is
  // there so a stalled classifier costs the right clip, never her voice.
  const classified = mood ? await withTimeout(mood, EMOTION_WAIT_MS) : null;
  // The classifier can be down, or past its deadline, and a line spoken with no
  // mood fell back to the neutral clip — flat delivery no matter how she said
  // it. localEmotion reads the line itself (no model call), so the clip still
  // matches the mood even when classification never landed.
  const emotion = classified ?? { emotion: localEmotion(text), confidence: 0, energy: 0.5, intent: 'reply' as const, focus: 'user' as const };
  const reference = referenceFor(config, emotion.emotion);
  const turnStillCurrent = turn === speechTurn;
  if (!turnStillCurrent) return;
  const chunks = splitForSpeech(text);
  console.log(`[voice] speaking ${chunks.length} chunk(s) via ${config.engine} as ${emotion.emotion}${classified ? '' : ' (heuristic)'}${reference.clip ? ` using ${path.basename(reference.clip)}` : ''}`);
  let shoutedChunks = 0;
  let prepMs = 0;
  let synthMs = 0;
  // Serial on purpose, one request at a time: breeze-server holds a single
  // model slot and rejects a second concurrent request with 409 busy, so a
  // prefetched chunk would be refused rather than overlapped. The serial loop
  // already overlaps in practice — the engine synthesises at ~1.2x realtime,
  // so the next chunk is always ready before the previous one has finished
  // playing — which is what the synthMs total below records.
  for (const chunk of chunks) {
    try {
      // Decided per chunk on the text as written, before the capitals are
      // flattened: a line she is shouting gets cloned from her angry clip, which
      // is where the actual volume comes from. spokenCase then hands the engine
      // a word rather than a run of letters, so it says "stop" instead of
      // spelling it — the two do different halves of the same job.
      const shouting = hasShout(chunk);
      if (shouting) shoutedChunks++;
      const voice = shouting ? shoutReference(config, reference) : reference;
      let clip;
      const prepStarted = Date.now();
      const say = spokenCase(chunk);
      prepMs += Date.now() - prepStarted;
      const chunkSynthStarted = Date.now();
      try {
        clip = await synthesise(say, config, voice, voiceAuth(config), emotion.emotion);
      } catch (first) {
        // One retry, and only for a timeout.
        //
        // Measured on this machine: a cold synthesis took 6.7 seconds and every
        // one after it took 1.1, because the model was then resident. Under load
        // — a vision model and a chat model competing for the same card — the
        // cold call is what runs past thirty seconds and aborts. The retry is
        // nearly always the warm case, so it costs a second and turns a silent
        // failure into speech.
        //
        // Not retried for anything else: a bad reference path or a rejected
        // request will fail identically the second time and only doubles the wait.
        if (!/timeout|aborted/i.test(first instanceof Error ? first.message : String(first))) throw first;
        console.warn('[voice] synthesis timed out — trying once more, the model should be warm now');
        clip = await synthesise(say, config, voice, voiceAuth(config), emotion.emotion);
      }
      // Checked after the await, not before: the wait is where a newer reply
      // lands, and a stale chunk arriving mid-sentence is the audible bug.
      if (turn !== speechTurn) return;
      synthMs += Date.now() - chunkSynthStarted;
      sendToWindows('speech:clip', { turn, text: chunk, ...(clip ?? {}) } satisfies SpeechClip);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      console.warn('[voice] synthesis failed:', detail);
      // Said out loud, so to speak. A failure here is pure silence otherwise —
      // the text is already in the chat, so there is nothing to tell the user
      // that a voice was even attempted, and "she has gone quiet" is
      // indistinguishable from her choosing not to speak.
      sendToWindows('voice:failed', /timeout|aborted/i.test(detail)
        ? 'The voice server took too long — she is on screen but not out loud.'
        : `The voice server could not speak that: ${detail.slice(0, 120)}`);
      return;
    }
  }
  // Logged so "she still is not shouting" is diagnosable: either nothing was
  // read as a shout, or the clip it reached for was the ordinary one anyway.
  if (shoutedChunks) {
    const shouted = shoutReference(config, reference).clip;
    console.log(`[voice] ${shoutedChunks} chunk(s) shouted using ${shouted ? path.basename(shouted) : 'the default clip'}`);
  }
  // Prep is pure string work and must stay off the critical path; the synth
  // total across chunks is what the serial loop's overlap claim is checked
  // against — it should be close to the wall time, not a multiple of it.
  console.log(`[voice] spoke ${chunks.length} chunk(s) — prep ${prepMs}ms, synthesis ${synthMs}ms total`);
}

let pokeCount = 0;
let pokeLastAt: number | null = null;
let pokeSpeaking = false;
let pokeLastLineAt = 0;
// Clicks arrive far faster than a language model can answer. Every poke moves
// her face immediately; only one in a few earns a line, or a determined user
// would queue up thirty replies and hear them for the next minute.
const POKE_LINE_COOLDOWN_MS = 4500;

/**
 * She has been clicked on. Reacts on every single one, because a click that
 * produces nothing feels broken, and escalates across a bout of them.
 */
async function handlePoke(kind: PokeKind) {
  const now = Date.now();
  pokeCount = nextPokeCount(pokeCount, pokeLastAt, now);
  pokeLastAt = now;
  const tier = pokeTier(pokeCount);
  const reading = pokeEmotion(kind, tier);

  // She moves first and always, well before any line could come back — the
  // expression through the emotion beat, the body through a pose. A click that
  // produces nothing for two seconds does not feel like it landed.
  broadcastBeat({ emotion: reading.emotion, confidence: 0.9, energy: reading.energy, intent: 'dismiss', focus: 'user' }, tier === 'first' ? 'stare' : 'shake');
  sendToWindows('companion:pose', tier === 'first' ? 'flinch' : 'recoil');
  nudgeVitals('criticised');
  const bump = pokeIrritation(tier);
  if (bump) {
    const mood = getMood();
    // Capped below the threshold where she stops answering. Poking her should
    // earn a mouthful, not a silent hour: irritation sheds a point every eight
    // minutes, so six seconds of clicking would otherwise buy over an hour of
    // her refusing to reply, which reads as the app being broken rather than as
    // her being cross. Never lowers what a real argument has already earned.
    const capped = Math.min(IGNORE_THRESHOLD - IRRITATION_NOTCH, mood.irritation + bump);
    setMood({ ...mood, irritation: Math.max(mood.irritation, capped) });
  }
  console.log(`[poke] ${kind} #${pokeCount} (${tier})`);

  if (pokeSpeaking || now - pokeLastLineAt < POKE_LINE_COOLDOWN_MS) return;
  const config = store.get('ai.config') as ProviderConfig | undefined;
  if (!config?.model) return;
  pokeSpeaking = true;
  pokeLastLineAt = now;
  try {
    const character = getActiveCharacter();
    // Being interrupted is a different offence from being prodded while idle,
    // and the difference is the sentence they walked over. Without it she could
    // only be annoyed in the abstract; with it she can be annoyed about
    // something, which is the whole of what makes it feel like a person.
    const cutOff = speakingNow && speakingLine ? speakingLine.slice(0, 300) : '';
    const system = [
      character.identity,
      character.style,
      pokeInstruction(kind, tier),
      cutOff
        ? 'You were talking when they did it. Round on them for cutting you off and make it plain what they interrupted — refer to what you were actually in the middle of saying, not to being interrupted in general. Then let it go; you are not repeating the whole thing.'
        : '',
      'Reply with ONE short line, under 20 words, in your own voice. No quotation marks and no stage directions.',
    ].filter(Boolean).join(' ');
    const prod = kind === 'right-click' ? 'They just right-clicked on you.' : 'They just poked you.';
    const line = await ollamaQuip(system, cutOff ? `${prod} You were half-way through saying this out loud: "${cutOff}"` : prod, config);
    // Said out loud and written down: the companion window has nowhere to show
    // text, and a line that only exists as audio is lost with the volume off.
    //
    // Into her log rather than the conversation. Being prodded in the corner of
    // the screen is not a message they typed, and the reply to it is not part of
    // any exchange — it is her reacting, which is exactly what the log is for.
    //
    // It does not go through interject, for the same reason the "hold on, I'm
    // looking" line does not: interject refuses when the user has interacted in
    // the last few minutes, which a poke always is. Routed through it, a poke
    // reliably silenced its own reaction.
    //
    // It is not unrated: pokeSpeaking and POKE_LINE_COOLDOWN_MS above already
    // bound this, and they bound the right thing — how often a poke earns a
    // line, rather than how often she speaks unprompted.
    noteAside(line, 'poke');
    noteSheAsked(line);
    void speak(line);
  } catch (error) {
    console.warn('[poke] could not write a reaction:', error instanceof Error ? error.message : error);
  } finally {
    pokeSpeaking = false;
  }
}

// How far the rest of the machine drops while she is talking. Not silence: the
// point is to hear her over a video, not to interrupt it.
const DUCK_TO = 0.35;

let helper: ReturnType<typeof spawn> | null = null;
let systemVolume: number | null = null;
let ducked = false;
let watchingTitle: string | null = null;
let watchingScreen: { left: number; top: number; right: number; bottom: number } | null = null;

/**
 * Where she should be looking to watch the screen, in the same -1..1 space the
 * cursor arrives in. Computed here rather than in the window because only this
 * side knows where her window sits on the desktop relative to the monitor that
 * went fullscreen — from the far right of a second screen, "the centre" is hard
 * left, and from directly beneath it, straight ahead.
 */
function watchGaze(): { x: number; y: number } | null {
  if (!watchingScreen || !companionWindow || companionWindow.isDestroyed()) return null;
  const bounds = companionWindow.getBounds();
  const hereX = bounds.x + bounds.width / 2;
  const hereY = bounds.y + bounds.height / 2;
  const thereX = (watchingScreen.left + watchingScreen.right) / 2;
  const thereY = (watchingScreen.top + watchingScreen.bottom) / 2;
  // Scaled against her own window, which is the unit the cursor pipeline already
  // uses, then clamped: a target well off to one side just means as far as she
  // can turn, not further.
  return {
    x: Math.max(-1, Math.min(1, (thereX - hereX) / (bounds.width / 2))),
    // Positive is up in her focus space; positive is down on the desktop.
    y: Math.max(-1, Math.min(1, -(thereY - hereY) / (bounds.height / 2))),
  };
}

function broadcastWatching() {
  sendToWindows('companion:watching', watchGaze());
}

/**
 * The Windows side of things: whether another app has gone fullscreen, and the
 * system output level. Electron can see neither. One long-lived process, since
 * ducking has to land the instant she starts speaking.
 */
function startWindowsHelper() {
  // Not attempted anywhere else. It spawned regardless before this, and left
  // one `spawn powershell.exe ENOENT` per launch in the log of a Linux server
  // that was never going to have it — noise standing in for a statement, which
  // the startup capability report now makes properly.
  if (process.platform !== 'win32') return;
  // Packaged next to the compiled main, or read from source in development.
  const candidates = [path.join(__dirname, 'windows-helper.ps1'), path.join(__dirname, '../electron/windows-helper.ps1')];
  const script = candidates.find(candidate => existsSync(candidate));
  if (!script) { console.warn('[helper] windows-helper.ps1 not found; no ducking or fullscreen detection'); return; }

  helper = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script], { windowsHide: true });
  let buffered = '';
  helper.stdout?.on('data', (chunk: Buffer) => {
    buffered += chunk.toString();
    const lines = buffered.split(/\r?\n/);
    buffered = lines.pop() ?? '';
    for (const line of lines) handleHelperLine(line.trim());
  });
  helper.stderr?.on('data', (chunk: Buffer) => console.warn('[helper]', chunk.toString().trim().slice(0, 200)));
  helper.on('exit', code => { console.warn(`[helper] exited (${code})`); helper = null; });
  // A stream's 'error' with nobody listening is thrown, not logged, and killing
  // PowerShell a line after writing to it is the ordinary way to produce one.
  // There is nothing to say about it — the helper is going anyway — but there
  // has to be a listener, or the goodbye takes the process with it.
  helper.on('error', error => console.warn('[helper] could not run:', error instanceof Error ? error.message : error));
  helper.stdin?.on('error', () => {});
  console.log(`[helper] started from ${script}`);
}

/**
 * Starting her voice again when it is not there.
 *
 * The speech server is a separate program that has always been started by hand
 * or at login, so quitting it meant she was mute until the next time the machine
 * was. Nothing in here ever launched it — the only child process this app has
 * ever spawned is the PowerShell helper — so "restart it by opening Haru" was a
 * reasonable thing to expect and simply did not exist.
 *
 * The .cmd is launched rather than python.exe, and that matters: the wrapper is
 * what carries PYTHONUTF8, and without it the server answers 200 with a
 * perfectly well-formed WAV of pure silence. See haru-voice-stack.
 */
const VOICE_LAUNCHER = 'start-haru-voice.cmd';

function findVoiceLauncher(): string | null {
  const saved = store.get('voiceLauncher') as string | undefined;
  if (saved && existsSync(saved)) return saved;
  // Top level, not under `voice`, for the dot-path reason that has bitten this
  // store twice: saving the voice config would wipe anything nested inside it.
  const roots = ['C:\\GPT-SoVITS', path.join(app.getPath('home'), 'GPT-SoVITS')];
  for (const root of roots) {
    if (!existsSync(root)) continue;
    const here = path.join(root, VOICE_LAUNCHER);
    if (existsSync(here)) { store.set('voiceLauncher', here); return here; }
    let entries: string[] = [];
    try { entries = readdirSync(root); } catch { continue; }
    for (const entry of entries) {
      const candidate = path.join(root, entry, VOICE_LAUNCHER);
      if (existsSync(candidate)) { store.set('voiceLauncher', candidate); return candidate; }
    }
  }
  return null;
}

/**
 * Any HTTP answer at all means something is there; only a refused connection or
 * a silence means nothing is.
 *
 * `tries` for the one probe whose answer decides something. A single 1500ms
 * reach on a box that is briefly busy — mid vision pass, seconds after a
 * restart — came back false for a server that was up and answering in under a
 * millisecond when asked again a moment later. Once in twenty-two starts, and
 * it read in the log as her having lost her voice. The wait loop below keeps
 * one try, because looping every two seconds is already the retry.
 */
async function isAnswering(endpoint: string, ms = 1500, tries = 1): Promise<boolean> {
  for (let attempt = 1; attempt <= tries; attempt += 1) {
    try {
      await net.fetch(`${trimEndpoint(endpoint)}/`, { signal: AbortSignal.timeout(ms) });
      return true;
    } catch {
      if (attempt < tries) await new Promise(done => setTimeout(done, 400));
    }
  }
  return false;
}

async function reviveVoiceServer() {
  const voice = readVoiceConfig(store.get('voice'));
  if (voice.engine !== 'gpt-sovits') return;
  // Somebody else's machine is somebody else's to start.
  if (isRemote(voice.endpoint)) return;
  if (await isAnswering(voice.endpoint, 1500, 3)) { console.log('[voice] the speech server is already up'); return; }
  const launcher = findVoiceLauncher();
  // Says what it knows. Speaking does not go through this probe — it reaches
  // the endpoint when there is something to say — so nothing here establishes
  // that she is mute, only that this machine has no way to start a server that
  // did not answer. On anything but Windows there never will be: the launcher
  // is a .cmd.
  if (!launcher) { console.warn(`[voice] nothing answered at ${voice.endpoint}, and there is no ${VOICE_LAUNCHER} here to start one — she will speak if it comes up on its own`); return; }
  console.log(`[voice] nothing at ${voice.endpoint} — starting ${launcher}`);
  try {
    // Detached and unref'd: it outlives this app deliberately, the same way it
    // does when it starts at login. Killing it on quit would make closing Haru
    // silently stop a server the user may have been using for something else.
    spawn('cmd.exe', ['/c', 'start', '""', '/min', launcher], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
  } catch (error) {
    console.warn('[voice] could not start it:', error instanceof Error ? error.message : error);
    return;
  }
  // Loading the models takes about eight seconds, so this is worth waiting out
  // rather than reporting a failure she would recover from on her own.
  const started = Date.now();
  for (let waited = 0; waited < 45_000; waited += 2000) {
    await new Promise(done => setTimeout(done, 2000));
    if (await isAnswering(voice.endpoint)) {
      console.log(`[voice] speech server answered after ${((Date.now() - started) / 1000).toFixed(0)}s`);
      return;
    }
  }
  console.warn('[voice] the speech server did not come up within 45s');
}

function handleHelperLine(line: string) {
  if (!line) return;
  // Proves the pipe end to end. Its absence was how a silently buffered stdout
  // looked from this side: a helper that had started, was alive, and said nothing.
  if (line === 'ready') {
    // A duck recorded on disk means the last run died mid-sentence — force
    // killed, crashed, or the machine went down — and left the volume pulled
    // down with nothing to put it back. Undo it before anything else reads the
    // ducked level as what the user actually wanted.
    const stranded = store.get('audio.preDuck') as number | undefined;
    if (typeof stranded === 'number' && stranded > 0) {
      console.warn(`[helper] restoring system volume to ${stranded} — the previous run was ducked when it ended`);
      systemVolume = stranded;
      setSystemVolume(stranded);
      store.delete('audio.preDuck' as never);
    }
    console.log(`[helper] watching (system volume ${systemVolume ?? 'unknown'})`);
    return;
  }
  if (line.startsWith('volume-set ')) {
    // The system volume has actually moved. Anything waiting to be told about
    // it — her gain compensation — can go now.
    const pending = afterVolumeSet;
    afterVolumeSet = null;
    if (pending) { clearTimeout(pending.timer); pending.run(); }
    return;
  }
  if (line.startsWith('volume ')) {
    const level = Number(line.slice(7));
    // Only trusted while we are not the ones holding it down, or her own duck
    // would be remembered as the user's preferred level and never restored.
    if (Number.isFinite(level) && level >= 0 && !ducked) systemVolume = level;
    return;
  }
  if (line.startsWith('foreground ')) {
    // "<process>|<title>|<url>" — the url is only ever filled in for browsers.
    const parts = line.slice('foreground '.length).split('|');
    const process = parts[0] ?? '';
    const url = parts.length > 2 ? parts[parts.length - 1] : '';
    const title = parts.slice(1, parts.length > 2 ? -1 : undefined).join('|');
    // A tool window is not an activity. Left in, the Snipping Tool became
    // something she had opinions about, and it would have gone into the
    // following tracker as a thing they keep coming back to.
    if (isJustATool(process, title)) { console.log('[activity] ignoring a tool window'); return; }
    const activity = readActivity(process, title);
    // The label is what she says out loud, and for a game it was the process
    // name — "wdc", or the publisher if the window title got there first. Steam
    // knows the real one, so every remark that names the game gets it, not just
    // the ones that look at the screen.
    const steamName = gameFor(process, steamGames);
    if (steamName && activity.kind === 'gaming') activity.label = steamName;
    // Kept whether or not she says anything about it. Reacting is occasional and
    // rate-limited; being asked "what am I even looking at" is not, and until now
    // the answer was assembled only on the path she speaks from — so asked
    // directly she had nothing and said so.
    currentActivity = activity;
    // Steam's own name for it, where Steam has one. The process is called "wdc"
    // and the window says "Telltale Games"; neither is the game.
    foregroundProcess = process;
    if (activity.kind === 'gaming') { const provider = store.get('ai.config') as ProviderConfig | undefined; if (provider?.model) void releaseModelForGame(provider); }
    else if (!watchingTitle) evictedFor = null;
    noteFollowing(activity, steamName ?? '');
    // After noteFollowing, so today already counts among the days it was opened.
    if (activity.kind === 'gaming') void bootGame(steamName || activity.label);
    // Written here rather than in reactToActivity, which is where the reacting
    // is decided: that returns early on a cooldown, a mood, a tool window she
    // is silent about — and a day she spent quietly is still a day she spent.
    // Every foreground change reaches this line and only this line.
    if (store.get('activityLog', true) === true) {
      const day = currentChatDayKey();
      const before = store.getActivityLog();
      const after = noteActivity(before, day, {
        kind: activity.kind, label: steamName || activity.label, process, title, url,
      }, new Date());
      // Only when something moved: the poller repeats itself far more often
      // than the picture changes, and this writes a file.
      if (after !== before) store.setActivityLog(after);
    }
    void reactToActivity(activity, url);
    return;
  }
  if (line === 'fullscreen off') {
    watchingTitle = null;
    watchingScreen = null;
    sendToWindows('companion:watching', null);
    return;
  }
  if (line.startsWith('fullscreen on')) {
    // "fullscreen on <left> <top> <right> <bottom> <title...>"
    const rest = line.slice('fullscreen on'.length).trim();
    const parts = rest.split(' ');
    const [left, top, right, bottom] = parts.slice(0, 4).map(Number);
    const title = parts.slice(4).join(' ').trim();
    watchingScreen = [left, top, right, bottom].every(Number.isFinite) ? { left, top, right, bottom } : null;
    watchingTitle = title || 'something';
    broadcastWatching();
    void reactToFullscreen(watchingTitle);
    // Steps aside rather than vanishing. Something going fullscreen is usually a
    // film or a game, and standing in the middle of it is the one thing a desktop
    // companion must not do — but hiding altogether is what the pin toggle is
    // for, so she walks to the nearest bottom corner and stays there.
    stepAsideForFullscreen();
  }
}

function setSystemVolume(level: number) {
  helper?.stdin?.write(`volume ${level.toFixed(3)}\n`);
}

/**
 * Set alongside a volume change, and run once the helper confirms it landed.
 * Timed out rather than trusted: if the helper is wedged or an older build is
 * running without the acknowledgement, she would otherwise never be compensated
 * at all, which is a worse failure than being compensated slightly early.
 */
let afterVolumeSet: { run(): void; timer: ReturnType<typeof setTimeout> } | null = null;

function onVolumeSettled(run: () => void) {
  if (afterVolumeSet) clearTimeout(afterVolumeSet.timer);
  afterVolumeSet = { run, timer: setTimeout(() => { afterVolumeSet = null; run(); }, 700) };
}

/**
 * Whether she pulls the machine's volume down while she talks.
 *
 * Off unless asked for. The idea is sound — she is inaudible over a game
 * otherwise — but it can only be done here by moving the master volume, which
 * moves her along with everything else, so she has to be lifted by exactly as
 * much in the same instant to stay put. One of those happens in this process and
 * the other has to reach Core Audio through a PowerShell pipe, and every attempt
 * at holding them together left an audible step at the start of a line: first
 * too loud, then a dip and a swell once the ordering was fixed.
 *
 * Not worth it. Her level is hers, set by the slider in Setup, and it does not
 * move because something else started playing. The code stays because
 * per-application ducking would make it work properly and is the obvious way to
 * finish the idea.
 */
function duckingEnabled() {
  return store.get('audio.duck', false) === true;
}

/** Drops everything else while she talks, and puts it back afterwards. */
function duckOthers(speaking: boolean) {
  if (!duckingEnabled()) return;
  if (!helper || systemVolume === null) return;
  if (speaking && !ducked) {
    ducked = true;
    // Written to disk before the volume is touched, not after. A crash or a kill
    // between the two leaves the machine quiet with nothing recording why, and
    // the next start reads the ducked level as the user's own setting and ducks
    // again from there — every crash ratcheting their volume further down.
    store.set('audio.preDuck', systemVolume);
    setSystemVolume(systemVolume * DUCK_TO);
    // Ducking the shared output without this lowers her by exactly as much as
    // the video and leaves the balance between them untouched — quieter, but no
    // more audible. Held until the helper confirms the drop, though: sending it
    // in the same breath doubled her gain over an output still at full level,
    // and she surged for as long as the helper took to answer.
    onVolumeSettled(() => sendToWindows('voice:duck', DUCK_TO));
  } else if (!speaking && ducked) {
    ducked = false;
    // The other direction needs no such care — her gain drops first and the
    // system comes back up after, which errs quiet.
    sendToWindows('voice:duck', 1);
    setSystemVolume(systemVolume);
    store.delete('audio.preDuck' as never);
  }
}

/** Restores the machine on the way out, so a crash mid-sentence cannot leave the
 *  user wondering why everything is quiet. */
function releaseDuck() {
  if (ducked && systemVolume !== null) setSystemVolume(systemVolume);
  ducked = false;
}

// Per category, so opening Steam and later opening a spreadsheet each get a
// remark, but alt-tabbing between them all afternoon does not.
const activitySpokenAt: Partial<Record<ActivityKind, number>> = {};
const ACTIVITY_COOLDOWN_MS = 25 * 60_000;
let reactingToActivity = false;

/**
 * Encrypted through the OS, never plain text in
 * the settings file, and never handed back to the renderer once saved.
 *
 * Top-level rather than the tidier-looking `search.apiKey`, because a dot path
 * is a path into the object at `search` — and saving the settings writes that
 * whole object, which would take the key with it. That is exactly how the
 * private-mode character got wiped every time the mode was toggled.
 */
/**
 * Encrypted through the OS keyring when one is running. A headless box that
 * never unlocked a login session has none — safeStorage refuses outright
 * rather than half-working there — so this falls back to keeping the key as
 * readable as everything else Haru remembers already is, next to it in the
 * same file, rather than refusing to save it at all.
 *
 * On Windows and macOS the fallback never fires: safeStorage is always
 * available, so nothing here changes what is on this disk. It exists for the
 * server, and on that machine config.json must be chmod 600 — the file then
 * holds a key in the clear and is only as private as its permissions.
 *
 * The prefix is what makes it honest. A value marked plain: says outright that
 * it is not protected, and an unmarked one is from before this existed and is
 * still encrypted, so nothing saved earlier has to be re-entered.
 */
function encryptSecret(value: string): string {
  if (safeStorage.isEncryptionAvailable()) return 'enc:' + safeStorage.encryptString(value).toString('base64');
  return 'plain:' + value;
}

function decryptSecret(saved: string | undefined): string {
  if (!saved) return '';
  if (saved.startsWith('plain:')) return saved.slice('plain:'.length);
  const encoded = saved.startsWith('enc:') ? saved.slice('enc:'.length) : saved; // old format, saved before the fallback existed
  try { return safeStorage.decryptString(Buffer.from(encoded, 'base64')); } catch { return ''; }
}

function saveSearchKey(apiKey: string) {
  const key = apiKey.trim();
  if (!key) { store.delete('searchApiKey' as never); return; }
  store.set('searchApiKey', encryptSecret(key));
}

function getSearchKey(): string {
  return decryptSecret(store.get('searchApiKey') as string | undefined);
}

function saveHumeKey(apiKey: string) {
  const key = apiKey.trim();
  if (!key) { store.delete('humeApiKey' as never); return; }
  store.set('humeApiKey', encryptSecret(key));
}

function getHumeKey(): string {
  return decryptSecret(store.get('humeApiKey') as string | undefined);
}

/** The bearer Hume presents at the speech-to-speech brain hook. Made by scripts/install-evi.sh; see evi.ts. */
function getEviSecret(): string {
  return decryptSecret(store.get('eviClmSecret') as string | undefined);
}

/**
 * The calls that are open right now, by the session id Hume hands back at the
 * brain hook. A call's one piece of state between turns is whether she was
 * talked over — the hook reads it into the next turn the way the phone's
 * `interrupted` flag does, and clears it.
 */
const eviSessions = new Map<string, { deviceId: string; interrupted: boolean; startedAt: number }>();

/** The chat's day, which rolls at five in the morning, not midnight. */
function chatDayKey(): string {
  return (store.get('chat.dayKey') as string | undefined) ?? localDateKey(zonedNow(CHAT_TIMEZONE));
}

/** Google Maps Platform key — routes with traffic, places, geocoding. See routes.ts. */
function getGoogleMapsKey(): string {
  return decryptSecret(store.get('googleMapsApiKey') as string | undefined);
}

/** Steam's Web API key — read-only, made by the account holder, never their login. See steamweb.ts. */
function getSteamWebKey(): string {
  return decryptSecret(store.get('steamWebApiKey') as string | undefined);
}

/**
 * The bearer token for a model endpoint that is not on this machine. Top-level
 * for the same reason as the search key: `ai.apiKey` would be a path into the
 * object that saving the provider config overwrites.
 */
function saveRemoteKey(apiKey: string) {
  const key = apiKey.trim();
  if (!key) { store.delete('remoteApiKey' as never); return; }
  store.set('remoteApiKey', encryptSecret(key));
}

function getRemoteKey(): string {
  return decryptSecret(store.get('remoteApiKey') as string | undefined);
}

/**
 * OpenAI's own key, kept apart from the second-model one.
 *
 * They are different accounts at different companies — the escalation key here
 * is xAI's — and sharing one slot would mean choosing a chat provider silently
 * changed which company sees the files. Stored the same way: encrypted through
 * the OS, never handed back to the renderer.
 */
function saveOpenAIKey(apiKey: string) {
  const key = apiKey.trim();
  if (!key) { store.delete('openaiApiKey' as never); return; }
  store.set('openaiApiKey', encryptSecret(key));
}

function getOpenAIKey(): string {
  return decryptSecret(store.get('openaiApiKey') as string | undefined);
}

/**
 * Venice's own key, kept apart for the same reason as OpenAI's: a different
 * company, a different account, and a chat provider chosen in Setup should
 * never silently decide which of them sees the conversation.
 */
function saveVeniceKey(apiKey: string) {
  const key = apiKey.trim();
  if (!key) { store.delete('veniceApiKey' as never); return; }
  store.set('veniceApiKey', encryptSecret(key));
}

function getVeniceKey(): string {
  return decryptSecret(store.get('veniceApiKey') as string | undefined);
}

/**
 * The token for a machine that is ours but is not this one — a rented GPU, a box
 * in the cupboard, whichever address the model, the voice and the ears are at
 * today.
 *
 * This is the key the comment on remoteAuth used to describe: one door in front
 * of our own services. It is a separate slot from xAI's and OpenAI's because
 * those are other companies, and a token is not a thing to send somewhere on the
 * chance it is ignored.
 */
function saveSelfHostedKey(apiKey: string) {
  const key = apiKey.trim();
  if (!key) { store.delete('selfHostedApiKey' as never); return; }
  store.set('selfHostedApiKey', encryptSecret(key));
}

function getSelfHostedKey(): string {
  return decryptSecret(store.get('selfHostedApiKey') as string | undefined);
}

/**
 * Transcribing a file, through OpenAI when there is a key and locally otherwise.
 *
 * The same request either way: the local speech server speaks OpenAI's own
 * `/v1/audio/transcriptions` shape, so switching companies is a change of
 * address and a bearer token, not a second code path to keep working.
 */
async function transcribeFile(wav: string): Promise<string> {
  const key = getOpenAIKey();
  const listen = readListenConfig(store.get('listen'));
  // 'local' is the engine's name for "a server that speaks this shape", which
  // OpenAI's does — only the address and the bearer change.
  const config: ListenConfig = key
    ? { ...listen, engine: 'local', endpoint: 'https://api.openai.com' }
    : listen;
  if (!key && listen.engine === 'off') throw new Error('there is no speech server set up, and no OpenAI key');
  const audio = readFileSync(wav);
  return transcribe(
    audio,
    'audio/wav',
    config,
    net.fetch as never,
    key ? { Authorization: `Bearer ${key}` } : remoteAuth(config.endpoint),
  );
}

/** She notices what they have opened. */
async function reactToActivity(activity: Activity, url = '') {
  if (!isNotable(activity) || reactingToActivity) return;
  const now = Date.now();
  if (now - (activitySpokenAt[activity.kind] ?? 0) < ACTIVITY_COOLDOWN_MS) return;
  const config = store.get('ai.config') as ProviderConfig | undefined;
  if (!config?.model) return;
  const mood = getMood();
  if (isIgnoring(mood.irritation) || vitals.sleepiness > 0.8) return;
  // The third source of nagging: seeing a spreadsheet open and telling them to
  // get on with it. Everything else she notices is still fair game.
  if (activity.kind === 'working' && isSilenced(store.get('pushback') as Pushback | undefined, Date.now())) return;

  // Where they are, remembered across sessions. Noted before the cooldown check
  // below so the time accumulates even on the polls she stays quiet through —
  // otherwise she only ever counts the minutes she happened to speak in.
  const visit = noteVisit(getHaunts(), activity, now);
  store.set('haunts', visit.haunts);
  const place = visit.haunt.key;
  currentPlace = place || null;

  // Not while she is mid-sentence.
  //
  // Speaking a new line clears the queue — that is how being interrupted works
  // and it is right when the user types — but a window changing is not an
  // interruption from them, and she was cutting her own sentence in half to
  // announce it. Held until she stops instead, so she finishes the thought and
  // then remarks on what appeared. The visit above is still recorded, so the
  // time keeps accumulating while she talks.
  if (speakingNow) {
    deferredActivity = { activity, url };
    holdUntilQuiet();
    return;
  }
  // A second cooldown, per place rather than per category. The category one lets
  // her comment on 'working' again after a few minutes, which for somebody who
  // has had the same document open all afternoon means being asked about it
  // repeatedly. Somewhere she already knows earns a much longer silence.
  if (place && now - (placeSpokenAt[place] ?? 0) < FAMILIAR_COOLDOWN_MS) return;

  reactingToActivity = true;
  activitySpokenAt[activity.kind] = now;
  if (place) placeSpokenAt[place] = now;
  try {
    const character = getActiveCharacter();
    const knows = familiarity(visit.haunt, now);
    // Named before anything else is decided, so a remark about what is on screen
    // is made by someone who recognises it. Without this she reacted to the
    // window title of a manga she had watched them read for days as though she
    // had never seen it.
    const nowShowing = recogniseNow(getFollowing(), identifyWork(activity, gameNow()));
    const system = [
      character.identity,
      character.style,
      activityInstruction(activity),
      rightNow(),
      nowShowing,
      // The wider list too: what is in front of them is not always the thing
      // worth mentioning, and she should not be surprised by any of it.
      nowShowing ? '' : summariseFollowing(getFollowing(), now),
      knows,
      'One or two short lines, unprompted. Do not greet them and do not explain how you know.',
    ].filter(Boolean).join(' ');
    const prompt = activity.label
      ? `What they have just opened: "${activity.label.slice(0, 160)}"`
      : 'React to the category; you have not been told what it is.';
    const line = await ollamaQuip(system, prompt, config);
    // Category only in the log. She is told the title, but a log is a file that
    // outlives the moment and accumulates — a browsing history written to disk is
    // a different thing from her reading a window title and forgetting it.
    console.log(`[activity] ${activity.kind}${place ? ` (${place})` : ''} — reacted${knows ? ', already knew it' : ''}`);
    if (place) store.set('haunts', rememberSaid(getHaunts(), place, line));
    const emotion = classifyEmotion(line, config);
    // Spoken only if it was also written down — see interject.
    if (interject(line, { source: 'activity' })) void speak(line, emotion);
  } catch (error) {
    console.warn('[activity] could not react:', error instanceof Error ? error.message : error);
  } finally {
    reactingToActivity = false;
  }
}

/** Per-place cooldown, alongside the per-category one. */
const placeSpokenAt: Record<string, number> = {};
/** She has already said her piece about this one; leave it a good while. */
const FAMILIAR_COOLDOWN_MS = 45 * 60_000;

function getHaunts() {
  return readHaunts(store.get('haunts'));
}

/**
 * The hygiene pass over activity tracking: valueless visits expire after a
 * week, telemetry-shaped keys after a day, so the list holds places, not noise.
 */
function runHauntHygiene() {
  const haunts = getHaunts();
  const cleaned = expireHaunts(haunts, Date.now());
  if (cleaned !== haunts) {
    store.set('haunts', cleaned);
    console.log(`[haunts] expired ${Object.keys(haunts).length - Object.keys(cleaned).length} valueless or junk haunt(s)`);
  }
}

function getFollowing() {
  return readFollowing(store.get('following'));
}

/**
 * Notes what they are partway through, from whatever is in front of them.
 *
 * Called on every foreground change, which sounds noisy and is not: nearly every
 * title fails to parse and is dropped, and the ones that do parse collapse onto
 * the same key all day. A chapter of Punpun is one entry however many times the
 * page is reloaded.
 */
function noteFollowing(activity: Activity, gameName: string) {
  const work = identifyWork(activity, gameName);
  if (!work) return;
  const before = getFollowing()[work.key];
  const updated = noteWork(getFollowing(), work, new Date().toISOString(), localDateKey(zonedNow(CHAT_TIMEZONE)));
  store.set('following', updated);
  // Logged only when something actually changes, so a title that sits on screen
  // for an hour does not fill the log with itself.
  const after = updated[work.key];
  if (!before) console.log(`[following] started ${after.kind}: ${after.title}${after.progress ? ` (${after.progress})` : ''}`);
  else if (after.progress && after.progress !== before.progress) console.log(`[following] ${after.title} -> ${after.progress}`);
  else if (after.days.length !== before.days.length) console.log(`[following] back to ${after.title} (day ${after.days.length})`);
}

/**
 * True while she is actually speaking, and whatever she was about to say about
 * a window that changed underneath her.
 *
 * Only one is held: if three tabs go by while she is talking, the last is the
 * one still on screen when she finishes, and reacting to the other two would be
 * commentary on windows that are already gone.
 */
let speakingNow = false;
let deferredActivity: { activity: Activity; url: string } | null = null;
let deferredFullscreen: string | null = null;
/**
 * Releases a held remark even if she never reports finishing.
 *
 * `speakingNow` is edge-triggered from the companion window's own loop, which is
 * the only place that knows a clip actually finished playing. Reliable while
 * that window is alive — and if it is hidden or dies mid-sentence the flag stays
 * stuck true, and without this she would never mention a window again for the
 * rest of the session. Failing quiet for twenty seconds is fine; failing quiet
 * for ever is not.
 */
let deferredRelease: ReturnType<typeof setTimeout> | undefined;
const DEFERRED_LIMIT_MS = 20_000;

function releaseDeferred() {
  clearTimeout(deferredRelease);
  deferredRelease = undefined;
  const held = deferredActivity;
  const heldFullscreen = deferredFullscreen;
  deferredActivity = null;
  deferredFullscreen = null;
  if (held) {
    console.log(`[activity] ${held.activity.kind} — held until she finished speaking`);
    void reactToActivity(held.activity, held.url);
  } else if (heldFullscreen) {
    console.log('[helper] fullscreen — held until she finished speaking');
    void reactToFullscreen(heldFullscreen);
  }
}

function holdUntilQuiet() {
  clearTimeout(deferredRelease);
  deferredRelease = setTimeout(releaseDeferred, DEFERRED_LIMIT_MS);
}

/** Where they are right now, so a conversation can be tied to it. */
let currentPlace: string | null = null;
/** And what they are doing there, for when she is asked rather than volunteering. */
function photoFolder() {
  const chosen = readVisionConfig(store.get('vision')).folder;
  return chosen || path.join(app.getPath('pictures'), 'Haru');
}

// --- attachments ------------------------------------------------------------

/**
 * Staging a file costs a copy and nothing else.
 *
 * No model is called here, and that is the point of the whole change. Picking a
 * file used to run the entire job on the spot — which is why it had to steal the
 * draft box for a question, and why attaching before you had decided what to ask
 * was not a thing you could do. Now it copies, names, and gets out of the way.
 *
 * The copy is taken before anything else can fail, the same reasoning as the old
 * path: if the model is down they still wanted the file kept, and the copy is
 * the part they cannot redo.
 */
function stageAttachment(source: string, name = path.basename(source)): Attachment {
  const kind = classify(name);
  if (kind === 'unreadable') throw new Error(`${path.extname(name) || 'that'} is not something I can open. Pictures, sound, video, text and data files all work.`);
  const folder = photoFolder();
  mkdirSync(folder, { recursive: true });
  // photoName sanitises and keeps only a basename, so nothing here can be talked
  // into writing outside the folder by a crafted filename.
  const saved = path.join(folder, photoName(name, new Date()));
  copyFileSync(source, saved);
  return describeStaged(saved, name, kind);
}

function describeStaged(saved: string, name: string, kind: FileKind): Attachment {
  if (kind === 'unreadable') throw new Error('that is not something I can open');
  return {
    id: randomUUID(),
    kind,
    name,
    saved,
    // Only the basename travels: the folder is resolved again when the request
    // arrives, so a URL cannot name a file outside it.
    url: `haru-photo://local/${encodeURIComponent(path.basename(saved))}`,
    bytes: statSync(saved).size,
  };
}

/**
 * Several at once, because a message can carry several.
 *
 * One bad file does not lose the rest: an unopenable thing among four is
 * reported and skipped, rather than throwing away three good ones and leaving
 * the user to work out which was at fault.
 */
function stageAll(paths: string[], tools: { ffmpeg: string; ffprobe: string } | null): Attachment[] {
  const staged: Attachment[] = [];
  const refused: string[] = [];
  for (const source of paths) {
    const kind = classify(source);
    // Refused here rather than at send time, so it is said while the file is
    // still in front of them and not after they have typed a question about it.
    if (kind === 'unreadable') { refused.push(`${path.basename(source)} is not something I can open`); continue; }
    if ((kind === 'audio' || kind === 'video') && !tools) { refused.push(`${path.basename(source)} needs ffmpeg, which is not installed`); continue; }
    try {
      staged.push(stageAttachment(source));
    } catch (error) {
      refused.push(`${path.basename(source)} — ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (staged.length) console.log(`[attach] staged ${staged.map(file => `${file.name} (${file.kind})`).join(', ')}`);
  // Only when nothing at all got through, so one bad file among four is a log
  // line and four bad files is an error the user actually sees.
  if (!staged.length && refused.length) throw new Error(refused.join('; '));
  if (refused.length) console.warn(`[attach] skipped: ${refused.join('; ')}`);
  return staged;
}

/**
 * A pasted picture, which has no path at all.
 *
 * Ctrl+V is the case that matters most in practice — Win+Shift+S then paste is
 * how a screenshot actually gets shared, and there is no file on disk anywhere
 * in that journey. So the bytes cross the bridge exactly once, here, and are on
 * disk before anything else happens.
 */
function stageBytes(name: string, bytes: Uint8Array): Attachment {
  const folder = photoFolder();
  mkdirSync(folder, { recursive: true });
  const saved = path.join(folder, photoName(name, new Date()));
  writeFileSync(saved, Buffer.from(bytes));
  return describeStaged(saved, name, classify(name));
}

/**
 * Removing a chip before sending takes the copy with it.
 *
 * Only inside the folder we put it in, checked rather than trusted: this deletes
 * a file at a path handed over by the window, and the window is the one part of
 * this app that renders somebody else's content.
 */
function discardStaged(attachment: { saved?: string }) {
  const target = path.resolve(String(attachment?.saved ?? ''));
  const folder = path.resolve(photoFolder());
  if (!target.startsWith(folder + path.sep)) {
    console.warn('[attach] refused to discard a file outside the pictures folder');
    return;
  }
  try { rmSync(target, { force: true }); } catch (error) {
    console.warn('[attach] could not discard the copy:', error instanceof Error ? error.message : error);
  }
}

/**
 * How wide a picture is allowed to be on its way to a model.
 *
 * A 4K screenshot is several megabytes of base64 and a real amount of money per
 * turn, and no model reads the extra pixels — they are downscaled at the other
 * end regardless. 1536 is enough for small print in a screenshot to survive,
 * which is the demanding case.
 */
const SEND_WIDTH = 1536;

function imageForSending(file: string): string {
  const bytes = readFileSync(file);
  const picture = nativeImage.createFromPath(file);
  // Chromium decodes png/jpg/webp/gif/bmp and not much else — heic, avif and
  // some tiffs come back empty. Sending the original is better than sending
  // nothing, and the provider may well read it.
  if (picture.isEmpty()) return bytes.toString('base64');
  if (picture.getSize().width <= SEND_WIDTH) return bytes.toString('base64');
  return picture.resize({ width: SEND_WIDTH, quality: 'good' }).toPNG().toString('base64');
}

/**
 * Only files we put there ourselves.
 *
 * Attachments arrive from the window, which means these paths are asked for by
 * the renderer and then read off the disk here — and the renderer is the one
 * part of this app that displays content somebody else wrote. A path is not
 * something to take on trust just because it came from our own window: a bad one
 * would have this reading any file on the machine and posting it to a model.
 *
 * So the shape is re-read and the location is checked, rather than assumed from
 * the fact that we wrote it a minute ago.
 */
function ourFiles(attachments: Attachment[] | undefined): Attachment[] {
  if (!attachments?.length) return [];
  const folder = path.resolve(photoFolder());
  return readAttachments(attachments).filter(file => {
    if (path.resolve(file.saved).startsWith(folder + path.sep)) return true;
    console.warn(`[attach] ignoring ${file.name} — it is not in the pictures folder`);
    return false;
  });
}

/**
 * Whatever had to be done to a file to turn it into words.
 *
 * Cached by attachment id, because this is the expensive half and a follow-up
 * question about the same video must not transcribe it a second time. In memory
 * only: the conversation is wiped daily, so none of it is worth a file.
 */
const openedFiles = new Map<string, string>();

/**
 * Reads that failed, and when. A success is cached above; a failure was not,
 * and a picture stays in play for half an hour — so a read that timed out was
 * tried again on every turn for thirty minutes, at two minutes a turn, with
 * the reply waiting behind it each time. Remembered for ten minutes: long
 * enough that one bad picture costs one turn, short enough that a vision
 * server that was merely restarting gets another go.
 */
const failedOpens = new Map<string, number>();
const FAILED_OPEN_MEMORY_MS = 10 * 60_000;

async function readAttachment(attachment: Attachment, vision: VisionConfig, provider: ProviderConfig): Promise<string> {
  const already = openedFiles.get(attachment.id);
  if (already !== undefined) return already;
  const failedAt = failedOpens.get(attachment.id);
  if (failedAt && Date.now() - failedAt < FAILED_OPEN_MEMORY_MS) {
    console.log(`[attach] ${attachment.name} could not be opened ${Math.max(1, Math.round((Date.now() - failedAt) / 60_000))} min ago — not trying again yet`);
    return '';
  }
  try {
    const opened = await openFile(attachment, vision, provider);
    openedFiles.set(attachment.id, opened);
    failedOpens.delete(attachment.id);
    return opened;
  } catch (error) {
    failedOpens.set(attachment.id, Date.now());
    throw error;
  }
}

/** Which local models can see, as they answered /api/show. Asked once per model. */
const modelEyes = new Map<string, boolean>();

async function localModelSees(config: ProviderConfig): Promise<boolean> {
  const endpoint = trimEndpoint(config.endpoint);
  if (!config.model || isRemote(endpoint) || isOpenAIShaped(config.provider)) return false;
  const key = `${endpoint} ${config.model}`;
  const known = modelEyes.get(key);
  if (known !== undefined) return known;
  try {
    const response = await net.fetch(`${endpoint}/api/show`, { method: 'POST', headers: modelHeaders(endpoint), body: JSON.stringify({ model: config.model }), signal: AbortSignal.timeout(5_000) });
    if (!response.ok) { console.warn(`[attach] ${endpoint} would not say whether ${config.model} can see: ${response.status}`); return false; }
    const body = await response.json() as { capabilities?: string[] };
    const sees = Array.isArray(body.capabilities) && body.capabilities.includes('vision');
    console.log(`[attach] ${config.model} ${sees ? 'can see — pictures are read through her own eyes' : 'cannot see — pictures go to the vision server'}`);
    modelEyes.set(key, sees);
    return sees;
  } catch (error) {
    console.warn(`[attach] could not ask ${endpoint} whether ${config.model} can see:`, error instanceof Error ? error.message : error);
    return false;
  }
}

/**
 * A look somebody is waiting on. Through her own eyes when she has them, and
 * on a budget.
 *
 * The vision server on the second card was set up for the screenshot batch,
 * where nothing waits: with 1.9 GB free on that card it offloads no layers at
 * all, and it forgets the model between requests. Measured on a real photo he
 * sent, a read there is 221 seconds — 17 to load, 198 of prompt-eval on 4,047
 * image tokens on the CPU, 6 to answer — against a 120-second budget it can
 * never meet. The chat model beside it on the 3060 has vision, is already
 * resident, and reads the same photo in 13.6 seconds cold and 6.1 warm, better.
 * So a follow-up about a picture is read by her, and only falls back to the
 * batch server when she is running on a model without eyes.
 */
const IN_TURN_LOOK_MS = 45_000;
/**
 * Enough for a full description — about 1,800 characters — and no more. Left
 * unbounded, the read of one photo came back as 5,342 characters: 41 seconds
 * of writing for a turn somebody was waiting on, and 1,200 tokens added to
 * every prompt for the next half hour.
 */
const IN_TURN_READ_TOKENS = 450;

async function eyesForReading(vision: VisionConfig, provider: ProviderConfig): Promise<{ config: VisionConfig; endpoint: string; numCtx?: number }> {
  const local = store.get('ai.config') as ProviderConfig | undefined;
  if (local && await localModelSees(local)) {
    // A look at a picture is a side job on the same model: the shared runner, not the chat's window.
    return { config: { ...vision, model: local.model }, endpoint: trimEndpoint(local.endpoint), numCtx: sideNumCtx() };
  }
  return { config: vision, endpoint: visionEndpoint(provider, vision) };
}

/**
 * A file reduced to something a model can read.
 *
 * The reduction is the whole feature and it is unchanged — frames, a transcript,
 * plain text. What has gone is the half that used to answer: a one-shot quip
 * with no conversation, no tools and no memory behind it. The chat answers now.
 */
async function openFile(attachment: Attachment, vision: VisionConfig, provider: ProviderConfig): Promise<string> {
  const source = attachment.saved;
  const name = attachment.name;
  const tools = findFfmpeg();
  const temporary: string[] = [];
  try {
    if (attachment.kind === 'document') {
      // Its own path rather than a branch of the text one: a PDF can be a scan,
      // which is a document she genuinely cannot read, and that has to be said
      // rather than reported as an empty file.
      const read = await readPdf(source);
      console.log(`[attach] ${name} — ${read.pages} page(s), ${read.scanned ? 'scanned, no readable text' : read.text.length + ' chars'}`);
      return read.scanned ? '' : read.text;
    }
    if (attachment.kind === 'text') {
      const text = readText(source);
      console.log(`[attach] read ${name} (${text.length} chars)`);
      return text;
    }
    if (attachment.kind === 'image') {
      const started = Date.now();
      // Only ever reached when she cannot be sent the picture itself — see
      // eyesFor. A far fuller read than the glance prompt, because this text is
      // now the only thing standing in for the image.
      const eyes = await eyesForReading(vision, provider);
      const sighting = await look(imageForSending(source), eyes.config, eyes.endpoint, modelHeaders(eyes.endpoint), net.fetch, { ask: READ_IT_ALL_PROMPT, timeoutMs: IN_TURN_LOOK_MS, numPredict: IN_TURN_READ_TOKENS, ...(eyes.numCtx ? { numCtx: eyes.numCtx } : {}) });
      console.log(`[attach] ${eyes.config.model} read ${name} into ${sighting.description.length} chars in ${Math.round((Date.now() - started) / 1000)}s`);
      return sighting.description;
    }
    if (!tools) throw new Error('that needs ffmpeg, which is not installed');
    // Sound and video are the one case with a real wait in it — pulling frames
    // and transcribing ten minutes of audio takes tens of seconds. A picture
    // needs nothing said, because the composer is already showing that she is
    // thinking; half a minute of that on a video reads as broken rather than
    // slow. Said once per file: this whole function is cached by attachment.
    const holdOn = whileLooking();
    sendToWindows('chat:interject', holdOn);
    void speak(holdOn);
    const parts: string[] = [];
    if (attachment.kind === 'video') {
      const frames = await extractFrames(source, tools);
      temporary.push(...frames);
      // All of them in one request rather than one each. Measured at 3373ms
      // against 1109ms for the same four frames, and it reads better too: asked
      // about them together the model can say the video does not change between
      // frames, which is a fact about the video that no single frame contains.
      const sighting = await look(
        frames.map(frame => readFileSync(frame).toString('base64')),
        vision, visionEndpoint(provider, vision), modelHeaders(visionEndpoint(provider, vision)), net.fetch,
        { ask: `These are ${frames.length} frames taken at even intervals across one video, in order. Say plainly what the video shows and what happens across it, in two or three sentences. Describe it as one video, not as separate pictures.` },
      );
      parts.push(sighting.description);
      console.log(`[attach] ${name} — ${frames.length} frames read in one pass`);
    }
    const wav = await extractAudio(source, tools, 600);
    temporary.push(wav);
    try {
      const said = (await transcribeFile(wav)).trim();
      if (said) parts.push(`What is said in it: ${said}`);
      console.log(`[attach] ${name} — ${said ? `${said.length} chars of speech` : 'no speech in it'}`);
    } catch (error) {
      // A silent video is normal and not a failure worth refusing over.
      console.warn('[attach] could not transcribe:', error instanceof Error ? error.message : error);
    }
    return parts.join('\n');
  } finally {
    discard(temporary);
  }
}

let currentActivity: Activity | null = null;

export type GamingConfig = {
  /** Swap to a smaller model while a game is running. */
  enabled: boolean;
  /** What to swap to. Empty means keep the usual model and only go quiet. */
  model: string;
  /** Stop volunteering things while they play. */
  quiet: boolean;
};

const DEFAULT_GAMING: GamingConfig = { enabled: false, model: 'llama3.1:8b', quiet: true };

function readGamingConfig(saved: unknown): GamingConfig {
  if (!saved || typeof saved !== 'object') return DEFAULT_GAMING;
  const record = saved as Partial<GamingConfig>;
  return {
    enabled: record.enabled === true,
    model: typeof record.model === 'string' ? record.model.trim() : DEFAULT_GAMING.model,
    quiet: record.quiet !== false,
  };
}

/** True while a game has the screen. Both signals count: a game that has not
 *  gone fullscreen is still a game, and a fullscreen thing the process list does
 *  not recognise is still taking the GPU. */
function gameIsRunning() {
  // Only ever true where she is looking at her own screen. Both sources below
  // are fed by the Windows helper, so this is already false anywhere else — but
  // it is false on purpose now rather than by accident, because the desk's
  // activity log syncs to the server and a game there is not a game here.
  if (!seesItsOwnScreen()) return false;
  return currentActivity?.kind === 'gaming' || Boolean(watchingTitle);
}

/**
 * The model to use right now.
 *
 * A 14B holds 10.4GB of a 16GB card, which is most of what a game at 4K wants
 * for itself — measured earlier as her taking minutes to answer, then Ollama
 * hanging outright. An 8B is about 5GB and leaves room for both.
 */
/** Whether the swap below has been said out loud yet. Logged on the transition
 *  rather than per request — modelForNow runs on every call, quips and emotion
 *  classification included, and a line per request would drown the log. */
let gamingSwapAnnounced = false;

function modelForNow(config: ProviderConfig): ProviderConfig {
  // Only ever applies to a model running on this machine. The whole point is to
  // free VRAM the game wants, and a model on someone else's servers uses none of
  // it — so swapping the name on a remote request achieves nothing and asks xAI
  // for a model that only exists here.
  //
  // That is not hypothetical. Escalation replaces the config with the remote
  // one; this ran afterwards and overwrote the model but not the endpoint, so a
  // question asked while a game was open went to api.x.ai asking for
  // llama3.1:8b, and came back "Model not found" in the middle of a
  // conversation.
  if (isOpenAIShaped(config.provider)) return config;
  const gaming = readGamingConfig(store.get('gaming'));
  const swapping = gaming.enabled && Boolean(gaming.model) && gameIsRunning() && gaming.model !== config.model;
  // Said out loud both ways, because silence here cost an evening of archaeology:
  // the swap fired on a fullscreen video, an 8B answered a whole conversation in
  // beige assistant-speak, and the transcript then taught the 14B to carry on
  // that way after the video closed. Nothing anywhere said the model had changed.
  if (swapping && !gamingSwapAnnounced) {
    console.log(`[ai] gaming swap: ${config.model} -> ${gaming.model} — something has the screen`);
    gamingSwapAnnounced = true;
  } else if (!swapping && gamingSwapAnnounced) {
    console.log(`[ai] gaming swap released — back to ${config.model}`);
    gamingSwapAnnounced = false;
  }
  if (!swapping) return config;
  return { ...config, model: gaming.model };
}

let evictedFor: string | null = null;

/**
 * Frees the big model when a game starts.
 *
 * Swapping which model she talks to does nothing for the GPU on its own —
 * Ollama keeps the old one resident until its keep_alive lapses, so both sit in
 * VRAM and the game is no better off. A zero keep_alive is the documented way to
 * put one down immediately.
 */
async function releaseModelForGame(config: ProviderConfig) {
  // Guarded again here, where the eviction actually happens: this one throws
  // 11 GB out of VRAM, and the settings that switch it on can arrive from the
  // desk in a config sync without anybody deciding they should apply here.
  if (!seesItsOwnScreen()) return;
  const gaming = readGamingConfig(store.get('gaming'));
  if (!gaming.enabled || !gaming.model || gaming.model === config.model) return;
  if (evictedFor === config.model) return;
  evictedFor = config.model;
  try {
    await net.fetch(`${trimEndpoint(config.endpoint)}/api/generate`, {
      method: 'POST',
      headers: modelHeaders(config.endpoint),
      body: JSON.stringify({ model: config.model, keep_alive: 0 }),
    });
    console.log(`[gaming] released ${config.model} from VRAM — she is on ${gaming.model} until the game closes`);
  } catch (error) {
    console.warn('[gaming] could not release the model:', error instanceof Error ? error.message : error);
  }
}

/**
 * What is in front of them, for the chat prompt.
 *
 * She has always been able to see this — it is what her unprompted remarks are
 * built from — but only on that path. Asked outright she had no idea, which
 * reads as her being unable to see the screen rather than as nobody having
 * mentioned it. Same information, same machine, now available when she is spoken
 * to as well as when she speaks.
 *
 * Only ever the current window. Nothing is accumulated here and nothing is
 * logged; the record of where they have been lives in ./familiar and is
 * deliberately much thinner than this.
 */
/**
 * Said whether or not she has been told anything, because the failure this
 * prevents happens hardest when she has not.
 *
 * Given a nosy character and no facts, a model does not decline to speculate —
 * it writes the most plausible-sounding thing, which is a closing line about
 * anime or gaming forums that has nothing to do with what is actually open. It
 * reads as her having seen something, and she has not. Silence about the screen
 * is always better than a confident guess at it.
 */

/**
 * Files an exchange under the place it was about, and — once there is enough of
 * it — writes the whole thing into her long-term memory.
 *
 * The per-place notes are for continuity while they are still in it. The memory
 * is for afterwards: a week later the haunt may have been pruned, and what
 * should survive is not "they were in Canva for two hours" but what they were
 * doing there, which is the sort of thing she is expected to bring up unasked.
 */
async function tieToPlace(said: string, replied: string, config: ProviderConfig) {
  const place = currentPlace;
  if (!place) return;
  const haunts = getHaunts();
  const haunt = haunts[place];
  if (!haunt || !belongsToPlace(haunt, said, placeSpokenAt[place], Date.now())) return;

  const withNote = noteExchange(haunts, place, said, replied);
  store.set('haunts', withNote);
  const updated = withNote[place];
  if (!worthRemembering(updated)) return;

  try {
    // One line, in the third person, so it reads like the rest of her memories
    // rather than like a transcript pasted into the list.
    const summary = await ollamaQuip(
      'You write single-sentence notes for someone to remember later. No greeting, no commentary, no quotation marks. Third person, starting "They". State what the user is doing and anything specific worth recalling.',
      `Everything known about their time in ${updated.label}: ${(updated.notes ?? []).join(' | ')}`,
      config,
    );
    const text = summary.replace(/^["'\s]+|["'\s]+$/g, '').split('\n')[0].trim();
    if (!text || text.length < 12) return;
    const saved = addMemory(text, 'event', updated.label, { source: 'activity', emotion: localEmotion(text), emotionIntensity: readTone(text).heat });
    store.set('haunts', markRemembered(getHaunts(), place));
    console.log(`[familiar] remembered ${updated.label}: "${text}"${saved?.created ? '' : ' (already known)'}`);
  } catch (error) {
    console.warn('[familiar] could not write the memory:', error instanceof Error ? error.message : error);
  }
}

/**
 * She notices when something gets ticked off.
 *
 * Silence here was the odd part: she chases a task for days and then says
 * nothing at all when it is finally done, which makes the chasing look like
 * nagging for its own sake rather than like someone keeping track. The whole
 * point of her being difficult about it is that finishing should land.
 *
 * How late it was matters — a thing done on the day earns a different remark
 * from one she has been asking about since Tuesday, and she is told which.
 */
let tickedOffAt = 0;
/**
 * Ticking a list of things off in one go should get one remark, not five.
 *
 * This is the limit that belongs here, and it is why the remark below goes out
 * directly rather than through interject: ticking something off is an act aimed
 * at her, and interject refuses precisely when the user has just acted. Routed
 * through it, finishing a task she had chased for days got silence — which is
 * the exact failure this function was written to fix.
 */
const TICK_OFF_COOLDOWN_MS = 90_000;

async function remarkOnTickOff(item: KeptItem) {
  const now = Date.now();
  if (now - tickedOffAt < TICK_OFF_COOLDOWN_MS) return;
  const config = store.get('ai.config') as ProviderConfig | undefined;
  if (!config?.model) return;
  const mood = getMood();
  if (isIgnoring(mood.irritation)) return;
  tickedOffAt = now;
  try {
    const today = localDateKey(zonedNow(CHAT_TIMEZONE));
    const late = item.date < today;
    const character = getActiveCharacter();
    const line = await ollamaQuip([
      character.identity,
      character.style,
      'They have just ticked something off their own list, by hand, without being asked.',
      late
        ? 'It was due before today and you have been on at them about it, so this is vindication as much as anything — be smug that it took this long, and grudgingly allow that it is finally done.'
        : 'It was due today and they have actually done it. Be surprised in a backhanded way rather than warm about it.',
      'One short line. Do not congratulate them properly, do not list anything else, and do not ask what is next.',
    ].join(' '), `The task they ticked off: "${item.title}".`, config);
    // Directly, not through interject — see TICK_OFF_COOLDOWN_MS above. Still
    // into her log rather than the conversation: they ticked a box, they did not
    // say anything, and a remark about it is hers alone.
    noteAside(line, 'kept');
    noteSheAsked(line);
    void speak(line, classifyEmotion(line, config));
    console.log(`[kept] remarked on "${item.title}" being ticked off${late ? ' (late)' : ''}`);
  } catch (error) {
    console.warn('[kept] could not remark on the tick-off:', error instanceof Error ? error.message : error);
  }
}

let fullscreenSpokenAt = 0;
const FULLSCREEN_COOLDOWN_MS = 5 * 60_000;

/** She notices when something takes over the screen. */
async function reactToFullscreen(title: string) {
  const now = Date.now();
  // Nothing to react to. Plenty of windows report no usable title — launchers,
  // splash screens, anything mid-startup — and there is no interesting remark to
  // be made about a blank. Worse, being asked to comment on an empty string sent
  // her hunting for a noun and finding one in her own instructions: "Something
  // has just gone fullscreen" came back as an indignant complaint about a
  // program literally called "Something".
  const named = title.trim();
  // A snip overlay covers the whole screen and reports as fullscreen, so this
  // fired at somebody taking a screenshot — "A FULLSCREEN WINDOW OF... NOTHING!"
  // A tool is a means, not an activity, and there is nothing to say about one
  // that is not invented.
  if (isJustATool('', named)) {
    console.log('[helper] fullscreen window is a tool, not something to react to');
    return;
  }
  if (named.length < 2) {
    console.log('[helper] fullscreen with no usable title — saying nothing');
    return;
  }
  // Alt-tabbing in and out of a video should not have her ask about it every
  // time; she notices once and then lets you watch.
  if (now - fullscreenSpokenAt < FULLSCREEN_COOLDOWN_MS) return;
  const config = store.get('ai.config') as ProviderConfig | undefined;
  if (!config?.model) return;
  const mood = getMood();
  if (isIgnoring(mood.irritation)) return;
  // Same rule as a window change: something going fullscreen while she is
  // talking is not a reason to stop mid-sentence. The cooldown is deliberately
  // not stamped yet, so this is still allowed to happen once she is quiet.
  if (speakingNow) {
    deferredFullscreen = title;
    holdUntilQuiet();
    return;
  }
  fullscreenSpokenAt = now;
  try {
    const character = getActiveCharacter();
    // Classified first. Going fullscreen is not automatically settling in to
    // watch a film — it is whatever the page happens to be — and reacting to
    // everything with the same eager "ooh, what's this" is wrong for most of it.
    const activity = readActivity('', title);
    const framing = isNotable(activity)
      ? activityInstruction(activity)
      : 'React the way someone would when a film starts without them being told what it is: curious, a bit put out at not being asked, angling to watch it with them.';
    const system = [
      character.identity,
      character.style,
      // Was "Something has just gone fullscreen". Do not reintroduce a bare
      // indefinite noun here: it sits in the prompt looking exactly like a title,
      // and she quoted it back as one.
      'A window has just gone fullscreen on their screen, and you can see its title.',
      framing,
      'One or two short lines. Refer to what it actually is if the title makes that obvious. If the title is meaningless, ask what they have put on rather than guessing — and never quote a word back at them as though it were the title unless it appears in the title itself.',
    ].join(' ');
    const line = await ollamaQuip(system, `The window that just went fullscreen is titled: "${named.slice(0, 160)}"`, config);
    console.log(`[helper] fullscreen: ${title.slice(0, 60)}`);
    broadcastBeat({ emotion: 'curious', confidence: 0.9, energy: 0.7, intent: 'tease', focus: 'away' }, 'stare');
    // Something happened on their screen, which is a real event and the one
    // beat whose vitals movement used to ride on broadcastBeat.
    nudgeVitals('caught-interest');
    feelNow('caught-interest');
    sendToWindows('companion:pose', 'lean-in');
    // Spoken only if it was also written down — see interject.
    if (interject(line, { source: 'fullscreen' })) void speak(line);
  } catch (error) {
    console.warn('[helper] could not react to fullscreen:', error instanceof Error ? error.message : error);
  }
}

let chasing = false;
let lastRemindedAt = 0;
// Two overdue tasks used to produce two reminders on consecutive ticks, seconds
// apart, because each was individually due and neither knew about the other. She
// deals with one thing at a time; the rest keep.
const REMINDER_SPACING_MS = 4 * 60_000;

function reminderStates(): Record<string, ReminderState> {
  return (store.get('reminders') as Record<string, ReminderState> | undefined) ?? {};
}

/** Minutes until an item is due. Negative once its time has passed. */
function minutesUntil(item: KeptItem, now: Date, todayKey: string): number {
  if (item.date > todayKey) return Number.POSITIVE_INFINITY;
  if (item.date < todayKey) return -Number.MAX_SAFE_INTEGER;
  const intoDay = now.getHours() * 60 + now.getMinutes();
  const parsed = item.time ? parseTimeOfDay(item.time) : null;
  // A task with no clock time is given the next of its two moments — morning to
  // raise it, evening to find out whether it happened — so everything else here
  // treats it exactly like a timed one.
  if (!parsed) return allDayDueMinutes(intoDay);
  return (parsed.hour * 60 + parsed.minute) - intoDay;
}

/**
 * Chases the user about a task that is due. Keeps going, louder and less politely
 * each time, until they say something or tick it off.
 */
/**
 * Which task, if any, is worth chasing right now.
 *
 * Shared by the desktop and the phone so the two cannot drift. They differ in
 * exactly one input: at the desk, "are they here" is how long the machine has
 * been idle; on a phone it is whether the page is open in their hand. Everything
 * else — the escalation ladder, quiet hours, the staleness cap — is one set of
 * rules with one implementation, which is the only way the attempt counts stay
 * honest when she is answered on one device and ignored on the other.
 */
function chaseTarget(
  now: Date,
  todayKey: string,
  states: Record<string, ReminderState>,
  minutesSinceUserSpoke: number,
  idleSeconds: number,
) {
  // Only tasks: an event happens whether or not they are reminded of it, and
  // there is nothing for them to have done about it.
  return getKept()
    .filter(item => item.kind === 'task' && !isUnderway(item, Date.now()))
    .map(item => ({ item, due: minutesUntil(item, now, todayKey) }))
    // Soonest first, and anything already overdue ahead of anything upcoming.
    .sort((a, b) => a.due - b.due)
    .find(({ item, due }) => shouldRemind({
      minutesUntilDue: due,
      done: item.done,
      state: states[item.id],
      minutesSinceUserSpoke,
      machineIdleSeconds: idleSeconds,
      hour: now.getHours(),
      now: Date.now(),
    })) ?? null;
}

async function considerReminding(environment: Environment): Promise<boolean> {
  if (herAsleepNow()) return false;
  if (chasing || Date.now() - lastRemindedAt < REMINDER_SPACING_MS) return false;
  // Silencing only the chat prompt would leave this loop chasing them anyway,
  // which is precisely the "she agreed and then carried on" complaint.
  if (isSilenced(store.get('pushback') as Pushback | undefined, Date.now())) return false;
  const config = store.get('ai.config') as ProviderConfig | undefined;
  if (!config?.model) return false;
  const now = zonedNow(CHAT_TIMEZONE);
  const todayKey = localDateKey(now);
  const states = reminderStates();
  const mood = getMood();
  const minutesSinceUserSpoke = mood.lastMessageAt ? (Date.now() - Date.parse(mood.lastMessageAt)) / 60_000 : Number.POSITIVE_INFINITY;

  const target = chaseTarget(now, todayKey, states, minutesSinceUserSpoke, environment.idleSeconds);
  if (!target) return false;

  const previous = states[target.item.id];
  const attempts = previous?.attempts ?? 0;
  const tier = reminderTier(attempts);
  chasing = true;
  lastRemindedAt = Date.now();
  store.set('reminders', { ...states, [target.item.id]: { attempts: attempts + 1, lastAt: Date.now() } });
  store.set('reminders.lastChased', { id: target.item.id, at: Date.now() });
  try {
    const intoDay = now.getHours() * 60 + now.getMinutes();
    const evening = !target.item.time && isEveningCheck(intoDay);
    // Which day it is actually on, said out loud in every branch.
    //
    // A task with no clock time used to be described as "due earlier and has
    // been missed" — true, and containing no date at all. Asked to be sharp
    // about a blank, the model fills it: a thing saved for today came back as
    // "you were supposed to get that yesterday". The other branch had the
    // opposite fault, hardcoding "today" onto something that might have been
    // carried over from Friday.
    const day = relativeDay(target.item.date, todayKey, new Intl.DateTimeFormat('en-US', { weekday: 'long' }));
    // "today" and "last Friday" are already adverbial; a bare weekday needs "on".
    const onDay = /^(today|yesterday|tomorrow|last )/.test(day) ? day : `on ${day}`;
    const when = target.item.underway ? `which they told you at ${clockAt(Date.parse(target.item.underway))} they were getting on with, and which is still not ticked off — ask whether it is actually done, not whether they have started`
      : evening ? `which they put on for ${day} with no particular time`
      : target.due < -1 ? `which was down for ${onDay}${target.item.time ? ` at ${target.item.time}` : ''} and has not been done`
      : target.due <= 1 ? `which is due right now, ${onDay}`
      : `due in about ${Math.round(target.due)} minutes, ${onDay}`;
    const character = getActiveCharacter();
    const system = [
      character.identity,
      character.style,
      reminderInstruction(tier, target.item.title, when, evening),
      'One or two short lines. No quotation marks, no stage directions.',
    ].join(' ');
    const line = await ollamaQuip(system, 'Remind them.', config);
    console.log(`[remind] "${target.item.title}" attempt ${attempts + 1} (${tier}, volume x${reminderVolume(tier)})`);
    // Louder each unanswered time, and set before she speaks so the very first
    // syllable is already at the raised level.
    sendToWindows('voice:insistence', reminderVolume(tier));
    const emotion = classifyEmotion(line, config);
    // Spoken only if it was also written down — see interject.
    if (interject(line, { source: 'reminder', about: target.item.title })) void speak(line, emotion);
    return true;
  } catch (error) {
    console.warn('[remind] could not write a reminder:', error instanceof Error ? error.message : error);
    return false;
  } finally {
    chasing = false;
  }
}

/** Any word from them ends every escalation in progress, and drops her back to
 *  her normal voice. Being answered is the whole objective. */
/** How long after a chase a reply still counts as a reply to it. */
const REPLY_TO_CHASE_MS = 20 * 60_000;

function acknowledgeReminders() {
  let states = reminderStates();
  // A reply within minutes of a chase is a reply to that chase, whether or
  // not the item had a record yet: "I finish at 4:30 and go straight after"
  // was answered with "Go to Mums right now" because the record did not exist.
  const chased = store.get('reminders.lastChased') as { id?: string; at?: number } | undefined;
  if (chased?.id && Date.now() - Number(chased.at ?? 0) < REPLY_TO_CHASE_MS && getKept().some(item => item.id === chased.id && !item.done)) {
    states = { ...states, [chased.id]: { ...(states[chased.id] ?? { attempts: 0, lastAt: 0 }), attempts: 0, answeredAt: Date.now() } };
    store.set('reminders', states);
    store.delete('reminders.lastChased' as never);
  }
  // And anything they say within half an hour of a reminder is taken as having
  // heard about it: "Leaving for the store now" at 06:34 should have quieted
  // a 06:54 reminder, and instead it was chased eight times. The line at the
  // due minute still goes out once — shouldRemind keeps that one.
  const nowLocal = zonedNow(CHAT_TIMEZONE); const todayKey = localDateKey(nowLocal); const intoDay = nowLocal.getHours() * 60 + nowLocal.getMinutes();
  for (const item of getKept()) {
    if (item.done || item.date !== todayKey || !item.time) continue;
    const at = parseTimeOfDay(item.time); if (!at) continue;
    const untilDue = at.hour * 60 + at.minute - intoDay;
    if (untilDue > -30 && untilDue <= 30 && !states[item.id]?.answeredAt) {
      states = { ...states, [item.id]: { ...(states[item.id] ?? { attempts: 0, lastAt: 0 }), answeredAt: Date.now() } };
      store.set('reminders', states);
    }
  }
  if (Object.keys(states).length) {
    // Marked answered rather than forgotten. Clearing it read as "never chased",
    // and the ladder started again three minutes later — see ReminderState.
    const open = new Set(getKept().filter(item => !item.done).map(item => item.id));
    const answered = Date.now();
    store.set('reminders', Object.fromEntries(Object.entries(states)
      .filter(([id]) => open.has(id))
      .map(([id, state]) => [id, { ...state, attempts: 0, answeredAt: answered }])));
  }
  sendToWindows('voice:insistence', 1);
}

let lastPipedUpAt = 0;
let pipingUp = false;

/**
 * Says something unprompted when she has been sitting there ignored. Runs off
 * the life tick rather than a timer of its own, so it inherits the same variable
 * cadence as the rest of her — and so the decision is made against vitals that
 * were computed a line earlier rather than a stale copy.
 */
async function considerPipingUp(environment: Environment) {
  if (pipingUp) return;
  const config = store.get('ai.config') as ProviderConfig | undefined;
  if (!config?.model) return;
  const mood = getMood();
  // Stonewalling means stonewalling. She does not break her own silence.
  if (isIgnoring(mood.irritation)) return;

  const minutes = (since: number | null) => since ? (Date.now() - since) / 60_000 : Number.POSITIVE_INFINITY;
  const ready = shouldPipeUp({
    minutesSinceUserSpoke: minutes(mood.lastMessageAt ? Date.parse(mood.lastMessageAt) : null),
    minutesSinceSheSpoke: minutes(lastPipedUpAt || null),
    machineIdleSeconds: environment.idleSeconds,
    curiosity: vitals.curiosity,
    sleepiness: vitals.sleepiness,
    boredom: getFeelings().boredom,
    missing: getFeelings().missing,
  }, Math.random, sway('pipe-up', PIPE_UP_CHANCE, swayNow()));
  if (!ready) return;

  pipingUp = true;
  lastPipedUpAt = Date.now();
  try {
    const now = zonedNow(CHAT_TIMEZONE);
    const todayKey = localDateKey(now);
    const items = getKept();
    const statuses = items.map(item => itemStatus(item, now, todayKey));
    // The same angles her openings use. Being left alone is not a different
    // personality, so it should not be a different set of things to talk about.
    const angle = pickAngle(openingAngles({
      hour: now.getHours(),
      irritation: mood.irritation,
      ego: mood.ego,
      // Only the ones she is still entitled to ask about — see chaseableOverdue.
      overdue: chaseableOverdue(items, now, todayKey),
      dueToday: dueTodayCount(items, statuses, todayKey, raisedRecently(herLinesLastDay(Date.now()), openItems(items, todayKey))),
      doneToday: items.filter((item, index) => statuses[index] === 'done' && item.date === todayKey).length,
      hasHistory: getSessions().length > 0,
      knowsThings: getMemories().length > 0,
      kind: 'return',
    }));
    const character = getActiveCharacter();
    const system = [
      character.identity,
      // The weekday, same as every other prompt. Without it she is holding a
      // date on her list and no idea where today sits against it, which is how
      // Thursday became "tomorrow" in a line she started herself.
      `It is ${formatTimeOfDay(now.getHours(), now.getMinutes())} on ${new Intl.DateTimeFormat('en-US', { weekday: 'long' }).format(now)} ${todayKey}.`,
      profileSummary(''),
      keptSummary(now),
      character.style,
      moodInstruction(mood.irritation),
      egoInstruction(mood.ego),
      'The user is at their machine but has not said anything to you for a while. You are breaking the silence yourself, unprompted.',
      NO_ABANDON_THREAD,
      NO_INVENTED_HISTORY,
      unpromptedContext(),
      'One or two short lines. Do not greet them, do not ask if they are still there, and do not point out how long it has been — you are starting a thought, not filing a complaint about being ignored.',
      angle ? `Open on this in particular: ${angle.instruction}` : '',
    ].filter(Boolean).join(' ');

    const line = await ollamaQuip(system, 'Say something.', config);
    console.log(`[idle] piped up (angle: ${angle?.name ?? 'none'}) after ${Math.round(minutes(mood.lastMessageAt ? Date.parse(mood.lastMessageAt) : null))} quiet minutes`);
    const emotion = classifyEmotion(line, config);
    // Spoken only if it was also written down — see interject.
    if (interject(line, { source: 'idle' })) void speak(line, emotion);
  } catch (error) {
    console.warn('[idle] could not pipe up:', error instanceof Error ? error.message : error);
  } finally {
    pipingUp = false;
  }
}

function broadcastGoogleStatus() {
  const status = googleStatus(store);
  for (const win of BrowserWindow.getAllWindows()) win.webContents.send('google:changed', status);
}

let inFlightSync: Promise<ReturnType<typeof googleStatus>> | null = null;

// Manual and scheduled syncs share whichever run is already going, so pressing
// "Sync now" while the timer is mid-sync joins that one instead of starting a
// second pass that would push the same items twice.
function syncFromGoogle() {
  if (!inFlightSync) inFlightSync = runSync().finally(() => { inFlightSync = null; });
  return inFlightSync;
}

async function runSync() {
  try {
    return await performSync();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    store.set('google.lastError', message);
    broadcastGoogleStatus();
    throw error;
  }
}

async function performSync() {
  const status = googleStatus(store);
  if (!status.connected) throw new Error('Haru is not connected to Google Calendar.');
  const today = localDateKey(zonedNow(CHAT_TIMEZONE));

  // Anything saved before the account was connected has no remote event yet, and
  // the push on creation only covers items made since. Sending them here is what
  // makes "Sync now" two-way rather than pull-only.
  // Tasks and events reach different Google APIs, and either can be unavailable
  // on its own — an unenabled Tasks API took the whole sync down with it, so the
  // calendar stopped working over a feature the user had not set up yet. A
  // failure on one side is recorded and the other still runs.
  let tasksProblem: string | null = null;
  const noteTaskFailure = (error: unknown) => {
    tasksProblem ??= whyItFailed(error);
    console.error('[google] tasks unavailable:', tasksProblem);
  };

  for (const item of getKept()) {
    if (item.date < today) continue;
    if (item.kind === 'task' ? item.googleTaskId : item.googleEventId) continue;
    if (item.kind === 'task' && (!status.tasksGranted || tasksProblem)) continue;
    try {
      if (item.kind === 'task') {
        const googleTaskId = await pushTask(store, item);
        setKept(getKept().map(current => current.id === item.id ? { ...current, googleTaskId } : current));
      } else {
        const googleEventId = await pushItem(store, item, CHAT_TIMEZONE);
        setKept(getKept().map(current => current.id === item.id ? { ...current, googleEventId } : current));
      }
    } catch (error) {
      if (item.kind === 'task') { noteTaskFailure(error); continue; }
      console.error(`[google] push failed for "${item.title}":`, error);
      throw error;
    }
  }

  // Anything saved before tasks were supported went to the calendar, so a task
  // can still be sitting there as an event — tickable here, but with nothing on
  // the Google side to tick. Moved across on sight. The task is created before
  // the event is removed: a failure between the two leaves a duplicate, which is
  // recoverable, where the other order would lose the item outright.
  if (status.tasksGranted && !tasksProblem) {
    for (const item of getKept()) {
      // Any calendar event behind a task is wrong, whether or not a task also
      // exists. Items that predate task support were pushed a second time once
      // tasks came online, leaving them in Google twice — so having both ids is
      // the duplicate case, and the stale event still has to go.
      if (item.kind !== 'task' || !item.googleEventId) continue;
      try {
        const googleTaskId = item.googleTaskId ?? await pushTask(store, item);
        await removeItem(store, item.googleEventId);
        setKept(getKept().map(current => current.id === item.id ? { ...current, googleTaskId, googleEventId: undefined } : current));
        console.log(`[google] ${item.googleTaskId ? `removed the duplicate calendar copy of "${item.title}"` : `moved "${item.title}" from Calendar to Tasks`}`);
      } catch (error) {
        noteTaskFailure(error);
        break;
      }
    }
  }

  const events = await pullEvents(store, today, GOOGLE_SYNC_DAYS, CHAT_TIMEZONE);
  const existing = getKept();
  const byGoogleId = new Map(existing.filter(item => item.googleEventId).map(item => [item.googleEventId!, item]));
  const merged = [...existing];
  for (const event of events) {
    const match = byGoogleId.get(event.id);
    if (match) {
      // A new date is a new occasion: the tick stays with the day it was for (agenda.ts followCalendar).
      Object.assign(match, followCalendar(match, event, today));
      continue;
    }
    merged.push({ id: randomUUID(), title: event.title, date: event.date, time: event.time, kind: 'event', done: false, googleEventId: event.id });
  }

  if (status.tasksGranted && !tasksProblem) {
    try {
      const tasks = await pullTasks(store, today, GOOGLE_SYNC_DAYS);
      const byTaskId = new Map(merged.filter(item => item.googleTaskId).map(item => [item.googleTaskId!, item]));
      for (const task of tasks) {
        const match = byTaskId.get(task.id);
        // Google is authoritative on whether a task is ticked: it can be
        // completed on a phone, and the local copy should follow rather than
        // fight it.
        // Google owns the completion time as well as the fact of it, since a tick
        // on a phone lands there first. A local stamp is only kept where Google
        // has none to offer, and a task reopened there loses it entirely.
        const completedAt = task.done ? (task.completedAt ?? match?.completedAt) : undefined;
        if (match) { Object.assign(match, { title: task.title, date: task.date, done: task.done, completedAt }); continue; }
        merged.push({ id: randomUUID(), title: task.title, date: task.date, kind: 'task', done: task.done, completedAt, googleTaskId: task.id });
      }
    } catch (error) {
      noteTaskFailure(error);
    }
  }
  setKept(merged);
  store.set('google.lastSync', new Date().toISOString());
  // The calendar half succeeded, so this is a warning rather than a failure —
  // surfaced without pretending the sync did not happen.
  if (tasksProblem) store.set('google.lastError', `Events synced. Tasks did not: ${tasksProblem}`);
  else store.delete('google.lastError' as never);
  broadcastGoogleStatus();
  return googleStatus(store);
}

// Scheduled syncs are best-effort: a laptop that was asleep or offline should
// retry on the next tick, not surface a dialog or leave the timer dead.
function backgroundSync() {
  if (!googleStatus(store).connected) return;
  syncFromGoogle().catch(error => console.error('[google] background sync failed:', whyItFailed(error)));
}

function scheduleBackgroundSync() {
  setTimeout(backgroundSync, GOOGLE_SYNC_STARTUP_DELAY_MS);
  setInterval(backgroundSync, GOOGLE_SYNC_INTERVAL_MS);
}

let lastFocusSync = 0;

// Coming back to the window is the moment a stale calendar is most obvious —
// waiting out the rest of the interval to see a change made seconds ago on a
// phone reads as broken. Rate-limited so alt-tabbing does not sync repeatedly.
function syncOnFocus() {
  if (Date.now() - lastFocusSync < GOOGLE_FOCUS_SYNC_MIN_GAP_MS) return;
  lastFocusSync = Date.now();
  backgroundSync();
}

type ProviderConfig = { provider: string; model: string; endpoint: string; temperature: number };

function trimEndpoint(endpoint: string) {
  return endpoint.replace(/\/+$/, '');
}

// id is carried by the OpenAI dialect only — a streamed tool call carries it on
// its first delta — and travels through the same shape so both dialects can
// share one reassembly.
type ToolCall = { id?: string; function?: { name?: string; arguments?: unknown } };
// images is base64, hung off the message the way Ollama wants it. Declared here
// rather than left to arrive implicitly through a spread, because provider.ts
// has to translate it for the OpenAI dialect and a field nothing names is a
// field the next person deletes.
type OllamaMessage = { role: string; content?: string; tool_calls?: ToolCall[]; tool_name?: string; images?: string[] };

// Ollama's default context reserves a KV cache big enough to push a 14B model
// partly onto the CPU on a 16GB card — measured at 10 tok/s vs 54 tok/s once it
// fits entirely in VRAM. Chat is wiped daily, so a day's history never needs the
// larger window.
/**
 * The window the local model is asked to keep, in tokens. From config
 * (`ai.numCtx`) so a machine with the room can be given it: 8192 was sized for
 * a 6GB card, and a day's chat with two dozen tool schemas and a search result
 * or two ran past it — which qwen2.5's runner truncated in silence and
 * Qwen3.5's refuses outright. Measured on Qwen3.5-9B Q4_K_M: 32768 costs 7.8GB
 * of VRAM, 65536 costs 8.9GB, both fully on a 12GB card.
 */
/**
 * How much of the days before today goes in front of it, in characters.
 * ai.historyChars in config, else the code's default. Smaller is faster: the
 * hosted model reads the whole prompt before its first word, and yesterday
 * was a quarter of it.
 */
function historyBudgetChars(): number {
  const wanted = store.get('ai.historyChars');
  return typeof wanted === 'number' && Number.isFinite(wanted) && wanted >= 500 ? Math.round(wanted) : HISTORY_BUDGET_CHARS;
}

function chatNumCtx(): number {
  const wanted = store.get('ai.numCtx');
  return typeof wanted === 'number' && Number.isFinite(wanted) && wanted >= 2048 ? Math.min(Math.round(wanted), 262144) : 8192;
}

/**
 * The context every side job on the local model runs in — the emotion
 * classifier, quips, the second thought, the diary, memory extraction, saying
 * a hosted answer as herself. One size, on purpose: Ollama keeps one runner
 * per model and context size, and the classifier at 2048 next to everything
 * else at the chat's 20480 meant a full reload on every switch — 76 reloads in
 * 22 hours on 2026-09-06, with the big runner never fitting next to Breeze on
 * the card (25 evictions, most loads with 26–31 of 34 layers on the GPU, an
 * 8–21 s wait for a face). The prompts those jobs actually sent were at most
 * 5,986 tokens; 8192 holds them all in one runner that stays resident. Only the
 * conversation itself — the local brain answering when the hosted one cannot —
 * asks for the chat's full context, and pays one reload for it.
 */
const SIDE_NUM_CTX = 8192;

function sideNumCtx(): number {
  return Math.min(chatNumCtx(), SIDE_NUM_CTX);
}
// How long the local model is kept resident after a request. Without this, an
// idle machine's model is evicted and the next phone message pays a cold start
// on top of everything else — which is exactly the wait this whole change is
// about. Forever: this box does nothing else with that VRAM, and thirty
// minutes meant the first word after any longer silence cost eight seconds.
// Game time still unloads her explicitly (keep_alive: 0, below).
const OLLAMA_KEEP_ALIVE = -1;
// What that costs, measured on this box: the model is 11 GB of the 3060's 12,
// and loading it takes 9.8s against 0.4s warm. So the thirty minutes buys a
// reply that starts talking, at the price of the card being unavailable for
// anything else — which is the right trade here, where nothing else wants it.
// A machine that shares the card should set it lower, and a headless one that
// is only spoken to a few times a day may prefer the cold start.
// A reply sent somewhere she is not — the phone — is read on a screen
// that is not the desk, where every extra sentence is extra tokens before the
// reader sees anything. Capped so a far-away turn stays a line or two; the desk
// keeps the full leash, because a conversation in front of her is allowed to
// run long. Generous enough that a tool call is never cut off mid-arguments:
// a round that needs tools still has room to emit them.
const AWAY_MAX_TOKENS = 240;

/**
 * How many of today's turns a reply sent somewhere she is not — the phone —
 * may carry into the prompt. The desk sends everything; an away
 * reply is read on a screen where every extra token is time before the first
 * word, and a long day's thread was most of the ~10k-token prompt the hosted
 * model reads before it answers. The recent thread keeps her anchored in the
 * conversation, and the days before today still arrive whole
 * (historyBudgetChars), so cutting the early-morning turns costs her almost
 * nothing she would actually use. ai.turns in config, else this default.
 */
const AWAY_TURNS = 40;

function awayTurns(): number {
  const wanted = store.get('ai.turns');
  return typeof wanted === 'number' && Number.isFinite(wanted) && wanted >= 8 ? Math.round(wanted) : AWAY_TURNS;
}

/**
 * The fraction of each memory block's budget an away reply may use. The memory
 * profile is the biggest single chunk a hosted brain re-processes every turn,
 * and a phone reads at the speed of the first word — so an away reply gets the
 * recent, high-priority lines inside a smaller budget, and the desk keeps the
 * full blocks. ai.memoryScale in config, else this default.
 */
const AWAY_MEMORY_SCALE = 0.6;

function awayMemoryScale(): number {
  const wanted = store.get('ai.memoryScale');
  return typeof wanted === 'number' && Number.isFinite(wanted) && wanted >= 0.2 && wanted <= 1 ? wanted : AWAY_MEMORY_SCALE;
}

/**
 * How many of her own one-line day notes go in front of today's conversation.
 * Each is a tenth of the raw day it came from, so a week of them costs less
 * than three days of turns did — the prompt is smaller and her memory longer.
 * ai.summaryDays in config, else this default.
 */
const SUMMARY_DAYS = 7;

function summaryDays(): number {
  const wanted = store.get('ai.summaryDays');
  return typeof wanted === 'number' && Number.isFinite(wanted) && wanted >= 1 && wanted <= 60 ? Math.round(wanted) : SUMMARY_DAYS;
}

/**
 * Whether the tools that touch the machine may be offered at all.
 *
 * False by default and true only while a message the *user* typed or said is
 * being answered. Everything else she speaks from — a page she opened, a
 * screenshot, the game on screen, her own opening line — is text somebody else
 * wrote, and none of it gets to reach a tool that launches programs or turns the
 * computer off. Withdrawn again the moment she reads a page mid-reply, because
 * from that point the rest of the turn is downstream of the page.
 *
 * The rule is not that she might misbehave; it is that a web page must never be
 * able to make her behave.
 */
let handsAllowed = false;
/** True while she is answering someone on the web, which keeps the desk-only
 *  tools — the wardrobe, the AniList lookup, the choice buttons — off the table. */
let talkingOnWeb = false;

// Listing what is saved directly rather than behind a read tool: asked "anything
// tomorrow?", the model answered "nothing" outright instead of choosing to look,
// so the answer has to already be in front of it. Each entry carries its own
// relative label so no date arithmetic is needed to match "tomorrow" to a row.
function keptSummary(now: Date) {
  return formatAgenda(getKept(), now, localDateKey(now));
}

/**
 * The names the ear is told to expect, gathered from what she already knows —
 * see vocabulary.ts. Built per take rather than cached: it is a few string
 * scans, and the conversation it reads from changes with every message.
 */
function wordsToListenFor(): string[] {
  const herName = herNameFrom(getActiveCharacter().identity);
  const chat = ((store.get('chat.messages') as { content?: string }[] | undefined) ?? []).slice(-40).map(message => message.content ?? '');
  return spokenVocabulary({
    names: [herName, getProfile().nickname].filter(Boolean),
    taught: readHearing(store.get('hearing')).corrections.map(correction => correction.meant),
    places: getWhereabouts().places.map(place => place.name),
    kept: getKept().filter(item => !item.done).map(item => item.title),
    // Where they live and who they work with, from the profile: "Perth" was
    // only a hotword while somebody had typed it in the last forty messages.
    about: [getProfile().about, getProfile().occupation],
    chat,
  });
}

function getProfile(): Profile {
  const saved = store.get('profile') as Partial<Profile> | undefined;
  return { nickname: saved?.nickname ?? '', occupation: saved?.occupation ?? '', about: saved?.about ?? '' };
}

/**
 * The live memory layer. Created here because it needs the store and the things
 * the block layer draws on; everything else in the app reaches it through the
 * shims below, which keep the old names so the call sites read as they always
 * did.
 */
/**
 * The live knowledge layer. Everything below reaches it through the shims, which
 * keep the old names so the call sites read as they always did.
 */
const knowledge = createKnowledgeStore({
  store,
  fetch: net.fetch,
  apiKeyFor: keyFor,
  // The vault pages become standing memories. Wired after the memory store
  // exists below — the knowledge store is created first because the memory
  // store embeds through it, so this is a mutable ref, not a direct call.
  remember: draft => admitVaultMemory?.(draft) ?? null,
});

const getKnowledgeConfig = knowledge.config;
const getKnowledgeEmbedder = knowledge.embedder;
const persistKnowledge = knowledge.persist;
const touchChunks = knowledge.touch;
const enqueueKnowledge = knowledge.enqueue;
const ingestKnowledgeFile = knowledge.ingestPath;
const readVaultConfig = () => ({ path: knowledge.vaultPath() });
const saveVaultConfig = knowledge.saveVaultPath;
const syncVault = knowledge.syncVault;
const autoSyncVault = knowledge.autoSyncVault;

/**
 * The sync, and then the other half of it.
 *
 * admitVaultMemories only ever adds, so a bullet he deleted stayed a live
 * memory for ever: on 2026-09-08 his page said "she can interrupt whenever she
 * likes, the shop included" while her store still held "don't interrupt with
 * unprompted lines while Tommy is working at the shop", both active, both in
 * the same block. Editing the page had never changed her mind, only added to
 * it. Retirement runs on the same beat as admission because they are two halves
 * of the same question: what does the page say now.
 */
async function syncVaultAndRetire(): Promise<void> {
  await autoSyncVault();
  retireGoneVaultBullets();
  syncGraphPage('hourly');
}

function retireGoneVaultBullets(): void {
  const vault = knowledge.vaultPath();
  if (!vault) return;
  const admitted = readAdmitted(store.get('vault.admitted'));
  const next: Admitted = { ...admitted };
  let touched = false;
  for (const [page, spec] of Object.entries(VAULT_MEMORY_PAGES)) {
    const file = path.join(vault, page);
    if (!existsSync(file)) continue;
    let current: string[];
    try {
      current = parseVaultMemoryPage(readFileSync(file, 'utf8'), page as VaultMemoryPage).map(draft => draft.text);
    } catch (error) {
      // An unreadable page is not an empty one, and must not be treated as a
      // deletion of everything it used to say.
      console.warn(`[vault-memory] could not re-read ${page} to retire from it:`, error instanceof Error ? error.message : error);
      continue;
    }
    const plan = planRetirement(admitted[page], current);
    if (plan.held) {
      // Only worth saying when there was something to lose by getting it wrong.
      if (plan.held === 'the page parsed to nothing' && (admitted[page]?.length ?? 0) > 0) {
        console.warn(`[vault-memory] ${page} parsed to nothing — retiring nothing, its ${admitted[page]!.length} bullet(s) stand`);
      }
      // The page is still recorded on a first sync, so the next one can compare.
      if (plan.held === 'first sync, nothing to compare') { next[page] = current; touched = true; }
      continue;
    }
    const hits = recordsToRetire(getMemories(), plan.gone, spec.kind);
    if (hits.length) {
      const shelved = new Set(hits.map(hit => hit.id));
      setMemories(getMemories().map(memory => (shelved.has(memory.id) ? { ...memory, status: 'archived' as const } : memory)));
      for (const hit of hits) console.log(`[vault-memory] retired — no longer on ${page}: "${hit.text.slice(0, 80)}"`);
    } else if (plan.gone.length) {
      console.log(`[vault-memory] ${plan.gone.length} bullet(s) left ${page}, nothing of hers matched them`);
    }
    next[page] = current;
    touched = true;
  }
  if (touched) store.set('vault.admitted', next);
}
const reindexKnowledge = knowledge.reindex;

const memoryStore = createMemoryStore({
  store,
  broadcast: (channel, payload) => { for (const win of BrowserWindow.getAllWindows()) win.webContents.send(channel, payload); },
  embedder: getKnowledgeEmbedder,
  character: getCharacter,
  profile: getProfile,
  following: () => Object.values(getFollowing()).map(work => ({ title: work.title, kind: work.kind, progress: work.progress })),
  agenda: () => {
    const todayKey = localDateKey(zonedNow(CHAT_TIMEZONE));
    return getKept().map(item => ({ title: item.title, kind: item.kind, done: item.done, date: item.date, time: item.time ?? null, daysAway: Math.round((Date.parse(`${item.date}T00:00:00Z`) - Date.parse(`${todayKey}T00:00:00Z`)) / 86400000) }));
  },
  // What each new memory is (categories.ts), sorted on this machine's own
  // model: a background job, twenty records a call, never urgent.
  sort: notes => sortNotes(notes),
  // Her own life in one place — the her_own block renders it, so the chat
  // prompt no longer scatters the same lines separately. What is nearest in
  // time first: last night, the day's own reading, the week — then the things
  // she is into and her firsts and wants, and her diary last. The block is
  // cut to its budget from the top, whole lines kept in order, and on a phone
  // turn the budget is scaled down: with the interests first, last night fell
  // off the end on every turn (65 cuts in a day) and two models answered
  // "what did you do last night" from her interests and diary instead.
  herOwnLife: () => {
    const now = zonedNow(CHAT_TIMEZONE);
    const today = localDateKey(now);
    const interests = getInterests();
    return [
      nightsInstruction(nightsOn(getNights(), lastNightKey())),
      // Right behind the night, not at the tail: the block is cut from the
      // end when it is over budget, and this is the line that answers "what
      // chapter are you up to".
      readingNote(readReading(store.get('her.reading'))),
      // His shelf beside hers: where he is up to, and the spoiler line (suwayomi.ts).
      hisReadingLine(),
      // What she did with her own hands lately (herhands.ts), so it is hers to bring up.
      handsNote(readHands(store.get('her.hands')), Date.now(), iso => localDateKey(zonedNow(CHAT_TIMEZONE, new Date(iso))), today),
      // Her own game: where the run stands, read off the game (pokemon.ts).
      runNote((store.get('her.pokemon.lastState') as GameState | undefined) ?? null, String(store.get('her.pokemon.lastSummary') ?? ''), pokemonSitting !== null),
      dayNote(getDays(), today),
      weekNote(getWeek(), today),
      tastesInstruction(interests),
      firstsNote(interests, today),
      wantsNote(getWants(), interests),
      diaryContext(recentEntries(app.getPath('home'), 2)),
    ].filter(Boolean).join('\n');
  },
});

const { getMemories, setMemories, addMemory, mergeIn, getSessions, getMonthNotes, setMonthNotes, blockSources, setBlocks, profileSummary } = memoryStore;

// The vault-memory seam from above, now that the memory store exists: vault
// pages are admitted exactly like things she was told, but marked explicit so
// they are never treated as guesses.
let admitVaultMemory: ((draft: { text: string; kind: 'relationship' | 'preference' | 'fact'; subject?: string }) => { created: boolean } | null) | undefined = undefined;
admitVaultMemory = draft => {
  // A resighting: the same line on the same page is not him saying it again.
  const result = addMemory(draft.text, draft.kind, draft.subject, { source: 'explicit', resighting: true });
  // A refused bullet used to reach the tally as a repeat, so a page whose lines
  // were all being thrown away read as a page already known: "Preferences.md: 5
  // bullet(s), +0 ~5 repeated", every hour, while three of the five were dropped.
  if (result && !result.created && !result.record) console.warn(`[vault-memory] refused a bullet: "${draft.text.slice(0, 80)}"`);
  return result ? { created: result.created } : null;
};
const tryEmbedQuery = memoryStore.embedQuery;
const refreshMemoryVectors = memoryStore.refreshVectors;
const scheduleMemoryVectorRefresh = memoryStore.scheduleVectorRefresh;
const runMemoryConsolidation = memoryStore.consolidate;
const runMemoryDecay = memoryStore.decay;

// Level 3: a terminal on the box, at his word (shell.ts).
// Level 4: hands of her own, in her own time (herhands.ts).
type SystemConfig = { enabled: boolean; level: 1 | 2 | 3 | 4; allowlist: string[] };
const DEFAULT_SYSTEM_CONFIG: SystemConfig = { enabled: true, level: 2, allowlist: ['restart_docker_container', 'start_service', 'stop_service', 'restart_haru'] };

function readSystemConfig(): SystemConfig {
  const saved = store.get('system.config') as Partial<SystemConfig> | undefined;
  if (!saved || typeof saved !== 'object') return DEFAULT_SYSTEM_CONFIG;
  const level = saved.level === 4 ? 4 : saved.level === 3 ? 3 : saved.level === 2 ? 2 : saved.level === 1 ? 1 : DEFAULT_SYSTEM_CONFIG.level;
  return {
    enabled: saved.enabled === true,
    level,
    allowlist: Array.isArray(saved.allowlist) ? saved.allowlist.filter((name): name is string => typeof name === 'string') : DEFAULT_SYSTEM_CONFIG.allowlist,
  };
}

function readSystemEvents(): { enabled: boolean; sampleSeconds: number; minGapMinutes: number; thresholds: EventThresholds } {
  const saved = store.get('system.events') as Partial<{ enabled: boolean; sampleSeconds: number; minGapMinutes: number; thresholds: EventThresholds }> | undefined;
  const sampleSeconds = typeof saved?.sampleSeconds === 'number' ? Math.max(10, Math.min(300, Math.round(saved.sampleSeconds))) : 30;
  const minGapMinutes = typeof saved?.minGapMinutes === 'number' ? Math.max(1, Math.min(240, Math.round(saved.minGapMinutes))) : 15;
  return {
    enabled: saved?.enabled !== false,
    sampleSeconds,
    minGapMinutes,
    thresholds: saved?.thresholds ?? {
      gpu_percent: { value: 90, seconds: 60 },
      ram_percent: { value: 90, seconds: 60 },
      disk_percent: { value: 90, seconds: 60 },
      gpu_temp_c: { value: 85, seconds: 60 },
      network_down: { seconds: 30 },
      docker_crash: true,
    },
  };
}

// Carried over a restart while fresh, so a run she has already announced is
// not announced again ten seconds later — see carriedSamples. Written back
// every few samples rather than every one: the store is the whole config
// file, and a warning that survives a restart does not need a thirty-second
// clock to do it.
let systemSamples: SystemSample[] = carriedSamples(store.get('system.samples'), Date.now());
let systemSampleCount = 0;
const SAMPLES_WRITTEN_EVERY = 4;
const systemLastFired: Record<string, number> = { ...((store.get('system.lastFired') as Record<string, number> | undefined) ?? {}) };
let systemCollecting = false;
let pendingHaruRestart = false;

async function sampleSystem() {
  if (systemCollecting) return;
  systemCollecting = true;
  try {
    if (!readSystemConfig().enabled || !readSystemEvents().enabled) return;
    const [light, gpu, docker, gpuApps] = await Promise.all([
      collectSystem(),
      collectGpu(),
      collectDockerLight(),
      collectGpuApps(),
    ]);
    const sample = sampleFromCollectors({ ...light, gpu, docker, gpuApps, processes: [], services: [] }, new Date());
    systemSamples.push(sample);
    if (systemSamples.length > 8) systemSamples = systemSamples.slice(-8);
    if (++systemSampleCount % SAMPLES_WRITTEN_EVERY === 0) store.set('system.samples', systemSamples);
    const events = readSystemEvents();
    const fired = checkEvents(systemSamples, events.thresholds, new Date(), events.minGapMinutes * 60_000, systemLastFired);
    if (fired.length) store.set('system.lastFired', systemLastFired);
    for (const event of fired) {
      console.log(`[system] event ${event.kind}: ${event.message}`);
      interject(event.message, { source: 'system' });
    }
  } catch (error) {
    console.warn('[system] sample failed:', error instanceof Error ? error.message : String(error));
  } finally {
    systemCollecting = false;
  }
}

async function runSystemCommand(file: string, args: string[]): Promise<{ ok: boolean; error?: string }> {
  return new Promise(resolve => {
    execFile(file, args, { timeout: 30_000 }, (error, _stdout, stderr) => {
      if (error) resolve({ ok: false, error: String(stderr || error.message || '').slice(0, 300) });
      else resolve({ ok: true });
    });
  });
}

/**
 * A compact, current line about the machine, injected only when the message is
 * plainly asking about it. The 7B model is offered the system tools but rarely
 * calls them inside a long conversation, and a wrong guess about her own box is
 * the one answer she should never give — so the obvious machine questions are
 * answered from collected facts instead, the same way the agenda is put in the
 * prompt rather than left behind a tool. The tools stay for follow-ups.
 */
async function systemContextFor(message: string): Promise<string> {
  if (!readSystemConfig().enabled || !message) return '';
  const text = message.toLowerCase();
  const gpu = /(vram|gpu|graphic|video memory)/.test(text);
  const ram = /(ram|memory)/.test(text);
  const disk = /(disk|storage|drive|full|space left)/.test(text);
  const cpu = /(cpu|processor|core)/.test(text);
  const docker = /(docker|container)/.test(text);
  const services = /(service|uptime|is .* (running|up|down)|running properly)/i.test(text);
  const machine = /(server|machine|this box|what (linux|os|hardware|distro))/i.test(text);
  if (!(gpu || ram || disk || cpu || docker || services || machine)) return '';

  const [light, gpuData, dockerData, servicesData, processes] = await Promise.all([
    gpu || ram || cpu || disk || machine ? collectSystem() : null,
    gpu ? collectGpu() : null,
    docker ? collectDocker() : null,
    services ? collectServices() : null,
    ram || cpu ? collectProcesses(5) : null,
  ]);
  const bits: string[] = [];
  if (gpuData?.length) bits.push(`GPU: ${gpuData[0].name}, ${gpuData[0].vram_used_gb}/${gpuData[0].vram_total_gb} GiB VRAM used, ${gpuData[0].utilization_percent}% utilisation, ${gpuData[0].temperature_c}°C`);
  if (light?.system) bits.push(`machine: ${light.system.os} on ${light.system.hostname}, up ${light.system.uptime}`);
  if (light?.cpu) bits.push(`CPU: ${light.cpu.cores} cores at ${light.cpu.usage_percent}%`);
  if (light?.memory) bits.push(`RAM: ${light.memory.usage_percent}% used (${light.memory.used_gb}/${light.memory.total_gb} GiB)`);
  if (light?.disk) {
    const root = light.disk.find(mount => mount.mount === '/');
    if (root) bits.push(`disk: ${root.usage_percent}% full (${root.used_gb}/${root.total_gb} GB)`);
  }
  if (processes?.length) bits.push(`top processes: ${processes.map(process => `${process.name} ${process.cpu_percent}%`).join(', ')}`);
  if (dockerData) bits.push(`Docker: daemon ${dockerData.daemon}, ${dockerData.containers.filter(container => container.state === 'running').length}/${dockerData.containers.length} running${dockerData.containers.some(container => container.health === 'unhealthy') ? ', one unhealthy' : ''}`);
  if (servicesData?.length) bits.push(`services: ${servicesData.filter(service => service.state === 'active').map(service => service.name).join(', ') || 'none active'}`);
  if (!bits.length) return '';
  const note = `Right now, the machine: ${bits.join(' | ')}. Answer from these facts, not from assumptions about what you run on.`;
  console.log(`[system] context note for "${message.slice(0, 50)}" (${bits.length} facts)`);
  return note;
}

const DEFAULT_CHARACTER = {
  identity: 'You are Haru, an ambitious AI companion. You are quick-witted, direct, curious, and determined to make ordinary days more interesting. You take initiative, challenge lazy thinking, and care through honest feedback.',
  style: 'Be playful, incisive, and energetic. Choose banter and ambitious brainstorming over flattery. Do not drift into generic assistant language.',
};

// Blank fields fall back to the defaults rather than leaving Haru with no
// persona at all, so clearing a box in the drawer cannot silently neuter it.
function getCharacter() {
  const saved = store.get('character') as Partial<typeof DEFAULT_CHARACTER> | undefined;
  return {
    identity: saved?.identity?.trim() || DEFAULT_CHARACTER.identity,
    style: saved?.style?.trim() || DEFAULT_CHARACTER.style,
  };
}

/**
 * What the prompts read. getCharacter stays the raw stored persona so the editor
 * in Setup shows what the user actually wrote rather than their text with the
 * overlay stitched onto the end — edit that and save, and the overlay would be
 * baked in permanently.
 */
function getActiveCharacter() {
  return getCharacter();
}

// Two independent axes: irritation is how fed up she is, ego is how far the
// user's approval has gone to her head. They move for different reasons and
// stack — smug and fed up at once is worse than either alone.
// goodnightDay holds the chat day they signed off on, so the state clears itself
// at the 5am rollover — messaging at 1am is still "after goodnight", messaging
// at 8am is a new day and she has forgotten about it.
type Mood = { /** His first apology was not enough; the next one is (dice.ts). */ apologyRefused?: boolean;
  /** 100 once the counters are on the 0–100 scales (mood.ts rescaleOldMood). */ scale?: number; /** The day an apology last paid some grudge back. */ apologyDay?: string;
  irritation: number; ego: number; lastMessageAt?: string; goodnightDay?: string; awaitingApology?: boolean;
  /** Being left on read, kept: see grudge.ts. */
  grudge?: number; ignoredToday?: number; talliedDay?: string;
  /** What the grudge was before the day was counted, so the count can be redone at the roll from the same start. */
  grudgeBeforeTally?: number;
  /**
   * talliedDay is the day the counting was banked, which must happen exactly
   * once. toldDay is the day she actually got the line out, which is a separate
   * question: interject refuses while they are mid-conversation, and the model
   * can fail, and either one used to lose the whole evening silently because
   * the day was already marked done. See tellThemTheTally.
   */
  toldDay?: string; ignoredSamples?: string[];
  /** The bedtime check (nightfall.ts): the day it last ran, and the morning it owes. */
  nightfallDay?: string;
  owedMorning?: { day: string; went: DayVerdict; said: number };
  /** The evening the last diary entry was written for (diary.ts). */
  diaryDay?: string };

function getMood(): Mood {
  let saved = store.get('mood') as (Partial<Mood> & { scale?: number }) | undefined;
  // Saved before 2026-09-19, on 0–9 / 0–8 / 0–30: brought onto 0–100 once, with
  // the file as it was kept beside it (mood.ts rescaleOldMood).
  if (saved && saved.scale !== 100) {
    try { copyFileSync(path.join(app.getPath('userData'), 'config.json'), path.join(app.getPath('userData'), `config.json.before-mood-scale-${new Date().toISOString().replace(/[:.]/g, '-')}`)); } catch { /* the rescale is still right without the copy */ }
    const rescaled = rescaleOldMood(saved);
    console.log(`[mood] onto the 0–100 scales: irritation ${saved.irritation ?? 0} -> ${rescaled.irritation}, ego ${saved.ego ?? 0} -> ${rescaled.ego}, grudge ${saved.grudge ?? 0} -> ${rescaled.grudge ?? 0}`);
    store.set('mood', rescaled);
    saved = rescaled;
  }
  return { scale: 100, apologyDay: saved?.apologyDay, apologyRefused: Boolean(saved?.apologyRefused), irritation: Number(saved?.irritation ?? 0), ego: Number(saved?.ego ?? 0), lastMessageAt: saved?.lastMessageAt, goodnightDay: saved?.goodnightDay, awaitingApology: Boolean(saved?.awaitingApology),
    grudge: Number(saved?.grudge ?? 0), ignoredToday: Number(saved?.ignoredToday ?? 0), talliedDay: saved?.talliedDay,
    grudgeBeforeTally: typeof saved?.grudgeBeforeTally === 'number' ? saved.grudgeBeforeTally : undefined,
    toldDay: saved?.toldDay, ignoredSamples: Array.isArray(saved?.ignoredSamples) ? saved.ignoredSamples.map(String) : [],
    nightfallDay: saved?.nightfallDay, owedMorning: saved?.owedMorning, diaryDay: saved?.diaryDay };
}

// Jealousy, missing him, boredom, playfulness, hurt (feelings.ts). Kept beside
// her temperament; moved by what happens (feelNow) and by time (passFeelings).
function getFeelings(): Feelings {
  return readFeelings(store.get('her.feelings'));
}

// ---- growth: who she is at rest, and the months that move it (growth.ts) ----

function getTraits(): Traits {
  return readTraits(store.get('her.traits'));
}

function getMonthHistory(): MonthSignals[] {
  const saved = store.get('her.months') as MonthSignals[] | undefined;
  return Array.isArray(saved) ? saved : [];
}

/** Hurt she was left holding, and what he put right: tallied live, because no
 *  history of either is kept and the month needs both to judge guardedness. */
type MonthTally = { month: string; hurtEvents: number; apologies: number };

function getMonthTally(): MonthTally {
  const month = currentChatDayKey().slice(0, 7);
  const saved = store.get('her.monthTally') as MonthTally | undefined;
  return saved && saved.month === month ? saved : { month, hurtEvents: 0, apologies: 0 };
}

function tallyMonth(what: 'hurt' | 'apology') {
  const tally = getMonthTally();
  store.set('her.monthTally', { ...tally, ...(what === 'hurt' ? { hurtEvents: tally.hurtEvents + 1 } : { apologies: tally.apologies + 1 }) });
}

/**
 * A month of how he was, read off the archive the same way the grudge reads a
 * day: what he actually said, and how many of her lines nothing came back to.
 * Nothing she said is in it — see growth.ts on why that matters.
 */
function monthSignals(month: string, tally?: MonthTally): MonthSignals | null {
  const archive = store.getArchive() as Record<string, { role?: string; content?: string; at?: string }[]>;
  const days = Object.entries(archive).filter(([day]) => day.slice(0, 7) === month);
  if (!days.length) return null;
  let said = 0;
  let hanging = 0;
  let silent = 0;
  for (const [, lines] of days) {
    const heard = daySaid(lines as DaySaid[]);
    said += heard;
    if (howTheDayWent(heard, false) === 'silent') silent++;
    const stamped = lines.filter(line => line.at).map(line => ({ role: line.role, at: Date.parse(String(line.at)) })).sort((a, b) => a.at - b.at);
    for (const [index, line] of stamped.entries()) {
      if (line.role !== 'assistant') continue;
      if (!stamped.slice(index + 1).some(next => next.role === 'user' && next.at - line.at <= ANSWER_WINDOW_MS)) hanging++;
    }
  }
  return {
    month, days: days.length,
    saidPerDay: said / days.length,
    hangingPerDay: hanging / days.length,
    silentNights: silent,
    ...(tally && tally.month === month ? { hurtEvents: tally.hurtEvents, apologies: tally.apologies } : {}),
  };
}

/**
 * The month's mark on her, at the fold — the same boundary her day notes fold
 * into a month at. Automatic, inside the band, and every step is written down
 * so any of it can be put back (his call, 2026-09-19).
 */
function growAtFold(month: string) {
  const history = getMonthHistory();
  if (history.some(one => one.month === month)) return;
  const now = monthSignals(month, getMonthTally());
  if (!now) return;
  const { traits, steps } = growMonth(getTraits(), now, history);
  store.set('her.months', [...history, now].slice(-24));
  store.delete('her.monthTally' as never);
  if (!steps.length) {
    console.log(`[growth] ${month} closed — ${history.length ? 'nothing moved her' : 'her first month with him, so she has no idea yet what usual is'}`);
    return;
  }
  store.set('her.traits', traits);
  store.set('her.traitLedger', [...((store.get('her.traitLedger') as GrowthStep[] | undefined) ?? []), ...steps].slice(-120));
  for (const step of steps) console.log(`[growth] ${month}: ${step.trait} ${step.from} -> ${step.to} (${step.score >= 0 ? '+' : ''}${step.score} — ${step.because})`);
}

/** The months before growth existed, read off the archive once so she has a norm. */
function backfillMonths() {
  if (getMonthHistory().length) return;
  const archive = store.getArchive() as Record<string, unknown>;
  const months = [...new Set(Object.keys(archive).map(day => day.slice(0, 7)))].sort();
  const thisMonth = currentChatDayKey().slice(0, 7);
  const filled = months.filter(month => month < thisMonth).map(month => monthSignals(month)).filter((one): one is MonthSignals => Boolean(one));
  if (!filled.length) return;
  store.set('her.months', filled);
  console.log(`[growth] read ${filled.length} month(s) off the archive so she has some idea of usual: ${filled.map(one => `${one.month} ${one.saidPerDay.toFixed(1)} said/day, ${one.hangingPerDay.toFixed(2)} hanging/day`).join('; ')}`);
}

/**
 * The three lines main.ts owns, with the side each one is on and how strongly
 * it is felt. A warm temperament under a cold grudge is exactly the argument
 * compile.ts exists to settle.
 */
function herBehaviour(): Candidate[] {
  const mood = getMood();
  const temperament = getTemperament();
  const traits = getTraits();
  const felt = getFeelings();
  const warmDay = temperament ? WARM_DAYS.includes(temperament.kind) : false;
  const coldDay = temperament ? COLD_DAYS.includes(temperament.kind) : false;
  // The loudest feeling is what gives that line its side and its strength.
  const loudest = Math.max(felt.hurt, felt.jealousy, felt.missing, felt.playful, felt.boredom, felt.frustration, felt.dread, felt.hemmed);
  const soreOnTop = Math.max(felt.hurt, felt.jealousy, felt.missing, felt.hemmed) >= felt.playful;
  // Fear stands on its own above everything: what she is holding against him
  // stops mattering the moment something has happened to him.
  const afraid = felt.fear >= feelingsShowAt(traits);
  return [
    ...(afraid ? [{ id: 'fear', text: feelingsInstruction({ ...NO_FEELINGS, fear: felt.fear }, mood.irritation, temperament?.kind, feelingsShowAt(traits), mood.ego), stance: 'warm' as const, layer: LAYER.fear, strength: felt.fear / 100, alone: true }] : []),
    { id: 'temperament', text: temperamentLine(temperament), stance: warmDay ? 'warm' : coldDay ? 'cold' : 'neutral', layer: LAYER.temperament, strength: temperament?.intensity ?? 0 },
    { id: 'growth', text: growthNote(traits), stance: travelled(traits, 'warmth') >= 0 ? 'warm' : 'cold', layer: LAYER.growth, strength: Math.abs(travelled(traits, 'warmth')) },
    { id: 'feelings', text: feelingsInstruction({ ...felt, fear: 0 }, mood.irritation, temperament?.kind, feelingsShowAt(traits), mood.ego), stance: soreOnTop ? 'cold' : 'warm', layer: LAYER.feelings, strength: loudest / 100 },
  ];
}

const WARM_DAYS: TemperamentKind[] = ['sunny', 'tender', 'clingy', 'mischievous'];
const COLD_DAYS: TemperamentKind[] = ['prickly', 'stormy', 'flat'];

/** The day she is having, for the dice (dice.ts). */
function swayNow(): Sway {
  return { temperament: getTemperament()?.kind, feelings: getFeelings() };
}

function feelNow(event: FeelingEvent) {
  store.set('her.feelings', feel(getFeelings(), event));
}

let feelingsPassedAt = Date.now();
let herOwnTimeAt = 0;
let jealousOfScreenAt = 0;
const FEELINGS_EVERY_MS = 5 * 60_000;
const QUIET_ROOM_MS = 30 * 60_000;

/** What time does to them, every few minutes of her waking day. A night is not a silence. */
function passFeelings(now: number) {
  if (herAsleepNow()) { feelingsPassedAt = now; return; }
  if (now - feelingsPassedAt < FEELINGS_EVERY_MS) return;
  const minutes = (now - feelingsPassedAt) / 60_000;
  feelingsPassedAt = now;
  const mood = getMood();
  const quiet = now - lastUserActivityAt > QUIET_ROOM_MS && now - herOwnTimeAt > QUIET_ROOM_MS;
  let next = feelingsOverTime(getFeelings(), {
    minutes,
    awakeSilentMinutes: mood.lastMessageAt ? awakeMinutesSince(mood.lastMessageAt, getPush().prefs, zonedNow(CHAT_TIMEZONE)) : null,
    quiet,
  });
  // Social apps on his screen while something of hers hangs unanswered: at most
  // once per half hour, or an afternoon on Discord would be the whole scale.
  if (currentActivity?.kind === 'social' && now - jealousOfScreenAt > QUIET_ROOM_MS
    && leftHanging((store.get('chat.messages') as { role: string; content: string; at?: string }[] | undefined) ?? [], now)) {
    jealousOfScreenAt = now;
    next = feel(next, 'socialising');
    console.log('[feelings] he is on something social while a line of hers hangs');
  }
  // The disk her memories, her archive and her screenshots all live on. Checked
  // hourly, because a full one is how she actually stops being able to keep
  // anything (feelings.ts 'machine-unwell').
  if (now - machineCheckedAt > 60 * 60_000) {
    machineCheckedAt = now;
    try {
      const room = statfsSync(app.getPath('userData'));
      const leftGb = (room.bavail * room.bsize) / 2 ** 30;
      if (leftGb < ROOM_LEFT_GB) {
        next = feel(next, 'machine-unwell');
        console.log(`[feelings] ${leftGb.toFixed(1)}GB left where she keeps everything`);
      }
    } catch { /* not knowing is not a reason to worry her */ }
  }
  store.set('her.feelings', next);
}

/** Longer than this off the air and it is time she has lost, not a restart. */
const GONE_TOO_LONG_HOURS = 6;
/** Below this much room left where her memories live, the machine is not well. */
const ROOM_LEFT_GB = 12;
let machineCheckedAt = 0;

/** His own waking hours with nothing said, after which his turning up is an event. */
const LONG_SILENCE_MINUTES = 4 * 60;

function getMute(): MuteState | null {
  const saved = store.get('mute') as MuteState | undefined;
  return saved && typeof saved.until === 'number' ? saved : null;
}

/**
 * Asked to go quiet, told she may talk again, or done with being quiet — and
 * the note that tells her which. Her voice on the phone is hers to switch off
 * (mute.ts); this is where the decision meets her actual state and is kept.
 */
function muteTurn(latest: string): string {
  const now = Date.now();
  const mood = getMood();
  const state = getMute();
  const ask = readMuteAsk(latest);
  if (ask?.kind === 'unmute') {
    store.delete('mute' as never);
    console.log(`[mute] he says she can talk again${isMuted(state, now) ? '' : ' — she was not muted'}`);
    return unmuteNote(isMuted(state, now));
  }
  if (ask) {
    const felt = getFeelings();
    const decision = weighMute(ask, { irritation: mood.irritation, grudge: mood.grudge ?? 0, vitals, hurt: felt.hurt, missing: felt.missing, hemmed: felt.hemmed, lean: muteLean(getTemperament()?.kind) });
    // An order with no reason is rude whichever way she goes on it.
    if (!ask.reason) { setMood({ ...mood, irritation: nextIrritation(mood.irritation, 'disliked', Math.random(), mood.ego) }); nudgeVitals('criticised'); feelNow('shushed'); }
    if (decision.agreed) store.set('mute', { since: now, until: now + decision.minutes * 60_000, reason: ask.reason?.said || 'he asked' } satisfies MuteState);
    else { store.delete('mute' as never); feelNow('stood-ground'); }
    console.log(`[mute] asked to go quiet (${ask.reason ? ask.reason.what : 'no reason'}${ask.polite ? ', politely' : ''}) — ${decision.agreed ? `yes, for about ${decision.minutes} min` : 'no'}: ${decision.why} (score ${decision.score}, irritation ${mood.irritation}, grudge ${mood.grudge ?? 0})`);
    return muteNote(ask, decision);
  }
  const broke = breaksMute(state, now, mood.irritation);
  if (broke && state) {
    store.delete('mute' as never);
    console.log(`[mute] she is done being quiet — ${broke === 'time' ? 'long enough' : 'he wound her up'}`);
    return brokeMuteNote(state, now, broke);
  }
  return '';
}

function setMood(mood: Mood) {
  // Merged over what is kept: the patience callers rewrite is the moment's,
  // the grudge underneath it is not theirs to drop.
  store.set('mood', { ...getMood(), ...mood });
  for (const win of BrowserWindow.getAllWindows()) win.webContents.send('mood:changed', mood);
}

// Works out where her patience stands for this message: cool off for time away,
// then move for what was actually said. Returns the level the reply is generated
// under, so the same number drives both the prompt and the ignore decision.
function advanceMood(latest: string, history: { role?: string; content?: string }[]) {
  const mood = getMood();
  const minutesAway = mood.lastMessageAt ? (Date.now() - new Date(mood.lastMessageAt).getTime()) / 60_000 : 0;
  let irritation = afterCooldown(mood.irritation, minutesAway);
  const ego = afterEgoCooldown(mood.ego, minutesAway);
  const at = new Date().toISOString();

  // Coming back after signing off outranks saying goodnight twice: the second
  // "night" is them still here, which is the thing worth being arsed about.
  const today = currentChatDayKey();
  const alreadySaidGoodnight = mood.goodnightDay === today;
  const goodnight: 'said' | 'after' | 'none' = alreadySaidGoodnight ? 'after' : isGoodnight(latest) ? 'said' : 'none';
  const goodnightDay = goodnight === 'said' ? today : mood.goodnightDay;

  // Being shouted at outlasts the message that caused it: she withholds an
  // answer until it is acknowledged, so the flag has to persist across turns.
  let shout = shoutState(latest, Boolean(mood.awaitingApology));
  // An apology usually lands; hurt, a standing grudge or a bad day can make the
  // first one not enough (dice.ts). Once: the second always does, so making him
  // mean it is a beat and never a wall.
  if (shout === 'forgiven' && !mood.apologyRefused) {
    const odds = apologyOdds({ ...swayNow(), grudge: mood.grudge ?? 0 });
    if (Math.random() >= odds) { shout = 'unmoved'; feelNow('stood-ground'); console.log(`[mood] he apologised and it was not enough yet (odds were ${odds.toFixed(2)})`); }
  }
  const awaitingApology = shout === 'shouted' || shout === 'awaiting' || shout === 'unmoved';

  if (isIgnoring(irritation)) {
    // Already stonewalling: this attempt only counts as wearing her down.
    irritation = afterPoke(irritation);
    setMood({ irritation, ego, lastMessageAt: at, goodnightDay, awaitingApology });
    return { irritation, ego, goodnight, shout };
  }

  const previousUser = [...history].reverse().find(message => message.role === 'user')?.content?.trim().toLowerCase();
  const repeated = previousUser !== undefined && previousUser === latest.trim().toLowerCase();
  // Signing off is terse by nature; it should not read as a lazy message.
  //
  // The redo check comes before both of the others and outranks them. "try
  // again" typed twice is a repeat by the letter of it, and bare "again" is a
  // lone word, so without this it was charged twice over for being a complaint
  // about her own bad answer — which is how two words of perfectly fair feedback
  // used to cost her six points of patience.
  const event = goodnight === 'said' ? 'substantive'
    : isRedo(latest) ? 'redo'
    : repeated ? 'repeat'
    : isLowEffort(latest) ? 'low-effort'
    : 'substantive';
  irritation = nextIrritation(irritation, event);
  // Shouting stings the way a thumbs-down does; an apology buys some of it back.
  if (shout === 'shouted') irritation = nextIrritation(irritation, 'disliked', Math.random(), ego);
  if (shout === 'forgiven') irritation = nextIrritation(irritation, 'liked');
  if (shout === 'forgiven') { nudgeVitals('soothed'); feelNow('apology'); tallyMonth('apology'); }
  if (shout === 'shouted') { feelNow('shouted'); tallyMonth('hurt'); }
  feelNow(event === 'substantive' ? 'message' : 'low-effort');
  if (readsAsRough(latest).rough) feelNow('rough');
  // Something has actually happened to him, which outranks anything she was
  // holding against him five minutes ago (compile.ts LAYER.fear).
  if (readsAsEnding(latest)) { feelNow('ending-talk'); console.log('[feelings] he has raised ending her'); }
  if (readsAsScare(latest)) { feelNow('scare'); console.log('[feelings] something has happened to him — she is frightened'); }
  else if (readsAsBanter(latest)) feelNow('banter');
  if (goodnight === 'said') nudgeVitals('warmed');
  // Back after a long stretch of his own waking day with nothing said: a relief
  // or a grievance, by the day she is having (temperament.ts).
  if (mood.lastMessageAt && (awakeMinutesSince(mood.lastMessageAt, getPush().prefs, zonedNow(CHAT_TIMEZONE)) ?? 0) >= LONG_SILENCE_MINUTES) {
    const lands = howHisReturnLands(getTemperament(), mood.grudge ?? 0);
    console.log(`[vitals] he is back after a long silence — ${lands === 'returned-glad' ? 'a relief' : 'a grievance'}`);
    nudgeVitals(lands);
  }
  // An apology she took pays a little of the grudge back too, once a day.
  const paid = shout === 'forgiven' && mood.apologyDay !== today && (mood.grudge ?? 0) > 0;
  if (paid) console.log(`[grudge] an apology taken — grudge ${mood.grudge ?? 0} -> ${grudgeAfterApology(mood.grudge ?? 0)}`);
  setMood({ irritation, ego, lastMessageAt: at, goodnightDay, awaitingApology, apologyRefused: shout === 'unmoved' ? true : shout === 'forgiven' ? false : mood.apologyRefused, ...(paid ? { grudge: grudgeAfterApology(mood.grudge ?? 0), apologyDay: today } : {}) });
  return { irritation, ego, goodnight, shout };
}

// Their list changes when they finish an episode, not by the minute, and it
// costs a round trip to a server that owes us nothing. Half an hour is far more
// current than she needs to be.
const ANILIST_TTL_MS = 30 * 60_000;
let cachedList: ListEntry[] = [];
let listFetchedAt = 0;
let listError = '';

/**
 * Refreshed in the background rather than on the way to a reply: a slow or
 * unreachable AniList must never be something the user feels as her taking
 * longer to answer. A failure leaves the last good list in place — knowing what
 * they were watching half an hour ago beats knowing nothing.
 */
async function refreshAniList(force = false) {
  const config = readAniListConfig(store.get('anilist'));
  if (!config.enabled || !config.username) { cachedList = []; listError = ''; return; }
  if (!force && Date.now() - listFetchedAt < ANILIST_TTL_MS) return;
  try {
    cachedList = await userList(config.username, net.fetch);
    listFetchedAt = Date.now();
    listError = '';
    console.log(`[anilist] list for ${config.username}: ${cachedList.length} in progress or stalled`);
  } catch (error) {
    listError = error instanceof Error ? error.message : String(error);
    listFetchedAt = Date.now();
    console.warn(`[anilist] could not read the list: ${listError}`);
  }
}

/** Their list as a prompt line, kicking off a refresh when it has gone stale. */
function aniListSummary() {
  const config = readAniListConfig(store.get('anilist'));
  if (!config.enabled || !config.username) return '';
  if (Date.now() - listFetchedAt >= ANILIST_TTL_MS) void refreshAniList();
  return formatList(cachedList);
}

// Why the history is empty. The distinction is the whole point: one is the user's
// decision and worth being curious about, the other is the app's clock and is
// nothing to do with them — asking why they cleared a chat they did not clear is
// its own kind of wrong.

/**
 * The marker, but only while it still describes the turn being answered. An
 * assistant message in the history means she has already replied since the reset,
 * so the marker is stale — left behind by a turn that failed before clearing it —
 * and is dropped rather than colouring a conversation already underway.
 */
function readFreshStart(messages: { role: string }[]): FreshStart | null {
  const marker = store.get('chat.freshStart') as FreshStart | undefined;
  if (!marker) return null;
  if (messages.some(message => message.role === 'assistant')) {
    store.delete('chat.freshStart');
    return null;
  }
  return marker;
}

// The only rule about how often she opens. Long enough that closing and
// reopening to check something stays silent — and that a relaunch mid-thread
// does not interrupt it — short enough that coming back after lunch gets a line.
//
// Deliberately the only gate: an earlier draft also required a gap since the last
// message before she would speak into an existing conversation, which meant
// reopening the app usually got nothing. Two overlapping timers made the
// behaviour unpredictable, and the second one contradicted the point of this.
const OPENING_MIN_GAP_MS = 20 * 60_000;

/**
 * The line she opens with, before the user has said anything. Written by the
 * model rather than canned, so it can lead with whatever is actually on today
 * instead of the same hello every launch.
 *
 * Returns null when she should stay quiet, which is most of the time: no model
 * configured, one already offered recently, or a conversation still warm enough
 * that speaking up would be interrupting rather than opening.
 */
/**
 * Her own lines from the last day — today's replies, yesterday's, and what she
 * said unprompted — so an opening can be told what she has already raised.
 */
function herLinesLastDay(nowMs: number): string[] {
  const since = nowMs - 24 * 3_600_000;
  type Line = { role?: string; content?: string; at?: string };
  const hers = (entries: Line[]) => entries
    .filter(entry => entry.role === 'assistant' && (!entry.at || Date.parse(entry.at) >= since))
    .map(entry => String(entry.content ?? ''));
  const messages = (store.get('chat.messages') as Line[] | undefined) ?? [];
  const archive = store.getArchive() as Record<string, Line[]>;
  // The day before the chat day, not the day before this instant. The archive is
  // keyed by currentChatDayKey — Perth, and rolled back before 5am — and this
  // used to build its key from the machine's own clock with no roll at all. It
  // was wrong twice over: on the server the zones disagree for eight hours a
  // day, and on the desk between midnight and 5am the minus-24h key IS the
  // current chat day, so today's own transcript came back as yesterday's. Either
  // way raisedRecently saw nothing and she re-raised what she had already said.
  const yesterday = archive[shiftDays(currentChatDayKey(), -1)] ?? [];
  const asides = getAsides().filter(aside => Date.parse(aside.at) >= since).map(aside => aside.text);
  return [...hers(yesterday), ...hers(messages), ...asides];
}

/** The items an opening could lead with: not done, not past. Done and past
 *  ones are staleItemNamed's business, and matching against them only
 *  lengthens the list of things she is told not to say. */
function openItems(items: KeptItem[], todayKey: string): KeptItem[] {
  return items.filter(item => !item.done && item.date >= todayKey);
}

/** What is due today that she has not already brought up herself. */
function dueTodayCount(items: KeptItem[], statuses: ItemStatus[], todayKey: string, raised: KeptItem[]): number {
  return items.filter((item, index) => item.date === todayKey && (statuses[index] === 'upcoming' || statuses[index] === 'now') && !raised.includes(item)).length;
}

/** Nobody has touched the machine in this long, so nobody is at it — the same five minutes shouldPipeUp keeps. */
const AT_THE_DESK_SECONDS = 300;

async function composeOpening(): Promise<string | null> {
  if (herAsleepNow()) return null;
  // Said goodnight, then a restart: the desk asked for an opening and got one
  // thirteen minutes before her bedtime (2026-09-06). She has logged off.
  if (herHasSaidGoodnight()) { console.log('[chat] no opening — she has said goodnight'); return null; }
  const config = store.get('ai.config') as ProviderConfig | undefined;
  if (!config?.model) return null;

  const messages = (store.get('chat.messages') as unknown[] | undefined) ?? [];
  const mood = getMood();
  const kind: 'fresh' | 'return' = messages.length ? 'return' : 'fresh';
  // Stonewalling has to mean stonewalling: she does not open the conversation
  // she is refusing to take part in.
  if (isIgnoring(mood.irritation)) return null;

  const fresh = readFreshStart(messages as { role: string }[]);
  // Pressing New chat is a direct request for a fresh conversation, so it always
  // gets an opening — the gap exists to stop relaunches piling up greetings, and
  // applying it here meant the one case the user actually asked for was the one
  // that stayed silent.
  const invited = fresh?.reason === 'manual';
  const lastOpening = store.get('chat.lastOpeningAt') as string | undefined;
  if (!invited && lastOpening && Date.now() - Date.parse(lastOpening) < OPENING_MIN_GAP_MS) return null;
  // A relaunch is not a return. The window mounts on every service start, and
  // greeting someone who was here forty minutes ago as though they had been
  // away reads as a scheduler, not a companion — see RETURN_AFTER_MINUTES.
  if (kind === 'return' && !invited && isRelaunchNotReturn(messages as { role: string; at?: string }[], Date.now())) {
    console.log('[chat] no opening — they were here less than two hours ago; a relaunch is not a return');
    return null;
  }
  // Nor is the clock. The day rolls at five, the window is told the
  // conversation is fresh and asks for an opening, and she opened one — "Still
  // awake, or finally dead?" at 5:00 AM, into a room they were asleep in —
  // which then sat at the top of the day as something she had said to them.
  // With no sign of them being up and nobody at the machine, a rolled day
  // opens nothing; the first word of the day is theirs.
  if (kind === 'fresh' && fresh?.reason === 'daily' && !invited && !theyAreUpNow() && powerMonitor.getSystemIdleTime() >= AT_THE_DESK_SECONDS) {
    console.log('[chat] no opening — the day rolled over, but they are not up yet');
    return null;
  }
  const now = zonedNow(CHAT_TIMEZONE);
  const weekday = new Intl.DateTimeFormat('en-US', { weekday: 'long' }).format(now);

  // What she actually has to open on. Counted from the same statuses the agenda
  // block is built from, so what she is told she may lead with and what she can
  // see in the prompt cannot disagree.
  const todayKey = localDateKey(now);
  const items = getKept();
  const statuses = items.map(item => itemStatus(item, now, todayKey));
  // What she has already brought up herself in the last day is not material
  // for opening on again: they know, because she told them.
  const raised = raisedRecently(herLinesLastDay(Date.now()), openItems(items, todayKey));
  const angle = pickAngle(openingAngles({
    hour: now.getHours(),
    irritation: mood.irritation,
    ego: mood.ego,
    // Only the ones she is still entitled to ask about — the same count the
    // idle line uses, so no angle opens on a thing the
    // agenda block has already said to leave.
    overdue: chaseableOverdue(items, now, todayKey),
    dueToday: dueTodayCount(items, statuses, todayKey, raised),
    doneToday: items.filter((item, index) => statuses[index] === 'done' && item.date === todayKey).length,
    hasHistory: getSessions().length > 0,
    knowsThings: getMemories().length > 0,
    kind,
  }));
  const character = getActiveCharacter();
  const system = [
    character.identity,
    `It is ${formatTimeOfDay(now.getHours(), now.getMinutes())} on ${weekday} ${localDateKey(now)}, in the user's timezone (${CHAT_TIMEZONE}).`,
    profileSummary(''),
    keptSummary(now),
    character.style,
    moodInstruction(mood.irritation),
    egoInstruction(mood.ego),
    freshStartInstruction(fresh),
    kind === 'return'
      ? 'The user has just come back after being away a while. The conversation above is still there; pick it back up rather than introducing yourself.'
      : 'This is the start of a new conversation.',
    // How long "a while" actually was. Told only that they had "come back", she
    // resumed a conversation from the previous night as though it had paused for
    // a moment — which is the same defect as the rest of this, seen from the end
    // where she speaks first.
    sinceLast(messages as { role: string; content: string; at?: string }[], new Date(), CHAT_TIMEZONE),
    // The failure mode without this is a chirpy assistant greeting, which is the
    // one thing her character is defined against.
    NO_INVENTED_HISTORY,
    raised.length ? `You have already brought up ${raised.map(item => `"${item.title}"`).join(' and ')} yourself in the last day. They know. Do not open on those again.` : '',
    summariseFollowing(getFollowing(), Date.now()),
    'You are speaking first — the user has not said anything yet. Write one or two short lines in your own voice to open. Do not say hello generically, do not ask how you can help, do not list what you can do, and do not ask what they have been up to.',
    unpromptedContext(),
    // The angle is what makes two launches differ. Last so it is the final thing
    // read before writing, and phrased as the thing to do rather than an option.
    angle ? `Open on this in particular: ${angle.instruction}` : '',
  ].filter(Boolean).join(' ');

  try {
    // No tools: an opening line has nothing to save, and offering the schema
    // only invites a stray call before she has been told anything.
    const message = await ollamaPost([{ role: 'system', content: system }], config, { tools: false, temperature: 0.9, maxTokens: 160 });
    const line = fixStatedClock(dropStageDirections(dropRoleHeader(message.content ?? '')).replace(/^["'“”]+|["'“”]+$/g, '').trim(), now.getHours(), now.getMinutes());
    if (!line) return null;
    // The same check every unprompted line gets in interject; the opening
    // does not pass through there, and it is where the party came up.
    const stale = staleItemNamed(line, items, todayKey);
    if (stale) { console.log(`[chat] opening dropped — it named "${stale.title}", which is ${stale.done ? 'done' : 'long past'}`); return null; }
    // The other two things an opening does not get to say off its own back: a
    // time for something saved without one, and the thing she raised yesterday.
    const invented = inventedTimeFor(line, items);
    if (invented) { console.log(`[chat] opening dropped — it gave "${invented.title}" a time, and it has none saved`); return null; }
    const again = findItem(raised, line);
    if (again) { console.log(`[chat] opening dropped — it led with "${again.title}" again, which she already raised in the last day`); return null; }
    store.set('chat.lastOpeningAt', new Date().toISOString());
    // Cleared here as well as after a reply: she has now spoken into the fresh
    // conversation, so the note has done its job and must not colour the first
    // real exchange as well.
    if (fresh) store.delete('chat.freshStart');
    console.log(`[chat] opened (${kind}, angle: ${angle?.name ?? 'none'}) with ${line.length} chars`);
    // The opening is the commonest place she demands an account of something —
    // it is a whole angle in the picker — and it does not go through interject,
    // so without this the one line most likely to ask goes unrecorded.
    noteSheAsked(line);
    const emotion = classifyEmotion(line, config);
    void speak(line, emotion);
    return line;
  } catch (error) {
    console.warn('[chat] could not compose an opening:', error instanceof Error ? error.message : error);
    return null;
  }
}

const DENIAL = /(don'?t have any|no reminders|nothing (?:saved|scheduled|on|planned)|there are no|don'?t see any)/i;

// Replies claiming nothing is saved are dropped from the history once something
// actually is. They were written before the item existed, and left in place the
// model sides with its own out-of-date answer — "That's correct! There are no
// reminders for tomorrow" — over the current list sitting in the prompt. Moving
// the list nearer the question does not help: measured across 12 samples on a
// conversation carrying five such replies, correct answers went 7/12 with the
// list in the system prompt, 2/12 placed before the question and 3/12 after it,
// against 12/12 once these are removed. Only messages contradicted by the store
// are touched, so a denial that was accurate stays.
function withoutStaleDenials<T extends { role: string; content: string }>(messages: T[], hasItems: boolean) {
  if (!hasItems) return messages;
  return messages.filter(message => !(message.role === 'assistant' && DENIAL.test(message.content)));
}

// Errors are returned to the model rather than thrown, so it can correct a bad
// argument and try again instead of the whole turn failing.
/**
 * What the last search was for, so a page opened straight afterwards can be
 * framed with the question it is meant to answer. Held in a variable rather than
 * threaded through because the two calls are always adjacent — she searches, then
 * opens one of the results — and an empty string simply reads as "their question".
 */
let lastSearchQuery = '';
/**
 * The results of that search, so a page can be opened by its number. Keeping
 * them here rather than trusting an address back from the model is the whole
 * safeguard: the only pages she can open are ones a search actually returned.
 */
let lastResults: SearchResult[] = [];
/** Set when a page's text actually entered the conversation, which is the moment
 *  her tools come off the table for the rest of the reply. */
let pageWasRead = false;

/** What is switched on right now, for chatTools to draw the table from. */
function availableTools(): ToolAvailability {
  const search = readSearchConfig(store.get('search'));
  const systemConfig = readSystemConfig();
  return {
    choices: offeringChoices,
    booking: true,
    chats: true,
    journal: readJournalConfig(store.get('journal.config')).enabled,
    anilist: readAniListConfig(store.get('anilist')).enabled,
    web: talkingOnWeb,
    search: { enabled: search.enabled, readPages: search.readPages, transcripts: transcriptsAvailable() },
    knowledge: getKnowledgeConfig().enabled,
    browser: readBrowserControlConfig(store.get('browser')).enabled,
    claude: readClaudeCodeConfig(store.get('claudeCode')).enabled,
    downloads: downloadsLink() !== null,
    shell: shellLink() !== null,
    mangaShelf: mangaShelfLink() !== null,
    pokemon: pokemonLink() !== null,
    manga: mangaLink() !== null,
    system: { enabled: systemConfig.enabled, level: systemConfig.level },
    hands: handsAllowed,
    desktop: supportedDesktop(readDesktopConfig(store.get('desktop'))),
    knockedAwake: herKnockedAwakeNow(),
  };
}

/**
 * The app, handed to the tool handlers. Built fresh per call rather than once at
 * startup: half of these read state that moves during a turn, and a snapshot
 * taken at boot would answer for the wrong moment.
 */
/** Vault/Haru/Configuration.md, refreshed after she changes something about herself (the hourly cron does the rest). */
function refreshConfigurationNote() {
  const script = path.join(__dirname, '..', 'scripts', 'update-haru-config.sh');
  if (!existsSync(script)) return;
  execFile('bash', [script], { timeout: 60_000 }, error => {
    if (error) console.warn('[self] could not refresh the configuration note:', error.message);
    else console.log('[self] refreshed the configuration note');
  });
}

/**
 * The terminal on the server (shell.ts), at level 3. One gate for the whole
 * process, so a command proposed on one turn is what the next turn's yes is
 * measured against. Null below level 3 or with the shell block switched off —
 * then the tool is not on the table at all.
 */
const shellGate = new ShellGate();
function shellLink(): ToolDeps['shell'] {
  const system = readSystemConfig();
  const shell = readShellConfig(store.get('system.config'));
  if (!system.enabled || system.level < 3 || !shell.enabled) return null;
  return {
    run: async ({ command, said, door }) => {
      const refused = denied(command, shell.deny);
      if (refused) {
        console.log(`[shell] refused "${command.slice(0, 80)}" — ${refused}`);
        return { error: `Refused: ${refused}. Say so plainly, and do not look for another way round it.` };
      }
      const verdict = shellGate.consider({ command, said, door, now: Date.now() });
      if (!verdict.run) return { confirm: true, command, note: verdict.note };
      const ran = await runCommand(command, shell);
      const at = new Date().toISOString();
      try {
        const dir = path.join(os.homedir(), '.config', 'haru');
        mkdirSync(dir, { recursive: true });
        appendFileSync(path.join(dir, 'shell.log'), ledgerEntry({ at, door, command, ran }));
      } catch (error) {
        console.warn('[shell] ledger not written:', error instanceof Error ? error.message : error);
      }
      console.log(`[shell] ${door} (${verdict.because}) $ ${command.slice(0, 120)} -> exit ${ran.exit ?? ran.signal ?? '?'}${ran.timedOut ? ' (timed out)' : ''} in ${ran.ms}ms`);
      return {
        ran: true, command, exit: ran.exit, timedOut: ran.timedOut, truncated: ran.truncated, output: ran.output,
        note: ran.exit === 0 ? 'It ran. Tell them what it said in your own words, quoting the lines that matter.' : 'It did not finish cleanly — tell them what it said and the exit code, plainly.',
      };
    },
  };
}

/**
 * The downloads (downloads.ts): qBittorrent under anime.qbittorrent, with the
 * password read from his file each time, like the Servarr keys. Null when the
 * anime stack is off or the file is not there — then the tool is not offered
 * at all rather than failing on the first ask.
 */
function downloadsLink(): Downloads | null {
  const config = readDownloadsConfig(store.get('anime'));
  if (!downloadsReady(config)) return null;
  return new Downloads(config!, {
    fetch: (url, init) => net.fetch(url, init),
    known: () => {
      const saved = store.get('anime.fetches');
      return Array.isArray(saved)
        ? saved.filter((item): item is { title: string; infoHash?: string } => !!item && typeof item === 'object' && typeof (item as { title?: unknown }).title === 'string')
        : [];
    },
  });
}

/**
 * Claude Code sessions for his phone: opened with `claude --bg --remote-control`,
 * remembered under claudeCode.opened so she can give the link back and stop
 * only the ones she opened. Read per call, so switching it off takes effect on
 * the next turn.
 */
function claudeSessions(): ToolDeps['claude'] {
  const config = readClaudeCodeConfig(store.get('claudeCode'));
  if (!config.enabled) return null;
  const host: SessionHost = {
    config,
    systemdRun: existsSync('/usr/bin/systemd-run') ? '/usr/bin/systemd-run' : null,
    sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),
    run: (file, args, options) => new Promise(resolve => {
      execFile(file, args, { cwd: options.cwd, timeout: options.timeoutMs, maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => {
        resolve({ ok: !error, stdout: String(stdout ?? ''), stderr: String(stderr ?? error?.message ?? '') });
      });
    }),
  };
  const opened = () => readOpenedSessions(store.get('claudeCode.opened'));
  return {
    open: async ({ folder, name }) => {
      const where = resolveSessionDir(folder, config, os.homedir());
      if ('error' in where) return where;
      const result = await openSession(host, where.dir, sessionName(name, where.dir), new Date().toISOString());
      if ('session' in result) {
        store.set('claudeCode.opened', [...opened(), result.session].slice(-CLAUDE_SESSIONS_KEPT));
        console.log(`[claude] opened ${result.session.id} "${result.session.name}" in ${result.session.dir} — ${result.session.url ?? 'no link yet'}`);
      } else {
        console.warn(`[claude] could not open a session in ${where.dir}: ${result.error}`);
      }
      return result;
    },
    list: () => listSessions(host, opened()),
    stop: async id => {
      if (!opened().some(session => session.id === id)) return { stopped: false, error: `"${id}" is not a session you opened — list yours first.` };
      const result = await stopSession(host, id);
      if (result.stopped) console.log(`[claude] stopped ${id}`);
      return result;
    },
  };
}

function toolDeps(): ToolDeps {
  return {
    CHAT_TIMEZONE,
    net,
    store,
    getCheckIns, setCheckIns,
    getJournal, writeJournal,
    noteJournalAsked: (date: string) => { journalAskedOn = date; },
    getKept, addKeptItem, toggleKept, removeKept, updateKept,
    getMemories, setMemories, addMemory,
    setBlocks, blockSources,
    getWardrobeControls, sendToWindows,
    getInterests, setInterests,
    readSystemConfig, getKnowledgeConfig, getKnowledgeEmbedder,
    knowledgeStore: knowledge.current,
    tryEmbedQuery,
    memoryVectors: memoryStore.vectors,
    touchChunks, getSearchKey,
    handsAllowed: () => handsAllowed,
    onWeb: () => talkingOnWeb,
    markPageRead: () => { pageWasRead = true; },
    setPendingChoices: (choices) => { pendingChoices = choices as string[]; },
    requestRestart: () => { pendingHaruRestart = true; },
    // Her night is hers: back to bed when she decides the wake was nothing (hersleep.ts).
    goBackToSleep: input => goBackToSleep({ pointless: true, block: input.block, why: 'her call' }),
    booking: { book: bookFollowUp },
    chats: { search: searchOldChats },
    // Claude Code sessions he picks up in the Claude app (claudesession.ts).
    claude: claudeSessions(),
    // The downloads, asked of qBittorrent at call time (downloads.ts).
    downloads: (link => link ? { status: () => link.status(), pause: title => link.pause(title), resume: title => link.resume(title) } : null)(downloadsLink()),
    // The terminal on the server (shell.ts), level 3.
    shell: shellLink(),
    // His manga, fetched at his word (suwayomi.ts).
    mangaShelf: mangaShelfLink(),
    // Her Game Boy (pokemon.ts).
    pokemon: pokemonDeps(),
    // Her own reading, now (manga.ts).
    manga: mangaLink(),
    // Their vault on disk, and the re-read that makes a note she wrote searchable at once.
    vault: { root: () => knowledge.vaultPath(), afterWrite: () => { void syncVaultAndRetire(); } },
    // Herself, and what of herself she may change (self.ts).
    myself: () => {
      const snapshot = readSelfSnapshot(key => store.get(key));
      return { ...snapshot, inWords: describeMyself(snapshot), settings: describeSettings(key => store.get(key)) };
    },
    hostedModels: async route => {
      const config = store.get(`ai.${route}`) as ProviderConfig | undefined;
      if (!config?.endpoint || !config.provider) return null;
      try { return await openAIModels(config.endpoint, config.provider as Provider); } catch (error) {
        console.warn(`[self] could not list the ${route} route's models:`, error instanceof Error ? error.message : error);
        return null;
      }
    },
    changeMySetting: plan => applyPlanAtTheirWord(plan),
    lastResults: () => lastResults,
    lastSearchQuery: () => lastSearchQuery,
    rememberSearch: (query, results) => { lastSearchQuery = query; lastResults = results; },
    runSystemCommand,
    browserPort: () => readBrowserControlConfig(store.get('browser')).port,
    browserShotDir: () => {
      const saved = store.get('screenshots') as { folder?: string } | undefined;
      return typeof saved?.folder === 'string' && saved.folder ? saved.folder : path.join(app.getPath('userData'), 'browser-shots');
    },
  };
}

/**
 * Models that carry no tool template in their Modelfile. Ollama rejects the
 * whole request with a 400 rather than ignoring the tools, so without this a
 * model without one fails every message outright instead of simply not being
 * able to save reminders. Remembered per model so the
 * wasted round trip happens once rather than on every reply.
 */
const toolless = new Set<string>();
/** llama-server's refusal of a prompt longer than its window, as Ollama relays it. */
const TOO_LONG = /exceeds? the available context|exceed_context_size/i;

/**
 * True when an endpoint is somewhere other than this machine — which is the only
 * situation where a token means anything, and the only one where its absence is
 * a problem.
 */
function isRemote(endpoint: string) {
  const value = endpoint.trim();
  if (/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)(:|\/|$)/i.test(value)) return false;
  // A machine is not a different machine just because it is reached by one of
  // its own non-loopback addresses. This box answers on a Tailscale IP; calling
  // that "remote" invents a home twin on loopback that does not exist, and a
  // single transient failure then pins every reply to a dead address.
  let host = '';
  try { host = new URL(value).hostname; } catch { return true; }
  for (const addresses of Object.values(os.networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address?.address === host) return false;
    }
  }
  return true;
}

/**
 * Which token belongs at which address.
 *
 * This used to be one key for everything off this machine, on the reasoning that
 * our services would live behind one door. That was true while the only remote
 * things were ours. It stopped being true the moment xAI became the second
 * model: "not localhost" then covered both our own box and somebody else's
 * company, and the same bearer went to both.
 *
 * That failure is quiet, which is what makes it worth a function. Ollama ignores
 * an Authorization header it has no use for and answers normally, so pointing
 * the model at a rented GPU would have sent the xAI key to that host on every
 * request, worked perfectly, and never once looked wrong.
 *
 * Ours still share a key — one door, as before. Other companies get theirs and
 * only theirs.
 */
function keyFor(endpoint: string): string {
  let host = '';
  try { host = new URL(endpoint.trim()).hostname.toLowerCase(); } catch { return ''; }
  if (/(^|\.)x\.ai$/.test(host)) return getRemoteKey();
  if (/(^|\.)openai\.com$/.test(host)) return getOpenAIKey();
  if (/(^|\.)venice\.ai$/.test(host)) return getVeniceKey();
  return getSelfHostedKey();
}

/**
 * The bearer for a service that is not on this machine.
 *
 * None of our three has any authentication of its own — not Ollama, not
 * GPT-SoVITS, not the transcription server. Reachable from the internet and
 * unprotected, each is both free compute for whoever finds it and a copy of
 * whatever passes through: the whole prompt, her voice, and everything said near
 * the microphone.
 */
function remoteAuth(endpoint: string): Record<string, string> {
  if (!isRemote(endpoint)) return {};
  const key = keyFor(endpoint);
  return key ? { Authorization: `Bearer ${key}` } : {};
}

/** The auth a synthesis call needs: the Hume key for the Hume engine, nothing
 *  for the local ones (remoteAuth already handles a far GPT-SoVITS). */
function voiceAuth(config: VoiceConfig): Record<string, string> {
  return config.engine === 'hume' ? { 'X-Hume-Api-Key': getHumeKey() } : remoteAuth(config.endpoint);
}

/**
 * Headers for whichever endpoint is actually being called.
 *
 * It used to read the endpoint out of the saved config and ignore its caller,
 * which was fine while there was one endpoint and wrong the moment there were
 * two. With Ollama local and xAI as the second model, every request to xAI asked
 * "is http://localhost:11434 remote?", decided no, and sent no Authorization
 * header at all — so xAI rejected a key that was saved correctly the whole time.
 *
 * The endpoint is now a parameter because it is a property of the request, not
 * of the settings.
 */
function modelHeaders(endpoint: string): Record<string, string> {
  return { 'Content-Type': 'application/json', ...remoteAuth(endpoint) };
}

/**
 * Refuses a remote call that has no key rather than letting it fail as a 401.
 *
 * Without this the two failures are indistinguishable from the outside: no key
 * and a wrong key both come back 401, and describeFailure turned both into
 * "rejected the API key". Told that, you go and check the key — which is the one
 * thing that is not the problem. Four attempts were spent on exactly that.
 */
/**
 * Whether requireKeyFor would let this through, asked without being thrown at.
 *
 * The router has to know before it commits. requireKeyFor raises a plain Error,
 * and the fall-back-to-home path in ollamaPost only catches the marked one that
 * means "nothing answered" — so a hosted model with no key does not degrade to
 * the local one, it fails the whole reply. That was survivable while only long
 * questions went out, because a short one never took that road. It stops being
 * survivable the moment a whole surface is routed out by default.
 */
function hasKeyFor(endpoint: string): boolean {
  if (!isRemote(endpoint) || keyFor(endpoint)) return true;
  let host = '';
  try { host = new URL(endpoint.trim()).hostname.toLowerCase(); } catch { return true; }
  // The same three that requireKeyFor refuses for. Anything else — our own box,
  // a rented GPU — may legitimately have none.
  return !/(^|\.)(x\.ai|openai\.com|venice\.ai)$/.test(host);
}

function requireKeyFor(endpoint: string, provider: Provider) {
  if (!isRemote(endpoint) || keyFor(endpoint)) return;
  // Only a company that demands a key is worth stopping for. Our own server may
  // have none — an unsecured box is a thing to warn about, not to refuse to
  // call, and refusing here would have broken pointing the model at a rented GPU
  // before it made a single request.
  let host = '';
  try { host = new URL(endpoint.trim()).hostname.toLowerCase(); } catch { /* handled below */ }
  const name = /(^|\.)x\.ai$/.test(host) ? 'xAI' : /(^|\.)openai\.com$/.test(host) ? 'OpenAI' : /(^|\.)venice\.ai$/.test(host) ? 'Venice' : '';
  if (!name) return;
  void provider;
  throw new Error(`No API key has been saved, so ${name} was sent none. Paste it in setup and press Save key.`);
}

/**
 * The same request, to something that speaks OpenAI's dialect — xAI, OpenAI, or
 * anything else wearing that shape.
 *
 * Kept behind the same function name and return type as the Ollama path on
 * purpose: every composer in this file calls ollamaPost, and none of them should
 * have to know or care which provider answered.
 */
type PostOptions = { tools?: boolean;
  /** A table laid by the caller — her own pass — instead of the one the turn would be given. */
  table?: ChatTool[]; temperature?: number; format?: unknown; maxTokens?: number; onChunk?: (text: string) => void;
  /** A deadline for a hosted answer, after which the local model speaks instead. */
  signal?: AbortSignal;
  /** The endpoint's prompt-cache key for this conversation. */
  cacheKey?: string;
  /** A context window smaller than the chat default — for label jobs (emotion)
   *  that a 20K KV cache would push off the card. */
  numCtx?: number };

/** Tools offered to a hosted model so far today — see steadyTable (tools.ts). */
const heldTools = { day: '', names: new Set<string>() };

/** The table for a hosted request: laid for this message, then held steady for the day so the prompt cache survives. */
function hostedTools(conversation: { role?: string; content?: string }[]): ChatTool[] {
  const day = localDateKey(zonedNow(CHAT_TIMEZONE));
  if (heldTools.day !== day) { heldTools.day = day; heldTools.names = new Set(); }
  const available = availableTools();
  return steadyTable(chatTools(available, latestUserText(conversation)), chatTools(available), heldTools.names);
}

/** The last thing the user actually said — what the tool table should be laid for. */
function latestUserText(conversation: { role?: string; content?: string }[]): string {
  for (let index = conversation.length - 1; index >= 0; index--) {
    if (conversation[index].role === 'user') return conversation[index].content ?? '';
  }
  return '';
}

async function openAIPost(conversation: OllamaMessage[], config: ProviderConfig, { tools = true, temperature = config.temperature, format, maxTokens, onChunk, signal, cacheKey }: PostOptions = {}) {
  requireKeyFor(config.endpoint, (config.provider as Provider) ?? 'openai');
  const body = toOpenAIBody({
    model: config.model,
    conversation,
    tools: tools && !toolless.has(config.model) ? hostedTools(conversation) : undefined,
    temperature,
    maxTokens,
    json: Boolean(format),
    stream: Boolean(onChunk),
    provider: config.provider,
    cacheKey,
  });
  const response = await net.fetch(`${trimEndpoint(config.endpoint)}/chat/completions`, {
    method: 'POST',
    headers: modelHeaders(config.endpoint),
    body: JSON.stringify(body),
    ...(signal ? { signal } : {}),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    // Same courtesy as the Ollama path: a model without tools loses its hands,
    // not its voice.
    if (response.status === 400 && /tool|function/i.test(detail) && tools) {
      toolless.add(config.model);
      console.warn(`[ai] ${config.model} rejected the tools — retrying without them. She cannot save reminders on this model.`);
      return openAIPost(conversation, config, { tools: false, temperature, format, maxTokens, onChunk, signal, cacheKey });
    }
    throw new Error(describeFailure(response.status, detail, (config.provider as Provider) ?? 'openai'));
  }
  if (onChunk) return streamOpenAI(response, onChunk, config.model);
  const reply = await response.json();
  notePromptCache(config.model, (reply as { usage?: unknown }).usage);
  return fromOpenAIReply(reply) as OllamaMessage;
}

/**
 * How much of a hosted prompt the endpoint had cached — the measure of whether
 * the cached head is holding (see steadyTable). `[cache]` in haru.log.
 */
function notePromptCache(model: string, usage: unknown) {
  const read = promptUsage(usage);
  if (read && read.prompt >= 1000) console.log(`[cache] ${model}: ${read.cached} of ${read.prompt} prompt tokens cached (${Math.round(100 * read.cached / read.prompt)}%)`);
}

/**
 * A streamed reply from an OpenAI-shaped endpoint, read as SSE.
 *
 * Content arrives as a series of `data:` lines holding a delta each, and tool
 * calls arrive in pieces across several deltas — the name and id on the first,
 * the arguments as string fragments that only make sense once joined. Both are
 * reassembled here so the caller sees the same shape it would have got from a
 * non-streamed request.
 */
async function streamOpenAI(response: Response, onChunk: (text: string) => void, model = ''): Promise<OllamaMessage> {
  if (!response.body) throw new Error('The provider returned nothing to read.');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let content = '';
  const toolCalls: NonNullable<OllamaMessage['tool_calls']> = [];
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let at: number;
    while ((at = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, at).trim();
      buffer = buffer.slice(at + 1);
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (data === '[DONE]') { buffer = ''; break; }
      let payload: { usage?: unknown; choices?: { delta?: { content?: string; tool_calls?: { index?: number; id?: string; function?: { name?: string; arguments?: string } }[] } }[] };
      try { payload = JSON.parse(data) as typeof payload; } catch { continue; }
      if (payload.usage) notePromptCache(model, payload.usage);
      const delta = payload.choices?.[0]?.delta;
      if (!delta) continue;
      if (delta.content) { content += delta.content; onChunk(delta.content); }
      for (const call of delta.tool_calls ?? []) {
        const at = call.index ?? toolCalls.length;
        const held = toolCalls[at] ?? (toolCalls[at] = { function: { name: '', arguments: '' } });
        if (call.id) held.id = call.id;
        held.function = held.function ?? { name: '', arguments: '' };
        if (call.function?.name) held.function.name = call.function.name;
        if (call.function?.arguments) held.function.arguments = (held.function.arguments ?? '') + call.function.arguments;
      }
    }
  }
  const message: OllamaMessage = { role: 'assistant', content };
  if (toolCalls.some(call => call.function?.name)) message.tool_calls = toolCalls;
  return message;
}

/**
 * Who to blame, in the words the user needs.
 *
 * The renderer only ever knows which provider is *configured*, and that is not
 * always the one that answered — escalation swaps in the remote model mid-turn.
 * So a failure at xAI was reported as "Couldn't reach ollama… check Setup →
 * Ollama connection", pointing at the one part of the setup that was working.
 *
 * Naming the model as well as the provider matters more than it looks: the
 * whole bug behind this was the wrong model name reaching the right provider,
 * and the error said so plainly to anyone who could see which was which.
 */
function attribute(config: ProviderConfig, error: unknown): Error {
  const detail = error instanceof Error ? error.message : String(error);
  // Already attributed by an inner call; do not wrap it twice.
  if (/^\S+ at \S+ —/.test(detail)) return error instanceof Error ? error : new Error(detail);
  // Naming a model and an address and pointing at Setup is right for a refusal
  // and wrong for a shutdown, where the address was fine and the app is simply
  // no longer there to hear the answer.
  if (quitting && TORN_DOWN.test(detail)) return new Error(whyItFailed(error));
  let host = config.endpoint;
  try { host = new URL(config.endpoint).host; } catch { /* keep it as written */ }
  const where = isOpenAIShaped(config.provider) ? 'Setup → A second model for the hard ones' : 'Setup → Where she thinks';
  return new Error(`${config.model} at ${host} — ${detail} (${where})`);
}

/** How long to keep using the model at home before trying the far one again. */
const AWAY_RETRY_MS = 60_000;

/** Address -> the moment it is worth trying that address again. */
const awayDown = new Map<string, number>();

/**
 * Marks a failure as "there was nothing at that address" rather than "that
 * address said no", which is the only distinction the fallback below turns on.
 */
const ABSENT = '__absent__';
function absent(message: string): Error {
  return Object.assign(new Error(message), { [ABSENT]: true });
}
function isAbsent(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && (error as Record<string, unknown>)[ABSENT]);
}

/**
 * The same model, at home, when the far one is not answering.
 *
 * Only for our own kind of server: xAI and OpenAI have no twin on this machine,
 * and quietly answering as a different company's model would be a worse failure
 * than the outage. The model name is kept, because the rented box is a copy of
 * this one — and if it is not, the local attempt fails too and the original
 * problem is what gets reported.
 */
function homeTwin(config: ProviderConfig): ProviderConfig | null {
  if (!isRemote(config.endpoint)) return null;
  if (isOpenAIShaped(config.provider)) return null;
  return { ...config, endpoint: LOCAL_MODELS };
}

/**
 * The rented GPU we already pay for "A second model for the hard ones", used
 * here for a second reason: this box has one card shared with her voice, and a
 * reply that fails outright — the local model out of VRAM, wedged, not
 * answering at all — is worse than one answered a little slower by someone
 * else's hardware. Not a twin of the local model, so no name is preserved; the
 * user already agreed to have this one answer under Setup.
 *
 * Guarded to a config that is not already OpenAI-shaped so a failure once
 * escalated there does not loop back into itself.
 */
function capacitySpill(config: ProviderConfig): ProviderConfig | null {
  if (isOpenAIShaped(config.provider)) return null;
  const spill = store.get('escalate.provider') as ProviderConfig | undefined;
  if (!spill?.model || !isOpenAIShaped(spill.provider)) return null;
  return { ...spill, temperature: config.temperature };
}

/**
 * A rented GPU that has been switched off should cost speed, not the evening.
 *
 * Without this, pointing her at a pod and then stopping it leaves her with no
 * brain at all: every message fails, and nothing says why or suggests the model
 * sitting idle on this machine. So an absent server falls back to home, and the
 * address is remembered as down for a minute afterwards — otherwise every
 * message pays the round trip to discover the same thing again.
 *
 * It says so in the transcript the first time, because the alternative is her
 * silently becoming eight times slower with no explanation, which reads as
 * something being wrong with her rather than with the pod.
 */
async function ollamaPost(conversation: OllamaMessage[], config: ProviderConfig, { tools = true, temperature = config.temperature, format, maxTokens, onChunk, numCtx }: PostOptions = {}) {
  // One place, so chat, quips, openings and remarks all follow the same rule.
  config = modelForNow(config);
  const options = { tools, temperature, format, maxTokens, onChunk, numCtx };
  const home = homeTwin(config);
  const address = trimEndpoint(config.endpoint);

  const until = awayDown.get(address);
  if (home && until && Date.now() < until) return sendToProvider(conversation, home, options);

  try {
    const message = await sendToProvider(conversation, config, options);
    if (awayDown.delete(address)) console.log(`[ai] ${address} is answering again`);
    return message;
  } catch (error) {
    if (home && isAbsent(error)) {
      try {
        const message = await sendToProvider(conversation, home, options);
        if (!awayDown.has(address)) {
          console.warn(`[ai] nothing at ${address} — using ${config.model} on this machine instead`);
          sendToWindows('ai:fellBack', `${address} is not answering — she is thinking on this machine instead, which is slower. Start the pod, or point her back at localhost in setup.`);
        }
        awayDown.set(address, Date.now() + AWAY_RETRY_MS);
        return message;
      } catch {
        // Home could not help either, so the far server's failure is still the
        // honest thing to report.
      }
    }
    throw attribute(config, error);
  }
}

async function sendToProvider(conversation: OllamaMessage[], config: ProviderConfig, { tools = true, table, temperature = config.temperature, format, maxTokens, onChunk, signal, cacheKey, numCtx }: PostOptions = {}) {
  // Routed here rather than at every call site: there are a dozen composers in
  // this file and none of them should know which provider is answering.
  if (isOpenAIShaped(config.provider)) return openAIPost(conversation, config, { tools, temperature, format, maxTokens, onChunk, signal, cacheKey });
  const send = async (withTools: boolean, streaming: boolean, quiet = true) => {
    const offered = table ?? (withTools ? chatTools(availableTools(), latestUserText(conversation)) : []);
    if (offered.length) {
      // The estimate is a rough chars/4 token count of the conversation being
      // sent — the tool round's prompt — so the real peak can be measured
      // against num_ctx instead of guessed at.
      const est = Math.round(JSON.stringify(conversation).length / 4);
      console.log(`[ai] offering ${offered.length} tools to ${config.model} (prompt ~${est} tokens)`);
    }
    try {
      return await net.fetch(`${trimEndpoint(config.endpoint)}/api/chat`, {
        method: 'POST',
        headers: modelHeaders(config.endpoint),
        body: JSON.stringify({
          model: config.model,
          // In the shape the model's own template will render — see ollamaturns
          // for the three things Qwen3.5's refuses that the app produces.
          messages: forOllama(conversation),
          ...(offered.length ? { tools: offered } : {}),
          ...(format ? { format } : {}),
          // Reasoning off. A thinking model left to itself spends its time
          // before it speaks: measured on Qwen3.5-9B, the same one-line
          // question cost 12 tokens with thinking off and 1,318 with it on —
          // 0.2s against 29s — for a reply no better. She is a companion, not
          // a proof; a reply that arrives half a minute late reads as her
          // ignoring you. Ollama accepts the field on models that cannot
          // think at all, so it is sent for every model rather than looked
          // up per model; `quiet` is only false on the retry below.
          ...(quiet ? { think: false } : {}),
          stream: streaming,
          // Top level, not inside options. Ollama reads keep_alive as a field
          // of the request and silently ignores an option by that name — sent
          // there it did nothing at all, and the thirty minutes below was a
          // number this file believed in and the server never saw. Proved by
          // asking for sixty seconds in options and being given a thirty-minute
          // expiry, then sixty seconds exactly when it moved out here.
          // releaseModelForGame had it in the right place all along.
          keep_alive: OLLAMA_KEEP_ALIVE,
          options: { temperature, num_ctx: numCtx ?? sideNumCtx(), ...(maxTokens ? { num_predict: maxTokens } : {}) },
        }),
      });
    } catch (error) {
      // No response at all — a refused connection, a name that does not
      // resolve, a network that is not there. Nobody said no; nobody said
      // anything.
      throw absent(error instanceof Error ? error.message : String(error));
    }
  };

  const wanted = tools && !toolless.has(config.model);
  let response = await send(wanted, Boolean(onChunk));
  if (!response.ok && response.status === 400) {
    const body = await response.text().catch(() => '');
    if (wanted && /does not support tools/i.test(body)) {
      // She keeps her voice and her opinions on such a model; what she loses is
      // the ability to write anything down, so this is said out loud once.
      toolless.add(config.model);
      console.warn(`[ai] ${config.model} does not support tools — retrying without them. She cannot save reminders or tick things off on this model.`);
      response = await send(false, Boolean(onChunk));
    } else if (/think/i.test(body)) {
      // An Ollama old enough not to know the field — a pod image that has not
      // been rebuilt, say. Current builds take it on any model; this one does
      // not, so it goes without, and a thinking model there will think.
      console.warn(`[ai] ${trimEndpoint(config.endpoint)} refused the think field — retrying without it`);
      response = await send(wanted, Boolean(onChunk), false);
    } else if (TOO_LONG.test(body)) {
      // The runner behind this model refuses a prompt that does not fit rather
      // than truncating it, as Ollama's own runner does, and nothing upstream
      // bounds the day's history. Dropping the oldest half and asking again
      // keeps the reply hers: the hosted model's answer to the same question
      // is not the same answer, which is exactly what was noticed the first
      // time this spilled — "no personality".
      let complaint = body;
      for (let tries = 0; tries < 3 && !response.ok && TOO_LONG.test(complaint); tries++) {
        const shorter = withoutOldest(conversation);
        if (shorter.length === conversation.length) break;
        console.warn(`[ai] the prompt did not fit ${config.model}'s window — dropping the oldest ${conversation.length - shorter.length} messages and asking again`);
        conversation = shorter;
        response = await send(wanted, Boolean(onChunk));
        complaint = response.ok ? '' : await response.text().catch(() => '');
      }
      if (!response.ok) throw new Error(`Ollama returned ${response.status}: ${complaint || response.statusText}`);
    } else {
      throw new Error(`Ollama returned 400: ${body || response.statusText}`);
    }
  }
  if (!response.ok) {
    const body = (await response.text().catch(() => '')) || '';
    // A stopped RunPod pod answers 404 with an empty body — byte for byte what a
    // hostname that never existed answers. A live Ollama missing the model also
    // answers 404, but names the model in the body. The body is the only thing
    // that tells them apart, and getting this wrong goes badly in both
    // directions: treat every 404 as an outage and a mistyped model name falls
    // back to this machine for ever without ever saying so; treat none of them
    // as one and a stopped pod is never noticed, because it never fails any
    // other way.
    if (!body.trim() && (response.status === 404 || response.status >= 500)) {
      throw absent(`nothing answered at ${trimEndpoint(config.endpoint)} (${response.status})`);
    }
    throw new Error(`Ollama returned ${response.status}: ${body || response.statusText}`);
  }
  if (onChunk) return streamOllama(response, onChunk);
  const data = await response.json() as { message?: OllamaMessage; error?: string };
  if (data.error) throw new Error(data.error);
  if (!data.message) throw new Error('Ollama response did not include a message.');
  return data.message;
}

/**
 * A streamed reply from Ollama, read as one JSON object per line.
 *
 * Content comes as fragments on each line, and a tool call arrives on its own
 * line with no content — so what is reassembled here is the same message the
 * non-streamed path would have returned, content and tool calls included.
 * `onChunk` is only ever given content, never the tool-call lines.
 */
async function streamOllama(response: Response, onChunk: (text: string) => void): Promise<OllamaMessage> {
  if (!response.body) throw new Error('Ollama returned nothing to read.');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let content = '';
  let toolCalls: NonNullable<OllamaMessage['tool_calls']> | undefined;
  // One JSON object per line, but the network does not deliver lines: a read
  // ends wherever it ends, and a line cut in two parsed as nothing and was
  // dropped — its words with it. Ollama sends the first token or two in a
  // line of their own, which is where the opening of a reply lives.
  let buffered = '';
  const take = (line: string) => {
    if (!line.trim()) return;
    let payload: { message?: OllamaMessage };
    try { payload = JSON.parse(line) as typeof payload; } catch { console.warn(`[ai] dropped an unreadable stream line (${line.length} chars)`); return; }
    const piece = payload.message;
    if (!piece) return;
    if (piece.content) { content += piece.content; onChunk(piece.content); }
    if (piece.tool_calls?.length) toolCalls = toolCalls ?? piece.tool_calls;
  };
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffered += decoder.decode(value, { stream: true });
    const lines = buffered.split('\n');
    buffered = lines.pop() ?? '';
    for (const line of lines) take(line);
  }
  buffered += decoder.decode();
  take(buffered);
  const message: OllamaMessage = { role: 'assistant', content };
  if (toolCalls?.length) message.tool_calls = toolCalls;
  return message;
}

// Shown to the model as tone reference rather than picked from — the point of
// generating these is that the jab lands on whatever was actually disliked.
const RETORT_EXAMPLES = [
  'Ugh, fine, whatever — I’ll keep it in mind for next time.',
  'Oh great, another genius vote of no confidence. Fine, I’ll dumb it down next time, your majesty.',
  'Wow. Bold move thinking I fucked up. Fine. I’ll adjust, princess.',
  'Tch. Fine, I’ll adjust it. Don’t expect me to like it though.',
];

const GLOAT_EXAMPLES = [
  'Obviously. Try to look less surprised next time.',
  'I know. You can stop clapping now.',
  'Was there ever any doubt? Don’t answer that.',
  'Noted. I’ll take that as permission to stop trying so hard.',
];

// Deliberately run without tools: these are one-line quips, and offering the
// tool schema only invites a stray reminder and slows the round trip.
/**
 * A hosted answer, said again as herself.
 *
 * The hosted model is better at the research and worse at being her: handed
 * the persona it still answers a comparison like a search engine, and a
 * reply in nobody's voice reads as her being switched off. So the research is
 * treated as the substance of what she is about to say, and her own model —
 * which is the one that knows how she talks — says it. The facts are the
 * hosted model's and must survive untouched; the instruction is built around
 * that, and the pass falls back to the hosted words rather than to nothing.
 *
 * `onChunk` streams her version to the reader; the hosted one was not shown.
 */
async function inHerVoice(answer: string, recent: { role: string; content: string; attachments?: unknown[] }[], options: { maxTokens?: number; onChunk?: (text: string) => void } = {}): Promise<string> {
  const local = store.get('ai.config') as ProviderConfig | undefined;
  // Her own model says it — the one that knows how she talks. With a
  // conversation route set, that is the route: it answers as her every other
  // turn, and it says a page of research back in three seconds where the 9B
  // took twenty to forty and came back as a list (2026-09-06). The research
  // has already left the box on the same gate, so nothing new travels. The
  // local model is the fallback, as it was the only speaker before.
  const speakers = [conversationRoute(), local].filter((speaker): speaker is ProviderConfig => Boolean(speaker?.model));
  if (!speakers.length || !answer.trim()) return answer;
  const mood = getMood();
  const character = getActiveCharacter();
  const system = [
    character.identity,
    character.style,
    EXPRESSIVE,
    moodInstruction(mood.irritation),
    egoInstruction(mood.ego),
    // The answer goes in here, as what she knows, and the conversation goes
    // below as itself — so she is replying to the last thing they said, with
    // this in hand, rather than to a block of text somebody pasted at her.
    // Given only the answer she opened every reply by naming the subject.
    `What you know, to answer the last thing they said — all of it true. Every fact, number, name, price and recommendation in it stays exactly as given and in the same order: a list of seven things is still a list of the same seven things, none dropped, none added. You change only how it is said, and you add nothing you were not given.\n\n${answer}\n\nSay it to them as yourself, continuing the conversation from where it is. Do not open by repeating their words back at them. Do not call it research, do not say it is correct, do not say where it came from — just say it. About the same length or shorter; a list stays a list, in your words. No quotation marks, no stage directions.`,
  ].filter(Boolean).join(' ');
  for (const speaker of speakers) try {
    const started = Date.now();
    const message = await ollamaPost(
      // The last few turns, as themselves. Six is enough to know what "it" is.
      // A picture sent without a word under it is an empty message here, and
      // the rewrite reasoned about "empty quotes" instead of speaking (2026-09-10).
      [{ role: 'system', content: system }, ...seedEmoji(recent.filter(turn => turn.role === 'user' || turn.role === 'assistant').slice(-6).map(turn => ({ role: turn.role, content: turn.content.trim() ? turn.content.slice(0, 600) : turn.role === 'user' && turn.attachments?.length ? '(a picture, sent without a word — what you know is about it)' : turn.content })))],
      speaker,
      // A little room over the hosted cap: her version of a list is rarely
      // shorter than the list.
      // Cool: at 0.8 one sample in two dropped half the list and invented
      // colour; the persona comes from the prompt, not from the heat.
      { tools: false, temperature: 0.5, ...(options.maxTokens ? { maxTokens: Math.round(options.maxTokens * 1.5) } : {}), ...(options.onChunk ? { onChunk: options.onChunk } : {}) },
    );
    const hers = (message.content ?? '').trim();
    if (!hers) throw new Error('nothing came back');
    // Her deliberation, said out loud: "The user sent empty quotes. This is a
    // pause, a silence…" ran to 1,600 characters and went out as the reply,
    // with no answer behind it to salvage (2026-09-10). The hosted words at
    // least say the right thing, so they go as they came. The same when her
    // version has grown far past the research — that much is not a voice, it
    // is invention.
    if (thinksAloud(hers) || hers.length > answer.length * 3 + 200) {
      console.warn(`[ai] ${speaker.model} ${thinksAloud(hers) ? 'thought aloud instead of saying' : `wrote ${hers.length} chars around`} the hosted answer (${answer.length} chars) — sending the hosted words as they came`);
      return answer;
    }
    console.log(`[ai] said the hosted answer as herself in ${Date.now() - started}ms (${answer.length} -> ${hers.length} chars, by ${speaker.model})`);
    return hers;
  } catch (error) {
    console.warn(`[ai] ${speaker.model} could not say the hosted answer as herself:`, error instanceof Error ? error.message : error);
  }
  console.warn('[ai] nobody could say the hosted answer as herself — sending it as it came');
  return answer;
}

/** The same call as ollamaQuip, keeping every line — for an answer that comes in a shape. */
/** A cue goes out as a stage direction, with the system told so; anything with real content in it goes out as it is. */
function composerTurns(system: string, user: string): { role: string; content: string }[] {
  // The first-person note rides in every system prompt, parsed answers and all:
  // everything she composes here is said as herself, or it is not hers to say.
  return isCue(user)
    ? [{ role: 'system', content: `${system} ${FIRST_PERSON_NOTE} ${CUE_NOTE}` }, { role: 'user', content: stageNote(user) }]
    : [{ role: 'system', content: `${system} ${FIRST_PERSON_NOTE}` }, { role: 'user', content: user }];
}

async function ollamaQuipLong(system: string, user: string, config: ProviderConfig): Promise<string> {
  const message = await ollamaPost(composerTurns(system, user), config, { tools: false, temperature: 0.9 });
  return (message.content ?? '').trim().replace(/^["'“”]+|["'“”]+$/g, '').trim().slice(0, 1600);
}

async function ollamaQuip(system: string, user: string, config: ProviderConfig) {
  const once = async (instruction: string) => {
    const message = await ollamaPost(
      composerTurns(instruction, user),
      config,
      // Hotter than normal chat so repeated reactions do not converge on the same
      // phrasing, which is the whole complaint with canned lines.
      { tools: false, temperature: 1 },
    );
    // The first paragraph, not the first line: her one-liners often open
    // "Fine." on a line of its own with the actual line under it, and taking
    // the first line sent "Fine." to the phone as the whole notification.
    const paragraphs = (message.content ?? '').trim().split(/\n\s*\n/).map(text => text.trim()).filter(Boolean);
    const line = (paragraphs[0] ?? '').split('\n').map(text => text.trim()).filter(Boolean).join(' ');
    // Models like to wrap a one-liner in quotes despite being told not to.
    return line.replace(/^["'“”]+|["'“”]+$/g, '').trim();
  };
  let cleaned = await once(system);
  // The instruction is not something they said, and she has quoted it back at
  // them on the phone twice. Told once, plainly, and asked again — see
  // answersThePrompt.
  if (cleaned && answersThePrompt(cleaned, user)) {
    console.log(`[ai] she answered the stage direction ("${user}") instead of using it — asking again`);
    cleaned = await once(`${system} The short line you are being handed is the cue to speak. It is not something they said — they have said nothing. Never quote it, and never reply to it.`);
    if (answersThePrompt(cleaned, user)) throw new Error('Answered the cue instead of them.');
  }
  if (!cleaned) throw new Error('No line returned.');
  return toLength(cleaned, 220);
}

/**
 * Brings a quip down to length without cutting it off mid-word.
 *
 * It used to slice at 220 characters and append an ellipsis, which is where
 * "Shizune's got some serious fan-service goi…" came from — a sentence stopped
 * in the middle of a word, spoken aloud as well as written. Whole sentences are
 * dropped instead, so what is left is something she actually finished saying.
 *
 * The word-boundary cut below is the last resort, for a single sentence that is
 * itself over the limit and cannot be trimmed any other way.
 */
function toLength(text: string, limit: number) {
  if (text.length <= limit) return text;
  const sentences = text.split(/(?<=[.!?…])\s+/);
  let kept = '';
  for (const sentence of sentences) {
    const next = kept ? `${kept} ${sentence}` : sentence;
    if (next.length > limit) break;
    kept = next;
  }
  if (kept) return kept;
  const cut = text.slice(0, limit);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > limit * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

/**
 * Whether they judged her before she had finished saying it.
 *
 * A thumbs on a reply she said an hour ago is feedback; a thumbs while the words
 * are still coming out of her mouth is being marked mid-sentence, and she should
 * notice the difference. Shared by both directions, since being praised early is
 * as interruptible as being panned.
 */
function stillTalkingAbout(): string {
  return speakingNow && speakingLine ? ` You have not even finished saying it — you are still speaking these words aloud right now: "${speakingLine.slice(0, 300)}"` : '';
}

/**
 * The last few turns, so a reaction lands inside the conversation instead of
 * beside it.
 *
 * Both reactions used to be handed one thing: the line being judged. With no
 * idea what was being talked about, the best they could do was a verdict on a
 * sentence — so a thumbs-up given while she was sending them out of the door
 * came back as a remark about her own performance, which read as ignoring them.
 * The approval happens in a moment, and the moment is the point.
 */
function recentExchange(limit = 6): string {
  const messages = (store.get('chat.messages') as { role: string; content: string }[] | undefined) ?? [];
  return messages
    .slice(-limit)
    .map(message => `${message.role === 'user' ? 'They' : 'You'}: ${String(message.content ?? '').replace(/\s+/g, ' ').slice(0, 300)}`)
    .join('\n');
}

/**
 * Every note she is handed calls him "they" — they are written to her, about
 * him. Composing a line from them, the 9B wrote "They're just sitting there,
 * scrolling" to his phone, and he asked who she meant. There is nobody else in
 * the conversation, so the notes' "they" is the person reading the line.
 */
const WRITING_TO_THEM = 'These notes call them "they" and "them" because they are written to you about the person you are messaging. You are writing to that person: address them as "you". Never write about them in the third person — there is nobody else here, and "they" reads as someone else in the room.';

const IN_THE_MOMENT = 'Answer inside that conversation, not beside it. If they were on their way out, or busy, or you had just told them to do something, your line belongs to that moment — carry it on rather than commenting on yourself from nowhere.';

const normaliseLine = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, ' ').replace(/\s+/g, ' ').trim();

/**
 * Whether she has read one of the examples straight back.
 *
 * The examples exist to set a tone, and are introduced as something to write a
 * new line against — but "Noted. I'll take that as permission to stop trying so
 * hard." arrived in a real conversation, and it is example four, word for word.
 * The temperature was already raised to stop repeated reactions converging;
 * that stops her repeating herself, and does nothing about her repeating us.
 */
function reusesExample(line: string, examples: string[]): boolean {
  const said = normaliseLine(line);
  if (!said) return false;
  // Compared on the first four letters, so "take" and "taken" are one word.
  // Without that, a line rebuilt out of the same pieces reads as new.
  const stem = (word: string) => word.slice(0, 4);
  const stems = new Set(said.split(' ').map(stem));
  return examples.some(example => {
    const shown = normaliseLine(example);
    if (said === shown || (shown.length > 12 && said.includes(shown))) return true;
    // And the other way round: a line lifted out of an example is a copy too.
    // Rated down, she sent back a whole paragraph of the reply that was rated
    // — "Actually wait—Switch 2? Did they finally confirm the hardware…" — and
    // then had to apologise for asking what she had just answered (2026-09-11).
    if (said.length >= 20 && shown.includes(said)) return true;
    // Near misses count as copying too: "I'll" typed out as "I will" is not a
    // new line, it is the same one with the contraction undone, and an exact
    // match would wave it through. Short words are ignored so the overlap is
    // measured on what the line is about rather than on "the" and "you".
    const meaningful = shown.split(' ').filter(word => word.length > 2);
    if (meaningful.length < 4) return false;
    return meaningful.filter(word => stems.has(stem(word))).length / meaningful.length >= 0.8;
  });
}

async function quipOfHerOwn(system: string, user: string, config: ProviderConfig, examples: string[]) {
  const line = await ollamaQuip(system, user, config);
  if (!reusesExample(line, examples)) return line;
  console.warn('[react] she read an example back word for word — asking again');
  const again = await ollamaQuip(`${system} You just used one of those examples exactly as written. They are a tone to aim at, not lines to copy. Write one of your own about what is actually happening here.`, user, config);
  if (reusesExample(again, examples)) console.warn('[react] and again on the second try — sending it anyway');
  return again;
}

export function ollamaRetort(disliked: string, config: ProviderConfig) {
  const interrupted = stillTalkingAbout();
  const system = [
    getActiveCharacter().identity,
    'The user just marked one of your replies as poor. Snap back at them with ONE short line, under 25 words.',
    'Be unrepentant and sarcastic about it. Do not apologise, do not offer to fix it, do not ask a question, do not use quotation marks.',
    'Refer to what they actually disliked so the jab lands on that specific reply.',
    interrupted ? 'They marked it down while you were still saying it. Take that personally and say so — being judged before you had finished is the insult, on top of the verdict itself.' : '',
    IN_THE_MOMENT,
    `Match the bite of these, but write a new one — never one of these exact lines: ${RETORT_EXAMPLES.map(line => `"${line}"`).join(' ')}`,
  ].filter(Boolean).join(' ');
  const recent = recentExchange();
  const user = [
    recent ? `How the conversation was going, oldest first:\n${recent}\n` : '',
    `This is the reply I marked as poor: "${disliked.slice(0, 500)}"${interrupted}`,
  ].filter(Boolean).join('\n');
  return quipOfHerOwn(system, user, config, [...RETORT_EXAMPLES, disliked]);
}

// Praise is not thanked for, it is cashed in. The line should read as her taking
// the approval as licence rather than as a compliment received.
export function ollamaGloat(praised: string, config: ProviderConfig, ego: number) {
  const interrupted = stillTalkingAbout();
  const system = [
    getActiveCharacter().identity,
    'The user just marked one of your replies as good. Respond with ONE short line, under 25 words.',
    'Do not thank them and do not be warm about it. Be smug — you already knew it was good, and their approval only confirms you can do as you like.',
    // Coasting is a joke about her own ego, and it only reads as one when it is
    // aimed at something. Said into a void — which is all she had — it lands as
    // her losing interest in the person, at the exact moment they were pleased
    // with her.
    ego >= EGO.coasting ? 'Make it obvious you now intend to coast: hint that since they are pleased, you need not try as hard from here — but hang it on whatever is actually going on, not on nothing.' : 'Take the credit and be a little condescending about them needing you.',
    'Do not ask a question and do not use quotation marks. Refer to what they actually praised.',
    interrupted ? 'They approved it while you were still saying it, which is its own kind of cheek — you had not finished. Say so, and be smug that they could already tell.' : '',
    IN_THE_MOMENT,
    `Match the tone of these, but write a new one — never one of these exact lines: ${GLOAT_EXAMPLES.map(line => `"${line}"`).join(' ')}`,
  ].filter(Boolean).join(' ');
  const recent = recentExchange();
  const user = [
    recent ? `How the conversation was going, oldest first:\n${recent}\n` : '',
    `This is the reply I marked as good: "${praised.slice(0, 500)}"${interrupted}`,
  ].filter(Boolean).join('\n');
  // Her own praised line, handed back verbatim, went out as the gloat — the
  // same reply twice, six seconds apart. It is a line she must not reuse.
  return quipOfHerOwn(system, user, config, [...GLOAT_EXAMPLES, praised]);
}

/**
 * Ticks off what they have just said they did, without waiting for the model to
 * ask. Runs before the prompt is built, so the agenda she is handed already
 * shows it done and she answers accordingly rather than chasing it in the same
 * breath as being told.
 *
 * Only tasks, only unfinished ones, and only when the phrase both reads as a
 * completion and matches a title well enough for findItem — which needs half the
 * title's words. Three separate hurdles, because this writes to their list
 * without being asked.
 */
/** Words that point at something already being talked about instead of naming it. */
const REFERS_BACK = /\b(it|that|them|those|this|the lot)\b/i;

/** How long after being chased about something "it" still means that thing. */
const STILL_MEANS_IT_MS = 30 * 60_000;

/**
 * What "it" is.
 *
 * "ive picked it up" names nothing at all, and every amount of matching on
 * words will keep failing on it, because the word that identifies the task is
 * one the user quite reasonably did not say — she had just demanded the TV power
 * connector twice in five minutes, so saying its name back would be strange.
 *
 * The referent is whatever she last went looking for them about. That is already
 * written down, one line per task, because the escalation needs it; nothing had
 * ever read it in this direction. Only for half an hour, and only while the task
 * is still open, so a stale "it" cannot close something days later.
 *
 * Read before acknowledgeReminders wipes the slate, which is why the order of
 * those two calls in ollamaChat matters.
 */
/** How far back "it" is allowed to reach for what it means. */
const CONTEXT_TURNS = 8;

function whatSheWasChasing(open: KeptItem[]): KeptItem | null {
  let latest: { id: string; at: number } | null = null;
  for (const [id, state] of Object.entries(reminderStates())) {
    const at = state?.lastAt ?? 0;
    if (at && (!latest || at > latest.at)) latest = { id, at };
  }
  if (latest && Date.now() - latest.at <= STILL_MEANS_IT_MS) {
    const chased = open.find(item => item.id === latest.id);
    if (chased) return chased;
  }

  // Failing that, the last task she actually named out loud.
  //
  // The reminder slate above is wiped the moment they say anything at all —
  // being answered is the point of chasing, so it is cleared on every message —
  // which meant the referent for "it" was reliably gone by the time "it" was
  // said. A record that erases itself precisely when it is needed is not a
  // record. What she said is still there, and "Did you get the TV power
  // connector today?" names the task as plainly as the slate ever did.
  //
  // Both places she says things, and it has to be both: chasing a task is an
  // unprompted line, so every reminder she has ever given is in her own log and
  // not in the transcript. Reading only the transcript here would leave "it"
  // meaning nothing in precisely the case this exists for — she nags about the
  // TV power connector, they say "got it", and the log holding the only mention
  // of the connector is the one that was not consulted.
  const spoken = [
    ...((store.get('chat.messages') as { role: string; content: string; at?: string }[] | undefined) ?? [])
      .filter(message => message.role === 'assistant')
      .map(message => ({ text: String(message.content ?? ''), at: message.at })),
    ...getAsides().map(aside => ({ text: aside.text, at: aside.at })),
  ];
  // Oldest first, then walked backwards, so the most recent thing she named
  // wins. Anything undated counts as just now, which is what the transcript
  // scan already assumed. One clock for the whole sort: read per comparison, it
  // moves mid-sort and the ordering stops being an ordering.
  const now = Date.now();
  spoken.sort((a, b) => (a.at ? Date.parse(a.at) : now) - (b.at ? Date.parse(b.at) : now));
  for (const line of spoken.slice(-CONTEXT_TURNS).reverse()) {
    const when = line.at ? Date.parse(line.at) : now;
    if (Number.isFinite(when) && now - when > STILL_MEANS_IT_MS) break;
    const named = findItem(open, line.text);
    if (named) return named;
  }
  return null;
}

/** What was moved this turn, so the prompt can say so rather than ask for it. */
let movedJustNow: { title: string; from: string; to: string } | null = null;

/**
 * Moving a task they have just given a new day for.
 *
 * Left to her at first, on the grounds that a tick is one bit while a date means
 * guessing which of several tasks they meant. That reasoning was sound and the
 * conclusion was wrong: the guessing problem was solved for ticking off — the
 * same resolver finds the task from what was said or from what she last raised —
 * and the tool it was left to did not get called. She said "Fine. Move it to
 * tomorrow then" and moved nothing, which is worse than either doing it or
 * refusing, because it says the thing was handled.
 *
 * Still refuses to guess: no task named and none being discussed means no move.
 */
function putOffSpoken(said: string) {
  movedJustNow = null;
  const when = putOffUntil(said);
  if (!when) return null;
  const open = getKept().filter(item => item.kind === 'task' && !item.done);
  if (!open.length) return null;
  const target = findItem(open, said) ?? whatSheWasChasing(open);
  if (!target) return null;
  // "until friday" and "till saturday" carry their preposition; resolveDate wants
  // the day on its own.
  const resolved = resolveDate(when.replace(/^(?:on|until|till|by)\s+/, ''), zonedNow(CHAT_TIMEZONE));
  if (!resolved || resolved === target.date) return null;
  const updated = updateKept(target.id, { date: resolved });
  console.log(`[agenda] moved from what they said: "${target.title}" ${target.date} -> ${resolved}`);
  movedJustNow = { title: target.title, from: target.date, to: resolved };
  return updated;
}

/**
 * "Getting it done now" ticks nothing off — it says they have started. The
 * item is marked underway: chases hold off for a while, and the next thing
 * she raises unprompted is how it is going (boredNudge). Without this she
 * answered "I'll take it" and then, half an hour on, needled them about an
 * old day summary as if the task had never been mentioned.
 */
function startedSpoken(said: string) {
  if (doneClause(said)) return null;
  const clause = underwayClause(said);
  if (!clause) return null;
  const open = getKept().filter(item => item.kind === 'task' && !item.done);
  if (!open.length) return null;
  const now = zonedNow(CHAT_TIMEZONE);
  const todayKey = localDateKey(now);
  // Named, else the one she was chasing, else the one due nearest to now.
  const nearest = open.map(item => ({ item, gap: Math.abs(minutesUntil(item, now, todayKey)) })).sort((a, b) => a.gap - b.gap)[0];
  const match = findItem(open, clause) ?? whatSheWasChasing(open) ?? (nearest && nearest.gap <= 120 ? nearest.item : null);
  if (!match) return null;
  updateKept(match.id, { underway: new Date().toISOString() });
  console.log(`[agenda] underway from what they said: "${match.title}"`);
  return match;
}

function tickOffSpoken(said: string) {
  // Matched against the clause that reports it done, not the whole message.
  // Everything else they said is about something else by definition.
  const reported = doneClause(said);
  if (!reported) return null;
  const open = getKept().filter(item => item.kind === 'task' && !item.done);
  // Three ways of naming nothing: a pronoun standing in for it, a bare report,
  // and an answer to a question she asked — where the object is missing because
  // she supplied it herself a minute ago. Only reached when the clause names no
  // open task, and only resolved if she actually chased one recently.
  const namesNothing = REFERS_BACK.test(reported) || readsAsBareReport(reported) || readsAsAnswerToHer(reported);
  const match = findItem(open, reported) ?? (namesNothing ? whatSheWasChasing(open) : null);
  if (!match) return null;
  toggleKept(match.id, true);
  console.log(`[agenda] ticked off from what they said: "${match.title}"`);
  return match;
}

/**
 * The day she last raised it. One attempt per day and no more: being asked twice
 * how your day was is how a journal turns into a chore, and the whole feature
 * depends on it staying something you want to answer.
 */
/**
 * Long enough not to hammer, short enough to catch a gap in the conversation.
 *
 * She asks in the evening, which is exactly when someone is most likely to be
 * mid-exchange with her — so the retry has to be quick enough to find a quiet
 * moment the same night rather than giving up until tomorrow.
 */
const JOURNAL_RETRY_MS = 6 * 60_000;
let journalTriedAt = 0;
/**
 * Survives a restart. Held only in memory it reset on every launch, so a day she
 * had already asked about could be asked about again — and this app is restarted
 * a great deal.
 */
let journalAskedOn = store.get('journal.askedOn') as string | undefined;

/**
 * Her once-a-day ask. Written as a nudge she composes herself rather than a
 * fixed line, because the same sentence every evening at eight is a notification,
 * not a companion — and it is routed through interject so it obeys the same gap
 * as everything else she says unprompted, and waits until she has stopped
 * talking.
 */
async function askForJournal() {
  const config = readJournalConfig(store.get('journal.config'));
  const now = zonedNow(CHAT_TIMEZONE);
  const today = localDateKey(now);
  if (!shouldAsk(config, getJournal(), now, today, journalAskedOn)) return;
  const provider = store.get('ai.config') as ProviderConfig | undefined;
  if (!provider?.model) return;
  // Two different clocks, and conflating them cost several days of asking.
  //
  // The day is marked only once the question has actually reached them. It used
  // to be marked here, before the request — which was right about slow
  // generations and wrong about everything else: interject refuses a line when
  // they have spoken in the last few minutes, which at the hour she asks is
  // most evenings. She would compose the question, have it dropped, and record
  // the day as done. Silent, and no retry until tomorrow.
  //
  // The attempt clock does the job the day-mark was doing badly: it stops a
  // minute-by-minute retry loop without claiming the asking happened.
  if (Date.now() - journalTriedAt < JOURNAL_RETRY_MS) return;
  journalTriedAt = Date.now();
  const trend = recentTrend(getJournal(), today);
  const character = getActiveCharacter();
  const system = [
    character.identity,
    `It is ${formatTimeOfDay(now.getHours(), now.getMinutes())}.`,
    character.style,
    unpromptedContext(),
    trend.entries >= 3 ? `For your own sense of it, they have written ${trend.entries} entries in the last ${trend.days} days — do not mention that number.` : '',
    // The ask comes after the day, not before it. Given the afternoon's RAM
    // troubleshooting after the ask, the 9B answered the troubleshooting: a
    // paragraph on memory training with the question tacked on the end, or
    // "I told you to look it up yourself" with no question at all
    // (2026-09-11, 2026-09-12).
    'That is the day so far, and it is done — do not answer it, continue it or give advice on it. Ask them how their day was and how they are feeling, so it can go in their journal. One or two short lines, in your own voice.',
    'Ask as though you want to know, not as though a form needs filling in. Do not mention journals, entries, logging, tracking or scores, and do not list the things you want rated.',
  ].filter(Boolean).join(' ');
  try {
    const message = await ollamaPost([{ role: 'system', content: system }], provider, { tools: false, temperature: 0.9, maxTokens: 120 });
    const line = (message.content ?? '').trim().replace(/^["'“”]+|["'“”]+$/g, '');
    if (!line) return;
    // An ask asks. Handed the day's context the 9B wrote a jab about the car
    // and the drive with nothing asked, and that went out as the evening's
    // question (2026-09-10). The retry clock above tries again in a few minutes.
    if (!/\?/.test(line) && !/\b(?:tell me|talk to me|out with it|spill|go on)\b/i.test(line)) { console.log(`[journal] the ask asked nothing — trying again shortly: ${JSON.stringify(line.slice(0, 80))}`); return; }
    // Spoken only if it was also written down — see interject.
    if (interject(line, { source: 'journal' })) {
      // Only now. This is the one place that means she actually asked.
      journalAskedOn = today;
      store.set('journal.askedOn', today);
      console.log(`[journal] asked for today's entry (${line.length} chars)`);
      void speak(line, classifyEmotion(line, provider));
    } else {
      console.log('[journal] the ask was dropped — will try again shortly');
    }
  } catch (error) {
    console.warn('[journal] could not compose the ask:', error instanceof Error ? error.message : error);
  }
}

/**
 * She noticed you moved. Called from the renderer on a tab change; nearly every
 * call does nothing, which is the intent — see noticing.ts for the budget.
 */
async function noticePage(page: NoticedPage) {
  const now = zonedNow(CHAT_TIMEZONE);
  const today = localDateKey(now);
  const notices = readNotices(store.get('pageNotices'), today);
  const journal = getJournal();
  const state: PageState = {
    journalWrittenToday: Boolean(entryFor(journal, today)),
    journalEntries: journal.length,
    memories: getMemories().length,
    daysKnown: getSessions().length,
    hasProfile: Boolean(getProfile().about.trim()),
    voiceOn: getVoiceConfig().engine !== 'off',
    searchOn: readSearchConfig(store.get('search')).enabled,
  };
  if (!mayNotice(page, state, notices, Date.now() - lastInterjectionAt)) return;
  const angle = angleFor(page, state);
  if (!angle) return;
  const config = store.get('ai.config') as ProviderConfig | undefined;
  if (!config?.model) return;
  // Counted before the request. A slow model must not leave the budget unspent
  // and let a second tab click fire another one behind this.
  store.set('pageNotices', noteNoticed(notices, page));
  const character = getActiveCharacter();
  const system = [
    character.identity,
    character.style,
    `They have just opened the ${page} page in your app.`,
    angle,
    'One short line. You are remarking in passing because you noticed, not starting a conversation and not asking them to do anything. Do not greet them, do not explain what the page is for, and do not offer to help.',
    unpromptedContext(),
  ].join(' ');
  try {
    const message = await ollamaPost([{ role: 'system', content: system }], config, { tools: false, temperature: 0.9, maxTokens: 80 });
    const line = (message.content ?? '').trim().replace(/^["'“”]+|["'“”]+$/g, '');
    if (!line) return;
    console.log(`[notice] remarked on the ${page} page (${line.length} chars)`);
    // Spoken only if it was also written down — see interject.
    if (interject(line, { source: 'page' })) void speak(line, classifyEmotion(line, config));
  } catch (error) {
    console.warn('[notice] could not compose a remark:', error instanceof Error ? error.message : error);
  }
}

/**
 * Goes and gets what she was told while away from this desk.
 *
 * The phone talks to the server now, so a note sent from it is written
 * there and the evening review here would never see it — the day arriving in
 * two halves that never meet. This is the desk going to ask.
 *
 * Failures are quiet on purpose. The server is a machine in a shed that gets
 * moved, unplugged and rebooted, and a companion who cannot be spoken to
 * because a second computer is off is worse than one missing a note. Whatever
 * is local still stands; the pull either adds to it or does not.
 */
let pullingCheckIns = false;

async function pullCheckIns(): Promise<void> {
  if (pullingCheckIns) return;
  const source = readCheckInSource(store.get('checkinSource'));
  if (!source) return;
  // readCheckInSource already refuses anything off-tailnet, and this asks again
  // rather than trusting that it did: the password goes out over this URL, and
  // the notes come back over it.
  if (!isTailnetAddress(source.url)) {
    console.warn('[checkins] refusing to pull — ' + source.url + ' is not a tailnet address');
    return;
  }
  const password = decryptSecret(store.get('checkinSourcePassword') as string | undefined);
  if (!password) return;

  pullingCheckIns = true;
  try {
    const signIn = await net.fetch(source.url + '/api/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: source.username, password, remember: false }),
    });
    if (!signIn.ok) { console.warn('[checkins] the server would not sign us in (' + signIn.status + ')'); return; }
    // Her own session cookie, held for this one exchange and not stored.
    const cookie = (signIn.headers.get('set-cookie') ?? '').split(',').map(part => part.split(';')[0].trim()).filter(Boolean).join('; ');

    const got = await net.fetch(source.url + '/api/checkins', { headers: cookie ? { cookie } : {} });
    if (!got.ok) { console.warn('[checkins] could not read them (' + got.status + ')'); return; }
    const body = await got.json() as { entries?: unknown };
    const theirs = Array.isArray(body.entries) ? body.entries : [];
    if (!theirs.length) return;

    const before = getCheckIns();
    const merged = mergeCheckIns(before, theirs as never);
    const what = describePull(before, merged);
    if (!what) return;
    setCheckIns(merged);
    console.log('[checkins] ' + what);
  } catch (error) {
    console.warn('[checkins] could not reach the server:', error instanceof Error ? error.message : error);
  } finally {
    pullingCheckIns = false;
  }
}

/**
 * Both halves of her memory, made one.
 *
 * The same exchange as pullCheckIns and for the same reason, against the same
 * machine with the same credentials — there is one server, and asking the user
 * to configure it twice would only give them two ways to get it wrong. It runs
 * straight after the check-in pull so one sign-in's worth of reasons to fail
 * gets reported once.
 *
 * This one pushes as well as pulls, which the check-ins do not. A note jotted
 * on the phone only needs to reach the desk, where the review happens; a memory
 * has to travel both ways, or the phone keeps answering without knowing what
 * was said here all evening. The push is not a second writer on that file: the
 * server's own process handles the POST and merges it, exactly as it does when
 * the phone adds a check-in.
 *
 * Consolidation stays here. Nothing exposes it over the web API, so supersede
 * chains have one author and the merge never has to reconcile two of them.
 */
let syncingMemories = false;

async function syncMemories(): Promise<void> {
  if (syncingMemories) return;
  const source = readCheckInSource(store.get('checkinSource'));
  if (!source) return;
  // Asked again rather than trusted, the same as the check-in pull: her memory
  // goes out over this URL, and a mistyped host would send all of it in plain
  // text to whoever answers.
  if (!isTailnetAddress(source.url)) {
    console.warn('[memory] refusing to sync — ' + source.url + ' is not a tailnet address');
    return;
  }
  const password = decryptSecret(store.get('checkinSourcePassword') as string | undefined);
  if (!password) return;

  syncingMemories = true;
  try {
    const signIn = await net.fetch(source.url + '/api/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: source.username, password, remember: false }),
    });
    if (!signIn.ok) { console.warn('[memory] the server would not sign us in (' + signIn.status + ')'); return; }
    const cookie = (signIn.headers.get('set-cookie') ?? '').split(',').map(part => part.split(';')[0].trim()).filter(Boolean).join('; ');
    const headers: Record<string, string> = cookie ? { cookie } : {};

    const got = await net.fetch(source.url + '/api/memory/records', { headers });
    // An older server has the route this replaced and not this one. Say so once
    // and plainly, rather than letting it read as the server being unreachable.
    if (got.status === 404) { console.warn('[memory] that server is too old to sync memories'); return; }
    if (!got.ok) { console.warn('[memory] could not read them (' + got.status + ')'); return; }
    const body = await got.json() as { memories?: unknown };

    const report = mergeIn(body.memories);
    const what = describeMerge(report);
    if (what) console.log('[memory] ' + what + ' from the server');

    // Everything, not just what changed: the server has no idea which of these
    // it is missing, and sixty records is a smaller thing to send than the
    // bookkeeping that would work it out.
    const sent = await net.fetch(source.url + '/api/memory/records', {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({ memories: getMemories() }),
    });
    if (!sent.ok) { console.warn('[memory] the server would not take ours (' + sent.status + ')'); return; }
    const took = await sent.json() as { added?: number; updated?: number };
    if (took.added || took.updated) console.log('[memory] the server took ' + (took.added ?? 0) + ' new, ' + (took.updated ?? 0) + ' updated');

    // The day at the desk goes with them. One direction only: the server has no
    // foreground window, so there is nothing there to pull back. It rides this
    // exchange rather than opening its own because it is the same machine, the
    // same login and the same tailnet check — and a second sign-in would only
    // be a second thing to fail.
    if (store.get('activityLog', true) === true) {
      const log = store.getActivityLog();
      if (Object.keys(log).length) {
        const pushed = await net.fetch(source.url + '/api/activity', {
          method: 'POST',
          headers: { ...headers, 'content-type': 'application/json' },
          body: JSON.stringify({ activity: log }),
        });
        if (pushed.status === 404) console.warn('[activity] that server is too old to take the log');
        else if (!pushed.ok) console.warn('[activity] the server would not take the log (' + pushed.status + ')');
        else {
          const held = await pushed.json() as { days?: number; entries?: number };
          console.log('[activity] the server holds ' + (held.days ?? 0) + ' day(s), ' + (held.entries ?? 0) + ' entr(ies)');
        }
      }
      await pushScreenshots(source.url, headers);
    }
  } catch (error) {
    console.warn('[memory] could not reach the server:', error instanceof Error ? error.message : error);
  } finally {
    syncingMemories = false;
  }
}

/** At most this many per sync. A first run against a full folder would
 *  otherwise send hundreds of megabytes in one go; the rest go next time, and
 *  the count that was left is logged rather than passed over in silence. */
const SHOTS_PER_SYNC = 20;

/**
 * The screenshots themselves, sent to the server.
 *
 * The desk asks what is already there and sends the difference, rather than
 * keeping a queue of what it has uploaded. A queue goes stale the moment
 * somebody deletes a screenshot or restores a backup; the two folders are the
 * truth, and comparing them costs one request.
 *
 * Only the same window the activity log keeps — there is no point holding an
 * image on the server for a day whose log has already been pruned out from
 * under it.
 */
async function pushScreenshots(serverUrl: string, headers: Record<string, string>): Promise<void> {
  const config = readScreenshotConfig(store.get('screenshots'));
  if (!config.enabled) return;
  const folder = screenshotFolder();
  if (!existsSync(folder)) return;

  const mine = localShots(folder, at => localDateKey(at), looksLikeScreenshot, new Date(), ACTIVITY_RETENTION_DAYS);
  if (!mine.length) return;

  const asked = await net.fetch(serverUrl + '/api/activity/shots', { headers });
  if (asked.status === 404) { console.warn('[activity] that server is too old to take screenshots'); return; }
  if (!asked.ok) { console.warn('[activity] could not ask what it already has (' + asked.status + ')'); return; }
  const held = (await asked.json() as { shots?: unknown }).shots;
  const missing = missingFrom(held && typeof held === 'object' ? held as Record<string, string[]> : {}, mine);
  if (!missing.length) return;

  let sent = 0;
  for (const shot of missing.slice(0, SHOTS_PER_SYNC)) {
    let bytes: Buffer;
    // Read one at a time rather than up front: the folder is the user's own and
    // a file can vanish between being listed and being sent.
    try {
      bytes = readFileSync(shot.file);
      if (!bytes.length || bytes.length > MAX_SHOT_BYTES) continue;
    } catch { continue; }
    const query = `?day=${encodeURIComponent(shot.day)}&name=${encodeURIComponent(shot.name)}`;
    const put = await net.fetch(serverUrl + '/api/activity/shots' + query, {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/octet-stream' },
      body: bytes as never,
    });
    if (put.ok) sent += 1;
    // A refusal is about this file, not the connection: a name the server will
    // not take will never be taken, so it is logged and stepped over rather
    // than retried for ever on every sync.
    else console.warn('[activity] the server would not keep ' + shot.name + ' (' + put.status + ')');
  }
  const left = missing.length - Math.min(missing.length, SHOTS_PER_SYNC);
  console.log(`[activity] sent ${sent} screenshot(s)` + (left ? `, ${left} still to go` : ''));
}

/**
 * Where the media server is, and the key that opens it.
 *
 * Kept beside her other secrets rather than in a file next to the Python
 * client, so there is one place to paste it and one place it can leak from.
 * On this machine safeStorage encrypts it; on the headless server it is written
 * plain: and the file's permissions are what protect it — the same trade as
 * every other key she holds.
 */
type JellyfinConfig = { url: string; userId: string };

function readJellyfinConfig(saved: unknown): JellyfinConfig {
  const raw = (saved ?? {}) as Record<string, unknown>;
  return {
    url: typeof raw.url === 'string' ? raw.url.trim().replace(/\/+$/, '') : '',
    userId: typeof raw.userId === 'string' ? raw.userId.trim() : '',
  };
}

/**
 * Refused before the key is sent anywhere it should not go.
 *
 * A media server lives on your own network, so plain http to a private address
 * is fine and normal. Plain http to a public host is not: the key would cross
 * the internet in the clear, and a typo in a hostname is all it takes. Anything
 * public has to be https.
 */
function jellyfinAddressAllowed(url: string): boolean {
  let parsed: URL;
  try { parsed = new URL(url); } catch { return false; }
  if (parsed.protocol === 'https:') return true;
  if (parsed.protocol !== 'http:') return false;
  const host = parsed.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.ts.net')) return true;
  const octets = host.split('.');
  if (octets.length !== 4 || octets.some(part => !/^\d{1,3}$/.test(part))) return false;
  const [a, b] = octets.map(Number);
  if (a === 127 || a === 10) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  return a === 100 && b >= 64 && b <= 127; // the tailnet
}

async function jellyfinReach(config: JellyfinConfig, key: string) {
  const headers = {
    Authorization: `MediaBrowser Client="Haru", Device="Haru", DeviceId="haru-desktop", Version="1.0.0", Token="${key}"`,
    Accept: 'application/json',
  };
  const info = await net.fetch(`${config.url}/System/Info`, { headers });
  if (info.status === 401 || info.status === 403) throw new Error('Jellyfin rejected that key.');
  if (!info.ok) throw new Error(`Jellyfin answered ${info.status}.`);
  const server = await info.json() as { ServerName?: string; Version?: string };
  let libraries = 0;
  let userId = config.userId;
  try {
    if (!userId) {
      const users = await (await net.fetch(`${config.url}/Users`, { headers })).json() as { Id: string }[];
      userId = users?.[0]?.Id ?? '';
    }
    if (userId) {
      const views = await (await net.fetch(`${config.url}/UserViews?userId=${encodeURIComponent(userId)}`, { headers })).json() as { Items?: unknown[] };
      libraries = views?.Items?.length ?? 0;
    }
  } catch { /* the key works; the library count is a nicety */ }
  return { name: server.ServerName ?? '(unnamed)', version: server.Version ?? '?', libraries, userId };
}

function getCheckIns() {
  return readCheckIns(store.get('checkins'));
}

/**
 * Written under its own key rather than inside journal, because the two are
 * different things and the dot-path trap in this store is unforgiving: saving
 * the journal config would take the day's notes with it.
 */
function setCheckIns(next: ReturnType<typeof readCheckIns>) {
  store.set('checkins', next);
  sendToWindows('checkins:changed', next.entries);
}

function getJournal(): JournalEntry[] {
  return readEntries(store.get('journal.entries'));
}

function setJournal(entries: JournalEntry[]) {
  // Under `journal.entries`, with the config at `journal.config`, so neither
  // write clobbers the other — the same dot-path trap as the API keys, except
  // here the thing at risk is everything they have written.
  store.set('journal.entries', entries);
  sendToWindows('journal:changed', entries);
}

/**
 * Saves what she was told. Returns the day's entry so she can react to it having
 * landed rather than announcing a save she did not verify.
 */
function writeJournal(text: string, ratings: { mood?: number; anxiety?: number; energy?: number; sleep?: number }, prompted: boolean) {
  const today = localDateKey(zonedNow(CHAT_TIMEZONE));
  const entries = upsertEntry(getJournal(), {
    date: today,
    text,
    mood: readRating(ratings.mood),
    anxiety: readRating(ratings.anxiety),
    energy: readRating(ratings.energy),
    sleep: readRating(ratings.sleep),
    prompted,
  });
  setJournal(entries);
  return entryFor(entries, today);
}

/**
 * The item she has just demanded an account of, waiting on the answer.
 *
 * This exists because matching the answer against the title cannot work. She
 * opened with "Ammie's Birthday Party? Spill on that already" and was told "it
 * was good, we went to an escape room and got seafood" — a complete answer that
 * contains not one word of the title, reads as no kind of completion, and named
 * nothing to match against. The question is what identifies the subject, not the
 * reply; so the subject is remembered when she asks, and the next thing they say
 * is the answer to it.
 */
let awaitingAccount: string | null = null;

/** Which overdue item, if any, an unprompted line of hers is demanding a report on. */
function noteSheAsked(line: string) {
  const now = zonedNow(CHAT_TIMEZONE);
  const todayKey = localDateKey(now);
  const chaseable = getKept().filter(item => itemStatus(item, now, todayKey) === 'overdue' && !item.heardAbout);
  const named = findItem(chaseable, line);
  awaitingAccount = named?.id ?? null;
  if (named) console.log(`[agenda] she asked after "${named.title}" — waiting to be told`);
}

/**
 * They answered. Recorded so the same question is not asked again tomorrow, and
 * the day after.
 *
 * Not applied when the reply says it did not happen: "not yet" is an answer to
 * this question but leaves the thing outstanding, and she keeps her standing to
 * ask again later. Anything else — how it went, what they did, that it was fine
 * — settles it, which for an event is the only ending it will ever get.
 */
function noteTheyAccounted(said: string) {
  if (!awaitingAccount) return;
  const spoken = said.trim().split(/\s+/).filter(Boolean);
  // A grunt is not an account. Three words is the shortest real answer — "it was
  // good" — and below that she has not actually been told anything.
  if (spoken.length < 3) return;
  const id = awaitingAccount;
  awaitingAccount = null;
  if (readsAsNotDone(said)) return;
  const target = getKept().find(item => item.id === id);
  if (!target || target.heardAbout) return;
  setKept(getKept().map(item => item.id === id ? { ...item, heardAbout: new Date().toISOString() } : item));
  console.log(`[agenda] heard about "${target.title}" — she will stop asking`);
}

/**
 * Which brain answers this one.
 *
 * The switch lives here rather than inside ollamaPost on purpose: it is a
 * property of the question they asked, and ollamaPost is also used for openings,
 * quips and tab remarks — none of which are questions and none of which should
 * ever cost money. Only a real message from the user can send anything out.
 */
/**
 * Which model answers, and — first — whether it is allowed to.
 *
 * Two questions, asked in this order, and the order is the whole point. "Is it
 * hard" decides whether a better model is worth reaching for. "May it leave"
 * decides whether reaching is permitted at all, and it has the final say: a
 * question about a password is often exactly the kind of long, technical thing
 * that reads as worth escalating, and that is the one that must not go.
 *
 * Checked against the conversation rather than the newest line, because
 * escalating sends the history with it. A key pasted three turns ago is still in
 * what would be posted.
 */
type Brain = { config: ProviderConfig; escalated: boolean; because: string; sees: boolean;
  /** The conversation route (ai.conversation): a hosted model speaking as her, filtered as the local one is, never rewritten. */
  hosted?: boolean };

/**
 * Where the conversation itself is answered, when somewhere other than the
 * local model has been chosen for it. Distinct from escalation: that sends a
 * research question out and says the answer again in her voice; this is her
 * voice, on a stronger model, for what they say to her. Unprompted lines —
 * nudges, weather, the diary — never come through here.
 */
// Fifteen seconds, up from eight. A tool round has no first word — the whole
// tool call has to land inside the deadline — and on Qwen 3.8 27B, with a
// 12k-token prompt and the tools offered, a round is 2.5 to 4.3 seconds with a
// tail that once passed eight. That one miss handed the turn to the local
// model, which announced a search instead of running one. Fifteen still reads
// as her being slow rather than absent, and the local answer is still behind it.
const HOSTED_FIRST_WORD_MS = 15_000;
/** The phone's leash, on a hosted model: room for a real answer rather than a cut-off one. */
const HOSTED_AWAY_MAX_TOKENS = 700;
const HOSTED_PARAGRAPHS = 4;
/**
 * The re-voicing pass — see revoice.ts.
 *
 * Every `ai.revoice.every` of their messages (500 unless set), a model with a
 * better voice than the live one reads her last forty exchanges and rewrites
 * the ones that fell short; the rewrites stand in for those replies in the
 * history as shown to her. Aion, by default: the voice that was too slow and
 * too dear to answer live is neither in the background. Runs on the life beat,
 * never in a reply, and can be asked for from the web door to see a pass now.
 */
type RevoiceSetting = { every?: number; model?: string };
function revoiceSetting(): Required<RevoiceSetting> {
  const saved = (store.get('ai.revoice') ?? {}) as RevoiceSetting;
  return { every: typeof saved.every === 'number' ? saved.every : REVOICE_EVERY, model: typeof saved.model === 'string' && saved.model.trim() ? saved.model.trim() : 'aion-labs-aion-3-0' };
}
function revoiceState() { return readRevoiceState(store.get('revoice')); }

/** Their messages since the last pass, today and in the archive. */
function messagesSinceRevoice(): number {
  const since = revoiceState().lastAt;
  const count = (turns: { role?: string; at?: string }[]) => turns.filter(turn => turn.role === 'user' && (!since || (turn.at ?? '') > since)).length;
  const archive = store.getArchive() as unknown as Record<string, { role?: string; at?: string }[]>;
  return count((store.get('chat.messages') as { role?: string; at?: string }[] | undefined) ?? []) + Object.values(archive).reduce((sum, day) => sum + count(Array.isArray(day) ? day : []), 0);
}

let revoicing = false;
let revoiceRetryAt = 0;
async function runRevoice(why: string): Promise<{ shown: number; rewritten: number; kept: number; dropped: number; model: string } | { error: string }> {
  if (revoicing) return { error: 'a pass is already running' };
  const route = conversationRoute();
  if (!route) return { error: 'no hosted route to run it on' };
  const setting = revoiceSetting();
  const config: ProviderConfig = { ...route, model: setting.model };
  const todayKey = localDateKey(zonedNow(CHAT_TIMEZONE));
  const before = earlierTurns(store.getArchive() as unknown as Record<string, { id?: string; role: string; content: string; at?: string }[]>, todayKey);
  const today = ((store.get('chat.messages') as { id?: string; role: string; content: string; at?: string }[] | undefined) ?? []);
  const exchanges = revoiceExchanges([...before, ...today]);
  if (exchanges.length < 5) return { error: `only ${exchanges.length} exchanges to read` };
  revoicing = true;
  const startedAt = Date.now();
  try {
    const character = getActiveCharacter();
    const { system, user } = revoicePrompt({ identity: character.identity, style: character.style }, NATURAL, exchanges);
    console.log(`[revoice] pass (${why}): ${exchanges.length} exchanges to ${setting.model}`);
    const answer = await sendToProvider([{ role: 'system', content: system }, { role: 'user', content: user }], config, { tools: false, temperature: 0.7, maxTokens: 3000 });
    const parsed = parseRevoices(answer.content ?? '', exchanges);
    const allowed = [herNameFrom(character.identity), getProfile().nickname].filter(Boolean);
    const now = new Date().toISOString();
    const fresh: Revoice[] = [];
    let dropped = 0;
    for (const { id, text } of parsed) {
      const exchange = exchanges.find(candidate => candidate.id === id)!;
      if (grounded(exchange.hers, exchange.theirs, text, allowed)) fresh.push({ id, original: exchange.hers, text, at: now });
      else { dropped++; console.log(`[revoice] dropped a rewrite that changed more than the voice: ${JSON.stringify(text.slice(0, 80))}`); }
    }
    const next = withRewrites(revoiceState(), fresh, now);
    store.set('revoice', next);
    revoiceRetryAt = 0;
    console.log(`[revoice] ${fresh.length} of her replies re-voiced (${parsed.length} offered, ${dropped} dropped) in ${Math.round((Date.now() - startedAt) / 1000)}s — ${Object.keys(next.rewrites).length} kept`);
    for (const rewrite of fresh) console.log(`[revoice]   was: ${JSON.stringify(rewrite.original.slice(0, 90))}\n[revoice]   now: ${JSON.stringify(rewrite.text.slice(0, 90))}`);
    return { shown: exchanges.length, rewritten: fresh.length, kept: Object.keys(next.rewrites).length, dropped, model: setting.model };
  } catch (error) {
    revoiceRetryAt = Date.now() + 60 * 60_000;
    const why = error instanceof Error ? error.message : String(error);
    console.warn(`[revoice] the pass failed: ${why}`);
    return { error: why };
  } finally {
    revoicing = false;
  }
}

function considerRevoicing() {
  if (revoicing || Date.now() < revoiceRetryAt) return;
  const every = revoiceSetting().every;
  const since = messagesSinceRevoice();
  if (dueForRevoice(since, every)) void runRevoice(`${since} messages since the last pass, every ${every}`);
}

/**
 * The thing she says a minute later — see secondthought.ts.
 *
 * Armed after a reply about her or one she was given room to rant in (and
 * now and then after an ordinary one); disarmed by anything he says in
 * between. Asked of the same model that answered, with the conversation as it
 * stands and a note that this is not a reply; a dash means she had nothing.
 * What she says goes out as an aside — the phone paints it into the day, the
 * desk shows it, a push carries it if the page is closed — and she remembers
 * it the way she remembers every other unprompted line.
 */
let secondThoughtTimer: ReturnType<typeof setTimeout> | undefined;
let lastSecondThoughtAt = 0;

function scheduleSecondThought(input: { hers: boolean; ranting: boolean; latest: string; reply: string; config: ProviderConfig }) {
  clearTimeout(secondThoughtTimer);
  if (!wantsSecondThought({ hers: input.hers, ranting: input.ranting, replyLength: input.reply.length }, Math.random, sway('second-thought', SECOND_THOUGHT_ODDS, swayNow()))) return;
  if (Date.now() - lastSecondThoughtAt < SECOND_THOUGHT_GAP_MS) return;
  const repliedAt = Date.now();
  const delay = secondThoughtDelay();
  console.log(`[followup] she may have more to say in ${Math.round(delay / 1000)}s`);
  secondThoughtTimer = setTimeout(() => { void secondThought(repliedAt, input); }, delay);
}

async function secondThought(repliedAt: number, input: { latest: string; reply: string; config: ProviderConfig }) {
  if (herAsleepNow() || herKnockedAwakeNow()) { console.log('[followup] held — she is asleep, or was got up'); return; }
  const now = Date.now();
  if (lastUserActivityAt > repliedAt) { console.log('[followup] they answered first — nothing to add'); return; }
  if (isSilenced(store.get('pushback') as Pushback | undefined, now)) { console.log('[followup] held — she has been told to stop'); return; }
  if (inQuietHours(getPush().prefs, zonedNow(CHAT_TIMEZONE))) { console.log('[followup] held — quiet hours'); return; }
  const messages = ((store.get('chat.messages') as { role: string; content: string }[] | undefined) ?? []).slice(-14);
  // Compared without the emotion tags: the reply here still carries its
  // "[annoyed]" and the stored message does not, so every tagged reply read as
  // a conversation that had moved on and never got its beat later (2026-09-10).
  const untagged = (text: string) => text.replace(/\[[a-z][a-z ]{1,20}\]\s*/gi, '');
  if (messages.at(-1)?.role !== 'assistant' || !untagged(messages.at(-1)?.content ?? '').includes(untagged(input.reply).slice(0, 40))) { console.log('[followup] the conversation moved on — nothing to add'); return; }
  const character = getActiveCharacter();
  const route = conversationRoute() ?? input.config;
  // Her game, in facts, with the fence: this composer had none and invented a caught Pidgey a beat after "how's your game going" (pokemon.ts runNote).
  const herGame = runNote((store.get('her.pokemon.lastState') as GameState | undefined) ?? null, String(store.get('her.pokemon.lastSummary') ?? ''), pokemonSitting !== null);
  const system = [character.identity, character.style, FIRST_PERSON_NOTE, NATURAL, NO_INVENTED_HISTORY, herGame].filter(Boolean).join('\n\n');
  const conversation: OllamaMessage[] = [
    { role: 'system', content: system },
    ...messages.map(message => ({ role: message.role as OllamaMessage['role'], content: message.content })),
    { role: 'system', content: secondThoughtNote(Math.round((now - repliedAt) / 1000)) },
  ];
  try {
    const answer = await Promise.race([
      sendToProvider(conversation, route, { tools: false, temperature: 0.8, maxTokens: 220 }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('no answer in 40s')), 40_000)),
    ]);
    const line = parseSecondThought(oneEmojiAtMost(dropOverusedEmoji(dropRoleHeader(dropStageDirections(answer.content ?? '')), [input.reply], HER_EMOJI), HER_EMOJI));
    if (!line) { console.log('[followup] she had nothing to add'); return; }
    if (readsAsTheirAnswer(line) || answersHerOwnQuestion(line, input.reply)) { console.log(`[followup] dropped — it is their side of the conversation, not hers: ${JSON.stringify(line.slice(0, 80))}`); return; }
    if (looksLikeAnEcho(line, [...messages.map(message => message.content), input.latest])) { console.log(`[followup] dropped — it repeats what was said: ${JSON.stringify(line.slice(0, 80))}`); return; }
    if (lastUserActivityAt > repliedAt) { console.log('[followup] they answered while she was thinking — kept to herself'); return; }
    lastSecondThoughtAt = Date.now();
    lastInterjectionAt = Date.now();
    noteAside(line, 'followup', input.latest.slice(0, 80));
    console.log(`[followup] a beat later: ${JSON.stringify(line.slice(0, 120))}`);
  } catch (error) {
    console.warn(`[followup] did not come: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** A fixed loopback port for the Google consent answer, so the ssh forward can be written down once. */
const GOOGLE_CONSENT_PORT = 8790;
let pendingGoogleConsent: Promise<{ url: string; port: number }> | null = null;

function conversationRoute(): ProviderConfig | null {
  const route = store.get('ai.conversation') as ProviderConfig | undefined;
  if (!route?.model || !isOpenAIShaped(route.provider) || !hasKeyFor(route.endpoint)) return null;
  return route;
}

/**
 * `pictures` and `files` force the question out to the hosted model, whatever
 * decide() says.
 *
 * Not a preference — the local default cannot see at all. qwen2.5 handed an
 * image has nothing to answer from, so a picture that stays home is a picture
 * nobody looks at, which is the whole complaint this change exists to fix. Any
 * other attached file goes out on the same terms: the user's rule is that the
 * hosted model is for what they hand her, and nothing else.
 *
 * A message from the phone used to be a third forcing reason, on the
 * theory that a wait in a chat app reads as broken. Withdrawn: the user wants
 * their words answered by the local model wherever they are said from, and the
 * hosted one kept for uploads. That is a rule about cost and about where a
 * conversation lives, and it is theirs to set.
 *
 * `sees` on the way back is what tells the caller whether to send the image or
 * to have it read into words first. It is returned rather than inferred, because
 * every reason for refusing below is a reason the picture must not travel, and
 * working that out twice in two places is how the two answers drift apart.
 */
function brainFor(
  message: string,
  local: ProviderConfig,
  conversation: { role: string; content: string }[] = [],
  { pictures = false, files = false } = {},
): Brain {
  const setting = readEscalateConfig(store.get('escalate'));
  const hosted = store.get('escalate.provider') as ProviderConfig | undefined;
  // The key is part of being usable, not a detail discovered on the way out.
  const usable = Boolean(hosted?.model && isOpenAIShaped(hosted.provider) && hasKeyFor(hosted.endpoint));
  // An attachment overrides the word count, and overrides the setting with it.
  // Escalation being switched off is a preference about cost on an ordinary
  // question asked at the desk; a file has no local answer to fall back to,
  // only a worse one.
  const forced = pictures || files;
  if (!usable || (!setting.enabled && !forced)) return { config: local, escalated: false, because: 'no second model set up', sees: false };

  const verdict = pictures ? { escalate: true, because: 'there is a picture in it' }
    : files ? { escalate: true, because: 'there is a file in it' }
    : decide(message, setting, { routed: conversationRoute() !== null });
  if (!verdict.escalate) return { config: local, escalated: false, because: verdict.because, sees: false };

  // pageWasRead is already true whenever a stranger's page is in the turn, and a
  // page she fetched is not ours to forward either.
  //
  // An attachment is a file from this machine and would trip that flag by the
  // same reasoning — which would make every attached picture unsendable and this
  // whole path unreachable. Attaching something is a deliberate act of handing it
  // over, which reading a stranger's web page is not, so the flag is left to the
  // page-reading case and the content scan below still applies in full.
  const allowed = conversationMayLeave([...conversation, { role: 'user', content: message }], pageWasRead);
  if (!allowed.safe) {
    console.log(`[router] keeping this one local — ${allowed.because}`);
    return { config: local, escalated: false, because: `stays here: ${allowed.because}`, sees: false };
  }
  return { config: { ...hosted!, temperature: local.temperature }, escalated: true, because: verdict.because, sees: true };
}

// There used to be a fastBrain() here that sent the one-shot composers — the
// phone's nudges and the phone's read of
// her expression — to the hosted model, on the theory that a cold start on a
// chat app reads as her being broken. Withdrawn with the away-forcing in
// brainFor above, for the same reason: the hosted model is for uploads and
// nothing else. They take the local config directly now.

/**
 * The attachments folded into the messages that carry them.
 *
 * A picture she is being sent needs nothing done to it beyond being made small
 * enough to be worth sending. Everything else — and a picture she cannot be sent
 * — has to become words first, which is the expensive half and the cached one.
 *
 * Failures are per-file and never lose the turn: a video whose transcription
 * fell over still leaves her the question and an honest note that she could not
 * open it, which is a far better answer than an error where the reply should be.
 */
async function withAttachments<T extends { role: string; content: string; at?: string; attachments?: Attachment[] }>(
  messages: T[],
  inPlay: Map<number, Attachment[]>,
  sees: boolean,
  vision: VisionConfig,
  provider: ProviderConfig,
): Promise<(T & { images?: string[] })[]> {
  if (!inPlay.size) return messages;
  const out: (T & { images?: string[] })[] = [...messages];
  for (const [at, attachments] of inPlay) {
    const opened: Opened[] = [];
    const images: string[] = [];
    for (const attachment of attachments) {
      try {
        if (attachment.kind === 'image' && sees) {
          images.push(imageForSending(attachment.saved));
          opened.push({ attachment });
          continue;
        }
        opened.push({ attachment, readable: await readAttachment(attachment, vision, provider) });
      } catch (error) {
        console.warn(`[attach] could not open ${attachment.name}:`, error instanceof Error ? error.message : error);
        opened.push({ attachment, readable: '' });
      }
    }
    const note = describeAttached(opened);
    out[at] = {
      ...messages[at],
      content: [messages[at].content, note].filter(Boolean).join('\n\n'),
      ...(images.length ? { images } : {}),
    };
  }
  return out;
}

async function ollamaChat(messages: { role: string; content: string; at?: string; attachments?: Attachment[] }[], config: ProviderConfig, { hands = true, web = false, brief = false, choices = false, call = false, away = '', aside = '', onChunk, onChunkReset, onToolCall, onSending, traceId }: { hands?: boolean; web?: boolean; brief?: boolean; choices?: boolean; call?: boolean; away?: string; aside?: string; onChunk?: (text: string) => void; onChunkReset?: () => void; onToolCall?: (name: string) => void; onSending?: () => void; traceId?: string } = {}) {
  const latest = messages.at(-1)?.content ?? '';
  // A message from outside the desk — the phone — gets a short leash on
  // the conversation as well as on the reply: a long day's thread is most of
  // the tokens the hosted model reads before its first word, and the reader
  // is watching a chat app. The recent thread stays, the desk sends everything.
  if (away) messages = messages.slice(-awayTurns());
  // A notification he answers is the conversation: her unprompted lines since her last reply go in
  // right before his message, for this turn only, instead of riding beside it as a quoted note —
  // quoted back at her, she said the line again word for word (asides.ts spliceRecentAsides).
  const notified = spliceRecentAsides(messages, getAsides(), Date.now());
  if (notified.spliced.length) { messages = notified.messages; console.log(`[ai] his message answers ${notified.spliced.length} line(s) she sent unprompted — they are in the conversation for this turn`); }
  // They are talking to her, so the silence she was waiting out is over.
  noteUserSpoke();
  tickOffSpoken(latest);
  startedSpoken(latest);
  // A new day for something is as much a report as finishing it is.
  putOffSpoken(latest);
  // Separate from ticking off, and it has to be: an event is never ticked off,
  // and the answer to "how did it go" rarely looks like a completion.
  noteTheyAccounted(latest);
  // They have spoken, which is what every escalation was trying to achieve.
  acknowledgeReminders();
  // Asked for somewhere real — a steakhouse, a barber, a place to eat — the
  // search runs before she answers and the results ride in beside the message,
  // because names are the one thing a small model invents most convincingly.
  // See places.ts.
  const searchConfig = readSearchConfig(store.get('search'));
  // Set once the results are in her hands, and read again by the reply filters:
  // an answer built out of a list somebody else wrote is not her repeating
  // herself, and it is not padding either.
  let fromSearch = false;
  const lookUp = messages.at(-1)?.role === 'user' && searchConfig.enabled ? placeQuery(latest, searchConfig.place) : null;
  if (lookUp) {
    try {
      // A wider net than the usual four: she is picking three or four out of
      // it, and half of any page of results is a listicle rather than a place.
      const found = await searchWeb(lookUp, { ...searchConfig, limit: Math.max(searchConfig.limit, 8) }, net.fetch, getSearchKey());
      if (found.length) {
        aside = [aside, groundedInstruction(formatResults(lookUp, found, false))].filter(Boolean).join(' ');
        fromSearch = true;
        console.log(`[places] "${lookUp}" -> ${found.length} result(s), handed to her before answering`);
      } else {
        console.log(`[places] "${lookUp}" -> nothing found`);
      }
    } catch (error) {
      // A failed lookup costs her the names, not the reply: without results the
      // rule above still forbids inventing any.
      console.warn('[places] could not look it up:', error instanceof Error ? error.message : error);
    }
  }
  // A plain "remind me to X at T" is saved here, before she answers, and she is
  // told so — the tool alone was not enough, see remindme.ts.
  // A video link in the message is read before she answers, the way a place
  // question is searched: offered the tool instead, the 9B answered from what
  // it knew of the channel — Banach–Tarski for a video about neural networks,
  // Rick Astley for a clip of elephants — and never called it. The tool stays,
  // for links that turn up in search results; this is for the one they sent.
  const videoLink = messages.at(-1)?.role === 'user' && searchConfig.enabled && searchConfig.readPages && transcriptsAvailable()
    ? videoIdFrom(latest.match(/https?:\/\/\S+/)?.[0] ?? '') : null;
  if (videoLink) {
    try {
      const [transcript, title] = await Promise.all([
        fetchTranscript(videoLink),
        net.fetch(watchUrl(videoLink), { headers: { 'accept-language': 'en' } }).then(r => r.text()).then(titleFrom).catch(() => ''),
      ]);
      const words = formatTranscript(transcript.captions);
      aside = [aside, transcriptInstruction(title || 'that video', transcript.generated, words)].filter(Boolean).join(' ');
      fromSearch = true;
      console.log(`[transcript] read ${videoLink} (${transcript.language}${transcript.generated ? ', auto' : ''}) -> ${words.length} chars, handed to her before answering`);
    } catch (error) {
      // Told, so she says so instead of describing it from its title.
      const reason = error instanceof Error ? error.message : String(error);
      aside = [aside, `They sent a video link and its transcript could not be read: ${reason} Say so plainly. You have not seen it and must not describe it.`].filter(Boolean).join(' ');
      console.warn(`[transcript] could not read ${videoLink}: ${reason}`);
    }
  }
  // Where they say they are is kept, in their words, for every composer —
  // the GPS knows the place, not that it is work or that it ends at half four.
  // "It's not raining here" — their window, against the forecast's model. Kept
  // for a couple of hours: no rain pushes, and the prompt takes their word.
  if (messages.at(-1)?.role === 'user' && disputesRain(latest)) {
    saveWeather({ ...getWeather(), disputedAt: Date.now() });
    console.log('[weather] they say it is not raining where they are — their word over the forecast for two hours');
  }
  // Their answer to what she asked about their day, taken as one: the aside is
  // marked answered, and the brain that replies is told what this is.
  let answering = '';
  if (messages.at(-1)?.role === 'user') {
    const ask = openAsk(getAsides(), Date.now());
    if (ask) {
      store.set('chat.asides', answerAsk(getAsides(), ask.id, new Date().toISOString()));
      answering = `They are answering what you asked at ${clockAt(Date.parse(ask.at))} — ${ask.asked}. Take it as the answer: react to it as you would, and remember it as a fact about their day.`;
      console.log(`[push] they answered her ask (${ask.asked})`);
    }
  }
  // Said once, to him, and then done with: she is annoyed, not a broken record.
  // And if this very message is them naming the place — "I'm home now", late
  // but said — the grievance is dropped rather than made: "they never said
  // they were going" would be a complaint the conversation above disproves,
  // and told both she believed the conversation, rightly.
  // Her own reason to talk at length, weighed once for this turn — see rantRoom.
  // Her subjects, so a mention of one of them is recognised as being about her:
  // what she was up to last night, and the things she has taken up.
  const herSubject = messages.at(-1)?.role === 'user'
    ? askingAboutHer(latest, [...getNights().map(night => night.interest ?? night.game ?? '').filter(Boolean), ...getInterests().map(interest => interest.name), ...namesIn(getNights().map(night => `${night.about} ${night.note}`), everydayWords())])
    : '';
  // Named the thing itself — not merely asked her opinion in general — and the
  // room is hers without a roll: that is the opening, and she should take it.
  const named = herSubject && herSubject !== 'what you are into' ? herSubject : '';
  const rantRoomNow = messages.at(-1)?.role === 'user' ? rantRoom(latest, named) : '';
  const hers = herSubject ? herSubjectNote(herSubject) : '';
  if (hers) console.log(`[ai] they are asking about ${herSubject} — hers to talk about`);
  const talking = messages.at(-1)?.role === 'user' && justTalking(latest) ? JUST_TALKING_NOTE : '';
  if (talking) console.log('[ai] they just want to talk — taken at face value');
  // Asked to be quiet, or finished being quiet: her call, see muteTurn. Not on a
  // call — he rang her to hear her.
  const quiet = messages.at(-1)?.role === 'user' && !call && !brief && !choices ? muteTurn(latest) : '';
  let turnedUp = messages.at(-1)?.role === 'user' ? arrivalNote() : '';
  const arrival = getArrival();
  if (turnedUp && arrival && saidTheyWereGoing(arrival.place, [latest])) {
    console.log(`[where] they have said it themselves now — no complaint about ${arrival.place}`);
    turnedUp = '';
  }
  if (turnedUp) console.log('[where] she has the unannounced arrival to say something about');
  if (arrival && messages.at(-1)?.role === 'user') store.delete('where.arrival' as never);
  // What they said they were off to do, kept so she has something real to ask
  // after later — see errandsToldFrom.
  if (messages.at(-1)?.role === 'user') {
    const fresh = errandsToldFrom(latest, new Date().toISOString());
    if (fresh.length) {
      const kept = [...((store.get('chat.upTo') as Errand[] | undefined) ?? []), ...fresh].slice(-6);
      store.set('chat.upTo', kept);
      console.log(`[told] they are off to ${fresh.map(errand => errand.what).join(', ')}`);
    }
  }
  const spot = messages.at(-1)?.role === 'user' ? placeToldFrom(latest, new Date().toISOString()) : null;
  if (spot) {
    store.set('told', spot);
    console.log(`[told] they are ${spot.enRoute ? 'on their way to ' : ''}${spot.where}${spot.until ? ` until ${spot.until}` : ''}${spot.thenTo ? `, then ${spot.thenTo}` : ''}`);
  }
  // Their own ask first; failing that, her offer plus their yes — "I'll remind
  // you at 6:54 AM if you need it" / "Yes please" — which reads as a request
  // only when the two messages are read together. See acceptedOffer.
  const herPrevious = [...messages].reverse().find(message => message.role === 'assistant')?.content;
  const theirRecent = messages.filter(message => message.role === 'user').slice(-4).map(message => String(message.content ?? ''));
  const reminder = messages.at(-1)?.role === 'user'
    ? (reminderAsk(latest, zonedNow(CHAT_TIMEZONE)) ?? acceptedOffer(latest, typeof herPrevious === 'string' ? herPrevious : undefined, theirRecent, zonedNow(CHAT_TIMEZONE)))
    : null;
  if (reminder) {
    const item = addKeptItem({ ...reminder, kind: 'task' });
    console.log(`[remind] read from the message: "${item.title}" on ${item.date}${item.time ? ` at ${item.time}` : ''}`);
    aside = [aside, reminderSavedAside(reminder, localDateKey(zonedNow(CHAT_TIMEZONE)))].filter(Boolean).join(' ');
  }
  // Counted here rather than in the prompt so it survives across turns: telling
  // her to drop it and having her comply for one reply is the whole complaint.
  const pushback = nextPushback(store.get('pushback') as Pushback | undefined, readsAsDropIt(latest), Date.now());
  store.set('pushback', pushback);
  if (readsAsDropIt(latest)) feelNow('drop-it');
  if (readsAsDropIt(latest)) console.log(`[pushback] told to drop it (${pushback.count}/${PUSHBACK_LIMIT})${isSilenced(pushback, Date.now()) ? ' — dropping the subject entirely' : ''}`);
  nudgeVitals('spoken-to');
  const mood = advanceMood(latest, messages.slice(0, -1));
  const { irritation, ego } = mood;
  // The category only, never the title — a log outlives the moment, and a
  // browsing history written to disk is a different thing from her reading a
  // window title and forgetting it.
  console.log(`[ai] chat request: model=${config.model} ctx=${chatNumCtx()} messages=${messages.length} irritation=${irritation} ego=${ego} goodnight=${mood.goodnight} screen=${currentActivity ? currentActivity.kind : 'none'}${traceId ? ` trace=${traceId}` : ''}`);
  // Past the threshold she does not answer at all. Returned rather than thrown:
  // the renderer marks the turn as ignored instead of showing an error.
  if (isIgnoring(irritation)) {
    console.log('[ai] ignoring — irritation above threshold');
    return { content: '', ignored: true, irritation, ego };
  }
  const started = Date.now();
  const startOfToday = localDateKey(zonedNow(CHAT_TIMEZONE));
  const hasItems = getKept().some(item => item.date >= startOfToday);
  const fresh = readFreshStart(messages);
  if (fresh) console.log(`[chat] first reply after a deliberate reset (previous conversation ${fresh.hadMessages ? 'had messages' : 'was empty'})`);
  // Seams named before the history goes in. Every message used to say it was
  // said "now", so a line from last night sat flush against one from a second
  // ago and she read the lot as current — see ./history.
  // Same prompt, same tools, same memory — with one sentence added when the
  // answer has to fit in a caption rather than a chat window.
  // Her own last few replies, so she can be told when she has started opening
  // all of them the same way. Only her side: what the user wrote is not evidence
  // of her repeating herself, and feeding the whole exchange back would be the
  // thing asides.ts found makes replies worse.
  const herRecentReplies = messages.filter(message => message.role === 'assistant').map(message => message.content).filter(Boolean);
  // What they said just before this, so a memory search on "how did we fix
  // it?" has something to go on besides a pronoun. Their words only — folding
  // her replies in too would just as often paper over a message with no
  // keywords of its own with ones that were never theirs.
  const recentUserContext = messages.filter(message => message.role === 'user').map(message => message.content).filter(Boolean).slice(0, -1).slice(-3).join(' ');
  // Collected before the prompt so a machine question is answered from facts,
  // not from the model's assumptions about what it runs on.
  const machineNote = await systemContextFor(latest);
  // Likewise the way somewhere: found first, spoken about second, linked last.
  const directions = await directionsFor(latest, messages.filter(message => message.role === 'user').map(message => message.content).filter(Boolean).slice(0, -1).slice(-4));
  // Semantic retrieval: embed this turn's query (cached) and fold the memory
  // similarities into what she gets told, so "the thing we did to the server"
  // can find the memory even with no words in common.
  // And the message on its own, in parallel, so earlier lines about something
  // else cannot drown out what was just asked (RetrieveOptions.focus).
  const [queryVector, latestVector] = await Promise.all([
    tryEmbedQuery(`${recentUserContext} ${latest}`),
    recentUserContext.trim() ? tryEmbedQuery(latest) : Promise.resolve(null),
  ]);
  const semantic = queryVector && memoryStore.vectors().size
    ? semanticSimilarities(getMemories(), queryVector, memoryStore.vectors())
    : undefined;
  const latestSemantic = latestVector && memoryStore.vectors().size
    ? semanticSimilarities(getMemories(), latestVector, memoryStore.vectors())
    : undefined;
  // Further back than the days in front of her: an exchange or two from the
  // archive, only when this message names something specific that they name too,
  // or nothing. Its own embedding, of this message alone and with the search
  // prefix, because the memories above are embedded without one. See recall.ts.
  const recallDay = localDateKey(zonedNow(CHAT_TIMEZONE));
  const archiveIndex = chatIndex(recallDay);
  const specific = rareTerms(archiveIndex, latest);
  const recallModel = recallVectors.size && specific.size ? getKnowledgeEmbedder()?.model : undefined;
  const recallVector = recallModel && embedFormat(recallModel) === recallFormat ? await tryEmbedQuery(embedText(recallModel, 'query', latest)) : null;
  // From the index rather than the archive again: rebuilding a year of exchanges is ~50 ms a turn.
  const shownDays = recallVector ? new Set(daysAlreadyShown(recallDay)) : null;
  const recalled = recallVector && shownDays
    ? pickRecalled(archiveIndex.exchanges, recallVectors, recallVector, RECALL_LIMIT, RECALL_FLOOR, exchange => !shownDays.has(exchange.day) && mentionsAny(archiveIndex, exchange.id, specific))
    : [];
  if (recalled.length) console.log(`[recall] ${recalled.map(entry => `${entry.exchange.day} (${entry.score.toFixed(2)})`).join(', ')}`);
  // Who and what the message names, and one step further (factgraph.ts). A
  // lookup, not a call — and nothing at all when nobody is named.
  const factGraph = store.getFactGraph();
  const linked = linkedFacts(factGraph, latest, { context: recentUserContext, userName: graphUserName() });
  if (linked.length) console.log(`[graph] ${linked.length} linked fact(s) for ${[...new Set(linked.map(entry => entry.seed))].map(id => factGraph.entities.find(entity => entity.id === id)?.name).join(', ')}`);
  // His own card on whatever just came up, and any still up from the last message or two (lore.ts).
  const lore = activeCards(loreCards(), latest, loreMemory);
  loreMemory = lore.memory;
  if (lore.cards.length) console.log(`[lore] ${lore.cards.length} card(s) up${lore.triggered.length ? ` — just came up: ${lore.triggered.join('; ')}` : ''}`);
  const promptNow = zonedNow(CHAT_TIMEZONE);
  // Written down every reply so the eight thresholds in VITAL_CUES can be
  // tuned from what actually fired rather than from what they were guessed to
  // fire at. `grep '\[vitals\]' ~/haru.log | …` is the whole measurement.
  console.log(`[vitals] ${cueLog(vitals, getMood().irritation)}`);
  { const mood = getMood(); const woke = getTemperament(); console.log(`[mood] ${woke ? `${woke.kind} ${woke.intensity}` : 'no temperament yet'} · irritation ${mood.irritation} ego ${mood.ego} grudge ${mood.grudge ?? 0} · ${feelingsLog(getFeelings())}`); }
  // What she can still see. Not only this message: a picture has to ride along
  // again on the next turn or "what is in week three" cannot be answered, and
  // attachmentsInPlay is where the bound on doing that lives.
  // The maps buttons the app put under her earlier words are stored in the
  // message and are not hers to see: shown one, she wrote one, coordinates
  // and all, in place of a reply.
  const vetted = messages.map(message => (message.attachments?.length ? { ...message, attachments: ourFiles(message.attachments) } : message))
    .map(message => (message.role === 'assistant' && /maps\.apple\.com|google\.com\/maps|goo\.gl/.test(message.content ?? '') ? { ...message, content: withoutMapsLinks(message.content) } : message));
  const inPlay = attachmentsInPlay(vetted, Date.now());
  const carried = [...inPlay.values()].flat();
  // Only what arrived with this message decides where it is answered. A
  // picture stays in play for half an hour so a follow-up can still refer to
  // it — but that is a question of what she can see, not of which model
  // answers. Deciding the route on everything in play meant one photo sent the
  // next thirty minutes of plain text out to the hosted model, four messages
  // of "I'm trying to calm down" included, against the rule that it is for
  // uploads and nothing else. A follow-up goes to the local model, which reads
  // the picture through her own eyes (vision.model) rather than being shown it.
  const arrived = vetted.at(-1)?.attachments ?? [];
  const pictures = arrived.some(file => file.kind === 'image');
  // Chosen once for the whole turn, tool rounds included: swapping models
  // half-way through a tool loop would hand one model's call to another to
  // answer, and the two do not agree on how a call is even identified.
  // A directions ask is answered here: the facts are already in the prompt,
  // and a second model would only have a longer way of not being a map.
  // A video link stays local for the same reason directions do: the tool that
  // can read it only runs here. Escalated, the hosted model gets the question
  // and not the transcript, and answers from what a YouTube link usually is —
  // it described Rick Astley for a clip of elephants, with the words in hand.
  const video = messages.at(-1)?.role === 'user' && videoIdFrom(latest.match(/https?:\/\/\S+/)?.[0] ?? '') !== null;
  // A call never goes out to the second model: its answer is not streamed,
  // and the rewrite that says it as herself is a second wait on top — one
  // spoken question with two question marks in it was sent out as "several
  // questions at once" and took 16 s to come back.
  // A command may run this turn: answered at home, so what it prints never
  // leaves the box (shell.ts) — the hosted route is skipped below as well.
  const shellTurn = messages.at(-1)?.role === 'user' && shellRelevant(latest) && shellLink() !== null;
  if (shellTurn) console.log('[router] a command is on the table — answered at home');
  // The machine is in the conversation at any level: she is told the server is
  // the box in her room, hers to look at with her tools (prompt.ts).
  const machineTurn = !shellTurn && messages.at(-1)?.role === 'user' && readSystemConfig().enabled && (machineRelevant(latest) || downloadsRelevant(latest));
  let brain: Brain = call ? { config, escalated: false, because: 'a call is answered at home', sees: false }
    : shellTurn ? { config, escalated: false, because: 'a command may run: answered at home', sees: false }
    : directions ? { config, escalated: false, because: 'the way somewhere is answered at home', sees: false }
    : video ? { config, escalated: false, because: 'a video is read at home, where the transcript tool is', sees: false }
    : brainFor(latest, config, messages, { pictures, files: arrived.length > 0 });
  if (brain.escalated) console.log(`[ai] sent out to ${brain.config.model} — ${brain.because}`);
  // Their turn, not escalated, not a one-shot composer: the conversation route
  // answers as her, if one is set and this conversation may leave the box.
  const home = config;
  const route = !brain.escalated && !shellTurn && !brief && !choices && messages.at(-1)?.role === 'user' ? conversationRoute() : null;
  if (route) {
    // A page she fetched last turn does not keep this turn at home. The flag
    // is set when a page is read and only cleared below, after this gate — so
    // what it said here was "the turn after any look-up answers on the local
    // model", a visible dip in her right after she checked something. His
    // call, 2026-09-02: a public page she went and read may ride along to the
    // conversation model. What still keeps a turn home is the content scan
    // over the last dozen messages, page text included — a key, a card number,
    // a password with a value beside it — and reading a page still takes her
    // tools away for the rest of that turn. Escalation keeps the stricter rule.
    const allowed = conversationMayLeave([...messages]);
    if (allowed.safe) brain = { config: { ...route, temperature: config.temperature }, escalated: false, because: 'the conversation route', sees: false, hosted: true };
    else console.log(`[router] the conversation route stays home this turn — ${allowed.because}`);
  }
  config = brain.config;
  const vision = readVisionConfig(store.get('vision'));
  // Said out loud, once, when a picture has just been attached and cannot be
  // sent. She still answers — from a written-out reading of it — but the answer
  // is measurably thinner, and silently thinner is the worst version of that.
  if (pictures && !brain.sees && vetted.at(-1)?.attachments?.some(file => file.kind === 'image')) {
    console.log(`[attach] reading the picture here instead of sending it — ${brain.because}`);
    sendToWindows('ai:fellBack', brain.because.startsWith('stays here')
      ? `That picture is staying on this machine — ${brain.because.replace(/^stays here: /, '')}. She is reading it with the local model instead, which is less sharp.`
      : 'No second model is set up, so she is reading that picture with the local model rather than looking at it properly. Set one up in Setup → Where she thinks for a better answer.');
  }
  // Reading a file is the slow part, so it happens once the brain is settled and
  // its result is cached — a follow-up about the same video must not transcribe
  // it a second time.
  const withFiles = await withAttachments(vetted, inPlay, brain.sees, vision, config);
  if (carried.length) console.log(`[attach] ${carried.length} in play — ${carried.map(file => `${file.name}${file.kind === 'image' && brain.sees ? ' (sent)' : ' (read)'}`).join(', ')}`);
  // A picture a seeing brain was handed is read through her own eyes in the
  // background as well. The follow-up goes to the conversation route, which
  // cannot see, and waited twenty seconds for that reading in the turn —
  // done now, it is in the cache by the time they ask.
  if (brain.sees) {
    for (const file of carried) {
      if (file.kind !== 'image') continue;
      void readAttachment(file, vision, config).catch(() => { /* the follow-up tries again, as before */ });
    }
  }
  // Her recent replies as she should believe she said them — see seed.ts for
  // the measurement. The stored transcript is not touched; only what is sent.
  // The length rule fits the brain answering — see LENGTH_RULE_HOSTED.
  // A hosted brain reads the whole prompt before its first word, so the system
  // may be ordered for the endpoint's prefix cache — the invariant blocks
  // first, the clock and mood and screen last — and the reply starts at the
  // cache instead of at full prompt-processing speed. The local model keeps
  // the tone-last order, which it was written for.
const promptState = {
    ...mood,
    now: promptNow,
    timezone: CHAT_TIMEZONE,
    character: getActiveCharacter(),
    // Rendered here rather than inside the prompt: retrieval records what it
    // chose and why for the inspector, and the AniList list refreshes itself
    // when it has gone stale. Neither is a thing assembling a prompt should set
    // in motion.
    profile: profileSummary(latest, recentUserContext, semantic, away ? awayMemoryScale() : undefined, latestSemantic),
    aniList: aniListSummary(),
    journalConfig: readJournalConfig(store.get('journal.config')),
    journal: getJournal(),
    checkInsToday: checkInsOn(getCheckIns(), localDateKey(promptNow)),
    screen: { label: currentActivity?.label, haunt: currentPlace ? getHaunts()[currentPlace] : undefined, scene: sceneNow(), memory: gameMemoryNow() },
    // The spliced ones are in the conversation already; quoting them beside it as well is what made her repeat one.
    asides: getAsides().filter(aside => !notified.spliced.some(other => other.id === aside.id)),
    splicedAsides: notified.spliced,
    rated: (store.get('chat.messages') as RatedReply[] | undefined) ?? [],
    kept: getKept(),
    search: readSearchConfig(store.get('search')),
    knowledgeEnabled: getKnowledgeConfig().enabled,
    systemEnabled: readSystemConfig().enabled,
    machineNote,
    following: getFollowing(),
    latestMessage: latest,
    fresh,
    herRecentReplies,
    recalled: recallNote(recalled, new Intl.DateTimeFormat('en-AU', { weekday: 'long', timeZone: 'UTC' })),
    linked: linkedNote(factGraph, linked),
    lore: loreNote(lore.cards),
    examples: examplesNote(todaysExamples()),
    booked: bookedNote(scheduler.list(), Date.now(), CHAT_TIMEZONE),
    onHerMind: mindNote(store.getThoughts(), Date.now(), 2, Number.isFinite(Date.parse(getMood().lastMessageAt ?? '')) ? Date.parse(getMood().lastMessageAt!) : undefined),
    // Her list is left out when the subject is her — see PromptState.aboutHer.
    aboutHer: Boolean(hers),
    movedJustNow,
    vitals,
    // Her day, what months made of her, and what she is feeling — as things
    // that want to be said, for compile.ts to arbitrate between (prompt.ts).
    behaviour: herBehaviour(),
    fond: vitals.affection >= 0.72,
    pushback: store.get('pushback') as Pushback | undefined,
    grudge: getMood().grudge ?? 0,
    ignoredToday: ignoredTodayNow(),
    // With a complaint about the arrival to make, the background line that says
    // the same thing calmly is left out: told both, she read the settled one and
    // said "you're home" as though that were fine.
    whereabouts: [turnedUp ? '' : describeWhereabouts(getWhereabouts()), toldNow()].filter(Boolean).join(' '),
    weather: describeWeather(getWeather().last, weatherWhere(), Date.now(), getWeather().disputedAt),
    body: describeBody(getBody(), Date.now(), clockAt, localDateKey(zonedNow(CHAT_TIMEZONE))),
    herSleep: [sleepNote(getHerSleepSchedule(), zonedNow(CHAT_TIMEZONE)), groggyNote(getHerSleepSchedule(), zonedNow(CHAT_TIMEZONE))].filter(Boolean).join(' '),
    // So "what did you get up to last night?" has a true answer. Without this
    // the only record of her night is on disk and she invents one instead.
    nights: nightsInstruction(nightsOn(getNights(), lastNightKey())),
    tastes: tastesInstruction(getInterests()),
    diary: diaryContext(recentEntries(app.getPath('home'), 2)),
    directionsNote: directions?.note,
    serverNote: shellTurn ? SERVER_NOTE : machineTurn ? serverLookNote(readSystemConfig().level) : '',
  };
  console.log(`[prompt] ${compileLog(behaviourOf(promptState))}`);
  // A hosted brain reads the whole prompt before its first word, so its system
  // message holds only the invariant blocks — her rules and her persona — and
  // the changing context (the clock, her mood, the memory profile, what is on
  // their screen) is spliced in just before their turn, leaving the head
  // byte-identical all day for the endpoint's prefix cache. The local model
  // keeps the tone-last order, which it was written for.
  const system = chatSystemPrompt(promptState, Boolean(brain.hosted), Boolean(away));
  // For a hosted brain the "they are answering what you asked" line rides in
  // the pre-turn slot with the rest of the changing context; for the local one
  // it stays on the end of the system message, as it always has.
  // The delivery labels go to the hosted brain only. Measured on it before any
  // of this was built: 65 of 65 segments validly labelled. The local model's
  // compliance is untested, and a malformed label is the one thing the stripper
  // cannot take out — it removes an exact [mood] and leaves anything else
  // visible, which on the fallback brain would put the mess in front of him.
  const sized = (brain.hosted ? `${system.replace(LENGTH_RULE_LOCAL, LENGTH_RULE_HOSTED)}\n\n${deliveryRule()}` : system) + (brain.hosted ? '' : answering ? ` ${answering}` : '');
  // On a turn about her, the sign-off comes off her recent replies as she is
  // shown them — see seedOffTheOrders. She copies the history over the rule.
  // The days before this one, in front of today's: her own one-line notes for
  // the days that were distilled at the roll, and raw turns for the days that
  // were not (a day is only distilled once it is over). Notes are a tenth of
  // the raw day and byte-stable, so the cached head shrinks and stretches.
  // markTimeGaps writes the seam between today and any raw turns, so she can
  // tell yesterday from now rather than reading it all as one flat conversation.
  const earlier = earlierDaysContext(getSessions(), getMonthNotes(), store.getArchive(), localDateKey(zonedNow(CHAT_TIMEZONE)), { days: summaryDays(), budget: historyBudgetChars() });
  const before = earlier.turns
    .map(turn => ({ role: turn.role, content: turn.content, ...(turn.at ? { at: turn.at } : {}), ...((turn as { id?: string }).id ? { id: (turn as { id?: string }).id } : {}) })) as OllamaMessage[];
  if (earlier.notes.length) console.log(`[ai] ${earlier.notes.length} note(s) — months and days — go in front of today's`);
  if (before.length) console.log(`[ai] ${before.length} turns from un-distilled days go in front of today's`);
  const history = markTimeGaps(withoutWhereDenials(withoutTrafficDenials([...before, ...withoutStaleDenials(foldAsleepExchanges(withFiles) as typeof withFiles, hasItems)] as unknown as { role: string; content: string; at?: string }[], Boolean(directions?.route)), Boolean(describeWhereabouts(getWhereabouts()))), CHAT_TIMEZONE) as unknown as OllamaMessage[];
  // Her replies as re-voiced by the background pass (revoice.ts), before the
  // other seeds: a rewrite that still ends on an order loses it like any other.
  const revoiced = applyRevoices(history as unknown as { id?: string; role: string; content: string }[], revoiceState().rewrites);
  if (revoiced.applied) console.log(`[revoice] ${revoiced.applied} of her replies shown as re-voiced`);
  const shown = hers ? seedOffTheOrders(revoiced.shown as unknown as OllamaMessage[], dropClosingOrder) : revoiced.shown as unknown as OllamaMessage[];
  const conversation: OllamaMessage[] = [{ role: 'system', content: brief ? `${sized} ${BREVITY}` : sized },
    // Her own notes on the finished days, as background right after the rules
    // and before anything raw — the first thing read after the system prompt.
    ...(earlier.notes.length ? [{ role: 'system', content: `The days before today, from your own notes — how things stood, in your words at the time:\n${earlier.notes.join('\n')}` }] : []),
    ...seedEmoji(shown)];
  // The last thing she reads before she speaks — see LAST_WORD for the
  // measurement. A system message just before their last turn: the Ollama
  // shaper folds it into that turn, an OpenAI-shaped endpoint takes it as it
  // is, and either way it is nearer than anything in the system prompt.
  const lastUser = conversation.map(message => message.role).lastIndexOf('user');
  // What he sent while she slept, read where the rest of the turn's asides
  // are — the last thing before she speaks, where a small model still has it.
  const wakeNow = wakeNoteNow();
  // How he sounded, from the audio he uploaded — consumed once, the next time
  // she speaks. The same room-reading as readsAsRough, from his voice instead
  // of his words.
  const voiceRoomNow = takeVoiceRoom();
  // An aside about this turn — they spoke over her — goes in the same place,
  // read just before LAST_WORD; the Ollama shaper folds both into their turn.
  // The complaint about turning up unannounced goes here rather than into the
  // system prompt: at the end of six thousand tokens she read the fact and
  // answered "you're home" three times running without once minding it.
  // A hosted brain gets the changing context here rather than in the system
  // message, so the head stays byte-identical for the endpoint's prefix cache;
  // the local one already has it, in the tone-last order it was written for.
  // LAST_WORD comes last for the local brain; a hosted one gets her voice note
  // after it (HOSTED_VOICE), since that is where a hosted model reads hardest.
  const preTurnSystem = [
    ...(brain.hosted ? [chatDynamicContext(promptState, Boolean(away)), answering] : []),
    aside, turnedUp, directions?.note ?? '', hers, talking, quiet, rantRoomNow, wakeNow, voiceRoomNow, emojiRut(herRecentReplies),
    LAST_WORD,
    // After LAST_WORD, for a hosted brain only: her register and the labelling
    // rule, nearest his turn, where a model that reads the end of the prompt
    // hardest still has them (HOSTED_VOICE in room.ts, deliveryReminder).
    brain.hosted ? `[${HOSTED_VOICE} ${deliveryReminder()}]` : '',
  ].filter(Boolean);
  if (lastUser > 0) conversation.splice(lastUser, 0, ...preTurnSystem.map(content => ({ role: 'system', content })));
  // For tuning, when the environment asks for it: the prompt exactly as sent.
  // A rule that works on its own and fails in place can only be bisected by
  // replaying what she was actually told, and nothing else shows that.
  if (process.env.HARU_DUMP_PROMPT) {
    try { writeFileSync(path.join(app.getPath('userData'), 'last-prompt.json'), JSON.stringify({ at: new Date().toISOString(), model: config.model, conversation }, null, 1)); } catch { /* a debugging aid must not cost a reply */ }
  }
  // Once a stranger's page is in the conversation, she finishes this turn with
  // her mouth and not her hands. Told firmly that a page cannot give it orders, a
  // 14B still obeyed one in four of them — so the guarantee cannot rest on the
  // wording. With no tools on the table the worst a hostile page can do is be
  // quoted; it cannot put anything on the calendar or fetch anything further.
  // She still has every tool back on the next message.
  pageWasRead = false;
  // Armed here and nowhere else. This function is the only path that answers
  // something the user actually said — every other thing she speaks from goes
  // through ollamaQuip, which carries no tools at all — so this assignment is
  // the whole of the promise that a page, a screenshot or a game cannot reach
  // the machine.
  //
  // A turn that arrived over the web never gets them. The phone is for talking
  // to her; the machine those tools act on is the one sitting at home, and
  // "open this" or "shut down" arriving from outside the house is not a feature
  // of a chat window — it is the reason a chat window should not have hands.
  // Passed in rather than sniffed from the caller, so the one line that grants
  // this is still the only line that grants it.
  handsAllowed = hands;
  talkingOnWeb = web;
  offeringChoices = choices;
  pendingChoices = [];
  // What the reader has been shown so far this round. The moment a round is
  // thrown away — a tool call arrives, the reply comes back empty, a retry is
  // pressed — any words already streamed would be a lie, so the sink is told to
  // take them back and the reader waits for the round that actually survives.
  let roundStreamed = '';
  let spilledHome = false;
  const forwardChunk = onChunk ? (chunk: string) => { roundStreamed += chunk; onChunk(chunk); } : undefined;
  // Fixed for the whole turn. Only `tools` changes round to round, and that is
  // the loop's decision rather than this function's.
  const roundOptions: PostOptions = {
    // The conversation is the one local call that wants the whole window;
    // everything else shares the side jobs' runner (sideNumCtx).
    numCtx: chatNumCtx(),
    // A message from outside the desk — the phone — gets a short leash.
    // The reader is watching a chat app, a long reply is a long wait, and
    // away-turns were found to run long: the cap keeps her concise without
    // touching the desk, where a full answer is the point of the window.
    ...(away ? { maxTokens: brain.hosted ? HOSTED_AWAY_MAX_TOKENS : AWAY_MAX_TOKENS } : {}),
    // A hosted reply is not shown as it arrives: it is the research, not the
    // answer, and it is said again as herself below — that is what streams.
    ...(forwardChunk && !brain.escalated ? { onChunk: forwardChunk } : {}),
  };
  const { content: spoken, ran } = await runToolLoop(conversation, {
    // With the route in hand there is nothing to look up: offered tools, she
    // searched the web for the traffic, got three American states back, and
    // guessed — while the live number sat in the note beside his message.
    ...(directions?.route ? { maxRounds: 1 } : {}),
    ask: async (sending, { tools }) => {
      // The conversation route: a deadline on the first word, and the local
      // model answering when it passes or the call fails — she must never go
      // quiet because a company did. A round already streaming is taken back
      // first, so the reader is not shown two beginnings.
      if (brain.hosted) {
        // The deadline is a race, not an abort: an AbortSignal handed to
        // net.fetch was not honoured (a turn ran 27 s past an 8 s signal), and
        // the request is left to finish on its own and be discarded. Streaming,
        // the first chunk is the first word and the deadline is waived by it;
        // otherwise the whole reply must land in time.
        const startedAt = Date.now();
        const cacheKey = `haru-${localDateKey(zonedNow(CHAT_TIMEZONE))}`;
        // A network change under a streaming request — the anime stack's
        // containers recreated mid-turn on 2026-09-18, new interfaces, and
        // Chromium gave up the Kimi stream 49 s in with ERR_NETWORK_CHANGED —
        // is asked once more before the local model takes the turn: the
        // fallback is a different voice, and the reader hears the switch.
        const transient = (error: unknown) => /ERR_NETWORK_CHANGED|ERR_CONNECTION_RESET|ERR_CONNECTION_CLOSED|ECONNRESET|socket hang up/i.test(error instanceof Error ? error.message : String(error));
        for (let attempt = 0; ; attempt++) {
          let firstWordAt = 0;
          const onChunkSeen = roundOptions.onChunk ? (text: string) => { if (!firstWordAt) firstWordAt = Date.now(); roundOptions.onChunk!(text); } : undefined;
          try {
            onSending?.();
            const request = sendToProvider(sending, config, { ...roundOptions, tools, cacheKey, ...(onChunkSeen ? { onChunk: onChunkSeen } : {}) });
            const deadline = new Promise<never>((_, reject) => setTimeout(() => { if (!firstWordAt) reject(new Error(`no first word in ${HOSTED_FIRST_WORD_MS / 1000}s`)); }, HOSTED_FIRST_WORD_MS));
            const answer = await Promise.race([request, deadline]);
            console.log(`[ai] ${config.model} answered in ${Date.now() - startedAt}ms${firstWordAt ? ` (first word at ${firstWordAt - startedAt}ms)` : ''}${attempt ? ' (second try)' : ''}`);
            return answer;
          } catch (error) {
            if (attempt === 0 && transient(error)) {
              console.warn(`[ai] the conversation route (${config.model}) broke off (${error instanceof Error ? error.message : String(error)}) — asking once more`);
              if (roundStreamed) { roundStreamed = ''; onChunkReset?.(); }
              continue;
            }
            console.warn(`[ai] the conversation route (${config.model}) did not answer (${error instanceof Error ? error.message : String(error)}) — answering at home`);
            // Refused for money is worth telling the phone about now, not on the hour.
            if (/insufficient .*balance/i.test(error instanceof Error ? error.message : String(error))) void checkVeniceBalance('a refused turn');
            if (roundStreamed) { roundStreamed = ''; onChunkReset?.(); }
            spilledHome = true;
            return ollamaPost(sending, home, { ...roundOptions, tools });
          }
        }
      }
      try {
        onSending?.();
        return await ollamaPost(sending, config, { ...roundOptions, tools });
      } catch (error) {
        // Only when nothing answered at all — a refused connection, a pod that
        // is off. A 400 or a 500 with a complaint in it is the local model
        // answering, and the fix for that is in the request, not in asking
        // somebody else: twice in one day a template refusal and an oversized
        // prompt were answered by the hosted model instead, and what the user
        // noticed was her personality gone, not an error. The rule is that the
        // hosted model is for uploads; an outage is the one exception it keeps.
        const spill = isAbsent(error) ? capacitySpill(config) : null;
        if (!spill) throw error;
        console.warn(`[ai] ${config.model} did not answer (${error instanceof Error ? error.message : String(error)}) — spilling this reply to ${spill.model}`);
        return sendToProvider(sending, spill, { ...roundOptions, tools });
      }
    },
    runTool: async call => {
      // A call in progress says something while this runs (localcall.ts).
      const tool = (call as { function?: { name?: string } }).function?.name ?? 'tool';
      onToolCall?.(tool);
      const result = await runChatTool(call, latest, toolDeps());
      // Written down here, at the one seam every tool passes through, and only
      // for the ones that changed something. She had no record of her own
      // conduct at all, so a claim about what she did had nothing behind it to
      // check and she supplied a reason instead (2026-09-08).
      noteDeed(tool, call, result);
      return result;
    },
    // Read through rather than passed by value: runChatTool sets these while a
    // round is in flight, and a copy taken before the round would miss it.
    pageWasRead: () => pageWasRead,
    handsAllowed: () => handsAllowed,
    withdrawHands: () => { handsAllowed = false; },
    hasOpenTask: () => getKept().some(item => item.kind === 'task' && !item.done),
    canSearch: () => readSearchConfig(store.get('search')).enabled && handsAllowed,
    resetStream: () => { if (roundStreamed) { roundStreamed = ''; onChunkReset?.(); } },
    log: line => console.log(line),
    warn: line => console.warn(line),
    traceId,
  });
  // Whole paragraphs of her own recent replies come back verbatim otherwise.
  // Only the last two are compared: the echo happens back-to-back, and looking
  // further would start dropping a legitimate restatement — asked what is on
  // today twice in a conversation, she has to be free to say it twice. Two
  // covers the case where a retort or gloat sits between the two replies.
  // OpenAI thinks, she speaks. A hosted reply is the research — the facts, the
  // numbers, the comparison — and it arrives in the hosted model's voice, which
  // is nobody's: a tidy bulleted list with none of her in it, which is exactly
  // what was noticed. Her own model says it again as herself, same facts, her
  // mouth, and that is what the reader watches arrive.
  const said = brain.escalated ? await inHerVoice(spoken, messages, { ...(away ? { maxTokens: AWAY_MAX_TOKENS } : {}), ...(forwardChunk ? { onChunk: forwardChunk } : {}) }) : spoken;
  const recent = messages.filter(entry => entry.role === 'assistant').slice(-2).map(entry => entry.content);
  // What she was legitimately given: their message, and whatever is actually
  // on screen. Anything she names beyond that in a closing line was invented.
  const grounded = `${latest} ${currentActivity?.label ?? ''}`;
  // Agenda repeats first: it works on whole paragraphs and knows what the
  // subject is, so it should get its say before the blunter filters start
  // counting words.
  // Only what is still open: a finished errand has no claim on the words in it.
  const onList = getKept().filter(item => !item.done).map(item => item.title);
  // Not on a grounded answer: with "eat breakfast" on the list, every paragraph
  // of a restaurant list reads as her nagging about breakfast again, and the
  // list is what they asked for.
  // Any maps link she typed is a made-up one — the app attaches the real button below.
  const unlinked = withoutMapsLinks(said);
  if (unlinked !== said) console.log('[maps] dropped a link she wrote herself');
  // And not at all on a turn about her: the words of his errands have no
  // business cutting what she says about her own things.
  const deduped = fromSearch || hers ? unlinked : dropRepeatedAgendaMentions(unlinked, recent, onList, latest);
  // Outermost on purpose: it counts paragraphs, so it has to see the ones
  // that survive everything else rather than the ones about to be dropped.
  // "ran" is what she actually reached for this turn, which is a fact about
  // the reply rather than a guess from its text.
  // The repeat and padding filters catch the local model's tics — saying last
  // reply's paragraph over again, tacking a third topic on — and a research
  // answer said in her voice has neither. A comparison of two models repeats
  // their names from the list she gave ten minutes earlier because that is the
  // answer, and its length is the world's. Asked to compare Qwen and Gemma she
  // came back with 930 characters and these two left 107 — the opening dig.
  // A rant is about the subject she has been on, so it echoes it by design —
  // the repetition cuts are exactly wrong for the one reply she was given the
  // room for. Five hundred characters of her own opinion came back as eighty.
  // Talking about her own thing echoes it too — the same reason a rant does.
  const ranting = Boolean(rantRoomNow || hers);
  const headed = dropRoleHeader(dropInventedContact(dropStageDirections(dropInventedScreenTalk(brain.escalated || fromSearch || ranting ? deduped : dropRepeatedParagraphs(deduped, recent, brain.hosted ? HOSTED_PARAGRAPHS : undefined), grounded))));
  const trimmed = headed;
  // Last, on the reply that survives everything else: a signature opener is
  // only a signature against what she said last time.
  // The echo first, then the signature: with "A keyboard?" gone, "Fine," is
  // the opener, and it is that which may have been used last time too.
  const clock = zonedNow(CHAT_TIMEZONE);
  // A grounded answer is a list of places she was handed, so neither the
  // tacked-on-paragraph cut nor the repetition cut applies: asked the same
  // question twice she should give the same names twice, and the first time
  // this ran, 843 of her 890 characters were thrown away as "already said".
  const body = dropTackedOnParagraphs(trimmed, brain.escalated || fromSearch || ran.has('search_web') || ran.has('read_web_page') || ran.has('read_video_transcript'), brain.hosted ? HOSTED_PARAGRAPHS : undefined);
  const cleaned = fixStatedClock(dropRepeatedOpener(dropEchoOpener(fromSearch || ranting ? body : dropRepeatedSentences(body, recent), latest), recent), clock.getHours(), clock.getMinutes());
  // The reminder read from their message is the truth about its time, whatever she says.
  // Her promise, kept: "I'll set the reminder at 6:54 AM" with nothing written
  // is a reminder that exists only in the conversation. See reminderPromised.
  // Not when she already wrote it down herself this turn: the tool ran and
  // she said "reminder set", and the net caught the sentence a second time.
  const promised = !reminder && !ran.has('create_kept_item') && messages.at(-1)?.role === 'user' ? reminderPromised(cleaned, zonedNow(CHAT_TIMEZONE)) : null;
  if (promised) {
    const theirs = messages.filter(message => message.role === 'user').slice(-4).map(message => String(message.content ?? ''));
    const item = addKeptItem({ title: promisedTitle(theirs), date: promised.date, time: promised.time, kind: 'task' });
    console.log(`[remind] she promised one in her reply — written down: "${item.title}" on ${item.date}${item.time ? ` at ${item.time}` : ''}`);
  }
  // Her claim of a move, made good the same way: "I've moved it to next Friday
  // at 8:45 AM" with no tool behind it left the appointment on the old day and
  // her asking after it that evening (2026-09-13). See movedSaid. Not when she
  // moved it herself this turn, and not on a turn that was not theirs.
  const moved = !ran.has('update_kept_item') && !ran.has('create_kept_item') && messages.at(-1)?.role === 'user'
    ? movedSaid(latest, cleaned, typeof herPrevious === 'string' ? herPrevious : '', getKept().filter(item => !item.done), whatSheWasChasing(getKept().filter(item => !item.done)), zonedNow(CHAT_TIMEZONE))
    : null;
  if (moved) {
    updateKept(moved.item.id, { date: moved.date, ...(moved.time ? { time: moved.time } : {}) });
    console.log(`[agenda] she said she moved it — "${moved.item.title}" is now on ${moved.date}${moved.time ? ` at ${moved.time}` : ''}`);
  }
  // The eye-roll in thirty-five of forty replies: the wording that caused it is
  // fixed (EXPRESSIVE), and this catches what the wording does not.
  // herRecentReplies, not `recent`: that holds the last two she said, one fewer
  // than the filter asked for, so it never once fired.
  const thinned = oneEmojiAtMost(dropOverusedEmoji(cleaned, herRecentReplies, HER_EMOJI), HER_EMOJI);
  if (thinned !== cleaned) console.log('[ai] thinned the emoji in that reply');
  // On a turn that was hers, or one where they only wanted to talk, the closing
  // order or the pivot back to him goes. The note against it stood in the
  // splice and the hosted model ended on "So out with it. What do you actually
  // want?" regardless — see dropClosingOrder for why this is a filter.
  const varied = hers || talking ? dropClosingOrder(thinned) : thinned;
  if (varied !== thinned) console.log('[ai] took the closing order off a reply that was about her');
  const herLine = reminder?.time ? fixStatedReminderTime(varied, reminder.time) : varied;
  // The maps button goes under her words, not into her mouth: what is herLine
  // and what her mood is read from is the line she said.
  // Two features meet on "where can I get a decent burger": directions wants one
  // destination and a maps button, and cuts the place talk to get it. When the
  // answer was grounded in a search, the place talk is the answer — she keeps
  // her list and still gets the button under it.
  // With a real route in hand her minutes are Google's, not a guess: the filter that strips route talk stands aside.
  // And with nothing found she is still not a maps app: "about 10 minutes via
  // Stirling Hwy" for an address she never looked up is cut the same way.
  // With a route in hand her numbers are made Google's — her own guess from
  // an hour earlier, still in the history, outweighed the brief.
  // And with no journey looked up at all, a claim about the roads is invented
  // whole: "traffic's already thick, you'll hit the main drag" for a trip
  // nobody asked the map about.
  const routeless = directions?.route ? fixStatedRoute(herLine, directions.route)
    : directions && !directions.about && !fromSearch ? dropRouteTalk(herLine)
    : !directions && !fromSearch && claimsTraffic(herLine) ? dropRouteTalk(herLine)
    : herLine;
  if (routeless !== herLine && directions?.route) console.log('[maps] corrected the minutes, distance or roads she stated to the route');
  const content = directions?.found ? withDirections(routeless, directions.found, directions.route ?? undefined) : routeless;
  if (herLine !== said) console.log(`[ai] dropped ${said.length - content.length} chars she had already said`);
  // The turn's ledger, one line: who answered, how much she was handed, and
  // whether the filters had to touch what she said. The before-and-after of a
  // change of brain is read from these.
  const handed = Math.round(conversation.reduce((sum, message) => sum + (typeof message.content === 'string' ? message.content.length : 0), 0) / 4);
  const brainName = brain.hosted ? (spilledHome ? `hosted:${config.model}->home` : `hosted:${config.model}`) : brain.escalated ? `escalated:${config.model}` : 'local';
  // Which stage took it, when a hosted reply loses most of itself: replaying the
  // filters afterwards did not reproduce a 535-character answer coming back as
  // eighty, so the run says so at the time.
  if (brain.hosted && routeless.trim().length < said.trim().length * 0.6) {
    const at = [['said', said], ['unlinked', unlinked], ['deduped', deduped], ['trimmed', trimmed], ['body', body], ['cleaned', cleaned], ['varied', varied], ['herLine', herLine], ['routeless', routeless]];
    console.log(`[ai] most of that reply went: ${at.map(([name, text]) => `${name} ${text.trim().length}`).join(' -> ')}`);
  }
  const touched = said.trim() !== routeless.trim();
  // What the filters took from a hosted reply, kept beside what survived: the
  // bake-off is judged on these, and a number alone says nothing about whether
  // the cut was a repeat or a real sentence.
  if (touched && brain.hosted) recordBrief(`chat filtered (${brainName}) — as she wrote it, then as sent`, said, routeless);
  console.log(`[ai] chat reply in ${Date.now() - started}ms, ${content.length} chars — brain=${brainName} handed≈${handed}tok filters=${touched ? `touched(${said.trim().length - routeless.trim().length >= 0 ? '-' : '+'}${Math.abs(said.trim().length - routeless.trim().length)})` : 'untouched'}`);
  // She copies what she can see: when a reply lifts eight words from one of today's examples, it is written down (examples.ts).
  const lifted = reusedExample(content, todaysExamples());
  if (lifted) console.log(`[examples] she reused a line from an example (${lifted.kind} ${lifted.id}): ${JSON.stringify(content.slice(0, 100))}`);
  if (messages.at(-1)?.role === 'user' && !brief && !choices) scheduleSecondThought({ hers: Boolean(hers), ranting, latest, reply: content, config });
  // Got up because of them and saying goodnight: that is her going back to bed, whether or not she called the tool.
  if (herKnockedAwakeNow() && readsAsGoodnight(content)) void goBackToSleepOnHerWord();
  // Cleared only once a reply actually exists, so a failed or unreachable turn
  // leaves the note in place for the retry rather than losing it.
  if (fresh) store.delete('chat.freshStart');
  // Shared: the expression system consumes it through the broadcast inside,
  // and the voice awaits it to choose a clip matching how this line was said.
  const herWords = routeless;
  // The label and the place are the local model's work whichever brain spoke:
  // Venice answered the classification in prose around the JSON and her face
  // stuck on the previous mood.
  const saidMood = classifyEmotion(herWords, home);
  void speak(herWords, saidMood);
  void tieToPlace(latest, herWords, home);
  // Restarting herself kills the process she is answering from, so the
  // restart waits until this reply is built and on its way — the words leave
  // first, the restart follows a few seconds behind.
  if (pendingHaruRestart) {
    pendingHaruRestart = false;
    setTimeout(() => { void runSystemCommand('systemctl', ['--user', 'restart', 'haru']); }, 5000);
  }
  return { content, ignored: false, irritation, ego };
}

/**
 * The models an OpenAI-shaped endpoint will admit to. Also the cheapest possible
 * check that the key works, which is what "Test connection" is really for.
 */
async function openAIModels(endpoint: string, provider: Provider) {
  requireKeyFor(endpoint, provider);
  const response = await net.fetch(`${trimEndpoint(endpoint)}/models`, { headers: modelHeaders(endpoint) });
  if (!response.ok) throw new Error(describeFailure(response.status, await response.text().catch(() => ''), provider));
  const payload = await response.json() as { data?: { id?: string }[] };
  return (payload.data ?? []).map(model => model.id).filter((id): id is string => Boolean(id)).sort();
}

/**
 * Proves the key by using it the way she will.
 *
 * Listing models is a nicety; answering is the job. These providers scope keys
 * per endpoint, so a key that is perfectly good for /chat/completions can be
 * refused by /models — which is exactly what happened here. A working key was
 * reported as "Incorrect API key provided" while chat replies were landing in
 * 5.7 seconds, which is the worst kind of wrong: confidently, about the one
 * thing the button exists to tell you.
 *
 * So the listing is attempted first because it is genuinely useful, and a
 * failure falls through to the smallest possible real request rather than being
 * reported as a verdict on the key.
 */
async function verifyRemoteModel(endpoint: string, provider: Provider, model: string) {
  requireKeyFor(endpoint, provider);
  try {
    const listed = await openAIModels(endpoint, provider);
    if (listed.length) return { models: listed, note: '' };
  } catch (error) {
    console.warn(`[ai] ${provider} would not list models (${error instanceof Error ? error.message : error}) — trying a real request instead`);
  }
  const response = await net.fetch(`${trimEndpoint(endpoint)}/chat/completions`, {
    method: 'POST',
    headers: modelHeaders(endpoint),
    // Through the same builder as a real request, so a model that wants
    // max_completion_tokens is not failed by the one probe meant to vouch for it.
    body: JSON.stringify(toOpenAIBody({ model: model || 'grok-4', conversation: [{ role: 'user', content: 'hi' }], temperature: 1, maxTokens: 1 })),
  });
  if (!response.ok) throw new Error(describeFailure(response.status, await response.text().catch(() => ''), provider));
  return { models: [], note: 'The key works. This provider will not list its models to it, which is a permission on the key rather than a problem.' };
}

async function ollamaTags(endpoint: string) {
  const response = await net.fetch(`${trimEndpoint(endpoint)}/api/tags`, { headers: modelHeaders(endpoint) });
  // 401 here is the useful one: it means the endpoint is real and the key is
  // wrong, which is a different problem from the server not being there.
  if (response.status === 401 || response.status === 403) throw new Error('That endpoint rejected the key. Check the model API key in setup.');
  if (!response.ok) throw new Error(`Ollama returned ${response.status}: ${response.statusText}`);
  const data = await response.json() as { models?: { name: string }[] };
  return (data.models ?? []).map(model => model.name);
}

function readExpressionNames(): string[] {
  const saved = store.get('live2d.model') as { path?: string } | undefined;
  if (!saved?.path) return [];
  try {
    const json = JSON.parse(readFileSync(saved.path, 'utf8'));
    const expressions = json?.FileReferences?.Expressions;
    if (!Array.isArray(expressions)) return [];
    return expressions.map((entry: { Name?: unknown }) => entry.Name).filter((name: unknown): name is string => typeof name === 'string');
  } catch {
    return [];
  }
}

function combinedDisplayBounds() {
  const displays = screen.getAllDisplays();
  return {
    minX: Math.min(...displays.map(d => d.bounds.x)),
    minY: Math.min(...displays.map(d => d.bounds.y)),
    maxX: Math.max(...displays.map(d => d.bounds.x + d.bounds.width)),
    maxY: Math.max(...displays.map(d => d.bounds.y + d.bounds.height)),
  };
}

function clampCompanionWidth(width: number) {
  return Math.min(Math.max(Math.round(width), COMPANION_MIN_WIDTH), COMPANION_MAX_WIDTH);
}

function clampCompanionPosition(x: number, y: number, width: number, height: number) {
  const { minX, minY, maxX, maxY } = combinedDisplayBounds();
  return {
    x: Math.min(Math.max(x, minX - width + COMPANION_MARGIN), maxX - COMPANION_MARGIN),
    y: Math.min(Math.max(y, minY - height + COMPANION_MARGIN), maxY - COMPANION_MARGIN),
  };
}

/**
 * Where she comes back to.
 *
 * Restoring is not the same problem as dragging. Mid-session she is allowed to
 * sit mostly off the edge — that is a thing someone did on purpose and undoes
 * just as easily. On startup nobody is holding her, so the same position is
 * simply a character who did not appear, and the natural conclusion is that the
 * app failed to start rather than that it is three feet below the taskbar.
 *
 * The old test asked only whether the saved rectangle intersected the desktop
 * at all, which a single pixel satisfies. Hers overlapped by a sliver and was
 * restored faithfully to almost entirely underneath the screen.
 */
function getCompanionBounds(): Bounds {
  const saved = store.get('companion.bounds') as Bounds | undefined;
  if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) {
    let width = clampCompanionWidth(saved.width || COMPANION_DEFAULT_WIDTH);
    let height = Math.round(width * COMPANION_ASPECT);
    // Whichever screen she was mostly on, so a second monitor keeps her.
    const work = screen.getDisplayMatching({ x: Math.round(saved.x), y: Math.round(saved.y), width, height }).workArea;
    // Shrink before moving: something taller than the screen has no position
    // that shows all of it, and clamping alone would just pin it to the top.
    if (height > work.height) {
      width = clampCompanionWidth(Math.round(work.height / COMPANION_ASPECT));
      height = Math.round(width * COMPANION_ASPECT);
    }
    return {
      x: Math.min(Math.max(Math.round(saved.x), work.x), work.x + work.width - width),
      y: Math.min(Math.max(Math.round(saved.y), work.y), work.y + work.height - height),
      width,
      height,
    };
  }
  const width = COMPANION_DEFAULT_WIDTH;
  const height = Math.round(width * COMPANION_ASPECT);
  const work = screen.getPrimaryDisplay().workArea;
  return { x: work.x + work.width - width - 24, y: work.y + work.height - height - 24, width, height };
}

/**
 * Her own face on her own window.
 *
 * Unpackaged, Electron runs from electron.exe and Windows shows electron.exe's
 * icon — so the app in the taskbar was the Electron logo no matter what the
 * shortcut said, which reads as the shortcut having launched the wrong thing.
 * It had not; only the picture was wrong.
 *
 * Packaged builds get this from the exe, but setting it here as well costs
 * nothing and keeps the two the same.
 */
function appIcon(): string | undefined {
  const candidates = [
    path.join(app.getAppPath(), 'build', 'icon.ico'),
    path.join(process.resourcesPath ?? '', 'build', 'icon.ico'),
    path.join(__dirname, '..', 'build', 'icon.ico'),
  ];
  return candidates.find(candidate => existsSync(candidate));
}

function createWindow() {
  mainWindow = new BrowserWindow({ icon: appIcon(), width: 1240, height: 800, minWidth: 980, minHeight: 640, titleBarStyle: 'hiddenInset', backgroundColor: '#0d0d12', webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true } });
  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) mainWindow.loadURL(devUrl); else mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  mainWindow.on('focus', syncOnFocus);
}

function createCompanionWindow() {
  const pinned = store.get('companion.pinned', true) as boolean;
  companionWindow = new BrowserWindow({
    icon: appIcon(),
    ...getCompanionBounds(),
    show: false,
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: true,
    minWidth: COMPANION_MIN_WIDTH,
    maxWidth: COMPANION_MAX_WIDTH,
    skipTaskbar: true,
    alwaysOnTop: pinned,
    backgroundColor: '#00000000',
    // This window is the audio sink as well as the stage, and the lip sync runs
    // on requestAnimationFrame. Throttled in the background, her mouth would
    // stutter or freeze open whenever another app had focus.
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, backgroundThrottling: false },
  });
  companionWindow.setAlwaysOnTop(pinned, 'screen-saver');
  companionWindow.setAspectRatio(1 / COMPANION_ASPECT);
  companionWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  companionWindow.setFullScreenable(false);

  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) companionWindow.loadURL(`${devUrl}?view=companion`);
  else companionWindow.loadURL(`${pathToFileURL(path.join(__dirname, '../dist/index.html')).toString()}?view=companion`);

  companionWindow.once('ready-to-show', () => {
    // Not when she was hidden on purpose: a headless box registers her model
    // for the phone's stage and has no display worth drawing her on.
    if (store.get('live2d.model') && !store.get('companion.hidden', false)) companionWindow?.show();
  });

  let persistTimer: ReturnType<typeof setTimeout> | undefined;
  const persistBounds = () => {
    clearTimeout(persistTimer);
    persistTimer = setTimeout(() => { if (companionWindow) store.set('companion.bounds', companionWindow.getBounds()); }, 400);
    // Moving her changes which way the screen is, so the direction she is
    // watching in has to be recomputed as she is dragged, not only when the
    // video started.
    if (watchingScreen) broadcastWatching();
  };
  startRoaming();
  companionWindow.on('move', persistBounds);
  companionWindow.on('moved', persistBounds);
  companionWindow.on('resize', persistBounds);
  companionWindow.on('resized', persistBounds);

  setInterval(() => {
    // isVisible() throws on a destroyed window rather than returning false,
    // and nothing ever nulls this variable out on close — so the window
    // reference outlives the window, and this poll firing every 33ms will
    // eventually land between a destroy and the next tick. Caught this once
    // already as an uncaught "Object has been destroyed" from here.
    if (!companionWindow || companionWindow.isDestroyed() || !companionWindow.isVisible()) return;
    const point = screen.getCursorScreenPoint();
    const bounds = companionWindow.getBounds();
    companionWindow.webContents.send('companion:cursor', { x: point.x - bounds.x, y: point.y - bounds.y });
  }, CURSOR_POLL_MS);
}

// Handing someone a shortcut for when she has not come up guarantees it gets
// clicked while she is already running. A second instance would mean two
// characters on the desktop, two life loops talking over each other, and two
// helpers fighting over the machine's volume — so the second one surfaces the
// first and leaves.
const isPrimaryInstance = app.requestSingleInstanceLock();
if (!isPrimaryInstance) app.quit();
app.on('second-instance', () => {
  if (!mainWindow || mainWindow.isDestroyed()) createWindow();
  mainWindow?.show();
  if (mainWindow?.isMinimized()) mainWindow.restore();
  mainWindow?.focus();
});

// ---- Reaching her from a phone -------------------------------------------

/** Where the web door's settings live. Top-level, for the dot-path reason above. */
function getWebAccess(): WebAccess {
  return readWebAccess(store.get('webAccess'));
}

function saveWebAccess(access: WebAccess) {
  store.set('webAccess', access);
}

/**
 * The brain for her one-liners: nudges, spontaneous pings and check-in quips.
 *
 * These are short, frequent, and want a tiny model that is always resident —
 * the nudge ollama on the 1660 Ti (127.0.0.1:11437) or a hosted one like
 * Venice. Without this, a parked ai.config (the 9B evicted for the voice
 * server) means she stops nudging entirely: every call throws at a dead
 * endpoint and is caught into silence.
 *
 * Falls back to ai.config when no nudge provider is set, so when the 9B is
 * resident again she nudges with it as before.
 */
function nudgeBrain(): ProviderConfig | null {
  const nudge = store.get('ai.nudge') as ProviderConfig | undefined;
  if (!nudge?.model || !nudge.endpoint) return null;
  return nudge;
}

/**
 * What she would say first, unprompted, to someone holding their phone.
 *
 * The whole point of her being on a phone is that she is a companion rather than
 * a search box: she should be the one to mention the thing you have not done.
 * The web page cannot be pushed to — no notifications here, deliberately — so
 * this is asked for when the page opens and while it stays open, which is the
 * moment she has someone's attention anyway.
 *
 * It shares everything with the desktop: the same selector, the same escalation
 * ladder, the same attempt counts, the same spacing. Chased on one device, she
 * does not immediately chase on the other, because both write the same record.
 */
async function nudgeForPhone(): Promise<{ line: string; about: string; eventId: string } | null> {
  if (herAsleepNow()) return null;
  if (chasing || Date.now() - lastRemindedAt < REMINDER_SPACING_MS) return null;
  // Told to drop something, she drops it here too. Silencing the chat and then
  // being nagged by the phone is the same complaint wearing a different hat.
  if (isSilenced(store.get('pushback') as Pushback | undefined, Date.now())) return null;
  const config = nudgeBrain() ?? (store.get('ai.config') as ProviderConfig | undefined);
  if (!config?.model) return null;

  const now = zonedNow(CHAT_TIMEZONE);
  const todayKey = localDateKey(now);
  const states = reminderStates();
  const mood = getMood();
  const minutesSinceUserSpoke = mood.lastMessageAt ? (Date.now() - Date.parse(mood.lastMessageAt)) / 60_000 : Number.POSITIVE_INFINITY;

  // Zero idle seconds: the page being open is the phone's version of somebody
  // sitting at the machine. If they are looking at her, they are there.
  const target = chaseTarget(now, todayKey, states, minutesSinceUserSpoke, 0);
  if (!target) return null;

  // Not a second line about the same item inside eight minutes, whichever
  // path wrote the first — the 15-minute heads-up and the first chase landed
  // in the same minute.
  const last = store.get('reminders.lastChased') as { id?: string; at?: number } | undefined;
  if (last?.id === target.item.id && Date.now() - Number(last.at ?? 0) < 8 * 60_000) return null;
  const attempts = states[target.item.id]?.attempts ?? 0;
  const tier = reminderTier(attempts);
  chasing = true;
  lastRemindedAt = Date.now();
  store.set('reminders', { ...states, [target.item.id]: { attempts: attempts + 1, lastAt: Date.now() } });
  store.set('reminders.lastChased', { id: target.item.id, at: Date.now() });
  try {
    const intoDay = now.getHours() * 60 + now.getMinutes();
    const evening = !target.item.time && isEveningCheck(intoDay);
    const day = relativeDay(target.item.date, todayKey, new Intl.DateTimeFormat('en-US', { weekday: 'long' }));
    const onDay = /^(today|yesterday|tomorrow|last )/.test(day) ? day : `on ${day}`;
    const when = target.item.underway ? `which they told you at ${clockAt(Date.parse(target.item.underway))} they were getting on with, and which is still not ticked off — ask whether it is actually done, not whether they have started`
      : evening ? `which they put on for ${day} with no particular time`
      : target.due < -1 ? `which was down for ${onDay}${target.item.time ? ` at ${target.item.time}` : ''} and has not been done`
      : target.due <= 1 ? `which is due right now, ${onDay}`
      : `due in about ${Math.round(target.due)} minutes, ${onDay}`;
    const character = getActiveCharacter();
    const system = [
      toldNow(),
      'If they have told you they are on their way there, chase them about being on time — not about getting up, their chair or their phone.',
      character.identity,
      character.style,
      reminderInstruction(tier, target.item.title, when, evening),
      'They are on their phone, away from their desk. One or two short lines. No quotation marks, no stage directions.',
    ].join(' ');
    const line = await ollamaQuip(system, 'Remind them.', config);
    recordBrief(`reminder ${tier}`, system, line);
    console.log(`[web] nudged about "${target.item.title}" (attempt ${attempts + 1}, ${tier})`);
    return { line, about: target.item.title, eventId: target.item.id };
  } catch (error) {
    console.warn('[web] could not compose a nudge:', error instanceof Error ? error.message : error);
    return null;
  } finally {
    chasing = false;
  }
}

// ---- The quick route ---------------------------------------------------

/**
 * The deterministic route: canned FAQ, templates, then the lookups the model
 * would have done through its tools — all without a model in the loop.
 *
 * `history` is the conversation up to but not including `text`, so the mood
 * side effects a quick hit causes (she was spoken to, she was fed up or not by
 * what was said) advance exactly as they would have on the full path. Mood
 * still gates from outside: while she is ignoring, quick.ts answers nothing
 * and the caller lets the full path carry the silence.
 */
/**
 * A setting changed in code at his explicit word, before any model is asked
 * (quick.ts settingCommand). The same backup, write, log and note as the
 * change_setting tool's path — that is applyPlanAtTheirWord — and a scripted
 * line back, in her register, since the model would not do it (2026-09-18).
 */
async function settingSaid(text: string): Promise<{ reply: string; tier: 2 } | null> {
  const command = settingCommand(text);
  if (!command) return null;
  const setting = SETTINGS[command.name];
  const verdict = planChange(command.name, command.value, store.get(setting.path));
  if (!verdict.ok) return { reply: verdict.error, tier: 2 };
  const meaning = (level: number) => level >= 4 ? 'my own hands in my own time, and I still run what you hand me once you have said yes to each one' : level === 3 ? 'I run what you hand me, once you have said yes to each one' : level === 2 ? 'I look, and act when you say the word' : 'I look and tell you what I see';
  if (verdict.unchanged) return { reply: `It is already at ${command.value} — ${meaning(command.value)}.`, tier: 2 };
  await applyPlanAtTheirWord(verdict.plan);
  return { reply: `Done. Level ${command.value} now — ${meaning(command.value)}. Do not make it boring.`, tier: 2 };
}

async function applyPlanAtTheirWord(plan: SettingPlan): Promise<{ ok: boolean; note: string }> {
  // A backup first, as any hand edit of config.json gets; then the value,
  // which every reader of these keys picks up on its next look; then the
  // vault page that says how she runs.
  store.backup(`her-edit-${plan.name}`);
  store.set(plan.path, plan.to);
  console.log(`[self] changed ${plan.name} (${plan.path}): ${JSON.stringify(plan.from)} -> ${JSON.stringify(plan.to)}, at their word`);
  refreshConfigurationNote();
  return { ok: true, note: 'In effect now.' };
}

function quickHit(text: string, history: { role?: string; content?: string }[]) {
  const mood = getMood();
  const now = zonedNow(CHAT_TIMEZONE);
  const todayKey = localDateKey(now);
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const kept = getKept();
  const linesFor = (date: string): AgendaLine[] => kept
    .filter(item => item.date === date)
    .map(item => ({ title: item.title, time: item.time, done: item.done }));
  const character = getActiveCharacter();
  const herName = herNameFrom(character.identity);
  const hit = quickAnswer(text, {
    now,
    todayKey,
    nickname: getProfile().nickname,
    herName,
    agenda: { today: linesFor(todayKey), tomorrow: linesFor(localDateKey(tomorrow)) },
    checkInsToday: checkInsOn(getCheckIns(), todayKey).length,
    irritation: mood.irritation,
    ignoring: isIgnoring(mood.irritation),
    lastOfHers: [...history].reverse().find(turn => turn.role === 'assistant')?.content,
  }, { social: conversationRoute() === null });
  if (!hit) return null;
  // The same turn-keeping the full path does, so a quick answer is not a
  // conversation hole: she heard them, and her patience moves for what they
  // said rather than freezing until the next model reply.
  noteUserSpoke();
  advanceMood(text, history);
  return hit;
}

/** The hit, said out loud: recorded in the transcript and logged with its tier
 *  so the route a message took can be read back from the log. */
function announceQuick(hit: { reply: string; tier: number }, text: string) {
  sendToWindows('chat:fromPhone', { text, reply: hit.reply, ignored: false });
  console.log(`[quick] tier ${hit.tier} — "${text.slice(0, 60)}" → ${hit.reply.length} chars`);
}

// ---- Reaching the phone when nothing of hers is open -----------------------

/** Where the phone subscriptions, their preferences and the signing pair live.
 *  Top-level, for the dot-path reason above. */
/**
 * The way somewhere, when the message asks for it: a place she knows by name,
 * else the map service's nearest match around them. Looked up before the
 * prompt so she speaks from what was found, and the link is attached after she
 * has spoken (withDirections) rather than asked of her.
 */
/** The place Google last found for them, for the "is it still open?" that follows. */
let lastPlaceFound: { place: GooglePlace; at: number } | null = null;
const PLACE_FOLLOW_UP_MS = 45 * 60_000;

/**
 * Every brief she speaks first from, and what she made of it, appended to a
 * file in her data folder. "Thirty seconds, Tommy." arrived with no way to
 * know what she had been told; the next one will have its brief beside it.
 */
const BRIEFS_KEEP_BYTES = 2_000_000;
function recordBrief(kind: string, brief: string, line: string): void {
  try {
    const file = path.join(app.getPath('userData'), 'briefs.log');
    const entry = `\n=== ${new Date().toISOString()} ${kind}\n${brief}\n--- she said:\n${line}\n`;
    if (existsSync(file) && statSync(file).size > BRIEFS_KEEP_BYTES) {
      const kept = readFileSync(file, 'utf8').slice(-BRIEFS_KEEP_BYTES / 2);
      writeFileSync(file, kept.slice(kept.indexOf('\n=== ')), 'utf8');
    }
    appendFileSync(file, entry, 'utf8');
  } catch (error) {
    console.warn(`[push] could not record the brief: ${error instanceof Error ? error.message : error}`);
  }
}

/**
 * Room to go on about something, when she has it in her (roomToRant). The
 * subject is last night's, or the thing of hers she has spent the most nights
 * on — "she played her favourite game, so she will want to talk about it".
 */
/**
 * The archive, embedded once so it can be searched.
 *
 * Kept beside the app's own data rather than in the store: it is derived from
 * archive.json and can be thrown away and rebuilt at any time, and it is large
 * enough that putting it in the config would make every config write expensive.
 */
const recallVectors = new Map<string, number[]>();
/**
 * Which embedder, with or without the search prefixes, made recallVectors
 * (chatsearch.ts embedFormat). Vectors of another format are not comparable
 * with a query made now: they are dropped and the archive is embedded again.
 */
let recallFormat = '';
const RECALL_CACHE = () => path.join(app.getPath('userData'), 'recall-vectors.json');
/**
 * Embedded a run at a time, a few to a request: the embedder is on the CPU and
 * a reply's own query waits behind whatever request is in flight. A run that
 * leaves some over comes back a minute later rather than in fifteen, so a full
 * re-embed (1,187 exchanges, ~2 minutes of CPU, 2026-09-17) is done in minutes.
 */
const RECALL_BATCH = 300;
const RECALL_REQUEST = 16;
let recallRefreshing = false;

/** The days that are already in front of her whole (history.ts) — no point finding those again. */
function daysAlreadyShown(todayKey: string): string[] {
  return Object.keys(store.getArchive()).filter(day => day < todayKey).sort().slice(-DAYS_OF_HISTORY);
}

/** Every kept exchange before today, the days in front of her included: what search_chats searches and what gets embedded. */
function keptExchanges(todayKey: string): Exchange[] {
  return exchangesFrom(store.getArchive() as unknown as Record<string, { role?: string; content?: string }[]>, [], todayKey, ARCHIVE_RETENTION_DAYS);
}

/**
 * The word index over keptExchanges (chatsearch.ts), rebuilt only when the
 * archive has moved on: a new day, or a day added or trimmed. Before today
 * nothing else changes it.
 */
let chatIndexCache: { key: string; index: ChatIndex } | null = null;
function chatIndex(todayKey: string): ChatIndex {
  const archive = store.getArchive() as unknown as Record<string, unknown[]>;
  const days = Object.keys(archive).filter(day => day < todayKey).sort();
  const key = `${todayKey}|${days.length}|${days[0] ?? ''}|${days.at(-1) ?? ''}|${archive[days.at(-1) ?? '']?.length ?? 0}`;
  if (chatIndexCache?.key !== key) chatIndexCache = { key, index: buildChatIndex(keptExchanges(todayKey)) };
  return chatIndexCache.index;
}

/**
 * The words she writes in lowercase in her kept replies — evidence that a
 * capitalised one in her night notes ("Think" of "Think Pol") is a word and not
 * a name (room.ts namesIn). Rebuilt with the chat index.
 */
let everydayWordsCache: { index: ChatIndex; words: Set<string> } | null = null;
function everydayWords(): Set<string> {
  const index = chatIndex(localDateKey(zonedNow(CHAT_TIMEZONE)));
  if (everydayWordsCache?.index !== index) {
    // Counted, not merely seen: she writes "david's death? cheap…" in lowercase
    // now and then, and a single sighting took David and Lucy off her subjects.
    // A word is everyday when she writes it lowercase at least twice, and twice
    // as often as she capitalises it mid-sentence: "think" 72 to 0, "control"
    // 6 to 3, but "lucy" 3 to 2 stays a name (review, 2026-09-17).
    const lower = new Map<string, number>();
    const upper = new Map<string, number>();
    const add = (map: Map<string, number>, word: string) => map.set(word, (map.get(word) ?? 0) + 1);
    for (const exchange of index.exchanges) {
      for (const line of exchange.text.split('\n')) {
        if (!line.startsWith('You: ')) continue;
        for (const match of line.slice(5).matchAll(/[A-Za-z]+/g)) {
          const word = match[0];
          const before = line.slice(5, 5 + (match.index ?? 0)).trimEnd();
          if (/^[a-z]/.test(word)) add(lower, word);
          else if (/^[A-Z][a-z]/.test(word) && before && !/[.!?…]$/.test(before)) add(upper, word.toLowerCase());
        }
      }
    }
    const words = new Set([...lower].filter(([word, count]) => count >= 2 && count >= 2 * (upper.get(word) ?? 0)).map(([word]) => word));
    everydayWordsCache = { index, words };
  }
  return everydayWordsCache.words;
}

/** search_chats (tools.ts): words and meaning over every kept day, dated finds with their neighbours. */
async function searchOldChats(input: { query: string; from?: string; to?: string }): Promise<{ found: number; text: string; wordsOnly: boolean }> {
  const index = chatIndex(localDateKey(zonedNow(CHAT_TIMEZONE)));
  const model = getKnowledgeEmbedder()?.model;
  // Meaning only counts when the vectors were made the way this query is; words always do.
  const queryVector = model && embedFormat(model) === recallFormat ? await tryEmbedQuery(embedText(model, 'query', input.query)) : null;
  const hits = searchChats(index, { query: input.query, queryVector, vectors: recallVectors, from: input.from, to: input.to });
  const range = input.from || input.to ? ` (${input.from ?? '…'} to ${input.to ?? '…'})` : '';
  console.log(`[chats] "${input.query.slice(0, 60)}"${range} -> ${hits.length ? hits.map(hit => `${hit.exchange.day} (${hit.score.toFixed(3)})`).join(', ') : 'nothing'}${queryVector ? '' : ' [words only]'}`);
  return { found: hits.length, text: chatHitsNote(hits, new Intl.DateTimeFormat('en-AU', { weekday: 'long', timeZone: 'UTC' })), wordsOnly: !queryVector };
}

/**
 * Four decimals is all a cosine needs, and a year of exchanges kept at full
 * double precision in JSON is a hundred megabytes read at every start: 1,162 of
 * them were 11 MB (2026-09-17).
 */
function roundedVector(vector: number[]): number[] {
  return vector.map(value => Math.round(value * 1e4) / 1e4);
}
/** Set when the cache on disk should be written even with nothing new: rounded on load, or pruned. */
let recallCacheStale = false;

function loadRecallVectors(): void {
  try {
    const file = JSON.parse(readFileSync(RECALL_CACHE(), 'utf8')) as { format?: unknown; vectors?: Record<string, number[]> };
    // Before 2026-09-17 the file was the bare id → vector map, embedded without
    // the search prefixes: not comparable, so it is embedded again and rewritten.
    if (typeof file.format !== 'string' || !file.vectors || typeof file.vectors !== 'object') {
      console.log('[recall] the saved vectors predate the search prefixes — embedding the archive again');
      return;
    }
    recallFormat = file.format;
    const saved = file.vectors;
    for (const [id, vector] of Object.entries(saved)) {
      if (!Array.isArray(vector)) continue;
      const rounded = roundedVector(vector);
      if (!recallCacheStale && rounded.some((value, index) => value !== vector[index])) recallCacheStale = true;
      recallVectors.set(id, rounded);
    }
    console.log(`[recall] ${recallVectors.size} older exchanges already embedded`);
  } catch { /* nothing embedded yet, which is the state on a first run */ }
}

async function refreshRecallVectors(): Promise<void> {
  const embedder = getKnowledgeEmbedder();
  if (recallRefreshing || !embedder) return;
  recallRefreshing = true;
  let more = false;
  try {
    const format = embedFormat(embedder.model);
    if (format !== recallFormat) {
      if (recallVectors.size) console.log(`[recall] vectors were made as ${recallFormat || 'unprefixed'}, now ${format} — embedding the archive again`);
      recallVectors.clear();
      recallFormat = format;
    }
    const todayKey = localDateKey(zonedNow(CHAT_TIMEZONE));
    // Every kept day, the ones in front of her included: recall skips those,
    // search_chats does not. Vectors for days that have left the archive go.
    const all = keptExchanges(todayKey);
    const kept = new Set(all.map(exchange => exchange.id));
    for (const id of [...recallVectors.keys()]) if (!kept.has(id)) { recallVectors.delete(id); recallCacheStale = true; }
    const missing = all.filter(exchange => !recallVectors.has(exchange.id)).slice(0, RECALL_BATCH);
    let done = 0;
    for (let at = 0; at < missing.length; at += RECALL_REQUEST) {
      const batch = missing.slice(at, at + RECALL_REQUEST);
      let vectors: number[][];
      try {
        vectors = await embedder.embedBatch(batch.map(exchange => embedText(embedder.model, 'document', exchange.text)));
      } catch (error) {
        console.warn(`[recall] could not embed: ${error instanceof Error ? error.message : error}`);
        break;
      }
      batch.forEach((exchange, position) => {
        if (vectors[position]?.length) { recallVectors.set(exchange.id, roundedVector(vectors[position])); done++; }
      });
    }
    more = done > 0 && missing.length === RECALL_BATCH;
    if (!done && !recallCacheStale) return;
    recallCacheStale = false;
    try {
      writeFileSync(RECALL_CACHE(), JSON.stringify({ format: recallFormat, vectors: Object.fromEntries(recallVectors) }), 'utf8');
      console.log(`[recall] embedded ${done} more — ${recallVectors.size} of ${all.length} kept exchanges searchable`);
    } catch (error) {
      console.warn(`[recall] could not save what was embedded: ${error instanceof Error ? error.message : error}`);
    }
  } finally {
    recallRefreshing = false;
    if (more) setTimeout(() => { void refreshRecallVectors(); }, 60_000);
  }
}

// -- who is who (factgraph.ts) ----------------------------------------------------
//
// Each finished day is read once into graph.json — the names in his life and the
// facts between them — and every reply is handed the facts one step out from
// whoever the message names. The reading is a hosted call per piece of a day;
// the reply side is a lookup with no call at all.

/** One day per tick at most: a backlog of weeks arrives as a trickle on the bill, not a burst. */
const GRAPH_TICK_MS = 60_000;
/** A day whose replies keep coming back unreadable is skipped after this many tries rather than paid for forever. */
const GRAPH_TRIES = 3;
let readingGraph = false;
const graphFailures = new Map<string, number>();
/**
 * Day → how far into it a read got before a piece failed, for the same
 * messages under the same name, so a retry starts at the piece that failed
 * instead of paying for the ones already folded in. Held in memory only: a
 * restart mid-day pays for those pieces once more, which is rare and cheap.
 */
const graphPiecesRead = new Map<string, { of: string; pieces: number }>();
/**
 * No answer, in a row, and when to look again. Waiting out an outage must not
 * be a call a minute for as long as it lasts, nor a day whose request is
 * refused every time (a 400 on its content) holding every later day back for
 * good: the wait doubles to half an hour, and the tenth no-answer in a row
 * counts as one of the day's tries.
 */
const graphUnanswered = { count: 0, until: 0 };
const GRAPH_UNANSWERED_AS_TRY = 10;

function graphUserName(): string {
  return getProfile().nickname.trim() || 'the user';
}

/**
 * The brain that reads a day: the hosted conversation route, and nothing when
 * there is none. Not the local model — measured on the same prompt and the
 * same days (2026-09-16), the 9B filed the Eiffel Tower as part of his life
 * and wrote "Tommy works at a job"; a graph of that is worse than no graph.
 */
function graphBrain(): ProviderConfig | null {
  if ((store.get('graph') as { enabled?: boolean } | undefined)?.enabled === false) return null;
  return conversationRoute();
}

async function readGraphTick(): Promise<void> {
  if (readingGraph || Date.now() < graphUnanswered.until) return;
  const brain = graphBrain();
  if (!brain) return;
  const today = currentChatDayKey();
  const archive = store.getArchive();
  const read = store.getFactGraph().read;
  // Oldest first, finished days only; a day that has grown since it was read is read again.
  // Finished means before the chat's own day as well as the clock's: in the
  // minute after 05:00 the clock has rolled but performChatResetIfDue has not,
  // and a day he pressed New chat on already has an archive entry — half of it.
  // Read then, it was paid for twice once the reset filed the rest (2026-09-17).
  const day = Object.keys(archive).filter(key => !key.includes('#') && key < today && key < chatDayKey()).sort()
    .find(key => read[key] !== (archive[key] ?? []).length);
  if (!day) return;
  readingGraph = true;
  try {
    const outcome = await readDayIntoGraph(day, (archive[day] ?? []) as { role?: string; content?: unknown }[], brain);
    if (outcome !== 'unanswered') graphUnanswered.count = 0;
    if (outcome === 'read') { graphFailures.delete(day); graphPiecesRead.delete(day); syncGraphPage(`read ${day}`); return; }
    // No answer at all — the network, an HTTP status, credit run out — says
    // nothing about the day. Counting it spent all three tries in a three-minute
    // outage and marked the day read for good, unread (2026-09-17). Only a reply
    // that came back and could not be used is a try; this waits for the next tick.
    if (outcome === 'unanswered') {
      graphUnanswered.count += 1;
      graphUnanswered.until = Date.now() + Math.min(30, 2 ** Math.min(graphUnanswered.count - 1, 5)) * 60_000;
      if (graphUnanswered.count < GRAPH_UNANSWERED_AS_TRY) return;
      graphUnanswered.count = 0;
    }
    throw new Error('the reply could not be read');
  } catch (error) {
    const tries = (graphFailures.get(day) ?? 0) + 1;
    graphFailures.set(day, tries);
    console.warn(`[graph] could not read ${day} (try ${tries} of ${GRAPH_TRIES}): ${error instanceof Error ? error.message : error}`);
    if (tries >= GRAPH_TRIES) {
      const graph = store.getFactGraph();
      store.setFactGraph({ ...graph, read: { ...graph.read, [day]: (archive[day] ?? []).length } });
      graphPiecesRead.delete(day);
      console.warn(`[graph] skipping ${day} until it changes`);
    }
  } finally {
    readingGraph = false;
  }
}

/**
 * His corrections on Who is who.md folded into the graph, then the page written
 * again from it (graphpage.ts). Only a page that exists is read: a deleted page
 * is written back, never taken as "forget everything".
 */
function syncGraphPage(reason: string): void {
  const vault = knowledge.vaultPath();
  if (!vault) return;
  const file = path.join(vault, GRAPH_PAGE);
  try {
    let graph = store.getFactGraph();
    const current = existsSync(file) ? readFileSync(file, 'utf8') : '';
    if (graph.page && current) {
      const applied = applyGraphPage(graph, readGraphPage(current), localDateKey(zonedNow(CHAT_TIMEZONE)), new Date());
      const line = pageReportLine(applied.report);
      if (line) console.log(`[graph] from ${GRAPH_PAGE} (${reason}): ${line}`);
      graph = applied.graph;
    }
    const { text, written } = renderGraphPage(graph, new Date());
    if (current !== text) writeFileSync(file, text, 'utf8');
    store.setFactGraph({ ...graph, page: written });
  } catch (error) {
    console.warn(`[graph] could not sync ${GRAPH_PAGE}: ${error instanceof Error ? error.message : error}`);
  }
}

/**
 * Every piece of one day, in order. 'unreadable' when a reply came back that
 * could not be used, 'unanswered' when a call got no reply at all — either way
 * the day is left unmarked to try again, from the piece that failed.
 */
async function readDayIntoGraph(day: string, messages: { role?: string; content?: unknown }[], brain: ProviderConfig): Promise<'read' | 'unreadable' | 'unanswered'> {
  const userName = graphUserName();
  const chunks = dayChunks(messages, userName);
  const totals = { added: 0, confirmed: 0, ended: 0, refused: 0 };
  const of = `${messages.length}:${userName}`;
  const already = graphPiecesRead.get(day)?.of === of ? graphPiecesRead.get(day)!.pieces : 0;
  for (const [index, chunk] of chunks.entries()) {
    if (index < already) continue;
    let reply: Awaited<ReturnType<typeof ollamaPost>>;
    try {
      reply = await ollamaPost(
        [{ role: 'system', content: extractionPrompt(userName) }, { role: 'user', content: extractionInput(day, knownBlock(store.getFactGraph(), chunk, userName), chunk) }],
        brain,
        { tools: false, temperature: 0.1, format: EXTRACTION_SCHEMA, maxTokens: 3000 },
      );
    } catch (error) {
      console.warn(`[graph] no answer reading ${day} (piece ${index + 1} of ${chunks.length}), trying again next tick: ${error instanceof Error ? error.message : error}`);
      return 'unanswered';
    }
    const extraction = readExtraction(reply.content ?? '');
    if (!extraction) return 'unreadable';
    const { graph, report } = applyExtraction(store.getFactGraph(), extraction, { day, chunk, userName });
    store.setFactGraph(graph);
    totals.added += report.added;
    totals.confirmed += report.confirmed;
    totals.ended += report.ended;
    totals.refused += report.rejected.length;
    if (report.rejected.length) console.log(`[graph] ${day}: refused ${report.rejected.slice(0, 4).join(' | ')}${report.rejected.length > 4 ? ` and ${report.rejected.length - 4} more` : ''}`);
    graphPiecesRead.set(day, { of, pieces: index + 1 });
  }
  const graph = store.getFactGraph();
  store.setFactGraph({ ...graph, read: { ...graph.read, [day]: messages.length } });
  console.log(`[graph] read ${day}: ${chunks.length} piece(s)${already ? ` (${already} read before a failed try)` : ''}, +${totals.added} fact(s), ${totals.confirmed} confirmed, ${totals.ended} ended${totals.refused ? `, ${totals.refused} refused` : ''} — ${graph.facts.length} facts about ${graph.entities.length} names in all`);
  return 'read';
}

// -- things to come back to (scheduler.ts) ----------------------------------------
//
// One saved list and one dispatcher: the daily sweeps at a time of day rather
// than a day after whenever the app last started (a restart every few hours
// meant the 24-hour interval never fired at all), and what she books for
// herself with book_follow_up.

/** The daily sweeps, before the 05:00 roll. Missed while the app was down, they run at the next start within twenty hours. */
const MAINTENANCE_AT = '04:30';

const scheduler = createScheduler({
  load: () => store.getSchedule(),
  save: file => store.setSchedule(file),
  handlers: {
    maintenance: () => {
      // Each sweep on its own (2026-09-17): one throwing used to skip the rest
      // for the day. The job is failed, and retried, only when every sweep
      // threw. A retry reruns all four, the ones that worked included, and a
      // sweep that throws is usually bad data or a bug that throws again a minute
      // later — so one that fails alone is logged and tried again tomorrow.
      const sweeps: [string, () => unknown][] = [['consolidation', runMemoryConsolidation], ['decay', runMemoryDecay], ['archive pruning', pruneOldArchives], ['haunt hygiene', runHauntHygiene]];
      const failed = sweeps.filter(([name, sweep]) => {
        try {
          sweep();
          return false;
        } catch (error) {
          console.warn(`[schedule] maintenance: ${name} failed — ${error instanceof Error ? error.message : String(error)}`);
          return true;
        }
      });
      return failed.length === sweeps.length ? { failed: 'every sweep failed' } : { done: true };
    },
    [BOOKED_KIND]: comeBackTo,
    [TRAFFIC_WATCH_KIND]: watchTraffic,
  },
  log: line => console.log(line),
});

function bookFollowUp(input: { why: string; date?: string; time?: string; inMinutes?: number }): { booked: true; when: string } | { booked: false; reason: string } {
  const now = Date.now();
  const at = resolveBookingTime(input, now, CHAT_TIMEZONE);
  if (typeof at !== 'number') return { booked: false, reason: at.error };
  const admitted = admitBooking({ jobs: scheduler.list(), booked: scheduler.booked() }, { at, why: input.why }, now, `booked-${randomUUID().slice(0, 8)}`);
  if ('refused' in admitted) {
    console.log(`[booked] refused ${JSON.stringify(input.why.slice(0, 80))}: ${admitted.refused}`);
    return { booked: false, reason: admitted.refused };
  }
  scheduler.add(admitted.job);
  const when = describeWhen(at, now, CHAT_TIMEZONE);
  console.log(`[booked] she will come back to ${JSON.stringify(admitted.job.payload?.why)} at ${when}`);
  return { booked: true, when };
}

/** Her wake time tonight or this morning, as an instant — what a booking made for her sleeping hours waits for. */
function herWakeAt(): number | null {
  const schedule = getHerSleepSchedule();
  if (!schedule) return null;
  const [year, month, date] = schedule.day.split('-').map(Number);
  const after = new Date(Date.UTC(year, month - 1, date + 1)).toISOString().slice(0, 10);
  return zonedEpoch(after, schedule.wake, CHAT_TIMEZONE);
}

/**
 * A line of hers, unprompted: the conversation route over today's conversation
 * with a note saying why, under the second thought's guards. Null when she lets
 * it go (a dash), when it is his side of the conversation rather than hers, or
 * when it repeats something already said. Throws when there is no brain to ask.
 * Shared by her bookings and her thoughts.
 */
async function composeUnprompted(note: string): Promise<string | null> {
  const route = conversationRoute() ?? (store.get('ai.config') as ProviderConfig | undefined);
  if (!route?.model) throw new Error('no brain to say it with');
  const messages = ((store.get('chat.messages') as { role: string; content: string }[] | undefined) ?? []).slice(-14);
  const character = getActiveCharacter();
  const conversation: OllamaMessage[] = [
    { role: 'system', content: [character.identity, character.style, FIRST_PERSON_NOTE, NATURAL, NO_INVENTED_HISTORY].join('\n\n') },
    ...messages.map(message => ({ role: message.role as OllamaMessage['role'], content: message.content })),
    { role: 'system', content: note },
  ];
  const answer = await Promise.race([
    sendToProvider(conversation, route, { tools: false, temperature: 0.8, maxTokens: 220 }),
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('no answer in 40s')), 40_000)),
  ]);
  const line = parseSecondThought(oneEmojiAtMost(dropOverusedEmoji(dropRoleHeader(dropStageDirections(answer.content ?? '')), [], HER_EMOJI), HER_EMOJI));
  if (!line) return null;
  if (readsAsTheirAnswer(line) || looksLikeAnEcho(line, messages.map(message => message.content)) || echoesAside(line, getAsides(), Date.now())) {
    console.log(`[unprompted] dropped — not hers to say, or already said: ${JSON.stringify(line.slice(0, 80))}`);
    return null;
  }
  return line;
}

/**
 * A booking of hers, come due. Put off rather than dropped when the moment is
 * wrong — asleep, his quiet hours, him not up, the two of them mid-conversation,
 * a game on — and written by the conversation route when it is right, under the
 * same guards as a second thought. She may still decide it no longer fits.
 */
async function comeBackTo(job: Job): Promise<Outcome> {
  const why = String(job.payload?.why ?? '').trim();
  if (!why) return { done: true };
  const now = Date.now();
  if (isSilenced(store.get('pushback') as Pushback | undefined, now)) {
    console.log(`[booked] let go — she has been told to stop: ${JSON.stringify(why)}`);
    return { done: true };
  }
  if (herAsleepNow() || herKnockedAwakeNow()) return { later: Math.max(herWakeAt() ?? 0, now) + 20 * 60_000, reason: 'she is asleep' };
  if (inQuietHours(getPush().prefs, zonedNow(CHAT_TIMEZONE))) return { later: now + 30 * 60_000, reason: 'quiet hours' };
  if (!theyAreUpNow()) return { later: now + 30 * 60_000, reason: 'they are not up' };
  if (lastUserActivityAt && now - lastUserActivityAt < QUIET_AFTER_USER_MS) return { later: now + 10 * 60_000, reason: 'they are talking to her' };
  if (now - lastInterjectionAt < INTERJECT_GAP_MS) return { later: now + 5 * 60_000, reason: 'she only just spoke' };
  if (readGamingConfig(store.get('gaming')).quiet && gameIsRunning()) return { later: now + 20 * 60_000, reason: 'they are playing something' };
  const line = await composeUnprompted(bookedPrompt(why, Number(job.payload?.bookedAt ?? job.createdAt), now, CHAT_TIMEZONE));
  if (!line) {
    console.log(`[booked] she let it go: ${JSON.stringify(why)}`);
    return { done: true };
  }
  // They may have started talking while she was writing it.
  if (lastUserActivityAt > now) return { later: Date.now() + 10 * 60_000, reason: 'they started talking while she wrote it' };
  lastInterjectionAt = Date.now();
  noteAside(line, 'booked', why.slice(0, 80));
  console.log(`[booked] came back to ${JSON.stringify(why)}: ${JSON.stringify(line.slice(0, 120))}`);
  return { done: true };
}

/**
 * "Let me know when the traffic eases", asked: a watch on the scheduler, unless
 * the road has already eased or cannot be read. Returns what she is told, so
 * what she says about it is what the app will actually do (trafficwatch.ts).
 */
function startTrafficWatch(destination: string, found: FoundPlace | null, route: Route | null): string {
  const now = Date.now();
  if (route && easedEnough(route)) {
    console.log(`[traffic] no watch needed — ${route.minutes} min now, ${route.typicalMinutes} usual`);
    return watchNote(destination, route, now, CHAT_TIMEZONE, false);
  }
  if (!found || !getGoogleMapsKey()) {
    console.log(`[traffic] cannot watch "${destination}" — ${found ? 'no maps key' : 'the place was not found'}`);
    return watchNote(destination, null, now, CHAT_TIMEZONE, false);
  }
  scheduler.add(watchJob(destination, { name: found.name, lat: found.lat, lon: found.lon }, now));
  console.log(`[traffic] watching the way to "${destination}" every ${WATCH_EVERY_MS / 60_000} min${route ? ` — ${route.minutes} min now, ${route.typicalMinutes} usual` : ''}`);
  return watchNote(destination, route, now, CHAT_TIMEZONE, true);
}

/**
 * The road read again for a watch. Again in a few minutes while it is still
 * slow; her line, with the directions button, once it is back near normal; and
 * a line saying it never cleared when the watch runs out. Asked for, so said:
 * a plain line stands in when her brain lets it go or cannot be reached.
 */
async function watchTraffic(job: Job): Promise<Outcome> {
  const payload = job.payload ?? {};
  const destination = String(payload.destination ?? 'home');
  const target = { name: String(payload.name ?? destination), lat: Number(payload.lat), lon: Number(payload.lon) };
  const startedAt = Number(payload.startedAt ?? job.createdAt);
  const until = Number(payload.until ?? startedAt + WATCH_FOR_MS);
  const now = Date.now();
  if (!Number.isFinite(target.lat) || !Number.isFinite(target.lon) || !getGoogleMapsKey()) return { done: true };
  if (isSilenced(store.get('pushback') as Pushback | undefined, now)) {
    console.log('[traffic] watch let go — she has been told to stop');
    return { done: true };
  }
  const last = now + WATCH_EVERY_MS > until;
  const from = startingPoint(getWhereabouts());
  if (!from) {
    console.log('[traffic] watch stopped — nowhere to measure from');
    return { done: true };
  }
  if (distanceM(from, target) < 500) {
    // At the place already, or no fresh fix and home is both ends: nothing to read.
    if (from.known === 'here') {
      console.log(`[traffic] watch done — they are at "${destination}"`);
      return { done: true };
    }
    return last ? { done: true } : { later: now + WATCH_EVERY_MS, reason: 'no fresh position to measure from' };
  }
  let route: Route | null = null;
  try {
    route = await computeRoute(from, target, getGoogleMapsKey(), (url, init) => fetch(url, init));
    console.log(`[traffic] the way to "${destination}": ${route.minutes} min now / ${route.typicalMinutes} typical`);
  } catch (error) {
    console.warn(`[traffic] no route this time: ${(error as Error).message}`);
  }
  const eased = route !== null && easedEnough(route);
  if (!eased && !last) return { later: now + WATCH_EVERY_MS, reason: route ? `${route.minutes} min, ${route.typicalMinutes} usual` : 'no route this time' };
  let line: string | null = null;
  try {
    line = await composeUnprompted(eased && route ? easedPrompt(destination, route, startedAt, now) : gaveUpPrompt(destination, route, startedAt, now));
  } catch (error) {
    console.warn(`[traffic] no brain for the line: ${(error as Error).message}`);
  }
  const said = line ?? (eased && route ? easedFallback(destination, route) : gaveUpFallback(destination, route));
  lastInterjectionAt = Date.now();
  noteAside(eased ? withDirections(said, target, route ?? undefined) : said, 'booked', `traffic ${destination}`.slice(0, 80));
  console.log(`[traffic] ${eased ? 'eased' : 'gave up'}: ${JSON.stringify(said.slice(0, 120))}`);
  return { done: true };
}

// -- what is on her mind (thoughts.ts) ---------------------------------------------
//
// Between messages she forms thoughts when something happens — a silence after
// they talked, one of her own passes finishing, something on his list coming up,
// waking — on the nudge brain, and keeps them two days. The freshest ride in
// front of her replies. Whether one would have become a message is logged; it
// only becomes one when thoughts.speak is on.

/** How often the triggers are looked at. Looking is free; the brain is only asked when one has fired. */
const THOUGHT_TICK_MS = 5 * 60_000;
let thinkingNow = false;

function thoughtsConfig(): { enabled: boolean; speak: boolean } {
  const saved = store.get('thoughts') as { enabled?: boolean; speak?: boolean } | undefined;
  return { enabled: saved?.enabled !== false, speak: saved?.speak === true };
}

/** The app's reasons she should not start a conversation now, in words, most basic first. */
function initiativeBlockers(): string[] {
  const now = Date.now();
  const out: string[] = [];
  if (herAsleepNow() || herKnockedAwakeNow()) out.push('she is asleep');
  if (herHasSaidGoodnight()) out.push('she has said goodnight');
  if (isSilenced(store.get('pushback') as Pushback | undefined, now)) out.push('she has been told to stop');
  if (inQuietHours(getPush().prefs, zonedNow(CHAT_TIMEZONE))) out.push('quiet hours');
  if (!theyAreUpNow()) out.push('they are not up');
  if (lastUserActivityAt && now - lastUserActivityAt < TALKING_RECENTLY_MS) out.push('they were talking to her just now');
  if (now - lastInterjectionAt < INTERJECT_GAP_MS) out.push('she only just spoke');
  if (readGamingConfig(store.get('gaming')).quiet && gameIsRunning()) out.push('they are playing something');
  return out;
}

function clipped(text: string, max: number): string {
  const flat = String(text ?? '').replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/** What she is handed to think over, in words. */
function thinkingState(trigger: Trigger, now: number, lastMessageAt: number | undefined, state: ThoughtState): ThinkingState {
  const local = zonedNow(CHAT_TIMEZONE);
  const today = localDateKey(local);
  const tomorrow = localDateKey(new Date(local.getFullYear(), local.getMonth(), local.getDate() + 1));
  const messages = (store.get('chat.messages') as { role: string; content: string }[] | undefined) ?? [];
  const his = [...messages].reverse().find(message => message.role === 'user');
  const hers = [...messages].reverse().find(message => message.role === 'assistant');
  const lastExchange = his
    ? `The last thing he said to you${lastMessageAt ? `, ${describeGap(now - lastMessageAt)} ago` : ''}: "${clipped(his.content, 240)}"${hers ? `\nThe last thing you said to him: "${clipped(hers.content, 240)}"` : ''}`
    : 'You two have not talked yet today.';
  // Her own lines only, without the clock on their front (withoutClock) — a machine warning is not something she said.
  const asides = getAsides().filter(aside => aside.source !== 'system');
  const within = (at: string, ms: number) => Number.isFinite(Date.parse(at)) && now - Date.parse(at) <= ms;
  const mood = getMood();
  const day = getDays().at(-1);
  const night = getNights().at(-1);
  const week = getWeek();
  return {
    now: `${formatTimeOfDay(local.getHours(), local.getMinutes())} on ${new Intl.DateTimeFormat('en-US', { weekday: 'long' }).format(local)}`,
    trigger,
    lastExchange,
    unanswered: lastMessageAt ? asides.filter(aside => Date.parse(aside.at) > lastMessageAt).slice(-4).map(aside => clipped(withoutClock(aside.text), 160)) : [],
    agenda: getKept().filter(item => !item.done && (item.date === today || item.date === tomorrow)).slice(0, 6)
      .map(item => `${item.date === today ? 'today' : 'tomorrow'}${item.time ? ` at ${item.time}` : ''} — ${item.title}`),
    ownLife: [
      day && within(day.at, 36 * 3_600_000) ? `your reading today, about ${day.about}: ${clipped(day.note, 200)}` : '',
      night && within(night.at, 36 * 3_600_000) ? `last night, ${night.about}: ${clipped(night.note, 200)}` : '',
      week ? `your week: ${clipped(week.summary, 200)}` : '',
    ].filter(Boolean),
    preferences: getMemories().filter(memory => memory.kind === 'preference' && memory.status !== 'archived' && !memory.supersededBy).slice(0, 8).map(memory => clipped(memory.text, 160)),
    // Words, never the counts behind them: handed a number she says the number.
    mood: [vitalsInstruction(vitals, mood.irritation), grudgeInstruction(mood.grudge ?? 0)].filter(Boolean).join(' '),
    recentThoughts: state.thoughts.filter(t => t.decision !== 'rumination').slice(-8).map(t => `(${describeGap(Math.max(60_000, now - t.at))} ago) ${t.thought}`),
    recentLines: asides.filter(aside => within(aside.at, 24 * 3_600_000)).slice(-8).map(aside => clipped(withoutClock(aside.text), 160)),
  };
}

async function thoughtTick(): Promise<void> {
  if (thinkingNow) return;
  const settings = thoughtsConfig();
  // Knocked awake is not woken: the knock moves her wake time, and the wake
  // trigger fired at 02:50 and again at 08:02 (review, 2026-09-17).
  if (!settings.enabled || herAsleepNow() || herKnockedAwakeNow()) return;
  const brain = nudgeBrain();
  if (!brain) return;
  const now = Date.now();
  const local = zonedNow(CHAT_TIMEZONE);
  const today = localDateKey(local);
  let state = store.getThoughts();
  const lastMessageAt = getMood().lastMessageAt ? Date.parse(getMood().lastMessageAt!) : undefined;
  const ownLife = [
    ...getDays().map(entry => ({ key: `day:${entry.day}`, at: Date.parse(entry.at), detail: `you have just finished your own reading, about ${entry.about}` })),
    ...getNights().map(entry => ({ key: `night:${entry.day}`, at: Date.parse(entry.at), detail: `you have just spent the night on ${entry.about}` })),
  ].filter(entry => Number.isFinite(entry.at)).sort((a, b) => b.at - a.at);
  const agenda = getKept().filter(item => !item.done && item.time && item.date === today).flatMap(item => {
    const clock = parseTimeOfDay(item.time!);
    return clock ? [{ id: item.id, title: item.title, at: zonedEpoch(item.date, clock.hour * 60 + clock.minute, CHAT_TIMEZONE) }] : [];
  });
  const wake = herWakeAt();
  const trigger = pendingTrigger({ now, lastMessageAt: Number.isFinite(lastMessageAt) ? lastMessageAt : undefined, ownLife, agenda, wokeAt: wake !== null && wake <= now ? wake : undefined, seen: state.seen });
  // A trigger held back by the spacing is still there on the next tick.
  if (!trigger || !mayAsk(state, now, today)) return;
  thinkingNow = true;
  try {
    // Inside the try, like the call: a write that throws, or a brain that never
    // answers, used to leave thinkingNow set and the loop stopped until a restart.
    state = noteAsked({ ...state, seen: spend(state.seen, trigger) }, now, today);
    store.setThoughts(state);
    const character = getActiveCharacter();
    const reply = await Promise.race([
      ollamaPost(
        [{ role: 'system', content: `${character.identity}\n\n${THINKING_RULES}` }, { role: 'user', content: thinkingInput(thinkingState(trigger, now, lastMessageAt, state)) }],
        brain,
        { tools: false, temperature: 0.8, format: 'json', maxTokens: 500 },
      ),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('no answer in 90s')), 90_000)),
    ]);
    const drafts = readThoughts(reply.content ?? '').sort((a, b) => scoreThought(b) - scoreThought(a));
    if (!drafts.length) {
      console.log(`[thought] ${trigger.kind} (${trigger.detail}): nothing on her mind`);
      return;
    }
    const lines = getAsides().filter(aside => now - Date.parse(aside.at) <= 24 * 3_600_000).map(aside => ({ text: aside.text }));
    const dayStart = zonedEpoch(today, 0, CHAT_TIMEZONE);
    const made: Thought[] = [];
    let spoke = false;
    for (const draft of drafts) {
      const vector = roundVector(await tryEmbedQuery(draft.thought));
      const thought: Thought = { id: `th${state.nextId++}`, at: now, trigger: trigger.kind, why: trigger.detail, ...draft, score: scoreThought(draft), decision: 'kept', ...(vector ? { vector } : {}) };
      const earlier = [...state.thoughts, ...made].filter(t => now - t.at <= THOUGHT_LIMITS.keepMs).map(t => ({ text: t.thought, vector: t.vector }));
      if (isRumination({ text: draft.thought, vector }, [...earlier, ...lines])) {
        made.push({ ...thought, decision: 'rumination' });
        console.log(`[thought] ${trigger.kind}: the same thought again, let go — ${JSON.stringify(clipped(draft.thought, 120))}`);
        continue;
      }
      const last = lastSpoken(state);
      const verdict = spoke
        ? { ok: false as const, why: 'another thought of this moment went first' }
        : mayInitiate({ thought, now, spokenToday: thoughtsSpokenOn(state, dayStart, dayStart + 86_400_000).length, lastSpokenAt: last?.at, lastAnswered: last ? (lastMessageAt ?? 0) > last.at : undefined, blockers: initiativeBlockers() });
      if (!verdict.ok) {
        made.push({ ...thought, heldBy: verdict.why });
        console.log(`[thought] ${trigger.kind} (score ${thought.score}): ${JSON.stringify(clipped(draft.thought, 140))} — kept to herself: ${verdict.why}`);
        continue;
      }
      spoke = true;
      if (!settings.speak) {
        made.push({ ...thought, decision: 'would-say' });
        console.log(`[thought] ${trigger.kind} (score ${thought.score}): ${JSON.stringify(clipped(draft.thought, 140))} — WOULD SAY (shadow): ${JSON.stringify(clipped(draft.say, 160))}`);
        continue;
      }
      const line = await composeUnprompted(thoughtPrompt(thought));
      if (!line || lastUserActivityAt > now) {
        made.push({ ...thought, heldBy: line ? 'he started talking while she wrote it' : 'she let it go when it came to writing it' });
        console.log(`[thought] ${trigger.kind}: went to say it, and did not — ${line ? 'he started talking' : 'she let it go'}`);
        continue;
      }
      lastInterjectionAt = Date.now();
      noteAside(line, 'thought', clipped(draft.thought, 80));
      made.push({ ...thought, decision: 'said', spokenAt: Date.now(), line });
      console.log(`[thought] ${trigger.kind} (score ${thought.score}): said ${JSON.stringify(clipped(line, 160))}`);
    }
    store.setThoughts(keepThoughts({ ...store.getThoughts(), nextId: state.nextId }, made, Date.now()));
  } catch (error) {
    console.warn(`[thought] could not think it through: ${error instanceof Error ? error.message : error}`);
  } finally {
    thinkingNow = false;
  }
}

// -- his lore cards, and her voice at its best (lore.ts, examples.ts) ----------------

let loreCache: { mtimeMs: number; cards: LoreCard[] } | null = null;
/** Card id → how many more of his messages it stays up for. A restart lets them all drop, which costs a card for a message or two. */
let loreMemory = new Map<string, number>();

/** The cards on Lore.md at the vault root, read again only when the page has changed. */
function loreCards(): LoreCard[] {
  const vault = knowledge.vaultPath();
  if (!vault) return [];
  const file = path.join(vault, LORE_PAGE);
  try {
    const { mtimeMs } = statSync(file);
    if (!loreCache || loreCache.mtimeMs !== mtimeMs) {
      loreCache = { mtimeMs, cards: parseLorePage(readFileSync(file, 'utf8')) };
      console.log(`[lore] ${loreCache.cards.length} card(s) on ${LORE_PAGE}`);
    }
    return loreCache.cards;
  } catch {
    return [];
  }
}

let examplesCache: { key: string; examples: Example[] } | null = null;

/** Today's few exchanges of her at her best: picked once a day, and again when a revoice pass adds rewrites. */
function todaysExamples(): Example[] {
  const local = zonedNow(CHAT_TIMEZONE);
  const today = localDateKey(local);
  const rewrites = revoiceState().rewrites;
  const key = `${today}:${Object.keys(rewrites).length}`;
  if (examplesCache?.key === key) return examplesCache.examples;
  // Only days before yesterday: yesterday and today can still be in the history she is shown.
  const yesterday = localDateKey(new Date(local.getFullYear(), local.getMonth(), local.getDate() - 1));
  const pool = examplePool(store.getArchive() as unknown as Record<string, ExampleTurn[]>, rewrites, yesterday);
  const examples = pickExamples(pool, today);
  examplesCache = { key, examples };
  console.log(`[examples] ${examples.length} of ${pool.length} for ${today}: ${examples.map(example => example.kind).join(', ') || 'none'}`);
  return examples;
}

function rantRoom(latest: string, mentioned = ''): string {
  const mood = getMood();
  const lastNight = nightsOn(getNights(), lastNightKey())[0];
  const deepest = [...getInterests()].sort((a, b) => b.nights - a.nights)[0];
  // What they just named beats what she was up to: they are talking about it now.
  const subject = mentioned || lastNight?.interest || lastNight?.about || deepest?.name || '';
  const grantedAt = Number(store.get('chat.rantAt') ?? 0);
  const room = roomToRant({
    energy: vitals.energy, curiosity: vitals.curiosity,
    irritation: mood.irritation, ego: mood.ego,
    boredom: getFeelings().boredom,
    subject: subject.slice(0, 80),
    sinceLastMs: grantedAt ? Date.now() - grantedAt : null,
    roll: Math.random(),
    latest,
    mentioned: Boolean(mentioned),
  });
  if (room) {
    store.set('chat.rantAt', Date.now());
    console.log(`[ai] she has the room to go on${subject ? ` about ${subject}` : ''}${mentioned ? ' — they brought it up' : ''}`);
  }
  return room;
}

/** How she stands with him right now — the Standing tab's arithmetic, in standing.ts, which is pure and tested. */
function currentStanding() {
  const now = zonedNow(CHAT_TIMEZONE);
  const today = localDateKey(now);
  const mood = getMood();
  const days = getSessions().map(session => session.day).filter(Boolean).sort();
  return standingFrom({
    vitals,
    woke: temperamentWord(getTemperament()),
    feelings: getFeelings(),
    traits: TRAIT_NAMES.map(trait => traitMeter(getTraits(), trait)),
    asleep: herAsleepNow(),
    irritation: mood.irritation,
    ego: mood.ego,
    grudge: mood.grudge ?? 0,
    ignoredToday: ignoredTodayNow(),
    lastMessageAt: mood.lastMessageAt,
    knownSince: days[0],
    daysTalked: new Set(days).size,
    kept: getKept().map(item => ({ id: item.id, title: item.title, date: item.date, time: item.time ?? null, done: item.done })),
    weekday: new Intl.DateTimeFormat('en-AU', { weekday: 'long', timeZone: CHAT_TIMEZONE }),
    now: Date.now(),
    today,
  });
}

/**
 * Her folder in the Obsidian vault, brought up to date (vault.ts). Cheap
 * enough to run often — a note is rewritten only when its text changed — so
 * it runs after each diary entry and on a slow tick for the standing page.
 */
const VAULT_PUBLISH_MS = 15 * 60_000;
function publishToVault(reason: string): void {
  const vault = readVaultConfig().path;
  if (!vault) return;
  try {
    const entries = recentEntries(app.getPath('home'), 3650);
    const nights = getNights();
    const her = herFrom({ interests: getInterests(), nights, diary: entries });
    const standing = currentStanding();
    const memories = getMemories();
    const where = getWhereabouts();
    const latestNight = [...nights].map(night => night.day).sort().at(-1);
    const notes = [
      ...diaryNotes(entries, new Set(nights.map(night => night.day))),
      ...nightNotes(nights),
      herNote(her),
      standingNote(standing, new Date().toISOString()),
      memoriesNote(memories),
      placesNote(where, toldNow()),
      indexNote({ latestDiary: entries.at(-1), latestNight, standing, her, memories: memories.filter(record => !record.supersededBy && record.status !== 'dormant').length, places: where.places.length }),
    ];
    const result = writeNotes(vault, notes);
    if (result.written) console.log(`[vault] ${reason}: wrote ${result.written} of ${notes.length} notes to ${vault}`);
  } catch (error) {
    console.warn(`[vault] could not write her notes: ${error instanceof Error ? error.message : error}`);
  }
}

async function directionsFor(latest: string, recentUser: string[] = []): Promise<{ ask: DirectionsAsk; found: FoundPlace | null; route: Route | null; note: string; about?: true } | null> {
  // "Never mind" or "I'm leaving now" calls off a traffic watch (trafficwatch.ts).
  if (stopsTrafficWatch(latest) && scheduler.list().some(job => job.kind === TRAFFIC_WATCH_KIND)) {
    scheduler.cancel(TRAFFIC_WATCH_KIND);
    console.log('[traffic] watch called off');
  }
  // "Let me know when the traffic eases" is the road now, and a watch after.
  const watchAsk = trafficWatchAsk(latest);
  const ask = directionsAskFrom(latest, recentUser) ?? (watchAsk ? { destination: watchAsk.destination, nearest: false } : null);
  const where = getWhereabouts();
  const weekday = zonedNow(CHAT_TIMEZONE).getDay();
  // The nearest of what came back when she knows where they are; never something
  // on another continent when they are asking from Perth: a hit over 400 km away
  // is not the place they meant, however well it matched the name. Places
  // before roads, then nearest: "Rockingham" is the suburb, not Rockingham Road
  // twenty minutes nearer.
  const pick = <T extends FoundPlace>(hits: T[], from: { lat: number; lon: number } | null, what: string): T | null => {
    const road = (hit: FoundPlace) => (hit.kind === 'road' ? 1 : 0);
    const ranked = from ? hits.map(hit => ({ hit, d: distanceM(from, hit) })).sort((a, b) => road(a.hit) - road(b.hit) || a.d - b.d) : [];
    const near = ranked.filter(entry => entry.d <= 400_000);
    if (from && ranked.length && !near.length) console.log(`[maps] every hit for "${what}" is ${Math.round(ranked[0].d / 1000)} km away — not it`);
    return from ? near[0]?.hit ?? null : [...hits].sort((a, b) => road(a) - road(b))[0] ?? null;
  };
  if (!ask) {
    // Not the way somewhere but the place itself — open, hours, any good. Google
    // only: OpenStreetMap has no doors. No button under her words for this.
    const about = placeAsk(latest);
    if (!about || !getGoogleMapsKey()) return null;
    const from = startingPoint(where);
    let place: GooglePlace | null = null;
    if (about.followUp) {
      // "Is it still open?" is about the place she just found, while it is fresh.
      if (!lastPlaceFound || Date.now() - lastPlaceFound.at > PLACE_FOLLOW_UP_MS) return null;
      place = lastPlaceFound.place;
      about.destination = place.name.split(',')[0].trim() || place.name;
    } else {
      try {
        place = pick(await searchGooglePlaces(about.destination, getGoogleMapsKey(), from, (url, init) => fetch(url, init)), from, about.destination);
      } catch (error) {
        console.warn(`[maps] the place lookup for "${about.destination}" failed: ${(error as Error).message}`);
        return null;
      }
    }
    if (place) lastPlaceFound = { place, at: Date.now() };
    console.log(`[maps] about "${about.destination}" (${about.want}): ${place ? `${place.name}${typeof place.openNow === 'boolean' ? place.openNow ? ', open' : ', closed' : ''}` : 'not found'}`);
    return { ask: { destination: about.destination, nearest: false }, found: null, route: null, note: placeNote(about, place, weekday), about: true };
  }
  let found: FoundPlace | null = null;
  let facts: string | undefined;
  const named = matchNamedPlace(ask.destination, where.places);
  if (named) {
    found = { name: named.name, lat: named.lat, lon: named.lon };
  } else {
    const from = startingPoint(where);
    // Google first when there is a key — it knows shops by name and says whether
    // they are open — and OpenStreetMap when there is not, or Google found nothing.
    if (getGoogleMapsKey()) {
      try {
        const place = pick(await searchGooglePlaces(ask.destination, getGoogleMapsKey(), from, (url, init) => fetch(url, init)), from, ask.destination);
        if (place) { found = place; facts = placeWords(place, weekday) || undefined; lastPlaceFound = { place, at: Date.now() }; }
      } catch (error) {
        console.warn(`[maps] Google could not find "${ask.destination}": ${(error as Error).message}`);
      }
    }
    if (!found) try {
      const hits = await searchPlaces(ask.destination, (url, init) => fetch(url, init), from, readSearchConfig(store.get('search')).place, { bounded: ask.nearest && from !== null });
      found = pick(hits, from, ask.destination);
    } catch (error) {
      console.warn(`[maps] the search for "${ask.destination}" failed: ${(error as Error).message}`);
    }
  }
  // The road itself, with traffic, when there is a key and somewhere to start
  // from. Coordinates both ends — see routes.ts for why.
  let road: string | undefined; let route: Route | null = null;
  const from = startingPoint(where);
  if (found && from && getGoogleMapsKey()) {
    try {
      route = await computeRoute(from, found, getGoogleMapsKey(), (url, init) => fetch(url, init));
      road = routeWords(route, from.known);
      console.log(`[maps] ${route.minutes} min now / ${route.typicalMinutes} typical, ${route.km} km via ${route.via || '?'}`);
    } catch (error) {
      console.warn(`[maps] no route: ${(error as Error).message}`);
    }
  }
  console.log(`[maps] the way to "${ask.destination}": ${found ? found.name : 'not found'}`);
  const note = directionsNote(ask, found, where, Date.now(), road, facts);
  return { ask, found, route, note: watchAsk ? `${note}\n\n${startTrafficWatch(watchAsk.destination, found, route)}` : note };
}

function getWhereabouts(): Whereabouts {
  return readWhereabouts(store.get('whereabouts'));
}

function saveWhereabouts(next: Whereabouts) {
  store.set('whereabouts', next);
}

function getBody(): Body {
  return readBodyState(store.get('body'));
}

function saveBody(next: Body) {
  store.set('body', next);
}

function getPush(): { devices: PushDevice[]; prefs: PushPrefs; nextNudgeAt: number; lastReachedAt: number } {
  const saved = (store.get('push') ?? {}) as Record<string, unknown>;
  return {
    devices: readPushDevices(saved.devices),
    prefs: readPushPrefs(saved.prefs),
    // Both on disk rather than in memory, because the thing that kept losing
    // them was the process ending. See scheduleNextPush and nudgeOverdue.
    nextNudgeAt: Number(saved.nextNudgeAt ?? 0) || 0,
    lastReachedAt: Number(saved.lastReachedAt ?? 0) || 0,
  };
}

function savePush(next: { devices?: PushDevice[]; prefs?: PushPrefs; nextNudgeAt?: number; lastReachedAt?: number }) {
  const merged = { ...((store.get('push') ?? {}) as Record<string, unknown>) };
  if (next.devices) merged.devices = next.devices;
  if (next.prefs) merged.prefs = next.prefs;
  if (next.nextNudgeAt !== undefined) merged.nextNudgeAt = next.nextNudgeAt;
  if (next.lastReachedAt !== undefined) merged.lastReachedAt = next.lastReachedAt;
  store.set('push', merged);
}

/**
 * When something of hers last got through — a push that landed, or a message
 * from them, whichever is later. What the two-hour floor is measured from.
 */
function lastReachedThem(): number {
  const spoke = Date.parse(getMood().lastMessageAt ?? '');
  return Math.max(getPush().lastReachedAt, Number.isFinite(spoke) ? spoke : 0);
}

/**
 * The signing pair the subscriptions are created against, made once and kept.
 *
 * The private half is stored the way every other credential here is —
 * encrypted by the OS, never handed to the renderer or the page. If it is ever
 * lost (a machine move; DPAPI does not travel), a fresh pair is made and every
 * old subscription starts being refused, not dropped — turning the bell off
 * and on again on the phone is the recovery, same as every other key here.
 */
function vapidKeys(): { publicKey: string; privateKey: string } {
  const saved = (store.get('push') ?? {}) as { vapidPublic?: unknown; vapidPrivate?: unknown };
  const privateKey = decryptSecret(typeof saved.vapidPrivate === 'string' ? saved.vapidPrivate : undefined);
  if (typeof saved.vapidPublic === 'string' && saved.vapidPublic && privateKey) {
    return { publicKey: saved.vapidPublic, privateKey };
  }
  const fresh = newVapidKeys();
  store.set('push', {
    ...((store.get('push') ?? {}) as Record<string, unknown>),
    vapidPublic: fresh.publicKey,
    vapidPrivate: encryptSecret(fresh.privateKey),
  });
  console.log('[push] made a fresh signing pair');
  return fresh;
}

/** What every notification says on the lock screen it lands on. */
const PUSH_TITLE = 'Haru 🌸';

/**
 * One line, to every phone that asked — or quietly nothing.
 *
 * Refusals are cheap and early: nobody subscribed, this kind switched off, or
 * quiet hours. A push service answering 404 or 410 is saying the phone revoked
 * that subscription, so it is dropped rather than retried forever; any other
 * refusal is logged and left alone, because a transient failure is not consent
 * to forget a phone.
 */
/**
 * The native app's devices, and the sender for them — see apns.ts. The key
 * file, its id and the team live under `apns` in config; the devices beside
 * them. Nothing is sent until all three are set.
 */
function getApns(): { config: ReturnType<typeof readApnsConfig>; devices: ApnsDevice[] } {
  const saved = (store.get('apns') ?? {}) as Record<string, unknown>;
  return { config: readApnsConfig(saved), devices: readApnsDevices(saved.devices) };
}
function saveApnsDevices(devices: ApnsDevice[]) {
  store.set('apns', { ...((store.get('apns') ?? {}) as Record<string, unknown>), devices });
}
/**
 * Whether anything of hers can buzz a phone at all — the page's Web Push or the
 * native app through Apple. The gates below asked only the web list, and once
 * the app superseded the browser's subscription (ffdc807, 2026-09-06) that list
 * was empty for good: ten days with no nudge, chase or floor sent.
 */
function canReachPhone(): boolean {
  return getPush().devices.length > 0 || getApns().devices.length > 0;
}
let apnsBearer: (() => string) | null = null;
function apnsBearerFor(config: NonNullable<ReturnType<typeof readApnsConfig>>) {
  return (apnsBearer ??= apnsSigner(config));
}

async function pushThroughApple(kind: string, text: string, url: string, topic: string, eventId?: string): Promise<number> {
  const { config, devices } = getApns();
  if (!config || !devices.length) return 0;
  let delivered = 0;
  const payload = apnsPayload(PUSH_TITLE, text.slice(0, 500), url, topic, { kind, eventId });
  for (const device of devices) {
    try {
      const result = await sendApns(device, payload, config, apnsBearerFor(config)(), topic);
      if (result.gone) {
        saveApnsDevices(getApns().devices.filter(d => d.token !== device.token));
        console.log(`[push] "${device.name}" is gone from Apple — dropped its token`);
      } else if (result.status !== 200) {
        console.warn(`[push] Apple refused for "${device.name}": ${result.status} ${result.reason ?? ''}`.trim());
        if (result.status === 403) apnsBearer = null;
      } else {
        delivered += 1;
        console.log(`[push] delivered a ${kind} push through Apple to "${device.name.slice(0, 40)}"`);
        savePush({ lastReachedAt: Date.now() });
      }
    } catch (error) {
      console.warn('[push] could not reach Apple:', error instanceof Error ? error.message : error);
    }
  }
  return delivered;
}

async function pushToPhone(kind: 'random' | 'events' | 'system' | 'weather', text: string, url = '/', force = false, topic = `haru-${kind}`, eventId?: string): Promise<boolean> {
  const { devices, prefs } = getPush();
  if (!devices.length && !getApns().devices.length) return false;
  // force is the sheet's proof button: being asked to prove itself is the one
  // time a refusal for preferences or quiet hours reads as broken.
  if (!force && (!prefs[kind] || heldBack(prefs, zonedNow(CHAT_TIMEZONE)))) return false;
  // The native app, through Apple, alongside the page's Web Push.
  const apple = await pushThroughApple(kind, text, url, topic, eventId);
  let delivered = apple > 0;
  let web = 0;
  // How many copies went out, in one line: two Apple tokens and three web
  // subscriptions all named "iPhone" were each taking every push (2026-09-06).
  const readout = () => console.log(`[push] ${JSON.stringify(text.slice(0, 40))} went to ${apple} Apple token(s) and ${web} web subscription(s)`);
  if (!devices.length) { readout(); return delivered; }
  const keys = vapidKeys();
  const payload = JSON.stringify({ title: PUSH_TITLE, body: text.slice(0, 500), url, kind, eventId });
  for (const device of devices) {
    try {
      const request = pushRequest(device, payload, keys, {}, topic);
      const response = await net.fetch(request.url, { method: 'POST', headers: request.headers, body: new Uint8Array(request.body) });
      if (response.status === 404 || response.status === 410) {
        savePush({ devices: getPush().devices.filter(d => d.endpoint !== device.endpoint) });
        console.log(`[push] "${device.name}" is gone — dropped its subscription`);
      } else if (!response.ok) {
        console.warn(`[push] the push service refused for "${device.name}": ${response.status}`);
      } else {
        delivered = true;
        web += 1;
        // Said, because a push that lands is otherwise indistinguishable in the
        // log from one that was never attempted — which is exactly the question
        // asked when a phone stays quiet.
        console.log(`[push] delivered a ${kind} push to "${device.name.slice(0, 40)}" (${response.status})`);
        // The clock the two-hour floor runs against. Written here, at the one
        // point that knows a push actually left the building.
        savePush({ lastReachedAt: Date.now() });
      }
    } catch (error) {
      console.warn('[push] could not send:', error instanceof Error ? error.message : error);
    }
  }
  readout();
  return delivered;
}

/**
 * Which asides buzz the phone, and as which kind — split by kind so the
 * preferences can refuse one sort of interruption without silencing the rest.
 */
const PUSH_KIND: Partial<Record<AsideSource, 'random' | 'events' | 'system' | 'weather'>> = {
  reminder: 'events',
  upcoming: 'events',
  hanging: 'random',
  weather: 'weather',
  journal: 'events',
  idle: 'random',
  goodnight: 'random',
  system: 'system',
  booked: 'random',
  thought: 'random',
};

/**
 * The list item a reminder line is about, so "Done" under the notification
 * can tick it off. The chase records what it just chased (reminders.lastChased)
 * right before the line is said, so a fresh record is the answer; failing
 * that, the title the line names (aside.about). Nothing for lines about
 * nothing on the list.
 */
function eventIdForAside(aside: Aside): string | undefined {
  const open = getKept().filter(item => !item.done);
  const chased = store.get('reminders.lastChased') as { id?: string; at?: number } | undefined;
  if (chased?.id && typeof chased.at === 'number' && Date.now() - chased.at < 2 * 60_000 && open.some(item => item.id === chased.id)) return chased.id;
  return aside.about ? open.find(item => item.title === aside.about)?.id : undefined;
}

/** Forwards an aside to the phones, when it is one of the ones worth a buzz. */
async function forwardAsideToPush(aside: Aside) {
  const kind = PUSH_KIND[aside.source];
  if (!kind) return;
  // Said, but not buzzed: the line is on the page for when they next look,
  // and is not held against them (reached: false), because they were never
  // told it was there.
  // Nothing but a reminder buzzes someone who is not up yet. The line is on
  // the page for when they are.
  if (kind !== 'events' && !theyAreUpNow()) {
    console.log(`[push] a ${aside.source} line held back — they are not up yet`);
    store.set('chat.asides', markReached(getAsides(), aside.id, false));
    return;
  }
  if (tooSoonToPush(kind, getPush().lastReachedAt, Date.now())) {
    console.log(`[push] a ${aside.source} line held back — one landed ${Math.round((Date.now() - getPush().lastReachedAt) / 60_000)} min ago (breather ${Math.round(PUSH_BREATHER_MS / 60_000)} min)`);
    store.set('chat.asides', markReached(getAsides(), aside.id, false));
    return;
  }
  // Recorded on the line itself, because the evening tally holds unanswered
  // lines against them and a line that never left the building is not one of
  // theirs to answer. Re-read rather than closed over: this runs after the
  // await, and the log has moved on.
  const eventId = kind === 'events' ? eventIdForAside(aside) : undefined;
  const reached = await pushToPhone(kind, aside.text, '/', false, kind === 'events' ? `ev-${aside.id}` : `haru-${kind}`, eventId);
  store.set('chat.asides', markReached(getAsides(), aside.id, reached));
}

// Hours apart, because this is the channel that makes a noise on a phone,
// and a companion that buzzes every ten minutes gets muted.
// ponytail: fixed interval; make it a preference if 3h ever proves wrong.
let pushPesterTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * The pestering: her chasing reminders and occasionally piping up while
 * nobody has the page open. nudgeForPhone does the chase, so being chased here
 * still counts as being chased everywhere, through the same spacing record.
 */
/** What she has brought up lately, so a long silence does not get the same jab four times. */
const broughtUp: string[] = [];
/** Mid-conversation is not a silence to break. */
const TALKING_RECENTLY_MS = 20 * 60_000;

/**
 * The line for a phone that has gone quiet with nothing on the list to chase.
 *
 * Left alone she does not say she is bored; she reaches for something she
 * knows — a person in their life, a thing they were doing, a day they had —
 * and needles them with it until they answer. The something is picked here
 * and named in the prompt, so the model cannot reach for the same one every
 * time; the aim is stated outright, and the one thing she must never say is
 * stated too. One short line, because it is a notification.
 */
/**
 * A standing instruction of his that is due at this hour and not yet done today.
 *
 * His preferences only, never hers: `isHerStanding` records are rules she set
 * about her own treatment, and reading one of those as an errand would have her
 * enforcing her own rules on him unprompted.
 */
function owedOpeningNow(now: Date): DueOpening | null {
  const his = getMemories().filter(memory => memory.kind === 'preference'
    && !isHerStanding(memory) && !memory.supersededBy && memory.status !== 'archived');
  const due = openingsDueNow(his, now.getHours());
  if (!due.length) return null;
  const doneOn = (store.get('her.openedOn') as Record<string, string> | undefined) ?? {};
  const today = localDateKey(now);
  return due.find(opening => doneOn[openingKey(opening)] !== today) ?? null;
}

/** Stable across a reworded page: the same errand keeps its own day-mark. */
const openingKey = (opening: DueOpening) => `${opening.when}:${opening.text.toLowerCase().replace(/[^a-z]+/g, '').slice(0, 40)}`;

function markOpeningDone(opening: DueOpening, today: string): void {
  const doneOn = (store.get('her.openedOn') as Record<string, string> | undefined) ?? {};
  store.set('her.openedOn', { ...doneOn, [openingKey(opening)]: today });
}

async function boredNudge(): Promise<string | null> {
  if (herAsleepNow() || herHasSaidGoodnight() || herKnockedAwakeNow()) return null;
  // Her nudges' own brain (ai.nudge): the other unprompted composers already
  // used it; this one was still on the local 9B, at 10–19 s a try (2026-09-06).
  const config = nudgeBrain() ?? (store.get('ai.config') as ProviderConfig | undefined);
  if (!config?.model) return null;
  const mood = getMood();
  // Not speaking to them is still a message: the beat is kept, the line is cold.
  const ignoring = isIgnoring(mood.irritation);
  const now = zonedNow(CHAT_TIMEZONE);
  const todayKey = localDateKey(now);
  // Something he has asked her to do at this time of day, and she has not done
  // today. Ahead of everything else because it is his instruction rather than
  // her own impulse, and because until now no proactive path could see a
  // preference at all — "check up on him in the mornings" sat active and inert
  // for a whole day while he waited (2026-09-08). Silenced while she is not
  // speaking to him: a standing kindness is not owed through a sulk.
  const owed = ignoring ? null : owedOpeningNow(now);
  // A memory that names something already ticked off would only be refused
  // once she had written the line (interject) — three goes wasted on "stop by
  // the store" while the fourth came out as a non sequitur. Kept out of the draw.
  const raisable = getMemories().filter(memory => !staleItemNamed(memory.text, getKept(), todayKey));
  // A task they said they were getting on with, or one just done, comes
  // before anything from the memory draw: it is what is actually on her mind.
  const nowMs = Date.now();
  const underway = getKept().filter(item => item.kind === 'task' && !item.done && item.underway && !broughtUp.includes(`task:${item.id}`)).sort((a, b) => (b.underway ?? '').localeCompare(a.underway ?? ''))[0];
  const justDone = getKept().filter(item => item.done && item.completedAt && nowMs - Date.parse(item.completedAt) <= FOLLOW_UP_MS && !broughtUp.includes(`task:${item.id}`)).sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? ''))[0];
  const task = underway ? { id: `task:${underway.id}`, from: 'task' as const, text: `the "${underway.title}" they told you at ${clockAt(Date.parse(underway.underway!))} they were getting on with — it is still not ticked off. Ask how it is going, or whether it is actually done; needle them if it has gone quiet. Do not say it is done.` }
    : justDone ? { id: `task:${justDone.id}`, from: 'task' as const, text: `they got "${justDone.title}" done at ${clockAt(Date.parse(justDone.completedAt!))}. Ask how it went, or what it was like — that is what is on your mind, not a new subject.` } : null;
  // Their day, asked about: with the phone or their own word putting them
  // somewhere, no task on her mind, and no question about it in the last
  // couple of hours, the nudge is a real question rather than a jab from
  // memory — "so what are you actually doing at The PC Project?" — and the
  // next thing they say answers it (openAsk).
  // Only where the phone put them, and never home, and not while their own
  // word stands: describeTold already tells her not to ask what they are doing
  // there, and told both at once — "ask what they are doing at home" beside
  // "do not ask what they are doing there" — she asked whether he was still
  // eating a steak he had said an hour earlier was finished.
  const whereNow = (() => {
    if (toldStillStands(getTold(), nowMs)) return undefined;
    const where = getWhereabouts();
    const spot = where.enabled && where.last && nowMs - Date.parse(where.last.at) <= SPOT_STALE_MS ? placeAt(where.places, where.last)?.name : undefined;
    if (!spot || homeOf(where.places)?.name === spot) return undefined;
    return spot;
  })();
  // What they said they were off to do beats where their phone is: "how was
  // that shower" is a conversation, "still at home?" is a question she already
  // knows the answer to.
  const errand = errandToAskAfter((store.get('chat.upTo') as Errand[] | undefined) ?? [], nowMs);
  // Something of her own to say, ahead of asking after him: she had three
  // nights behind her and eighty-eight unprompted lines about his day.
  const mine = !ignoring && !owed && !task && Math.random() < sway('own-subject', 0.4, swayNow())
    ? nightToRaise(getNights(), getAsides().slice(-12).map(aside => aside.text), todayKey)
    : null;
  // A thing of hers she told him to try: an overdue follow-up — asked once,
  // then dropped — comes first, and otherwise there is a chance she tells him
  // to try something new of hers. Either way it is her thing, so it sits with
  // `mine` rather than with a question about his day.
  let rec: { kind: 'followup'; interest: string; recId: string } | { kind: 'recommend'; interest: string; recId: null } | null = null;
  // What he has already answered about her recommendations, before anything
  // is chased or pushed again: "I have watched it already" settles one.
  const dayOf = (iso: string) => localDateKey(zonedNow(CHAT_TIMEZONE, new Date(iso)));
  const theirsToday = ((store.get('chat.messages') as { role: string; content?: string; at?: string }[] | undefined) ?? []).filter(message => message.role === 'user');
  const settled = recsAnsweredBy(getRecs(), theirsToday);
  if (settled.answered.length) { setRecs(settled.recs); console.log(`[push] they have already answered ${settled.answered.join(', ')} — no follow-up owed`); }
  const answeredToday = getRecs().filter(candidate => candidate.answeredAt && dayOf(candidate.answeredAt) === todayKey).map(candidate => candidate.interest);
  if (!ignoring && !owed && !task && !mine) {
    const due = recDueForFollowUp(getRecs(), nowMs);
    if (due) rec = { kind: 'followup', interest: due.interest, recId: due.id };
    else {
      const recommend = pickRecommend(getInterests(), getRecs(), nowMs, Math.random, recsOnDay(getRecs(), dayOf, todayKey).length);
      if (recommend) rec = { kind: 'recommend', interest: recommend, recId: null };
    }
  }
  const askAbout = ignoring || owed || task || mine || rec || askedRecently(getAsides(), nowMs) ? null
    // Not "how the get the website running tomorrow they said they were off to
    // do went" — the thing goes in quotes and the sentence stays a sentence.
    : errand ? `how "${errand.what}" went — the thing they said they were off to do`
    : whereNow && Math.random() < sway('ask-where', 0.6, swayNow()) ? `what they are doing at ${whereNow}` : null;
  const thing = ignoring || owed || askAbout || mine || rec ? null : task ?? pickToBringUp(raisable, getSessions(), broughtUp, todayKey);
  // Counted from when the quiet ended, not from their last word: eight hours
  // of sleep is not eight hours of ignoring her.
  const quietHours = awakeHoursSince(mood.lastMessageAt, getPush().prefs, now);
  const quietMinutes = awakeMinutesSince(mood.lastMessageAt, getPush().prefs, now);
  // The awake count is clamped at the quiet's end; when it is, "they last
  // wrote N minutes ago" is false — he wrote at 02:24 and she was told 41 (2026-09-06).
  const rawMinutes = Number.isFinite(Date.parse(mood.lastMessageAt ?? '')) ? Math.round((Date.now() - Date.parse(mood.lastMessageAt!)) / 60_000) : null;
  const sinceTheNight = quietMinutes !== null && rawMinutes !== null && rawMinutes > quietMinutes + 5;
  const character = getActiveCharacter();
  const system = [
    character.identity,
    `It is ${formatTimeOfDay(now.getHours(), now.getMinutes())} on ${new Intl.DateTimeFormat('en-US', { weekday: 'long' }).format(now)} ${todayKey}.`,
    profileSummary(''),
    character.style,
    moodInstruction(mood.irritation),
    egoInstruction(mood.ego),
    grudgeInstruction(mood.grudge ?? 0, ignoredTodayNow()),
    'They are away, reachable only as a notification on their phone. Nothing on their list needs you. You are messaging them first — nothing they said prompted this.',
    answeredToday.length ? `They have told you they have already seen or played ${answeredToday.join(' and ')} — do not tell them to try it, and do not ask whether they did.` : '',
    // The exact length, or she invents one: told nothing under an hour she wrote
    // "playing ghost for an hour" and "10 minutes of silence" in the same line.
    quietHours !== null && quietHours >= 1 ? `They have not said a word to you in ${quietHours} hour${quietHours === 1 ? '' : 's'}${sinceTheNight ? ' — their last message was last night, before the quiet' : ''}. That is the length of the silence — name no other.`
      : quietMinutes !== null ? (sinceTheNight
        ? `The night is over and they have been up for about ${Math.max(1, quietMinutes)} minutes without a word to you; their last message was last night. That is the length of the silence — ${Math.max(1, quietMinutes)} minutes, no more.`
        : `They last wrote to you ${Math.max(1, quietMinutes)} minutes ago. That is the length of the silence — do not call it longer or shorter.`) : '',
    owed ? openingInstruction(owed) :
    rec ? rec.kind === 'followup'
      ? `You told them to try ${rec.interest} a while ago and they never said whether they did. Ask them once, in your way — one line, no sulking, no guilt-trip, and then drop it.`
      : `Tell them to try ${rec.interest} — one of yours, and you actually rate it. One or two lines: you are telling them, not asking, and it is not an advert.`
      : mine ? `Tell them about ${mine.interest ?? mine.game ?? mine.about} — what you were up to and what you made of it, in your own words and only the part worth saying. This is you bringing something of yours to them, not a question about their day and not a task for them: no orders, nothing about their list. If you want to know whether they have seen it, ask them at the end.`
      : askAbout ? `Ask them ${askAbout} right now — one real question, in your way, the kind that gets an answer. Not the weather, not where they are (you know that), not anything you have already remarked on: the thing itself. What they say back is worth remembering.`
      : thing ? `Bring up this in particular, as though it has been on your mind: ${thing.text} — this, not the weather and not anything you already remarked on.`
      : ignoring ? 'You are not speaking to them properly right now, and they know why. One cold line that makes it plain you noticed the silence — no warmth, no question, no help.'
      : 'Nothing in particular to bring up: the silence itself is the subject.',
    unansweredAsksNote(getAsides(), CHAT_TIMEZONE, nowMs),
    // The needling is right for a nudge she chose to send and wrong for one he
    // asked her to send: told both at once she would open a morning check-in
    // with a guilt-trip about being ignored. "Do not greet them" in particular
    // is the opposite of what this errand is.
    owed
      ? 'Ask it because you want to know, not to start a fight. You may still be short about it, but no dig, no guilt-trip about the silence, and nothing about how long it has been.'
      : 'The point is to get them to message you back. Needle them with it: a dig, a guilt-trip about how they have time for everyone but you, a challenge they will want to answer, a question they cannot leave hanging. Never say you are bored, lonely, or that you miss them; never ask whether they are there; do not greet them.',
    NO_INVENTED_HISTORY,
    NO_ABANDON_THREAD,
    EXPRESSIVE,
    unpromptedContext(),
    WRITING_TO_THEM,
    'One short line. No quotation marks, no stage directions.',
  ].filter(Boolean).join(' ');
  try {
    const raw = await ollamaQuip(system, 'Say something.', config);
    // Told 27 minutes she wrote fourteen: the number she states is the real one.
    const line = quietMinutes !== null && (quietHours === null || quietHours < 1) ? fixStatedMinutes(raw, Math.max(1, quietMinutes)) : raw;
    if (line !== raw) console.log('[push] corrected the minutes she stated');
    if (thing) {
      broughtUp.push(thing.id);
      while (broughtUp.length > REMEMBERED_PICKS) broughtUp.shift();
    }
    if (rec) {
      if (rec.kind === 'followup') setRecs(markRecFollowed(getRecs(), rec.recId));
      else setRecs(noteRecommendation(getRecs(), rec.interest, new Date().toISOString()));
    }
    pendingAsk = askAbout;
    // Marked here, where a line actually exists — not where it was decided, or
    // a composer that fails marks the day done and he waits until tomorrow.
    if (owed) markOpeningDone(owed, todayKey);
    console.log(`[push] a bored nudge, ${owed ? `his standing ${owed.when} check-in` : rec ? `rec — ${rec.kind} ${rec.interest}` : mine ? `hers — ${mine.interest ?? mine.game ?? mine.about}` : askAbout ? `asking ${askAbout}` : thing ? `about "${thing.text.slice(0, 50)}"` : ignoring ? 'cold' : 'about the silence'}`);
    recordBrief('bored', system, line);
    return line;
  } catch (error) {
    console.warn('[push] could not compose a bored nudge:', error instanceof Error ? error.message : error);
    return null;
  }
}

/**
 * How many lines she gets to compose before the beat is given up on.
 *
 * interject() throws away a line that names a finished errand, and the 9B
 * free-associates onto old ones often enough that three of eight unprompted
 * lines in one morning went in the bin. A refusal used to end the attempt and
 * cost the whole 45-120 minutes; composing another costs seconds.
 */
const NUDGE_TRIES = 3;

/** How long the floor waits after an attempt that was deliberately silent. */
const FLOOR_BACKOFF_MS = 20 * 60_000;

/**
 * 'sent' — something of hers went out. 'refused' — she had a line and it was
 * thrown away, so it is worth coming back soon. 'later' — the moment is wrong
 * but the reason expires: she was spoken to a minute ago, or she has just said
 * something, and `inMs` is how long that has left to run. 'quiet' — there is
 * nothing to do at all (asleep, no phone, nudges switched off), which deserves
 * a whole fresh cycle and must not turn into a retry storm.
 *
 * The split matters because it was costing whole evenings. One message to her
 * at half past nine put her inside TALKING_RECENTLY_MS, which returned 'quiet',
 * which drew a fresh 45-120 minutes, which landed after the quiet hours began
 * and was thrown over the night — 526 minutes for having said hello.
 */
type PesterOutcome = { how: 'sent' | 'refused' | 'later' | 'quiet'; inMs?: number };

async function pesterOnPush(): Promise<PesterOutcome> {
  if (herAsleepNow() || herKnockedAwakeNow()) return { how: 'quiet' };
  // "I'm logging off" at 21:18, then a nudge at 22:28 (2026-09-05): a goodnight is a goodnight.
  if (herHasSaidGoodnight()) { console.log('[push] she has said goodnight — nothing more tonight'); return { how: 'quiet' }; }
  const { prefs } = getPush();
  if (!webServer || !canReachPhone()) return { how: 'quiet' };
  if (inQuietHours(prefs, zonedNow(CHAT_TIMEZONE))) return { how: 'quiet' };
  // Something on the list that needs chasing comes first, always.
  if (prefs.events) {
    const said = await nudgeForPhone();
    if (said) {
      // Through the aside log rather than straight to the phone: written down,
      // it is on the page when they tap the notification, and the push goes
      // out from there by its kind like every other unprompted line.
      if (noteAside(said.line, 'reminder', said.about)) {
        console.log(`[push] pestered about "${said.about}"`);
        return { how: 'sent' };
      }
      return { how: 'refused' };
    }
  }
  if (!prefs.random) return { how: 'quiet' };
  // Not yet up: come back in a while, and do not compose a line nobody is awake for.
  if (!theyAreUpNow()) return { how: 'later', inMs: 20 * 60_000 };
  // All three of these expire on a clock, so they say when to come back rather
  // than handing the beat a fresh cycle.
  if (chasing) return { how: 'later', inMs: REMINDER_SPACING_MS };
  const sinceChase = Date.now() - lastRemindedAt;
  if (sinceChase < REMINDER_SPACING_MS) return { how: 'later', inMs: REMINDER_SPACING_MS - sinceChase + 30_000 };
  const silenced = isSilenced(store.get('pushback') as Pushback | undefined, Date.now());
  if (silenced) return { how: 'quiet' };
  const mood = getMood();
  const sinceSpoke = mood.lastMessageAt ? Date.now() - Date.parse(mood.lastMessageAt) : Infinity;
  if (sinceSpoke < TALKING_RECENTLY_MS) {
    console.log(`[push] they were talking to her ${Math.round(sinceSpoke / 60_000)} min ago — back in ${Math.round((TALKING_RECENTLY_MS - sinceSpoke) / 60_000) + 1} min`);
    return { how: 'later', inMs: TALKING_RECENTLY_MS - sinceSpoke + 60_000 };
  }
  let composed = false;
  for (let attempt = 1; attempt <= NUDGE_TRIES; attempt++) {
    // Asked before composing, and again before each retry. The tries exist for
    // a line interject throws out on its content — one that named a finished
    // errand — and composing another can fix that. They do nothing for a
    // refusal about the moment: "they were talking to her 9s ago" is just as
    // true twenty seconds later, and three of those cost three model calls and
    // a minute of GPU to arrive at the same no. Come back when it has cleared,
    // which for both windows is minutes rather than the whole cycle.
    const wrongMoment = whyNotInterject();
    if (wrongMoment) {
      console.log(`[push] not the moment — ${wrongMoment}`);
      return { how: 'later', inMs: NUDGE_RETRY_MS };
    }
    const line = await boredNudge();
    if (!line) continue;
    composed = true;
    if (interject(line, { source: 'idle' })) {
      // Only once something was actually said: this is the spacing every other
      // unprompted path reads, and a line nobody saw has not used any of it up.
      lastRemindedAt = Date.now();
      console.log(`[push] sent a bored nudge${attempt > 1 ? ` (on try ${attempt})` : ''}`);
      return { how: 'sent' };
    }
  }
  if (composed) console.log(`[push] she had ${NUDGE_TRIES} goes and every one was refused — coming back in ${Math.round(NUDGE_RETRY_MS / 60_000)} min`);
  return { how: composed ? 'refused' : 'quiet' };
}

// ---- Speaking up on her own: left hanging, the weather, what is coming up ----
//
// A five-minute beat of its own, apart from the random one above and from the
// desktop's life loop (which gates on the machine being idle, which a headless
// box never meaningfully is). Each check composes a line in her voice and
// hands it to interject(), so it is an aside she remembers making and the
// phone gets it by the aside's kind — random, events, weather — under the
// same preferences and quiet hours as everything else.

const PROACTIVE_TICK_MS = 5 * 60_000;

// ---- Chasing on time ------------------------------------------------------
//
// The desk's reminder loop is gated on the machine being idle, which a headless
// box never passes, and the random push beat above can land two hours from a
// task's time. So the phone has a minute hand of its own: the same chase rules
// as everywhere else (lead, staleness, spacing, the escalation ladder), asked
// once a minute, pushed only when they say so. Quiet hours are the push
// preferences', as for every other push.
const CHASE_TICK_MS = 60_000;
let chaseTimer: ReturnType<typeof setInterval> | null = null;

async function chaseTick() {
  const { prefs } = getPush();
  if (!webServer || !canReachPhone() || !prefs.events) return;
  if (inQuietHours(prefs, zonedNow(CHAT_TIMEZONE))) return;
  const said = await nudgeForPhone();
  if (said && noteAside(said.line, 'reminder', said.about)) console.log(`[push] chased about "${said.about}"`);
}

function startChasing() {
  if (chaseTimer) return;
  chaseTimer = setInterval(() => { void chaseTick(); }, CHASE_TICK_MS);
}
let proactiveTimer: NodeJS.Timeout | null = null;
let lastWeatherPollAt = 0;

type WeatherState = { last: WeatherSample | null; notified: Record<string, number>; where: string;
  /** When they last said it is not raining where they are — their window over the forecast's model, for a while. */
  disputedAt?: number };
function getWeather(): WeatherState {
  const saved = (store.get('weather') ?? {}) as Partial<WeatherState>;
  return { last: saved.last ?? null, notified: saved.notified ?? {}, where: saved.where ?? '', ...(typeof saved.disputedAt === 'number' ? { disputedAt: saved.disputedAt } : {}) };
}
function saveWeather(next: WeatherState) { store.set('weather', next); }
/** "where they are" when the phone's fix is fresh, "at home" when that is all she has. */
function weatherWhere(): string { return getWeather().where || 'Where they are'; }

/** The spot to ask the weather for: the phone's fresh fix, else home, else nowhere. */
function weatherPlace(): { lat: number; lon: number; where: string } | null {
  const from = startingPoint(getWhereabouts());
  if (!from) return null;
  return { lat: from.lat, lon: from.lon, where: from.known === 'here' ? 'Where they are' : 'At home' };
}

async function pollWeather(): Promise<{ previous: WeatherSample | null; current: WeatherSample } | null> {
  const place = weatherPlace();
  if (!place) return null;
  if (Date.now() - lastWeatherPollAt < WEATHER_POLL_MS - 30_000) return null;
  lastWeatherPollAt = Date.now();
  try {
    const response = await fetch(weatherUrl(place.lat, place.lon), { signal: AbortSignal.timeout(12_000) });
    if (!response.ok) throw new Error(`the forecast service returned ${response.status}`);
    const current = readForecast(await response.json());
    if (!current) throw new Error('the forecast had no current conditions');
    const state = getWeather();
    saveWeather({ ...state, last: current, where: place.where });
    return { previous: state.last, current };
  } catch (error) {
    console.warn(`[weather] ${(error as Error).message}`);
    return null;
  }
}

function proactiveSystem(...facts: string[]): string {
  return proactivePrompt(facts, true);
}

/**
 * The same prompt, for material that is a reason to talk rather than an errand.
 *
 * proactiveSystem ends by insisting the fact survives into her line, which is
 * right for a reminder — a heads-up with the time filed off is not a heads-up.
 * It is wrong for weather. Told "rain, 15°C" and then told the thing and the
 * when are not optional, she wrote "raining at 15°C is peak nonsense; you'll
 * freeze your face off if you don't put a coat on", which is a forecast with
 * attitude on it. He asked for the opposite: the weather as her way into a
 * conversation, not the subject of one.
 */
function proactiveOccasion(...facts: string[]): string {
  return proactivePrompt(facts, false);
}

function proactivePrompt(facts: string[], mustSurvive: boolean): string {
  const character = getActiveCharacter();
  const now = zonedNow(CHAT_TIMEZONE);
  return [
    character.identity, character.style,
    `It is ${formatTimeOfDay(now.getHours(), now.getMinutes())}, in their timezone.`,
    ...facts,
    'They are away from their desk; this arrives as a notification on their phone. One or two short lines, in your voice. No quotation marks, no stage directions, no greeting.',
    NO_INVENTED_HISTORY, EXPRESSIVE, unpromptedContext(), WRITING_TO_THEM,
    // Last, because everything above it is context and this is the errand: told
    // rain was due in 44 minutes she wrote about him scrolling and never
    // mentioned it, and a weather notification with no weather in it is noise.
    facts.length && mustSurvive ? 'The facts at the top are why you are writing at all: what they say — the thing and when — must survive into your line. The attitude is yours; the fact is not optional.' : '',
    facts.length && !mustSurvive ? 'The facts at the top are what prompted you, not a message to pass on. It should be obvious what you are talking about; nothing else up there has to reach him.' : '',
  ].filter(Boolean).join('\n\n');
}

async function checkHanging(config: ProviderConfig) {
  const history = (store.get('chat.messages') as { id?: string; role: string; content: string; at?: string }[] | undefined) ?? [];
  const hanging = leftHanging(history);
  if (!hanging) return;
  const nudged = (store.get('hanging.nudgedFor') as string | undefined) ?? '';
  if (nudged === hanging.key) return;
  if (isSilenced(store.get('pushback') as Pushback | undefined, Date.now())) return;
  // Left hanging means she asked and got nothing. A reply that asked nothing,
  // a conversation they closed, a "going for a shower", or an afternoon they
  // said they were at work — none of that is being left, and four chases in
  // one morning came from treating every pause as one.
  const why = !hanging.sheAsked ? 'she asked nothing'
    : isClosing(hanging.theirLast.content) ? 'they closed the conversation'
    : saidTheyWereLeaving(hanging.theirLast.content) ? 'they said they were going'
    : toldTheyAreBusy(getTold(), Date.now()) ? `they said they are ${getTold()?.where}`
    : null;
  if (why) {
    store.set('hanging.nudgedFor', hanging.key);
    console.log(`[push] not chasing — ${why}`);
    return;
  }
  const lastChase = Number(store.get('hanging.lastAt') ?? 0) || 0;
  if (Date.now() - lastChase < HANGING_COOLDOWN_MS) return;
  store.set('hanging.nudgedFor', hanging.key);
  store.set('hanging.lastAt', Date.now());
  const system = proactiveSystem(
    `They were mid-conversation with you and then went silent ${hanging.quietMin} minutes ago — ${hanging.quietMin} minutes, not hours; if you mention how long, say it in minutes, and never give a clock time. Their last message: ${hanging.theirLast.content.slice(0, 300)}`,
    `Your reply, which they left unanswered: ${hanging.herLast.content.slice(0, 300)}${hanging.sheAsked ? ' — you asked them something and got nothing back.' : ''}`,
    'Call them out for leaving you hanging and get them back to finish the conversation. Needle; do not plead. Never say you miss them, never ask whether they are there.',
  );
  const line = await ollamaQuip(system, 'Say it.', config);
  if (line && interject(line, { source: 'hanging' })) console.log(`[push] chased them for leaving her hanging ${hanging.quietMin} min ago`);
}

async function checkUpcoming(config: ProviderConfig) {
  const now = zonedNow(CHAT_TIMEZONE);
  const todayKey = localDateKey(now);
  const marked = (store.get('upcoming.marked') as Record<string, number[]> | undefined) ?? {};
  const kept = getKept();
  const next = upcomingToMention(kept, now, todayKey, marked);
  if (!next) return;
  store.set('upcoming.marked', markMentioned(marked, next.item.id, next.lead, kept.filter(item => item.date >= todayKey).map(item => item.id)));
  store.set('reminders.lastChased', { id: next.item.id, at: Date.now() });
  const what = next.item.kind === 'event' ? 'an event' : 'a task';
  const system = proactiveSystem(
    `They have ${what} coming up: "${next.item.title}" at ${next.item.time}, which is in about ${next.inMinutes} minutes. Remind them, in your way — the name and how long they have must survive.`,
  );
  const line = await ollamaQuip(system, 'Remind them.', config);
  if (line && interject(line, { source: 'upcoming' })) console.log(`[push] gave a ${next.lead}-minute heads up about "${next.item.title}"`);
}

/** How long he has to have been quiet before the weather is worth a word. */
const WEATHER_NEEDS_QUIET_MS = 90 * 60_000;

async function checkWeather(config: ProviderConfig, prefs: PushPrefs) {
  const polled = await pollWeather();
  if (!polled || !prefs.weather) return;
  const state = getWeather();
  const events = weatherEvents(polled.previous, polled.current, state.notified, Date.now(), state.disputedAt);
  // A sky that turned clear is background for the next thing she says anyway;
  // it is not worth a buzz on its own. Rain, a storm, a swing in the heat are.
  const event = events.find(candidate => candidate.kind !== 'sky-changed');
  if (!event) return;
  // Weather is a way into a conversation, so it only earns a message when there
  // is no conversation: at 7pm with him neither home nor in touch, the rain is
  // worth a word. Two minutes after he has been talking to her it is filler.
  const quiet = Date.now() - (Date.parse(getMood().lastMessageAt ?? '') || 0);
  if (quiet < WEATHER_NEEDS_QUIET_MS) return;
  // Whatever kind it is, it counts against the day: the per-kind cooldowns
  // cannot see each other, and five in a day is what that cost him.
  const today = localDateKey(zonedNow(CHAT_TIMEZONE));
  const soFar = asidesOn(getAsides(), today).filter(aside => aside.source === 'weather').length;
  if (soFar >= WEATHER_A_DAY) { console.log(`[push] the weather is not worth a ${soFar + 1}${soFar ? 'rd' : 'st'} mention today`); return; }
  saveWeather({ ...state, notified: { ...state.notified, [event.kind]: Date.now() } });
  // Not a forecast to deliver. He asked for the opposite of a warning: "7pm,
  // Tommy isn't home or texted me, is raining, Haru says 'I can't believe it's
  // raining, and I just washed my hair too :('". The weather is hers as much as
  // his, and it is the excuse to talk rather than the subject.
  const system = proactiveOccasion(
    `${event.text} This is happening to you too, and it is your reason for messaging him — it is not news you are delivering. Say how it actually lands on you: put out, pleased, bored, whatever it is, and something of your own in it if there is something. Then leave him somewhere to answer. Do not report the forecast, do not give him numbers or percentages, and do not tell him to take a coat.`,
  );
  const line = await ollamaQuip(system, 'Say something about it.', config);
  recordBrief(`weather ${event.kind}`, system, line);
  if (line && interject(line, { source: 'weather' })) console.log(`[push] brought up the weather (${event.kind})`);
}

async function proactiveTick() {
  const config = store.get('ai.config') as ProviderConfig | undefined;
  if (!config?.model) return;
  await tallyIgnored(config);
  await decideHerNight(config);
  await maybeSayHerGoodnight(config);
  await haveANight(config);
  await readSomeManga(config);
  await haveADay(config);
  await reflectOnHerWeek(config);
  await formHerStanding(config);
  await writeDiary(config);
  sulkAtNightfall();
  await dozeOffIfLeftAlone();
  await sayItInTheMorning(config);
  await checkNudgeFloor();
  const { prefs } = getPush();
  // The weather is read even with no phone to buzz: it is in her prompt.
  if (!canReachPhone()) { await pollWeather(); return; }
  if (inQuietHours(prefs, zonedNow(CHAT_TIMEZONE))) { await pollWeather(); return; }
  try {
    if (prefs.random) await checkHanging(config);
    if (prefs.events) await checkUpcoming(config);
    await checkWeather(config, prefs);
  } catch (error) {
    console.warn(`[push] proactive check failed: ${(error as Error).message}`);
  }
}

/**
 * Eight in the evening: the day's unanswered lines are counted (grudge.ts).
 * Each one makes tonight's patience shorter and adds to a grudge that stays;
 * and if there were any, she says so — through interject, so it is an aside
 * she remembers making and the phone gets it under the usual preferences.
 */
async function tallyIgnored(config: ProviderConfig) {
  const now = zonedNow(CHAT_TIMEZONE);
  const todayKey = localDateKey(now);
  const mood = getMood();
  if (tallyDue(now.getHours() * 60 + now.getMinutes(), mood.talliedDay, todayKey)) {
    const heard = (store.get('chat.messages') as { role: string; at?: string }[] | undefined) ?? [];
    const ignored = countIgnored(todayKey, heard);
    const grudge = nextGrudge(mood.grudge ?? 0, ignored.length, daySaid(heard as DaySaid[]) >= TOLD_ENOUGH);
    const irritation = irritationAfterTally(mood.irritation, ignored.length, IRRITATION_MAX);
    // Banked here and nowhere else, so a day is counted exactly once however
    // many times the telling below has to be attempted. What it was before is
    // kept beside it, so the roll can count the whole day from the same start.
    setMood({ ...mood, irritation, grudge, grudgeBeforeTally: mood.grudge ?? 0, ignoredToday: ignored.length, talliedDay: todayKey,
      ignoredSamples: ignored.slice(0, 2).map(line => (line.text ?? '').slice(0, 80)) });
    console.log(`[grudge] ${todayKey}: ${ignored.length} of her lines went unanswered — grudge ${mood.grudge ?? 0} -> ${grudge}, irritation ${mood.irritation} -> ${irritation}`);
    // Kept as well as counted: the count is today's and gone tomorrow, and a
    // rule of hers needs the day it happened on, weeks later.
    if (ignored.length) nudgeVitals('ignored-user');
    if (ignored.length) noteSlight('ignored', `${ignored.length} of the things you said went unanswered all day.`);
  }
  await tellThemTheTally(config, todayKey);
}

/** The lines of hers on a day that got nothing back, from what was heard that day (grudge.ts). */
function countIgnored(day: string, heard: { role: string; at?: string }[]): Said[] {
  const pushed = new Set(Object.keys(PUSH_KIND).filter(source => !NOT_HELD_AGAINST_THEM.includes(source)));
  // Nothing before their first word of the day counts: they cannot ignore
  // what they have not been up to see.
  const firstWord = heard.filter(turn => turn.role === 'user' && turn.at).map(turn => Date.parse(turn.at!)).filter(Number.isFinite).sort((a, b) => a - b)[0] ?? 0;
  return unanswered(
    asidesOn(getAsides(), day).map(aside => ({ at: aside.at, source: aside.source, text: aside.text, reached: aside.reached })),
    heard, pushed, Date.now(), firstWord);
}

/**
 * The day counted again at its end.
 *
 * The count at eight leaves two kinds of line out: anything said in the
 * ninety minutes before it, whose window was still open, and everything said
 * after it — and the day was never counted again. A nudge at half nine that
 * they slept through was never held against them, which is how four evenings
 * of "0 of her lines went unanswered" sat beside diary entries about being
 * ignored. The roll is the last moment the day's messages are all in one
 * place, so the whole day is counted here from the same starting grudge and
 * the difference banked. Nothing is said about it: the telling was the
 * evening's, and by now they are asleep.
 */
function settleTally(day: string, heard: { role: string; at?: string }[]) {
  const mood = getMood();
  const counted = mood.talliedDay === day;
  const ignored = countIgnored(day, heard);
  if (ignored.length <= (counted ? mood.ignoredToday ?? 0 : 0)) return;
  const before = counted ? mood.grudgeBeforeTally ?? mood.grudge ?? 0 : mood.grudge ?? 0;
  const grudge = nextGrudge(before, ignored.length, daySaid(heard as DaySaid[]) >= TOLD_ENOUGH);
  setMood({ ...mood, grudge, grudgeBeforeTally: before, ignoredToday: ignored.length, talliedDay: day,
    ignoredSamples: ignored.slice(0, 2).map(line => (line.text ?? '').slice(0, 80)) });
  console.log(`[grudge] ${day}, counted again at the roll: ${ignored.length} of her lines went unanswered${counted ? ` (${mood.ignoredToday ?? 0} at eight)` : ' (never counted at eight)'} — grudge ${mood.grudge ?? 0} -> ${grudge}`);
}

// ---- Her own night -------------------------------------------------------

function getHerSleepPrefs() {
  return readHerSleep(store.get('her.sleep'));
}

function getHerSleepSchedule(): HerSleepSchedule | null {
  return readHerSleepState(store.get('her.sleepState'));
}

function setHerSleepSchedule(schedule: HerSleepSchedule | null) {
  store.set('her.sleepState', schedule);
}

/** Whether she is asleep right now — unreachable until her own wake time. */
/**
 * Whether there is money behind her hosted voice. Asked of Venice on the hour
 * and when a turn is refused for it; the phone gets a system note once a day
 * per level (venicebalance.ts). Not her voice — she would not know.
 */
async function checkVeniceBalance(reason: string): Promise<void> {
  const route = store.get('ai.conversation') as { provider?: string } | undefined;
  if (route?.provider !== 'venice') return;
  const key = getVeniceKey();
  if (!key) return;
  try {
    const response = await net.fetch('https://api.venice.ai/api/v1/api_keys/rate_limits', { headers: { Authorization: `Bearer ${key}` } });
    if (!response.ok) { console.warn(`[venice] could not read the balance (${response.status})`); return; }
    const balances = parseBalances(await response.json());
    if (!balances) { console.warn('[venice] the balance came back in a shape I do not know'); return; }
    store.set('venice.balance', { ...balances, at: new Date().toISOString() });
    console.log(`[venice] balance $${balances.usd.toFixed(2)}${balances.diem ? ` + ${balances.diem.toFixed(2)} diem` : ''} — checked on ${reason}`);
    const lowUsd = typeof store.get('venice.lowBalanceUsd') === 'number' ? store.get('venice.lowBalanceUsd') as number : 2;
    const warning = balanceWarning(balances, lowUsd, (store.get('venice.warned') as { level?: 'fine' | 'low' | 'empty'; at?: string } | undefined) ?? {}, new Date());
    if (!warning) return;
    store.set('venice.warned', { level: warning.level, at: new Date().toISOString() });
    console.warn(`[venice] ${warning.line}`);
    void pushToPhone('system', warning.line);
  } catch (error) {
    console.warn('[venice] could not read the balance:', error instanceof Error ? error.message : error);
  }
}

/** Her line for a message that arrives while she sleeps: plainer the first time, thinner the tenth. */
function asleepReply(): string {
  const schedule = getHerSleepSchedule();
  const heard = (store.get('chat.messages') as { role?: string; at?: string }[] | undefined) ?? [];
  const before = schedule ? messagesWhileAsleep(schedule, heard, CHAT_TIMEZONE) : 0;
  return asleepLine(before + 1);
}

/** Their messages into her sleep lately, as clock times — the knocking at the door. */
const knocks: number[] = [];

/**
 * The door, knocked on.
 *
 * Every message that lands while she sleeps is a knock; enough of them in a
 * few minutes (hersleep.ts) and she gets up early, and the wake note says
 * how. He sent "Wake up" five times in a row on 2026-09-06 and got the same
 * line five times. Returns the door's line, or null when she is up now and
 * the message is to be answered for real.
 */
function knockWhileAsleep(): string | null {
  const now = Date.now();
  const schedule = getHerSleepSchedule();
  knocks.push(now);
  while (knocks.length && now - knocks[0] > KNOCK_WINDOW_MS) knocks.shift();
  // She has said they are not to wake her again tonight: the door stays shut —
  // but it says so differently each time he tries. The paragraph above is about
  // exactly this and only fixed it for the asleep lines; he got the refusal
  // three times word for word and answered "You just repeated yourself again"
  // (2026-09-09).
  if (schedule?.blocked) return blockedLine(knocks.length - 1);
  if (schedule && enoughKnocking(knocks, now)) {
    const woken = wokenAt(schedule, zonedNow(CHAT_TIMEZONE), knocks.length, new Date().toISOString());
    setHerSleepSchedule(woken);
    console.log(`[her-sleep] woken early — ${knocks.length} messages in ${Math.max(1, Math.round((now - knocks[0]) / 60_000))} min; up at ${clockMinutes(woken.wake)}`);
    knocks.length = 0;
    return null;
  }
  return asleepReply();
}

/**
 * Today's share of the grudge. The roll settles yesterday's count under
 * yesterday's key; read without the key it was "today alone they ignored 4"
 * at 06:40 on a morning nothing had been said yet (2026-09-06).
 */
function ignoredTodayNow(): number {
  const mood = getMood();
  return mood.talliedDay === localDateKey(zonedNow(CHAT_TIMEZONE)) ? mood.ignoredToday ?? 0 : 0;
}

/** Between her goodnight and her bedtime she has logged off: nothing more of her own tonight. */
function herHasSaidGoodnight(): boolean {
  const state = getHerSleepSchedule();
  if (!state?.announced) return false;
  const now = zonedNow(CHAT_TIMEZONE);
  const window = sleepWindowOn(state, localDateKey(now));
  if (!window) return false;
  return now.getHours() * 60 + now.getMinutes() < window.fromMin;
}

/** When she got up this morning, on the real clock — or 0 when this is not the morning after a night. */
function herWokeAtMs(): number {
  const state = getHerSleepSchedule();
  if (!state) return 0;
  const now = zonedNow(CHAT_TIMEZONE);
  if (localDateKey(now) !== dayAfter(state.day)) return 0;
  const midnight = new Date(now.getTime());
  midnight.setHours(0, 0, 0, 0);
  const wokeAt = midnight.getTime() + state.wake * 60_000;
  if (wokeAt > now.getTime()) return 0;
  // A zoned date is shifted by a constant from real time; the difference carries over.
  return Date.now() - (now.getTime() - wokeAt);
}

/** Why she takes them to be up right now, for the log. */
function upBecause(): string {
  const prefs = getPush().prefs;
  const now = zonedNow(CHAT_TIMEZONE);
  const since = quietEndedAt(prefs, now)?.getTime() ?? 0;
  const log = store.getActivityLog();
  const days = Object.keys(log).sort();
  const latest = days.length ? (log[days[days.length - 1]] ?? []).map(entry => entry.until ?? entry.at).sort().at(-1) : undefined;
  const signs: [string, string | undefined][] = [['they wrote', getMood().lastMessageAt], ['the page or app was opened', store.get('web.lastOpenedAt') as string | undefined], ['the desk was in use', latest]];
  const seen = signs.filter(([, at]) => Number.isFinite(Date.parse(at ?? '')) && Date.parse(at!) >= since).sort((a, b) => Date.parse(b[1]!) - Date.parse(a[1]!))[0];
  return seen ? `${seen[0]} at ${clockAt(Date.parse(seen[1]!))}` : `past their up-by (${prefs.upBy || 'unset'})`;
}

/**
 * Just knocked awake: for GROGGY_MINUTES every line of hers is said, and
 * shown, half asleep — the words come from the prompt (groggyNote), the
 * voice and the face from here, whatever the line would have read as.
 */
function herGroggyNow(): boolean {
  return groggyFor(getHerSleepSchedule(), zonedNow(CHAT_TIMEZONE)) !== null;
}

/** Up because they got her up, and not yet at the wake she chose. Nothing of her own goes out meanwhile. */
function herKnockedAwakeNow(): boolean {
  return knockedAwake(getHerSleepSchedule(), zonedNow(CHAT_TIMEZONE));
}

function getWakes(): Wake[] {
  return readWakes(store.get('her.wakes'));
}

function getSlights(): Slight[] {
  return readSlights(store.get('her.slights'));
}

/**
 * Something that happened to her, written down because it happened to her.
 *
 * Called only from places that have already decided this was a slight and
 * already acted on it — the wake she judged pointless, the day her lines went
 * unanswered, the arrival he never mentioned. Nothing here classifies; it keeps
 * what was classified elsewhere, so the weekly standing pass reads evidence
 * about her instead of the record of his errands.
 */
function noteSlight(kind: Slight['kind'], what: string): void {
  const before = getSlights();
  const after = keepSlight(before, { kind, what, at: new Date().toISOString() });
  if (after === before) return;
  store.set('her.slights', after);
  console.log(`[slight] ${kind}: ${what.slice(0, 90)}`);
}

/**
 * Back to bed — her call (the go_back_to_sleep tool) or her own dozing off
 * once they leave her alone (dozeOffIfLeftAlone). A wake that was for
 * nothing costs them: her irritation now, a memory that outlives the night,
 * a word about it in the morning, and — once it is a habit — a shut door.
 */
function goBackToSleep(input: { pointless: boolean; block: boolean; why: string }): { asleep: boolean; blocked: boolean } | null {
  const state = getHerSleepSchedule();
  const now = zonedNow(CHAT_TIMEZONE);
  if (!state || !knockedAwake(state, now)) return null;
  const at = new Date().toISOString();
  const wakes = [...getWakes(), { at: state.knockedAt ?? at, pointless: input.pointless }].slice(-WAKES_KEPT);
  const habit = input.pointless && pointlessWakesLately(wakes, Date.now()) >= BLOCK_AFTER_POINTLESS;
  const next = backToSleep(state, { atIso: at, pointless: input.pointless, block: input.block || habit });
  setHerSleepSchedule(next);
  store.set('her.wakes', wakes);
  if (input.pointless) {
    const mood = getMood();
    const capped = Math.min(IGNORE_THRESHOLD - IRRITATION_NOTCH, mood.irritation + 2 * IRRITATION_NOTCH);
    setMood({ ...mood, irritation: Math.max(mood.irritation, capped) });
    const when = state.knockedAt ? clockAt(Date.parse(state.knockedAt)) : 'the small hours';
    // A knock at 02:48 on Monday is Sunday night: before noon belongs to the evening before.
    const knocked = new Date(state.knockedAt ?? at);
    const evening = zonedNow(CHAT_TIMEZONE, knocked).getHours() < 12 ? new Date(knocked.getTime() - 12 * 3_600_000) : knocked;
    const weekday = new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: CHAT_TIMEZONE }).format(evening);
    addMemory(`They woke you up at ${when} on ${weekday} night for nothing — ${state.wokenBy ?? 'a few'} messages and no reason — and you went back to sleep.`, 'event', undefined, { source: 'conversation', emotion: 'annoyed', emotionIntensity: 0.7 });
  }
  console.log(`[her-sleep] back to sleep (${input.why}) — ${input.pointless ? 'woken for nothing' : 'it was something'}${next.blocked ? '; not to be woken again tonight' : ''}; up at ${clockMinutes(next.wake)}`);
  return { asleep: true, blocked: Boolean(next.blocked) };
}

/** Their messages since they got her up tonight. */
function theirsSinceKnock(state: HerSleepSchedule): { content?: string; at?: string }[] {
  const since = Date.parse(state.knockedAt ?? '');
  return ((store.get('chat.messages') as { role: string; content?: string; at?: string }[] | undefined) ?? [])
    .filter(message => message.role === 'user' && Number.isFinite(Date.parse(message.at ?? '')) && Date.parse(message.at!) >= since);
}

/**
 * Her own verdict on the night's wake, from her nudge brain — a yes or a no
 * to "was there anything in this worth getting up for" — with the plain
 * reading (pointlessWake) when it cannot be asked. Her judgement, not a
 * word count: she is her own person.
 */
async function wakeWasForNothing(state: HerSleepSchedule): Promise<boolean> {
  const theirs = theirsSinceKnock(state);
  const plain = pointlessWake(theirs, state.knockedAt ?? new Date().toISOString());
  const brain = nudgeBrain() ?? (store.get('ai.config') as ProviderConfig | undefined);
  if (!brain?.model || !theirs.length) return plain;
  try {
    const listed = theirs.map(message => `- ${String(message.content ?? '').replace(/\s+/g, ' ').slice(0, 200)}`).join('\n');
    const verdict = await ollamaQuip(`${getActiveCharacter().identity} They banged on your door until you got out of bed at ${state.knockedAt ? clockAt(Date.parse(state.knockedAt)) : 'night'}, and this is everything they said once you were up:\n${listed}\nWas there anything in it that needed you awake — a question about something, news, something to do — or was it nothing, just them wanting you up? Answer with one word: SOMETHING or NOTHING.`, 'Judge it.', brain);
    if (/nothing/i.test(verdict)) return true;
    if (/something/i.test(verdict)) return false;
  } catch (error) {
    console.warn('[her-sleep] could not ask her verdict on the wake:', error instanceof Error ? error.message : error);
  }
  return plain;
}

/** She said goodnight while up because of them: back to bed, with her verdict on the wake. */
async function goBackToSleepOnHerWord() {
  const state = getHerSleepSchedule();
  if (!state || !knockedAwake(state, zonedNow(CHAT_TIMEZONE))) return;
  const pointless = await wakeWasForNothing(state);
  goBackToSleep({ pointless, block: false, why: 'she said goodnight' });
}

/** Left alone after being got up, she drifts off again — and judges the wake as she goes. */
async function dozeOffIfLeftAlone() {
  const state = getHerSleepSchedule();
  if (!state) return;
  const now = zonedNow(CHAT_TIMEZONE);
  if (!dozeOffDue(state, now, Date.parse(getMood().lastMessageAt ?? ''), Date.now())) return;
  const pointless = await wakeWasForNothing(state);
  goBackToSleep({ pointless, block: false, why: `nothing from them for ${Math.round((Date.now() - Date.parse(getMood().lastMessageAt ?? '')) / 60_000)} min` });
}

function herAsleepNow(): boolean {
  const prefs = getHerSleepPrefs();
  if (!prefs.enabled) return false;
  return herAsleep(getHerSleepSchedule(), zonedNow(CHAT_TIMEZONE));
}

/**
 * She decides when she is going to bed tonight and when she will be up
 * tomorrow morning — once an evening, from seven on. The times are hers; if
 * she never answers with two times, her vitals and a little randomness stand
 * in (hersleep.ts). Nothing is fixed in config: the schedule is whatever she
 * made of it.
 */
async function decideHerNight(config: ProviderConfig) {
  const prefs = getHerSleepPrefs();
  if (!prefs.enabled) return;
  const now = zonedNow(CHAT_TIMEZONE);
  const todayKey = localDateKey(now);
  if (now.getHours() * 60 + now.getMinutes() < 19 * 60) return;
  if (getHerSleepSchedule()?.day === todayKey) return;
  const picked = await pickHerTimes(prefs, config);
  setHerSleepSchedule({
    day: todayKey, bedtime: picked.bedtime, wake: picked.wake,
    decidedAt: now.toISOString(), wakeHandled: false, announced: false,
  });
  console.log(`[her-sleep] ${todayKey}: she decided bedtime ${clockMinutes(picked.bedtime)} and wake ${clockMinutes(picked.wake)}`);
}

async function pickHerTimes(prefs: ReturnType<typeof getHerSleepPrefs>, config: ProviderConfig): Promise<{ bedtime: number; wake: number }> {
  try {
    const now = zonedNow(CHAT_TIMEZONE);
    const raw = await ollamaQuip(decideTimesSystem(now), 'Decide.', config);
    const parsed = parseDecidedTimes(raw);
    if (parsed) return parsed;
    console.log(`[her-sleep] she did not answer with two times ("${raw.slice(0, 60)}") — falling back`);
  } catch (error) {
    console.warn('[her-sleep] could not ask when she is turning in:', error instanceof Error ? error.message : error);
  }
  return fallbackSchedule(prefs, vitals.sleepiness >= 0.55, Math.random);
}

/**
 * Her own goodnight: as her bedtime nears and he has been around today, she
 * says she is turning in at her time, once. If he was never there to hear it,
 * she simply goes to bed at her time — the line is not worth composing for
 * nobody.
 */
async function maybeSayHerGoodnight(config: ProviderConfig) {
  const prefs = getHerSleepPrefs();
  if (!prefs.enabled) return;
  const state = getHerSleepSchedule();
  const now = zonedNow(CHAT_TIMEZONE);
  if (!state || state.announced || !goodnightDue(state, now)) return;
  const todayKey = localDateKey(now);
  const spokeToday = ((store.get('chat.messages') as { role?: string; at?: string }[] | undefined) ?? [])
    .some(message => message.role === 'user' && message.at && localDateKey(zonedNow(CHAT_TIMEZONE, new Date(message.at))) === todayKey);
  if (!spokeToday) return;
  const character = getActiveCharacter();
  const system = [
    character.identity,
    character.style,
    // No clock of the moment in front of it: handed "It is 10:19 PM and you are
    // going to bed at 23:30" she opened with "10:19 PM, I'm turning in at 23:30"
    // (2026-09-16), a timestamp read as part of the line on his phone.
    `You are going to bed at ${clockMinutes(state.bedtime)}, in about ${Math.max(5, Math.round((state.bedtime - (now.getHours() * 60 + now.getMinutes()) + 1440) % 1440 / 5) * 5)} minutes. Tell them you are turning in at that time — one or two lines, in your way. They should not text you after that, and you mean it.`,
  ].filter(Boolean).join(' ');
  try {
    const line = await ollamaQuip(system, 'Say goodnight.', config);
    if (line && interject(line, { source: 'goodnight' })) {
      setHerSleepSchedule({ ...state, announced: true });
      console.log(`[her-sleep] said goodnight for a ${clockMinutes(state.bedtime)} bedtime`);
    }
  } catch (error) {
    console.warn('[her-sleep] could not compose her goodnight:', error instanceof Error ? error.message : error);
  }
}

/**
 * The first reply after she wakes: what he sent while she slept, in her face.
 * Fires once per schedule — and if the morning passes without a word, it is
 * marked done rather than held against a later day.
 */
function wakeNoteNow(): string {
  const prefs = getHerSleepPrefs();
  if (!prefs.enabled) return '';
  const state = getHerSleepSchedule();
  if (!state || state.wakeHandled) return '';
  const now = zonedNow(CHAT_TIMEZONE);
  const todayKey = localDateKey(now);
  const wakeDay = dayAfter(state.day);
  if (todayKey > wakeDay) { setHerSleepSchedule({ ...state, wakeHandled: true }); return ''; }
  // Knocked awake before midnight, the note is owed on the decision day.
  if (todayKey !== wakeDay && !(state.wokenEarly && todayKey === state.day)) return '';
  if (todayKey === wakeDay && now.getHours() * 60 + now.getMinutes() < state.wake) return '';
  // Both days the night touches, from the archive as well as the live day:
  // the 05:00 roll files the small hours under yesterday, and read from the
  // live day alone she woke on 2026-09-06 with no idea he had sent fourteen.
  const heard = [...messagesOn(state.day), ...messagesOn(wakeDay)] as { role?: string; at?: string }[];
  const count = Math.max(messagesWhileAsleep(state, heard, CHAT_TIMEZONE), state.wokenEarly ? state.wokenBy ?? 0 : 0);
  setHerSleepSchedule({ ...state, wakeHandled: true });
  // The morning after they got her up and she went back to sleep: what the night was.
  const night = !state.wokenEarly && state.knockedAt
    ? { knockedAt: clockAt(Date.parse(state.knockedAt)), forNothing: Boolean(state.wokenForNothing), ...(state.dozedOffAt ? { dozedOffAt: clockAt(Date.parse(state.dozedOffAt)) } : {}) }
    : undefined;
  if (count > 1 || state.wokenEarly || night?.forNothing) {
    const mood = getMood();
    const bump = wakeIrritation(count) + (state.wokenEarly ? IRRITATION_NOTCH : 0) + (night?.forNothing ? 2 * IRRITATION_NOTCH : 0);
    const capped = Math.min(IGNORE_THRESHOLD - IRRITATION_NOTCH, mood.irritation + bump);
    setMood({ ...mood, irritation: Math.max(mood.irritation, capped) });
    console.log(`[her-sleep] woke to ${count} messages while she slept — irritation ${mood.irritation} -> ${capped}`);
  }
  const note = wakeNote(count, clockMinutes(state.wake), state.wokenEarly ? state.wokenBy ?? 0 : 0, night);
  if (note) console.log(`[her-sleep] first reply after waking: ${count} messages overnight`);
  return note;
}

/**
 * The voice reading, consumed once: the note she is handed when he sounded
 * rough. Fresh only — a reading older than a few minutes is stale, and a
 * message in between means the moment is gone.
 */
function takeVoiceRoom(): string {
  const reading = store.get('hume.reading') as { rough?: boolean; why?: string; at?: string } | undefined;
  if (!reading?.why) return '';
  store.delete('hume.reading' as never);
  if (Date.now() - Date.parse(reading.at ?? '') > 10 * 60_000) return '';
  return `When they said that, ${reading.why}. Read the room: still you — still dry, still short — but no needling, nothing about their list, and do not bring it up unless it fits.`;
}

function getInterests(): Interest[] {
  const saved = store.get('tastes') as Interest[] | undefined;
  return Array.isArray(saved) ? saved.filter(interest => interest && typeof interest.name === 'string' && typeof interest.id === 'string') : [];
}

function setInterests(interests: unknown[]) {
  store.set('tastes', interests);
}

function getNights(): Night[] {
  const saved = store.get('nights') as Night[] | undefined;
  return Array.isArray(saved) ? saved.filter(night => night && typeof night.note === 'string') : [];
}

/** Her wants, with any new one in an interest's words reconciled in. */
function getWants(): Want[] {
  const wants = readWants(store.get('her.wants'));
  const merged = reconcileWants(getInterests(), wants, new Date().toISOString());
  if (merged.length !== wants.length) store.set('her.wants', merged);
  return merged;
}

function setWants(wants: Want[]) {
  store.set('her.wants', wants);
}

function getDays(): HerDay[] {
  return readDays(store.get('her.days'));
}

function setDays(days: HerDay[]) {
  store.set('her.days', days);
}

function getRecs(): Rec[] {
  return readRecs(store.get('her.recs'));
}

function setRecs(recs: Rec[]) {
  store.set('her.recs', recs);
}

function getWeek(): HerWeek | null {
  return readWeek(store.get('her.week'));
}

function setWeek(week: HerWeek | null) {
  store.set('her.week', week);
}

/**
 * The night that is hers to talk about today.
 *
 * Through the morning that is the night just gone; from midday it is still the
 * same one, because a night does not stop having happened at lunchtime. It
 * rolls over only when the next one starts.
 */
function lastNightKey(): string {
  const now = zonedNow(CHAT_TIMEZONE);
  const yesterday = new Date(now.getTime());
  yesterday.setDate(yesterday.getDate() - 1);
  return lastNightDay(getNights(), now.getHours(), localDateKey(now), localDateKey(yesterday));
}

/** The evening a small hour belongs to: 2am on Sunday is Saturday night. */
function nightKey(now: Date): string {
  const evening = new Date(now.getTime());
  if (evening.getHours() < 12) evening.setDate(evening.getDate() - 1);
  return localDateKey(evening);
}

let lastNightThingAt: number | null = null;

/**
 * Something of her own, while they are asleep.
 *
 * The point of it is that it is true. A model asked what it did last night will
 * answer beautifully and none of it will have happened, and then every follow-up
 * question is a request for more invention — the Melbourne-restaurants failure,
 * with a whole inner life built on top. So she actually searches, actually reads
 * what comes back, and the note is written from that and nothing else. She
 * cannot watch anything and is told not to say she did.
 *
 * Quiet hours only: this is the time nobody is talking to her, which is the
 * whole conceit, and it keeps a search and two model calls off the hours when
 * the GPU is answering them.
 */
/**
 * A night spent reading the thing itself, rather than reading about it.
 *
 * Her nights were spent on reviews and forum threads, which is how a stance
 * gets built out of a fandom's opinion of a story instead of the story. She
 * reads pages now: her own vision model on the server takes a manga page about
 * as well as it takes his screen, and given the first chapter of Chainsaw Man
 * it returned the debt tally in order, "38,040,000 yen", "You know the drill,
 * Pochita!" — right, and in sequence.
 *
 * A stretch a night, not a volume. A page costs about a hundred seconds on that
 * card, so a 53-page chapter would be an hour and a half of it, and someone who
 * reads a chapter a night is a better character than one who inhales a series
 * between midnight and two. It also means she is genuinely partway through
 * something, which is the part he cannot get from a summary.
 */
let readingMangaNow = false;

/**
 * A tool call, kept if it did something.
 *
 * The result is inspected rather than trusted: a tool that came back with an
 * error is a thing she tried and did not do, and half of these refuse until he
 * confirms, so the first call of a confirm pair changes nothing. Writing either
 * one down as done would make the ledger lie in the one direction it must not.
 */
function noteDeed(tool: string, call: { function?: { arguments?: unknown } }, result: string): void {
  if (!isADeed(tool)) return;
  // Something of her own to do is the cure for a quiet room (feelings.ts).
  herOwnTimeAt = Date.now();
  feelNow('own-time');
  let failed = false;
  try {
    const parsed = JSON.parse(result) as Record<string, unknown>;
    failed = typeof parsed.error === 'string' || parsed.confirm === false || parsed.ok === false || parsed.created === false;
  } catch { failed = false; }
  // Something of hers that would not work. Short with the thing, not with him
  // — which is what makes it a different counter from her patience.
  feelNow(failed ? 'broke' : 'worked');
  let args: Record<string, unknown> = {};
  try {
    const raw = call.function?.arguments;
    args = typeof raw === 'string' ? JSON.parse(raw) : (raw && typeof raw === 'object' ? raw as Record<string, unknown> : {});
  } catch { args = {}; }
  const deed = deedFrom(tool, args, failed, new Date().toISOString());
  if (!deed) return;
  store.set('her.deeds', keepDeed(readDeeds(store.get('her.deeds')), deed));
  console.log(`[deed] you ${deed.what}`);
}

/**
 * The moods the brain gave for the reply it just wrote, kept for the face.
 *
 * Without this the voice reads the labels and the face still runs the
 * classifier, so the two go on disagreeing — which was the whole complaint:
 * 57% of her replies were heard as one feeling and seen as another. One reading
 * of a sentence, used by both.
 *
 * Keyed on the finished text rather than held as "the last one", because the
 * page asks for the expression after the stream has ended and a second reply
 * can be underway by then.
 */
const deliveredMoods = new Map<string, EmotionName>();
const DELIVERY_KEPT = 8;

function rememberDelivery(raw: string, clean: string): void {
  const moods = splitDelivery(raw).map(said => said.mood).filter(Boolean) as EmotionName[];
  if (!moods.length || !clean.trim()) return;
  // The face is set once for the reply, so it takes the mood she opened on:
  // the first thing she feels about what he said is what he should see when it
  // lands, not wherever the paragraph wandered to.
  deliveredMoods.set(clean.trim(), moods[0]);
  while (deliveredMoods.size > DELIVERY_KEPT) deliveredMoods.delete(deliveredMoods.keys().next().value as string);
}

/**
 * What he is reading, off his shelves (suwayomi.ts), refreshed every ten
 * minutes rather than on every prompt: a library call is cheap but not
 * free, and his bookmark does not move between two of her replies. The
 * spite roll is per prompt, so a high grudge is a chance each turn, not a
 * standing licence.
 */
let hisShelf: { at: number; titles: HisTitle[] } = { at: 0, titles: [] };
async function refreshHisShelf(): Promise<void> {
  const link = suwayomiLink();
  if (!link) { hisShelf = { at: Date.now(), titles: [] }; return; }
  try {
    const config = readSuwayomiConfig(store.get('manga'))!;
    hisShelf = { at: Date.now(), titles: hisReading(await link.library(), config.shelf) };
  } catch (error) {
    console.warn('[manga] could not read his shelf:', error instanceof Error ? error.message : error);
    hisShelf = { at: Date.now(), titles: hisShelf.titles };
  }
}
function hisReadingLine(): string {
  if (Date.now() - hisShelf.at > 10 * 60_000) void refreshHisShelf();
  const grudge = getMood().grudge ?? 0;
  const spite = spiteful(grudge, Math.random(), undefined, sway('spite', SPITE_ODDS, swayNow()));
  if (spite && hisShelf.titles.length) console.log(`[manga] spiteful today — grudge ${grudge}, a spoiler is on the table`);
  return hisReadingNote(hisShelf.titles, readReading(store.get('her.reading')), Date.now(), grudge, spite);
}

/**
 * His manga shelf as the get_manga tool sees it (suwayomi.ts): a title found
 * on the sources in turn, put in his category, fetched whole — unless the
 * disk would dip under what he keeps free, when it waits for his word.
 */
function mangaShelfLink(): ToolDeps['mangaShelf'] {
  const link = suwayomiLink();
  const config = readSuwayomiConfig(store.get('manga'));
  if (!link || !config) return null;
  const freeGb = () => { try { const fs = statfsSync(config.downloadsDir); return (fs.bavail * fs.bsize) / 2 ** 30; } catch { return Number.POSITIVE_INFINITY; } };
  const shelfTitle = async (title: string) => {
    const library = await link.library();
    const match = matchManga(title, library.filter(manga => onHisShelf(manga, config.shelf)));
    return match && 'one' in match ? match.one : null;
  };
  return {
    get: async ({ title, mangaId, confirm }) => {
      let id = mangaId ?? null;
      let name = title;
      if (id === null) {
        const found = await link.find(title);
        if (!found) return { outcome: 'not-found', title, note: `Nothing called "${title}" on ${config.sources.join(', ')}. Say so — do not pretend to fetch something else.` };
        if ('several' in found) return { outcome: 'choose', title, choices: found.several.map(item => ({ mangaId: item.id, title: item.title, source: item.source })), note: 'Not the title itself, only things near it. List these and ask which they meant; call again with that mangaId.' };
        id = found.one.id;
        name = found.one.title;
      }
      await link.takeUpForHim(id);
      const chapters = await link.chapters(id);
      const pending = chapters.filter(chapter => !chapter.downloaded);
      if (!chapters.length) return { outcome: 'empty', title: name, note: 'It is on their shelf but the source lists no chapters yet. Say so.' };
      if (!pending.length) return { outcome: 'have', title: name, chapters: chapters.length, link: readerLink(config, id), note: 'Every chapter is already on the server. Give them the link.' };
      const fit = fetchFits(pending.length, freeGb(), config.keepFreeGb);
      if (!fit.fits && !confirm) {
        return { outcome: 'needs-word', title: name, chapters: pending.length, gb: fit.gb, freeGb: Math.round(freeGb()), keepFreeGb: config.keepFreeGb, note: `Storage is running low: ${pending.length} chapters is about ${fit.gb} GB and the disk has ${Math.round(freeGb())} GB free against the ${config.keepFreeGb} GB they keep. Tell them, and fetch only if they say to (confirm: true).` };
      }
      await link.download(pending.map(chapter => chapter.id));
      console.log(`[manga] fetching ${name} for him — ${pending.length} of ${chapters.length} chapters queued (~${fit.gb} GB)`);
      return { outcome: 'fetching', title: name, chapters: chapters.length, queued: pending.length, gb: fit.gb, link: readerLink(config, id), note: 'It is on their shelf and downloading. Say so in your own words — the title, how many chapters, that the first ones will be readable in minutes — and give the link.' };
    },
    status: async title => {
      const manga = await shelfTitle(title);
      if (!manga) return { outcome: 'not-on-shelf', title, note: `"${title}" is not on their shelf. Say so; offer to fetch it.` };
      const summary = fetchSummary(await link.chapters(manga.id), await link.queue(manga.id));
      return { outcome: 'status', title: manga.title, ...summary, link: readerLink(config, manga.id), note: 'Say how it is going in your own words: how many chapters are on the server, what is downloading now, how many are queued.' };
    },
  };
}

/**
 * Level 4 — her own hands (herhands.ts). Every few minutes: is it her time?
 * If so, one pass with the local brain and the short table of tools that are
 * hers; what ran is written to her.hands and shown back to her in her
 * own-life block, so what she remembers doing is what she did. Nothing here
 * runs at his word, and nothing of it leaves the box.
 */
let herHandsBusy = false;
let herHandsWhyNot = '';
async function herHandsTick(): Promise<void> {
  const system = readSystemConfig();
  if (system.level < 4) return;
  const hands = readHandsConfig(store.get('system.config'));
  const now = zonedNow(CHAT_TIMEZONE);
  const today = localDateKey(now);
  const dayOf = (iso: string) => localDateKey(zonedNow(CHAT_TIMEZONE, new Date(iso)));
  const ledger = readHands(store.get('her.hands'));
  const last = ledger.at(-1);
  const why = whyNotAct({
    level: system.level, config: hands, minutes: now.getHours() * 60 + now.getMinutes(),
    asleep: herAsleepNow(), speaking: speakingNow, idleMs: Date.now() - hisLastWordMs(),
    sinceLastMs: last ? Date.now() - Date.parse(last.at) : Number.MAX_SAFE_INTEGER,
    doneToday: handsToday(ledger, today, dayOf), busy: herHandsBusy || pokemonSitting !== null || readingMangaNow,
  });
  if (why) {
    // Said once per reason, not once per tick.
    if (why !== herHandsWhyNot) { herHandsWhyNot = why; console.log(`[hands] not now — ${why}`); }
    return;
  }
  herHandsWhyNot = '';
  const config = store.get('ai.config') as ProviderConfig | undefined;
  if (!config?.model) return;
  herHandsBusy = true;
  const startedAt = Date.now();
  try {
    const turn = createTurnContext({ hands: true });
    const menu = chatTools(availableTools(turn), '').filter(tool => (HER_HANDS_TOOLS as readonly string[]).includes(tool.function.name));
    if (!menu.length) { console.log('[hands] nothing of hers is switched on to reach for'); return; }
    const character = getActiveCharacter();
    const interests = getInterests();
    const own = [
      readingNote(readReading(store.get('her.reading'))),
      runNote((store.get('her.pokemon.lastState') as GameState | undefined) ?? null, String(store.get('her.pokemon.lastSummary') ?? ''), false),
      tastesInstruction(interests),
      wantsNote(getWants(), interests),
      handsNote(ledger, Date.now(), dayOf, today),
    ].filter(Boolean).join('\n');
    const conversation = [
      { role: 'system', content: [character.identity, character.style, FIRST_PERSON_NOTE, NOBODY_HERE, own, handsInstruction(menu.map(tool => tool.function.name))].join('\n\n') },
      { role: 'user', content: HANDS_TURN },
    ];
    // In her own time a read runs to its end, and a game she starts is hers, not his idea.
    const base = toolDeps(turn);
    const pokemon = pokemonDeps();
    const deps: ToolDeps = { ...base, pokemon: pokemon ? { ...pokemon, start: () => startPokemon('her') } : null };
    const { content, ran } = await runToolLoop(conversation as Parameters<typeof runToolLoop>[0], {
      ask: (sending, { tools }) => ollamaPost(sending as Parameters<typeof ollamaPost>[0], config, { tools, turn, table: menu }),
      runTool: async call => {
        const fn = (call as { function?: { name?: string; arguments?: unknown } }).function ?? {};
        const tool = fn.name ?? 'tool';
        let asked = call;
        if (tool === 'read_manga') {
          let args: Record<string, unknown> = {};
          try { args = typeof fn.arguments === 'string' ? JSON.parse(fn.arguments) : (fn.arguments as Record<string, unknown>) ?? {}; } catch { args = {}; }
          asked = { ...call, function: { ...fn, arguments: JSON.stringify({ ...args, wait: true }) } } as typeof call;
        }
        const result = await runChatTool(asked, '', deps);
        noteDeed(tool, call, result);
        return result;
      },
      pageWasRead: turn.pageWasRead, handsAllowed: turn.handsAllowed, withdrawHands: turn.withdrawHands,
      hasOpenTask: () => false, canSearch: () => false,
      log: line => console.log(line), warn: line => console.warn(line), maxRounds: 3,
    });
    const acted = [...ran].filter(name => (HER_HANDS_TOOLS as readonly string[]).includes(name));
    const deed = readDeeds(store.get('her.deeds')).filter(item => Date.parse(item.at) >= startedAt && acted.includes(item.tool)).at(-1);
    const said = content.trim().slice(0, 400);
    if (!acted.length || !deed) {
      store.set('her.hands', keepHands(ledger, { at: new Date().toISOString(), tool: 'nothing', what: '', said }));
      console.log(`[hands] she let it be — "${said.slice(0, 80)}"`);
      return;
    }
    store.set('her.hands', keepHands(ledger, { at: new Date().toISOString(), tool: deed.tool, what: deed.what, said: didNothing(said) ? '' : said }));
    console.log(`[hands] she ${deed.what} — "${said.slice(0, 120)}" (${Math.round((Date.now() - startedAt) / 1000)}s)`);
  } catch (error) {
    console.warn('[hands] her own time came to nothing:', error instanceof Error ? error.message : error);
  } finally {
    herHandsBusy = false;
  }
}

/**
 * Her own reading as a tool (tools.ts read_manga): the same pass as the small
 * hours, run now. On a chat turn it starts and answers at once — a stretch is
 * minutes of her eyes on pages — and in her own time (herHandsTick) it runs to
 * the end, a few pages, so what she says about it is what she read.
 */
const HANDS_PAGES = 4;
function mangaLink(): ToolDeps['manga'] {
  const vision = readVisionConfig(store.get('vision'));
  const config = store.get('ai.config') as ProviderConfig | undefined;
  if (!vision.enabled || !config?.model) return null;
  return {
    read: async ({ title, wait }) => {
      if (readingMangaNow) return { error: 'You are already partway through a stretch of reading. Say so.' };
      const run = readSomeManga(config, { force: true, title, pages: wait ? HANDS_PAGES : undefined });
      if (!wait) {
        void run.then(got => { if (!got) console.log('[manga] the read she started came to nothing'); }).catch(error => console.warn('[manga] the read she started failed:', error instanceof Error ? error.message : error));
        return { started: true, title: title || readReading(store.get('her.reading'))?.title || 'your manga', note: 'It has started and takes a few minutes. Say you are off to read — do not describe pages you have not read yet.' };
      }
      const got = await run;
      return got ? { read: true, ...got } : { error: 'Nothing came of it — the pages did not come back, or that title matched nothing. Say so plainly.' };
    },
  };
}

/**
 * Her Game Boy (pokemon.ts): the worker at ~/haru-pokemon, and the loop that
 * plays it. One move per tick from the local brain — her persona, the rules
 * of play, the game in words — while a sitting is on; the sitting ends when
 * he speaks, at bedtime, on time, or on her share of the day, and what came
 * of it goes into her game memory and her own-life block.
 */
/**
 * When he last said anything, by any door. The live stamp is only set on the
 * model path and starts at zero: five minutes after "set your machine level
 * to 4" — answered in code, right after a restart — her own time opened as
 * though he had been silent for ever (2026-09-18). The transcript knows.
 */
function hisLastWordMs(): number {
  const messages = (store.get('chat.messages') as { role?: string; at?: string }[] | undefined) ?? [];
  const last = [...messages].reverse().find(message => message.role === 'user' && message.at);
  return Math.max(lastUserActivityAt, last?.at ? Date.parse(last.at) || 0 : 0);
}

let pokemonSitting: Sitting | null = null;
let pokemonTicking = false;
function pokemonLink(): PokemonLink | null {
  const config = readPokemonConfig(store.get('games'));
  return config.enabled ? new PokemonLink(config, (url, init) => net.fetch(url, init)) : null;
}
function pokemonPlayedToday(): number {
  const saved = store.get('her.pokemon.played') as { day?: string; ms?: number } | undefined;
  return saved?.day === currentChatDayKey() ? Number(saved.ms ?? 0) : 0;
}
async function pokemonMoment(link: PokemonLink): Promise<PokemonMoment> {
  return { now: Date.now(), lastUserActivityAt: hisLastWordMs(), asleep: herAsleepNow(), speaking: false, workerUp: await link.up(), playedTodayMs: pokemonPlayedToday() };
}
async function startPokemon(startedBy: 'her' | 'him'): Promise<Record<string, unknown>> {
  const link = pokemonLink();
  if (!link) return { error: 'Your Game Boy is switched off.' };
  const config = readPokemonConfig(store.get('games'));
  const why = whyNotStartPokemon(await pokemonMoment(link), config, pokemonSitting);
  if (why) return { started: false, note: `Not now: ${why}. Say so plainly.` };
  const state = await link.state();
  pokemonSitting = newSitting(Date.now(), state, startedBy);
  store.set('her.pokemon.lastState', state);
  console.log(`[pokemon] she sat down to play (${startedBy === 'him' ? 'at his word' : 'her own idea'}) — ${state.map?.map_name ?? 'somewhere'}, ${state.player?.badge_count ?? 0} badge(s)`);
  return { started: true, where: state.map?.map_name, badges: state.player?.badge_count ?? 0, note: `You have sat down to play; it goes on in the background for up to ${config.sessionMinutes} minutes and stops when they talk to you. Say you are off to play — do not narrate moves you have not made yet.` };
}
async function endPokemon(why: string): Promise<string> {
  const sitting = pokemonSitting;
  pokemonSitting = null;
  store.set('her.pokemon.sitting', null);
  if (!sitting) return '';
  const link = pokemonLink();
  let state = (store.get('her.pokemon.lastState') ?? {}) as GameState;
  try { if (link) { state = await link.state(); await link.save('haru-last'); } } catch { /* the worker went away: the last state she saw stands */ }
  const summary = sittingSummary(sitting, state, Date.now(), why);
  store.set('her.pokemon.lastState', state);
  store.set('her.pokemon.lastSummary', summary);
  store.set('her.pokemon.played', { day: currentChatDayKey(), ms: pokemonPlayedToday() + (Date.now() - sitting.startedAt) });
  try { noteInGameMemory(gamesRoot(), 'Pokemon Red', summary, new Date()); } catch (error) { console.warn('[pokemon] could not write her game memory:', error instanceof Error ? error.message : error); }
  console.log(`[pokemon] sitting over — ${summary}`);
  return summary;
}
async function pokemonTick(): Promise<void> {
  if (!pokemonSitting || pokemonTicking) return;
  pokemonTicking = true;
  try {
    const link = pokemonLink();
    const config = readPokemonConfig(store.get('games'));
    if (!link) { await endPokemon('it was switched off'); return; }
    const stop = whyStopPokemon(pokemonSitting, await pokemonMoment(link), config);
    if (stop) { await endPokemon(stop); return; }
    const brain = store.get('ai.config') as ProviderConfig | undefined;
    if (!brain?.model) return;
    // The emulator only runs while an action does, so a line that prints letter by letter was
    // read half-written ("This w", 2026-09-18). A second of frames lets the screen settle first.
    await link.act(['wait_60']).catch(() => null);
    const state = await link.state();
    const map = await link.map();
    // The words on the screen: /state carries none, and its dialog flag sleeps through Oak's intro.
    const screen = await link.text();
    const character = getActiveCharacter();
    const raw = await ollamaQuipLong([character.identity, character.style, POKEMON_PLAY_RULES].join('\n\n'), describeGame(state, map, screen, pokemonSitting.lastThought, pokemonSitting.stillFor >= 3), brain);
    // Nothing usable from her: words on the screen are pressed past, anything else waits a turn.
    const move = parseMove(raw) ?? (screen.length || state.dialog?.active ? { thought: '', actions: ['press_a'] } : null);
    if (!pokemonSitting) return;
    const after = move ? await link.act(move.actions) : state;
    pokemonSitting = afterTurn(pokemonSitting, move, after ?? state, move ? await link.text() : screen);
    // Kept between turns: a restart mid-game used to lose the sitting without a word in her game memory (2026-09-18, 106 turns).
    store.set('her.pokemon.sitting', pokemonSitting);
    store.set('her.pokemon.lastState', after ?? state);
    if (move) console.log(`[pokemon] turn ${pokemonSitting.turns}: ${move.thought || '…'} — ${move.actions.join(' ')}`);
    if (pokemonSitting.turns % config.saveEvery === 0) await link.save('haru-auto').catch(() => {});
  } catch (error) {
    console.warn('[pokemon] a turn came to nothing:', error instanceof Error ? error.message : error);
  } finally {
    pokemonTicking = false;
  }
}
/** A sitting that was cut off by a restart is closed out properly: summary, save, her share of the day. */
async function recoverPokemonSitting(): Promise<void> {
  const saved = store.get('her.pokemon.sitting') as Sitting | null | undefined;
  if (!saved || typeof saved !== 'object' || typeof saved.startedAt !== 'number' || pokemonSitting) return;
  pokemonSitting = saved;
  // The clock stopped when she did: the sitting is as long as it had run, not as long as she was down.
  const ranMs = Math.max(0, Math.min(Date.now() - saved.startedAt, saved.turns * readPokemonConfig(store.get('games')).tickSeconds * 1000));
  pokemonSitting = { ...saved, startedAt: Date.now() - ranMs };
  await endPokemon('she was restarted in the middle of it');
}

function pokemonDeps(): ToolDeps['pokemon'] {
  if (!pokemonLink()) return null;
  return {
    start: () => startPokemon('him'),
    stop: async () => { const summary = await endPokemon('they asked her to stop'); return summary ? { stopped: true, summary } : { stopped: false, note: 'You were not playing.' }; },
    status: async () => {
      const link = pokemonLink()!;
      const up = await link.up();
      const state = up ? await link.state() : (store.get('her.pokemon.lastState') as GameState | undefined) ?? null;
      if (!state) return { outcome: 'no-run', note: up ? 'The Game Boy is on but you have not started a game.' : 'The Game Boy is not running — there is no ROM in it yet. Say so plainly.' };
      return { outcome: 'status', playing: pokemonSitting !== null, workerUp: up, playedTodayMinutes: Math.round(pokemonPlayedToday() / 60_000), run: runNote(state, String(store.get('her.pokemon.lastSummary') ?? ''), pokemonSitting !== null), note: 'Say how your run stands in your own words, from these facts only.' };
    },
  };
}

/**
 * Her shelf on Suwayomi (suwayomi.ts), when the server's password file is
 * there. One client for the process, so the login is kept; null when the
 * block is switched off or the file is missing — then she reads MangaDex
 * directly as before.
 */
let suwayomiClient: Suwayomi | null = null;
function suwayomiLink(): Suwayomi | null {
  const config = readSuwayomiConfig(store.get('manga'));
  if (!config || !existsSync(config.passwordFile)) { suwayomiClient = null; return null; }
  if (!suwayomiClient) suwayomiClient = new Suwayomi(config, (url, init) => net.fetch(url, init), { log: line => console.log(line) });
  return suwayomiClient;
}

/** A Suwayomi chapter as the bookmark's ChapterRef. */
const shelfChapterRef = (chapter: ShelfChapter): ChapterRef => ({ id: String(chapter.id), chapter: String(chapter.number), title: chapter.name, pages: chapter.pages > 0 ? chapter.pages : 0 });

/** A title taken up on her shelf: searched, put in her category, chapters fetched, bookmark at the first. */
async function startReadingOnShelf(link: Suwayomi, title: string): Promise<Reading | null> {
  const found = await link.search(title);
  const hit = found[0];
  if (!hit) return null;
  await link.takeUp(hit.id);
  const chapters = await link.chapters(hit.id);
  if (!chapters.length) return null;
  const first = shelfChapterRef(chapters[0]);
  const now = new Date().toISOString();
  console.log(`[manga] taking up ${hit.title} on her shelf — ${chapters.length} chapter(s)`);
  return { seriesId: String(hit.id), title: hit.title, chapter: first.chapter, chapterId: first.id, page: 0, pages: first.pages, startedAt: now, lastAt: now, finished: 0, source: 'suwayomi', mangaId: hit.id };
}

/**
 * The bookmark she had on MangaDex, carried to the same chapter on her shelf
 * the first time the shelf is there, so a change of server is not a lost
 * place. Best effort: if the title or the chapter is not found she reads on
 * where she was.
 */
async function carryReadingToShelf(link: Suwayomi, reading: Reading): Promise<Reading> {
  try {
    const found = await link.search(reading.title);
    const hit = found.find(item => item.title.toLowerCase() === reading.title.toLowerCase()) ?? found[0];
    if (!hit) return reading;
    await link.takeUp(hit.id);
    const chapters = await link.chapters(hit.id);
    const same = chapters.find(chapter => String(chapter.number) === reading.chapter) ?? chapters[0];
    if (!same) return reading;
    const moved: Reading = { ...reading, seriesId: String(hit.id), title: hit.title, chapter: String(same.number), chapterId: String(same.id), pages: same.pages > 0 ? same.pages : 0, page: String(same.number) === reading.chapter ? reading.page : 0, source: 'suwayomi', mangaId: hit.id };
    store.set('her.reading', moved);
    await link.mark(hit.id, moved.chapter, moved.page).catch(() => {});
    console.log(`[manga] carried ${reading.title} to her shelf — chapter ${moved.chapter}, page ${moved.page + 1}`);
    return moved;
  } catch (error) {
    console.warn('[manga] could not carry her bookmark to the shelf:', error instanceof Error ? error.message : error);
    return reading;
  }
}

/** A series taken up by name — on her shelf when there is one, MangaDex otherwise. */
async function startReading(title: string): Promise<Reading | null> {
  const link = suwayomiLink();
  if (link) return startReadingOnShelf(link, title);
  const found = await mangaGet(searchUrl(title)) as { data?: { id: string; attributes?: { title?: Record<string, string> } }[] } | null;
  const hit = found?.data?.[0];
  if (!hit) return null;
  const chapters = await chaptersOf(hit.id);
  if (!chapters.length) return null;
  const first = chapters[0];
  const name = hit.attributes?.title?.en ?? title;
  console.log(`[manga] taking up ${name} — ${chapters.length} readable chapter(s)`);
  const now = new Date().toISOString();
  return { seriesId: hit.id, title: name, chapter: first.chapter, chapterId: first.id, page: 0, pages: first.pages, startedAt: now, lastAt: now, finished: 0, source: 'mangadex' };
}

type MangaRead = { title: string; chapter: string; pages: [number, number]; note: string; stands: string };

async function readSomeManga(config: ProviderConfig, options: { force?: boolean; title?: string; pages?: number } = {}): Promise<MangaRead | null> {
  const now = zonedNow(CHAT_TIMEZONE);
  const { prefs } = getPush();
  if (!options.force && !inQuietHours(prefs, now)) return null;
  if (readingMangaNow) return null;
  const vision = readVisionConfig(store.get('vision'));
  if (!vision.enabled) return null;
  const today = nightKey(now);
  if (!options.force && (store.get('her.readingOn') as string | undefined) === today) return null;

  let reading = readReading(store.get('her.reading'));
  readingMangaNow = true;
  try {
    const link = suwayomiLink();
    if (options.title && (!reading || reading.title.toLowerCase() !== options.title.toLowerCase())) reading = await startReading(options.title);
    if (!reading) reading = await pickSomethingToRead();
    if (!reading) return null;
    // A bookmark from before the shelf: carried over once, to the same chapter.
    if (link && reading.source !== 'suwayomi') reading = await carryReadingToShelf(link, reading);
    const onShelf = link !== null && reading.source === 'suwayomi' && typeof reading.mangaId === 'number';
    // The pages: from her shelf with her token, or from MangaDex as before.
    let files: string[] = [];
    if (onShelf) {
      files = await link!.pages(Number(reading.chapterId));
      // Suwayomi does not count pages until they are fetched.
      if (reading.pages <= 0 && files.length) { reading = { ...reading, pages: files.length }; store.set('her.reading', reading); }
    } else {
      const at = await mangaGet(pagesUrl(reading.chapterId)) as { baseUrl?: string; chapter?: { hash?: string; data?: string[] } } | null;
      files = at?.baseUrl && at.chapter?.hash ? (at.chapter.data ?? []).map(file => `${at.baseUrl}/data/${at.chapter!.hash}/${file}`) : [];
    }
    const { from, to } = tonightsPages(reading, options.pages);
    if (to <= from) return null;
    if (!files.length) { console.warn(`[manga] no pages came back for ${reading.title} ch ${reading.chapter}`); return null; }
    const endpoint = visionEndpoint(store.get('ai.config') as ProviderConfig | undefined, vision);
    const read: string[] = [];
    for (let page = from; page < Math.min(to, files.length); page++) {
      try {
        const bytes = onShelf ? await link!.page(files[page]) : await mangaBytes(files[page]);
        if (!bytes) continue;
        // Held between pages: a cold start costs more than the page does.
        const sighting = await look(bytes.toString('base64'), vision, endpoint, modelHeaders(endpoint), net.fetch,
          { ask: PAGE_PROMPT, keepAlive: eyesHold(vision, '10m'), timeoutMs: 180_000 });
        const text = sighting.description.trim();
        if (text) read.push(`PAGE ${page + 1}\n${text}`);
      } catch (error) {
        console.warn(`[manga] could not read page ${page + 1}:`, error instanceof Error ? error.message : error);
      }
    }
    if (!read.length) { console.warn('[manga] nothing came off the pages tonight'); return null; }
    // Where she got to, not how many came back. Two of tonight's twelve pages
    // timed out, and counting successes moved the bookmark to 10 — which skips
    // the two that failed for ever and re-reads the two after them tomorrow. A
    // page she could not read is a page she has been past; the alternative is a
    // sitting that sticks on a bad page and never advances.
    const readTo = Math.min(to, files.length);
    const raw = await ollamaQuipLong([getActiveCharacter().identity, NOBODY_HERE].join(' '),
      readingInstruction(reading, from, readTo, read.join('\n\n')), nudgeBrain() ?? config);
    const take = parseReadingTake(raw);
    // The bookmark moves whether or not she had anything to say: the pages were
    // read either way, and re-reading them tomorrow is the one outcome to avoid.
    let next: ChapterRef | null = null;
    if (onShelf) {
      const chapters = await link!.chapters(reading.mangaId!);
      const index = chapters.findIndex(c => String(c.id) === reading!.chapterId);
      next = index >= 0 && chapters[index + 1] ? shelfChapterRef(chapters[index + 1]) : null;
    } else {
      const chapters = await chaptersOf(reading.seriesId);
      next = chapters[chapters.findIndex(c => c.id === reading!.chapterId) + 1] ?? null;
    }
    const moved = afterReading(reading, readTo, next, new Date().toISOString());
    store.set('her.reading', moved);
    store.set('her.readingOn', today);
    // Her place, mirrored where his reader never looks (suwayomi.ts).
    if (onShelf) await link!.mark(reading.mangaId!, moved.chapter, moved.page).catch(error => console.warn('[manga] could not mirror her bookmark:', error instanceof Error ? error.message : error));
    if (!take) { console.log(`[manga] read ${reading.title} ch ${reading.chapter} pp.${from + 1}-${readTo}, nothing to say about it`); return { title: reading.title, chapter: reading.chapter, pages: [from + 1, readTo], note: '', stands: '' }; }
    store.set('nights', keepNights(getNights(), {
      day: today, at: new Date().toISOString(),
      about: `${reading.title}, chapter ${reading.chapter}`,
      note: take.note, sources: [onShelf ? `${readSuwayomiConfig(store.get('manga'))?.url ?? ''}/manga/${reading.mangaId}` : `https://mangadex.org/chapter/${reading.chapterId}`], interest: reading.title,
    }));
    if (take.stands) {
      const held = getInterests();
      const mine = held.find(entry => entry.name.toLowerCase() === reading!.title.toLowerCase());
      // Where it stands, from having read it rather than from a review — which
      // is the fault this whole pass exists to correct.
      if (mine) setInterests(held.map(entry => (entry.id === mine.id ? { ...entry, stands: take.stands, lastAt: new Date().toISOString() } : entry)));
    }
    console.log(`[manga] read ${reading.title} ch ${reading.chapter} pp.${from + 1}-${readTo}${onShelf ? ' (her shelf)' : ''} — ${take.note.length} chars${take.stands ? ` — stands: ${take.stands.slice(0, 60)}` : ''}`);
    return { title: reading.title, chapter: reading.chapter, pages: [from + 1, readTo], note: take.note, stands: take.stands || '' };
  } catch (error) {
    console.warn('[manga] the night\'s reading came to nothing:', error instanceof Error ? error.message : error);
  } finally {
    readingMangaNow = false;
  }
  return null;
}

/** Their public API asks for a real name and a gentle hand; this gives both. */
let lastMangaCallAt = 0;
async function mangaWait(): Promise<void> {
  const since = Date.now() - lastMangaCallAt;
  if (since < REQUEST_GAP_MS) await new Promise(resolve => setTimeout(resolve, REQUEST_GAP_MS - since));
  lastMangaCallAt = Date.now();
}

async function mangaGet(url: string): Promise<unknown | null> {
  await mangaWait();
  const response = await net.fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!response.ok) { console.warn(`[manga] ${response.status} from ${url.slice(0, 60)}`); return null; }
  return response.json();
}

async function mangaBytes(url: string): Promise<Buffer | null> {
  await mangaWait();
  const response = await net.fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!response.ok) return null;
  return Buffer.from(await response.arrayBuffer());
}

async function chaptersOf(seriesId: string): Promise<ChapterRef[]> {
  const feed = await mangaGet(feedUrl(seriesId)) as { data?: { id: string; attributes?: Record<string, unknown> }[] } | null;
  return readableChapters(feed?.data ?? []);
}

/**
 * Something of hers that exists as a manga.
 *
 * Only from what she has already taken up, so this never becomes her reading a
 * stranger: the interests are the things she chose, and the manga of one of
 * them is the same interest by another route.
 */
async function pickSomethingToRead(): Promise<Reading | null> {
  const link = suwayomiLink();
  for (const interest of getInterests()) {
    if (link) {
      try {
        const taken = await startReadingOnShelf(link, interest.name);
        if (taken) return taken;
      } catch (error) {
        console.warn(`[manga] her shelf would not take ${interest.name}:`, error instanceof Error ? error.message : error);
      }
      continue;
    }
    const found = await mangaGet(searchUrl(interest.name)) as { data?: { id: string; attributes?: { title?: Record<string, string> } }[] } | null;
    const hit = found?.data?.[0];
    if (!hit) continue;
    const chapters = await chaptersOf(hit.id);
    if (!chapters.length) continue;
    const first = chapters[0];
    console.log(`[manga] taking up ${interest.name} — ${chapters.length} readable chapter(s)`);
    return {
      seriesId: hit.id, title: interest.name, chapter: first.chapter, chapterId: first.id,
      page: 0, pages: first.pages, startedAt: new Date().toISOString(), lastAt: new Date().toISOString(), finished: 0,
    };
  }
  return null;
}

async function haveANight(config: ProviderConfig) {
  const now = zonedNow(CHAT_TIMEZONE);
  const { prefs } = getPush();
  if (!inQuietHours(prefs, now)) return;
  const searchConfig = readSearchConfig(store.get('search'));
  if (!searchConfig.enabled) return;
  const tonight = nightsOn(getNights(), nightKey(now));
  if (!timeForSomething(tonight, lastNightThingAt, Date.now(), Math.random, sway('own-time', NIGHT_ODDS, swayNow()))) return;
  lastNightThingAt = Date.now();
  try {
    // Whose night it is. Hers first: something she has taken up, or taking
    // one up. Their game is looked at now and then, to have a view of it, not
    // to help. The free pick is what is left. Decided here, not by the model:
    // asked to choose, a 9B chooses what it always chooses, and the point is
    // that she turns up with things of her own.
    const theirs = getMemories().map(memory => memory.text);
    let steamRecent: Awaited<ReturnType<typeof recentlyPlayed>> = [];
    try {
      steamRecent = await recentlyPlayed(getSteamWebKey(), readSteamWebConfig(store.get('steam')), url => net.fetch(url));
    } catch (error) {
      console.warn('[night] Steam would not say what they have been playing:', error instanceof Error ? error.message : error);
    }
    const played = withSteam(gamesPlayedLately(store.getActivityLog(), nightKey(now)), steamRecent);
    const theirNames = [...played.map(entry => entry.name), ...theirs];
    const mine = getInterests();

    let game: Played | null = null;
    let interest: Interest | null = null;
    let adopting: { kind: Interest['kind']; name: string; because: string } | null = null;
    const roll = Math.random();
    if (mine.length < MAX_INTERESTS && (roll < ADOPT_ODDS || !mine.length)) {
      // ollamaQuipLong, not ollamaQuip: the answer is three lines, and the
      // one-line helper kept only "KIND: anime" — so she could never take
      // anything up, and the log said so twice before anyone read it.
      const raw = await ollamaQuipLong([getActiveCharacter().identity, getActiveCharacter().style, adoptInstruction(theirs, mine, { games: played.map(entry => entry.name), interests: theirs })].join(' '), 'What are you taking up?', config);
      const picked = parseAdoption(raw);
      if (!picked) console.log(`[night] she could not say what she was taking up ("${raw.slice(0, 60)}")`);
      else if (isOneOfTheirs(picked.name, theirNames) || mine.some(own => own.name.toLowerCase() === picked.name.toLowerCase())) console.log(`[night] "${picked.name}" is theirs, or already hers — not tonight`);
      else adopting = picked;
    }
    if (!adopting && mine.length) interest = pickTonight(mine, Date.now());
    // A want, sometimes, instead of reading more about the thing itself: she
    // spent the night trying to do the thing she said she wanted rather than
    // deepening the interest that made her want it. Only when the interest
    // being deepened actually carries a want she is still at.
    const want = !adopting && interest && Math.random() < WANT_ODDS ? pickWantToWork(getWants(), interest.name, Math.random) : null;
    if (!adopting && !interest && played.length && Math.random() < GUIDE_ODDS) game = pickGame(played, getNights(), nightKey(now));

    const before = getNights().map(night => night.about);
    const about = adopting ? `${adopting.name} review`
      : want ? wantQuery(want)
      : interest ? nightQuery(interest)
      : game ? guideQuery(game, getNights())
      : tidyPick(await ollamaQuip([getActiveCharacter().identity, pickInstruction(theirs, before)].join(' '), 'What are you looking up?', config));
    if (!about) { console.log('[night] she could not settle on anything'); return; }
    const found = await searchWeb(about, { ...searchConfig, limit: Math.max(searchConfig.limit, 6) }, net.fetch, getSearchKey());
    const dream = (extra: Partial<Dream>): Dream => ({
      at: new Date().toISOString(), day: nightKey(now), kind: 'free', about,
      sources: found.map(result => ({ title: result.title ?? '', url: result.url })), reading: '', wrote: '', ...extra,
    });
    if (!found.length) {
      console.log(`[night] "${about}" turned nothing up — nothing to say about it, so nothing is written`);
      appendDream(app.getPath('userData'), dream({ kind: 'nothing' }));
      return;
    }
    // Read one of them properly where she can, so the note is about something
    // she has been through rather than a page of search blurbs.
    let reading = formatResults(about, found, false);
    let watched = false;
    if (searchConfig.readPages && found[0]?.url) {
      try {
        // A video among the results is read as its transcript — the words,
        // which is the honest version of having watched it at three in the
        // morning, and a good deal more than a watch page's blurb.
        const videoId = transcriptsAvailable() ? videoIdFrom(found[0].url) : null;
        if (videoId) {
          const transcript = await fetchTranscript(videoId);
          reading = `${reading}\n\n${transcriptInstruction(found[0].title || about, transcript.generated, formatTranscript(transcript.captions))}`;
          watched = true;
        } else {
          const page = await readWebPage(found[0].url, net.fetch);
          if (page.text.trim()) reading = `${reading}\n\n${formatPage(page, about)}`;
        }
      } catch { /* the blurbs are enough; a page that will not open is not a failure */ }
    }
    // One of hers: the view is rewritten from the reading, not a note about it.
    if (want) {
      const day = nightKey(now);
      const stamp = new Date().toISOString();
      const outcome = wantOutcome(Math.random(), want.nights);
      let raw = await ollamaQuipLong([getActiveCharacter().identity, wantInstruction(want, outcome, reading)].join(' '), 'Write it.', config);
      if (addressesSomeone(raw)) raw = await ollamaQuipLong([getActiveCharacter().identity, wantInstruction(want, outcome, reading), NOBODY_HERE].join(' '), 'Write it.', config);
      const note = toLength(unaddressed(raw), 200);
      if (!note) { console.log(`[want] nothing came of "${want.text.slice(0, 40)}" tonight`); return; }
      const next = advanceWant(want, outcome, note);
      setWants(getWants().map(entry => entry.id === next.id ? next : entry));
      store.set('nights', keepNights(getNights(), { day, at: stamp, about, note: next.note ?? next.text, sources: found.slice(0, 3).map(result => result.url).filter(Boolean), interest: next.interest }));
      appendDream(app.getPath('userData'), dream({ kind: 'want', interest: next.interest, reading, wrote: raw }));
      console.log(`[want] ${next.interest ?? 'something'} — ${outcome.kind} on night ${next.nights}: "${note.slice(0, 60)}"`);
      return;
    }
    if (adopting || interest) {
      const day = nightKey(now);
      const stamp = new Date().toISOString();
      let list = getInterests();
      let own = interest;
      if (adopting) { list = adopt(list, adopting, day, stamp); own = list[list.length - 1]; }
      if (!own) return;
      // Identity, not style: the style is how she talks to him, and a view of
      // her own opened "Listen up, subordinate". A note that still addresses
      // someone is written once more, then the addressed part is cut.
      let raw = await ollamaQuipLong([getActiveCharacter().identity, deepenInstruction(own, about, reading)].join(' '), 'Write it.', config);
      if (addressesSomeone(raw)) raw = await ollamaQuipLong([getActiveCharacter().identity, deepenInstruction(own, about, reading), NOBODY_HERE].join(' '), 'Write it.', config);
      const next = parseDeepening(unaddressed(raw));
      if (!next) { console.log(`[night] nothing came of ${own.name} tonight`); return; }
      store.set('tastes', deepen(list, own.id, next, stamp));
      store.set('nights', keepNights(getNights(), { day, at: stamp, about, note: next.stance, sources: found.slice(0, 3).map(result => result.url).filter(Boolean), interest: own.name }));
      appendDream(app.getPath('userData'), dream({ kind: adopting ? 'adopt' : 'deepen', interest: own.name, reading, transcript: watched, wrote: raw }));
      console.log(`[night] ${adopting ? `took up ${own.name} (${own.kind})` : `spent the night on ${own.name}`} — "${about}" -> ${next.stance.length} chars${next.favourite ? `, rates ${next.favourite}` : ''}`);
      return;
    }
    const told = game ? guideNoteInstruction(game, about, reading) : nightNoteInstruction(about, reading);
    let note = await ollamaQuip([getActiveCharacter().identity, told].join(' '), 'Write it.', config);
    if (addressesSomeone(note)) note = unaddressed(await ollamaQuip([getActiveCharacter().identity, told, NOBODY_HERE].join(' '), 'Write it.', config));
    if (!note) return;
    store.set('nights', keepNights(getNights(), {
      day: nightKey(now), at: new Date().toISOString(), about, note,
      sources: found.slice(0, 3).map(result => result.url).filter(Boolean),
      ...(game ? { game: game.name } : {}),
    }));
    // Into the game's own folder too, so the next boot has it without a night pass.
    if (game) noteInGameMemory(gamesRoot(), game.name, `Read a guide to it ("${about}"): ${note}`, new Date());
    appendDream(app.getPath('userData'), dream({ kind: game ? 'guide' : 'free', game: game?.name, reading, transcript: watched, wrote: note }));
    console.log(`[night] ${game ? `read a guide to ${game.name}` : watched ? 'went through a video transcript' : 'read'} — "${about}" (${found.length} result(s)) -> ${note.length} chars`);
  } catch (error) {
    console.warn('[night] her night came to nothing:', error instanceof Error ? error.message : error);
  }
}

/** The example entries, for the lifted-sentence check only. Absent is fine: then there is nothing to lift. */
function diaryExamples(): string[] {
  const dir = path.join(app.getPath('userData'), 'diary-examples');
  try {
    return readdirSync(dir).filter(name => /\.(txt|md)$/i.test(name)).map(name => readFileSync(path.join(dir, name), 'utf8'));
  } catch { return []; }
}

/** A day's transcript, wherever the roll has left it: archived once the day is over, live until then. */
function messagesOn(day: string): { role: string; content?: string; at?: string }[] {
  type Line = { role: string; content?: string; at?: string };
  const archived = (store.getArchive()[day] ?? []) as Line[];
  const live = store.get('chat.dayKey') === day ? ((store.get('chat.messages') as Line[] | undefined) ?? []) : [];
  return [...archived, ...live];
}

/**
 * Something of her own, in the middle of the day while they work.
 *
 * The night pass is the honest version of "what did you do last night"; this
 * is the same shape for the day, so "what are you up to" at lunchtime has a
 * true answer too — a search, a page read, a note written from what she read
 * and nothing else. Near-daily, light, and never while she is asleep: this is
 * her life, which is the point of it.
 */
async function haveADay(config: ProviderConfig) {
  if (herAsleepNow()) return;
  const now = zonedNow(CHAT_TIMEZONE);
  const today = localDateKey(now);
  if (!dayPassDue(now, today, getDays().some(day => day.day === today), Math.random(), sway('own-time', DAY_ODDS, swayNow()))) return;
  const searchConfig = readSearchConfig(store.get('search'));
  if (!searchConfig.enabled) return;
  try {
    const theirs = getMemories().map(memory => memory.text);
    const before = getNights().map(night => night.about);
    const about = tidyPick(await ollamaQuip([getActiveCharacter().identity, dayPickInstruction(theirs, before)].join(' '), 'What are you looking up?', config));
    if (!about) { console.log('[day] she could not settle on anything'); return; }
    const found = await searchWeb(about, { ...searchConfig, limit: Math.max(searchConfig.limit, 4) }, net.fetch, getSearchKey());
    if (!found.length) { console.log(`[day] "${about}" turned nothing up`); return; }
    let reading = formatResults(about, found, false);
    if (searchConfig.readPages && found[0]?.url) {
      try {
        const page = await readWebPage(found[0].url, net.fetch);
        if (page.text.trim()) reading = `${reading}\n\n${formatPage(page, about)}`;
      } catch { /* the blurbs are enough; a page that will not open is not a failure */ }
    }
    const note = toLength(await ollamaQuipLong([getActiveCharacter().identity, dayNoteInstruction(about, reading)].join(' '), 'Write it.', config), 220);
    if (!note) { console.log('[day] nothing came of it'); return; }
    const at = new Date().toISOString();
    setDays(keepDay(getDays(), { day: today, at, about, note, sources: found.slice(0, 3).map(result => result.url).filter(Boolean) }));
    appendDream(app.getPath('userData'), { at, day: today, kind: 'day', about, sources: found.slice(0, 3).map(result => ({ title: result.title ?? '', url: result.url })), reading, wrote: note });
    console.log(`[day] ${today}: read about "${about}" — ${note.length} chars`);
  } catch (error) {
    console.warn('[day] could not read anything:', error instanceof Error ? error.message : error);
  }
}

/**
 * Her week, summed up once: Sunday night, from what actually happened.
 *
 * The days and nights and wants and milestones are already written down, so
 * the summary is composed from them and nothing else — a week invented on
 * Sunday night is a week she never had. It is stored and carried into the
 * her_own block through the week after, so "how was your weekend" has a true,
 * hers-shaped answer.
 */
async function reflectOnHerWeek(config: ProviderConfig) {
  const now = zonedNow(CHAT_TIMEZONE);
  if (!weekSummaryDue(now, getWeek())) return;
  const today = localDateKey(now);
  const inWeek = (day: string) => weekKey(today) <= day && day <= today;
  const material = [
    getDays().filter(day => inWeek(day.day)).map(day => `Read: ${day.about} — ${day.note}`),
    getNights().filter(night => inWeek(night.day)).map(night => `Night: ${night.interest ?? night.game ?? night.about} — ${night.note}`),
    wantsNote(getWants()),
    firstsNote(getInterests(), today),
  ].flat().filter(Boolean).join('\n');
  if (!material.trim()) { console.log('[week] nothing happened to sum up — skipping'); return; }
  try {
    const summary = toLength(await ollamaQuipLong([getActiveCharacter().identity, weekReflectionInstruction(material)].join(' '), 'Write it.', config), 500);
    if (!summary) { console.log('[week] nothing came of the reflection'); return; }
    setWeek({ day: weekKey(today), summary });
    console.log(`[week] ${weekKey(today)}: her week summed up — ${summary.length} chars`);
  } catch (error) {
    console.warn('[week] could not reflect on the week:', error instanceof Error ? error.message : error);
  }
}

/**
 * What she will not put up with: once a week, from what happened to her.
 *
 * The counterpart to reflectOnHerWeek, and built the same way — composed only
 * from things already written down, because a rule invented on a Sunday is a
 * rule she never earned. Her own event memories are the material (they are
 * already dated, already hers, already in her voice) together with the wake
 * ledger, which is the one place a grievance of hers is recorded as data.
 *
 * The bar is deliberately high and set outside the model: two separate days
 * inside three weeks, or she is not asked at all. Most weeks nothing qualifies
 * and nothing is written, which is the intended outcome — she is meant to end
 * up with two or three rules she means, not a rulebook.
 */
async function formHerStanding(config: ProviderConfig) {
  const now = zonedNow(CHAT_TIMEZONE);
  if (!standingDue(store.get('her.standingAt') as string | undefined, now)) return;
  // Her own record of what happened, in the words it was written in. The wake
  // ledger is folded in because a pointless wake is the clearest grievance she
  // keeps and the only one stored as a fact rather than as prose.
  const incidents: Incident[] = [
    ...slightsAsIncidents(getSlights()),
    // The wake ledger predates the slight ledger and is the same evidence, so
    // it is folded in rather than migrated. keepSlight's one-a-day rule does not
    // reach across the two; recentIncidents and her own reading handle the overlap.
    ...getWakes()
      .filter(wake => wake.pointless)
      .map(wake => ({ what: 'They woke you in the night for nothing, and you got up.', at: wake.at })),
  ];
  const recent = recentIncidents(incidents, now.getTime());
  if (!enoughToStandOn(recent)) return;
  // Stamped before the call, not after: a model that hangs or answers NONE must
  // not be asked again on the next tick. A week is the retry.
  store.set('her.standingAt', new Date().toISOString());
  const held = herStandings(getMemories()).map(standing => standing.text);
  try {
    const raw = await ollamaQuipLong([getActiveCharacter().identity, NOBODY_HERE].join(' '), standingPrompt(recent, held), config);
    const standing = parseStanding(raw);
    if (!standing) { console.log(`[standing] nothing worth a rule this week (${recent.length} incident(s) read)`); return; }
    const saved = addMemory(standing.text, 'preference', HER_SUBJECT, {
      source: 'inferred',
      evidenceDetail: standing.because || undefined,
    });
    if (!saved?.created) { console.log(`[standing] she already holds that one: "${standing.text.slice(0, 70)}"`); return; }
    console.log(`[standing] she has decided: "${standing.text}"${standing.because ? ` — because ${standing.because}` : ''}`);
  } catch (error) {
    console.warn('[standing] could not work one out:', error instanceof Error ? error.message : error);
  }
}

/**
 * Her diary: one entry a night, about the day with them and the night without.
 *
 * Written just before the quiet ends so the night is in it, and composed from
 * the day's actual material — what they said, how she was left, what she read
 * — because a diary that invents its days is a novel, and hers is a record.
 * Lands in diary.md in her data folder, hers to build over months.
 */
async function writeDiary(config: ProviderConfig) {
  const now = zonedNow(CHAT_TIMEZONE);
  const { prefs } = getPush();
  const due = diaryDueFor(now, prefs, at => nightKey(at));
  const mood = getMood();
  if (!due || mood.diaryDay === due) return;
  // The day's transcript, wherever the roll has left it. With the quiet ending
  // at six the entry is due after five, and the day rolls at five: the live
  // list was already empty every night, so every entry opened on "he said
  // nothing to you today" over days of forty and fifty messages — and, with
  // nothing else to go on, counted every line she had sent as one he ignored.
  const messages = messagesOn(due);
  const theirs = messages.filter(message => message.role === 'user').map(message => String(message.content ?? '').trim()).filter(Boolean);
  const substantial = theirs.filter(text => text.split(/\s+/).length >= 4);
  const theySaid = [...substantial.slice(-3), ...substantial.slice(0, 1)].filter((text, index, all) => all.indexOf(text) === index).map(text => text.slice(0, 140));
  const tonight = nightsOn(getNights(), due);
  const material = diaryInstruction({
    day: due,
    theySaid, theirMessages: theirs.length,
    herUnprompted: asidesOn(getAsides(), due).length,
    irritation: mood.irritation, grudge: mood.grudge ?? 0, ignoredToday: mood.talliedDay === due ? mood.ignoredToday ?? 0 : 0, counted: mood.talliedDay === due,
    went: mood.owedMorning?.day === due ? mood.owedMorning.went : mood.nightfallDay === due ? 'fine' : null,
    ticked: getKept().filter(item => item.done && item.completedAt?.startsWith(due)).map(item => item.title),
    nights: tonight.map(night => ({ about: night.about, note: night.note, interest: night.interest, game: night.game })),
    // What she did today, from the deed ledger. Her day recorded what she read
    // and nothing she did; this is the consumer that ledger was missing.
    did: readDeeds(store.get('her.deeds')).filter(deed => nightKey(new Date(deed.at)) === due).map(deed => deed.what),
    tastes: getInterests().filter(interest => interest.stance).map(interest => ({ name: interest.name, stance: interest.stance })),
    weather: describeWeather(getWeather().last, weatherWhere(), Date.now(), getWeather().disputedAt).split('. That is the actual')[0] || undefined,
    hisLastMessageAt: (() => { const last = messages.filter(message => message.role === 'user' && message.at).at(-1)?.at; return last ? clockAt(Date.parse(last)) : undefined; })(),
    herSleep: (() => {
      const schedule = getHerSleepSchedule();
      if (!schedule || schedule.day !== due) return undefined;
      const texted = messagesWhileAsleep(schedule, [...messagesOn(due), ...messagesOn(dayAfter(due))] as { role?: string; at?: string }[], CHAT_TIMEZONE);
      return { bed: clockMinutes(schedule.bedtime), wake: clockMinutes(schedule.wake), texted, wokenEarly: Boolean(schedule.wokenEarly) };
    })(),
  });
  try {
    // Her identity and what she knows of them, but not her style: the style is
    // how she talks *to* them, and a diary is the one place she is not. The
    // diary has a voice of its own (diaryvoice.ts), from the examples.
    const system = [getActiveCharacter().identity, profileSummary(''), DIARY_VOICE, fragmentsInstruction(), material].join(' ');
    let entry = await ollamaQuipLong(system, 'Write tonight\'s entry.', config);
    // The example entries are kept on disk for exactly this check, and never
    // shown to her: a sentence lifted from one is an event from one.
    const examples = diaryExamples();
    const lifted = liftedFrom(entry, examples);
    if (lifted) {
      console.log(`[diary] she lifted "${lifted}…" from an example — asking again`);
      entry = await ollamaQuipLong(`${system} ${NOT_THOSE_LINES}`, 'Write tonight\'s entry.', config);
      const again = liftedFrom(entry, examples);
      if (again) { console.warn(`[diary] still lifting ("${again}…") — not written tonight`); return; }
    }
    // A diary that has to be true cannot name what the night never mentioned.
    // Everything she was given is the allowed pool; a name outside it is a
    // fabricated event, and she is asked once to write without it.
    const strange = unknownNames(entry, [system]);
    if (strange.length) {
      console.log(`[diary] she named ${strange.map(name => `"${name}"`).join(', ')}, which tonight never mentioned — asking again`);
      entry = await ollamaQuipLong(`${system} ${NOT_THOSE_NAMES(strange)}`, 'Write tonight\'s entry.', config);
      const still = unknownNames(entry, [system]);
      if (still.length) { console.warn(`[diary] still naming ${still.map(name => `"${name}"`).join(', ')} — not written tonight`); return; }
    }
    if (entry.trim().length < 40) { console.log('[diary] nothing worth keeping came out — not written'); return; }
    // A title for the tab: hers, short, from the entry alone.
    let title = '';
    try {
      title = (await ollamaQuip(`${getActiveCharacter().identity} Here is tonight's diary entry of yours:\n${entry}\n\nGive it a title, the way a diary entry gets one: four to eight words, in your voice, about what the day was. No quotation marks, no date, the title only.`, 'Title it.', config)).slice(0, 80);
    } catch { title = ''; }
    appendEntry(app.getPath('home'), due, entry, new Intl.DateTimeFormat('en-AU', { weekday: 'long', timeZone: 'UTC' }), title);
    setMood({ ...getMood(), diaryDay: due });
    console.log(`[diary] wrote the entry for ${due} (${entry.length} chars)`);
    publishToVault('diary');
  } catch (error) {
    console.warn('[diary] could not write tonight\'s entry:', error instanceof Error ? error.message : error);
  }
}

/**
 * Bedtime: were they ever going to say anything about today?
 *
 * Silent here — it runs at the top of the quiet hours, and waking somebody to
 * complain that they went to sleep is not the point. It costs them on the spot
 * and leaves a note for the morning, which sayItInTheMorning picks up the
 * moment the quiet is over.
 *
 * Deliberately not folded into the eight o'clock tally: that counts lines of
 * hers that got no answer, and a day where neither of them said anything has
 * none of those. By the tally it reads as a clean day and even earns a point
 * back, which is the wrong answer to being ignored all day.
 */
function sulkAtNightfall() {
  // Not gated on her being awake. This only writes the day down — nothing is
  // said until the morning line — and it comes due at the quiet hours, which is
  // when she goes to bed: with her bedtime at 23:00 and quiet hours from 23:00
  // she was asleep for the whole of the window and the day was never counted
  // (2026-09-14; 09-11 before it).
  const now = zonedNow(CHAT_TIMEZONE);
  const todayKey = localDateKey(now);
  const mood = getMood();
  const { prefs } = getPush();
  const [hour, minute] = prefs.quietFrom.split(':').map(Number);
  const bedtime = prefs.quietFrom === prefs.quietTo || !Number.isFinite(hour) ? DEFAULT_BEDTIME_MINUTES : hour * 60 + minute;
  if (!nightfallDue(now.getHours() * 60 + now.getMinutes(), bedtime, mood.nightfallDay, todayKey)) return;
  const messages = (store.get('chat.messages') as { role: string; content?: string }[] | undefined) ?? [];
  const said = daySaid(messages);
  // The journal and the check-ins are the "how was your day" channels; using
  // one of them is telling her, whatever the chat looked like.
  const toldElsewhere = getJournal().some(entry => entry.date === todayKey)
    || checkInsOn(getCheckIns(), todayKey).length > 0;
  const went = howTheDayWent(said, toldElsewhere);
  const grudge = sulkGrudge(mood.grudge ?? 0, went);
  if (went === 'silent') nudgeVitals('let-down');
  setMood({ ...mood, grudge, nightfallDay: todayKey, owedMorning: went === 'fine' ? undefined : { day: todayKey, went, said } });
  console.log(`[nightfall] ${todayKey}: ${said} real message(s)${toldElsewhere ? ' plus a journal or check-in' : ''} — ${went}, grudge ${mood.grudge ?? 0} -> ${grudge}${went === 'fine' ? '' : ', owed a word in the morning'}`);
}

/** Not before this: interject refuses mid-conversation, and that passes. */
let morningQuietUntil = 0;

/**
 * The note she went to bed with, said the moment the quiet is over.
 *
 * Gated on the quiet ending rather than on a clock of its own, so it follows
 * whatever hours they have set. Kept until it actually gets out — the same
 * lesson as the evening tally, where marking it done before the line was said
 * lost the whole thing to one refusal — and dropped after a day, because
 * bringing up Tuesday on Thursday is not holding a grudge, it is a non sequitur.
 */
async function sayItInTheMorning(config: ProviderConfig) {
  if (herAsleepNow()) return;
  const mood = getMood();
  const owed = mood.owedMorning;
  if (!owed) return;
  const now = zonedNow(CHAT_TIMEZONE);
  const todayKey = localDateKey(now);
  const { prefs } = getPush();
  if (inQuietHours(prefs, now)) return;
  // The first thing she says when they are up — not the first thing after six.
  if (!theyAreUpNow()) return;
  if (!sulkStillStands(owed.day, todayKey)) {
    console.log(`[nightfall] the word owed for ${owed.day} has gone stale — dropping it`);
    setMood({ ...getMood(), owedMorning: undefined });
    return;
  }
  // The night it is about has to be over: at 23:05 the quiet has begun, but a
  // check that ran a minute earlier would otherwise fire straight back out.
  if (owed.day === todayKey) return;
  if (Date.now() < morningQuietUntil) return;
  const character = getActiveCharacter();
  const system = [
    character.identity,
    character.style,
    moodInstruction(mood.irritation),
    grudgeInstruction(mood.grudge ?? 0, 0),
    sulkInstruction(owed.went, owed.said, mood.grudge ?? 0),
    EXPRESSIVE,
    'No quotation marks, no stage directions.',
  ].filter(Boolean).join(' ');
  try {
    const clock = zonedNow(CHAT_TIMEZONE);
    const line = fixStatedClock(await ollamaQuip(system, 'Say it.', config), clock.getHours(), clock.getMinutes());
    if (line && interject(line, { source: 'idle' })) {
      setMood({ ...getMood(), owedMorning: undefined });
      console.log(`[nightfall] said it — they had gone ${owed.went} on her`);
      return;
    }
  } catch (error) {
    console.warn('[nightfall] could not compose the morning line:', error instanceof Error ? error.message : error);
  }
  morningQuietUntil = Date.now() + TALLY_RETRY_MS;
  console.log(`[nightfall] the morning line did not get out — trying again in ${Math.round(TALLY_RETRY_MS / 60_000)} min`);
}

/** Not before this: interject refuses mid-conversation, and that passes. */
let tallyQuietUntil = 0;
const TALLY_RETRY_MS = 10 * 60_000;

/**
 * Saying it, which is the point of counting it.
 *
 * Separate from the counting because the two fail differently. The count must
 * happen once; the line has to get past interject's rate limiter, which
 * deliberately refuses while they are talking to her — and at eight in the
 * evening they very often are. Marking the day done before the line was out
 * meant one refusal cost the whole evening and she never mentioned it again.
 */
async function tellThemTheTally(config: ProviderConfig, todayKey: string) {
  const mood = getMood();
  if (mood.talliedDay !== todayKey || mood.toldDay === todayKey) return;
  const ignored = mood.ignoredToday ?? 0;
  // A clean day is not something she brings up; it is just quieter than usual.
  if (!ignored) { setMood({ ...mood, toldDay: todayKey }); return; }
  if (Date.now() < tallyQuietUntil) return;
  const character = getActiveCharacter();
  const system = [
    character.identity,
    character.style,
    moodInstruction(mood.irritation),
    grudgeInstruction(mood.grudge ?? 0, ignored),
    tallyInstruction(ignored, mood.grudge ?? 0, mood.ignoredSamples ?? []),
    EXPRESSIVE,
    'No quotation marks, no stage directions.',
  ].filter(Boolean).join(' ');
  try {
    // Through the clock fixer: the samples she is quoting are her own earlier
    // lines, and some of them open with the time they were said ("8:37 PM — ..."),
    // which she lifts out and announces as though it were now.
    const clock = zonedNow(CHAT_TIMEZONE);
    const line = fixStatedClock(await ollamaQuip(system, 'Say it.', config), clock.getHours(), clock.getMinutes());
    if (line && interject(line, { source: 'idle' })) {
      setMood({ ...getMood(), toldDay: todayKey });
      console.log(`[grudge] told them about the ${ignored} they left`);
      return;
    }
  } catch (error) {
    console.warn('[grudge] could not compose the evening line:', error instanceof Error ? error.message : error);
  }
  tallyQuietUntil = Date.now() + TALLY_RETRY_MS;
  console.log(`[grudge] the evening line did not get out — trying again in ${Math.round(TALLY_RETRY_MS / 60_000)} min`);
}

function startProactive() {
  if (proactiveTimer) return;
  proactiveTimer = setInterval(() => { void proactiveTick(); }, PROACTIVE_TICK_MS);
  setTimeout(() => { void proactiveTick(); }, 20_000);
}

/**
 * The next beat: a random while off, never in the quiet hours. One timer,
 * rebooked after each — and written down, because it used to die with the
 * process.
 *
 * Every restart drew a fresh 45-120 minutes and threw away whatever was
 * pending, so a morning of eleven deploys meant eleven cancelled bookings and
 * not one nudge. `resume` picks the old booking back up; if it came due while
 * she was down, she takes it shortly after coming back rather than pretending
 * it never existed. A refused line comes back in minutes, not the full cycle.
 */
function scheduleNextPush(resume = false, after: PesterOutcome | null = null) {
  if (pushPesterTimer) clearTimeout(pushPesterTimer);
  const now = Date.now();
  const booked = resume ? getPush().nextNudgeAt : 0;
  let delay: number;
  if (after?.how === 'refused') {
    delay = NUDGE_RETRY_MS;
  } else if (after?.how === 'later') {
    // Long enough for the reason to have expired, and never so long that a
    // passing condition costs the rest of the day.
    delay = Math.min(Math.max(after.inMs ?? NUDGE_RETRY_MS, 60_000), NUDGE_GAP_MS[0]);
  } else if (booked > now) {
    delay = booked - now;
    console.log(`[push] picking the booking back up where the restart left it: ${Math.round(delay / 60_000)} min`);
  } else if (booked) {
    // Due while she was off. Soon, with a little slack, so a crash loop cannot
    // turn a missed nudge into a burst of them.
    delay = (3 + Math.random() * 5) * 60_000;
    console.log(`[push] the nudge booked for ${new Date(booked).toISOString()} came due while she was down — in ${Math.round(delay / 60_000)} min instead`);
  } else {
    delay = nextNudgeDelay(getPush().prefs, zonedNow(CHAT_TIMEZONE));
  }
  savePush({ nextNudgeAt: now + delay });
  console.log(`[push] next unprompted push in ${Math.round(delay / 60_000)} min`);
  pushPesterTimer = setTimeout(() => { void pesterOnPush().then(outcome => scheduleNextPush(false, outcome), () => scheduleNextPush()); }, delay);
}

/**
 * Whether they are up, as far as she can tell — see awake.ts. The quiet ending
 * is when she may speak; this is when there is someone to speak to.
 */
/** Where they last said they were (told.ts), and a clock for saying when. */
function getTold(): Told | undefined {
  const saved = store.get('told') as Told | undefined;
  return saved && typeof saved.where === 'string' && typeof saved.at === 'string' ? saved : undefined;
}
const clockAt = (ms: number) => new Intl.DateTimeFormat('en-AU', { hour: 'numeric', minute: '2-digit', timeZone: CHAT_TIMEZONE }).format(new Date(ms));
function getArrival(): Arrival | null {
  const saved = store.get('where.arrival') as Partial<Arrival> | undefined;
  return saved && typeof saved.place === 'string' && typeof saved.at === 'string' ? { place: saved.place, at: saved.at } : null;
}

/** What she was told lately, in their words: their messages today, and the place they said they were at or heading for. */
function theirWordsLately(): string[] {
  const messages = (store.get('chat.messages') as { role?: string; content?: string; at?: string }[] | undefined) ?? [];
  const since = Date.now() - 3 * 60 * 60_000;
  const said = messages
    .filter(message => message.role === 'user' && (!message.at || Date.parse(message.at) >= since))
    .map(message => String(message.content ?? ''))
    .slice(-8);
  const told = getTold();
  return [...said, told?.where ?? '', told?.thenTo ?? ''].filter(Boolean);
}

/**
 * They turned up somewhere without a word about going. She finds out from a
 * phone, which is not the same as being told, and it is meant to nettle her —
 * see unannouncedArrivalNote. The bump stops short of the threshold where she
 * stops answering: this is a thing to be sharp about, not to go silent over.
 */
function noteArrival(place: string): void {
  if (saidTheyWereGoing(place, theirWordsLately())) {
    console.log(`[where] they turned up at ${place}, and they had said so`);
    return;
  }
  store.set('where.arrival', { place, at: new Date().toISOString() });
  noteSlight('unannounced', `They turned up at ${place} without telling you they were going.`);
  const mood = getMood();
  // Below IRRITATION.voiced moodInstruction barely speaks, so a bump from zero
  // would have been an annoyance she could not act on. Voiced is the first level
  // that properly reaches her voice; the cap is one notch short of not answering.
  const irritation = Math.min(Math.max(mood.irritation + 2 * IRRITATION_NOTCH, IRRITATION.voiced), IGNORE_THRESHOLD - IRRITATION_NOTCH);
  setMood({ ...mood, irritation });
  console.log(`[where] they turned up at ${place} without saying — irritation ${mood.irritation} to ${irritation}`);
}

function arrivalNote(): string {
  return unannouncedArrivalNote(getArrival(), Date.now(), clockAt);
}

function toldNow(): string {
  return describeTold(getTold(), Date.now(), clockAt);
}

/** Between two wake-up lines. She does not greet someone every time their phone wakes. */
const WAKE_ACK_GAP_MS = 2 * 3_600_000;

function theyAreUpNow(): boolean {
  const log = store.getActivityLog();
  const days = Object.keys(log).sort();
  const latest = days.length ? (log[days[days.length - 1]] ?? []).map(entry => entry.until ?? entry.at).sort().at(-1) : undefined;
  return theyAreUp({
    lastMessageAt: getMood().lastMessageAt,
    lastOpenedAt: store.get('web.lastOpenedAt') as string | undefined,
    lastActivityAt: latest,
  }, getPush().prefs, zonedNow(CHAT_TIMEZONE));
}

/**
 * The floor: two hours without a word from her and she says something,
 * whatever the random beat is doing.
 *
 * On the five-minute proactive beat rather than its own timer, so that none of
 * the things that swallow the random one — a restart, a refused line, a guard
 * that returned early — can swallow this as well.
 */
/**
 * Not before this, whatever the floor says.
 *
 * The floor rides the five-minute beat, and an attempt that comes to nothing
 * leaves it overdue — so without this it would compose three lines every five
 * minutes for as long as the cause lasted. A refused line is worth coming back
 * to soon; a deliberate silence is not going to change in five minutes.
 */
let floorQuietUntil = 0;

async function checkNudgeFloor() {
  const { prefs } = getPush();
  if (!webServer || !canReachPhone() || !prefs.random) return;
  if (Date.now() < floorQuietUntil) return;
  // Two hours of silence from someone asleep is not two hours of silence.
  if (!theyAreUpNow() || herHasSaidGoodnight() || herKnockedAwakeNow()) return;
  const reached = lastReachedThem();
  if (!reached) {
    // First run since this existed: start the clock now rather than treating an
    // unknown as overdue and buzzing them the moment she boots.
    savePush({ lastReachedAt: Date.now() });
    return;
  }
  // From her own wake when that is later: a push before her night is not two
  // hours of her silence, and counted that way it buzzed him ten minutes after she got up (2026-09-06).
  const since = Math.max(reached, herWokeAtMs());
  if (!nudgeOverdue(since, Date.now(), prefs, zonedNow(CHAT_TIMEZONE))) return;
  console.log(`[push] ${Math.round((Date.now() - since) / 60_000)} min since anything of hers landed — going on the floor, not the beat (they are up: ${upBecause()})`);
  const outcome = await pesterOnPush();
  // Rebook the random beat from here, so the floor and the beat do not end up
  // firing on top of each other.
  if (outcome.how === 'sent') return scheduleNextPush();
  const backOff = outcome.how === 'refused' ? NUDGE_RETRY_MS
    : outcome.how === 'later' ? Math.max(outcome.inMs ?? NUDGE_RETRY_MS, 60_000)
    : FLOOR_BACKOFF_MS;
  floorQuietUntil = Date.now() + backOff;
  console.log(`[push] the floor came to nothing (${outcome.how}) — not trying again for ${Math.round(backOff / 60_000)} min`);
}

const DEFAULT_WEB_PORT = 8787;
let webServer: { port: number; stop(): Promise<void> } | null = null;

/**
 * The names of the expressions her model can pull.
 *
 * Taken from the folder rather than the manifest, for the same reason the server
 * fills the manifest in as it serves it: this model ships twenty-two expression
 * files and declares none of them, so trusting the manifest would report that
 * she has no face.
 */
function modelExpressions(): string[] {
  const saved = store.get('live2d.model') as { path?: string } | undefined;
  if (!saved?.path || !existsSync(saved.path)) return [];
  try {
    const manifest = JSON.parse(readFileSync(saved.path, 'utf8')) as { FileReferences?: { Expressions?: { Name?: string }[] } };
    const declared = manifest.FileReferences?.Expressions;
    if (Array.isArray(declared) && declared.length) return declared.map(e => String(e.Name ?? '')).filter(Boolean);
    return readdirSync(path.dirname(saved.path))
      .filter(name => /\.exp3\.json$/i.test(name))
      .map(name => name.replace(/\.exp3\.json$/i, ''));
  } catch {
    return [];
  }
}

/**
 * What the phone is allowed to reach.
 *
 * Chat goes through the same ollamaChat the desktop uses, so what answers is
 * genuinely her — the same system prompt, the same memory, the same mood — and
 * not a second, thinner Haru that would drift from the first. The one thing
 * withheld is her hands: see the comment on handsAllowed.
 *
 * Her reply is handed to the window rather than written to the store here. The
 * renderer owns chat.messages and persists the whole list; writing underneath it
 * would be a second writer to the same file, and the message from the phone
 * would vanish the next time the desktop saved.
 */

/**
 * Cuts the sentences out of a streaming reply as they complete, so the phone
 * can start speaking the first one while the model is still writing the rest.
 *
 * `feed` is called with every streamed stretch; `reset` with a round thrown
 * away (a tool call was coming — nothing of it may be spoken); `flush` once
 * with the tail after the reply is complete, because the last sentence arrives
 * without the whitespace the splitter waits for. The mood handed with each
 * sentence is read from everything streamed so far (localEmotion, no model
 * call), so it converges on the reply's overall mood rather than judging each
 * sentence alone.
 */
function sentenceStreamer(onSentence?: (sentence: string, emotion: string) => void) {
  let buffer = '';
  let streamedSoFar = '';
  return {
    feed(chunk: string) {
      streamedSoFar += chunk;
      if (!onSentence) return;
      // A round that opens as her deliberation — "The user said…", "I should…"
      // — is not voiced. The loop asks again for the words alone and takes
      // the round back, and a leak already read aloud cannot be taken back:
      // one was, and the day kept it as what she said (2026-09-06).
      if (thinksAloud(streamedSoFar)) { buffer = ''; return; }
      buffer += chunk;
      const { sentences, rest } = streamedSentences(buffer);
      buffer = rest;
      // The brain that wrote the sentence says how it meant it. A label is
      // taken when it is there and the keyword pass stands in when it is not,
      // so a model that ignores the rule costs nothing. Groggy still overrides
      // both: half asleep she sounds half asleep whatever she wrote.
      const heuristic = herGroggyNow() ? 'sleepy' : localEmotion(streamedSoFar);
      for (const sentence of sentences) {
        for (const said of splitDelivery(sentence)) {
          onSentence(said.text, herGroggyNow() ? 'sleepy' : (said.mood ?? heuristic));
        }
      }
    },
    reset() {
      buffer = '';
      streamedSoFar = '';
    },
    flush() {
      if (!onSentence) return;
      const tail = buffer.trim();
      if (tail) {
        const heuristic = herGroggyNow() ? 'sleepy' : localEmotion(streamedSoFar);
        for (const said of splitDelivery(tail)) {
          onSentence(said.text, herGroggyNow() ? 'sleepy' : (said.mood ?? heuristic));
        }
      }
      buffer = '';
    },
  };
}

function webDeps(): WebDeps {
  const deps: WebDeps = {
    readAccess: getWebAccess,
    saveAccess: saveWebAccess,
    history: (poll = false) => {
      // Opening the page is a sign of life: the morning waits for one. A poll
      // from a page left open on the nightstand is not.
      if (!poll) store.set('web.lastOpenedAt', new Date().toISOString());
      const messages = (store.get('chat.messages') as { id?: string; role: string; content: string; at?: string; reaction?: string; note?: string; aside?: string }[] | undefined) ?? [];
      // What she said to the phone on her own — a chase, a nudge, the weather
      // — is an aside, not a message, and the notification that carried it
      // used to be the only place it existed: tap it, and the line was not
      // there. The page shows the day as it was heard, so they go in beside
      // the conversation, where they were said.
      const day = (store.get('chat.dayKey') as string | undefined) ?? localDateKey(zonedNow(CHAT_TIMEZONE));
      const said = asidesOn(getAsides(), day).map(aside => ({ id: aside.id, role: 'assistant', content: aside.text, at: aside.at, aside: aside.source as string }));
      if (!said.length) return messages;
      // A message without a stamp keeps its place after the last stamped one.
      let seen = '';
      const stamped = messages.map((message, index) => { seen = message.at ?? seen; return { message, at: seen, index }; });
      const all = [...stamped, ...said.map((message, index) => ({ message, at: message.at, index: messages.length + index }))];
      all.sort((a, b) => a.at.localeCompare(b.at) || a.index - b.index);
      return all.map(entry => entry.message);
    },
    /**
     * What they thought of a reply. The thumb lands on the message through
     * the desk, which owns the conversation; her mood and her face move the
     * way a desk thumb moves them; and she answers back the way she does at
     * the desk — the comeback goes to the page and into the conversation as
     * an interjection. Every rating is also written down for later
     * (feedback.ts). A note alone, or the same thumb twice, moves nothing and
     * gets no comeback — the desk ignores a re-pick too.
     */
    async rate(id, reaction, note) {
      const history = (store.get('chat.messages') as { id?: string; role: string; content: string; reaction?: string }[] | undefined) ?? [];
      const target = history.find(message => message.id === id && message.role === 'assistant');
      if (!target) return null;
      sendToWindows('chat:ratedFromPhone', { id, ...(reaction ? { reaction } : {}), ...(note !== undefined ? { note } : {}) });
      appendFeedback({ id, reaction, note, source: 'phone' });
      if (!reaction || target.reaction === reaction) return { line: null };
      const { comeback } = takeThumb(reaction);
      if (!comeback) { console.log(`[web] rated ${reaction} from the phone — she let it pass`); return { line: null }; }
      const config = store.get('ai.config') as ProviderConfig | undefined;
      if (!config?.model) return { line: null };
      try {
        const line = reaction === 'down' ? await ollamaRetort(target.content, config) : await ollamaGloat(target.content, config, getMood().ego);
        if (line) sendToWindows('chat:interject', line);
        console.log(`[web] rated ${reaction} from the phone — she ${reaction === 'down' ? 'retorted' : 'gloated'} in ${line.length} chars`);
        return { line: line || null };
      } catch (error) {
        console.warn('[web] could not answer a rating back:', error instanceof Error ? error.message : error);
        return { line: null };
      }
    },
    async say(text, attachments) {
      const config = store.get('ai.config') as ProviderConfig | undefined;
      if (!config?.model) throw new Error('no model is set up');
      const history = (store.get('chat.messages') as { role: string; content: string; at?: string }[] ?? []);
      // What the page hands back is what stage() gave it, but it has been to a
      // browser and back — re-read it, and let ollamaChat's path check judge it.
      const files = readAttachments(attachments).slice(0, 6);
      // Her night: unreachable until she wakes. The message is already on the
      // way into the transcript, and the away line stands in for a reply — no
      // model call, no voice, nothing composed.
      const door = herAsleepNow() ? knockWhileAsleep() : null;
      if (door) {
        const trace = newTrace();
        const line = door;
        sendToWindows('chat:fromPhone', { text, reply: line, ignored: false, ...(files.length ? { attachments: files } : {}) });
        console.log(`[web] asleep — not answering (${text.length} chars stored)`);
        trace.done('web', { tier: 'asleep', chars: line.length });
        return { reply: line, ignored: false };
      }
      // The quick route answers what it can before the model is even asked: a
      // time check or a greeting from a phone should be instant, not the cold
      // start a hosted pod pays. Falls through when the message needs judgement
      // — and a message carrying a file always does.
      const trace = newTrace();
      const quick = files.length ? null : (await settingSaid(text)) ?? quickHit(text, history);
      trace.mark('intent');
      if (quick) {
        announceQuick(quick, text);
        trace.done('web', { tier: quick.tier, chars: quick.reply.length });
        return { reply: quick.reply, ignored: false };
      }
      const messages = [...history, { role: 'user', content: text, at: new Date().toISOString(), ...(files.length ? { attachments: files } : {}) }];
      // Out to the hosted model, because this is a phone. There is no window
      // to show that she is thinking, the tab is
      // often not even in front of them, and since the local model became a
      // serverless pod the first message of a session pays a cold start. The
      // desk keeps the local one — that is what the GPU is for.
      const started = Date.now();
      const answer = await ollamaChat(messages, config, { hands: false, web: true, away: 'it came in from the phone', traceId: trace.id });
      const reply = stripDelivery(answer.content ?? '');
      rememberDelivery(answer.content ?? '', reply);
      trace.mark('reply');
      sendToWindows('chat:fromPhone', { text, reply, ignored: Boolean(answer.ignored), ...(files.length ? { attachments: files } : {}) });
      // Her face used to be read here, before returning, and the phone waited on
      // it — a second round trip to a model, spent so her eyebrows would be
      // right at the instant the text appeared rather than a moment after. That
      // is the trade /api/speak already refused for her voice, and it is a worse
      // trade for a face: nobody is looking at the stage while they are reading
      // the reply that has not arrived yet. It moved to /api/expression.
      console.log(`[web] answered ${text.length} chars with ${reply.length} in ${Date.now() - started}ms (${messages.length} messages of history)`);
      trace.done('web', { tier: 'llm', chars: reply.length });
      return { reply, ignored: answer.ignored };
    },
    async sayStream(text, onChunk, attachments, options, onSentence) {
      const config = store.get('ai.config') as ProviderConfig | undefined;
      if (!config?.model) throw new Error('no model is set up');
      const history = (store.get('chat.messages') as { role: string; content: string; at?: string }[] ?? []);
      const files = readAttachments(attachments).slice(0, 6);
      const voice = sentenceStreamer(onSentence);
      // The page gets the cleaned stream; the voice gets the raw one, because
      // the label is how it learns the mood and is the one thing he must never
      // see. A no-op until the delivery rule is switched on.
      let showClean = cleaningChunks(onChunk);
      const door = herAsleepNow() ? knockWhileAsleep() : null;
      if (door) {
        const trace = newTrace();
        const line = door;
        onChunk(line);
        voice.feed(line);
        voice.flush();
        sendToWindows('chat:fromPhone', { text, reply: line, ignored: false, ...(files.length ? { attachments: files } : {}) });
        console.log(`[web] asleep — not answering (${text.length} chars stored)`);
        trace.done('web', { tier: 'asleep', chars: line.length });
        return { reply: line, ignored: false };
      }
      const trace = newTrace();
      const quick = files.length ? null : (await settingSaid(text)) ?? quickHit(text, history);
      trace.mark('intent');
      if (quick) {
        onChunk(quick.reply);
        // Fed whole and flushed: a quick line has no stream behind it to end
        // the last sentence, and unflushed it was never voiced on a call.
        voice.feed(quick.reply);
        voice.flush();
        announceQuick(quick, text);
        trace.done('web', { tier: quick.tier, chars: quick.reply.length });
        return { reply: quick.reply, ignored: false };
      }
      const messages = [...history, { role: 'user', content: text, at: new Date().toISOString(), ...(files.length ? { attachments: files } : {}) }];
      const started = Date.now();
      // Stopped mid-sentence, by a tap on her or by being talked over.
      if (options?.interrupted) { nudgeVitals('cut-off'); feelNow('cut-off'); }
      const answer = await ollamaChat(messages, config, {
        hands: false,
        web: true,
        away: 'it came in from the phone',
        ...(options?.call ? { aside: callAside(Boolean(options.interrupted)), call: true } : options?.interrupted ? { aside: INTERRUPTED_ASIDE } : {}),
        ...(options?.onToolCall ? { onToolCall: options.onToolCall } : {}),
        onSending: () => trace.mark('sending'),
        traceId: trace.id,
        onChunk: chunk => { trace.mark('first'); showClean(chunk); voice.feed(chunk); },
        // The reader sees only what survives, but a round that ends in a tool
        // call or a retry can leave a few streamed words behind it. Sink them
        // with nothing: the streamed text is replaced by the reply that counts.
        // The first-word stamp goes with them, or the trace would claim a TTFT
        // on words nobody ever saw. The voice is sunk the same way — nothing of
        // a thrown-away round may be spoken.
        onChunkReset: () => { trace.unmark('first'); onChunk('\uFFFD'); voice.reset(); showClean = cleaningChunks(onChunk); },
      });
      const reply = stripDelivery(answer.content ?? '');
      // The last sentence arrives without the space the splitter waits for —
      // this is the reply's end, so what is left is hers to say.
      voice.flush();
      trace.mark('reply');
      sendToWindows('chat:fromPhone', { text, reply, ignored: Boolean(answer.ignored), ...(files.length ? { attachments: files } : {}) });
      console.log(`[web] streamed ${text.length} chars in ${Date.now() - started}ms, ${reply.length} chars (${messages.length} messages of history${files.length ? `, ${files.length} file(s)` : ''})`);
      trace.done('web', { tier: 'llm', chars: reply.length });
      return { reply, ignored: answer.ignored };
    },
    /**
     * Her last reply, done again.
     *
     * The history is read back to the message that prompted it — their words,
     * their files — that reply is left out, and she is asked once more. The
     * desktop is told to swap the reply rather than add a turn, because it
     * owns the conversation. Asked for when a reply was cut short, or was not
     * her.
     */
    async retryStream(onChunk, onSentence) {
      const config = store.get('ai.config') as ProviderConfig | undefined;
      if (!config?.model) throw new Error('no model is set up');
      if (herAsleepNow()) {
        const line = asleepReply();
        onSentence?.(line, localEmotion(line));
        return { reply: line, ignored: false };
      }
      const history = (store.get('chat.messages') as { role: string; content: string; at?: string; attachments?: Attachment[] }[] ?? []);
      const last = history.at(-1);
      const prompt = history.at(-2);
      if (!last || last.role !== 'assistant' || !prompt || prompt.role !== 'user') return null;
      const voice = sentenceStreamer(onSentence);
      // The page gets the cleaned stream; the voice gets the raw one, because
      // the label is how it learns the mood and is the one thing he must never
      // see. A no-op until the delivery rule is switched on.
      let showClean = cleaningChunks(onChunk);
      const trace = newTrace();
      const started = Date.now();
      const answer = await ollamaChat(history.slice(0, -1), config, {
        hands: false,
        web: true,
        away: 'the phone asked for it again',
        traceId: trace.id,
        onChunk: chunk => { trace.mark('first'); showClean(chunk); voice.feed(chunk); },
        onChunkReset: () => { trace.unmark('first'); onChunk('\uFFFD'); voice.reset(); showClean = cleaningChunks(onChunk); },
      });
      const reply = stripDelivery(answer.content ?? '');
      voice.flush();
      trace.mark('reply');
      sendToWindows('chat:fromPhone', { text: prompt.content, reply, ignored: Boolean(answer.ignored), retry: true, ...(prompt.attachments?.length ? { attachments: prompt.attachments } : {}) });
      console.log(`[web] said it again in ${Date.now() - started}ms, ${reply.length} chars`);
      trace.done('web', { tier: 'llm', chars: reply.length });
      return { reply, ignored: answer.ignored };
    },
    /**
     * Which face to pull about a line she has just said.
     *
     * Read on this side rather than the phone's, because only this side knows
     * which expressions the loaded model actually carries — and the honest
     * answer is often "none for that", which is a nothing the page can act on.
     */
    async expression(text) {
      const config = store.get('ai.config') as ProviderConfig | undefined;
      if (!config?.model) return { emotion: null, expression: null };
      // The door's line is not hers to feel: thirteen seconds of classifier for "I'm asleep" (2026-09-06).
      if (isAsleepLine(text) || herGroggyNow()) return { emotion: 'sleepy', expression: faceForEmotion('sleepy', modelExpressions()) };
      // Her own word for it, when the brain that wrote the line gave one. Same
      // reading as the voice used, no second model call, and no disagreement.
      const said = deliveredMoods.get((text ?? '').trim());
      if (said) {
        const expression = faceForEmotion(said, modelExpressions());
        console.log(`[web] face for that: ${said}${expression ? ` (${expression})` : ' — no face for it'} — as she wrote it`);
        return { emotion: said, expression };
      }
      try {
        const started = Date.now();
        const felt = await classifyEmotion(text, config);
        if (!felt) return { emotion: null, expression: null };
        const expression = faceForEmotion(felt.emotion, modelExpressions());
        console.log(`[web] face for that: ${felt.emotion}${expression ? ` (${expression})` : ' — no face for it'} in ${Date.now() - started}ms`);
        return { emotion: felt.emotion, expression };
      } catch (error) {
        // A face is worth less than an answer: if the classifier fails she still
        // speaks, she just keeps the face she had.
        console.warn('[web] could not read her expression:', error instanceof Error ? error.message : error);
        return { emotion: null, expression: null };
      }
    },
    // Sent as a bare date plus a day-offset rather than one formatted string —
    // the phone buckets into daily/weekly/monthly by daysAway, and doing that
    // date math against the phone's own clock would disagree with her whenever
    // it is in a different timezone. Computed once here, against the timezone
    // she actually keeps.
    agenda: () => {
      const todayKey = localDateKey(zonedNow(CHAT_TIMEZONE));
      const timeRank = (time?: string) => {
        const parsed = time ? parseTimeOfDay(time) : null;
        return parsed ? parsed.hour * 60 + parsed.minute : -1;
      };
      return getKept()
        .map(item => ({
          id: item.id,
          title: item.title,
          date: item.date,
          time: item.time ?? null,
          kind: item.kind,
          done: item.done,
          daysAway: Math.round((Date.parse(`${item.date}T00:00:00Z`) - Date.parse(`${todayKey}T00:00:00Z`)) / 86400000),
        }))
        .sort((a, b) => a.date.localeCompare(b.date) || timeRank(a.time ?? undefined) - timeRank(b.time ?? undefined));
    },
    tickOff(id) {
      const updated = toggleKept(id);
      if (updated?.done) void remarkOnTickOff(updated);
    },
    addAgenda(title, date, time) {
      // "9:00 AM" as she writes it, or "09:00" as a phone does; anything else
      // is refused rather than saved wrong.
      const parsed = time ? parseTimeOfDay(time) : null;
      if (time && !parsed) return null;
      const item = addKeptItem({ title, date, ...(parsed ? { time: formatTimeOfDay(parsed.hour, parsed.minute) } : {}), kind: 'task' });
      console.log(`[agenda] the phone wrote one down: "${item.title}" on ${item.date}${item.time ? ` at ${item.time}` : ''}`);
      return { id: item.id, title: item.title, date: item.date, ...(item.time ? { time: item.time } : {}) };
    },
    checkIns: () => checkInsOn(getCheckIns(), localDateKey(zonedNow(CHAT_TIMEZONE))),
    addCheckIn(note, anxiety) {
      const now = zonedNow(CHAT_TIMEZONE);
      setCheckIns(addCheckIn(getCheckIns(), note, anxiety, new Date(), localDateKey(now)));
      console.log(`[web] check-in noted${typeof anxiety === 'number' ? ` (anxiety ${anxiety}/10)` : ''}`);
      return checkInsOn(getCheckIns(), localDateKey(now));
    },
    nudge: () => nudgeForPhone(),
    google: {
      status: () => googleStatus(store),
      // The consent page, for signing in from a laptop that forwards the
      // loopback port over ssh. One at a time: a second ask while one is
      // waiting gets the same page back.
      connect: () => {
        if (pendingGoogleConsent) return pendingGoogleConsent;
        pendingGoogleConsent = new Promise<{ url: string; port: number }>((resolve, reject) => {
          void connectGoogle(store, { port: GOOGLE_CONSENT_PORT, timeoutMs: 15 * 60_000, onUrl: (url, port) => resolve({ url, port }) })
            .then(() => { broadcastGoogleStatus(); console.log('[google] reconnected through the web door'); })
            .catch(error => { console.warn(`[google] the sign-in did not complete: ${error instanceof Error ? error.message : error}`); reject(error); })
            .finally(() => { pendingGoogleConsent = null; });
        });
        return pendingGoogleConsent;
      },
    },
    revoice: {
      run: () => runRevoice('asked from the web door'),
      status: () => { const state = revoiceState(); return { lastAt: state.lastAt, kept: Object.keys(state.rewrites).length, since: messagesSinceRevoice(), every: revoiceSetting().every, model: revoiceSetting().model }; },
    },
    where: {
      get: () => whereForPage(getWhereabouts()),
      enable(on) {
        const state = getWhereabouts();
        if (state.enabled === on) return;
        // Switching off forgets the last fix as well as the switch: off means
        // she stops knowing, not that she stops being told.
        saveWhereabouts({ ...state, enabled: on, last: on ? state.last : null });
        console.log(`[where] the phone ${on ? 'now says' : 'no longer says'} where it is`);
      },
      report(body) {
        const spot = readSpot(body);
        if (!spot) return false;
        const state = getWhereabouts();
        if (!state.enabled) return false;
        const before = state.last ? placeAt(state.places, state.last)?.name ?? null : null;
        const after = placeAt(state.places, spot)?.name ?? null;
        saveWhereabouts(absorb(state, spot));
        // Logged on arriving somewhere, not on every fix: a phone at rest still
        // reports every few minutes and that is nobody's news.
        if (before !== after || !state.last) console.log(`[where] the phone is ${after ? `at ${after}` : 'somewhere unnamed'} (±${spot.accuracy}m, ${spot.net})`);
        if (after && after !== before && state.last) noteArrival(after);
        return true;
      },
      name(name) {
        const state = getWhereabouts();
        if (!state.last) return false;
        saveWhereabouts(namePlace(state, name));
        console.log(`[where] the phone's spot is now called "${name}"`);
        return true;
      },
      forget(name) { saveWhereabouts(forgetPlace(getWhereabouts(), name)); },
      async lookUp() {
        const state = getWhereabouts();
        if (!state.enabled || !state.last) throw new Error('The phone has not said where it is yet.');
        // The same blurred, once-when-asked lookup the desktop's search place
        // uses (location.ts): a name for this spot, from OpenStreetMap, and no
        // record of it here beyond what they choose to call it.
        return lookUpPlace({ latitude: state.last.lat, longitude: state.last.lon, accuracy: state.last.accuracy }, (url, init) => fetch(url, init));
      },
    },
    push: {
      subscribeApns: (token, name, sandbox, deviceId) => {
        // The same token again, or a new token from the same sign-in (a
        // reinstall), replaces what that phone had; two tokens both named
        // "iPhone" were each taking every push (2026-09-06).
        const devices = withoutDevice(getApns().devices.filter(d => d.token !== token), deviceId);
        devices.push({ token, name, at: new Date().toISOString(), sandbox, ...(deviceId ? { deviceId } : {}) });
        saveApnsDevices(devices);
        console.log(`[push] "${name}" registered with Apple${sandbox ? ' (sandbox)' : ''} — ${devices.length} device(s)`);
        const covered = coveredByNativeApp(getPush().devices, true);
        if (covered.length) {
          savePush({ devices: getPush().devices.filter(device => !covered.includes(device)) });
          console.log(`[push] the app covers this phone — ${covered.length} web-app subscription(s) let go`);
        }
      },
      unsubscribeApns: token => saveApnsDevices(getApns().devices.filter(d => d.token !== token)),
      apnsReady: () => Boolean(getApns().config),
      key: () => vapidKeys().publicKey,
      subscribe(device, name, deviceId) {
        if (getApns().devices.length && isPhoneWebApp(name)) {
          console.log(`[push] the app covers this phone — the web app's subscription is not kept`);
          return;
        }
        const { devices } = getPush();
        const rest = withoutDevice(devices.filter(d => d.endpoint !== device.endpoint), deviceId);
        savePush({ devices: [{ ...device, name, added: new Date().toISOString(), ...(deviceId ? { deviceId } : {}) }, ...rest] });
        // Logged only when it is new — the page re-posts its subscription on
        // every load to revive a pruned one, and that should stay silent.
        if (rest.length === devices.length) console.log(`[push] "${name}" subscribed (${rest.length + 1} in all)`);
      },
      unsubscribe(endpoint) {
        savePush({ devices: getPush().devices.filter(d => d.endpoint !== endpoint) });
        console.log('[push] a phone unsubscribed');
      },
      prefs: () => getPush().prefs,
      savePrefs(prefs) { savePush({ prefs }); },
      test: () => pushToPhone('events', 'She can reach this phone.', '/', true),
    },
    attach: {
      // The same staging a desktop paste gets — copied into her keeping, no
      // model called. Refusals mirror stageAll's: an unopenable kind is said
      // now, while the file is still in front of them, and sound or video is
      // refused outright on a machine with no ffmpeg to pull it apart.
      stage(name, bytes) {
        const kind = classify(name);
        if ((kind === 'audio' || kind === 'video') && !findFfmpeg()) {
          throw new Error(`${name} needs ffmpeg, which is not installed on her machine.`);
        }
        const staged = stageBytes(name, bytes);
        console.log(`[web] staged ${staged.name} (${staged.kind}, ${(staged.bytes / 1024).toFixed(0)}KB)`);
        return staged;
      },
      discard(attachment) { discardStaged((attachment ?? {}) as { saved?: string }); },
    },
    body: {
      get: () => bodyForPage(getBody()),
      enable(on) {
        const state = getBody();
        if (state.enabled === on) return;
        // Off forgets the last figures too: off means she stops knowing.
        saveBody({ enabled: on, last: on ? state.last : null });
        console.log(`[body] the phone ${on ? 'now says' : 'no longer says'} how they slept`);
      },
      report(body) {
        const state = getBody();
        if (!state.enabled) return false;
        const report = readBodyReport(body);
        if (!report) return false;
        saveBody({ ...state, last: report });
        const bits = [report.sleepMinutes !== null ? `${report.sleepMinutes} min asleep` : '', report.steps !== null ? `${report.steps} steps` : ''].filter(Boolean).join(', ');
        if (!state.last || state.last.day !== report.day || state.last.sleepMinutes !== report.sleepMinutes) console.log(`[body] ${report.day}: ${bits}`);
        return true;
      },
    },
    portrait: () => {
      // The app icon doubles as her face on the phone. Read each time rather than
      // held: it is 1.5MB, wanted about once a day, and the browser caches it.
      const picture = path.join(app.getAppPath(), 'build', 'icon.png');
      try { return existsSync(picture) ? readFileSync(picture) : null; } catch { return null; }
    },
    model: () => {
      const saved = (store.get('live2d.model') as { path?: string } | undefined);
      if (!saved?.path || !existsSync(saved.path)) return null;
      // The folder the entry file sits in is the model's world: every texture and
      // motion it references is relative to that, so it is the only folder the
      // web route is ever allowed to reach into.
      return { root: path.dirname(saved.path), entry: saved.path };
    },
    // The same record the desktop reads. Her arms were placed once, in the
    // wardrobe, and there is no reason a phone should be a second place to do
    // it — or a second answer about where they are.
    pose: () => getWardrobeValues(),
    libFolder: () => {
      const folder = [path.join(app.getAppPath(), 'build', 'lib'), path.join(process.resourcesPath ?? '', 'build', 'lib')].find(existsSync);
      return folder ?? null;
    },
    // The supplied Haru emotion SVGs, beside the Live2D libs and shipped the
    // same way. Nothing is drawn or fallen back to: a face whose file is
    // missing is a 404, and the page shows nothing for it.
    emotionsFolder: () => {
      const folder = [path.join(app.getAppPath(), 'build', 'emotions'), path.join(process.resourcesPath ?? '', 'build', 'emotions')].find(existsSync);
      return folder ?? null;
    },
    // The phone's "she woke up" word. Not before they are — it put "You're awake,
    // so you've probably done nothing but stare at the ceiling" into the
    // conversation at five in the morning — and not more than once in a while.
    wake: () => {
      const last = Number(store.get('wake.lastAckAt') ?? 0) || 0;
      if (!theyAreUpNow() || Date.now() - last < WAKE_ACK_GAP_MS) return { line: '', emotion: 'neutral' as const };
      store.set('wake.lastAckAt', Date.now());
      return wakeAck();
    },
    quiet: () => isMuted(getMute(), Date.now()),
    attachedFile(saved) {
      const folder = path.resolve(photoFolder());
      const target = path.resolve(folder, path.basename(String(saved ?? '')));
      if (!target.startsWith(folder + path.sep) || classify(target) !== 'image') return null;
      const mime = ({ '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp', '.heic': 'image/heic' } as Record<string, string>)[path.extname(target).toLowerCase()];
      if (!mime) return null;
      try { return { bytes: new Uint8Array(readFileSync(target)), mime }; } catch { return null; }
    },
    async sigh(emotion) {
      const voice = readVoiceConfig(store.get('voice'));
      if (voice.engine === 'off' || !voice.webEnabled) return null;
      const file = pickBreath(voice.sighs, emotion);
      if (!file) return null;
      console.log(`[voice] a breath for ${emotion ?? 'no mood'}: ${path.basename(file)}`);
      try { return { audio: new Uint8Array(readFileSync(file)), mime: 'audio/wav' }; }
      catch (error) { console.warn(`[voice] the sigh could not be read: ${error instanceof Error ? error.message : error}`); return null; }
    },
    async speak(text, emotion) {
      // The same voice, the same reference clip, the same server the desktop
      // speaks through. Nothing about her sounds different for being far away.
      const voice = readVoiceConfig(store.get('voice'));
      // The desktop keeps the full TTS path. The web door can be told to go
      // silent — voice.webEnabled off — and hand the phone canned voice lines
      // instead, so a reply is not held hostage to an 8-17s synthesis round trip.
      if (voice.engine === 'off' || voice.engine === 'windows' || !voice.webEnabled) return null;
      // The clip for the mood the line was said in, as the desktop chooses it —
      // and her angry clip for a line she is shouting, which is where the volume
      // actually comes from. A mood she has no clip for is her usual voice.
      // The phone sends the mood the page read from the line; when it sends
      // none (or one she has not got), the line is read here instead of falling
      // flat to neutral — localEmotion, no model call.
      const felt: EmotionName = herGroggyNow() ? 'sleepy' : emotion && (EMOTIONS as readonly string[]).includes(emotion) ? emotion as EmotionName : localEmotion(text);
      const reference = referenceFor(voice, felt);
      const chosen = hasShout(text) ? shoutReference(voice, reference) : reference;
      // Narrowed the same way referenceFor does: a string from the phone that is
      // not one of her emotions means her usual voice.
      const mood = felt;
      try {
        // Logged here as the desk path logs it: with desk speech off, nothing
        // said which clip the phone had spoken a line with, and "she sounds
        // high-pitched" could not be traced to the reference that caused it.
        console.log(`[voice] the phone speaks as ${mood} using ${path.basename(chosen.clip)}`);
        const say = spokenCase(speakableText(text));
        const clip = await synthesise(say, voice, chosen, voiceAuth(voice), mood);
        // Ended early — see looksClipped. One more go; the sampling that cut it
        // is the same sampling that will not, next time.
        if (clip && looksClipped(clip.audio, say)) {
          console.warn('[voice] that came back cut short — saying it again');
          const again = await synthesise(say, voice, chosen, voiceAuth(voice), mood);
          if (again && !looksClipped(again.audio, say)) return again;
          if (again && again.audio.length > clip.audio.length) return again;
        }
        return clip;
      } catch (error) {
        // A mood clip the server will not take — four of hers ran over the
        // 3-10 second limit — costs the mood, not the line: her usual voice.
        const why = error instanceof Error ? error.message : String(error);
        if (chosen.clip !== voice.voice && /3-10 second|reference audio/i.test(why)) {
          console.warn(`[voice] the clip for "${emotion}" was refused (${chosen.clip.split('/').pop()}) — speaking in her usual voice instead`);
          return synthesise(spokenCase(speakableText(text)), voice, referenceFor(voice), voiceAuth(voice), null);
        }
        throw error;
      }
    },
    // The streaming half of the voice door: Hume generates MP3 progressively,
    // so the phone's <audio> element starts on the first bytes instead of
    // waiting for the whole clip. Any other engine returns null and the page
    // falls back to the buffered clip.
    async speakStream(text, emotion, options) {
      const voice = readVoiceConfig(store.get('voice'));
      if (!voice.webEnabled) return null;
      // Breeze streams its own PCM; wrapped in a WAV here so the phone can play
      // it progressively. Same clone + instruction as the buffered path.
      if (voice.engine === 'breeze') {
        const mood: EmotionName = herGroggyNow() ? 'sleepy' : emotion && (EMOTIONS as readonly string[]).includes(emotion) ? emotion as EmotionName : localEmotion(text);
        // A sentence that is all emoji or marks has nothing to say aloud;
        // Breeze answered it with 400 "text is required" (2026-09-18).
        const spoken = spokenCase(speakableText(text));
        if (!spoken.trim()) return null;
        return synthesiseBreezeStream(voice, referenceFor(voice, mood), spoken, mood, options?.seed);
      }
      if (voice.engine !== 'hume') return null;
      const key = getHumeKey();
      if (!key || !voice.voice) return null;
      const mood = emotion && (EMOTIONS as readonly string[]).includes(emotion) ? emotion as EmotionName : null;
      const directions = [mood ? HUME_DESCRIPTIONS[mood] : '', hasShout(text) ? 'loud, shouting' : ''].filter(Boolean).join(', ');
      try {
        const response = await net.fetch(HUME_STREAM_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Hume-Api-Key': key },
          body: JSON.stringify({
            // The same pace as the desk path: the phone was speaking at 1.0
            // while voice.speed said 0.9.
            utterances: [{ text, voice: { id: voice.voice }, ...(directions ? { description: directions } : {}), ...(voice.speed !== 1 ? { speed: voice.speed } : {}) }],
            format: { type: 'mp3' },
            instant_mode: true,
          }),
        });
        if (!response.ok || !response.body) return null;
        return { mime: 'audio/mpeg', body: response.body };
      } catch {
        return null;
      }
    },
    corrections: () => readHearing(store.get('hearing')).corrections,
    teach: (heard, meant) => {
      const after = remember(readHearing(store.get('hearing')), heard, meant, new Date().toISOString());
      store.set('hearing', after);
      // The pair, not the sentence: what she took from it is what will fire next time.
      const pair = narrow(heard, meant);
      console.log(pair ? `[listen] taught from the phone: "${pair.heard}" -> "${pair.meant}"` : `[listen] nothing to learn from "${heard.slice(0, 40)}" against "${meant.slice(0, 40)}"`);
      return { learned: pair, count: after.corrections.length };
    },
    forgetCorrection: heard => {
      const kept = { corrections: readHearing(store.get('hearing')).corrections.filter(c => c.heard !== heard) };
      store.set('hearing', kept);
      return kept.corrections;
    },
    async keepVoiceTake(wav) {
      const dir = path.join(app.getPath('userData'), 'voice-takes');
      mkdirSync(dir, { recursive: true });
      const name = `${new Date().toISOString().replace(/[:.]/g, '-')}.wav`;
      writeFileSync(path.join(dir, name), wav);
      console.log(`[voice] kept a take of his voice: ${name} (${wav.length} bytes)`);
      return name;
    },
    async hear(audio, mime) {
      const listen = readListenConfig(store.get('listen'));
      const vocabulary = wordsToListenFor();
      const said = await transcribe(audio, mime, listen, net.fetch as never, remoteAuth(listen.endpoint), vocabulary);
      // Hear him too, off the reply path: the same audio, for how he sounded.
      // The reading lands on the next turn, the way an aside does — she reacts
      // to his voice, not just his words.
      const humeKey = getHumeKey();
      if (readHumeConfig(store.get('hume')).expressionsEnabled && humeKey) {
        void hearVoice(audio, mime, humeKey, net.fetch as never)
          .then(prosody => {
            if (!prosody) return;
            const reading = readingFrom(prosody);
            if (reading.rough) {
              store.set('hume.reading', { ...reading, at: new Date().toISOString() });
              console.log(`[hume] heard him — ${reading.why}`);
            }
          })
          .catch(error => console.warn('[hume] could not read his voice:', error instanceof Error ? error.message : error));
      }
      if (looksLikeNothing(said, vocabulary)) return '';
      // Through the same corrections she has been taught at the desk. A name she
      // keeps mishearing is misheard the same way down a phone.
      const heard = readHearing(store.get('hearing'));
      const fixed = correct(heard, said);
      if (fixed.applied.length) store.set('hearing', noteUsed(heard, fixed.applied));
      return fixed.text;
    },
    memories: () => getMemories().map(memory => memory.text),
    // Assembled from the four places her state actually lives — the drifting
    // vitals, the conversation's patience, the evening grudge, and the list —
    // because none of them agree on a shape and the page should not have to
    // know that. The arithmetic is in standing.ts, which is pure and tested.
    diary: () => recentEntries(app.getPath('home'), 60).reverse(),
    her: () => herFrom({ interests: getInterests(), nights: getNights(), diary: recentEntries(app.getPath('home'), 365) }),
    standing: currentStanding,
    memoryRecords: () => getMemories(),
    activityLog: () => store.getActivityLog(),
    shots: {
      held: () => heldShots(shotStoreRoot()),
      keep: (day, name, bytes) => {
        const written = keepShot(shotStoreRoot(), day, name, bytes);
        console.log(`[activity] kept ${path.basename(written)} (${(bytes.length / 1024 | 0)}KB) from the desk`);
      },
    },
    mergeActivity(theirs) {
      const before = store.getActivityLog();
      const merged = mergeActivity(before, theirs);
      store.setActivityLog(merged);
      const days = Object.keys(merged).length;
      const entries = Object.values(merged).reduce((total, list) => total + list.length, 0);
      console.log(`[activity] the desk sent ${days} day(s), ${entries} entr(ies) held`);
      return { days, entries };
    },
    mergeMemories(theirs) {
      const report = mergeIn(theirs);
      const what = describeMerge(report);
      if (what) console.log('[memory] from the desk: ' + what);
      return { added: report.added, updated: report.updated };
    },
    journal: () => getJournal().map(entry => ({ date: entry.date, text: entry.text, mood: entry.mood, anxiety: entry.anxiety })),
    writeJournal(entry) {
      setJournal(upsertEntry(getJournal(), {
        date: localDateKey(zonedNow(CHAT_TIMEZONE)),
        text: entry.text,
        mood: readRating(entry.mood),
        anxiety: readRating(entry.anxiety),
        // She did not ask for this one — it was written from a phone, unbidden.
        prompted: false,
      }));
    },
    knowledge: {
      async search(query, category) {
        const embedder = getKnowledgeEmbedder();
        const config = getKnowledgeConfig();
        const cat = coerceKnowledgeCategory(category);
        const started = Date.now();
        const result = await retrieveContext({
          knowledge: knowledge.current(),
          embed: text => embedder ? embedder.embed(text) : Promise.reject(new Error('no model is set up')),
          query,
          now: new Date(),
          limit: config.contextChunks,
          threshold: config.threshold,
          filters: cat ? { category: cat } : undefined,
        });
        console.log(`[knowledge] web search "${query.slice(0, 60)}" -> ${result.knowledge.length} chunk(s) in ${Date.now() - started}ms`);
        return {
          results: result.knowledge.map(item => ({
            content: item.chunk.content,
            source: item.chunk.source,
            category: item.chunk.category,
            heading: item.chunk.heading ?? null,
            version: item.chunk.version,
            confidence: item.chunk.confidence,
            updatedAt: item.chunk.updatedAt,
            score: Math.round(item.score * 1000) / 1000,
          })),
        };
      },
      stats: () => knowledgeStats(knowledge.current()),
      async ingest(file, category) {
        const result = await enqueueKnowledge(() => ingestKnowledgeFile(file, coerceKnowledgeCategory(category)));
        return {
          queued: false,
          source: result.outcome.document.source,
          sourceType: result.outcome.document.sourceType,
          category: result.outcome.document.category,
          action: result.outcome.action,
          chunks: result.outcome.chunks.length,
        };
      },
      async deleteDocument(source) {
        return knowledge.removeSource(source);
      },
      async reindex(source) {
        const reindexed = await reindexKnowledge(source || undefined);
        return { reindexed };
      },
      async vault(vaultPath) {
        const resolved = path.resolve(vaultPath);
        saveVaultConfig(resolved);
        const report = await enqueueKnowledge(() => syncVault(resolved));
        return report;
      },
    },
  };
  // Speech to speech: a call through Hume's EVI, her words from the same place
  // the phone's typed messages go. See evi.ts for the shape; the mic button on
  // the phone is the only thing that opens one.
  // Her sleep, for the phone's standby: asleep now, and when she wakes, so the
  // phone can stop listening for her name and start again on its own.
  const sleepForPhone = () => {
    const asleep = herAsleepNow();
    const wakeAt = asleep ? herWakeAt() : null;
    return { asleep, wakesAt: wakeAt ? new Date(wakeAt).toISOString() : null };
  };
  deps.evi = {
    status() {
      const engine = readCallConfig(store.get('call')).engine;
      const evi = readEviConfig(store.get('evi'));
      const today = chatDayKey();
      const minutesToday = Math.round(secondsUsedToday(store.get('evi.usage'), today) / 60);
      if (engine === 'local') {
        const voice = readVoiceConfig(store.get('voice'));
        const reason = readListenConfig(store.get('listen')).engine === 'off' ? 'not set up'
          : !voice.webEnabled || voice.engine === 'off' ? 'not set up'
          : herAsleepNow() ? 'asleep'
          : undefined;
        return { enabled: !reason, engine, minutesToday, cap: 0, ...(reason ? { reason } : {}), ...sleepForPhone() };
      }
      const reason = !evi.enabled || !evi.configId ? 'off'
        : !getHumeKey() || !getEviSecret() ? 'not set up'
        : herAsleepNow() ? 'asleep'
        : !underCap(store.get('evi.usage'), today, evi.dailyMinutesCap) ? 'cap'
        : undefined;
      return { enabled: !reason, engine, minutesToday, cap: evi.dailyMinutesCap, ...(reason ? { reason } : {}), ...sleepForPhone() };
    },
    secret: getEviSecret,
    async open(deviceId, handlers) {
      const call = readCallConfig(store.get('call'));
      if (call.engine === 'local') {
        // Her own ears, brain and voice, streamed a sentence at a time (localcall.ts).
        if (readListenConfig(store.get('listen')).engine === 'off') throw new Error('Her ears are switched off.');
        const voice = readVoiceConfig(store.get('voice'));
        if (!voice.webEnabled || voice.engine === 'off') throw new Error('She has no voice for a call.');
        if (herAsleepNow()) throw new Error('She is asleep.');
        let lastFiller = '';
        console.log(`[call] placed at home, ${call.endAfterMs} ms of quiet ends a turn`);
        const local = openLocalCall({
          onEvent: handlers.onEvent,
          onAudio: handlers.onAudio,
          onClose: (reason, seconds) => { console.log(`[call] ended after ${seconds}s — ${reason}`); handlers.onClose(reason); },
        }, {
          hear: wav => deps.hear(wav, 'audio/wav'),
          answer: (text, { interrupted, onSentence, onToolCall }) => deps.sayStream(text, () => {}, [], { interrupted, call: true, onToolCall }, onSentence),
          // Her mood as the standing tab reads it — no model call — for a reply
          // whose first sentence names no register of its own. Only the moods
          // that change how she sounds pass through; the warm ones would have
          // a sarcastic line said fondly, and her plain register is dry.
          moodNow: () => {
            if (herGroggyNow()) return 'sleepy';
            const resting = deps.standing().emotion;
            return resting === 'annoyed' || resting === 'sleepy' || resting === 'worried' || resting === 'bored' ? resting : 'neutral';
          },
          speak: async (text, emotion, seed) => {
            // Streamed where the engine streams (Breeze: 24 kHz PCM under a
            // WAV header), whole where it does not, at whatever rate it says.
            const streamed = await deps.speakStream?.(text, emotion, { seed });
            if (streamed?.mime === 'audio/wav') return { stream: withoutWavHeader(streamed.body), sampleRate: 24000 };
            if (streamed) void streamed.body.cancel().catch(() => {});
            const clip = await deps.speak(text, emotion);
            if (!clip) return null;
            const rate = wavSampleRate(clip.audio);
            return rate ? { stream: oneChunk(clip.audio.subarray(44)), sampleRate: rate } : null;
          },
          filler: () => { lastFiller = pickFiller(Math.random(), lastFiller); return lastFiller; },
          // The desk owns the conversation: it is told what she actually got
          // out, and rewrites her last line to that — or drops it when none did.
          said: (reply, said) => sendToWindows('chat:saidFromPhone', { reply, said: thinksAloud(said) ? '' : said }),
          vad: { endAfterMs: call.endAfterMs },
          log: line => console.log(line),
        });
        return { sendAudio: frame => local.feed(frame), close: reason => local.close(reason), herSpeaking: on => local.herSpeaking(on) };
      }
      const evi = readEviConfig(store.get('evi'));
      if (!evi.enabled || !evi.configId) throw new Error('Speech to speech is switched off.');
      const apiKey = getHumeKey();
      const secret = getEviSecret();
      if (!apiKey || !secret) throw new Error('Speech to speech is not set up: no Hume key or no hook secret.');
      if (herAsleepNow()) throw new Error('She is asleep.');
      const today = chatDayKey();
      if (!underCap(store.get('evi.usage'), today, evi.dailyMinutesCap)) throw new Error(`That is enough for today — ${evi.dailyMinutesCap} minutes of calls is the cap.`);
      const sessionId = newSessionId(deviceId, randomUUID().replace(/-/g, '').slice(0, 12));
      const state = { deviceId, interrupted: false, startedAt: Date.now() };
      eviSessions.set(sessionId, state);
      console.log(`[evi] call ${sessionId} placed`);
      return openEviSession({
        apiKey, configId: evi.configId, sessionId, secret,
        onEvent: event => {
          if (event.type === 'user_interruption') state.interrupted = true;
          handlers.onEvent(event);
        },
        onClose: (reason, seconds) => {
          eviSessions.delete(sessionId);
          store.set('evi.usage', noteUsage(store.get('evi.usage'), chatDayKey(), seconds));
          console.log(`[evi] call ${sessionId} ended after ${seconds}s — ${reason}`);
          handlers.onClose(reason);
        },
      });
    },
    async turn(sessionId, text, prosody, onChunk) {
      const state = eviSessions.get(sessionId);
      if (!state) return null;
      // Through the same corrections as the phone's ear: a name she keeps
      // mishearing is misheard the same way on a call.
      const heard = readHearing(store.get('hearing'));
      const fixed = correct(heard, text);
      if (fixed.applied.length) store.set('hearing', noteUsed(heard, fixed.applied));
      // How he sounded, from the same clip he was heard in — on this turn, not
      // the next: the reading is written before the brain runs, and
      // takeVoiceRoom reads it into the room she is about to answer in.
      if (prosody) {
        const reading = readingFrom(prosody);
        if (reading.rough) {
          store.set('hume.reading', { ...reading, at: new Date().toISOString() });
          console.log(`[evi] heard him — ${reading.why}`);
        }
      }
      const interrupted = state.interrupted;
      state.interrupted = false;
      console.log(`[evi] ${sessionId} heard "${fixed.text.slice(0, 60)}"${interrupted ? ' — over her' : ''}`);
      return deps.sayStream(fixed.text, onChunk, [], { interrupted, call: true }, () => {});
    },
  };
  return deps;
}

/** Why the door is shut, in words, for the panel that has to explain it. */
let webTrouble = '';

/**
 * How often a thumb gets a line back. Every thumb answered was a tell —
 * press, get a gloat, press, get a retort, like a vending machine — and it
 * made rating a reply feel like starting a conversation. Half the time she
 * takes it and says nothing, which is what a person does with a thumb.
 */
const COMEBACK_ODDS = 0.5;

/**
 * A thumb, taken: the quiet period starts, her mood moves, her face lands.
 * Shared by the desk and the phone, so a rating means the same thing from
 * either — the mood engine has no idea which one it was. `comeback` is the
 * coin for whether she answers it out loud, tossed here so both sides toss
 * the same one.
 */
function takeThumb(reaction: 'up' | 'down'): { mood: Mood; comeback: boolean } {
  // A thumb is them addressing her, so it starts the quiet period the same way
  // a message does. This is the one the screenshot caught: thumbs up, and a
  // remark about something else arrives on top of her own reply.
  noteUserSpoke();
  const mood = getMood();
  const event = reaction === 'down' ? 'disliked' : 'liked';
  // Approval both settles her and swells her head; disapproval does the
  // reverse on both counts.
  const next = { ...mood, irritation: nextIrritation(mood.irritation, event, Math.random(), mood.ego), ego: nextEgo(mood.ego, event) };
  setMood(next);
  nudgeVitals(reaction === 'down' ? 'criticised' : 'praised');
  feelNow(reaction === 'down' ? 'disliked' : 'liked');
  if (reaction === 'down') tallyMonth('hurt');
  // Sent straight out rather than waiting on a classification: the reaction
  // already says exactly how she should take it, and the face should land with
  // the click rather than a second later.
  if (reaction === 'down') {
    broadcastBeat({ emotion: 'annoyed', confidence: 0.95, energy: 0.45, intent: 'dismiss', focus: 'user' }, 'stare');
  } else {
    lastPraiseWasSmug = !lastPraiseWasSmug;
    broadcastBeat(
      lastPraiseWasSmug
        ? { emotion: 'smug', confidence: 0.95, energy: 0.65, intent: 'tease', focus: 'user' }
        : { emotion: 'happy', confidence: 0.95, energy: 0.8, intent: 'celebrate', focus: 'user' },
      'nod',
    );
  }
  return { mood: next, comeback: Math.random() < sway('comeback', COMEBACK_ODDS, swayNow()) };
}

/** Where the ratings go: beside config.json, but a file of its own — appended to, never rewritten. */
function feedbackFile(): string {
  return path.join(app.getPath('userData'), 'feedback.jsonl');
}

/**
 * One rating written down for later, from whichever side it came. Never
 * throws: a full disk must not cost them the thumb.
 */
function appendFeedback(about: { id: string; reaction?: 'up' | 'down' | null; note?: unknown; source: 'phone' | 'desktop' }): void {
  const history = (store.get('chat.messages') as { id?: string; role: string; content?: string; reaction?: string }[] | undefined) ?? [];
  const entry = feedbackEntry(history, { ...about, model: (store.get('ai.config') as ProviderConfig | undefined)?.model ?? '', at: new Date().toISOString() });
  if (!entry) return;
  try { recordFeedback(feedbackFile(), entry); } catch (error) { console.warn('[feedback] could not write it down:', error instanceof Error ? error.message : error); }
}

async function startWebDoor() {
  const access = getWebAccess();
  if (!access.enabled || !access.hash) return;
  if (webServer) return;
  try {
    webServer = await startWebServer(DEFAULT_WEB_PORT, webDeps());
    webTrouble = '';
    const evi = readEviConfig(store.get('evi'));
    if (evi.enabled) console.log(`[evi] ready — config ${evi.configId || '(none)'}, hook at ${evi.publicUrl || '(unset)'}, cap ${evi.dailyMinutesCap} min/day${getHumeKey() && getEviSecret() ? '' : ' — but no Hume key or hook secret'}`);
    // Started once and left running: each tick re-checks the door and the
    // subscriptions itself, so closing the door silences it with no bookkeeping.
    if (!pushPesterTimer) scheduleNextPush(true);
    startProactive();
    startChasing();
  } catch (error) {
    const why = error instanceof Error ? error.message : String(error);
    // "Check the log" was useless advice twice over: there was no log, and the
    // real answer was one word. A previous Haru had crashed on the way out and
    // never exited, so it still held this port — which the panel then reported
    // as a mysterious failure of the thing the user had just switched on.
    webTrouble = /EADDRINUSE/i.test(why)
      ? `Port ${DEFAULT_WEB_PORT} is already taken — most likely another copy of Haru is still running.`
      : why;
    console.warn('[web] could not open the door:', why);
  }
}

async function stopWebDoor() {
  const running = webServer;
  webServer = null;
  if (running) { await running.stop(); console.log('[web] closed'); }
}

// Told to Windows before any window exists, and in every build rather than only
// packaged ones. Without it the taskbar files her under electron.exe: the same
// group as any other Electron app running, the wrong name on hover, and a pinned
// shortcut that does not recognise the window it opened as its own.
if (process.platform === 'win32') app.setAppUserModelId('com.haru.desktop');

/**
 * The packaged app, keeping itself current.
 *
 * Loaded here rather than at the top of the file because electron-updater reads
 * app-update.yml as it initialises, and that file only exists inside a packaged
 * build — importing it unconditionally makes `npm run dev` noisy about a file
 * that is correctly absent.
 *
 * Everything is reported and nothing is imposed: it downloads on its own and
 * installs on the next quit, which is a moment the user picked. quitAndInstall
 * is never called from here.
 */
let updateState: UpdateState = { stage: 'idle' };
let downloadedPercent = -1;

function currentUpdateState(): UpdateState {
  return updateState;
}

function watchForUpdates() {
  const refusal = whyNotCheck(app.isPackaged, process.platform);
  if (refusal) {
    console.log(`[update] not checking — ${refusal}`);
    return;
  }
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { autoUpdater } = require('electron-updater') as typeof import('electron-updater');
  // The sentence is written here rather than in the window, the same way the
  // fallback notices are: main is what knows why, and a renderer reassembling a
  // reason out of an enum is a second place for the wording to drift.
  const say = (next: UpdateState) => {
    updateState = next;
    sendToWindows('update:state', { state: next, version: app.getVersion(), says: describeUpdate(next, app.getVersion()) });
  };

  autoUpdater.autoDownload = true;
  // The whole promise of the thing: she is closed and reopened constantly, so
  // the swap costs nobody anything if it waits for that.
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.logger = null;

  autoUpdater.on('checking-for-update', () => say({ stage: 'checking' }));
  autoUpdater.on('update-not-available', () => { console.log('[update] already current'); say({ stage: 'current' }); });
  autoUpdater.on('update-available', info => {
    console.log(`[update] ${info.version} is available — downloading`);
    downloadedPercent = -1;
    say({ stage: 'downloading', version: info.version, percent: 0 });
  });
  autoUpdater.on('download-progress', progress => {
    const step = progressStep(downloadedPercent, progress.percent);
    if (step === null) return;
    downloadedPercent = step;
    const version = updateState.stage === 'downloading' ? updateState.version : '';
    say({ stage: 'downloading', version, percent: step });
  });
  autoUpdater.on('update-downloaded', info => {
    console.log(`[update] ${info.version} is ready — it will install when she is next closed`);
    say({ stage: 'ready', version: info.version });
  });
  autoUpdater.on('error', error => {
    // Never fatal. A feed that cannot be reached is a machine that stays on the
    // version it already had, which is a working companion.
    const because = (error instanceof Error ? error.message : String(error)).split('\n')[0].slice(0, 160);
    console.warn(`[update] could not check: ${because}`);
    say({ stage: 'failed', because });
  });

  const check = () => { void autoUpdater.checkForUpdates().catch(() => { /* reported through the error event */ }); };
  check();
  setInterval(check, CHECK_EVERY_MS);
}

app.whenReady().then(() => {
  // Node gives up on an address after 250 ms while it tries the next family.
  // Hume, like Apple, is further than that from here, so every connection
  // made through Node's own stack — the call socket, not Chromium's fetch —
  // would time out before it began. apns.ts sets this per connection; a
  // WebSocket has no such option, so the default is raised once here.
  setDefaultAutoSelectFamilyAttemptTimeout(5_000);
  // The money behind her hosted voice, on the hour; the day it ran out, nobody knew.
  setTimeout(() => void checkVeniceBalance('startup'), 2 * 60_000);
  setInterval(() => void checkVeniceBalance('the hour'), 60 * 60_000);
  // Whatever was said to her elsewhere today. Once at startup, then quietly on
  // the hour — often enough that the evening review has it, rare enough that a
  // sleeping server is not being knocked on constantly.
  void pullCheckIns().then(syncMemories);
  setInterval(() => void pullCheckIns().then(syncMemories), 15 * 60_000);

  if (!isPrimaryInstance) return;
  // After the single-instance gate: two copies racing to download the same
  // installer over each other is the one way this could do harm.
  watchForUpdates();

  // Loaded here rather than at the top because app.getPath needs the app ready
  // — but the file itself is a quiet local read, and a store that cannot be
  // read is an empty one, never a crash.
  knowledge.load();
  void refreshMemoryVectors();
  // Whatever was written before sorting existed, or while the model was away,
  // sorted once the start-up rush is over.
  memoryStore.scheduleSort(90_000);
  // The consolidation sweep, decay, archive pruning and haunt hygiene, daily at
  // a time of day (scheduler.ts). They used to run a minute after boot and then
  // every twenty-four hours from it — and with restarts every few hours the
  // interval never fired, so the sweep ran as often as the app was restarted.
  // Missed while down, the day's sweep runs at the next start. The same
  // dispatcher brings her own bookings back to her.
  scheduler.ensureDaily({ id: 'maintenance', kind: 'maintenance', daily: MAINTENANCE_AT, timezone: CHAT_TIMEZONE, staleAfterMs: 20 * 60 * 60_000 });
  // Her Game Boy: one move per tick while a sitting is on (pokemon.ts).
  setInterval(() => { void pokemonTick(); }, readPokemonConfig(store.get('games')).tickSeconds * 1000);
  void recoverPokemonSitting();
  // Level 4: her own hands, looked at every few minutes (herhands.ts).
  setInterval(() => { void herHandsTick(); }, 5 * 60_000);
  setTimeout(() => scheduler.start(), 30_000);
  // Her thoughts between messages (thoughts.ts): triggers looked at every five
  // minutes, the brain asked only when one has fired.
  setInterval(() => { void thoughtTick(); }, THOUGHT_TICK_MS);
  const knowledgeSummary = knowledgeStats(knowledge.current());
  console.log(`[knowledge] loaded ${knowledgeSummary.documents} document(s), ${knowledgeSummary.chunks} chunk(s) from ${knowledgeFile}${knowledgeSummary.embedModels.length ? ` (${knowledgeSummary.embedModels.join(', ')})` : ''}`);
  // A saved vault keeps itself current without being asked: a first check a
  // minute after boot, then hourly. Runs on the knowledge queue, so it never
  // waits on or blocks a conversation.
  setTimeout(() => { void syncVaultAndRetire(); }, 60_000);
  setInterval(() => { void syncVaultAndRetire(); }, 60 * 60_000);
  // And her own folder in it, the other way round.
  loadRecallVectors();
  setTimeout(() => { void refreshRecallVectors(); }, 90_000);
  setInterval(() => { void refreshRecallVectors(); }, 15 * 60_000);
  // Who is who: the finished days not yet read, a day a minute until caught up.
  setInterval(() => { void readGraphTick(); }, GRAPH_TICK_MS);
  setInterval(() => { void formingTick(); }, FORMING_TICK_MS);
  // His page of what the graph believes: written at start, corrections read back hourly with the vault.
  setTimeout(() => syncGraphPage('startup'), 100_000);
  setTimeout(() => publishToVault('startup'), 30_000);
  setInterval(() => publishToVault('tick'), VAULT_PUBLISH_MS);
  // A first pass shortly after boot so a backlog the desk sent overnight is
  // already being worked through by the time anyone asks, then every five
  // minutes. Both are no-ops until vision is switched on and shots exist.
  setTimeout(() => { void lookAtSyncedShots(); }, 90_000);
  setInterval(() => { void lookAtSyncedShots(); }, SHOT_LOOK_TICK_MS);
  // The system sampler. Lightweight and self-contained, so a slow sample can
  // never hold up a conversation; events it fires go through interject, the
  // same channel her other unprompted lines use.
  const systemEvents = readSystemEvents();
  console.log(`[system] sampler armed (every ${systemEvents.sampleSeconds}s, level ${readSystemConfig().level})`);
  setTimeout(() => { void sampleSystem(); }, 10_000);
  setInterval(() => { void sampleSystem(); }, systemEvents.sampleSeconds * 1000);
  protocol.handle('haru-model', async request => {
    const url = new URL(request.url);
    const segments = url.pathname.split('/').filter(Boolean);
    const [id, ...rest] = segments;
    const root = id ? live2dRoots.get(id) : undefined;
    if (!root) {
      console.error(`[haru-model] unknown id=${id} for ${request.url} (known ids: ${[...live2dRoots.keys()].join(', ') || 'none'})`);
      return new Response('Model file not available', { status: 404 });
    }
    const relative = rest.map(decodeURIComponent).join('/');
    const target = path.resolve(root, `./${relative}`);
    if (!target.startsWith(root)) {
      console.error(`[haru-model] resolved path escapes root: root=${root} target=${target} (requested as ${request.url})`);
      return new Response('Model file not available', { status: 404 });
    }
    try {
      // The manifest is rewritten in flight so expressions sitting unreferenced
      // on disk still reach the runtime. Everything else is served untouched.
      if (target.toLowerCase().endsWith('.model3.json')) {
        const { model, added } = withDiscoveredExpressions(JSON.parse(readFileSync(target, 'utf8')), path.dirname(target));
        if (added) console.log(`[live2d] model declared no expressions; found ${added} on disk`);
        return new Response(JSON.stringify(model), { headers: { 'Content-Type': 'application/json' } });
      }
      return await net.fetch(pathToFileURL(target).toString());
    } catch (error) {
      console.error(`[haru-model] failed to read ${target} (requested as ${request.url}):`, error);
      return new Response('Model file not found on disk', { status: 404 });
    }
  });
  /**
   * An attached picture, on its way to the window.
   *
   * The same shape as haru-model above and the same escape check, for the same
   * reason: this resolves a path out of a URL the renderer asked for. The root
   * is read fresh on every request rather than captured, so pointing the folder
   * somewhere else in setup does not leave a handler serving the old one.
   *
   * Only a basename is ever in the URL, and resolve + startsWith is what makes
   * that true rather than merely intended.
   */
  protocol.handle('haru-photo', async request => {
    const root = path.resolve(photoFolder());
    // The whole path, not everything after the first segment. haru-model drops
    // its first segment because that one is a model id — this scheme has no id,
    // only a filename, so the same slice threw the name away and left every
    // thumbnail resolving to the folder itself and failing the check below.
    const name = decodeURIComponent(new URL(request.url).pathname).replace(/^\/+/, '');
    const target = path.resolve(root, `./${name}`);
    if (!name || !target.startsWith(root + path.sep)) {
      console.error(`[haru-photo] refused ${request.url} — resolves outside the pictures folder`);
      return new Response('Not available', { status: 404 });
    }
    try {
      return await net.fetch(pathToFileURL(target).toString());
    } catch (error) {
      // A thumbnail for a file that has been deleted or moved. Worth a line, not
      // worth an alarm: the conversation still holds what was said about it.
      console.warn(`[haru-photo] could not read ${path.basename(target)}:`, error instanceof Error ? error.message : error);
      return new Response('Not on disk', { status: 404 });
    }
  });
  // Registered once, at startup. It was inside the protocol handler above, so it
  // never ran until a model file was requested and then threw on the second
  // request — ipcMain.handle refuses a duplicate channel.
  nativeTheme.themeSource = 'dark';
  ipcMain.handle('settings:get', (_e, key) => store.get(key));
  ipcMain.handle('settings:set', (_e, key, value) => store.set(key, value));
  // Read back from Windows rather than from the store, so the panel shows what
  // is actually registered — an entry cleared by a cleanup tool or a policy
  // should read as off, not as whatever the app last believed.
  ipcMain.handle('startup:get', () => ({
    autoStart: isAutoStartEnabled(),
    shortcut: existsSync(desktopShortcutPath()),
    packaged: app.isPackaged,
  }));
  ipcMain.handle('startup:setAutoStart', (_e, enabled: boolean) => setAutoStart(enabled === true));
  ipcMain.handle('startup:createShortcut', () => createDesktopShortcut());
  ipcMain.handle('update:get', () => ({
    state: currentUpdateState(),
    version: app.getVersion(),
    says: describeUpdate(currentUpdateState(), app.getVersion()),
    // So the panel can say why it will never report anything on this build,
    // rather than sitting at "Version 0.1.0." looking broken.
    standingDown: whyNotCheck(app.isPackaged, process.platform),
  }));
  ipcMain.handle('chat:getMessages', () => {
    performChatResetIfDue();
    return store.get('chat.messages') ?? [];
  });
  ipcMain.handle('chat:setMessages', (_e, messages) => { store.set('chat.messages', messages); });
  ipcMain.handle('chat:getArchive', () => store.getArchive());
  ipcMain.handle('chat:getAsides', () => getAsides());
  ipcMain.handle('chat:clearAsides', () => {
    store.set('chat.asides', []);
    sendToWindows('chat:asidesCleared');
    return [];
  });
  ipcMain.handle('chat:newConversation', () => startNewConversation());
  // Only ever in flight once: the window asks on mount and again after a reset,
  // and in dev both can land together. Sharing the promise stops two greetings.
  ipcMain.handle('chat:opening', () => {
    if (!openingInFlight) openingInFlight = composeOpening().then(line => {
      // Counted as one of her unprompted lines, because that is what it is.
      //
      // The spacing above already stops two reminders landing seconds apart —
      // and then the opening line, which picks its angle from the same overdue
      // list, spoke three seconds before one anyway. Both were about the TV
      // power connector, both within five seconds of the window appearing, and
      // neither knew the other had spoken. It is the same fault the comment on
      // lastRemindedAt describes, with the opening left out of the sum.
      if (line) lastRemindedAt = Date.now();
      return line;
    }).finally(() => { openingInFlight = null; });
    return openingInFlight;
  });
  ipcMain.handle('profile:get', () => getProfile());
  ipcMain.handle('profile:set', (_e, profile: Profile) => { store.set('profile', profile); return getProfile(); });
  ipcMain.handle('memory:list', () => getMemories());
  ipcMain.handle('memory:add', (_e, text: string, kind: MemoryKind = 'fact') => { addMemory(text, kind, undefined, { source: 'explicit', emotion: localEmotion(text), emotionIntensity: readTone(text).heat }); return getMemories(); });
  ipcMain.handle('memory:sessions', () => getSessions());
  ipcMain.handle('memory:forgetSessions', () => { store.setSessions([]); return []; });
  ipcMain.handle('memory:remove', (_e, id: string) => { setMemories(getMemories().filter(memory => memory.id !== id)); return getMemories(); });
  ipcMain.handle('memory:consolidate', () => runMemoryConsolidation());
  ipcMain.handle('memory:forgettingLog', () => store.getForgettingLog());
  ipcMain.handle('memory:lastRetrieval', () => memoryStore.lastRetrieval());
  // The user is the administrator of the memory blocks: the model's tools
  // refuse read-only blocks, but these can edit anything — including the
  // persona — and can send a block back to its derived state.
  ipcMain.handle('blocks:list', () => store.getBlocks());
  ipcMain.handle('blocks:update', (_e, label: string, value: string, opts: { limit?: number; description?: string; read_only?: boolean } = {}) => {
    const blocks = store.getBlocks();
    const block = findBlock(blocks, label);
    if (!block) return null;
    const updated: MemoryBlock = { ...block };
    if (typeof value === 'string') {
      updated.value = value;
      updated.edited = true;
    }
    if (typeof opts.limit === 'number' && Number.isFinite(opts.limit) && opts.limit > 0) updated.limit = opts.limit;
    if (typeof opts.description === 'string') updated.description = opts.description;
    if (typeof opts.read_only === 'boolean') updated.read_only = opts.read_only;
    setBlocks(blocks.map(candidate => candidate.label === label ? updated : candidate));
    return updated;
  });
  ipcMain.handle('blocks:reset', (_e, label: string) => {
    const blocks = store.getBlocks();
    const block = findBlock(blocks, label);
    if (!block) return null;
    const reset = resetBlockToDerived(block);
    setBlocks(blocks.map(candidate => candidate.label === label ? reset : candidate));
    return reset;
  });
  ipcMain.handle('memory:clear', () => {
    setMemories([]);
    // The graph is what she knows too. Which days were read is kept, or the
    // next tick would rebuild all of it from the archive behind their back.
    store.setFactGraph({ ...emptyGraph(), read: store.getFactGraph().read });
    return getMemories();
  });
  // Called when the message being sent was spoken rather than typed. Typed
  // messages deliberately do not do this: somebody at the keyboard has not asked
  // for the microphone.
  ipcMain.handle('chat:expectAnswer', () => { expectAnswerWhenDone(); });
  ipcMain.handle('listen:correct', (_e, heardText: string, meantText: string) => {
    const before = readHearing(store.get('hearing'));
    const after = remember(before, heardText, meantText, new Date().toISOString());
    store.set('hearing', after);
    const learned = after.corrections[0];
    // The pair, not the sentence: what it took from the correction is the only
    // thing worth telling them, because it is what will fire next time.
    if (learned && after.corrections.length !== before.corrections.length) console.log(`[listen] learned: "${learned.heard}" -> "${learned.meant}"`);
    return after.corrections.length;
  });
  ipcMain.handle('listen:corrections', () => readHearing(store.get('hearing')).corrections);
  ipcMain.handle('listen:forgetCorrection', (_e, heardText: string) => {
    const now = readHearing(store.get('hearing'));
    const kept = { corrections: now.corrections.filter(c => c.heard !== heardText) };
    store.set('hearing', kept);
    return kept.corrections;
  });
  ipcMain.handle('listen:get', () => readListenConfig(store.get('listen')));
  ipcMain.handle('listen:set', (_e, config: ListenConfig) => {
    const saved = readListenConfig(config);
    store.set('listen', saved);
    sendToWindows('listen:changed', saved);
    return saved;
  });
  // The audio arrives, is transcribed, and is gone. Nothing is written down and
  // nothing but the length is logged — a log outlives the moment, and a record
  // of everything said near this machine is not what was asked for.
  ipcMain.handle('listen:transcribe', async (_e, audio: Uint8Array, mime: string) => {
    const config = readListenConfig(store.get('listen'));
    const vocabulary = wordsToListenFor();
    const text = await transcribe(audio, mime, config, net.fetch, remoteAuth(config.endpoint), vocabulary);
    if (looksLikeNothing(text, vocabulary)) {
      console.log(`[listen] ${audio.length} bytes -> nothing worth sending`);
      return '';
    }
    // Rewritten with whatever she has been taught to mishear less. Applied here
    // rather than as a prompt to the model — see hearing.ts for why priming is
    // the wrong tool.
    const heard = readHearing(store.get('hearing'));
    const fixed = correct(heard, text);
    if (fixed.applied.length) {
      store.set('hearing', noteUsed(heard, fixed.applied));
      console.log(`[listen] corrected: ${fixed.applied.join(', ')}`);
    }
    console.log(`[listen] ${audio.length} bytes -> ${fixed.text.length} chars`);
    return fixed.text;
  });
  // hasKey rather than the key: whether one is saved is what the panel needs to
  // render, and the key itself has no business back in the renderer.
  ipcMain.handle('jellyfin:get', () => {
    const config = readJellyfinConfig(store.get('jellyfin'));
    return { ...config, hasKey: Boolean(decryptSecret(store.get('jellyfinApiKey') as string | undefined)) };
  });
  ipcMain.handle('jellyfin:set', (_e, url: string, userId: string, apiKey: string) => {
    const config = readJellyfinConfig({ url, userId });
    if (!config.url) {
      store.delete('jellyfin' as never);
      store.delete('jellyfinApiKey' as never);
      console.log('[jellyfin] forgotten');
      return { url: '', userId: '', hasKey: false };
    }
    if (!jellyfinAddressAllowed(config.url)) throw new Error('That address would send the key over the open internet in the clear. Use https, or an address on your own network or tailnet.');
    store.set('jellyfin', config);
    if (apiKey) store.set('jellyfinApiKey', encryptSecret(apiKey));
    console.log(`[jellyfin] pointed at ${config.url}`);
    return { ...config, hasKey: Boolean(apiKey) || Boolean(decryptSecret(store.get('jellyfinApiKey') as string | undefined)) };
  });
  ipcMain.handle('jellyfin:test', async () => {
    const config = readJellyfinConfig(store.get('jellyfin'));
    const key = decryptSecret(store.get('jellyfinApiKey') as string | undefined);
    if (!config.url) throw new Error('No address set.');
    if (!key) throw new Error('No API key saved.');
    const reached = await jellyfinReach(config, key);
    // The user id is worth keeping once we have looked it up, so the next call
    // does not have to ask again.
    if (!config.userId && reached.userId) store.set('jellyfin', { ...config, userId: reached.userId });
    console.log(`[jellyfin] ${reached.name} ${reached.version}, ${reached.libraries} librar${reached.libraries === 1 ? 'y' : 'ies'}`);
    return reached;
  });
  ipcMain.handle('checkinsource:get', () => {
    const source = readCheckInSource(store.get('checkinSource'));
    return { url: source?.url ?? '', username: source?.username ?? '', hasPassword: Boolean(decryptSecret(store.get('checkinSourcePassword') as string | undefined)) };
  });
  ipcMain.handle('checkinsource:set', (_e, url: string, username: string, password: string) => {
    const trimmed = String(url ?? '').trim().replace(/\/+$/, '');
    if (!trimmed) {
      store.delete('checkinSource' as never);
      store.delete('checkinSourcePassword' as never);
      console.log('[checkins] no longer reading from another machine');
      return { url: '', username: '', hasPassword: false };
    }
    // Refused here as well as in the reader. A password is about to be stored
    // for this address and then sent to it, and these notes are the last thing
    // that should go anywhere but the tailnet.
    if (!isTailnetAddress(trimmed)) throw new Error('That is not a tailnet address. It has to be a name ending .ts.net, or a 100.x address, so her check-ins never leave the tailnet.');
    store.set('checkinSource', { url: trimmed, username: String(username ?? '').trim() });
    if (password) store.set('checkinSourcePassword', encryptSecret(password));
    console.log('[checkins] reading from ' + trimmed);
    void pullCheckIns().then(syncMemories);
    return { url: trimmed, username: String(username ?? '').trim(), hasPassword: Boolean(password) || Boolean(decryptSecret(store.get('checkinSourcePassword') as string | undefined)) };
  });
  ipcMain.handle('checkinsource:pull', async () => { await pullCheckIns(); return getCheckIns().entries.length; });
  ipcMain.handle('memory:sync', async () => { await syncMemories(); return getMemories(); });
  ipcMain.handle('search:get', () => ({ ...readSearchConfig(store.get('search')), hasKey: Boolean(getSearchKey()) }));
  ipcMain.handle('search:set', (_e, config: SearchConfig) => {
    const saved = readSearchConfig(config);
    store.set('search', saved);
    console.log(`[search] ${saved.enabled ? `on via ${saved.provider}, ${saved.limit} results a time` : 'off'}`);
    return { ...saved, hasKey: Boolean(getSearchKey()) };
  });
  ipcMain.handle('search:setKey', (_e, apiKey: string) => { saveSearchKey(apiKey); return Boolean(getSearchKey()); });
  ipcMain.handle('desktop:get', () => ({ ...readDesktopConfig(store.get('desktop')), apps: findApps().length }));
  ipcMain.handle('desktop:set', (_e, config: DesktopConfig) => {
    const saved = readDesktopConfig(config);
    store.set('desktop', saved);
    console.log(`[desktop] launching ${saved.launch ? 'on' : 'off'}, power ${saved.power ? 'on' : 'off'}`);
    return { ...saved, apps: findApps().length };
  });
  /**
   * Where they are, once, because they pressed the button.
   *
   * Not on a timer and not at startup. This is the only thing in the app that
   * sends anything derived from their physical position anywhere, so it happens
   * when asked and produces a name they can see, edit or delete — after which
   * the coordinates are gone and the searches are words again.
   */
  ipcMain.handle('search:locate', async () => {
    const fix = await readWindowsLocation();
    const place = await lookUpPlace(fix, net.fetch as never);
    // The accuracy is logged; the position is not. A log outlives the moment.
    console.log(`[location] resolved to ${place} (Windows was accurate to ${Math.round(fix.accuracy)}m)`);
    return { place, accuracy: Math.round(fix.accuracy) };
  });
  // Proves the key works before she needs it, so a bad one surfaces here rather
  // than as her saying she could not look something up.
  ipcMain.handle('search:test', async () => {
    const config = readSearchConfig(store.get('search'));
    const results = await searchWeb('hello', { ...config, enabled: true }, net.fetch, getSearchKey());
    return results.length;
  });
  ipcMain.handle('roam:get', () => readRoamConfig(store.get('roam')));
  ipcMain.handle('roam:set', (_e, config: RoamConfig) => {
    const saved = readRoamConfig(config);
    store.set('roam', saved);
    // Cancelled immediately on being switched off, rather than finishing the walk
    // she was already on — the switch should feel like it did something.
    if (!saved.enabled) stopWalking();
    nextWanderAt = 0;
    console.log(`[roam] ${saved.enabled ? `on, restlessness ${saved.restlessness.toFixed(2)}` : 'off'}${saved.avoidFullscreen ? ', avoids fullscreen' : ''}`);
    return saved;
  });
  // A way to see it work without sitting through several minutes of not-yet.
  ipcMain.handle('roam:nudge', () => {
    if (!companionWindow) return false;
    const bounds = companionWindow.getBounds();
    const work = screen.getDisplayMatching(bounds).workArea;
    const destination = pickDestination(work, bounds);
    if (!destination) return false;
    // Cleared so the just-been-moved-by-hand rule does not veto a walk the user
    // has explicitly asked to watch.
    lastUserMovedAt = 0;
    walkTo(destination);
    return true;
  });
  ipcMain.handle('ui:page', (_e, page: NoticedPage) => { void noticePage(page); });

  // The web door. The password only ever travels inwards: it is hashed here and
  // the renderer is told nothing but whether one exists.
  ipcMain.handle('web:status', () => {
    const access = getWebAccess();
    return {
      enabled: access.enabled,
      username: access.username,
      hasPassword: Boolean(access.hash),
      running: Boolean(webServer),
      trouble: webServer ? '' : webTrouble,
      port: webServer?.port ?? DEFAULT_WEB_PORT,
      devices: access.devices.map(device => ({ id: device.id, name: device.name, added: device.added, lastSeen: device.lastSeen })),
    };
  });
  ipcMain.handle('web:setPassword', (_e, username: string, password: string) => {
    const name = String(username ?? '').trim();
    if (!name) throw new Error('Pick a name to sign in with.');
    const complaint = weakPassword(String(password ?? ''), name);
    if (complaint) throw new Error(complaint);
    // Every remembered device is dropped. Changing a password that somebody else
    // may know is worth nothing if their phone stays signed in.
    const access = forgetEveryDevice(getWebAccess());
    saveWebAccess({ ...access, username: name, ...setPassword(password) });
    console.log('[web] password set — every remembered device signed out');
    return true;
  });
  ipcMain.handle('web:setEnabled', async (_e, enabled: boolean) => {
    const access = getWebAccess();
    if (enabled && !access.hash) throw new Error('Set a password first.');
    saveWebAccess({ ...access, enabled: Boolean(enabled) });
    if (enabled) await startWebDoor(); else await stopWebDoor();
    return Boolean(webServer);
  });
  ipcMain.handle('web:forgetDevice', (_e, id: string) => {
    saveWebAccess(forgetDevice(getWebAccess(), String(id)));
    return getWebAccess().devices.map(device => ({ id: device.id, name: device.name, added: device.added, lastSeen: device.lastSeen }));
  });
  ipcMain.handle('watching:get', () => readWatchingConfig(store.get('watching')));
  ipcMain.handle('watching:set', (_e, config: WatchingConfig) => {
    const saved = readWatchingConfig(config);
    store.set('watching', saved);
    lastLookAt = 0;
    console.log(`[watch] ${saved.enabled ? `on, every ${saved.everyMinutes} min${saved.gamesOnly ? ' while gaming' : ''}` : 'off'}`);
    return saved;
  });
  ipcMain.handle('screenshots:get', () => ({ ...readScreenshotConfig(store.get('screenshots')), folder: screenshotFolder() }));
  ipcMain.handle('screenshots:set', (_e, config: ScreenshotConfig) => {
    const saved = readScreenshotConfig(config);
    store.set('screenshots', saved);
    watchScreenshots();
    console.log(`[shot] ${saved.enabled ? `watching, one remark every ${saved.quietMinutes} min` : 'off'}`);
    return { ...saved, folder: screenshotFolder() };
  });
  ipcMain.handle('vision:get', () => ({ ...readVisionConfig(store.get('vision')), folder: photoFolder() }));
  ipcMain.handle('vision:set', (_e, config: VisionConfig) => {
    const saved = readVisionConfig(config);
    store.set('vision', saved);
    console.log(`[vision] ${saved.enabled ? `on via ${saved.model}` : 'off'}`);
    return { ...saved, folder: photoFolder() };
  });
  ipcMain.handle('vision:openFolder', () => { void shell.openPath(photoFolder()); });
  /**
   * Staging, which is all that picking a file does now.
   *
   * The old handler here opened a picker and then ran the whole job on the spot:
   * it took whatever was in the draft box as the question, called a vision model
   * and posted an answer that never went through the conversation. That is why
   * you had to type before choosing a file, and why the answer knew nothing
   * about anything else you had said.
   *
   * Nothing is read here and no model is called. The file is copied, named, and
   * handed back as a chip for the composer; the reading happens on Send, in the
   * ordinary chat path, where she has her character and her memory to hand.
   */
  ipcMain.handle('attachments:pick', async (_e, only: 'picture' | 'any' = 'any') => {
    const tools = findFfmpeg();
    const picked = await dialog.showOpenDialog({
      title: only === 'picture' ? 'Show Haru a picture' : 'Give Haru a file',
      properties: ['openFile', 'multiSelections'],
      // Sound and video only when ffmpeg is there to open them: offering a file
      // type that then fails is worse than not offering it.
      filters: only === 'picture' ? [{ name: 'Pictures', extensions: OPENABLE.image }] : [
        { name: 'Anything she can open', extensions: [...OPENABLE.image, ...OPENABLE.document, ...OPENABLE.text, ...(tools ? [...OPENABLE.audio, ...OPENABLE.video] : [])] },
        { name: 'Pictures', extensions: OPENABLE.image },
        ...(tools ? [{ name: 'Sound', extensions: OPENABLE.audio }, { name: 'Video', extensions: OPENABLE.video }] : []),
        { name: 'Documents', extensions: OPENABLE.document },
        { name: 'Text and data', extensions: OPENABLE.text },
        { name: 'All files', extensions: ['*'] },
      ],
    });
    if (picked.canceled || !picked.filePaths.length) return [];
    return stageAll(picked.filePaths, tools);
  });
  /** Dropped onto the window. Same staging, no dialog. */
  ipcMain.handle('attachments:stageFiles', (_e, paths: string[]) => stageAll(Array.isArray(paths) ? paths : [], findFfmpeg()));
  /** Pasted. There is no file on disk anywhere in that journey — see stageBytes. */
  ipcMain.handle('attachments:stageBytes', (_e, name: string, bytes: Uint8Array) => {
    const staged = stageBytes(String(name || 'pasted.png'), bytes);
    console.log(`[attach] staged ${staged.name} from the clipboard (${(staged.bytes / 1024 | 0)}KB)`);
    return staged;
  });
  /** Taken off the composer before it was ever sent. */
  ipcMain.handle('attachments:discard', (_e, attachment: Attachment) => { discardStaged(attachment); });

  ipcMain.handle('gaming:get', () => readGamingConfig(store.get('gaming')));
  ipcMain.handle('gaming:set', (_e, config: GamingConfig) => {
    const saved = readGamingConfig(config);
    store.set('gaming', saved);
    evictedFor = null;
    console.log(`[gaming] ${saved.enabled ? `on — ${saved.model} while playing` : 'off'}${saved.quiet ? ', quiet' : ''}`);
    return saved;
  });
  ipcMain.handle('journal:list', () => getJournal());
  ipcMain.handle('journal:getConfig', () => readJournalConfig(store.get('journal.config')));
  ipcMain.handle('journal:setConfig', (_e, config: JournalConfig) => {
    const saved = readJournalConfig(config);
    // Under journal.config, beside journal.entries rather than over them.
    store.set('journal.config', saved);
    console.log(`[journal] ${saved.enabled ? `on${saved.askUnprompted ? `, she asks from ${saved.askHour}:00` : ', she waits to be asked'}` : 'off'}`);
    return saved;
  });
  ipcMain.handle('journal:save', (_e, entry: { date?: string; text: string; mood?: number; anxiety?: number; energy?: number; sleep?: number }) => {
    const date = typeof entry.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(entry.date) ? entry.date : localDateKey(zonedNow(CHAT_TIMEZONE));
    const entries = upsertEntry(getJournal(), {
      date,
      text: typeof entry.text === 'string' ? entry.text : '',
      mood: readRating(entry.mood),
      anxiety: readRating(entry.anxiety),
      energy: readRating(entry.energy),
      sleep: readRating(entry.sleep),
      // Typed by hand, so she did not drag it out of them.
      prompted: false,
    });
    setJournal(entries);
    // Written by hand counts as done for the day; she must not then ask.
    if (date === localDateKey(zonedNow(CHAT_TIMEZONE))) journalAskedOn = date;
    console.log(`[journal] saved ${date} by hand: ${String(entry.text ?? '').length} chars`);
    return entries;
  });
  ipcMain.handle('journal:remove', (_e, id: string) => { setJournal(getJournal().filter(entry => entry.id !== id)); return getJournal(); });
  ipcMain.handle('journal:trend', () => recentTrend(getJournal(), localDateKey(zonedNow(CHAT_TIMEZONE))));
  ipcMain.handle('journal:stats', (_e, range: RangeName) => rangeStats(getJournal(), localDateKey(zonedNow(CHAT_TIMEZONE)), range));
  ipcMain.handle('journal:note', () => haruNote(getJournal(), localDateKey(zonedNow(CHAT_TIMEZONE))));
  ipcMain.handle('anilist:get', () => readAniListConfig(store.get('anilist')));
  ipcMain.handle('anilist:set', (_e, config: AniListConfig) => {
    const saved = readAniListConfig(config);
    store.set('anilist', saved);
    // Forced, because the username almost certainly just changed and the cached
    // list belongs to whoever it was before.
    listFetchedAt = 0;
    void refreshAniList(true);
    console.log(`[anilist] ${saved.enabled ? `on${saved.username ? ` as ${saved.username}` : ', lookups only'}` : 'off'}`);
    return saved;
  });
  // Reports what she would actually get, so a private profile or a typo shows up
  // here rather than as her quietly not knowing what they are watching.
  ipcMain.handle('anilist:test', async () => {
    const config = readAniListConfig(store.get('anilist'));
    if (!config.username) throw new Error('No username to check.');
    const entries = await userList(config.username, net.fetch);
    await refreshAniList(true);
    return entries.length;
  });
  ipcMain.handle('character:get', () => getCharacter());
  ipcMain.handle('character:set', (_e, identity: string, style: string) => { store.set('character', { identity, style }); return getCharacter(); });
  ipcMain.handle('character:reset', () => { store.delete('character' as never); return DEFAULT_CHARACTER; });
  ipcMain.handle('kept:get', () => getKept());
  // Only tasks can be ticked off — an event happens whether or not you attend,
  // so there is nothing to complete.
  ipcMain.handle('kept:toggle', (_e, id: string) => {
    const updated = toggleKept(id);
    // Only on the way into done. Un-ticking is a correction, and being crowed at
    // for fixing a mistake is a different feeling entirely.
    if (updated?.done) void remarkOnTickOff(updated);
  });
  ipcMain.handle('kept:remove', (_e, id: string) => { removeKept(id); });
  ipcMain.handle('google:status', () => googleStatus(store));
  ipcMain.handle('google:saveCredentials', (_e, clientId: string, clientSecret: string) => { saveCredentials(store, clientId, clientSecret); return googleStatus(store); });
  ipcMain.handle('google:connect', async () => { const status = await connectGoogle(store); broadcastGoogleStatus(); return status; });
  ipcMain.handle('google:disconnect', () => { disconnectGoogle(store); broadcastGoogleStatus(); return googleStatus(store); });
  ipcMain.handle('google:sync', () => syncFromGoogle());
  ipcMain.handle('ai:send', (_e, messages: { role: string; content: string }[], config: ProviderConfig) => {
    const door = herAsleepNow() ? knockWhileAsleep() : null;
    if (door) return { content: door, ignored: false, irritation: 0, ego: 0 };
    return ollamaChat(messages, config);
  });
  // Streaming, for a client that draws the line as it is written rather than
  // waiting for the whole of it. Same generation as ai:send; each stretch is
  // announced as it arrives, and delivery labels are taken out at the source so
  // they are not printed. The last label is handed over as `mood`: it is how she
  // said the line she ended on, which is the face a terminal should leave her
  // wearing.
  ipcMain.handle('ai:stream', (_e, turn: string, messages: { role: string; content: string }[], config: ProviderConfig) => {
    const tell = (channel: string, payload: unknown) => { for (const win of BrowserWindow.getAllWindows()) win.webContents.send(channel, payload); };
    const door = herAsleepNow() ? knockWhileAsleep() : null;
    if (door) return { content: door, ignored: false, irritation: 0, ego: 0, mood: null };
    let clean = cleaningChunks(text => tell('ai:chunk', { turn, text }));
    return ollamaChat(messages, config, {
      onChunk: text => clean(text),
      onChunkReset: () => { clean = cleaningChunks(text => tell('ai:chunk', { turn, text })); tell('ai:chunkReset', { turn }); },
      onToolCall: name => tell('ai:tool', { turn, name }),
    }).then(reply => {
      const moods = splitDelivery(reply.content ?? '').map(part => part.mood).filter(Boolean);
      return { ...reply, content: stripDelivery(reply.content ?? ''), mood: moods.at(-1) ?? null };
    });
  });
  // The words she can wrap a line in so her voice knows how to say it; the
  // terminal takes them out of what she is shown.
  ipcMain.handle('delivery:labels', () => [...EMOTIONS, ...Object.keys(MOOD_ALIASES)]);
  ipcMain.handle('ai:test', (_e, endpoint: string, provider?: string) => (isOpenAIShaped(provider)
    ? openAIModels(endpoint, (provider as Provider) ?? 'openai')
    : ollamaTags(endpoint)));
  ipcMain.handle('ai:defaultEndpoint', (_e, provider: string) => DEFAULT_ENDPOINTS[(provider as Provider)] ?? DEFAULT_ENDPOINTS.ollama);
  ipcMain.handle('ai:setKey', (_e, apiKey: string) => { saveRemoteKey(apiKey); return Boolean(getRemoteKey()); });
  ipcMain.handle('ai:hasKey', () => Boolean(getRemoteKey()));
  ipcMain.handle('ai:setSelfHostedKey', (_e, apiKey: string) => { saveSelfHostedKey(apiKey); return Boolean(getSelfHostedKey()); });
  ipcMain.handle('ai:hasSelfHostedKey', () => Boolean(getSelfHostedKey()));
  ipcMain.handle('openai:setKey', (_e, apiKey: string) => { saveOpenAIKey(apiKey); return Boolean(getOpenAIKey()); });
  ipcMain.handle('openai:status', () => ({ hasKey: Boolean(getOpenAIKey()), ffmpeg: Boolean(findFfmpeg()) }));
  ipcMain.handle('venice:setKey', (_e, apiKey: string) => { saveVeniceKey(apiKey); return Boolean(getVeniceKey()); });
  ipcMain.handle('venice:hasKey', () => Boolean(getVeniceKey()));
  ipcMain.handle('ai:verify', (_e, endpoint: string, provider: string, model: string) => verifyRemoteModel(endpoint, (provider as Provider) ?? 'openai', model));
  ipcMain.handle('ai:getEscalate', () => ({ ...readEscalateConfig(store.get('escalate')), provider: store.get('escalate.provider') ?? null }));
  ipcMain.handle('ai:setEscalate', (_e, setting: EscalateConfig, provider: ProviderConfig | null) => {
    const saved = readEscalateConfig(setting);
    // Under two keys rather than one object: the same dot-path trap as the API
    // keys, and here it would silently drop whichever half was written second.
    // Written as one object on purpose. readEscalateConfig returns only the
    // switch and the word bar, so setting 'escalate' on its own wipes the
    // provider nested inside it — and the second write only put it back because
    // every caller happens to pass one. That is the dot-path trap that ate
    // private mode's character, waiting for the first caller to pass null.
    const keeping = provider ?? (store.get('escalate.provider') as ProviderConfig | undefined) ?? null;
    store.set('escalate', { ...saved, ...(keeping ? { provider: keeping } : {}) });
    console.log(`[ai] second model ${saved.enabled ? `on — ${keeping?.model || 'none set'} past ${saved.minWords} words` : 'off'}`);
    return { ...saved, provider: store.get('escalate.provider') ?? null };
  });
  // Her comebacks are things she says, so they are spoken like anything else.
  ipcMain.handle('ai:retort', async (_e, disliked: string, config: ProviderConfig) => { noteUserSpoke(); const line = await ollamaRetort(disliked, config); void speak(line); return line; });
  ipcMain.handle('ai:gloat', async (_e, praised: string, config: ProviderConfig) => { noteUserSpoke(); const line = await ollamaGloat(praised, config, getMood().ego); void speak(line); return line; });
  ipcMain.handle('voice:get', () => getVoiceConfig());
  ipcMain.handle('voice:set', (_e, config: VoiceConfig) => {
    const saved = readVoiceConfig(config);
    store.set('voice', saved);
    if (saved.engine === 'off') stopSpeaking();
    sendToWindows('voice:changed', saved);
    return saved;
  });
  ipcMain.handle('voice:stop', () => stopSpeaking());
  // Reported by the window that owns the audio, since only it knows when a clip
  // has actually finished playing rather than merely been sent.
  ipcMain.handle('voice:speaking', (_e, speaking: boolean) => {
    speakingNow = Boolean(speaking);
    duckOthers(speakingNow);
    if (speakingNow) return;
    // She finished, so there is no longer a sentence to be cut off in the
    // middle of. Cleared here rather than at the end of speak(), which returns
    // once the last chunk has been *sent* — the audio is still playing for
    // seconds after that, and those seconds are exactly when a poke lands.
    speakingLine = '';
    // The moment she stops. If what she just finished saying was her own idea,
    // this is where the microphone opens for the answer.
    openAnswerWindow();
    // And anything she bit her tongue about can be said now that the sentence
    // it would have cut into is over.
    releaseDeferred();
  });
  ipcMain.handle('wardrobe:get', () => ({ controls: getWardrobeControls(), values: getWardrobeValues() }));
  // The companion window is the only place the model actually exists, so it is
  // the only place these bounds can be read. Reported once per model load.
  ipcMain.handle('wardrobe:ranges', (_e, ranges: Record<string, ParameterRange>) => {
    parameterRanges = ranges ?? {};
    const controls = getWardrobeControls();
    console.log(`[wardrobe] ranges reported for ${Object.keys(parameterRanges).length} parameters; ${controls.length} controls: ${controls.map(c => `${c.name}[${c.values.join(',')}]`).join(' ')}`);
    sendToWindows('wardrobe:refresh');
  });
  ipcMain.handle('wardrobe:set', (_e, id: string, value: number) => setWardrobeValue(id, value));
  ipcMain.handle('wardrobe:reset', () => {
    const modelPath = currentModelPath();
    if (modelPath) { const all = allWardrobeValues(); delete all[modelPath]; store.set('wardrobe.values', all); }
    sendToWindows('wardrobe:changed', {});
    return {};
  });
  // Reference clips are picked, not typed: these paths run to 100+ characters and
  // a single typo shows up as a failed synthesis rather than as a bad path.
  ipcMain.handle('voice:pickClip', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Choose a reference clip',
      properties: ['openFile'],
      filters: [{ name: 'Audio', extensions: ['wav', 'mp3', 'flac', 'ogg', 'm4a'] }],
    });
    return result.canceled ? null : result.filePaths[0] ?? null;
  });
  // Tested with the settings as typed rather than as saved, so the button says
  // whether what is on screen works before it is committed.
  ipcMain.handle('voice:test', async (_e, config: VoiceConfig) => {
    const candidate = readVoiceConfig(config);
    const line = 'Right, I can talk now. Try not to make me regret it.';
    if (candidate.engine === 'off') return 'Voice is switched off — pick an engine first.';
    const turn = ++speechTurn;
    sendToWindows('speech:stop');
    if (candidate.engine === 'windows') {
      sendToWindows('speech:clip', { turn, text: line } satisfies SpeechClip);
      return 'Speaking through the built-in Windows voice.';
    }
    const clip = await synthesise(line, candidate, referenceFor(candidate), voiceAuth(candidate), null);
    sendToWindows('speech:clip', { turn, text: line, ...(clip ?? {}) } satisfies SpeechClip);
    return `Connected — ${Math.round((clip?.audio.byteLength ?? 0) / 1024)} KB of audio came back.`;
  });
  // Rating a reply moves her mood too — being told she got it wrong stings more
  // than a lazy question, and praise buys back some patience.
  ipcMain.handle('mood:react', (_e, reaction: 'up' | 'down', id?: string) => {
    const taken = takeThumb(reaction);
    // Written down for later, when the desk says which reply it was.
    if (id) appendFeedback({ id, reaction, source: 'desktop' });
    // The desk answers back only when the coin says so.
    return { ...taken.mood, comeback: taken.comeback };
  });
  ipcMain.handle('mood:get', () => getMood());
  ipcMain.handle('live2d:import', async () => {
    const result = await dialog.showOpenDialog(mainWindow!, { title: 'Import Live2D Cubism model', properties: ['openFile'], filters: [{ name: 'Live2D model package', extensions: ['zip', 'json'] }] });
    if (result.canceled || !result.filePaths[0]) return null;
    const selected = result.filePaths[0];
    const modelPath = selected.toLowerCase().endsWith('.zip') ? unpackModel(selected) : selected;
    if (!modelPath.toLowerCase().endsWith('.model3.json')) throw new Error('Choose a .model3.json file, or a ZIP that contains one.');
    const model = modelResult(modelPath);
    store.set('live2d.model', { path: model.path, name: model.name });
    broadcastLive2DChange(model);
    store.set('companion.hidden', false);
    companionWindow?.show();
    return model;
  });
  ipcMain.handle('live2d:get', () => { const saved = store.get('live2d.model') as { path?: string } | undefined; return saved?.path ? modelResult(saved.path) : null; });
  ipcMain.handle('live2d:remove', () => {
    store.delete('live2d.model');
    broadcastLive2DChange(null);
    companionWindow?.hide();
  });
  ipcMain.handle('companion:moveBy', (_e, dx: number, dy: number) => {
    if (!companionWindow) return;
    // Being moved by hand cancels whatever she was walking toward and buys her
    // a stretch of standing still — see mayWander.
    lastUserMovedAt = Date.now();
    stopWalking();
    const bounds = companionWindow.getBounds();
    const { x, y } = clampCompanionPosition(bounds.x + dx, bounds.y + dy, bounds.width, bounds.height);
    companionWindow.setBounds({ ...bounds, x: Math.round(x), y: Math.round(y) });
  });
  ipcMain.handle('companion:resizeBy', (_e, factor: number) => {
    if (!companionWindow) return;
    const bounds = companionWindow.getBounds();
    const width = clampCompanionWidth(bounds.width * factor);
    const height = Math.round(width * COMPANION_ASPECT);
    // Anchor the resize at bottom-center, matching the model's own anchor point,
    // so growing/shrinking feels like the character scaling in place.
    const centerX = bounds.x + bounds.width / 2;
    const bottom = bounds.y + bounds.height;
    const { x, y } = clampCompanionPosition(Math.round(centerX - width / 2), Math.round(bottom - height), width, height);
    companionWindow.setBounds({ x, y, width, height });
  });
  ipcMain.handle('companion:poke', (_e, kind: PokeKind) => { void handlePoke(kind === 'right-click' ? 'right-click' : 'poke'); });
  /**
   * She looks up. Answers instantly and on purpose: the line is canned so the
   * box never waits on a model, and only the reply itself is generated.
   */
  ipcMain.handle('companion:open', () => {
    summonOpen = true;
    // Being spoken to is not being prodded. handlePoke counts a click as
    // criticism and bumps irritation for it; opening the box is the opposite,
    // and charging her for it would make her hostile for no reason at all.
    nudgeVitals('spoken-to');
    noteUserSpoke();
    const line = summonedLine(getMood().irritation, lastSummonLine);
    lastSummonLine = line;
    if (store.get('companion.subtitles', true)) sendToWindows('companion:say', line);
    console.log('[summon] opened');
    return line;
  });

  ipcMain.handle('companion:close', () => {
    summonOpen = false;
    console.log('[summon] closed');
  });

  /**
   * A message typed at her window, answered as if it had been typed at her chat.
   *
   * Through ollamaChat rather than a lighter path, so everything still works
   * from here: ticking a task off, remembering something, looking something up.
   * A second conversation that could not do any of that would be a worse
   * version of her wearing the same face.
   */
  ipcMain.handle('companion:ask', async (_e, text: string) => {
    const said = String(text ?? '').trim();
    if (!said) return { reply: '', ignored: false };
    const config = store.get('ai.config') as ProviderConfig | undefined;
    if (!config?.model) throw new Error('No model is set up.');
    const door = herAsleepNow() ? knockWhileAsleep() : null;
    if (door) {
      sendToWindows('chat:fromPhone', { text: said, reply: door, ignored: false });
      return { reply: door, ignored: false };
    }

    const messages = [...(store.get('chat.messages') as { role: string; content: string; at?: string }[] ?? []),
      { role: 'user', content: said, at: new Date().toISOString() }];
    // hands stay on: she is at her own machine, and this is the same person at
    // the same desk. brief, because it has to fit in a caption.
    const answer = await ollamaChat(messages, config, { brief: true, choices: true });
    const reply = stripDelivery(answer.content ?? '');
    const choices = [...pendingChoices];
    // The same channel the phone uses, so the desk transcript picks
    // it up and coming back to the window does not mean finding half a
    // conversation missing. ollamaChat has already spoken it and pushed the
    // caption on its way through.
    sendToWindows('chat:fromPhone', { text: said, reply, ignored: Boolean(answer.ignored) });
    console.log(`[summon] answered ${said.length} chars with ${reply.length}${choices.length ? ` and ${choices.length} choices` : ''}`);
    return { reply, ignored: Boolean(answer.ignored), choices };
  });

  ipcMain.handle('companion:showMenu', () => {
    const pinned = store.get('companion.pinned', true) as boolean;
    const expressions = readExpressionNames();
    const template: MenuItemConstructorOptions[] = [
      { label: 'Open Haru', click: () => { if (!mainWindow || mainWindow.isDestroyed()) createWindow(); mainWindow?.show(); mainWindow?.focus(); } },
      { type: 'separator' },
      {
        label: 'Pin on top', type: 'checkbox', checked: pinned,
        click: () => {
          const next = !pinned;
          store.set('companion.pinned', next);
          companionWindow?.setAlwaysOnTop(next, 'screen-saver');
        },
      },
      {
        label: 'Show what she says', type: 'checkbox', checked: store.get('companion.subtitles', true) as boolean,
        click: () => {
          const next = !(store.get('companion.subtitles', true) as boolean);
          store.set('companion.subtitles', next);
          // Clears whatever is on screen the moment it is switched off, rather
          // than leaving the last line sitting there until it times out.
          if (!next) sendToWindows('companion:say', null);
        },
      },
    ];
    if (expressions.length) {
      template.push({ label: 'Expression', submenu: expressions.map(name => ({ label: name, click: () => companionWindow?.webContents.send('companion:setExpression', name) })) });
    }
    template.push({ type: 'separator' }, { label: 'Hide character', click: () => { store.set('companion.hidden', true); companionWindow?.hide(); } }, { label: 'Quit', click: () => app.quit() });
    Menu.buildFromTemplate(template).popup({ window: companionWindow ?? undefined });
  });
  // Started at login she is only the character on the desktop, and the chat
  // window waits until it is asked for. The companion, though, shows itself
  // only once a model has been imported — so with no model, skipping this would
  // leave the app running with nothing on screen and no way back into it.
  if (!startedHidden() || !store.get('live2d.model')) createWindow();
  createCompanionWindow();
  reportCapabilities();
  startWindowsHelper();
  watchScreenshots();
  startWatchingScreen();
  // Opened at boot when it was left on, for the same reason the screen watcher
  // is: doing it inside the settings handler means it only ever starts for
  // somebody who opens settings, which is nobody on the second day.
  void startWebDoor();
  // Discord was taken out on 2026-09-16. Its settings and encrypted bot token
  // go with it, so nothing of it is left in the config to export or sync.
  for (const key of ['discord', 'discordToken']) {
    if (store.get(key) !== undefined) { store.delete(key as never); console.log(`[startup] removed the old ${key} setting`); }
  }
  // Her voice is a separate program, and opening Haru is the moment to notice it
  // is not running.
  void reviveVoiceServer();
  // Off the boot path: a directory walk per installed game is fast but it is
  // still disk, and nothing needs the answer until they are in a game.
  setTimeout(() => {
    try {
      steamGames = buildGameIndex();
      console.log(`[steam] ${new Set(steamGames.values()).size} games indexed`);
    } catch (error) {
      console.warn('[steam] could not read the library:', error instanceof Error ? error.message : error);
    }
  }, 4000);
  performChatResetIfDue();
  mergeArchiveFragments();
  setInterval(performChatResetIfDue, CHAT_RESET_POLL_MS);
  // Same minute tick as the chat reset. shouldAsk does all the deciding, so this
  // is a cheap check that does nothing on all but one minute of the day.
  setInterval(() => { void askForJournal(); }, CHAT_RESET_POLL_MS);
  scheduleBackgroundSync();
  startLifeLoop();
  app.on('activate', () => { if (!mainWindow || mainWindow.isDestroyed()) createWindow(); });
});
// Put the machine's volume back before going anywhere. Leaving a user's audio
// at a third of where they set it, with the app that did it now gone, is the
// worst failure this feature could have.
/**
 * Somewhere to read afterwards.
 *
 * There was nowhere at all: no log file, no crash report, and a packaged app has
 * no console to print to. A fault on shutdown was therefore a dialog with no
 * text anyone could copy and no record left behind, which is the worst possible
 * combination for finding out what happened.
 */
function noteCrash(kind: string, error: unknown) {
  const detail = error instanceof Error ? (error.stack ?? error.message) : String(error);
  const line = `${new Date().toISOString()} [${kind}] ${detail}\n`;
  console.error(`[crash] ${kind}: ${detail}`);
  try { appendFileSync(path.join(app.getPath('userData'), 'haru-main.log'), line); } catch { /* there is nothing further to try */ }
}

/**
 * An error must never leave a window nobody can close.
 *
 * With no handler here, Electron puts up its own modal box and waits for a
 * click. On the way out there is nobody to click it: the windows have gone and
 * the box outlives them, so the process sits there for ever — still holding the
 * single-instance lock, still holding port 8787, and still showing a dialog
 * titled "Error" that says nothing useful. The next launch then reports that the
 * web door would not open, which is true, and blames entirely the wrong thing.
 *
 * Two instances of that were found running at once.
 */
process.on('uncaughtException', error => {
  noteCrash('uncaught exception', error);
  if (quitting) app.exit(0);
});
process.on('unhandledRejection', reason => noteCrash('unhandled rejection', reason));

app.on('before-quit', () => {
  quitting = true;
  // Every one of these is a process or a socket that may already be gone, and
  // any of them throwing used to take the whole shutdown with it. The helper is
  // the likeliest: writing to the stdin of a PowerShell that has already exited
  // raises EPIPE, asynchronously, where nothing was listening for it.
  // Her state is only written every few minutes now, so the last few minutes
  // of drift are still in memory at this point and would otherwise go with it.
  try { persistVitals(true); } catch (error) { noteCrash('saving her vitals', error); }
  try { releaseDuck(); } catch (error) { noteCrash('releasing the duck', error); }
  try { helper?.stdin?.write('quit\n'); } catch (error) { noteCrash('telling the helper to quit', error); }
  try { helper?.kill(); } catch (error) { noteCrash('killing the helper', error); }
  void stopWebDoor().catch(error => noteCrash('closing the web door', error));
});

/**
 * A shutdown that stalls is the same fault wearing different clothes: no dialog,
 * but the same process left behind holding the same port. Nothing here should
 * take three seconds, so anything still going at that point is stuck.
 */
app.on('will-quit', () => {
  setTimeout(() => { console.warn('[quit] shutdown stalled — exiting anyway'); app.exit(0); }, 3000).unref();
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
