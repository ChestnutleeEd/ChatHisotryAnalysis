## ADDED Requirements

### Requirement: Local preprocessing CLI inputs
The system SHALL provide a local macOS Python CLI that accepts one or more explicitly designated `annual source` CipherTalk `.json` files, zero or more explicitly designated `overlap verification` files, and one ignored local output directory. Equivalent repeated arguments SHALL be `--annual-source`, `--overlap-verification`, and `--output-dir`; roles SHALL NOT be inferred from file or directory names. The CLI SHALL process local files without modifying them or making a network request.

#### Scenario: Select multiple annual sources
- **WHEN** the user supplies one or more readable files with the annual-source role
- **THEN** the CLI treats only those files as contributors to the complete-history dataset

#### Scenario: Select an overlap verification source
- **WHEN** the user supplies a readable file with the overlap-verification role
- **THEN** the CLI uses it only for repeat-export consistency checks and never adds its records or time range to the dataset

#### Scenario: Require explicit roles
- **WHEN** a JSON path is present only through a directory convention or suggestive filename
- **THEN** the CLI does not infer a role or include that path

#### Scenario: Require an output directory
- **WHEN** preprocessing starts without an explicit output directory
- **THEN** the CLI rejects the invocation before reading message records

#### Scenario: Preserve raw sources
- **WHEN** preprocessing succeeds, fails, or is cancelled
- **THEN** every raw CipherTalk export remains byte-for-byte unchanged

#### Scenario: Run preprocessing offline
- **WHEN** all external network access is blocked
- **THEN** source validation, normalization, deduplication, and output generation can complete using local dependencies and files

### Requirement: Raw preprocessing capacity
The supported preprocessing limits SHALL be 536,870,912 bytes per raw input file, 20 annual-source files, 2,147,483,648 aggregate raw bytes across all roles, and 2,000,000 aggregate raw message entries across all roles. These SHALL be supported MVP limits rather than claims about absolute hardware capacity. A limit failure SHALL be fatal and SHALL NOT produce or promote a partial normalized dataset.

#### Scenario: Accept exact per-file raw limit
- **WHEN** an otherwise supported raw input is exactly 536,870,912 bytes and all aggregate limits remain satisfied
- **THEN** preprocessing permits the file

#### Scenario: Reject oversized raw file
- **WHEN** any raw input is greater than 536,870,912 bytes
- **THEN** preprocessing rejects the dataset before parsing that file

#### Scenario: Accept exact annual-source count
- **WHEN** exactly 20 annual-source files satisfy every other constraint
- **THEN** preprocessing permits the annual-source set

#### Scenario: Reject too many annual sources
- **WHEN** more than 20 annual-source files are supplied
- **THEN** preprocessing rejects the invocation before message parsing

#### Scenario: Accept exact aggregate raw size
- **WHEN** aggregate raw input size is exactly 2,147,483,648 bytes and every other limit is satisfied
- **THEN** preprocessing permits the input set

#### Scenario: Reject excessive aggregate raw size
- **WHEN** aggregate raw input size is greater than 2,147,483,648 bytes
- **THEN** preprocessing rejects the input set before message parsing

#### Scenario: Accept exact aggregate message limit
- **WHEN** streaming validation observes exactly 2,000,000 raw message entries and every other limit is satisfied
- **THEN** preprocessing may complete

#### Scenario: Reject excessive aggregate messages
- **WHEN** streaming validation observes a 2,000,001st raw message entry
- **THEN** preprocessing aborts the candidate dataset, removes temporary output, and reports a content-free limit error

### Requirement: Streaming CipherTalk validation
The preprocessor SHALL open each raw source in binary mode, validate UTF-8 with strict fatal behavior, and stream exactly one top-level JSON value without loading all annual files or a complete large source simultaneously. It SHALL accept only an object root containing object `exportInfo`, object `session`, array `messages`, `exportInfo.format` exactly `detailed-json`, and an unambiguous private session. It SHALL use bounded validation/range and final-ranked staging passes so `fileRank` is known before insertion, and SHALL verify the source hash on every post-digest pass to reject mutation without adding a source identifier to SQLite.

#### Scenario: Stream a supported export
- **WHEN** a source has valid UTF-8, one valid detailed-JSON object, a private session, and a messages array
- **THEN** the preprocessor visits messages sequentially and retains only bounded per-record and aggregate state

#### Scenario: Reject invalid UTF-8
- **WHEN** strict incremental decoding encounters an invalid byte sequence
- **THEN** the source produces a fatal encoding error without replacement characters or source excerpts

#### Scenario: Reject malformed JSON
- **WHEN** the streaming parser encounters malformed, incomplete, commented, or multiple-top-level JSON
- **THEN** the source produces a fatal parse error without content in the error

#### Scenario: Reject wrong export format
- **WHEN** `exportInfo.format` is missing or not exactly `detailed-json`
- **THEN** the source produces a fatal unsupported-format error

#### Scenario: Reject unsupported top-level structure
- **WHEN** the root, `exportInfo`, `session`, or `messages` has an unsupported type
- **THEN** the source produces a fatal structural error naming only the field and expected type

#### Scenario: Reject group or ambiguous chat
- **WHEN** `session.isGroup` is not exactly `false`, `session.type` does not indicate private chat, or the two conflict
- **THEN** the source produces a fatal unsupported-session error

#### Scenario: Reject source mutation between passes
- **WHEN** a source's recomputed hash differs from its first-pass digest during validation or staging
- **THEN** preprocessing fails without staging or promoting a mixed-version dataset

### Requirement: Preprocessing runtime startup gate
Before opening any raw source, the CLI SHALL verify the complete supported runtime tuple and initialize the streaming parser. The MVP runtime matrix SHALL be CPython `>=3.12.0,<3.13.0` on macOS `arm64`; every other interpreter implementation, Python minor, operating system, or architecture SHALL be unsupported until this OpenSpec is revised. The gate SHALL verify installed `ijson` version exactly `3.5.1`, require the installed distribution SHA-256 to match an approved hash for the exact runtime/platform tuple, select exactly `ijson.backends.yajl2_c`, prohibit automatic or Python-backend fallback, and complete a minimal in-memory parser initialization self-check. Startup failure output SHALL follow the project error-output privacy allow-list.

#### Scenario: Reject an unsupported Python runtime
- **WHEN** the interpreter is not CPython 3.12.x on macOS arm64
- **THEN** startup fails with reason code `UNSUPPORTED_PYTHON_RUNTIME` before any raw source is opened

#### Scenario: Reject the wrong ijson version
- **WHEN** the installed `ijson` version is not exactly 3.5.1
- **THEN** startup fails with reason code `IJSON_DISTRIBUTION_UNVERIFIED` before any raw source is opened

#### Scenario: Reject an unapproved distribution hash
- **WHEN** the installed `ijson` distribution hash is absent from the approved list for the exact runtime/platform tuple
- **THEN** startup fails with reason code `IJSON_DISTRIBUTION_UNVERIFIED` before any raw source is opened

#### Scenario: Reject a missing native backend
- **WHEN** `ijson.backends.yajl2_c` cannot be imported
- **THEN** startup fails with reason code `IJSON_BACKEND_UNAVAILABLE` and does not select another backend

#### Scenario: Reject an unexpected backend
- **WHEN** runtime inspection shows that the selected parser backend is not exactly `yajl2_c`
- **THEN** startup fails with reason code `IJSON_BACKEND_MISMATCH`

