## Context

### Planning baseline and privacy boundary

This planning freeze was prepared on branch `feat/implement-local-chat-wordcloud-mvp` at full initial HEAD `c054754883a567f8a2c05d5d386de0e7abb1bf77` (`feat: complete beta packaged acceptance`), with a clean workspace and upstream `0/0`. The only private-boundary command executed was `git check-ignore -v data/private`, which confirmed `.gitignore:4:data/private/`. No private directory was listed, searched, traversed, or opened; no real source, screenshot, identity, token, aggregate, or statistic was used. All later implementation and acceptance evidence defined here is synthetic-only.

`ui-ux-pro-max` is not installed (`UI_UX_PRO_MAX_AVAILABLE=false`). Planning therefore uses the installed `frontend-design`, current Web Interface Guidelines through `web-design-guidelines`, and `openspec-propose` skills. The visual brief is treated as four related surfaces with separate purposes: Annual is a cinematic editorial archive, Detailed is a professional data workspace, Home is a quiet local portal, and Share Card remains an archival folio.

### Protected product substrate

The completed `beta-annual-recap-visual-experience`, `productize-local-chat-analysis-desktop`, and `implement-local-chat-wordcloud-mvp` changes remain the functional and authority baseline. V3 is presentation-only. It preserves canonical/dedup behavior, Analytics Worker boundaries, query identity, `reportBaseRange` and year synchronization, Draft versus Applied state, explicit Apply, frequency denominators, Clean Mode, custom hidden words, keyword ranking, deterministic Word Cloud geometry, reply/session calculation, Summary contracts, Canvas/PNG determinism, raw IPC lease, `NSSavePanel`, atomic save, aggregate export, package/offline behavior, and privacy authority.

The existing product composition is:

```text
DesktopImportPanel
├── product header + completion status + mode navigation
├── Home → BetaHome
├── Annual → BetaAnnualReport
│   ├── ReportNavigator
│   ├── BetaCoreReportSections → 5 scenes / 12 logical facts
│   ├── BetaWordEvidenceSections → frequent / keyword / cloud
│   ├── ClosingScene
│   └── BetaSharePreviewDialog (protected B5 authority)
└── Detailed → DesktopDashboard
    ├── header + applied context + draft query form
    ├── 8-route tab rail
    ├── route panel
    └── global methodology disclosure
```

### Current visual architecture diagnosis

The UI is no longer failing because one margin, color, or card is wrong. It fails because the final DOM and cascade encode several incompatible generations at once.

| Evidence | Root cause | Visible consequence | V3 architectural response |
|---|---|---|---|
| `frontend/src/presentation/beta/styles.css` is 6,132 lines. V1 occupies lines 1–2579, a second Detailed layer starts at 2580, Annual V2 starts at 3778, P1 overrides start at 4912, and protected B5 styles start at 5444. | The cascade is chronological patch history rather than one source of visual truth. | A selector's apparent definition is not its final authority; breakpoint changes and later hotfixes silently undo earlier composition. | Migrate consumers into ordered foundation/Annual/Detailed/motion layers, then remove superseded selectors after visual and behavioral parity gates. |
| `.dashboard-shell` starts at lines 1858, 2586, and 5264; `.beta-report-navigation` starts at 811 and is rewritten at 4962 plus three responsive blocks. | Identical selectors carry different generations with equal or higher specificity. | Small fixes require another later rule; tokens, dimensions, and responsive behavior drift. | Give V3 roots an explicit version scope and keep one selector authority per component and breakpoint. |
| `ReportNavigator` renders context, seven scene buttons, year select, chapter select, and restore action in one sticky five-column `<nav>`. | Progress, context, global scope, chapter navigation, and recovery are permanently co-present. | The navigator behaves like an admin form and remains visually stronger than the report. | Use a thin reading-progress dock with on-demand, in-flow controls; update current scene from scroll observation. |
| `selectedSection` changes only through `changeReportSection`; scrolling only saves `window.scrollY`. | Navigation state is click-driven, not reading-position-driven. | The displayed scene can be stale during ordinary reading. | Add a presentation-only scene observer; it updates navigation state but never analytics/query/layout identity. |
| `BetaCoreReportSections` has scene-specific wrappers, but every `LogicalSection` still emits the same Header → Lead → Metric → Visual → Detail sequence. | Logical-section anatomy is mistaken for visual-scene composition. | Different facts repeat the same editorial grammar and hierarchy. | Keep logical anchors/contracts while scene components own distinct DOM composition and only reuse low-level primitives. |
| P1 rewrites both Scale and Balance to 12-column grids whose hero and support groups each span the full row. | A screenshot fix flattened meaningful asymmetry rather than making it content-aware. | The hero ends before its scene does, and the user perceives large unclaimed regions. | Give each scene a declared composition mode and density variant; choose asymmetry or stacked layout from existing presentation evidence. |
| Vocabulary uses a fixed `5fr + 7fr` row even when keywords are unavailable or sparse. | Layout does not react to evidence availability/density. | Dense Frequent Words and a short keyword notice still reserve a long shared row. | Use `ready`, `sparse`, and `unavailable` composition variants; cloud remains a separate full-width beat. |
| `MetricHero`, support blocks, charts, rankings, and methodologies repeatedly use borders, rounded surfaces, green lines, and inset gray slabs. | Primitive reuse is visual reuse, not structural reuse. | Annual scenes look templated; Detailed looks like a card wall. | Reuse layout/accessibility primitives while scene/chart surface treatments remain purpose-specific. |
| `BarChart` is reused throughout Detailed, and Annual falls back to `BarRows` for multiple unrelated metrics. | Representation is chosen by implementation convenience, not semantic role. | Time, rank, category, and interval data all read as utility bars. | Freeze a Visual Encoding Matrix and distinct Annual/Detailed renderers over the same accepted facts. |
| Current one-shot scene motion is `220ms`, opacity, and `translateY(8px)`. | Motion has one generic consumer and no data/navigator/Canvas choreography. | Motion is safe but nearly imperceptible and does not create story emphasis. | Introduce micro, scene, data, navigation, and bounded Canvas motion with fixed triggers, durations, cleanup, and reduced-motion equivalence. |
| The browser geometry test finds the bottom-most leaf in a whole scene and asserts a small scene tail. | One global bottom cannot detect an empty second column, a stretched sibling, or a large blank region above a longer sibling's bottom. | The most obvious visual failure can pass automation. | Instrument scene content bounds and each declared grid cell; test tail, occupancy, sibling balance, min-height, and navigation occlusion separately. |
| Detailed has a header, applied strip, query form, tab rail, page heading, developer disclosure, chart cards, tables, and global methodology stacked before/around data. | Correct states are represented as separate visual containers and hierarchy levels. | The workspace is stable but dense in chrome and repetitive in panels. | Compress context/query/navigation, use a ledger canvas with flat sections, and make methodology progressive and structured. |

