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
The Beta word cloud SHALL use Canvas for screen and export, zero-degree text, offline system font stacks, fixed palette, and the term limits/dimensions in `design.md`. Resize inside a bucket SHALL scale; crossing a bucket SHALL relayout without reanalysis. Canvas SHALL be excluded from the accessibility tree and accompanied by one semantic ranked list containing exactly the same bounded selected words, including layout-omitted ranks, with token, display rank, raw count, normalized rate, role, and year. The implementation MUST NOT create a hidden DOM node per Canvas glyph or render the full 400-item candidate pool by default.

#### Scenario: Narrow screen
- **WHEN** report content is below 640 CSS pixels
- **THEN** the 480×520 narrow layout uses at most 50 terms and the semantic list and controls remain usable without horizontal page scrolling

#### Scenario: Export layout
- **WHEN** a word-cloud PNG is prepared
- **THEN** the export renderer uses one fixed 1200×1500 final-pixel layout key with at most 100 terms independent of preview CSS size, device-pixel ratio, or application window size

#### Scenario: Canvas unavailable
- **WHEN** Canvas or animation cannot render
- **THEN** the same bounded selected ranked list and compact textual/bar summary remain available and no selected-cloud information is lost

### Requirement: Frozen visual system and dark-mode boundary
Annual Recap SHALL implement the selected “本地数据年鉴 / Editorial Almanac” direction and semantic color, type, spacing, width, surface, card, radius, border, depth, control, grid, focus, skeleton, empty, error, warning, success, privacy, partial, and disabled roles in `design.md`. Numeric visual dimensions marked as defaults/targets SHALL respond within their frozen bounds rather than act as pixel gates. The visual result SHALL be editorial, personal, calm, tactile, data-rich, contemporary, and restrained; it MUST NOT resemble an enterprise/admin template, raw HTML, cyberpunk/gaming UI, neumorphism, heavy Material elevation, large-gradient theme, or glassmorphism system. First Beta SHALL reserve semantic token structure for dark mode but SHALL NOT implement a dark palette or toggle.

Beta SHALL follow the current stylesheet architecture using scoped CSS custom properties/classes beneath `.desktop-app.beta-enabled`, `.beta-report`, and explicit Dashboard selectors. It MUST NOT leak unprefixed Beta rules into browser-v1 or add CSS Modules, Tailwind, CSS-in-JS, a UI/component framework, icon pack, animation library, word-cloud dependency, remote asset, or remote font.

#### Scenario: Render at target window
- **WHEN** the application is 1180×760
- **THEN** Home is uncrowded, both mode actions remain visible, the report hero shows its year, primary conclusion, dominant metric and navigation/scroll cue, filter actions remain reachable, and no horizontal page scrolling is required

#### Scenario: Render narrow or zoomed
- **WHEN** CSS content narrows to 760 pixels or the user zooms to 200 percent
- **THEN** cards and controls collapse to one column, focus is not covered, and charts retain text alternatives

#### Scenario: Distinguish roles without color
- **WHEN** owner and other data are compared
- **THEN** both direct labels and geometry/pattern accompany the role colors

#### Scenario: Reject an unfinished dark mode
- **WHEN** B1 implements semantic visual tokens
- **THEN** it does not expose a dark-mode toggle or incomplete dark palette and leaves full dark mode non-blocking

### Requirement: Semantic typography and engineering-label hierarchy
The interface SHALL implement the eyebrow, display, heading, title, report-lead, body, secondary, metadata, metric, and metric-unit CSS roles frozen in `design.md`. Display text SHALL use the responsive 40–72px clamp and metrics the 36–64px clamp, with narrower wrapping governed by available space. These roles MUST NOT force one React component per token; body/secondary/metadata normally use semantic markup plus scoped classes. Narrative conclusions SHALL use `report-lead` rather than ordinary paragraph styling. Visible labels SHALL be classified as `USER_VISIBLE`, `METHOD_ONLY`, or `DEVELOPER_ONLY`; generation, query keys, schema/DTO IDs, Worker terminology, and canonical/internal IDs MUST NOT carry primary visual weight. System-font differences MAY change exact wrapping, but MUST NOT cause clipping or hierarchy loss.

#### Scenario: Scan the annual hero
- **WHEN** a user first views a populated annual hero
- **THEN** the year display, narrative lead, dominant tabular metric, unit, and concise metadata are visibly distinct without relying only on font size or blue text

#### Scenario: Present an eyebrow
- **WHEN** Annual Recap or a Dashboard section uses a context label
- **THEN** it appears as a quiet capsule or letter-spaced label and engineering numbering such as `05 / WORDS & YEARS` is not a primary Annual Recap element

