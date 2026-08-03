# Productization Stage 7 analytics

Stage 7 implements the deterministic word, length, keyword, summary, and message-type metrics for the local desktop analytics Worker. It consumes the canonical index produced by the earlier stages and does not read raw chat files or private data.

## Runtime boundary

- `AnalysisWorkerRuntime.loadDataset` tokenizes each eligible canonical event once and stores token IDs plus cleaned Unicode-code-point lengths in the typed canonical index.
- Each `analyze` query performs one shared filtered record pass. The pass produces the existing aggregates, activity inputs, yearly token counts/message frequencies, and eligible-text length arrays together.
- Stage 7 derives its DTOs from those shared accumulators. It does not re-tokenize, re-parse, scan the full canonical index once per year, or return raw content, sender identifiers, source paths, or filenames.
- All Stage 7 computation runs in the Worker. The React surface is a typed DTO-to-table presentation layer with global date/sender filters and a local selected-year control.

The DTO schema is `chat-history-analysis.stage7-metrics.v1`. Its metric definition versions are explicit in `definitionVersions` and are checked at the result boundary.

## Metric semantics

### Cross-year vocabulary

The vocabulary is the top 20 token IDs by total raw count over the selected date/sender scope. Ties use ascending Unicode code-point order. Every represented calendar year is returned, including years with zero eligible tokens. Each cell contains raw count and `count * 10,000 / yearTokenTotal`; zero-token years return zero rates.

### Eligible-text length

Lengths use cleaned eligible text and JavaScript code-point iteration (`[...text].length`), not UTF-16 units, grapheme clusters, bytes, or token counts. Overall, owner, and other scopes each expose count, sum, mean, median, and p90. Empty scopes return null statistics. Mean is computed from the combined sum/count. Median and p90 use nearest rank `ceil(p*n) - 1`.

### Yearly keywords

Candidates must have at least 5 token occurrences and occur in at least 3 distinct eligible messages. For a multi-year selection, the score is smoothed year-vs-rest log odds:

```text
ln((c_y + 0.5) / (T_y - c_y + 0.5))
- ln((c_rest + 0.5) / (T_rest - c_rest + 0.5))
```

Only positive scores are returned. Ordering is score descending, count descending, then Unicode code-point ascending. A one-year scope uses the documented frequency fallback because no rest corpus exists. The DTO retains count, message frequency, year/rest token totals, and score for traceability. Partial-year labels are derived from the selected date bounds.

### Fixed summary and message types

Summary clauses are assembled in a fixed order from versioned aggregates and include filters, metric IDs, definition versions, and values. Tied peaks are listed canonically; unavailable metrics carry explicit omission reasons. No free-form generation, sentiment, relationship, or psychological inference is performed.

Message-type tables use the stable canonical category order. The denominator is filtered user messages, including eligible and ineligible text and unknown messages. System diagnostics are visible as a separate diagnostic count and remain outside that denominator. Empty categories remain present as zero buckets.

## Validation and privacy

`validateStage7Metrics` checks exact DTO keys, schema and definition versions, filter equality, year bounds, category order, length arithmetic, keyword thresholds/order/invariants, summary trace filters, and message-type reconciliation. The UI renders only validated derived DTOs.

Stage 8 metrics such as reply intervals and session initiators are not implemented here; the summary records them only as deferred omissions. The implementation is covered by deterministic unit fixtures, Worker cancellation and no-retokenization tests, presentation contract assertions, existing Stage 6 and v1 word-cloud regression suites, and repository privacy checks.
