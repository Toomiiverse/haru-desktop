# Fruit-fly mechanisms for Haru — overnight protocol

Started 16 September 2026, approximately 03:15 Australia/Perth. Report due 08:00.
This protocol is written before the new retrieval and learning measurements.

## Question

Can the actual adult fly connectome, or a specific algorithm studied in flies,
improve a measurable part of Haru? A biologically named variable is not evidence.
Language quality, user preference, timing, stability and computational cost are
different outcomes and must be reported separately.

## Experiments and controls

1. **Memory and repeated nudges:** sparse expansion and winner-take-all (FlyHash)
   versus exact cosine, keyword matching, and an equally sized random projection.
   Use Haru's installed embedding model on invented companion-related examples.
   Report semantic relevance, nearest-neighbour recall, index size, and runtime.
   The embedding model supplies semantics; the hash does not learn language.
2. **Actual wiring:** inspect the publicly released v783 graph and annotations.
   Extract the olfactory projection-neuron to Kenyon-cell subgraph, if annotation
   coverage permits. Compare its connectivity with degree-matched random wiring
   using identical input encodings and readouts. Shuffle input assignments across
   seeds; arbitrary mappings from text features to olfactory neurons are a major
   limitation. Do not call an anatomical projection a whole-brain emulation.
3. **Preferences and feedback:** test sparse associative learning with a reward
   prediction error against a simple context table and a linear learner on
   simulated, explicitly labelled feedback. Separate familiar contexts, held-out
   combinations, changing preferences and noisy feedback. Silence is missing
   evidence, not a negative rating. Report adaptation time and prediction error.
4. **Mood and emotion:** replay Haru's existing event and emotion updates. Measure
   saturation, reversal, noise sensitivity and recovery. Compare any proposed
   persistence mechanism with an ordinary exponential moving average. Numerical
   smoothness does not establish more believable emotion or actual feelings.
5. **Attention and nudges:** retain the existing policy-2 shadow experiment. Replay
   metadata against recorded inputs, inspect long-run timing and state transitions,
   and collect fresh server observations near the report deadline. No live rating
   means no evidence that fewer proposals are preferred.

## Evaluation rules

- Declare development/held-out splits before seeing model scores. Fix algorithm
  settings on development only; retain failed variants in results.
- Use multiple fixed seeds. Report ranges or uncertainty, sample counts and
  hardware. Synthetic fixtures are an engineering screen, not a clinical or
  human-user study, and are not representative of all conversations.
- Compare equal information and training feedback. Keep exact cosine as the
  quality ceiling for approximating those vectors, not as semantic ground truth.
- Include mapping/encoding cost in timing and distinguish warm from cold work.
- Use only invented text for direct model calls. Never send actual Haru messages,
  memories or credentials to a new service. Existing Ollama runs locally.
- Keep downloaded datasets and optional analysis libraries outside the app and
  outside Git. Record source revisions, checksums and attribution.
- Production stays in shadow mode. A candidate needs useful held-out results and
  tests before any integration; the overnight deadline alone is no reason to ship.
- Commit reproducible scripts, small fixtures, results and the final report to the
  feature branch. Preserve the server's unrelated uncommitted work.

## Initial evidence already available

Policy 2 fixed three reproduced defects in the first hand-written attention
experiment. The full local suite passed 1,120 tests and the server suite 1,517.
A synthetic day produced 18 shadow proposals versus a baseline mean of 52.5;
this is a count difference, not a demonstrated user benefit. No actual FlyWire
connectivity has been involved in that controller so far.

## Follow-up registered after the first small retrieval run, 03:25

The 64 held-out invented-memory questions have a high baseline ceiling (63/64
for cosine). The real circuit did not beat degree-preserving rewiring across 20
seeds. Similarity alone also failed on meaning-changing nudge pairs. Retain these
results and add an independent public benchmark rather than tune on these labels.

