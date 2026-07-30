## 1. Dependency and Project Boundaries

- [x] 1.1 Create the local Python CLI module structure without introducing an HTTP server, API framework, database service, or network code path.
- [x] 1.2 Add an exact `ijson==3.5.1` dependency for the preprocessor and document its `BSD-3-Clause AND ISC` license.
- [x] 1.3 Pin the MVP runtime matrix to CPython 3.12.x on macOS arm64 and reject every other interpreter, minor, operating system, and architecture before opening raw input.
- [x] 1.4 Verify official `ijson==3.5.1` distribution SHA-256 values for that exact runtime/platform tuple and generate a hash-enforced lock file.
- [x] 1.5 Implement the pre-open startup gate for exact version, approved distribution hash, exact `yajl2_c` backend identity, and no automatic or Python-backend fallback.
- [x] 1.6 Implement the in-memory parser self-check and content-free startup categories `UNSUPPORTED_PYTHON_RUNTIME`, `IJSON_DISTRIBUTION_UNVERIFIED`, `IJSON_BACKEND_UNAVAILABLE`, `IJSON_BACKEND_MISMATCH`, and `IJSON_PARSER_INITIALIZATION_FAILED`.
- [x] 1.7 Prove with an unopened-source sentinel that no raw source is opened until every startup check succeeds.
- [x] 1.8 Create the React, TypeScript, and Vite application scaffold with loopback development, build, preview, type-check, lint, and test commands; add and test repository-root Finder start/stop commands with self-location, strict loopback single-instance state, safe port-conflict behavior, and identity-verified targeted shutdown.
- [x] 1.9 Establish separate modules for preprocessing contracts, normalized schema, browser input, Worker analysis, presentation, and privacy validation.
- [x] 1.10 Add exact `jieba-wasm@2.4.0` and verify package integrity, license, embedded dictionary, browser export, and Worker-compatible initialization.
- [x] 1.11 Select and pin ECharts plus a browser word-cloud extension after verifying local bundling, licensing, canvas PNG export, and stable ordered inputs.

## 2. CLI Input Roles and Capacity Preflight

- [x] 2.1 Implement repeated explicit `--annual-source`, repeated optional `--overlap-verification`, and required `--output-dir` arguments.
- [x] 2.2 Reject role inference from filenames or directory names and reject invocations without at least one annual source.
- [x] 2.3 Validate that every source is a readable regular local file and the output target is under a Git-ignored local path.
- [x] 2.4 Enforce the inclusive 536,870,912-byte per-raw-file limit before parsing.
- [x] 2.5 Enforce the inclusive 20 annual-source-file limit before parsing.
- [x] 2.6 Enforce the inclusive 2,147,483,648-byte aggregate raw-input limit across both roles.
- [x] 2.7 Enforce the inclusive 2,000,000 aggregate raw-message limit during streaming and abort on the next record.
- [x] 2.8 Add distinct content-free CLI exit codes for argument, input validation, ignore-policy, and capacity failures without presenting any path or basename.

## 3. Streaming JSON and Session Validation

- [x] 3.1 Implement a first binary pass that computes source SHA-256 and performs strict incremental UTF-8 validation without correction or replacement.
- [x] 3.2 Implement the bounded validation/range pass with `ijson.backends.yajl2_c.parse`, fixed options/buffer, no record persistence, and a concurrent hash check against pass one.
- [x] 3.3 Build a bounded event-state adapter that validates one object root and constructs only small top-level metadata plus one message object at a time.
- [x] 3.4 Validate object `exportInfo`, exact `detailed-json` format, object `session`, array `messages`, and single top-level JSON completion.
- [x] 3.5 Reject group and ambiguous sessions using exact private-session discriminators.
- [x] 3.6 Derive each source's actual minimum and maximum valid message time without trusting filenames.
- [x] 3.7 Derive a transient participant set and validate platform, owner, peer, and participant consistency for all annual sources.
- [x] 3.8 Implement versioned length-prefixed canonical session serialization and lowercase SHA-256 conversation fingerprints.
- [x] 3.9 Reject a different or insufficiently identifiable annual-source session before output promotion.
- [x] 3.10 After all final ranks are known, implement the bounded annual staging pass in rank order plus verification streaming without inserting verification records.
- [x] 3.11 Recompute and compare source SHA-256 during every post-digest pass; treat source mutation as fatal and remove staged mixed-version state.
- [x] 3.12 Ensure parser, UTF-8, schema, mutation, and session errors contain only field names, source ordinals, and reason codes.