#### Scenario: Demote developer metadata
- **WHEN** a normal user views Home, Annual Recap, workflow success, or Dashboard overview
- **THEN** result generation, schema IDs, query keys, Worker DTO labels, and canonical terminology are absent from primary content and remain available only through methodology/developer disclosure where needed

#### Scenario: Constrain text measure
- **WHEN** body or methodology summary text is rendered in the 1120px content column
- **THEN** readable text measure does not exceed 72ch and narrative copy prefers the 58–68ch range

### Requirement: Six-level surface, border, radius, and depth system
The UI SHALL distinguish application canvas, elevated report, standard card, inset/subtle, highlight/accent, and semantic status/callout roles using the frozen fills, spacing, radius, and depth tokens. These are six semantic token/class roles, not six required React components. Radius values are responsive defaults; Annual primary cards normally remain at least 16px while controls and pills retain clear interactive shape. Full borders SHALL be reserved for controls, selected/focus states, table separation, and occasional subtle distinction; nested sections MUST NOT repeat complete outlined rectangles at every level.

#### Scenario: Group ordinary content
- **WHEN** a report section contains a card, nested details, and a chart
- **THEN** hierarchy is created by tone, spacing, heading structure and at most restrained raised depth rather than three nested white rectangles with gray outlines

#### Scenario: Use depth tokens
- **WHEN** a card, report sheet, dialog, or popover is rendered
- **THEN** it uses only surface-flat, surface-raised, or surface-overlay for the approved role and no Annual Recap card uses overlay/heavy Material elevation

#### Scenario: Preserve interactive boundaries
- **WHEN** a control is focused, selected, invalid, or disabled
- **THEN** its boundary and state remain perceivable even though non-interactive content no longer uses pervasive borders

### Requirement: Badges, chips, status pills, highlight sentences, and disclosures
The visual foundation SHALL provide reusable Badge, Chip, StatusPill, HighlightSentence, and MethodologyDisclosure patterns with the dimensions and purposes frozen in `design.md`. Current query context SHALL be presented as structured chips for date/year, sender, UTC+08, session threshold, and filtered state rather than one long prose line. Full methodology MUST remain available through a collapsed accessible disclosure.

#### Scenario: Present committed query context
- **WHEN** a filtered result is committed
- **THEN** compact chips show its date/year scope, sender, UTC+08, session threshold, and filtered status without exposing generation as ordinary metadata

#### Scenario: Present a narrative conclusion
- **WHEN** a chapter has a validated sentence such as its peak month or peak hour
- **THEN** the sentence uses a restrained tinted HighlightSentence with an accent rail or icon and one emphasized phrase rather than an unstyled white-background paragraph

#### Scenario: Open methodology
- **WHEN** a user activates the methodology disclosure
- **THEN** the complete existing method information becomes keyboard and screen-reader accessible while the collapsed state retains a short summary and method chips

### Requirement: Button and form-control hierarchy
The shared visual foundation SHALL implement Primary, Secondary, Tertiary/Ghost, and Destructive/Exit button roles with approved usage, at least 44px height, 12px radius, consistent horizontal padding, 600 weight, icon gap, and default/hover/active/focus-visible/disabled/loading states. Date input, select, segmented control, checkbox/toggle, and text input MAY retain native semantics but SHALL use the shared label, wrapper, height, radius, spacing, focus, validation, and disabled presentation.

#### Scenario: Compare action priorities
- **WHEN** Home or a report export panel displays multiple actions
- **THEN** the primary filled action, secondary tonal action, tertiary disclosure action, and quiet Exit action are visually and semantically distinguishable

#### Scenario: Preserve accessible native control
- **WHEN** a native date or select control is more reliable in the packaged WebView
- **THEN** its native semantics remain while its visible label, wrapper, dimensions, focus, error, and disabled states conform to the Beta system

#### Scenario: Show loading and disabled states
- **WHEN** a button is loading or unavailable
- **THEN** it preserves layout, exposes accessible state and reason, has no misleading hover, and retains at least 3:1 component contrast

### Requirement: Two-level navigation and compact filter toolbar
App-level Annual Recap/Detailed Analysis navigation SHALL use the frozen high-level segmented pattern. The existing eight Dashboard routes SHALL use a subordinate tab rail with clear active, hover, focus, keyboard, and horizontal-overflow behavior. The global filter SHALL become a compact wrapping FilterToolbar containing date range, sender, session threshold, and explicit Apply action. Visual redesign MUST NOT change explicit Worker query commit semantics.

