# Desktop activity connected

Verified 17 September 2026, 00:01 AWST.

## Delivered

The existing Windows Haru client now sends fresh, content-free activity readings
to the main server through its saved authenticated connection. Its existing
desktop shortcut, avatar implementation and user-data location remain in use.
Haru was built and started successfully; the current avatar rendered correctly.

The desktop update is deliberately narrow: one sender, one life-tick hook and
reuse of the successful memory-sync session. It does not replace the desktop's
older chat/mood implementation with the server version.

Before starting the real client, a protocol mismatch was found and fixed:
`readEnvironment()` includes `hour`, but the receiver accepts only the seven
activity-report fields. The sender had spread the whole object, which would
produce rejected requests. It now selects idle time, window focus and battery
explicitly. An authenticated HTTP test verifies the real sender and receiver
together with an OS-shaped sample containing extra fields.

Native commit: **`0d5e950`** on `codex/native-attention-client`.
Its three-file patch was applied to the existing desktop checkout after a clean
patch check. Existing unrelated tracked changes were checked by SHA-256 before
and after application and were unchanged. Their original Git state was preserved;
they were not included in this commit.

Server/integration commit: **`a0bb084`** on `codex/attention-integration`.
This fixes the shared sender and adds the comparison tool below. It was transferred
to the server and built/tested there. No server restart was needed: the runtime
change affects the Windows-only sender, while comparison runs offline.

These are local Git commits and focused transfers, not a public release.

## Verification

| Check | Result |
|---|---|
| Existing desktop suite, including avatar tests | 1,178 passed; zero failed/skipped |
| Desktop production build | Passed |
| Sender/receiver boundary tests | 58 passed |
| Server full suite | 1,596 passed; zero failed/skipped |
| Server production build | Passed |
| Available diagnostic replay | 4,181 samples; zero mismatches or malformed records |
| Server service and HTTP | Active, HTTP 200, zero automatic restarts |
| Native process | Running and responding |

At the verification cutoff, policy 3 had **31 samples**: 21 initially unknown
and **10 with real desktop evidence**. No missing/duplicate baseline results
were recorded. All ten known-input samples were blocked by existing sleep rules.
Neither the live baseline nor shadow controller proposed a remark.

This verifies desktop-to-server integration. It does not establish better timing,
better replies or a benefit from the anatomical fruit-fly brain map.

## Same-input comparison

[compare-observed.cjs](compare-observed.cjs) compares three timing policies on the
same recorded client observations, mood values, conversation timing and blockers:

1. Existing timing logic with corrected client activity and seeded random choices.
2. A simple rule that acts at the first eligible opportunity.
3. Fly-inspired competition.

All receive ten minutes of startup grace **in this offline analysis**, with their
own proposal clocks. Partial sessions are reported and skipped. Invalid samples
fail the analysis; unknown activity never becomes availability. Tests check
conversation, blocking, startup grace, missing evidence and deterministic replay.

Run after compiling the tests:

```text
node research/fruitfly/compare-observed.cjs /path/to/attention-shadow.jsonl output.json
```

The first real-data comparison has zero unblocked opportunities and zero proposals
for every policy. No ranking is justified. The recorded mood and conversation are
held fixed, so later results will still describe conditional proposals, not how
a user would respond to different messages.

The live controller remains in shadow mode. Representative daytime use, useful
versus unwanted feedback, shared delivery history and restart/backoff protection
are still needed before a live timing pilot.

## Backups and operating notes

- Desktop source/build/profile backup and validation logs:
  `C:/Users/Tommy PC/AppData/Local/haru-research-cache/native-client-0d5e950`.
- Desktop feature patch:
  `C:/Users/Tommy PC/AppData/Local/haru-research-cache/native-attention-client.patch`.
- Server patch, backups, test/build logs, report, replay and comparison:
  `/home/toomii/.local/state/haru-deployments/native-boundary-a0bb084`.
- Raw observations and profile backups stay outside Git. Rollback should reverse
  the focused patch only after checking applicability; do not reset either checkout.
- Startup also reported an existing expired/revoked Google sync token and a
  missing optional avatar clip file. The avatar rendered and activity reporting
  worked. No account or avatar configuration was changed to suppress those errors.
