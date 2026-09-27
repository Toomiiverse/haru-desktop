"""Extract a labelled, left-side olfactory projection; never imports app data.

Usage: python extract_connectome.py CACHE_DIR
Requires numpy, pandas and pyarrow in the research Python environment only.
The two public source files and source-commits.json live in CACHE_DIR.
"""
import hashlib
import json
import platform
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import pyarrow.parquet as pq


def sha256(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def main(cache):
    annotations = pd.read_csv(cache / "annotations.tsv", sep="\t", low_memory=False)
    edges = pq.read_table(cache / "2025_Connectivity_783.parquet", columns=[
        "Presynaptic_ID", "Postsynaptic_ID", "Connectivity", "Excitatory"
    ]).to_pandas()
    assert not annotations.root_id.duplicated().any(), "Duplicate neuron annotations"
    pn = annotations[(annotations.cell_class == "ALPN")
                     & (annotations.cell_sub_class == "uniglomerular")
                     & (annotations.top_nt == "acetylcholine")
                     & (annotations.side == "left")]
    kc = annotations[(annotations.cell_class == "Kenyon_Cell") & (annotations.side == "left")]
    relevant = edges[edges.Presynaptic_ID.isin(pn.root_id)
                     & edges.Postsynaptic_ID.isin(kc.root_id)]
    # The source is an aggregated edge list, not one row per synapse.
    relevant = relevant.groupby(["Presynaptic_ID", "Postsynaptic_ID"], as_index=False).Connectivity.sum()
    summaries = {}
    for threshold in [1, 5, 10]:
        filtered = relevant[relevant.Connectivity >= threshold]
        source_ids = np.sort(filtered.Presynaptic_ID.unique())
        target_ids = np.sort(filtered.Postsynaptic_ID.unique())
        matrix = np.zeros((len(source_ids), len(target_ids)), dtype=np.float32)
        matrix[np.searchsorted(source_ids, filtered.Presynaptic_ID),
               np.searchsorted(target_ids, filtered.Postsynaptic_ID)] = filtered.Connectivity
        assert matrix.size and np.all(matrix.sum(axis=0) > 0)
        binary = matrix > 0
        np.savez_compressed(cache / f"pn-kc-{threshold}.npz", weights=matrix,
                            source_ids=source_ids, target_ids=target_ids)
        summaries[str(threshold)] = {
            "presynaptic_neurons": len(source_ids), "postsynaptic_neurons": len(target_ids),
            "edges": int(binary.sum()), "synapses": int(matrix.sum()),
            "incoming_degree_percentiles": np.percentile(binary.sum(axis=0), [0, 25, 50, 75, 100]).tolist(),
            "outgoing_degree_percentiles": np.percentile(binary.sum(axis=1), [0, 25, 50, 75, 100]).tolist(),
            "density": float(binary.mean()),
        }
    stats = {
        "python": platform.python_version(), "source_commits": json.loads((cache / "source-commits.json").read_text(encoding="utf-8-sig")),
        "sha256": {name: sha256(cache / name) for name in ["annotations.tsv", "2025_Connectivity_783.parquet"]},
        "whole_source_edges": len(edges), "whole_source_synapses": int(edges.Connectivity.sum()),
        "whole_source_neurons": len(np.union1d(edges.Presynaptic_ID, edges.Postsynaptic_ID)),
        "annotated_neurons": len(annotations), "eligible_pn": len(pn), "eligible_kc": len(kc),
        "selection": "Left hemisphere; ALPN uniglomerular; predicted acetylcholine; targets Kenyon_Cell left; edge synapse-count threshold",
        "projection": summaries,
        "limitations": ["Predicted transmitter used for source selection", "Only one feedforward projection; no spiking or learning",
                        "Threshold and input encoding are engineering choices", "Latest v783 annotations, not the original paper snapshot"],
    }
    output = Path(__file__).with_name("connectome-stats.json")
    output.write_text(json.dumps(stats, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(stats, indent=2))


if __name__ == "__main__":
    main(Path(sys.argv[1]))