#### Scenario: Reject parser initialization failure
- **WHEN** the minimal in-memory parser self-check raises or produces an unexpected event sequence
- **THEN** startup fails with reason code `IJSON_PARSER_INITIALIZATION_FAILED` without exposing an exception excerpt

#### Scenario: Pass the startup gate
- **WHEN** the runtime tuple, exact version, approved distribution hash, backend identity, and parser self-check all pass
- **THEN** and only then may the CLI open the first raw source

### Requirement: Same-conversation validation
Before merging, the preprocessor SHALL compare every annual source's format, platform, private/group status, owner identity, peer identity, and observed participant set transiently. It SHALL derive a pseudonymous conversation fingerprint as lowercase hexadecimal SHA-256 over a versioned, length-prefixed canonical private-session identity representation. Raw session identifiers or names SHALL NOT be written beside the fingerprint or into normalized artifacts.

#### Scenario: Accept the same conversation
- **WHEN** all annual sources have the same canonical private-session identity and participant set
- **THEN** preprocessing uses one conversation fingerprint for the dataset

#### Scenario: Reject a different conversation
- **WHEN** any annual source differs in owner identity, peer identity, participant set, platform, or private-session status
- **THEN** preprocessing fails the complete dataset before final output promotion

#### Scenario: Avoid fingerprint ambiguity
- **WHEN** canonical identity components contain arbitrary Unicode or separator characters
- **THEN** versioned length-prefix encoding produces an unambiguous SHA-256 input

#### Scenario: Treat the fingerprint as pseudonymous
- **WHEN** the fingerprint is written to the local manifest
- **THEN** no raw identity value is stored with it and documentation identifies it as pseudonymous rather than anonymous

### Requirement: Overlap verification behavior
Overlap verification SHALL compare an optional verification source with the annual-source dataset using the same validation and identity rules, SHALL report only aggregate consistency outcomes, and SHALL never modify annual-source totals. If verification is requested in the preprocessing invocation and fails, final output SHALL NOT be promoted; the user MAY rerun preprocessing without verification or run a separate read-only verification command.

#### Scenario: Confirm complete overlap
- **WHEN** every verification record matches an annual-source identity
- **THEN** the CLI reports aggregate complete-overlap success without adding records

#### Scenario: Confirm partial overlap
- **WHEN** only part of a valid verification source matches annual-source identities
- **THEN** the CLI reports aggregate partial-overlap counts and rates without adding records

#### Scenario: Reject different-session verification
- **WHEN** a verification source represents another conversation
- **THEN** verification fails without altering annual-source state or totals

#### Scenario: Fail combined preprocessing verification
- **WHEN** verification was requested in a preprocessing invocation and any verification source is invalid or unverifiable
- **THEN** no final normalized output is promoted

#### Scenario: Run separate verification
- **WHEN** the user invokes the read-only verification operation against an existing valid normalized dataset
- **THEN** it reports aggregate results without changing manifest or chunk bytes

### Requirement: Message classification hierarchy
The preprocessor SHALL use integer `chatLabType` as the primary classifier with mappings 0 text, 1 image, 2 voice, 3 video, 4 file, 5 animated emoji, 7 structured/link/other application content, 8 location, 23 call, 24 mini-program/share, 25 reply, 27 contact card, 80 system, and 99 other/special transaction content. It SHALL use string `type` for consistency validation and conservative fallback. It SHALL retain `localType` only transiently as raw safe-integer metadata and SHALL NOT use it as the sole classifier or identity.

#### Scenario: Classify a known chatLabType
- **WHEN** a record contains a documented integer `chatLabType`
- **THEN** the preprocessor assigns the documented normalized category

#### Scenario: Conserve a conflicting non-text record
- **WHEN** `chatLabType` conflicts with `type` and either signal indicates image, media, system, or structured content
- **THEN** the preprocessor excludes the record from text analysis and increments an aggregate classification-conflict warning

#### Scenario: Retain an unknown primary code
- **WHEN** `chatLabType` is an unknown integer
- **THEN** the record is conservatively non-text and an aggregate unknown-type counter is incremented

#### Scenario: Validate safe localType
- **WHEN** `localType` is an integer within JavaScript safe-integer range, including a value above signed 32-bit range
- **THEN** the preprocessor accepts it as raw metadata without bitwise operations, 32-bit casts, or `Int32Array` storage

#### Scenario: Reject unsafe localType
- **WHEN** `localType` is non-integer or outside JavaScript safe-integer range
- **THEN** preprocessing reports a fatal unsafe-integer dataset error

#### Scenario: Avoid provisional localType 49 classification
- **WHEN** a structured record does not use `localType=49`
- **THEN** classification remains based on `chatLabType` and `type` rather than assuming 49 is canonical

### Requirement: Eligible text-message rule
A raw message SHALL be eligible for normalized text output only when `chatLabType === 0`, `type === "文本消息"`, `localType === 1`, and `content` is a non-empty string. Any classification conflict SHALL exclude the record and increment a content-free aggregate warning. Eligible content SHALL then exclude bracketed media/system placeholders, XML-like content, URL-only content, content empty after URL removal, and malformed values; mixed human-readable text SHALL remain after URL spans are removed.

#### Scenario: Accept fully agreeing text
- **WHEN** all three text signals agree and non-empty string content survives content filtering
- **THEN** one normalized text record is produced

#### Scenario: Exclude conflicting text signals
- **WHEN** any one of the three text signals does not match the eligible-text rule
- **THEN** the record is excluded and only an aggregate conflict counter changes

#### Scenario: Exclude bracketed placeholder
- **WHEN** otherwise eligible content is a recognized bracketed media or system placeholder
- **THEN** the record is excluded before normalized output

#### Scenario: Exclude XML-like content
- **WHEN** otherwise eligible content is XML-like
- **THEN** the record is excluded without parsing or recording the XML

#### Scenario: Exclude URL-only content
- **WHEN** URL removal leaves no human-readable text
- **THEN** the record is excluded

#### Scenario: Retain mixed text
- **WHEN** content contains both a URL span and remaining human-readable text
- **THEN** the URL span is removed and the remaining text is normalized

#### Scenario: Exclude malformed content
- **WHEN** content is null, non-string, or empty after trimming
- **THEN** the record is skipped with an aggregate non-content-bearing reason

### Requirement: Canonical time and file ranking
The preprocessor SHALL treat `createTime` as integer Unix seconds and strict `formattedTime` as `YYYY-MM-DD HH:mm:ss` at fixed UTC+08:00, independent of host timezone. Actual message timestamps SHALL define source ranges. Annual files SHALL rank by minimum valid `createTime`, then maximum valid `createTime`, then stable user-supplied annual-source order; filenames SHALL NOT determine dates or rank.

#### Scenario: Validate matching time fields
- **WHEN** both time fields are valid and agree at UTC+08:00
- **THEN** the preprocessor preserves them and derives the matching calendar date

#### Scenario: Handle a time-field mismatch
- **WHEN** both time fields are valid but disagree
- **THEN** the record is skipped with an aggregate time-conflict reason rather than using host-local interpretation

#### Scenario: Reject unusable time
- **WHEN** a candidate text record lacks either required valid canonical time field
- **THEN** the record is skipped with an aggregate malformed-time reason

#### Scenario: Rank independently of filename
- **WHEN** lexical filename order conflicts with actual validated ranges
- **THEN** minimum time, maximum time, and supplied order determine file rank