The Web Interface Guidelines review confirms that the stable baseline already uses semantic buttons/links/selects, visible `:focus-visible`, a skip link, explicit image dimensions, reduced-motion handling, exact chart alternatives, and no `transition: all`. V3 must retain those strengths. Planning also records two corrections: the Clean Mode label must not use the text glyph `✓` as an icon substitute, and every V3 anchored heading—not only its scene wrapper—must own an effective `scroll-margin-top` tied to the real navigator height.

## Goals / Non-Goals

**Goals:**

- Make Annual feel like a cinematic editorial annual recap and private personal archive, while making Detailed visibly denser, quieter, and more professional.
- Eliminate accidental half-screen whitespace through content-driven scene structure and testable grid-cell geometry rather than another margin override.
- Preserve seven narrative scenes, sixteen logical sections, their order, meanings, anchors, empty states, and accepted facts while allowing multiple logical sections to form one visual beat.
- Freeze concrete tokens, type scales, grid spans, scene compositions, chart representations, motion triggers/durations/easings, responsive fallbacks, and accessibility alternatives.
- Make Vocabulary a deliberate climax without changing frequency authority, Clean Mode/custom-hidden semantics, or deterministic Word Cloud geometry.
- Replace the Annual admin-toolbar impression with light reading progress and accessible on-demand controls.
- Consolidate CSS authority and specificity without a framework rewrite or risky all-at-once replacement.
- Require synthetic screenshots, human visual inspection, DOM diagnostics, responsive/motion/accessibility review, and performance evidence in every implementation batch.

**Non-Goals:**

- Production implementation, final artwork generation, screenshot generation, packaging, or private-data acceptance in this planning freeze.
- Any new analytics, new metric, new inference, data/query/worker/export/privacy contract change, or rewording that implies unsupported statistical meaning.
- Tailwind, MUI, Ant, Chakra, Bootstrap, a large component library, CSS-in-JS, a broad icon pack, or a default Framer Motion dependency.
- A Share Card renderer, Canvas, PNG, IPC, lease, or native-save redesign. Any later polish requires a separate task and full B5 regression.
- Scroll snapping, scroll hijacking, continuous parallax, infinite animation, particles, count-up required for comprehension, random motion, or layout-shifting animation.
- A full dark mode, remote fonts, runtime downloads, CDN artwork, runtime image generation, or network access.

## Decisions

### 1. Freeze mode-specific visual anchors without mixing their tokens

The product has one domain and shared semantics, but Annual and Detailed have intentionally different jobs. One generic hybrid theme would preserve the current ambiguity, so V3 uses two explicit `frontend-design` anchors:

- **Annual + Home — Organic.** Surface is sand `#E8DCC7` with oat `#D4B895`, moss `#606C38`, sage `#8B9D83`, clay `#B08B6E`, terracotta `#C66B3D`, ochre `#C08E3A`, and ink `#2F342C`. Display type is offline humanist serif/Chinese Songti; artwork may use restrained 1–2% print grain; major artwork/surfaces use 16–24px radii. It does not use the old pale `#F7F3EA` cream canvas, cold gray, pure white/black, glass, or neon. Share Card keeps its protected `#F7F3EA` renderer background because it is not restyled by V3.
- **Detailed — Swiss.** Surface is `#FFFFFF` or `#F7F7F8`, typography is all Helvetica Neue/PingFang/system sans, structure uses a visible 12-column ledger and 1px hairlines, primary alignment is left/asymmetric, and folio numerals identify routes. IKB `#002FA7` is the single UI signal. Owner blue and Other coral remain explicit data-semantic exceptions and always include labels/pattern or position.

Annual's memorable differentiator is the **Archive Current**: one restrained data-led path changes semantic form—cover registration mark, Scale baseline, Rhythm pulse, Balance proportion, Conversation connection, Vocabulary perimeter, Closing folio mark—rather than repeating the same green divider. Detailed's differentiator is the **Instrument Ledger**: route folios, headings, charts, and tables align to one visible grid instead of floating in unrelated cards.

Alternatives rejected:

- Extending “Private Data Atelier” without an exact anchor would keep token drift and vague premium language.
- A single Swiss system for every mode would make Annual another polished report/dashboard.
- Lo-Fi, Brutalist, Aurora, and Retro-Futuristic anchors conflict with calm/private/professional goals or motion/accessibility constraints.

### 2. Separate color meaning from brand, selection, role, and status

Annual tokens:

| Token | Value | Exclusive use |
|---|---:|---|
| `annual.canvas` | `#E8DCC7` | Organic report/Home ground |
| `annual.inset` | `#D4B895` | Supporting inset and low-emphasis field |
| `annual.ink` | `#2F342C` | Primary text and primary action fill |
| `annual.secondary` | `#555A4E` | Body/support text; contrast verified in V3.1 |
| `annual.muted` | `#6D705F` | Metadata only; never small text until AA verified |
| `brand.moss` | `#606C38` | Product identity and artwork motif only |
| `data.neutral` | `#8B9D83` | Non-role single-series data |
| `data.peak` | `#C08E3A` | Directly labelled peak/tie emphasis |
| `data.owner` | `#254B9B` | Owner role only |
| `data.other` | `#C66B3D` | Other role only |
| `status.success` | `#1F6B52` | Labelled success state only |
| `status.warning` | `#8A5B00` | Labelled partial/warning state only |
| `status.error` | `#A63A2D` | Labelled error state only |
| `focus.ring` | `#005FCC` | Keyboard focus only |

Detailed tokens:

| Token | Value | Use |
|---|---:|---|
| `workspace.canvas` | `#F7F7F8` | Workspace background |
| `workspace.surface` | `#FFFFFF` | Data/table surface |
| `workspace.inset` | `#EEF0F3` | Compact disclosure/table header |
| `workspace.border` | `#C9CDD5` | Strong hairline |
| `workspace.divider` | `#DDE0E5` | Internal ledger line |
| `workspace.ink` | `#16181D` | Text/actions/selected underline |
| `workspace.secondary` | `#565C66` | Supporting copy |
| `workspace.muted` | `#747A84` | Metadata after AA verification |
| `workspace.signal` | `#002FA7` | IKB focus/signal, sparingly |
| `data.owner` | `#254B9B` | Owner role only |
| `data.other` | `#FF4F00` | Other role only |

Selection uses weight, position, and an ink hairline; it does not borrow success green or role colors. Brand moss does not mean positive, selected, or data. Peaks always have text/shape annotation. Status always has a word/icon and never relies on hue.

