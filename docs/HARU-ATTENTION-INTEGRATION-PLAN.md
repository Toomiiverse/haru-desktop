# Integrating fly-inspired attention into Haru

## Objective and decision

Give Haru more consistent attention, better timing and more coherent expression,
while preserving her character and existing capabilities. Integrate the small
fly-inspired controller already tested, then measure whether it improves actual
use. Actual anatomical wiring remains a separate research candidate: the completed
experiments did not demonstrate a benefit from it.

Implementation has begun. See [milestone status](../research/fruitfly/INTEGRATION-MILESTONE.md)
for the observation/mood fixes and shadow runtime. Live control remains a later stage.

## Verified starting point

- `electron/attention.ts` provides a pure, deterministic `stepAttention` policy
  and a diagnostic wrapper. Its four proposals are attend, investigate, speak
  and rest. Neither existing shadow branch controls production behavior.
- Browser input collection is deployed. It records content-free input receipts,
  expires after five minutes and reports unknown when evidence is unavailable.
  It does not measure activity outside Haru's browser page.
- `readEnvironment()` still reads the host OS. On `haruserver`, this is a virtual
  desktop, so its idle and focused-window readings cannot establish user presence.
- The newer server code separates `broadcastBeat()`/emotion classification from
  mood updates. Preserve this: her own generated prose must not drive her mood.
- Slow state already lives in `vitals.ts`; prompt cues enter through
  `prompt.ts`; gestures and gaze have existing consumers. Sleep, irritation,
  quiet hours, gaming rules, push preferences and reminder rules already exist.
- The server's observed base is `2eba05b` plus working-tree changes. Research
  commit `a19e41b` and report commit `2399cf3` were transferred with documented
  adaptations. Start implementation against the current effective server source,
  not the older research branch's copies of mood and chat code.

Evidence: [main report](../research/fruitfly/REPORT.md),
[daytime audit](../research/fruitfly/DAYTIME-FOLLOWUP.md),
[client-input deployment](../research/fruitfly/CLIENT-INPUT-FOLLOWUP.md).

## Where it fits

```text
Actual client input + conversation/events + existing vitals
                         |
               Freshness-aware observation
                         |
          Existing eligibility checks and priorities
                         |
             Fly-inspired attention proposal
                         |
         Existing composition and delivery functions
                         |
             Final checks before delivery
                         |
          Outcome record and explicit user feedback
```

Direct replies and requested reminders retain their current pathways. The first
live use of attention governs optional spontaneous chatter only. It does not own
tools, memory, task completion or a second schedule of reminders.

| Haru area | Integration | Initial authority |
|---|---|---|
| Attention | Read fresh activity, recent conversation and existing vitals | Observe, then defer optional chatter |
| Nudges | Consult the proposal at an existing eligible opportunity | Permit or defer; existing gates remain final |
| Mood | Correct the evidence feeding `driftVitals`; retain event-driven updates | Separate change, evaluated before policy effects |
| Chat | Translate stable attention into one small cue in existing prompt assembly | Optional later experiment; no factual or tool authority |
| Emotions | Existing classifier drives face/voice delivery | Preserve current separation from mood |
| Gaze/gestures | Use stable attention as a low-priority input to existing blending | Later; speaking and explicit gestures take precedence |
| Retrieval | Keep current exact/hybrid retrieval | No change; revisit FlyHash only at measured scale |

## Implementation sequence

### 1. Establish one trustworthy observation of activity

**Change:** Add a small shared observation helper used by the main life loop and
attention. Carry source, receipt age and availability explicitly. Distinguish
recent input, a measured idle device, and unknown evidence; none proves what the
user is thinking or whether they welcome interruption.

- Reuse the deployed browser signal. Track conversation separately: a tap or
  scroll must not reset the clock measuring silence since a message.
- Add fresh native-desktop input reports using the existing authenticated server
  connection when available. Sample actual OS input on the user's machine, never
  on the server. Do not repurpose the 15-minute activity-history sync as presence.
- Report while the client is connected, with a bounded cadence and no backlog.
  Send only necessary numeric state, not keys, coordinates or window titles.
