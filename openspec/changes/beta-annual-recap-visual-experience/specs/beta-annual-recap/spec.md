## ADDED Requirements

### Requirement: Protected Alpha substrate and local privacy boundary
The Beta Annual Recap SHALL consume only the accepted canonical-v2 Analytics Worker result and approved versioned Beta DTOs. It SHALL preserve the detailed Dashboard, source-selection/preprocessing/canonical handoff, offline/no-account/no-upload/no-telemetry behavior, query lifecycle, and existing exports. It MUST NOT read raw CipherTalk JSON, place the canonical dataset in React state, tokenize or scan message bodies on the main thread, request an external resource, or expand general Tauri filesystem/network/shell authority.

#### Scenario: Enter recap after desktop analysis
- **WHEN** a canonical result has been committed for the active session and generation
- **THEN** Home and Annual Recap render from that result without reopening a selected source or transporting canonical events into React state

#### Scenario: Preserve detailed analysis
- **WHEN** Beta is enabled and the user enters Detailed Analysis
- **THEN** Overview, Trends, Comparison, Activity, Words & Years, Message Types, Replies & Sessions, Export, their metrics, filters, and aggregate exports remain available with their existing semantics

#### Scenario: Reject a main-thread fallback
- **WHEN** the Analytics Worker or layout Worker cannot run
- **THEN** the UI shows a content-free retry/reselect or list-only failure state and does not parse, tokenize, aggregate, or lay out canonical records on the React main thread

### Requirement: Post-analysis Home and two-level information architecture
After a successful analysis, the application SHALL enter a post-analysis Home. Home SHALL present “查看年度聊天报告” as the primary action and “进入详细分析” as a persistent secondary action. Annual Recap and Detailed Analysis SHALL be peer modes rather than one replacing the other.

#### Scenario: Successful first entry
- **WHEN** analysis publishes a non-empty committed result
- **THEN** Home identifies local-only analysis, offers both mode actions, and makes Annual Recap the primary action without hiding Detailed Analysis

#### Scenario: No represented user messages
- **WHEN** the committed scope has zero post-dedup user messages
- **THEN** Home and Annual Recap show an explicit empty state and leave Detailed Analysis and reselect actions available

### Requirement: Represented-year and calendar-scope semantics
The product SHALL distinguish represented year, full-calendar query scope, partial-calendar query scope, and source completeness. It MUST NOT claim that a year is a complete export. The default annual year SHALL be the latest represented year whose full January 1–December 31 calendar is contained by the current query, falling back to the latest represented year with a partial-scope disclosure.

#### Scenario: Multiple represented full-calendar years
- **WHEN** the current query contains multiple represented years and at least one full calendar year
- **THEN** Annual Recap defaults to the greatest represented full-calendar-scope year and also offers every represented year and Multi-year Overview

#### Scenario: Only partial represented year
- **WHEN** no represented year has a full calendar contained in the current query
- **THEN** Annual Recap defaults to the latest represented year and visibly says that current query coverage is partial without claiming missing source data

#### Scenario: One represented year
- **WHEN** exactly one represented year exists
- **THEN** the primary Home action enters that year directly while keeping the year/scope control visible

#### Scenario: Empty year intersection
- **WHEN** a candidate year does not intersect the active inclusive date bounds or has no user messages
- **THEN** it is disabled or yields an explicit no-data state and no statistics from another year are shown

### Requirement: Year selection and multi-year overview
Annual selection SHALL support a concrete represented year, all current years, and Multi-year Overview. The report controller SHALL retain an in-memory `reportBaseRange` established by initial analysis, explicit global filter Apply, all-years selection, or restore-full-range. A concrete year SHALL use the intersection of that base range and the calendar year, leave the base unchanged, and commit only effective bounds plus selected year. `reportBaseRange` MUST NOT enter `canonicalQueryKey`. Multi-year comparisons SHALL retain partial-period labels and omit year-over-year claims that lack comparable full-calendar scopes.

#### Scenario: Select a concrete year
- **WHEN** the user selects year YYYY
- **THEN** the report query applies `max(baseStart, YYYY-01-01)` through `min(baseEnd, YYYY-12-31)`, sets selected year YYYY, and publishes only a matching committed result

#### Scenario: Switch directly between years
- **WHEN** 2024 is committed from a multi-year `reportBaseRange` and the user next selects 2025
- **THEN** the 2025 bounds are intersected with the preserved base range rather than the narrowed 2024 effective query

#### Scenario: Select all years
- **WHEN** the user selects all years
- **THEN** the report commits `reportBaseRange` with selected year cleared and omits annual-distinctiveness claims that require a selected comparison year

#### Scenario: Compare multiple years
- **WHEN** the user opens Multi-year Overview
- **THEN** it shows existing yearly message/token trends with partial labels and computes year-over-year change only between eligible comparable calendar scopes

### Requirement: Shared applied query and mode preservation
Annual Recap and Detailed Analysis SHALL share the **committed** date range, sender, UTC+08:00 timezone, applied selected year, and session threshold. Draft date/sender/year/threshold controls SHALL remain local until explicit Apply succeeds. Report mode, Dashboard route, report chapter/scene, scroll position, raw/per-10k display, custom-hidden preferences, and reduced-motion state MUST NOT enter `canonicalQueryKey`. Mode switching SHALL preserve committed query plus in-memory navigation without rereading sources. The UI SHALL provide an explicit action to restore dataset-wide dates and clear the applied selected year. Dataset/generation replacement SHALL reset report/navigation state and fence stale work.

#### Scenario: Round-trip modes
- **WHEN** the user selects a report year, enters Detailed Analysis, and returns
- **THEN** both modes show the same committed filter/year/threshold and no raw source or canonical dataset is reloaded

#### Scenario: Restore full range
- **WHEN** the user activates “恢复全部数据范围”
- **THEN** the Worker query returns to dataset minimum/maximum inclusive dates while retaining a valid sender and session threshold

#### Scenario: Recover after reload
- **WHEN** the existing startup-recovery flow restores a committed result
- **THEN** the product returns to Home without persisted tokens/dataset IDs/report DTOs and reconstructs `reportBaseRange` from committed dates when no year is selected or from dataset min/max with a visible safe-default label when the result is year-narrowed

#### Scenario: Edit draft or navigate
- **WHEN** the user edits an unapplied filter, changes app mode, Dashboard route, report chapter, scroll position, raw/per-10k display, or custom-hidden preferences
- **THEN** none of those UI-only transitions changes the committed canonical analytics key; only a successful explicit analytics Apply may publish a new committed key

### Requirement: Committed annual scope synchronization
The visible Annual Recap selection SHALL describe the currently committed analytical result, not an optimistic request. A year transition SHALL publish the selector, report query/DTO, core cards, scoped frequency DTO, distinctive-keyword year, cloud presentation, accessible list, and scope labels as one correlated scope. Retained prior evidence MAY remain available during refresh only while it retains its prior selector/scope label. A mismatched frequency DTO or late layout result MUST be suppressed. Selecting Multi-year Overview from a concrete year SHALL first restore the preserved `reportBaseRange` with `selectedYear=null`; selecting all years SHALL do the same. Route, chapter, scroll, metric display, clean mode, and custom-hidden state SHALL remain outside analytical identity.

