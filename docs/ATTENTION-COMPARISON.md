# Attention comparison — policy 2, 16 September 2026

## Outcome

Three regressions were reproduced against policy 1 before changes: speech during
frequent conversation, speech before the existing patience threshold, and
indefinite initial-state dependence. All pass after the changes. Keep shadow
mode while collecting representative daytime data; these results concern
proposals, not user preference or delivered messages.

## Improvements

- Reuses shouldPipeUp's patience and sleep eligibility with a deterministic
  eligibility check. Haru's actual random decision is still sampled only once.
- A small score advantage wins after remaining strongest for a minute.
  Alternating small advantages do not cause flicker.
- The urge to speak grows between 15 and 30 quiet minutes, resets after a
  proposal or contact, and remains moderated by energy, curiosity, focus,
  stress and sleepiness. This addresses silence throughout a normal day.
- Recent conversation timing survives restart via the saved last-message timestamp.
- Policy-tagged logs prevent revision 1 and 2 measurements being mixed.
  Numeric input snapshots allow future live samples to be reproduced.
- Invalid clocks, malformed log sessions and invalid silence measurements are
  handled without crashing the report or bypassing patience.

## Reproducible one-hour comparison

Baseline: mean of 100 seeded runs. Both shadow versions are deterministic.
Fixed vitals, 20-second ticks, user contact at minute zero, independent speech
clocks. Actual reminder generation, language models and delivery are omitted.

| Scenario | Current Haru | Original shadow | Improved shadow |
|---|---:|---:|---:|
| Default vitals, active desk | 4.68 | 0 | 0 |
| Alert and curious | 4.41 | 6 | 5 |
| Focused work | 4.54 | 0 | 0 |
| Activity changes every two minutes | 4.41 | 6 | 5 |
| User speaks every five minutes | 0 | 6 | 0 |
| Sleeping or speech blocked | 0 | 0 | 0 |

First proposed speech in the alert scenario: 3 min 20 sec originally, now
15 min; baseline median 16 min 20 sec. Under identical default inputs, cold
and initially engaged states now both settle on attend instead of remaining
rest and attend indefinitely.

## Broader tests

- Seven simulated days with irregular 7/23/61-second ticks, drifting vitals,
  daytime contact, alternating praise/criticism, sleep and speech gates.
- Conversation and proposal-spacing tests at 5/20/60-second tick rates.
- Sustained-state convergence, alternating small score differences, novelty
  decay, invalid clocks/silence, bounded log rotation and policy filtering.
- Long silence does not override zero energy or maximum stress.
- A separate 24-hour replay starts at 08:00, alternates work/evening/sleep,
  uses half-hourly daytime contact and alternating hourly feedback.
  Current Haru proposes a mean 52.5 times (range 48–56); policy 2 proposes 18.
  Policy 2 shifts between attend and rest and remains silent overnight.

The 24-hour result is a synthetic comparison, not proof that 18 check-ins are
desirable. Frozen default vitals still yield no shadow speech, and investigate
uses coarse activity categories. Human preference remains unmeasured.

## Reproduce

    npm test
    node scripts/attention-compare.cjs
    node scripts/attention-report.cjs /path/to/attention-shadow.jsonl

The comparison accepts an alternate repository directory and uses its compiled
test modules. The report defaults to policy 2; append 1 to inspect old logs.
