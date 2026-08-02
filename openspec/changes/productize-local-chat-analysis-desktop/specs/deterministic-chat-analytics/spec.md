## ADDED Requirements

### Requirement: Canonical event dataset v2
The production preprocessor SHALL add a versioned canonical event record and manifest v2 for product analytics while preserving the exact v1 normalized-record and browser contract. Each post-dedup v2 record SHALL contain exactly safe-integer `createTime`, canonical `formattedTime`, canonical `calendarDate`, `senderScope` equal to `owner`, `other`, or `null`, a `messageCategory`, boolean `textEligible`, string-or-null `content`, non-negative `fileRank`, and monotonic canonical `sourceIndex`.

`messageCategory` SHALL be one of `text`, `image`, `voice`, `video`, `file`, `animated-emoji`, `structured`, `location`, `call`, `mini-program`, `reply`, `contact-card`, `system`, `other`, or `unknown`. A known system event SHALL use `senderScope: null`. A non-system event with valid canonical time and sender SHALL be a user message, including an `unknown` category. Cleaned content SHALL be present only when the existing exact eligible-text rule passes; every other event SHALL have `content: null` and SHALL preserve no raw, structured, media, URL, XML, identifier, participant, or path value.

V2 SHALL accept zero eligible text records when at least one canonical event exists. Desktop v2 limits SHALL be 2,000,000 canonical events, 536,870,912 aggregate manifest-plus-chunk bytes, and 33,554,432 bytes per chunk, subject to the mandatory synthetic performance gate. Browser v1 limits and rejection of zero eligible text SHALL remain unchanged.

#### Scenario: Normalize an eligible text event
- **WHEN** a post-dedup user message satisfies the existing text classification and cleaning rules
- **THEN** v2 contains its canonical time, sender, `text` category, `textEligible: true`, cleaned content, rank, and index and no forbidden field

#### Scenario: Normalize a media event
- **WHEN** a post-dedup message has valid canonical time and sender and a known image, voice, emoji, video, file, or other non-system category
- **THEN** v2 retains only canonical metadata, sets `textEligible: false` and `content: null`, and discards all payload and media metadata

#### Scenario: Normalize a system event
- **WHEN** a post-dedup record is classified as system with valid canonical time
- **THEN** v2 retains category and time, uses `senderScope: null`, and excludes it from user-message metrics

#### Scenario: Preserve an unknown type
- **WHEN** a record has valid canonical time and sender but an unrecognized safe classification
- **THEN** v2 retains it as `unknown`, increments an aggregate warning, and never guesses a text or media category

#### Scenario: Analyze a media-only dataset
- **WHEN** one or more canonical user events survive but no eligible text survives
- **THEN** v2 publishes successfully, non-text analytics remain available, and text-only panels show defined empty states

#### Scenario: Keep v1 compatible
- **WHEN** existing browser v1 tests run
- **THEN** v1 field sets, limits, hashes, importer behavior, word frequencies, and zero-eligible rejection remain unchanged

### Requirement: Event-wide deterministic deduplication
All v2 metrics SHALL consume only annual-source events after one preprocessor deduplication and canonical ordering pass. A valid string platform message ID SHALL reuse the existing domain-separated primary SHA-256 plus independent BLAKE2b verifier without persisting the raw ID. The v2 fallback SHALL use a new `ChatHistoryAnalysis/dedup/event-fallback/v2` domain and verifier domain over conversation fingerprint, canonical time, canonical sender marker, normalized category, safe raw classification integers, optional safe `localId` as one corroborating component, and cryptographic digests of type-tagged transient `content` and `rawContent` values. Raw values and fallback evidence SHALL be discarded after identity calculation.

Matching identity kind, digest, and verifier SHALL be one event; a matching digest with a different verifier SHALL remain fatal. `localId`, timestamp, category, sender, source index, or content alone SHALL NOT be an identity. When no platform ID and insufficient comparable fallback evidence exist, the preprocessor SHALL retain the occurrence rather than risk data loss, SHALL NOT deduplicate it across files, and SHALL increment a content-free `UNVERIFIABLE_EVENT_IDENTITY` warning.

