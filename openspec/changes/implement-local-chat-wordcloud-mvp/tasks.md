## 1. Project and Application Scaffold

- [ ] 1.1 Create a React, TypeScript, and Vite application scaffold with loopback development, production build, loopback preview, type-check, lint, and test commands; document that `file://` is unsupported.
- [ ] 1.2 Establish feature folders for input/parsing, normalized domain models, text analysis, visualization, and UI components without coupling analysis modules to React.
- [ ] 1.3 Add exact `jieba-wasm@2.4.0`, verify its published integrity, MIT license, browser export, `await init()`, `cut(text, false)`, embedded dictionary, lazy-singleton lifecycle, and Vite same-origin WASM output; stop for design revision rather than substituting a dependency if verification fails.
- [ ] 1.4 Verify ECharts and its word-cloud extension support the chosen Vite/TypeScript setup, canvas PNG export, local bundling, license requirements, and stable ordered inputs; record and install the selected visualization dependencies.
- [ ] 1.5 Configure unit, component, and browser test environments and add smoke tests for loopback development and the locally served production build with all non-loopback requests blocked.

## 2. CipherTalk JSON Types and Parser

- [ ] 2.1 Define untrusted input types for `exportInfo`, `session`, and message records plus a separate immutable normalized domain model.
- [ ] 2.2 Implement `.json` selection with an inclusive 33,554,432-byte `File.size` preflight, staged candidate state, and atomic replacement only after all file-level checks pass.
- [ ] 2.3 Implement `ArrayBuffer` reading and fatal UTF-8 decoding equivalent to `TextDecoder("utf-8", { fatal: true })`, with a safe encoding error and no `U+FFFD` substitution.
- [ ] 2.4 Implement JSON parsing and fatal top-level validation for object root, object `exportInfo`, exact `detailed-json` format, object private-chat `session`, array `messages`, and inclusive 50,000-message limit.
- [ ] 2.5 Explicitly reject group or ambiguous sessions, same-shaped unsupported JSON, wrong formats, and excessive message counts without partially analyzing or replacing prior successful state.
- [ ] 2.6 Tolerate unknown non-discriminator fields, attach provisional-schema status to the loaded result, and ensure errors never echo chat content.
- [ ] 2.7 Distinguish typed file-level errors from recoverable message-level warnings and derive file name, session display name, normalized message count, and canonical time/date range for the loaded-session summary.

## 3. Validation and Message Normalization

- [ ] 3.1 Normalize required type/content fields plus nullable sender identity fields into new records with stable source indexes, skipping only individually unrecoverable entries.
- [ ] 3.2 Implement exact numeric `isSend` normalization for `0` and `1`, reject all coercible or unsupported values, and keep `isSend` authoritative when sender metadata conflicts.
- [ ] 3.3 Treat missing `ownerId` as recoverable metadata, warn on missing/conflicting owner and sender identity, and preserve the one other-participant scope for valid non-owner records.
- [ ] 3.4 Implement strict real-calendar `YYYY-MM-DD HH:mm:ss` parsing and finite integer Unix-second `createTime` parsing without host-timezone APIs.
- [ ] 3.5 Implement the fixed-UTC+08:00 fallback in both directions, preserve split canonical roles on conflicts, mark fallbacks, warn on conflicts, and skip records only when both time fields are unusable.
- [ ] 3.6 Sort chronologically by normalized `createTime` and then source index, and derive date-control bounds and inclusion keys only from canonical normalized wall-clock dates.
- [ ] 3.7 Compare derived count and time range with session metadata and surface discrepancies as non-fatal warnings.
- [ ] 3.8 Add immutability checks proving every success and rejection path leaves the parsed source object and selected file unchanged.

## 4. Text Filtering and Chinese Segmentation

- [ ] 4.1 Implement composable message-type predicates for documented text, image, voice, video, animation-emoji, structured-content, system, and call codes, including provisional handling of `localType=10000`.
- [ ] 4.2 Implement content rules for null/empty values, known media placeholders, raw XML, URL removal, URL-only messages, and standalone numbers.
- [ ] 4.3 Implement NFKC, whitespace, repeated-punctuation, and English lowercase normalization without losing usable surrounding text, and reject punctuation/separator-only content before tokenization.
- [ ] 4.4 Implement the lazy-singleton `jieba-wasm@2.4.0` adapter using only `cut(text, false)`, combine Chinese output with Unicode English word runs, and return a retryable safe error without online fallback if local initialization fails.
- [ ] 4.5 Treat emojis as separators, skip malformed fragments safely, and produce aggregate non-content-bearing filter diagnostics.
- [ ] 4.6 Add a versioned local default stop-word asset with documented source, license, version, and SHA-256 plus configurable normalized stop-word and Unicode-code-point minimum-length filters that never mutate the Jieba dictionary.

## 5. Frequency Calculation

- [ ] 5.1 Implement all-participant, owner-only, and other-participant selection using normalized private-chat `isSend` semantics.
- [ ] 5.2 Implement full-range and inclusive custom calendar-date filtering with validation against the available range.
- [ ] 5.3 Increment analyzed text-message count exactly at tokenization submission, including stop-word-only or later-thresholded text while excluding placeholders, malformed, URL-only, and punctuation-only inputs rejected earlier.
- [ ] 5.4 Implement pure token counting, unique-token totals, minimum-frequency filtering, and maximum-displayed-word limiting.
- [ ] 5.5 Implement deterministic ranking by descending frequency and ascending Unicode code-point token order for ties.
- [ ] 5.6 Return one canonical analysis result containing frequencies, ranking, metrics, sender scope, date range, settings, and aggregate diagnostics.

## 6. Word-Cloud Visualization and Ranking

