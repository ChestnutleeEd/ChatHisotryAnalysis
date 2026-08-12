## ADDED Requirements

### Requirement: Presentation-only authority boundary
V3 SHALL change only presentation component structure, CSS, visual layout/order inside scenes, chart representation, motion, decorative local assets, copy hierarchy, and disclosure presentation. It MUST NOT change canonical/dedup processing, Analytics Worker responsibility, query identity, `reportBaseRange`/year synchronization, Draft versus Applied behavior, explicit Apply, frequency denominator, Clean Mode analytical effect, custom-hidden semantics, keyword algorithm, deterministic Word Cloud geometry, reply/session calculation, Summary contract, Canvas/PNG authority, raw IPC/lease, native save, aggregate export, package authority, or privacy boundary.

#### Scenario: Re-express an existing metric
- **WHEN** an implementation replaces an Annual bar with a timeline, matrix, proportional band, interval ruler, or typographic ranking
- **THEN** every value, unit, ordering, tie, denominator, availability state, filter exception, and exact alternative SHALL come from the accepted existing DTO/presenter without a new derived fact or claim

#### Scenario: Preserve Draft and Apply
- **WHEN** a user edits a Detailed date or sender control before selecting Apply
- **THEN** the applied context, charts, exports, query identity, and analytics result SHALL remain unchanged until the existing Apply action commits a complete result

#### Scenario: Reject a Share authority change
- **WHEN** V3 work reaches Share Preview or Share Card code
- **THEN** renderer geometry, Canvas pixels, PNG authority, raw IPC, lease, native save, and export behavior SHALL remain unchanged unless a separately approved task and complete B5 regression explicitly authorize the change

### Requirement: Mode-specific visual direction and semantic tokens
Annual and Home SHALL implement the frozen Organic direction with sand/oat earth-tone surfaces, offline serif display roles, restrained print texture, and 16–24px major radii. Detailed SHALL implement the frozen Swiss direction with neutral white/gray surfaces, all-sans typography, visible grid/hairlines, left/asymmetric alignment, and sparse IKB signal use. The modes SHALL retain shared product identity, Owner/Other role semantics, focus behavior, spacing scale, and tabular numerals without blending their incompatible surface/type/texture tokens.

#### Scenario: Render Annual or Home
- **WHEN** Annual or Home renders at a supported viewport
- **THEN** its canvas SHALL use the frozen Organic earth-tone family and SHALL NOT introduce the old pale cream canvas, pure white/black, cold gray, glassmorphism, neon, or Detailed Swiss card grammar as its primary surface

#### Scenario: Render Detailed
- **WHEN** Detailed renders any of its eight routes
- **THEN** its display and body SHALL remain all-sans on the frozen neutral Swiss canvas with hairline structure and SHALL NOT use Annual serif headings, sand/oat canvas, grain, poster treatment, or cinematic scene spacing

#### Scenario: Apply color semantics
- **WHEN** brand, selection, peak, role, success, warning, error, and focus states appear together
- **THEN** brand moss SHALL NOT also mean selected/positive/data, Owner blue and Other coral SHALL be role-only, focus blue SHALL be focus-only, and every status/data meaning SHALL have a text/shape/position alternative

### Requirement: Offline typography hierarchy
V3 SHALL use only offline system font stacks and the role scales defined in `design.md`. Annual serif SHALL be limited to Cover, Scene Heading, and Closing statement; controls, charts, metrics, methodology, Home actions, and all Detailed content SHALL use the shared sans stack. Comparable numbers SHALL use tabular numerals, major headings SHALL wrap deliberately, and user-derived tokens SHALL remain readable without page overflow.

#### Scenario: Render mixed-script content
- **WHEN** a synthetic specimen contains Chinese, Latin, punctuation, and long tabular numbers
- **THEN** the packaged WebView SHALL select the frozen local fallback stacks, synthesize no missing face, retain distinct heading/body/numeric hierarchy, and create no runtime font or network request