#### Scenario: Distinguish navigation levels
- **WHEN** Detailed Analysis is active
- **THEN** the app mode segmented control and Dashboard tab rail have visibly different hierarchy and selected-state treatment

#### Scenario: Overflow Dashboard tabs
- **WHEN** all eight Dashboard tabs do not fit
- **THEN** the tab rail remains keyboard operable and shows an edge fade or explicit cue that horizontal navigation is available

#### Scenario: Apply filters explicitly
- **WHEN** a user edits a date, sender, or threshold control
- **THEN** no Worker query is committed until the user activates the Primary Apply button, after which QueryChips represent the committed result

### Requirement: Refined App Shell and workflow status
The App Shell SHALL organize product identity, local/privacy status, primary context, and secondary actions without scattering them across competing bordered controls. “本地处理 / 不上传” SHALL be a privacy badge or status indicator. Exit SHALL remain visually subordinate. A successful workflow SHALL show one concise success composition and MUST NOT repeat the same state in an eyebrow, heading, and sentence; detailed workflow panels SHALL appear only while processing, error, cleanup/recovery, or expanded diagnostics are relevant.

#### Scenario: Show completed workflow
- **WHEN** analysis reaches a committed ready state
- **THEN** the shell shows one check icon, “分析完成”, compact range/message context, and local completion badge without also repeating “当前状态：结果已准备好”

#### Scenario: Show active or failed workflow
- **WHEN** analysis is processing, cancelling, failed, or requires recovery
- **THEN** a detailed semantic workflow/status surface presents progress or actions without changing existing cancel/retry/reselect behavior

#### Scenario: De-emphasize Exit
- **WHEN** Exit appears beside normal navigation or analysis actions
- **THEN** it uses the quiet destructive/ghost role and does not visually compete with the primary annual-report CTA

### Requirement: Annual Recap composition and card variants
Every visual scene SHALL prioritize one dominant idea, one dominant metric or visualization, and one short explanation using the frozen eyebrow → narrative lead → hero metric/visualization → metadata → optional details order. The report SHALL express hero, metric, split, chart, word, narrative, summary, and privacy semantic variants through one lightweight `BaseCard`/surface primitive plus modifiers; specialized components are required only for materially different behavior/accessibility. It MUST NOT implement eight polymorphic components merely to mirror variant names. Logical sections MUST NOT all use the same white bordered card or present ten competing primary numbers.

#### Scenario: Render the opening viewport
- **WHEN** a populated annual report opens at 1180×760
- **THEN** a 24px-radius hero visibly communicates the year, one core conclusion, one dominant metric or visual, and the next navigation/scroll affordance within a two-second visual scan

#### Scenario: Render different chapter purposes
- **WHEN** metric, comparison, chart, word, narrative, summary, and privacy chapters are present
- **THEN** they use the appropriate distinct card variants while retaining one shared product system

#### Scenario: Maintain chapter rhythm
- **WHEN** the user scrolls consecutive chapters
- **THEN** chapter gaps, hero height, card spacing, chart height, radii, and table density use the responsive defaults/bounds in `design.md`, with no forced empty space, clipping, covered focus, or loss of hierarchy at 1180×760, narrow layout, or 200% zoom

### Requirement: Detailed Dashboard visual uplift without semantic change
Beta B1b SHALL visually unify Detailed Analysis with the App Shell through scoped CSS, presentation-only wrappers/markup, shared typography, spacing, color, radius, surfaces, buttons, controls, chips, status, filter toolbar, tab rail, tables, chart cards, disclosures, and metadata hierarchy. It MUST preserve all eight routes, metrics, charts/alternatives, props, callback signatures/timing, Worker request/protocol/result DTO, canonical query identity, filter validation/explicit commit, selected-year/threshold lifecycle, metric values/order, pending-result retention, cancellation/stale publication, exports/payloads, loading/error/recovery behavior, and Worker semantics. Any visual change that cannot preserve these boundaries SHALL be deferred rather than converted into behavior work. B1b SHALL NOT block B2–B5.

#### Scenario: Compare before and after behavior
- **WHEN** the visual uplift is applied to Detailed Analysis
- **THEN** identical synthetic inputs, filters, thresholds, routes, pending transitions, and export actions produce the same analytical behavior and values

#### Scenario: Share the product language
- **WHEN** a user switches between Annual Recap and Detailed Analysis
- **THEN** controls, chips, status, navigation quality, typography, and semantic colors clearly belong to one product while Detailed Analysis remains denser and tool-oriented

#### Scenario: Keep all Dashboard sections
- **WHEN** Detailed Analysis loads after B1b
- **THEN** Overview, Trends, Comparison, Activity, Words & Years, Message Types, Replies & Sessions, and Export remain present and keyboard reachable

