## Context

The repository currently provides a deterministic 5000-message synthetic CipherTalk `detailed-json` fixture, a Python fixture generator, tests for that generator, and `docs/CIPHERTALK_EXPORT_SCHEMA.md`. It has no application scaffold or runtime analysis code. The documented export shape is a development baseline, not a stable CipherTalk API; timestamps, type mappings, optional fields, and malformed-record representations must be revalidated when an authorized and properly de-identified real export becomes available.

The first product increment must load one private-chat export, calculate Chinese word frequencies, render a word cloud and ranking, and export the cloud as PNG without transferring chat content. The solution must be small enough to establish the core workflow while keeping parsing and filtering replaceable as the provisional schema evolves.

Read-only baseline profiling measured the committed fixture at 2,634,343 bytes (2.512 MiB) and 5000 messages. On the current development machine, Node decoded it with fatal UTF-8 behavior in about 1.2 ms and parsed it in an average 2.8 ms across 20 runs. A temporary in-memory 50,000-message expansion serialized to 20,634,553 bytes (19.679 MiB) and parsed in about 29.8 ms. These measurements justify headroom for the selected MVP limits but are not browser performance guarantees.

## Goals / Non-Goals

**Goals:**

- Provide one end-to-end local workflow from file selection through PNG export.
- Keep source parsing, normalization, filtering, tokenization, counting, and presentation as explicit boundaries that can be tested independently.
- Reliably process the current 5000-message fixture without UI failure.
- Reject files beyond explicit 32 MiB or 50,000-message MVP support limits without partial analysis.
- Make frequency results deterministic for fixed input, settings, tokenizer, and dictionary.
- Preserve privacy by avoiding a backend, online analysis services, and chat-content telemetry.
- Keep schema assumptions and validation warnings visible and revisable.

**Non-Goals:**

- Annual report generation, sentiment analysis, AI summarization, relationship scoring, topic modeling, timeline charts, or heatmaps.
- Group-chat analysis, direct WeChat database access, CipherTalk database decryption, or media-file analysis.
- Public-server deployment, desktop-wrapper packaging, user accounts, cloud storage, multi-file merging, or persistence of uploaded chat data.
- Treating the provisional synthetic schema as a permanent or complete CipherTalk contract.

These exclusions are possible subjects for separate future changes; they are not hidden implementation tasks for this MVP.

## Decisions

### 1. Use a browser-only React and TypeScript architecture

The MVP will use React, TypeScript, and Vite. Parsing, normalization, filtering, segmentation, counting, and export will run in browser-side TypeScript modules. No FastAPI service will be introduced.

| Consideration | Browser-only TypeScript | React plus local Python/FastAPI |
| --- | --- | --- |
| Privacy | The file can remain in browser memory; no application-layer upload or listening service is needed. | Can remain on the same machine, but still introduces browser-to-server transfer, a listening process, and more places where sensitive content may be logged. |
| Chinese segmentation | Requires a browser-compatible deterministic tokenizer and fixed dictionary, potentially backed by WASM. | Python offers mature segmentation packages and straightforward custom dictionaries. |
| Development complexity | One language, one process, one test/build toolchain, and direct in-memory flow. | Two runtimes, an API contract, CORS/process lifecycle, error mapping, and integration tests are required. |
| Packaging | A static local build or lightweight desktop wrapper remains possible; runtime does not require Python. | Distribution must install and launch Python, dependencies, a local port, and the frontend. |
| Future extensibility | Pure analysis modules can later move into a Web Worker, desktop shell, or service boundary. | Better suited if later features require Python-only NLP or heavy native libraries. |

Browser-only TypeScript is chosen because it satisfies this frequency-analysis increment with the smallest privacy and packaging surface. Python/FastAPI becomes worth reconsidering only if a separately measured requirement cannot be met by the fixed browser tokenizer, or a later offline NLP feature requires a Python-only model.

#### Fixed Chinese tokenizer

The MVP will use exactly `jieba-wasm@2.4.0` (MIT), resolved with an exact dependency entry rather than a semver range and pinned by the future package lockfile. The verified npm tarball integrity is `sha512-ZvQdS+FGifrFXZIXSgOyOgEz+1wdy1P4vSvwe37FVtku9ycSdHTZbHqF5i9tMN1JucoAmeiLBeI6/YaqcGD+KA==`. The package publishes a browser export with TypeScript declarations. Browser usage is:

```ts
import init, { cut } from "jieba-wasm";

await init();
const tokens = cut(text, false);
```

`cut` is the default accurate mode. The second argument is fixed to `false`, disabling HMM. The MVP will not use `cut_all`, `cut_for_search`, `tokenize` search mode, `add_word`, or `with_dict`. It will not expose custom dictionary controls. Configurable stop words remain a separate exact-match post-segmentation filter and do not mutate the tokenizer.

The binding constructs one process-wide Jieba instance with `Jieba::new()`. Its default dictionary is compiled into the WASM binary through the dependency's embedded `jieba-rs` dictionary; there is no separately fetched or copied dictionary asset to checksum. Therefore the reproducibility boundary is the exact `jieba-wasm@2.4.0` package, its lockfile integrity, the embedded WASM, `cut` mode, and `hmm=false`. Contract tests will pin representative segmentation outputs. `Intl.Segmenter` is not a fallback because its behavior can vary by browser engine and version.

A local tokenizer adapter will cache a module-level initialization promise and call `init()` lazily on the first analysis request, yielding one initialization lifecycle per page load. Concurrent requests share that promise. If local WASM loading or initialization fails, the adapter clears the failed promise for an explicit retry, returns a non-content-bearing initialization error, retains the successfully loaded normalized dataset, and produces no partial frequencies, cloud, ranking, or export. It never falls back to an online tokenizer.

Vite resolves the package's browser export and emits its WASM as either an inlined build asset or a hashed static asset requested from the same local origin. Both forms are part of the local build output and require no external request. Compatibility task 1.3 verifies this exact configuration; it does not select another tokenizer or architecture.