#### Scenario: Switch directly across annual scopes
- **WHEN** the user commits Year A, then Year B, then all years from a multi-year `reportBaseRange`
- **THEN** every published report/frequency/keyword/cloud identity matches Year A, then Year B, then the broad base range, without intersecting Year B with Year A or relabelling stale evidence

#### Scenario: Open multi-year overview from an annual result
- **WHEN** a concrete year is committed and the user selects Multi-year Overview
- **THEN** the committed analytical bounds return to `reportBaseRange`, `selectedYear` is cleared, and the overview does not render year-narrowed cards, frequency evidence, or cloud data

#### Scenario: Reject stale word evidence
- **WHEN** a retained frequency DTO or layout result belongs to another base query, year, role, dataset, or generation
- **THEN** it is not rendered under the current selector and cannot overwrite the current cloud/list presentation

### Requirement: Fixed annual narrative and logical-section contracts
Annual Recap SHALL use the fixed logical order: Opening; Messages; Active Days; Longest Streak; Peak Month; Peak Weekday; Peak Hour; Sender Share; Message Length; Message Types; Sessions; Replies; Frequent Words; Distinctive Keywords; Word Cloud; Summary and Share. Each logical section SHALL define its user question, primary metric, template ID, supporting visual, source, empty/insufficient state, filter exception, export eligibility, and multi-year eligibility as frozen in `design.md`. Adjacent logical sections MAY share one responsive visual scene; sixteen full-screen cards are not required.

#### Scenario: Render a complete report
- **WHEN** all candidate metrics have sufficient synthetic evidence
- **THEN** the sixteen accessible logical sections appear in fixed order and each reads only validated presentation fields, while related sections may share fewer content-driven visual scenes without losing headings or metrics

#### Scenario: Omit an unsupported conclusion
- **WHEN** a chapter metric has zero denominator, inadequate sample, no positive candidate, or incompatible comparison scope
- **THEN** that chapter shows a named empty/insufficient reason and does not substitute a guessed value or sentence

#### Scenario: Keep engineering fields out of the story
- **WHEN** a yearly keyword chapter is rendered
- **THEN** year/rest totals, message DF, raw score, query key, generation, and trace tables are absent from the hero content and available only through concise methodology or Detailed Analysis

### Requirement: Factual and non-evaluative metric language
The annual presentation SHALL describe counts, distributions, time intervals, code-point lengths, token frequencies, and statistical distinctiveness only. It MUST NOT infer affection, attention, initiative, relationship quality, personality, psychological state, or intent. Reply metrics SHALL be called reply intervals or median reply latency and SHALL include sample count and threshold context.

#### Scenario: Present replies
- **WHEN** a responder has one or more eligible reply intervals
- **THEN** the report displays the median interval, sample count, active session threshold, and a non-evaluative explanation

#### Scenario: No reply evidence
- **WHEN** no eligible reply interval exists
- **THEN** the report says evidence is insufficient and does not present zero seconds or a relational conclusion

### Requirement: Metric support and presentation derivation
The implementation SHALL follow the metric classifications and sources frozen in `design.md`. Presentation-only derivations SHALL be pure, deterministic, and tested. Average daily messages SHALL divide selected post-dedup user messages by every inclusive calendar day in scope, including zero-message days. Peak metrics SHALL return all ties in canonical bucket order.

#### Scenario: Compute average daily messages
- **WHEN** a selected annual scope spans N inclusive calendar days
- **THEN** the presentation adapter reports user-message count divided by N and labels the denominator as calendar days rather than active days

#### Scenario: Resolve a tied peak
- **WHEN** two months, weekdays, or hours share the maximum non-zero count
- **THEN** the sentence and visual include both in canonical chronological/fixed bucket order

#### Scenario: Prior year is zero or partial
- **WHEN** year-over-year change has a zero prior denominator or incomparable partial scope
- **THEN** the change is unavailable with a reason instead of infinity, zero, or a misleading percentage

### Requirement: Frequent-word and distinctive-keyword separation
Frequent words SHALL mean eligible tokens with the highest count in the current query/year. Distinctive yearly keywords SHALL mean eligible tokens relatively more characteristic of the selected year than other represented years using the existing smoothed year-vs-rest log-odds contract and thresholds. The UI SHALL use distinct labels and a short accessible methodology explanation.

#### Scenario: Multi-year distinctive keyword
- **WHEN** a selected year has qualifying positive-score candidates and a non-empty rest corpus
- **THEN** the report labels them “最能代表这一年的词” and does not describe them as the most frequent words

#### Scenario: Single-year fallback
- **WHEN** only one represented year is available
- **THEN** the keyword chapter identifies frequency fallback and does not claim year-vs-rest distinctiveness

#### Scenario: Show frequent words
- **WHEN** a word ranking is available for the selected scope
- **THEN** the report labels it “今年最常提到” or equivalent and exposes raw count or per-10,000 eligible-token rate with its denominator

### Requirement: Versioned Beta report query, result, and responsibility boundaries
The system SHALL define and validate versioned `BetaReportQuery`, locale-neutral `BetaReportDto`, localized report view-model, word-frequency DTO, layout DTO, and export view-model contracts matching `design.md`. Numeric/factual evidence SHALL be calculated in the Analytics Worker; semantic facts, derived labels, reasons, and template IDs in a presentation adapter; fixed locale-specific sentences in a small `zh-CN` presenter before render; geometry in the layout Worker; passive rendering/interaction/focus in React; pixels in the export renderer; and destination/save authority in Rust. Beta MUST NOT add a general i18n framework. React component render functions MUST NOT calculate statistics, select templates, or assemble business prose.

#### Scenario: Build a report DTO
- **WHEN** a validated canonical result and matching word-frequency DTO are available
- **THEN** the presentation adapter emits an exact-key locale-neutral DTO with semantic facts, value models, template IDs, reason codes, methodology, privacy, and export metadata, after which the fixed `zh-CN` presenter emits ready-to-render sentences

#### Scenario: Reject a mismatched DTO
- **WHEN** dataset, generation, base query, schema version, timezone, or policy identity does not match current committed state
- **THEN** the report is rejected as stale/invalid and the prior complete report remains readable

#### Scenario: Strip private/internal fields
- **WHEN** the report DTO is converted to an export view-model
- **THEN** dataset IDs, query keys, generation, source metadata, hidden-word values, trace fields, and message content are absent

### Requirement: Scoped word-frequency Worker DTO
The Analytics Worker SHALL compatibly extend the canonical analysis path with a bounded envelope containing up to 400 ranked eligible candidates for year/all-years and both/owner/other roles. Envelope metadata SHALL carry dataset/generation/base-query/frequency identity, timezone, year, role, built-in-policy identity, and the exact eligible-token denominator/definition once. Each item SHALL carry only normalized token, raw count, per-10,000 rate, analytical rank, script category, and bounded non-hidden quality flags. Display token/rank belong to presentation. The result MUST NOT duplicate envelope fields per item or contain message body, source metadata, participant identity, token context, custom-hidden values, or a redundant original token.