#### Scenario: Deduplicate the same media event
- **WHEN** overlapping annual sources contain the same valid platform message ID for a media event
- **THEN** exactly one canonical v2 event survives

#### Scenario: Deduplicate without persisting payload
- **WHEN** a comparable event lacks a platform ID but has sufficient fallback evidence
- **THEN** transient hashes support deterministic comparison and neither raw payload nor evidence digest enters canonical output

#### Scenario: Preserve an unverifiable occurrence
- **WHEN** an event lacks both a platform ID and sufficient comparable fallback evidence
- **THEN** it is retained once for its source occurrence and the manifest records only an aggregate unverifiable-identity warning

#### Scenario: Handle overlap duplicates before metrics
- **WHEN** duplicate annual records cross a day, month, or year file boundary
- **THEN** deduplication completes before every bucket, sender share, streak, token, reply, and session metric is computed

### Requirement: Common population, time, filter, and result semantics
Analytics SHALL define a `user message` as a post-dedup v2 event with valid `owner` or `other` sender and category other than `system`. Unknown user categories SHALL be user messages. `Eligible text` SHALL mean `textEligible: true` with non-null cleaned content. System events SHALL be available only as a separate diagnostic type count and SHALL NOT contribute to trends, sender shares, activity, chat days, reply intervals, sessions, token metrics, or length.

All calendar derivation SHALL use the existing fixed UTC+08:00 policy, never host timezone or locale. The global date filter SHALL be inclusive at both calendar-date boundaries. The global sender filter SHALL apply to scope-aware metrics; intrinsically comparative sender, reply, and initiator metrics SHALL ignore it and visibly declare that scope. A local year selector SHALL further constrain year panels. One query SHALL use one immutable dataset generation, canonical filter object, and metric-definition version. Empty denominators SHALL return `null`, not `NaN`, infinity, or a fabricated zero percentage.

#### Scenario: Keep word eligibility metric-specific
- **WHEN** a user message is a media event or ineligible text
- **THEN** it contributes to all-user-message metrics but not token, keyword, or average-text-length metrics

#### Scenario: Apply inclusive dates
- **WHEN** events occur on the selected first and last UTC+08:00 calendar dates
- **THEN** both boundary dates contribute to every applicable metric

#### Scenario: Apply a sender filter
- **WHEN** the user selects owner or other
- **THEN** scope-aware trends, activity, types, text length, and word metrics recompute from that sender while comparative metrics keep both senders and label the exception

#### Scenario: Handle an empty filtered scope
- **WHEN** no applicable event remains after filters
- **THEN** counts are zero, ratios and duration statistics are null, arrays use the metric's defined empty shape, and the UI receives no fabricated conclusion

### Requirement: Daily, monthly, and yearly message trends
Daily, monthly, and yearly trends SHALL count post-dedup user messages of every category, including media, ineligible text, and unknown types, but excluding system events. Buckets SHALL use UTC+08:00 calendar day, `YYYY-MM`, and calendar year. The global date and sender filters SHALL apply before counting. The selector SHALL emit every bucket intersecting the selected interval, including zero-count buckets, in ascending order. A partial month or year SHALL contain only selected dates and SHALL carry `partial: true`.

The importer SHALL construct shared date-bucket indexes once in O(N); a trend query SHALL derive all three series from shared filtered aggregates in O(D + M + Y), not rescan messages separately per chart. The result SHALL be cached by dataset generation and canonical global filter. Daily SHALL render as a line/area chart, monthly as a column/line chart, and yearly as columns, with raw count, sender scope, fixed timezone, and partial-bucket status in accessible tooltips and tables.

#### Scenario: Count mixed message categories
- **WHEN** one day contains text, image, voice, emoji, and unknown user events plus a system event
- **THEN** the daily count includes the five user events and excludes the system event

