## ADDED Requirements

### Requirement: Product workflow and privacy onboarding
The desktop UI SHALL present explicit states for first launch, privacy explanation, source selection, selection validation, preprocessing, analytics indexing, cancellation, retryable failure, non-retryable failure, results, re-analysis, export, discard, and application close. First launch SHALL explain that selected raw exports and retained cleaned text are private, processing is local, the application does not upload data, and default sessions are deleted on replacement or quit. Acceptance of the privacy explanation SHALL be stored only as a non-sensitive local preference and SHALL NOT authorize future file access.

#### Scenario: Open for the first time
- **WHEN** the application has no recorded onboarding preference
- **THEN** it shows the privacy explanation before source selection and requires an explicit continue action

#### Scenario: Return after onboarding
- **WHEN** the user has previously completed onboarding
- **THEN** the application opens at source selection with a persistent privacy-status entry that can reopen the explanation

#### Scenario: Start analysis
- **WHEN** a valid opaque annual-source selection exists
- **THEN** Start analysis becomes available and its accessible description states the selected file count and local processing boundary without names

#### Scenario: Cancel a running phase
- **WHEN** preprocessing or analytics is cancellable
- **THEN** the same progress surface exposes one Cancel action, announces cancelling, and restores focus to a logical retry or selection action after completion

### Requirement: Results navigation and page hierarchy
After a dataset is accepted, the primary navigation SHALL contain `Overview`, `Trends`, `Comparison`, `Activity`, `Words & Years`, `Message Types`, `Replies & Sessions`, and `Export`. Import/progress SHALL be a workflow route rather than a result-navigation item. Every result route SHALL retain the active dataset generation and global filter context, expose a page title and metric-definition help, and provide `Analyze other files` without silently discarding the current session.

#### Scenario: Enter results
- **WHEN** the initial analytics result commits
- **THEN** Overview becomes current and every declared result route is keyboard reachable in a stable order

#### Scenario: Navigate between result pages
- **WHEN** the user changes a result route
- **THEN** current filters and accepted aggregate generation remain unchanged and no raw data is reread solely for navigation

#### Scenario: Start over from results
- **WHEN** the user activates Analyze other files
- **THEN** the UI explains that confirming the replacement will cancel active work and delete the current temporary session before opening selection

### Requirement: Overview dashboard composition
Overview SHALL contain KPI cards for selected user-message count, total chat days, longest consecutive chat-day interval, owner/other message shares, median reply interval by responder when available, and conversation-session initiator counts at the active threshold. It SHALL also contain compact daily/monthly/yearly trend context, leading message types, and links to yearly keywords and summary. Every KPI SHALL show its unit, filter scope, definition-version help, and a visible unavailable state instead of substituting zero for null.

#### Scenario: Show a complete overview
- **WHEN** current filters provide evidence for every KPI
- **THEN** all KPI values originate from one atomic analytics result and link to their detailed page

#### Scenario: Show partial evidence
- **WHEN** reply, keyword, or sender evidence is unavailable
- **THEN** the relevant card says why it is unavailable while independent cards remain usable

#### Scenario: Update overview atomically
- **WHEN** a global filter calculation finishes
- **THEN** all affected KPIs and compact charts switch to the same result generation together

### Requirement: Detailed dashboard sections
`Trends` SHALL group daily, monthly, and yearly message series. `Comparison` SHALL group sender counts/share and average eligible-text length. `Activity` SHALL group hour, weekday, total chat days, and streak intervals. `Words & Years` SHALL group the existing word cloud/ranking, word evolution, yearly keywords, and traceable yearly summary. `Message Types` SHALL show exact user categories, eligible-text count, unknown count, and system diagnostic. `Replies & Sessions` SHALL group reply distributions, responder statistics, threshold control, and initiator comparison. `Export` SHALL summarize included metrics, active filters, privacy sensitivity, and supported local formats before a native save action.

