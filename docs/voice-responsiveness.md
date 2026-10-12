# Feedback editors and conversational speech — 2026-09-29

## Released

Haru iOS build **77**, commit `34cd524b8869723ba165a8a04c3f88d4c69fc5bd`, passed its macOS build, signed export, and App Store Connect verification. Apple reported `VALID` and `IN_BETA_TESTING` at 04:28:43 UTC.
[Release build](https://github.com/Toomiiverse/haru-ios/actions/runs/36521370690).

The six server runtime patches activated at 04:45:03 UTC. Haru, ASR and voice affect services are active; the web endpoint returned HTTP 200. Runtime hashes match `deployment.json`.

## Feedback

The two native feedback sheets were owned by rows in a lazy transcript. Keyboard layout and transcript updates could recycle the presenting row. Both sheets now belong to the persistent chat screen and hold an immutable snapshot of the selected message. The hearing draft is seeded once instead of being reset by `onAppear`. Network save errors stay inside the sheet with the draft intact; repeated submissions and dismissal during saving are disabled.

The app must be updated to build 77 for these changes. Physical keyboard/sheet interaction was not exercised on the user's iPhone here; the app compiled and archived on Xcode 26.3.

## Speech

- Ordinary call instructions now permit the existing narrow conversational route. Mixed requests, attachments, tools and ambiguous follow-ups retain the full path.
- Short social/voice replies use the configured text identity/style and full sourced transcript, emitting only the spoken reply instead of an invisible explanatory JSON basis. The final publication gate is preserved.
- A reply that dismisses a user's tone impression is withheld and goes through the full local evidence check. That fallback can take longer.
- Stable transcript text precedes changing timestamps/audio evidence, retaining more of the model's cached prefix. In a controlled 24-message transcript probe, warm prompt evaluation fell from 3.17–3.21 s to 1.16 s. No conversation content was removed.
- Existing delivery labels select voice/face without another emotion-classification request. Call tone changes retain their individual delivery and a shared voice seed.
- Native chat voice uses progressive PCM over authenticated GET `/api/speak?format=pcm`; other voices/older servers retain the complete-file fallback. Interruptions cancel current and prefetched requests. Browser WAV streaming remains compatible.
- Initial iPhone audio priming changed from 0.90 s to 0.24 s. The 0.60 s recovery buffer remains. These local chunk traces projected no underruns at the smaller initial buffer; mobile network jitter can still cause rebuffering.

## Deployed-runtime probes

Synthetic prompts exercised the actual compiled local reply/provider functions and the local Breeze speech engine, without adding test conversation to chat or memory. The call aside and full configured persona were included. Times run from composition entry to first PCM; they **exclude** microphone end detection, ASR, broader application preparation and phone/network playback. They are not end-to-end one-second guarantees.

| Probe | Reply complete | First PCM | TTS to first PCM |
|---|---:|---:|---:|
| greeting cold | 2.64 s | 2.91 s | 275 ms |
| greeting warm | 1.60 s | 1.84 s | 240 ms |
| tone feedback | 2.74 s | 2.98 s | 249 ms |
| own delivered tone | 3.31 s | 3.59 s | 280 ms |
| no input audio | 1.98 s | 2.23 s | 248 ms |
| current audio cue | 2.33 s | 2.60 s | 266 ms |

The candidate warm greeting reached 1.64 s; the deployed warm greeting reached 1.84 s. Tone/audio questions took 2.23–3.59 s in the deployed probe. Complex tool work remains slower. The model remains on its configured 20,480-token runner with no context reloads in the check.

## Validation and artifacts

- TypeScript runtime and test compilation passed.
- 226 server/module/compiled-path checks passed: reply routing, grounded composition, publication gate, delivery, voice analysis, local call interruptions, tool loop and authenticated HTTP endpoints.
- The real Swift `HaruClient` passed a local HTTP test on the Mac runner: first PCM before EOF, exact bytes across odd chunk boundaries, whole-file fallback, HTTP/format failures and cancellation before consumption.
- iOS archive/export and exact-build TestFlight availability passed.
- `candidate-manifest.json` contains source/runtime hashes. `activation-before/` and `deploy.py` provide guarded rollback material. Deployment used only the six scoped compiled patches, preserving concurrent provider work.
- `deployed-probe.json`, `runtime-probe.json`, `cache-benchmark.json`, `test-results.json`, `deployment.json`, and `ios-release.json` hold results. The isolated iOS release checkout is `ios-release/`.