#### Scenario: Allow annual gaps
- **WHEN** ranked annual ranges have a period with no messages
- **THEN** preprocessing permits the gap and records non-sensitive range metadata

#### Scenario: Handle annual overlap
- **WHEN** annual ranges overlap
- **THEN** preprocessing deduplicates overlapping records and emits an aggregate overlap warning when the overlap is suspiciously large

#### Scenario: Reject out-of-policy wall time
- **WHEN** a record cannot be deterministically interpreted under the UTC+08:00 policy
- **THEN** it cannot enter normalized output

### Requirement: Private-chat sender semantics
Numeric integer `isSend` SHALL be authoritative: `1` SHALL map to `senderScope: "owner"` and `0` SHALL map to `senderScope: "other"`. The preprocessor SHALL NOT coerce booleans, strings, nulls, or other numbers. Owner and sender metadata SHALL be transient consistency inputs only; conflicts SHALL be recoverable aggregate warnings when valid `isSend` exists.

#### Scenario: Normalize owner scope
- **WHEN** eligible text has integer `isSend` equal to 1
- **THEN** its normalized sender scope is `owner`

#### Scenario: Normalize other scope
- **WHEN** eligible text has integer `isSend` equal to 0
- **THEN** its normalized sender scope is `other`

#### Scenario: Reject invalid sender scope
- **WHEN** `isSend` is missing, boolean, string, null, non-integer, or not 0 or 1
- **THEN** the record is skipped with an aggregate invalid-sender reason

#### Scenario: Warn on metadata conflict
- **WHEN** valid `isSend` conflicts with owner or sender metadata
- **THEN** `isSend` remains authoritative and an aggregate warning is incremented without exposing an identifier

### Requirement: Cross-file deduplication and canonical order
The preprocessor SHALL compute identity digests immediately while streaming. Canonical encodings SHALL begin with their fixed UTF-8 domain and encode every following variable-length byte field with one unsigned 64-bit big-endian length prefix followed by exactly that many bytes; fixed-width integers SHALL use signed 64-bit big-endian representation. Conversation-fingerprint bytes SHALL be the exact 32 bytes decoded from its validated 64-character lowercase hexadecimal form. A valid platform ID primary encoding SHALL use domain `ChatHistoryAnalysis/dedup/platform-id/v1`, conversation-fingerprint bytes, and exact UTF-8 `platformMessageId` bytes. Its primary key SHALL be SHA-256 of that encoding. Its independent verifier SHALL be BLAKE2b with a 16-byte digest over the same fields under distinct domain `ChatHistoryAnalysis/dedup/platform-id-verifier/v1`.

For an absent, empty, or non-string platform ID, fallback encoding SHALL use domain `ChatHistoryAnalysis/dedup/fallback/v1`, conversation-fingerprint bytes, signed-64-bit `createTime`, UTF-8 `formattedTime`, UTF-8 authoritative `senderScope`, UTF-8 normalized message-type code, and the 32-byte SHA-256 digest of cleaned content. Its primary key SHALL be SHA-256 of that encoding; its 16-byte BLAKE2b verifier SHALL use the same fields under domain `ChatHistoryAnalysis/dedup/fallback-verifier/v1`. Raw cleaned content SHALL NOT be placed in either identity encoding when its content hash is sufficient.

The preprocessor SHALL store only identity kind, 32-byte primary digest, and 16-byte verifier for identity comparison. Raw `platformMessageId` SHALL remain a string only until these values are computed, SHALL never be numerically parsed, logged, stored in SQLite, or written to normalized output, and SHALL then be discarded. Same identity kind, primary digest, and verifier SHALL mean duplicate identity. The same identity kind and primary digest with a different verifier SHALL be a fatal `CRYPTOGRAPHIC_IDENTITY_COLLISION` integrity error: preprocessing SHALL stop, promote no output, and reveal no identifier, content, hash, or path. The implementation SHALL NOT resolve that condition by retaining both records or selecting an occurrence. It SHALL NOT use `localId`, timestamp, or source-array index alone as identity.

#### Scenario: Deduplicate by platform identifier
- **WHEN** two records in annual sources have the same valid string platform identifier and conversation fingerprint
- **THEN** only the deterministically earliest ranked occurrence survives

#### Scenario: Keep decimal-looking identifiers as strings
- **WHEN** a platform identifier contains only decimal digits
- **THEN** it remains a string until immediate digest calculation, is never numerically parsed, and is then discarded

#### Scenario: Deduplicate by fallback identity
- **WHEN** a record lacks a valid platform identifier and its fallback fingerprint matches another annual-source record
- **THEN** only the deterministically earliest ranked occurrence survives

#### Scenario: Confirm a duplicate with both digests
- **WHEN** identity kind, SHA-256 primary digest, and BLAKE2b-128 verifier all match
- **THEN** the records are treated as the same identity

#### Scenario: Stop on a simulated primary-digest collision
- **WHEN** the same identity kind and SHA-256 digest is encountered with a different BLAKE2b-128 verifier
- **THEN** preprocessing fails with `CRYPTOGRAPHIC_IDENTITY_COLLISION` and promotes no output

#### Scenario: Separate primary and fallback domains
- **WHEN** otherwise equivalent field bytes are encoded as a primary identity and a fallback identity
- **THEN** distinct fixed domains prevent cross-kind identity equality

#### Scenario: Avoid ambiguous lengths
- **WHEN** variable-length fields can be partitioned into the same concatenated bytes in more than one way
- **THEN** unsigned 64-bit length prefixes produce different canonical encodings

#### Scenario: Avoid raw-content map keys
- **WHEN** fallback identity requires content
- **THEN** a cryptographic content hash rather than raw content is used in identity maps

#### Scenario: Keep raw identifiers out of staging
- **WHEN** an eligible record has a valid platform identifier
- **THEN** SQLite receives only the identity kind, SHA-256 digest, and BLAKE2b-128 verifier

#### Scenario: Ignore duplicate localId as identity
- **WHEN** two otherwise distinct records share `localId`
- **THEN** neither is removed solely because of that value

#### Scenario: Preserve identical timestamp messages
- **WHEN** distinct identities share `createTime`
- **THEN** both survive and order by file rank then original source-array index

#### Scenario: Assign canonical source index
- **WHEN** deduplication completes
- **THEN** surviving records sort by `createTime`, file rank, and original source-array index and receive monotonically increasing canonical source indexes

### Requirement: Private SQLite staging and lifecycle
The preprocessor SHALL create one unique temporary sibling of the requested final output directory, inside the explicitly selected Git-ignored normalized-output parent and therefore on the same filesystem as the final destination. Before creating it, the process SHALL apply a restrictive umask equivalent to `0077`; the staging directory SHALL have owner-only permissions equivalent to `0700`, and its SQLite database, marker, manifest, chunks, and other regular files SHALL have permissions equivalent to `0600`. The staging directory and database path SHALL never be printed. The database SHALL never be placed in a global user database directory or generic shared temporary directory, and the promoted normalized directory SHALL contain no SQLite database.

