Haru conversation limitations follow-up — 29 September 2026

The fixes were deployed at **09:32:23 UTC**. Haru, local ASR, Breeze synthesis, local voice analysis and the watchdog were active after deployment. All 24 deployed source/runtime/test files matched the tested manifest. The RTX 3070 remains GPU 0. Configuration, GPU assignments and spending allowances were preserved. Versioned rollback files are in `before-093221/`.

The main conversation configuration changed outside this patch during testing, from MiMo to GLM and then to hosted Qwen. This deployment preserves the final Qwen configuration; the earlier MiMo timings and answers are not measurements of this current main route.

| Use | Verified active route |
|---|---|
| Eligible short chat and hands-free conversation | DeepSeek Flash, direct API |
| Fuller ordinary conversation and eligible substantive calls | `qwen/qwen3.8-27b-uncensored` through NanoGPT |
| Targeted factual evidence composition | DeepSeek Flash, direct API, after the primary draft/tool discovery |
| Private, machine-action or cloud-unavailable conversation | Local Qwen3.8 27B Heretic on the existing Ollama-compatible endpoint |
| Affordable escalation | DeepSeek Flash, direct API |
| Coding/writing specialist | Claude Sonnet 5.5 through Venice, as previously approved |
| Complex specialist | Kimi K3, direct Moonshot API |
| Premium specialist | Astra, direct OpenAI API |
| Speech recognition / speech synthesis | Local large-v3-turbo CUDA / local Breeze |

Local perception remains configured to the existing local Qwen endpoint; this work did not perform an image-quality or gameplay evaluation. MiMo support was not removed, but MiMo is not the active primary conversation route at this verification time.

The task policy is still **$0.50/task, $5/day, 12 provider attempts, 12 tool calls, a 180-second deadline and at most one quality escalation**. Factual evidence composition is an additional budgeted provider request within the current task, not an unlimited escalation ladder. It has no tools of its own. Fast-route quality failure returns to the configured primary. Normal affordable escalation can progress to Kimi; specialist/complex failures can request Astra when policy permits. Privacy, credentials, model suitability, price freshness and allowance remain gates. Disabling escalation also disables the new affordable evidence-review step; an unavailable review discards the hosted draft and enters the existing local grounded fallback.

Changes now deployed:

- Expanded the short English conversation matcher to common complete paraphrases such as “I’m a bit tired”, “Could you keep me company?” and “Can you tell me a joke?”. Mixed requests and ambiguous follow-ups still use the full path.
- Eligible substantive calls can now use the configured main conversation model with full retrieval instead of being forced onto local Qwen. Explicit specialist requests retain their roles; private and local machine actions retain local handling. This routing behavior was tested against the actual compiled selection blocks. It was not timed through a new physical phone session.
- Added a bounded preference projection to short replies: up to eight whole explicit conversation preferences within 1,600 characters, alongside the existing seven-turn/4,000-character recent transcript. It reads current saved records and supplied thread statements without creating another memory cache or database. New user corrections are presented last. Deleted, superseded, inactive, conflicted and inferred records are excluded; blank-slate and deletion boundaries prevent older thread preferences from reappearing.
- Strengthened greeting variation, delivery-label validation, ordinary joke framing and setup/payoff instructions. Explicit jokes no longer trip the real-lookup guard merely because the joke says “I checked…”. Real tool/action restrictions still apply. The humor remains model-generated.
- A recent explicit correction of the user’s feelings now withholds conflicting classifier labels from the short text prompt. The original local voice evidence remains available for speech behavior. Missing audio cannot support a claim of hearing the user.
- Added targeted evidence-only composition for challenged facts, arithmetic correction, personal-history questions and verification/citation requests. The discarded draft is not given to the checker or published to chat/speech. Sources retain user/assistant/tool provenance. The check uses direct DeepSeek Flash independently of the main conversation model, under the same durable task and outbound privacy gate. Successful tool receipts remain available as evidence; discovery calls pass through before review.
- Corrected prompt rules that equated absence from a short transcript with an event never happening, or treated timezone/language as proof of residence. Unknown personal dates stay unknown; updates to personal facts are distinguished from correcting an earlier mistake.
- Complete recognized social utterances no longer incur the extra unfinished-phrase hold merely because ASR omitted punctuation. The 550 ms end-of-speech setting is unchanged and genuine fragments still wait.
- Fixed a reproduced speech/privacy bug: a calculated pace of `4.032258064516129` accidentally matched the payment-card detector. Prompt copies of voice measurements now use four decimal places. Full-precision local decisions and all text/credential/card checks remain intact. The tests verify that real secret-shaped text is still blocked.

