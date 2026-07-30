## Context

The repository contains a deterministic synthetic CipherTalk `detailed-json` fixture, its generator and tests, and provisional schema documentation, but no application or runtime analysis code. A privacy-preserving read-only audit established that a complete private-chat history can span multiple annual sources beyond the former raw-browser limits and that an overlap-verification export cannot be counted as another analysis period. No private audit counts, sizes, hashes, paths, names, identifiers, or date ranges belong in committed documentation.

The audit also confirmed that raw payload fields dominate source size and can contain XML, URLs, and embedded private metadata; `localId` is not unique; decimal-looking platform identifiers must remain strings; `localType` may exceed signed 32-bit range; `chatLabType` is the most stable classifier; timestamps use Unix seconds and fixed UTC+08:00 wall time; and identical timestamps require stable source ordering. These aggregate conclusions are safe to document publicly, but raw and normalized datasets remain private local artifacts.

The former browser-only raw-import architecture is therefore replaced before implementation. The local Python component is a CLI preprocessor, not an HTTP service, server backend, database service, upload path, or cloud boundary. The browser receives only a data-minimized local analysis dataset.

## Goals / Non-Goals

**Goals:**

- Analyze the complete private-chat history across explicitly selected annual CipherTalk exports.
- Stream large raw sources sequentially with bounded memory and no source mutation or network access.
- Validate one private conversation, minimize fields, deduplicate, merge deterministically, and emit atomic reproducible local artifacts.
- Keep raw identifiers and structured payloads out of normalized chunks, browser state, logs, snapshots, and errors.
- Load normalized artifacts in a browser Worker, tokenize each record once, cache tokens, and keep the UI responsive.
- Preserve deterministic sender/date filtering, frequencies, ranking, progress, cancellation, accessibility, and PNG export.
- Keep all private data under Git-ignored local paths.

**Non-Goals:**

- Sentiment analysis, AI summarization, relationship scoring, annual relationship reports, topic modeling, timelines, or heatmaps.
- Group-chat analysis, media transcription, image recognition, direct WeChat database access, or CipherTalk database decryption.
- FastAPI or another local HTTP API, cloud upload or storage, public deployment, user accounts, or telemetry containing private data.
- Electron/Tauri packaging, direct `file://` execution, or copying normalized data into the application build.
- Treating a data-minimized text dataset as anonymous.

## Decisions

### 1. Split raw preprocessing from browser analysis

The architecture is:

```text
CipherTalk annual detailed-JSON files
  -> local Python preprocessing CLI on macOS
  -> strict streaming source and same-session validation
  -> message classification and eligible-text filtering
  -> privacy minimization
  -> transient identity calculation and cross-file deduplication
  -> chronological merge
  -> deterministic manifest plus bounded NDJSON chunks
  -> local React/TypeScript application
  -> browser analysis Worker
  -> Jieba initialization, one-time tokenization, cached filtering and frequencies
  -> word cloud, ranked list, metrics, and PNG export
```

Raw browser import is deliberately unsupported. The split prevents hundreds of MiB of unnecessary structured fields from entering browser memory and makes privacy minimization an inspectable precondition rather than a UI convention.

Alternatives considered:

- **Whole-file parsing one annual source at a time:** simpler, but a several-hundred-MiB JSON string plus object graph has an unsafe and implementation-dependent memory multiplier.
- **Browser streaming of raw exports:** keeps one runtime but still exposes raw structured payloads to browser state and makes cross-file validation, atomic output, and reproducibility harder.
- **Python/FastAPI:** unnecessary listening process and request/logging surface. The selected Python component is an invoked local CLI only.

### 2. Use pinned `ijson==3.5.1` with a fixed streaming mode

The MVP supports one explicit runtime row: CPython `>=3.12.0,<3.13.0` on macOS `arm64`. Before opening any raw source, a startup gate verifies the interpreter implementation, Python minor, operating system, and architecture; installed `ijson` version exactly `3.5.1`; an installed-distribution SHA-256 from the approved list for that exact runtime/platform tuple; backend identity exactly `yajl2_c`; and a minimal in-memory parser event self-check. The gate maps failure to `UNSUPPORTED_PYTHON_RUNTIME`, `IJSON_DISTRIBUTION_UNVERIFIED`, `IJSON_BACKEND_UNAVAILABLE`, `IJSON_BACKEND_MISMATCH`, or `IJSON_PARSER_INITIALIZATION_FAILED`. It discards underlying exception text before presentation.

After that gate, the selected API is `ijson.backends.yajl2_c.parse` over a binary file with:

- `use_float=False`, preserving JSON integers as Python integers;
- `multiple_values=False`, requiring exactly one top-level value;
- `allow_comments=False`, requiring standard JSON;
- a fixed 65,536-byte buffer unless implementation profiling documents and tests a different fixed value;
- no automatic backend selection or pure-Python fallback.

The event state machine collects the small top-level `exportInfo` and `session` objects and constructs at most one `messages.item` object at a time. Large fields may exist in that one object but are discarded immediately after safe aggregate checks. Annual sources are opened and processed sequentially; all source object graphs are never resident together.

Each source receives three bounded passes so final `fileRank` is known before any eligible row enters the exact ten-column table:

1. Stream bytes to SHA-256 and Python's strict incremental UTF-8 decoder without correction or replacement.
2. Reopen in binary mode, stream parser events for contract/session/participant/message-count/time-range validation, discard each message, and verify a concurrently recomputed source hash still matches pass one.
3. After every annual range and rank is known, reopen annual sources in deterministic rank order, stream/classify/minimize/digest/stage eligible records with final `file_rank`, and again verify the source hash. Verification inputs stream against staged identities without entering the table.

This extra pass avoids adding a forbidden source identifier or provisional rank to SQLite. It also detects source mutation between passes. Parse errors, incomplete JSON, trailing values, comments, invalid UTF-8, changed bytes, and unsupported structures are fatal and content-free.

The future preprocessing dependency file must pin exactly `ijson==3.5.1` and the supported runtime tuple. A generated lock file must include SHA-256 hashes for every approved distribution in that tuple, and installation must enforce hashes. Runtime verification remains mandatory even after hash-locked installation. There is no automatic backend choice, pure-Python parser, other native backend, or unsupported-runtime fallback. The committed lock file, interpreter boundary, exact backend, options, and parser contract are the reproducibility boundary. Implementation must verify official distribution hashes and licenses before installation; this documentation task creates no manifest and installs nothing.

### 3. Enforce separate raw and normalized limits

Raw preprocessing supports:

| Limit | Inclusive maximum |
| --- | ---: |
| One raw input | 536,870,912 bytes (512 MiB) |
| Annual-source files | 20 |
| Aggregate raw inputs across both roles | 2,147,483,648 bytes (2 GiB) |
| Aggregate raw message entries across both roles | 2,000,000 |

Browser normalized input supports:

| Limit | Inclusive maximum |
| --- | ---: |
| Aggregate eligible text records | 1,000,000 |
| Aggregate normalized dataset | 134,217,728 bytes (128 MiB) |
| One normalized NDJSON chunk | 33,554,432 bytes (32 MiB) |

These are supported MVP limits, not hardware claims. Counts include overlap-verification sources for raw resource protection even though they never contribute normalized records. Every limit is checked at the earliest reliable point. Crossing a limit aborts the candidate, deletes temporary output, and never silently emits a truncated dataset.

### 4. Make input roles explicit

The CLI exposes repeated role arguments equivalent to:

```text
--annual-source <path>
--overlap-verification <path>
--output-dir <ignored-local-path>
```

At least one annual source and an output directory are required. Directory and filename conventions never imply roles.

- **Annual source:** contributes eligible records, participates in same-session checks, ranking, deduplication, merge, and totals.
- **Overlap verification:** optional; validates repeat-export consistency, never contributes a record, count, or date period.

If verification is included in a preprocessing run and fails, no final output is promoted. A separate read-only `verify-overlap` operation may compare a verification source against an existing manifest without modifying it. This avoids a dangerous “warning but silently continue” path; the user can explicitly rerun without verification if desired.

### 5. Validate one private conversation pseudonymously

For every annual source, the preprocessor transiently compares:

- exact `detailed-json` format;
- platform;
- private/group status;
- owner identity;
- peer identity;
- participant set derived from message sender identities.

Canonical identity serialization is versioned and length-prefixed, for example a fixed domain tag followed by UTF-8 byte length and bytes for each normalized component and the sorted participant set. SHA-256 of that representation becomes the lowercase hexadecimal conversation fingerprint. Length prefixes prevent delimiter ambiguity.

The fingerprint is pseudonymous, not anonymous: anyone possessing candidate identifiers could recompute it. The local manifest may contain the fingerprint, but no raw identity, participant name, or identifier may accompany it. A different-session annual source is fatal. Missing identity fields that prevent deterministic comparison are also fatal for complete-history preprocessing rather than being guessed.

### 6. Classify with `chatLabType`, corroborate with `type`, preserve `localType` transiently

The primary normalized mappings are:

