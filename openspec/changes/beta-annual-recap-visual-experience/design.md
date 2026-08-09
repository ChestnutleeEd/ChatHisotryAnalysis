## Context

### Repository baseline used by this design

Planning was performed on branch `feat/implement-local-chat-wordcloud-mvp` at `6fa9495f3a67077aa8270754f9d2fd7968ee8b8e` (`fix: validate multi-year canonical dataset handoff`) with a clean initial workspace and upstream `0/0`. `data/private` is ignored by `.gitignore:4`; only `git check-ignore -v data/private` was run against that boundary. No private source, aggregate, filename, or path was read.

OpenSpec 1.6.0 reports two existing changes as artifact-complete but task-in-progress: `implement-local-chat-wordcloud-mvp` (144/176) and `productize-local-chat-analysis-desktop` (90/102). In the latter, product tasks 1.1–12.6 and 12.9 are checked, real-data authorization gates 12.7 and 12.8 are unchecked, and D.1–D.10 are unchecked Release hardening. The older word-cloud change has checked preprocessing tests numbered 12.7/12.8 but unchecked browser/capacity/final stages; those same numbers are unrelated to the productization real-data gates and are not changed here.

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

### Packaged Alpha visual findings that Beta must correct

The current desktop CSS establishes accessibility and a functional Swiss light theme, but most workflow cards, status panels, Dashboard shells, filters, charts, tables, methodology panels, buttons, and controls share the same white fill, 1px gray outline, and near-square geometry. Information is therefore grouped by repeated boxes rather than depth, typography, spacing, or content hierarchy. The packaged Alpha also exposes duplicated workflow success copy, long plain-text scope lines, visually prominent generation/schema labels, native-looking form controls, a flat text-only tab rail, dense technical tables, and a `Words & Years` page whose engineering trace is expanded by default.

These findings are accepted product evidence for visual planning. Beta must correct them through shared presentation primitives and scoped CSS, while leaving all existing metrics, tabs, filter commit behavior, Worker queries, exports, accessibility semantics, and error/recovery behavior intact.

## Goals / Non-Goals

**Goals:**

- Freeze one implementable Beta information architecture, report flow, narrative, metric semantics, presentation contract, word-cloud pipeline, visual/motion system, accessibility contract, export boundary, performance budget, and staged implementation plan.
- Reuse accepted Alpha infrastructure and preserve every detailed Dashboard route, filter, metric, query, recovery path, and export.
- Keep canonical data and tokenization in the Worker boundary, keep report assembly out of React render, and keep file destinations in Rust authority.
- Make frequent words, distinctive yearly keywords, sample insufficiency, partial calendar scope, sender-filter exceptions, timezone, and session-threshold effects understandable without relational or psychological claims.
- Produce a deterministic, responsive, local word cloud plus equivalent accessible list and fixed-size exports.
- Make B1a small enough to show a runnable Beta shell with the shared visual foundation, refined App Shell/workflow status, a synthetic hero, one metric card, one narrative card, and methodology disclosure. Land the existing eight-route Dashboard uplift separately as B1b so it cannot block populated report cards or the word-frequency path.

**Non-Goals:**

- Any proposal non-goal, Release hardening, D.1–D.10, private-data authorization gate, or change to the Alpha task checkboxes.
- A new source reader, main-thread tokenizer/statistics path, full canonical dataset in React state, cloud service, AI-generated narrative, or context playback from tokens.
- Replacing the existing Dashboard with a story page or forcing engineering trace fields into the annual report.
- Dark-mode implementation in the first Beta; only semantic token names and contrast-ready pairs are reserved.
- Possible-name filtering, accurate person-name detection, automatic contact naming, English stemming/lemmatization, or hiding all uppercase abbreviations in first Beta.
- Chapter PNG and long/multipage export as first-Beta blockers.

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

### 9. Frozen visual system