- Keep source identity and freshness separate when several clients are connected;
  fresh input on one device must not be overwritten by another device's stale
  idle/focus report. Server receipt time is authoritative; account for sample age
  and reject out-of-order reports without trusting the client's wall clock.
- Treat focus as a separate observation. Recent input does not establish continued
  focus. An open connection or visible page does not establish input.
- Native phone clients outside this repository need their own adapter before
  claiming coverage; the browser adapter alone does not cover them.

**Files:** `main.ts`, `webserver.ts`, `webpage.ts`, one small observation module,
and the relevant desktop connection code after locating its session lifecycle.

**Exit check:** Tests cover multiple clients, expiry, restart, clock changes,
offline/reconnect and invalid input. Demonstrate known and unknown observations
from actual clients in representative use. Keep this stage diagnostic initially.

### 2. Correct mood inputs independently

**Change:** Extend `Environment` to represent missing idle/focus readings. Update
every consumer deliberately; do not turn unknown into zero idle, infinite idle,
or a claim that the user is ignoring her.

- Continue time-of-day drift and real event updates when activity is unknown.
- Apply activity/focus-dependent changes only when the corresponding observation
  is known. Initially hold those specific components when evidence is missing;
  test recovery and long gaps before choosing any additional decay rule.
- Keep server power state separate from the user's activity and emotional state.
- Preserve elapsed-time correction and the server's event-driven mood design.
  Do not restore the old `emotionToVitals` feedback from generated replies.

**Files:** `vitals.ts`, `main.ts`, existing environment consumers and their tests.

**Exit check:** Replays cover active work, quiet reading, conversation, absence,
overnight use and timer delays. Values remain bounded; no fabricated focus or
affection increase from a virtual window. Measure this ordinary input correction
before attributing any later improvement to the fly-inspired policy.

### 3. Make the attention policy usable without giving the logger control

**Change:** Reuse `stepAttention` through a small runtime adapter returning a
proposal and reason codes. Leave the diagnostic `observe()` interface separate.
No second agent process, model call or general-purpose event framework is needed.

- Advance it once per life tick, including ticks where reminders win. Record
  suppression reasons so missing samples do not look like deliberate silence.
- Sample the baseline's random choice only once. Observation must not affect the
  random sequence, cooldowns or production outcome.
- Separate proposed, attempted, accepted and delivered actions. A winning shadow
  score is not a delivered message. Preserve attempt backoff as well as delivery
  spacing so failures cannot cause repeated generation.
- Add one behavior mode: off, shadow, defer-only, or pilot. Logging can be
  disabled independently. A logging failure must not change behavior.
- Invalid or stale observations deny new experimental initiatives. Failures
  return control to the existing behavior path without creating a new action.
- Reset transient scores on restart while retaining established delivery/backoff
  history. A restart must not grant a fresh chance to interrupt.

**Files:** `attention.ts`, its integration in `main.ts`, reporting/replay tools.

**Exit check:** Shadow mode leaves existing outputs and state unchanged. Replay
matches recorded proposals; cooldown, priority, failure and restart tests pass.
Version the policy and log inputs when decision semantics change.

### 4. Integrate optional nudges in two steps

**First: defer-only.** At `considerPipingUp`, an already eligible optional remark
may proceed or be deferred. This tests whether persistent attention avoids bad
interruptions without adding new opportunities. Direct messages and explicit
reminders never depend on winning the attention competition.

**Then: bounded pilot.** After useful evidence, let the policy select timing within
existing spontaneous-chatter opportunities. Start with this one source. Expand
to `pesterOnPush` and the nudge floor only in a separate change after delivery
outcomes and cross-channel duplicate prevention work correctly.

Separate the existing deterministic eligibility rules from its random timing
choice. Defer-only applies after the baseline chooses a remark; the pilot replaces
that timing choice at eligible ticks. Do not require both independent policies to
win before speaking. Keep a single observed baseline draw for comparison.

- Preserve `whyNotInterject`, sleep/wake rules, quiet hours, gaming preferences,
  opt-outs, reminder priority, repetition checks and content checks.
- Recheck eligibility after generation: the user may start talking or a reminder
  may become due while Haru is composing.