| `chatLabType` | Category |
| ---: | --- |
| 0 | text |
| 1 | image |
| 2 | voice |
| 3 | video |
| 4 | file |
| 5 | animated emoji |
| 7 | structured/link/other application content |
| 8 | location |
| 23 | call |
| 24 | mini-program/share |
| 25 | reply |
| 27 | contact card |
| 80 | system |
| 99 | other/special transaction content |

String `type` corroborates this mapping. Any disagreement that might turn media or structured content into text is conservatively non-text and increments an aggregate warning. Unknown primary codes are also non-text rather than guessed.

`localType` is accepted only when it is a Python integer other than `bool` and lies between `-Number.MAX_SAFE_INTEGER` and `Number.MAX_SAFE_INTEGER`. In TypeScript it must pass `Number.isSafeInteger`. No implementation may use bitwise operators, signed 32-bit casts, `Int32Array`, or a 32-bit database column. Unknown safe values are retained only long enough for validation and diagnostics. Stable simple examples include 1 text, 3 image, 34 voice, 43 video, 47 animated emoji, 50 call, and 10000 system; structured records may use much larger values. `localType=49` is not canonical.

### 7. Require exact text agreement and minimize content

A record is eligible only if:

```text
chatLabType === 0
type === "文本消息"
localType === 1
content is a non-empty string
```

Then pure filters:

1. reject known bracketed media/system placeholders;
2. reject XML-like content without parsing it;
3. remove URL spans;
4. reject URL-only or now-empty content;
5. retain the remaining human-readable text exactly enough for later deterministic Unicode cleanup.

Classification and content failures produce only aggregate reason codes. Non-text content never enters staging output. Mixed text remains after URL removal.

The normalized browser allow-list is:

```json
{
  "createTime": 0,
  "formattedTime": "YYYY-MM-DD HH:mm:ss",
  "calendarDate": "YYYY-MM-DD",
  "senderScope": "owner",
  "content": "synthetic example only",
  "fileRank": 0,
  "sourceIndex": 0
}
```

This is conceptual and synthetic. `sourceIndex` is the post-dedup canonical index; original raw array index is transient. The record contains no raw classification codes because eligibility has already been decided.

The deny-list includes `rawContent`, `source`, raw sender fields, avatars, all session names and identifiers, platform and local message identifiers, URLs, XML, application payloads, `chatRecords`, reply/group fields, media metadata, and non-text content. A final privacy validator recursively rejects unknown keys, forbidden keys, XML-like content, and URL spans before promotion. The result is called a **data-minimized local analysis dataset** because retained message text can still contain personal information.

### 8. Normalize time, rank files from data, and retain stable source order

`createTime` must be integer Unix seconds. `formattedTime` must be a real calendar value matching exact `YYYY-MM-DD HH:mm:ss` and equal the UTC+08:00 rendering of `createTime`. The preprocessor uses explicit UTC arithmetic, never host timezone or locale. A candidate text record with missing, invalid, or conflicting canonical time is skipped with an aggregate reason; source-level absence of enough valid timestamps to derive a range is fatal.

Filename dates are ignored. Each annual source's actual range comes from validated message timestamps. File rank sorts by:

1. minimum valid `createTime`;
2. maximum valid `createTime`;
3. explicit annual-source argument order.

Annual gaps are allowed. Annual overlaps are deduplicated; an overlap beyond a documented synthetic-test threshold produces an aggregate warning but is not itself fatal when the conversation matches.

The original source-array index is recorded transiently for every staged message. It remains the final tie-breaker for distinct messages with identical timestamps.

### 9. Deduplicate with transient cryptographic identities

Identity encoding uses fixed UTF-8 domains, unsigned 64-bit big-endian length prefixes for every variable-length byte field, and signed 64-bit big-endian fixed-width integers. Length prefixes include byte lengths, not character counts. Conversation-fingerprint bytes are the exact 32 bytes decoded from the validated 64-character lowercase hexadecimal fingerprint.

For a valid string `platformMessageId`, the primary input is:

```text
domain = ChatHistoryAnalysis/dedup/platform-id/v1
length(conversationFingerprintBytes) || conversationFingerprintBytes
length(platformMessageIdUtf8) || platformMessageIdUtf8
```

The identity key is SHA-256 of that encoding. An independent BLAKE2b verifier with a 16-byte digest uses the same fields under `ChatHistoryAnalysis/dedup/platform-id-verifier/v1`. The raw platform ID remains a string only while streaming, is never parsed as a number or logged, and is discarded immediately after both digests are computed.

If the platform ID is absent, empty, or non-string, the fallback input is:

```text
domain = ChatHistoryAnalysis/dedup/fallback/v1
length(conversationFingerprintBytes) || conversationFingerprintBytes
int64(createTime)
length(formattedTimeUtf8) || formattedTimeUtf8
length(senderScopeUtf8) || senderScopeUtf8
length(normalizedMessageTypeUtf8) || normalizedMessageTypeUtf8
length(contentSha256Bytes) || contentSha256Bytes
```

Its key is SHA-256. Its 16-byte BLAKE2b verifier uses `ChatHistoryAnalysis/dedup/fallback-verifier/v1`. The content component is the 32-byte SHA-256 of cleaned content, never the content itself. Primary and fallback domains are deliberately distinct. `localId`, timestamp, or source-array index alone are prohibited identities.

The SQLite store contains one staging-record table and exactly ten columns:

| Column | Boundary |
| --- | --- |
| `identity_kind` | non-null text, `platform-id-v1` or `fallback-v1` |
| `identity_digest` | non-null 32-byte SHA-256 blob |
| `identity_verifier` | non-null 16-byte BLAKE2b blob |
| `create_time` | non-null canonical integer seconds |
| `formatted_time` | non-null canonical fixed-zone text |
| `calendar_date` | non-null canonical date text |
| `sender_scope` | non-null text, `owner` or `other` |
| `content` | non-null cleaned eligible text |
| `file_rank` | non-null non-negative deterministic integer rank |
| `source_array_index` | non-null non-negative original per-source ordinal |

The unique constraint is `(identity_kind, identity_digest, identity_verifier)`. A separate `(identity_kind, identity_digest)` lookup detects a primary-digest match before duplicate resolution, and `(create_time, file_rank, source_array_index)` supports canonical output. No raw identifier is hidden in a table, index, constraint, or auxiliary metadata. In particular SQLite never stores raw platform/local IDs, raw/session/sender fields, URLs, XML, application/media payloads, source paths, or basenames.

Matching kind, SHA-256, and verifier means a duplicate. The deterministic survivor has lowest file rank and then lowest source-array index. Matching kind and SHA-256 with a different verifier is not a duplicate: it stops preprocessing as `CRYPTOGRAPHIC_IDENTITY_COLLISION`, promotes nothing, and reveals no identifier, content, digest, or location. Keeping both records or silently selecting one is prohibited.

After deduplication, surviving records sort by `createTime`, file rank, and original source-array index. The writer assigns zero-based monotonically increasing canonical `sourceIndex`.

The staging directory is a unique sibling of the requested final directory inside the selected Git-ignored normalized-output parent, which also guarantees the same filesystem for atomic promotion. The process sets an umask equivalent to `0077`, creates the directory as `0700`, and creates the database and regular files as `0600`. It never prints the staging directory or database location and never uses a global database directory or generic shared temporary directory.

Before private insertion, the connection sets and verifies:

```text
PRAGMA journal_mode=DELETE
PRAGMA temp_store=MEMORY
PRAGMA secure_delete=ON
PRAGMA busy_timeout=0
```

The connection uses no shared cache. WAL is prohibited. The MVP table has no foreign keys; any future foreign-key schema must also set and verify `PRAGMA foreign_keys=ON`. Memory temp storage prevents SQLite sort/index spill into system temporary directories and must survive supported-maximum profiling. If it does not, work stops for an OpenSpec revision instead of silently enabling disk spill. Deprecated or process-global temporary-directory configuration is prohibited. `secure_delete=ON` reduces ordinary deleted-page remnants but cannot promise forensic or cryptographic erasure, especially on SSDs.

### 10. Emit deterministic bounded NDJSON and a canonical manifest

Output is conceptually:

```text
data/exports/normalized/<dataset-name>/
  manifest.json
  chunk-0001.ndjson
  chunk-0002.ndjson
  ...
```

The actual output directory is explicit and must be Git-ignored. Chunks are created in canonical record order. Each line is one compact JSON object with fixed allow-list field order, UTF-8 without BOM, no insignificant whitespace, and one LF. Actual encoded UTF-8 bytes, including that LF, determine boundaries. An exactly 33,554,432-byte record or chunk is valid. A 33,554,433-byte record is fatal `NORMALIZED_RECORD_TOO_LARGE`, is never written, and prevents promotion. If adding an otherwise valid record would make a non-empty chunk exceed the inclusive limit, the writer closes that chunk and writes the complete record as the first line of the next deterministic chunk. The first record creates the first chunk; empty chunks are never emitted.

The canonical manifest contains:

- normalized schema and preprocessor tool versions;
- pseudonymous conversation fingerprint;
- explicit UTC+08:00 policy;
- ordered input descriptors containing role, supplied ordinal, byte size, and SHA-256 but no raw path or basename;
- ordered chunk names, byte sizes, record counts, and SHA-256;
- aggregate source and normalized record counts;
- aggregate skipped-record counts by non-sensitive reason;
- duplicate, overlap, verification, and warning counts;
- actual data-derived minimum and maximum time;
- owner/other scope counts;
- forbidden-field privacy-validation result.