#### Scenario: Raw ranking
- **WHEN** raw-count mode is requested for a year and role
- **THEN** the Worker sorts eligible tokens by count descending and Unicode code-point order for ties and returns the exact eligible-token denominator

#### Scenario: Normalized ranking
- **WHEN** per-10,000 mode is requested
- **THEN** the Worker returns `count * 10000 / eligibleTokenDenominator`, handles zero denominator explicitly, and keeps raw count for explanation

#### Scenario: Change a custom hidden word
- **WHEN** the user adds or removes a custom hidden token
- **THEN** no Analytics Worker request or frequency identity changes; presentation filters the bounded pool, derives contiguous display rank, and preserves every count, rate, and eligible-token denominator

### Requirement: Local vocabulary quality policy
`beta-vocabulary-policy.v1` SHALL preserve current NFKC/lowercase/local Jieba/fixed-stopword semantics and exclude URLs, punctuation/symbol/emoji separators, pure numbers, tokens shorter than two code points, invisible/control tokens, tokens over 32 code points, exact versioned file extensions, and invalid mixed fragments. This built-in analysis policy SHALL define the eligible-token denominator, participate in `frequencyDtoKey`, and operate by filtering the retained Worker token index without source reread or retokenization. It SHALL NOT perform stemming/lemmatization or automatically hide all abbreviations. Limitations for email/path fragments SHALL be disclosed rather than overstated.

#### Scenario: Apply default quality filters
- **WHEN** synthetic tokens contain punctuation, pure numbers, emoji, invisible characters, a versioned extension, an overlong token, and valid Han/Latin words
- **THEN** only policy-eligible words reach the Beta frequent-word/cloud presentation in deterministic order

#### Scenario: Preserve work abbreviation
- **WHEN** a meaningful abbreviation is otherwise eligible
- **THEN** it remains visible unless the user explicitly adds its normalized token to custom hidden words

#### Scenario: Explain uncertain fragments
- **WHEN** token normalization prevents exact reconstruction of email/path origin
- **THEN** methodology states the limitation and the system does not claim that every such fragment was identified

### Requirement: User-managed custom hidden words
Custom hidden words SHALL be stored only in bounded versioned local application-profile preferences, normalized deterministically, editable, reviewable, bulk-pasteable, removable, restorable, and resettable. They SHALL filter only the bounded presentation candidate lists for Beta Frequent Words, Distinctive Keywords, the cloud, its accessible list, and those exports. Their hash SHALL enter `wordPresentationKey` and downstream layout/export identity only; they MUST NOT change `canonicalQueryKey`, `frequencyDtoKey`, Worker requests, analytical rank/count/rate, eligible-token denominator, or Detailed Analysis. Their values MUST NOT enter logs, export metadata, automated evidence screenshots, telemetry, or exports.

#### Scenario: Bulk add and recompute
- **WHEN** the user pastes newline/comma-separated words and confirms
- **THEN** valid unique normalized tokens are stored locally, affected Beta view-model/layout output recomposes synchronously without a Worker call, and export says only that custom filtering is active

#### Scenario: Reset custom words
- **WHEN** the user chooses restore default filtering
- **THEN** the custom set becomes empty, previously custom-hidden eligible tokens can return, and the fixed built-in policy remains active

### Requirement: Vocabulary Clean Mode presentation preference
Annual Recap SHALL provide a prominent “净化常用词” toggle, default-on, using the versioned local `beta-vocabulary-clean-presentation.v1` conservative Chinese/English function-word and discourse lexicon. Clean Mode SHALL be presentation-only and SHALL apply to Frequent Words, Distinctive Keywords, the word cloud, and its accessible list. The pipeline SHALL scan the bounded analytical candidates in their existing order, skip Clean Mode matches, then skip custom-hidden matches, and continue until the consumer's display limit or candidate exhaustion. It SHALL derive contiguous display ranks without changing analytical rank, score, count, rate, denominator, Stage 7, `canonicalQueryKey`, `frequencyDtoKey`, or Analytics Worker requests. Clean Mode state and custom-hidden state SHALL be independent local preferences.

#### Scenario: Toggle clean presentation
- **WHEN** Clean Mode changes on the same scoped frequency DTO
- **THEN** the analytical DTO, count, rate, denominator, analytical rank, keyword score, canonical identity, and frequency identity remain byte-equivalent while the presentation candidates and layout digest may change

#### Scenario: Refill after filtering
- **WHEN** early analytical candidates contain clean-lexicon or custom-hidden matches
- **THEN** presentation continues scanning later candidates in analytical order until the Frequent Words, Keywords, or Word Cloud display target is filled or the bounded candidate pool is exhausted

#### Scenario: Compose independent filters
- **WHEN** Clean Mode is enabled and custom hidden words are present
- **THEN** both filters apply in clean-then-custom order; disabling Clean Mode preserves custom hidden words, and clearing custom hidden words preserves the Clean Mode preference

#### Scenario: All-years keywords
- **WHEN** no concrete year is committed
- **THEN** the Distinctive Keywords presentation uses the existing unavailable/empty semantics and does not present a latest-year keyword list as an all-years claim

### Requirement: Deterministic layout Worker
Word-cloud geometry SHALL be produced by a dedicated local Worker using `beta-wordcloud-layout.v1`, stable weight/count/Unicode sorting, exact-center fixed-phase integer Archimedean spiral, fixed rank/category palette mapping, versioned synthetic Han/Latin/mixed glyph rectangles, zero rotation, 16-pixel spatial-hash collision checks, and at most 4,096 attempts per word. V1 SHALL NOT use a seed or PRNG because no randomized choice remains. Canvas `measureText` MAY only shrink rendering to an assigned safety rectangle and MUST NOT alter Worker coordinates or layout identity. Layout MUST NOT use current time, `Math.random`, locale collation, network fonts, DOM layout, or analytics.

#### Scenario: Equal inputs
- **WHEN** ordered presentation words, bucket/fixed canvas, synthetic-metrics version, limit, and layout version are identical
- **THEN** repeated layout runs return byte-equal coordinates and omitted ranks without dataset-dependent perturbation

#### Scenario: Collision and bounds
- **WHEN** the layout Worker places a mixed Han/Latin synthetic list
- **THEN** every placed safety rectangle is within bounds and no pair overlaps

#### Scenario: Progressive degradation
- **WHEN** all requested words cannot fit within attempt limits
- **THEN** the Worker removes lowest-ranked words in the frozen sequence down to 20, reports degradation, and never changes the analytical ranking

### Requirement: Canvas rendering, responsive buckets, and accessible equivalent
The Beta word cloud SHALL use Canvas for its in-app screen experience with zero-degree text, offline system font stacks, fixed palette, and the term limits/dimensions in `design.md`. Resize inside a bucket SHALL scale; crossing a bucket SHALL relayout without reanalysis. Canvas SHALL be excluded from the accessibility tree and accompanied by one semantic ranked list containing exactly the same bounded selected words, including layout-omitted ranks, with token, display rank, raw count, normalized rate, role, and year. The implementation MUST NOT create a hidden DOM node per Canvas glyph or render the full 400-item candidate pool by default. The existing 1200×1500 fixed cloud-layout fixture MAY remain for deterministic regression tests but B5 MUST NOT expose it as a product export.