### Requirement: Progressive Words & Years hierarchy
The default `Words & Years` view SHALL present Section Summary, Key Visualization, Primary Ranking, Year Comparison, a collapsed “查看逐年明细” table, and a collapsed “查看统计口径” disclosure in that order. This SHALL be presentation-only reordering over the same props/model/result; disclosure controls may own only local open/closed UI state and MUST NOT fetch, filter, rerank, recompute, or change callbacks. All current Top-20 values, yearly token cells, keyword methodology fields, trace values, summary traces, and definitions SHALL remain reachable; no data or metric semantics may be deleted or rewritten.

#### Scenario: Open Words & Years
- **WHEN** a user first enters the section
- **THEN** summary, key visualization, ranking, and year comparison are visible while the dense yearly trace table and full methodology are collapsed

#### Scenario: Inspect engineering detail
- **WHEN** a user expands yearly details or methodology
- **THEN** every previously available engineering field and exact table value remains accessible with appropriate method/developer classification

### Requirement: Table and chart visual treatments
User-facing tables SHALL default to stronger headers, comfortable 52px rows, 16px cell padding, subtle alternate/hover tones, muted secondary fields, sparse separators, and right-aligned tabular numbers; constrained layouts MAY compact toward a readable 44px floor. Dense methodology tables MAY use 40px rows and 12px padding. Wide tables SHALL expose labelled horizontal scrolling plus an edge cue and sticky header where useful. Every chart card SHALL contain Header, Primary Insight, Chart, Legend/Annotations, and Optional Details, use semantic and supporting colors with direct labels/values, and retain an exact accessible table/list.

#### Scenario: Read a normal table
- **WHEN** a user-facing ranking or comparison table is rendered
- **THEN** it uses comfortable density, balanced columns, tabular numeric alignment, and no hard border grid around every cell

#### Scenario: Read a dense methodology table
- **WHEN** a user explicitly opens technical detail
- **THEN** the table may use dense mode but retains header contrast, numeric alignment, labelled scrolling, keyboard reachability, and an overflow cue

#### Scenario: Read a chart without color
- **WHEN** a chart compares owner, other, or additional categories
- **THEN** its primary insight, labels, numeric values, geometry/pattern and exact accessible data communicate the result without relying on cobalt and gray alone

### Requirement: Unified motion and reduced-motion behavior
Motion introduced in B5 SHALL use the frozen fast/standard/emphasis/easing/stagger tokens. Chapters SHALL use one-shot non-blocking entry, numbers and charts SHALL reveal only after data is committed, and cloud words SHALL reveal in bounded rank batches. Motion MUST NOT start analytics, change data/layout, hide final information, or become required for correctness. Reduced motion SHALL show the final static state immediately. B1a/B1b SHALL establish no motion framework; they only guarantee complete static meaning and respect `prefers-reduced-motion` for incidental transitions.

#### Scenario: Standard motion
- **WHEN** motion is allowed and a committed chapter enters view
- **THEN** transform/opacity/count/reveal effects stay within the frozen token durations and global stagger cap

#### Scenario: Reduced motion
- **WHEN** `prefers-reduced-motion: reduce` is active
- **THEN** smooth scroll, transforms, count-up, chart drawing, cloud stagger, and cross-fades are disabled while content and layout remain identical

### Requirement: First-Beta sharing scope and privacy
First Beta SHALL export an annual summary card PNG and a word-cloud PNG only. Chapter PNG and long/multipage image export SHALL be non-blocking deferrals. Images SHALL visibly include year/scope, applied filter summary, UTC+08:00, metric definition label, local-only status, custom-filter on/off, and privacy warning. Default labels SHALL be anonymous owner/other; contact/source names SHALL never be auto-populated.

#### Scenario: Export default summary card
- **WHEN** the user confirms a current committed summary-card preview
- **THEN** the PNG contains approved aggregate sentences and anonymous roles but no body, contact name, source path/name, internal ID, query key, token trace, or detailed methodology table

#### Scenario: Use local display aliases
- **WHEN** the user enters valid temporary display aliases for export
- **THEN** the preview warns that aliases are sensitive, uses them only for that local preview/save, and does not derive or persist contact identity by default

#### Scenario: Unsupported long image
- **WHEN** the user looks for a long/multipage export in first Beta
- **THEN** it is absent or identified as deferred and does not block summary-card or word-cloud export