The SQLite boundary SHALL consist of one staging-record table with exactly these persisted columns: non-null text `identity_kind` constrained to `platform-id-v1` or `fallback-v1`; non-null blob `identity_digest` constrained to 32 bytes; non-null blob `identity_verifier` constrained to 16 bytes; non-null integer `create_time`; non-null text `formatted_time`; non-null text `calendar_date`; non-null text `sender_scope` constrained to `owner` or `other`; non-null cleaned text `content`; non-null non-negative integer `file_rank`; and non-null non-negative integer `source_array_index`. A unique constraint on `(identity_kind, identity_digest, identity_verifier)` SHALL identify confirmed duplicates; a lookup index on `(identity_kind, identity_digest)` SHALL permit collision detection before duplicate resolution; and an ordering index on `(create_time, file_rank, source_array_index)` SHALL support canonical output. SQLite SHALL NOT contain `rawContent`, `source`, sender usernames/display names/avatars, session names or identifiers, raw `platformMessageId`, `localId`, raw URLs, XML, `chatRecords`, media/application payloads, absolute input paths, or input basenames. No hidden raw identifier SHALL be needed by an index or constraint.

Before inserting private data, the implementation SHALL set and read back `PRAGMA journal_mode=DELETE`, `PRAGMA temp_store=MEMORY`, `PRAGMA secure_delete=ON`, and an immediate-failure locking policy equivalent to `PRAGMA busy_timeout=0`; it SHALL open SQLite without shared cache. WAL mode SHALL be prohibited. The MVP schema uses no foreign keys; any future schema using them SHALL set and verify `PRAGMA foreign_keys=ON` before insertion. `temp_store=MEMORY` is required to prevent SQLite sort/index spill files in system temporary directories. Supported-maximum profiling SHALL verify that policy; if it is not viable, implementation SHALL stop and revise OpenSpec rather than switch to disk spill. `secure_delete=ON` only reduces ordinary deleted-page remnants and does not provide forensic or cryptographic erasure, especially on SSD storage. Deprecated or process-global SQLite temporary-directory configuration SHALL NOT be used.

Cleanup SHALL enumerate and remove, one explicit entry at a time, the main database, `-journal`, `-wal`, `-shm`, every statement journal, temporary manifest/chunk files, the staging marker, and every other entry created inside the staging directory. Cleanup SHALL run after success, validation failure, parsing failure, capacity failure, output failure, user cancellation, and handled process interruption. Before promotion, the implementation SHALL close SQLite, remove the private database and every non-output staging artifact, and assert that the directory being promoted contains exactly the validated manifest and non-empty referenced chunks, with no database or sidecar. Only then may the single atomic rename occur.

An abrupt termination, operating-system crash, or power failure MAY leave an owner-only sibling directory bearing the fixed marker `.chathistoryanalysis-private-stage-v1`. A recovery CLI mode SHALL scan only an explicitly selected normalized-output parent, use that marker plus the fixed staging-name prefix to recognize candidates, report only ordinal counts and stable state codes, never print paths, filenames, or content, and delete at most one user-selected candidate per invocation after explicit confirmation. It SHALL refuse symbolic links, entries not owned by the current user, a directory not equivalent to `0700`, regular files not equivalent to `0600`, unexpected entry types, or any candidate outside the selected parent. It SHALL delete entries one explicit path at a time, never perform broad recursive deletion, and never claim forensic erasure.

#### Scenario: Create private same-filesystem staging
- **WHEN** preprocessing passes argument and startup preflight
- **THEN** it creates one unique owner-only marked sibling under the selected ignored output parent with the restrictive umask and file permissions

#### Scenario: Reject unsafe staging placement
- **WHEN** staging would use a global database location, shared temporary directory, non-ignored root, or different filesystem
- **THEN** preprocessing fails before inserting private data

#### Scenario: Persist only the exact staging schema
- **WHEN** eligible records are staged
- **THEN** SQLite contains only the ten specified columns and the specified uniqueness, collision-lookup, and ordering structures

#### Scenario: Verify SQLite privacy PRAGMAs
- **WHEN** the staging connection is initialized
- **THEN** DELETE journaling, memory temp storage, secure deletion, immediate lock failure, and no shared cache are verified before private insertion

#### Scenario: Stop when memory temp storage is not viable
- **WHEN** supported-maximum profiling cannot complete safely with `temp_store=MEMORY`
- **THEN** the staging/capacity task remains incomplete and OpenSpec must be revised before implementation proceeds

#### Scenario: Clean every handled exit
- **WHEN** preprocessing succeeds, fails validation/parsing/capacity/output, is cancelled, or handles an interruption
- **THEN** every created staging entry is enumerated and removed one explicit path at a time

#### Scenario: Assert a clean promotion directory
- **WHEN** candidate hashes and privacy checks pass
- **THEN** the database, all possible sidecars, marker, and every non-output artifact are absent before rename

#### Scenario: Recover one recognized crash remnant
- **WHEN** the user selects one recognized owner-only marked candidate and explicitly confirms recovery
- **THEN** the recovery mode deletes only that candidate entry-by-entry and reports only ordinal counts and state codes

#### Scenario: Refuse an unsafe recovery candidate
- **WHEN** a candidate is a symbolic link, has unexpected ownership/permissions/types, lacks the fixed marker, or resolves outside the selected parent
- **THEN** recovery refuses it without printing its path or name

#### Scenario: Make no forensic-erasure claim
- **WHEN** staging cleanup or recovery completes
- **THEN** documentation and CLI status state only logical cleanup success and make no forensic or cryptographic erasure claim

### Requirement: Data-minimized normalized record
Each normalized browser text record SHALL contain only integer `createTime`, string `formattedTime`, string `calendarDate`, `senderScope` equal to `owner` or `other`, cleaned string `content`, integer `fileRank`, and integer canonical `sourceIndex`. This artifact SHALL be called a data-minimized local analysis dataset, not anonymous data.

#### Scenario: Write an allow-listed record
- **WHEN** an eligible record survives validation and deduplication
- **THEN** its serialized object contains exactly the normalized allow-list fields

#### Scenario: Retain filter metadata
- **WHEN** the browser filters by sender or date
- **THEN** sender scope and calendar date are sufficient without raw identities

#### Scenario: Avoid persistent dedup fingerprint
- **WHEN** preprocessing completes
- **THEN** transient primary and fallback identity fingerprints are absent from browser records unless a future reviewed schema version demonstrates necessity

### Requirement: Forbidden normalized fields and error-output privacy
Normalized records and chunks SHALL NOT contain `rawContent`, `source`, `senderUsername`, `senderDisplayName`, `senderAvatar`, session nickname, remark, display name, `wxid`, `ownerId`, `platformMessageId`, `localId`, avatar or CDN/media URLs, XML, mini-program/application payloads, `chatRecords`, `replyToMessageId`, `groupNickname`, media metadata, or non-text message content.

Errors, warnings, progress output, logs, screenshots, stdout, stderr, browser errors, progress events, snapshots, debug logs, and manifest warnings SHALL contain only source ordinal, input role, processing phase, field name, line or record ordinal, stable reason code, aggregate count, percentage, or non-sensitive capacity value. They SHALL NOT contain absolute or relative paths, input basenames, directory names, output or SQLite paths, dataset labels derived from user input, participant values, message IDs, individual-message hashes, content fragments, URLs, or raw parser excerpts. Source presentation SHALL use fixed role/ordinal labels equivalent to `annual-source #1`, `annual-source #2`, and `overlap-verification #1`; output failures SHALL present only phase and reason code. Internal exception types and messages SHALL be translated into content-free project error categories before presentation.

#### Scenario: Validate forbidden-field absence
- **WHEN** temporary output is complete
- **THEN** a privacy validation pass confirms every forbidden key and payload class is absent before promotion