### 3. Freeze offline typography and Chinese/Latin/numeric hierarchy

No webfont, font file download, or runtime fallback request is permitted. V3.1 must render a synthetic Chinese/Latin/numeric specimen in the packaged WebView before finalizing fallback order; the following roles and bounds are already frozen:

| Role | Stack / size at Standard | Rules |
|---|---|---|
| Annual Cover | `Iowan Old Style, Baskerville, Songti SC, STSong, serif`; `clamp(56px, 7vw, 88px)/.94` | One range/year line; ≤12 CJK characters; `text-wrap: balance` |
| Annual Scene | same serif; `clamp(36px, 4.2vw, 52px)/1.06` | One per scene; never controls/charts |
| Annual Beat | `Helvetica Neue, PingFang SC, system-ui`; `clamp(24px, 2.7vw, 32px)/1.18`, 700 | Logical section title |
| Annual Metric Hero | UI sans; `clamp(72px, 9.5vw, 120px)/.86`, 720 tabular | One dominant metric per scene |
| Annual Metric | UI sans; `clamp(32px, 4vw, 52px)/.96`, 700 tabular | Supporting metrics |
| Annual Lead | UI sans; `18px/1.65`, ≤54ch | One short scene summary |
| Body | UI sans; `15px/1.65`, ≤72ch | Explanations |
| Label / Caption / Meta | UI sans; `12/13/11px` | No forced uppercase Chinese; meta never below 11px |
| Detailed Page | UI sans; `clamp(26px, 2.6vw, 34px)/1.1`, 700 | One route heading |
| Detailed Section | UI sans; `18px/1.25`, 700 | Compact flat section |
| Detailed Metric | UI sans; `28–48px/.95`, 720 tabular | Density depends on role |
| Detailed Body / Label / Meta | UI sans; `14/12/11px` | Tables use tabular numerals and right alignment |

Latin and numerals use the first available Latin face; Chinese falls through to Songti/PingFang. `font-synthesis: none`, `font-variant-numeric: tabular-nums`, balanced major headings, pretty body wrapping, and `overflow-wrap:anywhere` for user-derived tokens are required. Letter spacing applies only to short Latin/folio labels, never to Chinese body or all-caps filler. Standard actions retain standard copy.

### 4. Replace scene wrappers with reusable structural primitives

V3 components are structural contracts, not mandatory visual boxes:

| Primitive | Responsibility | Forbidden responsibility |
|---|---|---|
| `PageShell` | Product canvas/max width/safe area | Scene-specific color or min-height |
| `AnnualScene` | Semantic `<section>`, scene ID, content boundary, motion/geometry markers | Default card, arbitrary min-height |
| `SceneIntro` | Folio, scene heading, one summary | Metric/chart layout |
| `SceneBody` | Main content boundary for geometry diagnostics | Equal-column default |
| `SceneAside` | Supporting evidence, `align-self:start` | Stretching to sibling height |
| `EditorialGrid` | 12/8/4 tracks, declared composition/density | Auto-fit or implicit 50/50 |
| `MetricHero` / `MetricCluster` | Label/value/unit/short descriptor | Definition paragraphs |
| `ChartStage` | Figure, visible annotation, exact alternative link/disclosure | Metric calculation |
| `DataAnnotation` | Direct peak/tie/unit/sample label | Color-only meaning |
| `NarrativeBand` | One purposeful full-width visual beat | Empty transition spacer |
| `VocabularyStage` | Frequent/keyword/cloud composition variants | Frequency or layout calculation |
| `ArtworkStage` | Local decorative asset/fallback and crop contract | Data-bearing pixels |
| `ProgressNavigator` | Reading progress, scene/scope/chapter controls | Analytics/query interpretation |
| `WorkspaceSection` | Flat Detailed section on ledger grid | Generic rounded-card defaults |
| `WorkspaceToolbar` | Draft fields, applied state, Apply, errors | Automatic Apply |
| `DisclosureDrawer` | Secondary methods/hidden-word controls | Primary facts |

`BaseCard` remains compatibility-only during migration and must not wrap ordinary V3 logical sections. Every grid declares `data-layout-mode` and every meaningful cell declares `data-geometry-cell`; geometry tests consume these stable markers rather than selector heuristics.

### 5. Freeze content-driven scene height, grid, and spacing contracts

Canvas and tracks:

| Range | Grid | Content width | Outer inline margin | Gutter |
|---|---:|---:|---:|---:|
| Wide `≥1440` | 12 columns | max 1280px | 64px | 24px |
| Standard `960–1439` | 12 columns | max 1120px | 24–40px | 20px |
| Compact `600–959` | 8 columns | viewport minus 40px | 20px | 16px |
| Narrow `<600` | 4 columns | viewport minus 32px | 16px | 12px |

All major grids use `align-items:start`; siblings may stretch only when both are explicitly matched visualization peers and the geometry contract passes. Approved compositions are `12`, `8+4`, `7+5`, `6+6`, `5+7`, and `4+8`. `6+6` is allowed only when both cells are evidence peers and their meaningful heights differ by no more than 25% or 160px. `auto-fit`, unbounded implicit tracks, negative margins, and arbitrary viewport-filling minimums are prohibited for scenes.

Spacing tokens remain `4, 8, 12, 16, 24, 32, 48, 64, 96, 128`. Annual internal beat gap is 24–32px; the space between complete scenes is 96px Wide, 80px Standard, 64px Compact, and 48px Narrow. This transition space belongs between scene boxes, not as empty padding after meaningful content. Detailed uses 8px control, 16–20px module, and 32–40px route-section rhythm.

Ordinary Scale, Rhythm, Balance, Conversation, and Vocabulary scenes use `min-block-size:0`/content height. Opening may use `clamp(520px, calc(100svh - 176px), 720px)` at Wide/Standard; Closing may use up to 600px when poster/copy are present; an explicit `ArtworkStage` may use its frozen aspect ratio. These are the only default whitespace allowlist. Compact/Narrow Opening and Closing return to content-driven height.

### 6. Replace the sticky form toolbar with Progress Navigator V3

The selected design is a **minimal reading dock plus on-demand controls**, not an automatically height-morphing toolbar. Automatic height morphing was rejected because changing a sticky element's block size can shift anchors and focused content.

Desktop dock:

