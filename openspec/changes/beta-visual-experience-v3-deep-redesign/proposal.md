## Why

The packaged Beta is functionally stable, but its presentation architecture still reads as a web dashboard with editorial styling rather than a finished local desktop product. Repeated CSS override layers, fixed column assumptions, weak scene differentiation, utility-like charts, and an oversized sticky navigator create accidental whitespace and flatten the Annual story; the visual system now needs a bounded architecture-level redesign before any further polish.

## What Changes

- Establish a V3 presentation architecture with reusable Annual scene, editorial-grid, workspace, chart-stage, disclosure, artwork, vocabulary, and navigation primitives instead of accumulating scene-specific selectors.
- Make ordinary Annual scene height content-driven and add synthetic DOM geometry diagnostics for trailing blank area, stretched siblings, empty columns, inflated minimum heights, sticky occlusion, and clipped anchors.
- Recompose the unchanged seven Annual scenes and sixteen logical report sections with content-aware `12`, `8+4`, `7+5`, `6+6`, `5+7`, or `4+8` layouts; a visual beat may combine adjacent logical sections without changing their facts, order, anchors, or meaning.
- Replace the persistent form-like Annual toolbar with an accessible expanded-to-compact progress navigator that preserves scene, year, chapter, and restore-all-years operations without scroll hijacking or content occlusion.
- Freeze a scene-specific visualization matrix for existing message, activity, role, type, reply/session, and vocabulary facts; no new analytics, inference, denominator, or query semantics are introduced.
- Make Vocabulary a deliberate Annual climax through distinct frequent-word hierarchy, keyword composition, a full-width deterministic Word Cloud stage, and secondary hidden-word/methodology disclosures.
- Redesign Detailed as a denser modern data workspace while preserving all eight routes, draft-versus-applied query behavior, explicit Apply, metrics, tables, charts, and exports.
- Refine Home as a quiet private-local portal and preserve the Share Card renderer/export architecture as the visual maturity reference; any future Share Card polish remains an explicit isolated regression task.
- Freeze offline system typography, semantic color roles, spacing/grid/surface tokens, responsive behavior, WCAG 2.2 AA requirements, and a restrained but clearly perceptible motion system.
- Consolidate the current 6,132-line chronological CSS history into ordered token/foundation, Annual, Detailed, and motion/responsive layers; remove dead V1/V2/P1 selectors and structural hacks only after each migrated consumer is covered.
- Define a synthetic-only screenshot, human visual review, responsive, motion, geometry, accessibility, performance, and packaged smoke loop for every implementation batch.
- Freeze implementation into V3.1–V3.6 bounded batches with Sol review gates; this planning batch changes OpenSpec artifacts only and performs no production implementation, asset generation, screenshot capture, or package build.

## Capabilities

### New Capabilities

- `beta-visual-experience-v3`: Defines the presentation-only V3 architecture, visual system, Annual and Detailed compositions, navigation, visualization and motion language, geometry diagnostics, responsive/accessibility/performance constraints, synthetic visual QA, and staged migration gates.

### Modified Capabilities

None. There is no main `openspec/specs/` capability baseline to modify, and this independent visual change preserves the requirements and completed history of the existing Beta, productization, and word-cloud changes.

## Impact

- Planned presentation consumers: `frontend/src/presentation/beta/`, `frontend/src/presentation/DesktopDashboard.tsx`, Beta-owned shell composition in `frontend/src/presentation/DesktopImportPanel.tsx`, and presentation-only adapters where a new visual structure requires already-existing facts.
- Planned styling/test areas: `frontend/src/presentation/beta/styles.css` or a bounded split into `tokens.css`, `annual.css`, `detailed.css`, and `motion.css`; synthetic browser harnesses and Playwright visual/geometry/motion acceptance.
- Existing React, CSS, Canvas/SVG, IntersectionObserver, Web Animations API, and Worker architecture remain the default implementation substrate. No Tailwind, UI kit, remote font, runtime image generation, CDN, network dependency, or motion framework is added by default.
- Analytics, canonical/dedup processing, query identities, report range/year synchronization, Draft/Apply behavior, vocabulary and Clean Mode semantics, deterministic Word Cloud geometry, summary/share contracts, raw IPC, native save, aggregate export, packaging authority, and privacy boundaries are unchanged.
- Share Card Canvas determinism, PNG authority, one-use raw-binary lease, and `NSSavePanel` flow are outside the redesign unless a separately bounded low-risk task is explicitly approved and reruns the complete B5 renderer/export regression.
