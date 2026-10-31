"""Finish the GPT Image social preview with the exact published manga page.

The GPT-generated master supplies the composition and typography. Image models
can redraw tiny speech balloons, so the published sample page is inserted
without changing its content before uniform scaling and JPEG export.
Requires Pillow.
"""

from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
MASTER = ROOT / "docs/showcase/social-preview-gpt-master.png"
PAGE = ROOT / "docs/showcase/novel-account-page-01.png"
OUTPUT = ROOT / "docs/showcase/social-preview-gpt-1280x640.jpg"

design = Image.open(MASTER).convert("RGB")
assert design.size == (1774, 887), "Unexpected GPT Image master dimensions"

# Keep the generated frame and replace only its interior with the exact page.
ImageDraw.Draw(design).rectangle((1160, 54, 1676, 765), fill=(255, 255, 255))
page = Image.open(PAGE).convert("RGB")
page.thumbnail((474, 711), Image.Resampling.LANCZOS)
design.paste(page, (1181 + (474 - page.width) // 2, 54))

preview = design.resize((1280, 640), Image.Resampling.LANCZOS)
preview.save(OUTPUT, format="JPEG", quality=92, subsampling=0, optimize=True)
assert OUTPUT.stat().st_size < 1_000_000, "GitHub social preview must be under 1 MB"
print(f"{OUTPUT} ({OUTPUT.stat().st_size} bytes)")