- One sticky 44px row at `top:8px`, maximum width 720px, visually centered within the report rather than spanning the canvas.
- Left: current scene folio and label, such as `06 / 07 · 词汇`.
- Center: seven semantic progress segments/buttons; current and completed position use shape, label, and `aria-current`, not color alone.
- Right: one labelled “范围与章节” button. It expands an anchored control region in normal flow directly below the dock; it is not a viewport-covering popover.
- Expanded controls contain the existing native year/range select, native logical-chapter select, and explicit restore-full-range button. Closing the controls returns focus to the trigger.
- The current scene is derived from scene sentinels crossing a reading line at `max(navBottom + 24px, 28vh)`. The observer updates presentation navigation state only; it does not modify query/report/frequency/layout identity or force scroll.
- Scene/chapter activation calls ordinary `scrollIntoView({block:"start", behavior:"auto"})`; no snap, lock, or wheel/touch interception.
- `--annual-nav-occupied-block` is measured from frozen state constants, not live layout reads. `scroll-padding-top` and every logical heading's `scroll-margin-top` equal occupied block + 16px.

Compact/Narrow:

- Dock is full available width and 40–44px high; scene label truncates after the folio, while all seven positions remain programmatically named.
- Controls expand as a one-column in-flow drawer; selects and restore action are full width with 44px targets.
- At 200% zoom the same Narrow composition applies. No control is clipped, covered by the dock, or placed in an overlay with its own horizontal scroll.

Keyboard/accessibility:

- Native buttons/selects remain the authority. Progress buttons support normal Tab order; optional roving Arrow/Home/End behavior must not replace Tab access.
- The dock has a labelled `<nav>`, visible `:focus-visible`, current scene announcement only after a stable observer change, and no live announcement on every scroll pixel.
- Opening the control region does not move the reading position; Escape closes only that region. Focused anchors remain below the dock.

### 7. Recompose all seven Annual scenes

| Scene | Standard/Wide composition | Dominant visual and motion | Compact/Narrow fallback | Whitespace intent |
|---|---|---|---|---|
| Opening | `7+5`: cover/range/one lead/one message metric beside existing `annual-opening-hero-v1` | Cover clip reveal 520ms; art mask 560ms; no redundant badge stack | `5+3`, then 4-column copy above 4-column art; decorative art may crop to 5:4 | Allowlisted cinematic minimum only at Wide/Standard |
| Scale | `7+5`: message `MetricHero` and Archive Current baseline on 7; active days + streak `MetricCluster`/annotated timeline on 5 | Metric and baseline reveal 560ms; support annotations 480ms | `5+3`, then a single 4-column flow; no full-width hero followed by empty support row | Content-driven; no scene min-height |
| Rhythm | Month uses `12` compact year/month matrix; below it Weekday uses `5` seven-beat strip and Hour uses `7` 24-hour pulse/area strip | Matrix cell opacity stagger 20ms capped 240ms; pulse line draws 620ms from baseline | `8`, then `3+5`; Narrow stacks Month → Weekday → Hour and keeps exact tables | Content-driven; transition is inter-scene spacing, not an art spacer |
| Balance | Sender share uses `12` labelled proportional band; below it Length uses `4` and Message Types uses `8` when dense | Role band sweeps 580ms with fixed Owner/Other sides; type rows 440ms | Compact `3+5`; Narrow stack. If types have ≤3 visible rows, use `5+7`; if long, types own `12` below | Density variant comes from existing row count only |
| Conversation | `7+5`: session count/initiator composition on 7; reply quantile/interval stage on 5; one connecting path shows narrative order, not causality | Connection line 520ms; interval markers 480ms | `5+3`, then stack with connection as a vertical rule | Content-driven; methodology remains disclosure |
| Vocabulary | Ready: Frequent `5`, Keywords `7`, then Cloud `12`. Sparse/all-years: Frequent `8`, concise keyword notice `4`, then Cloud `12`. Keyword unavailable: Frequent `12`, inline notice, Cloud `12` | Top-word rank reveal 520ms; keyword constellation 560ms; bounded Word Cloud rank reveal 600ms | Compact `4+4` only when both ready; otherwise stack. Narrow always Frequent → Keywords/notice → Cloud | Content-driven; cloud stage aspect ratio is meaningful content |
| Closing | `5+7`: concise conclusion, Share Card CTA, Detailed CTA beside existing `closing-poster-v1` | Poster mask 560ms; CTA micro transition only | 4-column copy then poster; Share Preview behavior unchanged | Allowlisted cinematic poster composition |

Opening removes redundant mode/privacy/fixture badges from the primary hierarchy; scope, local-only state, and partial range remain concise and accessible. Closing uses the existing strong art direction and connects the “生成回顾卡” action to the archival folio without changing preview/export architecture.

### 8. Freeze the data visualization language

V3 changes only representation. Labels, units, ordering, ties, availability, denominators, filtering exceptions, and exact alternatives come from accepted DTO/presenter authority.

| Existing fact | Semantic role | Annual representation | Detailed representation | Color/emphasis | Motion | Accessible equivalent |
|---|---|---|---|---|---|---|
| Message total | Magnitude | Metric Hero + registered baseline | Compact headline metric | Ink; no positive color | number is static; baseline draws 520–560ms | labelled value/definition |
| Active days | Coverage | Annotated activity band | Compact metric | neutral sage/graphite | band reveals 480ms | exact value/definition |
| Longest streak/ties | Duration intervals | Chronological streak timeline | Dense interval list/timeline | peak ochre + direct dates | line scaleX 520ms | ordered tied-interval list |
| Month | Calendar rhythm | 12-cell-per-year matrix/timeline | precise line/column trend | neutral cells; peaks outlined/labelled | opacity stagger ≤620ms total | exact month table + partial marks |
| Weekday | Ordered 7-bucket rhythm | Seven-beat dot/column strip | compact columns | one neutral series; peak annotation | baseline scaleY 480ms | Monday–Sunday exact table |
| Hour | Ordered 24-bucket rhythm | 24-hour pulse/area strip | compact columns/line | neutral series; peak annotation | path/columns 620ms | 00–23 exact table |
| Owner/Other share | Part-to-whole roles | Labelled proportional band | precise two-row comparison | fixed Owner blue / Other coral + position/pattern | sweep 580ms | counts/shares definition list/table |
| Eligible text length | Comparable means | Labelled three-point/lollipop comparison; no fake distribution | compact numeric comparison | neutral except role markers | dots reveal 460ms | exact overall/role values |
| Message type | Ranked categories | Ranked proportional bands | compact ranked bars/table | neutral; category labels | row scaleX 440ms | exact ordered table |
| Session count/initiation | Magnitude + role share | Hero session metric + initiator band | metric + precise role rows | role colors only on roles | 520ms | exact counts/shares |
| Reply gaps/quantiles | Ordered interval distribution | p25/median/p75/p90 interval ruler using existing evidence | compact histogram/table | median direct label; neutral band | markers 480ms | exact direction/quantile table |
| Frequent words | Rank/frequency | Top-3 typographic hierarchy + proportional ranked list | compact ranking bars | size is rank-bounded; exact values visible | rank stagger ≤520ms | full ordered list with count/rate |
| Distinctive keywords | Year-relative rank | Bounded typographic constellation; size classes encode display rank only | compact ranked evidence list | terracotta/ink; score never implied by arbitrary area | rank stagger ≤560ms | exact keyword list/method table |
| Word Cloud | Existing deterministic geometry | Full-width Canvas artwork stage | not added to Detailed | existing role-safe palette; text stays readable | presentation-only rank draw ≤600ms | unchanged ranked accessible list |

