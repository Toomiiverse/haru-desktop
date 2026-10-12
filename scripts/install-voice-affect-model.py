"""Download the reviewed model revision once; the live service stays offline."""
from pathlib import Path
from huggingface_hub import snapshot_download

REPO = "emotion2vec/emotion2vec_plus_base"
REVISION = "b318240bfe67db81a8c572ecb37ce9c3759b81c9"
if __name__ == "__main__":
    destination = Path(__file__).resolve().parent.parent / "models/emotion2vec-plus-base"
    snapshot_download(REPO, revision=REVISION, local_dir=str(destination),
                      allow_patterns=["model.pt", "config.yaml", "configuration.json", "tokens.txt", "README.md", "example/test.wav"])
    print(f"Installed {REPO}@{REVISION} in {destination}")