It contains no raw identity, raw identifier, message value, source path, or current wall-clock generation time.

Manifest serialization uses UTF-8, LF, stable integer formatting, sorted object keys, and compact separators. Identical inputs, roles, order, tool/schema versions, and settings must produce byte-identical chunks and manifest. Input order intentionally affects the final tie-breaker when actual ranges are identical.

Zero eligible records is fatal `NO_ELIGIBLE_TEXT_RECORDS`. No zero-record dataset, manifest, or empty chunk is promoted. The CLI remains reusable and may report aggregate skipped counters through the error allow-list.

### 11. Promote output atomically and classify failures

The final destination must not exist as a file, directory, or symbolic link. Collision is fatal `OUTPUT_DESTINATION_EXISTS`; this MVP never overwrites, merges, deletes, or replaces it. The private staging sibling lives in the same parent and filesystem. The CLI:

1. streams and validates all sources;
2. validates same-session and verification rules;
3. enforces all limits;
4. writes and closes chunks;
5. computes and re-verifies manifest and chunk hashes;
6. runs recursive normalized-schema and privacy validation;
7. writes and re-reads the canonical manifest;
8. closes SQLite;
9. enumerates and removes the main database, `-journal`, `-wal`, `-shm`, every statement journal, temporary manifest/chunk files, fixed staging marker, and every other non-output entry one explicit path at a time;
10. asserts that only the validated manifest and referenced non-empty chunks remain;
11. rechecks that the final destination is absent and its parent is on the same filesystem;
12. atomically renames the directory once.

There is no cross-filesystem or copy-based fallback. Disk exhaustion, write/flush failure, hash mismatch, interrupted writing, pre-rename cleanup/assertion failure, or rename failure cannot expose an apparently valid final dataset. A handled failure closes resources and enumerates cleanup after validation, parsing, capacity, output, cancellation, and handled-interruption exits. A rename either publishes the entire validated directory or leaves the destination absent; a remaining private sibling is cleanup/recovery state, never a final dataset. Source files are always read-only.

Abrupt process termination, OS crash, or power failure can leave a private sibling. Recovery is an explicit CLI mode, not an automatic broad cleanup:

- scan only the normalized-output parent explicitly selected by the user;
- recognize a candidate using the fixed staging-name prefix and `.chathistoryanalysis-private-stage-v1` marker;
- reject symbolic links, ownership other than the current user, directory permissions other than `0700`, regular-file permissions other than `0600`, unexpected entry types, or containment outside the parent;
- report only candidate ordinals, counts, and stable state codes;
- require explicit confirmation and delete exactly one selected candidate per invocation, one entry at a time;
- never print a path, basename, directory name, filename, or content and never claim forensic erasure.

Error classes:

- **Startup:** unsupported runtime, unverified distribution, unavailable/mismatched backend, or parser initialization failure before raw input opens.
- **Fatal dataset:** invalid UTF-8/JSON/contract, group chat, different conversation, unusable session identity, cryptographic identity collision, unsafe `localType`, zero eligible records, oversized record, raw/normalized limit, or deterministic time/range failure.
- **Fatal output:** write, flush, hash, privacy validation, manifest, cleanup, or atomic rename failure.
- **Recoverable record:** malformed record, unsupported non-text type, missing optional data, valid-`isSend` metadata conflict, classification conflict, or ineligible content.
- **Verification failure:** invalid or inconsistent overlap-verification input; aborts promotion only when included in the preprocessing run.

All presentation surfaces share one allow-list: source ordinal, input role, processing phase, field name, line/record ordinal, stable reason code, aggregate count, percentage, and non-sensitive capacity value. The deny-list includes absolute/relative paths, basenames, directory/output/SQLite locations, user-derived dataset labels, participant values, message IDs, per-message hashes, content fragments, URLs, and raw parser excerpts. Sources appear only as fixed labels such as `annual-source #1` or `overlap-verification #1`; output errors expose only phase and reason code. Exception messages never pass through: adapters map them to content-free project categories before stdout, stderr, browser errors, progress events, screenshots, snapshots, debug logs, or manifest warnings.

SIGINT/cancellation sets a flag checked between parser events, SQLite batches, merge reads, and chunk writes. It exits distinctly after cleanup. Per-file progress uses bytes read where the streaming API exposes it plus message counts; aggregate progress uses completed input count and named phases. Percentages are described as estimates until totals are known.

### 12. Accept only normalized artifacts in the browser

