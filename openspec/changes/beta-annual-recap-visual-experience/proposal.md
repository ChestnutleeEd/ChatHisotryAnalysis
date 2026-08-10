## Why

The Beta now has the local desktop runtime, complete annual facts, Detailed Analysis, scoped vocabulary evidence, Clean Mode, and deterministic word cloud, but packaged visual acceptance rejected its presentation quality. Repeated cards, unstable column spans, excessive display type, uniform blue-bar charts, toolbar-like navigation, and almost no art direction make Annual Recap feel like a decorated Dashboard and Detailed Analysis feel like an engineering console.

Visual re-architecture must therefore precede B5 sharing/motion and B6 packaged acceptance. The accepted analytics, privacy, query, vocabulary, word-cloud geometry, and export-authority contracts remain protected; this change refreezes only presentation architecture and a repository-owned generated-art pipeline.

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
- Replace the first visual system with Design System v2: a semantic palette, a restrained serif/sans type hierarchy, predictable 12-column desktop grid, explicit spacing/surface/radius rules, fewer cards, and separate Annual/Detailed density modes.
- Recompose the sixteen logical Annual sections into seven visual scenes—Opening, Scale, Rhythm, Balance, Conversation, Vocabulary, and Closing—without changing their order, facts, anchors, empty states, or word-cloud geometry.
- Establish a formal generated-art direction and offline asset inventory for the Annual opening, transitions, vocabulary frame, closing poster, and optional Home decoration. Generated rasters remain generic, synthetic, text-free, data-free, locally optimized, and repository-owned; live generation, remote URLs, CDN assets, and private-data prompts are prohibited.
- Recompose Detailed Analysis as a modern data workspace with a compact header/query bar/section rail, concise metric anatomy, chart hierarchy, progressive methodology, and predictable information density while preserving every route and analytical behavior.
- Add a fixed screenshot set and a human visual acceptance rubric covering hierarchy, alignment, consistency, density, rhythm, balance, readability, contrast, scanability, composition, story progression, artwork integration, chart clarity, and navigation clarity.
- Treat the completed B1a/B1b presentation as a functional baseline, then supersede its rejected visual decisions through three bounded v2 batches with human screenshot gates.
- Refine the App Shell and workflow status so product identity, privacy/local state, current context, and secondary actions have distinct hierarchy; remove duplicate visible status statements and demote generation/schema/DTO labels to methodology or developer-only disclosure.
- Reorganize `Words & Years` visually as summary → visualization → primary ranking → year comparison → collapsed detailed table → collapsed methodology without removing any data or changing metric semantics.
- Add privacy-safe local PNG export for one annual summary/share card through a bounded renderer-to-host image contract and the existing native save authority.
- Freeze B5 as one high-quality 4:5 annual keepsake template rather than a template gallery: one 1200×1500 opaque PNG, a concise default summary, and an explicit optional vocabulary summary of at most five already-visible terms. Full word-cloud, chapter, long-image, PDF, video, GIF, clipboard, social, and automatic-sharing exports remain outside B5.
- Add a dedicated summary presentation chain—committed report/frequency evidence → pure summary adapter → fixed `zh-CN` presenter → privacy-stripped share-card view-model—so React never recomputes analytics or authors business conclusions.
- Add an in-app share-preview dialog/full-screen narrow sheet, deterministic Canvas 2D renderer, one-use raw-binary Tauri lease/save flow, explicit user-selected native destination, stable cancellation/failure recovery, and lightweight reduced-motion-safe completion feedback.
- Record that 5B.23 is accepted for progression while known module-level visual polish debt remains; this authorizes B5 implementation only and does not claim that all Annual/Detailed visual debt is resolved.
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
- Production React/CSS/Rust/TypeScript implementation or final image generation in this B5 planning-freeze batch. B5 implementation remains split into bounded later batches with independent stop points.

## Capabilities

### New Capabilities

- `beta-annual-recap`: Defines the Beta product information architecture, report semantics and chapters, presentation/word-cloud contracts, deterministic layout, local vocabulary policy, Design System v2, generated-art asset boundary, accessible responsive behavior, privacy-safe sharing, performance budgets, visual acceptance, and staged delivery.

### Modified Capabilities

None. The repository has no main `openspec/specs/` capability baseline, and this independent change does not revise the requirements of either existing Alpha change.

## Impact

- Planned presentation areas for V1–V3: `frontend/src/presentation/beta/`, `frontend/src/presentation/DesktopDashboard.tsx`, the Beta-owned portions of `frontend/src/presentation/DesktopImportPanel.tsx`, scoped CSS currently housed in `frontend/src/styles.css`, browser acceptance tests, and a new repository-owned `frontend/src/assets/beta/art/` directory created only during implementation.
- Planned host areas: compatible additions to `frontend/src/desktop/`, `src-tauri/src/ipc.rs`, `src-tauri/src/export.rs`, and `src-tauri/src/export_schema.rs` for a bounded one-use opaque-binary presentation-PNG save authority. The existing numeric aggregate export remains unchanged; no broader filesystem, shell, HTTP, opener, updater, clipboard, social, or window authority is added.
- Planned tests use only existing or new synthetic fixtures under `frontend/tests/`, `src-tauri` tests, and packaged synthetic acceptance scripts.
- Existing dependencies `React`, `ECharts`, `echarts-wordcloud`, `jieba-wasm`, Tauri 2, Rust, and the packaged PyInstaller `onedir` sidecar remain available. V1–V3 add no UI framework, CSS-in-JS system, icon pack, word-cloud library, runtime image-generation client, animation framework, CDN, remote font, or remote image dependency; generated art is copied into and bundled from the repository only after review and optimization.
- Production implementation is intentionally deferred to separate Luna Max batches; this change contains planning artifacts only.