#### Scenario: Fill temporal gaps
- **WHEN** no user message occurs in an interior day, month, or year bucket
- **THEN** the ordered trend contains that bucket with count zero

#### Scenario: Handle cross-boundary events
- **WHEN** events straddle day, month, and year boundaries in UTC+08:00
- **THEN** each event appears in exactly its canonical bucket

#### Scenario: Mark a partial period
- **WHEN** the date filter starts or ends inside a month or year
- **THEN** the affected aggregate is based only on selected dates and is labelled partial

### Requirement: Sender message counts and shares
Sender comparison SHALL count all post-dedup user messages within the inclusive date filter, grouped by `owner` and `other`, regardless of text eligibility or message category. It SHALL ignore the global sender filter because it is intrinsically comparative. Each share SHALL equal sender count divided by the two-sender total. Empty totals SHALL produce null shares; a single-sender population SHALL produce 100% and 0%. The shared base aggregate SHALL provide O(1) count derivation after date-bucket selection and cache by generation/date filter. The UI SHALL use two KPI counts plus a labelled 100% stacked bar or donut with count and denominator in its tooltip.

#### Scenario: Compare both senders
- **WHEN** both senders have messages in the selected dates
- **THEN** counts sum to the user-message total and shares sum to 100% subject only to display rounding

#### Scenario: Handle one sender
- **WHEN** only owner messages exist in the selected dates
- **THEN** owner is 100%, other is 0%, and no divide-by-zero or missing sender error occurs

#### Scenario: Handle no user messages
- **WHEN** only system events or no events remain
- **THEN** both counts are zero and both shares are null

### Requirement: Hour-of-day and weekday activity
Hour activity SHALL count post-dedup user messages in UTC+08:00 hours `00` through `23`. Weekday activity SHALL count the same population from Monday through Sunday using the canonical calendar date. The inclusive date and global sender filters SHALL apply. All 24 hours and all seven weekdays SHALL always be returned in fixed order with zeros for empty buckets. Import-time shared day/hour/weekday aggregates SHALL make selectors O(D) for selected days and SHALL be cached by generation and global filter. The UI SHALL use sender-consistent grouped or stacked columns and SHALL provide an accessible table with raw counts and percentages of the selected user-message population.

#### Scenario: Place midnight and late-night events
- **WHEN** user messages occur at local 00:00:00 and 23:59:59
- **THEN** they enter hour buckets 00 and 23 respectively

#### Scenario: Place weekday boundary events
- **WHEN** events fall on adjacent Sunday and Monday dates
- **THEN** each appears in its correct fixed-order weekday bucket

#### Scenario: Return an empty distribution
- **WHEN** no selected user message remains
- **THEN** 24 hour zeros and seven weekday zeros are returned with null percentages

### Requirement: Chat days and longest consecutive streak
A `chat day` SHALL be a UTC+08:00 calendar date containing at least one post-dedup user message in the active date and sender filters. One message by either selected sender is sufficient; system events alone are insufficient. Total chat days SHALL be the number of distinct qualifying dates. A consecutive streak SHALL be a maximal run of qualifying dates separated by exactly one calendar day. The selector SHALL recompute from filtered day flags in O(D), cache by generation/filter, and return length, start, and end for every longest tied interval in ascending start order.

The overview SHALL show total chat days and the earliest longest interval; when ties exist it SHALL state how many additional equal intervals exist and expose all intervals in the detail/table view. Empty input SHALL return zero days, zero streak length, and no interval.

#### Scenario: Count one-message chat days
- **WHEN** a selected date has exactly one qualifying user message
- **THEN** it counts as one chat day

#### Scenario: Recompute after sender filtering
- **WHEN** a date contains only other messages and the owner filter is active
- **THEN** that date is not a chat day for the filtered result

#### Scenario: Break a streak
- **WHEN** two qualifying dates have at least one missing calendar date between them
- **THEN** they belong to separate streaks

