"""Fetch pinned public research inputs outside the checkout; verify SHA-256.

Usage: python download_sources.py CACHE_DIR
Existing matching files are reused; an unexpected existing file is an error.
"""
import hashlib
import json
import sys
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent


def sha256(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def main(cache):
    cache = cache.resolve()
    if cache.is_relative_to(HERE.parents[1]):
        raise ValueError('Choose a research cache outside the application checkout')
    cache.mkdir(parents=True, exist_ok=True)
    connectome = json.loads((HERE / 'connectome-stats.json').read_text())
    banking = json.loads((HERE / 'banking-results.json').read_text())['dataset']
    emotion = json.loads((HERE / 'goemotions-manifest.json').read_text())
    revisions = connectome['source_commits']
    raw = 'https://raw.githubusercontent.com/'
    sources = [
        ('2025_Connectivity_783.parquet', f"{raw}eonsystemspbc/fly-brain/{revisions['connectivity']}/data/2025_Connectivity_783.parquet", connectome['sha256']['2025_Connectivity_783.parquet']),
        ('annotations.tsv', f"{raw}flyconnectome/flywire_annotations/{revisions['annotations']}/supplemental_files/Supplemental_file1_neuron_annotations.tsv", connectome['sha256']['annotations.tsv']),
    ]
    for split in ['train', 'test']:
        sources.append((f'banking-{split}.csv', f"{raw}PolyAI-LDN/task-specific-datasets/{banking['source_commit']}/banking_data/{split}.csv", banking['source_sha256'][split]))
    for local, remote in [('goemotions-test.tsv', 'test.tsv'), ('goemotions-labels.txt', 'emotions.txt')]:
        sources.append((local, f"{raw}google-research/google-research/{emotion['sourceCommit']}/goemotions/data/{remote}", emotion['sourceSha256'][local]))
    for name, url, expected in sources:
        target = cache / name
        if not target.exists():
            # The exclusive partial file protects an existing interrupted download.
            partial = target.with_name(target.name + '.download')
            with urllib.request.urlopen(url, timeout=60) as response, partial.open('xb') as stream:
                while chunk := response.read(1024 * 1024):
                    stream.write(chunk)
            if sha256(partial) != expected:
                raise ValueError(f'Checksum mismatch: {partial}')
            partial.rename(target)
        if sha256(target) != expected:
            raise ValueError(f'Existing file has unexpected content: {target}')
        print(f'Verified {name}', flush=True)
    (cache / 'source-commits.json').write_text(json.dumps(revisions), encoding='utf-8')
    (cache / 'banking-source-commit.txt').write_text(banking['source_commit'], encoding='utf-8')
    (cache / 'goemotions-source-commit.txt').write_text(emotion['sourceCommit'], encoding='utf-8')


if __name__ == '__main__':
    main(Path(sys.argv[1]))