#### Scenario: Inspect a detailed metric
- **WHEN** the user opens a dashboard section
- **THEN** charts, accessible tables, definitions, filters, and empty states use the exact corresponding analytics DTO

#### Scenario: Inspect yearly content
- **WHEN** Words & Years is open
- **THEN** a local year selector controls yearly keywords and summary while the global date and sender scope remain visible

#### Scenario: Inspect session metrics
- **WHEN** Replies & Sessions is open
- **THEN** the active inactivity threshold, sender-filter exception, offline-gap rule, and non-judgement wording are visible beside the metrics

### Requirement: Global and local filter scope
A persistent result header SHALL provide inclusive start date, inclusive end date, and sender scope `both`, `owner`, or `other`. A filter draft SHALL validate before dispatch and SHALL not alter the committed dashboard until one complete Worker result returns. Date and sender filters SHALL apply exactly as the analytics specification declares. Intrinsically comparative sender, reply, and initiator metrics SHALL visibly show `both senders; sender filter does not apply`. The year selector and inactivity-threshold preset SHALL be local controls with their affected panels identified.

#### Scenario: Apply valid global filters
- **WHEN** the user submits a valid date range and sender scope
- **THEN** the UI shows a calculation state and atomically commits one matching dashboard result

#### Scenario: Reject invalid dates
- **WHEN** dates are impossible, outside dataset bounds, or reversed
- **THEN** calculation is not dispatched and an associated field error explains the valid range

#### Scenario: Preserve the prior result while calculating
- **WHEN** a new filter result is pending
- **THEN** the previous result remains visible but is marked stale/pending and cannot be exported as if it used the draft filters

#### Scenario: Explain comparative scope
- **WHEN** owner-only or other-only is selected
- **THEN** comparative panels retain both senders and display the declared exception rather than silently changing their denominator

#### Scenario: Change session threshold
- **WHEN** the user selects 1, 3, 6, 12, or 24 hours
- **THEN** only replies, sessions, initiators, their overview cards, and dependent yearly-summary clauses enter recalculation

### Requirement: Progress, long tasks, and loading presentation
Selection validation, preprocessing, verified handoff, Worker transport, hashing, parsing, indexing, tokenization, aggregation, sessionization, and derived calculation SHALL map to stable human-readable phases. The UI SHALL show overall percentage, current phase, bounded aggregate progress, elapsed-duration bucket, Cancel when safe, and an indeterminate state only when no trustworthy total exists. Initial page regions SHALL use labelled skeletons; filter recalculation SHALL keep prior content with a local progress overlay rather than replacing the whole dashboard.

#### Scenario: Display preprocessing progress
- **WHEN** the sidecar reports a valid progress event
- **THEN** the progress screen announces the mapped phase and percentage without file names, paths, hashes, content, or record excerpts

#### Scenario: Display Worker progress
- **WHEN** indexing or analytics reports progress
- **THEN** the affected region and global busy status update without blocking keyboard access to Cancel

#### Scenario: Handle a long phase
- **WHEN** a phase crosses the documented long-task duration bucket
- **THEN** the UI states that work remains local and offers cancellation without estimating an unverified completion time

### Requirement: Error, empty, and recovery states
Errors SHALL map only from stable schema-validated categories to actionable local copy. The UI SHALL distinguish selection, input validation, packaged runtime, sidecar protocol/crash, disk space, unsafe storage, cancellation, Worker/WASM, analytics integrity, memory/capacity, export, and cleanup-required failures. It SHALL offer only actions valid for the current state: choose again, retry current selection, reduce selection, retry cleanup, return to the last accepted result, or quit after cleanup. Unknown internal text SHALL never be rendered.

Each metric SHALL define empty, single-sender, insufficient-evidence, and unsupported-v1 states. An empty chart SHALL retain its title, definition, filter summary, and accessible explanation; it SHALL not render misleading axes, percentages, or relationship conclusions.

