"""Compare exact Haru retrieval, FlyHash, and an actual PN->KC projection.

All text is invented. Run after embed-fixtures.cjs, haru-baselines.cjs and
extract_connectome.py. NumPy only; no app or model mutation.
python retrieval_experiment.py CACHE_DIR [SEEDS=20] [THRESHOLD=5]
"""
import hashlib
import json
import platform
import sys
import time
from pathlib import Path

import numpy as np

HERE = Path(__file__).parent


def unit(x):
    return x / np.maximum(np.linalg.norm(x, axis=1, keepdims=True), 1e-12)


def winners(x, fraction=0.05):
    k = max(1, round(x.shape[1] * fraction))
    # Stable, deterministic ties; ties are reported, never resolved using labels.
    selected = np.argsort(-x, axis=1, kind="stable")[:, :k]
    out = np.zeros_like(x, dtype=np.float32)
    np.put_along_axis(out, selected, 1, axis=1)
    return out


def rewire(matrix, rng, swaps_per_edge=10):
    """Bipartite double-edge swaps preserve BOTH source and target degrees."""
    graph = matrix.astype(bool).copy()
    sources, targets = np.nonzero(graph)
    count = len(sources)
    successes = 0
    for a, b in rng.integers(count, size=(count * swaps_per_edge, 2)):
        u, v = sources[a], sources[b]
        x, y = targets[a], targets[b]
        if u == v or x == y or graph[u, y] or graph[v, x]:
            continue
        graph[u, x] = graph[v, y] = False
        graph[u, y] = graph[v, x] = True
        targets[a], targets[b] = y, x
        successes += 1
    assert np.array_equal(graph.sum(axis=0), matrix.sum(axis=0))
    assert np.array_equal(graph.sum(axis=1), matrix.sum(axis=1))
    return graph.astype(np.float32), successes


def rank_metrics(ranks, expected, exact, mask):
    rows = np.flatnonzero(mask)
    hits, reciprocal, recall = [], [], []
    for i in rows:
        top = list(ranks[i][:5])
        hits.append(expected[i] in top[:1])
        reciprocal.append(1 / (top.index(expected[i]) + 1) if expected[i] in top else 0)
        recall.append(len(set(top) & set(exact[i][:5])) / 5)
    return {"queries": len(rows), "accuracy_at_1": float(np.mean(hits)),
            "recall_at_5": float(np.mean([expected[i] in ranks[i][:5] for i in rows])),
            "mrr_at_5": float(np.mean(reciprocal)), "exact_neighbour_recall_at_5": float(np.mean(recall))}


def confusion(predicted, labels, mask):
    p, y = predicted[mask], labels[mask]
    tp, fp, tn, fn = [int(np.sum(test)) for test in [p & y, p & ~y, ~p & ~y, ~p & y]]
    return {"tp": tp, "fp": fp, "tn": tn, "fn": fn,
            "balanced_accuracy": (tp / max(1, tp + fn) + tn / max(1, tn + fp)) / 2,
            "precision": tp / max(1, tp + fp), "recall": tp / max(1, tp + fn)}


def nudge_metrics(scores, labels, dev):
    candidates = np.r_[np.unique(scores[dev]), np.nextafter(scores[dev].max(), np.inf)]
    # Tune on development ONLY, tie-break toward fewer suppressions.
    threshold = max(candidates, key=lambda t: (confusion(scores >= t, labels, dev)["balanced_accuracy"], t))
    return {"threshold": float(threshold), "development": confusion(scores >= threshold, labels, dev),
            "heldout": confusion(scores >= threshold, labels, ~dev),
            "positive_mean": float(scores[labels].mean()), "negative_mean": float(scores[~labels].mean())}