The selected direction remains **“本地数据年鉴 / Editorial Almanac”**. Its precise language is editorial, personal, calm, tactile, data-rich, contemporary desktop, and premium but restrained. Warm neutral canvas, clean white cards, ink typography, cobalt structure, coral highlights, and very subtle tonal panels create the relationship between Annual Recap and Detailed Analysis. Warm paper does not mean that every surface is yellow. Enterprise dashboard, Bootstrap admin, raw HTML, cyberpunk, gaming UI, neumorphism, large gradients, heavy Material shadows, and glassmorphism are explicitly rejected.

One alternative remains **“Swiss Data Ledger”**, an exact extension of the current white/IKB/orange Dashboard. It is the supporting language for Detailed Analysis, but it is not sufficient for the consumer-facing report. Both modes share primitives; Annual Recap uses more editorial scale, tonal section backgrounds, and narrative cards, while Detailed Analysis remains denser and more tool-like.

#### 9.1 Color roles

```text
color.canvas                 #F4EFE6  app background
color.report                 #FBF8F2  elevated report surface
color.surface.standard       #FFFFFF  default card/control surface
color.surface.inset          #EEE8DE  inset/subtle grouping
color.surface.highlight      #EEF2FF  cobalt narrative highlight
color.surface.coral          #FFF0EA  restrained emphasis
color.surface.privacy        #EAF5F1  privacy/local callout
color.surface.success        #EAF6EF  completed workflow
color.surface.warning        #FFF5E5  partial/attention
color.text.primary           #181B20
color.text.secondary         #555B65
color.text.muted             #737984
color.text.inverse           #FFFFFF
color.border.subtle          #D8D1C7
color.border.strong          #8A8378
color.primary-data           #1738A8
color.owner                  #1738A8
color.other                  #E65F3D
color.highlight              #E65F3D
color.chart.3                #20806B
color.chart.4                #A56A12
color.chart.5                #7357A8
color.success                #176B45
color.warning                #8A5600
color.error                  #B42318
color.partial                #7A5A16
color.privacy                #176B5B
color.focus                  #005FCC
```

One screen or card should normally use one structural accent and at most one supporting highlight in addition to semantic status colors. Section-specific tonal surfaces may vary between report chapters, but saturated palette colors must not compete simultaneously. Owner/Other are fixed to cobalt/coral across both modes and always have direct labels plus geometry, pattern, or position.

#### 9.2 Typography component patterns

Font stacks stay offline and system-owned: display/headings use `Iowan Old Style, Baskerville, Songti SC, STSong, serif`; UI/body use `Helvetica Neue, Avenir Next, PingFang SC, Hiragino Sans GB, sans-serif`; metrics use the UI stack with `font-variant-numeric: tabular-nums`; dense developer metadata may use `ui-monospace, SFMono-Regular, Menlo, monospace`. System availability may select different Han/Latin faces across supported macOS versions, so exact line breaks are not acceptance evidence; overflow, hierarchy, readable measure, and stable fallback are.

```text
type.eyebrow       12px / 16px / 700 / .08em tracking
type.display       clamp(40px, 5.4vw, 72px) / 1.00 / 600 / -.04em
type.heading       clamp(30px, 3.6vw, 44px) / 1.08 / 600 / -.028em
type.title         22px / 1.25 / 650 / -.012em
type.report-lead   clamp(19px, 2.0vw, 26px) / 1.4 / 500 / -.01em
type.body          16px / 1.6 / 400
type.secondary     14px / 1.5 / 400
type.metadata      12px / 1.4 / 600
type.metric        clamp(36px, 5.2vw, 64px) / .98 / 650 / -.035em / tabular
type.metric-unit   14px / 1.2 / 600
```

These are CSS roles, not ten required React components. `body`, `secondary`, and `metadata` normally share semantic elements plus scoped modifier classes; dedicated components are justified only where structure/accessibility is repeated (`ReportLead`, `MetricNumber`), not for every font token.

An eyebrow is a quiet capsule or letter-spaced label on a tonal/transparent surface, not an isolated large blue uppercase line. Internal section numbering such as `05 / WORDS & YEARS` may remain in Detailed Analysis at low contrast but is not a primary Annual Recap element. Display headings carry page identity such as “你的 2025”; `report-lead` carries one short natural-language conclusion and must be visually stronger than body text. A metric is a dedicated number/unit composition, optionally followed by a compact delta badge; it is never styled as an ordinary `h2`.