#### Scenario: Recover from a rejected replacement
- **WHEN** a new selection or calculation fails while a previous result is valid
- **THEN** the previous accepted result remains available and the failure does not partially replace it

#### Scenario: Show cleanup-required state
- **WHEN** automatic cleanup safely refuses an unverified remnant
- **THEN** the UI explains that private temporary data may remain, exposes an in-app retry and safe quit choice, and shows no location

#### Scenario: Show a metric empty state
- **WHEN** the active filters leave no applicable population
- **THEN** the panel states the exact empty reason and displays no fabricated zero share, duration, keyword, or summary

#### Scenario: Open a v1 dataset in compatibility mode
- **WHEN** the browser compatibility path accepts a v1 eligible-text dataset
- **THEN** word-cloud features remain available and v2-only panels are explicitly unavailable rather than inferred from incomplete data

### Requirement: Metric definitions, tooltips, and chart consistency
Every KPI and chart SHALL expose a concise definition containing population, dedup status, fixed timezone, active filters, unit, denominator, threshold or algorithm version, and known exclusions. Tooltips SHALL use stable labels, raw values, units, and denominator context. Owner and other SHALL use the same semantic colors in every chart; system, unknown, missing, warning, and comparison states SHALL have distinct tokenized treatments and SHALL never rely on color alone. Tables and textual summaries SHALL preserve the exact deterministic order supplied by analytics.

#### Scenario: Inspect a trend tooltip
- **WHEN** a user focuses or points to a daily, monthly, or yearly bucket
- **THEN** the tooltip reports period, raw count, partial status, sender scope, and UTC+08:00 definition

#### Scenario: Inspect a keyword explanation
- **WHEN** a user opens yearly-keyword details
- **THEN** raw counts, totals, distinct-message threshold, score or fallback mode, filters, and algorithm version are available

#### Scenario: Inspect a reply tooltip
- **WHEN** a user focuses a reply distribution value
- **THEN** responder, duration unit, interval bin or percentile, inactivity threshold, and excluded-long-gap rule are stated

### Requirement: Re-analysis, close, and export decisions
The UI SHALL distinguish Worker restart, sidecar retry, new-file analysis, session discard, export, window close, and full application quit. Restart SHALL rebuild the Worker from the current verified temporary dataset. Sidecar retry SHALL create a new generation and absent output. New-file analysis SHALL confirm destruction of the current temporary session before replacement. Full quit SHALL show progress while active work and data are cleaned; closing a secondary view SHALL not discard the session.

Export SHALL support current-chart PNG and aggregate CSV or JSON report through a native save dialog. The export preview SHALL list active filters, timezone, metric-definition versions, and included panels. Export filenames SHALL be generic by default, and files SHALL contain no raw message content, token-level source text, participant, identifier, source path, or hidden metadata. Because aggregates can still be sensitive, the UI SHALL label every export as private local data.

#### Scenario: Restart analytics
- **WHEN** the Worker is stopped or failed but the verified session dataset remains
- **THEN** Restart creates a new Worker generation and revalidates the current temporary dataset

#### Scenario: Retry preprocessing
- **WHEN** a retryable sidecar failure occurs
- **THEN** Retry uses the retained opaque selection authority and a new session generation without reusing a partial destination

#### Scenario: Export current results
- **WHEN** the export preview matches the committed filter generation and the user confirms a destination
- **THEN** the selected supported aggregate format is written locally and labelled private

#### Scenario: Prevent stale export
- **WHEN** filters are draft, calculation is pending, or the displayed generation is stale
- **THEN** export is disabled with an accessible explanation

#### Scenario: Quit with active work
- **WHEN** the user confirms full quit during processing
- **THEN** the UI enters closing progress and remains until bounded process/Worker termination and cleanup finish or a safe cleanup-required state is reported

