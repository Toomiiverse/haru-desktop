# Fruit-fly research for Haru

Start with [REPORT.md](REPORT.md) for conclusions and [PROTOCOL.md](PROTOCOL.md)
for experiment timing and controls. This directory contains standalone research,
not a new Haru runtime dependency. No whole-brain emulator is integrated.

## Recorded environment

- Windows 11, Ryzen 9 7900X: Python 3.12.14, NumPy 2.3.5, pandas 3.0.1,
  pyarrow 25.0.1. Numerical experiments used one OpenBLAS thread.
- Linux server, i7-6700K: Node 22.22.1. Packed-search timings were measured here.
- The existing Ollama endpoint was `http://127.0.0.1:11436`. Embeddings used
  `nomic-embed-text:latest`, digest recorded in each relevant result. No prefixes
  were added, matching current Haru calls. The configured local Qwen3.5-9B GGUF
  model and digest are recorded in emotion results. Models were already installed.
- Model scripts read the server's provider configuration. They do not call Haru's
  chat endpoints, load its conversations, update its stores or deliver messages.
- Public text and binary datasets remain in an external research cache. A
  synthetic/public model call can still compete for server compute; run explicitly
  when that load is acceptable. No routine app start invokes these scripts.

## Inputs and attribution

`download_sources.py CACHE` downloads missing inputs and verifies pinned hashes;
it also verifies existing files and refuses mismatches. Choose `CACHE` outside the
checkout. The exact revisions/hashes are in `connectome-stats.json`,
`banking-results.json` and `goemotions-manifest.json`.