Body copy has a maximum readable measure of `72ch`, with preferred narrative measure `58–68ch`. Full-width sentences across the 1120px content column are prohibited. Metadata is represented as chips rather than one prose line. Generation IDs, schema names, DTO versions, `canonical dataset`, and Worker terminology are not normal metadata.

Visible technical information is classified:

| Class | Examples | Default treatment |
|---|---|---|
| `USER_VISIBLE` | year, sender scope, UTC+08, active filters, threshold, counts, partial/insufficient state | Main UI, chips, labels, conclusions |
| `METHOD_ONLY` | population definition, log-odds name, denominator, keyword thresholds, algorithm/version short labels | Collapsed methodology disclosure |
| `DEVELOPER_ONLY` | schema IDs, result generation, query key, Worker DTO, canonical/internal IDs | Hidden from normal UI; optional developer details only |

#### 9.3 Surface hierarchy, borders, radii, and depth

The six semantic surface roles are:

1. `surface.canvas`: application background, no border or shadow;
2. `surface.report`: broad elevated Annual Recap sheet, tonal separation plus `surface-raised` depth;
3. `surface.card`: standard white or tonal content card, normally no full border;
4. `surface.inset`: embedded table/filter/method block using tonal fill and no shadow;
5. `surface.highlight`: narrative/metric emphasis using a restrained cobalt or coral tint and optional accent rail;
6. `surface.status`: success/warning/error/privacy callout using icon, text, and semantic tint.

Depth tokens are `surface-flat: none`, `surface-raised: 0 3px 14px rgb(24 27 32 / .08)`, and `surface-overlay: 0 18px 48px rgb(24 27 32 / .14)`. Annual cards use flat or raised only; overlay is reserved for dialogs/popovers. Borders are primarily for interactive controls, table separators, selected state, focus support, and occasional subtle card distinction. A full 1px outline on every nested section is forbidden.

```text
radius.compact-control 10px
radius.control         12px
radius.card            18px
radius.hero            24px
radius.overlay         20px
radius.pill            999px
```

These six roles are design tokens/class modifiers, not six React components. A single surface primitive or ordinary semantic markup may select a role; behavior-specific components are introduced only when they own repeated accessibility or interaction. Annual Recap primary cards normally use radius ≥16px. Nested cards must change tone, spacing, or divider treatment rather than repeat another complete border box. Tables may have one subtle outer boundary and header/between-group separators, but not a hard grid around every cell.

#### 9.4 Text containers, badges, chips, and disclosures

- `Badge`: compact 24–28px high capsule for 本地处理、离线、Beta、部分年份、数据不足; semantic icon plus text where state matters.
- `Chip`: 30–34px high interactive or read-only pill for year, sender, timezone, filter, session threshold, role, raw/per-10k; selected chips use filled/tinted state and not color alone.
- `StatusPill`: concise state such as 分析中、已完成、部分年份、暂无数据; duplicate prefix copy such as “当前状态：结果已准备好” is removed.
- `HighlightSentence`: `report-lead` on a subtle tinted surface with a 3px accent rail or 20px icon; emphasized phrase may use stronger weight/color, but the whole paragraph is not saturated.
- `MethodologyDisclosure`: collapsed `<details>` or equivalent disclosure with icon, one-sentence summary, method chips, and secondary inset surface. Full existing methodology stays available only after deliberate expansion.

#### 9.5 Button system

All standard buttons use 44px minimum height, 12px radius, 16–20px horizontal padding, 600 weight, 8px icon gap, and `motion.fast` state transitions. Hero CTAs may use 48px height and 22px horizontal padding. Every style defines default, hover, active, `focus-visible`, disabled, and loading states; loading preserves width and exposes an accessible name/status.