#### Scenario: Narrow screen
- **WHEN** report content is below 640 CSS pixels
- **THEN** the 480×520 narrow layout uses at most 50 terms and the semantic list and controls remain usable without horizontal page scrolling

#### Scenario: Reserved fixed layout fixture
- **WHEN** the deterministic 1200×1500 cloud-layout fixture runs in tests
- **THEN** it uses at most 100 terms independent of preview CSS size, device-pixel ratio, or application window size and no B5 UI exposes a full-cloud save action

#### Scenario: Canvas unavailable
- **WHEN** Canvas or animation cannot render
- **THEN** the same bounded selected ranked list and compact textual/bar summary remain available and no selected-cloud information is lost

### Requirement: Design System v2 visual direction and token contract
Annual Recap SHALL use the “Private Data Atelier” consumer-editorial direction and Detailed Analysis SHALL use its denser modern-data-workspace mode. Both SHALL share the semantic color, typography, grid, spacing, surface, radius, border, shadow, focus, state, control, and component roles frozen in `design.md`. The product MUST NOT resemble an enterprise/admin template, finance terminal, neon AI interface, cyber-security icon set, cartoon/game UI, glassmorphism, neumorphism, heavy Material elevation, or image-filled card gallery. Full dark mode SHALL remain deferred; v2 MUST NOT ship an incomplete dark toggle or auto-invert light artwork.

#### Scenario: Compare product modes
- **WHEN** a user switches between Annual Recap and Detailed Analysis
- **THEN** semantic colors, controls, status, and interaction quality clearly belong to one product while Annual is spacious/editorial and Detailed is compact/all-sans

#### Scenario: Preserve non-color meaning
- **WHEN** owner/other or any semantic state is shown
- **THEN** direct labels and geometry/pattern/state text accompany color and satisfy the v2 contrast contract

### Requirement: Typography v2 hierarchy
The interface SHALL implement Display XL, Display, Scene Heading, Section Heading, Card Heading, Metric Hero, Metric, Body Large, Body, Secondary, Label, Metadata, Caption, and Tabular Number exactly as bounded in `design.md`. Serif SHALL appear only in the Annual opening hero, major Annual scene headings, and closing editorial statement. Detailed Analysis, controls, metrics, charts, tables, labels, methodology, and ranking rows SHALL use sans. Metric support text MUST NOT compete with values; a metric's visible descriptor SHALL be concise and longer definitions SHALL move to disclosure.

#### Scenario: Scan Annual opening
- **WHEN** a populated Annual opening renders
- **THEN** range/year, one editorial sentence, one Metric Hero, and artwork establish a clear order without multiple competing display headings

#### Scenario: Scan Detailed metric
- **WHEN** Detailed Overview renders a metric
- **THEN** Label, Metric, Unit, ≤2-line descriptor, and optional navigation are legible in sans while methodology is absent from the primary card

### Requirement: Predictable responsive grid and spacing v2
V2 SHALL use the named 12-column Wide/Standard, 8-column Compact, and 4-column Narrow grids, outer margins, gutters, approved spans, and spacing tokens in `design.md`. It MUST NOT use auto-fit or arbitrary widths for major composition. Long Chinese headings MUST NOT be placed in a 4-column desktop card. At 1180×760 the opening SHALL read as one near-complete composition; at ~760, ~380, and 200% zoom the layout SHALL preserve order, focus, labels, and alternatives without horizontal page scroll.

#### Scenario: Render standard Annual
- **WHEN** the viewport is 1180×760
- **THEN** Opening uses the frozen `7+5` split and later scenes use their named spans without arbitrary equal-card grids or forced equal heights

#### Scenario: Render compact and narrow
- **WHEN** the content is ~760 or ~380 CSS pixels wide or zoom reaches 200%
- **THEN** each major scene follows its explicit reflow/crop/hide strategy and no multi-column desktop grid is merely squeezed via auto-fit

### Requirement: Reduced card dependency and component system v2
Primary scene composition SHALL be allowed directly on a borderless/radius-zero scene canvas. Supporting cards SHALL use the v2 card/surface roles and MUST NOT contain repeated full-border rounded rectangles at every level. Implementation SHALL plan around `Scene`, `SectionHeader`, `Metric`, `MetricGroup`, `Surface`, `Inset`, `ChartFrame`, `Disclosure`, `Navigation`, `ToggleChip`, and `ArtworkFrame`; it MUST NOT create one component per typography token or per logical section. `BaseCard` MAY remain for compatibility but MUST NOT force every logical section to render as an `article` card.

#### Scenario: Compose a major scene
- **WHEN** Opening, Word Cloud, or Closing is rendered
- **THEN** the scene can carry text, data, and artwork directly without an outer white card or nested card-on-panel-on-card structure

#### Scenario: Preserve interaction boundaries
- **WHEN** a control is selected, focused, disabled, invalid, or loading
- **THEN** its boundary and state remain visible even though non-interactive content uses fewer borders and shadows

### Requirement: Generated artwork and offline asset boundary
V1/V2 SHALL treat generated artwork as first-class editorial structure using the asset inventory, palette, prompt boundary, crop rules, file targets, fallbacks, and review workflow in `design.md`. Every prompt MUST be generic, synthetic, abstract, and free of real chat text, keywords, contacts, company names derived from chat, statistics, filenames, paths, screenshots, or private evidence. Artwork MUST NOT bake year, metrics, words, chart data, or user-specific content into pixels. Selected assets SHALL be optimized repository-owned local files under the planned Beta asset directory and bundled offline; runtime generation APIs, remote URLs, CDN files, remote fonts, and network fetches are prohibited.

#### Scenario: Generate candidate artwork
- **WHEN** V1 or V2 produces an opening, transition, vocabulary, closing, or Home candidate
- **THEN** it generates 2–4 generic variants as separate built-in image-generation calls, reviews them in layout context, keeps only passing optimized candidates, and uses the documented CSS/SVG fallback if none pass

#### Scenario: Package artwork offline
- **WHEN** the packaged application renders Annual Recap without network access
- **THEN** every selected artwork loads from the repository bundle with explicit dimensions and no external request, while the UI remains complete if decorative art is hidden

#### Scenario: Keep data separate from art
- **WHEN** a user changes year, sender, filters, Clean Mode, or report facts
- **THEN** React/Canvas/SVG data layers update independently and the same generic artwork remains reusable

### Requirement: Seven-scene Annual Recap architecture v2
The sixteen logical sections SHALL remain in their fixed accessible order but SHALL be composed into Opening, Scale, Rhythm, Balance, Conversation, Vocabulary, and Closing using the purposes, dominant visuals, spans, supporting information, artwork, and disclosure strategies in `design.md`. Opening SHALL contain range/year, one strong sentence, one strong metric, and generated hero artwork. Scale SHALL combine messages/days/streak; Rhythm SHALL unify month/weekday/hour; Balance SHALL unify anonymous role share/length/types; Conversation SHALL unify sessions/initiator/replies; Vocabulary SHALL distinguish three word modes and make Word Cloud the visual climax; Closing SHALL use a poster composition, local/privacy statement, B5 share slot, and Detailed CTA rather than a large unavailable card.