#### Scenario: Render long tokens and narrow headings
- **WHEN** a token reaches the accepted 32-code-point bound or a Chinese heading wraps at 380px/200% zoom
- **THEN** content SHALL wrap/truncate only according to its declared role, remain available in an exact alternative where truncated, and SHALL NOT create page-level horizontal overflow or orphaned one-character heading lines where balancing can prevent them

### Requirement: Reusable V3 presentation structure
V3 SHALL provide stable structural equivalents for Page Shell, Annual Scene, Scene Intro/Body/Aside, Editorial Grid, Metric Hero/Cluster, Chart Stage, Data Annotation, Narrative Band, Vocabulary/Artwork Stage, Progress Navigator, Workspace Section/Toolbar, and Disclosure Drawer. These primitives SHALL own semantics, layout, accessibility, and diagnostics but MUST NOT force one repeated visual surface or compute analytics.

#### Scenario: Compose a logical section
- **WHEN** an existing logical report section is placed inside a V3 scene
- **THEN** its ID, order, heading anchor, fact meaning, status, and accessible alternative SHALL remain addressable while the scene component MAY choose a distinct DOM composition instead of the generic Header → Lead → Metric → Visual → Detail sequence

#### Scenario: Reuse a primitive across scenes
- **WHEN** Metric Hero, Chart Stage, or Disclosure Drawer is reused
- **THEN** it SHALL preserve structural/accessibility behavior while the owning scene MAY provide a purpose-specific surface, geometry, or annotation without another global override selector

#### Scenario: Prevent BaseCard expansion
- **WHEN** an ordinary V3 logical section renders
- **THEN** it SHALL NOT be wrapped in `BaseCard` or a rounded bordered article by default; card/surface treatment SHALL be reserved for bounded supporting content

### Requirement: Content-driven Annual scene geometry
Scale, Rhythm, Balance, Conversation, and Vocabulary SHALL use content-driven block size, `align-items:start`, declared grid modes, and the responsive `12`, `8+4`, `7+5`, `6+6`, `5+7`, or `4+8` compositions frozen in `design.md`. Opening, Closing, and declared Artwork Stages are the only default cinematic-whitespace allowlist.

#### Scenario: Measure ordinary scene tail
- **WHEN** a synthetic Annual scene reaches its final stable layout
- **THEN** trailing space from meaningful content bottom to scene bottom SHALL be no more than `min(120px, 20vh)` and no more than 20% of scene height, and computed scene minimum height SHALL be content-derived rather than a viewport unit or fixed value over 320px

#### Scenario: Measure paired columns
- **WHEN** a layout declares `paired` or uses `6+6`
- **THEN** the shorter/taller meaningful height ratio SHALL be at least 0.75 or the absolute difference no more than 160px, both cells SHALL be evidence peers, and neither cell SHALL be empty or stretched

#### Scenario: Measure asymmetric columns
- **WHEN** a layout declares `asymmetric`
- **THEN** the shorter/taller meaningful height ratio SHALL be at least 0.45 or the absolute difference no more than 200px; otherwise the component SHALL select a stacked/full variant without measuring DOM to invent analytics

#### Scenario: Detect an empty or stretched cell
- **WHEN** an allocated geometry cell has no meaningful child, less than 10% meaningful painted occupancy, or a painted box extending more than 96px below its meaningful content
- **THEN** synthetic geometry acceptance SHALL fail unless the cell is an explicit reviewed cinematic allowlist

#### Scenario: Preserve intentional whitespace
- **WHEN** Opening, Closing, or an Artwork Stage declares intentional whitespace
- **THEN** it SHALL include an allowlist reason, remain complete without the decorative asset, clip no content, and SHALL still fail if empty space exceeds 45% of the scene

### Requirement: Progress Navigator V3
Annual SHALL replace the full-width five-column sticky form toolbar with a maximum-720px, 40–44px reading dock showing current scene folio/label, seven-step progress, and one labelled on-demand control trigger. Year/range, logical chapter, and restore-full-range controls SHALL remain native and accessible inside an anchored in-flow control region. Current scene SHALL update from stable reading position without changing analytics/query/layout identity or hijacking scroll.