#### Scenario: Reject a privacy validation failure
- **WHEN** any forbidden field or disallowed payload is detected
- **THEN** preprocessing fails, removes temporary output, and does not promote a manifest

#### Scenario: Keep errors content-free
- **WHEN** any file, record, Worker, or output failure is reported
- **THEN** the report contains only values from the error-output allow-list and no path, name, content, identifier, URL, hash, or parser excerpt

#### Scenario: Label a source without naming it
- **WHEN** progress or an error identifies a raw input
- **THEN** it uses only the fixed input role and ordinal label

#### Scenario: Report an output failure
- **WHEN** writing, verification, cleanup, or promotion fails
- **THEN** the user sees only processing phase and stable reason code, not the destination or staging location

#### Scenario: Translate an internal exception
- **WHEN** an operating-system, SQLite, parser, Worker, or browser exception includes sensitive-looking text
- **THEN** the presentation layer emits a content-free project category and discards the original message

#### Scenario: Contain injected sensitive strings
- **WHEN** synthetic tests inject sensitive-looking paths, basenames, participant values, parser excerpts, URLs, identifiers, content, and hashes
- **THEN** none of those strings reaches stdout, stderr, browser errors, progress events, screenshots, snapshots, debug logs, or manifest warnings

### Requirement: Normalized manifest and NDJSON chunks
The preprocessor SHALL write one canonical `manifest.json` and deterministically named bounded chunks `chunk-0001.ndjson`, `chunk-0002.ndjson`, and so on. Each chunk SHALL contain normalized records in canonical order and end every record with one LF. Chunk construction SHALL use actual encoded UTF-8 bytes, including the trailing LF for each compact serialized record. Adding a record SHALL NOT make a chunk exceed the inclusive 33,554,432-byte limit: when it would, the current non-empty chunk SHALL close and the record SHALL begin the next chunk. An exactly full chunk SHALL be valid and empty chunks SHALL never be emitted.

One compact serialized NDJSON record whose encoded UTF-8 bytes including its LF exceed 33,554,432 bytes SHALL be a fatal `NORMALIZED_RECORD_TOO_LARGE` dataset error. Exactly 33,554,432 bytes SHALL be accepted; the first byte over SHALL be rejected before any oversized chunk is written, no final output SHALL be promoted, and presentation SHALL contain only the reason code and source ordinal metadata. A dataset with zero eligible text records SHALL fail with `NO_ELIGIBLE_TEXT_RECORDS`; no final manifest or chunk SHALL be promoted, the CLI SHALL remain reusable, and only aggregate skipped counters MAY be reported.

The manifest SHALL include schema and preprocessor versions, pseudonymous conversation fingerprint, UTC+08:00 policy, input roles and SHA-256 file hashes, ordered chunk names and hashes, aggregate source and normalized counts, aggregate skip/duplicate/warning counts, data-derived range, sender-scope counts, and privacy-validation result. It SHALL contain no raw identity or message value.

#### Scenario: Write bounded chunks
- **WHEN** adding the next NDJSON record would exceed 33,554,432 bytes
- **THEN** the preprocessor closes the current non-empty chunk and writes the record to the next deterministically numbered chunk

#### Scenario: Accept the exact record boundary
- **WHEN** one compact serialized record including LF is exactly 33,554,432 encoded UTF-8 bytes
- **THEN** it is accepted as one exactly full chunk

#### Scenario: Reject the first byte over the record boundary
- **WHEN** one compact serialized record including LF is 33,554,433 encoded UTF-8 bytes
- **THEN** preprocessing fails with `NORMALIZED_RECORD_TOO_LARGE`, writes no oversized chunk, and promotes no partial output

#### Scenario: Accept the exact chunk boundary
- **WHEN** adding a record makes the current chunk exactly 33,554,432 encoded UTF-8 bytes including every LF
- **THEN** the exactly full chunk is valid

#### Scenario: Move the first byte over to the next chunk
- **WHEN** adding the next record would make the current chunk at least 33,554,433 bytes
- **THEN** the current non-empty chunk closes and that entire record becomes the first record of the next chunk

#### Scenario: Create the first chunk
- **WHEN** the first eligible record is smaller than or equal to the record limit
- **THEN** the writer creates `chunk-0001.ndjson` and does not emit a preceding empty chunk

#### Scenario: Reject zero eligible records
- **WHEN** all raw messages are skipped or non-text and no eligible record survives
- **THEN** preprocessing fails with `NO_ELIGIBLE_TEXT_RECORDS`, promotes no manifest or chunk, reports at most aggregate skipped counters, and remains reusable

#### Scenario: Preserve canonical chunk order
- **WHEN** records span multiple chunks
- **THEN** concatenating chunks in manifest order yields canonical record order

#### Scenario: Preserve deterministic output after skips
- **WHEN** recoverable message skips occur for identical inputs and settings
- **THEN** the surviving canonical order and encoded chunk boundaries remain byte-identical across runs

#### Scenario: Record input roles
- **WHEN** the manifest is produced
- **THEN** it distinguishes annual sources from overlap-verification sources without inferring roles from names

#### Scenario: Record integrity
- **WHEN** temporary chunks are complete
- **THEN** the manifest records SHA-256 for each input and chunk and aggregate integrity counters

#### Scenario: Exclude wall-clock generation time
- **WHEN** a manifest is serialized
- **THEN** it contains no current wall-clock generation timestamp that would make identical runs differ

### Requirement: Deterministic preprocessing output
Identical input bytes, explicit roles and order, preprocessor version, normalization schema, and settings SHALL produce byte-identical manifest and chunk files. Canonical JSON SHALL use UTF-8 without BOM, LF line endings, fixed field order, no insignificant whitespace, stable integer formatting, and lexicographically sorted manifest object keys where field order is not otherwise prescribed.

#### Scenario: Repeat preprocessing
- **WHEN** preprocessing runs twice with identical inputs, roles, order, versions, and settings
- **THEN** corresponding manifest and chunk SHA-256 values are identical

#### Scenario: Change supplied order tie-breaker
- **WHEN** two files have identical actual ranges but their explicit annual-source order changes
- **THEN** deterministic file rank and output may change in the documented way

#### Scenario: Preserve Unicode deterministically
- **WHEN** normalized content contains Unicode
- **THEN** canonical UTF-8 serialization produces the same bytes across supported hosts

### Requirement: Atomic and recoverable preprocessing
The requested final destination SHALL NOT already exist. An existing file, directory, or symbolic link at that destination SHALL cause a fatal `OUTPUT_DESTINATION_EXISTS` error; the MVP SHALL provide no overwrite, merge, automatic deletion, or replacement behavior. The preprocessor SHALL write to the private unique sibling staging directory on the same filesystem, validate manifest and chunk hashes there, flush and close output, remove private and non-output artifacts, and promote the complete candidate through one atomic directory rename. It SHALL perform no copy-based or cross-filesystem fallback.

Insufficient disk space, output write/flush failure, hash verification failure, interrupted writing, failure immediately before rename, rename failure, or detected cross-filesystem conditions SHALL be fatal. No failure SHALL leave an apparently valid final dataset. A pre-rename failure SHALL leave no final destination; handled failures SHALL clean staging, while abrupt failures MAY leave only a recognized private staging remnant for the explicit recovery flow. If the atomic rename succeeds, the complete validated dataset is final; if it fails, the final destination SHALL remain absent and the candidate SHALL remain private staging until handled cleanup or recovery. Sources SHALL never be modified.