#### Scenario: Read the complete Annual story
- **WHEN** all sixteen logical sections have sufficient synthetic data
- **THEN** seven visually distinct scenes preserve all headings, metrics, sources, empty states, filter exceptions, and details in the frozen order

#### Scenario: Render the first viewport
- **WHEN** Annual Recap opens at 1180×760
- **THEN** range/year, one sentence, one dominant metric, and `annual-opening-hero` form one coherent near-viewport composition without a dashboard-card grid

#### Scenario: Reach Closing before B5
- **WHEN** Summary/Share behavior is still deferred
- **THEN** Closing presents the accepted poster/privacy/CTA structure and a reserved share position without claiming sharing exists or centering “尚未提供” as the visual conclusion

### Requirement: Navigation v2 hierarchy
App-level Home/Annual/Detailed navigation SHALL be visually primary and quiet. Annual report navigation SHALL use a ≤52px desktop sticky bar with compact year selection, current scene label, and seven-scene progress plus an accessible logical-section picker. Detailed section navigation SHALL remain subordinate. Each level SHALL have distinct selected-state treatment, keyboard operation, visible focus, labelled controls, safe `scroll-margin-top`, and Compact/Narrow behavior that does not cover focused content.

#### Scenario: Navigate Annual by keyboard
- **WHEN** a keyboard user changes year, advances scenes, or opens the logical chapter picker
- **THEN** focus remains visible, the committed scope stays correlated, the current scene is announced, and the sticky bar does not obscure the target heading

#### Scenario: Distinguish three levels
- **WHEN** Detailed Analysis is active
- **THEN** app mode, report progress, and the eight-section Detailed rail cannot be mistaken for one another

### Requirement: Vocabulary experience v2 distinction
Frequent Words SHALL use an editorial frequency ranking, Distinctive Keywords SHALL use bounded typographic highlights with statistical context, and Word Cloud SHALL use the unchanged deterministic geometry as a full-width climax with external controls/explanation/list trigger. Clean Mode SHALL use an accessible reversible `ToggleChip`; custom hidden words SHALL remain separately reviewable. Generated vocabulary art SHALL be decorative perimeter/frame content only and MUST NOT reduce cloud contrast, available geometry, or accessible alternatives.

#### Scenario: Compare three vocabulary modes
- **WHEN** Frequent Words, Distinctive Keywords, and Word Cloud are viewed consecutively
- **THEN** their composition communicates frequency, annual distinctiveness, and overall lexical landscape respectively rather than presenting three similar ranked tables

#### Scenario: Toggle Clean Mode
- **WHEN** the user toggles the semantic Clean Mode chip
- **THEN** native state, focus, label, reversibility, analytical invariants, and list/cloud correlation remain intact

### Requirement: Detailed Analysis workspace v2 without semantic change
Detailed Analysis SHALL use `Header → Query Bar → Section Rail → Content`, all-sans typography, compact systematic controls, concise metric anatomy, grouped Overview composition, purpose-specific charts, progressive methodology, and controlled table density. It MUST preserve all eight routes, props, callbacks/timing, Worker requests/protocols/results, canonical query identity, filter validation/explicit Apply, selected-year/threshold lifecycle, metric values/order, pending retention, stale suppression, loading/error/recovery, and export payload/authority. Overview MUST NOT render eight equal cards whose primary content includes long methodology paragraphs.

#### Scenario: Recompose Overview
- **WHEN** Detailed Overview renders
- **THEN** one dominant selected-message metric, an Activity pair, Owner/Other comparison, and Replies/Sessions group are scannable, while definitions and schema detail remain in disclosure

#### Scenario: Preserve behavior
- **WHEN** identical synthetic inputs, filters, thresholds, routes, pending transitions, and export actions run before and after V3
- **THEN** analytical values, keys, calls, states, and outputs remain equivalent

#### Scenario: Open Words & Years
- **WHEN** the user enters Words & Years
- **THEN** Summary, Key Visualization, Primary Ranking, Year Comparison, collapsed yearly details, and collapsed methodology appear in that order with every existing field still reachable

### Requirement: Chart language v2 and exact alternatives
The UI SHALL implement Hero Chart, Standard Chart, Micro Chart, Comparison Bar, Distribution Strip, Timeline, and Rank Bars according to their frozen purpose, density, labels, annotations, grid, and accessible fallback. Unrelated data MUST NOT default to the same blue horizontal/vertical bar in a beige panel. Every chart SHALL expose a title, primary insight, direct labels/units, non-color meaning, and an exact list/table alternative.

#### Scenario: Read Rhythm
- **WHEN** the Annual Rhythm scene is rendered
- **THEN** month is the primary Landscape/Hero chart and weekday/hour are subordinate distribution strips with one combined exact-data disclosure

#### Scenario: Read without color or Canvas
- **WHEN** color perception, Canvas rendering, or visual chart inspection is unavailable
- **THEN** sentence summaries, labels, geometry/pattern where present, and exact lists/tables communicate all values

### Requirement: Visual screenshot acceptance and human stop gates
V1, V2, and V3 SHALL each capture the fixed screenshot set applicable to the batch and score Hierarchy, Alignment, Consistency, Density, Rhythm, Balance, Readability, Contrast, Scanability, Composition, Story Progression, Artwork Integration, Chart Clarity, and Navigation Clarity as `PASS`, `NEEDS POLISH`, or `FAIL`. Home, Annual Opening, Scale, Rhythm, Balance, Conversation, Frequent Words, Keywords, Word Cloud, Closing, Detailed Overview, and Detailed Words & Years SHALL all be accepted before B5/B6. Any `FAIL`, inaccessible control, unclear data meaning, obvious generated-art defect, offline asset failure, or broken 1180/760/380 crop SHALL block the next batch. Each V batch SHALL stop for human review.

#### Scenario: Finish V1
- **WHEN** V1 automated checks pass
- **THEN** Home, Opening, navigation, and Detailed shell screenshots are presented and implementation stops until human visual acceptance

#### Scenario: Finish V2 or V3
- **WHEN** the applicable full Annual or Detailed screenshot set is captured
- **THEN** rubric results and unresolved polish are recorded and the next stage does not begin while any category is `FAIL`

### Requirement: Unified motion and reduced-motion behavior
Motion introduced in B5 SHALL use the frozen 120/220/420ms durations, `cubic-bezier(.2,.8,.2,1)` easing, and at most 180ms total stagger. It SHALL be limited to one-shot scene opacity/8px translate, Share Preview opacity/scale, and one non-looping export-success mark. B5 MUST NOT add count-up, delayed chart/cloud content, scroll hijack, parallax, horizontal storytelling, continuous particles/drift, long intro, cursor effects, a new animation dependency, or `transition: all`. Motion MUST NOT start analytics, change data/layout/Canvas pixels, hide or delay final information, move focus, or become required for correctness. Reduced motion and animation failure SHALL show the final static state immediately.

#### Scenario: Standard motion
- **WHEN** motion is allowed and a committed chapter enters view
- **THEN** the already-present chapter may reveal once with only transform/opacity inside the frozen duration/stagger cap and remains interruptible