#### Scenario: Return tied streaks
- **WHEN** multiple maximal intervals have the same longest length
- **THEN** every interval is returned in ascending order and the earliest is the summary interval

#### Scenario: Clip at filter boundaries
- **WHEN** a longer full-dataset streak crosses the selected start or end date
- **THEN** only qualifying dates inside the filter form the displayed streak

### Requirement: High-frequency words across years
The yearly word-evolution metric SHALL use only tokens from eligible text after the existing deterministic Jieba, NFKC, lowercase, separator, numeric, minimum-length, and stop-word rules. Global date and sender filters SHALL apply before token aggregation. For each represented calendar year, it SHALL calculate raw token counts and normalized frequency per 10,000 included tokens. The display vocabulary SHALL be the top 20 tokens by total raw count across the filtered represented years, breaking ties by ascending Unicode code-point order; years and tokens with no occurrence SHALL remain as zeros.

Tokenization SHALL occur once during import. The analytics cache SHALL retain compact token IDs, record offsets, sender/date/year metadata, a shared token table, and year-token aggregates without full message text. A filter query SHALL perform one shared token pass or reuse a canonical result cache, not one scan per chart or year. The UI SHALL use a year-by-token heatmap with an accessible table and raw count plus normalized rate tooltips.

#### Scenario: Compare years with different volumes
- **WHEN** the same token occurs in years with different total token counts
- **THEN** the result exposes both raw count and per-10,000-token rate

#### Scenario: Select the vocabulary deterministically
- **WHEN** more than 20 tokens qualify and counts tie
- **THEN** total count then Unicode code-point order selects exactly 20

#### Scenario: Handle a year with no eligible text
- **WHEN** a represented user-message year contains no eligible token
- **THEN** the year remains visible with zero word values and no division error

### Requirement: Average eligible-text message length
Average message length SHALL use only post-dedup eligible text after the preprocessor has trimmed the ends, removed URL spans, replaced control/newline runs, and collapsed internal whitespace. Length SHALL be the number of Unicode code points in the retained cleaned content, including internal spaces and emoji code points; it SHALL not use UTF-16 code units, grapheme clusters, Jieba tokens, or bytes. Media, system, ineligible text, bracketed placeholders, XML-like content, URL-only content, and recall/system placeholders SHALL not contribute.

The selector SHALL apply inclusive date and global sender filters and SHALL return overall and per-sender message count, total code points, arithmetic mean, median, and p90. Overall mean SHALL be total code points divided by total eligible messages, not a mean of sender means. Percentiles SHALL use nearest-rank `ceil(p * n) - 1` on ascending integer lengths. Import SHALL cache one `Uint32` length per eligible record; queries SHALL be O(T log T) only for selected percentile ordering or use a cached histogram/order index. The UI SHALL use comparison KPIs and a compact distribution plot with exact unit and exclusions in the tooltip.

#### Scenario: Count Unicode code points
- **WHEN** cleaned text contains supplementary-plane emoji or a multi-code-point emoji sequence
- **THEN** each Unicode code point contributes one and the UI identifies the code-point unit

#### Scenario: Count cleaned whitespace
- **WHEN** raw eligible text contains leading, trailing, repeated, or newline whitespace and a URL
- **THEN** length uses the retained trimmed, URL-removed, single-space form

#### Scenario: Calculate overall and sender means
- **WHEN** both senders have eligible messages of different lengths and counts
- **THEN** per-sender values use their own messages and overall mean uses the combined sum and count

#### Scenario: Handle one or zero senders
- **WHEN** one sender or no sender has eligible text after filters
- **THEN** unavailable sender or overall statistics are null with their count zero

### Requirement: Deterministic yearly keywords
Yearly keywords SHALL be calculated locally from the same eligible token cache and SHALL make no network or model call. A candidate token for year `y` SHALL have raw count `c_y >= 5` and appear in at least three distinct eligible messages in that year. With at least two represented years and nonzero rest-of-years tokens, distinctiveness SHALL use smoothed year-versus-rest log odds:

`score = ln((c_y + 0.5) / (T_y - c_y + 0.5)) - ln((c_rest + 0.5) / (T_rest - c_rest + 0.5))`.

Only positive scores SHALL be distinctive keywords. Ranking SHALL be descending score, descending `c_y`, then ascending Unicode code-point token. The result SHALL expose raw count, year token total, rest count, rest total, distinct-message frequency, score, algorithm version, and thresholds so every keyword is traceable. If comparison is impossible because only one year is represented, the metric SHALL enter `frequency-fallback` mode and rank by count then Unicode order rather than fabricate distinctiveness. Global date/sender filters and the local year selection SHALL apply; a partial selected year SHALL be labelled partial. Results SHALL be cached by generation/filter/year. The UI SHALL use ranked keyword bars/cards with an explanation panel, not a word cloud alone.

#### Scenario: Rank a distinctive yearly token
- **WHEN** a candidate clears both thresholds and has positive smoothed log odds against other years
- **THEN** it appears with every score input and the fixed algorithm version

#### Scenario: Exclude a one-message spike
- **WHEN** a token repeats often in fewer than three distinct messages
- **THEN** it is not a yearly-keyword candidate

#### Scenario: Break keyword ties
- **WHEN** candidates have equal scores and counts
- **THEN** ascending Unicode code-point token order is authoritative

#### Scenario: Handle a single represented year
- **WHEN** filters leave eligible tokens in only one year
- **THEN** the result uses labelled frequency-fallback mode and does not claim relative distinctiveness

#### Scenario: Return no keywords
- **WHEN** no token clears thresholds or has a positive score
- **THEN** the panel shows an explicit insufficient-evidence empty state

### Requirement: Traceable yearly data summary
The yearly summary SHALL be a deterministic local template assembled only from versioned metric results. In fixed clause order it MAY include user-message total, sender counts/share, chat days and longest streak, peak month, peak hour, top message types, up to three yearly keywords, median reply interval per responder, and session initiator counts. Every rendered clause SHALL carry a machine-readable trace to metric ID, definition version, filters, and underlying aggregate values. A clause whose denominator or minimum evidence is unavailable SHALL be omitted with an explicit reason code.

The summary SHALL NOT use a language model, free-form generation, sentiment, relationship score, relationship quality claim, psychological inference, diagnostic statement, or prediction. Equal peaks SHALL list all tied labels in chronological or fixed bucket order. The UI SHALL present the summary as traceable fact cards or sentences with links to the source panels.

#### Scenario: Generate a supported yearly summary
- **WHEN** a year has sufficient deterministic aggregates
- **THEN** the template emits clauses in fixed order and every clause links to its source metric and values

#### Scenario: Handle tied peaks
- **WHEN** multiple months or hours share the maximum count
- **THEN** all ties are listed in canonical order rather than choosing one arbitrarily

#### Scenario: Omit unsupported claims
- **WHEN** replies, keywords, or another source metric lacks evidence
- **THEN** its clause is omitted with a stable reason and no substitute interpretation

#### Scenario: Verify safe language
- **WHEN** yearly summaries are snapshot-tested
- **THEN** outputs contain only allow-listed deterministic templates and no relationship, sentiment, or psychological judgement

### Requirement: Message-type counts and shares
Message-type analytics SHALL count post-dedup user messages by the exact v2 categories, apply inclusive date and global sender filters, and show raw counts plus share of selected user messages. `text` SHALL include eligible and ineligible text events as messages; the panel SHALL separately expose eligible-text count. `unknown` user events SHALL remain a visible category. System events SHALL be reported as a separate diagnostic count outside the user-message share denominator. Empty categories SHALL remain zero in the stable category order. Import-time type aggregates SHALL support O(D * C) selection and canonical caching. The UI SHALL use ordered bars or a table; small categories SHALL be grouped visually only if the accessible table retains exact individual counts.