Annual charts are editorial and annotated; Detailed charts are precise, compact, and ledger-aligned. A single renderer may share formatting/accessibility helpers, but it must not force identical visual grammar across modes. SVG/CSS/Canvas primitives are preferred; ECharts or a new chart library is not required.

### 9. Make Vocabulary a staged visual climax, not a tool panel

Vocabulary uses one `VocabularyStage` over the already-correlated frequency/result evidence:

1. **Scope and display controls** form a compact toolbar before the visual beats. Role, raw/per-10k, and Clean Mode retain native fieldset/radio/checkbox semantics. The Clean Mode label is plain text with a CSS/SVG state mark, not the `✓` glyph. Controls do not recompute analytics except the already-existing role-scoped frequency request.
2. **Frequent Words** present the top three as large but bounded rank classes (`rank-1`, `rank-2`, `rank-3`), followed by rows 4–8 with visible count/rate. Font size represents display rank only; exact values remain adjacent. The complete list stays in disclosure.
3. **Distinctive Keywords** use four to six typographic placements chosen by deterministic rank order. Position is a fixed slot, not a force layout; font size is a fixed rank class, not an unlabelled score area. Counts and “年度区分候选” context stay visible. All-years/insufficient evidence produces a concise notice and triggers the sparse composition variant.
4. **Word Cloud** owns the full canvas. Perimeter artwork may frame only the outer 12–15% and cannot reduce the layout rectangle, cover glyphs, or change coordinates. Controls, status, and the accessible list trigger stay outside Canvas.
5. **Secondary operations**—custom hidden-word manager, complete rankings, statistical methodology, Canvas omissions—move to `DisclosureDrawer` instances after the main stage. At Narrow/200% they expand in flow; no bottom sheet may cover the focused word or trigger.

Custom hidden words remain capped and local. Hiding/restoring changes presentation/layout identity exactly as today but never counts, rates, denominator, analytical rank, keyword algorithm, or canonical query. Clean Mode remains default-on presentation filtering with deterministic refill.

### 10. Recompose Detailed as a modern Swiss data workspace

Detailed retains `DesktopDashboard` props, callbacks, eight route names, ARIA tab behavior, focus transfer, draft validation, explicit Apply, pending retention, stale export fence, local year/threshold behavior, all metrics/tables, and exports.

Shell:

- **Wide `≥1440`:** a 2-column route folio rail plus 10-column content canvas. Header and query toolbar span all 12 columns; the route rail becomes sticky within the workspace only, never viewport-covering.
- **Standard `960–1439`:** a full-width 12-column content canvas with one compact horizontal section rail. This is the primary 1180×760 gate.
- **Compact/Narrow:** the labelled tab rail scrolls horizontally with visible overflow affordance; Tab and Arrow/Home/End semantics remain. No custom select replaces accessible tabs unless testing proves the tab list unusable at 200% zoom.

Chrome order is `Context Strip → Workspace Toolbar → Section Rail → Route Canvas`. The current large Detailed header is reduced to a 44–56px context strip containing dataset-local state, applied range, sender, threshold, and “分析其他文件”. The draft toolbar uses four Standard columns (`3+3+3+3`) for start, end, sender, and Apply/status; validation stays inline. Applied values never visually mutate until Apply commits.

Overview:

- One selected-message metric spans 5 columns without a surrounding card.
- Activity spans 3 columns as a two-metric ledger group.
- Owner/Other spans 4 columns with a precise role comparison.
- Replies/Sessions spans 7 columns beneath; trend/type support spans 5 and may stack when row counts create imbalance.
- Grouping uses ledger lines, headings, and whitespace. A white surface is reserved for tables, scroll regions, or a genuinely bounded comparison—not every KPI.

Routes:

- Trends: primary monthly/annual line-column view plus collapsed exact daily data; partial periods are directly marked.
- Comparison: role band and eligible-length comparison aligned on one grid; sender-filter exception stays visible.
- Activity: compact hour and weekday plots on a `7+5` Standard composition, then chat-day/streak evidence.
- Words & Years: Summary → key visualization → primary ranking → year comparison → collapsed yearly table → collapsed methodology, with rank, keyword, and trace visually distinct.
- Message Types: ranked category composition plus exact table; system diagnostic remains separate.
- Replies & Sessions: session/initiator summary, reply distribution, threshold control, then exact tables.
- Export: one precise export form/preview with current committed scope and privacy warning; native save authority is unchanged.

Methodology becomes a structured disclosure containing definition-list rows grouped by `Population`, `Scope`, `Timezone`, `Exceptions`, and `Version`. The closed state is one 44px row; the open state uses the white ledger surface, not a full-width gray README slab. Developer schema/generation evidence remains available but visually tertiary.

### 11. Keep Home quiet and Share Card protected

Home uses the Annual Organic foundation without becoming a miniature report. It keeps one clear product heading, one local/private statement, the committed range, and the two existing Annual/Detailed actions. A subtle Archive Current entry mark may connect Home to Opening; there is no new card grid. Entry motion is one 480ms copy/art reveal and is disabled under reduced motion.

Share Card remains the strongest existing archival folio reference and is preserved by default. V3.1–V3.4 do not change `BetaShareCardPreview`, `BetaSharePreviewDialog`, `share-card-renderer.ts`, renderer geometry, fonts, artwork, Canvas digest, PNG bytes, raw IPC, lease, or native save. V3.5 may only make a separately listed, screenshot-justified low-risk DOM polish outside Canvas; any renderer visual change requires its own task, Sol review, and the complete B5 renderer/export regression before merge. No such renderer change is planned now.

### 12. Introduce five bounded motion classes

Motion must be noticeable at selected moments but silent in filters, tables, and methodology. Content and labels exist in their final semantic state before motion begins. The default CSS is visible; JavaScript adds an armed state only after feature/reduced-motion checks, preventing observer failure from hiding content.