## 4. Classification, Text Eligibility, Sender, and Time

- [x] 4.1 Implement the complete documented `chatLabType` primary mapping for 0, 1, 2, 3, 4, 5, 7, 8, 23, 24, 25, 27, 80, and 99.
- [x] 4.2 Implement `type` consistency validation and conservative non-text handling for conflicts and unknown primary codes.
- [x] 4.3 Parse `localType` only as a non-boolean safe integer and prohibit bitwise operations, 32-bit casts, `Int32Array`, and 32-bit database columns.
- [x] 4.4 Accept unknown safe `localType` values as transient metadata and remove the provisional `localType=49` canonical assumption.
- [x] 4.5 Implement the exact eligible-text conjunction `chatLabType===0`, `type==="文本消息"`, `localType===1`, and non-empty string content.
- [x] 4.6 Implement bracketed-placeholder, XML-like, URL-only, post-URL-empty, and malformed-content exclusions.
- [x] 4.7 Remove URL spans from mixed text while retaining remaining human-readable text.
- [x] 4.8 Implement exact numeric `isSend` normalization to `owner` or `other` without coercion.
- [x] 4.9 Keep valid `isSend` authoritative and aggregate owner/sender metadata conflicts without exposing identifiers.
- [x] 4.10 Validate integer Unix-second `createTime` and strict UTC+08:00 `YYYY-MM-DD HH:mm:ss` equality without host-timezone APIs.
- [x] 4.11 Skip ineligible records with aggregate non-sensitive reason counters and never retain non-text content.

## 5. File Ranking, Staging, Deduplication, and Merge

- [x] 5.1 Rank annual sources by actual minimum time, maximum time, and explicit user-supplied order.
- [x] 5.2 Permit annual gaps, detect overlaps, and emit an aggregate suspicious-overlap warning using a documented synthetic-tested threshold.
- [x] 5.3 Apply umask `0077` and create one unique marked `0700` staging sibling with `0600` files inside the selected ignored normalized-output parent.
- [x] 5.4 Verify the staging sibling and final destination parent share a filesystem; prohibit global database locations, generic shared temporary directories, cross-filesystem staging, and location disclosure.
- [x] 5.5 Create the exact ten-column staging-record table for identity kind/digests, canonical time/date, sender scope, cleaned content, file rank, and source-array index.
- [x] 5.6 Add only the unique `(identity_kind, identity_digest, identity_verifier)`, collision lookup `(identity_kind, identity_digest)`, and canonical ordering `(create_time, file_rank, source_array_index)` structures.
- [x] 5.7 Set and read back `journal_mode=DELETE`, `temp_store=MEMORY`, `secure_delete=ON`, and `busy_timeout=0` before private insertion; disable shared cache, prohibit WAL, and enable foreign keys if a revised schema adds them.
- [x] 5.8 Prohibit deprecated/process-global SQLite temp-directory settings and stop for an OpenSpec revision if supported-scale memory profiling cannot retain `temp_store=MEMORY`.
- [x] 5.9 Implement unsigned-64-bit length-prefixed `ChatHistoryAnalysis/dedup/platform-id/v1` SHA-256 identities over decoded 32-byte conversation fingerprint plus UTF-8 raw ID, with `ChatHistoryAnalysis/dedup/platform-id-verifier/v1` 16-byte BLAKE2b verifiers.
- [x] 5.10 Implement `ChatHistoryAnalysis/dedup/fallback/v1` SHA-256 identities plus `ChatHistoryAnalysis/dedup/fallback-verifier/v1` 16-byte BLAKE2b verifiers over decoded fingerprint, signed-64-bit time, length-prefixed formatted time/sender/type, and cleaned-content SHA-256 without raw content in the encoding.
- [x] 5.11 Discard raw string `platformMessageId` immediately after digesting and prove it, all other forbidden raw fields, paths, and basenames are absent from SQLite.
- [x] 5.12 Treat matching kind/SHA/verifier as duplicate, but stop with content-free `CRYPTOGRAPHIC_IDENTITY_COLLISION` when a matching kind/SHA has a different verifier.
- [x] 5.13 Resolve confirmed duplicates by file rank and original source-array index without using `localId`, timestamp, or source index alone.
- [x] 5.14 Preserve distinct messages with identical timestamps, order by time/rank/original index, and assign monotonically increasing canonical source indexes.
- [x] 5.15 Implement overlap-verification comparison without inserting verification records into annual totals or normalized output.
- [x] 5.16 Implement a separate read-only overlap-verification command and abort combined preprocessing promotion on verification failure.
- [x] 5.17 Implement marker-based recovery that scans only an explicitly selected output parent, reports ordinal counts/state codes, refuses symlinks or unsafe ownership/permissions/types, and deletes one explicitly confirmed recognized remnant per invocation entry-by-entry.
- [x] 5.18 Document logical cleanup without claiming forensic or cryptographic erasure.

