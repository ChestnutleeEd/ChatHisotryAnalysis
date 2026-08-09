## Context

### Repository baseline used by this design

Visual re-architecture planning was re-baselined on branch `feat/implement-local-chat-wordcloud-mvp` at full HEAD `78ab06ba1fdcd3d2a3283d42ba7a5201ea81cc4c` (`feat: refine beta annual recap visual experience`) with a clean workspace and upstream `0/0`. `data/private` is ignored by `.gitignore:4`; only `git check-ignore -v data/private` was run against that boundary. No private source, aggregate, screenshot content, filename, or path was read or used in an art prompt.

OpenSpec 1.6.0 reports this change artifact-complete with `57/79` tasks before this re-plan. B1a, B1b, B2, B3, B4, the annual-scope/Clean Mode hotfix, and the screenshot refinement are checked; B5 motion/share, B6 packaged acceptance, and deferred work remain unchecked. The new Visual Re-architecture and Design System v2 stage blocks B5 and B6 but is not a Release-hardening blocker.

### Existing architecture

- `frontend/src/main.tsx` selects `DesktopImportPanel` in Tauri and the browser-v1 `App` otherwise. The Beta desktop entry therefore belongs above `DesktopDashboard` inside `DesktopImportPanel`; it must not replace the browser-v1 route.
- `DesktopDashboard`, `DASHBOARD_ROUTES`, and `createDashboardViewModel` implement Overview, Trends, Comparison, Activity, Words & Years, Message Types, Replies & Sessions, and Export. Global date/sender filters, local year selection, and session-threshold changes publish new Worker queries while retaining the last complete result during pending work.
- `AnalysisWorkerRuntime` loads canonical v2 once, builds `CanonicalIndex` typed arrays and one token table, keeps up to eight `CanonicalAnalysisResult` entries by `canonicalQueryKey`, and suppresses stale operations through operation/generation/sequence checks. `DesktopImportPanel.startDesktopAnalytics` and `updateAnalyticsFilters` additionally verify session, generation, dataset, capability, committed result ID, and attempt identity before publication.
- `CanonicalAnalysisResult` already carries aggregates, daily/monthly/yearly trends, sender comparison, fixed hour/weekday buckets, chat days/streaks, average eligible-text code-point length, message categories, reply/session metrics, top-20 cross-year vocabulary, yearly keyword evidence, and traceable fixed summaries.
- `deriveStage7Metrics` confirms yearly keywords use candidate count ≥5, message DF ≥3, smoothed year-vs-rest log-odds, positive-score filtering, and score/count/Unicode ordering. One represented year uses frequency fallback. The engineering DTO includes count, year/rest totals, message DF, and score; those remain methodology data, not annual-report hero copy.
- `tokenizeNormalizedContent` already performs NFKC, lowercase, URL removal, punctuation/symbol/emoji separation, numeric-only exclusion, local stopword matching, and a default two-code-point minimum. It does not do stemming, lemmatization, reliable email/path-origin recognition, or name recognition.
- The desktop `Words & Years` page is a bar/table/trace view, not a word cloud. `createWordCloudChart` uses Canvas ECharts/`echarts-wordcloud` only in browser v1 and does not expose a stable layout seed. It can remain for browser compatibility but cannot satisfy the Beta deterministic contract.
- `buildRendererAggregateInput`, Rust `ResultRegistry`, `PrivacySafeExportSnapshot`, `export_aggregate`, and `save_to_destination` form the export authority: the renderer supplies a closed bounded numeric DTO, Rust owns definitions, native destination selection, validation, and atomic save. Current PNGs are host-rendered 800×450 logical / 2× pixel output and support seven approved aggregate charts; rich Chinese annual cards need a compatible new bounded PNG-save contract.
- Tauri has one local `main` window, restrictive CSP, denied navigation/new windows, no declared capability permissions, no network/update/telemetry surface, and host-owned IPC commands. Beta work in React and Workers needs no new general authority.
- `src/chat_history_analysis/canonical_dataset.py`, `src-tauri/src/dataset_handoff.rs`, and the v2 schema preserve deterministic merge/sort/dedupe, cross-language manifest/chunk/hash/count/order/timezone/publication checks, and `.canonical-dataset-complete-v2`. The annual report consumes the accepted Worker result only and never invokes source parsing.

Stakeholders are ordinary users seeking a readable local annual recap, advanced users retaining detailed analytics, implementation agents working in bounded Luna Max batches, and reviewers protecting privacy/data correctness.

### Packaged Beta visual findings that v2 must correct

The current production presentation is implemented through `BetaAnnualReport`, `BetaCoreReportSections`, `BetaWordEvidenceSections`, `BetaWordCloud`, `BetaHome`, `BetaModeNavigation`, `primitives.tsx`, `DesktopDashboard`, and 4,636 lines of global `styles.css`. `BaseCard` turns every variant into an `article`; rhythm/comparison scenes use equal-width grids; `BetaCoreReportSections` routes nearly every visual through the same horizontal bar grammar; and later B2/refinement/B1b CSS layers override earlier B1a tokens in place. Detailed Overview renders eight KPI cards whose definition copy competes with the value, while Annual opening and closing have no image asset or poster composition.

Manual packaged Beta acceptance describes the result as visually unattractive, misaligned, card-dependent, and too similar to a styled data Dashboard. The root problem is system composition rather than one color or radius: unstable grid spans, too many simultaneous hierarchy levels, excessive serif display, uniform chart grammar, multiple navigation layers, visually similar vocabulary modes, weak scene transitions, and no memorable artwork. V2 corrects these presentation roots while preserving every accepted product/data contract.

## Goals / Non-Goals

**Goals:**

- Freeze one implementable Beta information architecture, report flow, narrative, metric semantics, presentation contract, word-cloud pipeline, visual/motion system, accessibility contract, export boundary, performance budget, and staged implementation plan.
- Reuse accepted Alpha infrastructure and preserve every detailed Dashboard route, filter, metric, query, recovery path, and export.
- Keep canonical data and tokenization in the Worker boundary, keep report assembly out of React render, and keep file destinations in Rust authority.
- Make frequent words, distinctive yearly keywords, sample insufficiency, partial calendar scope, sender-filter exceptions, timezone, and session-threshold effects understandable without relational or psychological claims.
- Produce a deterministic, responsive, local word cloud plus equivalent accessible list and fixed-size exports.
- Keep the completed B1a–B4 functionality as a protected baseline and make each V1–V3 presentation batch small enough for focused screenshot review and rollback.
- Replace the rejected first visual pass with one coherent Design System v2, seven-scene Annual composition, generated-art asset strategy, modern Detailed workspace, fixed responsive rules, and screenshot-based human acceptance before B5/B6.

**Non-Goals:**

- Any proposal non-goal, Release hardening, D.1–D.10, private-data authorization gate, or change to the Alpha task checkboxes.
- A new source reader, main-thread tokenizer/statistics path, full canonical dataset in React state, cloud service, AI-generated narrative, or context playback from tokens.
- Replacing the existing Dashboard with a story page or forcing engineering trace fields into the annual report.
- Dark-mode implementation in the first Beta; only semantic token names and contrast-ready pairs are reserved.
- Possible-name filtering, accurate person-name detection, automatic contact naming, English stemming/lemmatization, or hiding all uppercase abbreviations in first Beta.
- Chapter PNG and long/multipage export as first-Beta blockers.
- Any production React/CSS/asset edit, image generation, commit, or push in the Sol xHigh visual-planning batch.

## Decisions

### 1. Reuse Alpha as a protected substrate

| Existing capability | Beta treatment | Concrete seam |
|---|---|---|
| Tauri 2 single-window macOS arm64 app, packaged PyInstaller `onedir`, bundle-relative runtime, ad-hoc `.app`, prototype `.dmg` | Reuse unchanged | `src-tauri/src/lib.rs`, `src-tauri/tauri*.conf.json`, build/package scripts |
| Detailed JSON selection, one/multiple annual sources, validation/merge/sort/dedupe, canonical v2 and publication marker | Reuse unchanged; report never reads sources | `DesktopImportPanel`, Python canonical pipeline, `dataset_handoff.rs` |
| Typed canonical indexes and one-time Worker tokenization | Reuse; add bounded token quality/ranking metadata only | `CanonicalIndex`, `AnalysisWorkerRuntime.loadDataset` |
| Aggregate/activity/stage7/reply-session result | Reuse stable fields; extend result compatibly under versioned Beta DTO | `CanonicalAnalysisResult` and metric modules |
| Query generation, cancellation, result cache, stale suppression | Reuse and compose into report/layout keys | `canonicalQueryKey`, `AnalysisWorkerRuntime`, `AnalysisWorkerClient`, `DesktopImportPanel` |
| Dashboard pages, filters, states, accessibility and current exports | Preserve as `detailed` mode without route/metric removal | `DesktopDashboard`, `desktop-dashboard.ts` |
| Browser-v1 ECharts word cloud | Preserve browser behavior; do not reuse layout for Beta | `App.tsx`, `word-cloud-chart.ts` |
| Native save authority | Extend with one closed presentation-PNG command; do not grant renderer paths | `export.rs`, `export_schema.rs`, `ipc.rs` |

No canonical schema, preprocessor, sidecar, dataset transport, permissions, release signing, or packaging trust behavior is to change for Beta unless a later Sol High correction explicitly reopens that boundary.

### 2. Product information architecture and state

The accepted post-analysis product hierarchy is:

```text
Post-analysis Home
├── Annual Recap
│   ├── represented-year selector
│   ├── multi-year overview
│   ├── story chapters
│   ├── word cloud and accessible list
│   └── summary/word-cloud PNG export
└── Detailed Analysis
    └── existing eight Dashboard routes unchanged
```

