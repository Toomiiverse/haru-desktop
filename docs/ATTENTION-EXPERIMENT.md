# Attention experiment

Haru runs a small fly-inspired attention controller in **shadow mode**. It never
changes prompts, animation, tool use, reminders, notification gates or speech.
It uses no FlyWire data, spiking neurons, new dependency, model call or GPU.

## Inputs and proposals

At each existing idle-speech check, energy, curiosity, focus, stress and sleepiness
compete through leaky scores for attend, investigate, speak and rest. Desktop
activity category changes renew novelty; repeated observations reduce it.
Direct interaction prioritizes attention for three minutes. Proposed speech
also respects Haru's existing longer patience rule and a ten-minute cooldown.
Small score advantages must persist for a minute before switching state; large
advantages act immediately. A gradual urge to speak builds over 15–30 quiet
minutes, moderated by focus, energy, curiosity, stress and sleepiness.

The existing interjection gate, irritation, model availability and an idle
composition already in progress inhibit proposed speech. The baseline records
the actual existing shouldPipeUp decision (including its single random draw)
with those gates. Checks skipped for reminders produce no sample. Neither proposal nor
baseline eligibility means a message was delivered. Reminder priority and
later content checks can still prevent delivery.

This is an engineering hypothesis, not a biological model. Coefficients are
hand chosen. Feedback already affects Haru's vitals; this experiment consumes
those vitals and records explicit reply feedback, but does not train a policy.
Novelty uses coarse categories, so two different coding tasks look the same.
Recent conversation timing is recovered from the saved last-message timestamp
after restart. Transient scores reset on restart; Haru's existing persisted vitals remain the
source of longer-lived state.

## Run and inspect

Enabled by default. Set HARU_ATTENTION_SHADOW=0 before starting Haru to disable.
The local userData directory contains attention-shadow.jsonl and at most one
rotated .1 file, each limited to roughly 2 MiB. Logging failure disables the
experiment for the session without stopping Haru. Only metadata is recorded:
numeric input snapshots are included, but no message bodies, window titles,
documents, feedback notes or credentials.
The adult activity category is recorded as other.

Run:

    node scripts/attention-report.cjs /path/to/attention-shadow.jsonl

The report defaults to policy 2. Append 1 to inspect the original policy
without mixing measurements.

The report includes proposed actions, eligible baseline speech, agreement,
action switching, computation time, actual aside counts, short aside gaps,
repeat rejections and latest recorded reply ratings. Rotation limits the
observation window; a missing rating is not negative feedback. Actual asides
cover noteAside callers; this does not count every push delivery or prove
whether an interruption was wanted. Latency measures controller computation,
not disk IO or language-model response time.

## Evaluation before any behavior change

Collect representative active work, quiet periods, conversation and overnight
sessions. Review missed opportunities and unwanted interruptions with the user.
Compare proposal timing and consistency with the baseline, preserving all
existing quiet-hour and reminder rules. Automated replay checks cover direct
interaction, novelty decay, sleep, inhibition, elapsed time and logging failure.

Shadow data cannot establish user preference for actions that were never taken.
Only consider a separately reviewed live trial after inspecting these results.
No claim of improved behavior or consciousness follows from this prototype.
If actual connectome wiring is added later, compare it with a matched ordinary
network to test whether the wiring contributes anything.

## Deployment and rollback

### Browser input comparison (16 September follow-up)

The authenticated web page now reports trusted `pointerdown`, `keydown`, `input`
and `wheel` events while visible, at most once per 30 seconds per page. The body
is only `{"kind":"input"}`: no key, text, position, event type, device ID or URL.
Loading a page, a visibility change and the existing history/nudge polling never
produce this signal. Native fetch has a five-second timeout and no retry or queue.
The server accepts only the exact body, behind its existing login and JSON gate.

`AttentionExperiment.webInput()` keeps one receipt timestamp in memory. It does
not call `noteUserSpoke`, reset conversation silence, update live vitals, save
presence to the user store, or trigger any action. Browser `isTrusted` filters
script-dispatched events; authenticated clients can still fabricate a request,
so this is **browser-reported input**, not verified human attention.

Each sample now has additive `webInput` and `webShadow` fields. For up to five
minutes after receipt, the second policy receives the age of that input as idle
time. After that, or following a restart/clock rollback, evidence is `unknown`
and the reported alternative action is `null`. Unknown samples cannot propose
speech. The internal policy continues stepping so its cooldown survives a gap.
The original policy and all production decisions remain unchanged.

Both policies still use the recorded host-driven vitals, category and blockers.
This isolates the idle signal; it does not fix mood/focus inputs or predict the
consequences of acting on the proposal. A recent tap also does not prove continued
presence, and reading without input becomes unknown. Input outside Haru's web
page, including other applications in the native desktop, is not measured.

The report's `webInputComparison` separates known coverage, unknown coverage,
disagreement and proposed speech. `research/fruitfly/replay-shadow.cjs` verifies
both states where the additive fields exist and still reads earlier logs. Raw
logs retain the same two-file, 2 MiB-per-file bound; larger samples mean a shorter
retained time window. `computeMs` measures the original policy; `webComputeMs`
measures the additional comparison. Neither includes file IO or model calls.

Reload an already-open browser page once after deployment to load the reporter.
No new login is required when the existing session remains valid. The global
`HARU_ATTENTION_SHADOW=0` switch disables collection and both policy evaluations;
the page's content-free requests may continue until the page is closed.

### Applying a change

Build and test the isolated feat/attention-shadow branch. Deploy its reviewed
commit onto the server's current Haru branch (cherry-pick if it has additional
server changes), build using the server's existing install procedure, and
restart with its existing service manager. Never copy local config.json over
the live server's memories or credentials. Verify the running process and a
fresh sample in the log. Roll back with HARU_ATTENTION_SHADOW=0 and restart;
reverting the feature commit also removes its integration.

Background: https://www.nature.com/articles/s41586-024-07763-9
Limitations: https://eon.systems/updates/embodied-brain-emulation