## 6. Normalized Schema, Deterministic Output, and Atomicity

- [x] 6.1 Define the exact normalized record allow-list for time, calendar date, sender scope, cleaned content, file rank, and canonical source index.
- [x] 6.2 Define the recursive forbidden-field and forbidden-payload validator for normalized records, chunks, logs, snapshots, and errors.
- [x] 6.3 Implement compact canonical UTF-8 NDJSON serialization with fixed field order and LF line endings.
- [x] 6.4 Measure actual encoded UTF-8 record bytes including trailing LF; accept exactly 33,554,432 bytes and fatally reject the first byte over before writing an oversized chunk.
- [x] 6.5 Split before the next record would exceed the inclusive chunk maximum, accept an exactly full chunk, create the first chunk only for the first record, and never emit empty chunks.
- [x] 6.6 Fail zero eligible records with `NO_ELIGIBLE_TEXT_RECORDS`, promote no manifest/chunk, preserve CLI reuse, and report at most aggregate skipped counters.
- [x] 6.7 Generate deterministic zero-padded chunk names and preserve canonical record order and boundaries after recoverable skips.
- [x] 6.8 Define and implement the canonical manifest schema, stable serialization, versions, roles, hashes, counts, warnings, ranges, sender totals, and privacy result.
- [x] 6.9 Exclude raw paths, basenames, identities, messages, identifiers, and wall-clock generation time from the manifest.
- [x] 6.10 Enforce the inclusive 1,000,000 normalized-record and 134,217,728-byte aggregate normalized limits before promotion.
- [x] 6.11 Compute and re-verify input, chunk, and manifest integrity information before promotion.
- [x] 6.12 Run final exact-schema and privacy validation over every candidate chunk and manifest.
- [x] 6.13 Refuse an existing destination with `OUTPUT_DESTINATION_EXISTS`; provide no overwrite, merge, deletion, or replacement behavior.
- [x] 6.14 Enumerate and remove the database, `-journal`, `-wal`, `-shm`, statement journals, marker, temporary output, and every other non-output entry one explicit path at a time on every handled exit.
- [x] 6.15 Before promotion, close SQLite and assert only the validated manifest and referenced non-empty chunks remain, with no database or sidecar.
- [x] 6.16 Perform one same-filesystem atomic directory rename to the absent final destination with no cross-filesystem or copy fallback.
- [x] 6.17 Handle disk exhaustion, write/flush failure, hash mismatch, interrupted writing, pre-rename cleanup failure, and promotion failure without an apparently valid final dataset.
- [x] 6.18 Prove repeated preprocessing of identical synthetic inputs and settings produces byte-identical manifest and chunks.

## 7. CLI Progress, Cancellation, and Error Model

- [x] 7.1 Implement startup, fatal dataset, fatal output, recoverable record, verification failure, and cancellation project error types that discard internal exception messages.
- [x] 7.2 Apply the exact presentation allow-list—source ordinal, input role, phase, field, line/record ordinal, reason code, aggregate count, percentage, and non-sensitive capacity value—to every output surface.
- [x] 7.3 Prohibit absolute/relative paths, basenames, directory/output/SQLite locations, user-derived labels, participants, message IDs, per-message hashes, content fragments, URLs, and parser excerpts everywhere.
- [x] 7.4 Present sources only as fixed role/ordinal labels and output failures only as phase plus reason code.
- [x] 7.5 Report aggregate input completion and preprocessing phases within the allow-list.
- [x] 7.6 Implement SIGINT cancellation checks between parser events, staging batches, merge reads, and chunk writes.
- [x] 7.7 Ensure cancellation closes resources, enumerates temporary cleanup, preserves an absent or prior final destination, and exits distinctly.
- [x] 7.8 Ensure recoverable records increment aggregate reason counters and never appear in console details.
- [x] 7.9 Add disk, write, flush, hash, privacy, cleanup, and atomic-rename integrity failures as content-free fatal paths.
- [x] 7.10 Inject sensitive-looking strings and prove none reaches stdout, stderr, browser errors, progress events, screenshots, snapshots, debug logs, or manifest warnings.

