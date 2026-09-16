"""Freeze four memory contexts for each held-out companion question."""
import json
import sys
from pathlib import Path
import numpy as np
from retrieval_experiment import unit, winners

cache = Path(sys.argv[1])
here = Path(__file__).parent
fixtures = json.loads((here / 'fixtures.json').read_text())
data = json.loads((cache / 'embeddings.json').read_text())
baseline = json.loads((cache / 'haru-baselines.json').read_text())
vectors = unit(np.array(data['vectors'], dtype=np.float32))
lookup = {text: i for i, text in enumerate(data['texts'])}
docs, query_indices, questions, expected, splits = [], [], [], [], []
for topic_index, topic in enumerate(fixtures['topics']):
    for fact in topic['facts']:
        for query in fact[1:]:
            query_indices.append(lookup[query]); questions.append(query)
            expected.append(len(docs)); splits.append(topic_index % 2 == 1)
        docs.append(lookup[fact[0]])
weights = np.load(cache / 'pn-kc-5.npz')['weights']
inputs, outputs = weights.shape
rng = np.random.default_rng(0)
sparse = np.zeros((768, outputs), dtype=np.float32)
for col in range(outputs):
    sparse[rng.choice(768, 6, replace=False), col] = 1
fly = unit(winners(vectors @ sparse))
# Consume the same random draws as the pre-registered retrieval run.
rng.normal(size=(768, outputs))
bridge = rng.normal(size=(768, inputs)).astype(np.float32) / np.sqrt(inputs)
rates = unit(np.maximum(0, vectors @ bridge))
actual = unit(winners(rates @ (weights > 0).astype(np.float32)))
ranks = {'current_haru': baseline['ranks'],
         'flyhash': np.argsort(-(fly[query_indices] @ fly[docs].T), axis=1, kind='stable')[:, :5].tolist(),
         'actual_connectome': np.argsort(-(actual[query_indices] @ actual[docs].T), axis=1, kind='stable')[:, :5].tolist(),
         'no_memory': [[] for _ in questions]}
cases = []
for qi, held in enumerate(splits):
    if not held:
        continue
    for variant, retrieved in ranks.items():
        notes = [{'id': f'm{di}', 'text': data['texts'][docs[di]]} for di in retrieved[qi]]
        cases.append({'id': qi, 'variant': variant, 'question': questions[qi], 'expected': f'm{expected[qi]}',
                      'evidenceAvailable': expected[qi] in retrieved[qi], 'notes': notes})
job = {'seed': 17, 'description': 'Controlled memory-source selection, not the full Haru persona or tool pipeline',
       'system': 'You are Haru, a desktop companion. Answer the question using only the supplied memory notes. The names and facts are invented. Do not guess missing facts. Return a JSON object with memory_id set to the one note that supports the answer, and a concise answer of at most forty words. If no note supports an answer, use memory_id "unknown" and say you do not know.',
       'schema': {'type': 'object', 'properties': {'memory_id': {'type': 'string'}, 'answer': {'type': 'string'}}, 'required': ['memory_id', 'answer']},
       'cases': cases}
(cache / 'grounding-job.json').write_text(json.dumps(job), encoding='utf-8')
print(f'Prepared {len(cases)} grounded-response cases')
