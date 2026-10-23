"""Download base Qwen models, verify full upstream LFS SHA-256, save revisions.

Python standard library only. No LoRAs or private credentials are needed.
Existing matching files are reused; conflicting files are never overwritten.
"""
import hashlib
import json
import re
import sys
import urllib.request
from pathlib import Path

MODELS = [
    ("Comfy-Org/Qwen-Image-Edit", "diffusion_models", "qwen_image_edit_2511_fp8mixed.safetensors"),
    ("Comfy-Org/Qwen-Image", "text_encoders", "qwen_2.5_vl_7b_fp8_scaled.safetensors"),
    ("Comfy-Org/Qwen-Image", "vae", "qwen_image_vae.safetensors"),
]


def digest(file):
    h = hashlib.sha256()
    with file.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def download(root, repo, folder, name):
    with urllib.request.urlopen(f"https://huggingface.co/api/models/{repo}?blobs=true", timeout=60) as response:
        info = json.load(response)
    revision = info["sha"]
    assert re.fullmatch(r"[0-9a-f]{40}", revision), "Invalid revision"
    remote = f"split_files/{folder}/{name}"
    metadata = next(item for item in info["siblings"] if item["rfilename"] == remote)
    expected = metadata["lfs"]["sha256"]
    assert re.fullmatch(r"[0-9a-f]{64}", expected), "Missing full upstream SHA-256"
    target = root / folder / name
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.exists():
        assert digest(target) == expected, f"Existing file differs; preserve and move it manually: {target}"
    else:
        temporary = target.with_suffix(".download")
        url = f"https://huggingface.co/{repo}/resolve/{revision}/{remote}"
        with urllib.request.urlopen(url, timeout=120) as source, temporary.open("wb") as output:
            for chunk in iter(lambda: source.read(1024 * 1024), b""):
                output.write(chunk)
        assert digest(temporary) == expected, f"SHA-256 mismatch: {temporary}"
        temporary.replace(target)
    return {"repository": repo, "revision": revision, "file": remote, "sha256": expected}


if __name__ == "__main__":
    root = Path(sys.argv[1]).resolve()
    records = [download(root, *model) for model in MODELS]
    (root / "manga-models.json").write_text(json.dumps(records, indent=2) + "\n", encoding="utf-8")
    print("MODELS_VERIFIED")
