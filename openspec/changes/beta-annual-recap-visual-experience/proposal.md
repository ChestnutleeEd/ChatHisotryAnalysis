## Why

The Alpha desktop product already provides a complete, local, engineering-oriented analysis Dashboard, but ordinary users lack a clear annual-recap entry and story flow. Its current packaged UI also relies heavily on sharp white bordered rectangles, native-looking controls, repeated engineering/status labels, dense tables, and plain text hierarchy, so it reads as an administration surface rather than one coherent consumer desktop product. `Words & Years` exposes traceable top-word and yearly-keyword tables rather than a true annual word cloud, and the distinction between frequent words and distinctive yearly keywords is not yet presented in user language.

This Beta should land before Release hardening because it can reuse the accepted canonical-v2, Worker, query, privacy, lifecycle, and export-authority foundations while testing the product's user-facing value without expanding into signing, distribution, or cloud scope. A separate presentation layer also prevents visual storytelling concerns from weakening the existing analytical contracts.

## What Changes

- Add a post-analysis home with a primary “查看年度聊天报告” action and a persistent secondary entry to the unchanged detailed Dashboard.
- Add represented-year selection, full-calendar-scope labels, multi-year overview, annual report re-selection, and state-preserving report/Dashboard mode switching.
- Add a fixed annual narrative with sixteen logical sections that may be composed into fewer visual scenes: opening, messages, active days and streak, peak month/weekday/hour, sender share, eligible-text length, message types, sessions and replies, frequent words, distinctive yearly keywords, deterministic word cloud, summary, and sharing.
- Add a versioned Beta presentation query, report DTO, presentation adapter, deterministic summary copy, methodology labels, empty/insufficient states, privacy/export metadata, and cache identities.
- Compatibly extend the Analytics Worker result for scoped ranked tokens, normalized frequencies, vocabulary-quality flags, stopword policy identity, and word-cloud inputs; retain one-time Worker tokenization and all existing Dashboard DTOs.
- Add an independent deterministic word-cloud layout Worker, Canvas screen/export renderers, and an accessible ranked list; the renderer will not scan message bodies or hold the canonical dataset.
- Add local vocabulary controls for built-in analysis-policy disclosure and custom hidden words; custom hiding is a presentation preference that never changes the eligible-token denominator or base analytics query.
- Synchronize the committed annual scope across the selector, report facts, core cards, scoped frequency DTO, yearly-keyword presentation, and word cloud; a pending selection never relabels retained evidence, and multi-year/all-years modes never retain a year-narrowed analytical result.
- Add a default-on, one-click “净化常用词” presentation preference backed by a conservative versioned Chinese/English discourse lexicon. It filters and refills bounded display candidates only, composes with custom hidden words, and never changes tokenization, Stage 7, analytical ranks/scores, counts, rates, denominators, canonical query identity, or frequency DTO identity.
- Add the frozen Beta visual, responsive, motion, reduced-motion, keyboard, ARIA, contrast, chart-alternative, loading, empty, error, and disabled-state system.
- Add a shared visual foundation for Annual Recap, then land the low-risk Detailed Analysis uplift as a separate non-blocking B1b batch: semantic typography patterns, six semantic surface roles, restrained borders/depth, lightweight card variants, button hierarchy, form-control wrappers, badges/chips, app-mode navigation, Dashboard tab rail, compact filter toolbar, table/chart treatments, methodology disclosures, and status patterns.
- Refine the App Shell and workflow status so product identity, privacy/local state, current context, and secondary actions have distinct hierarchy; remove duplicate visible status statements and demote generation/schema/DTO labels to methodology or developer-only disclosure.
- Reorganize `Words & Years` visually as summary → visualization → primary ranking → year comparison → collapsed detailed table → collapsed methodology without removing any data or changing metric semantics.
- Add privacy-safe local PNG export for an annual summary card and a word cloud through a bounded renderer-to-host image contract and the existing native save authority.
- Preserve the detailed Dashboard, canonical v2, fixed UTC+08:00 semantics, current filters/query generation/cancellation/stale suppression, local-only runtime, and aggregate export authority.

## Non-goals

- Developer ID signing, notarization, stapling, automatic updates, public Release distribution, formal Release security certification, or exhaustive Release testing.
- Windows packaging or the existing deferred Release-hardening tasks D.1–D.10.
- Accounts, cloud sync, upload, telemetry, remote fonts/images/assets, cloud NLP, or AI-generated summaries.
- Chat-body search, source-message/context playback, participant profiles, contact-name inference, relationship inference, sentiment analysis, personality or psychological diagnosis.
- Replacing, deleting, or reducing any existing Dashboard route, metric, filter, query, or aggregate JSON/CSV/chart-PNG export.
- Rewriting Dashboard data logic or Worker query commit semantics as part of visual uplift; Beta may change typography, spacing, surfaces, controls, navigation styling, tables, charts, disclosures, badges, and metadata hierarchy only.
- Executing private-data Stage 12.7/12.8, legacy Stage 13.10/15.10, or recording any private aggregate as implementation evidence.
- Full dark mode, possible-name filtering or named-entity recognition, a general-purpose NLP pipeline, chapter-by-chapter PNG, or long/multipage report export in the first Beta.
- The screenshot-driven B1b/Annual Recap visual refinement backlog (sticky toolbar weight, native select styling, forced equal heights, duplicate ready badges, over-expanded tables, excess serif hierarchy, dashboard-like cards, long vocabulary tables, density, and scene rhythm) is recorded but not implemented by this correctness hotfix.

## Capabilities

### New Capabilities

- `beta-annual-recap`: Defines the Beta product information architecture, report semantics and chapters, presentation/word-cloud contracts, deterministic layout, local vocabulary policy, visual and motion system, accessible responsive behavior, privacy-safe sharing, performance budgets, and staged acceptance.

### Modified Capabilities

None. The repository has no main `openspec/specs/` capability baseline, and this independent change does not revise the requirements of either existing Alpha change.

## Impact

- Planned frontend areas: `frontend/src/presentation/`, a new Beta presentation/report module, shared low-risk presentation primitives for the existing Dashboard, `frontend/src/worker-analysis/`, a new layout Worker, and explicitly scoped additions following the existing `frontend/src/styles.css` class/custom-property architecture.
- Planned host areas: compatible additions to `frontend/src/desktop/`, `src-tauri/src/ipc.rs`, `src-tauri/src/export.rs`, and `src-tauri/src/export_schema.rs` for a bounded opaque-binary presentation-PNG save authority; no broader filesystem, shell, HTTP, opener, updater, or window authority.
- Planned tests use only existing or new synthetic fixtures under `frontend/tests/`, `src-tauri` tests, and packaged synthetic acceptance scripts.
- Existing dependencies `React`, `ECharts`, `echarts-wordcloud`, `jieba-wasm`, Tauri 2, Rust, and the packaged PyInstaller `onedir` sidecar remain available. B1–B5 add no UI framework, CSS-in-JS system, icon pack, word-cloud library, animation framework, CDN, or remote font; the deterministic Beta layout does not rely on `echarts-wordcloud` random placement.
- Production implementation is intentionally deferred to separate Luna Max batches; this change contains planning artifacts only.
