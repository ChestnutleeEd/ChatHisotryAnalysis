# Productization Stage 8 analytics

Stage 8 adds deterministic reply-interval and conversation-session metrics to
the existing canonical v2 Worker path. It uses only synthetic fixtures in
automation. The browser v1 normalized-file workflow remains unchanged.

## Definitions

- Canonical user events are ordered by `createTime`, `fileRank`, then
  `sourceIndex`. System events are excluded from session boundaries and do not
  bridge a gap.
- The reviewed inactivity presets are 1, 3, 6, 12, and 24 hours. The default
  is 6 hours. A gap strictly greater than the active threshold starts a new
  session; a gap equal to the threshold remains in the same session. Midnight
  alone never starts a session.
- A burst is a maximal consecutive run of events from one sender. A reply
  interval is the first event of the responding burst minus the last event of
  the preceding burst. Intervals are non-negative integer seconds; same-time
  replies are zero. Long offline gaps are session boundaries rather than reply
  intervals.
- Reply results require both boundary messages inside the inclusive date
  filter. Reply and initiator metrics always include both senders; the global
  sender filter does not apply.
- A session initiator is the sender of its first valid user message. Sessions
  are filtered by their opening message date. Unknown sender codes, if ever
  encountered at an internal boundary, remain in an `unknown` bucket and never
  create a guessed direction.
- Percentiles use nearest rank. The DTO records count, arithmetic mean,
  p25/median/p75/p90, and fixed second-based duration bins. Empty populations
  use zero counts and null duration statistics.

## Worker and result contract

The Worker builds one O(N) session/burst index for the active threshold and
keeps only that threshold in the runtime cache. A threshold change starts a
new operation generation, cooperatively cancels the previous operation, and
cannot publish stale progress, errors, or results. The threshold is part of
the canonical query key. Canonical parsing and tokenization are reused; they
are not repeated for threshold queries.

The versioned result is `chat-history-analysis.analytics-result.v3` and adds
`replySessions` beside the existing Stage 5–7 fields. It contains no message
body, participant name, identifier, source path, or raw event object. The
validated DTO records the effective threshold and dataset/session/generation
correlation inherited from the result envelope.

## UI boundary

The desktop results view exposes a threshold preset control, reply-pair and
direction tables, fixed duration bins, initiator counts/shares, loading and
empty states, and the sender-filter exception. Wording describes counts,
distributions, intervals, and thresholds only. It does not infer attention,
affection, relationship quality, personality, or other psychological meaning.

## Validation

The Stage 8 fixture suite covers same-sender bursts, alternating senders,
exact and greater-than threshold gaps, midnight continuation, system
interleaving, same timestamps, date boundaries, single-sender/no-reply data,
deterministic reruns, threshold recomputation, cancellation, cache reuse,
accessible table models, and privacy-safe copy. Fixtures use fabricated
timestamps and content; no private storage is discovered or opened.

The profiling smoke uses 20,000 synthetic events across two chunks (the first
holds 4,096 records) and nine distinct filter/threshold queries. It verifies one indexed
dataset is reused, every query returns the Stage 8 DTO, serialized results are
non-empty, and the bounded result-cache hit/eviction behavior is covered by
the Worker integration suite. This is an interaction and complexity smoke,
not the deferred Stage 12 two-million-event capacity claim.