- `Primary`: filled cobalt with inverse text; used for 查看年度聊天报告、应用筛选、生成分享图.
- `Secondary`: neutral/tonal surface with strong text and optional subtle border; used for 进入详细分析、重新选择年份.
- `Tertiary/Ghost`: transparent or inset-tonal background without default box border; used for 查看统计口径、隐私说明.
- `Destructive/Exit`: quiet ghost by default with error color only on deliberate hover/focus; 退出应用 never competes with the main CTA.

Disabled buttons retain ≥3:1 component contrast, remove misleading hover, expose `aria-disabled`/native disabled semantics, and have adjacent explanation when the reason is not obvious. Not every action may use the same bordered rectangle.

#### 9.6 Form controls and filter toolbar

Native input/select semantics may remain where WebView accessibility is more reliable, but the surrounding visual system is fixed. Date, select, text input, checkbox/toggle, and segmented controls use a 44px minimum control height, 12px radius, 12px vertical/14px horizontal content padding where applicable, 14px UI text, 6px label gap, strong focus ring, explicit validation text/icon, and visually distinct disabled/read-only states. Labels remain visible; placeholders do not replace labels.

The global filter becomes a compact `FilterToolbar`, not a full-width bordered form. At 1180px it groups Date range, Sender, Session threshold, and Apply in one wrapping raised/inset surface. Apply remains an explicit primary button and preserves existing Worker commit semantics. After commit, `QueryChips` show `[2022–2026] [双方] [UTC+08] [Session 6h]` plus `[已筛选]` when bounds differ from dataset scope. The previous prose scope line and visible result generation are removed from normal presentation.

#### 9.7 Navigation hierarchy

App-level mode navigation and Dashboard section navigation are visually distinct:

- `ModeSegmentedControl`: Annual Recap / Detailed Analysis, 44px high, 12px container radius, tinted track, filled active segment, direct `aria-current`/selected semantics, and no horizontal scrolling at 1180px.
- `DashboardTabRail`: the existing eight routes in a 44px minimum-height rail with clear active indicator, hover/focus states, roving keyboard behavior, and horizontal overflow with visible edge fade/scroll cue. It remains subordinate to mode navigation.
- `ReportChapterNav`: compact sticky year/chapter navigation with current section label and progress; it must not resemble either mode segmentation or Dashboard tabs.

#### 9.8 App Shell and workflow status

The App Shell groups product identity, current local/privacy state, primary context, and secondary actions. The top area contains one product title, a quiet “本地处理 · 不上传” privacy badge, current mode/context, and subdued Privacy/Exit actions. `LOCAL CHAT ANALYSIS / DESKTOP ALPHA` may become a low-weight Beta/product badge but must not dominate the title.

A successful workflow collapses to one soft success row: check icon, “分析完成”, compact dataset range/message summary, and local completion badge. It must not repeat the same state in eyebrow, heading, and sentence. Detailed workflow panels appear only during processing, error, cleanup/recovery, or when the user expands diagnostics. Internal generation stays `DEVELOPER_ONLY`.

#### 9.9 Annual Recap composition and card variants

Annual Recap is not “Dashboard cards with nicer colors”. Every chapter prioritizes one dominant idea, one dominant metric or visualization, and one short explanation in this order:

```text
quiet eyebrow or chapter label
→ narrative headline / report lead
→ hero metric or visualization
→ concise explanatory metadata chips
→ optional details disclosure
```

No chapter card may place ten competing primary numbers. The logical sections vary composition using these semantic variants:

- `hero-card`: 24px radius, year/display heading, one lead, one primary metric/visual, directional scroll cue;
- `metric-card`: one tabular metric, unit, short definition, optional delta badge;
- `split-card`: two related roles or concepts with a shared headline, no nested border duplication;
- `chart-card`: header, primary insight, chart, direct legend/annotations, optional details;
- `word-card`: ranked terms/keywords with restrained tonal surface and accessible list;
- `narrative-card`: quote-like highlighted sentence with accent rail/icon, no fake quotation marks;
- `summary-card`: keepsake composition prepared for fixed PNG export;
- `privacy-callout`: privacy-toned icon, short warning, and optional disclosure.

Implementation uses one `BaseCard`/surface primitive plus semantic variant classes or data attributes. It MUST NOT create eight polymorphic card components merely to mirror this list; specialized `SummaryCard` or word-cloud composition is added only when structure/behavior differs materially.

