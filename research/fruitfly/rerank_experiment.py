"""A fixed 40-candidate exact reranker for the FlyHash prototype."""
import json
import sys
from pathlib import Path
import numpy as np
from retrieval_experiment import unit, winners

cache = Path(sys.argv[1])
job = json.loads((cache / 'banking-job.json').read_text())
x = unit(np.fromfile(cache / 'banking-vectors.f32', dtype='<f4').reshape(-1, 768))
train_count = job['train_count']
labels = np.array(job['labels'])
index, queries = x[:train_count], x[train_count:]
exact_scores = queries @ index.T
exact = np.argsort(-exact_scores, axis=1, kind='stable')[:, :5]
rows = []
for seed in range(5):
    rng = np.random.default_rng(seed)
    projection = np.zeros((768, 2336), dtype=np.float32)
    for col in range(2336):
        projection[rng.choice(768, 6, replace=False), col] = 1
    codes = unit(winners(x @ projection))
    candidates = []
    for start in range(train_count, len(codes), 128):
        scores = codes[start:start + 128] @ codes[:train_count].T
        candidates.append(np.argsort(-scores, axis=1, kind='stable')[:, :40])
    candidates = np.concatenate(candidates)
    selected_scores = np.take_along_axis(exact_scores, candidates, axis=1)
    ranked = np.take_along_axis(candidates, np.argsort(-selected_scores, axis=1, kind='stable'), axis=1)[:, :5]
    # Every top score in this benchmark exceeds Haru's 0.35 admission threshold.
    assert np.all(np.take_along_axis(exact_scores, ranked, axis=1) >= 0.35)
    rows.append({'seed': seed,
                 'raw_intent_accuracy': float(np.mean(labels[candidates[:, 0]] == labels[train_count:])),
                 'reranked_intent_accuracy': float(np.mean(labels[ranked[:, 0]] == labels[train_count:])),
                 'exact_top1_recovered': float(np.mean(ranked[:, 0] == exact[:, 0])),
                 'exact_neighbour_recall5': float(np.mean([len(set(a) & set(b)) / 5 for a, b in zip(ranked, exact)]))})
    print(rows[-1], flush=True)
result = {'candidate_count': 40, 'queries': len(queries), 'index_count': train_count,
          'exact_intent_accuracy': float(np.mean(labels[exact[:, 0]] == labels[train_count:])),
          'runs': rows,
          'means': {key: float(np.mean([row[key] for row in rows])) for key in rows[0] if key != 'seed'},
          'caveats': ['Exploratory follow-up on the already examined public benchmark',
                      'Retains original vectors plus a packed index; no total vector-memory saving',
                      'No change to production Haru retrieval']}
(Path(__file__).parent / 'rerank-results.json').write_text(json.dumps(result, indent=2) + '\n')