After analysis succeeds, the app enters **Home**, not directly into either analytical mode. Home uses the committed aggregate result, shows no fabricated claim, and offers primary CTA “查看年度聊天报告” plus secondary “进入详细分析”. A single represented year goes directly from the CTA into that year; multiple represented years default to the latest represented year and expose “多年度总览”; no represented user messages yields an annual-report empty state while Detailed Analysis remains available.

The product does not infer that a natural year was fully exported. It defines:

- **represented year**: a year with at least one post-dedup user message in the committed dataset/query;
- **full-calendar query scope**: the active inclusive query contains January 1 through December 31 for that year;
- **partial-calendar query scope**: either bound clips that year;
- **latest full-calendar-scope year**: the greatest represented year whose full calendar lies inside the active query bounds; this is a scope label, never a source-completeness claim;
- **default year**: latest full-calendar-scope year when one exists, otherwise latest represented year with an explicit “当前数据范围仅覆盖部分年份” label.

Annual selection values are `year:<YYYY>`, `all-years`, and `multi-year-overview`. Selecting a year submits inclusive bounds `max(base.startDate, YYYY-01-01)` through `min(base.endDate, YYYY-12-31)` and `selectedYear=YYYY`; an empty intersection is disabled and announced. `all-years` creates a continuous report over the current base range and omits year-specific claims that require a comparator. `multi-year-overview` uses existing yearly/monthly/token evidence and excludes partial endpoints from year-over-year claims.

One committed `AppliedAnalysisQuery` is shared by report and Dashboard for effective date bounds, sender, timezone, selected year, and session threshold. The report controller additionally keeps an in-memory `reportBaseRange`: the last committed date range established by initial analysis, explicit global filter Apply, all-years selection, or restore-full-range—not the temporary year intersection. Applying a report year computes its effective bounds from `reportBaseRange`, commits those bounds plus `selectedYear`, and leaves `reportBaseRange` unchanged; switching directly from 2024 to 2025 therefore never intersects 2025 with the already narrowed 2024 result. `all-years`/`multi-year-overview` use `reportBaseRange`; the former commits it with `selectedYear=null`, while the latter is presentation-only over matching committed evidence. Returning to Detailed Analysis shows the same effective committed scope. “恢复全部数据范围” replaces `reportBaseRange` and committed bounds with dataset min/max and clears `selectedYear`. Editing a date, sender, threshold, or year remains draft until the existing explicit Apply action succeeds. Mode switching does not reset committed query state or reload sources.

The final state taxonomy is deliberately additive to the current architecture rather than a new store:

1. **Dataset/session state** — selection/session/dataset/generation/result identities, accepted dataset bounds, lifecycle, cancellation, and recovery. This remains owned by `DesktopImportPanel`, the Analytics Worker client, and host authority.
2. **Committed analytics query state** — applied inclusive dates, sender, fixed timezone, applied `selectedYear`, and session threshold. These fields and only analytics-affecting contract/version fields belong in `canonicalQueryKey`; draft controls never do.
3. **Presentation/report state** — `reportBaseRange`, annual/all-years/multi-year mode, validated semantic report facts, word role, raw/per-10k display mode, custom-hidden preference hash, locale formatter version, and current complete/pending report view-model. `reportBaseRange` is controller input for the next committed year query but is not itself added to `canonicalQueryKey`; the effective committed dates already carry the analytical scope. Word role belongs only to the scoped frequency key; raw/per-10k and custom hiding reuse the same numeric DTO and belong only to presentation/layout keys.
4. **Navigation state** — Home/Annual Recap/Detailed Analysis mode, current Dashboard route, current logical report chapter/visual scene, and restorable scroll position. It is keyed in memory by current dataset/generation and MUST NOT enter analytics, report-fact, frequency, or layout identities.
5. **Local preference state** — bounded custom-hidden words and accessibility/platform preferences. It contains no dataset/result identity. Temporary export aliases are transient preview state and are not persisted by default.

Reload/startup recovery returns to Home with the recovered committed result when available; otherwise it returns to the existing selection/recovery flow. Because `reportBaseRange` is intentionally not persisted, recovery reconstructs it from committed dates when `selectedYear=null`, or from dataset min/max when the recovered result is year-narrowed, and visibly labels that safe default before another year/all-years commit. Persistent storage never stores dataset IDs, tokens from a dataset, query keys, report DTOs, routes, chapters, or scroll positions. Dataset or generation replacement resets report/navigation state and fences every stale result.

Comparative sender share, reply intervals, and session initiators continue to ignore the global sender filter exactly as current DTOs declare. Annual chapters show a “双方比较固定包含 owner 与 other” note. Session threshold is one shared applied value, defaults to six hours, survives mode changes, and invalidates only threshold-sensitive report/result cache entries.

### 3. Fixed report narrative

The annual mode uses an ordinary continuous vertical flow with a sticky compact report navigation; it does not use mandatory scroll snap. The fixed order below defines **sixteen logical content sections**, not sixteen mandatory full-screen cards. Adjacent sections may share one responsive visual scene while retaining their heading anchors, semantics, empty states, and order. For example, Peak Weekday + Peak Hour may form one “Activity Rhythm” scene, and Active Days + Longest Streak may share one activity scene.

| # | Chapter / user question | Main metric and one-sentence conclusion | Support visual / source | Empty or insufficient behavior | Filter / export / multi-year |
|---|---|---|---|---|---|
| 1 | Opening — “这是哪段时间的回顾？” | Year/scope label; “这是你选择的 YYYY 年本地聊天回顾。” | Metadata, timezone and privacy badge / report metadata | No user messages: explain scope and offer reselect/detail | All filters; summary export; yes as overview opener |
| 2 | Messages — “这一年聊了多少？” | post-dedup user-message count; factual count only | count-up KPI plus restrained comparison bar / `aggregate.userMessageCount` | zero is explicit, never omitted | date/sender; summary export; yes |
| 3 | Active days — “有多少天聊过？” | total chat days; “这一范围内有 N 个聊天日。” | calendar-density summary / `chatActivity.totalChatDays` | zero state | date/sender; chapter later, summary; yes |
| 4 | Longest streak — “最长连续聊了多久？” | longest consecutive active days | start/end chips for canonical tied intervals / `longestStreaks` | no active day state | date/sender; summary; compare length only for full-calendar scopes |
| 5 | Peak month — “哪个月最活跃？” | maximum monthly user-message bucket; fixed-order tie list | 12-bar monthly strip / `trends.monthly` | all zero → no peak; partial bucket marked | date/sender; chapter later; yes, excluding partial YoY claims |
| 6 | Peak weekday — “通常星期几更常聊？” | maximum weekday bucket, ties retained | seven bars + counts / `weekdayActivity` | zero denominator | date/sender; chapter later; yes |
| 7 | Peak hour — “一天中什么时候更常聊天？” | max fixed hour bucket, described as UTC+08:00 hour, not lifestyle | 24-cell clock strip / `hourActivity` | zero denominator | date/sender; chapter later; yes |
| 8 | Sender share — “双方各发了多少？” | owner/other counts and shares | two-segment bar plus counts / `senderComparison` | null denominator | date only; sender filter exception; summary; yes |
| 9 | Message length — “文字消息通常有多长？” | mean eligible cleaned Unicode code points, with median as context | two role cards / `stage7.averageLength` | count zero → insufficient | date/sender; chapter later; yes |
| 10 | Message types — “除了文字，还发了什么？” | stable category distribution | ranked bars/icons plus text table / `stage7.messageTypes` | zero user messages | date/sender; chapter later; yes |
| 11 | Sessions — “一次聊天如何开始？” | session count and initiator shares at active threshold | threshold chip + two/unknown counts / `conversationSessions` | zero sessions | date; sender exception; threshold-sensitive; chapter later; yes |
| 12 | Replies — “回复间隔通常多久？” | median latency by responder; “可判定回复区间的中位数是 …” | direction cards and sample counts / `replyIntervals` | count zero or too few → insufficient, not `0` | date; sender exception; threshold-sensitive; chapter later; multi-year only when same threshold |
| 13 | Frequent words — “今年最常提到什么？” | scoped ranked eligible tokens by raw count or per-10k rate | top list / Beta token-frequency DTO | zero denominator or fewer than minimum terms | date/sender/word policy; word-cloud export companion; yes |
| 14 | Distinctive keywords — “哪些词更能代表这一年？” | positive smoothed year-vs-rest log-odds candidates | ranked keyword cards / existing yearly keyword DTO | one year: label frequency fallback; no candidate: insufficient | date/sender; chapter later; only annual, not all-years hero |
| 15 | Word cloud — “这些词放在一起是什么样？” | same ranked DTO and selected raw/normalized weight | deterministic Canvas plus accessible ordered list / layout Worker | progressively fewer terms; final list-only fallback | date/sender/word policy; word-cloud PNG; overview may use small preview |
| 16 | Summary and share — “如何带走这份回顾？” | fixed template clauses selected from validated report DTO | summary card preview and privacy checklist | omit unsupported clause with reason | all applied context; summary PNG; yes |

All tie choices use the underlying canonical ordering. A pure semantic adapter selects facts, reasons, and template IDs; a separate local `zh-CN` presenter applies allow-listed templates before React render. React components receive ready-to-render labels and states; they do not calculate maxima, ratios, thresholds, or prose during render. Engineering fields such as year/rest totals, message DF, internal IDs, raw log-odds score, trace maps, query keys, and generation are available only in a concise “指标说明” drawer or Detailed Analysis, never in hero visuals.

Scene composition is responsive and content-driven. The implementation may use fewer visual scenes than logical sections and must not create empty full-screen panels merely to preserve a count. No metric or accessible heading is removed by grouping.

### 4. Metric support decisions

`Current support` is one of the mandated planning classifications.

