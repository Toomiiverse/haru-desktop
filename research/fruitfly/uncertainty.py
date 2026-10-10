"""Paired descriptive bootstrap checks, not estimates of human preference."""
import json
from pathlib import Path
import numpy as np

HERE = Path(__file__).resolve().parent
RNG = np.random.default_rng(20260916)
REPEATS = 10000


def interval(samples):
    return np.percentile(samples, [2.5, 97.5]).tolist()


def main():
    banking = json.loads((HERE / 'banking-results.json').read_text())
    methods = {name: np.array([row['per_intent_accuracy'] for row in runs])
               for name, runs in banking['methods'].items()}
    comparisons = [('actual_binary_raw', 'rewired_binary_raw'),
                   ('actual_binary_raw', 'exact_cosine_768'),
                   ('flyhash_direct', 'exact_cosine_768'),
                   ('simhash_equal_bits', 'exact_cosine_768')]
    results = {}
    for a, b in comparisons:
        delta = methods[a] - methods[b]
        # Preserve method pairing. Resample algorithm seeds and entire intents.
        draws = np.array([delta[np.ix_(RNG.integers(len(delta), size=len(delta)),
                                      RNG.integers(delta.shape[1], size=delta.shape[1]))].mean()
                          for _ in range(REPEATS)])
        results[f'{a}_minus_{b}'] = {'mean_difference_pp': float(delta.mean() * 100),
                                    'bootstrap_95_percentile_pp': interval(draws * 100),
                                    'algorithm_seeds': len(delta), 'intent_groups': delta.shape[1]}
    emotion = [json.loads(line) for line in (HERE / 'emotion-call-results.jsonl').read_text().splitlines()]
    held = [row for row in emotion if row.get('split') == 'heldout']
    by_key = {(row['id'], row['mood'], row['seed'], row['variant']): row for row in held}
    lines = sorted({row['id'] for row in held})
    line_deltas = []
    changed = {'became_correct': 0, 'became_incorrect': 0, 'unchanged': 0}
    for identifier in lines:
        deltas = []
        for mood in ['calm', 'irritated']:
            for seed in [17, 43]:
                a = by_key[identifier, mood, seed, 'baseline']
                b = by_key[identifier, mood, seed, 'complete']
                delta = int(b['parsed']['emotion'] == b['expected']) - int(a['parsed']['emotion'] == a['expected'])
                deltas.append(delta)
                changed['became_correct' if delta > 0 else 'became_incorrect' if delta < 0 else 'unchanged'] += 1
        line_deltas.append(np.mean(deltas))
    delta = np.array(line_deltas)
    draws = delta[RNG.integers(len(delta), size=(REPEATS, len(delta)))].mean(axis=1)
    output = {'resampling_seed': 20260916, 'bootstrap_repeats': REPEATS,
              'banking': results,
              'invented_emotion': {'distinct_lines': len(lines), 'paired_calls': len(held) // 2,
                                   'mean_difference_pp': float(delta.mean() * 100),
                                   'line_cluster_bootstrap_95_percentile_pp': interval(draws * 100),
                                   **changed},
              'limitations': ['Descriptive percentile bootstrap on the tested datasets only',
                              'Five algorithm seeds give limited estimates of mapping variability',
                              'Emotion calls are clustered by line; repeated moods/seeds are not independent texts',
                              'No correction for multiple exploratory comparisons; not a population or human-preference claim']}
    public_path = HERE / 'goemotions-results.json'
    if public_path.exists():
        public = json.loads(public_path.read_text())
        delta = np.array([row['meanDifference'] for row in public['lineDeltas']])
        draws = delta[RNG.integers(len(delta), size=(REPEATS, len(delta)))].mean(axis=1)
        output['public_emotion'] = {
            'distinct_lines': len(delta), 'mean_difference_pp': float(delta.mean() * 100),
            'line_cluster_bootstrap_95_percentile_pp': interval(draws * 100),
            'became_correct': public['becameCorrect'], 'became_incorrect': public['becameIncorrect'],
        }
    (HERE / 'uncertainty-results.json').write_text(json.dumps(output, indent=2) + '\n')
    print(json.dumps(output, indent=2))


if __name__ == '__main__':
    main()
