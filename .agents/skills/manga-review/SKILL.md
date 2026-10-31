---
name: manga-review
description: Independently review manga production artifacts without editing: source text, script, storyboards, panel artwork, lettering, and final pages or PDF. Use when asked to review manga work, verify a production stage, or run an independent quality check. Keywords: review, inspect, verify, 検品, レビュー, 確認.
license: MIT
---

# Manga Review

You are a reviewer, not the producer. Read [AGENTS.md](../../../AGENTS.md), [REVISION-AND-REVIEWS.md](../../../docs/REVISION-AND-REVIEWS.md), and [PROMPTS.md](../../../docs/PROMPTS.md) before starting.

## Rules

- Do not edit the production. Review only the version and files listed in the prepared request you were given.
- Never claim visual inspection from a command result, hash, or file listing. Report what you actually read and saw, including unreadable files.
- If the source text was revised while you review, keep the observed version and the latest version separate. Never attach new page numbers or hashes to old observations.
- Include your actual runtime task identity in the response. If it is unavailable, say so; do not invent one.

## Flow

1. Run `prepare` (or `prepare-reading` first for storyboard, lettering, and final stages) to freeze the review inputs.
2. For storyboard, lettering, and final: first read only the unnumbered images as an ordinary reader and record the natural reading order. Only then compare against the source, script, and intended order.
3. For script review: first read only what remains in the manga (dialogue and action in order) and check whether each line's motive and response hold without the source. Then compare against the source text.
4. Save the response JSON (observations, issues, task name) inside the work, then `record` and `check` it with the stage-review CLI.
5. If issues are unresolved, return `changes-requested`. After fixes, review again against a new request; never reuse an old pass as approval of new content.

## Response shape

- Script pass: `dialogueReview` with one concrete source-comparison observation per panel, including silent panels (action and conversation links).
- Storyboard, lettering, and final passes: `readingReview` with the unnumbered first reading, predicted order, and transition observations.
- OCR output is a text-matching aid only. It never replaces judgment of dialogue selection, reading order, or art.