- [ ] 6.1 Build the ECharts word-cloud adapter from the canonical ordered display list, using a fixed layout seed if the selected library supports one.
- [ ] 6.2 Build a ranked high-frequency-word list from the same display list and expose exact token/count values as the accessible representation of the cloud.
- [ ] 6.3 Add responsive visualization sizing, readable labels, and a clear empty state when no tokens meet the active filters.
- [ ] 6.4 Confirm cloud rendering never changes canonical frequencies or ranking and document that pixel placement is not part of deterministic acceptance.

## 7. Analysis Controls and Summary Metrics

- [ ] 7.1 Build an explicitly labeled local JSON file selector with staged replacement, loading state, distinct fatal/recoverable feedback, and reusable controls after byte-, count-, encoding-, or schema-limit rejection.
- [ ] 7.2 Display loaded file/session metadata, derived normalized message count and canonical time/date range, provisional-schema notice, fallback/conflict status, and aggregate non-fatal warnings.
- [ ] 7.3 Build sender-scope, full/custom date-range, maximum-word, and minimum-frequency controls with valid defaults and inline validation.
- [ ] 7.4 Implement generation and atomic regeneration so cloud, ranking, counts, scope, and range always update from the same result.
- [ ] 7.5 Add analyzed-message count, unique-token count, selected sender scope, and selected date range to the result summary.
- [ ] 7.6 Add a retryable non-content-bearing tokenizer-initialization state that retains the accepted dataset but disables partial results and export.
- [ ] 7.7 Verify logical keyboard order, visible focus, programmatic labels, associated errors, non-color-only feedback, and a painted programmatic busy state across all controls.

## 8. PNG Export

- [ ] 8.1 Implement browser-only conversion of the current word-cloud canvas to a PNG blob and trigger a local download.
- [ ] 8.2 Generate a non-sensitive export filename from the source base name and selected range without embedding raw messages or participant identifiers.
- [ ] 8.3 Disable export when there is no non-empty generated cloud and expose the reason to keyboard and assistive-technology users.
- [ ] 8.4 Verify the exported PNG represents the current settings and requires no upload, backend, or online service.

## 9. Tests and Fixture Validation

- [ ] 9.1 Add byte-boundary and decoder tests for below/exactly-at/over 33,554,432 bytes, valid UTF-8, invalid UTF-8, pre-read rejection, staged replacement, understandable errors, and unchanged source data.
- [ ] 9.2 Add file-schema tests for the correct private detailed JSON, malformed JSON, wrong root, same-shaped unsupported JSON, wrong `format`, non-array `messages`, group/ambiguous sessions, exact/over 50,000 messages, unknown fields, and whole-file rejection.
- [ ] 9.3 Add message normalization tests for partially malformed entries, exact `isSend` values, every invalid `isSend` form, missing `ownerId`, owner/sender conflicts, missing optional sender fields, and recoverable warnings.
- [ ] 9.4 Add time tests for strict formatted values, invalid/missing fields, fixed-UTC+08:00 fallback in both directions, conflicts, midnight, inclusive boundaries, invalid `createTime`, both fields invalid, identical timestamps, and host-timezone independence.
- [ ] 9.5 Add filtering tests covering every excluded type, empty/null content, placeholders, XML, URLs, numbers, English, Chinese, mixed text, emojis, punctuation-only input, and malformed content.
- [ ] 9.6 Pin exact `jieba-wasm@2.4.0` `cut(text, false)` outputs and test singleton initialization, no custom dictionary mutation, local failure/retry, stop-word asset integrity, token length, frequency, scope, thresholds, repeatability, and stable ties.
- [ ] 9.7 Test analyzed-message counting for stop-word-only text, punctuation-only content, excluded placeholders, and submitted text producing no displayed token.
- [ ] 9.8 Add an integration test that confirms and analyzes the 2,634,343-byte, 5000-message fixture and verifies its checksum is unchanged.
- [ ] 9.9 Add component/browser tests for summaries, oversized recovery, validation, date/sender controls, regeneration, empty results, tokenizer failure, painted busy state, ranking, keyboard use, and PNG-export availability.
- [ ] 9.10 Serve the built application on loopback, block and fail on every non-loopback request, confirm all JavaScript/WASM/dictionary/stop-word/font/chart assets are local, and exercise analysis plus PNG export.
- [ ] 9.11 Profile the 5000-message browser workflow and record fixture-scale usability; if acceptance fails, stop for an explicit architecture revision rather than introducing a hidden Worker or streaming parser.
- [ ] 9.12 Run the complete automated suite, type-check, lint, and production build and record successful acceptance with no uncaught error or unusable controls.

## 10. Documentation and Privacy Review

- [ ] 10.1 Document Vite loopback development, build and loopback preview commands, unsupported `file://`, excluded desktop wrappers/public deployment, supported input limits, settings, filtering, deterministic-result boundary, and PNG export.
- [ ] 10.2 Document exact `jieba-wasm@2.4.0`, npm integrity, embedded dictionary identity, lazy-singleton `init()`, fixed `cut(text, false)`, failure behavior, stop-word provenance/checksum, and visualization dependencies/licenses.
- [ ] 10.3 Update schema-facing documentation with only evidence learned during implementation and retain the explicit provisional warning pending an authorized real CipherTalk export.
- [ ] 10.4 Verify development and built-preview startup use only same-origin bundled assets rather than CDNs or online APIs and that telemetry cannot contain source names, identifiers, content, tokens, frequencies, or derived chat metadata.
- [ ] 10.5 Verify `data/private/` and `data/exports/` remain ignored, inspect the proposed diff for real chat data, and confirm the existing synthetic fixture remains the only committed chat dataset.
- [ ] 10.6 Review the completed MVP against every specification scenario and confirm all named non-goals remain excluded or are proposed only as separate future changes.