def main(cache, seeds, threshold):
    fixtures_bytes = (HERE / "fixtures.json").read_bytes()
    fixtures = json.loads(fixtures_bytes)
    data = json.loads((cache / "embeddings.json").read_text())
    assert data["fixturesSha256"] == hashlib.sha256(fixtures_bytes).hexdigest()
    baseline = json.loads((cache / "haru-baselines.json").read_text())
    vectors = unit(np.asarray(data["vectors"], dtype=np.float32))
    assert np.isfinite(vectors).all() and vectors.shape[1] == 768
    lookup = {text: i for i, text in enumerate(data["texts"])}
    docs, queries, expected, dev = [], [], [], []
    for ti, topic in enumerate(fixtures["topics"]):
        for fact in topic["facts"]:
            for query in fact[1:]:
                queries.append(lookup[query]); expected.append(len(docs)); dev.append(ti % 2 == 0)
            docs.append(lookup[fact[0]])
    docs, queries, expected, dev = [np.asarray(x) for x in [docs, queries, expected, dev]]
    pair_a = np.array([lookup[a] for a, b, label in fixtures["nudge_pairs"]])
    pair_b = np.array([lookup[b] for a, b, label in fixtures["nudge_pairs"]])
    labels = np.array([label for a, b, label in fixtures["nudge_pairs"]])
    pair_dev = np.arange(len(labels)) % 2 == 0
    exact_scores = vectors[queries] @ vectors[docs].T
    exact_ranks = np.argsort(-exact_scores, axis=1, kind="stable")
    weights = np.load(cache / f"pn-kc-{threshold}.npz")["weights"]
    biological = (weights > 0).astype(np.float32)
    inputs, outputs = weights.shape
    methods = {}
    individual = {}

    def evaluate(name, encoded=None, seed=None, ranks=None, encode_ms=None):
        if encoded is not None:
            encoded = unit(encoded)
            scores = encoded[queries] @ encoded[docs].T
            ranks = np.argsort(-scores, axis=1, kind="stable")
            pair_scores = (encoded[pair_a] * encoded[pair_b]).sum(axis=1)
        record = {"seed": seed, "development": rank_metrics(ranks, expected, exact_ranks, dev),
                  "heldout": rank_metrics(ranks, expected, exact_ranks, ~dev)}
        if encoded is not None:
            record["nudge"] = nudge_metrics(pair_scores, labels, pair_dev)
            record["top_score_tie_fraction"] = float(np.mean(np.sum(np.isclose(scores, scores.max(axis=1, keepdims=True), atol=1e-7), axis=1) > 1))
            record["encode_ms_all_240_texts"] = encode_ms
        methods.setdefault(name, []).append(record)
        individual.setdefault(name, []).append([int(len(row) > 0 and row[0] == target) for row, target in zip(ranks, expected)])

    evaluate("exact_cosine_768", vectors, encode_ms=0)
    evaluate("current_haru_hybrid", ranks=baseline["ranks"])
    evaluate("keyword_overlap", ranks=np.argsort(-np.array(baseline["keywordScores"]), axis=1, kind="stable"))
    for seed in range(seeds):
        rng = np.random.default_rng(seed)
        at = time.perf_counter()
        # Fixed random sparse projection, six inputs per output (FlyHash motif).
        sparse = np.zeros((768, outputs), dtype=np.float32)
        for col in range(outputs):
            sparse[rng.choice(768, 6, replace=False), col] = 1
        code = winners(vectors @ sparse)
        evaluate("flyhash_direct", code, seed, encode_ms=(time.perf_counter() - at) * 1000)

        at = time.perf_counter()
        gaussian = rng.normal(size=(768, outputs)).astype(np.float32)
        code = (vectors @ gaussian >= 0).astype(np.float32) * 2 - 1
        evaluate("simhash_equal_bits", code, seed, encode_ms=(time.perf_counter() - at) * 1000)

        at = time.perf_counter()
        bridge = rng.normal(size=(768, inputs)).astype(np.float32) / np.sqrt(inputs)
        # Engineering bridge from semantic embeddings to nonnegative firing rates.
        rates = unit(np.maximum(0, vectors @ bridge))
        bridge_ms = (time.perf_counter() - at) * 1000
        evaluate("pn_rate_cosine", rates, seed, encode_ms=bridge_ms)
        shuffled, swaps = rewire(biological, rng)
        for label, circuit in [("actual_binary", biological), ("rewired_binary", shuffled),
                               ("actual_weighted", weights)]:
            for gain in ["raw", "normalised"]:
                at = time.perf_counter()
                gains = circuit if gain == "raw" else circuit / np.maximum(np.linalg.norm(circuit, axis=0), 1e-12)
                code = winners(rates @ gains)
                evaluate(label + "_" + gain, code, seed,
                         encode_ms=bridge_ms + (time.perf_counter() - at) * 1000)
        print(f"Seed {seed + 1}/{seeds}: {swaps} degree-preserving swaps", flush=True)
    echo = np.asarray(baseline["echoPredictions"])
    paired = {}
    for gain in ["raw", "normalised"]:
        a = np.array(individual["actual_binary_" + gain])[:, ~dev]
        b = np.array(individual["rewired_binary_" + gain])[:, ~dev]
        paired[gain] = {"accuracy_difference_per_seed": (a.mean(axis=1) - b.mean(axis=1)).tolist(),
                        "mean_difference": float((a - b).mean()),
                        "actual_wins": int(np.sum(a.mean(axis=1) > b.mean(axis=1))),
                        "ties": int(np.sum(a.mean(axis=1) == b.mean(axis=1)))}
    summary = {name: {"heldout_accuracy_mean": float(np.mean([r["heldout"]["accuracy_at_1"] for r in rows])),
                      "heldout_accuracy_min": float(min(r["heldout"]["accuracy_at_1"] for r in rows)),
                      "heldout_accuracy_max": float(max(r["heldout"]["accuracy_at_1"] for r in rows)),
                      "heldout_recall5_mean": float(np.mean([r["heldout"]["recall_at_5"] for r in rows])),
                      "exact_neighbour_recall5_mean": float(np.mean([r["heldout"]["exact_neighbour_recall_at_5"] for r in rows]))}
               for name, rows in methods.items()}
    result = {"created_at_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
              "hardware": platform.platform(), "numpy": np.__version__, "model": data["model"], "model_digest": data["modelDigest"],
              "fixtures_sha256": data["fixturesSha256"], "documents": len(docs), "queries": len(queries),
              "development_queries": int(dev.sum()), "heldout_queries": int((~dev).sum()),
              "seed_count": seeds, "edge_threshold": threshold, "inputs": inputs, "outputs": outputs,
              "active_kc": round(outputs * 0.05), "methods": methods, "summary": summary,
              "actual_minus_rewired": paired, "individual_correct": individual,
              "current_echo": {"development": confusion(echo, labels, pair_dev), "heldout": confusion(echo, labels, ~pair_dev)},
              "caveats": ["Hand-authored examples; no independent human review", "Only 16 held-out nudge pairs",
                          "Arbitrary random text-to-PN mapping; not an embodied or spiking brain model",
                          "Encoding time includes projection setup; this is not a production query-time benchmark",
                          "Same vectors and text for every method; biological threshold fixed before results"]}
    output = HERE / f"retrieval-results-{threshold}.json"
    output.write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps(summary, indent=2))
    print("Paired biological minus rewired:", json.dumps(paired))


if __name__ == "__main__":
    main(Path(sys.argv[1]), int(sys.argv[2]) if len(sys.argv) > 2 else 20,
         int(sys.argv[3]) if len(sys.argv) > 3 else 5)