#### Scenario: Read through scenes without clicking navigation
- **WHEN** the user scrolls normally across Annual scenes
- **THEN** one bounded scene observer SHALL update the stable current scene/progress after crossing the frozen reading line, SHALL NOT force scroll or run analytics/layout, and SHALL NOT announce every scroll pixel

#### Scenario: Jump to a scene or chapter
- **WHEN** the user activates a progress step or logical chapter
- **THEN** the target SHALL use ordinary start-aligned scrolling, its visible heading top SHALL land between `nav.bottom + 12px` and `nav.bottom + 120px`, and no focused element SHALL intersect the dock

#### Scenario: Edit scope controls
- **WHEN** the user opens “范围与章节”
- **THEN** labelled native selects and restore action SHALL expand in normal flow without covering content, and close/Escape SHALL return focus to the trigger without changing scope unless the user commits an existing selection action

#### Scenario: Use Navigator at Narrow or 200% zoom
- **WHEN** the viewport is 380×900 or equivalent to 200% zoom
- **THEN** the dock SHALL remain 40–44px high, progress SHALL remain programmatically named, controls SHALL form a one-column 44px-target flow, and neither the page nor dock SHALL clip/occlude focused content

### Requirement: Seven differentiated Annual scenes
Annual SHALL preserve Opening, Scale, Rhythm, Balance, Conversation, Vocabulary, and Closing plus all sixteen logical sections, while implementing the distinct compositions and responsive fallbacks frozen in `design.md`. Each scene SHALL have one dominant visual conclusion and SHALL NOT repeat one universal label/heading/number/green-line/disclosure grammar.

#### Scenario: Render Opening
- **WHEN** Annual first opens at Wide or Standard
- **THEN** Opening SHALL present one cover/range, one lead, one dominant message metric, and the existing local hero artwork in `7+5`, with concise local/scope state and no redundant badge/metadata stack

#### Scenario: Render Scale
- **WHEN** Messages, Active Days, and Longest Streak are available
- **THEN** Scale SHALL compose one message Metric Hero with active-day/streak evidence in `7+5` or its responsive fallback, using no full-width hero followed by an unclaimed support row

#### Scenario: Render Rhythm
- **WHEN** month, weekday, and hour buckets are available
- **THEN** Rhythm SHALL use a 12-column month matrix/timeline plus a `5+7` weekday/hour composition, retain ordered buckets/peaks/ties/partial marks, and provide exact tables

#### Scenario: Render Balance
- **WHEN** role share, eligible length, and message types are available
- **THEN** Balance SHALL use a full-width labelled Owner/Other band and a density-aware `4+8`, `5+7`, or stacked length/type composition chosen only from existing bounded row availability

#### Scenario: Render Conversation
- **WHEN** session and reply evidence is available
- **THEN** Conversation SHALL use the frozen `7+5` narrative order with a session/initiator composition and reply interval/quantile stage, without implying causality or relationship quality

#### Scenario: Render Vocabulary and Closing
- **WHEN** the user reaches the final two scenes
- **THEN** Vocabulary SHALL form the deliberate full-width climax defined below, and Closing SHALL connect the existing poster, Share Card action, and Detailed action without changing Share Preview/export authority

### Requirement: Semantic visual encoding matrix
Each accepted metric SHALL use the representation, label, color, animation, and exact accessible alternative defined by the V3 Visual Encoding Matrix. Annual SHALL use editorial, annotated renderers; Detailed SHALL use compact, precise ledger renderers. Visual styling MUST NOT imply a statistic that the underlying evidence does not contain.

#### Scenario: Encode ordered time buckets
- **WHEN** month, weekday, or hour data renders
- **THEN** bucket order, zeros, partial markers, peaks/ties, timezone, and exact counts SHALL remain visible or available, and a matrix/pulse/line SHALL NOT interpolate or forecast missing data

#### Scenario: Encode role comparison
- **WHEN** Owner and Other data renders
- **THEN** fixed labels/sides and exact counts/shares SHALL accompany blue/coral/pattern marks, and global sender-filter exceptions SHALL remain visible