| Metric | Current support | Data source / decision |
|---|---|---|
| Total messages | `REUSE_AS_IS` | `aggregate.userMessageCount`, post-dedup user messages |
| Owner messages | `REUSE_AS_IS` | `aggregate.senderCounts.owner` |
| Other messages | `REUSE_AS_IS` | `aggregate.senderCounts.other` |
| Active days | `REUSE_AS_IS` | `chatActivity.totalChatDays` |
| Longest consecutive active days | `REUSE_AS_IS` | `longestStreakLength/longestStreaks` |
| Most active month | `PRESENTATION_ONLY` | max/ties from monthly buckets; partial label retained |
| Most active weekday | `PRESENTATION_ONLY` | max/ties from fixed weekday buckets |
| Most active hour | `PRESENTATION_ONLY` | max/ties from fixed UTC+08:00 hour buckets |
| Average daily messages | `PRESENTATION_ONLY` | selected user messages divided by inclusive calendar-day count, including zero days; never “active-day average” |
| Average message length | `REUSE_AS_IS` | mean cleaned eligible-text Unicode code points; median shown as context |
| Message-type distribution | `REUSE_AS_IS` | stable Stage 7 categories, user-message denominator |
| Session count | `REUSE_AS_IS` | current threshold-sensitive session count |
| Session initiator ratio | `REUSE_AS_IS` | owner/other/unknown initiator counts/shares, both-sender exception |
| “Reply speed” copy | `PRESENTATION_ONLY` | user label for reply-interval distributions; never relationship meaning |
| Median reply latency | `REUSE_AS_IS` | direction medians and counts in seconds |
| Frequent words for selected year/query | `WORKER_DTO_EXTENSION` | current top-20 vocabulary is cross-year, not a complete per-scope ranking |
| Distinctive yearly keywords | `PRESENTATION_ONLY` | existing smoothed year-vs-rest log-odds DTO, with hidden trace fields |
| Raw eligible token count | `REUSE_AS_IS` | aggregate/year token denominators |
| Per-10,000 eligible tokens for arbitrary ranked words | `WORKER_DTO_EXTENSION` | extend beyond current fixed cross-year top-20 cells |
| Multi-year message/token trend | `REUSE_AS_IS` | yearly trend and word-evolution buckets |
| Year-over-year change | `PRESENTATION_ONLY` | adjacent full-calendar-scope buckets only; zero prior denominator yields unavailable |
| Filtered metrics | `REUSE_AS_IS` | existing inclusive date/sender query; documented exceptions remain |
| Session-threshold impact | `PRESENTATION_ONLY` | existing recomputation and sensitivity flag; report adds explanation |
| Possible-name or people/contact filtering | `DEFER_FROM_BETA` | surname-shape heuristics add false-positive UX and preference/allowlist scope without improving the core recap or cloud; revisit as a later Beta enhancement, while any identity/NER work requires a separate privacy review |

Frequent words mean “eligible tokens appearing most often in the current year/query scope.” Distinctive yearly keywords mean “eligible tokens relatively more characteristic of the selected year than the other represented years.” UI labels are respectively “今年最常提到” and “最能代表这一年的词”. A short methodology drawer gives token eligibility, raw/per-10k denominator, keyword comparison method, thresholds, partial/fallback state, UTC+08:00, and filter exceptions without exposing full trace tables.

### 5. Versioned report and presentation contracts

The following is the implementation draft, not production code:

```ts
type ReportMode = "annual" | "all-years" | "multi-year-overview";
type WordRole = "both" | "owner" | "other";
type WordMetric = "raw-count" | "per-10000-eligible-tokens";

interface BetaReportQueryV1 {
  schemaVersion: "chat-history-analysis.beta-report-query.v1";
  datasetId: DatasetId;
  generation: Generation;
  baseQueryKey: string;
  mode: ReportMode;
  year: number | null;
}

interface BetaReportDtoV1 {
  schemaVersion: "chat-history-analysis.beta-report.v1";
  identity: { datasetId: DatasetId; generation: Generation; reportQueryKey: string };
  metadata: { mode: ReportMode; year: number | null; scope: "full-calendar-query" | "partial-calendar-query" | "multi-year"; timezone: "UTC+08:00"; representedYears: readonly number[] };
  facts: CoreReportFactsV1;
  sections: readonly SemanticReportSectionV1[]; // facts, value models, template IDs, reasons; no locale prose
  wordEvidence: { status: "not-requested" | "ready" | "empty"; frequencyDtoKey: string | null };
  methodology: readonly MethodologyFactV1[];
  privacy: { localOnly: true; containsMessageBodies: false; containsContactIdentity: false };
  export: ReportExportMetadataDto;
}

interface BetaReportViewModelV1 {
  locale: "zh-CN";
  reportQueryKey: string;
  customFilteringActive: boolean;
  sections: readonly LocalizedReportSectionV1[]; // final labels/sentences produced before React render
}
```

The report DTO is locale-neutral: it contains validated semantic facts, formatted numeric/unit value models, reason codes, and allow-listed template IDs, but no assembled Chinese narrative, canonical events, content, source name/path, participant/contact name, session/dataset internal ID in visible fields, raw trace, arbitrary HTML, or arbitrary format string. Dataset/query identities stay in the non-rendered envelope for correlation and are stripped before export rendering. `frontend/src/presentation/beta/locales/zh-CN.ts` is a small fixed presenter, not a general i18n framework; it converts a validated DTO to the localized view-model before React render and leaves an explicit seam for a future locale.

Responsibility is fixed:

- **Analytics Worker** validates the applicable analytics/frequency query against the accepted canonical index; performs counts, denominator math, scoped token ranking, bounded quality evidence, and versioned methodology; never emits bodies or locale prose.
- **Presentation adapter** validates `CanonicalAnalysisResult` plus an optional matching Beta token DTO, selects peaks/ties, derives semantic report facts/value models/labels, assigns empty/insufficient reasons and allow-listed template IDs, and never assembles locale sentences.
- **Locale presenter** applies only fixed `zh-CN` templates to validated semantic fields and emits a ready-to-render `BetaReportViewModelV1`; Beta does not add a translation runtime or remote locale assets.
- **Layout Worker** consumes only bounded presentation words and geometry policy and returns coordinates; it does no analytics, tokenization, or prose.
- **React** passively renders the localized view-model and owns navigation, controls, focus, announcements, Canvas lifecycle, list/table alternatives, and state transitions; component render functions do not select templates or concatenate business sentences.
- **Export renderer** consumes a privacy-stripped export view-model and fixed canvas spec, draws locally, and returns encoded PNG bytes to the bounded host save contract.
- **Rust host** validates committed result/generation, PNG structure/dimensions/byte bound and closed metadata; presents the native save panel and atomically saves.

### 6. Cache, generation, cancellation, and stale suppression

The base `canonicalQueryKey` and eight-entry result cache remain authoritative for analytics. Beta adds:

```text
reportQueryKey = stable-json(
  beta-report-query.v1, datasetId, generation, baseQueryKey, mode, year
)

frequencyDtoKey = stable-json(
  word-frequency-dto-version, datasetId, generation, baseQueryKey,
  wordRole, vocabularyPolicyVersion, builtInPolicyHash
)

wordPresentationKey = stable-json(
  frequencyDtoKey, wordMetric, customHiddenWordsHash, localePresenterVersion,
  boundedVisibleLimit
)

layoutKey = stable-json(
  wordPresentationDigest, layoutVersion, viewportBucketOrExportCanvas,
  syntheticMetricsVersion, maxWords
)
```

The presentation adapter keeps at most eight core report DTOs per accepted dataset. The scoped frequency cache reuses the existing eight-entry Worker result discipline, and the layout cache keeps at most six coordinate results; none contains body text. All are discarded on dataset replacement, generation change, Worker disposal, or application close. A custom hidden-word change invalidates only word-presentation/layout/report-view composition, not `canonicalQueryKey` or `frequencyDtoKey`; it does not message the Analytics Worker, reread sources, retokenize, change counts, or change the eligible-token denominator. A session-threshold change reuses the existing canonical index and invalidates threshold-sensitive analytics/report facts. A resize inside one viewport bucket scales the same coordinate system; a bucket transition requests a new layout but not new analytics. Export always uses its fixed canvas key independent of window size.

Every asynchronous analytics/frequency/report/layout request carries dataset, generation, the applicable committed key, and a monotonically increasing request ID. Publication requires every applicable identity to match current committed state. New committed year/filter/threshold requests cancel or supersede analytics/report work; word-role or built-in-policy changes supersede frequency work; custom-hidden/metric changes are synchronous bounded presentation recomposition; viewport-bucket changes supersede layout only. Navigation, route, chapter, scroll, draft filters, and reduced-motion state never participate in these keys. During refresh the previous complete report remains readable, controls indicate pending, and export is disabled until the new committed identity arrives.

### 7. Word-frequency DTO and vocabulary policy

Worker output, presentation input, layout input/output, and export input remain distinct:

```ts
interface WorkerWordFrequencyDtoV1 {
  schemaVersion: "chat-history-analysis.word-frequency.v1";
  identity: { datasetId: DatasetId; generation: Generation; baseQueryKey: string; frequencyDtoKey: string };
  scope: { timezone: "UTC+08:00"; year: number | null; role: WordRole };
  denominator: { eligibleTokenCount: number; definition: "eligible-token-after-built-in-policy.v1" };
  policy: { version: "beta-vocabulary-policy.v1"; builtInPolicyHash: string };
  items: readonly {
    normalizedToken: string;
    count: number;
    ratePer10000: number;
    rank: number;
    category: "han" | "latin" | "mixed" | "other";
    qualityFlags: readonly ("uncertain-fragment")[];
  }[];
}

interface WordCloudPresentationItemV1 {
  displayToken: string;
  normalizedToken: string;
  count: number;
  ratePer10000: number;
  sourceRank: number;
  displayRank: number;
  weight: number; // clamped log/sqrt display scale, never a new statistic
  category: "han" | "latin" | "mixed" | "other";
}

interface WordCloudLayoutInputV1 {
  layoutVersion: "beta-wordcloud-layout.v1";
  width: number;
  height: number;
  padding: number;
  maxAttemptsPerWord: 4096;
  words: readonly { displayToken: string; rank: number; weight: number; category: string }[];
}

interface WordCloudLayoutOutputV1 {
  layoutVersion: "beta-wordcloud-layout.v1";
  width: number;
  height: number;
  placed: readonly { rank: number; x: number; y: number; width: number; height: number; fontSize: number; rotation: 0 }[];
  omittedRanks: readonly number[];
  degraded: boolean;
}
```