#### Scenario: Count media and text types
- **WHEN** selected user events include text, image, voice, animated emoji, and other categories
- **THEN** each exact category receives its post-dedup count and shares use the total selected user messages

#### Scenario: Keep ineligible text in message totals
- **WHEN** a text event fails eligible-content filtering but has valid time and sender
- **THEN** it counts as a text message but not as eligible text

#### Scenario: Expose unknown and system separately
- **WHEN** unknown user events and system events exist
- **THEN** unknown contributes to user type share while system appears only as a diagnostic outside that denominator

#### Scenario: Filter one sender
- **WHEN** the owner filter is active
- **THEN** type counts and shares use owner user messages and the system diagnostic remains senderless

### Requirement: Reply interval semantics
Reply intervals SHALL be derived from post-dedup user messages sorted by `createTime`, `fileRank`, and canonical `sourceIndex`; system events SHALL be ignored and SHALL not bridge or split sessions. The shared inactivity threshold SHALL default to six hours and SHALL offer only reviewed presets of 1, 3, 6, 12, or 24 hours. A gap strictly greater than the threshold SHALL start a new conversation session; crossing midnight alone SHALL not. Within a session, a burst SHALL be a maximal consecutive run of messages from the same sender. A reply SHALL occur only when the next burst belongs to the other sender. Its interval SHALL be the first message time of the responding burst minus the last message time of the preceding burst.

Intervals SHALL not be numerically clipped: a gap greater than the threshold is excluded as a new session, a gap equal to the threshold is included, and same-timestamp replies are zero. Negative intervals after canonical ordering SHALL be rejected as an analytics integrity error. Date filtering SHALL include a reply only when both boundary messages lie inside the inclusive range. The global sender filter SHALL be ignored; results SHALL group by responder and return count, arithmetic mean, median, p25, p75, p90, and fixed duration-bin counts using nearest-rank percentiles. Threshold changes SHALL recompute one O(N) session/burst index with progress and cancellation and cache only the active threshold. The UI SHALL lead with responder medians, show an interval distribution, label threshold and excluded offline gaps, and avoid speed-as-quality language.

#### Scenario: Collapse consecutive messages into bursts
- **WHEN** one sender sends multiple consecutive messages before the other sender responds
- **THEN** exactly one reply interval uses the last outgoing timestamp and first responding timestamp

#### Scenario: Split a long offline gap
- **WHEN** the next message arrives more than the active inactivity threshold later
- **THEN** it starts a new session and creates no reply interval

#### Scenario: Include the exact threshold and cross-day replies
- **WHEN** a sender switch is separated by exactly the threshold or crosses midnight within the threshold
- **THEN** it remains one reply interval

#### Scenario: Handle same timestamp ordering
- **WHEN** canonical adjacent bursts switch sender at the same timestamp
- **THEN** the reply interval is zero and canonical source order is preserved

#### Scenario: Calculate both responders
- **WHEN** both senders respond in the selected range
- **THEN** each responder receives independent count, mean, median, percentiles, and histogram bins

#### Scenario: Handle no replies
- **WHEN** data is empty, single-sender, or contains only single-burst sessions
- **THEN** reply count is zero and duration statistics are null

### Requirement: Conversation sessions and initiators
Conversation-session initiators SHALL use the same post-dedup user-message order and inactivity threshold as reply intervals. A session SHALL begin at the first user message or after a gap strictly greater than the threshold; a new calendar day SHALL not itself create a session. The initiator SHALL be the sender of the first valid user message. Multiple opening messages by that sender SHALL count once. A single-message session SHALL count once. System events SHALL be ignored and shall neither initiate nor bridge a session.

The inclusive date filter SHALL include a session only when its opening user message lies inside the range. The global sender filter SHALL be ignored because the metric is comparative. Results SHALL return both counts and shares, session total, threshold, and a `sensitivityChanged` indicator when a non-default threshold is active. Sessionization SHALL be O(N) on threshold change and selectors SHALL reuse its cache. The UI SHALL use two counts and a labelled comparison bar, call the measure “会话开场次数”, and SHALL state that it is threshold-sensitive and not a relationship-quality measure.