#### Scenario: Encode length and interval facts
- **WHEN** eligible-text means or reply quantiles render
- **THEN** a point/ruler SHALL include only accepted means/percentiles/sample evidence and SHALL NOT imply a full distribution, variance, or relationship conclusion not present in the DTO

#### Scenario: Render unavailable or sparse evidence
- **WHEN** an accepted fact is unavailable, empty, tied, partial, or insufficient
- **THEN** the renderer SHALL show the existing factual state and recompose around it without substituting zero, fabricating filler data, or reserving an empty visualization column

### Requirement: Vocabulary Showcase
Vocabulary SHALL retain existing role/year correlation, raw/per-10k presentation, Clean Mode, custom hidden words, frequency authority, keyword authority, and deterministic Word Cloud geometry while giving Frequent Words, Distinctive Keywords, and Word Cloud separate visual compositions. Hidden-word management, complete lists, and methodology SHALL be secondary disclosures.

#### Scenario: Render ready vocabulary evidence
- **WHEN** Frequent Words and Distinctive Keywords are ready for a concrete year
- **THEN** Frequent SHALL use fixed rank classes and visible count/rate, Keywords SHALL use deterministic fixed slots and rank-bounded emphasis, and Word Cloud SHALL own a separate full-width stage with unchanged final geometry

#### Scenario: Render all-years or insufficient keywords
- **WHEN** keyword evidence is sparse, unavailable, or not defined for all-years
- **THEN** the scene SHALL select the frozen sparse/unavailable variant, show the existing concise explanation, and SHALL NOT reserve a fixed tall 5+7 row with an empty/small second column

#### Scenario: Toggle Clean Mode or hide a word
- **WHEN** the user changes Clean Mode or custom hidden words
- **THEN** only bounded display candidates and presentation/layout identity SHALL change; counts, rates, denominator, frequency DTO identity, keyword scores/order, analytics query, and deterministic coordinates for unchanged inputs SHALL remain authoritative

#### Scenario: Access Word Cloud without vision or motion
- **WHEN** Canvas is hidden, fails, is reduced-motion, or is ignored by assistive technology
- **THEN** the same ranked list with token/rank/count/rate/role/year SHALL remain available and complete without waiting for animation

### Requirement: Detailed modern data workspace
Detailed SHALL retain all eight routes and accepted query/filter/pending/focus/export semantics while recomposing its shell as Context Strip → Workspace Toolbar → Section Rail → Route Canvas. Standard shall use one horizontal rail and 12-column canvas; Wide may use a 2+10 folio rail/content ledger; Compact/Narrow shall preserve semantic scrollable tabs and a single content flow.

#### Scenario: Render the Detailed shell
- **WHEN** a committed analysis result enters Detailed
- **THEN** dataset-local status, applied range/sender/threshold, analyze-other-files action, draft query fields, Apply, eight routes, and current route SHALL remain available with fewer visual hierarchy levels than the current header/context/form/rail stack

#### Scenario: Render Overview
- **WHEN** Overview has complete evidence
- **THEN** it SHALL compose selected messages, activity, role comparison, replies/sessions, and support trend/types on the declared ledger spans without eight equal cards or long definition copy competing with values

#### Scenario: Navigate all routes by keyboard
- **WHEN** the user Tabs to the route rail or uses Arrow/Home/End on the active tab
- **THEN** all eight unchanged routes SHALL remain reachable, selected with correct ARIA state, and focus SHALL move to the route panel exactly as the accepted behavior defines

#### Scenario: View methodology
- **WHEN** the user opens route/global methodology
- **THEN** Population, Scope, Timezone, Exceptions, and Version SHALL appear as a structured definition list on a compact ledger surface instead of an always-dominant gray documentation slab

#### Scenario: Use Detailed at Narrow and 200% zoom
- **WHEN** the workspace is 380px wide or equivalent to 200% zoom
- **THEN** toolbar/content SHALL form one column, route tabs SHALL remain visibly scrollable and keyboard operable, page-level horizontal overflow SHALL be absent, and only labelled table regions MAY scroll horizontally