Dependency facts were verified against the official [`jieba-wasm` npm metadata](https://www.npmjs.com/package/jieba-wasm), [package README](https://github.com/fengkx/jieba-wasm), [binding source](https://github.com/fengkx/jieba-wasm/blob/master/src/lib.rs), and [Vite WebAssembly guidance](https://vite.dev/guide/features.html#webassembly).

### 2. Use a staged, immutable analysis pipeline

The application will keep the following boundaries:

```text
File
  -> 32 MiB File.size preflight
  -> fatal UTF-8 decode
  -> JSON parse
  -> private detailed-json and 50,000-message validation
  -> immutable normalized messages
  -> sender/date selection
  -> extensible message filters
  -> text cleanup and segmentation
  -> stop-word/minimum-length filters
  -> frequency map and stable ranking
  -> cloud, ranking, metrics, PNG
```

Each stage consumes typed values and returns a new value plus structured issues. The parsed source object is never changed. UI components do not inspect raw message shapes and the counter does not know CipherTalk type codes. This isolation allows later schema adapters and filter rules to change without rewriting visualization logic.

Validation has two levels:

- File-level errors reject a non-`.json` name; `File.size` above 33,554,432 bytes; invalid UTF-8; malformed JSON; a non-object root; non-object `exportInfo` or `session`; `exportInfo.format` other than `detailed-json`; non-array `messages`; `messages.length` above 50,000; or a session whose `isGroup` is not exactly `false` or whose `type` is not exactly `私聊`. A group or ambiguous session is unsupported even when the top-level field names look correct.
- Record-level issues skip only unusable messages and report array positions and issue codes without echoing chat content. A recoverable message must be an object with integer `localType`, string `type`, string-or-null `content`, numeric integer `isSend` equal to `0` or `1`, and at least one valid time field. Missing optional sender identity fields normalize to null.

The byte check runs against `File.size` before `arrayBuffer()` and decoding; a file exactly at the limit proceeds. Decoding uses `new TextDecoder("utf-8", { fatal: true })`, so invalid sequences fail instead of becoming `U+FFFD`. The message-count check runs immediately after JSON and top-level validation and before per-message normalization; exactly 50,000 proceeds. A candidate exceeding either limit is rejected as a whole and is never partially analyzed. Candidate state is staged and replaces the last successful dataset only after all file-level checks pass, so a failed replacement leaves the last successful dataset intact and the selector usable.

Unknown fields are tolerated to avoid unnecessary breakage while the schema is provisional. `exportInfo.version`, generator values beyond the required format discriminator, and supported-record extra fields do not cause failure. A schema-validation library may be used, but it must support safe parsing, useful paths, and inclusion in the local build without network access.

### 3. Define canonical normalized data and time behavior

The normalized message will include:

- integer Unix-second chronological value plus whether it was derived;
- strict `YYYY-MM-DD HH:mm:ss` wall-clock `formattedTime`, its `YYYY-MM-DD` calendar-date key, and whether they were derived;
- numeric `localType`, normalized `type`, nullable normalized `content`;
- boolean owner-sent state derived from `isSend`;
- nullable normalized `senderUsername` and `senderDisplayName`;
- original array index for stable diagnostics.

Sender controls use only raw JSON numbers: integer `1` means owner and integer `0` means the other participant. Strings, booleans, null, missing values, non-integers, and other numbers are not coerced; the record is skipped with an issue code. This matches the current private-chat schema and intentionally does not generalize to group chats.

`session.ownerId` is optional consistency metadata, not a scope discriminator. A missing or unusable value yields a session warning but does not prevent analysis. When it is present, an owner-sent record whose `senderUsername` differs from it, or an other-participant record whose `senderUsername` equals it, keeps its `isSend`-derived role and emits a warning. Missing or unknown sender names normalize to null and never alter role assignment. Since group sessions are rejected, all valid `isSend=0` records belong to the single other-participant scope.

Time normalization uses these fixed rules:

1. `formattedTime` is valid only when it exactly matches `YYYY-MM-DD HH:mm:ss` and represents a real proleptic-Gregorian calendar value. It is the canonical wall-clock display value and supplies calendar-date bounds and inclusive date filtering.
2. `createTime` is valid only as a finite integer Unix-seconds number. It is the canonical chronological ordering value. Ties use the lower original source-array index first.
3. When both are valid, each retains its role. They are compared by interpreting `formattedTime` with the provisional fixed UTC+08:00 offset documented for the fixture. A disagreement emits a warning but does not replace either canonical value.
4. When `formattedTime` is invalid or missing but `createTime` is valid, derive the wall-clock string and date key at fixed UTC+08:00 and mark the record fallback-normalized.
5. When `createTime` is invalid or missing but `formattedTime` is valid, derive an ordering timestamp by interpreting the wall-clock value at fixed UTC+08:00 and mark the record fallback-normalized.
6. When neither is valid, skip the record with a warning.

All parsing and conversion use explicit UTC arithmetic plus a fixed eight-hour offset, never the host timezone or locale. Midnight boundaries therefore follow canonical wall-clock dates. UTC+08:00 and Unix-second precision remain provisional until a real export establishes the actual rules.

The loaded summary derives normalized-record count, first/last chronological wall-clock values, and available date bounds from the normalized model. Conflicting `session.messageCount`, `firstTimestamp`, or `lastTimestamp` values are shown as non-fatal warnings rather than silently trusted.

### 4. Make filtering data-driven and text-safe

Message-type exclusions will be represented as composable predicates and type-code sets, initially covering documented `localType` values for images (`3`), voice (`34`), video (`43`), animation emoji (`47`), and system/call content (`50`, with `10000` recognized provisionally). Readable `localType=1` messages are the primary MVP input. `localType=49` records enter analysis only when their normalized content is demonstrably human-readable rather than XML, a file/link placeholder, or an unsupported structured payload.

Content cleaning uses ordered pure functions:

1. reject null, non-string, empty, media-placeholder, and XML-like content;
2. remove URL spans, with URL-only messages becoming empty;
3. normalize Unicode with NFKC and lowercase English;
4. convert emojis, repeated punctuation, and whitespace to separators;
5. reject punctuation/separator-only content before tokenization;
6. tokenize Chinese with lazy-singleton `jieba-wasm@2.4.0` `cut(text, false)` and English as Unicode alphabetic runs;
7. apply a normalized configurable stop-word set and a Unicode-code-point minimum length;
8. reject numeric-only tokens.

Emoji are excluded as words for the MVP; nearby text remains. Malformed records and fragments are skipped, summarized by non-sensitive issue code, and never allowed to abort the full analysis. The default stop-word list is a local, UTF-8, versioned asset whose source, license, version, and SHA-256 are documented when created. Both the asset and any caller-provided replacement set are NFKC-normalized, trimmed, lowercased for English, de-duplicated, and passed to the pure analysis engine. This makes stop words configurable for tests and future callers without requiring a stop-word editor in the first UI. Stop words never call `add_word` or `with_dict`.

### 5. Produce one canonical result for every presentation

The analysis engine returns a single result containing the full frequency map, stable ranked tokens, analyzed text-message count, unique-token count, sender scope, and inclusive date range. The analyzed text-message counter increments exactly when a normalized message survives sender, date, message-type, and content-level exclusions and is submitted to tokenization. Stop-word-only input still counts; punctuation-only, URL-only, placeholder, excluded-type, and malformed messages rejected before tokenization do not. A submitted message continues to count even when token length, stop words, aggregate minimum frequency, or maximum display count leaves no displayed token. Counts sort descending, then ties sort by ascending Unicode code-point order. The maximum-word and minimum-frequency settings derive the display list from that canonical result.

The word cloud and ranked list consume the same display list, and regeneration atomically replaces the full result to avoid mismatched metrics. Invalid settings block generation. A valid analysis with no remaining tokens produces an explicit empty state.

### 6. Render and export with ECharts plus a word-cloud extension

ECharts with a browser-compatible word-cloud extension is the preferred visualization because it provides a TypeScript-friendly canvas rendering path, responsive sizing, and image export without a server. Dependency compatibility, maintenance, licensing, deterministic input ordering, and accessible fallback behavior must be confirmed during scaffolding. If that check fails, a small canvas/SVG word-cloud library may replace it without changing the analysis contract.

Only placement and decoration may vary with canvas layout; frequency values and ranking remain deterministic. If the visualization library supports a random seed, use a fixed seed. Otherwise PNG pixels are not claimed to be byte-for-byte deterministic.

PNG export will use the current chart canvas/data URL or blob, assign a non-sensitive filename derived from the source base name and selected range, and trigger a browser download. It will not embed raw messages or participant identifiers as PNG metadata.

The ranked list is the accessible, exact textual representation of cloud data. File and analysis controls use native inputs where practical, explicit labels, keyboard focus, associated errors, a programmatic busy state, and non-color-only feedback.

### 7. Keep processing responsive at fixture scale

Acceptance is based on completing the existing 2,634,343-byte, 5000-message fixture in a current desktop browser with no crash, uncaught exception, permanently blocked UI, or unusable controls. The UI commits a programmatic busy state before starting perceptible work and yields so it can paint. No arbitrary time budget is imposed beyond successful fixture-scale usability.

The supported input ceilings are 33,554,432 bytes and 50,000 message entries. The byte limit is checked before reading or decoding; the message limit is checked after top-level parsing and before normalization. The fixture has approximately 12.7× byte headroom and 10× message headroom, while the temporary 50,000-message profile remained under 20 MiB serialized. Both ceilings are independent and inclusive. Exceeding either rejects the complete candidate with a specific limit error and leaves the prior successful state and controls usable.

Streaming JSON parsing and Web Workers are not requirements or hidden conditional tasks in this change. Analysis modules remain serializable and side-effect-free so a separately reviewed future change can introduce a worker if browser profiling later demonstrates a need. If the 5000-message acceptance case cannot remain usable without one, implementation must stop and revise this design rather than silently expand scope.

### 8. Enforce local privacy and repository hygiene

Loading and analysis must not invoke remote APIs. Application startup should not depend on a CDN; production assets, tokenizer data, dictionaries, stop words, and visualization code are bundled locally. Telemetry is disabled unless a future change defines a content-safe policy; under no circumstances may it include message text, tokens, frequencies, participant identifiers, source filenames, or derived chat metadata.

The implementation must verify that `data/private/` and user export locations such as `data/exports/` remain Git-ignored. Only synthetic datasets may be committed, and the existing fixture remains the sole committed chat dataset for this MVP.

### 9. Use an explicit local same-origin launch model

Development uses the Vite development server bound to loopback. Production-artifact verification runs `npm run build` and then the documented `npm run preview -- --host 127.0.0.1` command, which serves the built `dist/` application from one local HTTP origin. This preview command validates the production build; it is not a public deployment.

Direct `file://` execution is unsupported. ES modules and a WASM asset emitted by Vite rely on HTTP-origin URL resolution and fetch semantics that are not reliably available from a local file origin. An Electron or Tauri wrapper is also outside this change.

The future Vite configuration and lockfile must ensure all JavaScript, CSS, fonts, ECharts code, `jieba-wasm` JavaScript/WASM, its embedded dictionary, stop words, and other runtime assets are present in the local source/build graph. Vite may inline the WASM or emit it as a hashed file; either is acceptable after task 1.3 verifies that the resulting URL stays on the application origin.

“Offline” means external network access is unnecessary and no third-party content request is made. Requests from the browser to its loopback application origin for packaged assets are allowed. Browser acceptance tests will abort any non-loopback request, load the local build, wait for local assets and tokenizer initialization, then analyze the fixture, regenerate, and export PNG. The request log must contain no non-loopback origin and no chat data.

### 10. Test at module and workflow boundaries

Unit tests use small inline synthetic records to cover fatal UTF-8 errors; both inclusive input limits; every fatal schema discriminator; recoverable records; exact `isSend` semantics; owner metadata conflicts; time fallback, conflict, midnight, tie, and host-timezone behavior; every default content exclusion; mixed-language processing; stop words; token length; date/sender scopes; exact frequencies; analyzed-message counting; and tie ordering. Tokenizer fixtures pin exact `cut(text, false)` outputs against `jieba-wasm@2.4.0`.

An integration test reads `data/mock/ciphertalk_detailed_chat_2025.json`, asserts its 2,634,343-byte and 5000-message load succeeds, exercises the default analysis flow, and verifies the file checksum is unchanged. Component or browser-level tests cover file selection, both oversized errors and recovery, understandable validation, controls, regeneration, result summaries, empty state, keyboard operation, local WASM failure, PNG-export availability, production-build launch, and external-network denial. Tests must not require external network access.

## Risks / Trade-offs

- [Provisional export schema differs from real CipherTalk data] → Keep parsing behind an adapter, tolerate unknown fields, emit structured issues, and revise the adapter only after an authorized de-identified sample is available.
- [`jieba-wasm@2.4.0` fails browser or Vite verification] → Treat task 1.3 as an implementation blocker and revise this design explicitly; do not silently substitute a tokenizer, enable HMM, or introduce a backend.
- [Local WASM initialization fails at runtime] → Keep the accepted normalized dataset, show a safe retryable error, clear the failed singleton promise, and never send text to a fallback service.
- [Main-thread segmentation causes unacceptable fixture-scale blocking] → Stop implementation and propose an explicit worker architecture revision; a worker is not a hidden task in this MVP.
- [Word-cloud placement varies despite deterministic counts] → Treat the ranked list as canonical, use stable input ordering and a fixed layout seed when supported, and scope determinism acceptance to frequencies and ranking.
- [Filters remove legitimate content or admit placeholders] → Keep rules composable, cover each with focused tests, show aggregate exclusions, and make later rule additions isolated.
- [Schema time fields have unknown timezone semantics] → Apply the explicit fixed-UTC+08:00 fallback and split canonical roles, surface every fallback/conflict, and revisit only after real-export validation.
- [Large local files consume browser memory] → Enforce the inclusive 32 MiB pre-read and 50,000-message pre-normalization limits and reject the complete candidate beyond either boundary.
- [`file://` or external assets undermine offline behavior] → Support loopback HTTP only, keep every runtime asset in the Vite build graph, and fail tests on any non-loopback request.

## Migration Plan

1. Add the frontend scaffold and local dependencies without changing the synthetic fixture.
2. Verify exact `jieba-wasm@2.4.0` Vite packaging and implement pure parsing and analysis modules before connecting UI.
3. Add visualization, controls, export, and accessibility behavior behind the validated analysis result.
4. Build and serve the production artifact on loopback, block external requests, and run automated plus manual fixture workflows before declaring the MVP complete.

There is no production data migration or deployed service. Rollback consists of reverting the new application and analysis files; the existing generator, fixture, and schema documentation remain usable independently.

## Open Questions

- What timestamp precision, timezone, private-session discriminators, sender semantics, optional fields, and message-type variants occur in a real CipherTalk export? Keep these explicitly provisional until an authorized de-identified sample is available.