- BANKING77 (Casanueva et al., 2020): official 10,003 training and 3,080 test
  utterances, 77 intent labels. Use all training utterances as the index and the
  official test set as queries. Report nearest-neighbour intent accuracy, exact
  neighbour recall, and runtime. This is a constrained language benchmark, not
  a Haru preference evaluation. No test-label tuning.
- Freeze the primary 5-synapse anatomical threshold, 5% winners and six inputs per
  synthetic expansion cell. Run seeds 0–4 on this larger dataset.
- Add an exploratory homeostatic variant: standardise each expansion cell's
  response using the indexed training examples only, then take 5% winners.
  Apply the same normalisation to the real and rewired graphs. It tests whether
  activity calibration helps; ordinary statistical normalisation is the control.
- Inspect thresholds 1 and 10 on the original fixtures as sensitivity analyses,
  not as new confirmation or as grounds to cherry-pick a best threshold.

## Learning control added after initial results, 03:41

The sparse learners handled a two-cue interaction better than the plain linear
model. That is not sufficient evidence for biological wiring: a linear model
cannot represent XOR in its original inputs. Add all pairwise cue products as a
16-parameter control, using the same development learning-rate selection and
held-out seeds. This is an exploratory control added after observing the original
comparison, not a newly untouched test set. Keep the original methods and their
results in the comparison.

## Retrieval improvement follow-up, approximately 04:10

Packed FlyHash is slower than current vector search at the observed 98-active-
chunk scale. It is faster at 10,003 candidates, but loses exact neighbours. Test
exact cosine reranking of the best **40** hash candidates, fixed to match Haru's
default vector candidate-pool size. Retain full vectors, account for the extra
index rather than claim memory savings, and include query hash computation in
timings. Repeat BANKING77 across seeds 0–4 for this changed algorithm; this is an
exploratory improvement using an already examined benchmark, not a fresh test set.

## External emotion check, approximately 04:30

The completed-label prompt improved agreement on invented lines. Before looking
at predictions on a public dataset, fix this additional test: GoEmotions official
test split, single-label comments only; 12 comments per mapped category, selected
by the SHA-256 ordering of `haru-goemotions-20260916:<comment id>`. The categories
are neutral, joy→happy, curiosity→curious, annoyance→annoyed,
embarrassment→embarrassed, nervousness→worried, and surprise→surprised. There are
only 12 eligible nervousness examples, which fixes the balanced sample size.

Run all 84 lines with the unchanged before/after prompts, two mood settings and
seeds 17 and 43 (672 calls). No prompt tuning or production change based on this
test. Report label agreement and paired changes, not general accuracy: Reddit
emotion annotations do not specify an animated companion's delivery, and some
mapped labels differ in scope. Four Haru emotions and affection are not covered.
The public text stays in the research cache; commit only IDs, hashes, predictions
and aggregate results. This extends the earlier synthetic-only model-call rule
to this public, human-annotated dataset on the same local Ollama provider.

## Exploratory mood-context ablation, approximately 04:50

The external check returned low agreement and classified 124/168 comments as
smug under the irritated/high-ego context. This motivates a separate follow-up.
It supersedes the earlier no-prompt-tuning stopping rule **for offline research
only**; the original comparison remains frozen, all results remain reported,
and no production prompt change will be made from this follow-up.

Before predictions, fix three conditions: current complete definitions; the same
prompt with an explicit instruction that words outrank background mood when the
emotion is clear; and the same prompt with the background mood sentence omitted.
Use up to 20 single-label comments for each of the same seven mapped categories
from the previously unused official **dev** split (128 total; nervousness has
only eight), selected by SHA-256 order of `haru-mood-ablation-20260916:<id>`.
Require no ID overlap with the original test sample. Add the six existing
reported-emotion challenges as a separately labelled, previously seen probe.

Run two moods and seeds 17/43 for all three conditions (1,608 calls). Repeating
the identical no-mood prompt under each nominal mood is a duplicate control,
not an additional independent sample. Report micro and per-category agreement,
paired changes and mood sensitivity. This is a new exploratory hypothesis using
a separate split, not confirmation of the original fly-brain hypothesis, and
emotion agreement is still not a rating of preferable character delivery.
