import core_speaker_1 = require("./core-speaker");
import {configureAffect,affectTurn,currentAffect,admitAffect,affectOutcome,affectDelivery,readAffectSettings,saveAffectSettings} from './core-affect';
import {withIOSOrigin} from './core-ios';
import {coreWhatsAppPublish,coreWhatsAppSelf} from './core-whatsapp-watch';
import {coreGmail} from './core-gmail';
import {loadCallEngagement} from './call-engagement';
import {naturalTurn,naturalSelection} from './core-natural-turn';
import {supplement,supplementOwned,coreRefreshShelf,coreShelfLine,coreReadOverheard} from './core-context-supplement';

async function runCoreProviderFallback(conversation:OllamaMessage[],config:ProviderConfig,options:PostOptions){
 let packet=naturalPolicy<any>('awayStart',[config,homeTwin(config),trimEndpoint(config.endpoint),[...awayDown],Date.now()]);
 let firstError:unknown,lastError:unknown,value:OllamaMessage|undefined;
 for(let step=0;step<3;step++){
  activeTask.getStore()?.signal.throwIfAborted();options.signal?.throwIfAborted();
  for(const event of packet.events??[]){if(event.kind==='delete')awayDown.delete(event.key);else if(event.kind==='set')awayDown.set(event.key,event.value);else if(event.kind==='log')console.log(event.message);else if(event.kind==='warn')console.warn(event.message);else if(event.kind==='broadcast')sendToWindows(event.channel,event.message);else throw Error('core_provider_event_protocol');}
  if(packet.result)return value!;
  if(packet.error){const error=packet.error.source==='original'?firstError:lastError;throw packet.error.attribute?attribute(config,error):error;}
  if(packet.command?.kind!=='send'||!packet.state)throw Error('core_provider_continuation_protocol');
  let observation:any;
  try{value=await sendToProvider(conversation,packet.command.config,options);observation={ok:true,absent:false};}
  catch(error){activeTask.getStore()?.signal.throwIfAborted();options.signal?.throwIfAborted();lastError=error;if(firstError===undefined)firstError=error;observation={ok:false,absent:isAbsent(error)};}
  packet=naturalPolicy<any>('awayObserved',[packet.state,observation,[...awayDown],Date.now()]);
 }
 throw Error('core_provider_continuation_bound');
}
import {naturalError} from './core-natural-policy';

async function runCoreNaturalLocal(args:any,roundOptions:PostOptions){
 let packet=naturalPolicy<any>('localStart',[args]);
 for(let step=0;step<4;step++){
  activeTask.getStore()?.signal.throwIfAborted();
  if(Object.hasOwn(packet,'result'))return packet.result;
  if(packet.error)naturalError(packet.error,VoiceReplyNeedsReview);
  const command=packet.command;if(!command||!packet.state)throw Error('core_local_conversation_protocol');
  let observation:any;
  try{
   const ask=(messages:OllamaMessage[])=>sendToProvider(messages,command.config,command.options);
   let value:any;
   if(command.kind==='grounded')value=await composeLocalReply(command.messages,command.latest,command.evidence,ask,command.character);
   else if(command.kind==='direct')value=await composeConversationalReply(command.messages,command.latest,command.evidence,command.character,ask,command.aside??undefined);
   else if(command.kind==='local-natural')value=await answerLocalNaturalConversation(command.sources,command.latest,command.voice,ask,command.recentReplies);
   else if(command.kind==='draft')value=await ollamaPost(command.messages,command.config,{...roundOptions,tools:command.tools,onChunk:undefined});
   else if(command.kind==='finish')value=await finishLocalReply(command.draft,command.messages,command.latest,command.evidence,ask,undefined,command.character);
   else throw Error('core_local_conversation_command');
   observation={ok:true,value};
  }catch(error){activeTask.getStore()?.signal.throwIfAborted();observation={ok:false,error:{kind:error instanceof VoiceReplyNeedsReview?'VoiceReplyNeedsReview':error instanceof ToolLoopFailure?'ToolLoopFailure':'Error',...(error instanceof ToolLoopFailure?{code:error.code}:{}),message:error instanceof Error?error.message:String(error)}}}
  activeTask.getStore()?.signal.throwIfAborted();packet=naturalPolicy<any>('localObserved',[packet.state,observation]);
 }
 throw Error('core_local_conversation_bound');
}
import {naturalPolicy} from './core-natural-policy';
import {coreSweepPictures,corePictureMutation} from './core-picture-maintenance';
import {navigationPolicy,runCoreDirections,startCoreTrafficWatch,runCoreTrafficWatch,runCorePlaceSearch} from './core-navigation-policy';
import {conversationProgram,conversationCommit} from './core-conversation-policy';

function conversationPolicyFacts(){return {config:remainingStore(app.getPath('userData')).docRef('config',{}),now:Date.now(),clock:agendaClock(zonedNow(CHAT_TIMEZONE)),mood:getMood(),character:getActiveCharacter(),local:store.get('ai.config')??null,route:conversationRoute(),sideNumCtx:sideNumCtx()};}
function conversationApply(packet:any){conversationCommit(app.getPath('userData'),packet);}
function conversationRun(kind:string,args:any,onChunk?: (text:string)=>void,signal?:AbortSignal){
  return conversationProgram(kind,args,conversationPolicyFacts,async command=>{
    if(command.kind==='random')return Math.random();
    const options={...command.options};if(options.stream){delete options.stream;options.onChunk=onChunk;}
    if(command.accounting){
      // Core supplied the route, allowance, deadline and one-attempt scope.
      // Give this separate model command its own native ledger context; the
      // chat task has already finished by the publication seam.
      const accounting=command.accounting;
      const registry=readModelRegistry(store.get('ai.modelRegistry'),{local:(store.get('ai.config') as ProviderConfig|undefined)??command.config,conversation:store.get('ai.conversation') as ProviderConfig|undefined,specialist:store.get('escalate.provider') as ProviderConfig|undefined,vision:readVisionConfig(store.get('vision'))});
      const scoped=new TaskController(taskBridge.call,registry,accounting.policy,accounting.cloudAllowed);
      await scoped.start(accounting.request,command.config.model,accounting.priority,signal);
      let value:any;
      await scoped.compose(async()=>{value=await sendToProvider(command.messages,command.config,options);return value;},command.messages);
      return value;
    }
    return ollamaPost(command.messages,command.config,options);
  });
}

function conversationRevoiceFacts(){return {...conversationPolicyFacts(),busy:revoicing,retryAt:revoiceRetryAt,archive:remainingStore(app.getPath('userData')).docRef('archive',{}),today:localDateKey(zonedNow(CHAT_TIMEZONE)),profile:getProfile(),herName:herNameFrom(getActiveCharacter().identity)};}
function conversationSecondFacts(){return {...conversationPolicyFacts(),asleep:herAsleepNow(),knocked:herKnockedAwakeNow(),lastUser:lastUserActivityAt,silenced:isSilenced(store.get('pushback') as Pushback|undefined,Date.now()),quiet:inQuietHours(getPush().prefs,zonedNow(CHAT_TIMEZONE))};}
import {hearingPolicy,applyCoreHearing} from './core-hearing-policy';
import {coreEveryday,coreProactiveRecall,coreRefreshRecall,recallFrames} from './core-final-recall';
import {runCorePicture} from './core-final-picture';
import {coreSessionLink} from './core-final-sessions';
import {LOCAL_DIRS} from './claudesession';
import { codeJobs, codeLink, openCodeApi, openCodeAuth, type CodeLink } from './codetask';
import { codeEventHub, codeMode, type CodeModeLink } from './codemode';
import {runCoreShell} from './core-final-shell';
import {locationPolicy,locationFlow,locationClock,applyCoreLocation} from './core-location-policy';
import {devicePolicy,deviceFlow,deviceMutation,handleCoreHelper,reactCoreActivity,reactCoreFullscreen,tieCorePlace} from './core-device-activity';
import {retireCoreVaultMemories} from './core-knowledge';
import {agendaClock,agendaFacts,applyAgendaPlan,mutateAgenda,syncAgendaGoogle} from './core-agenda-lifecycle';
import {executeGoogleCommand} from './google';
import {gamePolicy,bootCoreGame} from './core-games';
import {screenPolicy,runCoreScreen,commitPerceptionPlan} from './core-screen-policy';
import {attachmentPolicy,attachmentURLFacts,attachmentCapability,attachmentFileSource,readCoreAttachment,openCoreAttachment,foldCoreAttachments,waitSink,withWaitLine} from './core-attachments';
import {runCoreMemoryTool,runCoreMemoryAdmin,runCoreMemoryReset} from './core-memory-tools';
import {runSyncedCaptions} from './core-shot-captions';
import {coreAsideMutation} from './core-asides';
import {runChatSummary,runChatRollover,runManualChat,appendChatArchive,runArchiveMerge,pruneLifecycleRecords,runChatFormation,commitLifecyclePlan} from './core-chat-lifecycle';
import {runOwnedHands} from './core-hands-policy';
import {remainingStore,applyRemainingPlan} from './core-remaining';
import {graphFingerprint,graphJob,graphFailure,graphPolicy,assertGraphCounter} from './graph-job';
import {corePolicySync} from './core-policy-sync';
import {coreStoreFor} from './core-store';
import {runCoreContinuation,runCoreDayNight,bindDayNightProject,boundDayNightProject,commitDayNightPlan} from './core-day-night';
import {runCoreWeek,runCoreStanding} from './core-own-time';
import {coreEntropyPolicy} from './core-policy-observations';
import {runCoreProjectStep,runCoreProjectBirth,runCoreReadingOutcome,runCoreProjectSettlement} from './core-projects';
import {appendPhoneTurn,type PhoneTurn} from './core-brain-history';
import { ProviderAvailability } from './provider-availability';
import {coreChatPrompt,corePrepareNaturalConversation} from './core-prompts';
import { markTurn, timeTurnReview, runTimedTurn, spanCountingSink } from './turn-timing';
import { conversationReplyIssue } from './conversation-contract';
import { veniceRegistryEntries } from './model-catalog';
import { runDreamLearning, learningNote } from './dream-learning';
import { runDreamNotebook, followupQuery, imaginationNote } from './dream-notebook';
import { DIRECT_MODELS, directCatalogEntry, nanoGptPricing, abliterationPricing, refreshDirectEntries } from './direct-catalog';
import { directCredentialName, directProviderKey, isDirectProvider, isAllowedTaskProvider } from './direct-providers';
import { taskIntent, selectTaskModel, nextTaskRole, routingTextHistory } from './task-router';
import { readOpenAIStream } from './openai-stream';
import { toResponsesBody, fromResponsesReply, streamResponses } from './responses-provider';
import { toAnthropicBody, fromAnthropicReply, streamAnthropic } from './anthropic-provider';
import { TaskBridge } from './task-bridge';
import { TaskController, activeTask } from './task-controller';
import {coreLook,coreHostedLook} from './core-perception';
import {noteCoreUserActivity,noteCoreGame} from './core-live-state';
import {coreLocalBudget} from './core-local-budget';
import {coreCloudFetch} from './core-cloud-provider';
import {coreModelFetch,coreModelCapabilities} from './core-model-provider';
import {coreHandsWhyNotAct,runCoreHands} from './core-hands';
import {coreTaskIntent,coreSelectTaskModel,coreInputProfile,coreFastConversationModel,coreNextTaskRole,provideNightFacts} from './core-router';
import { ReplyGate } from './reply-gate';
import { readModelRegistry, readTaskPolicy, isLocalConfig, type ModelEntry, type ModelRole, type RouteRequest } from './model-registry';
import {callRegistry,selectCallModel,CALL_ROUTE_ID} from './call-route';
import { assertOutboundSafe, guardedRequest } from './outbound';
import { app, BrowserWindow, dialog, ipcMain, Menu, type MenuItemConstructorOptions, nativeImage, nativeTheme, net, powerMonitor, protocol, safeStorage, screen, shell, desktopCapturer } from 'electron';
import { installConsole, broadcastConsole, consolePort } from './console';
installConsole();
import path from 'node:path';
import os from 'node:os';
import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { appendFileSync, copyFileSync, existsSync, readdirSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, statfsSync, watch, writeFileSync, type FSWatcher } from 'node:fs';
import { execFile, execFileSync, spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import AdmZip from 'adm-zip';
import { HaruStore } from './store';
import { AttentionExperiment, readAttentionMode } from './attention';
import { ActivityObservations, idleWithoutEyes, type ActivityObservation } from './activity-observation';
import { ActivityReporter } from './activity-reporter';
import { formatTimeOfDay, localDateKey, parseTimeOfDay, resolveDate, zonedNow } from './dates';
import { connectGoogle, disconnectGoogle, googleStatus, pullEvents, pullTasks, pushItem, pushTask, removeItem, removeTask, saveCredentials } from './google';
import { afterCooldown, afterEgoCooldown, egoInstruction, goodnightInstruction, IGNORE_THRESHOLD, IRRITATION_MAX, isGoodnight, isIgnoring, isLowEffort, isRedo, leverageInstruction, moodInstruction, nextEgo, nextIrritation, notTwiceInstruction, shoutInstruction, shoutState, type ShoutState, EGO, IRRITATION, IRRITATION_NOTCH, rescaleOldMood } from './mood';
import { nextPokeCount, pokeEmotion, pokeInstruction, pokeIrritation, pokeTier, type PokeKind } from './poke';
import { applyEvent, chooseIdleAction, cueLog, DEFAULT_VITALS, driftVitals, nextTickDelayMs, shouldPersistVitals, type Environment, type Lean, type Vitals } from './vitals';
import { classificationPrompt, EMOTION_SCHEMA, EMOTIONS, NEUTRAL_EMOTION, parseEmotion, type Emotion, type EmotionName, faceForEmotion, localEmotion } from './emotion';
import { withDiscoveredExpressions } from './expressions';
import { reportCapabilities, seesItsOwnScreen } from './capabilities';
import { followCalendar, chaseableOverdue, findItem, shiftDays, formatAgenda, itemStatus, missedInstruction, movedSaid, putOffInstruction, putOffUntil, relevantItems, readsAsAnswerToHer, readsAsBareReport, tickOffInstruction, readsAsDone, doneClause, readsAsNotDone, relativeDay, staleItemNamed, inventedTimeFor, raisedRecently, type ItemStatus, underwayClause, isUnderway, FOLLOW_UP_MS } from './agenda';
import { isRelaunchNotReturn, openingAngles, pickAngle, shouldPipeUp, PIPE_UP_CHANCE } from './opening';
import { blankSlateInstruction, blankSlateOpening, BODY_KEYS, readSlate, RESET_KEYS, slateIsNewer, SLATE_DISARM_MINUTES, strangerIdentityNote, strangerLean, STRANGER_VITALS, withoutPreSlate, withoutPreSlateDays, type BlankSlate } from './blankslate';
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
import { DOWNTIME_NOTICE_MS, backMessage, readLivenessFile } from './liveness';
import { answersHerOwnQuestion, looksLikeAnEcho, parseSecondThought, readsAsTheirAnswer, secondThoughtDelay, secondThoughtNote, wantsSecondThought, SECOND_THOUGHT_GAP_MS, SECOND_THOUGHT_ODDS } from './secondthought';
import { applyRevoices, dueForRevoice, exchangesFrom as revoiceExchanges, grounded, parseRevoices, readRevoiceState, revoicePrompt, withRewrites, REVOICE_EVERY, type Revoice } from './revoice';
import { decide, readEscalateConfig, type EscalateConfig } from './escalate';
import { turnImages, withImageBytes } from './core-harness-media';
import { describeFailure, fromOpenAIReply, isOpenAIShaped, promptUsage, toOpenAIBody, toolsUnsupported, DEFAULT_ENDPOINTS, type ChatTool, type Provider } from './provider';
import { formatPage, formatResults, readSearchConfig, lookItUpInstruction, readWebPage, SearchBlocked, searchWeb, type SearchConfig } from './search';
import { mayWander, pickDestination, readRoamConfig, refugeFrom, speedFor, step, nextWanderDelay, type Point, type RoamConfig } from './roam';
import { angleFor, mayNotice, noteNoticed, readNotices, type Page as NoticedPage, type PageState } from './noticing';
import { CAPTURE_HEIGHT, CAPTURE_WIDTH, readWatchingConfig, recentScene, sceneAsk, shouldLook, watchingPrompt, worthMentioning, type WatchingConfig } from './watching';
import { gameMemoryForPrompt, noteInGameMemory, openGameMemory, timesThisWeek, welcomePrompt } from './games';
import { buildGameIndex, gameFor } from './steam';
import { pdfPrompt, readPdf } from './pdf';
import { classify, discard, extractAudio, extractFrames, findFfmpeg, OPENABLE, readText, scratchDir, type FileKind } from './attach';
import { coreRenderPdfPages } from './core-attachment-files';
import { markTimeGaps, sinceLast, earlierDaysContext, recentWindow, earlierTurns, DAYS_OF_HISTORY, HISTORY_BUDGET_CHARS } from './history';
import { exchangesFrom, pickRecalled, recallNote, RECALL_FLOOR, RECALL_LIMIT, type Exchange } from './recall';
import { buildChatIndex, chatHitsNote, embedFormat, embedText, mentionsAny, rareTerms, searchChats, type ChatIndex } from './chatsearch';
import { applyExtraction, dayChunks, emptyGraph, EXTRACTION_SCHEMA, extractionInput, extractionPrompt, knownBlock, linkedFacts, linkedNote, readExtraction } from './factgraph';
import { admitBooking, bookedNote, bookedPrompt, BOOKED_KIND, createScheduler, describeWhen, resolveBookingTime, zonedEpoch, type Job, type Outcome } from './scheduler';
import {createCoreScheduler,activeScheduledJob} from './core-scheduler';
import { describeGap, emptyThoughtState, isRumination, keepThoughts, lastSpoken, mayAsk, mayInitiate, mindNote, noteAsked, pendingTrigger, readThoughts, roundVector, scoreThought, spend, spokenOn as thoughtsSpokenOn, THINKING_RULES, thinkingInput, THOUGHT_LIMITS, thoughtPrompt, withoutClock, type ThinkingState, type Thought, type ThoughtState, type Trigger } from './thoughts';
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
import { leftHanging } from './hanging';
import { theyAreUp, awakeMinutesSince } from './awake';
import { describeTold, placeToldFrom, toldTheyAreBusy, toldStillStands, type Told, errandsToldFrom, errandToAskAfter, type Errand } from './told';
import { markMentioned, upcomingToMention } from './upcoming';
import { directionsAskFrom, directionsNote, dropRouteTalk, matchNamedPlace, startingPoint, withDirections, withoutMapsLinks, type DirectionsAsk, claimsTraffic, withoutTrafficDenials } from './directions';
import { absorb, describeWhereabouts, distanceM, forgetPlace, homeOf, knownHaunt, namePlace, placeAt, readSpot, readWhereabouts, whereForPage, type Whereabouts, SPOT_STALE_MS, saidTheyWereGoing, unannouncedArrivalNote, withoutWhereDenials, type Arrival } from './whereabouts';
import { bodyForPage, describeBody, readBody as readBodyState, readBodyReport, type Body } from './body';
import { convertImage, normaliseFormat, FORMATS } from './convert';
import { cancelPower, closeApp, findApps, isCancellable, launch, listRunning, matchApp, matchRunning, normalisePower, POWER_DELAY_S, readDesktopConfig, runPower, supportedDesktop, type DesktopConfig } from './desktop';
import { looksLikeScreenshot, maySpeak, readScreenshotConfig, screenshotPrompt, SETTLE_MS, SETTLE_TRIES, type ScreenshotConfig } from './screenshots';
import { look, photoName, readShotDescription, readVisionConfig, whileLooking, type VisionConfig } from './vision';
import { BackgroundInferenceDeferred, InferencePriority } from './inference-priority';
import { CAPTION_MAX_CHARS, captionsSince, describedShots, forgetCaptions, moreThanOnePass, noteCaption, noteFailure, readCaptions, shotsNeedingALook, shotsSince } from './seen';
import { breaksMute, brokeMuteNote, isMuted, muteNote, readMuteAsk, unmuteNote, weighMute, type MuteState } from './mute';
import { LAYER, compileLog, type Candidate } from './compile';
import { normFrom, charterTraits, feelingsShowAt, fuseOf, growMonth, growthNote, readTraits, traitLean, traitMeter, travelled, TRAIT_NAMES, type GrowthStep, type MonthSignals, type Traits } from './growth';
import { muteLean, sway, type Sway } from './dice';
import { NO_FEELINGS, FELT, feel, feelingsInstruction, feelingsLog, feelingsOverTime, readFeelings, readsAsBanter, readsAsEnding, readsAsScare, type FeelingEvent, type Feelings } from './feelings';
import { addLeans, bruiseFrom, eventSize, fadeBruise, howHisReturnLands, rollTemperament, stepWander, temperamentLean, temperamentLine, temperamentWord, type Temperament, type TemperamentKind } from './temperament';
import { EXPRESSIVE, HOSTED_VOICE, LAST_WORD, NATURAL, NO_INVENTED_HISTORY, NO_ABANDON_THREAD, readsAsRough, roomInstruction, HER_EMOJI, emojiRut, roomToRant, askingAboutHer, herSubjectNote, namesIn, justTalking, JUST_TALKING_NOTE } from './room';
import { roomHeldBack } from './rantgate';
import { journalStance } from './journal';
import { haruNote, rangeStats, type HaruNote, type RangeName, type RangeStats } from './journal';
import { describeRating, entryFor, journalPrompt, readEntries, readJournalConfig, readRating, recentTrend, shouldAsk, upsertEntry, SCALE_MAX, type JournalConfig, type JournalEntry } from './journal';
import { formatList, formatMedia, formatMissing, lookUp, readAniListConfig, userList, type AniListConfig, type ListEntry, type MediaKind } from './anilist';
import { createDesktopShortcut, desktopShortcutPath, isAutoStartEnabled, setAutoStart, startedHidden } from './startup';
import { answersThePrompt, CUE_NOTE, isCue, stageNote, dropRoleHeader, dropTackedOnParagraphs, dropInventedContact, dropInventedScreenTalk, dropRepeatedAgendaMentions, dropRepeatedParagraphs, dropStageDirections, dropRepeatedOpener, dropEchoOpener, dropRepeatedSentences, fixStatedClock, fixStatedReminderTime, dropOverusedEmoji, oneEmojiAtMost, dropClosingOrder, thinksAloud } from './reply';
import { runToolLoop } from './toolloop';
import { composeLocalReply, finishLocalReply as finishLocalReplyUntimed, localReplyEvidence, GROUNDED_REPLY_SCHEMA } from './local-reply';
import { canReplyDirectly, directReplyKind, directReplyAsideAllowed, composeConversationalReply, CONVERSATIONAL_REPLY_SCHEMA, VoiceReplyNeedsReview, directReplyEvidence, requestContextSize } from './reply-latency';
import { createTurnContext, type TurnContext } from './turncontext';
import { chatTools, coerceKnowledgeCategory, downloadsRelevant, machineRelevant, runChatTool, shellRelevant, steadyTable, type ToolAvailability, type ToolDeps } from './tools';
import { describeMyself, describeSettings, explicitModeOn, planChange, readSelfSnapshot, SETTINGS, type SettingPlan } from './self';
import { pickBreath } from './breaths';
import { createMemoryStore } from './memorystore';
import { captureCorePromptComparison, prefetchCoreMemory, prepareCoreMemory, readCoreMemoryConfig, replacePromptProfile, selectCoreMemory, withoutCoreGraphClaims, type CoreMemoryRequest } from './core-memory';
import { createKnowledgeStore } from './knowledgestore';
import { behaviourOf, chatSystemPrompt, chatDynamicContext, FIRST_PERSON_NOTE, freshStartInstruction, type FreshStart, type RatedReply, LENGTH_RULE_LOCAL, LENGTH_RULE_HOSTED } from './prompt';
import { hasShout, readVoiceConfig, referenceFor, shoutReference, spokenCase, speakableText, splitForSpeech, streamedSentences, synthesise, synthesiseBreezeStream, type SpeechClip, type VoiceConfig, looksClipped, HUME_DESCRIPTIONS, HUME_STREAM_URL, planVoice } from './voice';
import { readHumeConfig } from './hume';
import { voiceSense, analyzeLocalVoice, fromHume } from './voice-sense';
import { readEviConfig, newSessionId, secondsUsedToday, noteUsage, underCap, callAside } from './evi';
import { readCallConfig, pickFiller } from './call';
import { openLocalCall, withoutWavHeader, oneChunk, wavSampleRate } from './localcall';
import { openEviSession } from './evibridge';
import { setDefaultAutoSelectFamilyAttemptTimeout } from 'node:net';
import { readBrowserControlConfig } from './browserctl';
import { listSessions, openSession, readClaudeCodeConfig, readOpenedSessions, resolveSessionDir, sessionName, SESSIONS_KEPT as CLAUDE_SESSIONS_KEPT, stopSession, type SessionHost } from './claudesession';
import { ShellGate, SERVER_NOTE, DIAGNOSTIC_NOTE, denied, ledgerEntry, readShellConfig, runCommand } from './shell';
import { readWhatsAppConfig, readHeard, isForHer, asTurn, asOverheard, chatLabel, splitForWhatsApp, gapBefore, sendThroughWorker, type WhatsAppConfig, type Heard as WhatsAppHeard } from './whatsapp';
import { Overheard, isLoopback, overheardPrompt, overheardInput, OVERHEARD_SCHEMA, readPlans, keepable, asKept, factsFor } from './overheard';
import { HANDS_TURN, HER_HANDS_TOOLS, didNothing, handsInstruction, handsNote, handsToday, keepHands, readHands, readHandsConfig, whyNotAct } from './herhands';
import { withToolContract } from './tool-contract';
import { receivedProviderMessage } from './provider-state';
import {runMangaFetch} from './manga-fetch';
import { Suwayomi, fetchFits, fetchSummary, hisReading, hisReadingNote, matchManga, onHisShelf, readerLink, readSuwayomiConfig, spiteful, type HisTitle, SPITE_ODDS } from './suwayomi';
import { serverLookNote } from './prompt';
import { Downloads, downloadsReady, readDownloadsConfig } from './downloads';
import { applyDecay, DEEP_RECALL_LIMIT, findSuperseded, formationPrompt, formationWindows, MEMORIES_PER_DAY, readFormation, type FormedNote, formatMemoryPrompt, isExplicitRecall, closeEvents, isWorthAnEvent, isWorthKeeping, isWorthRemembering, MEMORY_KINDS, migrateMemories, monthFoldPrompt, pruneMemories, readsAsSecondPerson, rememberInto, retrieveMemories, semanticSimilarities, summaryPrompt, supersede, THIRD_PERSON_AGAIN, vectorSimilarity, type ForgettingEntry, type MemoryKind, type MemoryRecord, type MemorySource, type RetrievalFactors, type ScoredMemory, type SessionSummary } from './memory';
import { consolidateMemories, type ConsolidationChange } from './consolidation';
import { appendToBlockValue, canEditBlock, findBlock, formatMemoryBlocks, replaceInBlockValue, resolveBlockValue, resetBlockToDerived, withEditedValue, type BlockSources, type MemoryBlock } from './blocks';
import { forgetDevice, forgetEveryDevice, readWebAccess, setPassword, weakPassword, type WebAccess } from './web';
import { conversationMayLeave, mayLeaveTheMachine, outboundNamesFrom } from './sensitivity';
import { makePicture, PictureRefused } from './venice-image';
import { fetchWebPicture } from './web-picture';
import {commitUserRecord,runOwnedJournal} from './core-user-records';
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
import { ageNote, openingsToAvoid, pickToBringUp, REMEMBERED_PICKS } from './bored';
import { coreComposeNudge } from './core-nudge-composer';
import { coreSourceNudges, coreNudgeContext, sameSourceSnapshot, type SourceSnapshot } from './core-nudge-context';
import { nudgeMetadata,coreReserveDelivery, coreFinishDelivery, sameCoreDelivery, corePublishNudge, corePickNudge, coreSelectPhoneNudge, claimCorePhoneNudge, coreScanPhoneNudges, sameCorePhoneScan, coreRateNudge, coreLearnNudgeResponse, sameCoreFeedback } from './core-nudges';
import { interestTopic, nudgeContentProblem, nudgeContinuity, nudgeMood, nudgePrompt, nudgeReviewTurns, NUDGE_REVIEW_SCHEMA, NUDGE_REVIEW_MAX_TOKENS, ownNudgeCandidates, pickNudgeCandidate, publishNudge, readNudge, readNudgeReview, recentNudgeTopics, type NudgeCandidate, type NudgeDraft, type NudgeFeedback } from './nudges';
import { PHONE_NUDGE_GAP_MS, PHONE_NUDGE_LIMIT, PHONE_SCAN_MS, finishPhoneDelivery, learnPhoneReply, migratePhoneDeliveries, phoneCandidateRelevant, phoneDeliveryAllowed, readPhoneNudges, reservePhoneDelivery, scanPhoneOpportunities, selectPhoneOpportunity } from './nudge-schedule';
import { isNudgeAside, learnNudgeResponse, nudgeAffinity, nudgeKeywords, rateNudge, readNudgeLearning, validNudgePreference, type NudgeMessage } from './nudge-learning';
import { chooseNudgeDelivery, connectNudgeCandidates, conversationNudgeCandidates, relationshipNudgeCandidate, taskNudgeCandidates } from './nudge-context';
import { resolveReply, withReplyContext } from './replyto';
import { ANSWER_WINDOW_MS, grudgeAfterApology, grudgeInstruction, irritationAfterTally, nextGrudge, tallyDue, unanswered, type Said } from './grudge';
import { groundedInstruction, placeQuery } from './places';
import { daySaid, TOLD_ENOUGH, type DaySaid, DEFAULT_BEDTIME_MINUTES, howTheDayWent, nightfallDue, type DayVerdict } from './nightfall';
import { keepNights, lastNightDay, nightNoteInstruction, nightsInstruction, nightsOn, nightsToDrawOn, pickInstruction, tidyPick, timeForSomething, type Night, NIGHT_ODDS } from './nightlife';
import { chooseGuide, gamesPlayedLately, GUIDE_ODDS, guideNoteInstruction, guideQuery, pickGame, withSteam, type Played } from './gamenight';
import { addressesSomeone, adopt, ADOPT_ODDS, adoptInstruction, deepen, deepenInstruction, isOneOfTheirs, MAX_INTERESTS, nightQuery, NOBODY_HERE, parseAdoption, parseDeepening, pickTonight, tastesInstruction, unaddressed, type Interest } from './tastes';
import { readSteamWebConfig, recentlyPlayed } from './steamweb';
import { appendDream, appendEntry, diaryContext, diaryDueFor, diaryInstruction, DIARY_FILE, DREAMS_FILE, recentEntries, type Dream, type Entry } from './diary';
import { liftedFrom, NOT_THOSE_LINES, NOT_THOSE_NAMES, unknownNames } from './diaryvoice';
import { fetchTranscript, formatTranscript, titleFrom, transcriptInstruction, transcriptsAvailable, videoIdFrom, watchUrl } from './transcripts';
import { feedbackEntry, modelThatSpoke, readSpoke, recordFeedback, rememberSpoke, repliedTo, type FeedbackEntry } from './feedback';
import { appendTuningPage, recordTuning, tuningNote } from './tuning';
import { describePull, isTailnetAddress, mergeCheckIns, readCheckInSource } from './checkinsource';
import { describeMerge } from './memorysync';
import { describeShot, mergeActivity, noteActivity, noteScreenshot, summariseDay } from './activitylog';
import { heldShots, keepShot, localShots, missingFrom, pruneShots, readShot, MAX_SHOT_BYTES } from './shotstore';
import { AnimeLink, apiKeyFrom, readAnimeConfig, type Fetch as AnimeFetch } from './anime';
import { ANIME_FETCH_KIND, FETCH_EVERY_MS, FETCH_FOR_MS, fetchJob, fetchState, gaveUpFallback as fetchGaveUpFallback, gaveUpPrompt as fetchGaveUpPrompt, GONE_AFTER_MISSES, importPlan, LANDING_EVERY_MS, landedFallback, landedPrompt, queueLineFor } from './animefetch';
import { startWebServer, type WebDeps } from './webserver';
import { openingInstruction, openingsDueNow, type DueOpening } from './standingtime';
import { parseVaultMemoryPage, VAULT_MEMORY_PAGES, type VaultMemoryPage } from './vaultmemories';
import { planRetirement, readAdmitted, recordsToRetire, type Admitted } from './vaultretire';
import { cleaningChunks, deliveryReminder, deliveryRule, hasDeliveryLabel, splitDelivery, stripDelivery, MOOD_ALIASES } from './delivery';
import { deedFrom, isADeed, keepDeed, readDeeds } from './deeds';
import { DeedFeelings } from './deed-feelings';
import { reportsAttentionElsewhere } from './feelings';
import { isHerStanding } from './herstanding';
import { enoughToStandOn, herStandings, keepSlight, parseStanding, readSlights, recentIncidents, slightsAsIncidents, standingDue, standingPrompt, HER_SUBJECT, type Incident, type Slight } from './herstanding';
import { blockedLine, asleepLine, backToSleep, dayAfter, decideTimesSystem, dozeOffDue, enoughKnocking, fallbackSchedule, foldAsleepExchanges, goodnightDue, groggyFor, groggyNote, herAsleep, isAsleepLine, knockedAwake, messagesWhileAsleep, parseDecidedTimes, pointlessWake, pointlessWakesLately, readsAsGoodnight, readHerSleep, readHerSleepState, readWakes, sleepNote, sleepWindowOn, wakeIrritation, wakeNote, wokenAt, clockMinutes, BLOCKED_LINE, BLOCK_AFTER_POINTLESS, KNOCK_WINDOW_MS, WAKES_KEPT, type HerSleepSchedule, type Wake } from './hersleep';
import { parseBalances, balanceWarning } from './venicebalance';
import { dayNote, dayNoteInstruction, dayPassDue, dayPickInstruction, firstsNote, keepDay, markRecFollowed, noteRecommendation, pickRecommend, readDays, readRecs, readWeek, recDueForFollowUp, reconcileWants, recsAnsweredBy, recsOnDay, wantOutcome, weekKey, weekNote, weekReflectionInstruction, weekSummaryDue, WANT_ODDS, type HerDay, type HerWeek, type Rec, DAY_ODDS } from './ownlife';
import { admits, advanceProject, asProject, beatenTwiceAt, childOf, dueForRevisit, judgeAttemptInput, judgeAttemptPrompt, DAY_PROJECT_SHARE, hersOwn, keepProjects, needsHim, needsSomethingNew, newProjectInstruction, nowItStings, pickProject, projectInstruction, projectQuery, projectsNote, readAttemptVerdict, readProjects, revisit, settleFromRead, roomForNew, siblingOf, spawnInstruction, staleSpawns, standingIn, stepInstruction, stripProject, type Outcome as NightOutcome, type Project, type Worked } from './projects';
import { inQuietHours, newVapidKeys, pushRequest, readPushDevices, readPushPrefs, type PushDevice, type PushPrefs, PUSH_BREATHER_MS, tooSoonToPush, heldBack, withoutDevice, isPhoneWebApp, coveredByNativeApp } from './push';
import { CHECK_EVERY_MS, describeUpdate, progressStep, whyNotCheck, type UpdateState } from './updates';
import { BREVITY, summonedLine } from './summoned';
import { CHOICES_TOOL, readChoices } from './choices';
import { quickAnswer, settingCommand, type AgendaLine } from './quick';
import { newTrace } from './trace';
import { ToolLoopFailure } from './toolloop';
import { ConversationPreferenceCache } from './conversation-continuity';
import { needsGroundedConversationReview } from './local-reply';
import { naturalConversationKind, naturalConversationEligible, naturalCallAllowed, conversationCallAllowed, prepareNaturalConversation, type NaturalConversationSources, answerNaturalConversation, answerLocalNaturalConversation, selectFastConversationModel, NATURAL_GROUNDED_REPLY_SCHEMA, NATURAL_MAX_TOKENS, NATURAL_FIRST_WORD_MS } from './natural-conversation';
import { emptyKnowledge, KNOWLEDGE_CATEGORIES, knowledgeStats, type KnowledgeCategory } from './knowledge';
import type { IngestResult } from './ingestion';
import type { Embedder } from './embeddings';
import { retrieveContext } from './retrieveContext';
import { HARU_FOLDER, type VaultSyncReport } from './obsidian';
import { diaryNotes, herNote, indexNote, memoriesNote, nightNotes, placesNote, standingNote, writeNotes } from './vault';
import { categoryOf, LEGACY_KIND, namesSomeoneElse, readSorting, sortInput, sortPrompt, type SortNote, type Sorted } from './categories';
import { collectAll, collectDocker, collectDockerLight, collectGpu, collectGpuApps, collectProcesses, collectServices, collectSystem, diagnose, KNOWN_SERVICES, USER_SERVICES, type Diagnosis } from './system';
import { carriedSamples, checkEvents, sampleFromCollectors, type EventThresholds, type SystemSample } from './systemState';
import { warnLine } from './brain-warn';
// 4050: warnings go to stderr, which the Core keeps private and throws away, so a refused background call was invisible
// (the month fold, the after-turn lines). Each also prints one content-free stdout line, tag and error code only.
{const warn=console.warn.bind(console),error=console.error.bind(console),seen=new Map<string,number>();
 const tee=(write:(...a:unknown[])=>void)=>(...args:unknown[])=>{write(...args);try{const line=warnLine(args,Date.now(),seen);if(line)process.stdout.write(line+'\n');}catch{}};
 console.warn=tee(warn);console.error=tee(error);}

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
/** Said once a run, not once a tick: the backlog is looked at every few minutes. */
let saidShotsBeforeSlate = false;

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
const inferencePriority = new InferencePriority({ timing: event => console.log(`[inference-priority] ${JSON.stringify(event)}`) });

function protectedInferenceEndpoint(): string {
  const brain = store.get('ai.config') as ProviderConfig | undefined;
  return corePolicySync<string>('inference-priority.protectedEndpoint',[brain?.endpoint??null,Boolean(brain&&isLocalConfig(brain)),LOCAL_MODELS]);
}

async function backgroundLook(...args: Parameters<typeof look>): ReturnType<typeof look> {
  const [image, vision, endpoint, headers, fetcher, options = {}] = args;
  return inferencePriority.runBackground(endpoint, protectedInferenceEndpoint(), signal =>
    ownedLook(image, vision, endpoint, headers, fetcher, { ...options, signal,
      ...(({priority:'background' as const})) } as typeof options));
}

function ownedLook(...args:Parameters<typeof look>):ReturnType<typeof look> {
  return coreLook(args,{rpc:taskBridge.call,policy:()=>readTaskPolicy(store.get('ai.taskPolicy')),
    registry:()=>readModelRegistry(store.get('ai.modelRegistry'),{
      local:(store.get('ai.config') as ProviderConfig|undefined)??{provider:'ollama',model:args[1].model,endpoint:args[2],temperature:.2},
      conversation:store.get('ai.conversation') as ProviderConfig|undefined,specialist:store.get('escalate.provider') as ProviderConfig|undefined,
      vision:{...args[1],endpoint:args[2]},
    })});
}

async function lookAtSyncedShots() {
  {
    const core=remainingStore(app.getPath('userData')); const root=shotStoreRoot();
    await runSyncedCaptions({core,held:()=>existsSync(root)?heldShots(root):{},exists:()=>existsSync(root),
      busy:()=>lookingAtShots,lock:on=>{lookingAtShots=on},
      urls:()=>{const cfg=core.get('config',{}),values=[cfg.vision?.endpoint,cfg.ai?.config?.endpoint,'http://localhost:11434'];
        return Object.fromEntries(values.filter(v=>typeof v==='string').map(value=>{const endpoint=String(value).trim();try{const u=new URL(endpoint);return [endpoint,{hostname:u.hostname,href:u.toString()}]}catch{return [endpoint,{}]}}));},
      addresses:()=>Object.values(os.networkInterfaces()).flatMap(rows=>(rows??[]).map(row=>row.address)),
      read:shot=>readShot(root,shot.day,shot.name),
      look:(bytes,request)=>backgroundLook(bytes.toString('base64'),request.vision,request.endpoint,modelHeaders(request.endpoint),net.fetch,request.options),
      deferred:error=>error instanceof BackgroundInferenceDeferred,
    });return;
  }
}

const knowledgeFile = process.env.HARU_KNOWLEDGE_FILE ? process.env.HARU_KNOWLEDGE_FILE : path.join(app.getPath('userData'), 'knowledge.json');
const storeOptions = { cwd: app.getPath('userData'), knowledgeFile };

// Opening and recovery share the actual user-data paths. A corrupt config is
// replaced by its newest valid backup, keeping healthy files and damaged bytes.
let store: HaruStore;
let storeWasRecovered = false;
try {
  store = new HaruStore(storeOptions);
} catch (error) {
  console.warn('[store] could not open the store:', error instanceof Error ? error.message : error);
  if (!HaruStore.recoverBackups(storeOptions)) throw error;
  // Files of hers came back damaged and were replaced from a backup: whatever
  // was between the backup and now, she does not have any more (feelings.ts).
  storeWasRecovered = true;
  store = new HaruStore(storeOptions);
}
store.migrate();
store.hardenPermissions();
console.log(`[memory-authority] ${store.memoryBackend()} storage ready`);
// Her sleeping hours move the conversation route (route_admission.py). Facts only, read live.
provideNightFacts(()=>({sleep:store.get('her.sleep'),sleepState:store.get('her.sleepState'),now:zonedNow(CHAT_TIMEZONE)}));

// Her own model names are long, mixed-case and full of separators ? the exact
// shape the outbound entropy rule hunts for. One of them sitting in a tool
// result (describe_myself, above all) was refusing the whole conversation, so
// they are cut out of the text before the patterns run. Read live from the
// store: a changed brain needs nothing re-registered.
outboundNamesFrom(() => {
  const names: string[] = [];
  const models = [
    (store.get('ai.config') as { model?: string } | undefined)?.model,
    (store.get('ai.conversation') as { model?: string } | undefined)?.model,
    (store.get('ai.nudge') as { model?: string } | undefined)?.model,
    (store.get('ai.awayConfig') as { model?: string } | undefined)?.model,
  ];
  for (const model of models) {
    if (typeof model !== 'string' || model.length < 8) continue;
    names.push(model);
    // She names it by the tail ? "Qwen3.8-27B-Heretic-?", without the path ?
    // and the tail alone is its own long mixed-case run.
    const tail = model.split('/').pop() ?? '';
    if (tail.length >= 8) {
      names.push(tail);
      if (tail.length > 48) names.push(tail.slice(0, 45)); // shortModelName's cut
    }
  }
  return names;
});

// The reset, fired where her brain actually is (blankslate.ts). An environment
// variable and not a route: this destroys a year of her, and the one thing it
// must not be is a thing a phone with a stale cookie can do. Set it in the unit
// file, restart her, take it back out.
//
// Here rather than in whenReady, because the first memory sync runs on startup
// and a reset after it has already merged back the very memories it is clearing.
if (process.env.HARU_RESET === '1') {
  // Self-disarming, because the variable outlives the intention: the drop-in is
  // removed by hand and Restart=on-failure is three seconds away, so a crash on
  // the way up would wipe her again — with a new timestamp, which every body
  // would then follow a second time (SLATE_DISARM_MINUTES).
  const stood = Date.parse((store.get('her.slate') as { at?: string } | undefined)?.at ?? '');
  const sinceMinutes = Number.isFinite(stood) ? (Date.now() - stood) / 60_000 : Infinity;
  if (sinceMinutes < SLATE_DISARM_MINUTES) {
    console.log(`[reset] HARU_RESET is set, but she was reset ${Math.round(sinceMinutes)} minute(s) ago — refusing to fire again. Take the drop-in out.`);
  } else {
    console.log('[reset] HARU_RESET is set — she is waking up with nothing');
    resetHer();
  }
} else if (process.env.HARU_BODY_CLEAR === '1') {
  // The limb's own version: drop the life this machine led while it was a
  // second her, keep what he typed, leave no slate. Her memories come back down
  // on the next pull, which is the whole point of being a mirror.
  console.log('[reset] HARU_BODY_CLEAR is set — this machine is letting go of its own life');
  resetHer({ body: true });
}

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
  sendToWindows('live2d:changed', model);
}

function broadcastChatReset() {
  sendToWindows('chat:reset');
}

// The "chat day" runs from CHAT_RESET_HOUR to CHAT_RESET_HOUR the next day, not
// midnight to midnight — chatting with Haru at 1am shouldn't get wiped by a plain
// date rollover mid-conversation.
let dayKeyAt = 0, dayKeyHeld = '';
function currentChatDayKey(): string {
  // 3520: asked seven times a turn; the day rolls at a fixed hour, so a key is good for a second.
  const now = Date.now();
  if (now - dayKeyAt >= 1000) { dayKeyHeld = corePolicySync('chat-lifecycle.dayKey',[now,CHAT_TIMEZONE,CHAT_RESET_HOUR]); dayKeyAt = now; }
  return dayKeyHeld;
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
  return corePolicySync('chat-lifecycle.activityDigest',[store.get('activityLog',true),store.getActivityLog()[day]??[]]);
}

function summariseSession(messages: { role?: string; content?: string }[], day: string, { replace = false, attempt = 0 } = {}) {
  void runChatSummary('day',day,messages,replace,{core:remainingStore(app.getPath('userData')),
      model:r=>ollamaPost(r.messages,r.config,r.options),
      form:c=>{void formDayMemories(c.lines,c.doing,c.day,c.config,c.messageCount);}})
      .catch(error=>console.warn('[memory] Core summary refused:',error instanceof Error?error.message:'failed'));return;
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
  void runChatSummary('month',month,[],true,{core:remainingStore(app.getPath('userData')),
      model:r=>ollamaPost(r.messages,r.config,r.options),form:()=>{}})
      .catch(error=>console.warn('[memory] Core month fold refused:',error instanceof Error?error.message:'failed'));return;
}

/**
 * A day's conversation as the distilling passes read it. Labelled `They:` and
 * `Haru:` rather than `Them:` and `You:`: the note the model is about to write
 * goes into her own system prompt, where "you" is her — so the input must not
 * contain a second person at all, and the word the note should use for the
 * user is the word its lines already carry.
 */
function dayLines(messages: { role?: string; content?: string }[]): string[] {
  return corePolicySync('chat-lifecycle.dayLines',[messages]);
}

/** Sort notes into categories on this machine's own model (categories.ts): new memories, and a day's formed notes as a second opinion. */
async function sortNotes(notes: SortNote[]): Promise<Map<string, Sorted> | null> {
  {
    const request=corePolicySync<any>('chat-lifecycle.sortStart',[notes,store.get('ai.config')??null,getProfile().nickname,notes.map(n=>localDateKey(zonedNow(CHAT_TIMEZONE,new Date(n.createdAt))))]);
    if(!request)return null;
    const message=await ollamaPost(request.messages,request.config,request.options);
    return new Map(corePolicySync('chat-lifecycle.sortRead',[message.content??'',notes]));
  }
}

/**
 * The second pass over a finished day: what it taught her about him, of every
 * kind (memory.ts formationPrompt), read a window at a time over the whole day,
 * gated, and kept with its category and day. Runs after the summary lands, in
 * the same quiet background rhythm — never urgent.
 */
async function formDayMemories(lines: string[], doing: string, day: string, config: ProviderConfig, messageCount: number) {
  {
    const action=corePolicySync<string>('chat-lifecycle.formAdmission',[forming,lines,doing]);
    if(action==='busy')return;
    if(action==='mark'){markFormed(day,messageCount);return;}
    if(action!=='begin')throw Error('core_form_admission_protocol');
    forming=true;
    try{
      const success=await formFrom(lines,doing,day,config),core=remainingStore(app.getPath('userData'));
      const outcome=corePolicySync<any>('chat-lifecycle.formFinish',[core.docRef('config',{}),day,messageCount,success,Object.fromEntries(formRetries),Date.now()]);
      if(outcome.plan)commitLifecyclePlan(core,outcome.plan);
      if(success)await writePortrait(config);   // 3890: the portrait follows the day's memories, once a day
      formRetries.clear();for(const [key,value] of Object.entries(outcome.retries))formRetries.set(key,value as {tries:number;until:number});
    }finally{forming=false;}return;
  }
}

/** 3890: one paragraph about him from everything kept, written once a day after the day pass into config.portrait (the portrait block). */
async function writePortrait(config: ProviderConfig): Promise<void> {
  try{
    const core=remainingStore(app.getPath('userData'));
    const ask=corePolicySync<any>('chat-lifecycle.portraitAsk',[core.docRef('config',{}),core.docRef('memories',{}),core.docRef('graph',{}),localDateKey(zonedNow(CHAT_TIMEZONE))]);
    if(!ask)return;
    const text=await ollamaQuipLong(ask.system,ask.user,config);
    const plan=corePolicySync<any>('chat-lifecycle.portraitPlan',[core.docRef('config',{}),text,ask.day,new Date().toISOString()]);
    if(plan)commitLifecyclePlan(core,plan);
    console.log(`[portrait] ${plan?'written':'rejected'} from ${ask.notes} notes (${text.length} chars)`);
  }catch(error){console.warn('[portrait]',error instanceof Error?error.message:'failed');}
}

/**
 * Day → how many times forming it has failed and when to try again. A day the
 * model keeps failing on (a window it cannot read, a context it overflows)
 * would otherwise be the newest unformed day at every tick: paid for every
 * two minutes, for as long as the app runs, and standing in front of every
 * older day. Backing off — doubling from the tick, capped at a day — lets the
 * tick move on to the days behind it and still comes back, so an outage on
 * the model's side loses nothing. Held in memory: a restart tries afresh.
 */
const formRetries = new Map<string, { tries: number; until: number }>();
const FORMING_RETRY_CAP_MS = 24 * 3_600_000;

function noteFormingFailed(day: string): void {
  {
    const result=corePolicySync<any>('chat-lifecycle.formRetry',[day,Object.fromEntries(formRetries),Date.now()]);
    formRetries.clear();for(const [key,value] of Object.entries(result.retries))formRetries.set(key,value as {tries:number;until:number});return;
  }
}

/** Days already read for memories, with how many messages they had: a day that has grown is read again. */
function formedDays(): Record<string, number> {
  return corePolicySync('chat-lifecycle.readFormed',[remainingStore(app.getPath('userData')).docRef('config',{})]);
}

function markFormed(day: string, messageCount: number): void {
  {
    const core=remainingStore(app.getPath('userData'));commitLifecyclePlan(core,corePolicySync('chat-lifecycle.markFormed',[core.docRef('config',{}),day,messageCount]));return;
  }
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
  {
    const archive=store.getArchive(),config=store.get('ai.config') as ProviderConfig|undefined;
    const lengths=Object.fromEntries(Object.entries(archive).map(([k,v])=>[k,v.length]));
    const day=corePolicySync<string|null>('chat-lifecycle.formChoose',[forming,config??null,getMood().lastMessageAt??null,currentChatDayKey(),lengths,formedDays(),Object.fromEntries(formRetries),Date.now()]);
    if(!day){   // 3950: no memories to form; catch up a day note that never got written (same tick, same backoff map under 'summary:<day>')
      const missing=corePolicySync<string|null>('chat-lifecycle.summaryChoose',[forming,config??null,getMood().lastMessageAt??null,currentChatDayKey(),lengths,getSessions(),Object.fromEntries(formRetries),Date.now()]);
      if(!missing){   // 4000: then a month with day notes but no month note; the startup fold ran outside a job scope and a hosted model refused it (cloud_task_required)
        const month=corePolicySync<string|null>('chat-lifecycle.monthChoose',[forming,config??null,getMood().lastMessageAt??null,currentChatDayKey(),getSessions(),getMonthNotes(),Object.fromEntries(formRetries),Date.now()]);
        if(!month)return;
        const folded=await runChatSummary('month',month,[],true,{core:remainingStore(app.getPath('userData')),model:r=>ollamaPost(r.messages,r.config,r.options),form:()=>{}}).catch(()=>'provider_failed');
        console.log(`[memory] month note catch-up ${month}: ${folded}`);
        if(folded!=='saved')noteFormingFailed('month:'+month);
        return;
      }
      const result=await runChatSummary('day',missing,(archive[missing]??[]) as unknown[],false,{core:remainingStore(app.getPath('userData')),model:r=>ollamaPost(r.messages,r.config,r.options),form:()=>{}}).catch(()=>'provider_failed');
      console.log(`[memory] day note catch-up ${missing}: ${result}`);
      if(result!=='saved')noteFormingFailed('summary:'+missing);
      return;
    }
    const messages=(archive[day]??[]) as {role?:string;content?:string}[];
    await formDayMemories(dayLines(messages),activityDigest(day),day,config!,messages.length);return;
  }
}

/** One day's windows, gated, second-guessed and kept. False when the model could not be reached, so the day is tried again. */
async function formFrom(lines: string[], doing: string, day: string, config: ProviderConfig): Promise<boolean> {
  return runChatFormation([lines,doing,day,config,getMemories(),getProfile().nickname,Date.now()],{core:remainingStore(app.getPath('userData')),day,
    model:r=>ollamaPost(r.messages,r.config,r.options),sort:notes=>sortNotes(notes),
    add:c=>addMemory(c.text,c.memoryKind,undefined,c.options)});
}

/**
 * Raw transcripts have a shelf life: once a day has its summary, the transcript
 * has given what it has to give, and keeping the sensitive past verbatim is a
 * retention problem with no recall benefit. Runs at startup and on the daily
 * tick; a day without a summary is never touched.
 */
function pruneOldArchives() {
  pruneLifecycleRecords(remainingStore(app.getPath('userData')),'archive',Date.now(),Intl.DateTimeFormat().resolvedOptions().timeZone);pruneOldActivity();return;
}

/**
 * The activity log on the same clock as the transcripts, and for the same
 * reason: once a day has been distilled into a summary and whatever events
 * survived the gate, the minute-by-minute record has given what it has to give.
 * Keeping a browsing history past that point is retention with no recall behind
 * it — the more so for this file, which is the one holding raw titles.
 */
function pruneOldActivity() {
  const ownedRetention=(pruneLifecycleRecords(remainingStore(app.getPath('userData')),'activity',Date.now(),Intl.DateTimeFormat().resolvedOptions().timeZone));
  const log = store.getActivityLog();
  const cutoff = ownedRetention?ownedRetention.cutoff:localDateKey(new Date(Date.now() - ACTIVITY_RETENTION_DAYS * 86_400_000));
  const sessions = getSessions();
  let dropped = 0;
  for (const day of (ownedRetention?[]:Object.keys(log))) {
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
  if(ownedRetention){const core=remainingStore(app.getPath('userData'));const plan=corePolicySync<any>('chat-lifecycle.captionPlan',[core.docRef('config',{}),cutoff]);if(plan)commitLifecyclePlan(core,plan);return;}
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
  appendChatArchive(remainingStore(app.getPath('userData')),dayKey,messages);return;
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
  runArchiveMerge(remainingStore(app.getPath('userData')),localDateKey(zonedNow(CHAT_TIMEZONE)).slice(0,7),command=>{
      if(command.kind==='summary')summariseSession((store.getArchive()[command.day]??[]) as {role?:string;content?:string}[],command.day,{replace:command.replace});
      else if(command.kind==='fold')foldMonth(command.month,store.get('ai.config') as ProviderConfig);
      else throw Error('core_chat_backfill_protocol');
    });return;
}

function startNewConversation() {
  runManualChat(remainingStore(app.getPath('userData')),currentChatDayKey());stopSpeaking();broadcastChatReset();return;
}

function performChatResetIfDue() {
  runChatRollover(remainingStore(app.getPath('userData')),currentChatDayKey(),command=>{
      if(command.kind==='summary')summariseSession(command.messages,command.day,{replace:command.replace});
      else if(command.kind==='fold')foldMonth(command.month,store.get('ai.config') as ProviderConfig);
      else if(command.kind==='grow')growAtFold(command.month);
      else if(command.kind==='tally')settleTally(command.day,command.messages);
      else if(command.kind==='broadcast')broadcastChatReset();
      else throw Error('core_chat_rollover_protocol');
    },getAsides);return;
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

// The facade carries observations; Core returns policy and atomic plans.

function ownedReminderFacts(phone:boolean,idleSeconds:number){return {phone,idleSeconds,asleep:herAsleepNow(),chasing,lastRemindedAt,now:Date.now(),clock:agendaClock(zonedNow(CHAT_TIMEZONE)),zone:CHAT_TIMEZONE,mood:getMood(),character:getActiveCharacter(),told:phone?toldNow():''};}
async function ownedReminder(phone:boolean,idleSeconds:number):Promise<any>{
 const core=ownedAgendaCore();
 const packet=corePolicySync<any>('agenda-life.reminderStart',[agendaFacts(core),ownedReminderFacts(phone,idleSeconds)]);
 if(!packet.run)return packet.result;
 applyAgendaPlan(core,packet,()=>{});chasing=true;lastRemindedAt=packet.at;
 try{
  // 3880: the reminder goes out even when the model is down (Venice: 11/11 reminder lines failed 10-13..14); the attempt was already counted
  let line:string;try{line=await ollamaQuip(packet.request.system,packet.request.user,packet.request.provider);}
  catch(error){console.warn('[remind] plain line, model failed:',error instanceof Error?error.message:'failed');line=`Reminder: ${packet.item.title}${packet.item.time?` at ${packet.item.time}`:''}.`;}
  if(!corePolicySync<boolean>('agenda-life.reminderCurrent',[packet.source,agendaFacts(core),ownedReminderFacts(phone,idleSeconds)]))return phone?null:false;
  if(phone){recordBrief(`reminder ${packet.tier}`,packet.request.system,line);return {line,about:packet.item.title,eventId:packet.item.id};}
  sendToWindows('voice:insistence',packet.volume);
  const emotion=classifyEmotion(line,packet.request.provider);
  if(interject(line,{source:'reminder',about:packet.item.title}))void speak(line,emotion);
  return true;
 }catch(error){console.warn('[remind]',error instanceof Error?error.message:'failed');return phone?null:false;}
 finally{chasing=false;}
}
function ownedOpeningFacts(){const now=zonedNow(CHAT_TIMEZONE);return {now:Date.now(),clock:agendaClock(now),weekday:new Intl.DateTimeFormat('en-US',{weekday:'long'}).format(now),zone:CHAT_TIMEZONE,chatday:currentChatDayKey(),asleep:herAsleepNow(),goodnight:herHasSaidGoodnight(),up:theyAreUpNow(),brainWorker:(true as boolean),idleSeconds:powerMonitor.getSystemIdleTime(),mood:getMood(),character:getActiveCharacter(),archive:remainingStore(app.getPath('userData')).docRef('archive',{}),asides:getAsides(),hasHistory:getSessions().length>0,random:Math.random(),profile:profileSummary(''),following:summariseFollowing(getFollowing(),Date.now()),unprompted:unpromptedContext(),slateOpening:blankSlateOpening(getSlate(),knownSinceSlate())};}
async function ownedComposeOpening():Promise<string|null>{
 try{
  const core=ownedAgendaCore(),packet=corePolicySync<any>('agenda-life.openingStart',[agendaFacts(core),ownedOpeningFacts()]);
  applyAgendaPlan(core,packet,()=>{});if(!packet.run)return null;
  const message=await ollamaPost([{role:'system',content:packet.request.system}],packet.request.provider,packet.request.options);
  const result=corePolicySync<any>('agenda-life.openingResult',[agendaFacts(core),packet.source,ownedOpeningFacts(),message.content??'',new Date().toISOString()]);
  applyAgendaPlan(core,result,()=>{});if(!result.result)return null;
  noteSheAsked(result.result);void speak(result.result,classifyEmotion(result.result,packet.request.provider));return result.result;
 }catch(error){console.warn('[chat] opening',error instanceof Error?error.message:'failed');return null;}
}

function ownedAgendaCore(){return remainingStore(app.getPath('userData'));}
let agendaWrites=0;   // 3770: committed agenda writes, so a call turn can tell that it acted
/** 3770: stop a call turn dropped for his next words; a hang-up is not a drop (what he asked is still written down, as before). */
function stopIfDropped(signal?: AbortSignal) { if (signal?.aborted && signal.reason !== 'hung-up') signal.throwIfAborted(); }
function ownedAgendaChanged(packet:any){
  if(packet.plan)agendaWrites++;
  if(packet.plan){sendToWindows('kept:changed',corePolicySync<any>('agenda-life.get',[packet.plan.config.kept?.items??[]]));broadcastGoogleStatus();}
  if(packet.memoryChanged){memoryStore.scheduleVectorRefresh();memoryStore.scheduleSort();sendToWindows('memory:changed',packet.plan.memory.memories);}
}
function ownedAgendaMutation(kind:string,args:unknown){
  const result=mutateAgenda(ownedAgendaCore(),kind,args,ownedAgendaChanged);
  void syncFromGoogle().catch(error=>console.warn('[agenda-sync]',error instanceof Error?error.message:'failed'));
  return result;
}
function ownedAgendaSpoken(kind:string,said:string){
  const packet=corePolicySync<any>('agenda-life.spoken',[kind,said,agendaFacts(ownedAgendaCore()),getAsides(),agendaClock(zonedNow(CHAT_TIMEZONE)),Date.now(),new Date().toISOString(),randomUUID()]);
  applyAgendaPlan(ownedAgendaCore(),packet,ownedAgendaChanged);
  movedJustNow=packet.moved;
  if(packet.plan)void syncFromGoogle().catch(error=>console.warn('[agenda-sync]',error instanceof Error?error.message:'failed'));
  return packet.result;
}

function getKept(): KeptItem[] {
  return corePolicySync<KeptItem[]>('agenda-life.get',[store.get('kept.items')??[]]);
}

function setKept(items: KeptItem[]) {
  throw Error('agenda_direct_write_requires_core_plan');
}

function addKeptItem(item: Omit<KeptItem, 'id' | 'done'>): KeptItem {
  return ownedAgendaMutation('add',{item});
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
  return ownedAgendaMutation('toggle',{id,force});
}

function removeKept(id: string) {
  return ownedAgendaMutation('remove',{id});
}

function updateKept(id: string, changes: Partial<Pick<KeptItem, 'title' | 'date' | 'time' | 'underway'>>) {
  return ownedAgendaMutation('update',{id,changes});
}

async function syncItemToGoogle(item: KeptItem) {
  return syncFromGoogle();
}

// Pulls Google's events in as kept items, matched on the remote id so repeated
// syncs update rather than duplicate. Items Haru created are refreshed in place;
// anything already deleted locally is not resurrected.
// ---------------------------------------------------------------------------
// The life loop. Runs whether or not anyone is talking to her: reads the
// machine, drifts her state, and usually decides to do nothing. Stillness is
// most of the behaviour — movement only reads as deliberate if it is rare.
// ---------------------------------------------------------------------------

const attentionMode = readAttentionMode(process.env.HARU_ATTENTION_MODE, process.env.HARU_ATTENTION_SHADOW === '0');
const attention = new AttentionExperiment(() => path.join(app.getPath('userData'), 'attention-shadow.jsonl'),
  attentionMode !== 'off', 2 * 1024 * 1024, process.env.HARU_ATTENTION_LOG !== '0');
const activityObservations = new ActivityObservations();
const activityReporter = new ActivityReporter((input, init) => net.fetch(String(input), init));
let attentionTick = 0;
let vitals: Vitals = { ...DEFAULT_VITALS };
let lastTickAt = Date.now();
let tickTimer: ReturnType<typeof setTimeout> | undefined;

function readHostEnvironment() {
  return {
    hour: zonedNow(CHAT_TIMEZONE).getHours(),
    // Idle time across the whole machine, not just this window — she should
    // know the difference between being alone and being ignored.
    idleSeconds: powerMonitor.getSystemIdleTime(),
    onBattery: powerMonitor.isOnBatteryPower(),
    windowFocused: BrowserWindow.getAllWindows().some(win => win.isFocused()),
  };
}

/** When the app came up: the headless idle fallback counts from here until he first speaks. */
const appStartedAt = Date.now();

/**
 * The host reading, the freshest evidence across his devices, and the
 * Environment the vitals drift on — one rule, so the tick and the broadcast
 * cannot combine them differently. Without eyes of its own the server counts
 * idle from the last time he addressed her once every device's evidence has
 * expired (idleWithoutEyes), rather than holding her mood where the last
 * message left it.
 */
function observeEnvironment(now = Date.now()): { host: ReturnType<typeof readHostEnvironment>; observation: ActivityObservation; environment: Environment } {
  const worker = (true as boolean);
  // An absent desktop is unknown evidence, never a fabricated idle reading.
  const host = worker ? {hour:zonedNow(CHAT_TIMEZONE).getHours(),idleSeconds:Number.NaN,onBattery:false,windowFocused:false} : readHostEnvironment();
  const eyes = !worker && seesItsOwnScreen();
  const observation = activityObservations.read(now, eyes ? host : undefined);
  const idleSeconds = idleWithoutEyes(observation, eyes, now, Math.max(lastUserActivityAt, appStartedAt));
  return { host, observation, environment: { hour: host.hour, idleSeconds, windowFocused: observation.windowFocused, onBattery: observation.onBattery } };
}

function readEnvironment(): Environment {
  return observeEnvironment().environment;
}

function broadcastLife(action: string | null, environment: Environment) {
  const payload = { vitals, action, night: environment.hour >= 23 || environment.hour < 6 };
  sendToWindows('life:tick', payload);
}

// The weather of her day and what is left of the last thing that happened
// (temperament.ts). Kept with her vitals, so a restart is not a fresh start.
let wander: Lean = {};
let bruise: Lean = {};

function getTemperament(): Temperament | null {
  return corePolicySync('mood.currentTemperament',[store.get('her.temperament')??null,currentChatDayKey()]);
}

/**
 * The mood she woke up in, rolled the first time she is awake on a new day —
 * so it is decided at her wake, not at the 05:00 roll she sleeps through.
 */
function ensureTemperament() {
  {
    const saved=store.get('her.temperament')??null,mood=getMood(),sleepState=getHerSleepSchedule(),day=currentChatDayKey();
    const decision=corePolicySync<Temperament|null>('mood.ensureTemperament',[{...publicationSnapshot(),saved,mood,sleepState,day,draws:[Math.random(),Math.random()]}]);
    if(decision)store.transaction(()=>{if(JSON.stringify(store.get('her.temperament')??null)!==JSON.stringify(saved)||JSON.stringify(getMood())!==JSON.stringify(mood)
      ||JSON.stringify(getHerSleepSchedule())!==JSON.stringify(sleepState)||currentChatDayKey()!==day)throw Error('core_temperament_state_changed');store.set('her.temperament',decision);});return;
  }
}

async function lifeTick() {
  const now = Date.now();
  const { host, observation, environment } = observeEnvironment(now);
  const seconds = (now - lastTickAt) / 1000;
  ensureTemperament();
  passFeelings(now);
  wander = stepWander(wander, seconds);
  bruise = fadeBruise(bruise, seconds);
  // The stranger lean last, and additive like the rest: while she is new to him
  // her affection is not the middle of the scale it defaults to (blankslate.ts).
  vitals = driftVitals(vitals, environment, seconds, addLeans(traitLean(getTraits()), temperamentLean(getTemperament()), wander, bruise, strangerLean(getSlate(), knownSinceSlate())));
  lastTickAt = now;
  persistVitals();
  broadcastLife(chooseIdleAction(vitals, environment), environment);
  // Reminders outrank idle chatter: something she was asked to chase beats
  // something she thought of, and both at once would be two voices at once.
  const tickId = ++attentionTick;
  observeAttention(environment, observation, tickId, now);
  // Keep existing delivery gates on their established host readings until the
  // live nudge pilot. Corrected observations already feed mood and shadow state.
  const attentionWork = considerReminding(host).then(reminded => {
    if (reminded) attention.baseline(tickId, false, true, 'reminder-priority');
    else return considerPipingUp(host, tickId);
  }, () => { attention.baseline(tickId, false, true, 'reminder-error'); })
    .catch(error => { console.warn('[attention] baseline tick failed', error); });
  const reportWork = seesItsOwnScreen() && store.get('activityLog', true) === true
    ? activityReporter.report(readCheckInSource(store.get('checkinSource')), readHostEnvironment) : undefined;
  const revoiceWork = considerRevoicing();
  if (corePeriodic) {
    await Promise.allSettled([attentionWork, reportWork, revoiceWork]);
    return vitals.sleepiness;
  }
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
  // 3780: one commit, not three (each was a storage round trip; two forced a full memory re-projection before the 3780 worker).
  store.transaction(() => {
    store.set('vitals', vitals);
    store.set('her.weather', { wander, bruise });
    // Stamped every time her state is written, so a gap she cannot account for is
    // visible the next time she comes up (feelings.ts 'lost-time').
    store.set('her.lastAliveAt', new Date().toISOString());
  });
  savedVitals = { ...vitals };
  savedVitalsAt = Date.now();
}

/**
 * What the watchdog saw while she was gone, said to his phone on the way back
 * up. This is the half of the outage alert that only she can send: the watchdog
 * can say "I have gone quiet" while the machine is up, but if the machine
 * itself was off there was nothing running to say anything at all — so she
 * reads back the watchdog's last note and tells him how long the gap was.
 *
 * Her own `her.lastAliveAt` is written only when her state moves, up to five
 * minutes stale, so on its own it would read a fifteen-second deploy as a five
 * minute outage. The watchdog's note is at most half a minute old, which is
 * what makes the number a fact rather than the shape of the file.
 */
function mentionDowntime() {
  {const watched=readLivenessFile();const own=Date.parse(String(store.get('her.lastAliveAt')??''));const p=corePolicySync<any>('startup-context.downtime',[watched?.lastAliveAt??0,Number.isFinite(own)?own:null,Date.now()]);if(p)void pushToPhone(p.source,p.text,p.url,p.silent,p.tag,undefined,undefined,p.force);return;}
}

function startLifeLoop() {
  const saved = store.get('vitals') as Vitals | undefined;
  // Resuming where she left off means closing and reopening the app does not
  // hand back a factory-fresh mood.
  vitals=corePolicySync('startup-context.initial',[saved??null,vitals]);
  const weather = store.get('her.weather') as { wander?: Lean; bruise?: Lean } | undefined;
  backfillMonths();
  // What she missed. A deploy is seconds and a crash that took her out for half
  // a day is not, and the difference is the whole point.
  const aliveAt = Date.parse(String(store.get('her.lastAliveAt') ?? ''));
  {const p=corePolicySync<any>('startup-context.resumed',[storeWasRecovered,Number.isFinite(aliveAt)?aliveAt:null,Date.now()]);if(p){feelNow(p.event);console.log(`[feelings] ${p.reason}`);}}
  mentionDowntime();
  const restored=(corePolicySync<any>('startup-context.restored',[saved??null,vitals,weather??null]));
  wander=restored.wander;bruise=restored.bruise;
  lastTickAt = Date.now();
  // What is on disk right now, so the first tick is measured against it rather
  // than against nothing and written out immediately. Null when there was
  // nothing saved, which is the one case where the first tick should write.
  savedVitals = (restored.savedVitals);
  savedVitalsAt = Date.now();
  clearTimeout(tickTimer);
  if (!corePeriodic) tickTimer = setTimeout(lifeTick, 4_000);
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
  sendToWindows('emotion:changed', { emotion, gesture });
}

// Still fire-and-forget as far as the reply is concerned — it is already on
// screen — but the promise is returned so the voice can pick a clip that matches
// the mood this line was actually said in. Callers that only want the expression
// can go on ignoring it.
/** A line classified lately, so the phone's face and the desk's mood share one call rather than queue two. */
const recentClassifications = new Map<string, { at: number; result: Promise<Emotion | null> }>();
const CLASSIFY_MEMO_MS = 2 * 60_000;

function classifyEmotion(reply: string, config: ProviderConfig): Promise<Emotion | null> {
  {const p=corePolicySync<any>('conversation-program.classifyMemo',[reply,[...recentClassifications].map(([key,v])=>({key,at:v.at})),Date.now()]);if(p.hit)return recentClassifications.get(p.key)!.result;const result=classifyEmotionNow(reply,config);recentClassifications.set(p.key,{at:p.at,result});for(const key of p.drop)recentClassifications.delete(key);return result;}
}

function classifyEmotionNow(reply: string, config: ProviderConfig): Promise<Emotion | null> {
  return conversationRun('classify',{reply,config}).then(packet=>{if(!packet)return null;broadcastBeat(packet.emotion,packet.gesture??undefined);if(packet.pose)sendToWindows('companion:pose',packet.pose);broadcastLife(null,readEnvironment());return packet.emotion;}).catch(error=>{console.warn('[emotion]',error instanceof Error?error.message:'failed');return null;});
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
  if ((channel === 'chat:fromPhone')) {
    store.set('chat.messages', appendPhoneTurn((store.get('chat.messages') ?? []) as any[], payload as PhoneTurn, randomUUID(), new Date().toISOString()));
  }
  broadcastConsole(channel,[payload]);
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
function coreAside(action:string,args:unknown):any {
  const now=new Date();return coreAsideMutation(action,args,remainingStore(app.getPath('userData')),{now:now.getTime(),at:now.toISOString(),day:localDateKey(zonedNow(CHAT_TIMEZONE,now)),timeZone:CHAT_TIMEZONE});
}
function getAsides(): Aside[] {
  return readAsides(store.get('chat.asides'));
}

function getNudgeLearning() { return readNudgeLearning(store.get('chat.nudgeLearning'), Date.now()); }

function nudgeConversation(): NudgeMessage[] {
  {const archive=store.getArchive();const days=corePolicySync<string[]>('context-preparation.nudgeDays',[Object.keys(archive)]);return corePolicySync<any>('context-preparation.nudgeConversation',[Object.fromEntries(days.map(day=>[day,archive[day]])),store.get('chat.messages')??[]]);}
}

async function saveNudgePreference(id: unknown, choice: unknown): Promise<Aside | null> {
  if (typeof id !== 'string' || !validNudgePreference(choice)) return null;
  const asides = getAsides(), learning = getNudgeLearning();
  const result = await coreRateNudge(asides, learning, id, choice, Date.now());
  if (!result) return null;
  if (!sameCoreFeedback(asides, learning, getAsides(), getNudgeLearning())) throw new Error('core_nudge_state_changed');
  store.set({ 'chat.asides': result.asides, 'chat.nudgeLearning': result.learning });
  sendToWindows('chat:asidesChanged', result.asides);
  return result.aside;
}

type NudgeDetail = Partial<Pick<NudgeDraft, 'topic' | 'kind' | 'asked' | 'keywords' | 'revision' | 'eventAt' | 'tone' | 'phoneOpportunity'>>;

/** Everything she says without having been spoken to is written here. */
function noteAside(text: string, source: AsideSource, about = '', nudge?: NudgeDetail, scheduledPush = false): Aside | null {
  {
    const made=coreAside('note',{text,source,about,nudge});if(!made)return null;
    const aside=made.aside as Aside;
    attention.event('aside',{id:aside.id,source});
    if(made.asked)console.log(`[push] she asked ${made.asked} — the next thing they say answers it`);
    sendToWindows('chat:aside',aside);
    void forwardAsideToPush(aside,nudge?.phoneOpportunity,scheduledPush).catch(error=>console.warn('[push] aside forwarding failed:',error));
    return aside;
  }
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
  return corePolicySync<any>('agenda-life.spokenOn',[ownedAgendaCore().docRef('config',{}),ownedAgendaCore().docRef('archive',{}),day,today]);   // 3690: archive by digest
}

function todaySoFar(limit = UNPROMPTED_CONTEXT_TURNS): string {
  return corePolicySync<any>('agenda-life.todaySoFar',[ownedAgendaCore().docRef('config',{}),ownedAgendaCore().docRef('archive',{}),localDateKey(zonedNow(CHAT_TIMEZONE)),limit]);   // 3690: archive by digest
}

/**
 * Whether she is still waiting on an answer, and for how long.
 *
 * lastInterjectionAt is zeroed the moment they say anything, so a non-zero value
 * means the last word was hers and it went unanswered — which is exactly the
 * thing she should notice rather than cheerfully starting a new subject.
 */
function stillWaiting(): string {
  return corePolicySync<any>('agenda-life.stillWaiting',[lastInterjectionAt,Date.now()]);
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
  return corePolicySync<any>('agenda-life.rightNow',[agendaClock(zonedNow(CHAT_TIMEZONE))]);
}

/**
 * Her night and her things are in the her_own block every composer already
 * gets; listed here as well they went into each brief twice (2026-09-06).
 * What the block cannot know is what she has said tonight, so only the
 * guard survives here.
 */
function nightRaisedAlready(recentLines: string[]): string {
  return corePolicySync<any>('agenda-life.nightRaised',[getNights(),lastNightKey(),recentLines]);
}

function unpromptedContext(subjectNow?: string): string {
  {
    const today=localDateKey(zonedNow(CHAT_TIMEZONE)),asides=getAsides(),at=Date.parse(getMood().lastMessageAt??'');
    const parts=[summariseFollowing(getFollowing(),Date.now()),todaySoFar(),alreadySaidRecently(asides,CHAT_TIMEZONE,Date.now(),Number.isFinite(at)?at:undefined,undefined,subjectNow),stillWaiting(),toldNow(),arrivalNote(),unansweredAsksNote(asides,CHAT_TIMEZONE,Date.now()),weatherToDrawOn(getWeather().last,weatherWhere(),asides.map(a=>a.text),Date.now(),getWeather().disputedAt),nightRaisedAlready(asides.map(a=>a.text)),sleepNote(getHerSleepSchedule(),zonedNow(CHAT_TIMEZONE)),openingsToAvoid(asides,Date.now())];
    return corePolicySync<string>('agenda-life.unpromptedFacts',[parts,subjectNow??null,blankSlateInstruction(getSlate(),knownSinceSlate()),blankSlateOpening(getSlate(),knownSinceSlate()),spokenOn(today,today).length,asidesOn(asides,today).length]);
  }
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
/** Raw policy inputs. Latest activity ordering reports a device fact. */
function publicationSnapshot(aboutTheGame=false) {
  const log=store.getActivityLog(),days=Object.keys(log).sort();
  const latest=days.length?(log[days[days.length-1]]??[]).map(entry=>entry.until??entry.at).sort().at(-1):undefined;
  return {now:Date.now(),local:zonedNow(CHAT_TIMEZONE),aboutTheGame,lastInterjectionAt,lastUserActivityAt,lastRemindedAt,chasing,
    sleepPrefs:store.get('her.sleep')??null,sleepState:store.get('her.sleepState')??null,explicit:explicitModeNow(),
    quietGaming:readGamingConfig(store.get('gaming')).quiet,gameRunning:gameIsRunning(),prefs:getPush().prefs,
    pushback:store.get('pushback')??null,webReady:Boolean(webServer),hasDevices:canReachPhone(),lastReachedAt:getPush().lastReachedAt,
    phoneState:getPhoneNudges(),signs:{lastMessageAt:(store.get('mood') as any)?.lastMessageAt,lastOpenedAt:store.get('web.lastOpenedAt'),lastActivityAt:latest}};
}

function whyNotInterject({ aboutTheGame = false } = {}): string | null {
  return corePolicySync('publication.whyNotInterject',[publicationSnapshot(aboutTheGame)]);
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
function interject(line: string, { aboutTheGame = false, source = 'other' as AsideSource, about = '', nudge = undefined as NudgeDetail | undefined } = {}): boolean {
  const now = Date.now();
  {
    const decision=corePolicySync<any>('publication.interject',[publicationSnapshot(aboutTheGame),line,getKept(),store.get('chat.messages')??[],getAsides()]);
    if(!decision.ok){if(decision.reason==='repeat-blocked')attention.event('repeat-blocked');console.log('[core-nudge] '+JSON.stringify({op:'interject',reason:decision.reason}));return false;}
  }
  
  // Before it goes out, so that whatever she has just demanded an account of is
  // on record by the time they reply.
  
  // Into her own log, not the transcript. This function is the definition of an
  // unprompted line — it exists to rate-limit exactly the things nobody asked
  // for — so it is also the right and only place to decide where they are
  // written. Anything that reaches the conversation instead does so by not
  // coming through here, which is a short and deliberate list: see the two
  // "hold on, I'm looking" sites, which answer a button the user just pressed.
  const storedAside=noteAside(line, source, about, nudge);
  if(!storedAside)return false;lastInterjectionAt=now;noteSheAsked(line);
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
  noteCoreUserActivity();
  inferencePriority.interaction();
  attention.event('interaction');
  activityObservations.conversation(Date.now());
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
/** Literal I/O facts and already-owned service primitives for Core attachment plans. */
function attachmentFacts(extra:string[]=[]){
 const brain=store.get('ai.config') as ProviderConfig|undefined,vision=readVisionConfig(store.get('vision'));
 const endpoints=[brain?.endpoint??'',vision.endpoint??'','http://localhost:11434',...extra];
 return {...attachmentURLFacts(endpoints.flatMap(e=>[e,e.trim(),trimEndpoint(e)]),Object.values(os.networkInterfaces()).flatMap(rows=>(rows??[]).map(a=>a.address))),brain:brain??null,chatSize:chatNumCtx(),sideSize:sideNumCtx(),keepAlive:OLLAMA_KEEP_ALIVE};
}
function attachmentAdapters(vision:VisionConfig,provider:ProviderConfig){
 const tools=findFfmpeg();
 return {facts:()=>attachmentFacts([provider.endpoint,vision.endpoint??'']),source:(a:Attachment)=>({file:attachmentFileSource(a.saved),vision,provider,brain:store.get('ai.config')}),hasTools:()=>Boolean(tools),
 pdf:readPdf,text:readText,image:imageForSending,eyes:eyesForReading,
 look:(images:string|string[],command:any)=>command.entry?coreHostedLook(images,command.entry,{...command.options,timeoutMs:command.timeoutMs},{rpc:taskBridge.call,policy:()=>readTaskPolicy(store.get('ai.taskPolicy')),send:sendToProviderAdmitted})   // 3820
  :ownedLook(images,command.config,command.endpoint,modelHeaders(command.endpoint),net.fetch,command.options),
 frames:(file:string)=>extractFrames(file,tools!),readFrame:(file:string)=>readFileSync(file).toString('base64'),pdfPages:(file:string,count:number)=>coreRenderPdfPages(file,count,scratchDir()),audio:(file:string,seconds:number)=>extractAudio(file,tools!,seconds),transcribe:transcribeFile,
 waiting:(line:string)=>{const sink=waitSink.getStore();if(sink){sink(line);return;}sendToWindows('chat:interject',line);void speak(line);},discard};   // 4130: a phone turn shows it in the reply bubble
}

function eyesHold(vision: VisionConfig, wanted: string): string | number {
 return attachmentPolicy('hold',[vision,wanted,attachmentFacts()]);
}

function visionNumCtx(vision: VisionConfig, endpoint: string): number {
 return attachmentPolicy('context',[vision,endpoint,attachmentFacts([endpoint])]);
}

function visionEndpoint(provider: ProviderConfig | undefined, vision?: VisionConfig): string {
 return attachmentPolicy('endpoint',[provider,vision,attachmentFacts([provider?.endpoint??'',vision?.endpoint??''])]);
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
 return gamePolicy('currentMemory',[currentGame,gameIsRunning()]);
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
 try{await bootCoreGame(name,{core:remainingStore(app.getPath('userData')),facts:()=>{const character=getActiveCharacter();return {current:currentGame,last:lastGamingPollAt,now:Date.now(),nights:getNights(),provider:store.get('ai.config'),refusal:whyNotInterject({aboutTheGame:true}),following:getFollowing(),today:localDateKey(zonedNow(CHAT_TIMEZONE)),context:[character.identity,character.style,rightNow()]};},stamp:(at:number)=>{lastGamingPollAt=at;},opened:(game:any)=>{currentGame=game;},quip:(request:any)=>ollamaQuip(request.system,request.prompt,request.provider),publish:(publication:any,provider:any)=>{if(interject(publication.line,publication.options))void speak(publication.line,classifyEmotion(publication.line,provider));}});}catch(error){console.warn('[game] no welcome:',error);}return;
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
 {let cursor:string|null=null;try{cursor=String(screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).id);}catch{}const index=screenPolicy<number|null>('active',[sources.map(s=>s.display_id),cursor]);return index===null?undefined:sources[index];}
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
function screenFacts(kind:string,shot?:{path:string;at:number}){
 const character=getActiveCharacter();
 const context=screenPolicy<string[]>('context',[kind,{character,rightNow:rightNow(),following:getFollowing(),activity:currentActivity,game:gameNow(),now:Date.now()}]);
 return {...attachmentFacts(),vision:store.get('vision'),provider:store.get('ai.config'),watching:store.get('watching'),screenshots:store.get('screenshots'),now:Date.now(),lastLookAt,lastSceneSeen,lastSceneAt,screenshotSpokeAt,gameOn:gameIsRunning(),speaking:speakingNow,blocked:whyNotInterject({aboutTheGame:true}),gameTitle:gameNow(),watchingTitle,activity:currentActivity,context,name:shot?path.basename(shot.path):'',day:currentChatDayKey(),logEnabled:store.get('activityLog',true)===true};
}
function screenAdapters(kind:string,shot?:{path:string;at:number}){
 return {core:remainingStore(app.getPath('userData')),facts:()=>screenFacts(kind,shot),update:(values:any)=>{if(Object.hasOwn(values,'lastLookAt'))lastLookAt=values.lastLookAt;if(Object.hasOwn(values,'lastSceneSeen'))lastSceneSeen=values.lastSceneSeen;if(Object.hasOwn(values,'lastSceneAt'))lastSceneAt=values.lastSceneAt;if(Object.hasOwn(values,'screenshotSpokeAt'))screenshotSpokeAt=values.screenshotSpokeAt;},
 capture:async(options:any)=>{const sources=await desktopCapturer.getSources(options),frame=activeScreen(sources)?.thumbnail;return frame&&!frame.isEmpty()?frame.toPNG():null;},
 read:(file:string)=>readFileSync(file),settle:settled,
 look:(bytes:Buffer,request:any)=>backgroundLook(bytes.toString('base64'),request.config,request.endpoint,modelHeaders(request.endpoint),net.fetch,request.options),
 quip:(request:any)=>ollamaQuip(request.system,request.prompt,request.provider),
 publish:(line:string,options:any,provider:any)=>{if(interject(line,options))void speak(line,classifyEmotion(line,provider));},
 game:()=>currentGame,gameUpdated:(text:string)=>{if(currentGame)currentGame.memory=text;},deferred:(error:unknown)=>error instanceof BackgroundInferenceDeferred,
 pending:()=>pendingShot,retry:(shot:any,delay:number)=>{pendingShot=shot;if(settleTimer)clearTimeout(settleTimer);settleTimer=setTimeout(()=>void remarkOnScreenshot(),delay);}};
}

async function glanceAtScreen() {
 try{await runCoreScreen('glance',screenAdapters('glance'));}catch(error){console.warn('[watch] could not look:',error instanceof Error?error.message:error);}return;
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
 {let last=-1,command=screenPolicy('settleStart',[]);for(let attempt=1;;attempt++){await new Promise(done=>setTimeout(done,command.delayMs));let size:number|null=null;try{size=statSync(file).size;}catch{}const next=screenPolicy('settle',[attempt,last,size]);if(next.done)return next.value;last=next.last;command=next;}}
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
 {const shot=pendingShot;pendingShot=null;if(!shot)return;try{await runCoreScreen('screenshot',screenAdapters('screenshot',shot),shot);}catch(error){console.warn('[screenshots]',whyItFailed(error));}return;}
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
      {const file=path.join(folder,String(name??''));let birth:number|null=null;try{birth=statSync(file).birthtimeMs;}catch{}const command=screenPolicy('watchEvent',[name?String(name):'',birth,Date.now()]);if(!command.accept)return;pendingShot={path:file,at:Date.now()};const core=remainingStore(app.getPath('userData'));commitPerceptionPlan(core,screenPolicy('screenshotNote',[core.get('activity',{}),currentChatDayKey(),String(name),currentActivity,new Date().toISOString(),store.get('activityLog',true)===true]));if(settleTimer)clearTimeout(settleTimer);settleTimer=setTimeout(()=>void remarkOnScreenshot(),command.delayMs);return;}
    });
    console.log(`[shot] watching ${folder}`);
  } catch (error) {
    console.warn('[shot] could not watch the folder:', error instanceof Error ? error.message : error);
  }
}

function speechBoundary<T = any>(name:string,args:unknown[]):T {
  return corePolicySync<T>('speech-boundary.'+name,args);
}
function speechClipObservation(clip:{audio:Uint8Array}|null|undefined){
  return clip ? {length:clip.audio.length,rate:wavSampleRate(clip.audio)} : null;
}
let saidDesktopIsMute = false;

voiceSense.configure((audio, mime, words) => {
  return analyzeLocalVoice(audio,mime,net.fetch as unknown as typeof fetch,process.env.HARU_AFFECT_ENDPOINT,words);
});

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
  const emotion = (speechBoundary('desktopEmotion',[text,classified]));
  const reference = (speechBoundary('reference',[config,emotion.emotion]));
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
      const voice = (speechBoundary('reference',[config,emotion.emotion,shouting]));
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
        if (!((speechBoundary('timeoutRetry',[first instanceof Error ? first.message : String(first)])))) throw first;
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
      sendToWindows('voice:failed', (speechBoundary('failureText',[detail])));
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
  {const p=corePolicySync<any>('conversation-program.poke',[{...conversationPolicyFacts(),poke:{count:pokeCount,lastAt:pokeLastAt,speaking:pokeSpeaking,lastLineAt:pokeLastLineAt},speakingNow,speakingLine},kind]);conversationApply(p);pokeCount=p.count;pokeLastAt=p.lastAt;broadcastBeat(p.reading,p.gesture);sendToWindows('companion:pose',p.pose);nudgeVitals('criticised');sendToWindows('mood:changed',getMood());if(!p.run)return;pokeSpeaking=true;pokeLastLineAt=p.lineAt;try{const line=await ollamaQuip(p.system,p.user,store.get('ai.config') as ProviderConfig);noteAside(line,'poke');noteSheAsked(line);void speak(line);}catch(error){console.warn('[poke]',error instanceof Error?error.message:'failed');}finally{pokeSpeaking=false;}return;}
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

function deviceFacts(withContext=false){
 const core=remainingStore(app.getPath('userData')),now=new Date(),character=withContext?getActiveCharacter():null;
 return {config:core.docRef('config',{}),activityLog:core.docRef('activity',{}),now:now.getTime(),at:now.toISOString(),day:currentChatDayKey(),ducked,watchingTitle,steamIndex:[...steamGames],reacting:reactingToActivity,activitySpokenAt,placeSpokenAt,irritation:withContext?getMood().irritation:0,sleepiness:vitals.sleepiness,speaking:speakingNow,gameName:gameNow(),identity:character?.identity??'',style:character?.style??'',rightNow:withContext?rightNow():'',fullscreenSpokenAt,currentPlace};
}
function deviceStateAdapter(){return {core:remainingStore(app.getPath('userData')),facts:deviceFacts};}
function coreHelperAdapter(){return {...deviceStateAdapter(),update:(u:any)=>{
 for(const [key,value] of Object.entries(u)){switch(key){case 'systemVolume':systemVolume=value as number;break;case 'currentActivity':currentActivity=value as Activity;break;case 'foregroundProcess':foregroundProcess=value as string;break;case 'evictedFor':evictedFor=value as string|null;break;case 'watchingTitle':watchingTitle=value as string|null;break;case 'watchingScreen':watchingScreen=value as typeof watchingScreen;break;default:throw Error('core_device_state_field_invalid');}}
 },execute:(c:any)=>{switch(c.kind){case 'volume':setSystemVolume(c.level);break;case 'volume-set-observed':{const pending=afterVolumeSet;afterVolumeSet=null;if(pending){clearTimeout(pending.timer);pending.run();}break;}case 'game-observation':noteCoreGame(c.value);break;case 'release-game-model':void releaseModelForGame(c.provider);break;case 'boot-game':void bootGame(c.name);break;case 'react-activity':void reactToActivity(c.activity,c.url);break;case 'watching-off':sendToWindows('companion:watching',null);break;case 'broadcast-watching':broadcastWatching();break;case 'react-fullscreen':void reactToFullscreen(c.title);break;case 'step-aside':stepAsideForFullscreen();break;default:throw Error('core_device_command_invalid');}}};}
function coreActivityAdapter(){return {...deviceStateAdapter(),facts:()=>deviceFacts(true),place:(p:string|null)=>{currentPlace=p;},defer:(held:any,delay:number)=>{deferredActivity=held;clearTimeout(deferredRelease);deferredRelease=setTimeout(releaseDeferred,delay);},started:(kind:ActivityKind,place:string|null,at:number)=>{reactingToActivity=true;activitySpokenAt[kind]=at;if(place)placeSpokenAt[place]=at;},finished:()=>{reactingToActivity=false;},quip:(r:any)=>ollamaQuip(r.system,r.prompt,r.provider),publish:(r:any)=>{const emotion=classifyEmotion(r.line,r.provider);if(interject(r.line,r.options))void speak(r.line,emotion);}};}
function coreFullscreenAdapter(){return {...deviceStateAdapter(),facts:()=>deviceFacts(true),defer:(title:string,delay:number)=>{deferredFullscreen=title;clearTimeout(deferredRelease);deferredRelease=setTimeout(releaseDeferred,delay);},stamp:(at:number)=>{fullscreenSpokenAt=at;},quip:(r:any)=>ollamaQuip(r.system,r.prompt,r.provider),publish:(r:any)=>{broadcastBeat(r.beat,r.animation);nudgeVitals(r.event);feelNow(r.event);sendToWindows('companion:pose',r.pose);if(interject(r.line,r.options))void speak(r.line);}};}

function handleHelperLine(line: string) {
 try{handleCoreHelper(line,coreHelperAdapter());}catch(error){console.warn('[helper] Core event refused:',error);}return;
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
 {const key=getOpenAIKey(),command=attachmentPolicy('transcriber',[readListenConfig(store.get('listen')),Boolean(key)]);if(command.error)throw Error(command.error);return transcribe(readFileSync(wav),'audio/wav',command.config,net.fetch as never,command.auth==='openai'?{Authorization:`Bearer ${key}`}:remoteAuth(command.config.endpoint));}
}

/** She notices what they have opened. */
async function reactToActivity(activity: Activity, url = '') {
 try{await reactCoreActivity(activity,url,coreActivityAdapter());}catch(error){console.warn('[activity] could not react:',error);}return;
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
 deviceMutation('hygiene',[],deviceStateAdapter());return;
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
 deviceMutation('follow',[activity,gameName],deviceStateAdapter());return;
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
 {clearTimeout(deferredRelease);deferredRelease=undefined;const command=deviceFlow('deferred',[deferredActivity,deferredFullscreen]);deferredActivity=null;deferredFullscreen=null;if(command?.kind==='activity')void reactToActivity(command.activity,command.url);else if(command?.kind==='fullscreen')void reactToFullscreen(command.title);return;}
}

function holdUntilQuiet() {
 clearTimeout(deferredRelease);deferredRelease=setTimeout(releaseDeferred,deviceFlow<number>('deferDelay',[]));return;
}

/** Where they are right now, so a conversation can be tied to it. */
let currentPlace: string | null = null;
/** And what they are doing there, for when she is asked rather than volunteering. */
function photoFolder() {
  const chosen = readVisionConfig(store.get('vision')).folder;
  {
    const plan=attachmentPolicy<{folder:string|null}>('photoFolder',[chosen,app.getPath('home'),(true as boolean)]);
    if(plan.folder)return plan.folder;
  }
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
  const command=(attachmentPolicy('stageCheck',[name,path.basename(name),path.extname(name),true,'single']));
  if(command?.error)throw Error(command.error);
  const kind = classify(name);
  
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
    {const command=attachmentPolicy('stageCheck',[source,path.basename(source),path.extname(source),Boolean(tools),'all']);if(command.error){refused.push(command.error);continue;}}
    try {
      staged.push(stageAttachment(source));
    } catch (error) {
      refused.push(`${path.basename(source)} — ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (staged.length) console.log(`[attach] staged ${staged.map(file => `${file.name} (${file.kind})`).join(', ')}`);
  // Only when nothing at all got through, so one bad file among four is a log
  // line and four bad files is an error the user actually sees.
  {const command=attachmentPolicy('stageSummary',[staged,refused]);if(command.error)throw Error(command.error);}
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

/** 4100: a JPEG no wider than SEND_WIDTH, metadata dropped. shortcut: synchronous ffmpeg (~0.2-1 s, only for pictures over the cap); move it off the loop if big pictures become common. */
function smallerPicture(file: string): Buffer {
  return execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-frames:v', '1', '-vf', `scale='min(${SEND_WIDTH},iw)':-2`, '-map_metadata', '-1', '-q:v', '3', '-f', 'image2pipe', '-c:v', 'mjpeg', '-'],
    { maxBuffer: 32 * 1024 * 1024, timeout: 20_000 });
}

function imageForSending(file: string): string {
  {
    const plan=attachmentPolicy<{raw?:boolean;maxBytes:number}>('imageSend',[true,0,(true as boolean)]);
    if(plan.raw){
      let raw:Buffer=readFileSync(file);
      if(raw.length>plan.maxBytes)raw=smallerPicture(file);   // 4100: too big to send whole (was dropped); shrunk instead
      if(raw.length>plan.maxBytes)throw Error('core_image_bytes_too_large');
      return raw.toString('base64');
    }
  }
 {const bytes=readFileSync(file),picture=nativeImage.createFromPath(file),empty=picture.isEmpty(),command=attachmentPolicy('imageSend',[empty,empty?0:picture.getSize().width]);return command.resize?picture.resize({width:command.width,quality:command.quality}).toPNG().toString('base64'):bytes.toString('base64');}
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
 return readCoreAttachment(attachment,vision,provider,attachmentAdapters(vision,provider));
}

/** Which local models can see, as they answered /api/show. Asked once per model. */
const modelEyes = new Map<string, boolean>();

async function localModelSees(config: ProviderConfig): Promise<boolean> {
 return attachmentCapability(config,attachmentFacts([config.endpoint]),async command=>{return coreModelCapabilities(config);});
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
 {const local=store.get('ai.config') as ProviderConfig|undefined;return attachmentPolicy('eyes',[vision,provider,attachmentFacts([provider.endpoint,vision.endpoint??'']),local?await localModelSees(local):false]);}
}

/**
 * A file reduced to something a model can read.
 *
 * The reduction is the whole feature and it is unchanged — frames, a transcript,
 * plain text. What has gone is the half that used to answer: a one-shot quip
 * with no conversation, no tools and no memory behind it. The chat answers now.
 */
async function openFile(attachment: Attachment, vision: VisionConfig, provider: ProviderConfig): Promise<string> {
 return openCoreAttachment(attachment,vision,provider,attachmentAdapters(vision,provider));
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
 return gamePolicy('gaming',[saved]);
}

/** True while a game has the screen. Both signals count: a game that has not
 *  gone fullscreen is still a game, and a fullscreen thing the process list does
 *  not recognise is still taking the GPU. */
function gameIsRunning() {
 return gamePolicy('running',[seesItsOwnScreen(),currentActivity,watchingTitle]);
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
 {const command=gamePolicy('swap',[config,store.get('gaming'),gameIsRunning(),gamingSwapAnnounced]);gamingSwapAnnounced=command.announced;if(command.log)console.log(command.log);return command.config;}
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
 {const command=gamePolicy('release',[config,store.get('gaming'),seesItsOwnScreen(),evictedFor]);if(!command)return;evictedFor=command.evicted;try{await net.fetch(command.url,{method:'POST',headers:modelHeaders(config.endpoint),body:JSON.stringify(command.body)});}catch(error){console.warn('[gaming] could not release the model:',error);}return;}
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
 try{await tieCorePlace(said,replied,config,{...deviceStateAdapter(),facts:()=>({...deviceFacts(),memories:getMemories()}),quip:(r:any)=>ollamaQuip(r.system,r.prompt,r.provider),remember:(r:any)=>addMemory(r.text,r.kind,r.label,{source:r.source,emotion:localEmotion(r.text),emotionIntensity:readTone(r.text).heat})});}catch(error){console.warn('[familiar] could not write the memory:',error);}return;
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
  {
    const packet=corePolicySync<any>('agenda-life.remarkPrepare',[item,{now:Date.now(),lastAt:tickedOffAt,provider:store.get('ai.config')??{},irritation:getMood().irritation,today:localDateKey(zonedNow(CHAT_TIMEZONE)),character:getActiveCharacter()}]);
    if(!packet.run)return;tickedOffAt=packet.at;
    const line=await ollamaQuip(packet.system,packet.user,packet.provider);
    if(!corePolicySync<boolean>('agenda-life.remarkResult',[packet.source,getKept(),store.get('ai.config')??{},getActiveCharacter()]))return;
    noteAside(line,'kept');noteSheAsked(line);void speak(line,classifyEmotion(line,packet.provider));return;
  }
}

let fullscreenSpokenAt = 0;
const FULLSCREEN_COOLDOWN_MS = 5 * 60_000;

/** She notices when something takes over the screen. */
async function reactToFullscreen(title: string) {
 try{await reactCoreFullscreen(title,coreFullscreenAdapter());}catch(error){console.warn('[helper] could not react to fullscreen:',error);}return;
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
  {const value=corePolicySync<number|null>('agenda-life.minutesUntil',[item,agendaClock(now),todayKey]);return value===null?Infinity:value;}
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
  return corePolicySync<{item:KeptItem;due:number}|null>('agenda-life.chaseTarget',[getKept(),agendaClock(now),todayKey,states,Number.isFinite(minutesSinceUserSpoke)?minutesSinceUserSpoke:null,idleSeconds,Date.now()]);
}

async function considerReminding(environment: ReturnType<typeof readHostEnvironment>): Promise<boolean> {
  return ownedReminder(false,environment.idleSeconds);
}

/** Any word from them ends every escalation in progress, and drops her back to
 *  her normal voice. Being answered is the whole objective. */
/** How long after a chase a reply still counts as a reply to it. */
const REPLY_TO_CHASE_MS = 20 * 60_000;

function acknowledgeReminders() {
  {const packet=corePolicySync<any>('agenda-life.acknowledge',[agendaFacts(ownedAgendaCore()),agendaClock(zonedNow(CHAT_TIMEZONE)),Date.now()]);applyAgendaPlan(ownedAgendaCore(),packet,()=>{});sendToWindows('voice:insistence',packet.result.volume);return;}
}

let lastPipedUpAt = 0;
let pipingUp = false;

/**
 * Says something unprompted when she has been sitting there ignored. Runs off
 * the life tick rather than a timer of its own, so it inherits the same variable
 * cadence as the rest of her — and so the decision is made against vitals that
 * were computed a line earlier rather than a stale copy.
 */
function observeAttention(environment: Environment, observation: ActivityObservation, tickId: number, now: number) {
  if (attentionMode === 'off') return;
  const blockReasons: string[] = [];
  if (pipingUp) blockReasons.push('composing');
  if (!(store.get('ai.config') as ProviderConfig | undefined)?.model) blockReasons.push('no-model');
  if (isIgnoring(getMood().irritation)) blockReasons.push('ignoring');
  if (herAsleepNow() || herKnockedAwakeNow()) blockReasons.push('sleep');
  if (whyNotInterject() !== null) blockReasons.push('interjection-gate');
  const lastInteractionAt = Math.max(lastUserActivityAt, Date.parse(getMood().lastMessageAt ?? '') || 0);
  attention.observe({
    now, vitals, environment, observation, tickId, blockReasons,
    activity: currentActivity?.kind === 'adult' ? 'other' : currentActivity?.kind ?? 'other',
    sinceInteractionMs: lastInteractionAt ? Math.max(0, now - lastInteractionAt) : Infinity,
    baselineReady: null, blocked: blockReasons.length > 0,
  });
}

/** Final admission in Core; content grounding and actual publication remain synchronous in interject. */
async function publishOwnedNudge(draft: NudgeDraft, publish: (draft: NudgeDraft) => boolean): Promise<boolean> {
  if (draft.topic.startsWith('gmail:')) {
    const grant = await coreGmail('reserve-summary', { key: draft.topic, zone: CHAT_TIMEZONE });
    if (!grant.allowed) return false;
  }
  return corePublishNudge(draft,()=>({asleep:herAsleepNow(),knockedAwake:herKnockedAwakeNow(),interjectionBlocked:Boolean(whyNotInterject()),
    expiresAt:draft.phoneOpportunity?.expiresAt??null}),publish);
}

async function considerPipingUp(environment: ReturnType<typeof readHostEnvironment>, tickId: number) {
  {const facts={...conversationPolicyFacts(),busy:pipingUp,lastAt:lastPipedUpAt,idleSeconds:environment.idleSeconds,vitals,feelings:getFeelings(),whyNot:whyNotInterject(),odds:sway('pipe-up',PIPE_UP_CHANCE,swayNow())};let p=corePolicySync<any>('conversation-program.pipeAdmission',[facts,[]]);if(p.draws)p=corePolicySync<any>('conversation-program.pipeAdmission',[facts,[Math.random()]]);attention.baseline(tickId,p.result.ready,p.result.blocked,p.result.reason);if(!p.result.run)return;pipingUp=true;lastPipedUpAt=p.result.at;attention.outcome(tickId,'attempted');try{const draft=await composeSpontaneousNudge(new Map());if(!draft){attention.outcome(tickId,'suppressed');return;}const accepted=await publishOwnedNudge(draft,nudge=>interject(nudge.line,{source:'idle',nudge}));attention.outcome(tickId,accepted?'accepted':'suppressed');if(accepted)void speak(draft.line,classifyEmotion(draft.line,store.get('ai.config') as ProviderConfig));}catch(error){attention.outcome(tickId,'failed');console.warn('[idle]',error instanceof Error?error.message:'failed');}finally{pipingUp=false;}return;}
}

function broadcastGoogleStatus() {
  const status = googleStatus(store);
  sendToWindows('google:changed', status);
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
  return performSync();
}

async function performSync() {
  return syncAgendaGoogle({core:ownedAgendaCore(),today:localDateKey(zonedNow(CHAT_TIMEZONE)),zone:CHAT_TIMEZONE,execute:(command,fence)=>executeGoogleCommand(store,command,fence),changed:ownedAgendaChanged});
}

// Scheduled syncs are best-effort: a laptop that was asleep or offline should
// retry on the next tick, not surface a dialog or leave the timer dead.
function backgroundSync() {
  {const admitted=corePolicySync<boolean>('agenda-google.background',[agendaFacts(ownedAgendaCore())]);if(!admitted)return;return syncFromGoogle().catch(error=>console.warn('[agenda-sync]',error instanceof Error?error.message:'failed'));}
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
  {const decision=corePolicySync<any>('agenda-google.focus',[Date.now(),lastFocusSync]);if(!decision.run)return;lastFocusSync=decision.at;backgroundSync();return;}
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
type OllamaMessage = import('./provider').ChatMessage;

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
  return naturalPolicy<number>('contextDefault',['historyBudgetChars',store.get('ai.historyChars')??null]);
}

function chatNumCtx(): number {
  return naturalPolicy<number>('contextDefault',['chatNumCtx',store.get('ai.numCtx')??null]);
}

/**
 * Default window for separate side-job models. Requests sharing the chat
 * model are aligned to chatNumCtx at the provider boundary. Switching the
 * same 27B model between 8192 and 20480 cost about 8 seconds PER switch on
 * 2026-09-29, including the mood check immediately following every reply.
 */
const SIDE_NUM_CTX = 8192;

function sideNumCtx(): number {
  return naturalPolicy<number>('contextDefault',['sideNumCtx',store.get('ai.numCtx')??null]);
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
  return naturalPolicy<number>('contextDefault',['awayTurns',store.get('ai.turns')??null]);
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
  return naturalPolicy<number>('contextDefault',['awayMemoryScale',store.get('ai.memoryScale')??null]);
}

/**
 * How many of her own one-line day notes go in front of today's conversation.
 * Each is a tenth of the raw day it came from, so a week of them costs less
 * than three days of turns did — the prompt is smaller and her memory longer.
 * ai.summaryDays in config, else this default.
 */
const SUMMARY_DAYS = 7;

function summaryDays(): number {
  return naturalPolicy<number>('contextDefault',['summaryDays',store.get('ai.summaryDays')??null]);
}

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
function coreHearing(op:string,args:unknown[]){return applyCoreHearing(op,args,remainingStore(app.getPath('userData')));}
function wordsToListenFor(): string[] {
 return corePolicySync('speech-context.listen',[getActiveCharacter().identity,getProfile(),readHearing(store.get('hearing')),getWhereabouts().places,getKept(),store.get('chat.messages')??[]]);
}

function coreMemoryAdmin(action:string,args:Record<string,unknown>={}){return runCoreMemoryAdmin(action,args,{core:remainingStore(app.getPath('userData')),sources:()=>blockSources(''),publish:events=>memoryStore.notifyCommitted(events)});}

function getProfile(): Profile {
  return corePolicySync('memory-admin.profile',[store.get('profile')]);
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
 retireCoreVaultMemories(knowledge.vaultPath(),{core:remainingStore(app.getPath('userData')),publish:events=>memoryStore.notifyCommitted(events)});return;
}
const reindexKnowledge = knowledge.reindex;

const memoryStore = createMemoryStore({
  store,
  broadcast: (channel, payload) => { sendToWindows(channel, payload); },
  embedder: getKnowledgeEmbedder,
  embeddingTiming: event => console.log(`[query-embedding-timing] ${JSON.stringify(event)}`),
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
  portrait: () => (store.get('portrait') as { text?: string } | undefined)?.text ?? '',
  herOwnLife: () => {
    const now = zonedNow(CHAT_TIMEZONE);
    const today = localDateKey(now);
    const interests = getInterests();
    return [
      nightsInstruction(nightsOn(getNights(), lastNightKey())),
      // 3510: her finished work reaches the prompt from the Core (prompt assembly), not from the retired work view.
      // His shelf beside hers: where he is up to, and the spoiler line (suwayomi.ts).
      hisReadingLine(),
      // What she did with her own hands lately (herhands.ts), so it is hers to bring up.
      handsNote(readHands(store.get('her.hands')), Date.now(), iso => localDateKey(zonedNow(CHAT_TIMEZONE, new Date(iso))), today),
      dayNote(getDays(), today),
      weekNote(getWeek(), today),
      tastesInstruction(interests),
      firstsNote(interests, today),
      projectsNote(getProjects(), Date.now()),
      // Her body in the game, one line, only when there is something to say.
      diaryContext(recentEntries(app.getPath('home'), 2)),
    ].filter(Boolean).join('\n');
  },
});

const { getMemories, setMemories, addMemory, mergeIn, getSessions, getMonthNotes, setMonthNotes, blockSources, setBlocks, profileSummary } = memoryStore;

// The vault-memory seam from above, now that the memory store exists: vault
// pages are admitted exactly like things she was told, but marked explicit so
// they are never treated as guesses.
let admitVaultMemory: ((draft: { id?: string; text: string; kind: 'relationship' | 'preference' | 'fact'; subject?: string }) => { created: boolean } | null) | undefined = undefined;
admitVaultMemory = draft => {
 {const plan=corePolicySync<any>('knowledge-flow.admit',[draft,getSlate(),knownSinceSlate(),Date.now()]);if(Object.hasOwn(plan,'result'))return plan.result;const observed=addMemory(plan.text,plan.kind,plan.subject,plan.extra);return corePolicySync('knowledge-flow.admissionResult',[observed]);}
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
 return corePolicySync('final-system.config',[store.get('system.config')??null]);
}

function readSystemEvents(): { enabled: boolean; sampleSeconds: number; minGapMinutes: number; thresholds: EventThresholds } {
 return corePolicySync('final-system.events',[store.get('system.events')??null]);
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

async function sampleSystem() {
  if (systemCollecting) return;
  systemCollecting = true;
  try {
    if(!corePolicySync<any>('final-system.sampleStart',[readSystemConfig(),readSystemEvents()]).collect)return;
    const [light, gpu, docker, gpuApps] = await Promise.all([
      collectSystem(),
      collectGpu(),
      collectDockerLight(),
      collectGpuApps(),
    ]);
    const sample = sampleFromCollectors({ ...light, gpu, docker, gpuApps, processes: [], services: [] }, new Date());
    {
      const p=corePolicySync<{samples:SystemSample[];count:number;write:boolean}>('final-system.sampleObserved',[systemSamples,systemSampleCount,sample]);systemSamples=p.samples;systemSampleCount=p.count;if(p.write)store.set('system.samples',p.samples);
    }
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
 {
   const c=corePolicySync<{file:string;args:string[];timeoutMs:number}>('final-system.commandStart',[file,args]);
   const observation=await new Promise<{error:string|null;stderr:string}>(resolve=>execFile(c.file,c.args,{timeout:c.timeoutMs},(error,_stdout,stderr)=>resolve({error:error?.message??null,stderr:String(stderr)})));
   return corePolicySync('final-system.commandResult',[observation.error,observation.stderr]);
 }
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
 {
  const p=corePolicySync<any>('final-system.contextStart',[message,readSystemConfig().enabled]);if('result' in p)return p.result;
  const c=p.command;
  const [light,gpu,docker,services,processes]=await Promise.all([c.light?collectSystem():null,c.gpu?collectGpu():null,c.docker?collectDocker():null,c.services?collectServices():null,c.processes===null?null:collectProcesses(c.processes)]);
  return corePolicySync('final-system.contextObserved',[{light,gpu,docker,services,processes}]);
 }
}

const DEFAULT_CHARACTER = {
  identity: 'You are Haru, an ambitious companion. You are quick-witted, direct, curious, and determined to make ordinary days more interesting. You take initiative, challenge lazy thinking, and care through honest feedback.',
  style: 'Be playful, incisive, and energetic. Choose banter and ambitious brainstorming over flattery. Do not drift into generic assistant language.',
};

// Blank fields fall back to the defaults rather than leaving Haru with no
// persona at all, so clearing a box in the drawer cannot silently neuter it.
function getCharacter() {
  return corePolicySync<{identity:string;style:string}>('memory-admin.character',[store.get('character')]);
}

/**
 * What the prompts read. getCharacter stays the raw stored persona so the editor
 * in Setup shows what the user actually wrote rather than their text with the
 * overlay stitched onto the end — edit that and save, and the overlay would be
 * baked in permanently.
 */
function getActiveCharacter() {
  return corePolicySync<{identity:string;style:string}>('memory-admin.activeCharacter',[store.get('character'),getSlate(),knownSinceSlate(),Date.now()]);
}

/** The slate left by the last reset, or nothing. See blankslate.ts. */
function getSlate(): BlankSlate | null {
  const saved = store.get('her.slate') as Partial<BlankSlate> | undefined;
  return readSlate({ slate: saved });
}

/**
 * How many things she has learned about him since the reset, which is what ends
 * the slate (blankslate.ts).
 *
 * Not getMemories().length. His vault pages are admitted as memories and marked
 * explicit, and the sync re-reads them every hour: counting those would have the
 * slate spend fifteen of its twenty-five on his own filing cabinet, before he had
 * said a word — the fade would go quiet while she still knew nothing he had told
 * her. Records born before the slate are the old life and do not count either.
 *
 * With no slate it is simply how many she holds, which is what every other
 * caller of this number meant before there was a reset at all.
 */
function knownSinceSlate(): number {
  return corePolicySync('memory-admin.known',[getSlate(),getMemories()]);
}

/**
 * The reset: everything she knew and everything she had become, cleared in one
 * go, with her attitude left exactly where it is.
 *
 * What survives is the part that was never learned — the persona above, his
 * settings and keys, and his own list, reminders and journal. A reset is hers,
 * not his. RESET_KEYS (blankslate.ts) is the written-out account of the rest.
 *
 * Backed up first and not optionally: this throws away a year of her, and
 * store.backup already writes every store file aside under a reason. Her diary
 * is a file in his home folder rather than a store key, so it is moved aside
 * under a dated name rather than deleted — still his to open, no longer hers to
 * read back as a life she remembers having.
 *
 * `at` is the moment the reset happened, and a body passes the brain's rather
 * than stamping its own: the two then hold the same string, and "have I
 * followed this reset yet" is a comparison that cannot drift with the clocks.
 */
function resetHer({ body = false, at = new Date().toISOString() }: { body?: boolean; at?: string } = {}): { at: string; body: boolean; backups: number } {
  return runCoreMemoryReset(body,at,{core:remainingStore(app.getPath('userData')),store,roots:{home:app.getPath('home'),userData:app.getPath('userData')},publishSchedule:()=>{if('updateMirror' in scheduler)scheduler.updateMirror(store.getSchedule());},renderGraph:graph=>renderGraphPage(graph,new Date()).text,exists:existsSync,move:renameSync,write:(file,text)=>writeFileSync(file,text,'utf8'),join:path.join});
}

/** Where her brain is, if it is not this machine. */
function herBrain(): string | null {
  return readCheckInSource(store.get('checkinSource'))?.url || null;
}

/**
 * The brain reset since this body last looked, so the body follows.
 *
 * Called on the way in from the sync door, before the merge. Without it the
 * body keeps the mirror it was holding — the union merge adds and updates and
 * has never once deleted — and hands every one of those memories straight back
 * on the push that follows.
 *
 * The brain's own moment is adopted rather than a fresh one, so this is
 * idempotent: the second sync sees a slate it already has and does nothing.
 */
function followSlate(body: unknown): void {
  const brain = readSlate(body);
  if (!slateIsNewer(brain, getSlate())) return;
  console.log(`[reset] her brain reset at ${brain!.at} — this machine is following`);
  resetHer({ at: brain!.at });
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
  {
    const raw=store.get('mood')??null,result=corePolicySync<any>('mood.normalize',[raw]);
    if(result.backup){try{copyFileSync(path.join(app.getPath('userData'),'config.json'),path.join(app.getPath('userData'),`config.json.before-mood-scale-${new Date().toISOString().replace(/[:.]/g,'-')}`));}catch{}}
    if(result.write)store.transaction(()=>{if(JSON.stringify(store.get('mood')??null)!==JSON.stringify(raw))throw Error('core_mood_state_changed');store.set('mood',result.persisted);});
    return result.view;
  }
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
  return corePolicySync<any>('conversation-program.monthHistory',[remainingStore(app.getPath('userData')).docRef('config',{})]);
}

/** Hurt she was left holding, and what he put right: tallied live, because no
 *  history of either is kept and the month needs both to judge guardedness. */
type MonthTally = { month: string; hurtEvents: number; apologies: number; woundUp: number };

function getMonthTally(): MonthTally {
  return corePolicySync<any>('conversation-program.monthTally',[remainingStore(app.getPath('userData')).docRef('config',{}),currentChatDayKey()]);
}

function tallyMonth(what: 'hurt' | 'apology' | 'wound-up') {
  conversationApply(corePolicySync<any>('conversation-program.growth',['tally',remainingStore(app.getPath('userData')).docRef('config',{}),{},currentChatDayKey(),what]));return;
}

/**
 * A month of how he was, read off the archive the same way the grudge reads a
 * day: what he actually said, and how many of her lines nothing came back to.
 * Nothing she said is in it — see growth.ts on why that matters.
 */
function monthSignals(month: string, tally?: MonthTally): MonthSignals | null {
  return corePolicySync<any>('conversation-program.monthSignals',[store.getArchive(),month,tally??null]);
}

/**
 * The month's mark on her, at the fold — the same boundary her day notes fold
 * into a month at. Automatic, inside the band, and every step is written down
 * so any of it can be put back (his call, 2026-09-19).
 */
function growAtFold(month: string) {
  conversationApply(corePolicySync<any>('conversation-program.growth',['fold',remainingStore(app.getPath('userData')).docRef('config',{}),remainingStore(app.getPath('userData')).docRef('archive',{}),currentChatDayKey(),month]));return;
}

/**
 * How many of her lines he ordinarily leaves hanging, from the months she has.
 * Only what is worse than this counts against him (grudge.ts).
 */
function ordinaryHanging(): number {
  return corePolicySync<number>('conversation-program.ordinaryHanging',[remainingStore(app.getPath('userData')).docRef('config',{})]);
}

/** The months before growth existed, read off the archive once so she has a norm. */
function backfillMonths() {
  conversationApply(corePolicySync<any>('conversation-program.growth',['backfill',remainingStore(app.getPath('userData')).docRef('config',{}),remainingStore(app.getPath('userData')).docRef('archive',{}),currentChatDayKey()]));return;
}

/**
 * The three lines main.ts owns, with the side each one is on and how strongly
 * it is felt. A warm temperament under a cold grudge is exactly the argument
 * compile.ts exists to settle.
 */
function herBehaviour(): Candidate[] {
  return corePolicySync<any>('context-preparation.herBehaviour',[getMood(),getTemperament(),getTraits(),getFeelings()]);
}

const WARM_DAYS: TemperamentKind[] = ['sunny', 'tender', 'clingy', 'mischievous'];
const COLD_DAYS: TemperamentKind[] = ['prickly', 'stormy', 'flat'];

/** The day she is having, for the dice (dice.ts). */
function swayNow(): Sway {
  return { temperament: getTemperament()?.kind, feelings: getFeelings() };
}

function feelNow(event: FeelingEvent) {
  // Her ego rides along: it amplifies a thing of hers failing (feelings.ts).
  store.set('her.feelings', feel(getFeelings(), event, Math.random(), getMood().ego));
}

let feelingsPassedAt = Date.now();
let herOwnTimeAt = 0;
let jealousOfScreenAt = 0;
const FEELINGS_EVERY_MS = 5 * 60_000;
const QUIET_ROOM_MS = 30 * 60_000;

/** What time does to them, every few minutes of her waking day. A night is not a silence. */
function passFeelings(now: number) {
  {
    const feelings=getFeelings(),mood=getMood(),passedAt=feelingsPassedAt,jealousAt=jealousOfScreenAt,machineAt=machineCheckedAt;
    const facts={...publicationSnapshot(),now,feelings,mood,passedAt,jealousAt,machineAt,ownTimeAt:herOwnTimeAt,
      activityKind:currentActivity?.kind,messages:store.get('chat.messages')??[],socialDraw:Math.random(),diskDraw:Math.random(),diskGb:null as number|null};
    let decision=corePolicySync<any>('feelings.tick',[facts]);
    if(decision.checkMachine){try{const room=statfsSync(app.getPath('userData'));facts.diskGb=room.bavail*room.bsize/2**30;}catch{}
      decision=corePolicySync<any>('feelings.tick',[facts]);}
    if(decision.write)store.transaction(()=>{if(JSON.stringify(getFeelings())!==JSON.stringify(feelings)||JSON.stringify(getMood())!==JSON.stringify(mood)
      ||feelingsPassedAt!==passedAt||jealousOfScreenAt!==jealousAt||machineCheckedAt!==machineAt)throw Error('core_feelings_state_changed');store.set('her.feelings',decision.feelings);});
    feelingsPassedAt=decision.passedAt;if(decision.write){machineCheckedAt=decision.machineAt;jealousOfScreenAt=decision.jealousAt;}return;
  }
}

/** Longer than this off the air and it is time she has lost, not a restart. */
const GONE_TOO_LONG_HOURS = 6;
/** Below this much room left where her memories live, the machine is not well. */
const ROOM_LEFT_GB = 12;
let machineCheckedAt = 0;

/** His own waking hours with nothing said, after which his turning up is an event. */
const LONG_SILENCE_MINUTES = 4 * 60;

function getMute(): MuteState | null {
  return corePolicySync<any>('conversation-program.getMute',[remainingStore(app.getPath('userData')).docRef('config',{})]);
}

/**
 * Asked to go quiet, told she may talk again, or done with being quiet — and
 * the note that tells her which. Her voice on the phone is hers to switch off
 * (mute.ts); this is where the decision meets her actual state and is kept.
 */
function muteTurn(latest: string): string {
  {const facts={...conversationPolicyFacts(),vitals,feelings:getFeelings(),muteLean:muteLean(getTemperament()?.kind),fuse:fuseOf(getTraits())};let p=corePolicySync<any>('conversation-program.mute',[facts,latest,[]]);if(p.draws)p=corePolicySync<any>('conversation-program.mute',[facts,latest,Array.from({length:p.draws},()=>Math.random())]);conversationApply(p);for(const event of p.events){if(event.kind==='vitals')nudgeVitals(event.event);else if(event.kind==='feel')feelNow(event.event);else throw Error('core_conversation_event_protocol');}sendToWindows('mood:changed',getMood());return p.result;}
}

function setMood(mood: Mood) {
  {const p=corePolicySync<any>('conversation-program.mergeMood',[remainingStore(app.getPath('userData')).docRef('config',{}),getMood(),mood]);conversationApply(p);sendToWindows('mood:changed',p.result);return;}
}

// Works out where her patience stands for this message: cool off for time away,
// then move for what was actually said. Returns the level the reply is generated
// under, so the same number drives both the prompt and the ignore decision.
function advanceMood(latest: string, history: { role?: string; content?: string }[]) {
  {
    const mood=getMood(),feelings=getFeelings(),month=getMonthTally(),screenAt=jealousOfScreenAt;
    const decision=corePolicySync<any>('mood.advance',[{mood,latest,history,now:Date.now(),day:currentChatDayKey(),
      fuse:fuseOf(getTraits()),prefs:getPush().prefs,local:zonedNow(CHAT_TIMEZONE),temperament:getTemperament(),
      jealousOfScreenAt:screenAt,draws:[Math.random(),Math.random()],returnDraw:Math.random()}]);
    store.transaction(()=>{
      if(JSON.stringify(getMood())!==JSON.stringify(mood)||JSON.stringify(getFeelings())!==JSON.stringify(feelings)
        ||JSON.stringify(getMonthTally())!==JSON.stringify(month)||jealousOfScreenAt!==screenAt)throw Error('core_mood_state_changed');
      for(const event of decision.feelingEvents)feelNow(event);
      for(const tally of decision.tallies)tallyMonth(tally);
      setMood(decision.patch);
    });
    jealousOfScreenAt=decision.jealousOfScreenAt;
    for(const event of decision.vitalEvents)nudgeVitals(event);
    return decision.result;
  }
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
  {
    const config=readAniListConfig(store.get('anilist')),decision=corePolicySync<any>('final-anilist.cache',[config,Date.now(),listFetchedAt,force]);
    if(decision.clear){cachedList=[];listError='';return;}if(!decision.refresh)return;
    try{cachedList=await userList(config.username,net.fetch);listFetchedAt=Date.now();listError='';}catch(error){listError=error instanceof Error?error.message:String(error);listFetchedAt=Date.now();}return;
  }
}

/** Their list as a prompt line, kicking off a refresh when it has gone stale. */
function aniListSummary() {
  {
    const decision=corePolicySync<any>('final-anilist.cache',[readAniListConfig(store.get('anilist')),Date.now(),listFetchedAt,false]);
    if(!decision.context)return '';if(decision.refresh)void refreshAniList();return formatList(cachedList);
  }
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
  {const packet=corePolicySync<any>('agenda-life.freshStart',[agendaFacts(ownedAgendaCore()),messages]);applyAgendaPlan(ownedAgendaCore(),packet,()=>{});return packet.result;}
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
  return corePolicySync<string[]>('agenda-life.herLinesLastDay',[ownedAgendaCore().docRef('config',{}),store.getArchive(),getAsides(),currentChatDayKey(),nowMs]);
}

/** The items an opening could lead with: not done, not past. Done and past
 *  ones are staleItemNamed's business, and matching against them only
 *  lengthens the list of things she is told not to say. */
function openItems(items: KeptItem[], todayKey: string): KeptItem[] {
  return corePolicySync<number[]>('agenda-life.openIndices',[items,todayKey]).map(i=>items[i]);
}

/** What is due today that she has not already brought up herself. */
function dueTodayCount(items: KeptItem[], statuses: ItemStatus[], todayKey: string, raised: KeptItem[]): number {
  return corePolicySync<number>('agenda-life.dueTodayCount',[items,statuses,todayKey,raised.map(i=>items.indexOf(i))]);
}

/** Nobody has touched the machine in this long, so nobody is at it — the same five minutes shouldPipeUp keeps. */
const AT_THE_DESK_SECONDS = 300;

async function composeOpening(): Promise<string | null> {
  return ownedComposeOpening();
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

/** What is switched on right now, for chatTools to draw the table from. */
function availableTools(turn: TurnContext): ToolAvailability {
  const search = readSearchConfig(store.get('search'));
  const systemConfig = readSystemConfig();
  return {
    choices: turn.offeringChoices(),
    booking: true,
    chats: true,
    journal: readJournalConfig(store.get('journal.config')).enabled,
    anilist: readAniListConfig(store.get('anilist')).enabled,
    web: turn.onWeb(),
    search: { enabled: search.enabled, readPages: search.readPages, transcripts: transcriptsAvailable() },
    knowledge: getKnowledgeConfig().enabled,
    browser: readBrowserControlConfig(store.get('browser')).enabled,
    // A fact for Core's tool menu: which browser that is.
    browserBackend: readBrowserControlConfig(store.get('browser')).backend,
    claude: readClaudeCodeConfig(store.get('claudeCode')).enabled,
    code: codeTasks() !== null,
    codeWaiting: codeTasks()?.waiting() ?? false,
    downloads: downloadsLink() !== null,
    shell: shellLink() !== null,
    mangaShelf: mangaShelfLink() !== null,
    system: { enabled: systemConfig.enabled, level: systemConfig.level },
    hands: turn.handsAllowed(),
    pictures: explicitModeNow(),
    desktop: ({launch:false,power:false}),
    knockedAwake: herKnockedAwakeNow(),
    anime: animeLink() !== null,
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
  if(!corePolicySync<boolean>('final-shell.available',[readSystemConfig(),store.get('system.config')??null,os.homedir()]))return null;
    return {run:input=>runCoreShell(input,{core:remainingStore(app.getPath('userData')),system:readSystemConfig,home:os.homedir(),run:runCommand,ledger:text=>{const dir=path.join(os.homedir(),'.config','haru');mkdirSync(dir,{recursive:true});appendFileSync(path.join(dir,'shell.log'),text);}})};
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
  return corePolicySync('anime-downloads.readFetches',[saved??null]);
    },
  });
}

/**
 * Claude Code sessions for his phone: opened with `claude --bg --remote-control`,
 * remembered under claudeCode.opened so she can give the link back and stop
 * only the ones she opened. Read per call, so switching it off takes effect on
 * the next turn.
 */
const OPENCODE_BIN = path.join(os.homedir(), '.npm-global/bin/opencode');
let codeTasksLink: CodeLink | null | undefined;
let codeModeLink: CodeModeLink | null | undefined;
let codeHub: ReturnType<typeof codeEventHub> | null = null;
/** Coding jobs handed to OpenCode (codetask.ts) and his own coding mode (codemode.ts): one OpenCode link each, null when OpenCode is not installed. */
function codeTasks(): CodeLink | null {
  if (codeTasksLink === undefined) codeTasksLink = existsSync(OPENCODE_BIN) ? codeLink({ api: openCodeApi(), jobs: codeJobs(path.join(app.getPath('userData'), 'code-jobs.json')), home: os.homedir(), listening: id => codeHub?.listening(id) ?? false }) : null;
  return codeTasksLink;
}
function codeModeNow(): CodeModeLink | null {
  if (codeModeLink === undefined) codeModeLink = existsSync(OPENCODE_BIN)
    ? codeMode({ api: openCodeApi(), hub: codeHub ??= codeEventHub(openCodeAuth()), jobs: codeJobs(path.join(app.getPath('userData'), 'code-jobs.json')), home: os.homedir(), file: path.join(app.getPath('userData'), 'code-mode.json') }) : null;
  return codeModeLink;
}
/** Each chase tick: her jobs' news becomes an aside (a phone event); his own coding-mode session pushes to him directly, only when he is not watching it. */
async function codeWatchTick() {
  try {
    await codeTasks()?.watch((line, about, direct) => { if (direct) void pushToPhone('events', line, 'haru://code'); else noteAside(line, 'code', about); });
  } catch (error) { console.warn('[code]', error instanceof Error ? error.message : 'failed'); }
}

function claudeSessions(): ToolDeps['claude'] {
  if(!readClaudeCodeConfig(store.get('claudeCode')).enabled)return null;
    return coreSessionLink({core:remainingStore(app.getPath('userData')),home:os.homedir(),dirs:LOCAL_DIRS,systemdRun:existsSync('/usr/bin/systemd-run')?'/usr/bin/systemd-run':null,sleep:ms=>new Promise(resolve=>setTimeout(resolve,ms)),run:(file,args,options)=>new Promise(resolve=>{execFile(file,args,{cwd:options.cwd,timeout:options.timeoutMs,maxBuffer:16*1024*1024},(error,stdout,stderr)=>resolve({ok:!error,stdout:String(stdout??''),stderr:String(stderr??error?.message??'')}));})});
}

function toolDeps(turn: TurnContext): ToolDeps {
  return {
    CHAT_TIMEZONE,
    net,
    store,
    getCheckIns, setCheckIns,
    getJournal, writeJournal,
    memoryTool:(name,args,message)=>runCoreMemoryTool(name,args,message,{core:remainingStore(app.getPath('userData')),sources:()=>blockSources(''),publish:events=>memoryStore.notifyCommitted(events)}),
    userRecord: (action,args)=>coreUserRecord(action,args),
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
    handsAllowed: turn.handsAllowed,
    onWeb: turn.onWeb,
    markPageRead: turn.markPageRead,
    pageWasRead: turn.pageWasRead,
    setPendingChoices: turn.setPendingChoices,
    requestRestart: turn.requestRestart,
    // Her night is hers: back to bed when she decides the wake was nothing (hersleep.ts).
    goBackToSleep: input => goBackToSleep(supplementOwned()?supplement('sleepInput',[input]):{ pointless: true, block: input.block, why: 'her call' }),
    booking: { book: bookFollowUp },
    chats: { search: searchOldChats },
    // Claude Code sessions he picks up in the Claude app (claudesession.ts).
    claude: claudeSessions(),
    // Coding jobs she hands to OpenCode (codetask.ts).
    code: codeTasks(),
    // The downloads, asked of qBittorrent at call time (downloads.ts).
    downloads: (link => link ? { status: () => link.status(), pause: title => link.pause(title), resume: title => link.resume(title) } : null)(downloadsLink()),
    // The terminal on the server (shell.ts), level 3.
    shell: shellLink(),
    // His manga, fetched at his word (suwayomi.ts).
    mangaShelf: mangaShelfLink(),
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
      // A local Ollama lists its models on its own endpoint, not OpenAI's /models.
      if (config.provider === 'ollama') {
        try { return await ollamaTags(config.endpoint); } catch (error) {
          console.warn(`[self] could not list the ${route} route's models:`, error instanceof Error ? error.message : error);
          return null;
        }
      }
      try { return await openAIModels(config.endpoint, config.provider as Provider); } catch (error) {
        console.warn(`[self] could not list the ${route} route's models:`, error instanceof Error ? error.message : error);
        return null;
      }
    },
    policyConfig:()=>remainingStore(app.getPath('userData')).get('config',{}),
    applyToolPlan:plan=>applyRemainingPlan(remainingStore(app.getPath('userData')),plan),
    changeMySetting: plan => applyPlanAtTheirWord(plan),
    makePicture: prompt => makeAndSendPicture(prompt),
    showWebPicture: result => showWebPicture(result, turn),
    lastResults: turn.lastResults,
    lastSearchQuery: turn.lastSearchQuery,
    rememberSearch: turn.rememberSearch,
    runSystemCommand,
    browserPort: () => readBrowserControlConfig(store.get('browser')).port,
    browserShotDir: () => {
      const saved = store.get('screenshots') as { folder?: string } | undefined;
      return typeof saved?.folder === 'string' && saved.folder ? saved.folder : path.join(app.getPath('userData'), 'browser-shots');
    },
    // The anime stack, likewise captured at call time (anime.ts).
    anime: (link => link ? { watch: input => link.watch(input), status: title => link.status(title) } : null)(animeLink()),
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
  {let host:string|null=null;try{host=new URL(endpoint.trim()).hostname}catch{}return naturalPolicy<boolean>('isRemote',[endpoint,host,os.networkInterfaces()]);}
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
  const direct = directCredentialName(endpoint);
  if (direct) {
    const configured = directProviderKey(endpoint);
    if (configured) return configured;
    if (direct === 'MIMO_API_KEY') return decryptSecret(store.get('mimoApiKey' as never) as string | undefined);
    if (direct === 'OPENAI_API_KEY') return getOpenAIKey();
    return '';
  }
  let host = '';
  try { host = new URL(endpoint.trim()).hostname.toLowerCase(); } catch { return ''; }
  if (/(^|\.)x\.ai$/.test(host)) return getRemoteKey();
  if (/(^|\.)openai\.com$/.test(host)) return getOpenAIKey();
  if (/(^|\.)venice\.ai$/.test(host)) return getVeniceKey();
  if (host === 'api.xiaomimimo.com') return decryptSecret(store.get('mimoApiKey' as never) as string | undefined);
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
  if (directCredentialName(endpoint)) return false;
  let host = '';
  try { host = new URL(endpoint.trim()).hostname.toLowerCase(); } catch { return true; }
  // The same three that requireKeyFor refuses for. Anything else — our own box,
  // a rented GPU — may legitimately have none.
  return !/(^|\.)(x\.ai|openai\.com|venice\.ai|xiaomimimo\.com)$/.test(host);
}

function requireKeyFor(endpoint: string, provider: Provider) {
  if (!isRemote(endpoint) || keyFor(endpoint)) return;
  const direct = directCredentialName(endpoint);
  if (direct) throw new Error(`Missing ${direct}; the direct provider is unavailable.`);
  // Only a company that demands a key is worth stopping for. Our own server may
  // have none — an unsecured box is a thing to warn about, not to refuse to
  // call, and refusing here would have broken pointing the model at a rented GPU
  // before it made a single request.
  let host = '';
  try { host = new URL(endpoint.trim()).hostname.toLowerCase(); } catch { /* handled below */ }
  const name = /(^|\.)x\.ai$/.test(host) ? 'xAI' : /(^|\.)openai\.com$/.test(host) ? 'OpenAI' : /(^|\.)venice\.ai$/.test(host) ? 'Venice' : /(^|\.)xiaomimimo\.com$/.test(host) ? 'MiMo' : '';
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
type PostOptions = { firstWordMs?: number; tools?: boolean;
  /** A table laid by the caller — her own pass — instead of the one the turn would be given. */
  table?: ChatTool[]; temperature?: number; format?: unknown; maxTokens?: number; onChunk?: (text: string) => void;
  /** Only an explicit chat turn can offer tools; background composers have none. */
  turn?: TurnContext;
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
function hostedTools(conversation: { role?: string; content?: string }[], turn: TurnContext): ChatTool[] {
  const day = localDateKey(zonedNow(CHAT_TIMEZONE));
  {
    const result=corePolicySync<{tools:ChatTool[];state:{day:string;names:string[]}}>('tool-menu.hosted',[
      availableTools(turn),conversation,day,{day:heldTools.day,names:[...heldTools.names]}]);
    heldTools.day=result.state.day;heldTools.names=new Set(result.state.names);return result.tools;
  }
}

/** The last thing the user actually said — what the tool table should be laid for. */
function latestUserText(conversation: { role?: string; content?: string }[]): string {
  for (let index = conversation.length - 1; index >= 0; index--) {
    if (conversation[index].role === 'user') return conversation[index].content ?? '';
  }
  return '';
}

async function openAIPost(conversation: OllamaMessage[], config: ProviderConfig, { tools = true, table, temperature = config.temperature, format, maxTokens, onChunk, signal, cacheKey, turn }: PostOptions = {}) {
  requireKeyFor(config.endpoint, (config.provider as Provider) ?? 'openai');
  const body = toOpenAIBody({
    model: config.model,
    conversation,
    tools: tools && !toolless.has(config.model) ? table ?? (turn && !turn.pageWasRead() ? hostedTools(conversation, turn) : undefined) : undefined,
    temperature,
    maxTokens,
    json: Boolean(format),
    stream: Boolean(onChunk),
    provider: config.provider,
    cacheKey,
  });
  assertOutboundSafe(conversation, (body as { tools?: unknown[] }).tools);
  const response = await coreCloudFetch((url,init)=>net.fetch(url,init), `${trimEndpoint(config.endpoint)}/chat/completions`, {
    method: 'POST',
    headers: modelHeaders(config.endpoint),
    body: JSON.stringify(body),
    ...(signal ? { signal } : {}),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    // Same courtesy as the Ollama path: a model without tools loses its hands,
    // not its voice.
    if (toolsUnsupported(response.status, detail) && tools) {
      toolless.add(config.model);
      console.warn(`[ai] ${config.model} rejected the tools — retrying without them. She cannot save reminders on this model.`);
      return sendToProvider(conversation, config, { tools: false, temperature, format, maxTokens, onChunk, signal, cacheKey, turn });
    }
    throw new Error(describeFailure(response.status, detail, (config.provider as Provider) ?? 'openai'));
  }
  if (onChunk) return streamOpenAI(response, onChunk, config.model);
  const reply = await response.json();
  notePromptCache(config.model, (reply as { usage?: unknown }).usage);
  return fromOpenAIReply(reply, config.model) as OllamaMessage;
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
  return readOpenAIStream(response, onChunk, model, usage => notePromptCache(model, usage));
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
  return naturalPolicy<any>('homeTwin',[config,isRemote(config.endpoint),LOCAL_MODELS]);
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
async function ollamaPost(conversation: OllamaMessage[], config: ProviderConfig, { tools = true, table, temperature = config.temperature, format, maxTokens, onChunk, numCtx, turn, signal }: PostOptions = {}) {
  return runCoreProviderFallback(conversation,modelForNow(config),{...naturalPolicy<any>('postOptions',[config,{tools:arguments[2]?.tools,temperature:arguments[2]?.temperature}]),table,format,maxTokens,onChunk,numCtx,turn,signal});
}

async function refreshTaskCatalog() {
  const updates = await Promise.all(DIRECT_MODELS.map(async model => {
    try {
      const response = await net.fetch(model.source, { signal: AbortSignal.timeout(20_000) });
      if (!response.ok) return undefined;
      return directCatalogEntry(model, await response.text());
    } catch { return undefined; }
  }));
  const verified = updates.filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));
  // Venice routes need current rates too; otherwise their eligibility expires after 24 hours.
  const veniceRoutes = ((store.get('ai.modelRegistry') as any)?.entries ?? []).filter((entry: any) => entry.config?.provider === 'venice');
  if (veniceRoutes.length && getVeniceKey()) {
    try {
      const response = await net.fetch('https://api.venice.ai/api/v1/models', {
        headers: { Authorization: `Bearer ${getVeniceKey()}` }, signal: AbortSignal.timeout(20_000),
      });
      if (response.ok) {
        const entries = veniceRegistryEntries(await response.json(), veniceRoutes)
          .map(entry => ({ ...entry, pricingSource: 'https://api.venice.ai/api/v1/models' }));
        verified.push(...entries as typeof verified);
      }
    } catch { /* Existing verified rates expire normally if the catalog is unavailable. */ }
  }
  // NanoGPT routes (e.g. the hosted conversation model) live on a host, not in
  // DIRECT_MODELS. Without this their price would age past 24h and the route
  // would silently drop back to local, so refresh each one from its model page.
  const nanoRoutes = ((store.get('ai.modelRegistry') as any)?.entries ?? []).filter((entry: any) => {
    try { return Boolean(entry.config?.endpoint) && /(^|\.)nano-gpt\.com$/i.test(new URL(entry.config.endpoint).hostname); } catch { return false; }
  });
  if (nanoRoutes.length) {
    const nano = await Promise.all(nanoRoutes.map(async (entry: any) => {
      try {
        const source = `https://nano-gpt.com/models/text/${entry.config.model}`;
        const response = await net.fetch(source, { signal: AbortSignal.timeout(20_000) });
        if (!response.ok) return undefined;
        const pricing = nanoGptPricing(await response.text());
        if (!pricing) return undefined;
        return { id: entry.id, role: entry.role, config: entry.config, enabled: true,
          capabilities: entry.capabilities, pricing, pricingVerifiedAt: Date.now(), pricingSource: source };
      } catch { return undefined; }
    }));
    const priced = nano.filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));
    if (priced.length) console.log(`[tasks] refreshed ${priced.length} NanoGPT price(s) from the model page`);
    verified.push(...priced as typeof verified);
  }
  const ablitRoutes = ((store.get('ai.modelRegistry') as any)?.entries ?? []).filter((entry: any) =>
    entry.config?.endpoint === 'https://api.abliteration.ai/v1' && entry.config?.model === 'abliterated-model-large-v2');
  if (ablitRoutes.length) {
    try {
      const source = 'https://docs.abliteration.ai/pricing.md';
      const response = await net.fetch(source, { signal: AbortSignal.timeout(20_000) });
      const pricing = response.ok ? abliterationPricing(await response.text()) : null;
      if (pricing) verified.push(...ablitRoutes.map((entry: any) => ({ ...entry, pricing, pricingVerifiedAt: Date.now(), pricingSource: source })));
    } catch { /* Existing verified pricing expires normally. */ }
  }
  if (verified.length) store.set('ai.modelRegistry', refreshDirectEntries(store.get('ai.modelRegistry') as any, verified));
  console.log(`[tasks] refreshed ${verified.length} provider prices; unavailable prices expire after 24h`);
}

app.whenReady().then(() => { void refreshTaskCatalog(); setInterval(() => void refreshTaskCatalog(), 3_600_000); });

const providerAvailability = new ProviderAvailability(event => {
  console.log('[provider-availability] '+JSON.stringify(event));
  sendToWindows('ai:fellBack', `${event.model} is blocked by its billing account. Haru will skip this provider for five minutes and use an eligible fallback.`);
}, Date.now, store.get('ai.providerAvailability'), rows=>store.set('ai.providerAvailability',rows),
  ({
    read:()=>remainingStore(app.getPath('userData')).get('config',{}),
    commit:plan=>applyRemainingPlan(remainingStore(app.getPath('userData')),plan as any),
  }));
const taskBridge = new TaskBridge();
app.on('before-quit', taskBridge.close);
void taskBridge.call('health', {}).then(() => console.log('[tasks] durable worker ready')).catch(() => console.warn('[tasks] durable worker unavailable; chat fails closed'));
async function sendToProvider(conversation: OllamaMessage[], config: ProviderConfig, options: PostOptions = {}): Promise<OllamaMessage> {
  // A detached composer can start before its parent's foreground scope closes.
  // Match the durable background classification below instead of inheriting
  // foreground privileges merely through AsyncLocalStorage.
  const backgroundComposition = false;
  const runBackground=(corePolicySync<boolean>('inference-priority.provider',[isLocalConfig(config),inferencePriority.inForeground,(true as boolean),Boolean(activeTask.getStore()),Boolean(options.turn),options.tools===false,options.table?.length===0]));
  if (runBackground) {
    return inferencePriority.runBackground(config.endpoint, protectedInferenceEndpoint(), signal =>
      sendToProviderAdmitted(conversation, config, { ...options, signal: options.signal ? AbortSignal.any([options.signal, signal]) : signal }));
  }
  return sendToProviderAdmitted(conversation, config, options);
}

async function sendToProviderAdmitted(conversation: OllamaMessage[], config: ProviderConfig, options: PostOptions = {}): Promise<OllamaMessage> {
  options.signal?.throwIfAborted();
  providerAvailability.assertAvailable(config);
  const replySignal = isLocalConfig(config) ? inferencePriority.replySignal : undefined;
  if (replySignal) options = { ...options, signal: options.signal ? AbortSignal.any([options.signal, replySignal]) : replySignal };
  const table = options.table ?? (options.tools !== false && options.turn && !options.turn.pageWasRead()
    ? isOpenAIShaped(config.provider) ? hostedTools(conversation, options.turn) : chatTools(availableTools(options.turn), latestUserText(conversation)) : []);
  if (!isLocalConfig(config)) {
    if (!isAllowedTaskProvider(config)) throw new Error('provider_not_allowed');
    assertOutboundSafe(conversation, table);
  }
  const task = activeTask.getStore();
  if(!task&&!options.turn&&!table.length){   // 4010: every hosted call without a live task gets its own ledger task; scheduled jobs only before, the rest died unlogged as cloud_task_required
    const registry=[...readModelRegistry(store.get('ai.modelRegistry'),{
      local:(store.get('ai.config') as ProviderConfig|undefined)??config,conversation:store.get('ai.conversation') as ProviderConfig|undefined,
      specialist:store.get('escalate.provider') as ProviderConfig|undefined,vision:readVisionConfig(store.get('vision')),
    }),...naturalPolicy<ModelEntry[]>('readerEntries',[])];   // 4080: the Core's reader entries (DeepSeek, Opus) for this one task only, never for routing
    // Keep the requested route. Scheduled hosted follow-ups receive the same
    // durable budgets, one attempt, no tools and a forty-second ceiling.
    const local=isLocalConfig(config),policy=readTaskPolicy(store.get('ai.taskPolicy'));
    const background=new TaskController(taskBridge.call,registry,{...policy,
      taskBudgetMicros:local?0:policy.taskBudgetMicros,dailyBudgetMicros:local?0:policy.dailyBudgetMicros,
      maxAttempts:1,maxToolCalls:0,maxEscalations:0,deadlineMs:local?180000:Math.min(40000,policy.deadlineMs)},!local);
    const job=activeScheduledJob.getStore()?.kind;   // 3960: which job spent it (the ledger grouped every composition under one label)
    // 4020: a hosted call outside a job is her answering him (second thought, opening line, remarks); background priority was
    // refused for 180 s after he spoke, i.e. always. Foreground runs beside his turns without queueing them; jobs stay background (startPriority).
    await background.start('Background model composition (no actions)'+(job?' — '+job:' — unscheduled'),config.model,local?'background':'foreground');
    let reply:OllamaMessage|undefined;
    await background.compose(async()=>{reply=await sendToProviderAdmitted(conversation,config,{...options,tools:false,table:[]});return reply;},conversation);
    return withToolContract(reply!,[]);
  }
  const run = (signal: AbortSignal, onChunk: (text: string) => void, maxTokens?: number) => providerAvailability.run(config, () => sendToProviderUnchecked(conversation, config,
    { ...options, table, ...(maxTokens ? { maxTokens } : {}), signal, ...(options.onChunk ? { onChunk } : {}) }));
  if (task) return withToolContract(await task.post(conversation, config, table, options.maxTokens, run, options.onChunk, options.firstWordMs, options.signal), options.tools === false ? [] : table);
  if (!isLocalConfig(config)) throw new Error('cloud_task_required');
  return withToolContract(await guardedRequest((signal, chunk) => run(signal, chunk), { signal: options.signal, totalMs: 180_000, firstWordMs: options.firstWordMs, onChunk: options.onChunk }), options.tools === false ? [] : table);
}

async function sendToProviderUnchecked(conversation: OllamaMessage[], config: ProviderConfig, { tools = true, table, temperature = config.temperature, format, maxTokens, onChunk, signal, cacheKey, numCtx, turn }: PostOptions = {}) {
  conversation = withImageBytes(conversation);
  if (config.model === 'gpt-6-astra' && new URL(config.endpoint).hostname === 'api.openai.com') {
    requireKeyFor(config.endpoint, 'openai');
    const body = toResponsesBody({ model: config.model, conversation, tools: tools ? table : undefined, maxTokens: maxTokens ?? 2048, stream: Boolean(onChunk), cacheKey });
    const response = await coreCloudFetch((url,init)=>net.fetch(url,init), `${trimEndpoint(config.endpoint)}/responses`, {
      method: 'POST', headers: modelHeaders(config.endpoint), body: JSON.stringify(body), ...(signal ? { signal } : {}),
    });
    if (!response.ok) throw new Error(describeFailure(response.status, await response.text().catch(() => ''), 'openai'));
    return onChunk ? streamResponses(response, config.model, onChunk) : fromResponsesReply(await response.json(), config.model);
  }
  // Routed here rather than at every call site: there are a dozen composers in
  // this file and none of them should know which provider is answering.
  if (config.provider === 'anthropic') {
    requireKeyFor(config.endpoint, 'anthropic');
    const body = toAnthropicBody({ model: config.model, conversation, tools: tools ? table : undefined, maxTokens: maxTokens ?? 4096, stream: Boolean(onChunk) });
    const response = await coreCloudFetch((url,init)=>net.fetch(url,init), `${trimEndpoint(config.endpoint)}/messages`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': keyFor(config.endpoint), 'anthropic-version': '2023-06-01' },
      body: JSON.stringify(body), ...(signal ? { signal } : {}),
    });
    if (!response.ok) throw new Error(describeFailure(response.status, await response.text().catch(() => ''), 'anthropic'));
    return onChunk ? streamAnthropic(response, config.model, onChunk) : fromAnthropicReply(await response.json(), config.model);
  }
  if (isOpenAIShaped(config.provider)) return openAIPost(conversation, config, { tools, table, temperature, format, maxTokens, onChunk, signal, cacheKey, turn });
  const chatConfig = store.get('ai.config') as ProviderConfig | undefined;
  const contextSize = requestContextSize(config, chatConfig ? modelForNow(chatConfig) : undefined, chatNumCtx(), numCtx ?? sideNumCtx());
  const send = async (withTools: boolean, streaming: boolean, quiet = true) => {
    const offered = table ?? (withTools && turn && !turn.pageWasRead() ? chatTools(availableTools(turn), latestUserText(conversation)) : []);
    if (offered.length) {
      // The estimate is a rough chars/4 token count of the conversation being
      // sent — the tool round's prompt — so the real peak can be measured
      // against num_ctx instead of guessed at.
      const est = Math.round(JSON.stringify(conversation).length / 4);
      console.log(`[ai] offering ${offered.length} tools to ${config.model} (prompt ~${est} tokens)`);
    }
    try {
      return await coreModelFetch((url,init)=>net.fetch(url,init), `${trimEndpoint(config.endpoint)}/api/chat`, {
        method: 'POST',
        ...(signal ? { signal } : {}),
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
          options: { temperature, num_ctx: contextSize, ...(maxTokens ? { num_predict: maxTokens } : {}) },
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
  return receivedProviderMessage(data.message);
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
    let payload: { message?: OllamaMessage; error?: string };
    try { payload = JSON.parse(line) as typeof payload; } catch { console.warn(`[ai] dropped an unreadable stream line (${line.length} chars)`); return; }
    if (payload.error) throw new Error(`Local provider stream failed: ${payload.error}`);
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
  return receivedProviderMessage(message);
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
  return conversationRun('voice',{answer,recent,maxTokens:options.maxTokens??null,stream:Boolean(options.onChunk)},options.onChunk);
}

/** The same call as ollamaQuip, keeping every line — for an answer that comes in a shape. */
/** A cue goes out as a stage direction, with the system told so; anything with real content in it goes out as it is. */
function composerTurns(system: string, user: string): { role: string; content: string }[] {
  return corePolicySync<any>('conversation-program.composerTurns',[system,user]);
}

async function ollamaQuipLong(system: string, user: string, config: ProviderConfig): Promise<string> {
  return conversationRun('long',{system,user,config});
}

async function ollamaQuip(system: string, user: string, config: ProviderConfig) {
  return conversationRun('quip',{system,user,config});
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
  return corePolicySync<string>('conversation-policy.toLength',[text,limit]);
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
  return corePolicySync<string>('conversation-program.stillTalkingAbout',[speakingNow,speakingLine]);
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
  return naturalPolicy<string>('recentExchange',[store.get('chat.messages')??[],arguments[0]??null,arguments.length===0||arguments[0]===undefined]);
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
  return corePolicySync<boolean>('conversation-policy.reusesExample',[line,examples]);
}

async function quipOfHerOwn(system: string, user: string, config: ProviderConfig, examples: string[]) {
  return conversationRun('own',{system,user,config,examples});
}

export function ollamaRetort(disliked: string, config: ProviderConfig) {
  {const p=corePolicySync<any>('conversation-program.reaction',['retort',disliked,0,getActiveCharacter().identity,store.get('chat.messages')??[],speakingNow,speakingLine]);return quipOfHerOwn(p.system,p.user,config,p.examples);}
}

// Praise is not thanked for, it is cashed in. The line should read as her taking
// the approval as licence rather than as a compliment received.
export function ollamaGloat(praised: string, config: ProviderConfig, ego: number) {
  {const p=corePolicySync<any>('conversation-program.reaction',['gloat',praised,ego,getActiveCharacter().identity,store.get('chat.messages')??[],speakingNow,speakingLine]);return quipOfHerOwn(p.system,p.user,config,p.examples);}
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
  return corePolicySync<KeptItem|null>('agenda-life.chase',[open,ownedAgendaCore().docRef('config',{}),getAsides(),Date.now()]);
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
  return ownedAgendaSpoken('putOff',said);
}

/**
 * "Getting it done now" ticks nothing off — it says they have started. The
 * item is marked underway: chases hold off for a while, and the next thing
 * she raises unprompted is how it is going (composeSpontaneousNudge). Without this she
 * answered "I'll take it" and then, half an hour on, needled them about an
 * old day summary as if the task had never been mentioned.
 */
function startedSpoken(said: string) {
  return ownedAgendaSpoken('started',said);
}

function tickOffSpoken(said: string) {
  return ownedAgendaSpoken('tick',said);
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
  return askForOwnedJournal();
}

/**
 * She noticed you moved. Called from the renderer on a tab change; nearly every
 * call does nothing, which is the intent — see noticing.ts for the budget.
 */
async function noticePage(page: NoticedPage) {
  {const read=()=>({config:remainingStore(app.getPath('userData')).docRef('config',{}),day:localDateKey(zonedNow(CHAT_TIMEZONE)),now:Date.now(),lastInterjectionAt,journal:getJournal(),memories:getMemories(),sessions:getSessions(),profile:getProfile(),voice:getVoiceConfig(),search:readSearchConfig(store.get('search')),character:getActiveCharacter(),context:unpromptedContext()});const p=corePolicySync<any>('context-preparation.noticeStart',[page,read()]);if(p.action==='stop')return;applyRemainingPlan(remainingStore(app.getPath('userData')),p.plan);try{const m=await ollamaPost(p.request.messages,p.request.config,p.request.options);activeTask.getStore()?.signal.throwIfAborted();const result=corePolicySync<any>('context-preparation.noticeObserved',[p.state,m.content??'',read()]);if(result&&interject(result.line,{source:result.source}))void speak(result.line,classifyEmotion(result.line,result.provider));}catch(error){console.warn('[notice]',error instanceof Error?error.message:'failed');}return;}
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

    {const result=coreUserRecord('checkins.merge',{entries:theirs});if(result.what)console.log('[checkins] '+result.what);return;}
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

    activityReporter.connected(source, cookie);

    const got = await net.fetch(source.url + '/api/memory/records', { headers });
    // An older server has the route this replaced and not this one. Say so once
    // and plainly, rather than letting it read as the server being unreachable.
    if (got.status === 404) { console.warn('[memory] that server is too old to sync memories'); return; }
    if (!got.ok) { console.warn('[memory] could not read them (' + got.status + ')'); return; }
    const body = await got.json() as { memories?: unknown; deletions?: unknown; slate?: unknown };

    // Before the merge, and before the push below: if her brain has reset, this
    // machine is holding a mirror of a Haru who no longer exists, and the push
    // would hand the whole of it back.
    followSlate(body);

    const report = mergeIn(withoutPreSlate(body, getSlate()));
    const what = describeMerge(report);
    if (what) console.log('[memory] ' + what + ' from the server');

    // Everything, not just what changed: the server has no idea which of these
    // it is missing, and sixty records is a smaller thing to send than the
    // bookkeeping that would work it out.
    const sent = await net.fetch(source.url + '/api/memory/records', {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({ memories: getMemories(), deletions: memoryStore.getDeletions() }),
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

/** The fetches she has started (anime.ts), newest last. Bounded: a season of asks, not a history. */
const ANIME_FETCHES_KEPT = 40;

function readAnimeFetches(): AnimeFetch[] {
  const saved = store.get('anime.fetches');
  return Array.isArray(saved) ? saved.filter((item): item is AnimeFetch => Boolean(item) && typeof item === 'object' && typeof (item as AnimeFetch).seriesId === 'number') : [];
}

/**
 * The anime stack, or null when any of its three servers is not wired up.
 *
 * Built per call: the keys are read from the apps'
 * own files each time, so a rotated key is picked up on the next ask rather
 * than after a restart. Jellyfin's is hers (the Settings panel), because
 * Jellyfin keeps its in a database rather than a file.
 */
function animeLink(): AnimeLink | null {
  const config = readAnimeConfig(store.get('anime'));
  if (!config.enabled) return null;
  const jellyfin = readJellyfinConfig(store.get('jellyfin'));
  const jellyfinKey = decryptSecret(store.get('jellyfinApiKey') as string | undefined);
  if (!jellyfin.url || !jellyfin.userId || !jellyfinKey) return null;
  const sonarrKey = apiKeyFrom(config.sonarr.apiKeyFile);
  const prowlarrKey = apiKeyFrom(config.prowlarr.apiKeyFile);
  if (!sonarrKey || !prowlarrKey) return null;
  const playbackSnapshot=()=>JSON.stringify([readAnimeConfig(store.get('anime')),readJellyfinConfig(store.get('jellyfin')),store.get('jellyfinApiKey')??null]);
  const playbackBinding=playbackSnapshot();
  const assertPlaybackCurrent=()=>{
    if(playbackSnapshot()!==playbackBinding)throw Error('anime_playback_config_stale');
  };
  return new AnimeLink(
    config,
    { jellyfinUrl: jellyfin.url, jellyfinUserId: jellyfin.userId, jellyfinKey, sonarrKey, prowlarrKey },
    (url, init) => net.fetch(url, init),
    {
      fetches: readAnimeFetches,
      downloadEffects:()=>store.get('anime.downloadEffects')??null,
      watchRecords:()=>store.get('anime.fetchWatches')??null,
      commitDownload:plan=>{
        assertPlaybackCurrent();
        if(JSON.stringify(store.get('anime.downloadEffects')??null)!==JSON.stringify(plan.expected))throw Error('anime_download_receipt_stale');
        store.set('anime.downloadEffects',plan.ledger);
      },
      commitWatch:plan=>{
        assertPlaybackCurrent();
        if(JSON.stringify(store.get('anime.fetchWatches')??null)!==JSON.stringify(plan.expected))throw Error('anime_watch_state_stale');
        store.set('anime.fetchWatches',plan.records);
      },
      playbackEffects:()=>store.get('anime.playbackEffects')??null,
      assertPlaybackCurrent,
      commitPlayback:plan=>{
        assertPlaybackCurrent();
        if(JSON.stringify(store.get('anime.playbackEffects')??null)!==JSON.stringify(plan.expected))throw Error('anime_playback_receipt_stale');
        store.set('anime.playbackEffects',plan.ledger);
      },
      keep: async fetch => {
        {
          assertPlaybackCurrent();
          const plan=corePolicySync<any>('anime-downloads.keepFetch',[store.get('anime.fetches')??null,fetch]);
          if(JSON.stringify(store.get('anime.fetches')??null)!==JSON.stringify(plan.expected))throw Error('anime_fetch_state_stale');
          store.set('anime.fetches',plan.fetches);
        }
        // The watch that files it and says when it is in (animefetch.ts).
        await scheduler.add(fetchJob(fetch, Date.now()));
        console.log(`[anime] fetching ${fetch.title}: ${fetch.release} (${Math.round(fetch.sizeBytes / 2 ** 30)} GB, ${fetch.episodes} episodes) — watched every ${FETCH_EVERY_MS / 60_000} min for ${FETCH_FOR_MS / 3_600_000} h`);
      },
      markImported: (seriesId, atIso) => {
        {
          assertPlaybackCurrent();
          const plan=corePolicySync<any>('anime-downloads.markImported',[store.get('anime.fetches')??null,seriesId,atIso]);
          if(JSON.stringify(store.get('anime.fetches')??null)!==JSON.stringify(plan.expected))throw Error('anime_fetch_state_stale');
          store.set('anime.fetches',plan.fetches);
        }
      },
    },
  );
}

/**
 * A fetch she started, watched until it is on Jellyfin (animefetch.ts).
 *
 * The mechanical half runs whatever the hour: read the queue, and once the
 * torrent is down, hand Sonarr the file list with the show named and tell it
 * to import. Only the line waits for a moment she may speak — the same
 * moments a booking waits for — so a pack that lands at 4 AM is filed at
 * 4 AM and mentioned at breakfast.
 */
const fetchWatchState = new Map<number, { misses: number; rescanAskedAt: number }>();

async function watchFetch(job: Job): Promise<Outcome> {
  {
    const link=animeLink();
    if(!link)return corePolicySync('anime-downloads.watchUnavailable',[Date.now()]);
    const facts=()=>({pushback:store.get('pushback')??null,prefs:getPush().prefs,local:zonedNow(CHAT_TIMEZONE),asleep:herAsleepNow(),knockedAwake:herKnockedAwakeNow(),wakeAt:herWakeAt()??null,
      theyUp:theyAreUpNow(),lastUserActivityAt,lastInterjectionAt,quietAfterUserMs:QUIET_AFTER_USER_MS,interjectGapMs:INTERJECT_GAP_MS});
    return link.runFetchWatch(job,async(op,args)=>{
      switch(op){
        case 'notifyFacts':return facts();
        case 'composeNotice':{
          try{return {line:await composeUnprompted(args[0].prompt)}}catch{return {line:null}}
        }
        case 'publish':{
          const fresh=facts();
          if(JSON.stringify(Object.fromEntries(Object.keys(args[3]).map(k=>[k,(fresh as any)[k]])))!==JSON.stringify(args[3]))throw Error('anime_notice_facts_stale');
          lastInterjectionAt=Date.now();const aside=noteAside(args[0],'anime',args[1].slice(0,80));return {accepted:true,aside,storedAside:getAsides().find(item=>item.id===aside?.id)??null};
        }
        default:throw Error('anime_notification_command_invalid');
      }
    });
  }
}

function coreUserRecord(action:string,args:unknown):any{
  const core=remainingStore(app.getPath('userData'));
  return commitUserRecord(action,args,{core,read:()=>{const now=zonedNow(CHAT_TIMEZONE);return {config:core.get('config',{}),today:localDateKey(now),at:new Date().toISOString()};},
    publish:(name,value)=>sendToWindows(name,value),asked:date=>{journalAskedOn=date;}});
}
async function askForOwnedJournal(){
  const core=remainingStore(app.getPath('userData'));const scope=activeScheduledJob.getStore();
  if(!scope)throw Error('core_journal_scope_required');
  let context='';
  const read=()=>{if(JSON.stringify(activeScheduledJob.getStore())!==JSON.stringify(scope))throw Error('core_journal_scope_changed');
    const now=zonedNow(CHAT_TIMEZONE),character=getActiveCharacter();return {scope,config:core.get('config',{}),today:localDateKey(now),at:new Date().toISOString(),nowMs:Date.now(),hour:now.getHours(),minute:now.getMinutes(),identity:character.identity,style:character.style,context};};
  try{const result=await runOwnedJournal({core,read,prepare:()=>{context=unpromptedContext();},compose:c=>ollamaPost(c.messages,c.provider,c.options),publish:c=>interject(c.line,{source:c.source})});
    if(result.askedOn!==undefined)journalAskedOn=result.askedOn;
    if(result.speech)void speak(result.speech.line,classifyEmotion(result.speech.line,result.speech.provider));
    console.log('[core-journal] '+JSON.stringify({status:result.status}));
  }catch(error){console.warn('[core-journal] attempt unresolved:',error instanceof Error?error.message:String(error));}
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
  coreUserRecord('checkins.replace',next);return;
}

function getJournal(): JournalEntry[] {
  return readEntries(store.get('journal.entries'));
}

function setJournal(entries: JournalEntry[]) {
  coreUserRecord('journal.replace',{entries});return;
}

/**
 * Saves what she was told. Returns the day's entry so she can react to it having
 * landed rather than announcing a save she did not verify.
 */
function writeJournal(text: string, ratings: { mood?: number; anxiety?: number; energy?: number; sleep?: number }, prompted: boolean) {
  return coreUserRecord('journal.write',{text,...ratings,prompted}) as JournalEntry|undefined;
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
  awaitingAccount=corePolicySync<string|null>('agenda-life.sheAsked',[line,getKept(),agendaClock(zonedNow(CHAT_TIMEZONE))]);return;
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
  {const packet=corePolicySync<any>('agenda-life.accounted',[said,awaitingAccount,agendaFacts(ownedAgendaCore()),new Date().toISOString(),randomUUID()]);applyAgendaPlan(ownedAgendaCore(),packet,ownedAgendaChanged);awaitingAccount=packet.awaiting;return;}
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
  hosted?: boolean; role?: ModelRole; entryId?: string };

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
  return corePolicySync<any>('conversation-program.revoiceSetting',[remainingStore(app.getPath('userData')).docRef('config',{})]);
}
function revoiceState() { return readRevoiceState(store.get('revoice')); }

/** Their messages since the last pass, today and in the archive. */
function messagesSinceRevoice(): number {
  return corePolicySync<number>('conversation-program.messagesSinceRevoice',[remainingStore(app.getPath('userData')).docRef('config',{}),store.getArchive()]);
}

let revoicing = false;
let revoiceRetryAt = 0;
async function runRevoice(why: string): Promise<{ shown: number; rewritten: number; kept: number; dropped: number; model: string } | { error: string }> {
  {const p=corePolicySync<any>('conversation-program.revoiceAdmission',[{...conversationRevoiceFacts(),id:randomUUID()},why]);if(Object.hasOwn(p,'result'))return p.result;conversationApply(p);revoicing=true;try{let observed:any;try{observed={ok:true,value:await sendToProvider(p.command.messages,p.command.config,p.command.options)};}catch(error){observed={ok:false,error:error instanceof Error?error.message:String(error)};}const done=corePolicySync<any>('conversation-program.revoiceObserved',[p.state,observed,conversationRevoiceFacts()]);conversationApply(done);revoiceRetryAt=done.retryAt;return done.result;}finally{revoicing=false;}}
}

function considerRevoicing() {
  {const why=corePolicySync<string|null>('conversation-program.considerRevoicing',[conversationRevoiceFacts()]);if(why)return runRevoice(why);return;}
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
  {clearTimeout(secondThoughtTimer);const at=Date.now(),facts={hers:input.hers,ranting:input.ranting,replyLength:input.reply.length},odds=sway('second-thought',SECOND_THOUGHT_ODDS,swayNow());let rolls:number[]=[];let p=corePolicySync<any>('conversation-program.secondSchedule',[facts,at,lastSecondThoughtAt,odds,rolls]);while(p.draws){while(rolls.length<p.draws)rolls.push(Math.random());p=corePolicySync<any>('conversation-program.secondSchedule',[facts,at,lastSecondThoughtAt,odds,rolls]);}if(p.result)secondThoughtTimer=setTimeout(()=>{void secondThought(p.result.repliedAt,input);},p.result.delay);return;}
}

async function secondThought(repliedAt: number, input: { latest: string; reply: string; config: ProviderConfig }) {
  {const p=corePolicySync<any>('conversation-program.secondStart',[repliedAt,input,conversationSecondFacts()]);if(Object.hasOwn(p,'result'))return;try{const answer=await Promise.race([sendToProvider(p.command.messages,p.command.config,p.command.options),new Promise<never>((_,reject)=>setTimeout(()=>reject(Error('no answer in 40s')),p.command.timeoutMs))]);const done=corePolicySync<any>('conversation-program.secondObserved',[p.state,answer.content??'',conversationSecondFacts()]);if(!done.result)return;lastSecondThoughtAt=done.result.at;lastInterjectionAt=done.result.at;noteAside(done.result.line,'followup',done.result.about);}catch(error){console.warn('[followup]',error instanceof Error?error.message:'failed');}return;}
}

/** A fixed loopback port for the Google consent answer, so the ssh forward can be written down once. */
const GOOGLE_CONSENT_PORT = 8790;
let pendingGoogleConsent: Promise<{ url: string; port: number }> | null = null;

function conversationRoute(): ProviderConfig | null {
  const route = store.get('ai.conversation') as ProviderConfig | undefined;
  if (process.env.HARU_SERVICE_FUNDING_GUARD === 'on') {
    return corePolicySync<ProviderConfig | null>('credit-guard.conversationRoute', [remainingStore(app.getPath('userData')).docRef('config', {}), {
      allowed: Boolean(route?.model && isAllowedTaskProvider(route)), keyAvailable: Boolean(route?.model && hasKeyFor(route.endpoint)),
    }]);
  }
  if (!route?.model || !isAllowedTaskProvider(route) || !hasKeyFor(route.endpoint)) return null;
  return route;
}

/** Initial role selection. Rechecked against the complete prompt and tools before dispatch. */
async function brainFor(
  message: string, local: ProviderConfig, conversation: { role: string; content: string }[] = [],
  { pictures = false, files = false, call = false } = {},
): Promise<Brain> {
  {const setting=readEscalateConfig(store.get('escalate')),vision=readVisionConfig(store.get('vision')),registry=callRegistry(readModelRegistry(store.get('ai.modelRegistry'),{local,conversation:store.get('ai.conversation') as ProviderConfig|undefined,specialist:store.get('escalate.provider') as ProviderConfig|undefined,vision}),store.get('ai.callConversation'),call);const intent=await coreTaskIntent(message,{pictures,files,minWords:setting.minWords,history:conversation}),policy=readTaskPolicy(store.get('ai.taskPolicy'));const request:RouteRequest={...naturalPolicy<any>('brainRequest',[message,conversation,intent,policy,setting,pictures]),available:entry=>providerAvailability.available(entry.config)&&(entry.local||hasKeyFor(entry.config.endpoint))};const chosen=(await naturalSelection(()=>selectCallModel(registry,intent.role,request),()=>coreSelectTaskModel(registry,intent.role,request)));return naturalPolicy<any>('brainFinished',[chosen??null,local,registry,intent.reason]);}
}
function brainFromEntry(entry: ModelEntry, because: string): Brain {
  return naturalPolicy<any>('brainFromEntry',[entry,because]);
}
function observeTaskModel(model: string, succeeded: boolean) {
  conversationCommit(app.getPath('userData'),naturalPolicy<any>('modelObserved',[remainingStore(app.getPath('userData')).docRef('config',{}),model,succeeded]));return;
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
  call = false,
): Promise<(T & { images?: string[] })[]> {
  return foldCoreAttachments(messages,inPlay,sees,a=>readAttachment(a,vision,provider),imageForSending,call);
}

const finishLocalReply: typeof finishLocalReplyUntimed = (...args) => timeTurnReview(() => finishLocalReplyUntimed(...args));
const naturalPreferences = new ConversationPreferenceCache();

configureAffect(() => remainingStore(app.getPath('userData')));
/** 3770: a call turn's memory read, started at turn entry with the same inputs the retrieval step will use (its time, request and
 *  the texts to embed; the recall text is asked for whenever the embedder can make it, and dropped later if recall is not used). */
function startCallMemory(latest: string, recentUserContext: string) {
  const config = readCoreMemoryConfig();
  const sourceRevision = store.memorySourceRevision();
  const model = getKnowledgeEmbedder();
  if (config.transport !== 'service' || config.mode !== 'on' || !sourceRevision || !model
    || model.cacheKey !== `${config.endpoint.replace(/\/+$/, '')}\u0000${config.embedModel}`) return null;
  const at = new Date();
  const request: CoreMemoryRequest = {
    protocol: 1, query: recentUserContext ? `${recentUserContext} ${latest}` : latest, latest,
    expectedSourceRevision: sourceRevision, now: at.toISOString(), expectedSlateAt: getSlate()?.at ?? null,
    ...(config.expectedEpochId ? { expectedEpochId: config.expectedEpochId } : {}),
  };
  const texts = [`${recentUserContext} ${latest}`.trim(), recentUserContext.trim() ? latest.trim() : null,
    embedFormat(model.model) === recallFormat ? embedText(model.model, 'query', latest).trim() : null];
  const result = prepareCoreMemory(config, request, texts.flatMap((text, index) => text ? [{ id: String(index), text }] : []), model.model)
    .then(value => ({ ok: true as const, value }), error => ({ ok: false as const, error }));
  return { at, config: JSON.stringify(config), request: JSON.stringify(request), model: model.model, texts, result };
}
async function ollamaChat(...args: Parameters<typeof ollamaChatTurn>): ReturnType<typeof ollamaChatTurn> {
  markTurn('foreground_queued');
  return inferencePriority.runForeground(() => affectTurn(args[0], args[2] ?? {}, options => ollamaChatTurn(args[0], args[1], options)));
}

async function ollamaChatTurn(messages: { role: string; content: string; at?: string; attachments?: Attachment[] }[], config: ProviderConfig, { hands = true, web = false, brief = false, choices = false, call = false, away = '', aside = '', onChunk, onChunkReset, onToolCall, onSending, onPublished, onActed, repeated, traceId, signal }: { signal?:AbortSignal; onPublished?: (content: string) => void; onActed?: () => void; repeated?: string; hands?: boolean; web?: boolean; brief?: boolean; choices?: boolean; call?: boolean; away?: string; aside?: string; onChunk?: (text: string) => void; onChunkReset?: () => void; onToolCall?: (name: string) => void; onSending?: () => void; traceId?: string; affect?: unknown } = {}) {
  signal?.throwIfAborted();
  markTurn('harness_start');
  const enteredAt = Date.now();
  console.log(`[reply-timing] ${JSON.stringify({ trace: traceId, stage: 'received', at: enteredAt })}`);
  const turn = createTurnContext({ hands, web, choices });
  const latest = messages.at(-1)?.content ?? '';
  const affect = currentAffect();
  if (affect) messages = [{ role: 'system', content: affect.guidance }, ...messages];
  const narratedTools:string[]=[];
  const voiceCall = call;   // runTool's parameter is also named call (the tool call) and hides this flag (3360)
  const nudgeResponseMessages = messages;
  // Capture current-utterance evidence before any slow work or another input.
  const voiceContext = voiceSense.beginTurn(latest);
  const voiceEvidence = voiceSense.evidence();
  // Told which line of hers he is answering, where he said (replyto.ts). After
  // `latest`, which is read for what the message is ABOUT — the tool table, recall,
  // the stale-item check — and has to stay his words alone, not her quoted line.
  messages = withReplyContext(messages);
  // A message from outside the desk — the phone — gets a short leash on
  // the conversation as well as on the reply: a long day's thread is most of
  // the tokens the hosted model reads before its first word, and the reader
  // is watching a chat app. The recent thread stays, the desk sends everything.
  if (away) messages = recentWindow(messages, awayTurns());
  // A notification he answers is the conversation: her unprompted lines since her last reply go in
  // right before his message, for this turn only, instead of riding beside it as a quoted note —
  // quoted back at her, she said the line again word for word (asides.ts spliceRecentAsides).
  const notified = spliceRecentAsides(messages, getAsides(), Date.now());
  if (notified.spliced.length) { messages = notified.messages; console.log(`[ai] his message answers ${notified.spliced.length} line(s) she sent unprompted — they are in the conversation for this turn`); }
  // What they said just before this, so a memory search on "how did we fix
  // it?" has something to go on besides a pronoun. Their words only — folding
  // her replies in too would just as often paper over a message with no
  // keywords of its own with ones that were never theirs. (3770: computed here; `messages` is not reassigned after this point.)
  const recentUserContext = messages.filter(message => message.role === 'user').map(message => message.content).filter(Boolean).slice(0, -1).slice(-3).join(' ');
  // 3770/3780: the memory read (embeddings + Core memory) starts now instead of ~0.5 s later, after the policy steps below; it is
  // used only if the request built at the retrieval step is the same one, else that step reads afresh as before. Not aborted
  // with the turn: cancelling stops the Core's memory worker and the next turn would pay its cold start. 3780: text turns too
  // (the embedding wait was 204-254 ms on the critical path; natural and source-only turns waste one read).
  const earlyMemory = startCallMemory(latest, recentUserContext);
  if (earlyMemory) await new Promise<void>(resolve => setImmediate(resolve));   // let the request leave before the blocking policy calls
  // 3770: every durable write below a check runs synchronously after it, so a turn dropped on a call either stops before
  // writing or has signalled that it acted (it is then never merged into his next words and asked again).
  stopIfDropped(signal);
  // They are talking to her, so the silence she was waiting out is over.
  noteUserSpoke();
  const agendaWritesAtEntry = agendaWrites;
  tickOffSpoken(latest);
  // Only the tick acts: run again on merged words it can tick a second task. Put-off, started and accounted are idempotent.
  if (agendaWrites !== agendaWritesAtEntry) onActed?.();
  startedSpoken(latest);
  // A new day for something is as much a report as finishing it is.
  putOffSpoken(latest);
  // Separate from ticking off, and it has to be: an event is never ticked off,
  // and the answer to "how did it go" rarely looks like a completion.
  noteTheyAccounted(latest);
  // They have spoken, which is what every escalation was trying to achieve.
  // Asked for somewhere real — a steakhouse, a barber, a place to eat — the
  // search runs before she answers and the results ride in beside the message,
  // because names are the one thing a small model invents most convincingly.
  // See places.ts.
  const searchConfig = readSearchConfig(store.get('search'));
  // Set once the results are in her hands, and read again by the reply filters:
  // an answer built out of a list somebody else wrote is not her repeating
  // herself, and it is not padding either.
  let fromSearch = false;
  const placeLookupPlan=(navigationPolicy('placeSearchStart',[latest,messages.at(-1)?.role??null,searchConfig]));
  const lookUp = placeLookupPlan?placeLookupPlan.query:(messages.at(-1)?.role === 'user' && searchConfig.enabled ? placeQuery(latest, searchConfig.place) : null);
  // The reminder and mood writes share one commit before provider work (3480: every turn, not only a standalone one —
  // the separate acknowledgement commit was ~80 ms a turn with reminders due). A place lookup awaits a search first,
  // so its acknowledgement stays durable ahead of that wait.
  const batchReminderAcknowledgement = !lookUp;
  if (!batchReminderAcknowledgement) acknowledgeReminders();
  if (lookUp && (true as boolean)) {
    const observed=await runCorePlaceSearch(placeLookupPlan,aside,{search:(query:string,options:any)=>searchWeb(query,options,net.fetch,getSearchKey()),format:(query:string,found:any)=>formatResults(query,found,false),current:()=>readSearchConfig(store.get('search'))});
    aside=observed.aside;fromSearch=observed.fromSearch;
  } else if (lookUp) {
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
  conversationApply(corePolicySync<any>('conversation-program.weatherDispute',[remainingStore(app.getPath('userData')).docRef('config',{}),messages.at(-1)?.role??null,latest,Date.now()]));
  // Their answer to what she asked about their day, taken as one: the aside is
  // marked answered, and the brain that replies is told what this is.
  let answering = '';
  {
    const answer=coreAside('answer',{role:messages.at(-1)?.role});answering=answer.instruction;
    if(answer.ask)console.log(`[push] they are answering ${answer.ask.asked}`);
  }
  const feedbackAsides = getAsides(), feedbackLearning = getNudgeLearning();
  const learned = await coreLearnNudgeResponse(feedbackAsides, feedbackLearning, nudgeResponseMessages, Date.now()).catch(() => {
    console.log('[core-nudge] '+JSON.stringify({op:'response',reason:'attribution_unavailable'}));
    return null;
  });
  if (learned && sameCoreFeedback(feedbackAsides, feedbackLearning, getAsides(), getNudgeLearning())) {
    const response = learned.learning.at(-1);
    const schedule = response?.engagement ? learnPhoneReply(getPhoneNudges(), response.asideId, zonedNow(CHAT_TIMEZONE).getHours(), Date.now()) : getPhoneNudges();
    store.set({ 'chat.asides': learned.asides, 'chat.nudgeLearning': learned.learning, 'chat.phoneNudges': schedule });
    sendToWindows('chat:asidesChanged', learned.asides);
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
  const rantRoomNow = messages.at(-1)?.role === 'user' ? rantRoom(latest, named, Boolean(answering)) : '';
  const hers = herSubject ? herSubjectNote(herSubject) : '';
  if (hers) console.log(`[ai] they are asking about ${herSubject} — hers to talk about`);
  const talking = messages.at(-1)?.role === 'user' && justTalking(latest) ? JUST_TALKING_NOTE : '';
  if (talking) console.log('[ai] they just want to talk — taken at face value');
  // Asked to be quiet, or finished being quiet: her call, see muteTurn. Not on a
  // call — he rang her to hear her.
  const quiet = messages.at(-1)?.role === 'user' && !call && !brief && !choices ? muteTurn(latest) : '';
  let turnedUp:string;
  {const result=applyCoreLocation('chat',[latest,messages.at(-1)?.role==='user'],locationAdapter());turnedUp=result.turnedUp;}
  // Their own ask first; failing that, her offer plus their yes — "I'll remind
  // you at 6:54 AM if you need it" / "Yes please" — which reads as a request
  // only when the two messages are read together. See acceptedOffer.
  const herPrevious = [...messages].reverse().find(message => message.role === 'assistant')?.content;
  const theirRecent = messages.filter(message => message.role === 'user').slice(-4).map(message => String(message.content ?? ''));
  let reminder: ReturnType<typeof reminderAsk> = null;
  {
    stopIfDropped(signal);   // 3770: see the turn-entry note
    const packet=corePolicySync<any>('agenda-life.directReminder',[agendaFacts(ownedAgendaCore()),{lastIsUser:messages.at(-1)?.role==='user',latest,previous:typeof herPrevious==='string'?herPrevious:null,recentUsers:theirRecent,clock:agendaClock(zonedNow(CHAT_TIMEZONE))},new Date().toISOString(),randomUUID()]);
    applyAgendaPlan(ownedAgendaCore(),packet,ownedAgendaChanged);
    if(packet.plan)onActed?.();   // 3770: a reminder written from his words: this turn acted (a call does not merge it into the next)
    if(packet.result){reminder=packet.result.reminder;aside=[aside,packet.result.aside].filter(Boolean).join(' ');}
    else if(messages.at(-1)?.role==='user'){   // 3910: his own thing with a time books her comeback for after it (no planner needed)
      const followUp=corePolicySync<any>('final-booking.direct',[latest,Date.now(),CHAT_TIMEZONE]);
      if(followUp)void bookFollowUp(followUp).then(r=>console.log('[follow-up] '+JSON.stringify(r))).catch(error=>console.warn('[follow-up]',error instanceof Error?error.message:'failed'));
    }
    if(packet.plan)void syncFromGoogle().catch(error=>console.warn('[agenda-sync]',error instanceof Error?error.message:'failed'));
  }
  // Counted here rather than in the prompt so it survives across turns: telling
  // her to drop it and having her comply for one reply is the whole complaint.
  const previousPushback = store.get('pushback') as Pushback | undefined;
  // 3770: on a merged call turn, only his new words are counted as pushing back (the first part was counted when it was heard).
  const newWords = repeated && latest.startsWith(repeated) ? latest.slice(repeated.length).trim() : latest;
  const pushback=(deviceMutation('pushback',[newWords],deviceStateAdapter()));
  
  if (readsAsDropIt(newWords)) feelNow('drop-it');
  if (readsAsDropIt(newWords)) console.log(`[pushback] told to drop it (${pushback.count}/${PUSHBACK_LIMIT})${isSilenced(pushback, Date.now()) ? ' — dropping the subject entirely' : ''}`);
  nudgeVitals('spoken-to');
  // Feelings and mood are one interaction update, committed together before dispatch.
  // 3480 write-behind: the mood is known now; the disk catches up while the prompt is prepared (~75-120 ms a turn).
  const mood = store.transactionBehind(() => {
    if (batchReminderAcknowledgement) acknowledgeReminders();
    return advanceMood(latest, messages.slice(0, -1));
  });
  const { irritation, ego } = mood;
  // The category only, never the title — a log outlives the moment, and a
  // browsing history written to disk is a different thing from her reading a
  // window title and forgetting it.
  console.log(`[ai] chat request: model=${config.model} ctx=${chatNumCtx()} messages=${messages.length} irritation=${irritation} ego=${ego} goodnight=${mood.goodnight} screen=${currentActivity ? currentActivity.kind : 'none'}${traceId ? ` trace=${traceId}` : ''}`);
  // Explicit messages receive answers at every mood level. Background callers
  // still use isIgnoring to suppress unsolicited chatter.
  const started = enteredAt;
  // Stage timings contain no conversation content.
  let prepLast = enteredAt;
  const prepMark = (what: string) => { markTurn('preparation_checkpoint',{step:what}); const now = Date.now(); console.log(`[prep] ${what}: ${now - prepLast}ms${traceId ? ` trace=${traceId}` : ''}`); prepLast = now; };
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
  // Decide before system inspection, retrieval or full prompt construction.
  // Interaction-state writes above remain authoritative on both paths.
  let compactConversation: OllamaMessage[] | null = null;
  let compactSources: NaturalConversationSources | null = null;
  let compactReason = 'dependent_or_mixed_request';
  const assemblyCache: { revision?: string; hit?: boolean } = {};
  let preferenceCacheHit = false;
  const compactEvidence = { now: zonedNow(CHAT_TIMEZONE), timezone: CHAT_TIMEZONE, voice: voiceEvidence, fresh };
  const naturalAdmission=(naturalPolicy<any>('admission',[{messages,latest,brief:Boolean(brief),choices:Boolean(choices),answering:Boolean(answering),turnedUp:Boolean(turnedUp),quiet:Boolean(quiet),rant:Boolean(rantRoomNow),aside:aside??null,call,fast:store.get('ai.fastConversation')??null,route:conversationRoute()??null}]));
  const proposedKind=naturalAdmission?naturalAdmission.kind:naturalConversationKind(latest);
  const specialMode=naturalAdmission?naturalAdmission.special:brief||choices||answering||turnedUp||quiet||rantRoomNow||!directReplyAsideAllowed(aside,call);
  if(naturalAdmission?naturalAdmission.eligible:proposedKind&&!specialMode&&naturalConversationEligible(messages,latest)&&(!call||naturalCallAllowed(store.get('ai.fastConversation'),messages,latest,aside))&&conversationRoute()){
    if (!conversationMayLeave(nudgeResponseMessages, false, Number.MAX_SAFE_INTEGER).safe) compactReason = 'private_context';
    else {
      try {
        const slate = getSlate();
        const blankSlate = Boolean(blankSlateInstruction(slate, knownSinceSlate()));
        const deletions = memoryStore.getDeletions();
        const naturalSources=(naturalPolicy<any>('continuitySources',[deletions,blankSlate,slate??null,fresh??null,messages]));
        const forgottenAt=naturalSources?naturalSources.options.forgottenAt:deletions.map(entry=>entry.at).sort().at(-1);
        const preferences=naturalPreferences.read(nudgeResponseMessages,getMemories(),naturalSources?naturalSources.options:{blankSlate,deletedIds:deletions.map(entry=>entry.id),forgottenAt});
        preferenceCacheHit = preferences.hit;
        // Old transcript words must not resurrect a deleted/reset preference.
        const cutoff=naturalSources?0:Math.max(Date.parse(forgottenAt??'')||0,blankSlate?Date.parse(slate?.at??'')||0:0,fresh?.reason==='manual'?Date.parse(fresh.at)||0:0);
        const recent=naturalSources?naturalSources.recent:messages.filter((message,index)=>index===messages.length-1||!cutoff||Date.parse(message.at??'')>cutoff);
        assemblyCache.revision = JSON.stringify([store.get('ai.conversation'), store.get('ai.fastConversation')]);
        const prepared = await corePrepareNaturalConversation(recent, latest, getActiveCharacter(), {
          ...compactEvidence, continuity: preferences.entries,
          mood: { irritation, ego, goodnight: mood.goodnight, shout: mood.shout },
          blankSlate: blankSlateInstruction(slate, knownSinceSlate()),
          learnedLessons: learningNote(app.getPath('userData'), latest, conversationRoute()!.model),
          replyFeedback: store.get('chat.feedback') ?? null, replyFeedbackAt: Date.now(), replyFeedbackAfter: getSlate()?.at ?? null,
          ...(call ? { callContext: aside } : {}),
        }, assemblyCache);
        compactConversation = prepared.messages;
        compactSources = prepared.sources;
        compactReason = `standalone_${proposedKind}`;
      } catch (error) {
        if (!(error instanceof Error) || !error.message.startsWith('natural_context_overflow:')) throw error;
        compactReason = error.message;
      }
    }
  } else if (proposedKind) compactReason = specialMode ? 'special_context' : 'attachments_history_or_route';
  console.log(`[reply-timing] ${JSON.stringify({ trace: traceId, stage: 'route', elapsedMs: Date.now() - enteredAt,
    path: compactConversation ? 'natural' : 'full', reason: compactReason, instructionCacheHit: Boolean(assemblyCache.hit), preferenceCacheHit })}`);
  // Collected before the prompt so a machine question is answered from facts,
  // not from the model's assumptions about what it runs on.
  const machineNote = compactConversation ? '' : await systemContextFor(latest);
  prepMark('systemContext');
  // Likewise the way somewhere: found first, spoken about second, linked last.
  const directions = compactConversation ? null : await directionsFor(latest, messages.filter(message => message.role === 'user').map(message => message.content).filter(Boolean).slice(0, -1).slice(-4));
  // Execute Core's delivery command: verified checks are delivered after final settlement.
  if ((directions as typeof directions & { streamProviderReply?: boolean })?.streamProviderReply === false) { onChunk = undefined; onChunkReset = undefined; }
  prepMark('directions');
  // What she can still see. Not only this message: a picture has to ride along
  // again on the next turn or "what is in week three" cannot be answered, and
  // attachmentsInPlay is where the bound on doing that lives.
  // The maps buttons the app put under her earlier words are stored in the
  // message and are not hers to see: shown one, she wrote one, coordinates
  // and all, in place of a reply.
  // 3290: one call for the whole history, not one per message (98 round trips on a 2026-10-12 turn).
  const vetted = navigationPolicy<typeof messages>('historyMessages',[messages.map(message => (message.attachments?.length ? { ...message, attachments: ourFiles(message.attachments) } : message))]);
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
  // Call cloud opt-in covers both the compact social path and ordinary
  // conversation with full retrieval. Local actions and private context still
  // stay home; every cloud request uses the normal task and publication gate.
  // A command may run this turn: answered at home, so what it prints never
  // leaves the box (shell.ts) — the hosted route is skipped below as well.
  const shellTurn = messages.at(-1)?.role === 'user' && shellRelevant(latest) && shellLink() !== null;
  if (shellTurn) console.log('[router] a command is on the table — answered at home');
  // The machine is in the conversation at any level: she is told the server is
  // the box in her room, hers to look at with her tools (prompt.ts).
  const machineTurn = !shellTurn && messages.at(-1)?.role === 'user' && readSystemConfig().enabled && (machineRelevant(latest) || downloadsRelevant(latest));
  const naturalPaths=(naturalPolicy<any>('pathKinds',[{brief:Boolean(brief),choices:Boolean(choices),answering:Boolean(answering),carried:carried.length,aside:aside??null,call,messages,vetted,latest,machineTurn,fast:store.get('ai.fastConversation')??null}]));
  const directKind=naturalPaths?naturalPaths.directKind:!brief&&!choices&&directReplyAsideAllowed(aside,call)&&!answering&&!carried.length&&messages.at(-1)?.role==='user'?directReplyKind(latest):null;
  const fastCall=naturalPaths?naturalPaths.fastCall:call&&!brief&&!choices&&!answering&&!carried.length&&naturalCallAllowed(store.get('ai.fastConversation'),vetted,latest,aside);
  const cloudCall=naturalPaths?naturalPaths.cloudCall:call&&!brief&&!choices&&!answering&&!carried.length&&!machineTurn&&conversationCallAllowed(store.get('ai.fastConversation'),vetted,latest,aside);
  const turnAdmission=(naturalTurn<any>('initial',[{call,cloudCall,shell:shellTurn,directions:Boolean(directions),video,directKind,conversationRoute:conversationRoute(),brief,choices,privateSafe:conversationMayLeave(nudgeResponseMessages,false,Number.MAX_SAFE_INTEGER).safe,config}]));
  let brain:Brain=turnAdmission?(turnAdmission.brain??await brainFor(latest,config,messages,{pictures,files:arrived.length>0,call})):call && !cloudCall ? { config, escalated: false, because: 'a local-only call', sees: false }
    : shellTurn ? { config, escalated: false, because: 'a command may run: answered at home', sees: false }
    : directions ? { config, escalated: false, because: 'the way somewhere is answered at home', sees: false }
    : video ? { config, escalated: false, because: 'a video is read at home, where the transcript tool is', sees: false }
    : directKind && !conversationRoute() ? { config, escalated: false, because: 'a short conversational turn', sees: false }
    : await brainFor(latest, config, messages, { pictures, files: arrived.length > 0, call });
  if (brain.escalated) console.log(`[ai] sent out to ${brain.config.model} — ${brain.because}`);
  const home = config;
  const cloudAllowed=turnAdmission?turnAdmission.cloudAllowed:(!call||cloudCall)&&!shellTurn&&!directions&&!video&&!brief&&!choices&&conversationMayLeave(nudgeResponseMessages,false,Number.MAX_SAFE_INTEGER).safe;
  const lookupPreparation=(corePolicySync<{sourceOnly:boolean}>('lookup-preparation.plan',[{message:latest,lastIsUser:messages.at(-1)?.role==='user',cloudAllowed,call,attached:messages.some(m=>m.attachments?.length)||arrived.length>0,brief:Boolean(brief),choices:Boolean(choices),aside:aside??null,answering:Boolean(answering),special:Boolean(turnedUp||quiet||rantRoomNow)}]));
  const sourceOnlyLookup=lookupPreparation.sourceOnly;
  if(sourceOnlyLookup)markTurn('retrieval_skipped',{step:'publicLookup'});
  brain=naturalTurn<Brain>('enforce',[brain,home,cloudAllowed]);
  config = brain.config;
  const vision = readVisionConfig(store.get('vision'));
  // Said out loud, once, when a picture has just been attached and cannot be
  // sent. She still answers — from a written-out reading of it — but the answer
  // is measurably thinner, and silently thinner is the worst version of that.
  if (pictures && !brain.sees && !brain.hosted && vetted.at(-1)?.attachments?.some(file => file.kind === 'image')) {   // 3820: hosted turns get the picture read
    console.log(`[attach] reading the picture here instead of sending it — ${brain.because}`);
    sendToWindows('ai:fellBack', brain.because.startsWith('stays here')
      ? `That picture is staying on this machine — ${brain.because.replace(/^stays here: /, '')}. She is reading it with the local model instead, which is less sharp.`
      : 'No second model is set up, so she is reading that picture with the local model rather than looking at it properly. Set one up in Setup → Where she thinks for a better answer.');
  }
  // Reading a file is the slow part, so it happens once the brain is settled and
  // its result is cached — a follow-up about the same video must not transcribe
  // it a second time.
  // 3810: the Core sees a reference per picture; sendToProviderUnchecked puts the bytes back (core-harness-media.ts).
  const attached = compactConversation ? vetted : await withAttachments(vetted, inPlay, brain.sees, vision, config, call);
  const withFiles = turnImages.toCore(attached as any) as unknown as typeof attached;
  prepMark('attachments');
  if (carried.length) console.log(`[attach] ${carried.length} in play — ${carried.map(file => `${file.name}${file.kind === 'image' && brain.sees ? ' (sent)' : ' (read)'}`).join(', ')}`);
  // Literal fresh-image descriptions already have one grounded foreground
  // read. Avoid a second caption competing for the same local model. Other
  // image tasks retain prefetch; uncached follow-ups read on demand as before.
  const imageInputProfile = brain.sees && pictures ? await coreInputProfile(latest, pictures) : 'normal';
  for(const file of attachmentPolicy<Attachment[]>('preload',[carried,brain.sees,imageInputProfile]))void readAttachment(file,vision,config).catch(()=>{});
  const naturalKind=(naturalPolicy<any>('hostedKind',[{compact:Boolean(compactConversation),hosted:Boolean(brain.hosted),brief:Boolean(brief),choices:Boolean(choices),call,fastCall,answering:Boolean(answering),aside:aside??null,turnedUp:Boolean(turnedUp),quiet:Boolean(quiet),rant:Boolean(rantRoomNow),carried:carried.length,messages:withFiles,latest}]));
  if (naturalKind) console.log(`[latency] natural=${naturalKind} retrieval=not-needed${traceId ? ` trace=${traceId}` : ''}`);
  if (naturalKind) markTurn('retrieval_skipped');
  const { conversation, evidence: replyEvidence } = naturalKind && compactConversation
    ? { conversation: compactConversation, evidence: compactEvidence }
    : await (async () => {
  // Semantic retrieval: embed this turn's query (cached) and fold the memory
  // similarities into what she gets told, so "the thing we did to the server"
  // can find the memory even with no words in common.
  // And the message on its own, in parallel, so earlier lines about something
  // else cannot drown out what was just asked (RetrieveOptions.focus).
  // Further back than the days in front of her: an exchange or two from the
  // archive, only when this message names something specific that they name too,
  // or nothing. Its own embedding, of this message alone and with the search
  // prefix, because the memories above are embedded without one. See recall.ts.
  // Decided before the embeds go out so its request rides with the other two:
  // the embedder is on the CPU and serves one request at a time, so awaited
  // after them it was a third embed's wait on every reply that named anything.
  const recallDay = localDateKey(zonedNow(CHAT_TIMEZONE));
  const archiveIndex = ((!corePolicySync<any>('final-recall.eligibility',[naturalKind??null,0,0]).index)) ? null : chatIndex(recallDay);
  const specific = archiveIndex ? rareTerms(archiveIndex, latest) : new Set<string>();
  const recallModel = ((corePolicySync<any>('final-recall.eligibility',[naturalKind??null,recallVectors.size,specific.size]).model)) ? getKnowledgeEmbedder()?.model : undefined;
  markTurn('retrieval_start');
  const retrievalStartedAt = Date.now();
  const coreMemoryConfig = readCoreMemoryConfig();
  const coreReadAt = earlyMemory?.at ?? new Date();
  const sourceRevision = store.memorySourceRevision();
  const memoryRequest: CoreMemoryRequest = {
    protocol: 1, query: recentUserContext ? `${recentUserContext} ${latest}` : latest, latest,
    ...(sourceRevision ? { expectedSourceRevision: sourceRevision } : {}), now: coreReadAt.toISOString(), expectedSlateAt: getSlate()?.at ?? null,
    ...(coreMemoryConfig.expectedEpochId ? { expectedEpochId: coreMemoryConfig.expectedEpochId } : {}),
  };
  const auxiliaryTexts = [`${recentUserContext} ${latest}`.trim(),
    recentUserContext.trim() ? latest.trim() : null,
    recallModel && embedFormat(recallModel) === recallFormat ? embedText(recallModel, 'query', latest).trim() : null];
  const embeddingModel = getKnowledgeEmbedder();
  const combinedEligible = !sourceOnlyLookup && coreMemoryConfig.transport === 'service' && coreMemoryConfig.mode === 'on' && sourceRevision
    && embeddingModel?.cacheKey === `${coreMemoryConfig.endpoint.replace(/\/+$/, '')}\u0000${coreMemoryConfig.embedModel}`;
  // 3770: the call's early read stands in only for exactly this request (same config, request, model and every text asked for).
  const earlyMatches = combinedEligible && earlyMemory && embeddingModel && earlyMemory.config === JSON.stringify(coreMemoryConfig) && earlyMemory.request === JSON.stringify(memoryRequest)
    && earlyMemory.model === embeddingModel.model && auxiliaryTexts.every((text, index) => !text || earlyMemory.texts[index] === text);
  if (earlyMemory) markTurn('memory_early', { status: earlyMatches ? 'ok' : 'error' });
  const combinedMemory = !combinedEligible || !embeddingModel ? null : earlyMatches ? earlyMemory!.result
    : prepareCoreMemory(coreMemoryConfig, memoryRequest, auxiliaryTexts.flatMap((text, index) => text ? [{ id: String(index), text }] : []), embeddingModel.model)
      .then(value => ({ ok: true as const, value }), error => ({ ok: false as const, error }));
  const readMemoryForTurn = sourceOnlyLookup ? undefined : prefetchCoreMemory(coreMemoryConfig, memoryRequest, combinedMemory ? async () => {
    const result = await combinedMemory; if (!result.ok) throw result.error; return result.value.memory;
  } : undefined);
  const [queryVector, latestVector, recallVector] = combinedMemory ? await combinedMemory.then(result =>
    auxiliaryTexts.map((text, index) => text && result.ok ? result.value.vectors[String(index)] ?? null : null)) : await Promise.all([
    (naturalKind || sourceOnlyLookup) ? Promise.resolve(null) : tryEmbedQuery(`${recentUserContext} ${latest}`),
    !naturalKind && !sourceOnlyLookup && recentUserContext.trim() ? tryEmbedQuery(latest) : Promise.resolve(null),
    !sourceOnlyLookup && recallModel && embedFormat(recallModel) === recallFormat ? tryEmbedQuery(embedText(recallModel, 'query', latest)) : Promise.resolve(null),
  ]);
  prepMark('embeddings');
  const semantic = queryVector && memoryStore.vectors().size
    ? semanticSimilarities(getMemories(), queryVector, memoryStore.vectors())
    : undefined;
  const latestSemantic = latestVector && memoryStore.vectors().size
    ? semanticSimilarities(getMemories(), latestVector, memoryStore.vectors())
    : undefined;
  // From the index rather than the archive again: rebuilding a year of exchanges is ~50 ms a turn.
  const shownDays = recallVector ? new Set(daysAlreadyShown(recallDay)) : null;
  const recalled = ((archiveIndex?coreProactiveRecall(archiveIndex,recallVectors,recallVector,[...(shownDays??[])],[...specific],chatIndexCache?.key):[]));
  if (recalled.length) console.log(`[recall] ${recalled.map(entry => `${entry.exchange.day} (${entry.score.toFixed(2)})`).join(', ')}`);
  // Who and what the message names, and one step further (factgraph.ts). A
  // lookup, not a call — and nothing at all when nobody is named.
  let factGraph = store.getFactGraph();
  let linked = naturalKind || (true as boolean) ? [] : linkedFacts(factGraph, latest, { context: recentUserContext, userName: graphUserName() });
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
  // Her recent replies as she should believe she said them — see seed.ts for
  // the measurement. The stored transcript is not touched; only what is sent.
  // The length rule fits the brain answering — see LENGTH_RULE_HOSTED.
  // A hosted brain reads the whole prompt before its first word, so the system
  // may be ordered for the endpoint's prefix cache — the invariant blocks
  // first, the clock and mood and screen last — and the reply starts at the
  // cache instead of at full prompt-processing speed. The local model keeps
  // the tone-last order, which it was written for.
  const profileArgs = [latest, recentUserContext, semantic, away ? awayMemoryScale() : undefined, latestSemantic] as const;
  let coreGraphIds: string[] = [];
  const coreMemory: Awaited<ReturnType<typeof selectCoreMemory>> = naturalKind || sourceOnlyLookup
    ? { profile: '', oldProfile: '', status: coreMemoryConfig.mode, elapsedMs: 0 }
    : await selectCoreMemory({
    config: coreMemoryConfig,
    read: readMemoryForTurn,
    now: coreReadAt,
    background: !coreMemoryConfig.captureDir,
    query: recentUserContext ? `${recentUserContext} ${latest}` : latest,
    latest,
    sourceRevision: () => store.memorySourceRevision(),
    slateAt: () => getSlate()?.at ?? null,
    render: memoryStore.prepareProfileSummary(...profileArgs, ids => { coreGraphIds = ids; }),
    fallbackRender: () => profileSummary(...profileArgs),
    log: entry => console.log(`[core-memory] ${JSON.stringify(entry)}`),
  });
  prepMark('coreMemory');
  // Read the current graph after memory's awaited work; no retained decision is
  // reused across that await. Enabled mode has no local graph-policy fallback.
  if (!naturalKind && !sourceOnlyLookup && (true as boolean)) {
    factGraph = store.getFactGraph();
    linked = linkedFacts(factGraph, latest, { context: recentUserContext, userName: graphUserName() });
  }
  markTurn('retrieval_end');
  console.log(`[retrieval-timing] ${JSON.stringify({ elapsedMs: Date.now() - retrievalStartedAt, parallel: true })}`);
  const promptState = {
    ...mood,
    learnedLessons: learningNote(app.getPath('userData'), latest, brain.config.model),
    imaginedDream: naturalKind ? '' : imaginationNote(app.getPath('userData'), latest),
    // Nighttime courtesy and follow-ups should not be displaced by an old row.
    ...(herKnockedAwakeNow() ? { goodnight: 'none' as const, shout: mood.shout === 'awaiting' ? 'none' as const : mood.shout } : {}),
    now: promptNow,
    timezone: CHAT_TIMEZONE,
    character: getActiveCharacter(),
    // Rendered here rather than inside the prompt: retrieval records what it
    // chose and why for the inspector, and the AniList list refreshes itself
    // when it has gone stale. Neither is a thing assembling a prompt should set
    // in motion.
    profile: coreMemory.profile,
    aniList: aniListSummary(),
    journalConfig: readJournalConfig(store.get('journal.config')),
    journal: getJournal(),
    checkInsToday: checkInsOn(getCheckIns(), localDateKey(promptNow)),
    screen: { label: currentActivity?.label, haunt: currentPlace ? getHaunts()[currentPlace] : undefined, scene: sceneNow(), memory: gameMemoryNow() },
    // The spliced ones are in the conversation already; quoting them beside it as well is what made her repeat one.
    asides: getAsides().filter(aside => !notified.spliced.some(other => other.id === aside.id)),
    splicedAsides: notified.spliced,
    rated: (corePolicySync<RatedReply[]>('prompt-context.ratedReplies', [store.get('chat.feedback') ?? null, store.get('chat.messages') ?? [], Date.now(), getSlate()?.at ?? null])),
    kept: getKept(),
    search: readSearchConfig(store.get('search')),
    knowledgeEnabled: getKnowledgeConfig().enabled,
    systemEnabled: readSystemConfig().enabled,
    machineNote,
    following: getFollowing(),
    latestMessage: latest,
    fresh,
    // Still a stranger to him, if the reset was recent (blankslate.ts).
    slate: getSlate(),
    known: knownSinceSlate(),
    herRecentReplies,
    recalled: recallNote(recalled, new Intl.DateTimeFormat('en-AU', { weekday: 'long', timeZone: 'UTC' })),
    linked: naturalKind ? '' : linkedNote(factGraph, coreMemory.status === 'on' ? withoutCoreGraphClaims(linked, coreGraphIds) : linked),
    // Lore.md is his page, and it hands her his name, his job, his business
    // address, his psychologist and his diagnosis — on exactly the message the
    // slate has her asking who he is. His page is untouched and the cards come
    // back when the slate lapses (blankslate.ts).
    lore: blankSlateInstruction(getSlate(), knownSinceSlate()) ? '' : loreNote(lore.cards),
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
    fond: (corePolicySync('conversation-inputs.fond',[vitals.affection])),
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
    diary: naturalKind ? '' : diaryContext(recentEntries(app.getPath('home'), 2)),
    directionsNote: directions?.note,
    serverNote: [shellTurn ? ((corePolicySync<string>('final-shell.note',['serverNote']))) : machineTurn ? serverLookNote(readSystemConfig().level) : '', shellLink() && readSystemConfig().level === 4 ? ((corePolicySync<string>('final-shell.note',['diagnosticNote']))) : ''].filter(Boolean).join(' '),
  };
  console.log(`[prompt] ${compileLog(behaviourOf(promptState))}`);
  // A hosted brain reads the whole prompt before its first word, so its system
  // message holds only the invariant blocks — her rules and her persona — and
  // the changing context (the clock, her mood, the memory profile, what is on
  // their screen) is spliced in just before their turn, leaving the head
  // byte-identical all day for the endpoint's prefix cache. The local model
  // keeps the tone-last order, which it was written for.
  // For a hosted brain the "they are answering what you asked" line rides in
  // the pre-turn slot with the rest of the changing context; for the local one
  // it stays on the end of the system message, as it always has.
  // The delivery labels go to the hosted brain only. Measured on it before any
  // of this was built: 65 of 65 segments validly labelled. The local model's
  // compliance is untested, and a malformed label is the one thing the stripper
  // cannot take out — it removes an exact [mood] and leaves anything else
  // visible, which on the fallback brain would put the mess in front of him.
  const assembledPrompt = naturalKind ? {system:'',dynamic:''} : await coreChatPrompt(promptState,Boolean(brain.hosted),Boolean(away),answering);
  const sized = assembledPrompt.system;
  prepMark('chatSystemPrompt');
  // On a turn about her, the sign-off comes off her recent replies as she is
  // shown them — see seedOffTheOrders. She copies the history over the rule.
  // The days before this one, in front of today's: her own one-line notes for
  // the days that were distilled at the roll, and raw turns for the days that
  // were not (a day is only distilled once it is over). Notes are a tenth of
  // the raw day and byte-stable, so the cached head shrinks and stretches.
  // markTimeGaps writes the seam between today and any raw turns, so she can
  // tell yesterday from now rather than reading it all as one flat conversation.
  // 3690: the archive by digest (707 KB raw on every full turn before; the Core keeps the body until it changes).
  const earlier = naturalKind ? { turns: [], notes: [] } : earlierDaysContext(getSessions(), getMonthNotes(), remainingStore(app.getPath('userData')).docRef('archive', {}), localDateKey(zonedNow(CHAT_TIMEZONE)), { days: summaryDays(), budget: historyBudgetChars() });
  prepMark('earlierDays');
  const before = earlier.turns
    .map(turn => ({ role: turn.role, content: turn.content, ...(turn.at ? { at: turn.at } : {}), ...((turn as { id?: string }).id ? { id: (turn as { id?: string }).id } : {}) })) as OllamaMessage[];
  if (earlier.notes.length) console.log(`[ai] ${earlier.notes.length} note(s) — months and days — go in front of today's`);
  if (before.length) console.log(`[ai] ${before.length} turns from un-distilled days go in front of today's`);
  const history = markTimeGaps(withoutWhereDenials(withoutTrafficDenials([...before, ...withoutStaleDenials(foldAsleepExchanges(withFiles) as typeof withFiles, hasItems)] as unknown as { role: string; content: string; at?: string }[], Boolean(directions?.route)), Boolean(describeWhereabouts(getWhereabouts()))), CHAT_TIMEZONE) as unknown as OllamaMessage[];
  // Her replies as re-voiced by the background pass (revoice.ts), before the
  // other seeds: a rewrite that still ends on an order loses it like any other.
  const revoiced = applyRevoices(history as unknown as { id?: string; role: string; content: string }[], revoiceState().rewrites);
  if (revoiced.applied) console.log(`[revoice] ${revoiced.applied} of her replies shown as re-voiced`);
  const shown = ([]);
  let conversation: OllamaMessage[] = (corePolicySync('conversation-inputs.history',[Boolean(hers),revoiced.shown,sized,brief,earlier.notes]));
  // The last thing she reads before she speaks — see LAST_WORD for the
  // measurement. A system message just before their last turn: the Ollama
  // shaper folds it into that turn, an OpenAI-shaped endpoint takes it as it
  // is, and either way it is nearer than anything in the system prompt.
  const lastUser = conversation.map(message => message.role).lastIndexOf('user');
  // What he sent while she slept, read where the rest of the turn's asides
  // are — the last thing before she speaks, where a small model still has it.
  const wakeNow = wakeNoteNow();
  // Audio evidence was matched to this exact utterance before the model ran.
  const voiceRoomNow = voiceContext;
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
  const preTurnSystem = ([]);
  conversation=corePolicySync('conversation-inputs.preTurn',[conversation,{natural:naturalKind??null,hosted:Boolean(brain.hosted),dynamic:assembledPrompt.dynamic,answering,aside,turnedUp,directions:directions?.note??'',hers,talking,quiet,rantRoom:rantRoomNow,wake:wakeNow,recentReplies:herRecentReplies,voice:voiceRoomNow}]);
  if (coreMemoryConfig.captureDir && coreMemory.coreProfile !== undefined) {
    try {
      const comparisonConversation = async (profile: string, graphIds: string[]) => {
        const state = { ...promptState, profile, linked: linkedNote(factGraph, withoutCoreGraphClaims(linked, graphIds)) };
        const variantPrompt = await coreChatPrompt(state,Boolean(brain.hosted),Boolean(away),answering);
        const variantSystem = variantPrompt.system;
        let variant = conversation.map((message, index) => index === 0 ? { ...message, content: brief ? `${variantSystem} ${BREVITY}` : variantSystem } : message);
        if (brain.hosted) variant = replacePromptProfile(variant, assembledPrompt.dynamic, variantPrompt.dynamic);
        return variant;
      };
      captureCorePromptComparison(coreMemoryConfig, {
        epochId: coreMemory.epochId, mode: coreMemory.status,
        old: await comparisonConversation(coreMemory.oldProfile, []),
        core: await comparisonConversation(coreMemory.coreProfile, coreGraphIds),
      });
    } catch { /* optional diagnostics must never cost a reply */ }
  }
  // For tuning, when the environment asks for it: the prompt exactly as sent.
  // A rule that works on its own and fails in place can only be bisected by
  // replaying what she was actually told, and nothing else shows that.
  if (process.env.HARU_DUMP_PROMPT) {
    try { writeFileSync(path.join(app.getPath('userData'), 'last-prompt.json'), JSON.stringify({ at: new Date().toISOString(), model: config.model, conversation }, null, 1)); } catch { /* a debugging aid must not cost a reply */ }
    prepMark('promptDump');
  }
      return { conversation, evidence: localReplyEvidence(promptState) };
    })();
  // This turn owns its tool state from entry through every round and retry.
  // Reading outside text withdraws its tools without affecting other replies.
  // Publish once, after the tool loop and final filters accept the reply.
  const replyGate = new ReplyGate(onChunk, line => console.log(line));
  let spilledHome = false;
  // Fixed for the whole turn. Only `tools` changes round to round, and that is
  // the loop's decision rather than this function's.
  let providerFirst = false;
  let providerSentAt = started;
  let firstDispatchAt = 0;
  const roundOptions: PostOptions = {
    turn,
    // Background calls to this same model use this window too, avoiding reloads.
    numCtx: chatNumCtx(),
    // A message from outside the desk — the phone — gets a short leash.
    // The reader is watching a chat app, a long reply is a long wait, and
    // away-turns were found to run long: the cap keeps her concise without
    // touching the desk, where a full answer is the point of the window.
    ...(away ? { maxTokens: brain.hosted ? HOSTED_AWAY_MAX_TOKENS : AWAY_MAX_TOKENS } : {}),
    // Keep first-word transport timing while withholding unvalidated assertions.
    onChunk: text => {
      if (!providerFirst && text) {
        providerFirst = true;
        console.log(`[latency] provider-first=${Date.now() - providerSentAt}ms preparation=${providerSentAt - started}ms path=${naturalKind ? 'natural' : 'full'}${traceId ? ` trace=${traceId}` : ''}`);
      }
      replyGate.chunk(text);
    },
  };
  const answerLocally = async (sending: OllamaMessage[], localConfig: ProviderConfig, tools: boolean, inputProfile?:'grounded-perception') => {
    const localLimit=await coreLocalBudget(localConfig,chatNumCtx(),net.fetch);
    return inferencePriority.localReply(async () => {
    return runCoreNaturalLocal({sending,config:localConfig,tools,inputProfile:inputProfile??null,visualProfiles:(true as boolean),naturalKind,compactSources,latest,replyEvidence,mood:getMood(),blankSlate:blankSlateInstruction(getSlate(),knownSinceSlate()),voice:voiceEvidence,localSinglePass:store.get('ai.fastConversation.localSinglePass')===true,directKind,character:getActiveCharacter(),aside:aside??null,numCtx:chatNumCtx(),recentReplies:herRecentReplies},roundOptions);
    },localLimit);
  };
  prepMark('modelRegistry');
  const registry = callRegistry(readModelRegistry(store.get('ai.modelRegistry'), {
    local: home, conversation: store.get('ai.conversation') as ProviderConfig | undefined,
    specialist: store.get('escalate.provider') as ProviderConfig | undefined, vision,
  }), store.get('ai.callConversation'), call);
  prepMark('taskPolicy');
  const policy = readTaskPolicy(store.get('ai.taskPolicy'));
  prepMark('taskIntent');
  const intent = await coreTaskIntent(latest, { pictures, files: arrived.length > 0, history: messages });
  const eligible = async (role: ModelRole, sending: OllamaMessage[], budgetMicros: number, excludeIds: string[] = []) => {
    {const prepared=naturalTurn<any>('eligible',[{role,sending,budget:budgetMicros,excludeIds,cloudAllowed,policy,escalate:readEscalateConfig(store.get('escalate')).enabled,naturalKind,pageRead:turn.pageWasRead()}]);const request:RouteRequest={...prepared,toolSchema:prepared.tools?hostedTools(sending,turn):[],available:entry=>providerAvailability.available(entry.config)&&(entry.local||hasKeyFor(entry.config.endpoint))};return naturalSelection(()=>selectCallModel(registry,role,request),()=>coreSelectTaskModel(registry,role,request));}
  };
  prepMark('routerSelectStart');
  const naturalMaxTokens=(naturalPolicy<number>('naturalMaxTokens',[naturalKind]));
  const turnFast=(naturalTurn<any>('fastRequest',[{naturalKind,cloudAllowed,policy,conversation}]));
  const fastRequest:RouteRequest={...(turnFast?turnFast.request:{cloudAllowed:cloudAllowed&&policy.enabled,conversation,inputs:['text'] as ('text'|'image')[],maxOutputTokens:naturalMaxTokens,budgetMicros:policy.dailyBudgetMicros?policy.taskBudgetMicros:0}),available:entry=>providerAvailability.available(entry.config)&&hasKeyFor(entry.config.endpoint)};
  const fastConversation=(turnFast?turnFast.admit:naturalKind)?((await naturalSelection(()=>selectCallModel(registry,'conversation',{...fastRequest,tools:false,toolSchema:[]}),()=>coreFastConversationModel(registry,store.get('ai.fastConversation'),fastRequest)))):undefined;
  // Preliminary routing used the full transcript and tool/output allowance.
  // Reconsider an eligible compact request with its actual completion cap.
  const turnReconsider=(naturalTurn<any>('reconsider',[{fast:fastConversation??null,local:isLocalConfig(config),brain,callRouteId:CALL_ROUTE_ID}]));
  if(turnReconsider?turnReconsider.admit:fastConversation||!isLocalConfig(config)||brain.entryId===CALL_ROUTE_ID){
    const selected=(await naturalSelection(async()=>fastConversation,()=>eligible(turnReconsider.role,conversation,policy.taskBudgetMicros)));
    {const finished=naturalTurn<any>('selected',[{selected:selected??null,brain,home,config,fast:fastConversation??null,sameFast:selected===fastConversation,naturalKind}]);if(finished.notice)sendToWindows('ai:fellBack',finished.notice);brain=finished.brain;}
    config=brain.config;
  }
  console.log(`[router] role=${brain.role ?? 'everyday'} model=${config.model} reason=${brain.because}`);
  prepMark('promptBuilt');
  const modelObservations: { model: string; succeeded: boolean }[] = [];
  const flushModelObservations = () => {
    for (const row of modelObservations.splice(0)) {
      try { observeTaskModel(row.model, row.succeeded); } catch { /* optional reliability counters */ }
    }
  };
  const task = new TaskController(taskBridge.call, registry, policy, cloudAllowed,
    (model, succeeded) => modelObservations.push({ model, succeeded }), event => {
    markTurn(event.stage,{attempt:event.attempt,model:event.model});
    if (event.stage === 'dispatch') firstDispatchAt ||= event.at;
    console.log(`[reply-timing] ${JSON.stringify({ trace: traceId, ...event, elapsedMs: event.at - enteredAt,
      ...(event.stage === 'dispatch' ? { preparationMs: event.at - enteredAt } : {}) })}`);
  });
  await task.start(latest, config.model, 'foreground', signal);
  prepMark('taskStart');
  // Planning is local even when the response is local. Cloud permission still
  // governs every response dispatch; Core restricts this route to scoped reads.
  const turnLoop=(naturalTurn<any>('loopFlags',[{splitEnabled:(false as boolean),workflowEnabled:(false as boolean),local:isLocalConfig(config),hosted:!!brain.hosted,cloudAllowed,pictures,naturalKind,directionsRoute:Boolean(directions?.route)}]));
  const splitPlanningAllowed=turnLoop?turnLoop.splitPlanning:false;
  const { content: spoken, ran } = await task.loop(conversation, {
    requireToolContract: true,
    splitPlanning:splitPlanningAllowed,
    publicLookupPrepared:sourceOnlyLookup,
    generalToolSplit:(true as boolean),
    generalToolCloudAllowed:cloudAllowed,
    toolSnapshot:()=>chatTools(availableTools(turn),latest),
    receiptPrograms:turnLoop?turnLoop.receiptPrograms:false,
    workerRoles:['everyday','conversation','affordable-cloud','specialist','complex','premium'],
    runWorker:async(sending,{role,maxTokens})=>{
      const entry=await coreSelectTaskModel(registry,role,{
        cloudAllowed,conversation:sending,tools:false,toolSchema:[],inputs:['text'],
        budgetMicros:task.remainingBudgetMicros,
        available:candidate=>providerAvailability.available(candidate.config)&&(isLocalConfig(candidate.config)||hasKeyFor(candidate.config.endpoint)),
      });
      if(!entry)return {error:'unavailable' as const,model:null};
      console.log('[workflow-worker] '+JSON.stringify({role,model:entry.config.model,tools:false}));
      try{
        const message=await sendToProvider(sending,entry.config,{tools:false,table:[],temperature:0.1,maxTokens,
          onChunk:()=>{},firstWordMs:HOSTED_FIRST_WORD_MS});
        return {message,model:entry.config.model};
      }catch(error){
        await task.check(); // Cancellation/deadline/privacy cannot become a reply.
        const reason=error instanceof Error?error.message:String(error);
        const turnWorkerFailure=(naturalTurn<any>('workerFailure',[reason]));
        if(turnWorkerFailure?turnWorkerFailure.throw:/outbound_privacy_blocked|cancelled|deadline/.test(reason))throw error;
        task.recordWorkerFailure();
        return {error:turnWorkerFailure?turnWorkerFailure.error:/budget|allowance/.test(reason)?'budget' as const:/first_word_timeout|timeout/.test(reason)?'timeout' as const:'transport' as const,model:entry.config.model};
      }
    },
    ...(taskBridge.readOnlyWorkflow ? {coreReadOnly:{decide:taskBridge.readOnlyWorkflow,table:()=>chatTools(availableTools(turn),latest)}} : {}),
    // With the route in hand there is nothing to look up: offered tools, she
    // searched the web for the traffic, got three American states back, and
    // guessed — while the live number sat in the note beside his message.
    ...(turnLoop?('maxRounds' in turnLoop?{maxRounds:turnLoop.maxRounds}:{}):directions?.route?{maxRounds:1}:{}),
    ask: async (sending, { tools,inputProfile,planningTable,maxTokens:workflowMaxTokens,candidateId,temperature }) => {
      if(inputProfile==='general-tool-planning'||inputProfile==='general-tool-response'){
        
        const planning=inputProfile==='general-tool-planning';
        const available=chatTools(availableTools(turn),latest);
        const table=planning?(planningTable??[]):[];
        if(table.some(tool=>!available.some(current=>current.function.name===tool.function.name)))throw Error('general_tool_unavailable');
        // 3330 route once: a response round keeps the conversation route this turn already decided while that entry is still
        // usable — the ledger prices and the dispatch scans every send regardless (task-controller.ts post) — and selects
        // afresh only when it is not. Two selections a turn (55-90 ms each, on the way to the first word) were the same answer.
        const decided=planning||!cloudAllowed||!brain.hosted||brain.role!=='conversation'?undefined
          :registry.find(candidate=>candidate.id===brain.entryId&&providerAvailability.available(candidate.config)&&hasKeyFor(candidate.config.endpoint));
        if(decided)console.log('[core-router] '+JSON.stringify({event:'reuse',role:'conversation',candidateId:decided.id,model:decided.config.model}));
        const entry=planning?corePolicySync<(typeof registry)[number]|undefined>('route-admission.planningEntry',[{
            registry,candidateId,cloudAllowed,conversation:sending,table,maxTokens:workflowMaxTokens,budgetMicros:task.remainingBudgetMicros,
            availableIds:registry.filter(candidate=>providerAvailability.available(candidate.config)&&(isLocalConfig(candidate.config)||hasKeyFor(candidate.config.endpoint))).map(candidate=>candidate.id),
          }])
          :decided??await coreSelectTaskModel(registry,'conversation',{cloudAllowed,conversation:sending,tools:false,toolSchema:[],inputs:['text'],maxOutputTokens:workflowMaxTokens,budgetMicros:task.remainingBudgetMicros,
            available:candidate=>providerAvailability.available(candidate.config)&&(isLocalConfig(candidate.config)||hasKeyFor(candidate.config.endpoint))});
        if(!entry)throw Error('general_tool_split_model_unavailable');
        if(!planning){
          brain=brainFromEntry(entry,'Core tool-free response');
          config=entry.config;
        }
        await task.check();
        return sendToProvider(sending,entry.config,{tools,table,temperature,maxTokens:workflowMaxTokens,numCtx:chatNumCtx(),turn});
      }
      const verifiedWorkflowResponse=inputProfile==='workflow-response';
      if(inputProfile==='tool-planning'){
        if(!splitPlanningAllowed||!tools)throw Error('split_planner_not_eligible');
        const planner=registry.find(entry=>entry.id==='local-planner'&&entry.enabled&&entry.local&&isLocalConfig(entry.config));
        if(!planner)throw Error('split_planner_not_registered');
        const available=new Set(chatTools(availableTools(turn),latest).map(tool=>tool.function.name));
        const table=(planningTable??[]).filter(tool=>tool.function.name==='vault_read'&&available.has(tool.function.name));
        if(!table.length)throw Error('split_planner_tool_unavailable');
        const limit=await coreLocalBudget(planner.config,chatNumCtx(),net.fetch);
        return inferencePriority.localReply(()=>sendToProvider(sending,planner.config,{
          tools:true,table,temperature:0,numCtx:chatNumCtx(),maxTokens:256,turn,
        }),limit);
      }
      if(inputProfile==='workflow-response'){
        throw Error('workflow_response_not_eligible'); // Ordinary reply validation/fallback stays active.
      }
      // The conversation route: a deadline on the first word, and the local
      // model answering when it passes or the call fails — she must never go
      // quiet because a company did. A round already streaming is taken back
      // first, so the reader is not shown two beginnings.
      if (brain.hosted) {
        // Transport chunks satisfy the first-word timer without reaching the
        // display. The task's total deadline remains enforced after that.
        const startedAt = Date.now();
        const cacheKey = `haru-${localDateKey(zonedNow(CHAT_TIMEZONE))}`;
        // A network change under a streaming request — the anime stack's
        // containers recreated mid-turn on 2026-09-18, new interfaces, and
        // Chromium gave up the Kimi stream 49 s in with ERR_NETWORK_CHANGED —
        // is asked once more before the local model takes the turn: the
        // fallback is a different voice, and the reader hears the switch.
        const transient = (error: unknown) => /ERR_NETWORK_CHANGED|ERR_CONNECTION_RESET|ERR_CONNECTION_CLOSED|ECONNRESET|socket hang up/i.test(error instanceof Error ? error.message : String(error));
        for (let attempt = 0; ; attempt++) {
          try {
            prepMark('send');
            providerSentAt = Date.now();
            onSending?.();
            const naturalRoundPolicy=(naturalPolicy<any>('roundPolicy',[{naturalKind,messages:sending,latest,fast:fastConversation??null,model:config.model,hostedFirstWordMs:HOSTED_FIRST_WORD_MS}]));
            const naturalRound=naturalRoundPolicy?naturalRoundPolicy.natural:naturalKind&&naturalConversationEligible(sending,latest);
            const firstWordMs=naturalRoundPolicy?naturalRoundPolicy.firstWordMs:fastConversation&&config.model===fastConversation.config.model?NATURAL_FIRST_WORD_MS:HOSTED_FIRST_WORD_MS;
            const answer = naturalRound
              ? await answerNaturalConversation(sending, latest, voiceEvidence, messages => sendToProvider(messages, config, {
                  ...roundOptions, tools: false, table: [], cacheKey, firstWordMs, maxTokens: naturalMaxTokens,
                }), withFiles.filter(message => message.role === 'assistant').slice(-3).map(message => message.content ?? ''))
              : await sendToProvider(sending, config, { ...roundOptions, tools, cacheKey, firstWordMs });
            const turnAnswer=(naturalTurn<any>('hostedAnswer',[{answer,naturalRound:Boolean(naturalRound),brain,needsReview:needsGroundedConversationReview(latest)}]));
            const refusal=turnAnswer?turnAnswer.invalid:conversationReplyIssue(answer.content??'');
            if(turnAnswer?Boolean(refusal):!answer.tool_calls?.length&&refusal)throw new ToolLoopFailure('invalid_conversational_reply',refusal);
            console.log(`[ai] ${config.model} answered in ${Date.now() - startedAt}ms${attempt ? ' (second try)' : ''}`);
            if(turnAnswer?turnAnswer.review:!naturalRound&&['conversation','affordable-cloud'].includes(brain.role??'conversation')&&needsGroundedConversationReview(latest)){
              const checked = await finishLocalReply(answer, sending, latest, { ...replyEvidence, voice: voiceEvidence },
                async messages => {
                  // Review the sources independently of the conversation
                  // model's personality and draft. This is one bounded,
                  // accounted composition step, with no tools of its own.
                  const turnReview=(naturalTurn<any>('reviewRequest',[{cloudAllowed,policy,escalate:readEscalateConfig(store.get('escalate')).enabled,messages,remaining:task.remainingBudgetMicros}]));
                  const reviewer=await coreSelectTaskModel(registry,'affordable-cloud',{...(turnReview??{cloudAllowed:cloudAllowed&&policy.enabled&&readEscalateConfig(store.get('escalate')).enabled,conversation:messages,tools:false,toolSchema:[],inputs:messages.some(message=>message.images?.length)?['text','image'] as ('text'|'image')[]:['text'] as ('text'|'image')[],budgetMicros:policy.dailyBudgetMicros?task.remainingBudgetMicros:0}),available:entry=>providerAvailability.available(entry.config)&&hasKeyFor(entry.config.endpoint)});
                  if (!reviewer) throw new Error('evidence_review_unavailable');
                  console.log(`[truth] evidence composition model=${reviewer.config.model}`);
                  return sendToProvider(messages,reviewer.config,(naturalTurn<PostOptions>('reviewOptions',[{schema:GROUNDED_REPLY_SCHEMA,cacheKey,firstWordMs:HOSTED_FIRST_WORD_MS}])));
                });
              replyGate.reset();
              return checked;
            }
            return answer;
          } catch (error) {
            await task.check(); // Cancellation never starts a retry or local fallback.
            {
              let decision=naturalTurn<any>('hostedFailure',[{toolLoopFailure:error instanceof ToolLoopFailure,error:error instanceof Error?error.message:String(error),attempt,fast:fastConversation??null,config,home,verified:verifiedWorkflowResponse}]);
              if(decision.action==='throw')throw error;
              if(decision.action==='try-fast-fallback'){const primary=await eligible(decision.role,sending,task.remainingBudgetMicros,decision.excludeIds);decision=naturalTurn<any>('hostedAfterFast',[decision.state,primary??null]);}
              if(decision.action==='retry-primary'){brain=decision.brain;config=brain.config;replyGate.reset();continue;}
              if(decision.action==='retry-transient'){replyGate.reset();continue;}
              if(decision.action==='recorded-completion'){replyGate.reset();if(decision.keepLocal)task.keepLocal();task.recordWorkerFailure();return decision.message;}
              if(decision.action==='local'){replyGate.reset();if(decision.keepLocal)task.keepLocal();spilledHome=true;sendToWindows('ai:fellBack',decision.notice);brain=decision.brain;config=brain.config;return answerLocally(sending,config,tools,inputProfile);}
              throw Error('core_hosted_failure_protocol');
            }
          }
        }
      }
      try {
        prepMark('send');
        providerSentAt = Date.now();
        onSending?.();
        return brain.escalated ? await sendToProvider(sending, config, { ...roundOptions, tools }) : await answerLocally(sending, config, tools,inputProfile);
      } catch (error) {
        await task.check();
        {
          const decision=naturalTurn<any>('localFailure',[{brain,home,cloudAllowed,local:isLocalConfig(config),absent:isAbsent(error),intent,error:error instanceof Error?error.message:String(error)}]);
          if(decision.action==='throw')throw error;
          if(decision.action==='local'){if(decision.keepLocal)task.keepLocal();brain=decision.brain;config=brain.config;return answerLocally(sending,config,tools,inputProfile);}
          if(decision.action==='candidate'){const candidate=await eligible(decision.role,sending,task.remainingBudgetMicros);if(!candidate)throw error;brain=brainFromEntry(candidate,'local outage');config=brain.config;return sendToProvider(sending,config,{...roundOptions,tools});}
          throw Error('core_local_failure_protocol');
        }
      }
    },
    runTool: async call => {
      // A call in progress says something while this runs (localcall.ts).
      const tool = (call as { function?: { name?: string } }).function?.name ?? 'tool';
      signal?.throwIfAborted();   // 3770: a dropped turn runs no tool (it would run again in the merged turn)
      onToolCall?.(tool);
      try {
          const packet=corePolicySync<{line:string;speak:boolean}>('conversation-program.toolNarration',[tool,narratedTools,{call}]);
          if(packet.line) {
            narratedTools.push(packet.line);
            sendToWindows('chat:interject',packet.line);
            if(packet.speak)void speak(packet.line);
            // 3320 speak-first: the phone's bubble shows the same line while the tool runs instead of a 6–15 s wait;
            // a call speaks its own filler (localcall.ts), so its stream is left alone.
            if(!voiceCall){replyGate.hold(packet.line);console.log('[reply-gate] '+JSON.stringify({hold:tool,chars:packet.line.length}));}
          }
        } catch(error) { console.warn('[ai] tool narration unavailable:',error instanceof Error?error.message:'transport'); }
      const result = await runChatTool(call, latest, toolDeps(turn));
      // Written down here, at the one seam every tool passes through, and only
      // for the ones that changed something. She had no record of her own
      // conduct at all, so a claim about what she did had nothing behind it to
      // check and she supplied a reason instead (2026-09-08).
      noteDeed(tool, call, result);
      return result;
    },
    // Read through rather than passed by value: runChatTool sets these while a
    // round is in flight, and a copy taken before the round would miss it.
    pageWasRead: turn.pageWasRead,
    handsAllowed: turn.handsAllowed,
    withdrawHands: turn.withdrawHands,
    hasOpenTask: () => getKept().some(item => item.kind === 'task' && !item.done),
    canSearch: () => readSearchConfig(store.get('search')).enabled && turn.handsAllowed(),
    onPresentation: replyGate.opening,
    resetStream: replyGate.reset,
    log: line => console.log(line),
    warn: line => console.warn(line),
    traceId,
  }, async handoff => {
    const current=registry.find(entry=>entry.config.model===handoff.currentModel);
    const turnHandoff=(naturalTurn<any>('qualityHandoff',[{cloudAllowed,escalate:readEscalateConfig(store.get('escalate')).enabled,current:current??null,naturalKind,fast:fastConversation??null,currentModel:handoff.currentModel,conversation:store.get('ai.conversation')??null}]));
    if(turnHandoff?!turnHandoff.admit:!cloudAllowed||!readEscalateConfig(store.get('escalate')).enabled)return null;
    const role=await coreNextTaskRole(turnHandoff?turnHandoff.role:current?.role??'everyday',intent,turnHandoff?turnHandoff.fast:!!(naturalKind&&fastConversation&&handoff.currentModel===fastConversation.config.model&&handoff.currentModel!==(store.get('ai.conversation') as ProviderConfig|undefined)?.model));
    if(!role)return null;
    const next=await eligible(role,handoff.messages,handoff.remainingBudgetMicros,turnHandoff?turnHandoff.excludeIds:current?[current.id]:[]);
    if (!next) return null;
    brain = brainFromEntry(next, `answer quality check failed: ${handoff.failure}`);
    config = next.config;
    console.log(`[router] quality handoff to ${next.role}: ${config.model}`);
    return config;
  }).catch(error => { setImmediate(flushModelObservations); throw error; });
  signal?.throwIfAborted();
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
  const replyCleanup=(corePolicySync<any>('reply-processing.clean',[spoken,withoutMapsLinks(spoken),messages,getKept(),latest,currentActivity?.label??'',{rant:Boolean(rantRoomNow),hers:Boolean(hers),fromSearch,escalated:Boolean(brain.escalated),hosted:Boolean(brain.hosted),hostedParagraphs:HOSTED_PARAGRAPHS},[...ran],agendaClock(zonedNow(CHAT_TIMEZONE))]));
  const said = spoken; // Preserve specialist artifacts without second-model rewriting.
  const recent = replyCleanup?replyCleanup.recent:messages.filter(entry => entry.role === 'assistant').slice(-2).map(entry => entry.content);
  // What she was legitimately given: their message, and whatever is actually
  // on screen. Anything she names beyond that in a closing line was invented.
  const grounded = replyCleanup?replyCleanup.grounded:`${latest} ${currentActivity?.label ?? ''}`;
  // Agenda repeats first: it works on whole paragraphs and knows what the
  // subject is, so it should get its say before the blunter filters start
  // counting words.
  // Only what is still open: a finished errand has no claim on the words in it.
  const onList = replyCleanup?replyCleanup.onList:getKept().filter(item => !item.done).map(item => item.title);
  // Not on a grounded answer: with "eat breakfast" on the list, every paragraph
  // of a restaurant list reads as her nagging about breakfast again, and the
  // list is what they asked for.
  // Any maps link she typed is a made-up one — the app attaches the real button below.
  const unlinked = replyCleanup?replyCleanup.unlinked:withoutMapsLinks(said);
  if (unlinked !== said) console.log('[maps] dropped a link she wrote herself');
  // And not at all on a turn about her: the words of his errands have no
  // business cutting what she says about her own things.
  const deduped = replyCleanup?replyCleanup.deduped:fromSearch || hers ? unlinked : dropRepeatedAgendaMentions(unlinked, recent, onList, latest);
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
  const ranting = replyCleanup?replyCleanup.ranting:Boolean(rantRoomNow || hers);
  const headed = replyCleanup?replyCleanup.headed:dropRoleHeader(dropInventedContact(dropStageDirections(dropInventedScreenTalk(brain.escalated || fromSearch || ranting ? deduped : dropRepeatedParagraphs(deduped, recent, brain.hosted ? HOSTED_PARAGRAPHS : undefined), grounded))));
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
  const body = replyCleanup?replyCleanup.body:dropTackedOnParagraphs(trimmed, brain.escalated || fromSearch || ran.has('search_web') || ran.has('read_web_page') || ran.has('read_video_transcript'), brain.hosted ? HOSTED_PARAGRAPHS : undefined);
  const cleaned = replyCleanup?replyCleanup.cleaned:fixStatedClock(dropRepeatedOpener(dropEchoOpener(fromSearch || ranting ? body : dropRepeatedSentences(body, recent), latest), recent), clock.getHours(), clock.getMinutes());
  // The reminder read from their message is the truth about its time, whatever she says.
  // Her promise, kept: "I'll set the reminder at 6:54 AM" with nothing written
  // is a reminder that exists only in the conversation. See reminderPromised.
  // Not when she already wrote it down herself this turn: the tool ran and
  // she said "reminder set", and the net caught the sentence a second time.
  // The eye-roll in thirty-five of forty replies: the wording that caused it is
  // fixed (EXPRESSIVE), and this catches what the wording does not.
  // herRecentReplies, not `recent`: that holds the last two she said, one fewer
  // than the filter asked for, so it never once fired.
  const replyFinish=(corePolicySync<any>('reply-processing.finish',[cleaned,herRecentReplies,HER_EMOJI,Boolean(hers),Boolean(talking),reminder]));
  const thinned = replyFinish?replyFinish.thinned:oneEmojiAtMost(dropOverusedEmoji(cleaned, herRecentReplies, HER_EMOJI), HER_EMOJI);
  if (thinned !== cleaned) console.log('[ai] thinned the emoji in that reply');
  // On a turn that was hers, or one where they only wanted to talk, the closing
  // order or the pivot back to him goes. The note against it stood in the
  // splice and the hosted model ended on "So out with it. What do you actually
  // want?" regardless — see dropClosingOrder for why this is a filter.
  const varied = replyFinish?replyFinish.varied:hers || talking ? dropClosingOrder(thinned) : thinned;
  if (varied !== thinned) console.log('[ai] took the closing order off a reply that was about her');
  const herLine = replyFinish?replyFinish.herLine:reminder?.time ? fixStatedReminderTime(varied, reminder.time) : varied;
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
  const navigationResult=(navigationPolicy<{routeless:string;content:string}>('finalReply',[herLine,directions,Boolean(fromSearch),Boolean(brain.escalated),spoken]));
  const {routeless,content: preparedContent}=navigationResult;
  let content=preparedContent;
  signal?.throwIfAborted();
  // Core selects the voice pass and validates its facts. This adapter sends
    // the selected model command through the existing accounted provider path.
    try {
      const voiced=await conversationRun('publication',{answer:content,source:brain.escalated?'specialist':'model',around:latest},undefined,signal);
      if(typeof voiced==='string')content=voiced;
    } catch(error) { console.warn('[ai] publication voice unavailable:',error instanceof Error?error.message:'transport'); }
  signal?.throwIfAborted();
  // 3770: her reply-promise reminder is written here, with nothing awaited before the commit that says it: a turn dropped
  // earlier writes nothing (and is merged); a turn that gets here says it.
  {
    const packet=corePolicySync<any>('agenda-life.final',[agendaFacts(ownedAgendaCore()),getAsides(),{lastIsUser:messages.at(-1)?.role==='user',hasReminder:Boolean(reminder),ran:[...ran],latest,reply:cleaned,previous:typeof herPrevious==='string'?herPrevious:'',recentUsers:messages.filter(m=>m.role==='user').slice(-4).map(m=>String(m.content??'')),clock:agendaClock(zonedNow(CHAT_TIMEZONE)),now:Date.now()},new Date().toISOString(),randomUUID()]);
    applyAgendaPlan(ownedAgendaCore(),packet,ownedAgendaChanged);
    if(packet.plan)void syncFromGoogle().catch(error=>console.warn('[agenda-sync]',error instanceof Error?error.message:'failed'));
  }
  replyGate.commit(content);
  // 3760: the reply is final: say what is left of it now (a one-sentence reply waited for the turn's end, ~0.2-0.3 s).
  try{onPublished?.(content);}catch(error){console.warn('[voice] early flush failed:',error instanceof Error?error.message:'error');}
  markTurn('published');
  console.log(`[reply-timing] ${JSON.stringify({ trace: traceId, stage: 'published', elapsedMs: Date.now() - enteredAt,
    preparationMs: firstDispatchAt ? firstDispatchAt - enteredAt : null, path: naturalKind ? 'natural' : 'full', model: config.model })}`);
  // Yield after publication so socket text can leave before optional diagnostics,
  // speech preparation or post-reply configuration writes run on this thread.
  // 3760: on a call, one I/O pass first, so her voice request leaves before the store writes (~65-75 ms).
  await new Promise<void>(resolve => voiceCall ? setImmediate(() => setImmediate(resolve)) : setImmediate(resolve));
  setImmediate(flushModelObservations);
  if (naturalKind && process.env.HARU_DUMP_PROMPT) setImmediate(() => {
    void import('node:fs/promises').then(fs => fs.writeFile(path.join(app.getPath('userData'), 'last-prompt.json'),
      JSON.stringify({ at: new Date().toISOString(), model: config.model, conversation }, null, 1))).catch(() => {});
  });
  if (herLine !== said) console.log(`[ai] dropped ${said.length - content.length} chars she had already said`);  // The turn's ledger, one line: who answered, how much she was handed, and
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
  applyAgendaPlan(ownedAgendaCore(),corePolicySync<any>('agenda-life.finishFresh',[agendaFacts(ownedAgendaCore()),fresh]),()=>{});
  // Shared: the expression system consumes it through the broadcast inside,
  // and the voice awaits it to choose a clip matching how this line was said.
  const herWords = routeless;
  // The reply already names its intended delivery. Reuse it for voice and
  // expression instead of queueing a second model request behind every turn.
  const labelled = splitDelivery(herWords)[0]?.mood ?? splitDelivery(said)[0]?.mood;   // 4040: a replaced opening loses her tag; what she wrote still has it (two call turns ran the classifier on 10-16)
  const delivery = labelled ? { ...NEUTRAL_EMOTION, emotion: labelled, confidence: 1 } : null;
  if (delivery) broadcastBeat(delivery);
  const saidMood = delivery ? Promise.resolve(delivery) : classifyEmotion(herWords, home);
  void speak(herWords, saidMood);
  void tieToPlace(latest, herWords, home);
  // Restarting herself kills the process she is answering from, so the
  // restart waits until this reply is built and on its way — the words leave
  // first, the restart follows a few seconds behind.
  if (turn.restartRequested()) {
    setTimeout(() => { void runSystemCommand('systemctl', ['--user', 'restart', 'haru']); }, 5000);
  }
  // Which brain this one was, written down before it is handed back: the
  // renderer owns the stored message and gives it no model, so a thumb on it
  // days later has nothing to go on but this (feedback.ts, Spoke).
  noteWhoSpoke(config.model, brainName);
  console.log(`[reply-timing] ${JSON.stringify({ trace: traceId, stage: 'complete', elapsedMs: Date.now() - enteredAt })}`);
  markTurn('harness_end');
  return { content, ignored: false, irritation, ego, choices: turn.pendingChoices(), attachments: turn.pictures() };
}

/** The route that just spoke, kept so a rating can be read by model. */
function noteWhoSpoke(model: string, brain: string): void {
  if (!model) return;
  store.set('ai.spoke', rememberSpoke(readSpoke(store.get('ai.spoke')), { at: new Date().toISOString(), model, brain }));
}

/**
 * Which model wrote the reply they are rating.
 *
 * Both logs used to stamp `ai.config.model` — the local brain, whoever actually
 * answered. The route now writes itself down as it finishes (noteWhoSpoke), so
 * this reads back the one that was speaking when that reply was stamped, and
 * falls back to the old answer for anything older than the record.
 */
function modelBehind(history: { id?: string; role: string; content?: string; reaction?: string; at?: string }[], id: string): string {
  const fallback = (store.get('ai.config') as ProviderConfig | undefined)?.model ?? '';
  return modelThatSpoke(readSpoke(store.get('ai.spoke')), repliedTo(history, id)?.at, fallback);
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
  return corePolicySync<ProviderConfig|null>('projects.nudgeConfig',[store.get('ai.nudge'),null]);
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
  return ownedReminder(true,0);
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
  {
    const core=remainingStore(app.getPath('userData')),decision=corePolicySync<any>('self.spokenPlan',[text,core.docRef('config',{})]);
    if(!decision)return null;
    if(decision.settingPlan)await applyPlanAtTheirWord(decision.settingPlan);
    return {reply:decision.reply,tier:decision.tier};
  }
}

async function applyPlanAtTheirWord(plan: SettingPlan): Promise<{ ok: boolean; note: string }> {
  {
    const core=remainingStore(app.getPath('userData')),decision=corePolicySync<any>('self.applyPlan',[core.docRef('config',{}),plan]);
    store.backup(decision.backup);applyRemainingPlan(core,decision.plan);refreshConfigurationNote();return decision.result;
  }
}

function quickHit(text: string, history: { role?: string; content?: string }[], phoneTimeZone?: string) {
  {
    const mood=getMood(),character=getActiveCharacter();
    const hit=corePolicySync<{reply:string;tier:number}|null>('quick.hit',[text,{
      voiceInput:voiceSense.hasInput(text),now:zonedNow(CHAT_TIMEZONE),nowMs:Date.now(),phoneTimeZone:phoneTimeZone??null,fallbackTimeZone:CHAT_TIMEZONE,kept:getKept(),checkIns:getCheckIns(),
      nickname:getProfile().nickname,herName:herNameFrom(character.identity),irritation:mood.irritation,
      ignoring:isIgnoring(mood.irritation),history,conversationRoute:conversationRoute(),
    }]);
    if(hit){noteUserSpoke();advanceMood(text,history);}return hit;
  }
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
  return corePolicySync('final-recall.shown',[store.getArchiveSizes().map(s=>s.day),todayKey,DAYS_OF_HISTORY]);
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
  {
    const decision=corePolicySync<{key:string;rebuild:boolean}>('final-recall.indexPlan',[store.getArchiveSizes(),todayKey,chatIndexCache?.key??null]);
    if(decision.rebuild)chatIndexCache={key:decision.key,index:buildChatIndex(keptExchanges(todayKey))};
    if(!chatIndexCache)throw Error('chat_index_cache_protocol');return chatIndexCache.index;
  }
}

/**
 * The words she writes in lowercase in her kept replies — evidence that a
 * capitalised one in her night notes ("Think" of "Think Pol") is a word and not
 * a name (room.ts namesIn). Rebuilt with the chat index.
 */
let everydayWordsCache: { index: ChatIndex; words: Set<string> } | null = null;
function everydayWords(): Set<string> {
  {
    const index=chatIndex(localDateKey(zonedNow(CHAT_TIMEZONE)));
    if(everydayWordsCache?.index!==index)everydayWordsCache={index,words:coreEveryday(index)};
    return everydayWordsCache.words;
  }
}

/** search_chats (tools.ts): words and meaning over every kept day, dated finds with their neighbours. */
async function searchOldChats(input: { query: string; from?: string; to?: string }): Promise<{ found: number; text: string; wordsOnly: boolean }> {
  {
    const index=chatIndex(localDateKey(zonedNow(CHAT_TIMEZONE))),plan=corePolicySync<any>('final-chat.embeddingPlan',[getKnowledgeEmbedder()?.model??null,recallFormat,input.query]);
    const queryVector=plan.embed?await tryEmbedQuery(plan.text):null;
    const hits=searchChats(index,{...input,queryVector,vectors:recallVectors});
    return corePolicySync('final-chat.result',[hits,Boolean(queryVector)]);
  }
}

/**
 * Four decimals is all a cosine needs, and a year of exchanges kept at full
 * double precision in JSON is a hundred megabytes read at every start: 1,162 of
 * them were 11 MB (2026-09-17).
 */
function roundedVector(vector: number[]): number[] {
  return corePolicySync('final-recall.rounded',[vector]);
}
/** Set when the cache on disk should be written even with nothing new: rounded on load, or pruned. */
let recallCacheStale = false;

function loadRecallVectors(): void {
  try{const file=JSON.parse(readFileSync(RECALL_CACHE(),'utf8')),meta=corePolicySync<any>('final-recall.loadMeta',[file.format??null,Boolean(file.vectors&&typeof file.vectors==='object')]);
      if(!meta.load)return;recallFormat=meta.format;
      recallFrames(Object.entries(file.vectors),rows=>{const result=corePolicySync<any>('final-recall.loadBatch',[rows]);for(const [id,vector] of result.rows)recallVectors.set(id,vector);if(result.stale)recallCacheStale=true;});
    }catch{}return;
}

async function refreshRecallVectors(): Promise<void | {recallBacklog:boolean}> {
  {
    const embedder=getKnowledgeEmbedder();if(recallRefreshing||!embedder)return {recallBacklog:false};
    recallRefreshing=true;
    try{return await coreRefreshRecall({model:embedder.model,oldFormat:recallFormat,all:keptExchanges(localDateKey(zonedNow(CHAT_TIMEZONE))),vectors:recallVectors,stale:recallCacheStale,embed:texts=>embedder.embedBatch(texts),setFormat:value=>{recallFormat=value},setStale:value=>{recallCacheStale=value},save:()=>{recallCacheStale=true;writeFileSync(RECALL_CACHE(),JSON.stringify({format:recallFormat,vectors:Object.fromEntries(recallVectors)}),'utf8');}});}
    finally{recallRefreshing=false;}
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
let readingGraph = false;
function graphProgress(day:string,messages:unknown[],userName:string) {
  return graphJob((store.get('graph.jobs') as Record<string,unknown>|undefined)?.[day],graphFingerprint(messages,userName));
}
function saveGraphProgress(day:string,job:ReturnType<typeof graphJob>) {
  const jobs=(store.get('graph.jobs') ?? {}) as Record<string,unknown>;
  store.set('graph.jobs',corePolicySync('graph-mutation.saveJobs',[jobs,day,job]));return;
}

function graphUserName(): string {
  return corePolicySync('graph-mutation.userLabel',[getProfile().nickname]);
}

/**
 * The brain that reads a day: the hosted conversation route, and nothing when
 * there is none. Not the local model — measured on the same prompt and the
 * same days (2026-09-16), the 9B filed the Eiffel Tower as part of his life
 * and wrote "Tommy works at a job"; a graph of that is worse than no graph.
 */
function graphBrain(): ProviderConfig | null {
  return corePolicySync('graph-mutation.brain',[store.get('graph') ?? null,conversationRoute()]);
}

async function readGraphTick(): Promise<void> {
  if (readingGraph) return;
  const brain = graphBrain();
  if (!brain || inferencePriority.backgroundReason(brain.endpoint,brain.endpoint)) return;
  const today = currentChatDayKey(), archive=store.getArchive(), read=store.getFactGraph().read;
  const extractionUser=graphUserName();
  const day=(corePolicySync<string|null>('graph-mutation.selectDay',[Object.entries(archive).map(([day,messages])=>({day,messageCount:messages.length,readCount:read[day] ?? null,fingerprint:graphFingerprint(messages,extractionUser),previous:(store.get('graph.jobs') as Record<string,unknown>|undefined)?.[day] ?? null})),today,chatDayKey(),Date.now()]));
  if(!day)return;
  readingGraph=true;
  try {
    const outcome=await inferencePriority.runBackground(brain.endpoint,brain.endpoint,signal=>readDayIntoGraph(day,(archive[day]??[]) as {role?:string;content?:unknown}[],brain,signal));
    if(outcome==='read')syncGraphPage(`read ${day}`);
  }catch(error){
    // Storage uncertainty must not be interpreted as a processed day. A Core
    // commit and its checkpoint are atomic; never acknowledge an uncertain one.
    console.warn('[graph] job could not be confirmed; unread progress retained');
  }finally{readingGraph=false;}
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
async function readDayIntoGraph(day: string, messages: { role?: string; content?: unknown }[], brain: ProviderConfig, signal?:AbortSignal): Promise<'read' | 'unreadable' | 'unanswered'> {
  assertGraphCounter(store.getFactGraph());
  const userName=graphUserName(),chunks=dayChunks(messages,userName);
  let job=graphProgress(day,messages,userName);
  if((!corePolicySync<boolean>('graph-mutation.eligible',[job,Date.now()])))return 'unanswered';
  const registry=readModelRegistry(store.get('ai.modelRegistry'),{
    local:store.get('ai.config') as ProviderConfig,conversation:store.get('ai.conversation') as ProviderConfig|undefined,
    specialist:store.get('escalate.provider') as ProviderConfig|undefined,vision:readVisionConfig(store.get('vision')),
  });
  for(const [index,chunk] of chunks.entries()){
    if(index<job.pieces)continue;
    const conversation:OllamaMessage[]=[{role:'system',content:extractionPrompt(userName)},
      {role:'user',content:extractionInput(day,knownBlock(store.getFactGraph(),chunk,userName),chunk)}];
    saveGraphProgress(day,job);
    const task=new TaskController(taskBridge.call,registry,graphPolicy(readTaskPolicy(store.get('ai.taskPolicy'))),true);
    let content:string;
    try{
      await task.start(`Graph extraction ${day} piece ${index+1} ${job.fingerprint.slice(0,16)}`,brain.model,'background',signal);
      content=await task.compose(()=>ollamaPost(conversation,brain,{tools:false,temperature:0.1,format:EXTRACTION_SCHEMA,maxTokens:3000}),conversation);
    }catch(error){
      job=graphFailure(job,'unanswered',Date.now());saveGraphProgress(day,job);
      console.warn(`[graph] piece ${index+1} deferred without marking the day read`);
      return 'unanswered';
    }
    const extraction=readExtraction(content);
    if(!extraction){saveGraphProgress(day,graphFailure(job,'unreadable',Date.now()));return 'unreadable';}
    const {graph,report}=applyExtraction(assertGraphCounter(store.getFactGraph()),extraction,{day,chunk,userName});
    job=(corePolicySync('graph-mutation.progress',[job,index+1]));
    store.transaction(()=>{store.setFactGraph(graph);saveGraphProgress(day,job);});
    console.log(`[graph] committed ${day} piece ${index+1}/${chunks.length}: +${report.added}, confirmed ${report.confirmed}, refused ${report.rejected.length}`);
  }
  const graph=store.getFactGraph();
  store.transaction(()=>{
    store.setFactGraph({...graph,read:{...graph.read,[day]:messages.length}});
    saveGraphProgress(day,(corePolicySync('graph-mutation.done',[job])));
  });
  return 'read';
}

// -- what she overhears (overheard.ts) ---------------------------------------
//
// Tier 1 of the WhatsApp door. Lines from the chats he allowed pile up here and
// a pass reads them on the local brain, on a slow timer and once more at the
// 04:30 maintenance so the last of the evening is not left until morning.
//
// Nothing in here ever answers anybody. The output is two things: entries on
// his list, and -- only if he switched that half on -- facts in the graph.

const overheard = new Overheard();
let readingOverheard = false;
let overheardReadAt = 0;

/**
 * The brain that reads other people's messages, and nothing when it would not
 * be this machine.
 *
 * His contacts never agreed to be read by anything. That the extraction runs
 * locally is the promise this integration is built on, so it is checked at the
 * moment of use rather than assumed from a config written weeks ago — and a
 * route that has been pointed somewhere else stops the pass rather than
 * quietly sending Sam's messages to Venice.
 */
function overheardBrain(): ProviderConfig | null {
  return supplement('brain',[store.get('ai.config')??null]);
}

/** One pass over everything said since the last one. */
async function readOverheardTick(force = false): Promise<void> {
  return coreReadOverheard(force,{core:remainingStore(app.getPath('userData')),facts:()=>({whatsapp:{enabled:(store.get('whatsapp') as any)?.enabled,reading:(store.get('whatsapp') as any)?.reading},brain:store.get('ai.config')??null,busy:readingOverheard,lines:overheard.lines,now:Date.now(),lastAt:overheardReadAt,day:currentChatDayKey(),userName:graphUserName()}),drain:()=>overheard.drain(),busy:value=>{readingOverheard=value;},stamp:at=>{overheardReadAt=at;},compose:(messages,config,options)=>ollamaPost(messages,config,options),committed:packet=>{if(packet.agendaChanged){ownedAgendaChanged({plan:{config:packet.config}});void syncFromGoogle().catch(error=>console.warn('[agenda-sync]',error));}},log:line=>console.warn(line)});
}

// -- things to come back to (scheduler.ts) ----------------------------------------
//
// One saved list and one dispatcher: the daily sweeps at a time of day rather
// than a day after whenever the app last started (a restart every few hours
// meant the 24-hour interval never fired at all), and what she books for
// herself with book_follow_up.

/** The daily sweeps, before the 05:00 roll. Missed while the app was down, they run at the next start within twenty hours. */
const MAINTENANCE_AT = '04:30';

const scheduler = ((createCoreScheduler))({
  load: () => store.getSchedule(),
  save: file => store.setSchedule(file),
  handlers: {
    maintenance: () => {
      // Each sweep on its own (2026-09-17): one throwing used to skip the rest
      // for the day. The job is failed, and retried, only when every sweep
      // threw. A retry reruns all four, the ones that worked included, and a
      // sweep that throws is usually bad data or a bug that throws again a minute
      // later — so one that fails alone is logged and tried again tomorrow.
      const sweeps: [string, () => unknown][] = [['consolidation', runMemoryConsolidation], ['decay', runMemoryDecay], ['archive pruning', pruneOldArchives], ['haunt hygiene', runHauntHygiene],
        // Whatever was said late and is still sitting in the window, so the end
        // of his evening is not left unread until the middle of the next day.
        ['overheard', () => { void readOverheardTick(true); }]];
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
    [ANIME_FETCH_KIND]: watchFetch,
  },
  log: line => console.log(line),
});

async function bookFollowUp(input: { why: string; date?: string; time?: string; inMinutes?: number }): Promise<{ booked: true; when: string } | { booked: false; reason: string }> {
  {
    if((!('book' in scheduler)))throw Error('core_booking_scheduler_required');
    const now=Date.now(),packet=corePolicySync<any>('final-booking.prepare',[input,now,CHAT_TIMEZONE]);
    if(packet.result)return packet.result;
    const result=await scheduler.book(packet.command,`booked-${randomUUID().slice(0,8)}`);
    return corePolicySync('final-booking.observed',[result,now,CHAT_TIMEZONE]);
  }
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
  {const p=corePolicySync<any>('conversation-program.unpromptedStart',[note,conversationPolicyFacts()]);if(p.error)throw Error(p.error);const answer=await Promise.race([sendToProvider(p.command.messages,p.command.config,p.command.options),new Promise<never>((_,reject)=>setTimeout(()=>reject(Error('no answer in 40s')),p.command.timeoutMs))]);return corePolicySync<any>('conversation-program.unpromptedObserved',[p.state,answer.content??'',{...conversationPolicyFacts(),asides:getAsides()}]).result;}
}

/**
 * A booking of hers, come due. Put off rather than dropped when the moment is
 * wrong — asleep, his quiet hours, him not up, the two of them mid-conversation,
 * a game on — and written by the conversation route when it is right, under the
 * same guards as a second thought. She may still decide it no longer fits.
 */
async function comeBackTo(job: Job): Promise<Outcome> {
  {const read=()=>({now:Date.now(),zone:CHAT_TIMEZONE,silenced:isSilenced(store.get('pushback') as Pushback|undefined,Date.now()),asleep:herAsleepNow(),knocked:herKnockedAwakeNow(),wakeAt:herWakeAt(),quiet:inQuietHours(getPush().prefs,zonedNow(CHAT_TIMEZONE)),up:theyAreUpNow(),lastUser:lastUserActivityAt,lastInterjection:lastInterjectionAt,gameQuiet:readGamingConfig(store.get('gaming')).quiet,gameRunning:gameIsRunning()});const p=corePolicySync<any>('conversation-program.bookedStart',[job,read()]);if(Object.hasOwn(p,'result'))return p.result;const line=await composeUnprompted(p.prompt);const done=corePolicySync<any>('conversation-program.bookedObserved',[p.state,line,read()]);if(done.publication){lastInterjectionAt=done.publication.at;noteAside(done.publication.line,done.publication.source,done.publication.about);}return done.result;}
}

/**
 * "Let me know when the traffic eases", asked: a watch on the scheduler, unless
 * the road has already eased or cannot be read. Returns what she is told, so
 * what she says about it is what the app will actually do (trafficwatch.ts).
 */
function navigationFacts(){return {now:Date.now(),where:getWhereabouts(),hasKey:Boolean(getGoogleMapsKey()),searchPlace:readSearchConfig(store.get('search')).place,weekday:zonedNow(CHAT_TIMEZONE).getDay(),timeZone:CHAT_TIMEZONE,lastPlaceFound,jobs:scheduler.list(),pushback:store.get('pushback')};}
function navigationAdapter(){return {facts:navigationFacts,jobs:()=>scheduler.list(),book:(job:Job)=>scheduler.add(job),cancel:(id:string)=>scheduler.cancel(id),cache:(cache:any)=>{lastPlaceFound=cache;},watch:(a:any)=>startTrafficWatch(a.destination,a.found,a.route),execute:(kind:string,a:any)=>{switch(kind){case 'google':return searchGooglePlaces(a.query,getGoogleMapsKey(),a.near,(url,init)=>fetch(url,init));case 'osm':return searchPlaces(a.query,(url,init)=>fetch(url,init),a.near,a.fallback,a.options);case 'route':return computeRoute(a.start,a.target,getGoogleMapsKey(),(url,init)=>fetch(url,init));case 'compose':return composeUnprompted(a.prompt);default:throw Error('navigation_command_invalid');}},stamp:(at:number)=>{lastInterjectionAt=at;},publish:(a:any)=>noteAside(a.text,a.source,a.about,undefined,a.scheduledPush)};}

async function startTrafficWatch(destination: string, found: FoundPlace | null, route: Route | null): Promise<string> {
 return startCoreTrafficWatch(destination,found,route,navigationAdapter());
}

/**
 * The road read again for a watch. Again in a few minutes while it is still
 * slow; her line, with the directions button, once it is back near normal; and
 * a line saying it never cleared when the watch runs out. Asked for, so said:
 * a plain line stands in when her brain lets it go or cannot be reached.
 */
async function watchTraffic(job: Job): Promise<Outcome> {
 return runCoreTrafficWatch(job,navigationAdapter());
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
  return corePolicySync('publication.initiativeBlockers',[publicationSnapshot()]);
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

function ownedThoughtFacts() {
  return {...publicationSnapshot(),zone:CHAT_TIMEZONE,settings:store.get('thoughts')??null,hasBrain:Boolean(nudgeBrain()),state:store.getThoughts(),
    mood:getMood(),messages:store.get('chat.messages')??[],asides:getAsides(),days:getDays(),nights:getNights(),week:getWeek(),tasks:getKept(),memories:getMemories(),
    moodNote:[vitalsInstruction(vitals,getMood().irritation),grudgeInstruction(getMood().grudge??0)].filter(Boolean).join(' ')};
}
async function ownedThoughtTick():Promise<void>{
  if(thinkingNow)return;
  const facts=ownedThoughtFacts(),plan=corePolicySync<any>('thoughts.begin',[facts]);if(!plan)return;
  const original=JSON.stringify(store.getThoughts());let state=plan.state,made:Thought[]=[],spoke=false;
  thinkingNow=true;
  try{
    store.transaction(()=>{if(JSON.stringify(store.getThoughts())!==original)throw Error('core_thought_state_changed');store.setThoughts(state);});
    const expected=JSON.stringify(store.getThoughts()),moodBranch=JSON.stringify(getMood()),messagesBranch=JSON.stringify(store.get('chat.messages')??[]);
    const fence=()=>{if(JSON.stringify(store.getThoughts())!==expected||JSON.stringify(getMood())!==moodBranch
      ||JSON.stringify(store.get('chat.messages')??[])!==messagesBranch)throw Error('core_thought_branch_changed');};
    const reply=await Promise.race([ollamaPost([{role:'system',content:`${getActiveCharacter().identity}\n\n${plan.rules}`},{role:'user',content:plan.input}],nudgeBrain()!,
      {tools:false,temperature:0.8,format:'json',maxTokens:500}),new Promise<never>((_,reject)=>setTimeout(()=>reject(Error('no answer in 90s')),90000))]);
    fence();const drafts=corePolicySync<any[]>('thoughts.drafts',[reply.content??'']);
    for(const draft of drafts){
      const vector=await tryEmbedQuery(draft.thought);fence();
      const decision:any=corePolicySync<any>('thoughts.consider',[{state,draft,vector:vector??null,now:facts.now,trigger:plan.trigger,made,spoke,speak:plan.speak,
        asides:getAsides(),publication:publicationSnapshot(),dayStart:plan.dayStart,lastMessageAt:plan.lastMessageAt}]);
      state=decision.state;spoke=decision.spoke;
      if(decision.action==='retain'){made.push(decision.thought);continue;}
      const line=await composeUnprompted(decision.prompt);fence();
      const delivery=corePolicySync<any>('thoughts.afterCompose',[decision.thought,line,facts.now,lastUserActivityAt]);
      if(!delivery.publish){made.push(delivery.thought);continue;}
      // The recorded aside is the application receipt; it does not mean phone playback.
      fence();const receipt=noteAside(line!,'thought',delivery.about);lastInterjectionAt=Date.now();
      const retained=corePolicySync<any>('thoughts.settled',[state,made,delivery.thought,line,receipt?{id:receipt.id}:null,Date.now()]);
      made=retained.made;
    }
    const final=corePolicySync<ThoughtState>('thoughts.keepThoughts',[state,made,Date.now()]);
    store.transaction(()=>{fence();store.setThoughts(final);});
  }catch(error){console.warn(`[thought] owned decision rejected: ${error instanceof Error?error.message:error}`);}
  finally{thinkingNow=false;}
}

async function thoughtTick(): Promise<void> {
  await ownedThoughtTick();return;
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
  {const now=zonedNow(CHAT_TIMEZONE),today=localDateKey(now),yesterday=localDateKey(new Date(now.getFullYear(),now.getMonth(),now.getDate()-1));const p=corePolicySync<any>('conversation-program.todaysExamples',[remainingStore(app.getPath('userData')).docRef('config',{}),remainingStore(app.getPath('userData')).docRef('archive',{}),today,yesterday]);examplesCache=p;return p.examples;}
}

function rantRoom(latest: string, mentioned = '', answering = false): string {
  {const facts={...conversationPolicyFacts(),lastNight:nightsOn(getNights(),lastNightKey())[0]??null,interests:getInterests(),vitals,feelings:getFeelings(),roll:Math.random()};const p=corePolicySync<any>('conversation-program.rant',[facts,latest,mentioned,answering]);conversationApply(p);return p.result;}
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
 return runCoreDirections(latest,recentUser,navigationAdapter());
}

function locationFacts(){
 const core=remainingStore(app.getPath('userData')),now=new Date(),config=core.docRef('config',{}),arrival=(config.body as any).where?.arrival;
 return {config,now:now.getTime(),at:now.toISOString(),timezone:Intl.DateTimeFormat().resolvedOptions().timeZone,weekday:new Intl.DateTimeFormat('en-US',{weekday:'long'}).format(zonedNow(CHAT_TIMEZONE)).toLowerCase(),memories:getMemories(),mood:getMood(),arrivalClock:locationClock(arrival,clockAt)};
}
function locationAdapter(){return {core:remainingStore(app.getPath('userData')),facts:locationFacts,moodChanged:(mood:any)=>sendToWindows('mood:changed',mood)};}

function getWhereabouts(): Whereabouts {
  return readWhereabouts(store.get('whereabouts'));
}

function saveWhereabouts(next: Whereabouts) {
 applyCoreLocation('mutation',['save',next],locationAdapter());return;
}

function getBody(): Body {
  return readBodyState(store.get('body'));
}

function saveBody(next: Body) {
  store.set('body', next);
}

function getPush(): { devices: PushDevice[]; prefs: PushPrefs; lastReachedAt: number } {
  const saved = (store.get('push') ?? {}) as Record<string, unknown>;
  return {
    devices: readPushDevices(saved.devices),
    prefs: readPushPrefs(saved.prefs),
    lastReachedAt: Number(saved.lastReachedAt ?? 0) || 0,
  };
}

function savePush(next: { devices?: PushDevice[]; prefs?: PushPrefs; lastReachedAt?: number }) {
  const merged = { ...((store.get('push') ?? {}) as Record<string, unknown>) };
  const previous = readPushPrefs(merged.prefs);
  if (next.devices) merged.devices = next.devices;
  if (next.prefs) merged.prefs = next.prefs;
  if (next.lastReachedAt !== undefined) merged.lastReachedAt = next.lastReachedAt;
  store.set('push', merged);
  if (next.prefs && ['random', 'held', 'quietFrom', 'quietTo'].some(key => previous[key as keyof PushPrefs] !== next.prefs![key as keyof PushPrefs])) {
    store.set('chat.phoneNudges', { ...getPhoneNudges(), pending: [], scannedAt: 0 });
  }
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

async function pushThroughApple(kind: string, text: string, url: string, topic: string, eventId?: string, expiresAt?: number, onUnknown?: () => void): Promise<number> {
  const { config, devices } = getApns();
  if (!config || !devices.length) return 0;
  let delivered = 0;
  const payload = apnsPayload(PUSH_TITLE, text.slice(0, 500), url, topic, { kind, eventId });
  for (const device of devices) {
    try {
      const result = await sendApns(device, payload, config, apnsBearerFor(config)(), topic, expiresAt);
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
      onUnknown?.();
      console.warn('[push] could not reach Apple:', error instanceof Error ? error.message : error);
    }
  }
  return delivered;
}

async function pushToPhone(kind: 'random' | 'events' | 'system' | 'weather' | 'followup', text: string, url = '/', force = false, topic = `haru-${kind}`, eventId?: string, nudge?: { id: string; expiresAt: number; scheduled?: boolean }, urgent = false, asideContext?: { source: AsideSource; opportunityPresent: boolean }): Promise<boolean> {
  const { devices } = getPush();
  const deliveryKey = nudge?.id ?? `random:${Date.now()}:${Math.random()}`;
  const capture = () => {
    const { prefs } = getPush();
    return {kind,id:deliveryKey,state:getPhoneNudges(),prefs:{enabled:prefs[kind],held:prefs.held,quietFrom:prefs.quietFrom,quietTo:prefs.quietTo},
      hasDevices:Boolean(getPush().devices.length||getApns().devices.length),force,urgent,scheduled:Boolean(nudge?.scheduled),
      momentBlocked:(corePolicySync<boolean>('publication.deliveryBlocked',[publicationSnapshot()])),
      fromAside:Boolean(asideContext),userAwake:theyAreUpNow(),opportunityRequired:Boolean(asideContext&&['idle','thought','hanging'].includes(asideContext.source)),
      opportunityPresent:Boolean(asideContext?.opportunityPresent),lastReachedAt:getPush().lastReachedAt,expiresAt:nudge?.expiresAt??null};
  };
  const before=capture(),clockMinute=Math.floor(Date.now()/60000);
  let decision;
  try { decision=await coreReserveDelivery(before,Date.now()); }
  catch { console.log('[core-nudge] '+JSON.stringify({op:'reserve',reason:'admission_unavailable'})); return false; }
  if(!decision.allowed||Math.floor(Date.now()/60000)!==clockMinute||!sameCoreDelivery(before,capture())||nudge&&nudge.expiresAt<=Date.now()&&kind==='random'&&!nudge.scheduled&&!force)return false;
  // No await between the fresh-state fence and durable reservation. Racing grants lose this fence.
  const deliveryId=decision.id;
  if(deliveryId)store.set('chat.phoneNudges',decision.state);
  const spontaneous=kind==='random'&&!nudge?.scheduled;
  let uncertain=false;
  const finish=async (sent:boolean) => {
    if(deliveryId&&!sent&&uncertain) {
      console.log('[core-nudge] '+JSON.stringify({op:'finish',reason:'carrier_outcome_unknown'}));
      return false;
    }
    if(deliveryId) {
      const state=getPhoneNudges(),target=state.deliveries.find(d=>d.id===deliveryId);
      try {
        const result=await coreFinishDelivery(state,deliveryId,sent,Date.now());
        const status=result.deliveries.find(d=>d.id===deliveryId)?.status;
        // Merge only the transport outcome, preserving newer reservations and reply-hour feedback.
        if(target&&status)store.set('chat.phoneNudges',{...getPhoneNudges(),deliveries:getPhoneNudges().deliveries.map(d=>
          d.id===deliveryId&&d.at===target.at&&d.status===target.status?{...d,status}:d)});
      } catch { console.log('[core-nudge] '+JSON.stringify({op:'finish',reason:'outcome_pending'})); }
    }
    return sent;
  };
  // The native app, through Apple, alongside the page's Web Push.
  const apple = await pushThroughApple(kind, text, url, topic, eventId, spontaneous ? 0 : undefined,()=>{uncertain=true;});
  let delivered = apple > 0;
  let web = 0;
  // How many copies went out, in one line: two Apple tokens and three web
  // subscriptions all named "iPhone" were each taking every push (2026-09-06).
  const readout = () => console.log(`[push] ${JSON.stringify(text.slice(0, 40))} went to ${apple} Apple token(s) and ${web} web subscription(s)`);
  if (!devices.length) { readout(); return finish(delivered); }
  let keys: ReturnType<typeof vapidKeys>;
  try { keys=vapidKeys(); } catch { return finish(delivered); }
  const payload = JSON.stringify({ title: PUSH_TITLE, body: text.slice(0, 500), url, kind, eventId });
  for (const device of devices) {
    try {
      const request = pushRequest(device, payload, keys, { ttlSeconds: spontaneous ? 0 : undefined }, topic);
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
        // The shared notification breather starts at carrier acceptance.
        savePush({ lastReachedAt: Date.now() });
      }
    } catch (error) {
      uncertain=true;
      console.warn('[push] could not send:', error instanceof Error ? error.message : error);
    }
  }
  readout();
  return finish(delivered);
}

/**
 * Which asides buzz the phone, and as which kind — split by kind so the
 * preferences can refuse one sort of interruption without silencing the rest.
 */
const PUSH_KIND: Partial<Record<AsideSource, 'random' | 'events' | 'system' | 'weather' | 'followup'>> = {
  reminder: 'events',
  upcoming: 'events',
  hanging: 'random',
  weather: 'weather',
  journal: 'events',
  idle: 'random',
  goodnight: 'random',
  system: 'system',
  booked: 'followup',
  thought: 'random',
  anime: 'random',
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
async function forwardAsideToPush(aside: Aside, opportunity?: { id: string; expiresAt: number }, scheduled = false) {
  {
    const command=corePolicySync<any>('asides.forward',[aside,{now:Date.now(),kept:getKept(),lastChased:store.get('reminders.lastChased')??null},opportunity??null,scheduled]);
    if(!command)return;
    const reached=await pushToPhone(command.kind,command.text,command.url,command.force,command.topic,command.eventId??undefined,command.nudge??undefined,command.urgent,command.asideContext);
    coreAside('reached',{id:aside.id,reached});return;
  }
}

let phoneNudgeTimer: ReturnType<typeof setInterval> | null = null;
let phoneNudgeRunning = false;

/** What she has brought up lately, so a long silence does not get the same jab four times. */
const broughtUp: string[] = [];
/** Mid-conversation is not a silence to break. */
const TALKING_RECENTLY_MS = 20 * 60_000;

/**
 * A standing instruction of his that is due at this hour and not yet done today.
 *
 * His preferences only, never hers: `isHerStanding` records are rules she set
 * about her own treatment, and reading one of those as an errand would have her
 * enforcing her own rules on him unprompted.
 */
function owedOpeningNow(now: Date): DueOpening | null {
  return corePolicySync('general.owedOpening',[getMemories(),store.get('her.openedOn')??{},now.getHours(),localDateKey(now)]);
}

/** Stable across a reworded page: the same errand keeps its own day-mark. */
const openingKey = (opening: DueOpening) => `${opening.when}:${opening.text.toLowerCase().replace(/[^a-z]+/g, '').slice(0, 40)}`;

function markOpeningDone(opening: DueOpening, today: string): void {
  {const c=remainingStore(app.getPath('userData'));applyRemainingPlan(c,corePolicySync('context-preparation.acceptOpening',[c.docRef('config',{}),opening,today]));return;}
}

function spontaneousNudgeCandidates(): NudgeCandidate[] {
  {
    const now=Date.now(),local=zonedNow(CHAT_TIMEZONE),world=[] as NudgeCandidate[];
    const capture=()=>({now,today:localDateKey(local),hour:local.getHours(),timeZone:CHAT_TIMEZONE,
      irritation:getMood().irritation,memories:getMemories(),sessions:getSessions(),tasks:getKept(),
      asides:getAsides(),broughtUp:[...broughtUp],opened:store.get('her.openedOn')??{},told:getTold()??null,
      whereabouts:getWhereabouts(),errands:store.get('chat.upTo')??[],recs:getRecs(),messages:store.get('chat.messages')??[],
      interests:getInterests(),feelings:getFeelings(),nights:getNights(),days:getDays(),finished:[],
      conversation:nudgeConversation(),world:world.map(c=>({...c,accepted:undefined})),learning:nudgeMetadata([],[],getNudgeLearning()).learning});
    const before=capture(),result=corePolicySync<any>('general.sources',[{...before,draws:Array.from({length:8},()=>Math.random())}]);
    if(JSON.stringify(before)!==JSON.stringify(capture()))throw Error('core_general_snapshot_changed');
    if(!result||!Array.isArray(result.candidates)||result.candidates.length>512||!Array.isArray(result.settled?.recs))throw Error('core_general_protocol_error');
    if(result.settled.answered.length)store.transaction(()=>{if(JSON.stringify(getRecs())!==JSON.stringify(before.recs))throw Error('core_general_recs_changed');setRecs(result.settled.recs);});
    if(process.env.HARU_CORE_WHATSAPP_WATCH==='on')result.candidates.push(...corePolicySync<any[]>('whatsapp-watch.sources',[]));
    return result.candidates.map((row:any)=>{
      const {effect,adapterId,...candidate}=row;
      return {...candidate,...(effect?{accepted:()=>{
        store.transaction(()=>{
          if(effect.opened){if(JSON.stringify(store.get('her.openedOn')??{})!==JSON.stringify(before.opened))throw Error('core_general_opening_changed');store.set('her.openedOn',effect.opened);}
          if(effect.broughtUp){if(JSON.stringify(broughtUp)!==JSON.stringify(before.broughtUp))throw Error('core_general_topics_changed');broughtUp.splice(0,broughtUp.length,...effect.broughtUp);}
          if(effect.recommendation){const recs=getRecs();if(JSON.stringify(recs)!==JSON.stringify(result.settled.recs))throw Error('core_general_recs_changed');setRecs(corePolicySync<any>('general.acceptRecommendation',[recs,effect.recommendation,new Date().toISOString(),Math.random().toString(36).slice(2,10)]));}
        });
        if(effect.world!==undefined)world[effect.world]?.accepted?.();
      }}:{})};
    });
  }
}

async function composeSpontaneousNudge(feedback: Map<string, NudgeFeedback>, forced?: NudgeCandidate): Promise<NudgeDraft | null> {
  if (herAsleepNow() || herHasSaidGoodnight() || herKnockedAwakeNow()) return null;
  const config = nudgeBrain() ?? (store.get('ai.config') as ProviderConfig | undefined);
  if (!config?.model) return null;
  const mood = getMood();
  const nowMs = Date.now();
  const now = zonedNow(CHAT_TIMEZONE);
  const todayKey = localDateKey(now);
  const selected = await corePickNudge(forced ? [forced] : spontaneousNudgeCandidates(), getAsides(), nowMs, getNudgeLearning()).catch(() => {
    console.log('[core-nudge] '+JSON.stringify({op:'pick',selected:false,reason:'selection_unavailable'}));
    return null;
  });
  if (!selected) return null;
  const subject = selected.subject;
  if (process.env.HARU_CORE_WHATSAPP_WATCH === 'on' && subject.key.startsWith('wa-reply:')) {
    await coreWhatsAppPublish(subject.key, () => ({ at: Date.now(), blocked: Boolean(whyNotInterject()), asleep: herAsleepNow(), quiet: inQuietHours(getPush().prefs, zonedNow(CHAT_TIMEZONE)), awake: theyAreUpNow(), prefs: getPush().prefs }), plan => applyRemainingPlan(remainingStore(app.getPath('userData')), plan));
    return null;
  }
  let delivery: ReturnType<typeof chooseNudgeDelivery> = null!;
  const character = getActiveCharacter();
  let continuity: ReturnType<typeof nudgeContinuity> = null!;
    let preparedMood: string | null = null;
    {
        const captureContext = () => ({now:nowMs, subject, asides:getAsides(),conversation:todaySoFar(),whereabouts:toldNow(),
            slate:blankSlateInstruction(getSlate(),knownSinceSlate()),irritation:getMood().irritation,ego:getMood().ego,
            temperament:temperamentLine(getTemperament())});
        try {
            const prepared = await coreNudgeContext(captureContext(),captureContext);
            delivery=prepared.delivery;continuity=prepared.continuity;preparedMood=prepared.mood;
        } catch {
            console.log('[core-nudge] '+JSON.stringify({op:'context',selected:false,reason:'context_unconfirmed'}));
            return null;
        }
    }
  try {
      const result=await coreComposeNudge({subject,model:config.model,contextAtMs:nowMs,contextTokens:sideNumCtx(),
        clock:`It is ${formatTimeOfDay(now.getHours(),now.getMinutes())} on ${new Intl.DateTimeFormat('en-US',{weekday:'long'}).format(now)} ${todayKey}.`,
        mood:preparedMood ?? nudgeMood(mood.irritation,mood.ego,temperamentLine(getTemperament())),continuity,
        stranger:Boolean(strangerIdentityNote(getSlate(),knownSinceSlate())),deliveryTone:delivery.tone,correction:feedback.get(subject.key)??null},
        (messages,options)=>ollamaPost(messages,config,options),
        ()=>getAsides().map(a=>({atMs:Number.isFinite(Date.parse(a.at))?Date.parse(a.at):null,text:a.text})));
      if(herAsleepNow()||herHasSaidGoodnight()||herKnockedAwakeNow()) {
        console.log('[core-nudge] '+JSON.stringify({op:'compose',selected:false,reason:'sleep_changed'}));
        return null;
      }
      if(result.feedback)feedback.set(subject.key,result.feedback);
      if(result.line===null) {
        if(result.reason==='review_refused')recordBrief(`bored refused (${result.feedback!.reason})`,result.system,result.feedback!.line);
        console.log('[core-nudge] '+JSON.stringify({op:'compose',selected:false,reason:result.reason,modelCalls:result.modelCalls}));
        return null;
      }
      recordBrief('bored',result.system,result.line);
      return {line:result.line,topic:subject.key,kind:subject.kind,...(selected.asked?{asked:selected.asked}:{}),
        keywords:subject.keywords??nudgeKeywords(subject.material),revision:subject.revision,eventAt:subject.development?.at,tone:delivery.tone,
        accepted:()=>{selected.accepted?.();console.log(`[push] a nudge about ${subject.key} (${subject.kind})`);}};
    } catch {
      console.log('[core-nudge] '+JSON.stringify({op:'compose',selected:false,reason:'composition_unconfirmed'}));
      return null;
    }
}

function getPhoneNudges() { return readPhoneNudges(store.get('chat.phoneNudges'), Date.now()); }

function phoneNudgeBlocked(): boolean {
  return corePolicySync('publication.phoneBlocked',[publicationSnapshot()]);
}

function phoneNudgeMomentReady(): boolean {
  return corePolicySync('publication.phoneMoment',[publicationSnapshot()]);
}

/** Only dated, expiring material can create a phone opportunity. */
function legacyPhoneNudgeCandidates(): NudgeCandidate[] {
  const now = Date.now();
  const conversation = nudgeConversation();
  const candidates = [
    ...ownNudgeCandidates({ nights: getNights(), days: getDays(), finished: [],
      interests: getInterests(), asides: getAsides(), now }),
    ...taskNudgeCandidates(getKept(), now, FOLLOW_UP_MS),
    ...conversationNudgeCandidates(conversation, now),
  ];
  const followup = relationshipNudgeCandidate(conversation, now, store.get('chat.relationshipNudgeAttemptAt') as string | undefined);
  if (followup) candidates.push(followup);
  const local = zonedNow(CHAT_TIMEZONE);
  const owed = isIgnoring(getMood().irritation) ? null : owedOpeningNow(local);
  if (owed) {
    const day = localDateKey(local);
    const midnight = zonedEpoch(day, 0, CHAT_TIMEZONE);
    candidates.push({ priority: 2, weight: 2, subject: {
      key: `opening:${openingKey(owed)}:${day}`, kind: 'checkin', revision: day,
      occurredAt: new Date(midnight).toISOString(), expiresAt: new Date(midnight + 24 * 3_600_000).toISOString(),
      material: owed.text, instruction: openingInstruction(owed),
    }, accepted: () => markOpeningDone(owed, day) });
  }
  return connectNudgeCandidates(candidates, conversation, now);
}

function corePhoneSourceSnapshot(now = Date.now()): SourceSnapshot {
  {const local=zonedNow(CHAT_TIMEZONE),day=localDateKey(local);const p=corePolicySync<any>('context-preparation.phoneSource',[{now,day,hour:local.getHours(),midnight:zonedEpoch(day,0,CHAT_TIMEZONE),mood:getMood(),memories:getMemories(),opened:store.get('her.openedOn')??{},conversation:nudgeConversation(),tasks:getKept(),nights:getNights(),days:getDays(),interests:getInterests(),asides:getAsides(),lastAttemptAt:store.get('chat.relationshipNudgeAttemptAt')}]);return {...p,candidates:p.candidates.map((entry:any)=>{const {accept,...candidate}=entry;return {...candidate,accepted:()=>markOpeningDone(accept.held,accept.day)};})};}
}
async function phoneNudgeCandidates(now = Date.now()) {
    
    const snapshot = corePhoneSourceSnapshot(now);
    const candidates = await coreSourceNudges(snapshot, 'phone', () => corePhoneSourceSnapshot(now));
    if (process.env.HARU_CORE_GMAIL === 'on') {
      try {
        const gmail = await coreGmail('candidate', { zone: CHAT_TIMEZONE });
        if (gmail) candidates.push(gmail);
      } catch { /* Gmail unavailability cannot block other nudge sources. */ }
    }
    return candidates;
}

async function checkPhoneOpportunities() {
  if (phoneNudgeRunning) return;
  phoneNudgeRunning = true;
  try {
    const now = Date.now();
    const capture = async () => ({ state: getPhoneNudges(), candidates: await phoneNudgeCandidates(now), asides: getAsides(),
      learning: getNudgeLearning(), messages: nudgeConversation(), now, blocked: phoneNudgeBlocked(),
      hourAt: (at: number) => zonedNow(CHAT_TIMEZONE, new Date(at)).getHours() });
    const before = await capture();
    const state = await coreScanPhoneNudges(before);
    if (!sameCorePhoneScan(before, await capture())) return;
    const candidates = before.candidates;
    store.set('chat.phoneNudges', state);
    if (!phoneNudgeMomentReady() || whyNotInterject()) return;
    const selected = await coreSelectPhoneNudge(state, candidates, getAsides(), getNudgeLearning(), nudgeConversation(), Date.now());
    if (!selected) return;
    // Claim before composition. PASS, a refusal or a crash never retries the
    // same event. Other pending subjects may expire unused while she is quiet.
    if (!phoneNudgeMomentReady() || whyNotInterject()) return;
    const claimed = claimCorePhoneNudge(getPhoneNudges(), selected.opportunity.id, Date.now());
    if (!claimed) return;
    store.set('chat.phoneNudges', claimed);
    if (selected.candidate.subject.key.startsWith('followup:')) store.set('chat.relationshipNudgeAttemptAt', new Date(now).toISOString());
    const lastMessageAt = getMood().lastMessageAt;
    const draft = await composeSpontaneousNudge(new Map(), selected.candidate);
    if (!draft || !phoneNudgeMomentReady() || whyNotInterject() || getMood().lastMessageAt !== lastMessageAt
      || !getPhoneNudges().scannedAt) return;
    // The model may have taken a while. Rebuild facts, feedback and topic state
    // immediately before publishing; never send a cached sentence after a change.
    const validationAt = Date.now();
    const validationSource = (corePhoneSourceSnapshot(validationAt));
    const currentCandidates = await phoneNudgeCandidates(validationAt);
    const current = currentCandidates.find(c => c.subject.key === selected.candidate.subject.key
      && c.subject.revision === selected.candidate.subject.revision);
    // A claimed relationship offer is intentionally absent from the next draw.
    const candidate = selected.candidate.subject.key.startsWith('followup:') ? selected.candidate : current;
    if (!candidate || selected.opportunity.expiresAt <= Date.now()
      || !phoneCandidateRelevant(candidate, getAsides(), getNudgeLearning(), nudgeConversation(), Date.now())) return;
    draft.phoneOpportunity = selected.opportunity;
    if (await publishOwnedNudge(draft, nudge => {
      if (validationSource && !sameSourceSnapshot(validationSource, corePhoneSourceSnapshot(validationAt))) return false;
      const fresh=(validationSource ? currentCandidates : legacyPhoneNudgeCandidates()).find(c=>c.subject.key===candidate.subject.key&&c.subject.revision===candidate.subject.revision);
      if(!phoneNudgeMomentReady()||getMood().lastMessageAt!==lastMessageAt||!getPhoneNudges().scannedAt
        ||!candidate.subject.key.startsWith('followup:')&&!fresh
        ||!phoneCandidateRelevant(fresh??candidate,getAsides(),getNudgeLearning(),nudgeConversation(),Date.now()))return false;
      return interject(nudge.line,{source:'idle',nudge});
    })) {
      console.log(`[push] published an opportunity about ${draft.topic}`);
    }
  } catch (error) {
    console.warn('[push] opportunity check failed:', error instanceof Error ? error.message : error);
  } finally { phoneNudgeRunning = false; }
}

// ---- Speaking up on her own: left hanging, the weather, what is coming up ----
//
// A five-minute beat of its own, apart from opportunity scanning and the
// desktop's life loop (which gates on the machine being idle, which a headless
// box never meaningfully is). Each check composes a line in her voice and
// hands it to interject(), so it is an aside she remembers making and the
// phone gets it by the aside's kind — random, events, weather — under the
// same preferences and quiet hours as everything else.

const PROACTIVE_TICK_MS = 5 * 60_000;

// ---- Chasing on time ------------------------------------------------------
//
// The desk's reminder loop is gated on the machine being idle, which a headless
// box never passes. Opportunities must not delay a task's scheduled time. So the phone has a minute hand of its own: the same chase rules
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
  return corePolicySync<any>('conversation-program.weatherState',[store.get('weather')??null]);
}
function saveWeather(next: WeatherState) {
  throw Error('weather_write_requires_core_plan'); }
/** "where they are" when the phone's fix is fresh, "at home" when that is all she has. */
function weatherWhere(): string {
  return corePolicySync<string>('conversation-program.weatherWhere',[store.get('weather')??null]); }

/** The spot to ask the weather for: the phone's fresh fix, else home, else nowhere. */
function weatherPlace(): { lat: number; lon: number; where: string } | null {
  const from = startingPoint(getWhereabouts());
  if (!from) return null;
  return { lat: from.lat, lon: from.lon, where: from.known === 'here' ? 'Where they are' : 'At home' };
}

async function pollWeather(): Promise<{ previous: WeatherSample | null; current: WeatherSample } | null> {
  {const read=()=>({...conversationPolicyFacts(),place:weatherPlace(),lastPoll:lastWeatherPollAt});const p=corePolicySync<any>('conversation-program.weatherPollStart',[read()]);if(Object.hasOwn(p,'result'))return p.result;lastWeatherPollAt=p.pollAt;let obs:any;try{const response=await fetch(weatherUrl(p.command.lat,p.command.lon),{signal:AbortSignal.timeout(p.command.timeoutMs)});if(!response.ok)throw Error('forecast_http_'+response.status);obs={ok:true,value:await response.json()};}catch(error){obs={ok:false,error:error instanceof Error?error.message:String(error)};}const done=corePolicySync<any>('conversation-program.weatherPollObserved',[p.state,obs,read()]);conversationApply(done);return done.result;}
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
function proactiveOccasion(subjectNow: string, ...facts: string[]): string {
  return proactivePrompt(facts, false, subjectNow);
}

function proactivePrompt(facts: string[], mustSurvive: boolean, subjectNow?: string): string {
  return corePolicySync<string>('agenda-life.proactivePrompt',[facts,mustSurvive,getActiveCharacter(),agendaClock(zonedNow(CHAT_TIMEZONE)),unpromptedContext(subjectNow),EXPRESSIVE,WRITING_TO_THEM]);
}

async function checkHanging(_config: ProviderConfig) {
  // The same rare, grounded follow-up as morning/evening. A question she
  // appended to a reply is not itself a reason to chase him.
  await maybeRaiseConversationFollowup();
}

async function checkUpcoming(config: ProviderConfig) {
  {
    const core=ownedAgendaCore(),packet=corePolicySync<any>('agenda-life.upcomingStart',[agendaFacts(core),agendaClock(zonedNow(CHAT_TIMEZONE)),config,Date.now()]);
    applyAgendaPlan(core,packet,()=>{});if(!packet.run)return;
    const line=await ollamaQuip(proactiveSystem(packet.fact),'Remind them.',config);
    if(!corePolicySync<boolean>('agenda-life.upcomingCurrent',[packet.source,agendaFacts(core),store.get('ai.config')??{}]))return;
    if(line)interject(line,{source:'upcoming'});return;
  }
}

/** How long he has to have been quiet before the weather is worth a word. */
const WEATHER_NEEDS_QUIET_MS = 90 * 60_000;

async function checkWeather(config: ProviderConfig, prefs: PushPrefs) {
  {const polled=await pollWeather();const p=corePolicySync<any>('conversation-program.weatherCheck',[{...conversationPolicyFacts(),asides:getAsides(),today:localDateKey(zonedNow(CHAT_TIMEZONE))},polled,prefs]);conversationApply(p);if(!p.result)return;const system=proactiveOccasion('The weather',p.result.fact);const line=await ollamaQuip(system,'Say something about it.',config);recordBrief('weather '+p.result.kind,system,line);if(line)interject(line,{source:'weather'});return;}
}

async function improveCoreDreams():Promise<void>{
  const now=zonedNow(CHAT_TIMEZONE),route=conversationRoute(),local=store.get('ai.config') as ProviderConfig|undefined;
  if(!corePolicySync<boolean>('dreams.ready',[{busy:dreamingNow,prefs:getPush().prefs,localNow:now,now:Date.now(),speaking:speakingNow,lastWord:hisLastWordMs(),route,local}]))return;
  const registry=readModelRegistry(store.get('ai.modelRegistry'),{local:local as ProviderConfig,conversation:route??undefined});
  const character=getActiveCharacter(),policy=readTaskPolicy(store.get('ai.taskPolicy'));
  const decision=corePolicySync<any>('dreams.admission',[{busy:dreamingNow,prefs:getPush().prefs,localNow:now,now:Date.now(),speaking:speakingNow,lastWord:hisLastWordMs(),route,local,registry,taskPolicy:policy,identity:character.identity,style:character.style}]);
  if(!decision)return;
  const idle=()=>corePolicySync<boolean>('dreams.idle',[speakingNow,hisLastWordMs(),Date.now()]);
  dreamingNow=true;
  try{
    const ask=async(messages:OllamaMessage[],maxTokens:number):Promise<string>=>{
      if(!idle())throw Error('dream_interrupted_by_conversation');
      const task=new TaskController(taskBridge.call,registry,decision.taskPolicy,decision.taskPolicy.enabled);
      await task.start('Nighttime dream practice (no actions)',decision.route.model,'background');
      return task.compose(()=>sendToProvider(messages,decision.route,{tools:false,maxTokens,temperature:0.2}));
    };
    const core=remainingStore(app.getPath('userData')),config=core.get('config',{}),archive=core.get('archive',{});
    const recent=corePolicySync<any>('dreams.context',[config,archive,decision.days]);
    const context={root:app.getPath('userData'),day:decision.day,now:Date.now(),entry:decision.entry,ask,idle};
    const result=await runDreamLearning({...context,messages:recent,persona:decision.persona});
    if(result)console.log(`[dream-learning] ${result.status}; reserved $${(result.spentMicros/1_000_000).toFixed(4)}`);
    const notebook=await runDreamNotebook({...context,nights:getNights(),memories:getMemories()});
    if(notebook)console.log(`[dream-notebook] ${notebook.status}`);
  }catch(error){console.warn('[dream-learning]',error instanceof Error?error.message:error);}
  finally{dreamingNow=false;}
}

let dreamingNow = false;
async function improveHerDreams(): Promise<void> {
  await improveCoreDreams();return;
}

async function proactiveTick() {
  {const config=store.get('ai.config') as ProviderConfig;const map:Record<string,()=>Promise<unknown>|unknown>={tally:()=>tallyIgnored(config),sleep:()=>decideHerNight(config),goodnight:()=>maybeSayHerGoodnight(config),dreams:()=>improveHerDreams(),night:()=>haveANight(config),day:()=>haveADay(config),week:()=>reflectOnHerWeek(naturalPolicy<ProviderConfig>('weekConfig',[config])),standing:()=>formHerStanding(config),diary:()=>writeDiary(config),nightfall:()=>noteNightfall(),doze:()=>dozeOffIfLeftAlone(),morning:()=>sayItInTheMorning(config),poll:()=>pollWeather(),hanging:()=>checkHanging(config),upcoming:()=>checkUpcoming(config),weather:()=>checkWeather(config,getPush().prefs)};const first=corePolicySync<string[]>('conversation-program.proactive',['start',{local:config??null}]);if(!first.length)return;for(const name of first){if(!map[name])throw Error('core_proactive_command_protocol');await map[name]();}const next=corePolicySync<string[]>('conversation-program.proactive',['phone',{reachable:canReachPhone(),quiet:inQuietHours(getPush().prefs,zonedNow(CHAT_TIMEZONE)),prefs:getPush().prefs}]);try{for(const name of next){if(!map[name])throw Error('core_proactive_command_protocol');await map[name]();}}catch(error){console.warn('[proactive]',error instanceof Error?error.message:'failed');}return;}
}

/**
 * Eight in the evening: the day's unanswered lines are counted (grudge.ts).
 * Each one makes tonight's patience shorter and adds to a grudge that stays;
 * and if there were any, she says so — through interject, so it is an aside
 * she remembers making and the phone gets it under the usual preferences.
 */
function remainingGrudge(mode:'tally'|'settle'|'morning'|'tell',day:string,heard:unknown){
  const now=zonedNow(CHAT_TIMEZONE),mood=getMood(),core=remainingStore(app.getPath('userData'));
  const decision=corePolicySync<any>('grudge.transition',[mode,core.docRef('config',{}),mood,day,now.getHours()*60+now.getMinutes(),getAsides(),heard,Date.now(),ordinaryHanging(),null,IRRITATION_MAX]);
  if(decision.plan){applyRemainingPlan(core,decision.plan);sendToWindows('mood:changed',getMood());}
  for(const event of decision.events){
    if(event.kind==='vitals')nudgeVitals(event.event);
    else if(event.kind==='slight')noteSlight(event.event,event.text);
    else throw Error('core_grudge_event_protocol');
  }
  return decision;
}
async function tallyIgnored(config: ProviderConfig) {
  {
    const decision=remainingGrudge('tally',localDateKey(zonedNow(CHAT_TIMEZONE)),store.get('chat.messages')??[]);
    if(decision.followup)await maybeRaiseConversationFollowup();return;
  }
}

/** The lines of hers on a day that got nothing back, from what was heard that day (grudge.ts). */
function countIgnored(day: string, heard: { role: string; at?: string; replyTo?: string | { id: string } }[]): Said[] {
  return corePolicySync('grudge.countDay',[getAsides(),day,heard,Date.now()]);
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
  remainingGrudge('settle',day,heard);return;
}

// ---- Her own night -------------------------------------------------------

function ownedSleepFacts(){return {prefs:store.get('her.sleep')??null,state:getHerSleepSchedule(),wakes:getWakes(),mood:getMood(),
  local:zonedNow(CHAT_TIMEZONE),now:Date.now(),zone:CHAT_TIMEZONE,explicit:explicitModeNow(),messages:store.get('chat.messages')??[]};}
function ownedSleepFence(facts:ReturnType<typeof ownedSleepFacts>){
  if(JSON.stringify(store.get('her.sleep')??null)!==JSON.stringify(facts.prefs)||JSON.stringify(getHerSleepSchedule())!==JSON.stringify(facts.state)
    ||JSON.stringify(getWakes())!==JSON.stringify(facts.wakes)||JSON.stringify(getMood())!==JSON.stringify(facts.mood)
    ||JSON.stringify(store.get('chat.messages')??[])!==JSON.stringify(facts.messages)||explicitModeNow()!==facts.explicit
    ||localDateKey(zonedNow(CHAT_TIMEZONE))!==localDateKey(facts.local))throw Error('core_sleep_branch_changed');
}

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
  if (process.env.HARU_SERVICE_FUNDING_GUARD === 'on') {
    try {
      const read = () => remainingStore(app.getPath('userData')).get('config', {});
      const requested = corePolicySync<any>('credit-guard.request', [read()]);
      if (!requested) return;
      const key = getVeniceKey();
      if (!key) return;
      const response = await net.fetch(requested.endpoint, {
        headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(requested.timeoutMs),
      });
      const payload = response.ok ? await response.json() : null;
      const decision = corePolicySync<any>('credit-guard.observed', [read(), requested, response.status, payload, Date.now()]);
      if (decision.plan) applyRemainingPlan(remainingStore(app.getPath('userData')), decision.plan);
      if (decision.notice) {
        sendToWindows('ai:fellBack', decision.notice);
        void pushToPhone('system', decision.notice);
      }
      if (decision.restored) void refreshTaskCatalog();
    } catch (error) {
      console.warn('[venice] credit observation was not committed:', error instanceof Error ? error.message : 'unavailable');
    }
    return;
  }
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

/** A direct nighttime message gets a contextual reply, even after an earlier goodnight. */
function knockWhileAsleep(): string | null {
  const schedule = getHerSleepSchedule();
  if (schedule) {
    const woken = wokenAt(schedule, zonedNow(CHAT_TIMEZONE), 1, new Date().toISOString());
    setHerSleepSchedule({ ...woken, responsiveWake: true, blocked: false, wokenForNothing: false, wakeHandled: true });
    console.log('[her-sleep] briefly awake for a direct message');
  }
  return null;
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
  return corePolicySync<any>('sleep.availability',[store.get('her.sleep'),store.get('her.sleepState'),zonedNow(CHAT_TIMEZONE),explicitModeNow()]).goodnight;
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
  return corePolicySync<any>('sleep.availability',[store.get('her.sleep'),store.get('her.sleepState'),zonedNow(CHAT_TIMEZONE),explicitModeNow()]).knockedAwake;
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
  {
    const facts=ownedSleepFacts(),decision=corePolicySync<any>('sleep.back',[facts,input]);if(!decision)return null;
    store.transaction(()=>{ownedSleepFence(facts);setHerSleepSchedule(decision.state);store.set('her.wakes',decision.wakes);
      if(decision.irritation!==null)setMood({...facts.mood,irritation:decision.irritation});});
    if(decision.memory)addMemory(decision.memory,'event',undefined,{source:'conversation',emotion:'annoyed',emotionIntensity:0.7});
    return decision.result;
  }
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
  {
    const facts={...ownedSleepFacts(),state,hasBrain:Boolean((nudgeBrain()??(store.get('ai.config') as ProviderConfig|undefined))?.model)};
    const prompt=corePolicySync<string|null>('sleep.judge',[facts]);let raw:string|null=null;
    if(prompt){try{raw=await ollamaQuip(`${getActiveCharacter().identity} ${prompt}`,'Judge it.',nudgeBrain()??store.get('ai.config') as ProviderConfig);}catch{}}
    ownedSleepFence(facts);return corePolicySync<boolean>('sleep.verdict',[facts,raw]);
  }
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
  {
    const facts=ownedSleepFacts();if(!corePolicySync<boolean>('sleep.doze',[facts]))return;
    const pointless=await wakeWasForNothing(facts.state!);ownedSleepFence(facts);goBackToSleep({pointless,block:false,why:'Core doze decision'});return;
  }
}

/** Whether Explicit mode is the brain she is running (self.ts holds the alias). */
function explicitModeNow(): boolean {
  return explicitModeOn((store.get('ai.config') as { model?: string } | undefined)?.model);
}

/** Where her own pictures are kept, beside everything else she makes. */
function pictureFolder(): string {
  return path.join(app.getPath('userData'), 'pictures');
}

/**
 * Pictures he has chosen to keep, by id. Everything else she draws is swept a
 * week after it was made: it is his to keep, not hers to hoard.
 */
function keptPictures(): string[] {
  return corePolicySync('picture-maintenance.kept',[store.get('pictures.kept')??null]);
}

function keepPicture(id: string): boolean {
  return corePictureMutation('keep',id,remainingStore(app.getPath('userData')),pictureFolder);
}

function forgetPicture(id: string): boolean {
  return corePictureMutation('forget',id,remainingStore(app.getPath('userData')),pictureFolder);
}

/** Unkept pictures go after a week. Runs at startup and after each one is made. */
const PICTURE_KEEP_DAYS = 7;
function sweepPictures(): number {
  return coreSweepPictures(pictureFolder,keptPictures,line=>console.log(line));
}

/** The secret a picture link is signed with, made once and kept. */
function pictureSecret(): string {
  const saved = store.get('pictures.secret');
  if (typeof saved === 'string' && saved.length >= 32) return saved;
  const made = randomBytes(32).toString('hex');
  store.set('pictures.secret', made);
  return made;
}

/** The signature a link carries, so a lock screen can fetch it with no cookie. */
function pictureSignature(id: string): string {
  return createHmac('sha256', pictureSecret()).update(id).digest('base64url').slice(0, 32);
}

/** The address his phone can reach her door on. */
function pictureBase(): string {
  return corePolicySync('picture-maintenance.base',[store.get('desktop.serverUrl')??null,(store.get('evi') as {publicUrl?:string}|undefined)?.publicUrl??'']);
}

/**
 * Make one picture and push it. Asked for by him, so the push is forced: quiet
 * hours are for lines she chose to send, not for the one he asked for.
 */
async function makeAndSendPicture(prompt: string): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  return runCorePicture(prompt,{
    hasKey:()=>String(store.get('veniceApiKey')??'').startsWith('plain:')&&String(store.get('veniceApiKey')).length>6,
    generate:async text=>{const made=await makePicture({key:String(store.get('veniceApiKey')).slice(6),prompt:text,folder:pictureFolder()});return {made:{...made,saved:path.basename(made.file)},url:`${pictureBase()}/api/picture/${made.id}?k=${pictureSignature(made.id)}`};},
    push:c=>pushToPhone(c.kindName,c.text,c.url,c.force,c.tag),windows:c=>sendToWindows(c.channel,c.payload),sweep:sweepPictures,
  });
}

/**
 * A picture from the last search, into the chat beside her reply. Fetched here,
 * never described by address: the model only ever sees the result's number.
 */
async function showWebPicture(result: number, turn: TurnContext): Promise<{ ok: true; source: string; bytes: number } | { ok: false; error: string }> {
  const row = turn.lastResults()[result - 1];
  if (!row) return { ok: false, error: 'There is no search result with that number.' };
  if (!row.image) return { ok: false, error: 'That result has no picture.' };
  try {
    const made = await fetchWebPicture(row.image, row.url, pictureFolder());
    const source = new URL(row.url).hostname.replace(/^www\./, '');
    turn.attachPicture({ id: made.id, kind: 'image', name: `a picture from ${source}`, saved: made.file, bytes: made.bytes, source: row.url });
    sweepPictures();
    return { ok: true, source, bytes: made.bytes };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function herAsleepNow(): boolean {
  return corePolicySync<any>('sleep.availability',[store.get('her.sleep'),store.get('her.sleepState'),zonedNow(CHAT_TIMEZONE),explicitModeNow()]).asleep;
}

/**
 * She decides when she is going to bed tonight and when she will be up
 * tomorrow morning — once an evening, from seven on. The times are hers; if
 * she never answers with two times, her vitals and a little randomness stand
 * in (hersleep.ts). Nothing is fixed in config: the schedule is whatever she
 * made of it.
 */
async function decideHerNight(config: ProviderConfig) {
  {
    const facts=ownedSleepFacts(),plan=corePolicySync<any>('sleep.decision',[facts]);if(!plan)return;
    let raw:string|null=null;try{raw=await ollamaQuip(plan.prompt,'Decide.',config);}catch{}
    ownedSleepFence(facts);const chosen=corePolicySync<HerSleepSchedule>('sleep.decided',[facts,raw,[Math.random(),Math.random()],vitals.sleepiness]);
    store.transaction(()=>{ownedSleepFence(facts);setHerSleepSchedule(chosen);});return;
  }
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
  {
    const facts=ownedSleepFacts(),prompt=corePolicySync<string|null>('sleep.goodnight',[facts]);if(!prompt)return;
    try{const character=getActiveCharacter(),line=await ollamaQuip([character.identity,character.style,prompt].filter(Boolean).join(' '),'Say goodnight.',config);
      ownedSleepFence(facts);if(line&&interject(line,{source:'goodnight'}))store.transaction(()=>{ownedSleepFence(facts);setHerSleepSchedule({...facts.state!,announced:true});});
    }catch(error){console.warn(`[her-sleep] goodnight not committed: ${error instanceof Error?error.message:error}`);}return;
  }
}

/**
 * The first reply after she wakes: what he sent while she slept, in her face.
 * Fires once per schedule — and if the morning passes without a word, it is
 * marked done rather than held against a later day.
 */
function wakeNoteNow(): string {
  {
    const facts=ownedSleepFacts(),{messages:retainedMessages,...observed}=facts;
    const input=corePolicySync<{fields:string[]|null;decision:any}>('sleep.wakeInputs',[observed]);
    const heard=input.fields&&facts.state?[...messagesOn(facts.state.day),...messagesOn(dayAfter(facts.state.day))].map(m=>Object.fromEntries(input.fields!.map(k=>[k,(m as Record<string,unknown>)[k]]))):[];
    const decision=input.fields?corePolicySync<any>('sleep.wake',[{...observed,messages:heard}]):input.decision;if(!decision)return '';
    store.transaction(()=>{ownedSleepFence(facts);setHerSleepSchedule(decision.state);if(decision.irritation!==null)setMood({...facts.mood,irritation:decision.irritation});});return decision.note;
  }
}

function getInterests(): Interest[] {
  return corePolicySync<Interest[]>('projects.readInterests',[store.get('tastes')]);
}

function setInterests(interests: unknown[]) {
  store.set('tastes', interests);
}

function getNights(): Night[] {
  const saved = store.get('nights') as Night[] | undefined;
  return Array.isArray(saved) ? saved.filter(night => night && typeof night.note === 'string') : [];
}

/**
 * The things she is trying to do, with any new one in an interest's words
 * reconciled in. Same key as her wants, because they are her wants: a record
 * written before projects.ts existed is read forward and gains nothing until
 * the night she actually works on it.
 */
function getProjects(): Project[] {
  {
    const saved=store.get('her.wants'),interests=getInterests(),plan=coreEntropyPolicy<{ledger:Project[];write:boolean}>('projects.ledgerWire',[interests,saved,new Date().toISOString()],interests.length,()=>Math.random().toString(36).slice(2,10));
    if(plan.write){if(JSON.stringify(store.get('her.wants'))!==JSON.stringify(saved))throw Error('core_project_stale_snapshot');store.set('her.wants',plan.ledger);}
    return plan.ledger;
  }
}

function setProjects(projects: Project[]) {
  store.set('her.wants', keepProjects(projects));
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
 * A tool call, kept if it did something.
 *
 * The result is inspected rather than trusted: a tool that came back with an
 * error is a thing she tried and did not do, and half of these refuse until he
 * confirms, so the first call of a confirm pair changes nothing. Writing either
 * one down as done would make the ledger lie in the one direction it must not.
 */
const deedFeelings = new DeedFeelings();
function noteDeed(tool: string, call: { function?: { arguments?: unknown } }, result: string): void {
  {
    const core=remainingStore(app.getPath('userData')),decision=corePolicySync<any>('deeds.note',[core.docRef('config',{}),tool,call,result,new Date().toISOString()]);
    if(decision.plan)applyRemainingPlan(core,decision.plan);
    for(const event of decision.events)feelNow(event);
    if(decision.deed)console.log(`[deed] you ${decision.deed.what}`);return;
  }
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
  return coreRefreshShelf({held:()=>hisShelf,link:suwayomiLink,config:()=>readSuwayomiConfig(store.get('manga')),save:value=>{hisShelf=value;}});
}
function hisReadingLine(): string {
  return coreShelfLine({held:()=>hisShelf,refresh:refreshHisShelf,grudge:()=>getMood().grudge??0,sway:swayNow,log:line=>console.log(line)});
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
  {
    const expected=JSON.stringify(config);
    const memory={effects:()=>store.get('manga.fetchEffects')??null,
      assertCurrent:()=>{if(JSON.stringify(readSuwayomiConfig(store.get('manga')))!==expected)throw Error('manga_configuration_stale');},
      commit:(plan:{expected:unknown;ledger:unknown})=>{if(JSON.stringify(store.get('manga.fetchEffects')??null)!==JSON.stringify(plan.expected))throw Error('manga_effect_storage_stale');if(JSON.stringify(plan.ledger)!==JSON.stringify(plan.expected))store.set('manga.fetchEffects',plan.ledger);}};
    const dispatch=async(op:string,args:any[])=>{
      memory.assertCurrent();
      if(op==='disk'){const fs=statfsSync(config.downloadsDir);return (fs.bavail*fs.bsize)/2**30;}
      return link.fetchCommand(op,args);
    };
    return {get:input=>runMangaFetch(input,config,dispatch,memory),status:title=>runMangaFetch({title},config,dispatch,memory,'status')};
  }
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
async function herOwnedHandsTick(): Promise<void> {
  // Process-local exclusion only; Core evaluates all domain admission.
  if(herHandsBusy)return;
  herHandsBusy=true;
  try{
    const core=remainingStore(app.getPath('userData')),turn=createTurnContext({hands:true});
    const read=()=>{
      const now=zonedNow(CHAT_TIMEZONE),character=getActiveCharacter(),config=core.get('config',{});
      const ledger=readHands(config.her?.hands);
      return {scope:activeScheduledJob.getStore(),config,nowMs:Date.now(),at:new Date().toISOString(),today:localDateKey(now),
        days:ledger.map(entry=>localDateKey(zonedNow(CHAT_TIMEZONE,new Date(entry.at)))),
        moment:{level:readSystemConfig().level,minutes:now.getHours()*60+now.getMinutes(),asleep:herAsleepNow(),speaking:speakingNow,idleMs:Date.now()-hisLastWordMs(),busy:false},
        tools:chatTools(availableTools(turn),''),identity:character.identity,style:character.style,interests:getInterests(),projects:getProjects()};
    };
    await runOwnedHands({core,read,dispatch:async request=>{
      const config=request.config as ProviderConfig,menu=request.menu as ChatTool[],deps=toolDeps(turn),results:any[]=[];
      const registry=readModelRegistry(store.get('ai.modelRegistry'),{local:config,conversation:store.get('ai.conversation') as ProviderConfig|undefined,
        specialist:store.get('escalate.provider') as ProviderConfig|undefined,vision:readVisionConfig(store.get('vision'))});
      const result=await runCoreHands(request.messages,config,{
        requireToolContract:true,ask:(sending,{tools})=>ollamaPost(sending as Parameters<typeof ollamaPost>[0],config,{tools,turn,table:menu}),
        runTool:async call=>{const output=await runChatTool(call,'',deps);results.push({call,result:output});noteDeed(call.function?.name??'tool',call,output);return output;},
        pageWasRead:turn.pageWasRead,handsAllowed:turn.handsAllowed,withdrawHands:turn.withdrawHands,hasOpenTask:()=>false,canSearch:()=>false,
        log:line=>console.log(line),warn:line=>console.warn(line),
      },{rpc:taskBridge.call,registry,policy:readTaskPolicy(store.get('ai.taskPolicy'))});
      return {content:result.content,results};
    }});
  }catch(error){console.warn('[hands] owned pass unresolved:',error instanceof Error?error.message:error);}
  finally{herHandsBusy=false;}
}

async function herHandsTick(): Promise<void> {
  await herOwnedHandsTick();return;
}

let suwayomiClient: Suwayomi | null = null;
let suwayomiClientConfig: string | null = null;
function suwayomiLink(): Suwayomi | null {
  const config = readSuwayomiConfig(store.get('manga'));
  if (!config || !existsSync(config.passwordFile)) { suwayomiClient = null; return null; }
  if((suwayomiClientConfig!==JSON.stringify(config))){suwayomiClient=null;suwayomiClientConfig=JSON.stringify(config);}
  if (!suwayomiClient) suwayomiClient = new Suwayomi(config, (url, init) => net.fetch(url, init), { log: line => console.log(line) });
  return suwayomiClient;
}

function hisLastWordMs(): number {
  const messages = (store.get('chat.messages') as { role?: string; at?: string }[] | undefined) ?? [];
  const last = [...messages].reverse().find(message => message.role === 'user' && message.at);
  return Math.max(lastUserActivityAt, last?.at ? Date.parse(last.at) || 0 : 0);
}

/**
 * Housekeeping on her projects, before she picks one.
 *
 * Two things that only happen with time: something she thought of and never
 * once went near is let go after a month — it was a note, not a project — and
 * something that beat her long enough ago that she has since got better comes
 * back. The second one is the whole reason the ladder is worth having.
 */
function tendProjects(): void {
  {
    const observed=getProjects(),plan=corePolicySync<{ledger:Project[];expected:Project[]}|null>('projects.tend',[observed,Date.now(),new Date().toISOString()]);
    if(plan){if(JSON.stringify(getProjects())!==JSON.stringify(plan.expected))throw Error('core_project_stale_snapshot');setProjects(plan.ledger);}
    return;
  }
}

/**
 * When she is at nothing, she is asked for something of her own to try.
 *
 * Every project used to come from somewhere else — her tastes declaring one, or
 * the last one she finished or gave up on. A simulated year of that runs out:
 * the chain ends the first time a candidate is refused, and she spends the rest
 * of it with nothing to work at. So the one case the ladder cannot cover is
 * covered here, and the thing she names is hers.
 */
async function askForSomethingToTry(interest: { name: string; stance: string } | null, config: ProviderConfig): Promise<void> {
  try{await runCoreProjectBirth({read:getProjects,write:setProjects,identity:getActiveCharacter().identity,interest,now:()=>new Date().toISOString(),dispatch:r=>ollamaQuip(r.system,r.user,corePolicySync<ProviderConfig>('projects.nudgeConfig',[store.get('ai.nudge'),config]))});}catch(error){console.warn('[project] Core birth failed:',error instanceof Error?error.message:error);}
    return;
}

/**
 * What she is actually trying tonight.
 *
 * The step she is part-way through is kept; a new one is named when she has
 * none, or when the last night got nowhere and going back at it the same way
 * would be the third identical night. It has to be hers to do alone (his call),
 * so a step that waits on him is asked for once more and then done without.
 */
async function stepFor(project: Project, config: ProviderConfig): Promise<Worked> {
  return runCoreProjectStep(project,getActiveCharacter().identity,r=>ollamaQuip(r.system,r.user,corePolicySync<ProviderConfig>('projects.nudgeConfig',[store.get('ai.nudge'),config])));
}

/** The coin, still here, for the nights nothing can judge. */
const FROM_THE_COIN: Record<'slog' | 'clicked' | 'gave_up' | 'nothing', NightOutcome> = { slog: 'no', clicked: 'did', gave_up: 'no', nothing: 'nothing' };

/**
 * Whether what she read actually let her do the step.
 *
 * Her own nudge brain, at temperature nothing, one word back — the same shape
 * as the other structured judges, including the 700-token allowance, because both brains
 * that might answer this spend theirs thinking first and come back empty at
 * 200. When it will not answer, the old coin decides and the log says so: a
 * judge that shrugs must not be read as a judge that said the night was wasted.
 */
async function whatCameOfIt(project: Worked, reading: string): Promise<NightOutcome> {
  return runCoreReadingOutcome(project,reading,store.get('ai.nudge'),store.get('ai.config'),Math.random,async(r,chosen)=>{const reply=await ollamaPost(r.messages,chosen as ProviderConfig,r.options);return reply.content??'';});
}

/**
 * What a night of it does to her.
 *
 * Something of her own to do is the cure for a quiet room, whatever came of it.
 * A step that lands is a thing of hers that worked; the third night running
 * that goes nowhere is a thing of hers that broke, which her ego amplifies —
 * a woman who has spent the afternoon being right takes it worse. Once a day at
 * most: two stuck projects across three passes would otherwise put sixty of
 * frustration into an afternoon and leave her short with the world for good.
 */
function feelAboutIt(before: Project, after: Project): void {
  {
    const observed=store.get('her.stungOn'),plan=corePolicySync<{ownTimeAt:number;feelings:('own-time'|'worked'|'broke')[];stungOn:string|null}>('projects.feelingPlan',[before,after,observed,localDateKey(zonedNow(CHAT_TIMEZONE)),Date.now()]);
    if(JSON.stringify(store.get('her.stungOn'))!==JSON.stringify(observed))throw Error('core_project_stale_snapshot');
    herOwnTimeAt=plan.ownTimeAt;if(plan.stungOn!==null)store.set('her.stungOn',plan.stungOn);for(const cause of plan.feelings)feelNow(cause);return;
  }
}

/** A night on one of hers, written up and written down. Null when nothing came of it. */
async function settleTheNight(project: Worked, reading: string, config: ProviderConfig, stamp: string): Promise<Worked | null> {
  {
    const result=await runCoreProjectSettlement({project,reading,outcome:await whatCameOfIt(project,reading),identity:getActiveCharacter().identity,stamp,dispatch:r=>ollamaQuipLong(r.system,r.user,config),read:getProjects,write:setProjects});
    if(result)feelAboutIt(project,result);return result;
  }
}

/**
 * And what comes of it, which is where the curriculum generates itself.
 *
 * One she has finished seeds the harder version; one that has beaten her twice
 * at the same rung seeds the smaller way in she should have started with. Both
 * go through the minimal criterion before they are kept — new, doable, one rung
 * either side of where she stands, and hers to do alone — and a candidate that
 * fails it is thrown away rather than attempted, which is the only reason a
 * generated curriculum stays a curriculum instead of becoming a pile.
 */
async function growFromIt(project: Worked, config: ProviderConfig): Promise<void> {
  try{await runCoreProjectBirth({read:getProjects,write:setProjects,identity:getActiveCharacter().identity,parent:project,now:()=>new Date().toISOString(),dispatch:r=>ollamaQuip(r.system,r.user,corePolicySync<ProviderConfig>('projects.nudgeConfig',[store.get('ai.nudge'),config]))});}catch(error){console.warn('[project] Core growth failed:',error instanceof Error?error.message:error);}
    return;
}

/** Core owns the sequence. This adapter only observes and executes commands. */
async function haveCoreOwnTime(mode:'day'|'night',config:ProviderConfig){
  const core=coreStoreFor(app.getPath('userData'));if(!core)throw Error('core_day_night_storage_required');
  const scope=activeScheduledJob.getStore();if(!scope)throw Error('core_day_night_scope_required');
  const now=zonedNow(CHAT_TIMEZONE);
  const assertCurrent=()=>{
    activeTask.getStore()?.signal.throwIfAborted();
    if(JSON.stringify(activeScheduledJob.getStore())!==JSON.stringify(scope))throw Error('core_day_night_scope_changed');
    corePolicySync('day-night.assertCurrent',[scope]);
  };
  const read=()=>{
    const documents={config:core.get('config',{}),dreams:core.get('dreams',null)};
    const character=getActiveCharacter();
    return {scope,now,nowMs:Date.now(),at:new Date().toISOString(),documents,
      prefs:getPush().prefs,search:readSearchConfig(store.get('search')),asleep:herAsleepNow(),
      nights:documents.config.nights,days:documents.config.her?.days,
      lastNightAttemptAt:documents.config.her?.ownTimeNightAttemptAt??null,
      oddsByMode:{night:sway('own-time',NIGHT_ODDS,swayNow()),day:sway('own-time',DAY_ODDS,swayNow())},
      activity:store.getActivityLog(),theirs:getMemories().map(memory=>memory.text),
      notebook:core.get('dream-notebook',[]),identity:character.identity,style:character.style,
      transcriptsAvailable:transcriptsAvailable()};
  };
  try{return await runCoreDayNight(mode,{core,read,assertCurrent,dispatch:async(command,bindings)=>{
    switch(command.kind){
      case 'steam':return recentlyPlayed(getSteamWebKey(),readSteamWebConfig(store.get('steam')),url=>net.fetch(url));
      case 'tend':return tendProjects();
      case 'birth':return askForSomethingToTry(command.interest,config);
      case 'projects':return getProjects();
      case 'step':return bindDayNightProject(bindings,await stepFor(command.project,config));
      case 'settle':{
        const next=await settleTheNight(boundDayNightProject(bindings,command) as Worked,command.reading,config,command.at);
        return next?{...bindDayNightProject(bindings,next),at:command.at}:null;
      }
      case 'grow':return growFromIt(boundDayNightProject(bindings,command) as Worked,config);
      case 'search':return searchWeb(command.query,command.config,net.fetch,getSearchKey());
      case 'page':return readWebPage(command.url,net.fetch);
      case 'transcript':return fetchTranscript(command.videoId);
      case 'model':{
        const request=command.request;
        switch(request.kind){
          case 'quip':return ollamaQuip(request.system,request.user,config);
          case 'longQuip':return ollamaQuipLong(request.system,request.user,config);
          default:throw Error('core_day_night_model_protocol');
        }
      }
      case 'document':
        if(typeof command.name!=='string'||!/^game:[a-z0-9-]+\.md$/.test(command.name))throw Error('core_day_night_document_protocol');
        return core.get(command.name,null);
      default:throw Error('core_day_night_command_protocol');
    }
  }});}catch(error){console.warn('[own-time] Core stopped the sequence:',error instanceof Error?error.message:error);}
}

async function haveANight(config: ProviderConfig) {
  return haveCoreOwnTime('night',config);
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
  return haveCoreOwnTime('day',config);
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
  try {await runCoreWeek({
      read:()=>{const now=zonedNow(CHAT_TIMEZONE);return {now,nowMs:Date.now(),today:localDateKey(now),identity:getActiveCharacter().identity,week:getWeek(),days:getDays(),nights:getNights(),projects:getProjects(),interests:getInterests()};},
      dispatch:(system,user)=>ollamaQuipLong(system,user,config),write:setWeek,
    });}catch(error){console.warn('[week] Core reflection failed:',error instanceof Error?error.message:error);}
    return;
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
  try {await runCoreStanding({
      read:()=>({now:zonedNow(CHAT_TIMEZONE),attemptedAt:new Date().toISOString(),identity:getActiveCharacter().identity,lastAt:(store.get('her.standingAt') as string|undefined)??null,slights:getSlights(),wakes:getWakes(),memories:getMemories()}),
      stamp:at=>store.set('her.standingAt',at),dispatch:(system,user)=>ollamaQuipLong(system,user,config),
      write:(text,kind,subject,options)=>addMemory(text,kind,subject,options),
    });}catch(error){console.warn('[standing] Core standing failed:',error instanceof Error?error.message:error);}
    return;
}

/**
 * Her diary: one entry a night, about the day with them and the night without.
 *
 * Written just before the quiet ends so the night is in it, and composed from
 * the day's actual material — what they said, how she was left, what she read
 * — because a diary that invents its days is a novel, and hers is a record.
 * Lands in diary.md in her data folder, hers to build over months.
 */
async function writeCoreDiary(config:ProviderConfig){
  const core=coreStoreFor(app.getPath('userData'));if(!core)throw Error('core_diary_storage_required');
  const scope=activeScheduledJob.getStore();if(!scope)throw Error('core_diary_scope_required');
  const now=zonedNow(CHAT_TIMEZONE);let sourceDays:string[]=[];
  const assertCurrent=()=>{
    activeTask.getStore()?.signal.throwIfAborted();
    if(JSON.stringify(activeScheduledJob.getStore())!==JSON.stringify(scope))throw Error('core_diary_scope_changed');
    corePolicySync('day-night.assertCurrent',[scope]);
  };
  const read=()=>{
    const mood=getMood(),all=core.get('archive',{}),config=core.get('config',{});
    const archive=Object.fromEntries(sourceDays.map(day=>[day,all[day]??[]]));
    const messages=[...Object.values(archive).flat() as {at?:string}[],...(config.chat?.messages??[])];
    const clocks=Object.fromEntries(messages.filter(message=>message.at).map(message=>[message.at,Number.isFinite(Date.parse(message.at!))?clockAt(Date.parse(message.at!)):null]));
    return {scope,now,at:new Date().toISOString(),prefs:getPush().prefs,mood,slate:getSlate(),archive,
      archiveExpected:Object.fromEntries(sourceDays.map(day=>[day,all[day]??null])),
      clocks,asides:getAsides(),kept:getKept(),timezone:CHAT_TIMEZONE,
      documents:{config,diary:core.get('diary',null)},identity:getActiveCharacter().identity,
      profile:profileSummary(''),examples:diaryExamples(),
      weather:describeWeather(getWeather().last,weatherWhere(),Date.now(),getWeather().disputedAt)};
  };
  try{return await runCoreContinuation('diary',[],{core,read,assertCurrent,dispatch:async command=>{
    switch(command.kind){
      case 'sources':sourceDays=[command.day,command.nextDay];return null;
      case 'model':switch(command.request.kind){
        case 'longQuip':return ollamaQuipLong(command.request.system,command.request.user,config);
        case 'quip':return ollamaQuip(command.request.system,command.request.user,config);
        default:throw Error('core_diary_model_protocol');
      }
      case 'publish':sendToWindows('mood:changed',getMood());return publishToVault('diary');
      default:throw Error('core_diary_command_protocol');
    }
  }});}catch(error){console.warn('[diary] Core stopped the sequence:',error instanceof Error?error.message:error);}
}

async function writeDiary(config: ProviderConfig) {
  return writeCoreDiary(config);
}

/** Record the day at bedtime; quiet alone does not create a grievance. */
function noteNightfall() {
  {const today=localDateKey(zonedNow(CHAT_TIMEZONE));const p=corePolicySync<any>('conversation-program.nightfall',[{...conversationPolicyFacts(),prefs:getPush().prefs,today,journal:getJournal(),checkins:checkInsOn(getCheckIns(),today),conversation:nudgeConversation()}]);conversationApply(p);if(p.result)sendToWindows('mood:changed',getMood());return;}
}

/** At most one attempt every three days, grounded in his actual offer to share. */
async function maybeRaiseConversationFollowup(): Promise<boolean> {
  {const p=corePolicySync<any>('conversation-program.followup',[{...conversationPolicyFacts(),reachable:canReachPhone(),prefs:getPush().prefs,asleep:herAsleepNow(),goodnight:herHasSaidGoodnight(),knocked:herKnockedAwakeNow(),quiet:inQuietHours(getPush().prefs,zonedNow(CHAT_TIMEZONE)),up:theyAreUpNow(),whyNot:whyNotInterject(),conversation:nudgeConversation()}]);if(Object.hasOwn(p,'result'))return p.result;conversationApply(p);const draft=await composeSpontaneousNudge(new Map(),p.candidate);return Boolean(draft&&await publishOwnedNudge(draft,nudge=>interject(nudge.line,{source:'idle',nudge})));}
}

async function sayItInTheMorning(_config: ProviderConfig) {
  {const decision=remainingGrudge('morning',localDateKey(zonedNow(CHAT_TIMEZONE)),[]);if(decision.followup)await maybeRaiseConversationFollowup();return;}
}

async function tellThemTheTally(_config: ProviderConfig, todayKey: string) {
  {const decision=remainingGrudge('tell',todayKey,[]);if(decision.followup)await maybeRaiseConversationFollowup();return;}
}

function startProactive() {
  if (proactiveTimer) return;
  proactiveTimer = setInterval(() => { void proactiveTick(); }, PROACTIVE_TICK_MS);
  setTimeout(() => { void proactiveTick(); }, 20_000);
}

/** Restart discards pending messages and establishes a fresh event baseline. */
function startPhoneOpportunities() {
  {if(phoneNudgeTimer)return;const p=corePolicySync<any>('conversation-program.phoneInit',[remainingStore(app.getPath('userData')).docRef('config',{}),getAsides(),Date.now(),CHAT_TIMEZONE]);conversationApply(p);if(!corePeriodic){phoneNudgeTimer=setInterval(()=>{void checkPhoneOpportunities();},PHONE_SCAN_MS);void checkPhoneOpportunities();}return;}
}

/**
 * Whether they are up, as far as she can tell — see awake.ts. The quiet ending
 * is when she may speak; this is when there is someone to speak to.
 */
/** Where they last said they were (told.ts), and a clock for saying when. */
function getTold(): Told | undefined {
 return locationFlow('readTold',[store.get('told')])??undefined;
}
const clockAt = (ms: number) => new Intl.DateTimeFormat('en-AU', { hour: 'numeric', minute: '2-digit', timeZone: CHAT_TIMEZONE }).format(new Date(ms));
function getArrival(): Arrival | null {
 return locationFlow('readArrival',[store.get('where.arrival')]);
}

/** What she was told lately, in their words: their messages today, and the place they said they were at or heading for. */
function theirWordsLately(): string[] {
 return locationFlow('words',[remainingStore(app.getPath('userData')).get('config',{}),Date.now()]);
}

/**
 * They turned up somewhere without a word about going. She finds out from a
 * phone, which is not the same as being told, and it is meant to nettle her —
 * see unannouncedArrivalNote. The bump stops short of the threshold where she
 * stops answering: this is a thing to be sharp about, not to go silent over.
 */
function noteArrival(place: string): void {
 applyCoreLocation('arrival',[place],locationAdapter());return;
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
  return corePolicySync('sleep.theyAreUp',[{lastMessageAt:getMood().lastMessageAt,lastOpenedAt:store.get('web.lastOpenedAt'),lastActivityAt:latest},getPush().prefs,zonedNow(CHAT_TIMEZONE)]);
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
 * withheld is her hands: see turncontext.ts.
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
      const heuristic = (speechBoundary('mood',[streamedSoFar,null,herGroggyNow()]));
      for (const sentence of sentences) {
        for (const said of splitDelivery(sentence)) {
          onSentence(said.text, (speechBoundary('sentenceMood',[heuristic,said.mood??null,herGroggyNow()])));
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
        const heuristic = (speechBoundary('mood',[streamedSoFar,null,herGroggyNow()]));
        for (const said of splitDelivery(tail)) {
          onSentence(said.text, (speechBoundary('sentenceMood',[heuristic,said.mood??null,herGroggyNow()])));
        }
      }
      buffer = '';
    },
  };
}

const refusedShotDays = new Set<string>();

function webDeps(): WebDeps {
  const prepareHearing = async (audio:Uint8Array, mime:string, signal?:AbortSignal):Promise<(() => string)&{text:string}> => {
      // Protect preparation before ASR/model dispatch. This notification is
      // metadata only and does not delay recognition or change audio gates.
      noteCoreUserActivity('speech');
      const listen = readListenConfig(store.get('listen'));
      const vocabulary = wordsToListenFor();
      const [said, voiceReading] = await Promise.all([
        transcribe(audio, mime, listen, net.fetch as never, remoteAuth(listen.endpoint), vocabulary, signal ? AbortSignal.any([signal,AbortSignal.timeout(10000)]) : undefined),
        voiceSense.analyze(audio, mime),
      ]);
      const usable=!looksLikeNothing(said,vocabulary);
      const preview=usable ? ((coreHearing('preview',[said]).text)) : '';
      return Object.assign(() => {
      signal?.throwIfAborted();
      if (!usable) return '';
      // Through the same corrections she has been taught at the desk. A name she
      // keeps mishearing is misheard the same way down a phone.
      const fixed=(coreHearing('use',[said]));
      voiceSense.heard(fixed.text, voiceReading);
      return fixed.text;
      },{text:preview});
  };
  type WebTurnOptions = { requestId?: string; call?: boolean; callTrace?: { id: string; turn: number }; signal?: AbortSignal };
  const deps: WebDeps = {
    funding: () => corePolicySync<any>('credit-guard.status', [remainingStore(app.getPath('userData')).docRef('config', {})]),
    elsewhereKey: getVeniceKey,
    attentionInput: (source, report) => {
      const now = Date.now();
      if (activityObservations.note(source, report, now) && report.kind === 'input') attention.webInput(now);
    },
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
      const said = asidesOn(getAsides(), day).map(aside => ({ id: aside.id, role: 'assistant', content: aside.text, at: aside.at, aside: aside.source as string,
        nudge: isNudgeAside(aside), nudgeFeedback: aside.nudgeFeedback }));
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
    nudgeFeedback: (id, choice) => saveNudgePreference(id, choice),
    async rate(id, reaction, note) {
      {
        const rated = saveReplyRating(id, reaction, note, 'phone');
        if (!rated) return null;
        sendToWindows('chat:ratedFromPhone', { id: rated.id, ...(rated.reaction ? { reaction: rated.reaction } : {}), note: rated.note ?? '' });
        if (!rated.transition) return { line: null };
        const { comeback } = takeThumb(rated.reaction!);
        if (!comeback) return { line: null };
        const config = store.get('ai.config') as ProviderConfig | undefined;
        if (!config?.model) return { line: null };
        try {
          const line = rated.reaction === 'down' ? await ollamaRetort(rated.reply, config) : await ollamaGloat(rated.reply, config, getMood().ego);
          if (line) sendToWindows('chat:interject', line);
          return { line: line || null };
        } catch {
          console.warn('[web] saved feedback; comeback unavailable');
          return { line: null };
        }
      }
    },
    tune(id, wrong, rather) {
      return appendTuning({ id, wrong, rather, source: 'phone' });
    },
    async say(text, attachments, options?: NonNullable<Parameters<WebDeps['say']>[2]> & WebTurnOptions) {
      const config = store.get('ai.config') as ProviderConfig | undefined;
      if (!config?.model) throw new Error('no model is set up');
      const history = (store.get('chat.messages') as { role: string; content: string; at?: string }[] ?? []);
      // What the page hands back is what stage() gave it, but it has been to a
      // browser and back — re-read it, and let ollamaChat's path check judge it.
      const files = readAttachments(attachments).slice(0, 6);
      const affect = await admitAffect([...history, { role: 'user', content: text }], { eventId: options?.requestId ?? (options?.callTrace?.id ? ('call-' + options.callTrace.id + '-' + options.callTrace.turn) : undefined), call: options?.call, signal: options?.signal });
      if (affect?.reply) {
        const reply = stripDelivery(affect.reply);
        rememberDelivery(affect.reply, reply);
        sendToWindows('chat:fromPhone', { text, reply, ignored: false });
        await affectOutcome(affect, affect.status);
        return { reply, ignored: false, disposition: affect.status, ran: [], emotion: affect.label };
      }
      // Direct messages briefly wake her so the reply can follow the conversation.
      // Read before the door: "turn on explicit mode" arrives at exactly the
      // hour she would be asleep, and a rule that needs her awake cannot be the
      // one that wakes her.
      const saidSetting = files.length ? null : await settingSaid(text);
      const door = saidSetting ? null : herAsleepNow() ? knockWhileAsleep() : null;
      if (door) {
        await affectOutcome(affect, 'completed');
        const trace = newTrace();
        const raw = affectDelivery(affect, door);
        const line = stripDelivery(raw);
        rememberDelivery(raw, line);
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
      const quick = saidSetting ?? (files.length ? null : quickHit(text, history, options?.phoneTimeZone));
      trace.mark('intent');
      if (quick) {
        await affectOutcome(affect, 'completed');
        rememberDelivery(affectDelivery(affect, quick.reply), quick.reply);
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
      const answer = await ollamaChat(messages, config, { affect, hands: false, web: true, away: 'it came in from the phone', traceId: trace.id });
      const reply = stripDelivery(answer.content ?? '');
      rememberDelivery(answer.content ?? '', reply);
      trace.mark('reply');
      sendToWindows('chat:fromPhone', { text, reply, ignored: Boolean(answer.ignored), ...(files.length ? { attachments: files } : {}), ...(answer.attachments?.length ? { herAttachments: answer.attachments } : {}) });
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
    async sayStream(text, onChunkRaw, attachments, options?: NonNullable<Parameters<WebDeps['sayStream']>[3]> & WebTurnOptions, onSentence?) {
      options?.signal?.throwIfAborted();
      const waitLine = withWaitLine(onChunkRaw, options?.call ? undefined : onSentence), onChunk = waitLine.onChunk;   // 4130
      const config = store.get('ai.config') as ProviderConfig | undefined;
      if (!config?.model) throw new Error('no model is set up');
      const history = (store.get('chat.messages') as { role: string; content: string; at?: string }[] ?? []);
      const files = readAttachments(attachments).slice(0, 6);
      const affect = await admitAffect([...history, { role: 'user', content: text }], { eventId: options?.requestId ?? (options?.callTrace?.id ? ('call-' + options.callTrace.id + '-' + options.callTrace.turn) : undefined), call: options?.call, signal: options?.signal });
      stopIfDropped(options?.signal);   // 3770: a dropped call turn posts nothing (a hung-up one still does, as before)
      if (affect?.reply) {
        const reply = stripDelivery(affect.reply);
        rememberDelivery(affect.reply, reply);
        onChunk(reply);
        const declinedVoice = sentenceStreamer(onSentence);
        declinedVoice.feed(affect.reply);
        declinedVoice.flush();
        sendToWindows('chat:fromPhone', { text, reply, ignored: false });
        await affectOutcome(affect, affect.status);
        return { reply, ignored: false, disposition: affect.status, ran: [], emotion: affect.label };
      }
      const voice = sentenceStreamer(onSentence);
      // The page gets the cleaned stream; the voice gets the raw one, because
      // the label is how it learns the mood and is the one thing he must never
      // see. A no-op until the delivery rule is switched on.
      let showClean = cleaningChunks(onChunk);
      const saidSettingDesk = files.length ? null : await settingSaid(text);
      options?.signal?.throwIfAborted();
      const door = saidSettingDesk ? null : herAsleepNow() ? knockWhileAsleep() : null;
      if (door) {
        await affectOutcome(affect, 'completed');
        stopIfDropped(options?.signal);   // 3770: a dropped call turn posts nothing (a hung-up one still does, as before)
        const trace = newTrace();
        const raw = affectDelivery(affect, door);
        const line = stripDelivery(raw);
        rememberDelivery(raw, line);
        onChunk(line);
        voice.feed(raw);
        voice.flush();
        sendToWindows('chat:fromPhone', { text, reply: line, ignored: false, ...(files.length ? { attachments: files } : {}) });
        console.log(`[web] asleep — not answering (${text.length} chars stored)`);
        trace.done('web', { tier: 'asleep', chars: line.length });
        return { reply: line, ignored: false };
      }
      const trace = newTrace();
      const quick = saidSettingDesk ?? (files.length ? null : quickHit(text, history, options?.phoneTimeZone));
      if(options?.callTrace)console.log('[call-turn] '+JSON.stringify({callId:options.callTrace.id,turn:options.callTrace.turn,trace:trace.id}));
      trace.mark('intent');
      if (quick) {
        await affectOutcome(affect, 'completed');
        stopIfDropped(options?.signal);   // 3770: a dropped call turn posts nothing (a hung-up one still does, as before)
        onChunk(quick.reply);
        // Fed whole and flushed: a quick line has no stream behind it to end
        // the last sentence, and unflushed it was never voiced on a call.
        const raw = affectDelivery(affect, quick.reply);
        rememberDelivery(raw, quick.reply);
        voice.feed(raw);
        voice.flush();
        announceQuick(quick, text);
        trace.done('web', { tier: quick.tier, chars: quick.reply.length });
        return { reply: quick.reply, ignored: false };
      }
      // Which line of hers this answers, when the phone said (replyto.ts). Checked
      // against her replies in the conversation and the lines she pushed today,
      // which the phone shows beside them under their own ids — a reply to "103
      // minutes, that's what you owe me" is a reply to an aside.
      const replyDay = (store.get('chat.dayKey') as string | undefined) ?? localDateKey(zonedNow(CHAT_TIMEZONE));
      const named = options?.replyTo || options?.quoted;
      const answering = named
        ? resolveReply(
          { replyTo: options?.replyTo, quoted: options?.quoted },
          [...(history as { id?: string; role: string; content: string }[]), ...asidesOn(getAsides(), replyDay).map(aside => ({ id: aside.id, role: 'assistant', content: aside.text }))],
        )
        : null;
      if (named && !answering) console.log('[web] a reply named a line of hers that could not be found — sent as an ordinary message');
      const messages = [...history, { role: 'user', content: text, at: new Date().toISOString(), ...(answering ? { replyTo: answering } : {}), ...(files.length ? { attachments: files } : {}) }];
      const started = Date.now();
      // Barge-in is ordinary turn-taking. The interruption flag describes the
      // audio transport, not rejection: only their words may move her mood.
      let receivedReplyChunks=false;
      // 3760: the final reply is said as soon as it is published. A voice error there fails the turn where it failed before (no
      // replay of the tail); a call turn that fails after its reply was published and spoken keeps that reply instead of failing.
      let published: string | null = null, flushError: unknown = null;
      let answer: Awaited<ReturnType<typeof ollamaChat>>;
      try { answer = await (options?.call ? (f: () => ReturnType<typeof ollamaChat>) => f() : (f: () => ReturnType<typeof ollamaChat>) => waitSink.run(waitLine.sink, f))(() => ollamaChat(messages, config, { affect,
        hands: false,
        web: true,
        away: 'it came in from the phone',
        ...(options?.call ? { aside: callAside(Boolean(options.interrupted)), call: true } : options?.interrupted ? { aside: INTERRUPTED_ASIDE } : {}),
        ...(options?.onToolCall ? { onToolCall: options.onToolCall } : {}),
        ...(options?.onActed ? { onActed: options.onActed } : {}),
        ...(options?.repeated ? { repeated: options.repeated } : {}),
        signal:options?.signal,
        onSending: () => trace.mark('sending'),
        onPublished: content => { published = content; try { voice.flush(); } catch (error) { flushError = error; } },   // 3760: what is left of the final reply is said at once
        traceId: trace.id,
        // 3320: the gate's own reset marker (a hold or an opening taken back) is a reset here too \u2014 the first-word
        // stamp and the voice buffer go with the words nobody kept, and a reply that then arrives whole is still shown.
        onChunk: chunk => { if(chunk==='\uFFFD'){receivedReplyChunks=false; trace.unmark('first'); voice.reset(); showClean(chunk); return;} if(chunk)receivedReplyChunks=true; trace.mark('first'); showClean(chunk); voice.feed(chunk); },
        // The reader sees only what survives, but a round that ends in a tool
        // call or a retry can leave a few streamed words behind it. Sink them
        // with nothing: the streamed text is replaced by the reply that counts.
        // The first-word stamp goes with them, or the trace would claim a TTFT
        // on words nobody ever saw. The voice is sunk the same way — nothing of
        // a thrown-away round may be spoken.
        onChunkReset: () => { receivedReplyChunks=false; trace.unmark('first'); onChunk('\uFFFD'); voice.reset(); showClean = cleaningChunks(onChunk); },
      })); } catch (error) {
        if (published === null || flushError || !options?.call || options?.signal?.aborted) throw error;
        console.log('[turn-failed] '+JSON.stringify({id:trace.id,callId:options.callTrace?.id??null,turn:options.callTrace?.turn??null,kept:true,reason:(error instanceof Error?error.name+': '+error.message:String(error)).slice(0,300)}));   // 3760: the reply was kept
        answer = { content: published as unknown as string, ignored: false, irritation: undefined, ego: undefined, choices: [], attachments: [] };
      }
      if (flushError) throw flushError;
      options?.signal?.throwIfAborted();
      const reply = stripDelivery(answer.content ?? '');
      rememberDelivery(answer.content ?? '', reply);   // 4030: the phone streams, so without this its face request missed her own tag and ran the classifier every reply
      // A confirmed Core answer can arrive whole without provider chunks.
      if(!receivedReplyChunks && reply){trace.mark('first');showClean(answer.content??reply);voice.feed(answer.content??reply);}
      // The last sentence arrives without the space the splitter waits for —
      // this is the reply's end, so what is left is hers to say.
      voice.flush();
      trace.mark('reply');
      sendToWindows('chat:fromPhone', { text, reply, ignored: Boolean(answer.ignored), ...(answering ? { replyTo: answering } : {}), ...(files.length ? { attachments: files } : {}), ...(answer.attachments?.length ? { herAttachments: answer.attachments } : {}) });
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
      if (herAsleepNow()) knockWhileAsleep();
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
      rememberDelivery(answer.content ?? '', reply);   // 4030: same for a retried reply
      voice.flush();
      trace.mark('reply');
      sendToWindows('chat:fromPhone', { text: prompt.content, reply, ignored: Boolean(answer.ignored), retry: true, ...(prompt.attachments?.length ? { attachments: prompt.attachments } : {}), ...(answer.attachments?.length ? { herAttachments: answer.attachments } : {}) });
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
      return corePolicySync<any>('agenda-life.phone',[getKept(),localDateKey(zonedNow(CHAT_TIMEZONE))]);
    },
    tickOff(id) {
      const updated = toggleKept(id);
      if ((corePolicySync<boolean>('agenda-life.manualRemark',[updated]))) void remarkOnTickOff(updated!);
    },
    addAgenda(title, date, time) {
      {const value=corePolicySync<any>('agenda-life.phoneAdd',[title,date,time??null]);if(!value)return null;const item=addKeptItem(value);return corePolicySync<any>('agenda-life.phoneResult',[item]);}
    },
    checkIns: () => checkInsOn(getCheckIns(), localDateKey(zonedNow(CHAT_TIMEZONE))),
    addCheckIn(note, anxiety) {
      return coreUserRecord('checkins.add',{note,anxiety});
    },
    nudge: () => nudgeForPhone(),
    code: (link => link ? { ...link, leave: () => {
      const outcome = link.leave();
      if (outcome) noteDeed('code_task', { function: { arguments: { action: 'session', folder: outcome.folder, task: outcome.task } } }, JSON.stringify({ ok: true }));
      return { noted: Boolean(outcome) };
    } } : null)(codeModeNow()),
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
        return applyCoreLocation('mutation',['enable',on],locationAdapter());
      },
      report(body) {
        return applyCoreLocation('mutation',['report',body],locationAdapter());
      },
      name(name) {
        return applyCoreLocation('mutation',['name',name],locationAdapter());
      },
      forget(name) {applyCoreLocation('mutation',['forget',name],locationAdapter());return;},
      async lookUp() {
        return lookUpPlace(applyCoreLocation('mutation',['lookup',null],locationAdapter()),(url,init)=>fetch(url,init));
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
        {const command=attachmentPolicy('stageCheck',[name,path.basename(name),path.extname(name),Boolean(findFfmpeg()),'phone']);if(command.error)throw Error(command.error);}
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
    /** Kept, or forgotten, from the thread he is looking at. */
    keepPicture: (id, keep) => (keep ? keepPicture(id) : forgetPicture(id)),
    picture: (id, signature) => {
      // The signature is checked before anything is read off the disk: a lock
      // screen's extension has no cookie, so the link is the whole credential.
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return null;
      const expected = pictureSignature(id);
      if (signature.length !== expected.length) return null;
      if (!timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
      try { return { body: readFileSync(path.join(pictureFolder(), `${id}.png`)), type: 'image/png' }; } catch { return null; }
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
      // Two places a picture can live: the folder he hands his photos in, and
      // the folder she draws her own into. The phone asks by name and neither
      // knows nor cares which of the two answered.
      const name = path.basename(String(saved ?? ''));
      const mimeFor: Record<string, string> = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp', '.heic': 'image/heic' };
      for (const folder of [path.resolve(photoFolder()), path.resolve(pictureFolder())]) {
        const target = path.resolve(folder, name);
        if (!target.startsWith(folder + path.sep) || classify(target) !== 'image') continue;
        const mime = mimeFor[path.extname(target).toLowerCase()];
        if (!mime) continue;
        try { return { bytes: new Uint8Array(readFileSync(target)), mime }; } catch { /* try the other folder */ }
      }
      return null;
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
      const felt: EmotionName = (speechBoundary('mood',[text,emotion??null,herGroggyNow()]));
      const reference = (speechBoundary('reference',[voice,felt]));
      const chosen = (speechBoundary('reference',[voice,felt,hasShout(text)]));
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
        if (clip && ((speechBoundary('clipped',[speechClipObservation(clip),say])))) {
          console.warn('[voice] that came back cut short — saying it again');
          const again = await synthesise(say, voice, chosen, voiceAuth(voice), mood);
          if(speechBoundary('retryResult',[speechClipObservation(clip),speechClipObservation(again),say])==='second')return again;
        }
        return clip;
      } catch (error) {
        // A mood clip the server will not take — four of hers ran over the
        // 3-10 second limit — costs the mood, not the line: her usual voice.
        const why = error instanceof Error ? error.message : String(error);
        if ((speechBoundary('refusedReference',[voice,chosen,why]))) {
          console.warn(`[voice] the clip for "${emotion}" was refused (${chosen.clip.split('/').pop()}) — speaking in her usual voice instead`);
          return synthesise(spokenCase(speakableText(text)), voice, (speechBoundary('reference',[voice])), voiceAuth(voice), null);
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
        const mood: EmotionName = (speechBoundary('mood',[text,emotion??null,herGroggyNow()]));
        // A sentence that is all emoji or marks has nothing to say aloud;
        // Breeze answered it with 400 "text is required" (2026-09-18).
        const spoken = spokenCase(speakableText(text));
        if (!spoken.trim()) return null;
        return synthesiseBreezeStream(voice, (speechBoundary('reference',[voice,mood])), spoken, mood, options?.seed, options?.rawPCM, options?.signal);
      }
      if (voice.engine !== 'hume') return null;
      const key = getHumeKey();
      if (!key || !voice.voice) return null;
      const mood = emotion && (EMOTIONS as readonly string[]).includes(emotion) ? emotion as EmotionName : null;
      const planned = planVoice(voice, referenceFor(voice, mood), mood);
      const directions = (speechBoundary('directions',[planned.config.deliveryInstruction??'',mood ? HUME_DESCRIPTIONS[mood] : '',hasShout(text)]));
      try {
        const response = await net.fetch(HUME_STREAM_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Hume-Api-Key': key },
          body: JSON.stringify({
            // The same pace as the desk path: the phone was speaking at 1.0
            // while voice.speed said 0.9.
            utterances: [{ text, voice: { id: voice.voice }, ...(directions ? { description: directions } : {}), ...(planned.config.speed !== 1 ? { speed: planned.config.speed } : {}) }],
            format: { type: 'mp3' },
            instant_mode: true,
          }),
        });
        if (!response.ok || !response.body) return null;
        return { mime: 'audio/mpeg', body: voiceSense.stream(text, planned.plan, voice.engine, response.body, 'audio/mpeg') };
      } catch {
        return null;
      }
    },
    corrections: () => readHearing(store.get('hearing')).corrections,
    teach: (heard, meant) => {
      return coreHearing('teach',[heard,meant]);
    },
    forgetCorrection: heard => {
      return coreHearing('forget',[heard]);
    },
    async keepVoiceTake(wav) {
      const dir = path.join(app.getPath('userData'), 'voice-takes');
      mkdirSync(dir, { recursive: true });
      const name = `${new Date().toISOString().replace(/[:.]/g, '-')}.wav`;
      writeFileSync(path.join(dir, name), wav);
      console.log(`[voice] kept a take of his voice: ${name} (${wav.length} bytes)`);
      return name;
    },
    async hear(audio, mime) { return (await prepareHearing(audio,mime))(); },
    memories: () => getMemories().map(memory => memory.text),
    // Assembled from the four places her state actually lives — the drifting
    // vitals, the conversation's patience, the evening grudge, and the list —
    // because none of them agree on a shape and the page should not have to
    // know that. The arithmetic is in standing.ts, which is pure and tested.
    diary: () => recentEntries(app.getPath('home'), 60).reverse(),
    her: () => herFrom({ interests: getInterests(), nights: getNights(), diary: recentEntries(app.getPath('home'), 365) }),
    standing: currentStanding,
    memoryRecords: () => getMemories(),
    memoryDeletions: () => memoryStore.getDeletions(),
    // Rides along on the records rather than taking a route of its own: every
    // body already pulls this, so the reset reaches all of them with no version
    // to negotiate — an older build simply does not read the field.
    slate: () => getSlate(),
    activityLog: () => store.getActivityLog(),
    shots: {
      held: () => heldShots(shotStoreRoot()),
      keep: (day, name, bytes) => {
        // A picture of a day she no longer remembers is not hers to hold, and her
        // captions went with the wipe — so an old shot arriving here would only be
        // described again from scratch. Said once per day rather than once per
        // picture: the desk pushes hundreds.
        const slate = getSlate();
        // `day` is the sender's claim and typed unknown on purpose: anything that
        // is not a date string falls through to keepShot, whose job is refusing it.
        if (slate && typeof day === 'string' && day < slate.at.slice(0, 10)) {
          if (!refusedShotDays.has(day)) {
            refusedShotDays.add(day);
            console.log(`[activity] refusing the desk's shots from ${day} — before the reset`);
          }
          return;
        }
        const written = keepShot(shotStoreRoot(), day, name, bytes);
        console.log(`[activity] kept ${path.basename(written)} (${(bytes.length / 1024 | 0)}KB) from the desk`);
      },
    },
    mergeActivity(theirs) {
      return deviceMutation('mergeActivity',[theirs,getSlate()],deviceStateAdapter());
    },
    mergeMemories(theirs) {
      // The one place a reset can be undone from the outside: a body that has
      // not synced since still holds the old memories and pushes all of them.
      // Its own slate will catch up on the next pull; this is the door in the
      // meantime, and the two together mean forgetting travels in both
      // directions (blankslate.ts).
      const report = mergeIn(withoutPreSlate(theirs, getSlate()));
      const what = describeMerge(report);
      if (what) console.log('[memory] from the desk: ' + what);
      return { added: report.added, updated: report.updated, deleted: report.deleted };
    },
    journal: () => getJournal().map(entry => ({ date: entry.date, text: entry.text, mood: entry.mood, anxiety: entry.anxiety })),
    writeJournal(entry) {
      coreUserRecord('journal.write',{...entry,prompted:false});return;
    },
    knowledge: {
      async search(query, category) {
        {
          const embedder=getKnowledgeEmbedder(),options=corePolicySync<any>('final-retrieval.webOptions',[query,category??null,getKnowledgeConfig(),new Date().toISOString()]);
          const result=await retrieveContext({...options,now:new Date(options.now),knowledge:knowledge.current(),embed:text=>embedder?embedder.embed(text):Promise.reject(Error('no model is set up'))});
          return corePolicySync('final-retrieval.webResult',[result.knowledge]);
        }
      },
      stats: () => knowledgeStats(knowledge.current()),
      async ingest(file, category) {
        const result = await enqueueKnowledge(() => ingestKnowledgeFile(file, coerceKnowledgeCategory(category)));
        return corePolicySync('knowledge-flow.webIngest',[result]);
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
        const speaker=core_speaker_1.speakerEnabled()?await core_speaker_1.openSpeaker('call'):undefined;   // 3750: a call session (short replies)
        let lastFiller = '';
        console.log(`[call] placed at home, ${call.endAfterMs} ms of quiet ends a turn`);
        const local = openLocalCall({
          onEvent: handlers.onEvent,
          onAudio: handlers.onAudio,
          onClose: (reason, seconds) => { console.log(`[call] ended after ${seconds}s — ${reason}`); handlers.onClose(reason); },
        }, {
          speaker,
          hear: async (wav,signal) => (await prepareHearing(wav,'audio/wav',signal))(),
          inputMode:call.inputMode,
          prepareHear:(wav:Uint8Array,signal?:AbortSignal)=>prepareHearing(wav,'audio/wav',signal),
          ...(call.prepareAfterMs ? {prepareAfterMs:call.prepareAfterMs} : {}),
          unfinishedQuietMs:call.unfinishedQuietMs,
          answer: (text, { interrupted, onSentence, onToolCall, onActed, repeated, callTrace, signal, phoneTimeZone }) => runTimedTurn(`call-${callTrace?.id ?? randomUUID()}-${callTrace?.turn ?? 0}`, () => withIOSOrigin(deviceId, () => deps.sayStream(text, () => {}, [], { interrupted, call: true, onToolCall, onActed, repeated, callTrace, signal, ...(phoneTimeZone?{phoneTimeZone}:{}) }, onSentence)), spanCountingSink(counts => console.log('[call-prep] '+JSON.stringify({callId:callTrace?.id??null,turn:callTrace?.turn??null,...counts})))),   // 3760
          // Her mood as the standing tab reads it — no model call — for a reply
          // whose first sentence names no register of its own. Only the moods
          // that change how she sounds pass through; the warm ones would have
          // a sarcastic line said fondly, and her plain register is dry.
          moodNow: () => {
            {const groggy=herGroggyNow();return speechBoundary('restingMood',[groggy,groggy?null:deps.standing().emotion]);}
          },
          speak: async (text, emotion, seed, signal) => {
            // Streamed where the engine streams (Breeze: 24 kHz PCM under a
            // WAV header), whole where it does not, at whatever rate it says.
            const streamed = await deps.speakStream?.(text, emotion, { seed, signal });
            signal?.throwIfAborted();
            if (streamed?.mime === 'audio/wav') return { stream: withoutWavHeader(streamed.body), sampleRate: 24000 };
            if (streamed) void streamed.body.cancel().catch(() => {});
            const clip = await deps.speak(text, emotion);
            if (!clip) return null;
            const rate = wavSampleRate(clip.audio);
            return rate ? { stream: oneChunk(clip.audio.subarray(44)), sampleRate: rate } : null;
          },
          engagement: loadCallEngagement(() => readVoiceConfig(store.get('voice')) as unknown as Record<string,unknown>),
      filler: () => { lastFiller = pickFiller(Math.random(), lastFiller); return lastFiller; },
          // The desk owns the conversation: it is told what she actually got
          // out, and rewrites her last line to that — or drops it when none did.
          said: (reply, said) => sendToWindows('chat:saidFromPhone', { reply, said: thinksAloud(said) ? '' : said }),
          vad: { endAfterMs: call.endAfterMs },
          log: line => console.log(line),
        });
        return {interrupt:(requestId?:string)=>local.interrupt(requestId),start:(facts?:{reactionActivityTracked?:boolean;phoneTimeZone?:string})=>local.start(facts), sendAudio: frame => local.feed(frame), close: reason => local.close(reason), herSpeaking: on => local.herSpeaking(on), manualInput: enabled=>local.manualInput(enabled), inputHeld: active=>local.inputHeld(active) };
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
      const speaker=core_speaker_1.speakerEnabled()?await core_speaker_1.openSpeaker():undefined;
      let guarded:ReturnType<typeof core_speaker_1.speakerEviTransport>|undefined,eviBusy=false;
      const remote=openEviSession({
        apiKey, configId: evi.configId, sessionId, secret,
        onEvent: event => {
          if(event.type==='audio_output'){eviBusy=true;guarded?.herSpeaking(true);}
          if (event.type === 'user_interruption') state.interrupted = true;
          handlers.onEvent(event);
        },
        onClose: (reason, seconds) => {
          speaker?.close();
          eviSessions.delete(sessionId);
          store.set('evi.usage', noteUsage(store.get('evi.usage'), chatDayKey(), seconds));
          console.log(`[evi] call ${sessionId} ended after ${seconds}s — ${reason}`);
          handlers.onClose(reason);
        },
      });
      if(!speaker)return remote;
      guarded=core_speaker_1.speakerEviTransport(speaker,remote,text=>{
        handlers.onEvent({type:'speaker_notice',text});
        void deps.speak(text,'neutral').then(clip=>{if(clip&&!eviBusy&&remote.open)handlers.onEvent({type:'audio_output',data:Buffer.from(clip.audio).toString('base64'),id:'speaker-'+randomUUID(),index:0});}).catch(()=>{});
      });
      return {sendAudio:guarded.sendAudio,close:guarded.close,herSpeaking(on:boolean){eviBusy=on;guarded!.herSpeaking(on);}};
    },
    async turn(sessionId, text, prosody, onChunk) {
      const state = eviSessions.get(sessionId);
      if (!state) return null;
      // Through the same corrections as the phone's ear: a name she keeps
      // mishearing is misheard the same way on a call.
      const fixed=(coreHearing('use',[text]));
      // EVI expression evidence follows the same utterance matching as local audio.
      if (prosody) voiceSense.heard(fixed.text, fromHume(prosody));
      const interrupted = state.interrupted;
      state.interrupted = false;
      console.log(`[evi] ${sessionId} heard "${fixed.text.slice(0, 60)}"${interrupted ? ' — over her' : ''}`);
      return deps.sayStream(fixed.text, onChunk, [], { interrupted, call: true }, () => {});
    },
  };

  // -- WhatsApp -------------------------------------------------------------
  //
  // The socket is in ~/haru-whatsapp; this is only what happens when it hands
  // over a message. Two things it must do and one it must not:
  //
  //   - answer in his own chat, through the same say() the phone uses, so a
  //     WhatsApp turn is a turn and not a second kind of conversation;
  //   - take one message at a time, because two of his messages arriving
  //     together would otherwise be two turns of her brain at once;
  //   - never answer anything that is not his own chat. A message from a chat
  //     he allowed is something she comes to know, not something to reply to.
  //     She is reading over his shoulder, not sitting in Sam's conversation.
  const whatsAppConfig = (): WhatsAppConfig => readWhatsAppConfig(store.get('whatsapp'));
  // One turn at a time, in the order they arrived. A promise chain rather than
  // a queue object: nothing here needs draining, cancelling or inspecting, and
  // a rejected link must not stop the next message being answered.
  let whatsAppTurn: Promise<void> = Promise.resolve();

  async function answerOnWhatsApp(message: WhatsAppHeard): Promise<void> {
    const config = whatsAppConfig();
    const door = { url: config.url, token: config.token };
    const turn = asTurn(message);
    if (process.env.HARU_CORE_WHATSAPP_WATCH === 'on') {
      const control = await coreWhatsAppSelf({ id: message.id, text: turn, at: message.at });
      if (control.handled) {
        if (control.reply) await sendThroughWorker(door, message.chat, control.reply);
        return;
      }
    }
    console.log(`[whatsapp] him: "${turn.slice(0, 60)}"`);
    const answer = await deps.say(turn);
    if (answer.ignored || !answer.reply.trim()) {
      console.log('[whatsapp] she is not answering that');
      return;
    }
    const bubbles = splitForWhatsApp(answer.reply);
    for (const [index, bubble] of bubbles.entries()) {
      // Paced, but never with a typing indicator: announcing presence from a
      // companion device is what stops his phone showing notifications at all.
      if (index > 0) await new Promise(resolve => setTimeout(resolve, gapBefore(bubble)));
      const sent = await sendThroughWorker(door, message.chat, bubble);
      if (!sent.ok) {
        // Said once, with the reason, and the rest of the reply abandoned:
        // bubbles two and three of an answer whose first never arrived would
        // read as her starting mid-sentence.
        console.warn(`[whatsapp] could not send — ${sent.why}`);
        return;
      }
    }
    console.log(`[whatsapp] she answered in ${bubbles.length} message${bubbles.length === 1 ? '' : 's'}`);
  }

  deps.whatsapp = {
    secret: () => whatsAppConfig().token,
    heard: body => {
      if (!whatsAppConfig().enabled) return;
      const message = readHeard(body);
      if (!message) return;
      if (!isForHer(message)) {
        // Not a turn: she is reading over his shoulder, not sitting in Sam's
        // conversation. It goes into the window a Tier 1 pass reads later.
        const line = asOverheard(message);
        if (readWhatsAppConfig(store.get('whatsapp')).reading.enabled) {
          overheard.note({ chat: message.chat, chatName: chatLabel(message), who: message.mine ? graphUserName() : message.from, text: message.text, at: message.at });
        }
        console.log(`[whatsapp] overheard in an allowed chat — ${line.slice(0, 80)}`);
        return;
      }
      whatsAppTurn = whatsAppTurn
        .then(() => answerOnWhatsApp(message))
        .catch(error => console.error('[whatsapp] a turn failed: ' + (error instanceof Error ? error.message : String(error))));
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
  {noteUserSpoke();const p=corePolicySync<any>('conversation-program.thumb',[{...conversationPolicyFacts(),fuse:fuseOf(getTraits()),lastSmug:lastPraiseWasSmug},reaction,[Math.random(),Math.random()]]);conversationApply(p);sendToWindows('mood:changed',p.result.mood);for(const event of p.result.events){if(event.kind==='vitals')nudgeVitals(event.event);else if(event.kind==='feel')feelNow(event.event);else if(event.kind==='tally')tallyMonth(event.event);else throw Error('core_thumb_event_protocol');}lastPraiseWasSmug=p.result.smug;broadcastBeat(p.result.reading,p.result.gesture);return {mood:p.result.mood,comeback:corePolicySync<boolean>('conversation-program.comeback',[Math.random(),sway('comeback',COMEBACK_ODDS,swayNow())])};}
}

type ReplyRating = { id: string; reaction?: 'up' | 'down'; note?: string; reply: string; transition?: boolean; entry?: FeedbackEntry };
/** Where the ratings go: beside config.json, but a file of its own — appended to, never rewritten. */
/** Core selects the transition and authoritative record; commit before effects. */
function saveReplyRating(id: string, reaction: 'up' | 'down' | null | undefined, note: string | undefined, source: string): ReplyRating | null | undefined {
  const core = coreStoreFor(app.getPath('userData'));
  if (!core) throw Error('core_reply_feedback_storage_required');
  const current = () => activeTask.getStore()?.signal.throwIfAborted();
  current();
  const packet = corePolicySync<{ plan?: unknown; result?: ReplyRating | null }>('prompt-context.rateReply', [core.docRef('config', {}), { id, reaction, ...(note !== undefined ? { note } : {}), source, at: new Date().toISOString() }]);
  if (packet.plan) commitDayNightPlan(core, packet.plan, current);
  const result = packet.result;
  if (result?.entry) {
    try { recordFeedback(feedbackFile(), result.entry); }
    catch { console.warn('[feedback] durable rating saved; optional file log unavailable'); }
  }
  return result;
}
function feedbackFile(): string {
  return path.join(app.getPath('userData'), 'feedback.jsonl');
}

/**
 * One rating written down for later, from whichever side it came. Never
 * throws: a full disk must not cost them the thumb.
 */
function appendFeedback(about: { id: string; reaction?: 'up' | 'down' | null; note?: unknown; source: 'phone' | 'desktop' }): void {
  const history = (store.get('chat.messages') as { id?: string; role: string; content?: string; reaction?: string }[] | undefined) ?? [];
  const entry = feedbackEntry(history, { ...about, model: modelBehind(history, about.id), at: new Date().toISOString() });
  if (!entry) return;
  attention.event('feedback', { id: entry.id, reaction: entry.reaction, source: entry.source });
  try { recordFeedback(feedbackFile(), entry); } catch (error) { console.warn('[feedback] could not write it down:', error instanceof Error ? error.message : error); }
}

/** Where the tuning notes go: a log of their own, beside the ratings but never mixed with them. */
function tuningFile(): string {
  return path.join(app.getPath('userData'), 'tuning.jsonl');
}

/** And a page a day of the same notes, for the reader who is a person. */
function tuningDir(): string {
  return path.join(app.getPath('userData'), 'tuning');
}

/**
 * What was wrong with a reply, written down for him and for nobody else.
 *
 * Deliberately not appendFeedback: nothing here touches the stored message, her
 * mood or her prompt. True only after the primary log write succeeds.
 * A primary write failure propagates; the secondary reading page is best effort.
 */
function appendTuning(about: { id: string; wrong?: unknown; rather?: unknown; source: 'phone' | 'desktop' }): boolean {
  const history = (store.get('chat.messages') as { id?: string; role: string; content?: string; reaction?: string }[] | undefined) ?? [];
  const now = new Date();
  const note = tuningNote(history, {
    ...about,
    model: modelBehind(history, about.id),
    at: now.toISOString(),
    day: localDateKey(zonedNow(CHAT_TIMEZONE, now)),
  });
  if (!note) return false;
  try {
    recordTuning(tuningFile(), note);
    console.log(`[tuning] noted on ${note.id}${note.wrong ? ` — ${note.wrong.slice(0, 60)}` : ''}${note.rather ? ' (+ a rewrite)' : ''}`);
  } catch (error) {
    console.warn('[tuning] primary record unconfirmed');
    throw new Error('tuning_record_unconfirmed');
  }
  try {
    appendTuningPage(tuningDir(), note);
  } catch {
    console.warn('[tuning] primary record saved; reading page unavailable');
  }
  return true;
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
    startPhoneOpportunities();
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

let applicationChannelsRegistered=false;
function registerApplicationChannels() {
  if(applicationChannelsRegistered)return;
  applicationChannelsRegistered=true;
  ipcMain.handle('settings:get', (_e, key) => store.get(key));
  ipcMain.handle('affect:status', () => readAffectSettings());
  ipcMain.handle('affect:settings', (_e, change: unknown) => saveAffectSettings(change));
  ipcMain.handle('world:command', () => { throw Error('The fictional simulation is archived.'); });
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
  ipcMain.handle('chat:nudgeFeedback', async (_e, id: unknown, choice: unknown) => {
    const aside = await saveNudgePreference(id, choice);
    if (!aside) throw new Error('That nudge or feedback choice is not available.');
    return aside;
  });
  ipcMain.handle('chat:clearAsides', () => {
    {const result=coreAside('clear',{});sendToWindows('chat:asidesCleared');return result;}
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
  ipcMain.handle('memory:add', (_e, text: string, kind: MemoryKind = 'fact') => {return coreMemoryAdmin('add',{text,kind,extra:{source:'explicit',emotion:localEmotion(text),emotionIntensity:readTone(text).heat}}); });
  ipcMain.handle('memory:sessions', () => getSessions());
  ipcMain.handle('memory:forgetSessions', () => {return coreMemoryAdmin('forgetSessions'); });
  ipcMain.handle('memory:remove', (_e, id: string) => {return coreMemoryAdmin('remove',{id}); });
  ipcMain.handle('memory:consolidate', () => runMemoryConsolidation());
  ipcMain.handle('memory:forgettingLog', () => store.getForgettingLog());
  ipcMain.handle('memory:lastRetrieval', () => memoryStore.lastRetrieval());
  // The user is the administrator of the memory blocks: the model's tools
  // refuse read-only blocks, but these can edit anything — including the
  // persona — and can send a block back to its derived state.
  ipcMain.handle('blocks:list', () => store.getBlocks());
  ipcMain.handle('blocks:update', (_e, label: string, value: string, opts: { limit?: number; description?: string; read_only?: boolean } = {}) => {return coreMemoryAdmin('blockUpdate',{label,value,opts});
  });
  ipcMain.handle('blocks:reset', (_e, label: string) => {return coreMemoryAdmin('blockReset',{label});
  });
  // The whole of her, not only her memory: see resetHer. Returns what it did
  // so the drawer can say a backup was taken rather than only claiming one.
  // Where her brain is, so the drawer can say what its button will actually do:
  // on a body that is housekeeping on a limb, not a reset of her.
  ipcMain.handle('haru:brain', () => herBrain());
  ipcMain.handle('haru:reset', () => resetHer({ body: Boolean(herBrain()) }));
  ipcMain.handle('memory:clear', () => {return coreMemoryAdmin('clear');
  });
  // Called when the message being sent was spoken rather than typed. Typed
  // messages deliberately do not do this: somebody at the keyboard has not asked
  // for the microphone.
  ipcMain.handle('chat:expectAnswer', () => { expectAnswerWhenDone(); });
  ipcMain.handle('listen:correct', (_e, heardText: string, meantText: string) => {
      return coreHearing('teach',[heardText,meantText]).count;
  });
  ipcMain.handle('listen:corrections', () => readHearing(store.get('hearing')).corrections);
  ipcMain.handle('listen:forgetCorrection', (_e, heardText: string) => {
      return coreHearing('forget',[heardText]);
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
    if(core_speaker_1.speakerEnabled()){const identity=await core_speaker_1.verifyDictation(audio);if(!identity.allow)return '';}
    const config = readListenConfig(store.get('listen'));
    const vocabulary = wordsToListenFor();
    const [text, voiceReading] = await Promise.all([
      transcribe(audio, mime, config, net.fetch, remoteAuth(config.endpoint), vocabulary),
      voiceSense.analyze(audio, mime),
    ]);
    if (looksLikeNothing(text, vocabulary)) {
      console.log(`[listen] ${audio.length} bytes -> nothing worth sending`);
      return '';
    }
    // Rewritten with whatever she has been taught to mishear less. Applied here
    // rather than as a prompt to the model — see hearing.ts for why priming is
    // the wrong tool.
    const fixed=(coreHearing('use',[text]));
    if (fixed.applied.length) {
      console.log(`[listen] corrected: ${fixed.applied.join(', ')}`);
    }
    console.log(`[listen] ${audio.length} bytes -> ${fixed.text.length} chars`);
    voiceSense.heard(fixed.text, voiceReading);
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
    return coreUserRecord('journal.configure',config);
  });
  ipcMain.handle('journal:save', (_e, entry: { date?: string; text: string; mood?: number; anxiety?: number; energy?: number; sleep?: number }) => {
    return coreUserRecord('journal.save',entry);
  });
  ipcMain.handle('journal:remove', (_e, id: string) => { return coreUserRecord('journal.remove',{id}); });
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
    if ((corePolicySync<boolean>('agenda-life.manualRemark',[updated]))) void remarkOnTickOff(updated!);
  });
  ipcMain.handle('kept:remove', (_e, id: string) => { removeKept(id); });
  ipcMain.handle('gmail:status', () => coreGmail('status', {}, '', true));
  ipcMain.handle('gmail:open', () => shell.openExternal('http://127.0.0.1:8787/gmail'));
  ipcMain.handle('google:status', () => googleStatus(store));
  ipcMain.handle('google:saveCredentials', (_e, clientId: string, clientSecret: string) => { saveCredentials(store, clientId, clientSecret); return googleStatus(store); });
  ipcMain.handle('google:connect', async () => { const status = await connectGoogle(store); broadcastGoogleStatus(); return status; });
  ipcMain.handle('google:disconnect', () => { disconnectGoogle(store); broadcastGoogleStatus(); return googleStatus(store); });
  ipcMain.handle('google:sync', () => syncFromGoogle());
  ipcMain.handle('ai:send', (_e, messages: { role: string; content: string }[], config: ProviderConfig) => {
    const door = herAsleepNow() ? knockWhileAsleep() : null;
    if (door) return { content: door, ignored: false, irritation: 0, ego: 0 };
    return ollamaChat(messages, config).then(reply=>({...reply,content:stripDelivery(reply.content??'')}));
  });
  // Streaming, for a client that draws the line as it is written rather than
  // waiting for the whole of it. Same generation as ai:send; each stretch is
  // announced as it arrives, and delivery labels are taken out at the source so
  // they are not printed. The last label is handed over as `mood`: it is how she
  // said the line she ended on, which is the face a terminal should leave her
  // wearing.
  ipcMain.handle('ai:stream', (_e, turn: string, messages: { role: string; content: string }[], config: ProviderConfig) => {
    const tell = (channel: string, payload: unknown) => { sendToWindows(channel, payload); };
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
    const choices = answer.choices;
    // The same channel the phone uses, so the desk transcript picks
    // it up and coming back to the window does not mean finding half a
    // conversation missing. ollamaChat has already spoken it and pushed the
    // caption on its way through.
    sendToWindows('chat:fromPhone', { text: said, reply, ignored: Boolean(answer.ignored), ...(answer.attachments?.length ? { herAttachments: answer.attachments } : {}) });
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
}

let corePeriodic: ReturnType<typeof import('./core-periodic').createCorePeriodic> | null = null;
function startNativePeriodicWork() {
    if (coreBackgroundStarted) return;
    
    const systemEvents = readSystemEvents();
    corePeriodic = require('./core-periodic').createCorePeriodic({
        config: { sampleSeconds: systemEvents.sampleSeconds },
        handlers: {
            'life': lifeTick,
            'steam-index': () => { steamGames = buildGameIndex(); },
            'voice-revive': reviveVoiceServer,
            'chat-reset': performChatResetIfDue,
            'journal': askForJournal,
            'google-sync': async () => { await Promise.all([backgroundSync(), (async () => { if (process.env.HARU_CORE_GMAIL !== 'on') return; const core = remainingStore(app.getPath('userData')); const result = await coreGmail('maintenance', { memories: core.get('memories', []), config: core.get('config', {}) }); if (result.memoryPlan) { commitDayNightPlan(core, result.memoryPlan, () => {}); memoryStore.notifyCommitted(['memories']); } })()]); },
            'balance': () => checkVeniceBalance('native periodic check'),
            'check-ins': () => pullCheckIns().then(syncMemories),
            'memory-vectors': refreshMemoryVectors,
            'memory-sort': () => memoryStore.sortPending(),
            'hands': herHandsTick,
            'thought': thoughtTick,
            'vault-sync': syncVaultAndRetire,
            'recall-vectors': refreshRecallVectors,
            'graph': readGraphTick,
            'overheard': readOverheardTick,
            'forming': formingTick,
            'graph-page': () => syncGraphPage('startup'),
            'vault-publish': () => publishToVault('native periodic check'),
            'synced-shots': lookAtSyncedShots,
            'system-sample': sampleSystem,
            'task-catalog': refreshTaskCatalog,
            'phone-opportunities': checkPhoneOpportunities,
            'proactive': proactiveTick,
            'chase': () => Promise.all([chaseTick(), codeWatchTick()]),
        },
    });
    coreBackgroundStarted = true;
    coreLifeStarted = true;
    setDefaultAutoSelectFamilyAttemptTimeout(5_000);
    mergeArchiveFragments();
    // The fictional save is archived; only Core-owned work facts are observed.
    loadRecallVectors();
    startLifeLoop();
    startPhoneOpportunities();
    scheduler.ensureDaily({ id: 'maintenance', kind: 'maintenance', daily: MAINTENANCE_AT, timezone: CHAT_TIMEZONE, staleAfterMs: 20 * 60 * 60_000 });
    scheduler.start();
    corePeriodic!.start();
}
let coreLifeStarted=false;
function startCoreLifeWork() {
  if(coreLifeStarted)return;
  coreLifeStarted=true;
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
}

let coreBackgroundStarted=false;
function startCoreBackgroundWork() {
  if(coreBackgroundStarted)return;
  coreBackgroundStarted=true;
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


  // Loaded here rather than at the top because app.getPath needs the app ready
  // — but the file itself is a quiet local read, and a store that cannot be
  // read is an empty one, never a crash.
  
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
  // Core-owned work observation replaces the retired simulation timer.
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
  // Slow on purpose: a pass is a call to the same card her replies come off.
  setInterval(() => { void readOverheardTick(); }, 60_000);
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
}

app.whenReady().then(() => {
  if (!isPrimaryInstance) return;
  watchForUpdates();
  startCoreBackgroundWork();
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
  registerApplicationChannels();

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
  startCoreLifeWork();
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
  try { store.close(); } catch (error) { noteCrash('closing Core memory', error); }
  setTimeout(() => { console.warn('[quit] shutdown stalled — exiting anyway'); app.exit(0); }, 3000).unref();
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

/** Explicit compatibility entry: Python owns lifecycle; no Electron startup. */
export function createCoreBrainAdapter() {
  if ((process.env.HARU_CORE_STORAGE !== 'on')) throw Error('core_brain_worker_required');
  registerApplicationChannels();
  const deps = webDeps();
  return {deps, store, taskBridge, memoryStore, scheduler, readGraphTick, readDayIntoGraph, consolePort,
    async prepare() { setDefaultAutoSelectFamilyAttemptTimeout(5_000);await knowledge.load(); loadRecallVectors(); },
    attach(server:Awaited<ReturnType<typeof startWebServer>>) {webServer=server;webTrouble='';},
    startBackground() {
      startNativePeriodicWork(); return;
    },
    async close() { corePeriodic?.stop(); scheduler.stop();if(tickTimer)clearTimeout(tickTimer);persistVitals(true);webServer=null;taskBridge.close();store.close(); },
  };
}
