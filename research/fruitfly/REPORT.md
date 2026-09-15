# Can a fruit-fly brain improve Haru?

**16 September 2026 · Australia/Perth · draft for the 08:00 report**

## Recommendation

Keep the actual fly connectome in research for now. The anatomical circuit tested
here reduced retrieval quality and did not outperform a control with shuffled
wiring. There is no measured improvement in Haru's conversational quality,
believability, or user preference from using that wiring.

Specific fly-inspired algorithms are more useful candidates. A sparse hash with
exact reranking becomes faster when searching about 10,000 vectors, but is slower
at Haru's current 98-active-chunk scale. The attention experiment can express
persistence and competing drives, but remains shadow-only because useful timing
and user preference have not been demonstrated in representative live use.

The investigation did produce two deployed improvements: elapsed-time-correct
mood drift and complete definitions for the emotion classifier. These are ordinary
Haru engineering fixes, not benefits attributable to the fly connectome.

| Haru area | Evidence from this investigation | Decision |
|---|---|---|
| Chat and memory | Actual wiring lost relevant memories; no answer-quality advantage | Keep current retrieval |
| Large memory collections | FlyHash plus exact reranking improved matching speed near 10,000 candidates | Retain the prototype; revisit only if retrieval becomes a bottleneck |
| Nudges and attention | Shadow policy fixed timing defects; fewer synthetic proposals are not evidence of preference | Continue shadow mode and obtain meaningful activity/feedback observations |
| Repeated nudges | Embedding similarity confused paraphrases with changed meanings | Do not use similarity alone to suppress messages |
| Mood | A real elapsed-time bug made recovery depend on timer cadence | Fixed, tested and deployed |
| Emotion expression | Missing label definitions caused avoidable classification errors | Definitions added; scope and external check below |
| Learning preferences | Simple controls matched or beat the anatomical learner; little usable live feedback | No online learner deployed |
| Gaze, gestures and embodied behavior | Existing movement blending already provides continuity; fly sensory/motor mappings do not transfer directly | No demonstrated benefit; no movement changes |

## What “using the fly brain” means here

The adult FlyWire reconstruction is an anatomical map. The original publication
reports 139,255 neurons and approximately 50 million synapses. It does not supply
a ready-made language model or a complete specification of a person's emotions.
Our downloaded export contains 138,639 represented neurons and 54,492,922 synapses;
different exports and annotation snapshots should not be conflated with the
publication's headline count. [FlyWire paper](https://www.nature.com/articles/s41586-024-07558-y)

