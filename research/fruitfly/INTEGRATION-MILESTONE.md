# Attention integration: first milestone

**Follow-up:** The desktop client is now connected and real readings have been
verified. See [desktop integration](DESKTOP-INTEGRATION.md) for the subsequent fix,
tests and comparison. The record below describes the initial server milestone.

## What is implemented

This change connects fresh activity evidence to Haru's existing life loop and
mood, and makes the fly-inspired policy an independently testable shadow runtime.
It does not give the policy authority to send messages or change prompts.

- Browser input, native Windows observations and deliberate conversation are
  separate evidence sources. Browser input never resets the conversation clock.
- Desktop reports reuse the existing successful memory-sync login, run no more
  than once per 30 seconds, obey the desktop activity-log setting, time out after
  five seconds and never queue old readings. Browser reports require real input
  on a visible page. Loading or polling a page does not count.
- Reports contain no keys, coordinates, titles or message text. Authenticated
  source and client sequence prevent one device's old report replacing another's
  new input. Source/session identifiers are held in memory and excluded from logs.
- Desktop evidence expires after 90 seconds, browser/conversation after five
  minutes. The most recent inferred input wins; its focus/battery stay with it.
  Freshness does not establish what the user is doing or whether interruption is welcome.
- On the Linux server, the virtual desktop no longer supplies activity, focus
  or battery to mood. Unknown activity holds curiosity, focus, affection and
  stress contributions; clock-driven sleep/energy and real events still work.
- The runtime advances once per life tick, including reminder ticks. Logging
  can fail or be disabled while the runtime continues. Its internal rest score
  is not exposed as a real proposal when activity is unknown.
- Policy-3 samples and baseline results share a session/tick ID. The existing
  random decision is observed once. Idle attempts and chat acceptance/suppression
  are logged separately. Chat acceptance does not prove the user heard/read it.
- Reports exclude unknown proposals, missing results and duplicate results from
  agreement. Replay supports complete policy-2 and policy-3 sessions.

## Boundaries

Only `HARU_ATTENTION_MODE=off|shadow` is implemented (default shadow).
`HARU_ATTENTION_SHADOW=0` remains a legacy off switch.
`HARU_ATTENTION_LOG=0` disables diagnostics independently. Unsupported modes,
including pilot/defer, resolve to off.

The activity/mood correction is live independently of the attention mode.
Disabling shadow alone does not undo the mood correction; source/build rollback does.
Original nudge/reminder delivery gates still read their established host inputs.
This intentionally leaves the live nudge decision unchanged except for its normal
dependence on the corrected vitals. Compare policies on the same corrected
observations offline before any later timing pilot.

This is the foundation of stages 1–3, with remaining exit checks: representative
real-client coverage; persistent initiative history/startup grace before a live
pilot; unified cross-channel delivery outcomes and actual presentation feedback.
The desktop sender is implemented and tested, but only an updated, running Windows
client with successful sync can provide native observations. Server deployment
alone does not update the desktop application. Open browser pages need a reload
for sequenced reports; legacy content-free reports remain accepted.

No brain-connectome weights, new model calls, prompt changes, retrieval changes
or emotion-to-mood feedback are introduced.

## Validation

- 168 focused tests pass, including real authenticated HTTP requests, multi-client
  freshness, duplicates, malformed payloads, reconnect, browser throttling,
  logging failures, unknown mood inputs, delayed baseline linkage and replay.
- Full local suite: 1,579/1,583 pass. Four unchanged tests in Claude-session and
  vault-memory modules assume Linux paths; their Windows failures show slash/home
  path differences. The implementation and test files for those modules match
  the imported server baseline.
- Full Linux server suite: **1,583/1,583 pass**, zero skipped. Server build and
  the eight-scenario integration probe pass against the newer scheduling code.
- Application build passes. Existing font/CSS build warnings remain.

## Synthetic comparison

See [reproducible probe](integration-probe.cjs) and
[numeric results](integration-probe-results.json). Eight one-hour scenarios,
100 seeded baseline runs each, use the same corrected observations/vitals for
the existing timing rule, a simple first-eligible rule and fly-inspired competition.

| Scenario | Baseline mean proposals | Simple proposals | Fly proposals |
|---|---:|---:|---:|
| Active desktop | 5.82 | 7 | 3 |
| Active browser | 5.82 | 7 | 3 |
| Conversation every minute | 0 | 0 | 0 |
| Quiet reading without input | 0 | 0 | 0 |
| Measured idle desktop | 0 | 0 | 0 |
| Overnight, unknown input | 0 | 0 | 0 |
| Disconnect and reconnect | 4.35 | 6 | 3 |
| Delayed one-minute ticks | 4.09 | 7 | 3 |

These are proposals, not messages or user ratings. Fewer proposals do not prove
better timing. Unknown quiet reading remains unknown. This demonstrates bounded
behavior and a measurable difference, not a benefit from the fruit-fly brain map.

## Deployment record

Feature commit: **`b59d880`**, branch `codex/attention-integration`.
Deployed on **16 September 2026, 23:47 AWST** to
`toomii@haruserver:/home/toomii/haru-desktop`.

Deployment applies only the feature delta from local baseline `4b4bf27`,
with the plan document added because it was absent on the server. Server HEAD
`119603e` and its newer scheduling changes are preserved. The local branch
contains a private snapshot of effective server sources and is not published.

Verification at 23:48 AWST:

- Service active, HTTP 200, automatic restart count zero.
- Both observed fresh policy-3 sessions report unknown activity, null focus and
  battery, and no action proposal. Both baseline results are linked, with no
  missing/duplicate records. Zero comparable samples is reported, not 100% silence agreement.
- All **4,152 available samples**, including those two policy-3 samples, replay
  without action, proposal or numerical mismatches at tolerance `1e-12`.
- A second clean service start was observed after deployment. All 19 deployed
  source/document/test files still match their recorded checksums.
- Runtime: Node `22.22.1`; application Electron dependency `43.2.0`.
  No model-quality claim is made and the configured model was not changed.

Backup and validation logs:
`/home/toomii/.local/state/haru-deployments/attention-b59d880`.
This holds the exact adapted patch, source/build backups, prior Git status,
server test/build logs, post-deploy hashes, synthetic probe and diagnostic reports.
Rollback reverses that feature patch and restores the saved build, then restarts
`haru.service`; check patch applicability first to preserve any subsequent edits.
The deployment-note update is documentation only and has its own recorded patch.

Real-client coverage is still pending. No artificial input was sent to the
running companion to make this check look like user activity.