The React/TypeScript application stages one `manifest.json` plus all referenced chunks through local File APIs. Multi-file selection and drag/drop are required; directory selection is an optional enhancement where supported. Matching is by exact manifest chunk name, size, and hash. Extra, missing, duplicate, or oversized files reject the candidate.

The application detects the raw CipherTalk top-level shape and rejects it with guidance to run the local preprocessor. It never reads raw messages.

Normalized files remain wherever the user generated them. They are not copied to source control, Vite `public/`, or `dist`. The Vite app itself runs on loopback, but File API reads are not HTTP uploads.

The main thread preflights selected file count and aggregate `File.size`, then transfers file handles/blobs to one Worker. It does not call `.text()` or retain the full normalized dataset.

### 13. Validate and analyze in one Web Worker

The Worker lifecycle is:

1. parse and validate the small manifest;
2. verify selected names, sizes, aggregate limits, and compatible schema;
3. for each chunk in manifest order, read at most one 32 MiB `ArrayBuffer`, compute SHA-256 using `crypto.subtle.digest`, and compare the manifest;
4. initialize `jieba-wasm` lazily once;
5. fatally decode the verified chunk and parse NDJSON line by line;
6. validate each exact allow-list record and monotonic order;
7. tokenize each record once and retain only the evidence-selected compact cache plus sender/date/index metadata;
8. discard the chunk text and release its buffer before the next chunk;
9. report phase, chunk, and overall progress;
10. apply controls to cached tokens;
11. calculate frequencies and stable ranking;
12. return only aggregate results to the main thread.

The chunk size bound makes one-shot browser SHA-256 digesting bounded. Malformed lines report chunk and line ordinals only.

Settings changes never re-segment text. The Worker filters cached token records by sender scope and inclusive calendar date, counts tokens, sorts descending frequency then ascending Unicode code-point order, and applies minimum frequency and maximum word count. A new dataset or explicit tokenizer-setting change invalidates the cache; normal sender/date/display changes do not.

Cancellation messages are checked between chunks, NDJSON records, tokenization batches, and aggregation batches. A cancelled candidate/cache is discarded and the UI becomes reusable. There is no hidden complete-dataset main-thread fallback. Memory/allocation failure produces a content-free local error and clears staged state.

### 14. Keep fixed local Jieba behavior inside the Worker

The Worker uses exactly `jieba-wasm@2.4.0`, exact lockfile integrity, its embedded dictionary, lazy singleton `init()`, and `cut(text, false)`. HMM is disabled. Full/search modes, `add_word`, `with_dict`, custom dictionaries, `Intl.Segmenter` fallback, and online fallback are forbidden.

Content processing order is:

1. NFKC normalization;
2. lowercase English;
3. turn emoji, punctuation, and whitespace into separators;
4. reject separator-only input;
5. segment Chinese with fixed Jieba behavior and extract Unicode English alphabetic runs;
6. apply the local versioned stop-word set;
7. apply Unicode-code-point minimum length;
8. remove numeric-only tokens.

The future Vite compatibility spike must prove that Worker JavaScript can initialize the package's WASM from the same loopback origin in development and production preview. Failure blocks implementation rather than moving segmentation to the main thread or substituting a tokenizer.

### 15. Keep presentation local, deterministic, and accessible

The main thread owns only:

- normalized file selection;
- sender/date and threshold controls;
- progress, cancellation, and errors;
- aggregate result state;
- word-cloud and ranked-list rendering;
- PNG export.

The canonical Worker result contains full frequencies, stable ranked tokens, analyzed-message count, unique-token count before display thresholds, selected scope/range, and aggregate diagnostics. Cloud and ranked list consume the same ordered display list. Frequency values and ranking are deterministic; pixel placement is not unless the selected ECharts word-cloud extension supports and is configured with a stable seed.

The ranked list is the exact accessible representation. Controls use labels, logical keyboard order, visible focus, associated errors, status announcements, non-color-only feedback, and a painted busy state. Cancellation restores focus to a useful control.

PNG export uses only the current visualization and a non-sensitive filename. No message text, identity, normalized source name, or private metadata is embedded.

### 16. Preserve the loopback and offline runtime model

Development uses Vite bound to loopback. Production verification builds the static application and serves `dist` from a loopback same-origin HTTP server. Direct `file://`, public hosting, Electron/Tauri, and remote runtime assets are unsupported.

All JavaScript, Worker code, WASM, embedded dictionary, stop words, fonts, ECharts code, and word-cloud extension are packaged locally. Browser tests abort every non-loopback request. Preprocessing has no networking code path. There is no local API server, FastAPI process, account, cloud service, or telemetry containing private data.