| Input | Source and attribution |
|---|---|
| v783 connectivity export | [Eon fly-brain data](https://github.com/eonsystemspbc/fly-brain), based on FlyWire; [original data record](https://zenodo.org/records/10676866), CC BY 4.0. No Eon implementation code was copied or integrated. |
| Neuron annotations | [FlyWire annotations](https://github.com/flyconnectome/flywire_annotations); credit Schlegel, Dorkenwald, Matsliah and Berg and colleagues as requested by that repository. |
| BANKING77 | [PolyAI dataset](https://github.com/PolyAI-LDN/task-specific-datasets), Casanueva et al. (2020), CC BY 4.0. |
| GoEmotions | [Google Research](https://github.com/google-research/google-research/tree/master/goemotions), [Demszky et al. (ACL 2020)](https://aclanthology.org/2020.acl-main.372/). Public text is downloaded separately; no comments are redistributed here. |
| Companion fixtures | Invented for this investigation; no real user memories or messages. |

The projection retains the left-side uniglomerular acetylcholine ALPN→Kenyon-cell
connections at thresholds 1, 5 and 10. Threshold 5 is primary. It is a single
feedforward circuit, with an arbitrary text-to-input bridge. The extracted graph
and optional Python dependencies are not placed in the application runtime.

## Reproduce

Commands below run from the repository root. `CACHE` is a placeholder for the
external directory. Use a research Python environment containing NumPy, pandas
and pyarrow; only extraction needs the latter two. Set `OPENBLAS_NUM_THREADS=1`
before starting numerical Python processes. The committed results capture the
original run; rerunning analysis scripts overwrites their corresponding result
JSON. Model-call runners use exclusive output creation so an earlier run is not
silently appended to or overwritten.

Compile the app's test modules using `npx tsc -p tests/tsconfig.json`, or run the
normal `npm test` suite. Research scripts import selected `dist-test` modules.

### Graph and companion retrieval

```text
python research/fruitfly/download_sources.py CACHE
python research/fruitfly/extract_connectome.py CACHE
node research/fruitfly/embed-fixtures.cjs research/fruitfly/fixtures.json CACHE/embeddings.json
node research/fruitfly/haru-baselines.cjs CACHE
python research/fruitfly/retrieval_experiment.py CACHE 20 5
python research/fruitfly/retrieval_experiment.py CACHE 20 1
python research/fruitfly/retrieval_experiment.py CACHE 20 10
```

The embedding command must reach the existing local Ollama provider. In this run,
embedding happened on the server and its output was copied to the Windows cache
for analysis. It embeds 240 unique invented strings.

### Independent language benchmark and reranking

```text
python research/fruitfly/prepare_banking.py CACHE
node research/fruitfly/embed-benchmark.cjs CACHE/banking-job.json CACHE/banking-vectors.f32
python research/fruitfly/banking_experiment.py CACHE 5
python research/fruitfly/rerank_experiment.py CACHE
python research/fruitfly/prepare_hash_timing.py CACHE
node research/fruitfly/hash-timing.cjs CACHE CACHE/timing.json REPOSITORY
```

There are 13,083 embeddings, including the official 10,003 training and 3,080 test
examples. `prepare_hash_timing.py` writes normalized float32 vectors, packed hash
codes and projection inputs; transfer those cache files when measuring on another
machine. Timings compare only vector matching. Raw FlyHash omits the cosine
admission gate; the exact-reranked variant restores it over 40 candidates.
Reranking retains full vectors and adds an index.

### Grounded answers with the current local model

```text
python research/fruitfly/prepare_grounding.py CACHE
node research/fruitfly/grounding-job.cjs CACHE/grounding-job.json CACHE/grounding-call-results.jsonl
node research/fruitfly/grounding-report.cjs CACHE/grounding-call-results.jsonl research/fruitfly/grounding-results.json
```

The runner reads provider routing from the existing server config; execute there.
The report measures selected supporting memory IDs, not general response quality.
The job contains invented notes and questions, and is held outside the repository.

### Emotion definitions and external regression check

```text
node research/fruitfly/prepare-emotion-job.cjs CACHE/emotion-job.json
node research/fruitfly/classify-emotion-job.cjs CACHE/emotion-job.json CACHE/emotion-call-results.jsonl
node research/fruitfly/emotion-report.cjs CACHE/emotion-call-results.jsonl research/fruitfly/emotion-results.json
node research/fruitfly/prepare-goemotions.cjs CACHE
node research/fruitfly/classify-emotion-job.cjs CACHE/goemotions-job.json CACHE/goemotions-call-results.jsonl
node research/fruitfly/goemotions-report.cjs CACHE/goemotions-call-results.jsonl
```

`prepare-emotion-job.cjs` reconstructs the pre-fix prompt even after the definitions
have shipped. The public check uses 84 single-label comments selected by a fixed
hash ordering, mapped into seven overlapping labels. Its manifest contains IDs,
hashes and labels, but no original comments. The same current local model, two
seeds and two mood contexts are used before/after. Agreement is not directly
comparable to the original GoEmotions paper's full multi-label F1 score.

The separately documented exploratory mood-context ablation uses the unused
official dev split, 128 public comments plus six previously seen challenges.
It compares the current prompt, words-first wording, and omitted background mood.
It is not a production change. To reproduce after preparing the emotion job:

```text
node research/fruitfly/prepare-mood-ablation.cjs CACHE
node research/fruitfly/classify-emotion-job.cjs CACHE/mood-ablation-job.json CACHE/mood-ablation-call-results.jsonl
node research/fruitfly/mood-ablation-report.cjs CACHE/mood-ablation-call-results.jsonl
```

### Preference learning and affect replay

```text
python research/fruitfly/learning_experiment.py CACHE
node research/fruitfly/affect-replay.cjs CACHE
python research/fruitfly/uncertainty.py
python -m unittest discover -s research/fruitfly -p "test_*.py"
```

Learning uses simulated feedback only. The affect replay imports current Haru
updates and tests synthetic event streams; no alternative mood controller is
deployed. `uncertainty.py` reads committed result files and reports descriptive
paired bootstrap intervals, with repeated emotion calls clustered by line.

### Attention and observation

```text
node scripts/attention-compare.cjs
node scripts/attention-report.cjs /path/to/attention-shadow.jsonl
node research/fruitfly/replay-shadow.cjs /path/to/attention-shadow.jsonl CACHE/replay.json
node research/fruitfly/attention-input-audit.cjs /path/to/attention-shadow.jsonl CACHE/input-audit.json 2026-09-16T00:00:00Z
node research/fruitfly/monitor-shadow.cjs observations.jsonl END_TIME_ISO
node research/fruitfly/observation-report.cjs observations.jsonl CACHE/observation-summary.json
node research/fruitfly/live-metadata.cjs CACHE/live-metadata.json
```

The bounded monitor is server-specific, reads health and diagnostic metadata every
ten minutes, and exits at the requested time (at most eight hours). Its report
counters are cumulative: **do not sum snapshots**. The server's local idle/focus
readings do not establish activity on the user's desktop or phone. Shadow output
does not control production behavior.

The [daytime follow-up](DAYTIME-FOLLOWUP.md) adds observed input coverage and an
offline sensitivity check. The optional start timestamp filters its report only;
complete sessions still replay from their beginning. Save both log parts before
running it: a live log can rotate during reading. The alternative holds recorded
vitals and blockers fixed and cannot predict a complete alternate day. The mood
probe is synthetic and separate. Neither experiment changes production behavior.

The [client-input follow-up](CLIENT-INPUT-FOLLOWUP.md) adds authenticated,
content-free browser input to a second shadow comparison. The ordinary report
shows its known/unknown coverage, and the replay tool verifies both recorded
policy states. Previously captured logs remain readable without these fields.

## Result interpretation

Compare anatomical wiring with its matched rewiring control before attributing
an effect to biology. Compare approximations with exact search before claiming
an improvement in retrieval. Report method seeds separately from distinct input
examples. Keep classifier agreement, memory-source selection, compute time,
proposal count and user preference as separate outcomes.