The envelope owns every field constant across words: dataset/generation/query correlation, timezone, year, role, denominator, and policy identity. Per-entry fields are only normalized token, count, rate, analytical rank, script category, and bounded non-hidden quality flags. The Worker does not duplicate year/role/timezone/policy/identity/denominator per item and does not send both an original token and an equivalent normalized token. `displayToken` and contiguous `displayRank` are presentation fields derived after local hiding. The Worker returns at most 400 eligible candidates (four times the largest first-Beta visible limit); a user who hides enough terms to exhaust that bounded pool sees fewer terms with an explanation rather than an unbounded request. Export input is the placed output plus stripped labels/metric metadata; it excludes dataset/query IDs and hidden terms.

Default `beta-vocabulary-policy.v1` is an **analysis eligibility policy**. It preserves current NFKC/lowercase/Jieba/fixed-stopword behavior, URL removal, punctuation/symbol/emoji separation, pure-number exclusion, and minimum two code points; it additionally excludes invisible/control tokens, tokens longer than 32 code points, a small versioned exact-extension denylist, and invalid mixed-script fragments. These built-in exclusions define the eligible-token denominator and therefore participate in `frequencyDtoKey`. They are applied by re-filtering the retained Worker token index, never by rereading or retokenizing source content. Emoji remain excluded from the cloud in v1. English inflection is not stemmed or lemmatized because that would merge meanings. Email/path origin cannot be reconstructed reliably from normalized tokens; the policy uses conservative token-shape rules and discloses the limitation.

Custom hidden words are a **display candidate preference**, scoped per application profile and stored as bounded normalized tokens in versioned renderer `localStorage`; they are never logged/exported/uploaded. Add, remove, newline/comma bulk paste, visible review, restore, and reset-to-empty are required. The presentation adapter filters the bounded eligible candidate pool used by Frequent Words, Distinctive Keywords, the cloud, its accessible list, and their exports, then derives contiguous display ranks. It never changes counts, rates, the eligible-token denominator, `canonicalQueryKey`, `frequencyDtoKey`, existing Detailed Analysis metrics, or Worker state. `customHiddenWordsHash` participates only in `wordPresentationKey` and downstream layout/export identity. Export metadata says only “自定义过滤：开启/关闭”, never lists words.

`beta-vocabulary-clean-presentation.v1` is a third, separate boundary: a conservative, versioned presentation lexicon for common Chinese connectors/general discourse and English function/discourse words. It defaults on, is independently toggleable and locally persisted, never uses casing/CamelCase/name/project heuristics, and never enters analysis eligibility or the eligible-token denominator. The presentation pipeline is fixed as analytical candidates → Clean Mode → custom hidden → bounded consumer limit → contiguous display rank. It scans beyond filtered leading candidates rather than filtering an already-truncated UI Top-N. Frequent Words and the cloud refill from the up-to-400 frequency pool; Keywords use a smaller UI target and refill from the unchanged Stage 7 analytical candidate order. Clean state enters word-presentation/layout identity only; `frequencyDtoKey`, `canonicalQueryKey`, Stage 7 scores/ranks, counts, rates, and denominators are unchanged.

For annual scope publication, `reportState.selection` is not published optimistically. The prior committed selector and evidence remain correlated while analytics refreshes. After the matching canonical result commits, report facts and selector publish together; stale frequency evidence is withheld until its base query/year/role matches, which also cancels/suppresses the old cloud presentation/layout. Multi-year Overview selected from a concrete annual scope first commits `reportBaseRange` with `selectedYear=null`; all-years does the same. All-years Distinctive Keywords is explicitly unavailable rather than borrowing Stage 7's latest represented year.

Possible-name filtering is deferred from first Beta. A 2–4 Han surname-shape heuristic would add false-positive warnings, review/allowlist state, policy identity, and tests while providing less value than shipping the actual cloud. A later Beta enhancement may reconsider an off-by-default, presentation-only heuristic; it must still avoid contacts, context, identity claims, denominator changes, and analytical-cache changes. NER or identity-aware work requires a separate privacy/data-contract change.

Uppercase/work abbreviations are **retained by default**; because case is normalized, Beta does not classify all-caps tokens. Users may hide specific abbreviations via custom hidden words. This avoids deleting meaningful project language.

### 8. Deterministic word-cloud layout and rendering

Beta uses a dedicated module Worker, not `echarts-wordcloud`, for layout. Equal ordered presentation words, viewport bucket/fixed export canvas, synthetic-metrics version, word limit, and layout version produce byte-equal coordinates and omitted ranks. Dataset identity is used for stale fencing but does not perturb geometry when the visible word input is otherwise identical.

No seed or PRNG is needed in v1. Input sorting is weight descending, raw count descending, then Unicode code-point token order; placement always starts at the exact canvas center with one fixed phase, follows a fixed integer Archimedean spiral, and uses zero rotation. Palette selection is a fixed rank/category mapping. Removing SHA-256/xorshift avoids implying that seeded randomness alone guarantees determinism.

Layout uses **deterministic synthetic metrics**: versioned Han/Latin/mixed advance coefficients, line-height coefficient, padding, and safety margin produce axis-aligned collision rectangles in a deterministic 16-pixel spatial hash grid. Each word gets at most 4,096 attempts. The Canvas renderer may call `measureText` only to shrink a glyph run until it fits its assigned safety rectangle; it must never expand a box, move coordinates, or use measured values in Worker layout/cache identity. No call to `Math.random`, current time, locale collation, DOM layout, or network font is permitted.

Failure removes the lowest-ranked unplaced/placed word and retries from the same fixed initial state until success or the minimum visible count. If 20 words cannot fit, Canvas shows the successfully placed subset and the same bounded accessible ranked list; if zero words fit, it falls back to the list and compact bars. Errors never alter analytics.

Screen buckets and limits are:

| Mode | Logical canvas | Default / maximum terms | Minimum frequency |
|---|---:|---:|---:|
| narrow `<640px` content | 480×520 | 40 / 50 | 2 |
| standard `640–959px` | 760×560 | 60 / 80 | 2 |
| wide `≥960px` | 960×620 | 80 / 100 | 2 |
| export | 1200×1500 final pixels | 100 / 100 | 2 |

The minimum usable cloud is 20 terms; fewer available terms render all available terms and an explanation. Tokens over 32 code points are excluded. Within a bucket, resize scales coordinates and Canvas backing resolution; crossing buckets re-layouts in the Worker. Export has one unambiguous fixed output size: **1200×1500 PNG pixels**. Preview CSS size and screen device-pixel ratio do not participate in the export contract.

Canvas is chosen for screen and export performance and bounded hit testing. SVG is not used for the cloud because hundreds of text nodes increase WebView/layout variability; ordinary React/SVG/CSS may still render small charts. The Canvas is `aria-hidden`; one adjacent semantic ordered list represents exactly the bounded words selected for the cloud (including any layout-omitted ranks), at most 100 on screen. It exposes rank, token, count, per-10k rate, role, year, and a visible bar/number; no hidden DOM node is created per Canvas glyph. Hover/focus may correlate a list row and Canvas item, but word clicks never reveal source text.

The determinism contract is intentionally split: geometry/order/omitted ranks are byte-equal for equal v1 inputs across supported JS runtimes because they use synthetic metrics and integer policy; rendered glyph pixels are required to match only within the same packaged application, supported macOS platform/font availability, and version. Cross-macOS/WebView pixel identity is not a Beta promise. Canvas fit-down plus safety margins protect collision/bounds when system glyph metrics vary.

### 9. Design System v2 and deep visual re-architecture

Design System v2 supersedes the rejected B1a/B2/B1b visual decisions while preserving all data and interaction semantics. The product direction is **“Private Data Atelier”**: Annual Recap is consumer editorial storytelling—premium, calm, cinematic, neutral, and memorable—while Detailed Analysis is a precise modern data workspace. Both use the same semantic tokens and interaction primitives; Annual uses larger composition, sparse serif headlines, and artwork, while Detailed uses compact all-sans information density. The signature move is a quiet “data current”: a recurring abstract field of dots, lines, cut-paper planes, and negative space that begins in the opening artwork, appears only at major scene transitions, frames vocabulary, and resolves in the closing poster.

Rejected directions remain enterprise BI, finance-terminal density, neon AI, cyber-security iconography, glassmorphism, gratuitous 3D, cartoons, children’s illustration, fake screenshots, fake avatars, romantic/personality imagery, and imagery in every metric card. Generated art is editorial structure, never generated content.

#### 9.1 Root visual diagnosis