Visual dimensions are responsive defaults, not pixel gates: chapter gap defaults to `clamp(40px, 6vw, 72px)` and narrows toward 32–48px; internal card gap defaults to 24px; content groups use 16/24/32px; hero target height uses content plus a bounded `clamp(360px, 58vh, 500px)` and is removed at zoom/narrow layouts; charts target 220–280px according to content; user-table rows default to 52px but may compact toward the 44px interactive/readability floor. Radius tokens remain defaults. Hard acceptance is hierarchy, reachability, no clipping/overflow, accessible target/focus/contrast, and unchanged semantics—not exact screenshots or forced empty space.

#### 9.10 Detailed Dashboard visual uplift

Detailed Analysis keeps every route, metric, chart alternative, filter, query, export, loading/error/recovery state, and keyboard behavior. This work belongs only to non-blocking B1b. Safe changes are scoped CSS, wrappers, presentation-only semantic markup, lightweight extraction of markup with identical props/callbacks, and native/accessibly controlled disclosure state. B1b may change typography, spacing, colors, radii, surfaces, buttons, control wrappers, filter toolbar, tabs, tables, chart containers, badges, status, disclosures, and metadata hierarchy.

B1b MUST NOT change Worker requests/protocols, `CanonicalAnalysisResult` or export DTOs, callback signatures or call timing, `canonicalQueryKey`, filter validation/commit, selected-year or threshold lifecycle, metric computation/order/values, route identity, pending-result retention, cancellation/stale suppression, result publication, or export payload/authority. Any desired uplift that cannot preserve those boundaries is deferred; it does not silently become a behavior refactor.

Allowed shared uplift includes:

- replace repeated full-outline containers with surface hierarchy and section spacing;
- apply the shared typography/button/control/chip/navigation/status system;
- convert the plain scope line into QueryChips while keeping exact context available;
- restyle existing tab semantics as `DashboardTabRail`;
- place charts in the fixed chart-card anatomy;
- use collapsed methodology summaries while retaining full text;
- demote schema/generation/definition IDs according to classification;
- keep dense engineering information accessible through deliberate disclosure.

`Words & Years` has a fixed default hierarchy: Section Summary → Key Visualization → Primary Ranking → Year Comparison → collapsed “查看逐年明细” table → collapsed “查看统计口径”. This is presentation-only markup reordering over the same `model/result` values. The two disclosure controls may own only local open/closed UI state; they do not fetch, recompute, filter, rerank, or alter callbacks. All current ranking, yearly values, keyword trace, summary trace, methodology, and engineering fields remain available. If this cannot be achieved without changing the existing data lifecycle, that subtask is deferred from B1b rather than changing behavior.

#### 9.11 Tables and chart containers

User-facing tables default to a 14px stronger header, 52px comfortable rows, 16px cell padding, subtle alternate/hover tone, muted secondary fields, tabular right-aligned numbers, and sparse horizontal separators; they may compact to a readable 44px floor when 1180×760 or zoom constraints require it. Dense methodology tables may use 40px rows and 12px padding. Wide tables get a labelled horizontal-scroll region, persistent first/context column where practical, and edge fade or explicit scroll cue; useful long tables may have a sticky header. A grid border around every cell is prohibited.

Every chart card uses Header → Primary Insight → Chart → Legend/Annotations → Optional Details. The primary insight is natural language, not a schema ID. Charts use owner/other semantic colors plus the three supporting palette colors as needed, with direct labels, numeric values, and non-color distinctions. Blue + gray is not the universal chart treatment. Exact accessible table/list data remains available.

#### 9.12 Responsive, states, and dark-mode boundary

Spacing scale is 4, 8, 12, 16, 24, 32, 48, 64, 72, 96. Report content max width is 1120px; readable prose is 720px/72ch. Focus ring is 3px with 3px offset; icon sizes are 16/20/24px; minimum interactive target is 44×44px. Skeletons use inset surfaces with a static block under reduced motion. Empty states use badge/status, title, reason, and one recovery action. Errors use icon, title, text, and semantic tint rather than a heavy full outline.