`data/private/`, `data/exports/`, and normalized output locations remain Git-ignored. Only synthetic chat-shaped data may be committed.

The repository root also provides `Start Chat Analysis.command` and `Stop Chat Analysis.command` for Finder use. Both resolve the canonical project root from their own real location and support spaces without a user-specific absolute path. Start verifies the documented local Node/npm boundary, `package.json`, and authoritative `package-lock.json`. When `node_modules`, the project-local Vite entry, or another required direct dependency is missing, Start runs project-local `npm ci` automatically without terminal input, global installation, a floating dependency command, or a global npm configuration change. Dependency installation may use the configured registry and is not described as offline; after it succeeds, application build and runtime remain local and make no external request. Installation failure exits nonzero before preview, browser opening, or publication of valid instance state and does not disturb an existing valid instance.

The preview process is the actual Node process executing a project-local `frontend/scripts/preview-launcher.mjs`, which uses Vite's Node API in-process with fixed canonical root, config, `127.0.0.1`, port, and `strictPort`. Each new instance receives a cryptographically random nonce of at least 128 bits. Start securely creates a unique owner-only identity file and log, passes their exact paths plus the nonce to the launcher, and the launcher holds the identity file descriptor open for its lifetime. Published state records the real PID, canonical Node executable, canonical launcher and project paths, exact structured arguments, nonce, identity/log paths, and a full process-start fingerprint. Ordinary argv substrings alone are never sufficient ownership evidence.

Before either script accesses runtime state, it requires the canonical project root to contain the runtime path, rejects a runtime-directory symlink or non-directory, verifies current-user ownership and permissions no wider than `0700`, and never recursively changes an unverified directory. State, PID when retained, identity, and log entries are current-user regular files created with exclusive no-follow semantics and mode `0600`. State is written to a random secure temporary file and published by atomic rename; existing symlink entries are rejected or the path entry itself is replaced without following its target. Stop rejects symlink, wrong-owner, non-regular, duplicate, unknown, missing, or malformed state fields. Cleanup removes only validated paths for the one project instance and never follows a symlink.

Stop parses rather than executes state. Before `TERM`, it verifies the unchanged process-start fingerprint, actual process executable, exact launcher path and tokenized launcher arguments, exact nonce/host/port/strict-port/root/config/identity values, and that the target process currently holds the exact identity file open. PID reuse, argv spoofing, unrelated processes, wrong nonce, or an identity file not held open are refused with diagnostic state preserved. If bounded shutdown reaches `KILL`, the complete verification is performed again and every identity factor must still match. Global name-, runtime-, or port-based termination is prohibited. Successful stop or a confirmed absent stale PID removes only validated files belonging to this instance and never affects another Node, Vite, npm, browser, or port owner.

The public `frontend/public/THIRD_PARTY_NOTICES.txt` traces the actual embedded Jieba dictionary through fixed `fxsjy/jieba`, `jieba-rs`, and `jieba-wasm` revisions, and records the bundled `echarts-wordcloud` and `wordcloud2.js` relationship. It preserves the applicable upstream copyright and complete license texts. Vite copies this file unchanged into `dist/`, and the local shell may link only to that same-origin copy. Remote repository links are evidence references, not runtime license delivery.

### 17. Test at privacy, determinism, and supported-scale boundaries

Unit and integration tests use only synthetic data and cover:

- every raw and normalized inclusive limit and first-over-limit rejection;
- startup rejection for unsupported runtime, wrong `ijson` version/hash, missing or mismatched backend, parser self-check failure, and the successful gate before any raw open;
- strict UTF-8, one top-level JSON, comments/trailing data, top-level contract, private session, and same-session fingerprints;
- multiple annual files, explicit roles, full overlap verification, verification failure, gaps, overlap, and filename/range mismatch;
- primary/fallback domain and length encoding, duplicate identities, simulated SHA collision with a different verifier, raw-ID absence from SQLite, duplicated `localId`, identical timestamps, file ranking, and canonical indexing;
- safe integers above 32-bit, unsafe values, complete `chatLabType` mappings, type conflicts, and conservative image/media exclusion;
- exact eligible-text agreement, URL removal, placeholders, XML, multilingual text, emoji, malformed content, sender conflicts, and fixed UTC+08:00;
- exact SQLite columns/indexes, privacy PRAGMAs, permissions, every handled cleanup exit, sidecar absence, and safe one-at-a-time crash recovery;
- exact/first-over record and chunk boundaries, first chunk, zero eligible records, byte-identical output after skips, disk exhaustion, destination collision, hash mismatch, interrupted pre-rename cleanup, promotion failure, and same-filesystem enforcement;
- allow-list serialization, every forbidden field, canonical chunks/manifest, byte-identical repeated output, and sensitive-string injection across every error/output surface;
- normalized File API selection, hash and NDJSON validation, Worker cancellation, progress, memory errors, token caching, and no main-thread fallback;
- fixed `jieba-wasm@2.4.0` output, retry behavior, stop words, frequency ties, sender/date controls, word cloud, accessibility, and PNG export;
- no external requests and no private files in source or build output.