- Use the current composition and delivery code. A `speak` proposal alone neither
  calls the model nor sends anything. `investigate` initially allocates attention
  to already available context; it does not trigger browsing, captures or tools.
- Reuse shared delivery history and budgets across desktop, browser and push.
  A push service accepting a message is not proof that it was seen or heard.
- A deferral is revisited on a normal tick, with no queued burst or catch-up
  message after quiet hours, missing evidence or reconnection.

**Exit check:** No protected-rule violations, duplicate delivery or extra model
call on denied opportunities. Live feedback shows fewer unwanted interruptions
without losing useful ones; reduced message count alone is insufficient.

### 5. Add coherent chat and expression, one experiment at a time

Only after timing is stable:

1. Map stable attention into the existing `prompt.ts`/`vitalsInstruction` path.
   Start with at most one brief cue, such as staying on the current task or using
   a shorter response. Avoid duplicate or conflicting persona/mood instructions.
2. Preserve the current mood, irritation and sleep rules. Attention must not
   manufacture facts, emotions attributed to the user, or relationship changes.
3. Feed a low-priority attention weight to existing gaze/idle animation blending,
   with smoothing. Speech, explicit gestures and reduced-motion settings win.
4. Test emotion-label changes separately on the currently deployed model; the
   overnight model configuration has changed, so its results are not transferable.

**Exit check:** Paired replies on the same model and context retain relevance,
factual grounding and Haru's character. User ratings favor the new behavior;
animation has no abrupt switching or conflict with speaking. Ship each area
independently so an unsuccessful tone or animation change can be disabled alone.

## Comparison and promotion criteria

Use three conditions with the same observations and current model configuration:

1. Existing behavior with corrected activity inputs.
2. A simple deterministic attention/timing rule using those same inputs.
3. The fly-inspired persistent competition using those same inputs.

This distinguishes benefits from better inputs, ordinary rules and the particular
controller. Freeze versions and criteria before collecting comparative results.
Use counterbalanced sessions for live comparisons, balancing work, conversation,
quiet use and time of day. Do not present repeated samples within one session as
independent evidence, or count missing ratings as approval.

Record opportunity, proposal, suppression reason, attempt, channel acceptance,
actual presentation when observable, and explicit feedback under a common ID.
Keep private content out of diagnostics. Reuse existing feedback mechanisms;
do not interrupt the user merely to request ratings.

Promotion requires:

- All invariant tests pass; no quiet-hour, opt-out, conversation, reminder or
  delivery-spacing violations.
- Known-input coverage spans the situations being claimed. Unknown coverage is
  reported, not quietly discarded or relabeled as absence.
- Helpful-versus-unwanted nudge feedback improves without material loss of useful
  opportunities. Report counts and session-level uncertainty; collect more data
  when evidence is too sparse to distinguish the alternatives.
- Reply quality and latency do not regress. No extra background model calls in
  the observation/attention loop; pre-generation denials should save calls.
- Fly-inspired behavior must outperform the simple control to justify retaining
  the additional state. If it does not, ship the input fixes and simpler rule.

Preference learning is a later project, contingent on sufficient explicit feedback
about the actual affected decisions. Existing chat thumbs do not supply training
labels for unperformed nudges.

## Delivery order and rollback

Use five reviewable changes: **observations → mood inputs → runtime/shadow adapter
→ optional-nudge pilot → independently tested chat/expression adapters**.
The fifth change may split further; do not bundle all behavior into one release.

For each stage, reconcile the current server source in an isolated integration
branch, preserve unrelated work, commit the focused change, test/build locally
and on the server, back up affected source/build files, deploy and verify health
plus a fresh diagnostic record. Record the exact applied patch and runtime/model
versions. Do not copy configuration, credentials or memories between checkouts.

Behavior can return to shadow/off without removing observation data or resetting
Haru's mood and memory. Application rollback restores the previous source/build.
Use a consistent millisecond clock for deployment verification; the earlier shell
date format returned nanoseconds on this server.

**First implementation milestone:** stages 1–3, ending in a stable, fully observed
shadow run against Haru's current structure. This produces the evidence and small
integration points needed for a controlled live nudge pilot.