#### Scenario: Promote successful output
- **WHEN** all source, dataset, privacy, size, serialization, and integrity checks pass
- **THEN** the complete temporary directory is atomically promoted to the final directory

#### Scenario: Fail before promotion
- **WHEN** any fatal dataset or output error occurs
- **THEN** no new final manifest becomes visible and temporary output is cleaned

#### Scenario: Protect an existing dataset
- **WHEN** the target final directory already exists
- **THEN** preprocessing fails with `OUTPUT_DESTINATION_EXISTS` without overwrite, merge, deletion, or destination disclosure

#### Scenario: Handle output integrity failure
- **WHEN** a written chunk hash or manifest reference fails verification
- **THEN** preprocessing reports a fatal integrity error and does not promote output

#### Scenario: Handle disk exhaustion
- **WHEN** staging creation, SQLite growth, chunk writing, or manifest writing encounters insufficient disk space
- **THEN** preprocessing reports a content-free fatal output code, promotes nothing, and performs handled cleanup

#### Scenario: Handle interrupted writing
- **WHEN** writing is cancelled or a handled interruption occurs before candidate completion
- **THEN** no final destination appears and created staging entries are cleaned explicitly

#### Scenario: Fail immediately before rename
- **WHEN** cleanup or final pre-promotion assertion fails after hashes validate
- **THEN** rename is not attempted and no apparently valid final dataset is visible

#### Scenario: Handle interrupted pre-rename cleanup
- **WHEN** cancellation or a handled interruption occurs while private staging artifacts are being removed
- **THEN** rename is not attempted, explicit cleanup continues to its handled outcome, and no final dataset is visible

#### Scenario: Handle simulated promotion failure
- **WHEN** the single atomic directory rename fails
- **THEN** no copy fallback occurs, the final destination remains absent, and staging follows handled cleanup or recognized recovery

#### Scenario: Enforce the same filesystem
- **WHEN** the staging directory and final destination parent do not resolve to the same filesystem
- **THEN** preprocessing fails before private insertion and never attempts a cross-filesystem rename

### Requirement: Preprocessing error classes
The CLI SHALL distinguish fatal dataset errors, recoverable message errors, and verification-source failures. Fatal errors SHALL include invalid UTF-8 or JSON, unsupported format, group chat, different conversation, unsafe `localType`, raw or normalized limit violation, and output write or integrity failure. Recoverable records SHALL be skipped using aggregate counters for malformed records, unsupported non-text types, missing optional fields, sender metadata conflicts with valid `isSend`, or invalid text-classification signals.

#### Scenario: Encounter a fatal dataset error
- **WHEN** a fatal error occurs in any annual source
- **THEN** the CLI exits unsuccessfully and promotes no dataset

#### Scenario: Encounter a recoverable record
- **WHEN** an individual record has a recoverable reason
- **THEN** the CLI skips it, increments an aggregate reason counter, and continues

#### Scenario: Avoid leaking a recoverable record
- **WHEN** a recoverable error is summarized
- **THEN** neither content nor identifier values appear in console output, manifest details, or logs

#### Scenario: Encounter verification failure
- **WHEN** an overlap-verification source fails
- **THEN** it is classified separately from annual-source validity and follows the explicit verification policy

### Requirement: Preprocessing progress and cancellation
The CLI SHALL display content-free progress for each source and the aggregate operation, including current role, source ordinal, byte or message progress where measurable, and phase. Cancellation SHALL stop at a safe boundary, clean temporary output, leave sources and prior final output unchanged, and exit with a distinct status.

#### Scenario: Report per-file progress
- **WHEN** a source is validating or streaming messages
- **THEN** the CLI reports its ordinal, role, phase, and measurable percentage without its content or identity metadata

#### Scenario: Report aggregate progress
- **WHEN** multiple inputs are supplied
- **THEN** the CLI reports completed input count and aggregate phase

#### Scenario: Cancel preprocessing
- **WHEN** the user requests cancellation
- **THEN** processing stops safely, temporary output is removed, and no partial dataset is promoted

#### Scenario: Re-run after cancellation
- **WHEN** cancellation cleanup completes
- **THEN** the same output target can be used by a later fresh invocation

### Requirement: Browser normalized input model
The React application SHALL reject raw CipherTalk exports and accept only one normalized manifest plus every manifest-referenced normalized NDJSON chunk selected locally through File APIs. Multi-file selection, drag and drop, and optional directory selection MAY be offered, but normalized private data SHALL NOT be copied into Vite `public/`, bundled into `dist`, or uploaded.

#### Scenario: Select a complete normalized dataset
- **WHEN** the user selects one manifest and all referenced chunks
- **THEN** the application stages them for Worker validation without network upload

#### Scenario: Reject a raw CipherTalk export
- **WHEN** a selected JSON has the raw `exportInfo`, `session`, and `messages` contract rather than the normalized manifest contract
- **THEN** the application rejects it and directs the user to local preprocessing

#### Scenario: Reject an incomplete chunk selection
- **WHEN** a manifest-referenced chunk is missing
- **THEN** the candidate dataset is rejected before analysis

#### Scenario: Keep normalized files outside build output
- **WHEN** the local application is built or previewed
- **THEN** private manifests and chunks are not required in source, `public/`, or `dist`

### Requirement: Normalized browser capacity
The browser SHALL support at most 1,000,000 aggregate eligible text records, 134,217,728 aggregate normalized bytes, and 33,554,432 bytes per normalized chunk. These SHALL be supported MVP limits rather than absolute browser limits. Every limit SHALL be checked before full tokenization, and failure SHALL leave the previous valid dataset usable without partial candidate results.

#### Scenario: Accept exact normalized record limit
- **WHEN** a valid manifest declares and supplies exactly 1,000,000 normalized records within byte limits
- **THEN** the Worker permits the dataset

#### Scenario: Reject excessive normalized records
- **WHEN** declared or observed normalized records exceed 1,000,000
- **THEN** the Worker rejects the entire candidate

#### Scenario: Accept exact aggregate normalized size
- **WHEN** selected normalized files total exactly 134,217,728 bytes and every other limit is satisfied
- **THEN** the application permits validation

#### Scenario: Reject excessive aggregate normalized size
- **WHEN** selected normalized files total more than 134,217,728 bytes
- **THEN** the application rejects the candidate before chunk parsing

#### Scenario: Accept exact chunk size
- **WHEN** a referenced chunk is exactly 33,554,432 bytes
- **THEN** the Worker permits it

#### Scenario: Reject oversized chunk
- **WHEN** any referenced chunk is larger than 33,554,432 bytes
- **THEN** the application rejects the entire candidate

### Requirement: Manifest and chunk validation
The Worker SHALL validate manifest schema/version, deterministic field types, pseudonymous fingerprint shape, UTC+08:00 policy, counts, file names, and selected file set; verify every chunk SHA-256 before trusting its records; and parse NDJSON incrementally in manifest order. It SHALL reject unknown incompatible schema versions, hash mismatches, duplicate or extra chunks, malformed lines, forbidden fields, and count/range discrepancies.

#### Scenario: Load a valid normalized dataset
- **WHEN** manifest, selected chunks, hashes, records, counts, and privacy declaration all agree
- **THEN** the Worker accepts the candidate atomically

#### Scenario: Reject a chunk hash mismatch
- **WHEN** a selected chunk's computed SHA-256 differs from the manifest
- **THEN** the Worker rejects the entire candidate before tokenization

