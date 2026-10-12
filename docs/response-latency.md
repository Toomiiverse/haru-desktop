# Response latency — 2026-09-29

The slow voice turns came primarily from local text generation. Two recent real
turns took 55–58 seconds to deliver any text. Whisper recognition took 0.25–0.96
seconds; local acoustic analysis measured 0.28 seconds on the supplied speech
sample and runs alongside recognition.

## Findings

The old local reply path generated a draft with the full character/memory prompt
and a tool menu, then discarded the draft and made another request for a grounded
answer. The first request was unnecessary for simple conversation and feedback
about vocal delivery. The final answer was deliberately withheld until validated.

Background calls used an 8192-token context while chat used 20480. Ollama reloaded
the same 27B model on each change. A controlled sequence measured 7.9 seconds for
each switch, even for a two-token answer. Screenshot reading and the background
world planner also requested smaller windows on this model.

## Changes

- Chat, classification, other side jobs, vision, and world planning use the chat
  context size when sharing its model and endpoint. Separate models keep their
  existing windows; larger explicit requests are not reduced.
- Complete, narrowly recognized greetings, check-ins, current voice questions,
  and delivery feedback go directly to the existing grounded composer. It keeps
  current state, audio evidence, the conversation, provenance labels, the output
  schema, and final answer checks. No unverified draft is displayed or spoken.
- Mixed requests, actions, factual lookups, attachments, and ambiguous follow-ups
  retain the tool loop. An attached file or an augmented user message cannot use
  the shortcut. A configured hosted conversation route remains respected.
- Runtime `[latency]` lines separate draft/tool time from final composition and
  identify single-request conversational replies.

## Measurements and validation

A controlled replay of the saved slow voice-feedback turn took 29.3 seconds for
the draft (including 9.3 seconds loading and 18.0 seconds reading the prompt), then
9.7 seconds for final composition: 38.9 seconds total. The single grounded request
took 9.4 seconds with an uncached prompt and 5.0 seconds when repeated with the
prompt cache warm. This replay uses 16 offered tools and a subset of live evidence;
it is a controlled comparison, not a replay of every live turn condition.

The 133 automated checks cover routing, mixed requests, context sizes, evidence,
voice awareness, final validation, tool loops, the durable task pipeline, vision,
and world planning. Live probes extract the compiled reply and provider functions
and use synthetic voice evidence, verifying one model request per eligible turn.
They do not start a second app or write chat, memory, task, or world state.

After activation at 03:53:28 UTC, the deployed functions produced a tone-feedback
reply in 17.6 seconds including a 9.3-second initial model load. Subsequent voice
checks completed in 10.5, 4.7, and 6.3 seconds, with model load times of 1 ms.
Alternating a side-job request with a chat request then took 0.52 and 0.31 seconds
for minimal answers: both used 20480 tokens, with 2 ms and 1 ms load times. The
model remained resident at that context size. These synthetic probes verify the
deployed reply/provider functions, not microphone-to-speaker latency.

Artifacts, timings, before/after runtime backups, and the guarded deployment are
under `/home/toomii/haru-latency-20260929`. These measurements exclude microphone
capture, network delivery to the phone, and speech synthesis. Longer requests,
tool use, concurrent background inference, and cold model starts can still take
longer. The phone's complete voice round trip must be measured separately.
