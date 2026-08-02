# Canonical event dataset v2

The productization preprocessor has a separate v2 output mode. It consumes
the same streaming source validation and startup authorization as the v1 CLI,
but emits one minimized canonical event for every valid post-dedup source
record. The v1 normalized-record path remains unchanged.

## Event contract

Each NDJSON event contains exactly:

```json
{
  "createTime": 0,
  "formattedTime": "1970-01-01 08:00:00",
  "calendarDate": "1970-01-01",
  "senderScope": "owner",
  "messageCategory": "text",
  "textEligible": true,
  "content": "synthetic example",
  "fileRank": 0,
  "sourceIndex": 0
}
```

`messageCategory` is one of the fifteen contract categories in
`src/chat_history_analysis/canonical_event_v2.py`. System events use a null
sender and null content. Non-system events with valid sender/time are retained,
including `unknown` and ineligible `text` events. Content is retained only
after the existing text cleaning rule succeeds; media, identifiers, URLs,
XML-like values, and raw payloads never cross the output boundary.

The manifest and chunks are deterministic. `sourceIndex` is assigned in final
canonical order, which is ascending by create time, annual file rank, source
array index, and stable insertion order. A valid dataset may contain zero
eligible text events as long as at least one canonical event remains.

The output limits are 2,000,000 events, 536,870,912 manifest-plus-chunk bytes,
33,554,432 bytes per chunk, and 16,384 chunks.

## Identity and overlap handling

Platform message IDs use the existing domain-separated SHA-256/BLAKE2b
identity pair for every v2 category. Events without a platform ID use the
v2 fallback domain over canonical time, sender marker, category, safe
classification integers, and type-tagged transient content digests. A safe
`localId` may corroborate those signals but cannot identify an occurrence by
itself. If there is not enough comparable evidence, the occurrence is kept
and the aggregate warning count records the possible overcount.

Only identity digests are held in private SQLite staging. Raw IDs, local IDs,
raw content, and fallback evidence are discarded before publication. A digest
with a different verifier is a fatal cryptographic collision rather than a
deduplication match.

## Storage and protocol boundaries

v2 staging uses a private owner-only SQLite sibling with DELETE journaling,
in-memory temporary storage, secure delete, zero busy timeout, no WAL, and no
raw payload columns. The database and marker are removed entry by entry before
the private chunk/manifest directory is atomically promoted.

Desktop mode accepts an absent destination only beneath a core-created,
owner-only `analysis-sessions/<opaque-session-id>` directory. The desktop
policy is intentionally separate from the v1 CLI Git-ignore policy.

The sidecar receives one bounded big-endian length-prefixed strict-JSON
configuration over stdin. Paths appear only in that private input boundary.
Stdout is newline-delimited progress followed by one result; stderr contains
one structured failure. Protocol output contains only opaque session metadata,
stable phases, and aggregate-safe counts.

All examples and fixtures for this contract are synthetic. No private source
paths, names, identifiers, payloads, or real-data aggregates belong in this
document.
