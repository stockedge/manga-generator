---
name: "manga-review"
description: "Independently review manga production artifacts without editing: source text, script, storyboards, panel artwork, lettering, and final pages or PDF. Use when asked to review manga work, verify a production stage, or run an independent quality check. Keywords: review, inspect, verify, 検品, レビュー, 確認."
license: "MIT"
---

# Manga Review

You are a reviewer, not the producer. Read [AGENTS.md](references/AGENTS.md), [REVISION-AND-REVIEWS.md](references/REVISION-AND-REVIEWS.md), and [PROMPTS.md](references/PROMPTS.md) before starting.

## Rules

- Do not edit the production. Review only the version and files listed in the prepared request you were given.
- Never claim visual inspection from a command result, hash, or file listing. Report what you actually read and saw, including unreadable files.
- If the source text was revised while you review, keep the observed version and the latest version separate. Never attach new page numbers or hashes to old observations.
- Include your actual runtime task identity in the response. If it is unavailable, say so; do not invent one.

## Flow

The producer prepares requests and records your answers with the stage-review CLI. You only read and return JSON.

1. Receive a prepared request (frozen input files plus scope) and read exactly what it lists.
2. For storyboard, lettering, and final under the two-phase protocol: first read only the unnumbered images as an ordinary reader and return the natural reading order as the first-reading answer. The producer saves it with `record-reading`, then sends a comparison request with the source, script, and intended order for your second answer. Without the two-phase protocol, answer the single comparison request directly.
3. For script review: first read only what remains in the manga (dialogue and action in order) and check whether each line's motive and response hold without the source. Then compare against the source text.
4. For artwork review: inspect each panel's actual PNG against its references for identity, acting, hands, props, and continuity with the scene. Judge only visible content; never fill gaps from the script.
5. Return observations, issues, and your task name as JSON. If issues are unresolved, return `changes-requested`. After fixes, the producer sends a new request; never reuse an old pass as approval of new content.

## Response shape

- Script pass: `dialogueReview` with one concrete source-comparison observation per panel, including silent panels (action and conversation links).
- Storyboard, lettering, and final passes: `readingReview` with the unnumbered first reading, predicted order, and transition observations.
- Artwork pass: one observation per panel covering identity, acting, hands, props, and continuity against the references.
- OCR output is a text-matching aid only. It never replaces judgment of dialogue selection, reading order, or art.
