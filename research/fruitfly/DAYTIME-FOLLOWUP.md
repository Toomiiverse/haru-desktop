# Haru attention: daytime follow-up

**16 September 2026, 22:30 Perth.** Follow-up to the frozen [08:00 report](REPORT.md).

## Finding

There is still no demonstrated improvement in Haru's nudges or conversational
quality from the fly-inspired attention policy. Daytime observations now contain
real interactions, but also confirm that the server's own desktop readings are
an inadequate proxy for activity on the user's phone or computer.

The useful improvement in this continuation is to the evaluation: the report now
separates shared silence from speech proposals, measures input coverage, and can
replay an alternative idle reading without changing Haru's behavior.

## New observations

The saved snapshot ends at **22:23:40 Perth**. Its four complete sessions contain
3,953 samples, all replayed with zero action or numeric mismatches at a tolerance
of 1e-12. Filtering the reporting window to **08:00–22:23:40** leaves:

| Measure | Observed |
|---|---:|
| Samples | 3,202 |
| Logged deliberate interactions | 16 |
| Delivered aside events | 6 |
| Baseline idle-speech proposals eligible after blocking | 1 |
| Experimental speech proposals | 0 |
| Samples where the host idle timer was at most five minutes | 22 |
| Samples reporting the host window focused | 3,202 |
| Recent-contact samples despite a host idle time over five minutes | 69 |

Across the entire snapshot, only **four** samples had both an active host idle
reading and no blocker. The one baseline-only proposal occurred at 13:29:50,
about 49 seconds after the current service started; its host idle time was 48
seconds. This timing is consistent with a fresh virtual desktop resetting the
idle timer; it does not establish that the user was at a computer. That sample's
experimental action was `attend`, with focus about 0.90.

The old headline of **99.97% agreement** consisted of 3,952 shared silences and
one baseline-only proposal. It is not evidence of good nudge timing. The six
delivered asides come from Haru's existing paths and cannot be treated as six
experimental successes. No new ratings were recorded in the shadow log.

Results: [input audit](daytime-input-results.json),
[expanded attention report](daytime-attention-report.json).

## Controlled input sensitivity

Replay the same policy twice from the start of each session. In the alternative,
for five minutes after deliberate contact, use the smaller of host idle time and
time since contact. Keep recorded vitals, focus, categories and blockers fixed.
Report only the daytime window; the earlier history still initializes both
policies. This is an exploratory sensitivity assumption, not measured client
presence or a prediction of a complete alternate day.

- **104** idle readings changed.
- **36** actions changed from `rest` to `attend`; all other actions matched.
- Speech proposals remained **zero** in both versions.

This has a structural explanation: contact evidence expires after five minutes,
while Haru waits eight to fifteen minutes after conversation before idle speech
is eligible. Knowing that someone just spoke cannot establish their availability
when that later window opens. Extending the evidence lifetime until speech becomes
possible would assume the presence we are trying to measure.

### Mood sensitivity, separately simulated

A one-hour noon scenario starts from default vitals, with direct contact every
minute, 20-second ticks, and no emotion events. These are synthetic endpoints,
not observed changes to Haru or reconstructed live mood:

| Input assumption | Curiosity | Focus | Affection |
|---|---:|---:|---:|
| Host idle for 12 days, host window focused | 0.15 | 0.90 | 0.70 |
| Recent contact supplies idle time; retain host focus | 0.75 | 0.90 | 0.70 |
| Same contact; assume no window focus | 0.75 | 0.40 | 0.40 |

The large differences justify testing input quality before tuning another mood
controller. The last row assumes lack of focus; absence of a client focus sensor
does not prove that assumption. Neither alternative is deployed to control mood.

## Changes and validation

- Improved `scripts/attention-report.cjs` with the four speech-decision counts,
  proposal overlap and host-input coverage. Zero proposal denominators produce
  `null`, rather than a misleading perfect score.
- Added `attention-input-audit.cjs` for verified replay, reporting-window filters,
  input sensitivity and the independent mood probe. It rejects corrupt replay
  values and skips sessions missing their beginning. Snapshot hashes identify the
  exact inputs; raw diagnostic logs remain outside Git.
- Added regression checks for the four outcomes, blocked samples, unavailable
  denominators, malformed inputs, corrupt actions/scores, partial sessions,
  unknown contact history, and replay before the reporting window.

Validation: test TypeScript compiled successfully; all **43** targeted attention,
vitals and opening tests passed. The input audit also ran against the saved live
snapshot, verifying all 3,953 recorded samples before evaluating its alternative.

The app's production code and shadow policy are unchanged. No new endpoint,
background polling, prompt, model setting, or nudge rule was introduced.

## Deployment context and next useful experiment

At 22:27:34, the server was active and HTTP returned 200. It had restarted since
the overnight report; the current service began at 13:29:01 and reports zero
automatic restarts. Its configured model no longer matches the overnight emotion
experiment. Consequently those earlier classifier scores cannot be claimed for
the current configuration. The active knowledge set is now 99 chunks.
[Metadata snapshot](daytime-live-metadata.json).

The next behavioral comparison needs **recent, timestamped client input** and an
explicit unknown state when that evidence expires. A visible tab, a history-page
request, a synced foreground-window entry and actual keyboard/mouse/touch input
are different signals. Record and validate them separately in shadow mode before
allowing any to control nudges. Fresh paired model tests would also be needed
before drawing emotion conclusions about the newly configured model.

The original recommendation stands: keep anatomical wiring and the attention
policy experimental. The evidence currently supports improving the observations
and evaluation, not replacing Haru's live behavior with a fly-brain controller.