#### Scenario: Reduced motion
- **WHEN** `prefers-reduced-motion: reduce` is active
- **THEN** scene/preview/success transitions, smooth scroll, and incidental cross-fades are disabled while every value, control, state, and layout remains identical

### Requirement: First-Beta sharing scope and privacy
First Beta B5 SHALL export exactly one annual Summary / Share Card product: one fixed 4:5 archival-folio template as an opaque 1200×1500 PNG. It SHALL support one optional “包含词汇摘要” content toggle, default off, that adds no more than five current Frequent Words after Clean Mode and custom-hidden filtering; it SHALL NOT export Distinctive Keywords, counts/rates, hidden words, or the full word cloud. Template galleries, aliases, chapter/word-cloud/long/multipage/PDF/video/GIF exports, clipboard automation, social actions, and automatic save/upload SHALL be absent. The card SHALL visibly include scope title/range/partial state, total messages, active days, peak month availability/ties, longest streak availability, anonymous Owner/Other comparison, applied sender-filter note, UTC+08:00, local-only status, and a small product signature. It SHALL omit generation time, session threshold, contact/source identity, internal IDs/keys/versions, and detailed methodology.

#### Scenario: Export default summary card
- **WHEN** the user confirms a current committed summary-card preview
- **THEN** the PNG contains only the frozen descriptive facts and anonymous roles from the matching share-card view-model and contains no body, contact name/alias, source path/name, internal ID, query key, token trace, hidden word, full cloud, or detailed methodology table

#### Scenario: Explicitly include vocabulary summary
- **WHEN** the user enables the vocabulary option on a current preview
- **THEN** the card includes at most the first five current contiguous display ranks after Clean Mode and custom-hidden filtering and never restores or replaces a filtered term

#### Scenario: Vocabulary is unavailable
- **WHEN** zero eligible visible frequent words remain
- **THEN** the vocabulary toggle is disabled with an explanation and the concise card remains exportable when required summary evidence exists

#### Scenario: Partial or missing evidence
- **WHEN** a committed report covers a partial range or lacks an optional peak/streak/comparison fact
- **THEN** partial scope is visibly labelled and reserved optional slots say evidence is insufficient; zero total user messages disables export rather than borrowing another scope

#### Scenario: Unsupported long image
- **WHEN** the user looks for another template, full word cloud, chapter, long, multipage, PDF, video, GIF, clipboard, or social export in B5
- **THEN** it is absent and does not block the one summary-card export

### Requirement: B5 summary presenter and preview state authority
The system SHALL build `BetaSummaryDtoV1` only from one matching committed Analytics Worker result, existing `BetaReportDtoV1` facts, and an optional matching filtered word presentation. A pure summary adapter SHALL select and classify existing facts; a fixed `zh-CN` presenter SHALL own descriptive sentences and number/date formatting; an exact-key privacy-stripped `ShareCardViewModelV1` SHALL be the sole preview/export content authority. React MUST NOT aggregate facts, select peaks/ties, calculate shares, infer conclusions, or assemble business prose. A scope/word/preference change SHALL invalidate Save until a matching current view-model is presented.

#### Scenario: Preview matches committed report
- **WHEN** a matching summary DTO and presenter complete
- **THEN** preview facts and optional words equal the committed report/presentation evidence and the same view-model key feeds preview and export

#### Scenario: Reject stale summary
- **WHEN** session, generation, result, report query, role, Clean Mode, custom-hidden preference, or vocabulary option changes
- **THEN** the prior card is never relabelled as current and Save remains disabled until the new correlated view-model is ready

#### Scenario: Keep language descriptive
- **WHEN** the presenter emits summary copy
- **THEN** it describes counts, months, days, streaks, and anonymous shares only and contains no affection, dependence, intent, personality, emotion, relationship-quality, or improvement/decline claim

### Requirement: B5 Share Preview dialog and recovery states
Closing SHALL provide “生成回顾卡” as the primary B5 action and retain Detailed Analysis as a secondary action. Share Preview SHALL be an in-app modal dialog that becomes a full-screen single-column sheet below 600px or at effective 200% zoom. It SHALL implement preview rendering, ready/options, export in progress, success, user cancelled, save failed, renderer/font/art failed, missing/partial evidence, stale, narrow, and reduced-motion states frozen in `design.md`. It SHALL show the quiet disclosure “PNG 会将当前选择的摘要内容保存到你指定的位置；应用不会上传。” immediately above Save and SHALL NOT add a second warning dialog.

#### Scenario: Keyboard preview lifecycle
- **WHEN** a keyboard user opens and closes Share Preview
- **THEN** focus moves to the dialog heading, remains trapped with visible focus, Escape closes only while no native panel owns focus, and close returns focus to the Closing trigger

#### Scenario: Cancel native save
- **WHEN** the user cancels the native save panel
- **THEN** the unchanged preview returns with a polite cancellation announcement and no error, path disclosure, or write

#### Scenario: Save or renderer failure
- **WHEN** rendering or saving fails
- **THEN** the dialog preserves the report and preview where safe, announces one content-free stable error with a concrete retry/choose-another-location action, and performs no automatic fallback upload/write/share

### Requirement: Bounded renderer-to-host PNG save authority
The preview and final PNG SHALL use the same pure Canvas 2D renderer and `ShareCardViewModelV1`; no DOM screenshot, hidden DOM, SVG raster capture, scroll/viewport/window/DPR/media-query input, or screenshot dependency is permitted. The renderer SHALL use 600×750 logical units at hard-coded scale 2, required offline macOS fonts, frozen `zh-CN` formatting/wrapping/fit/crop constants, a fully opaque `#F7F3EA` background, and a versioned local artwork or deterministic Canvas fallback. Equal authority/version input SHALL produce equal decoded RGBA digest in the same packaged environment. B5 SHALL add a distinct Tauri 2.11.3 opaque-binary contract rather than extending the existing numeric `export_aggregate` DTO with bytes: `prepare_presentation_png` validates current window/session/generation/result/schema/view-model digest/dimensions and creates at most one active single-use 60-second host lease per window; `save_presentation_png` receives only a top-level raw `ArrayBuffer`/`Uint8Array` body with the opaque lease ID in the allow-listed ASCII `x-chat-analysis-export-lease` header. Bytes MUST NOT be base64, a nested JSON number array, React state/cache, or logs. Rust SHALL consume/fence the lease and validate encoded size, PNG signature, chunk order/length/CRC, exactly one 1200×1500 8-bit RGB/RGBA IHDR, opaque decoded alpha, forbidden text/EXIF/profile chunks, and IEND before presenting `NSSavePanel` and atomically writing the user-selected destination. The renderer MUST NOT supply or receive a filesystem path or overwrite flag. A packaged synthetic raw-body/header contract test SHALL pass before renderer/save integration.

#### Scenario: Save valid PNG
- **WHEN** a fresh valid summary-card PNG passes the closed contract
- **THEN** Rust opens the native save panel with a generic name and atomically writes only the user-approved destination

#### Scenario: Reject stale or metadata-bearing PNG
- **WHEN** result/view-model identity or lease is stale/replaced/expired/replayed, or the PNG has wrong dimensions, excess bytes, transparent pixels, text/profile/EXIF metadata, malformed chunks/CRC, or unapproved kind
- **THEN** the host refuses save with a stable content-free error and performs no destination write