#### Scenario: Count one initiator per session
- **WHEN** a sender opens with several messages before a reply
- **THEN** the session contributes one initiator count to that sender

#### Scenario: Count a single-message session
- **WHEN** one isolated user message forms a session
- **THEN** its sender receives one initiator count

#### Scenario: Continue across midnight
- **WHEN** two user messages cross midnight with a gap at or below the threshold
- **THEN** they remain in the same session

#### Scenario: Recompute threshold sensitivity
- **WHEN** the user selects another reviewed threshold preset
- **THEN** sessions, replies, initiator counts, shares, and sensitivity label recompute from the same canonical events

#### Scenario: Filter by session opening date
- **WHEN** a session starts before the selected range but continues inside it
- **THEN** it does not count as an initiator session for that filtered result

#### Scenario: Avoid relationship judgement
- **WHEN** initiator results are rendered or exported
- **THEN** language reports counts, shares, threshold, and filters only

### Requirement: Shared analytics Worker and aggregate layering
All complete-dataset import, v1/v2 schema validation, chunk hashing, event indexing, text tokenization, base aggregation, sessionization, and derived metric calculation SHALL run in one dedicated analytics Worker, not the renderer main thread or desktop core. The preprocessor SHALL own raw validation, minimization, deduplication, canonical serialization, and manifest integrity but SHALL NOT precompute filter-dependent dashboard results. The renderer SHALL own only commands, aggregate state, selectors that format already-derived results, charts, accessible tables, and export requests.

The Worker runtime SHALL accept an explicit runtime-validated request union:
`browser-file-source` for the existing v1 `File[]` compatibility path and
`desktop-dataset-source` for an opaque session/dataset capability plus session
generation. The desktop variant SHALL contain no path, filename, `cwd`,
`argv`, `env`, URL, or raw bytes. Both variants SHALL enter the same
`analysis.worker.ts` → `worker-handler.ts` → `worker-runtime.ts` production
path; a main-thread or fixed-chunk analysis fallback is forbidden.

The Worker SHALL layer:

1. exact source adapter and canonical record validation;
2. compact base indexes using typed arrays for time, date, sender, category, eligibility, length, token offsets, and canonical order;
3. shared filter aggregates and one active-threshold session index;
4. pure versioned derived metrics;
5. presentation DTO selectors with no message text.

Each accepted record SHALL be tokenized at most once. Chunk text and buffers SHALL be released before the next chunk. Result and index caches SHALL key on dataset generation, metric-definition version, canonical filters, year, and threshold. One query SHALL populate shared accumulators for all requested panels rather than scan the dataset separately per chart. Progress and safe cancellation checkpoints SHALL cover transport, hash, parse, index, tokenization, base aggregation, sessionization, and derived metrics. No complete-dataset main-thread, desktop-core, cloud, or Python analytics fallback SHALL exist.

#### Scenario: Build a compact index
- **WHEN** a valid v2 dataset is accepted
- **THEN** the Worker retains compact arrays and token IDs, releases normalized content after indexing, and returns only aggregates

#### Scenario: Recalculate shared panels
- **WHEN** global filters change
- **THEN** one versioned query updates all affected metrics atomically and no chart performs an independent full scan

#### Scenario: Cancel indexing or calculation
- **WHEN** cancellation is requested during import, tokenization, sessionization, or aggregation
- **THEN** the Worker stops at a checkpoint, discards the candidate result, and cannot overwrite a newer generation

#### Scenario: Reject fallback
- **WHEN** Worker creation, memory allocation, WASM initialization, or analytics fails
- **THEN** the UI reports a content-free local failure and complete-dataset work does not move to another process or cloud service