## 8. Browser Normalized-File Input

- [x] 8.1 Implement local selection of one normalized manifest plus all referenced normalized chunks through multi-file File APIs.
- [x] 8.2 Add drag-and-drop support and evaluate optional directory selection without making it required.
- [x] 8.3 Detect and reject raw CipherTalk detailed JSON with guidance to run preprocessing.
- [x] 8.4 Reject missing, extra, duplicate, or ambiguously named normalized chunks.
- [x] 8.5 Preflight the inclusive 134,217,728-byte aggregate and 33,554,432-byte per-chunk browser limits before Worker parsing.
- [x] 8.6 Stage candidate files atomically so a failed replacement leaves the last accepted dataset and controls usable.
- [x] 8.7 Ensure normalized private files are never copied to Vite `public/`, application source, or `dist`.

## 9. Web Worker and WASM Lifecycle

- [x] 9.1 Create a typed Worker protocol for candidate validation, progress, cancellation, settings, aggregate results, and content-free errors.
- [x] 9.2 Transfer normalized File/Blob handles to the Worker and release avoidable full-text references on the main thread.
- [x] 9.3 Validate manifest schema/version, UTC policy, fingerprint shape, counts, names, and selected file set inside the Worker.
- [x] 9.4 Read one bounded chunk buffer at a time, compute SHA-256 with `crypto.subtle.digest`, and reject hash mismatches before tokenization.
- [x] 9.5 Fatally decode verified chunks and parse NDJSON incrementally in manifest order with exact allow-list validation.
- [x] 9.6 Verify monotonic normalized order, canonical source indexes, aggregate counts, ranges, and forbidden-field absence.
- [x] 9.7 Verify Vite development and production packaging of Worker JavaScript plus `jieba-wasm@2.4.0` WASM before building the full pipeline.
- [x] 9.8 Implement one lazy Jieba singleton per Worker dataset lifecycle using only `cut(text, false)` and the embedded dictionary.
- [x] 9.9 Tokenize every accepted record once, cache only the compact representation selected by the mandatory profiling decision with sender/date metadata, and release each chunk's normalized text and buffer before the next chunk.
- [x] 9.10 Implement safe Worker checkpoints for cancellation between chunks, lines, tokenization batches, and aggregation batches.
- [x] 9.11 Prohibit any hidden complete-dataset main-thread parsing or tokenization fallback.
- [x] 9.12 Handle Worker creation, WASM initialization, allocation, and memory-pressure failures with reusable content-free UI states.

## 10. Text Processing and Frequency Engine

- [x] 10.1 Implement NFKC, English lowercase, whitespace, punctuation, emoji-separator, and separator-only normalization.
- [x] 10.2 Combine fixed Jieba Chinese segmentation with Unicode English alphabetic runs.
- [x] 10.3 Add a local versioned stop-word asset with documented provenance, license, version, SHA-256, and exact-match normalization.
- [x] 10.4 Apply configurable stop words without mutating the embedded Jieba dictionary.
- [x] 10.5 Apply Unicode-code-point minimum token length and numeric-only token exclusion.
- [x] 10.6 Implement all, owner-only, and other-only filtering over cached token metadata.
- [x] 10.7 Implement full and inclusive custom calendar-date filtering from manifest-derived bounds.
- [x] 10.8 Implement deterministic token counts, analyzed-message and unique-token metrics, minimum frequency, and maximum displayed words.
- [x] 10.9 Sort equal frequencies by ascending Unicode code-point token order.
- [x] 10.10 Return one atomic aggregate result with no normalized message text.
- [x] 10.11 Reuse cached tokenization for sender, date, and display-threshold changes.

## 11. UI, Visualization, Export, and Accessibility

