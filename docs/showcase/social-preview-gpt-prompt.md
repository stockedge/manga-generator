# GPT Image social preview (2026-10-24)

The final [GitHub social preview](social-preview-gpt-1280x640.jpg) uses a GPT Image [background](social-preview-gpt-background.png), a [design master](social-preview-gpt-master.png), and the exact published [two-panel manga page](novel-account-page-01.png). `tools/build-social-preview-gpt.py` restores the comic page's exact content in the right frame and exports a 1280×640 JPEG under 1 MB. Do not replace the page insert with generated dialogue.

## Reference roles and prompt summaries

1. **Background and layout.** Reference: previous `social-preview-1280x640.png`, for its story-to-manga arrangement and monochrome/coral palette only. Prompt: “Create a polished, premium manga-editorial GitHub social preview background in a 2:1 landscape format. Warm ivory paper, deep charcoal ink, restrained vermilion, hand-inked page edges and manga speed lines guiding the eye left to right, sparse halftone details at the outer edges. Leave a blank left text frame, clean center transition zone and arrow, blank right portrait frame for a finished page, and dark footer band. No text, people, generated comic panels, logos or watermarks.”
2. **Finished design.** References: generated background as the edit target; `novel-account-page-01.png` as a locked supporting insert. Prompt: “Place the unchanged two-panel page in the right frame. Typeset the exact novel excerpt on the left: `「次の更新、告白の場面ですよね？」`, `昼休み、クラスの高嶺の花が、俺の机へ身を屈めて言った。`, `「……何の話？」`. Put `小説から漫画へ` above the red arrow. In the footer put `Manga Generator — Artwork, lettering, and PDF export`. Keep a crisp editorial hierarchy and preserve the background's ink strokes. No extra words.”

The image model redrew the tiny speech balloons in the insert despite the instruction to preserve them. The final build script therefore replaces only that area with the original page. This makes the character art and lettering faithful to the published sample while keeping the GPT-generated graphic design.