### Requirement: Supported-scale and determinism gate
Before the product analytics capability is declared Release-complete, purely synthetic datasets SHALL exercise 2,000,000 raw/canonical events, 536,870,912 aggregate v2 bytes, 33,554,432 bytes per chunk, multiple years, maximum token-cache pressure, each metric, filter changes, threshold changes, cancellation, restart, and deterministic rerun. Evidence SHALL record application/browser engine version, macOS version, architecture, hardware memory, input bytes/events/tokens, exact retained typed-array bytes, peak Worker or renderer memory where measurable, main-thread heartbeat, phase durations, cancellation acknowledgement, cached-query latency, and pass/fail without private data.

The unsigned Alpha foundation SHALL enforce those limits and bounded-memory
directions, and SHALL run representative multi-chunk and cancellation tests,
but it SHALL NOT claim the formal 512 MiB peak-memory or full 2,000,000-event
performance proof. That proof remains an unchecked Beta/Release hardening task
and must be completed before supported-scale or Release claims.

On the reference macOS arm64 system with 16 GiB memory, the gate SHALL require no process termination, no unexplained memory growth, maximum main-thread heartbeat gap below 250 ms, cancellation acknowledgement below 1,000 ms, p95 cached global-filter query below 2,000 ms, and conservative renderer-process-tree RSS below 1.5 GiB. If any limit cannot pass with the specified compact or partitioned representation, implementation SHALL stop, leave the task incomplete, and revise OpenSpec before reducing limits or claiming support.

All metrics, keyword ordering, summaries, buckets, percentiles, and serialized aggregate DTOs SHALL be byte-identical for the same canonical dataset, metric versions, filters, year, and threshold, except explicitly non-deterministic chart pixel placement. Stable sorting SHALL use numeric order, chronological order, fixed category order, or Unicode code-point order as specified.

#### Scenario: Pass the maximum synthetic gate
- **WHEN** every required synthetic maximum and interaction profile satisfies the recorded thresholds
- **THEN** the 2,000,000-event desktop contract may be marked supported

#### Scenario: Fail the maximum synthetic gate
- **WHEN** any profile crashes, exceeds the justified memory envelope, blocks the main thread, misses cancellation, or misses cached-query latency
- **THEN** capacity remains incomplete and implementation does not silently lower a limit, duplicate full text, move work to the main thread, or use cloud fallback

#### Scenario: Repeat analytics deterministically
- **WHEN** the same synthetic v2 dataset and query run repeatedly or after Worker restart
- **THEN** every aggregate DTO and trace value is byte-identical

### Requirement: Metric semantic fixture matrix and privacy
Every core metric SHALL have synthetic unit and Worker-integration fixtures for normal data, empty filters, single sender, same timestamp, deliberately out-of-order source records normalized into canonical order, overlap duplicates, cross-day, cross-month, cross-year, unknown type, system event, extreme reply interval, cancellation, and deterministic rerun. Average length SHALL add Unicode, emoji sequence, URL, and newline cleaning cases. Keywords SHALL add threshold, tie, one-year fallback, and no-candidate cases. Sessions SHALL add threshold equality, midnight continuation, long-offline split, multiple bursts, and single-message sessions.

Fixtures SHALL use fabricated participants, content, identifiers, paths, timestamps, and distributions. Tests, snapshots, logs, reports, and committed evidence SHALL contain no real message, name, path, hash, date range, aggregate, token, or inferred relationship statement. Tests that require private data SHALL remain outside automation and behind the existing explicit authorization gates.

#### Scenario: Run the semantic matrix
- **WHEN** analytics unit and integration suites execute
- **THEN** every metric covers the common matrix plus its specified metric-specific cases using only synthetic data

#### Scenario: Cancel each long metric phase
- **WHEN** synthetic hooks request cancellation at import, tokenization, base aggregation, sessionization, keyword scoring, or result assembly
- **THEN** no partial or stale result becomes current

#### Scenario: Audit fixture privacy
- **WHEN** source, snapshots, logs, build output, and aggregate evidence are inspected
- **THEN** all chat-shaped values are explicitly synthetic and no private value is present
