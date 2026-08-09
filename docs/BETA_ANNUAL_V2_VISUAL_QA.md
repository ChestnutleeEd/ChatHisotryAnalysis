# Beta Annual Recap V2 visual QA

Synthetic-only evidence for `?fixture=beta-annual-recap`. No private data, private-derived values, or private images were opened or used.

## Result

Synthetic visual/browser QA: **PASS — no visual FAIL observed**.

The V1 progression gate is recorded as: `V1 accepted for progression with known module-level polish debt.` This does not claim that every V1 surface is finally visually approved. OpenSpec 5B.16 remains the explicit V2 human-acceptance stop gate.

## Nine-scene screenshot set

All primary captures are 1180×760 and use the synthetic Annual fixture.

| Scene | Score | Evidence |
| --- | --- | --- |
| Opening | PASS | [`opening-1180.png`](../output/playwright/beta-v2/opening-1180.png) |
| Scale | PASS | [`scale-1180.png`](../output/playwright/beta-v2/scale-1180.png) |
| Rhythm | PASS | [`rhythm-1180.png`](../output/playwright/beta-v2/rhythm-1180.png) |
| Balance | PASS | [`balance-1180.png`](../output/playwright/beta-v2/balance-1180.png) |
| Conversation | PASS | [`conversation-1180.png`](../output/playwright/beta-v2/conversation-1180.png) |
| Frequent Words | PASS | [`frequent-words-1180.png`](../output/playwright/beta-v2/frequent-words-1180.png) |
| Keywords | PASS | [`keywords-1180.png`](../output/playwright/beta-v2/keywords-1180.png) |
| Word Cloud | PASS | [`word-cloud-1180.png`](../output/playwright/beta-v2/word-cloud-1180.png) |
| Closing | PASS | [`closing-1180.png`](../output/playwright/beta-v2/closing-1180.png) |

The rubric dimensions checked were hierarchy, alignment, density, rhythm, balance, readability, contrast, scanability, composition, story progression, artwork integration, chart clarity, and navigation clarity. No screenshot has a FAIL.

## Responsive and zoom pressure

| Check | Result | Evidence |
| --- | --- | --- |
| 760×900 | PASS; no horizontal overflow | [`responsive-760.png`](../output/playwright/beta-v2/responsive-760.png) |
| 380×900 | PASS; no horizontal overflow | [`responsive-380.png`](../output/playwright/beta-v2/responsive-380.png) |
| 200% equivalent layout viewport (590px) | PASS; no horizontal overflow | [`zoom-200-590.png`](../output/playwright/beta-v2/zoom-200-590.png) |

At 380px, Rhythm, Balance, Conversation, Frequent Words, Keywords, Word Cloud, and Closing anchors were each reached and measured with `document.documentElement.scrollWidth === window.innerWidth`.

## Asset decision

No new V2 raster asset was needed. Existing selected local WebP artwork remains in use:

- `frontend/src/assets/beta/art/annual-opening-hero-v1.webp` — 1536×1024, 80K.
- `frontend/src/assets/beta/art/closing-poster-v1.webp` — 1122×1402, 202K.

Optional rhythm/vocabulary textures were rejected as unnecessary for this composition; CSS/SVG-style dividers and the existing local artwork keep the scenes quieter. There are no remote image URLs.

## Module-level polish backlog

- Opening/Closing artwork can receive a later focal-crop pass at compact widths; current crops are readable and do not block the Annual story.
- Vocabulary controls and long ranking rows can receive a later spacing pass at 380px; current layout is keyboard-usable and has no horizontal overflow.

## Scope boundary

No analytics, report scope, frequency denominator, keyword algorithm, Clean Mode semantics, Worker contract, or word-cloud geometry/layout was changed. V3 Detailed body recomposition, B5 motion/share/export, and B6 packaging work were not started; this `.app`/`.dmg` is only the required interim visual-acceptance build.