The existing 5000-message fixture remains an integration baseline through preprocessing. Future implementation also adds a purely synthetic multi-year normalized dataset representing hundreds of thousands of text records and all audited edge shapes, without copying real values, hashes, URLs, or exact private distributions.

Browser capacity has a mandatory stop gate before capacity implementation can complete. Purely synthetic profiles must run at or near all three maxima: record count, aggregate normalized bytes, and per-chunk bytes. Each result records browser/version, OS, architecture, loaded bytes, records, peak Worker memory where measurable, main-thread responsiveness, cancellation, cache representation, and pass/fail without private data.

Evidence must select exactly one: token-ID arrays with a shared table, per-record metadata plus token-offset arrays, partitioned caches, or a reduced limit that first revises OpenSpec. Browser termination, persistent main-thread unresponsiveness, incomplete Worker tokenization, unsafe cache retention, unusable cancellation, or an exceeded/unjustified memory envelope leaves the capacity task incomplete and stops subsequent maximum-capacity acceptance. The implementation cannot claim the limits, silently lower them, retain duplicate full-text/tokenized representations, move complete processing to the main thread, or use cloud fallback while the gate fails.

## Risks / Trade-offs

- [Pinned native wheel is unavailable for a supported macOS/Python target] → Verify `ijson==3.5.1` wheel coverage and hashes before implementation; block rather than silently use another backend.
- [Temporary SQLite contains minimized text before promotion] → Apply `0077`/`0700`/`0600`, fixed privacy PRAGMAs, an exact minimized schema, exhaustive explicit cleanup, and marker-based recovery without claiming forensic erasure.
- [SHA-256 conversation fingerprint is reversible by guessing identifiers] → Label it pseudonymous, store no raw identity beside it, and keep the manifest private and ignored.
- [Verification failure blocks combined preprocessing] → Provide a separate read-only verification command and require the user to explicitly rerun without verification.
- [Unknown future CipherTalk types appear] → Default to non-text, count aggregate warnings, and update mappings only through reviewed evidence.
- [Text filtering removes legitimate text] → Prefer false negatives over admitting media/structured payloads; keep aggregate diagnostics and synthetic regression tests.
- [One 32 MiB chunk buffer plus token cache exceeds browser memory on constrained devices] → Enforce aggregate limits, release buffers between chunks, profile supported targets, and fail clearly without main-thread fallback.
- [Token cache remains sizable] → Use the mandatory maximum-boundary decision gate to select an evidence-backed compact or partitioned representation before accepting capacity.
- [`jieba-wasm` cannot initialize inside Vite Worker] → Treat compatibility verification as an implementation blocker; do not move full processing to the main thread.
- [Canvas layout is nondeterministic] → Keep frequencies and ranked list canonical; claim pixel determinism only if verified.
- [Atomic directory rename semantics differ across filesystems] → Require temporary and final directories to share a filesystem and test supported macOS filesystems.

## Migration Plan

1. Revise documentation and schema assumptions before any Apply work.
2. During implementation, add the hash-locked Python preprocessor dependency boundary and verify `ijson` backend compatibility.
3. Implement and test streaming validation, staging, minimization, deduplication, deterministic output, and atomic cleanup before using private data.
4. Add the React/Vite shell and verify Worker plus `jieba-wasm` packaging before the complete analysis pipeline.
5. Implement normalized selection, Worker loading/token cache, controls, visualization, PNG export, accessibility, and offline checks.
6. Run the mandatory synthetic SQLite and Worker maximum-boundary gates; stop and revise OpenSpec on failure.
7. Implement later maximum-capacity acceptance only after the gates pass.
8. Run privacy and Git-hygiene review before declaring the MVP complete.

There is no production deployment or data migration. Rollback removes the future application and preprocessor code while leaving raw exports and any previously generated ignored local datasets untouched.

## Open Questions

- What peak Worker memory is observed at the 1,000,000-record and 128 MiB supported boundaries on target browsers?
- Does the selected ECharts word-cloud extension provide a verified fixed layout seed, or will PNG placement remain explicitly nondeterministic?
- What synthetic overlap size should trigger the “suspiciously large annual overlap” warning without making valid repeat exports fatal?
