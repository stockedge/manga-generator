---
name: "manga-art-direction"
description: "Direct consistent manga artwork: face identity with 3 traits and expression sets, 8-item drawing inspection at multiple scales, panel composition with hands and props, and natural reading order across pages. Use when generating or reviewing manga art, faces, hands, or page flow. Keywords: art, face, composition, 作画, 顔, 構図, 読順."
license: "MIT"
---

# Manga Art Direction

Keep every panel identifiable, well-acted, and readable. Read [AGENTS.md](references/AGENTS.md), [ART-QUALITY.md](references/ART-QUALITY.md), [FACE-DESIGN.md](references/FACE-DESIGN.md), and [NARRATIVE-FLOW.md](references/NARRATIVE-FLOW.md) before starting.

## Faces

- Define 3 non-hair traits per character (eyes, brows, contours) plus a reference image and the basis (source-specified vs manga-added). A face style alone is never a rejection reason.
- Compare face candidates first, then build angle and expression sets for the adopted face before the main production.
- Use `referenceRoles` to separate what each reference supplies (face shape, linework, composition, costume, props). Never silently inherit an old face.
- Record per-face `faceIdentity` observations (traits plus in-scene expression) against the references during inspection.

## Drawing inspection

- Inspect the composed page and each panel at reduced, 100%, and 200% scales. Record pass, fail, or na with an observation for all 8 items (anatomy, contact, objects, faces, linework, background, continuity, lettering). Use na only for what is not visible.
- Fix structure first (hands together with what they touch), then tidy lines and backgrounds. Remeasure and re-adopt after every fix.
- If the same composition fails 3 local repairs, return to the storyboard instead. Never log unperformed hand fixes as done, and never promise that AI traits fully disappeared.

## Composition and reading order

- Design in order: emotion and information release, then panels, dialogue groups, faces and acting, then drawing. Never force every page into identical 2-panel layouts.
- Read the unnumbered storyboard first as an ordinary reader; close unrelated balloons get read together, so keep 1-2-3 orderings apart. Confirm transitions (time, place, flashback in/out) across adjacent panels and pages.
- Keep tails pointed at the true speaker without crossing faces, balloons, or protected areas, and confirm the reaction reads mid-conversation, not just the tail direction.