| Area | Root cause | V2 correction |
|---|---|---|
| Layout | Equal `repeat(3, 1fr)` grids, auto-fit helpers, arbitrary spans, and long Chinese headings in narrow cards create unstable weight and dead space. | Explicit 12/8/4-column grids and named spans per scene/component; content controls height. |
| Hierarchy | Eyebrow, serif heading, lead, metric, definition, chart, status, and disclosure often compete at similar scale. | One dominant element per scene; methodology and secondary definitions move behind disclosure. |
| Cards | `BaseCard` turns nearly every logical section into a rounded `article`, then charts/details add more inset rectangles. | Scene canvas carries primary composition directly; cards remain only for secondary support. |
| Typography | Serif appears in product, page, scene, lead, list, and chart headings; metrics and explanations are insufficiently separated. | Serif only for Annual opening, major scene headline, and closing statement; all controls/charts/Detailed copy use sans. |
| Charts | One blue horizontal/vertical bar grammar represents unrelated concepts inside beige boxes. | Seven explicit chart archetypes with purpose-specific geometry, annotation, density, and exact fallback. |
| Navigation | Home, app modes, sticky report form, year selector, chapter selector, and Dashboard tabs compete. | Three visibly distinct levels: app mode, compact scene progress, subordinate Detailed section rail. |
| Vocabulary | Frequent Words, Keywords, and cloud fallback all read as ranked lists. | Editorial ranking, typographic keyword constellation, and full-width cloud climax receive distinct compositions. |
| Annual | Opening is title/metric/card only; scenes read as a responsive admin grid; closing is an unavailable status card. | Seven authored scenes, generated opening/closing art, transitions, and a planned B5 share slot. |
| Detailed | Overview has eight large cards with value plus methodology paragraphs; chart/table/card wrappers dominate. | Concise metric anatomy, grouped overview, compact query bar/rail, and method disclosures. |
| CSS | One 4,636-line global file contains chronological B1a/B2/refinement/B1b overrides. | V1 groups v2 tokens/base primitives, Annual scenes, Detailed workspace, and responsive rules into clearly ordered scoped layers; file split is optional and behavior-neutral. |

#### 9.2 Semantic color v2

The application uses one neutral canvas and explicit semantic roles rather than chapter-by-chapter blue/pink/beige fills. Artwork uses tonal derivatives of the same moss/clay/ochre family and never introduces an unrelated neon palette.

```text
color.app-canvas       #F3F4F2
color.report-canvas    #F7F3EA
color.section-canvas   #E9E4D8
color.elevated         #FCFBF8
color.card             #FFFFFF
color.inset            #ECEDE9
color.subtle           #F4F5F2
color.border           #D6D7D2
color.divider          #C8CAC3
color.text-primary     #171A18
color.text-secondary   #535A55
color.text-tertiary    #737A74
color.accent-primary   #1F4D3F
color.accent-secondary #C8603C
color.owner            #254B9B
color.other            #C95D46
color.success          #276749
color.warning          #916300
color.error            #B42318
color.focus            #005FCC
```

Owner/Other remain stable across both modes and always carry direct labels plus side/shape/pattern. Status colors are never decorative accents. The artwork palette is bounded to `#E8DCC7` sand, `#8B9D83` sage, `#B08B6E` clay, `#C66B3D` terracotta, `#C08E3A` ochre, `#606C38` moss, and `#2F342C` ink, with enough quiet negative space for React overlays. Full dark mode remains deferred; light assets must have a hide/neutral-CSS fallback and must not be auto-inverted.

#### 9.3 Typography v2

All stacks remain offline system stacks. Annual display uses `Iowan Old Style, Baskerville, Songti SC, STSong, serif`; shared UI uses `Helvetica Neue, Avenir Next, PingFang SC, Hiragino Sans GB, sans-serif`; technical detail may use system monospace. Exact line breaks are not acceptance evidence.

| Role | Default | Use |
|---|---|---|
| Display XL | `clamp(56px, 7vw, 88px)/.96`, 600 serif | Annual opening year/range only |
| Display | `clamp(44px, 5vw, 64px)/1.02`, 600 serif | Closing statement or one major editorial line |
| Scene Heading | `clamp(34px, 4vw, 48px)/1.08`, 600 serif | Annual major scenes only |
| Section Heading | `clamp(26px, 2.8vw, 34px)/1.16`, 700 sans | Annual sub-sections and Detailed pages |
| Card Heading | `18px/1.35`, 700 sans | Secondary cards only |
| Metric Hero | `clamp(64px, 9vw, 112px)/.88`, 680 tabular sans | One dominant Annual metric |
| Metric | `clamp(32px, 4vw, 52px)/.96`, 680 tabular sans | Supporting metric/Detailed KPI |
| Body Large | `18px/1.6`, 450 sans | One short Annual lead |
| Body | `15px/1.65`, 400 sans | Main explanatory copy |
| Secondary | `13px/1.55`, 400 sans | Supporting text |
| Label | `12px/1.3`, 650 sans | Controls and chart labels; no forced uppercase Chinese |
| Metadata | `11px/1.45`, 600 sans | Scope/technical metadata |
| Caption | `12px/1.5`, 400 sans | Chart/table captions |
| Tabular Number | inherited sans + `tabular-nums` | All comparable numbers |

Serif is prohibited in Detailed Analysis, controls, metrics, charts, tables, methodology, badges, and ranking rows. A metric card contains Label → Metric + Unit → one small descriptor; definitions longer than two lines move to disclosure. Body measure is ≤72ch and Annual leads prefer 42–58ch.

#### 9.4 Grid and spacing v2

| Breakpoint | Canvas/grid | Outer margin | Gutter |
|---|---|---:|---:|
| Wide `≥1440` | max 1280px, 12 columns | 64px | 24px |
| Standard `960–1439` including 1180×760 | max 1120px, 12 columns | 24–40px | 20px |
| Compact `600–959` including ~760 | 8 columns | 20px | 16px |
| Narrow `<600` including ~380 | 4 columns | 16px | 12px |

Approved desktop compositions are `12`, `8+4`, `7+5`, `6+6`, and `4+4+4` only when all three labels are short/equal. Long Chinese headings never enter a 4-column card. Annual scene span defaults are Opening `7+5`, Scale `8+4`, Rhythm `12`, Balance `6+6`, Conversation `7+5`, Vocabulary `5+7` then cloud `12`, Closing `5+7`. Detailed KPI uses 4-column spans only for compact label/value/descriptor anatomy; long or technical metrics span 6.

Spacing tokens are `4, 8, 12, 16, 24, 32, 48, 64, 96, 128`. Annual component/card/section/scene gaps are `16/24/48/96` at Standard, increasing scene gaps to 128 at Wide and reducing to `16/20/32/64` at Compact and `12/16/24/48` at Narrow. Detailed uses component/card/section gaps `8/16/32–48`.

#### 9.5 Surfaces, radius, border, shadow, and primitives

Scene canvas is allowed and preferred at `0` radius, `0` border, and `0` shadow. `Surface` roles are canvas, elevated, card, inset, subtle, and semantic status; they are token choices, not six React components. Controls use 8px radius, small panels 10–12px, supporting cards 14–16px, artwork frames 20–24px, and pills only for compact state/filter tokens. Shadow is limited to elevated sticky/overlay surfaces (`0 8px 24px rgb(23 26 24 / 8%)`); grouping normally comes from composition, tone, whitespace, and hairline dividers.

Planned primitives are `Scene`, `SectionHeader`, `Metric`, `MetricGroup`, `Surface`, `Inset`, `ChartFrame`, `Disclosure`, `Navigation`, `ToggleChip`, and `ArtworkFrame`. `BaseCard` may remain as a compatibility wrapper for supporting content but MUST NOT own every logical section or always render `article`. Dedicated components are allowed only when structure/accessibility materially differs, such as word-cloud Canvas/list or B5 export preview.

#### 9.6 Generated art direction and privacy boundary

Generated artwork is `stylized-concept` raster imagery: abstract editorial cut-paper planes, print-like grain, calm geometry, dots, paths, pulse intervals, density fields, closed spatial containers, and negative space. It may suggest accumulation, time, local computation, conversation cadence, and private/local containment without locks, shields, crossed-out clouds, chat bubbles with text, app screenshots, people, avatars, photos, mascots, relationships, emotions, or psychological metaphors. It contains no embedded text, numbers, years, keywords, contact/company names, real statistics, paths, filenames, screenshots, or user/private evidence. All actual labels/data remain React/Canvas/SVG layers.

The built-in image generation capability is the default V1/V2 path. It does not accept a repository destination or guaranteed exact output dimensions, so each candidate is generated first, reviewed visually, then copied from the tool-owned output into the repository and locally cropped/resampled only if source quality permits. CLI/model fallback is out of scope unless separately requested. Each generated raster receives 2–4 independent candidates, one targeted refinement at a time, a quality comparison, compression, package/offline validation, and a delete-if-mediocre decision. Simple divider geometry remains deterministic CSS/SVG; a generated transition is retained only when its texture materially improves the scene.

Repository destination during implementation: `frontend/src/assets/beta/art/`. Review masters stay outside production or in a documented non-bundled review location; only selected optimized assets enter the bundle. Preferred shipping format is WebP for opaque art and PNG only when lossless/transparency is materially required. No runtime generation API, remote URL, CDN, remote font, or network fetch is permitted.

#### 9.7 Generated asset inventory

Target resolution is a post-generation acceptance/crop target, not a promise about the built-in generator's output arguments.

| Asset ID | Scene/purpose | Priority / generate | Ratio and target | Ship target | Desktop / compact behavior | Dark/accessibility/fallback |
|---|---|---|---|---|---|---|
| `annual-opening-hero` | Opening; first-screen data landscape with overlay-safe negative space | HIGH / yes, 3–4 candidates | 3:2 master, accept ≥2400×1600 | WebP ≤450 KiB | 7-column artwork; crop to 4:3 at Compact, 5:4 at Narrow with focal point preserved | Decorative `alt=""`, `aria-hidden`; hide in future dark mode unless alternate exists; CSS line/dot field fallback |
| `scene-transition-rhythm` | Scale→Rhythm cadence break | MEDIUM / conditional raster texture; CSS/SVG geometry first | 3:1, ≥1800×600 | WebP ≤180 KiB | full-bleed band; crop center and reduce opacity at Compact; hide at Narrow if noisy | Decorative; neutral divider fallback |
| `scene-transition-vocabulary` | Conversation→Vocabulary density transition | MEDIUM / conditional, 2–3 candidates | 3:1, ≥1800×600 | WebP ≤180 KiB | edge texture only; shorter crop at Compact/Narrow | Decorative; CSS dot-density fallback |
| `vocabulary-background` | Vocabulary/word-cloud edge frame; never behind dense glyph center | MEDIUM / yes, 2–3 candidates | 16:9, ≥1920×1080 | WebP ≤260 KiB | low-contrast perimeter crop; reposition rather than scale text area | Decorative; remove background while keeping cloud/list intact |
| `closing-poster` | Closing poster and future B5 visual language | HIGH / yes, 3–4 candidates | 4:5, ≥1600×2000 | WebP ≤420 KiB | 7-column portrait; Compact 1:1 crop or full-width 4:5 below copy | Decorative; CSS poster field fallback; all privacy/share text remains DOM |
| `home-decoration` | Optional Home focal balance after opening/closing pass | LOW / yes only after V1 review | 4:3, ≥1600×1200 | WebP ≤260 KiB | right-side 5 columns; hide at Narrow | Decorative; Home remains complete without it |

