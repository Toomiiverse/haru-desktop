"""Sparse associative reward learning versus simpler context learners.

This is a simulated feedback experiment, not evidence of real user preference.
python learning_experiment.py CACHE_DIR
"""
import json
import sys
from pathlib import Path

import numpy as np
from retrieval_experiment import rewire, unit, winners

PROFILES = ['additive', 'interaction', 'arbitrary', 'reversal']
RATES = [0.03, 0.1, 0.3]


def make_case(seed, profile, steps=1000):
    rng = np.random.default_rng(seed)
    bits = ((np.arange(32)[:, None] >> np.arange(5)) & 1).astype(np.float32)
    # The five cues stand for work, focus, activity, evening and recent contact.
    score = (bits - 0.5) @ np.array([-1.0, -1.2, 0.8, 0.5, -0.9])
    probabilities = 1 / (1 + np.exp(-score * 1.5))
    if profile == 'interaction':
        probabilities = np.where(bits[:, 0] != bits[:, 1], 0.85, 0.15)
    if profile == 'arbitrary':
        probabilities = rng.choice([0.15, 0.85], size=32)
    order = rng.permutation(32)
    seen = order[:24]
    held = order[24:]
    contexts = rng.choice(seen, size=steps)
    targets = probabilities[contexts].copy()
    final = probabilities.copy()
    if profile == 'reversal':
        targets[steps // 2:] = 1 - targets[steps // 2:]
        final = 1 - final
    # Same feedback stream for every learner. Unobserved ratings are never zero.
    observed = rng.random(steps) < 0.2
    rewards = (rng.random(steps) < targets).astype(np.float32)
    return {'bits': bits, 'seen': seen, 'held': held, 'contexts': contexts,
            'targets': targets, 'final': final, 'observed': observed, 'rewards': rewards}


def features(case, biological, seed):
    bits = case['bits']
    inputs = unit(np.concatenate([bits, 1 - bits], axis=1))
    outputs = biological.shape[1]
    rng = np.random.default_rng(seed + 1_000_000)
    result = {'global_average': np.ones((32, 1), dtype=np.float32),
              'context_table': np.eye(32, dtype=np.float32),
              'linear_cues': unit(np.c_[np.ones(32), bits * 2 - 1]).astype(np.float32)}
    signed = bits * 2 - 1
    pairs = np.array([signed[:, a] * signed[:, b] for a in range(5) for b in range(a + 1, 5)]).T
    result['linear_pairwise_cues'] = unit(np.c_[np.ones(32), signed, pairs]).astype(np.float32)
    sparse = np.zeros((inputs.shape[1], outputs), dtype=np.float32)
    for col in range(outputs):
        sparse[rng.choice(inputs.shape[1], 6, replace=False), col] = 1
    result['fly_sparse'] = unit(winners(inputs @ sparse))
    dense = rng.normal(size=(inputs.shape[1], outputs)).astype(np.float32)
    result['dense_random_wta'] = unit(winners(inputs @ dense))
    bridge = rng.normal(size=(inputs.shape[1], biological.shape[0])).astype(np.float32)
    rates = unit(np.maximum(0, inputs @ bridge))
    shuffled, _ = rewire(biological, rng)
    for name, circuit in [('actual_connectome', biological), ('rewired_connectome', shuffled)]:
        activity = rates @ circuit
        # Same training-only activity calibration for both topologies.
        training = activity[case['seen']]
        activity = (activity - training.mean(axis=0)) / np.maximum(training.std(axis=0), 1e-6)
        result[name] = unit(winners(activity))
    return result


def learn(encoded, contexts, rewards, observed, rate):
    weights = np.zeros(encoded.shape[1], dtype=np.float32)
    predictions = []
    for context, reward, available in zip(contexts, rewards, observed):
        x = encoded[context]
        prediction = float(np.clip(0.5 + weights @ x, 0, 1))
        predictions.append(prediction)
        if available:
            # Delta rule / reward prediction error; the same rule for all codes.
            weights += rate * (reward - prediction) * x
    return np.clip(0.5 + encoded @ weights, 0, 1), np.array(predictions)


def measure(predictions, stream, case):
    def score(indices):
        predicted, wanted = predictions[indices], case['final'][indices]
        wrong = (predicted >= 0.5) != (wanted >= 0.5)
        return {'probability_mse': float(np.mean((predicted - wanted) ** 2)),
                'decision_accuracy': float(np.mean(~wrong)),
                'decision_regret': float(np.mean(wrong * np.abs(2 * wanted - 1)))}
    return {'seen': score(case['seen']), 'unseen': score(case['held']),
            'all_mse': float(np.mean((predictions - case['final']) ** 2)),
            'prequential_mse': float(np.mean((stream - case['targets']) ** 2)),
            'after_midpoint_100_mse': float(np.mean((stream[500:600] - case['targets'][500:600]) ** 2)),
            'explicit_feedback': int(case['observed'].sum())}


def main(cache):
    biological = (np.load(cache / 'pn-kc-5.npz')['weights'] > 0).astype(np.float32)
    tuning = {}
    for profile in PROFILES:
        for seed in range(101, 106):
            case = make_case(seed, profile)
            for name, encoded in features(case, biological, seed).items():
                for rate in RATES:
                    prediction, stream = learn(encoded, case['contexts'], case['rewards'], case['observed'], rate)
                    tuning.setdefault(name, {}).setdefault(rate, []).append(measure(prediction, stream, case)['all_mse'])
        print(f'Development profile {profile} complete', flush=True)
    selected = {name: min(rates, key=lambda rate: np.mean(rates[rate])) for name, rates in tuning.items()}
    heldout = {}
    for profile in PROFILES:
        for seed in range(200, 220):
            case = make_case(seed, profile)
            for name, encoded in features(case, biological, seed).items():
                prediction, stream = learn(encoded, case['contexts'], case['rewards'], case['observed'], selected[name])
                heldout.setdefault(profile, {}).setdefault(name, []).append({'seed': seed, **measure(prediction, stream, case)})
        print(f'Held-out profile {profile} complete', flush=True)
    summary = {}
    for profile, methods in heldout.items():
        summary[profile] = {}
        for name, rows in methods.items():
            summary[profile][name] = {f'{split}_{metric}': float(np.mean([r[split][metric] for r in rows]))
                                     for split in ['seen', 'unseen'] for metric in ['probability_mse', 'decision_accuracy', 'decision_regret']}
            summary[profile][name]['prequential_mse'] = float(np.mean([r['prequential_mse'] for r in rows]))
    result = {'steps_per_run': 1000, 'feedback_probability': 0.2, 'context_count': 32, 'seen_contexts': 24,
              'development_seeds': list(range(101, 106)), 'heldout_seeds': list(range(200, 220)),
              'rate_grid': RATES, 'selected_rates': selected,
              'tuning_mse': {name: {str(rate): float(np.mean(values)) for rate, values in rates.items()} for name, rates in tuning.items()},
              'summary': summary, 'runs': heldout,
              'limitations': ['Simulated users and synthetic context cues', 'Binary welcome/not-welcome feedback, not full chat preference',
                             'Approximately 200 explicit ratings per run; unavailable in overnight live data',
                             'Same delta rule for all methods, learned readouts are not anatomical MBON weights',
                             'Arbitrary bridge from context to fly input neurons', 'Unseen contexts are entirely withheld from feedback']}
    (Path(__file__).parent / 'learning-results.json').write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps(summary, indent=2))


if __name__ == '__main__':
    main(Path(sys.argv[1]))
