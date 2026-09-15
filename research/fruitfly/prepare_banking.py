"""Convert the pinned, public BANKING77 CSVs into a local embedding job."""
import csv
import hashlib
import json
import sys
from pathlib import Path

cache = Path(sys.argv[1])
parts = {}
for split in ['train', 'test']:
    source = cache / f'banking-{split}.csv'
    with source.open(encoding='utf-8', newline='') as stream:
        parts[split] = list(csv.DictReader(stream))
assert len(parts['train']) == 10003 and len(parts['test']) == 3080
rows = parts['train'] + parts['test']
job = {
    'dataset': 'BANKING77', 'source': 'https://github.com/PolyAI-LDN/task-specific-datasets',
    'source_commit': (cache / 'banking-source-commit.txt').read_text(encoding='utf-8-sig').strip(),
    'attribution': 'Casanueva, Temcinas, Gerz, Henderson and Vulic, Efficient Intent Detection with Dual Sentence Encoders, 2020',
    'license': 'CC-BY-4.0', 'train_count': len(parts['train']), 'test_count': len(parts['test']),
    'source_sha256': {split: hashlib.sha256((cache / f'banking-{split}.csv').read_bytes()).hexdigest() for split in parts},
    'texts': [row['text'] for row in rows], 'labels': [row['category'] for row in rows],
    'prefix': 'none (matches current Haru)',
}
(cache / 'banking-job.json').write_text(json.dumps(job), encoding='utf-8')
print(f"Prepared {len(rows)} public benchmark texts")
