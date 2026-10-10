"""Independent BANKING77 retrieval check. Official test labels never tune a model.

python banking_experiment.py CACHE_DIR [SEEDS=5]
The training utterances form the index; nearest neighbour predicts intent.
"""
import hashlib
import json
import platform
import sys
import time
from pathlib import Path

import numpy as np
from retrieval_experiment import rewire, unit, winners


def main(cache, seeds):
    source = (cache / 'banking-job.json').read_bytes()
    job = json.loads(source)
    meta = json.loads((cache / 'banking-vectors.f32.json').read_text())
    assert meta['sourceSha256'] == hashlib.sha256(source).hexdigest()
    assert meta['completed'] == meta['expected'] == len(job['texts'])
    vectors = np.fromfile(cache / 'banking-vectors.f32', dtype='<f4').reshape(-1, 768)
    assert vectors.shape == (meta['completed'], 768) and np.isfinite(vectors).all()
    vectors = unit(vectors)
    train_count = job['train_count']
    names, labels = np.unique(job['labels'], return_inverse=True)
    train_labels, test_labels = labels[:train_count], labels[train_count:]
    weights = np.load(cache / 'pn-kc-5.npz')['weights']
    biological = (weights > 0).astype(np.float32)
    inputs, outputs = weights.shape
    methods, exact, correct = {}, None, {}

    def evaluate(name, codes, seed=None, encode_ms=0):
        nonlocal exact
        codes = unit(codes)
        index = codes[:train_count]
        at = time.perf_counter()
        ranks = []
        ties = 0
        for start in range(train_count, len(codes), 128):
            scores = codes[start:start + 128] @ index.T
            ranks.append(np.argsort(-scores, axis=1, kind='stable')[:, :5])
            ties += int(np.sum(np.sum(np.isclose(scores, scores.max(axis=1, keepdims=True), atol=1e-7), axis=1) > 1))
        elapsed_ms = (time.perf_counter() - at) * 1000
        ranks = np.concatenate(ranks)
        if exact is None:
            exact = ranks.copy()
        hit = train_labels[ranks[:, 0]] == test_labels
        correct.setdefault(name, []).append(hit.astype(int).tolist())
        per_intent = [float(hit[test_labels == label].mean()) for label in range(len(names))]
        record = {'seed': seed, 'accuracy': float(hit.mean()), 'per_intent_accuracy': per_intent,
                  'intent_recall5': float(np.mean(np.any(train_labels[ranks] == test_labels[:, None], axis=1))),
                  'exact_neighbour_recall5': float(np.mean([len(set(a) & set(b)) / 5 for a, b in zip(ranks, exact)])),
                  'top_tie_fraction': ties / len(hit), 'encoding_ms': encode_ms,
                  'query_scoring_and_ranking_ms': elapsed_ms, 'queries': len(hit)}
        methods.setdefault(name, []).append(record)
        print(f'{name} seed={seed}: accuracy={record["accuracy"]:.4f}, recall5={record["exact_neighbour_recall5"]:.4f}, scoring_ms={elapsed_ms:.0f}', flush=True)

    evaluate('exact_cosine_768', vectors)
    for seed in range(seeds):
        rng = np.random.default_rng(seed)
        at = time.perf_counter()
        sparse = np.zeros((768, outputs), dtype=np.float32)
        for col in range(outputs):
            sparse[rng.choice(768, 6, replace=False), col] = 1
        code = winners(vectors @ sparse)
        evaluate('flyhash_direct', code, seed, (time.perf_counter() - at) * 1000)
        del code

        at = time.perf_counter()
        gaussian = rng.normal(size=(768, outputs)).astype(np.float32)
        code = (vectors @ gaussian >= 0).astype(np.float32) * 2 - 1
        evaluate('simhash_equal_bits', code, seed, (time.perf_counter() - at) * 1000)
        del code, gaussian, sparse

        at = time.perf_counter()
        bridge = rng.normal(size=(768, inputs)).astype(np.float32) / np.sqrt(inputs)
        rates = unit(np.maximum(0, vectors @ bridge))
        bridge_ms = (time.perf_counter() - at) * 1000
        evaluate('pn_rate_cosine', rates, seed, bridge_ms)
        shuffled, _ = rewire(biological, rng)
        for label, circuit in [('actual_binary', biological), ('rewired_binary', shuffled), ('actual_weighted', weights)]:
            for gain in ['raw', 'normalised', 'homeostatic']:
                at = time.perf_counter()
                gains = circuit if gain != 'normalised' else circuit / np.maximum(np.linalg.norm(circuit, axis=0), 1e-12)
                activation = rates @ gains
                if gain == 'homeostatic':
                    # Calibration uses indexed training examples only, without labels.
                    mean = activation[:train_count].mean(axis=0)
                    sd = activation[:train_count].std(axis=0)
                    activation = (activation - mean) / np.maximum(sd, 1e-6)
                code = winners(activation)
                evaluate(label + '_' + gain, code, seed, bridge_ms + (time.perf_counter() - at) * 1000)
                del code, activation
    summary = {name: {'accuracy_mean': float(np.mean([r['accuracy'] for r in rows])),
                      'accuracy_range': [min(r['accuracy'] for r in rows), max(r['accuracy'] for r in rows)],
                      'intent_recall5_mean': float(np.mean([r['intent_recall5'] for r in rows])),
                      'exact_neighbour_recall5_mean': float(np.mean([r['exact_neighbour_recall5'] for r in rows]))}
               for name, rows in methods.items()}
    differences = {}
    for gain in ['raw', 'normalised', 'homeostatic']:
        a, b = np.array(correct['actual_binary_' + gain]), np.array(correct['rewired_binary_' + gain])
        differences[gain] = {'mean_accuracy_difference': float((a - b).mean()),
                             'difference_per_seed': (a.mean(axis=1) - b.mean(axis=1)).tolist()}
    # Per-query traces stay in the cache; sufficient for paired re-analysis.
    np.savez_compressed(cache / 'banking-correct.npz', **{name: np.array(values, dtype=np.int8) for name, values in correct.items()}, test_labels=test_labels)
    result = {'created_at_utc': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
              'platform': platform.platform(), 'numpy': np.__version__,
              'dataset': {key: value for key, value in job.items() if key not in ['texts', 'labels']},
              'identical_train_test_texts': len(set(job['texts'][:train_count]) & set(job['texts'][train_count:])),
              'model': meta['model'], 'model_digest': meta['modelDigest'], 'seeds': seeds,
              'inputs': inputs, 'outputs': outputs, 'active_kc': round(outputs * 0.05),
              'methods': methods, 'summary': summary, 'actual_minus_rewired': differences,
              'limitations': ['Public constrained-domain intent task, not Haru user feedback',
                             'Numpy floating-point scoring, not packed-code production timing',
                             'Original embeddings have no task prefixes, matching current Haru',
                             'No test-label tuning; homeostatic response calibration uses index only']}
    (Path(__file__).parent / 'banking-results.json').write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps(summary, indent=2))


if __name__ == '__main__':
    main(Path(sys.argv[1]), int(sys.argv[2]) if len(sys.argv) > 2 else 5)