| Class | Duration | Easing | Trigger | Allowed properties / use |
|---|---:|---|---|---|
| Micro | 120–220ms | `cubic-bezier(.2,.8,.2,1)` | direct pointer/keyboard interaction | `opacity`, `transform`, explicit border/background/color transitions for button, toggle, chip, focus, disclosure |
| Navigation | 180–260ms | `cubic-bezier(.22,1,.36,1)` | stable scene change or controls open/close | progress indicator transform/opacity; no dock height animation |
| Scene | 420–560ms | `cubic-bezier(.22,1,.36,1)` | first intersection at threshold `.18`, root margin `0 0 -12%` | opacity, translate ≤16px, clip/mask reveal; one-shot per mounted scene |
| Data | 440–700ms | `cubic-bezier(.16,1,.3,1)` | scene is visible and committed data is ready | scaleX/scaleY from explicit baseline, path/matrix/marker opacity; labels and values already readable |
| Canvas | ≤600ms | linear time mapped through `cubic-bezier(.16,1,.3,1)` | one completed Word Cloud layout/presentation digest | draw existing placed words in deterministic rank batches with opacity/small scale only; coordinates never recomputed |

Strong motion is limited to Opening, scene entries, Rhythm, Balance band, Conversation connection, Vocabulary/Word Cloud, and Closing. Standard methodology, tables, field editing, validation, and route content remain efficient and mostly use Micro motion.

Motion state rules:

- Scene observers disconnect after the first entry and clean up on unmount. Minor reverse scroll cannot replay an animation.
- Data motion begins at most once for a committed presentation identity. A scope/year/role change may animate the new committed data once after stale evidence has been fenced.
- Word Cloud may use one bounded `requestAnimationFrame` sequence of at most 600ms over the already-final Worker geometry. It reads no layout, changes no coordinates/size/rotation, cancels on new digest, hidden document, unmount, or user interaction, and leaves no live RAF handle.
- No random order, spring dependency, continuous loop, parallax, particle field, count-up, scroll-linked timeline, layout property animation, or `transition:all` is permitted.
- `prefers-reduced-motion:reduce`, missing observer/RAF, background throttling, animation cancel, or failure renders the identical final state immediately. Focus, controls, Canvas geometry, query identity, and comprehension are identical.

Native CSS, Web Animations API, IntersectionObserver, and a bounded RAF are sufficient. No motion dependency is proposed. A later dependency proposal must quantify bundle cost, prove packaged offline operation, and show a correctness benefit that native primitives cannot provide before installation.

### 13. Freeze the generated-art inventory without generating assets

All artwork is generic, abstract, repository-local, offline, text-free, and data-free. No runtime generation, remote URL, CDN, real screenshot, name, keyword, number, statistic, chat text, or identity may enter a prompt or pixel.

| Asset | V3 decision | Brief / ratio | Fallback | Batch |
|---|---|---|---|---|
| `annual-opening-hero-v1.webp` | Reuse; only crop/placement may change | Existing abstract time/rhythm landscape; 3:2 | CSS/SVG Archive Current field | V3.2 |
| `closing-poster-v1.webp` | Reuse unchanged by default | Existing 4:5 abstract closing poster | CSS line/dot folio field | V3.5 review only |
| `share-card-field-v1.webp` | Preserve B5 authority | Protected 4:5 archival field | existing deterministic Canvas fallback | Outside V3 by default |
| `rhythm-cadence-field-v3` | Optional candidate, only if CSS/SVG lacks texture | Low-noise abstract cadence strip, 3:1, no symbols/text | CSS pulse/matrix transition | V3.2, at most 3 candidates + 1 refinement |
| `vocabulary-linguistic-field-v3` | Preferred new candidate | Abstract linguistic density at perimeter, 16:9, center 70% quiet | CSS radial/line perimeter | V3.3, at most 3 candidates + 1 refinement |
| `home-local-field-v3` | Optional, lowest priority | Subtle local archive registration field, 4:3 | no art; Archive Current mark only | V3.5 after Annual approval |

Implementation uses the installed `imagegen` skill only in the listed batch. Each candidate is reviewed in synthetic context, optimized locally, checked offline, and either selected or rejected one explicit file at a time. A mediocre asset is not shipped to satisfy an inventory. Generated art is decorative with explicit dimensions, empty alt/`aria-hidden`, and a complete CSS/SVG fallback.

### 14. Migrate CSS by consumer and authority, not by file rewrite

The target is four maintainable presentation layers plus the protected share authority:

```text
styles.css             import manifest and temporary legacy bridge
foundation.css         tokens, reset, type, focus, shell, Home, structural primitives
annual.css             navigator, seven scenes, Annual charts, Vocabulary, responsive variants
detailed.css           Swiss workspace, eight routes, tables, responsive variants
motion.css             keyframes, armed states, reduced motion
styles.css or share.css
                       protected B5 Share Preview/Canvas presentation rules
```

Splitting is a migration aid, not an architecture goal. If a measured file stays cohesive below reviewable size, foundation/motion may remain together. The non-negotiable rule is one selector authority per component and breakpoint.

Migration sequence:

1. Add V3 tokens/primitives under an explicit visual-version root and use low-specificity `:where()` scopes. Do not append V3 overrides to existing `.beta-v2-*` selectors.
2. Migrate `PageShell`, Progress Navigator, and one representative scene; prove behavior/geometry before other scenes.
3. Migrate each Annual scene as a complete DOM+CSS consumer. After its screenshots/tests pass, remove only that scene's superseded V1/V2/P1 selectors.
4. Migrate Detailed shell and routes in the same consumer-by-consumer pattern. Existing chart/table behavior remains until its replacement is accepted.
5. Keep responsive rules next to their Annual/Detailed layer, ordered Wide → Standard → Compact → Narrow. No late global P1 block may override them.
6. Audit computed styles/selectors, remove dead `beta-v2`, duplicated V1/P1 rules, fixed ordinary scene min-heights, accidental `stretch`, arbitrary 50/50, and negative-margin hacks. Removal happens only after `rg` consumer proof and visual regression.
7. Leave protected B5 rules untouched through V3.4. Any exact extraction to `share.css` happens in V3.5 as a behavior-neutral task with full B5 tests.

No CSS Module, Tailwind, CSS-in-JS, UI kit, global reset rewrite, or production asset rename is required. Rollback is by bounded batch/consumer, not by reverting the whole product.

### 15. Define responsive composition, not only breakpoints