#### Scenario: Cancel or retry export
- **WHEN** save is cancelled, a renderer fails, or dialog close abandons an unused lease
- **THEN** the lease is consumed or explicitly invalidated, the analysis/report remains intact, and retry prepares a fresh lease for the same still-current preview

### Requirement: B5 generated-art slot and code-native fallback
B5 SHALL generate at most three generic synthetic candidates for one optional `share-card-field-v1` 4:5 editorial edge field and at most one targeted refinement of the leading direction. Prompts and candidates MUST contain no real/private data, screenshot, statistic, token, person, avatar, contact, message, filename/path, text, number, year, logo, watermark, lock/shield/cloud cliché, romantic imagery, neon AI, glossy 3D, or photorealism. Only one passing optimized opaque repository-local WebP at 1200×1500 and at most 350 KiB MAY ship. Dynamic card content, controls, completion mark, data bars, word chips, icons, focus, and dividers SHALL remain Canvas/CSS/SVG. The card SHALL remain complete with the versioned Canvas line/dot fallback and SHALL ship no mediocre or rejected candidate.

#### Scenario: All candidates fail
- **WHEN** every generated candidate has an obvious artifact, weak crop/contrast, prohibited motif, excess size, or fails actual preview quality
- **THEN** B5 uses the deterministic Canvas fallback and ships no new raster rather than lowering the visual/privacy gate

#### Scenario: Artwork fails at runtime
- **WHEN** the selected local asset cannot decode before rendering
- **THEN** preview and export use the same frozen Canvas fallback without changing facts, layout authority, accessibility, or network behavior

### Requirement: Cache, cancellation, and stale suppression
The system SHALL preserve the existing canonical key for committed analytics only and define separate bounded identities as in `design.md`: report facts from committed base query + report mode/year; frequency DTO from committed base query + role + built-in policy; word presentation from frequency DTO + raw/per-10k + custom-hidden hash + visible limit; layout from the bounded presentation digest + bucket/fixed canvas + synthetic-metrics/layout versions. Navigation, route, chapter, scroll, drafts, and reduced-motion state MUST enter none of them. Report/frequency/layout caches SHALL be bounded and cleared on dataset replacement, generation change, Worker disposal, or close. Superseded asynchronous work SHALL be cancelled/discarded and late results SHALL never replace current year data.

#### Scenario: Rapid year change
- **WHEN** the user selects 2024 and then 2025 before 2024 completes
- **THEN** 2024 work is cancelled or discarded and only a fully correlated 2025 report can publish

#### Scenario: Resize within bucket
- **WHEN** the Canvas changes size without crossing its viewport bucket
- **THEN** cached coordinates scale and no report, word-frequency, or canonical query runs

#### Scenario: Dataset replacement
- **WHEN** the user analyzes other files and commits a new dataset generation
- **THEN** all prior report/frequency/layout/export identities and caches are invalidated and cannot be displayed or saved

### Requirement: Performance and memory budgets
The implementation SHALL meet hard structural bounds: no source reread, no canonical dataset in React state, no main-thread tokenization/analytics/layout, no analytics on scroll/resize/navigation, bounded 400-candidate/100-visible terms and caches, stale suppression, one export Canvas, and opaque PNG bytes ≤10 MiB. Millisecond/FPS/retained-memory values in `design.md` are repeated-run diagnostic targets on the fixed synthetic reference fixture, not single-run CI gates. A diagnostic layout miss SHALL reduce terms through 100→80→60→40→20; it MUST NOT move analytics/tokenization to React, add a network fallback, or fail solely because one wall-clock sample missed a target.

#### Scenario: Scroll through report
- **WHEN** the user scrolls across all chapters after data is committed
- **THEN** no new analytics query, tokenization, layout analysis, source read, or unbounded DOM growth occurs; long-task observations are recorded diagnostically

#### Scenario: Layout exceeds budget
- **WHEN** a large cloud misses its layout budget
- **THEN** term count degrades through 100, 80, 60, 40, and 20 while the same bounded accessible candidate list remains available

### Requirement: Functional accessibility
Home, mode/year/filter/session/role/metric/vocabulary/chapter/export/recovery controls SHALL be keyboard operable, visibly focused, programmatically named, and ordered. Report headings SHALL be semantic; anchored headings SHALL have safe scroll margin; dynamic states SHALL be announced; charts SHALL have summaries and exact lists/tables; cloud rank and frequency SHALL be screen-reader readable; color/size SHALL not be the sole signal; contrast SHALL meet WCAG 2.2 AA; zoom, narrow layout, and reduced motion SHALL pass acceptance. Generated decorative artwork SHALL use empty alt/`aria-hidden`, explicit dimensions, and no information that lacks a textual equivalent. Native semantic elements SHALL be preferred over ARIA, icon-only controls SHALL have accessible names, and animations MUST NOT use `transition: all`.

#### Scenario: Keyboard annual flow
- **WHEN** a keyboard-only user enters Home, selects a year, navigates chapters, opens methodology, edits custom-hidden preferences, and exports
- **THEN** focus remains visible/logical, each control has a name/state, and focus returns to the appropriate heading or trigger after transitions/dialogs

#### Scenario: Announce asynchronous state
- **WHEN** analysis/report/layout/export moves through loading, success, empty, insufficient, cancellation, or error
- **THEN** an appropriate live region announces the state without exposing arbitrary error text or repeatedly reading animated intermediate values

#### Scenario: Remove decorative artwork
- **WHEN** generated artwork is hidden, fails to load, or is ignored by assistive technology
- **THEN** every heading, metric, chart, control, scope label, privacy statement, and navigation affordance remains complete and understandable

### Requirement: Synthetic-only verification and packaged Beta boundary
Automated and agent-run tests SHALL use synthetic fixtures only and SHALL cover the unit, Worker, layout, React, Rust/export, privacy, deterministic, cancellation, stale, responsive, motion, and accessibility matrices frozen in `design.md`. Final B6 SHALL use only the bounded Core multi-year, Edge/sparse, and Malformed/import-error fixture families; validate one final macOS arm64 ad-hoc packaged `.app`, prototype `.dmg`, clean-install, offline, no-account, and zero-external-request holistic product vertical; and publish source-attributed acceptance evidence. Real-data acceptance SHALL require separate manual user execution and MUST NOT be discovered, selected, opened, parsed, screenshotted, or judged by an agent.

#### Scenario: Run automated acceptance
- **WHEN** a Luna Max implementation stage reaches its gate
- **THEN** only synthetic fixtures are used and no private directory, source, aggregate, token output, filename, or path enters tests, logs, screenshots, docs, or Git

#### Scenario: Reach real-data gate
- **WHEN** all synthetic packaged prerequisites pass
- **THEN** the agent reports `PASS WITH USER ACCEPTANCE PENDING`, sets `BETA_PACKAGE_READY_FOR_USER_TEST=true`, stops at the real-data boundary, and does not execute productization 12.7/12.8 or legacy 13.10/15.10

