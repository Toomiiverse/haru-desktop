# Client input experiment

**16 September 2026.** Follow-up to [the daytime audit](DAYTIME-FOLLOWUP.md).

## Implemented

Haru's browser page can now supply a short-lived, content-free input signal on
phones or computers. The server compares the existing fly-inspired attention
policy with the same policy using this input's age instead of the server's idle
timer. This remains a shadow experiment: neither branch can change Haru's speech,
prompts, mood or actions.

It addresses the specific limitation found in the daytime audit: conversation
alone stops being useful presence evidence before the idle-speech window opens.
Browser input can arrive independently of conversation, such as scrolling through
the page. It does not establish activity elsewhere on the user's computer.

## Tests and interpretation

The local production build passed, and **1,128 tests passed**. Existing Vite
configuration/CSS warnings remain. New behavioral checks establish that:

- Loading, visibility changes, hidden tabs and script-dispatched input do not
  report activity. Failed input requests are never replayed after reconnecting.
- Real page input is limited to one request per 30 seconds, with one request in
  flight and a five-second timeout. The payload contains no event contents.
- The endpoint rejects anonymous callers, non-JSON requests, malformed shapes,
  extra fields and client-supplied timestamps.
- Evidence expires to unknown after five minutes and starts unknown on restart.
  Speech cooldown survives missing evidence; invalid or older timestamps cannot
  overwrite a newer receipt.
- The original attention actions and scores are identical with input collection
  enabled. Recorded alternative scores can be replayed; corrupt scores fail the
  replay check.

A deliberately alert synthetic fixture demonstrates the distinction: the host
policy remains quiet with an idle server, while the browser-input comparison can
propose speech when client evidence and existing timing gates permit it. This is
a wiring/gate check, **not evidence that those proposals are wanted**. No such
synthetic input is injected into the live user observation log.

## What remains unproven

The browser must load the updated page and receive actual input before live
coverage exists. Unknown does not mean asleep or absent. Five-minute freshness
is an explicit assumption, and receipt time includes network delay. A browser
claim is not a measurement of continued attention.

The comparison retains existing vitals, focus and activity categories. Therefore
it tests one input change, not a replacement mood controller. It does not yet
measure native desktop activity outside the browser, nor collect preference
ratings for unperformed actions. The actual fly connectome is not involved.

Use the expanded attention report and replay tool after representative use.
Evaluate coverage and speech proposals separately from shared silence. Claims of
better nudges or more natural behavior still require a later live preference
comparison; this deployment does not establish them.

Operational details and rollback: [attention experiment](../../docs/ATTENTION-EXPERIMENT.md).

## Deployment verified

Commit `a19e41b` was pushed and transferred to `haruserver`. Three overlapping
sections were adapted to its newer code (HEAD `2eba05b`), preserving the server's
other changes. Its full build and **1,555 tests passed**. At 23:03:28 Perth,
a fresh sample included the new fields; the service was active, HTTP returned
200, and its automatic restart counter was zero.

The saved post-deployment snapshot contains 4,058 samples from complete sessions.
All original decisions replayed without action or numeric mismatches. Five
instrumented samples replayed the additional state; all five had **unknown**
browser input, so this verifies startup and logging, not live client coverage or
the desirability of any proposal. The known-input path is covered by the
automated browser, authenticated HTTP and policy checks above.

Results: [replay](client-input-deployment-replay.json),
[coverage](client-input-deployment-summary.json).
Backup: `/home/toomii/.local/state/haru-deployments/web-input-a19e41b-4`.
Raw snapshot: `/home/toomii/.local/state/haru-research/web-input-a19e41b`.

**Reload an already-open Haru browser page once** to load the input reporter.