### Requirement: Functional accessibility
All onboarding, selection, navigation, filters, progress, cancellation, retry, dashboard, chart alternatives, definition dialogs, export, and close decisions SHALL be keyboard operable in logical order with visible focus. Every control SHALL have a programmatic name and description; validation SHALL be associated with its field; page and panel headings SHALL form a valid hierarchy. Progress SHALL use polite status updates, failures SHALL use an alert without repeated announcement, and focus SHALL move to the page heading, invalid field, or recovery action appropriate to the transition.

Every chart SHALL have a concise accessible name and an adjacent table or structured text containing the same exact values. Contrast SHALL meet WCAG 2.2 AA for text, controls, focus, and meaningful chart elements. Motion SHALL respect `prefers-reduced-motion`; disabled, selected, warning, and comparison states SHALL not rely on color alone.

#### Scenario: Complete the workflow by keyboard
- **WHEN** a keyboard-only user starts at first launch
- **THEN** they can select files, start, cancel or complete analysis, navigate every result, change filters, inspect definitions, export, and quit

#### Scenario: Read chart data without vision
- **WHEN** a screen reader user reaches a chart
- **THEN** its name, filter summary, definition, and exact data table are available in the same section

#### Scenario: Restore focus after failure
- **WHEN** validation, cancellation, retry, navigation, or export changes state
- **THEN** focus moves to the first actionable or explanatory element for that state

#### Scenario: Reduce motion
- **WHEN** the operating system requests reduced motion
- **THEN** skeleton shimmer, chart transitions, progress animation, and route motion are disabled or reduced without hiding state

### Requirement: Design tokens, viewport, and visual-phase boundary
Functional UI implementation SHALL establish semantic tokens for typography, spacing, radius, elevation, surface, text, border, focus, sender, category, status, chart grid, and motion. It SHALL use one consistent card, toolbar, chart frame, tooltip, empty-state, and table system. The macOS main window SHALL enforce a minimum content size of 1180 by 760 CSS pixels and remain usable when enlarged. Layout SHALL avoid horizontal scrolling at the minimum size except inside intentionally scrollable data tables.

The first functional productization release SHALL implement one complete accessible light theme and SHALL respect reduced motion. Automatic dark mode, illustration, decorative motion, brand refinement, advanced chart styling, and marketing polish SHALL be deferred to a separately reviewed visual-polish phase. Functional tasks SHALL not block on those deferred aesthetics, and the token architecture SHALL avoid preventing them later.

#### Scenario: Open at minimum window size
- **WHEN** the window is resized to the enforced minimum
- **THEN** primary navigation, global filters, current page controls, progress, errors, and dashboard content remain operable without page-level horizontal scrolling

#### Scenario: Render consistent sender colors
- **WHEN** owner and other appear across trends, comparison, activity, types, replies, and sessions
- **THEN** the same semantic tokens and non-color labels identify them

#### Scenario: Complete functional UI scope
- **WHEN** all product dashboard tasks are accepted
- **THEN** the accessible light theme and component states are complete while deferred visual-polish items remain explicitly out of scope

### Requirement: Privacy-safe product language
Product copy SHALL describe statistics as counts, distributions, intervals, thresholds, and deterministic local summaries. It SHALL NOT characterize relationship quality, affection, commitment, compatibility, mental health, personality, conflict, neglect, or emotional meaning. “Who opens more sessions” SHALL be labelled threshold-sensitive behavior, not initiative quality. “Faster reply” SHALL not be labelled more caring or attentive. Pseudonymous and data-minimized SHALL never be described as anonymous.

#### Scenario: Render comparative results
- **WHEN** sender, reply, or initiator metrics differ
- **THEN** the UI reports the measured difference and definition without evaluative relationship language

#### Scenario: Render a yearly summary
- **WHEN** deterministic summary clauses are available
- **THEN** copy remains traceable factual language and contains no model-generated interpretation

#### Scenario: Describe local privacy
- **WHEN** onboarding, status, export, or help explains privacy
- **THEN** it accurately distinguishes local processing, temporary retention, pseudonymous metadata, retained cleaned text, and aggregate sensitivity