Reusable generation brief skeleton:

```text
Use case: stylized-concept
Asset type: local desktop Annual Recap editorial artwork
Primary request: abstract editorial data landscape suggesting time, accumulation, exchange rhythm, and local/private containment
Style/medium: matte cut-paper and print-like raster illustration, restrained grain, premium low-noise finish
Composition/framing: requested asset ratio; generous negative space for UI overlay; no baked data
Color palette: only the Design System v2 artwork palette
Constraints: generic and synthetic; no text, numbers, logos, watermark, real data, people, avatars, chat UI, locks, shields, romantic or psychological imagery
Avoid: neon AI, glossy 3D, photorealism, cyber-security iconography, decorative clutter
```

#### 9.8 Annual Recap seven-scene architecture

Sixteen logical sections remain ordered and accessible, but are recomposed into seven authored scenes:

| Scene | Logical sections | Purpose / dominant visual | Composition and supporting detail | Artwork / disclosure |
|---|---|---|---|---|
| 01 Opening | Opening | Identify range with one sentence, one dominant message metric, and generated data landscape | Hero Split `7+5`; year/range + lead + Metric Hero overlay beside artwork; no white outer card | `annual-opening-hero`; scope/method chips are secondary; next-scene link |
| 02 Scale | Messages, Active Days, Longest Streak | Establish magnitude without 3–5 metric cards | Giant Metric on `8`; two supporting metrics and a small activity/streak timeline on `4` | Direct scene canvas; exact tied intervals in one disclosure |
| 03 Rhythm | Peak Month, Peak Weekday, Peak Hour | Tell one time-distribution story | Full-width month Landscape Chart; weekday Distribution Strip and hour strip below | Optional rhythm transition; exact tables collapsed once for the scene |
| 04 Balance | Sender Share, Message Length, Message Types | Compare anonymous roles and message form without identity inference | Metric Pair `6+6` for Owner/Other plus comparison bar; compact length/types support | No people/avatar art; direct role labels/patterns; details collapsed |
| 05 Conversation | Sessions, Replies | Explain session count, initiation balance, reply interval | Editorial Split `7+5`: session Giant Metric/initiator balance left, reply distribution right | Methodology never primary; threshold chip and sample counts visible |
| 06 Vocabulary | Frequent Words, Distinctive Keywords, Word Cloud | Create the visual climax while preserving semantic distinction | Frequent Words editorial ranking `5`; keyword typographic constellation `7`; full-width Word Cloud hero below | Vocabulary perimeter art only; Clean Mode ToggleChip; full lists/method in disclosures |
| 07 Closing | Summary and Share | Resolve the story with local/privacy statement and future share position | Poster Closing `5+7`: concise conclusion/CTA beside `closing-poster`; B5 share slot reserved | Generated poster; current UI does not show a large “尚未提供” card; Detailed CTA remains |

Composition archetypes are Hero Split, Giant Metric, Editorial Split, Landscape Chart, Metric Pair, Metric Triptych only for truly equal short metrics, Vocabulary Mosaic, and Poster Closing. Opening, cloud hero, and Closing intentionally avoid traditional card containers.

#### 9.9 Navigation v2

The App Shell exposes three peer destinations—Home, Annual Recap, Detailed Analysis—in one quiet product navigation. The active mode uses text weight plus a 2px indicator and `aria-current`; it is not a second card or large segmented pill. Annual report navigation is a ≤52px desktop sticky bar containing a compact year selector, current scene label, and seven-step progress rail/dots. Logical-section anchors remain addressable through an accessible chapter picker/disclosure, but sixteen options are not permanently visible. Arrow/Home/End behavior, native select labels, anchor `scroll-margin-top`, visible focus, and focus return remain.

At Compact/Narrow, the report bar becomes one row with year + current scene + chapter button; the expanded picker is in normal flow or an accessible popover that never covers focused content. Detailed section navigation is a subordinate tab/rail and never resembles app-mode or report-progress navigation.

#### 9.10 Vocabulary experience v2

- **Frequent Words**: editorial top ranking with oversized top 3, proportional measure line, count/rate switch, and exact accessible list; it communicates “most often”.
- **Distinctive Keywords**: 4–6 typographic keyword highlights of varying but bounded emphasis, each with short statistical context; it communicates “most characteristic of the year”, never “most frequent”.
- **Word Cloud**: full-width climax surface using the unchanged deterministic geometry; controls, scope, explanation, and accessible list trigger sit outside the Canvas. Generated art is limited to perimeter/frame and cannot reduce contrast or available geometry.
- **Clean Mode**: a semantic `ToggleChip` labelled `✓ 净化常用词` / `净化常用词`, with native checkbox/switch semantics, visible focus, reversible state, concise explanation, and independent custom-hidden management in disclosure.

#### 9.11 Detailed Analysis v2

Detailed Analysis becomes `Header → Query Bar → Section Rail → Content`. The header is compact, all-sans, and contains title/context/local state plus secondary “分析其他文件”. The Query Bar keeps date range, sender, session threshold, explicit Apply, validation, and committed QueryChips in one systematic wrapping row. The eight existing sections remain unchanged and keyboard reachable.

Overview is recomposed around one dominant selected-message metric, an Activity metric pair, one Owner/Other comparison, and one Replies/Sessions group; it is not eight equal cards. Each metric contains Label, Metric, Unit, one ≤2-line descriptor, and optional text-link navigation. Definitions, denominator language, filter exceptions, and schema details move to section methodology/developer disclosures. Standard charts use compact headers and direct insight; tables are used only when exact comparison needs them.

`Words & Years` remains Summary → Key Visualization → Primary Ranking → Year Comparison → collapsed yearly table → collapsed methodology, but ranking, keyword evidence, and trace are visually differentiated. User tables use 44–48px rows in the 1180×760 workspace; technical tables may be denser inside a labelled disclosure. Presentation changes cannot alter any prop, callback timing, route, query, metric, pending/stale behavior, or export authority.

#### 9.12 Chart language v2

| Archetype | Purpose/density | Labels and annotation | Accessible fallback |
|---|---|---|---|
| Hero Chart | One Annual scene conclusion; sparse | direct value/peak/tie annotation, minimal grid | sentence + exact list/table |
| Standard Chart | Detailed comparison/trend; medium | axis/units, direct legend, primary insight | exact labelled table |
| Micro Chart | Support one metric; very sparse | endpoint/peak only | descriptor with exact values |
| Comparison Bar | Owner/Other | direct labels, counts/shares, fixed sides/pattern | two-row definition list/table |
| Distribution Strip | Weekday/hour | all buckets, selected peak/ties, no heavy axes | ordered exact table |
| Timeline | Streak/year/activity | start/end, partial marks, gaps | chronological list/table |
| Rank Bars | Words/message types | rank, token/category, value, proportional line | ordered list/table |

Blue bars are not the universal default. Gridlines are hairlines and only where reading values requires them; zero baselines and units remain explicit. Chart color never carries meaning alone.

#### 9.13 Responsive and artwork behavior

Wide keeps generous negative space and maximum artwork presence. Standard 1180×760 is the primary composition gate and must show Opening as one near-complete viewport. Compact ~760 collapses 12-column compositions to the named 8-column arrangement rather than auto-fit; artwork may move below copy, crop, or reduce opacity. Narrow ~380 uses 4 columns, one content flow, no sticky multi-row toolbar, no horizontal page scroll, full-width controls, and optional decorative art hiding. Three-column desktop layouts never simply squeeze into narrow auto-fit cards.

Every major scene has an explicit crop/hide rule in the inventory/scene tables. Artwork uses explicit dimensions/aspect ratio to prevent layout shift; opening assets load eagerly from the local bundle and below-fold assets lazily where supported. The UI remains complete if any decorative asset is removed.

#### 9.14 Accessibility and visual acceptance

Semantic HTML precedes ARIA. Icon-only controls require names; every form control has a visible label; actions use buttons and navigation uses links/buttons with the correct semantics. Focus uses a 3px high-contrast `:focus-visible` ring; compound controls use `:focus-within`. Headings remain ordered, anchors receive `scroll-margin-top`, interactive targets are at least 44×44px, and 200% zoom cannot create two-dimensional page scroll or covered focus. Images have explicit width/height; generated decorative assets use empty alt and `aria-hidden`, while all real information exists as DOM/Canvas data plus text. Charts retain exact alternatives. Motion uses only transform/opacity and respects reduced motion; no `transition: all`.

Each implementation batch captures the fixed set: Home, Annual Opening, Scale, Rhythm, Balance, Conversation, Frequent Words, Keywords, Word Cloud, Closing, Detailed Overview, and Detailed Words & Years. Review each image independently and the sequence as a story. Each category is scored `PASS`, `NEEDS POLISH`, or `FAIL`: Hierarchy, Alignment, Consistency, Density, Rhythm, Balance, Readability, Contrast, Scanability, Composition, Story Progression, Artwork Integration, Chart Clarity, and Navigation Clarity. Any `FAIL`, inaccessible control, unclear data meaning, obvious AI artifact, or broken 1180/760/380 crop blocks the batch; `NEEDS POLISH` must be recorded and resolved or explicitly accepted before the next batch.

