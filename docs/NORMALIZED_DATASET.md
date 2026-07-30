# Normalized local dataset

Stages 5–6 convert explicitly selected CipherTalk `detailed-json` sources into
one data-minimized local analysis dataset. All work is local and offline after
the approved runtime has been installed. The output remains private and must
stay under a Git-ignored path.

## Commands

Create a new dataset at an absent destination:

```bash
chat-history-analysis preprocess \
  --annual-source <annual-a.json> \
  --annual-source <annual-b.json> \
  --overlap-verification <optional-repeat-export.json> \
  --output-dir <ignored-parent/absent-dataset>
```

Annual inputs contribute records. Verification inputs are validated against
the annual dataset but never contribute a record, sender total, or date range.
The final destination must not already exist.

Compare one or more raw verification exports with an existing dataset without
modifying its manifest or chunks:

```bash
chat-history-analysis verify-overlap \
  --dataset-dir <ignored-parent/existing-dataset> \
  --overlap-verification <repeat-export.json>
```

## Ranking, overlap, and deduplication

Annual sources are ranked by:

1. actual minimum valid `createTime`;
2. actual maximum valid `createTime`;
3. explicit `--annual-source` order.

Gaps are accepted. Every pairwise annual range overlap is counted. An overlap
strictly greater than 31 days is also counted as
`SUSPICIOUS_ANNUAL_OVERLAP`; the condition is an aggregate warning, not a
failure.

A non-empty string `platformMessageId` uses the
`ChatHistoryAnalysis/dedup/platform-id/v1` SHA-256 identity and the independent
`ChatHistoryAnalysis/dedup/platform-id-verifier/v1` 16-byte BLAKE2b verifier.
Missing, empty, or non-string IDs use
`ChatHistoryAnalysis/dedup/fallback/v1` and
`ChatHistoryAnalysis/dedup/fallback-verifier/v1` over canonical minimized
fields and the cleaned-content SHA-256. Variable fields use unsigned 64-bit
big-endian length prefixes; `createTime` uses signed 64-bit big-endian.

Matching kind, SHA-256, and verifier is a duplicate. The survivor has the
lowest file rank and then the lowest original source-array index. A matching
kind/SHA-256 with a different verifier is fatal
`CRYPTOGRAPHIC_IDENTITY_COLLISION`. Raw IDs are discarded after digesting and
are never stored in SQLite or final output.

## Private staging

The preprocessor creates one unique sibling of the requested destination in
the selected output parent:

- process creation uses umask `0077`;
- staging directory mode is `0700`;
- marker, SQLite, manifest, and chunk modes are `0600`;
- staging and final parent must share a filesystem;
- no global database directory, generic shared temporary database, WAL,
  shared SQLite cache, cross-filesystem copy, or overwrite path exists.

The single SQLite table contains exactly:

```text
identity_kind, identity_digest, identity_verifier,
create_time, formatted_time, calendar_date, sender_scope, content,
file_rank, source_array_index
```

It has only the unique identity triple, the kind/digest collision lookup, and
the time/rank/original-index ordering structure. Before insertion the process
sets and reads back:

```text
PRAGMA journal_mode=DELETE
PRAGMA temp_store=MEMORY
PRAGMA secure_delete=ON
PRAGMA busy_timeout=0
```

`secure_delete=ON` supports logical cleanup but does not guarantee forensic or
cryptographic erasure, especially on SSD storage.

## Record and chunk schema

`normalizedSchemaVersion` is
`chat-history-analysis.normalized-record.v1`. Every NDJSON line has exactly
these fields in this order:

```json
{"createTime":0,"formattedTime":"1970-01-01 08:00:00","calendarDate":"1970-01-01","senderScope":"owner","content":"synthetic text","fileRank":0,"sourceIndex":0}
```

`senderScope` is `owner` or `other`. `sourceIndex` is the zero-based canonical
post-dedup index. Output order is `createTime`, file rank, and original
source-array index.

Lines are compact canonical UTF-8 JSON with one LF and no BOM. Actual encoded
bytes include that LF:

- one record and one chunk accept exactly 33,554,432 bytes;
- a 33,554,433-byte record is fatal;
- a chunk closes before the next complete record would exceed the limit;
- the first chunk is created only for the first record;
- no empty chunk is emitted;
- zero eligible records is fatal `NO_ELIGIBLE_TEXT_RECORDS`.

The inclusive normalized limits are 1,000,000 records and 134,217,728 bytes
for manifest plus chunks.

## Manifest contract

`manifest.json` uses schema
`chat-history-analysis.manifest.v1`. It is compact canonical UTF-8 JSON with
sorted object keys and one trailing LF. Its exact root fields are:

```text
aggregates
chunks
conversationFingerprint
inputs
normalizedSchemaVersion
preprocessorVersion
privacyValidation
schemaVersion
timePolicy
timeRange
```

Inputs contain only role, supplied ordinal, file rank (annual only), byte size,
and SHA-256. Chunks contain deterministic `chunk-0001.ndjson` names, byte
sizes, record counts, and SHA-256. Aggregates contain raw/eligible/normalized/
skipped/duplicate counts, owner/other totals, warnings, and overlap outcomes.
The time range is derived only from surviving records. Privacy validation must
be exactly `{"forbiddenFieldCount":0,"status":"passed"}`.

The manifest contains no source path, basename, raw identity, participant,
message ID, per-message hash, message fragment outside retained cleaned
content, or wall-clock generation time. The conversation fingerprint is
pseudonymous, not anonymous.

## Verification and atomic publication

Before publication the preprocessor:

1. closes and fsyncs every chunk and the manifest;
2. re-reads canonical JSON, exact schemas, sizes, counts, order, privacy rules,
   and SHA-256 from disk;
3. closes SQLite;
4. removes the database, marker, any sidecar, and every other non-output entry
   one explicit entry at a time;
5. verifies the exact remaining manifest/chunk set again;
6. re-hashes every raw input and compares file identity plus pass-one evidence;
7. fsyncs the candidate directory and parent;
8. performs one exclusive same-filesystem atomic directory rename.

Handled write, flush, integrity, cleanup, collision, or promotion failure
leaves the final destination absent. There is no overwrite, merge, delete of
an existing destination, copy fallback, or partial final dataset.

Identical inputs, roles, argument order, versions, and settings produce
byte-identical manifest and chunks.

Handled SIGINT uses the same close-and-explicit-cleanup path. Cancellation is
observed only at bounded safe checkpoints, never by raising from the signal
handler during SQLite or file writes. A request observed before the atomic
rename returns `USER_CANCELLED` with exit code `130`, removes staging, and
leaves the destination absent or preserves a destination that already existed.
If SIGINT arrives after the exclusive rename commit boundary begins, the one
validated atomic rename completes and the command reports success. Re-running
after a pre-commit cancellation can use the same absent destination normally.

## Explicit recovery

Abrupt process or OS termination can leave a marked private sibling. Recovery
never scans broadly or runs automatically:

```bash
chat-history-analysis recover-staging \
  --output-parent <explicit-existing-ignored-parent>

chat-history-analysis recover-staging \
  --output-parent <explicit-existing-ignored-parent> \
  --candidate-ordinal 1 \
  --confirm
```

Inspection reports only candidate counts, ordinals, and stable state codes.
Candidates must have the fixed prefix and exact marker, current-user
ownership, `0700` directory mode, only regular `0600` entries, no symlinks,
and direct containment in the selected parent. Each confirmed invocation
removes exactly one recognized candidate entry by entry. This is logical
cleanup only; it makes no forensic-erasure claim.