Measured results:

| Probe and measurement scope | Count | Median | Range |
|---|---:|---:|---:|
| Short dialogue: validated text, provider/task/publication modules | 31 | 1.032 s | 0.689–1.879 s |
| Targeted factual replies: current hosted Qwen draft plus DeepSeek evidence composition | 7 | 3.615 s | 2.957–3.760 s |
| Full truth/fiction batch, including three primary-only prompts | 10 | 3.370 s | 2.079–3.760 s |
| Synthetic audio: server-estimated received speech end to first outgoing PCM | 8 | 1.819 s | 1.667–1.904 s |
| Same audio: committed transcript to first PCM | 8 | 1.011 s | 0.862–1.099 s |
| Same audio: recognition/voice-analysis wait | 8 | 0.247 s | 0.237–0.258 s |
| Same audio: synthesis to first PCM | 8 | 0.253 s | 0.237–0.266 s |
| Specialist API → synthetic read tool → final API response | 3 | 5.964 s | 4.996–7.077 s |

**These audio timings are not end-to-end phone latency.** The replays use generated speech, real-time 40 ms frames, the production local-call/VAD implementation, actual local ASR and voice analysis, budgeted provider calls and actual Breeze streaming. They omit the full live application's state/retrieval preparation and phone microphone/network/playback buffering. The measured end-of-speech wait was 560 ms at the replay's frame granularity. No new physical phone session was measured. The prior full-app phone-call observations of 3.39–3.66 seconds to outgoing PCM and the user's “Responsive enough for natural conversation” assessment remain historical observations, not a post-deployment retest.

The eight final audio conditions were an ordinary greeting, the same greeting with its ASR punctuation deliberately removed, a rough-day statement, two synthetic noise levels, 0.8× and 1.2× synthetic speech and a simple room-echo filter. All were transcribed and voiced. The punctuation-free greeting had zero added hold. Three simultaneous ASR requests all returned the expected transcription in 216, 430 and 642 ms, with 643 ms total elapsed. This small queue test is not a sustained-load result.

**339 focused regression tests plus 24 compiled routing checks passed.** Coverage includes memory integrity, preference selection/deletion, speech/VAD/interruptions, voice evidence, tool loops, provider handling, outbound privacy and durable accounting. Both TypeScript compilations passed. The final dialogue batch passed 31/31 checks with two private repairs; all used DeepSeek. Saved preferences, a preference after 60 intervening turns, a newer correction and overriding an emotion guess passed. There were four distinct greetings across five successive turns; the fifth could repeat the first because the repetition window is three replies.

The final factual batch passed 10/10 reviewed cases: retaining 42 against pressure to say 41; correcting 17 + 18 to 35; accepting a renamed cat without a false apology; separating fictional residence from personal history; declining to invent a deleted-backup motive, purchase year or verified DOI; correcting French and Finnish false premises; and producing clearly requested fiction. The seven English evidence-review cases used two requests. The French, Finnish and fiction cases used the current Qwen primary directly. A narrow rubric originally missed a correct “Stockholm” answer and valid Mars imagery; the checks were adjusted to accept those legitimate variants, while arithmetic and fabricated-DOI checks remained strict. These are small targeted tests, not a general truthfulness score.

