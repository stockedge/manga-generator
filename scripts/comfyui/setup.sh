#!/usr/bin/env bash
# Linux NVIDIA host with working CUDA PyTorch (for example a GPU pod).
set -euo pipefail
base="${MANGA_COMFY_HOME:-/workspace/manga-comfy}"
here="$(cd "$(dirname "$0")" && pwd)"
mkdir -p "$base"
python3 -c 'import torch; assert torch.cuda.is_available(), "CUDA PyTorch required"'
if [ ! -d "$base/ComfyUI" ]; then
  git clone https://github.com/Comfy-Org/ComfyUI.git "$base/ComfyUI"
fi
# Existing checkouts are never pulled or reset implicitly.
python3 -m venv --system-site-packages "$base/venv"
"$base/venv/bin/python" -m pip install -r "$base/ComfyUI/requirements.txt"
"$base/venv/bin/python" -c 'import torch; assert torch.cuda.is_available()'
"$base/venv/bin/python" "$here/download-models.py" "$base/ComfyUI/models"
git -C "$base/ComfyUI" rev-parse HEAD > "$base/comfyui-commit.txt"
"$base/venv/bin/python" -m pip freeze > "$base/python-packages.txt"
echo "SETUP_DONE: $base"