| Acceptance viewport | Annual | Navigator | Detailed | Artwork/controls |
|---|---|---|---|---|
| `1440×900` | 12 columns, 1280 max, strongest asymmetry and full scene transitions | centered 44px dock | optional 2+10 rail/content ledger | full crops; no arbitrary full-screen ordinary scenes |
| `1180×760` | 12 columns, 1120 max, primary composition gate | centered 44px dock; controls fit in one expanded row | horizontal route rail, compact context/query | Opening near-complete first view; no content under dock |
| `760×900` | 8 columns; `5+3`, `3+5`, or stack by scene | full-width dock; controls expand below | single content canvas; scrollable semantic tabs | artwork moves/crops; query fields stack as needed |
| `380×900` | 4 columns, one reading flow | 40–44px dock; one-column in-flow controls | one-column toolbar/content; tab rail scrolls | no decorative requirement; 44px targets; token wrap/break |
| `200% zoom` | Narrow rules regardless CSS pixel viewport | no clipped trigger/select/focus | no two-dimensional page scroll | tables may have labelled internal horizontal scrolling only |

Annual never squeezes a desktop `12`-column composition into Narrow. Detailed tables may scroll inside a labelled/focusable region, but page-level horizontal overflow is a failure. Safe-area insets are applied to any full-bleed/floating surface. User-derived tokens test short, normal, and 32-code-point cases.

### 16. Preserve and extend WCAG 2.2 AA behavior

- Semantic HTML precedes ARIA: sections/headings, nav/buttons/links, fieldset/legend, label/select/input, details/summary, figure/figcaption, table/caption.
- Heading order remains one page `h1`, seven scene `h2`s, and logical `h3`s. Logical section anchors are on their visible headings or wrappers with effective `scroll-margin-top`.
- Every interactive element has a visible label/name, 44px minimum target where practical, pointer/keyboard hover/active/focus feedback, and a 3px `:focus-visible` ring. Compound controls use `:focus-within`.
- Current scene, selected route, role, peak, status, and partial scope are never color-only. Owner/Other use labels and stable side/pattern. Charts expose captions plus exact list/table alternatives.
- Word Cloud Canvas remains `aria-hidden`; the ranked list contains equivalent token/rank/count/rate/role/year evidence. Animation does not delay that list.
- Status changes use restrained `aria-live="polite"`; errors include a next step. Scene progress does not announce on each scroll frame.
- Decorative artwork has `alt=""`, explicit `width`/`height`, predictable aspect ratio, lazy loading below fold, and complete text/CSS fallback.
- 200% zoom, 380px width, long tokens, keyboard-only route/scene navigation, disclosure focus return, and reduced motion are mandatory gates.
- No `user-scalable=no`, paste blocking, `outline:none` without replacement, icon glyph substitute, or `transition:all` is allowed.

### 17. Replace the empty-space test with a geometry contract

The diagnostic uses explicit markers and evaluates document coordinates after fonts, images, Canvas, disclosures, and one-shot motion reach a stable final state.

Scene contract:

- Ordinary scene trailing space is `sceneBox.bottom - meaningfulContentBox.bottom` and MUST be `≤ min(120px, 20vh)` and `≤20%` of scene height.
- Opening, Closing, and a declared `ArtworkStage` are the only default `data-whitespace-intent` allowlist. Each allowlist entry records a reason and still fails if content clips or the empty region exceeds 45% of the scene.
- Ordinary scene computed `min-block-size`/`min-height` MUST be `0`, `auto`, or content-derived; viewport units and fixed values above 320px fail.
- Inter-scene distance MUST match the breakpoint token within ±8px and is measured from previous scene border box to next scene border box, not to an internal heading.

Grid-cell contract:

- Every `data-geometry-cell` reports content box, paint box, row box, child count, and declared `data-layout-mode` (`paired`, `asymmetric`, `stacked`, `full`).
- An allocated cell with no meaningful child, or meaningful painted area below 10% of its allocated area, fails as an empty column.
- A painted/background/bordered sibling whose box stretches more than 96px below its meaningful content fails as stretched content.
- `paired` cells require shorter/taller meaningful height ratio `≥0.75` or absolute delta `≤160px`. `asymmetric` cells require ratio `≥0.45` or delta `≤200px`; otherwise the fixture must select a stacked/full composition variant.
- A `6+6` layout additionally fails if either cell is empty/sparse or the evidence roles are not declared peers.

Navigator/anchor contract:

- After every scene and logical chapter jump, the target heading top MUST be at least `nav.bottom + 12px` and at most `nav.bottom + 120px`.
- At stable scroll positions, no focused element or heading may intersect the dock paint box.
- Opening/closing, expanded controls, sticky state, Narrow, and 200% zoom are included.
- Page-level `scrollWidth` MUST be no greater than `clientWidth`; labelled table scroll regions are evaluated separately.

Diagnostics output one JSON inventory per viewport with scene/cell rectangles, meaningful bounds, tail, occupancy, computed min-height/align-self, navigator rectangle, target offsets, and allowlist reason. They are necessary but not sufficient: screenshots still require human review.

### 18. Establish the visual acceptance loop

Every implementation batch performs, in order:

1. targeted unit/component/browser tests using synthetic fixtures;
2. screenshots at `1440×900`, `1180×760`, `760×900`, `380×900`, and 200% zoom;
3. DOM geometry diagnostics and page/table overflow checks;
4. human inspection of each image and the Annual sequence;
5. keyboard, focus, semantic control, contrast, chart-alternative, and reduced-motion review;
6. motion video/trace review for trigger-once, interruption, layout shift, replay, Canvas geometry, and cleanup;
7. long-task/observer/RAF cleanup and `mainThreadLayoutCalls=0` diagnostics;
8. regression tests, strict OpenSpec validation, and exact-path Git review.

Screenshot inventory is Home; Annual Opening, Scale, Rhythm, Balance, Conversation, Frequent Words, Keywords ready/sparse, Word Cloud, Closing; Detailed top/context/query, Overview, all other routes, methodology closed/open; and protected Share Preview smoke. Each report lists file/view/viewport, what was visually inspected, `PASS`/`NEEDS POLISH`/`FAIL`, and known debt. Any `FAIL`, accidental half-screen region, sticky occlusion, unreadable chart, broken crop/fallback, severe hierarchy repetition, or missing screenshot blocks the batch. Playwright assertions alone cannot mark visual acceptance complete.

Temporary screenshots and rejected generated candidates follow existing storage rules and are removed one explicit path at a time. No real-data screenshot can be copied, transcribed, tracked, or used for regression.

### 19. Preserve performance and cleanup budgets

