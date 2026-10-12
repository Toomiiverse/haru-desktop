# Conversation quality and call timing — 2026-09-29

Follow-up: [Deployed limitations fixes and updated routes, 09:32 UTC](conversation-limitations-followup.md). The measurements below describe the earlier deployment.

Deployed greeting/voice-evidence corrections, honest call-stage timing and ASR startup warm-up. The last conversation patch was activated at 2026-09-29T08:29:47Z. Live settings and the four relevant services were verified after the final audio replay. The RTX 3070 remains GPU 0; no device assignment, main conversation model, call-end threshold or spending allowance was changed by this work.

## Active routes

| Request | Route |
|---|---|
| Eligible short chat and hands-free social turns | Direct DeepSeek Flash |
| Fuller ordinary chat | Direct MiMo v2.6 Pro |
| Substantive, memory-dependent or local-only calls | Existing local Qwen path |
| Coding/writing specialist | Claude Sonnet 5.5 through Venice, explicitly retained at the user's request |
| Complex work | Direct Kimi K3 |
| Premium work | Direct Astra |

Recognition and Breeze synthesis stay local. Fast cloud conversation is enabled for chat and calls. Task limits remain $0.50/task and $5/day, with one quality escalation per task. Independent provider/accounting changes made during this work were preserved, merged into the test stage and checked before the final small deployment. This is route verification, not a fresh paid run of every specialist.

## Changes and findings

- A plain greeting no longer accepts the known impatient demands, verbatim recent replies, invented absences/returns, greeting counts or observed unsupported wake-time claims. The model still writes the reply; there is no canned greeting replacement.
- Added targeted checks for the observed unasked advice and challenges to thanks. The persona itself remains intact. Five consecutive greeting probes produced five distinct published replies; one needed a private repair.
- Fixed a prompt mix-up: questions about the user's voice were receiving an instruction intended for feedback about Haru's voice. Missing-audio answers now have to acknowledge missing audio. Available emotion estimates are described as uncertain, and the user's account takes precedence.
- Synthetic audio exposed unsolicited emotional judgments during greetings. Greeting prompts now retain microphone availability but omit raw emotion-classifier scores. The local speech system still has the original evidence for delivery adjustments; explicit questions about the user's voice retain that evidence. Additional output checks cover the observed unasked judgments.
- Replaced misleading call logging: the old “first voice” timestamp was text entering the speech queue. New `[call-latency]` records separate detected speech end, recognition/voice analysis, unfinished-phrase holding, reply preparation, speech queueing and the first actual PCM bytes. Fillers do not count as an answer. Missing/failed speech stays null. Records explicitly say `playbackMeasured: false` and contain timings rather than transcript text.
- The first synthetic transcription took 6.528 seconds because the ASR model was loaded lazily. Startup now loads and warms both VAD and the lazy decoder using generated silence before readiness. The first spoken request after restarting took 0.285 seconds. Startup readiness itself took 5.24 seconds; the work moved to startup rather than disappearing. The configured large-v3-turbo CUDA model and GPU placement were retained.

## Measurements

| Probe | Median | Observed range |
|---|---:|---:|
| Live application call: received speech-end estimate to first outgoing PCM, 2 turns | 3.53 s | 3.39–3.66 s |
| Live application call: committed transcript to first PCM, 2 turns | 2.35 s | 2.16–2.54 s |
| Broad dialogue sweep: validated text, 22 cases | 1.04 s | 0.70–1.86 s |
| Unique-prefix requests, 3-case subset of the sweep | 1.11 s | 0.90–1.86 s |
| Final targeted dialogue regressions, 3 cases | 1.07 s | 1.04–2.66 s |
| Final audio replay: received speech-end estimate to first server PCM, 3 cases | 2.06 s | 1.95–2.46 s |
| Final audio replay: committed transcript to first PCM | 1.19 s | 1.16–1.63 s |
| Final audio replay: ASR alone | 0.27 s | 0.23–0.31 s |
| Final audio replay: speech synthesis to first PCM | 0.24 s | 0.24–0.24 s |

Two live call turns in the application log took **3.662 and 3.390 seconds** from the receiver's estimated speech end to first outgoing audio. Unlike the isolated replay, these include the full application's reply preparation. Both had 600 ms of end-of-speech detection; recognition/voice analysis took 298 and 252 ms, reply preparation through queueing took 1.917 and 2.138 seconds, and synthesis to first PCM took 246 and 398 ms. The first turn also waited 598 ms for a potentially unfinished phrase. These are real application measurements, but still exclude physical phone playback. See `real-call-timings.json`.

The user reported the phone call was **“Responsive enough for natural conversation.”** This is a successful subjective usability check, not a stopwatch or instrumented end-to-end latency measurement. The actual call measurements are slower than the isolated replay and do not meet a one-second target. See `phone-feedback.json`.

