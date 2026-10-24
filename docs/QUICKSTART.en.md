# Set up and make a manga with Codex

[日本語 README](../README.md) · [English README](../README.en.md)

This guide is for a reader who wants to hand Codex a story and receive reviewed manga pages, a browser reader, and a PDF. Codex coordinates the work; `auto.mjs start` only registers the story. It does **not** generate images by itself.

## See the output first

![A finished two-panel manga page with Japanese dialogue](showcase/novel-account-page-01.png)

This is the opening page of a completed adaptation of [*The Class Idol Found My Novel Account*](https://kakuyomu.jp/works/11054822663326441351), by 月森ナギ. It shows the output format: panel artwork, separately composed dialogue, and page layout. The full source story and generated work files are not bundled with this Git repository, so the image is a production example rather than a runnable fixture.

## Requirements

- A Codex environment that can actually generate and inspect images and run independent subagent reviews. Check tool availability and quota before starting a full story.
- Node.js 24. A browser such as Chrome or Edge, Japanese fonts, Python with ReportLab, pypdf and Pillow, and Poppler are needed for the full PDF and inspection workflow. Codex may use bundled dependencies when available.
- A UTF-8 text file containing a story you may adapt. You can also paste the text into Codex. For a URL, Codex must retrieve and record the complete accessible source before claiming a full adaptation.
- Enough disk space for generated alternatives, immutable history, rendered pages, the PDF, and the portable archive. Do not delete intermediate materials to make room.

## Install and check

Ask Codex to clone the repository into a new folder, read `AGENTS.md`, [the automatic workflow](AUTOMATIC.md), and [the reproducibility guide](../REPRODUCE.md), and check the requirements above. For a manual checkout:

```sh
git clone https://github.com/stockedge/manga-generator.git
cd manga-generator
npm install
npm run check
```

The tests verify the code and synthetic fixtures. They do not prove that image generation or visual review is available in your Codex session.

## Give Codex your story

Attach a UTF-8 `.txt` file or paste the text and ask: “Turn this complete story into a manga, review the actual images, and produce the reader, PNG pages, PDF, and reproducibility package.” You can use the ready-made request in [README.en.md](../README.en.md#getting-started-in-three-steps).

Codex registers a file with:

```sh
node cli/auto.mjs start path/to/story.txt --title "My Story"
```

The command prints a `works/auto-…/workflow.json` path. Codex sets `MANGA_PROJECT` to that exact path for subsequent commands. For example, in PowerShell:

```powershell
$env:MANGA_PROJECT='works/auto-…/workflow.json'
node cli/auto.mjs status
```

In a POSIX shell, use `export MANGA_PROJECT='works/auto-…/workflow.json'`. Replace `…` with the actual ID printed by `start`.

## What Codex does next

1. Read the **entire** original; map its scenes, dialogue, causality, and ending to a script. Keep source facts separate from added visual details.
2. Design the reading order, panel beats, transitions, dialogue positions, character references, and the before/current/after state of hands and important props. Run `node cli/production-audit.mjs work works/auto-…/workflow.json` before generating panels.
3. Generate text-free panel artwork with the declared renderer. Save the exact prompts, references, candidates, and originals. Inspect faces, hands, props, expressions, and composition in the *actual* images.
4. Compose dialogue and bubbles separately. Read each page without guide numbers, check speaker tails and scene transitions, and repair problems. Independent subagent reviews cover the original, script, storyboard, artwork, lettering, and final work.
5. Build the page images and reader, create and render the PDF for visual inspection, then verify the source coverage and portable package. `node cli/auto.mjs finish` records completion only after the required checks pass.

If you resume later, ask Codex to run `node cli/auto.mjs status` and continue at the first unfinished stage. The status separates saved panel materials from completion. For an author collection, `node cli/production-audit.mjs collection AUTHOR_ID` gives a material and storage overview; recorded reviews there are presence counts, not a fresh visual verification.

## Find the results

For the project ID returned by `start`, the usual paths are:

| Result | Path |
| --- | --- |
| Browser reader | `works/auto-…/output/reader.html` |
| Page PNGs | `works/auto-…/output/page-XX.png` |
| PDF | `works/auto-…/output/pdf/manga.pdf` |
| Prompts, references, candidates, reviews, and history | `works/auto-…/workflow/`, `works/auto-…/assets/`, `.manga-history/` |
| Verified portable package | `releases/` after successful completion |

Image generation is nondeterministic. The reproducibility package rebuilds the composition from **saved, adopted** artwork; it does not promise identical newly generated images. A passing mechanical check also does not guarantee that the story or drawing is appealing. See [the detailed workflow](AUTOMATIC.md) for the required visual checks and [the manual guide](../REPRODUCE.md) for individual commands.