#### Scenario: Reject an extra chunk
- **WHEN** selected normalized files include an unreferenced NDJSON chunk
- **THEN** the Worker rejects the ambiguous candidate

#### Scenario: Reject malformed NDJSON
- **WHEN** any non-empty chunk line is not one valid normalized record
- **THEN** the Worker rejects the candidate with a line ordinal and no content

#### Scenario: Reject forbidden normalized data
- **WHEN** a normalized record contains a forbidden field or unsupported extra field
- **THEN** the Worker rejects the dataset rather than silently retaining it

### Requirement: Browser analysis Worker lifecycle
One browser analysis Worker SHALL validate the candidate, verify hashes, initialize Jieba WASM once, load chunks in manifest order, parse NDJSON incrementally, tokenize each eligible record once, retain only the selected compact token-cache representation inside the Worker, report progress, apply sender/date controls to cached records, calculate deterministic frequencies, and return only aggregate results. After constructing the compact token cache for a chunk, the Worker SHALL release that chunk's normalized text and buffer before loading the next chunk. The main thread SHALL handle selection, controls, progress presentation, aggregate results, errors, rendering, and PNG export.

#### Scenario: Initialize one Worker dataset
- **WHEN** a valid dataset is accepted
- **THEN** one Worker owns its normalized loading, text, and token cache

#### Scenario: Tokenize once
- **WHEN** the user changes sender, date, maximum-word, or minimum-frequency controls
- **THEN** the Worker reuses cached tokens and does not segment all messages again

#### Scenario: Return aggregate results
- **WHEN** analysis completes
- **THEN** the Worker sends frequencies, rankings, counts, selected scope/range, diagnostics, and status without normalized message text

#### Scenario: Avoid main-thread full-text retention
- **WHEN** selected files have been transferred or streamed to the Worker
- **THEN** the main thread releases avoidable full normalized-text references

#### Scenario: Release chunk text after compact caching
- **WHEN** the Worker finishes constructing the selected compact token cache for a chunk
- **THEN** it releases that chunk's normalized text and buffer before loading the next chunk

#### Scenario: Reject hidden main-thread fallback
- **WHEN** Worker creation, WASM initialization, or Worker processing fails
- **THEN** the application reports a local error and does not process the complete dataset on the main thread

### Requirement: Worker tokenizer configuration
The Worker SHALL use exactly `jieba-wasm@2.4.0`, initialize it lazily once per Worker dataset lifecycle, call `cut(text, false)`, disable HMM, use the embedded dictionary, avoid custom dictionaries, load WASM from the local application origin, and provide no online fallback.

#### Scenario: Initialize local Jieba
- **WHEN** the first accepted dataset requires tokenization
- **THEN** the Worker initializes the locally packaged WASM singleton once

#### Scenario: Preserve segmentation mode
- **WHEN** Chinese text is tokenized
- **THEN** the Worker uses `cut(text, false)` and no full, search, HMM, `add_word`, or `with_dict` mode

#### Scenario: Fail tokenizer initialization
- **WHEN** local WASM initialization fails
- **THEN** analysis produces no partial frequency result and presents a retryable content-free error

#### Scenario: Verify Worker packaging
- **WHEN** the production build is tested
- **THEN** Worker JavaScript, WASM, embedded dictionary, and related assets resolve from the local same origin

### Requirement: Worker text processing
The Worker SHALL deterministically normalize eligible content with NFKC, URL removal, whitespace and punctuation separation, English lowercase handling, emoji separation, a versioned local stop-word set, Unicode-code-point minimum token length, and numeric-only token exclusion. It SHALL combine Chinese and English tokens without online processing.

#### Scenario: Process Chinese text
- **WHEN** normalized content contains Chinese characters
- **THEN** Jieba tokens enter the common filtering and frequency pipeline

#### Scenario: Process English text
- **WHEN** normalized content contains English alphabetic runs
- **THEN** lowercase English tokens enter the same frequency pipeline

#### Scenario: Process mixed text
- **WHEN** normalized content contains Chinese, English, emoji, punctuation, and whitespace
- **THEN** words remain analyzable while emoji and separators do not become tokens

#### Scenario: Apply stop words
- **WHEN** a token exactly matches the normalized stop-word set
- **THEN** it is excluded without mutating the Jieba dictionary

#### Scenario: Apply token-length rule
- **WHEN** a token has fewer Unicode code points than the configured minimum
- **THEN** it is excluded

#### Scenario: Exclude numeric-only token
- **WHEN** a token consists only of numbers after normalization
- **THEN** it is excluded

### Requirement: Analysis controls and cached frequency calculation
The application SHALL support all participants, owner-only, or other-only scope; full or inclusive custom calendar-date range; maximum displayed words; and minimum frequency. The Worker SHALL filter cached tokenized records by `senderScope` and `calendarDate`, compute counts deterministically, sort by descending frequency then ascending Unicode code-point token order, and return one atomic result.

#### Scenario: Select sender scope
- **WHEN** the user selects all, owner, or other
- **THEN** only cached records in that scope contribute

#### Scenario: Select inclusive date range
- **WHEN** the user selects valid start and end dates within manifest bounds
- **THEN** records on both boundaries and between them contribute

#### Scenario: Reject invalid controls
- **WHEN** a date range or numeric threshold is invalid
- **THEN** generation is blocked with associated validation feedback

#### Scenario: Reuse cached tokenization
- **WHEN** valid settings change after initial tokenization
- **THEN** only filtering and aggregation rerun

#### Scenario: Rank equal frequencies
- **WHEN** two tokens have equal counts
- **THEN** ascending Unicode code-point order breaks the tie

#### Scenario: Commit one result
- **WHEN** recalculation completes
- **THEN** cloud input, ranking, metrics, scope, range, and diagnostics update atomically

### Requirement: Analysis results and PNG export
The application SHALL display a word cloud, an exact accessible ranked-frequency list, analyzed text-message count, unique-token count before display thresholds, selected sender scope, selected actual data-derived date range, aggregate warnings, and a clear empty state. It SHALL export the current non-empty word cloud as a local PNG without upload or private metadata.

#### Scenario: Display a non-empty result
- **WHEN** active filters produce displayable tokens
- **THEN** cloud, ranking, counts, scope, and date range reflect one Worker result

#### Scenario: Display an empty result
- **WHEN** no token survives active filters and thresholds
- **THEN** the application presents an explicit empty state

#### Scenario: Export current cloud
- **WHEN** a non-empty cloud is current and the user activates export
- **THEN** a PNG representing current settings downloads locally

#### Scenario: Disable invalid export
- **WHEN** no current non-empty cloud exists
- **THEN** export is unavailable with an accessible explanation

#### Scenario: Avoid private PNG metadata
- **WHEN** a PNG is created
- **THEN** its filename and metadata contain no participant identity or message content

### Requirement: Browser progress, cancellation, and memory failure
The application SHALL show chunk-level phase and aggregate percentage while validating, loading, initializing, tokenizing, and analyzing. It SHALL support cancellation through Worker messaging and SHALL remain reusable after cancellation or an understandable local memory failure.

#### Scenario: Display processing progress
- **WHEN** the Worker performs a measurable phase
- **THEN** the main thread presents current chunk, phase, and overall progress programmatically and visually

#### Scenario: Cancel Worker processing
- **WHEN** the user cancels loading or tokenization
- **THEN** the Worker stops at a safe checkpoint, discards the staged candidate, and reports cancellation