- [x] 11.1 Build normalized dataset selection with staged replacement, schema guidance, fatal/recoverable feedback, and retry behavior.
- [x] 11.2 Display actual data-derived range, normalized record count, aggregate warnings, and pseudonymous dataset status without participant identity.
- [x] 11.3 Build sender, inclusive date-range, maximum-word, and minimum-frequency controls with valid defaults and inline validation.
- [x] 11.4 Display chunk/phase progress and overall percentage with a cancel action and programmatic busy status.
- [x] 11.5 Restore a reusable state and logical focus after cancellation or memory failure.
- [x] 11.6 Render an ECharts word cloud and exact accessible ranked-frequency list from the same ordered result.
- [x] 11.7 Display analyzed-message count, unique-token count, selected scope/range, warnings, and an explicit empty state.
- [x] 11.8 Atomically update cloud, ranking, and metrics after settings changes.
- [x] 11.9 Export the current non-empty cloud as a local PNG with a non-sensitive filename and no private metadata.
- [x] 11.10 Verify keyboard order, visible focus, programmatic labels, associated errors, status announcements, and non-color-only feedback.

## 12. Preprocessor Unit and Integration Tests

- [ ] 12.1 Test every raw per-file, annual-count, aggregate-byte, and aggregate-message boundary at exact and first-over values.
- [ ] 12.2 Test every startup category plus success, wrong version, unapproved hash, missing/mismatched backend, parser initialization exception, and proof that raw input remains unopened on failure.
- [ ] 12.3 Test strict UTF-8, malformed/incomplete JSON, comments, trailing values, top-level types, detailed format, and group rejection.
- [ ] 12.4 Test same-session canonical encoding, pseudonymous fingerprint stability, participant consistency, and different-session rejection.
- [ ] 12.5 Test all documented `chatLabType` categories, unknown codes, `type` conflicts, and conservative inconsistent-image exclusion.
- [ ] 12.6 Test safe integers above signed 32-bit, unknown safe `localType`, unsafe integers, and absence of 32-bit operations/storage.
- [ ] 12.7 Test exact text agreement, placeholders, XML, URLs, mixed text, malformed content, and non-text content disposal.
- [ ] 12.8 Test `isSend`, metadata conflicts, strict UTC+08:00, filename/range mismatch, annual gaps, overlaps, and file ranking.
- [ ] 12.9 Test duplicate platform/fallback identities, matching SHA plus matching verifier, simulated matching SHA plus different verifier, domain separation, ambiguous lengths, and raw-ID absence from SQLite.
- [ ] 12.10 Test duplicate `localId`, identical timestamps, deterministic survivor selection, canonical indexing, and no prohibited identity basis.
- [ ] 12.11 Test exact staging columns/indexes, permissions, every PRAGMA, no shared cache/WAL/temp spill, forbidden raw-value absence, and stop-on-memory-policy failure.
- [ ] 12.12 Test complete and partial verification, different-session verification, combined-run failure, and separate read-only verification.
- [ ] 12.13 Test exact and first-over record/chunk boundaries, first chunk creation, zero records, manifest schema/hashes, recoverable-skip determinism, and no empty/oversized chunk.
- [ ] 12.14 Test disk exhaustion, destination collision, hash mismatch, interrupted pre-rename cleanup, simulated promotion failure, same-filesystem enforcement, and no copy fallback.
- [ ] 12.15 Test success/failure/cancellation/interruption cleanup of every database sidecar and non-output entry plus safe one-candidate crash recovery refusal/confirmation cases.
- [ ] 12.16 Test the output allow-list by injecting sensitive-looking paths, basenames, parser errors, identifiers, values, URLs, and hashes across every specified surface.

## 13. Browser, Worker, and Workflow Tests

- [ ] 13.1 Test normalized manifest/chunk selection, raw-export rejection, missing/extra files, exact limits, and staged replacement.
- [ ] 13.2 Test manifest version, hash mismatch, malformed NDJSON, forbidden fields, count/range mismatch, and canonical order rejection.
- [ ] 13.3 Test Worker protocol, progress sequencing, cancellation checkpoints, retry, per-chunk text/buffer release after compact caching, main-thread release, and no main-thread fallback.
- [ ] 13.4 Pin exact `jieba-wasm@2.4.0` `cut(text, false)` outputs and test singleton initialization and local failure behavior.
- [ ] 13.5 Test multilingual normalization, stop words, token length, numeric exclusion, sender/date scopes, cached recalculation, and stable ties.
- [ ] 13.6 Test atomic aggregate results, empty state, ranking, metrics, warnings, PNG availability, and private-metadata absence.
- [ ] 13.7 Test keyboard workflow, focus restoration, associated validation, progress announcements, and visible focus.
- [ ] 13.8 Serve the production build on loopback, reject every non-loopback request, and verify all Worker/WASM/dictionary/chart assets are local.
- [ ] 13.9 Verify no normalized manifest or chunk enters application source, `public/`, `dist`, snapshots, or test logs.
- [ ] 13.10 After tasks 12.1–12.16 and 13.1–13.9 pass using only synthetic fixtures, run the explicitly opted-in private one-year local validation checkpoint against exactly one user-selected read-only detailed JSON file: verify real-structure compatibility, single-file streaming, normalization, eligible-text and sender aggregates, Worker tokenization, frequencies, word-cloud preview, and local performance/memory; record only content-free pass/fail and environment metadata, never private aggregate values; do not scan private storage, make external runtime requests, retain generated body text by default after the session, or allow ignored local artifacts into Git.