Sonnet, Kimi and Astra each completed a real two-request API/tool-result round trip, returning the expected synthetic marker exactly once. Sonnet took 4.996 s, Kimi 7.077 s and Astra 5.964 s. This verifies tool continuation for a fixed read-only result; it is not a benchmark of project execution, real browsing, code changes or image understanding.

Failures found during testing were retained rather than overwritten. Same-model Qwen review falsely defended 34 and fabricated a “verified” DOI; those failures motivated the separate DeepSeek evidence composer. Earlier prompt-only candidates fabricated or mishandled personal facts. One audio replay failed its privacy check until the decimal-precision bug was reproduced and fixed. An earlier first transcription took 1.110 s and its audio turn took 2.823 s, so the final warm range is not a worst-case bound. A specialist harness initially allowed zero tool calls; correcting that diagnostic setting produced the three successful round trips. A long diagnostic also encountered the live watchdog restarting the exclusive task worker; the harness now temporarily pauses and restores the watchdog during its idle-app tests. The final required checks have no unresolved failures.

Across all candidates, the durable diagnostic ledger contains 184 tasks: 161 completed, 21 failed and two interrupted. There were 207 successful provider attempts and two unknown attempts. The recorded charge is **$0.097227**, including $0.008875 conservatively retained for the unknown attempts; this is a ledger figure, not a provider invoice. Synthetic probes were not inserted into chat history or long-term memory. The diagnostic task ledger intentionally retains them.

Remaining limitations and tradeoffs:

- **A stable one-second hands-free response is not demonstrated.** Even the warm isolated replay requires about 1.67–1.90 seconds from received speech end, before phone playback and full app preparation. Internet/provider load, repairs, fallback and cold/recovery conditions can be slower. The 2.5-second fast-route deadline concerns first provider output, not final speech. This sample cannot establish p95, p99 or a maximum.
- **Truthfulness is improved only for the covered patterns and evidence.** Review selection is mainly English and heuristic; it is not a universal claim checker or an external fact lookup. The reviewer is also a model and can be wrong. A missing receipt remains unknown. Unsupported drafts are withheld, but an unavailable checker can fall back to the slower local grounded route. The additional check costs a request and measured roughly three to four seconds for text. The French/Finnish probes passed factually but still used annoyed/smug delivery labels; tone is not uniformly neutral.
- **Conversation quality remains uneven.** Some acknowledgements are very short, jokes can be stock or weak, and repetition can recur outside the three-reply window. More complete jokes have a higher output allowance and can take longer. The tests do not prove stable individuality, creativity or preference resistance across long sessions and every model.
- **Fast memory is still abbreviated.** The new projection covers explicit conversation preferences, not arbitrary life history or the full Obsidian/Core archive. At most eight preferences/1,600 characters are selected; older nuance can be omitted. Any deletion boundary conservatively drops older or undated thread preferences, including unrelated ones that exist only in that transcript. Full memory requests retain retrieval. This work tested projection and existing integrity behavior without performing a new live vault-ingestion/write cycle.
- **Coverage remains limited.** Synthetic noise and simple echo do not substitute for varied human accents, overlapping speakers, real phone echo cancellation or a crowded room. Three ASR jobs are not an extended multi-call soak. No new phone build was published and physical playback instrumentation remains absent. Whole-application substantive call speed, image analysis and long specialist projects remain unmeasured here.
- **Operational constraints still apply.** Local-only turns and fallback can be much slower. Provider credentials, prices and budgets can disable routes. ASR still has startup warm-up and GPU-memory costs; this deployment did not restart or retime its startup. The subjective earlier phone assessment remains useful but does not guarantee performance through service or GPU outages.

Evidence: `results-summary.json`, `dialogue-results.json`, `truthfulness-results.json`, `grounded-diagnostics.jsonl`, `specialists-results.json`, `audio-results.json`, retained earlier candidate files, `unit-results.json`, `runtime-routing.json`, `deployment.json`, `live-settings.json` and `live-verification.json`. The current source documentation is `haru-desktop/docs/conversation-limitations-followup.md`.