### Requirement: Home refinement and Share preservation
Home SHALL remain a quiet private-local portal with one hero hierarchy, committed scope, local/privacy identity, and the two existing Annual/Detailed choices. It MUST NOT add a card wall. Share Card and Preview SHALL remain the protected archival-folio baseline unless separately authorized.

#### Scenario: Enter Home after analysis
- **WHEN** a complete result is available
- **THEN** Home SHALL show real committed scope information, a primary Annual action, a secondary Detailed action, and concise local-only identity without fabricated content or additional feature cards

#### Scenario: Smoke protected Share Preview
- **WHEN** V3 visual batches run regression acceptance
- **THEN** Share Preview/Canvas/PNG/native save SHALL pass existing B5 smoke evidence without an implicit visual or authority change

### Requirement: Bounded motion system
V3 SHALL implement Micro 120–220ms, Navigation 180–260ms, Scene 420–560ms, Data 440–700ms, and Canvas ≤600ms motion using the triggers/easings in `design.md`. Motion SHALL be one-shot, interruptible, transform/opacity-first, presentation-only, and non-essential to comprehension. Reduced motion and failure SHALL show the identical final state immediately.

#### Scenario: Trigger a scene animation
- **WHEN** an armed scene first crosses the `.18` intersection threshold with the frozen root margin
- **THEN** it SHALL reveal once, disconnect one-shot observation, leave final semantic content available, and SHALL NOT replay on minor reverse scroll or start analytics/layout work

#### Scenario: Animate data marks
- **WHEN** committed data is ready in a visible scene
- **THEN** baselines, paths, cells, bands, or markers MAY animate for the frozen duration while labels/exact values remain readable from the start and no layout property changes

#### Scenario: Animate Word Cloud presentation
- **WHEN** one final deterministic Word Cloud layout completes
- **THEN** a single bounded rank-order reveal MAY redraw opacity/small scale over the unchanged coordinates for no more than 600ms, SHALL read no DOM layout, SHALL cancel on new digest/hidden/unmount/input, and SHALL leave no live RAF handle

#### Scenario: Reduce or interrupt motion
- **WHEN** reduced motion is requested, an observer/animation/RAF is unavailable, the document is hidden, or user input interrupts
- **THEN** the final content and Canvas state SHALL appear immediately with identical focus, controls, values, geometry, and query/presentation identity

#### Scenario: Reject gimmicky motion
- **WHEN** implementation introduces scroll snapping/hijacking, continuous parallax/particles, infinite loops, random movement, comprehension-required count-up, `transition:all`, or layout-shifting animation
- **THEN** V3 acceptance SHALL fail

### Requirement: Local generated-art boundary
V3 SHALL reuse the existing Opening and Closing assets, preserve Share artwork authority, and MAY later generate only the bounded Rhythm, Vocabulary, or Home candidates listed in `design.md`. New art SHALL be generic, abstract, local, offline, decorative, text/data/identity-free, reviewed in synthetic context, and complete with a deterministic CSS/SVG fallback.

#### Scenario: Generate a listed candidate
- **WHEN** an authorized implementation batch invokes image generation
- **THEN** prompts/candidates SHALL contain no real screenshot, chat text, keyword, name, number, statistic, path, identity, logo, remote resource, or runtime-generation requirement and SHALL remain within the stated candidate/refinement limit

#### Scenario: Reject all candidates
- **WHEN** generated candidates are mediocre, artifacted, noisy behind data, privacy-inappropriate, or fail crop/offline/size review
- **THEN** the CSS/SVG fallback SHALL ship and no candidate SHALL be retained merely to satisfy the inventory

#### Scenario: Artwork fails or is hidden
- **WHEN** a local decorative asset cannot decode or is ignored by assistive technology
- **THEN** headings, facts, controls, charts, navigation, and reading order SHALL remain complete without a network fallback or layout collapse

### Requirement: Consolidated CSS authority
V3 SHALL migrate presentation styling into ordered foundation, Annual, Detailed, and motion layers with a protected Share authority. Each V3 component and breakpoint SHALL have one selector authority. Migration SHALL be consumer-by-consumer, and superseded V1/V2/P1 selectors SHALL be removed only after their migrated consumer passes behavior, screenshot, geometry, responsive, and accessibility gates.

