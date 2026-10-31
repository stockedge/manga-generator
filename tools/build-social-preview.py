"""Build the GitHub social preview from a finished, unmodified manga page.

Requires Pillow. The output is intentionally deterministic: quoted source text,
composition, and typography stay accurate when the preview is regenerated.
"""

import os
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "docs/showcase/novel-account-page-01.png"
OUTPUT = ROOT / "docs/showcase/social-preview-1280x640.png"


def font(size, serif=False, bold=False):
    override = os.environ.get("MANGA_SOCIAL_FONT")
    candidates = [override] if override else []
    if serif:
        candidates += [
            "C:/Windows/Fonts/NotoSerifJP-VF.ttf",
            "C:/Windows/Fonts/YuMincho.ttc",
        ]
    elif bold:
        candidates += [
            "C:/Windows/Fonts/NotoSansJP-VF.ttf",
            "C:/Windows/Fonts/meiryob.ttc",
        ]
    else:
        candidates += [
            "C:/Windows/Fonts/NotoSansJP-VF.ttf",
            "C:/Windows/Fonts/meiryo.ttc",
        ]
    candidates += ["/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc"]
    for candidate in candidates:
        if candidate and Path(candidate).exists():
            return ImageFont.truetype(candidate, size)
    raise RuntimeError("Set MANGA_SOCIAL_FONT to a Japanese font file")


W, H = 1280, 640
paper = (248, 246, 240)
ink = (29, 30, 32)
accent = (187, 53, 43)
image = Image.new("RGB", (W, H), paper)
d = ImageDraw.Draw(image)

# Original text: exact excerpt from the source of the completed sample work.
d.rounded_rectangle(
    (54, 43, 488, 549), radius=12, fill=(255, 255, 255), outline=ink, width=3
)
d.rectangle((54, 43, 488, 101), fill=ink)
d.text((77, 56), "ORIGINAL TEXT", font=font(25, bold=True), fill=(255, 255, 255))
d.text((79, 132), "「次の更新、告白の", font=font(30, serif=True), fill=ink)
d.text((95, 179), "場面ですよね？」", font=font(30, serif=True), fill=ink)
d.line((79, 243, 459, 243), fill=(216, 213, 205), width=2)
d.text((79, 270), "昼休み、クラスの高嶺の花が、", font=font(24, serif=True), fill=ink)
d.text((79, 309), "俺の机へ身を屈めて言った。", font=font(24, serif=True), fill=ink)
d.text((79, 414), "「……何の話？」", font=font(30, serif=True), fill=ink)

# One short message and a clear left-to-right transformation cue.
d.text((535, 150), "小説から", font=font(31, bold=True), fill=ink)
d.text((559, 200), "漫画へ", font=font(31, bold=True), fill=ink)
d.polygon(
    [
        (537, 278),
        (692, 278),
        (692, 247),
        (777, 320),
        (692, 393),
        (692, 362),
        (537, 362),
    ],
    fill=accent,
)

# The exact finished two-panel page is only scaled; dialogue is never regenerated.
page = Image.open(SOURCE).convert("RGB")
page.thumbnail((356, 535), Image.Resampling.LANCZOS)
px = 839 + (356 - page.width) // 2
py = 31 + (535 - page.height) // 2
d.rounded_rectangle((829, 21, 1205, 577), radius=6, fill=(219, 215, 207))
d.rectangle(
    (px - 5, py - 5, px + page.width + 5, py + page.height + 5),
    fill=(255, 255, 255),
    outline=ink,
    width=2,
)
image.paste(page, (px, py))

d.rectangle((0, 581, W, H), fill=ink)
d.text(
    (55, 590),
    "Manga Generator — Artwork, lettering, and PDF export",
    font=font(30, bold=True),
    fill=(255, 255, 255),
)

OUTPUT.parent.mkdir(parents=True, exist_ok=True)
image.save(OUTPUT, format="PNG", optimize=True)
assert image.size == (1280, 640)
assert OUTPUT.stat().st_size < 1_000_000, "Social preview must be under 1 MB"
print(f"{OUTPUT} ({OUTPUT.stat().st_size} bytes)")