- `mainThreadLayoutCalls=0` remains a hard structural gate for analytics and Word Cloud layout. All deterministic Word Cloud placement remains in its Worker.
- Scroll, scene observation, route navigation, and animation never request analytics, tokenization, report assembly, or layout.
- Scene/nav observers are bounded to mounted targets, reuse one observer where practical, disconnect after one-shot completion/unmount, and schedule no continuous polling.
- Transform/opacity are the default animated properties. Baseline growth uses compositor transforms; SVG path animation avoids layout reads/writes.
- The bounded Canvas reveal uses cached geometry, at most one RAF, ≤600ms, no interleaved DOM reads/writes, immediate cancellation, and no retained handle/Canvas duplicate after completion.
- Long-task diagnostics record tasks ≥50ms during Annual scroll/motion. One diagnostic sample is not a CI failure by itself, but repeated >100ms motion tasks or any user-visible freeze blocks acceptance.
- Existing bounded report/frequency/layout caches, candidate/visible word limits, PNG budgets, and Worker cancellation/stale suppression are unchanged.
- No new network, font, UI, chart, or animation dependency is planned. Bundle delta is measured each batch; unexpected dependency or >50KiB minified script growth requires review.

### 20. Freeze bounded implementation batches and model authority

| Batch | Model | Scope | Stop gate |
|---|---|---|---|
| V3.1 — Visual Foundation + Shell + Navigator | Luna Max | tokens, typography specimen, structural primitives, CSS layer scaffold, PageShell/Home shell seam, Annual content container, Progress Navigator, motion primitives, geometry diagnostics, remove only migrated structural hacks | screenshots/geometry/a11y/motion PASS; exact commit/push |
| V3.2 — Annual Core Storytelling | Luna Max | Opening, Scale, Rhythm, Balance, Conversation; scene-specific charts/composition/motion; optional Rhythm art only if accepted | all five scenes at fixed viewports and no visual `FAIL` |
| V3.3 — Vocabulary Showcase | Luna Max | Frequent, Keywords ready/sparse, full Word Cloud stage, control hierarchy, hidden manager/disclosures, Canvas motion, optional Vocabulary art | complete vocabulary semantic/geometry/privacy/motion regression |
| Mid-review | Sol xHigh | composition, motion, hierarchy, remaining Annual/Vocabulary debt only | written bounded findings; no Detailed work until accepted |
| V3.4 — Detailed Workspace | Luna Max | compact context/query/route navigation, Overview, eight routes, precise charts/tables, methodology | all routes, Draft/Apply/export semantics, fixed screenshots PASS |
| V3.5 — Cross-Product Polish + Final Visual QA | Luna Max | Home, global transitions, responsive, accessibility, performance, visual regression, package smoke; Share DOM only if separately justified | Sol High/xHigh final visual review |
| Final review | Sol High or Sol xHigh | responsive/accessibility/architecture plus full visual sequence | only bounded fix list proceeds |
| V3.6 — Final Targeted Fixes | Luna Max | only findings from final review; no reopened re-architecture | final source/package/synthetic/user-hand-off gate |

Sol xHigh owns V3 architecture/design-system freeze, mid-review, major motion/data-visualization authority changes, and final visual architecture review. Sol High owns medium-risk responsive/accessibility/authority review. Luna Max owns React/CSS/Canvas/SVG implementation, tests, screenshot iteration, packaging, and bounded bug fixes. Sol xHigh is not allocated to mechanical CSS work.

## Risks / Trade-offs

- [Organic Annual and Swiss Detailed can feel like separate products] → Reuse product naming, Owner/Other semantics, focus behavior, spacing scale, tabular numerals, Archive Current/ledger alignment, and transitions while keeping mode surfaces/type grammar distinct.
- [The darker sand Organic canvas reduces perceived air or small-text contrast] → V3.1 packages a real WebView typography/contrast specimen; adjust only within the frozen earth-tone family and never reintroduce untested cream/cold gray drift.
- [A thin navigator hides discoverability] → Show clear scene folio/progress and a labelled “范围与章节” trigger; test first-use keyboard and 200% zoom without restoring permanent form chrome.
- [Scroll-derived current scene chatters at boundaries] → Use a fixed reading line, intersection ratio tie-break, short stability debounce, and polite announcements only after a stable scene change.
- [Content-aware variants become ad hoc JS layout] → Variants depend only on existing availability/bounded row-count presentation fields and explicit component branches, never DOM measurement or new analytics.
- [Geometry thresholds overfit synthetic content] → Test short/normal/long synthetic fixtures, output diagnostics, retain human review, and change thresholds only through a reviewed OpenSpec correction.
- [Per-word Canvas reveal creates main-thread cost] → Bound to one ≤600ms RAF over cached geometry, cancel aggressively, draw final once for reduced motion/failure, and drop to whole-canvas CSS reveal if diagnostics miss budget.
- [CSS cleanup breaks protected B5 styles] → Keep B5 block untouched through V3.4, use versioned consumer migration, exact selector removal, and full B5 regression for any later extraction/change.
- [Generated art looks artificial or distracts from data] → Generate only named candidates, inspect in synthetic context, keep perimeter/negative-space constraints, and ship deterministic CSS fallback instead of mediocre art.
- [Distinct visualizations imply new meanings] → Visual Encoding Matrix, direct labels, exact alternatives, and DTO-only values are acceptance authority; any new aggregation or derived claim is rejected as out of scope.
- [Four responsive regimes increase CSS volume] → Keep one component authority and co-located variants; prefer declared grid spans/custom properties over duplicated selectors.

## Migration Plan

1. V3.1 establishes version-scoped tokens/primitives, packaged font/contrast evidence, the navigator, and geometry diagnostics while the old scene consumers remain available for rollback.
2. Migrate Annual consumers scene by scene in V3.2; capture/test/remove the superseded selectors for each accepted consumer before continuing.
3. Migrate Vocabulary and bounded Canvas presentation in V3.3, then stop for Sol xHigh visual review and freeze a bounded debt list.
4. After Annual/Vocabulary acceptance, migrate Detailed shell and routes in V3.4 without changing props, state, queries, or exports.
5. Run cross-product responsive/accessibility/performance/package review in V3.5; do not touch Share renderer authority unless a separate approved task exists.
6. Apply only final review findings in V3.6, produce the latest package, and hand real-data visual acceptance to the user without agent access to private data.

Rollback is per committed batch and per migrated consumer. Legacy selectors are removed only after the corresponding V3 consumer is accepted, so a failing scene can revert without undoing accepted analytics, word-cloud, share/export, or other visual batches.

## Open Questions

No product, analytics, privacy, export, or presentation architecture choice is delegated to implementation. Three evidence questions are explicit stop gates rather than open design authority:

1. Which frozen offline font-stack order renders Chinese, Latin, and numerals best in the target packaged WebView while meeting the stated metrics and contrast?
2. Does the bounded rank-by-rank Canvas reveal stay within the V3.3 long-task/cleanup budget, or must it degrade to one whole-canvas opacity/scale reveal with unchanged geometry?
3. Do the optional Rhythm/Vocabulary/Home generated-art candidates materially improve the accepted synthetic compositions? If not, the frozen CSS/SVG fallbacks ship and no asset is added.