The connectome-constrained whole-brain model studied by Shiu and colleagues is
evidence that wiring can predict some fly behavior. Its reported 91% result
concerns tested neuronal activation experiments, not general intelligence or
conversational competence. Important physiological details are simplified or
missing. [Whole-brain model](https://www.nature.com/articles/s41586-024-07763-9)

Eon's embodied demonstration adds engineered sensory/motor interfaces and existing
low-level body controllers. Its technical account describes limited behaviors and
missing learning, internal-state and biological validation work. That makes it an
interesting robotics research starting point, not a validated companion controller.
[Eon technical account](https://eon.systems/updates/embodied-brain-emulation)

This investigation distinguishes three things:

1. **Actual anatomical wiring:** a labelled olfactory projection extracted from
   the public graph, tested against degree-preserving rewiring.
2. **Fly-inspired algorithms:** sparse expansion, selecting the strongest 5% of
   responses, competing persistent action scores, and reward-error learning.
3. **Ordinary Haru fixes:** prompt definitions and elapsed-time handling.

No whole-brain, spiking, or embodied simulation was installed in Haru. No test
establishes subjective feelings or consciousness. Negative results for one mapped
projection do not rule out every future use of fly circuits.

## 1. Actual connectivity: a controlled test

The primary projection uses left-hemisphere uniglomerular olfactory projection
neurons, predicted to release acetylcholine, connected to left Kenyon cells.
Keeping connections with at least five synapses gives **112 input neurons,
2,336 output cells, 10,317 connections and 164,433 synapses**. Median incoming
degree is five. Source revisions, hashes and selection rules are in
[connectome-stats.json](connectome-stats.json) and
[extract_connectome.py](extract_connectome.py).

All methods received the same 768-dimensional embeddings from Haru's installed
`nomic-embed-text` model. An arbitrary random bridge converted these embeddings
to nonnegative input rates for the anatomical circuit. That bridge is a major
limitation: text has no established correspondence to fly olfactory inputs.

Controls included exact cosine search, current Haru hybrid retrieval, FlyHash,
an equally sized SimHash, the bridged input rates without the circuit, and
shuffled wiring preserving **both** input and output degree sequences. Binary,
synapse-weighted and normalized variants were retained, including failures.

### Invented companion memories

There were 64 memories and 128 questions. Topic groups, not paraphrases of the
same topic, were split into 64 development and 64 held-out questions. The primary
projection ran across 20 seeds. Higher top-one accuracy is better.

| Method | Held-out correct first memory |
|---|---:|
| Exact cosine | 98.44% (63/64) |
| Current Haru hybrid retrieval | 96.88% (62/64) |
| SimHash, same number of bits | 94.22% |
| FlyHash | 90.86% |
| Input-rate cosine, before the anatomical circuit | 84.77% |
| Actual wiring, binary | 68.98% |
| Degree-preserving shuffled wiring | 69.77% |
| Actual wiring, synapse weighted | 60.78% |

Actual minus shuffled wiring averaged **−0.78 percentage points**; actual wiring
won on eight seeds and tied on three. Thresholds of one and ten synapses did not
produce an anatomical advantage either. These small, invented examples have a
high baseline ceiling and are not a representative sample of Haru conversations.
[Primary results](retrieval-results-5.json), [threshold 1](retrieval-results-1.json),
[threshold 10](retrieval-results-10.json)

### Independent public language benchmark

BANKING77 supplies an official 10,003-example training index and 3,080 test
questions across 77 banking intents. There were no identical train/test texts.
Settings were frozen before this benchmark; five seeds were run. The measure is
whether the nearest example has the correct intent, not whether Haru gives a good
answer. [Dataset and paper](https://github.com/PolyAI-LDN/task-specific-datasets)

| Method | Correct nearest-neighbor intent |
|---|---:|
| Exact cosine | 92.99% |
| SimHash, same bit count | 92.79% |
| FlyHash | 91.69% |
| Input-rate cosine | 90.73% |
| Actual wiring, binary | 86.05% |
| Degree-preserving shuffled wiring | 86.30% |
| Actual wiring with activity standardization | 84.71% |
| Shuffled wiring with the same standardization | 85.36% |

Actual minus shuffled wiring was **−0.25 percentage points**. A paired descriptive
bootstrap over algorithm seeds and intent groups gave a 95% percentile interval
of **−1.23 to +0.64 points**. Actual wiring versus exact cosine was **−6.94 points**
(interval −8.39 to −5.66). These intervals describe the tested benchmark and five
seeds; they are not population estimates for Haru users.
[Results](banking-results.json), [uncertainty checks](uncertainty-results.json)

Activity standardization was motivated by research on compensating for variable
Kenyon-cell responses. Our standardization is an engineering approximation, not
a reproduction of that paper's biophysical model. It used index examples only,
without test labels, and did not rescue this text mapping.
[Homeostatic compensation study](https://pmc.ncbi.nlm.nih.gov/articles/PMC8670477/)

### Does the retrieved memory improve a generated answer?

The same local Qwen model answered 64 held-out invented questions under four
memory conditions: 256 isolated calls. The prompt required a supporting memory
ID or an explicit unknown response. It did not include the full Haru persona or
tool pipeline.

| Memory condition | Relevant evidence retrieved | Correct supporting source | Wrong source | Abstained |
|---|---:|---:|---:|---:|
| Current Haru | 64/64 | 63/64 | 1 | 0 |
| FlyHash | 64/64 | 63/64 | 1 | 0 |
| Actual wiring | 61/64 | 61/64 | 2 | 1 |
| No memory | 0/64 | 0/64 | 0 | 64 |

One anatomical retrieval failure substituted a climbing preference for a tired
person's preference for a gentle walk. Another confused requesting a practical
plan with venting. The source-selection score does not prove every answer detail
was faithful, natural or preferable. Only one retrieval seed and one model seed
were used for this follow-up. [Results](grounding-results.json)

## 2. A useful fly-inspired option at larger scale

FlyHash expands an input into many sparse responses, then retains the strongest
small fraction. The concept is studied as a similarity-search algorithm; it does
not require importing the actual connectome. Our version uses six inputs per
output and 117 winners among 2,336 outputs.
[Original FlyHash paper](https://cseweb.ucsd.edu/~dasgupta/papers/fly-lsh.pdf)

Raw hashes lost neighbors, so a follow-up retrieved 40 hash candidates and ranked
those using their original cosine scores. On the full BANKING77 test set, averaged
over five seeds, this recovered **98.94% of the exact top-five neighbors** and
**99.69% of exact first neighbors**. Intent accuracy was **92.94%**, versus 92.99%
for full exact search. This was an exploratory follow-up on an already examined
benchmark. [Reranking results](rerank-results.json)

Warm server timing included computing the query hash. Each condition used 64
queries, five repetitions and eight warmups on the server's i7-6700K with Node
22.22.1. Embedding/model latency and index construction were excluded equally.

| Active vectors | Current Haru vector search, median | FlyHash + exact rerank, median |
|---|---:|---:|
| 98, plus 5,075 inactive records | 0.154 ms | 0.807 ms |
| 1,000 | 1.287 ms | 1.014 ms |
| 10,003 | 14.609 ms | 2.974 ms |

The largest case is about **4.9× faster for this matching stage**, saving about
12 ms. It is not a 4.9× faster conversation. Haru currently has only **98 active
chunks**, so adopting it now would add complexity and increase matching time.
The reranker also retains full vectors plus the hash index; it saves no total
vector-storage memory. Timing samples and full-benchmark neighbor recall are
different measurements. [Server timings](hash-timing-rerank-server.json)

## 3. Nudges and attention

The deployed policy-2 experiment computes four persistent competing scores:
attend, investigate, speak and rest. It is hand-written and fly-inspired; no
anatomical wiring is involved. Its proposals are logged and **do not drive Haru's
speech, prompts, movement or mood**.

Earlier tests reproduced and fixed speech during frequent conversation, premature
speech before Haru's patience gate, and indefinite dependence on the initial
state. A synthetic 24-hour comparison produced 18 shadow speech proposals versus
a current-policy mean of 52.5 across seeded runs. Fewer proposals may be helpful
or may make her too quiet; no preference rating establishes which.
[Detailed comparison](../../docs/ATTENTION-COMPARISON.md)

The duplicate-nudge experiment used 32 pairs split equally into development and
held-out sets. Exact embedding similarity incorrectly suppressed **six of eight**
held-out meaning-changing examples; balanced accuracy was 43.75%. Paraphrases,
negation and changed entities can remain close in embedding space. The current
exact-text echo component missed paraphrases but did not suppress those changed
meanings. Haru's separate prompt-level repetition instructions were not measured
by that component test. [Pair results](retrieval-results-5.json)

### Live observations — final collection pending at 08:00

At approximately 04:00, the service was healthy after the latest deployment.
An observation process samples service health, HTTP status and attention metadata
every ten minutes through 08:00. It does not send messages or stimulate Haru.

An important limitation is already clear: the recorded idle timer belongs to the
**server OS**, currently around 12 days, and window focus belongs to its virtual
desktop. These are not measurements of the user's PC or phone activity. Overnight
agreement while resting cannot establish useful daytime attention. Final sample
counts, numeric replay checks and service status will be inserted after collection.

## 4. Moods: a real timing bug fixed

Haru previously capped each mood-drift call at 20 seconds. A callback delayed for
five minutes therefore advanced mood by only 20 seconds. Recovery depended on
how often the timer fired.

The fix processes elapsed time in existing 20-second steps, bounded to one hour
per call, and ignores invalid/backward elapsed values. Normal 20-second behavior
is preserved. A fixed current environment cannot reconstruct changing conditions
during a long absence; the one-hour bound is intentional.

In a controlled ten-minute work scenario starting at stress 0.9 and happiness
0.2, stress ended as follows:

| Callback interval | Before | After |
|---|---:|---:|
| 20 seconds | 0.2618 | 0.2618 |
| 60 seconds | 0.4210 | 0.2618 |
| 300 seconds | 0.7477 | 0.2618 |

Regression tests first failed against the old implementation and passed with the
fix. This is a timing correction, not a judgment that Haru should always be less
stressed. [Change details](../../docs/VITALS-TIMING.md)

Additional synthetic event streams stayed finite and bounded. High-confidence
“worried” events every ten seconds reached stress ≥0.95 within 30 seconds; every
60 seconds they did not. After a five-minute rapid burst, stress returned within
0.05 of baseline after seven minutes in the fixed active environment. Alternating
happy/annoyed events could still accumulate stress. These rate effects identify
something to evaluate with actual desired behavior, not grounds to arbitrarily
rewrite her personality. [Affect replay](affect-results.json)

Fly research does offer useful design ideas for internal states: repeated stimuli
can create persistent, scalable defensive arousal, and sleep regulation includes
slow homeostatic dynamics. More recent work also implicates glia and metabolism,
which a neuron-to-neuron connection matrix alone does not specify. My engineering
inference is that persistence, bounded accumulation and recovery are worth testing
as explicit mechanisms; copying anatomy is not sufficient to obtain them in a
companion. Haru already has accumulating and decaying state variables.
[Persistent arousal study](https://pubmed.ncbi.nlm.nih.gov/25981791/),
[glial homeostasis study](https://www.nature.com/articles/s41593-025-01942-1)

## 5. Emotion classification

“Determined” and “worried” were accepted labels but had no definitions in the
classifier prompt. Adding their definitions improved agreement on invented
held-out lines while keeping the same model, sampling options and inputs.

There were 48 clear lines, half development and half held out, plus six separate
reported-emotion challenges. Two moods and two seeds produced 432 total calls.
The held-out sample is **24 distinct lines**, repeated under four settings, not
96 independent examples.

| Held-out setting | Before | Complete definitions |
|---|---:|---:|
| Calm | 40/48 | 48/48 |
| Irritated | 38/48 | 44/48 |
| Combined | 78/96 (81.25%) | 92/96 (95.83%) |

Sixteen paired calls became correct and two became incorrect. Both new errors
concerned the same happy line under irritated context. A line-cluster bootstrap
gave an improvement interval of 0 to 31.25 percentage points, illustrating the
small sample. Reported-emotion challenges did not improve and remained strongly
sensitive to the supplied mood; their expected neutral delivery may itself be
debatable. All outputs were parseable.

This measures agreement with authored labels before tone sharpening or rendered
animation. It does not establish more natural expression. The additional
GoEmotions human-annotated regression check is running and will be reported here
without changing the prompt in response to its results.
[Experiment details](../../docs/EMOTION-CLASSIFIER.md),
[invented-line results](emotion-results.json)

## 6. Learning preferences

Reward-error learning in the mushroom body is a useful scientific hypothesis.
A comparable delta-rule learner is straightforward without a connectome.
[Mushroom-body learning model](https://www.nature.com/articles/s41467-021-22592-4)

The simulation used 32 context combinations, 24 observed and eight withheld,
1,000 opportunities and approximately 200 explicit ratings per run. Missing
feedback caused no update. All models received the same reward stream and update
rule. Development seeds selected learning rates; 20 held-out seeds tested each
profile. Learned output weights were not anatomical fly output-neuron weights.

Mean prediction error on **unseen contexts** is below; lower is better:

| Simulated preference | Linear, 6 parameters | Pairwise cues, 16 parameters | Sparse expansion | Actual wiring | Shuffled wiring |
|---|---:|---:|---:|---:|---:|
| Additive cues | 0.0158 | 0.0392 | 0.0275 | 0.0367 | 0.0372 |
| Two-cue interaction | 0.2063 | 0.0451 | 0.0955 | 0.0972 | 0.1005 |
| Arbitrary preferences | 0.1580 | 0.1358 | 0.1522 | 0.1359 | 0.1400 |
| Preferences reverse midway | 0.0272 | 0.0739 | 0.0322 | 0.0521 | 0.0514 |

Sparse expansion beats an insufficient plain linear model on an interaction,
but a simple pairwise-cue control beats sparse expansion there. That control was
added after initial results and is labelled exploratory. A context table is
strong on familiar arbitrary preferences; no method can reliably infer arbitrary
preferences in contexts never rated. No unique anatomical advantage emerged.
[Full learning results](learning-results.json)

Live metadata contained 63 feedback rows, 54 distinct reply IDs and only 53 valid
latest ratings: **47 positive and six negative**, spanning three model
configurations. These concern chat replies, not shadow proposals. This is far
less and more selected feedback than the simulation. Silence must not be treated
as a negative rating. No online preference learner was activated.

## 7. What changed on the server

The feature branch is `feat/attention-shadow` in
[Toomiiverse/haru-desktop](https://github.com/Toomiiverse/haru-desktop).

| Commit | Change | Production effect |
|---|---|---|
| `67b9170` | Initial attention experiment | Shadow diagnostics only |
| `57713d7` | Attention patience, persistence and replay fixes | Shadow diagnostics only |
| `f04fb52` | Elapsed-time mood drift | Corrected live mood timing |
| `8e07a6f` | Determination/worry definitions | Complete live classifier prompt |

The four commits were pushed and their changes applied to
`toomii@haruserver:/home/toomii/haru-desktop`. The server's branch/HEAD was not
moved, and unrelated uncommitted work was preserved. Backups and inverse patches
are under `/home/toomii/.local/state/haru-deployments/`.

After the latest application change, **1,123 local tests and 1,520 server tests
passed**, and builds passed. The server suite includes additional existing work,
so its test count differs. Research evaluation checks also passed. Existing build
warnings were unchanged. The service was restarted at 03:58:37 Perth; final health
verification is pending the 08:00 snapshot.

## Next steps, in order

1. Keep the deployed timing and definition fixes, with normal usage observation.
2. Establish which client activity signals actually reach the server before
   judging or activating attention proposals. Collect ratings tied to proposed
   nudges and their context; reply ratings alone do not answer that question.
3. Evaluate conversational and emotional naturalness on representative dialogue
   with human judgment. Numeric mood stability and classifier agreement are
   different from a preferable companion.
4. Revisit approximate memory search only if the active index grows and profiling
   shows meaningful latency. The tested reranker is a candidate, not a production
   requirement, and should also face standard approximate-search alternatives.
5. If pursuing embodied behavior later, choose one task with a valid sensory/motor
   interface and a simple baseline. Do not infer a useful chat or emotion module
   merely from a neural circuit's name.

## Reproducibility and limits

[PROTOCOL.md](PROTOCOL.md) records initial hypotheses and when follow-up controls
were added. [README.md](README.md) describes scripts and reproduction. Results
include unsuccessful methods rather than a selected winning seed. Downloaded
graphs, datasets, embeddings and optional analysis libraries remain outside Git
and outside the app runtime. Model-call data was invented or public, sent only
to the existing local Ollama service. Private conversations were not used.

The study spans one embedding model, one local chat model, small synthetic
companion fixtures and a banking-domain benchmark. There is no human preference
trial, no independent rating of conversational naturalness, and no representative
daytime live attention trial. The overnight result supports bounded engineering
decisions; it does not settle whether every fly-inspired design could help Haru.