#### 9.15 CSS and dependency boundary

V2 retains scoped CSS beneath `.desktop-app.beta-enabled`, `.beta-report`, and explicit Dashboard roots; browser-v1 cannot inherit Beta rules. V1 may split the Beta/Detailed presentation layers into imported local CSS files to end chronological overrides, but MUST NOT add CSS Modules, Tailwind, CSS-in-JS, styled-components, a UI kit, or a new runtime dependency. Minimal deterministic SVG/CSS handles simple lines/dividers; generated raster assets handle only editorial texture/artwork. Existing word-cloud geometry, ECharts dependencies, analytics, and host authority remain unchanged.

### 10. Motion and scroll narrative

The report is continuous scrolling with optional anchor navigation. Motion tokens are:

```text
motion.fast      120ms
motion.standard  220ms
motion.emphasis  420ms
motion.easing    cubic-bezier(.2,.8,.2,1)
motion.stagger   36ms, capped at 216ms total
```

Chapter entry is opacity + 12px translate using `IntersectionObserver` once per chapter. Numbers count from the previous display value or zero only after data is ready, capped at 420ms; screen readers receive the final value once. Small charts reveal by transform/clip; the word cloud fades placed words in rank batches with the global stagger cap; year/mode switches cross-fade the complete committed view in 220ms; loading uses existing progress/skeleton patterns. Motion never triggers queries, changes layout coordinates, withholds final values, or participates in correctness.

`prefers-reduced-motion: reduce` disables transforms, counting, chart drawing, cloud stagger, smooth scroll, and cross-fades; final content appears immediately. Missing `IntersectionObserver`, Canvas animation failure, tab backgrounding, or low frame rate yields the same static final view. No large animation framework is added; CSS, Web Animations API, and existing React state suffice. Layout/analytics Workers remain off the main thread and animation work is limited to transform/opacity.

V1–V3 do not build a new motion abstraction. They ensure content, focus, navigation, artwork fallbacks, and meaning are complete in a static state and that incidental transitions respect `prefers-reduced-motion`. The motion tokens/observer/reveals remain in B5 when they have a concrete consumer.

### 11. Sharing and export authority

First Beta implements exactly:

1. annual summary card PNG, 1200×1500 final pixels;
2. word-cloud PNG, 1200×1500 final pixels.

Single-chapter PNG is a later Beta enhancement after the two fixed templates are accepted. Long image and multipage-image export are deferred beyond first Beta because WebView height, pagination, memory, and accessibility QA would delay core value. Aggregate JSON/CSV and approved chart PNG remain unchanged in Detailed Analysis.

Export defaults to anonymous `owner` / `other` labels. A user may enter local display aliases for the current export preview, but they are never auto-filled from contact/source metadata, are not persisted by default, and must pass length/control-character validation. The confirmation preview warns that aliases and token lists can be sensitive. Default output excludes message bodies, contact names, source paths, basenames, internal IDs, dataset/query keys, token trace, hidden-word lists, and methodology tables.

Every image visibly includes year/scope, active sender/filter summary, UTC+08:00, metric label/definition version short form, “仅本地生成”, custom-filter on/off, and a privacy warning. Summary-card clauses come from the committed localized report view-model; word-cloud export uses the fixed export layout key. Geometry is fixed; raster glyph pixels are deterministic within the same packaged application/platform/version, not promised across macOS font/WebView versions.

The renderer draws a privacy-stripped `BetaExportViewModelV1` into one 1200×1500 offscreen Canvas and encodes it with `toBlob("image/png")` without metadata. The raw RGBA backing store is approximately 7.2 MiB, one quarter of the former 2400×3000 proposal. Renderer code releases the Canvas/blob/byte view after save or cancellation and does not retain preview and export backing canvases simultaneously.

B5 adds an explicit **opaque binary presentation-export authority** alongside, not inside, the existing closed numeric `export_aggregate` DTO. The contract has two bounded steps: a small `prepare_presentation_png` command validates window/session/committed result/generation/export kind/schema/dimensions and stores at most one active lease per window; `save_presentation_png` then receives only PNG bytes as the top-level raw `ArrayBuffer`/`Uint8Array` IPC body, with the opaque lease ID in one allow-listed ASCII invoke header (`x-chat-analysis-export-lease`). PNG bytes MUST NOT be base64, a nested JSON number array, or placed in React state. Rust consumes the lease before save, validates authority/freshness, PNG signature/IHDR/chunks, exact **1200×1500 pixels**, no ancillary text/profile/EXIF chunks, at most **10 MiB encoded bytes**, approved kind, and generic default filename; prepare replacement, cancellation, session/generation replacement, or close invalidates the previous lease. It then owns native destination selection and descriptor-relative atomic save. A synthetic contract test proves the raw-body/header route before the rich renderer is wired. If the packaged Tauri path cannot carry it within bounds, B5 stops for a contract correction and never grants a renderer path. Cancellation leaves the report intact; retry prepares a fresh lease for the same committed preview.

This adds only the narrow prepare/raw-save contract and host-owned lease state; it adds no filesystem plugin, dialog plugin, HTTP, opener, shell, process, new-window, or general binary-write permission.

### 12. Performance budgets

Performance acceptance has two layers. Structural invariants are hard gates: no source reread, no canonical dataset in React state, no main-thread tokenization/analytics/layout, no analytics on scroll/resize/navigation, bounded candidate/visible words and caches, stale suppression, one export Canvas, and opaque bytes within the 10 MiB contract. Millisecond/FPS/memory observations are diagnostic targets measured on the existing Stage-12 macOS arm64 reference class with fixed synthetic fixtures; they are not flaky per-test CI assertions or universal hardware guarantees.

| Interaction | Warm/cold target |
|---|---|
| First Annual Recap after canonical result is committed | report shell/hero ≤300ms; complete cached-field adapter ≤500ms |
| Navigate between already rendered chapters | ≤100ms, no Worker query |
| Switch represented year | prior report remains readable; cached result ≤250ms, uncached existing aggregate query ≤2s p95 synthetic profile |
| Switch owner/other or raw/per-10k | cached frequency DTO ≤250ms; uncached scoped ranking ≤1s p95 |
| Add/remove custom hidden words | visible update ≤500ms, no source read/tokenization |
| Word-cloud layout | diagnostic: standard 80 terms ≤250ms; export 100 terms ≤750ms in layout Worker |
| Animation | diagnostic: smooth on the reference fixture; investigate Beta-attributable long tasks >50ms rather than gating on 60 FPS |
| PNG encode + opaque handoff before save panel | diagnostic ≤2s; hard ≤10MiB encoded bytes |
| Additional retained report/layout memory | diagnostic ≤32MiB beyond accepted canonical index/result cache; hard bounded cache/item counts |

The complete canonical dataset never enters React state, React never tokenizes, scrolling never starts analytics, mode changes never reread source JSON, and resize never recalculates analytics. If the cloud misses its diagnostic layout target, reduce terms 100→80→60→40→20 and announce the reduction; the same bounded accessible candidate list remains available. Performance tests use fixed synthetic token strings/numeric results and record warmup plus repeated-run median/p95; a single wall-clock miss is diagnostic, while violating a structural invariant or bound fails acceptance.

### 13. Accessibility acceptance

- All Home, mode, year, filter, role, metric, vocabulary, chapter navigation, methodology, hidden-word restore, export, cancel, retry, and reselect actions are keyboard operable with visible focus and logical focus return.
- Page and chapter headings are semantic and ordered; mode navigation is labelled; the year selector exposes partial/full-calendar scope; changes announce loading, success, empty, insufficient, error, and cancellation via appropriate polite/assertive live regions.
- Charts have a title, sentence summary, and exact table/list alternative. Owner/other and magnitude are represented by labels and geometry/pattern, not color alone.
- Canvas word cloud is not the only carrier and is hidden from the accessibility tree. Its ordered list announces rank, token, raw count, normalized rate, and current role/year.
- At 200% zoom and narrow CSS layout, controls remain reachable and content has no two-dimensional scroll. The 1180×760 app layout retains primary actions and sticky navigation.
- `prefers-reduced-motion` produces immediate static content. Focus is never moved by scroll animation; after a user-triggered mode/year change it moves once to the new `h1`/report heading.
- Text and UI contrast meet WCAG 2.2 AA; focus indicator meets 3:1; errors/loading do not rely on color or motion.

### 14. Synthetic-only test strategy

Unit tests cover report/query key separation, represented/full-calendar year logic, logical-section order/scene grouping, peak ties, semantic facts/template IDs, the fixed `zh-CN` presenter, formatters, average-day denominator, keyword/frequent-word copy, reason codes, custom-word normalization/bulk paste/reset, presentation hash, word weights, layout key, export metadata, alias validation, and forbidden privacy fields.

Worker tests cover year/role/date/sender, raw/per-10k fields, built-in-policy denominator, scoped frequent words, existing log-odds semantics, low samples, zero denominator, exact envelope/per-item keys, deterministic DTO, cache eviction, cancellation, and stale result rejection. Presentation tests prove custom hiding changes neither Worker calls/keys nor denominator/count/rate and may safely yield fewer bounded candidates. Existing Dashboard DTO tests remain unchanged.

Layout tests cover equal input/equal coordinates, controlled input/version changes, fixed initial phase, stable ordering, synthetic-metric rectangles, renderer fit-down without coordinate change, collisions, bounds, 32-code-point rejection, Han/Latin/mixed tokens, viewport buckets, max attempts, progressive term reduction, max term counts, 1200×1500 export pixels, and proof that reduced motion does not alter coordinates. Whole-image pixel snapshots are same-packaged-environment optional visual regression evidence, never the sole correctness oracle.