#### Scenario: Reuse UI after cancellation
- **WHEN** cancellation completes
- **THEN** controls and file selection are usable for a fresh attempt

#### Scenario: Handle memory failure
- **WHEN** allocation or browser memory pressure prevents supported processing
- **THEN** the candidate fails with a content-free local error and no partial result

### Requirement: Supported local launch and offline model
The application SHALL run through the Vite development server and verify its production build through a loopback same-origin HTTP server. Direct `file://`, Electron/Tauri, public deployment, remote assets, cloud services, accounts, and upload SHALL be unsupported. Once local build assets are available, preprocessing and analysis SHALL require no external request.

#### Scenario: Launch development locally
- **WHEN** the documented development command runs
- **THEN** application and analysis assets load from the local development origin

#### Scenario: Verify production locally
- **WHEN** the production build is served on loopback
- **THEN** UI, Worker, WASM, dictionary, stop words, styles, fonts, and visualization assets load from the same origin

#### Scenario: Attempt direct file execution
- **WHEN** a user opens the build through `file://`
- **THEN** documentation directs the user to the supported local HTTP launch

#### Scenario: Block external requests
- **WHEN** all non-loopback requests are denied
- **THEN** normalized loading, analysis, visualization, and PNG export remain functional

### Requirement: Repository and runtime privacy
Raw CipherTalk exports and data-minimized local analysis datasets SHALL remain only in ignored local locations such as `data/private/` and `data/exports/normalized/<dataset-name>/`. They SHALL NOT be committed, bundled, uploaded, logged, snapshotted, or used as test fixtures. Telemetry SHALL be disabled unless a future policy proves it contains no source names, text, tokens, frequencies, identifiers, or derived private metadata.

#### Scenario: Produce normalized output
- **WHEN** the CLI writes a dataset under the configured ignored output location
- **THEN** Git ignore checks confirm that manifest and chunks are excluded from version control

#### Scenario: Inspect network activity
- **WHEN** preprocessing and browser analysis run
- **THEN** no request contains raw or normalized private data

#### Scenario: Commit test data
- **WHEN** automated tests require multi-year or overlap inputs
- **THEN** they use only explicitly synthetic values and never copy real records, identifiers, hashes, URLs, or distributions

#### Scenario: Build application assets
- **WHEN** Vite builds the application
- **THEN** no normalized manifest or chunk is copied into `dist`

### Requirement: Supported-scale responsiveness and profiling
The existing 5000-message synthetic fixture SHALL remain supported through a synthetic preprocessing path. Before browser-capacity implementation or maximum-capacity acceptance can be marked complete, the implementation SHALL profile purely synthetic datasets at or near each supported maximum boundary: 1,000,000 eligible text records, 134,217,728 aggregate normalized bytes, and 33,554,432 bytes per chunk. For every run it SHALL record no private data and record browser/version, operating system, architecture, loaded normalized bytes, record count, peak Worker memory where measurable, main-thread responsiveness, cancellation behavior, tokenization-cache representation, and whether the supported contract passed.

The profiling evidence SHALL justify and document one architecture decision: compact token-ID arrays with a shared token table; compact per-record metadata plus token-offset arrays; partitioned token caches; or a reduced supported record/byte limit accompanied by an OpenSpec revision. The implementation SHALL NOT retain duplicate full-text and tokenized representations, process the complete dataset on the main thread, use cloud fallback, silently reduce a limit, or proceed while the maximum-boundary gate is failing.

The mandatory gate SHALL fail if any maximum-boundary profile causes browser termination, persistent main-thread unresponsiveness, inability to complete Worker tokenization, unsafe cache retention, unusable cancellation, or an unjustified/exceeded memory envelope. On failure, the capacity task SHALL remain incomplete, all subsequent maximum-capacity acceptance work SHALL stop, the current limits SHALL NOT be claimed as supported, and OpenSpec SHALL be revised before proceeding.

#### Scenario: Process baseline fixture
- **WHEN** the existing synthetic fixture is preprocessed and analyzed
- **THEN** the end-to-end local workflow completes without changing the fixture

#### Scenario: Profile every maximum boundary
- **WHEN** browser-capacity implementation reaches its mandatory decision gate
- **THEN** synthetic profiles exercise at or near the record, aggregate-byte, and per-chunk maxima and record every required environment, memory, responsiveness, cancellation, cache, and pass field

#### Scenario: Recalculate without re-tokenizing
- **WHEN** the user changes sender or date settings on the large synthetic dataset
- **THEN** cached tokenization is reused

#### Scenario: Require profiling evidence
- **WHEN** the capacity implementation task is considered complete
- **THEN** documented evidence justifies exactly one permitted compact-cache or reduced-limit architecture decision and shows the supported contract passed

#### Scenario: Stop on a failed maximum-boundary gate
- **WHEN** any maximum-boundary run terminates the browser, persistently blocks the main thread, cannot tokenize or retain the cache safely, makes cancellation unusable, or exceeds its justified memory envelope
- **THEN** capacity remains incomplete, later maximum-capacity acceptance stops, and OpenSpec must be revised before support is claimed

#### Scenario: Prohibit duplicate representations and fallback
- **WHEN** a chunk's compact cache has been built or Worker capacity is insufficient
- **THEN** full chunk text is released and neither complete-dataset main-thread processing, cloud fallback, silent limit reduction, nor duplicate full-text retention is used

### Requirement: Synthetic verification coverage
Implementation tests SHALL use purely synthetic data to cover multiple annual sources, complete overlap verification, repeated `localId`, unique string platform identifiers, missing-platform fallback, large safe `localType`, values above signed 32-bit range, identical timestamps, sender/owner conflicts, optional arrays, avatar-shape differences, null non-text content, type-signal conflicts, an image with inconsistent `chatLabType`, annual gaps, filename/range mismatch, different-session rejection, deterministic output hashes, capacity boundaries, and forbidden-field absence.

#### Scenario: Generate synthetic multi-year cases
- **WHEN** future implementation adds test data for the revised architecture
- **THEN** every required edge case uses fabricated identities, text, URLs, hashes, and distributions

#### Scenario: Verify deterministic artifacts
- **WHEN** fixed synthetic sources are preprocessed repeatedly
- **THEN** manifest and chunk hashes match expected synthetic values

#### Scenario: Verify privacy minimization
- **WHEN** synthetic normalized artifacts are inspected
- **THEN** only allow-listed fields exist and all forbidden fields are absent

#### Scenario: Reject a synthetic different session
- **WHEN** one annual source uses another fabricated private-session identity
- **THEN** preprocessing rejects the dataset

### Requirement: Accessible controls and status
Normalized-file selection, sender and date controls, numeric settings, generation, cancellation, progress, errors, ranking, and PNG export SHALL be keyboard operable, programmatically named, visibly focused, and associated with programmatic validation or status without relying on color alone.

#### Scenario: Operate by keyboard
- **WHEN** a keyboard-only user traverses the workflow
- **THEN** every action can be reached, understood, and activated in logical order

#### Scenario: Announce progress
- **WHEN** Worker progress changes
- **THEN** assistive technology receives useful non-disruptive status updates

#### Scenario: Announce validation failure
- **WHEN** file selection, manifest, control, or analysis validation fails
- **THEN** feedback is associated with the relevant control and contains no private content

#### Scenario: Preserve focus after cancellation
- **WHEN** cancellation completes
- **THEN** focus returns to a logical usable control
