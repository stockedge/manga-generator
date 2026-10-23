#!/usr/bin/env bash
# Foreground process: stop with Ctrl+C. Keep SSH tunnel in a separate terminal.
set -euo pipefail
base="${MANGA_COMFY_HOME:-/workspace/manga-comfy}"
cd "$base/ComfyUI"
exec "$base/venv/bin/python" main.py --listen 127.0.0.1 --port 8188