At 1180×760, Home is not crowded, both mode actions are visible, Annual Recap hero shows year + core conclusion + one main number + navigation/scroll cue, filter actions remain accessible, tab overflow is understandable, and the page has no horizontal scroll. At ≤760px CSS width or 200% zoom, toolbar groups and cards collapse to one column, navigation remains usable, and no fixed element covers focus. Dark mode remains explicitly token-reserved and deferred; B1 must not add a partial dark palette or toggle.

#### 9.13 CSS architecture and dependency policy

The repository currently imports one global `frontend/src/styles.css` and already scopes desktop rules beneath `.desktop-app`. Beta follows that architecture: CSS custom properties live beneath `.desktop-app.beta-enabled` (with intentional shared product primitives beneath `.desktop-app`), report rules beneath `.beta-report`, and Dashboard-uplift rules beneath `.desktop-app .dashboard-*`. No unprefixed Beta selector may restyle browser-v1. A separate imported Beta CSS file is acceptable only as file organization; it still uses these scope roots and does not introduce CSS Modules, Tailwind, CSS-in-JS, styled-components, or a UI framework.

Minimal inline SVG may provide icons with visible labels or accessible names. B1–B5 add no full icon library, remote asset/font, UI kit, motion library, or word-cloud dependency. Existing ECharts may continue existing charts; the Beta cloud uses the local deterministic layout/Canvas pipeline.

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

B1a/B1b do not build a motion abstraction for future use. They only ensure that content, focus, navigation, and meaning are complete in a static state and that any incidental CSS transition respects `prefers-reduced-motion`. The motion tokens/observer/reveals are introduced in B5 when they have a concrete consumer.

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

### 15. Luna Max implementation stages

| Stage | Goal | Main scope and dependency | Running UI | Acceptance | Model |
|---|---|---|---|---|---|
| B1a | Visual Foundation, App Shell and Annual Recap Skeleton | scoped custom properties/classes; semantic type/surface/BaseCard/control/status primitives; App Shell/workflow; Home; static logical-section/report-scene shell; synthetic hero/metric/narrative; no Dashboard-wide uplift | Yes | user first sees the runnable recap shell; 1180×760/narrow/a11y/static-state gates | Luna Max |
| B1b | Shared Detailed Dashboard Visual Uplift | presentation-only wrappers/CSS, tab rail/filter toolbar, Words & Years disclosures, table/chart treatments; depends B1a but blocks only B6 | Yes | exact props/callback/query/DTO/value/export/stale behavior remains unchanged | Luna Max |
| B2 | Presentation facts, locale presenter and core annual cards | `BetaReportQuery/Dto`, semantic adapter, fixed `zh-CN` presenter, report cache, logical sections 1–12; depends B1a/current Worker fields, not B1b | Yes | user first sees populated Annual Recap core metrics; exact semantic/template/empty/stale tests | Luna Max |
| B3 | Scoped word-frequency Worker DTO and list-first word sections | envelope/per-item contract, ranked per-scope candidate pool, built-in-policy denominator, raw+per-10k fields, custom presentation hiding, logical sections 13–14; depends B1a/current token index, may run parallel with B2 | Yes, list-first | no temporary B2 token adapter, no retokenization/source read, deterministic/cancel/privacy tests | Luna Max |
| B4 | Deterministic word cloud | seedless layout Worker, synthetic metrics, Canvas/bounded list, buckets/cache, logical section 15; depends B3 and B1a, not B1b | Yes | user first sees a real selected-scope word cloud; geometry/collision/a11y/diagnostic-performance tests | Luna Max |
| B5 | Summary/share scene, motion and two fixed PNG exports | logical section 16, motion/reduced motion, fixed 1200×1500 renderers, opaque binary lease/save contract; depends B2 and B4 | Yes | static fallback, privacy, raw IPC, PNG/save fencing tests | Luna Max |
| B6 | Packaged Beta acceptance | synthetic integration, `.app`, prototype `.dmg`, offline, docs; depends B1b and B5 | Packaged | packaged launch and synthetic vertical pass; no real data | Luna Max |