### Requirement: Bounded renderer-to-host PNG save authority
Rich PNGs SHALL be rendered locally from a privacy-stripped fixed export view-model into one 1200×1500 final-pixel Canvas. B5 SHALL add a distinct opaque binary contract rather than extending the existing numeric `export_aggregate` DTO with bytes: a small prepare command validates fresh committed result/generation, approved kind, schema, and dimensions and stores at most one active one-use host lease per window; the raw save command receives only a top-level `ArrayBuffer`/`Uint8Array` PNG body, with the opaque lease ID in the allow-listed ASCII `x-chat-analysis-export-lease` invoke header. Bytes MUST NOT be base64, a nested JSON number array, or React state. Rust SHALL consume/fence the lease and validate PNG signature, IHDR, chunks, exact 1200×1500 dimensions, forbidden ancillary metadata, and at most 10 MiB before presenting a native save destination and performing atomic save. Prepare replacement, cancellation, session/generation replacement, or close SHALL invalidate the prior lease. The renderer MUST NOT supply or receive a filesystem path. A packaged synthetic raw-body/header contract test SHALL pass before renderer integration.

#### Scenario: Save valid PNG
- **WHEN** a fresh valid summary or cloud PNG passes the closed contract
- **THEN** Rust opens the native save panel with a generic name and atomically writes only the user-approved destination

#### Scenario: Reject stale or metadata-bearing PNG
- **WHEN** result identity/lease is stale or replayed, or the PNG has wrong dimensions, excess bytes, text/profile/EXIF metadata, malformed chunks, or unapproved kind
- **THEN** the host refuses save with a stable content-free error and performs no destination write

#### Scenario: Cancel or retry export
- **WHEN** save is cancelled or fails
- **THEN** the analysis/report remains intact and the user can retry the same current export preview without recomputation

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
Home, mode/year/filter/session/role/metric/vocabulary/chapter/export/recovery controls SHALL be keyboard operable, visibly focused, programmatically named, and ordered. Report headings SHALL be semantic; dynamic states SHALL be announced; charts SHALL have summaries and exact lists/tables; cloud rank and frequency SHALL be screen-reader readable; color/size SHALL not be the sole signal; contrast SHALL meet WCAG 2.2 AA; zoom, narrow layout, and reduced motion SHALL pass acceptance.

#### Scenario: Keyboard annual flow
- **WHEN** a keyboard-only user enters Home, selects a year, navigates chapters, opens methodology, edits custom-hidden preferences, and exports
- **THEN** focus remains visible/logical, each control has a name/state, and focus returns to the appropriate heading or trigger after transitions/dialogs

#### Scenario: Announce asynchronous state
- **WHEN** analysis/report/layout/export moves through loading, success, empty, insufficient, cancellation, or error
- **THEN** an appropriate live region announces the state without exposing arbitrary error text or repeatedly reading animated intermediate values

### Requirement: Synthetic-only verification and packaged Beta boundary
Automated and agent-run tests SHALL use synthetic fixtures only and SHALL cover the unit, Worker, layout, React, Rust/export, privacy, deterministic, cancellation, stale, responsive, motion, and accessibility matrices frozen in `design.md`. Final B6 SHALL validate the packaged `.app`, prototype `.dmg`, offline, no-account, and zero-external-request synthetic vertical. Real-data acceptance SHALL require separate user authorization and manual user execution.

#### Scenario: Run automated acceptance
- **WHEN** a Luna Max implementation stage reaches its gate
- **THEN** only synthetic fixtures are used and no private directory, source, aggregate, token output, filename, or path enters tests, logs, screenshots, docs, or Git

#### Scenario: Reach real-data gate
- **WHEN** all synthetic packaged prerequisites pass
- **THEN** the agent stops at the existing authorization boundary and does not execute productization 12.7/12.8 or legacy 13.10/15.10 without separate explicit authorization

### Requirement: Beta blockers and Release deferrals
Beta acceptance SHALL fail for Dashboard regression, source reread, private-data access, network/upload dependency, canonical dataset in React state, main-thread tokenization, untestable nondeterministic cloud layout, privacy-leaking export, unusable 1180×760 layout, lost applied state, packaged startup failure, serious accessibility regression, or stale/cross-year display. Developer ID, notarization, stapling, Windows, auto-update, public Release, D.1–D.10, exhaustive inputs, full dark mode, possible-name filtering, advanced NER/NLP, all image formats, and Release-grade certification SHALL NOT be Beta blockers.

#### Scenario: Detect stale year publication
- **WHEN** a report displays metrics correlated to a year/query other than the current selection
- **THEN** Beta acceptance fails and implementation stops for correction

#### Scenario: Release hardening remains incomplete
- **WHEN** all Beta synthetic requirements pass while D.1–D.10 remain unchecked
- **THEN** Beta may be accepted as a local prototype without claiming formal Release readiness