#### Scenario: Migrate one scene
- **WHEN** an Annual scene adopts V3 DOM and styling
- **THEN** it SHALL use the explicit V3 version scope instead of appending overrides to `.beta-v2-*`, and its old selectors SHALL remain only until that scene's gate passes

#### Scenario: Audit the final cascade
- **WHEN** V3.5 performs CSS review
- **THEN** no component SHALL rely on later chronological hotfix blocks, duplicated same-root selector generations, negative-margin structural hacks, arbitrary ordinary-scene min-height, accidental stretch, or an implicit equal-column default

#### Scenario: Preserve dependencies
- **WHEN** CSS/presentation architecture is implemented
- **THEN** it SHALL use existing React/CSS/Canvas/SVG/native browser primitives by default and SHALL NOT add Tailwind, a UI kit, CSS-in-JS, remote font, CDN, or unreviewed chart/motion dependency

### Requirement: Responsive composition matrix
V3 SHALL pass `1440×900`, `1180×760`, `760×900`, `380×900`, and 200% zoom with the exact grid regimes and component fallbacks defined in `design.md`. Annual SHALL recompose rather than squeeze desktop columns; Detailed SHALL preserve dense but readable controls/tables; page-level horizontal overflow, clipped focus, covered headings, and two-dimensional page scroll are failures.

#### Scenario: Render fixed acceptance viewports
- **WHEN** synthetic Home, all seven Annual scenes, Vocabulary variants, all Detailed routes, and Share smoke render at each fixed viewport
- **THEN** their declared 12/8/4-column or stacked compositions SHALL apply, no serious overflow/occlusion SHALL occur, and screenshots SHALL contain complete headings, controls, visual annotations, and artwork fallback/crop

#### Scenario: Scroll a wide table
- **WHEN** an exact Detailed table cannot fit at Narrow/200% zoom
- **THEN** only its labelled focusable region SHALL scroll horizontally with a visible cue, while the page, query controls, route rail container, and focus outline remain within the viewport

### Requirement: WCAG 2.2 AA visual and interaction baseline
V3 SHALL preserve semantic controls/headings, keyboard operation, visible focus, chart alternatives, accessible Word Cloud list, zoom, contrast, reduced motion, and non-color-only meaning. New navigator/disclosure/motion/artwork behavior SHALL meet the detailed accessibility contract in `design.md`.

#### Scenario: Complete Annual by keyboard
- **WHEN** a keyboard user enters Annual, navigates scenes/chapters, changes range, edits vocabulary controls, opens hidden-word/methodology disclosures, opens/closes Share Preview, and enters Detailed
- **THEN** focus SHALL remain visible/logical, controls SHALL have names/state, anchors SHALL clear the dock, and dialogs/disclosures SHALL return focus to their trigger

#### Scenario: Read a chart without graphics
- **WHEN** a chart, role band, matrix, motion, Canvas, or artwork is unavailable
- **THEN** a heading/caption plus exact ordered list/table/definition SHALL communicate the same accepted evidence and state

#### Scenario: Announce dynamic state
- **WHEN** scene, report, frequency, layout, export, empty, partial, error, or cancellation state changes
- **THEN** a restrained live region SHALL announce stable useful state with a next step where applicable and SHALL NOT expose private/internal content or repeatedly announce animation frames

### Requirement: Synthetic visual acceptance loop
Every implementation batch SHALL run synthetic screenshots, DOM geometry diagnostics, human visual inspection, responsive review, motion review, accessibility review, performance/cleanup diagnostics, and regression tests before commit/push. A Playwright no-overflow assertion alone MUST NOT satisfy visual acceptance.

#### Scenario: Complete a visual batch
- **WHEN** a V3 implementation batch reaches its stop gate
- **THEN** its report SHALL inventory every screenshot/viewport/state, state what was visually inspected, record `PASS`, `NEEDS POLISH`, or `FAIL`, list known debt, include geometry/motion/performance evidence, and block progression on any `FAIL`