All three unique-prefix requests reported zero cached input tokens on their first attempt. One required a repair that then used cached tokens; its extra time is included. An inert unique prefix was added for this diagnostic, so it is not an exhaustive cold-start or provider-load test.

The final audio cases replayed “Hello there”, a rough-day statement and a greeting with mild synthetic noise, in real time through the production local-call/VAD implementation, local ASR and voice analysis, the provider/task/publication modules and Breeze streaming. All three were transcribed and voiced. They used the final deployed conversation module. Final published replies were brief greetings or acknowledgements without the previously observed emotional judgment. An earlier post-warm-up replay needed a repair and took 3.107 seconds; the final range is therefore not a reliable worst-case bound.

The configured 550 ms end-of-speech wait measured 560 ms with 40 ms replay frames. ASR, model time and synthesis add to that. A stable one-second hands-free target has not been demonstrated.

## What “passed” means

**190 focused unit/integration tests plus 10 compiled routing checks passed: 200 total.** They cover conversation selection and repairs, call streaming and interruptions, VAD, voice evidence, provider parsing, durable tasks, budgets/privacy, ASR startup readiness and routing compatibility. Initial worker/Python failures or stalls under the sandbox were rerun outside it; the final required checks passed.

The broad 22-case sweep passed the then-current runtime checks. Manual review still found an unsupported wake-time remark and a dismissive thanks variant; these were subsequently added to regression coverage and repaired in the three targeted live checks. Later audio review drove the greeting score-isolation change and its unit checks; the final deployed audio replay followed that change. No new 22-case sweep was run after those final narrow changes. Passing runtime checks is not a score for personality, creativity or complete truthfulness.

Across this work the durable ledger recorded **$0.324480** for 106 diagnostic tasks and 113 provider attempts, including intermediate candidates and repairs. This includes earlier conservative reservations and later settled usage, not a confirmed invoice. Synthetic conversations were not inserted into Haru's chat or long-term memory. The budgeted task ledger intentionally retains the diagnostics.

## Remaining limitations

1. **One-second calls are not achieved; phone playback remains unmeasured.** The two live application turns took 3.39–3.66 seconds to first outgoing PCM, including application preparation. The isolated audio replay omits that preparation. Neither measurement covers microphone-to-phone-speaker latency. The iOS “speaking” acknowledgement is sent at stream start, before actual playback; treating it as audible confirmation would be wrong. Server speech-end timing is inferred from received frames and cannot recover upstream microphone/network buffering or downstream phone playback.
2. **The faster route is narrow.** English phrase matching still excludes many paraphrases, ambiguous follow-ups, mixed requests, tools, files, images and substantive requests. Complex or memory-dependent calls keep their full local path. This work did not turn every call transcript into a cloud request.
3. **Memory context remains abbreviated on eligible turns.** The full persona and selected current state/lessons remain, but the prompt includes at most seven recent turns within 4,000 characters and skips archive/Core profile retrieval. Stored memory is unchanged. Older nuance can be missed; explicit memory requests still use retrieval.
4. **Personality and creative quality remain uneven.** Greetings varied, but some were minimal or pointed. Jokes can become personal jabs, comments about the prompt or weak punchlines. The broader probes do not establish richer creativity, warmth or stable individuality across models and long sessions.
5. **Truthfulness checks remain targeted.** They reduce observed unsupported claims; they are not a semantic proof of every statement. Review still found weak implications such as treating tiredness as evidence of a long day and defensive additions to tone feedback. Broad factual correction, adversarial pressure, multilingual dialogue and long-session memory were not re-evaluated here.
6. **Repairs and fallback add real delay.** One final targeted greeting took 2.657 seconds for text after a repair. The fast-provider 2.5-second limit concerns the first token, not the whole response. MiMo/local fallback and specialist work remain slower; privacy, credential, price and budget restrictions still apply.
7. **Speech realism and load coverage are limited.** A short real phone check was successful by the user's assessment, and two live call turns were captured. Mild synthetic noise is not a crowded room, speaker echo or a range of human accents. Interruption logic has automated coverage, but there was no extended live phone session or sustained concurrent-load study. No reliable p95/p99 or maximum latency can be inferred from these samples.
8. **Warm-up has an operational cost.** ASR now takes its load/warm-up time and GPU memory before accepting requests. Health reports loaded/warmed/device state. A service/GPU failure can still require recovery; first-call speed cannot be guaranteed through an outage.

Artifacts include `real-call-timings.json`, `phone-feedback.json`, `dialogue-results.json`, `targeted-results.json`, `audio-before-warmup.json`, `audio-after-warmup-first.json`, `audio-results.json`, `quality-review.json`, `unit-results.json`, `runtime-routing.json`, `live-verification.json`, both deployment receipts and versioned rollback backups. Code guards checked changed files and relevant dependencies; unrelated concurrent edits were preserved. No phone build was published or specialist route changed by this deployment.