React tests cover Home/default CTA, single/multiple/empty years, mode switching, shared filter/threshold retention, restore-full-range, chapter order, loading/error/empty/insufficient states, stale-year suppression, keyboard/focus/ARIA/live regions, chart alternatives, word-cloud list, vocabulary controls, export preview/privacy warning, retry/reselect, responsive layout, and reduced motion.

Rust/IPC tests first prove the one-use lease plus top-level opaque-binary request without base64/nested number arrays, then cover committed result/generation fencing, 1200×1500 PNG dimensions/signature/chunks/10MiB limit, forbidden metadata, generic names, lease replay/expiry, save cancellation, atomic replace/failure cleanup, and no renderer destination. Packaged Beta acceptance later uses synthetic vertical fixtures for `.app`, prototype `.dmg`, offline/no-account/no-network flows. Only the user may separately authorize and perform real-data checks; agents do not execute them.

### 15. Luna Max implementation stages after visual-plan freeze

B1a–B4 and the correctness/refinement work are the protected functional baseline. Visual implementation is split into three mandatory batches; no batch rewrites analytics, Worker DTOs, canonical v2, Clean Mode semantics, keyword scoring, word-cloud geometry, query identities, or export authority.

| Stage | Scope / likely files | Generated assets | Acceptance and stop point | Model |
|---|---|---|---|---|
| V1 — Design System v2 + Shell + Generated Asset Foundation | v2 tokens/type/grid/primitives; optional scoped CSS reorganization; App Shell/Home; app navigation; compact Annual progress navigation; Detailed header/query/rail shell. Likely: `styles.css` or new imported scoped Beta CSS, `primitives.tsx`, `BetaModeNavigation.tsx`, `BetaHome.tsx`, `BetaAnnualReport.tsx`, presentation-only parts of `DesktopImportPanel.tsx`/`DesktopDashboard.tsx`, tests. | Generate 3–4 `annual-opening-hero` and `closing-poster` candidates; review, keep only selected optimized local files; evaluate Home asset. | Type/lint/scoped browser/a11y/offline pass; screenshots Home, Opening, navigation, Detailed shell at 1180/760/380 and 200% zoom. Stop for human visual acceptance before V2. | Luna Max |
| V2 — Annual Recap Recomposition | seven scenes; composition archetypes; Scale/Rhythm/Balance/Conversation; distinct vocabulary modes; unchanged word-cloud Canvas geometry with new frame; progressive disclosure; closing poster/share slot. Likely: `BetaAnnualReport.tsx`, `BetaCoreReportSections.tsx`, `BetaWordEvidenceSections.tsx`, `BetaWordCloud.tsx`, `report-sections.ts`, scoped CSS, browser tests. | Generate/review conditional transition and vocabulary assets; integrate selected opening/closing assets; delete low-quality variants. | Full 10-image Annual screenshot set, rubric, keyboard/chart fallback/crop/offline/package-preview checks. Stop for second human visual acceptance before V3. | Luna Max |
| V3 — Detailed Analysis Recomposition | compact Header/Query Bar/Section Rail; Overview metric regrouping; concise metric anatomy; chart/table language; Words & Years; methodology; message types/replies/sessions/export presentation. Likely: `DesktopDashboard.tsx`, scoped Dashboard CSS, existing Dashboard/browser tests. | None by default; generated art does not enter analytical cards. | Detailed Overview and Words & Years screenshots plus all eight route regressions; exact query/callback/value/export/stale parity. Stop for third human visual acceptance before B5. | Luna Max |
| B5 — Story Motion and Privacy-Safe PNG Sharing | existing deferred motion, summary/share behavior, fixed PNG rendering and bounded host save authority | Reuse the accepted closing visual language; do not generate data-bearing export pixels | May begin only after V1–V3 are accepted; static/reduced-motion/privacy/IPC tests | Luna Max |
| B6 — Packaged Synthetic Beta Acceptance | existing `.app`/`.dmg`, offline and synthetic acceptance | Verify only repository-owned optimized assets are bundled and zero remote requests occur | May begin only after V3 and B5; packaged visual screenshot/rubric pass | Luna Max |

```text
protected B1a–B4 baseline → V1 → human stop → V2 → human stop → V3 → human stop → B5 → B6
```

Every future implementation batch uses exact-path review/staging, synthetic data only, strict OpenSpec validation, `git diff --check`, and offline/no-private checks. Commit/push instructions belong to the future implementation turn, not this planning batch. If visual changes require a data contract, word-cloud geometry, or privacy boundary change, that batch stops for Sol High re-planning instead of broadening scope.

### 16. Visual planning freeze and change control

This document, the capability spec, and tasks are the implementation authority for V1–V3. The old “Screenshot-driven refinement backlog” is no longer a loose backlog; its issues are absorbed into v2 diagnosis, scene/grid/type/chart/navigation requirements, generated-asset briefs, and visual gates. V1 may refine exact CSS variable names or component extraction, and image review may reject every candidate, but it may not change scene purposes, data meaning, accessibility, privacy, or stop points without updating OpenSpec first. Low-quality AI artwork is removed and the documented CSS/SVG fallback is used.

## Risks / Trade-offs

- [Shared query means report year changes the Detailed Dashboard scope] → Make the current scope persistent and visible in both modes, provide one-click “恢复全部数据范围”, and test round trips.
- [Current top-20 cross-year DTO cannot feed a real selected-year cloud] → Add a bounded versioned Worker DTO before cloud layout; do not synthesize missing terms in presentation.
- [Legacy ECharts word-cloud layout is not provably deterministic] → Keep it only for browser-v1 compatibility and implement a seedless, fixed-phase layout Worker for Beta.
- [System-font metrics can vary across macOS versions] → Use versioned synthetic rectangles plus renderer fit-down for coordinate correctness; promise raster identity only in the same packaged platform/version.
- [Token-only quality filtering cannot perfectly identify email/path fragments or names] → State fragment limitations, provide explicit custom hiding, and defer possible-name/NER behavior instead of making an identity claim.
- [Global localStorage hidden words can itself be sensitive] → Keep it local, content-free in logs/export, bounded, user-visible/editable/resettable, and never sync it. A future encrypted preference store is non-blocking.
- [Renderer-generated rich PNG weakens the current host-rendered image model] → Add a separate one-use lease plus opaque raw-byte authority, reduce output to 1200×1500, and retain host path/save/validation authority; never serialize bytes as base64/JSON arrays.
- [Canvas is not intrinsically accessible] → Make it decorative in the accessibility tree and provide the same bounded ordered semantic list without per-glyph hidden DOM.
- [Motion can harm performance or comprehension] → Uniform small tokens, transform/opacity only, one-shot observers, reduced-motion/static fallback, and main-thread long-task budget.
- [Beta visual tokens could leak into browser-v1 or Dashboard styles] → Follow the existing stylesheet architecture but scope variables/classes beneath `.desktop-app.beta-enabled`, `.beta-report`, and explicit Dashboard selectors.
- [Detailed v2 could accidentally become a data-logic refactor] → Isolate it as V3, retain exact component props/query callbacks/DTOs, stop on any parity failure, and block B5/B6 until it passes.
- [Reducing borders could weaken grouping or accessibility] → Replace borders with explicit surface tone, spacing, heading structure, and restrained depth; keep borders for controls, selected states, focus support, and table separators.
- [Decorative hierarchy could hide methodology] → Collapse rather than delete methodology and engineering detail, preserve keyboard-accessible disclosures, and test that every current Words & Years field remains reachable.
- [First-year data may be partial or sparse] → Never infer export completeness; label full/partial query scope and use explicit insufficient states.
- [Long-image export could dominate delivery] → Defer chapter/long/multipage output; ship two fixed templates first.
- [Generated art looks generic, noisy, or recognizably low-quality] → Generate multiple generic candidates, score them in context, keep none when quality is inadequate, and preserve a complete CSS/SVG fallback.
- [Artwork leaks private evidence or bakes data into pixels] → Prompts contain only the frozen abstract brief and palette; no private source/screenshot/statistic/name/path is read or supplied; all user/year/data text stays in React/Canvas/SVG layers.
- [Repository assets increase package weight or require network access] → Ship only optimized WebP/PNG under bounded per-asset targets, inspect the bundle, and run packaged zero-external-request acceptance.
- [V2 CSS becomes another chronological override layer] → V1 establishes one ordered token/primitives/Annual/Detailed/responsive structure and removes superseded Beta declarations deliberately without bulk deletion or browser-v1 leakage.

## Migration Plan

1. Treat completed B1a–B4 functionality as the protected baseline; freeze current screenshots before presentation edits.
2. Run V1 to install v2 tokens/grid/primitives, shell/navigation, and the reviewed opening/closing asset foundation; stop for human acceptance.
3. Run V2 to recompose all Annual scenes and vocabulary/word-cloud framing without changing logical sections or geometry; stop for human acceptance.
4. Run V3 to recompose Detailed Analysis without changing props, queries, metrics, routes, or exports; stop for human acceptance.
5. Resume B5 only after all three visual gates, then add the 1200×1500 renderer plus one-use lease/opaque binary save authority and deferred motion.
6. Complete B6 synthetic packaged acceptance. Rollback for V1–V3 is removal of the v2 presentation/selected art while the prior Detailed Dashboard, report data contracts, and deterministic cloud remain functional; no user data migration is required.

## Open Questions

No product or architecture question blocks V1. Asset selection is deliberately a quality gate rather than an open product question: if no candidate passes, use the frozen fallback. During B5, the raw-body contract test still precedes renderer integration; inability to carry a ≤10 MiB opaque PNG stops that batch for a bounded transport correction rather than falling back to base64/JSON bytes or granting renderer filesystem access. Word-cloud geometry is frozen and is not reopened by visual framing.