```text
B1a ─┬─→ B2 ─────────┐
     ├─→ B3 → B4 ────┼─→ B5 ──┐
     └─→ B1b ────────────────→ B6
```

B1a owns only the stable logical-section ID/order registry and typed composition slots. B2 fills sections 1–12 in core report modules; B3 fills sections 13–14 in separate word-evidence modules; B4 fills section 15; B5 fills section 16. B2 and B3 may therefore proceed independently after B1a without editing one temporary token adapter or the same implementation seam. B1b never blocks report facts or the cloud. Each implementation batch ends with scoped tests, `openspec validate beta-annual-recap-visual-experience --strict`, `git diff --check`, privacy/diff review, exact-path staging (never `git add ./-A/--all`), one intentional commit/push, clean workspace, and upstream `0/0`. Those Git actions are future implementation tasks, not actions in this planning batch. Sol High is reserved for contract/privacy re-freezing or a discovered cross-module conflict.

### 16. Screenshot-driven refinement backlog (recorded, not implemented by the hotfix)

The manual Beta screenshots establish the next UI-refinement scope: reduce the sticky year/chapter toolbar's weight and occlusion; replace the visually disconnected native-looking year select treatment; remove forced equal card heights and resulting empty space; consolidate repeated ready badges; collapse full month/weekday/hour/type tables behind progressive disclosure; reduce excessive serif display headings; restore editorial scene composition where cards have regressed into a dashboard; replace long Frequent Words/Keywords tables with a more readable progressive presentation; reduce dense tables; and stabilize Annual Recap scene rhythm. This backlog belongs to the later screenshot-driven UI refinement/B1b work and is intentionally not implemented in the annual-scope/Clean Mode hotfix.

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
- [Dashboard uplift could accidentally become a data-logic refactor or delay the recap] → Isolate it as B1b, retain exact component props/query callbacks/DTOs, and let only B6 depend on its completion.
- [Reducing borders could weaken grouping or accessibility] → Replace borders with explicit surface tone, spacing, heading structure, and restrained depth; keep borders for controls, selected states, focus support, and table separators.
- [Decorative hierarchy could hide methodology] → Collapse rather than delete methodology and engineering detail, preserve keyboard-accessible disclosures, and test that every current Words & Years field remains reachable.
- [First-year data may be partial or sparse] → Never infer export completeness; label full/partial query scope and use explicit insufficient states.
- [Long-image export could dominate delivery] → Defer chapter/long/multipage output; ship two fixed templates first.

## Migration Plan

1. Add B1a behind a local code-level Beta route constant defaulting on for synthetic tests; do not migrate or delete existing Dashboard state. B1b may then uplift Detailed Analysis independently.
2. Add locale-neutral presentation facts/adapters and the fixed `zh-CN` presenter against synthetic fixtures and existing result v3 before changing Worker output.
3. In parallel with step 2 after B1a, version-add the scoped token-frequency request/envelope, preserve current result validation/browser-v1 protocols, and land sections 13–14 list-first without a temporary B2 token adapter.
4. Add the seedless layout Worker/Canvas/bounded list for section 15; custom hiding remains presentation-only and Alpha Dashboard word tables remain unchanged.
5. Add the 1200×1500 renderer plus one-use lease/opaque binary PNG-save authority alongside `export_aggregate`; retain existing formats and approved chart keys.
6. Complete synthetic packaged acceptance after B1b and B5. Rollback at any stage is removal/disablement of the Beta entry while the detailed Dashboard and canonical result remain functional; no user data migration is required.

## Open Questions

No product or architecture question blocks implementation. During B4, measured packaged WebView fit-down may require a `beta-wordcloud-layout.v2`; changing synthetic geometry requires a version/key bump and Sol High review, not an unversioned tweak. During B5, the raw-body contract test precedes renderer integration; inability to carry a ≤10 MiB opaque PNG stops that batch for a bounded transport correction rather than falling back to base64/JSON bytes or granting renderer filesystem access.