#### Scenario: Inspect the Annual sequence
- **WHEN** Annual screenshots are reviewed
- **THEN** Opening, Scale, Rhythm, Balance, Conversation, Vocabulary, and Closing SHALL be inspected individually and as one story for hierarchy, alignment, density, rhythm, balance, differentiation, readability, chart clarity, artwork integration, and navigation clarity

#### Scenario: Enforce synthetic-only evidence
- **WHEN** automation, screenshot review, art review, package smoke, or documentation evidence runs
- **THEN** it SHALL use synthetic fixtures only and SHALL NOT discover, list, search, traverse, open, screenshot, transcribe, or record any real/private source, statistic, token, identity, or image

### Requirement: Geometry diagnostic inventory
Browser acceptance SHALL emit stable JSON diagnostics for every Annual scene, declared grid cell, meaningful content boundary, inter-scene gap, computed min-height/alignment, navigator box, anchor offset, page overflow, and whitespace allowlist reason at every fixed viewport.

#### Scenario: Catch a historical half-screen failure
- **WHEN** a short painted column shares a row with a much taller sibling while the whole scene's bottom-most leaf makes scene tail appear small
- **THEN** per-cell occupancy/balance/stretch diagnostics SHALL fail even if the legacy whole-scene leaf-bottom assertion would pass

#### Scenario: Catch sticky occlusion
- **WHEN** every scene and logical chapter is activated at each viewport and 200% zoom
- **THEN** diagnostics SHALL verify heading/focus clearance below the dock and SHALL fail clipped anchors, overlay intersection, or incorrect scroll padding/margin

### Requirement: Performance and lifecycle constraints
V3 SHALL retain `mainThreadLayoutCalls=0` for analytics and Word Cloud layout, SHALL run no analytics/tokenization/layout on scroll/navigation/animation, SHALL bound observers/RAF/caches/items/assets, and SHALL add no network or unreviewed dependency. Motion shall be diagnosed for long tasks and complete cleanup.

#### Scenario: Scroll and animate Annual
- **WHEN** a synthetic user scrolls all scenes and triggers every motion class
- **THEN** analytics/report/frequency/layout request counts SHALL remain unchanged, scene observers SHALL disconnect/cleanup, no continuous RAF SHALL remain, and page interaction SHALL remain responsive

#### Scenario: Miss a Canvas motion budget
- **WHEN** repeated bounded Word Cloud reveal diagnostics produce >100ms motion tasks, visible freeze, or retained RAF/Canvas state
- **THEN** implementation SHALL fall back to one whole-canvas transform/opacity reveal with unchanged final geometry rather than move layout to the main thread or add a dependency

#### Scenario: Run packaged offline
- **WHEN** the latest synthetic package runs outside the repository with network blocked
- **THEN** V3 fonts, CSS, artwork/fallbacks, charts, motion, Word Cloud, Home, Annual, Detailed, and protected Share flow SHALL work without a remote request or development runtime

### Requirement: Bounded migration and review gates
Implementation SHALL proceed only through V3.1 Foundation/Shell/Navigator, V3.2 Annual Core, V3.3 Vocabulary, Sol xHigh mid-review, V3.4 Detailed, V3.5 Cross-Product/Final QA, Sol High/xHigh final review, and V3.6 bounded final fixes if required. Each batch SHALL stop after its own exact-path commit/push and MUST NOT reopen accepted global architecture during V3.6.

#### Scenario: Reach the mid-review
- **WHEN** V3.3 passes its implementation gates
- **THEN** work SHALL stop for Sol xHigh review of composition, motion, hierarchy, and remaining Annual/Vocabulary debt before Detailed implementation begins

#### Scenario: Reach final fixes
- **WHEN** V3.5 and final Sol review produce a bounded finding list
- **THEN** V3.6 SHALL fix only those findings, rerun their affected gates, and SHALL NOT introduce new analytics, export authority, framework, or global presentation re-architecture

#### Scenario: Hand off real-data acceptance
- **WHEN** all synthetic source/package/visual gates pass and the latest package is ready
- **THEN** the user SHALL perform real-data visual acceptance separately while the agent does not access private data, and the implementation SHALL not treat that boundary as analytics failure