## 14. Synthetic Multi-Year and Capacity Validation

- [ ] 14.1 Extend the future synthetic generator with multiple annual files and a fully overlapping verification source without using real values.
- [ ] 14.2 Add synthetic repeated `localId`, unique and missing string platform identifiers, primary/fallback identities, verifier matches, simulated digest collision, ambiguous-length inputs, and deterministic duplicate cases.
- [ ] 14.3 Add synthetic large safe `localType`, above-32-bit values, identical timestamps, sender conflicts, optional arrays, avatar-shape differences, and null non-text content.
- [ ] 14.4 Add synthetic type conflicts, inconsistent image classification, annual gaps, filename/range mismatch, and different-session sources.
- [ ] 14.5 Preserve the current 5000-message fixture and verify its end-to-end preprocessing and browser analysis path.
- [ ] 14.6 Generate purely synthetic datasets at or near 1,000,000 eligible records, 134,217,728 aggregate normalized bytes, and 33,554,432 bytes per chunk.
- [ ] 14.7 Profile raw streaming and SQLite peak memory at supported maxima, prove `temp_store=MEMORY` viability, and stop for OpenSpec revision if it fails.
- [ ] 14.8 Profile every browser maximum and record browser/version, OS, architecture, loaded bytes, record count, peak Worker memory where measurable, responsiveness, cancellation, cache representation, and pass/fail without private data.
- [ ] 14.9 Use profiling evidence to select and document token-ID/shared-table, metadata/token-offset, partitioned-cache, or revised-reduced-limit architecture.
- [ ] 14.10 Enforce the mandatory stop gate for browser termination, persistent main-thread unresponsiveness, incomplete tokenization, unsafe cache retention, unusable cancellation, or unjustified/exceeded memory.
- [ ] 14.11 While the gate fails, leave capacity incomplete, stop later maximum-capacity acceptance, claim no current-limit support, and prohibit main-thread/cloud fallback, silent reduction, or duplicate full-text/token storage.
- [ ] 14.12 Only after the gate passes, complete maximum-capacity hash, tokenization, responsiveness, cancellation, compact-cache, and cached-recalculation acceptance.

## 15. Documentation, Privacy Review, and Final Acceptance

- [ ] 15.1 Document CLI roles, examples, exact raw and normalized limits, output location, cancellation, errors, and offline behavior.
- [ ] 15.2 Document `ijson==3.5.1`, exact backend/options, Python boundary, official hashes, license, hash-enforced lock, and failure policy.
- [ ] 15.3 Document normalized schema, manifest, chunks, pseudonymous fingerprint caveat, deduplication, ranking, deterministic serialization, and atomic promotion.
- [ ] 15.4 Document browser normalized-file selection, Worker lifecycle, token cache, controls, Vite loopback launch, unsupported `file://`, and PNG export.
- [ ] 15.5 Update schema documentation with only aggregate-safe confirmed observations, implementation policy, and remaining provisional behavior.
- [ ] 15.6 Verify raw and normalized paths remain ignored and inspect all diffs, build output, logs, snapshots, and fixtures for private data.
- [ ] 15.7 Verify no cloud service, remote API, FastAPI server, account, public deployment, Electron/Tauri wrapper, or excluded analysis feature entered scope.
- [ ] 15.8 Run unit, integration, browser, accessibility, privacy, offline, type-check, lint, and production-build suites.
- [ ] 15.9 Reconcile implementation against every specification scenario and record any explicitly approved deviations before completion.
- [ ] 15.10 After explicit user opt-in, run private full final acceptance only at this final stage for formal multi-file merge, ordering, deduplication, final totals, full-range filtering, and the final word cloud; use any overlapping one-year export only for overlap, deduplication, and consistency verification, never as an additional contribution to totals, and keep all inputs, artifacts, diagnostics, and evidence within the private local boundary.
