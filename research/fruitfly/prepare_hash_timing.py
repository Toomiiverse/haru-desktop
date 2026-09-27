"""Prepare packed FlyHash codes; keep model data outside the application."""
import json
import sys
from pathlib import Path
import numpy as np
from retrieval_experiment import unit, winners

cache = Path(sys.argv[1])
x = unit(np.fromfile(cache / 'banking-vectors.f32', dtype='<f4').reshape(-1, 768))
rng = np.random.default_rng(0)
indices = np.array([rng.choice(768, 6, replace=False) for _ in range(2336)], dtype='<u2')
projection = np.zeros((768, 2336), dtype=np.float32)
projection[indices.T, np.arange(2336)] = 1
codes = winners(x @ projection).astype(np.uint8)
np.packbits(codes, axis=1, bitorder='little').tofile(cache / 'banking-flyhash.bits')
indices.tofile(cache / 'flyhash-inputs.u16')
x.astype('<f4').tofile(cache / 'banking-normalised.f32')
(cache / 'hash-timing-meta.json').write_text(json.dumps({
    'rows': len(x), 'dimensions': 768, 'bits': 2336, 'winners': 117, 'inputs_per_cell': 6,
    'train_rows': 10003, 'seed': 0, 'vector_dtype': 'little-endian float32',
    'code_dtype': 'little-endian uint32', 'projection_dtype': 'little-endian uint16',
}, indent=2))
print(f'Prepared {len(x)} packed codes')