#### Scenario: Bound packaged fixtures
- **WHEN** B6 executes the packaged vertical
- **THEN** Fixture A supplies at least three synthetic years, multiple files, overlap/dedup, both anonymous roles, varied categories/activity/replies/sessions/vocabulary and all/year scopes, while Fixtures B and C are used only for bounded sparse/fallback and malformed/recovery seams and broad matrices remain automated

### Requirement: Final packaged Beta product gate
B6 SHALL rerun the complete current source regression matrix at the final HEAD, produce one official package under the single bounded work root frozen in `design.md`, and exercise the whole Beta product rather than only B5. The clean-install vertical SHALL include native user-driven multi-file import, canonical analysis, Home, Annual seven-scene flow, all-years and per-year scopes, vocabulary controls, deterministic Word Cloud, Closing, one Share Preview/native PNG save/readback, Detailed explicit Apply semantics, all eight Detailed routes, one existing aggregate export, critical cancel/retry/reselect, complete quit, sidecar/lease cleanup, restart, and expected bounded preferences. Network attempts SHALL equal zero, and the copied app MUST NOT depend on the repository, source tree, Node/npm, user/system Python, Rust/dev tools, external fonts, CDN, or remote images.

#### Scenario: Correlate annual scopes
- **WHEN** the packaged vertical commits all years, Year A, Year B, and all years again
- **THEN** the visible selector, committed report, Annual facts, vocabulary, keywords, word cloud/list, share-card content, export filename, and scope labels move together without old data under a new label

#### Scenario: Preserve explicit Detailed Apply
- **WHEN** a user edits a Detailed draft filter before selecting Apply
- **THEN** analytics do not recompute, and selecting Apply publishes exactly one matching committed result while every Detailed route and the aggregate export remain usable

#### Scenario: Complete offline clean install
- **WHEN** the `.app` copied from the verified prototype DMG runs outside the repository with network blocked
- **THEN** import, analysis, Home, Annual, Detailed, local artwork, Share Preview, native PNG save/readback, quit, and restart succeed with zero external attempts and a bundle-relative sidecar

#### Scenario: Reuse closed evidence
- **WHEN** B6 assesses deterministic Canvas pixels, raw IPC/lease behavior, word-cloud geometry, accessibility interactions, or Alpha sidecar/import edges already accepted at the current baseline
- **THEN** it cites the accepted B5/B4/Alpha evidence, reruns the final integration smoke and current source regressions, and does not repeat every closed low-level matrix manually in the package

### Requirement: B6 visual, performance, accessibility, and recovery threshold
B6 SHALL block on a broken or unusable standard/narrow/200%-zoom layout, major overflow or accidental whitespace regression, missing required artwork/fallback, unreadable chart/table/list, serious navigation/focus/ARIA/contrast/reduced-motion regression, main-thread word-cloud layout, unusable Worker failure without list fallback, broken cancellation, unbounded cache/item/payload/PNG behavior, stale result publication, privacy leakage, or user-visible freeze. Recorded module-level visual polish debt, minor aesthetic differences, diagnostic target variance without user-visible failure, and Release-grade benchmark/certification work MUST NOT block Beta.

#### Scenario: Retain accepted polish debt
- **WHEN** final Annual and Detailed screens remain usable, readable, non-overflowing, keyboard-operable, and free of visual-rubric `FAIL` while a known module-level polish item remains
- **THEN** B6 records the debt and may pass without starting a visual redesign

#### Scenario: Recover from bounded failures
- **WHEN** malformed import, import/analysis cancellation, renderer failure, native save cancellation/failure, retry, reselect, stale work, or startup recovery is exercised through the packaged critical smoke plus current automated evidence
- **THEN** no crash, source/path disclosure, stale publication, orphan sidecar, active lease, hidden temporary state, or unsafe fallback remains

### Requirement: B6 evidence, status, and package retention
The B6 report SHALL separate Automated Source Gates, Packaged Synthetic Gates, Evidence Reused, and User Manual Gate; SHALL distinguish `FAIL`, `BLOCKED`, `PASS`, and `PASS WITH USER ACCEPTANCE PENDING`; and SHALL never claim Release, Production, public-distribution, notarization, or formal supply-chain readiness. Until B6 passes, the verified B5 package SHALL remain the rollback. After the B6 package and every synthetic gate pass, the final retained verified set SHALL be the new B6 package plus B5 `final-release`; the older `package-20260810T065335Z` tree SHALL be removed manually by the user because recursive/batch deletion is prohibited, then verified read-only by the agent. Build caches and `target` MUST NOT be mass-deleted.

#### Scenario: Report successful agent gate
- **WHEN** all automated and packaged synthetic Beta gates pass but the user has not run real data
- **THEN** the report states `PASS WITH USER ACCEPTANCE PENDING`, `BETA_PACKAGE_READY_FOR_USER_TEST=true`, and `RELEASE_READY=false` without treating the pending user check as `BLOCKED`

#### Scenario: Preserve rollback on failure
- **WHEN** the B6 package or holistic vertical fails
- **THEN** the B5 verified package remains available, the older rollback is not deleted merely to reduce package count, and the report stops as `FAIL` or `BLOCKED` with no real-data or Release work

#### Scenario: Close storage gate after pass
- **WHEN** the new B6 package is fully verified and the user has manually removed the designated older package tree
- **THEN** read-only inspection shows exactly the new B6 verified package and B5 `final-release`, at most one active clean-install copy, and no retained synthetic PNG or temporary screenshot required only for the completed smoke

### Requirement: Beta blockers and Release deferrals
Beta acceptance SHALL fail for Dashboard regression, source reread, private-data access, network/upload/runtime-art dependency, canonical dataset in React state, main-thread tokenization, changed word-cloud geometry, privacy-leaking export, unresolved visual-rubric `FAIL`, unusable 1180×760/760×900/380×900/200%-zoom layout, broken artwork crop/fallback, lost applied state, packaged startup failure, serious accessibility regression, or stale/cross-year display. B5 and B6 MUST remain blocked until V1–V3 human stop gates pass. The recorded 5B.23 progression acceptance MAY retain known module-level visual polish debt but MUST NOT be represented as complete visual-debt resolution or used to broaden B5 into Annual 1–15/Detailed redesign. Developer ID, notarization, stapling, Windows, auto-update, public Release, D.1–D.10, exhaustive inputs, full dark mode, possible-name filtering, advanced NER/NLP, all image formats, and Release-grade certification SHALL NOT be Beta blockers.

#### Scenario: Detect stale year publication
- **WHEN** a report displays metrics correlated to a year/query other than the current selection
- **THEN** Beta acceptance fails and implementation stops for correction

#### Scenario: Release hardening remains incomplete
- **WHEN** all Beta synthetic requirements pass while D.1–D.10 remain unchecked
- **THEN** Beta may be accepted as a local prototype without claiming formal Release readiness

#### Scenario: Visual gate remains rejected
- **WHEN** any V1–V3 screenshot category is `FAIL` or human acceptance has not occurred
- **THEN** B5/B6 do not start even if functional automated tests are green

#### Scenario: Progress with recorded polish debt
- **WHEN** 5B.23 is accepted for progression with known module-level visual polish debt and no rubric category remains `FAIL`
- **THEN** B5 may proceed within its frozen Closing/share/export/motion scope without claiming the debt is resolved or restyling Annual 1–15/Detailed
