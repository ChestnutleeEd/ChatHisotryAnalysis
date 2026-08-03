## Context

The repository is an implemented local-analysis MVP, not an empty scaffold:

- The Python package exposes one production composition root and a stable `chat-history-analysis` console. On macOS arm64 CPython 3.12 it verifies the exact `ijson==3.5.1` distribution and `yajl2_c` backend before source access.
- Raw sources pass bounded digest/strict-UTF-8, streaming schema/range, ranked staging, and final identity revalidation. Inputs are explicit annual or overlap-verification roles and share the 2,000,000 raw-message limit.
- Eligible text is normalized one record at a time. Owner/other, UTC+08:00 time, type signals, URL/XML/placeholder filtering, and content-free skip/warning categories are already implemented.
- Private staging is one same-filesystem, owner-only SQLite sibling with fixed PRAGMAs, deterministic cryptographic identities, cross-file deduplication, deterministic v1 NDJSON/manifest, disk verification, explicit cleanup, and exclusive atomic publication.
- CLI stdout is fixed-shape progress plus one result; stderr is one content-free failure. Stable exit classes, safe SIGINT checkpoints, the promotion commit boundary, recovery, retry, and cancellation cleanup are implemented.
- The React 19/TypeScript/Vite 8 browser application accepts v1 normalized `File` objects only. The main thread performs metadata preflight; one Worker revalidates exact manifest/chunk bytes, initializes `jieba-wasm@2.4.0`, builds token-ID arrays plus a shared token table, and recalculates sender/date word frequency without retokenization.
- The current presentation is one page for normalized-file selection, progress, sender/date/frequency controls, word cloud, ranking, PNG export, Stop, and Worker restart. Finder start/stop commands supervise only the loopback Vite preview.
- Python unit/integration tests cover Stages 1–12. Frontend Worker, privacy, browser, and accessibility test code exists, but the existing OpenSpec Stage 13–15 checkboxes remain deliberately incomplete. Stage 13.10 one-year and Stage 15.10 full-history real-data gates are not authorized.

The product gaps follow directly from those facts:

1. Ordinary users still need the Python/runtime and normalized-file workflow.
2. There is no desktop main process, native picker, sidecar packaging, application-session process model, or application-owned ephemeral lifecycle.
3. V1 records contain eligible text only. Raw-message count in the manifest cannot reconstruct deduplicated media events, unknown types, chat days, reply bursts, or session initiators.
4. The current Worker and UI have word-frequency semantics, not a shared product analytics model or multi-page information architecture.
5. The repository has no `.app`/`.dmg` product package, clean-machine sidecar evidence, signing hierarchy, or future Windows process adapter.

This change is additive. The unarchived `implement-local-chat-wordcloud-mvp` change remains the v1 source of truth and keeps its task state. Productization does not claim that unchecked Stage 13–15 acceptance has happened.

## Stage 1 Alpha foundation and deferred release hardening

Stage 1 is now an Alpha foundation gate for an unsigned, locally runnable
macOS arm64 prototype. The gate is deliberately narrow but hard on privacy and
authority: no upload or cloud analysis, no renderer filesystem/shell/network
privilege, explicit user selection, Rust-owned session and dataset metadata,
opaque Worker transport, exact active-generation correlation, bounded
32 MiB chunks/512 MiB datasets/2,000,000 records/16,384 chunks, bounded channel
capacity, production Worker execution, browser-v1 compatibility, basic
cancellation/close cleanup, pinned Python 3.12 dependencies, true
`pip install --require-hashes`, and a source-buildable unsigned macOS path.

The Alpha path may use a fixed expected sidecar bundle root, evidence digest,
and build-input digest compiled into the Rust host. This is an integrity gate,
not a digital signature or release trust root. It must run before source-open,
must reject member/evidence/root mismatches, and must not expose a path to the
renderer. The Alpha test records native WebKit permission wiring as compiled
and auditable; a native callback test that cannot run on the test thread is
explicitly skipped/unsupported, never passed by an early return.

The following remain deferred, unchecked release-hardening tasks: packaged
WebKit permission runtime verification; independent signed sidecar trust root
and complete bundle-manifest publication chain; the full tamper matrix; the
complete IPC/lifecycle/disconnect/crash matrix; formal codesign, notarization,
and `.dmg` release acceptance; clean-machine release supply-chain evidence;
exhaustive IPC vectors; formal 512 MiB peak-memory proof; and Windows process,
packaging, signing, and clean-machine hardening. These requirements remain in
the specifications and task list, and are not silently removed or treated as
complete by the Alpha gate.

### Stage 10 Alpha threat model and acceptance boundary

The protected Alpha assets are the selected raw JSON, canonical dataset and
SQLite staging data, aggregate results, explicit export output, owner-only
session/cache directories, the sidecar process, dataset transport, structured
logs, and host registries plus session/generation/result capabilities.

Trusted components are the Rust/Tauri host, host-owned registries and
`SecureStorage`, the fixed-digest Alpha sidecar, and native operating-system
file dialogs. The WebView renderer, React UI, analytics Worker, and all
renderer/Worker messages are untrusted and form one frontend threat domain.
The host does not attempt to prove that a commit originated from a Worker
thread rather than renderer code. Its boundary is instead a closed numeric
aggregate DTO with complete runtime validation and binding to window, session,
generation, dataset, canonical query, and analytics contract. Paths,
filenames, bodies, arbitrary strings, schemas, and export payloads never cross
that commit seam.

Representative Alpha evidence covers malformed/oversized input, forged or
stale capability replay, unsafe storage objects and directory escape, unsafe
navigation/network paths, content-free logs, orphan cleanup, and write,
rename, and fsync failure. The accepted residuals are the macOS PID/PGID
reuse window between the last identity check and a signal syscall, races
against a fully malicious same-UID process, renderer/Worker indistinguishability
after renderer compromise, and OS/kernel/filesystem/WebKit vulnerabilities.
macOS has no Linux-pidfd-equivalent primitive for eliminating the signal window;
formal and exhaustive proof is not an Alpha acceptance condition.

The deferred mapping is explicit: packaged WKWebView/runtime permission proof
is D.1; exhaustive storage/tamper combinations are D.3; exhaustive
lifecycle/crash/disconnect/reuse cases are D.4; exhaustive IPC/capability
vectors and cross-language race proof are D.8; and formal capacity,
performance, and resource certification is D.9. Alpha acceptance requires no
unresolved current Alpha Critical, no realistically exploitable current Alpha
High, representative production/integration evidence, and documented
residuals; it does not require a formal or Cartesian-product proof.

## Goals / Non-Goals

**Goals:**

- Deliver a design in which a normal macOS user selects raw CipherTalk JSON and reaches local results without installing or invoking development runtimes.
- Reuse the production preprocessor rather than reproduce raw parsing, privacy minimization, deduplication, atomic output, progress, cancellation, or error classification in the shell.
- Add enough minimized post-dedup event evidence for accurate whole-message and content metrics without preserving non-text payloads.
- Establish exact metric definitions, shared aggregate layering, compact indexing, deterministic selectors, progress, cancellation, and a 2,000,000-event stop gate.
- Keep renderer privileges, filesystem paths, subprocess control, and logs behind a narrow desktop-core boundary.
- Define product workflow states, dashboard navigation, filter scope, error recovery, accessibility, export, and close behavior before UI implementation.
- Produce a macOS arm64 `.app` and `.dmg` prototype that runs on a clean machine, while leaving formal release signing/notarization for a later gate.
- Keep shared contracts portable to a future independently built Windows sidecar and process adapter.
- Make every implementation batch executable with synthetic fixtures before a real-data authorization gate.

**Non-Goals:**

- Cloud accounts, upload, storage, analysis, telemetry, remote assets, or external language-model APIs.
- Free-form AI summaries, sentiment, relationship scoring, psychological inference, or relationship-quality claims.
- Reading or decrypting a WeChat database, bypassing CipherTalk, group chats, transcription, or media recognition.
- Public Windows release, universal macOS release, Developer ID distribution, complete notarization/stapling, App Store delivery, installer auto-update, or migration of old local datasets.
- Automatic persistence of analysis history, raw-source copies, or normalized private datasets.
- Visual-brand polish, illustration, decorative motion, or dark mode in the first functional productization implementation.
- Running or changing the authorization state of existing Stage 13.10 or Stage 15.10.

## Decisions

### 1. Add productization above the v1 pipeline

The product path is:

```text
native raw-file selection (paths held only by desktop core)
  -> supervised packaged Python preprocessor
  -> canonical event dataset v2 in one private application session
  -> desktop-core containment/file-set verification
  -> opaque chunk transport
  -> dedicated analytics Worker
  -> compact base indexes and one-time tokenization
  -> shared filter aggregates
  -> versioned derived metrics
  -> presentation DTO selectors
  -> React dashboard and explicit local aggregate export
```

The v1 browser path remains:

```text
explicit normalized v1 File objects
  -> existing metadata preflight
  -> Worker exact validation and compact token cache
  -> word cloud/ranking
```

The v2 serializer is a new explicit preprocessor output mode used by desktop productization. It calls the same source-validation and deduplication services rather than forking their behavior. V1 serialization and browser tests remain pinned until the existing change is archived and a separately reviewed migration is justified.

This sequence avoids three forms of duplication:

- Tauri never parses raw CipherTalk.
- Python never implements interactive filter analytics.
- React charts never define or scan their own metric populations.

### 2. Choose Tauri 2 over Electron or an enhanced loopback launcher

| Criterion | Tauri 2 | Electron | Existing loopback browser |
| --- | --- | --- | --- |
| React/Vite reuse | Direct | Direct | Direct |
| Native picker and app lifecycle | Native Rust APIs | Native Node/Electron APIs | Requires browser limitations or helper |
| Python sidecar | Bundled external binary or Rust spawn | Node child process | Separate manual runtime |
| Renderer privilege floor | Generated capabilities; no Node | Secure only with carefully limited preload/IPC | Browser sandbox, but no product integration |
| Base bundle/memory | Uses system WebView; smaller base | Bundles Chromium and Node; larger base | Requires installed browser/Node preview |
| macOS `.app`/`.dmg` | First-class bundler | First-class packagers | Not a desktop package |
| Future Windows | WebView2 and target sidecar | Bundled Chromium and target sidecar | Still manual local server |
| IPC/security maintenance | Rust command schemas and capabilities | Main/preload/renderer plus Electron security updates | Local server/process state remains exposed |
| Process supervision | Rust native adapter | Node process APIs | Shell/Node launch scripts only |
| New implementation cost | Adds Rust toolchain and platform adapter | Adds Electron main, preload, Chromium lifecycle | Lowest short-term, misses product goal |

**Decision:** use pinned Tauri 2. Its capability model lets the shipped renderer have no general shell or filesystem API, and its system-WebView model avoids shipping a second Chromium/Node runtime beside Python. The existing React/Vite view and Web Worker code remain reusable.

**Electron is not selected** because its easiest path also introduces a privileged Node main/preload surface, a bundled Chromium/Node security-update obligation, and materially larger base package and memory cost. Secure Electron is possible with sandbox, context isolation, sender validation, CSP, custom protocol, and one-method IPC, but those requirements remove much of its implementation advantage here.

**The loopback launcher is not selected** because it still depends on Node/npm and a default browser, cannot give the product an opaque native-file capability, and cannot supervise the preprocessor and private session as one application lifetime. It remains a v1 development/compatibility surface.

Tauri dependencies are locked only when implementation begins. No floating `cargo install`, npm dependency, remote script, or runtime download enters the product.

### 3. Package Python with PyInstaller `onedir`

The sidecar is a console-style PyInstaller `onedir` distribution embedded as target-specific application resources. `onedir` is chosen because:

- it has no per-launch `_MEI...` extraction directory or executable-temp cleanup lifecycle;
- native Python and `ijson` members have stable inspectable paths and hashes;
- nested binaries can be signed before the outer `.app`;
- crashes do not leave a hidden unpacked runtime;
- clean-machine failures are easier to diagnose deterministically.

PyInstaller `onefile` is rejected because it extracts at runtime, adds a bootloader/child/signal boundary, complicates temp permissions and cleanup, and conflicts with the project's explicit private-artifact lifecycle. A relocatable hand-built CPython tree is rejected because it requires more bespoke stdlib/native-module relocation and provenance maintenance. Nuitka or PyOxidizer is deferred because it changes build/debug characteristics without removing the need for target-native builds and sidecar supervision.

#### Build modes

**Development mode**

- Uses the existing external CPython 3.12 installation boundary.
- Runs the installed console through the current startup gate.
- Uses the same desktop stdin protocol and session output mode as packaged execution.

**Packaged mode**

- Is built on the target platform; PyInstaller is not a cross-compiler.
- Pins Python, PyInstaller, build tools, project wheel, `ijson`, and every downloaded artifact by version/hash.
- Emits `sidecar-build-manifest.json` with source revision, target triple, tool versions, included members, byte sizes, and hashes.
- Starts with a frozen gate that verifies application-resource containment, target triple, build-manifest schema, executable/runtime/native-member hashes, exact `yajl2_c` origin, and positive/negative parser probes before source access.
- Enters the same authorized production preprocessing composition after the gate.

The existing installed-distribution gate cannot be copied literally into a frozen executable because wheel metadata and `sys.prefix` layout change. The frozen gate provides equivalent byte and backend evidence; it does not weaken the parser or source-open ordering. This is a Sol xHigh review and stop gate in the first implementation stage.

#### Invocation

The core resolves the resource through Tauri APIs and spawns it directly. Source and output paths are absent from argv. Immediately after spawn, the core writes:

```text
uint32 big-endian configuration byte length
strict UTF-8 JSON bytes
```

The exact configuration contains protocol version, session/generation, annual and optional verification paths, expected application cache root, absent output path, and a random session nonce. The sidecar reads one message, rejects extra data, and keeps stdin open. A monitor thread treats stdin EOF as parent loss and requests cooperative cancellation; this works for a handled core close and an abrupt parent disappearance without a second helper.

No configuration byte is echoed. The core parses only exact content-free NDJSON progress/result/error objects and discards raw child output on any protocol failure.

### 4. Put native authority in one Rust session supervisor

The Rust `SessionSupervisor` is the sole owner of:

- selected raw paths and role assignments;
- session and generation identifiers;
- child handle, PID, start fingerprint, process group, stdin/stdout/stderr;
- application cache/session paths and open descriptors;
- sidecar protocol parser;
- opaque dataset transport registration;
- window ownership;
- cancellation timers and cleanup state.

The renderer state is a projection, never authority.

#### State model

| State | Allowed entry | Allowed exit |
| --- | --- | --- |
| `idle` | app start, completed discard | `selecting` |
| `selecting` | native dialog request | `idle`, `ready` |
| `ready` | valid opaque selection | `preprocessing`, `selecting`, `discarding` |
| `preprocessing` | start accepted | `handoff`, `cancelling`, `failed`, `closing` |
| `handoff` | sidecar success | `analyzing`, `cancelling`, `failed`, `closing` |
| `analyzing` | Worker source available | `complete`, `cancelling`, `failed`, `closing` |
| `complete` | atomic Worker result | `analyzing`, `selecting`, `discarding`, `closing` |
| `cancelling` | cancel/replace/close | `ready`, `failed`, `discarding`, `closing` |
| `failed` | terminal structured failure | `ready`, `preprocessing` with new generation, `discarding`, `closing` |
| `discarding` | replace/discard | `idle`, `selecting`, `closing` |
| `closing` | full quit | process exit or safe cleanup-required state |

At most one sidecar generation and one analytics Worker generation are active. New work increments a monotonic generation. Every terminal generation stays terminal. Both core and renderer compare protocol version, session ID, generation, and increasing event sequence before state mutation.

#### macOS process model

- Spawn without a shell in a new process group whose group ID is the retained child PID.
- Retain the exact executable identity, PID, process-start fingerprint, nonce, and group.
- Cooperative cancel: request Worker cancel and signal the sidecar using its existing safe SIGINT path.
- After the graceful deadline, revalidate every identity and send targeted `TERM`.
- After the second deadline, revalidate again and send targeted `KILL` to the private group.
- Never discover or terminate by executable name, port, argv substring, or unverified PID.
- Closing stdin also activates the sidecar parent-loss monitor.
- Window close is intercepted while work or cleanup exists; full application exit occurs only after the bounded outcome.

A future Windows adapter uses a kill-on-close Job Object and Windows-native process identity; renderer and sidecar protocol semantics do not change.

### 5. Use a small versioned IPC surface

Renderer-to-core commands are one method each:

```text
selectAnnualSources(requestId)
selectVerificationSources(requestId)
startAnalysis(requestId, selectionId)
cancelAnalysis(requestId, sessionId, generation)
retryAnalysis(requestId, sessionId, generation)
discardSession(requestId, sessionId, generation)
exportAggregate(requestId, sessionId, generation, reportFormat, resultId)
requestApplicationClose(requestId, decision)
```

No command accepts an arbitrary path, executable, command, environment map, URL, shell string, or raw file content.

Core events use:

```text
protocolVersion
sessionId
generation
sequence
type
allow-listed payload for that type
```

Event types are `selection-ready`, `state`, `progress`, `dataset-ready`, `failure`, `cancelled`, `cleanup`, `exported`, and `closed`. Sidecar phase/category fields map through a fixed table. The core does not forward child JSON directly.

Production Tauri capabilities name only the application commands and main window. General shell, filesystem, HTTP, opener, process, global shortcut, updater, and remote API permissions are absent. The webview denies navigation, new windows, permissions, and drag-to-navigate.

The CSP baseline is:

```text
default-src 'self';
script-src 'self';
style-src 'self';
img-src 'self' data: blob:;
font-src 'self';
connect-src ipc: <opaque-dataset-scheme>;
worker-src 'self' blob:;
object-src 'none';
frame-src 'none';
base-uri 'none';
form-action 'none'
```

The exact Tauri-generated IPC source is inserted by build configuration. No wildcard or remote host is added.

### 6. Introduce a minimized canonical event v2

V1 cannot support whole-message statistics because non-text records are discarded before sender/time staging. V2 stages one canonical event after source validation and deduplication:

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

`senderScope` is nullable only for system events. `content` is non-null only for eligible text. No non-text content crosses staging. `unknown` remains visible rather than guessed.

The message-normalization implementation is refactored conceptually into:

1. classification evidence;
2. canonical sender/time evidence;
3. eligible-text cleaning;
4. canonical event emission;
5. optional v1 eligible-text projection.

This reuses existing classification and privacy policy while stopping `eligible text` from being the population rule for all analytics.

#### Event deduplication

Platform-ID identity remains the preferred identity for every category. The fallback adds a v2 event domain and uses only transient type-tagged payload hashes plus multiple canonical signals. `localId` may corroborate but never act alone. If evidence is insufficient, the event is kept and an aggregate warning records possible overcount; dropping a possibly distinct event is the less safe correctness choice.

V2 manifest/chunks:

- keep 32 MiB chunk boundaries;
- allow at most 2,000,000 canonical events and 512 MiB aggregate bytes;
- contain exact event, category, warning, sender, time, chunk, and privacy aggregates;
- exclude current wall-clock time, input paths/names, raw identities, raw payload, and transient event digests;
- allow media-only datasets;
- remain deterministic for identical bytes, roles, order, versions, and settings.

The v2 performance claim stays incomplete until the synthetic gate passes.

### 7. Keep private session data ephemeral and path-opaque

The desktop core resolves:

```text
app_cache_dir/
  analysis-sessions/
    <cryptographically random session id>/
      .session-marker
      session-state
      normalized/
        manifest.json
        chunk-NNNN.ndjson
```

This is a conceptual layout, not a renderer-visible path.

| Artifact | Created by | Lifetime | Rule |
| --- | --- | --- | --- |
| Raw input | User/CipherTalk | External | Open read-only; never copy or alter |
| Selection paths | Rust core | App process/session | Memory only; sidecar stdin only |
| Session root/state | Rust core | Active session | Owner-only; opaque to renderer |
| SQLite/staging | Python sidecar | Preprocessing | Existing same-filesystem rules and cleanup |
| V2 manifest/chunks | Python sidecar | Active session | Retained only for Worker restart/retry |
| Compact indexes/tokens | Analytics Worker | Worker generation | Memory only; terminate to release |
| Aggregate UI state | Renderer | Session | No messages or source paths |
| Export | Rust core | User-selected | Explicit aggregate/image only; labelled private |

The core verifies root/session containment, owner, mode, type, marker, and exact known entries without following symlinks. Free-space preflight uses a conservative documented estimate but does not replace write-time disk-full handling.

On normal replacement or quit:

1. cancel/terminate Worker;
2. cancel/terminate verified child;
3. close all dataset transports/descriptors;
4. validate one session and its exact entries;
5. remove each regular file explicitly;
6. remove each now-empty known directory;
7. remove session state/marker and the empty session directory.

No recursive deletion is used and no forensic-erasure claim is made.

At startup, only the application-owned sessions root is considered. Recognized owner-only remnants are processed one session at a time. A verified live orphan is terminated before cleanup. Any unknown, symlinked, mis-owned, mis-moded, unexpectedly typed, or uncontained object is untouched and produces an in-app content-free cleanup-required state. The user never needs a terminal command.

### 8. Hand dataset bytes to the Worker through an opaque source adapter

The existing Worker is refactored to depend on:

```text
DatasetByteSource
  readManifest(): Promise<ArrayBuffer>
  readChunk(ordinal, expectedBytes): Promise<ArrayBuffer>
  close(): Promise<void>
```

Adapters:

- `BrowserFileDatasetSource` wraps existing explicitly selected v1 `File` objects.
- `DesktopSessionDatasetSource` reads only an opaque active session and declared chunk ordinal through a read-only Tauri custom protocol.

The conceptual request is `chat-analysis-dataset://<session-id>/chunk/<ordinal>`. The protocol handler accepts only GET from the main bundled webview/Worker, exact active session/generation, `manifest` or a declared numeric ordinal, no query/fragment/redirect/range/traversal, and exact bounded bytes. It returns no directory listing and performs no socket networking.

The Alpha implementation selects the bounded Rust command/channel adapter. It
returns one exact manifest or chunk buffer by ordinal through the same
`DatasetByteSource`, while the registry remains the producer and owns all
authoritative metadata. A custom protocol may be evaluated later, but it is
not required for the unsigned Alpha gate; arbitrary filesystem APIs remain
forbidden.

The core validates containment, exact entry set, owner/mode/type, manifest size, and declared chunk names/sizes before granting the source. The Worker remains the independent authority for strict JSON, schema, hash, order, counts, time, and privacy validation.

For the Alpha bounded-channel path, the Rust host creates the session and
dataset identifiers and stores the verified synthetic/normalized bytes plus
their metadata in a private registry before any renderer command can open a
stream. `open`, `receive`, `cancel`, `complete`, and `close` accept only the
opaque session/dataset capability and the trusted `WebviewWindow`; they do not
accept renderer-supplied record counts, chunk counts, chunk sizes, dataset
bytes, paths, or host metadata. The registry is the sole producer, uses a
bounded capacity-two channel, releases consumed chunks, and binds window,
session, generation, and dataset together. A renderer may request an opaque
capability and later choose a chunk ordinal, but cannot define what the
capability contains.

The production Worker request union has two runtime-validated variants:
`browser-file-source` carries the existing explicitly selected v1 `File[]`,
and `desktop-dataset-source` carries only opaque session/dataset IDs and the
generation. Both variants enter the same `analysis.worker.ts` →
`worker-handler.ts` → `worker-runtime.ts` pipeline; desktop analysis never
falls back to main-thread, Rust, Python, or fixed-chunk test logic.

Generation handling is intentionally asymmetric. A new explicit start/load
operation may advance the generation; an event belonging to the active
session must have generation exactly equal to the active cursor. Future,
stale, wrong-session, wrong-window, wrong-sequence, unsupported-version,
duplicate-terminal, post-terminal-progress, cleanup-before-terminal, and
closed-before-cleanup events are shared invalid/race cases in Rust and
TypeScript. A future event never replaces the cursor implicitly.

### 9. Put analytics in one dedicated Worker with three layers

The current Worker already proves the right trust and memory direction. Productization generalizes it; it does not introduce a second full cache or move work to Rust/Python.

#### Layer A: compact base index

Built once from canonical events:

- `Float64Array` or validated safe-integer representation for Unix seconds;
- compact calendar-day codes and year/month/hour/weekday codes;
- `Uint8Array` sender and category codes;
- bitset/`Uint8Array` text eligibility;
- `Uint32Array` cleaned Unicode-code-point lengths;
- token-ID arrays, record offsets, and one shared token table;
- day-level sender/category/hour/weekday aggregates;
- year-token counts and per-message token-document-frequency evidence;
- canonical order evidence.

Chunk content and buffer are released after validation/indexing. The construction token map is released after the shared table is complete. Only compact arrays and aggregate-safe strings remain.

#### Layer B: shared aggregates

One canonical query contains:

```text
datasetGeneration
metricDefinitionVersion
inclusiveStartDate
inclusiveEndDate
senderScope
selectedYear
sessionThreshold
```

A single shared pass or bucket selection produces:

- message/date/sender/type/hour/weekday counters;
- chat-day flags;
- eligible-text length evidence;
- token totals by year and selected scope;
- reply/session evidence from the active-threshold index.

The Worker caches the latest result by the full canonical key. It does not retain unbounded combinations.

#### Layer C: pure derived metrics and presentation selectors

Versioned pure functions calculate shares, streak intervals, percentiles, keyword scores, and summary clauses. Presentation selectors only rename/format aggregate fields into DTOs. React and chart modules contain no population, denominator, timezone, percentile, session, or keyword algorithm.

### 10. Fix the statistical semantics before implementation

All metrics use post-dedup canonical events and UTC+08:00. The table summarizes the normative specs:

| Metric | Population and exact definition | Filter/boundary | Cache/complexity | Presentation |
| --- | --- | --- | --- | --- |
| Daily trend | All user messages; one count per date | Inclusive date/sender; zero days; system excluded | Day buckets, O(D) | Line/area + table |
| Monthly trend | Same, grouped `YYYY-MM` | Partial months labelled; zero months | Month derivation from day buckets | Columns/line |
| Yearly trend | Same, grouped calendar year | Partial years labelled; zero years | Year derivation from day buckets | Columns |
| Sender count/share | Owner and other user-message counts; share of combined total | Date applies; sender filter ignored; empty share null | Shared sender buckets, O(D) | KPI + 100% bar |
| Hour activity | User messages in local hours 00–23 | Date/sender; always 24 buckets | Day/hour buckets, O(D) | Grouped/stacked columns |
| Weekday activity | User messages Monday–Sunday | Date/sender; always seven buckets | Day/weekday buckets, O(D) | Columns + table |
| Chat days | Distinct dates with at least one selected user message | One message sufficient; system excluded | Day flags, O(D) | KPI |
| Longest streak | Maximal adjacent qualifying dates; return every tie | Filter clips boundaries | Day flags, O(D) | KPI + tied intervals |
| Yearly word change | Eligible tokens; top-20 total vocabulary; raw and per 10,000 tokens | Date/sender/year; zero token years retained | Shared token/year cache | Heatmap + table |
| Average length | Eligible cleaned content; Unicode code points | Date/sender; media/system/ineligible excluded; null empty | Cached lengths; histogram/order | Sender KPIs + distribution |
| Yearly keywords | Candidate count >=5 and message DF >=3; positive smoothed year-vs-rest log odds | Date/sender/year; partial labelled; one-year frequency fallback | Year token/DF cache | Ranked bars/cards |
| Yearly summary | Fixed ordered clauses from versioned metrics only | Omit unavailable evidence; list ties | Derived O(metric size) | Traceable facts |
| Message types | User messages by exact category; system separate | Date/sender; unknown visible; eligible text separate | Type/day buckets | Ordered bars/table |
| Reply interval | Last message of one sender burst to first of next, within shared session threshold | Both boundary messages in date; sender filter ignored; exact threshold included | O(N) threshold index | Median KPIs + histogram |
| Session initiator | Sender of first user message after first event or gap > threshold | Opening date in filter; sender filter ignored; midnight alone no split | Same threshold index | Counts/shares + sensitivity label |

Reply percentiles use nearest rank; average length uses code points after existing cleaning; keyword inputs and scores are traceable; summary language is fixed and non-evaluative. These choices are not implementation defaults that a chart may override.

#### Keyword alternatives

- **Raw yearly frequency only:** simple but mostly returns globally common terms and does not express annual distinctiveness.
- **TF-IDF with years as documents:** too few documents and unstable interpretation as the selected range changes.
- **Message-level TF-IDF:** downweights globally common terms but does not directly answer “more characteristic of this year than other years.”
- **Selected:** thresholded, smoothed year-vs-rest log odds, with frequency fallback when comparison is impossible. It is local, deterministic, explainable, and exposes all inputs.

#### Session alternatives

- **New calendar day always starts a session:** rejected because a short conversation across midnight would be split only by wall-clock date.
- **Every sender switch is a reply without sessions:** rejected because long offline gaps become misleading reply times.
- **User-entered arbitrary threshold:** rejected in v1 productization because it expands invalid-state and comparability space.
- **Selected:** shared reviewed presets of 1/3/6/12/24 hours, default six; gap strictly greater starts a session.

### 11. Use a workflow route plus eight result routes

#### Workflow

```text
First launch privacy
  -> Select raw files
  -> Validate selection
  -> Preprocess/index progress (Cancel)
  -> Recoverable or terminal error
  -> Results Overview
```

The privacy preference remembers only that the explanation was acknowledged; it is not file authorization.

#### Result navigation

1. **Overview** — selected user messages, chat days, streak, sender share, reply medians, initiators, compact trends/types.
2. **Trends** — daily, monthly, yearly.
3. **Comparison** — sender counts/share and eligible-text length.
4. **Activity** — hour, weekday, chat-day and streak detail.
5. **Words & Years** — existing word cloud/ranking, word evolution, yearly keywords, yearly summary.
6. **Message Types** — exact categories, eligible-text subset, unknown, system diagnostic.
7. **Replies & Sessions** — reply distributions, threshold, session initiators.
8. **Export** — committed filters, included metrics, format, privacy warning, native save.

Global date and sender filters are persistent. Comparative panels explicitly ignore sender scope. Year and session threshold are local controls. Draft filters never become exportable until an atomic Worker result commits.

The first functional UI implements semantic design tokens, consistent sender/category/status colors, accessible charts plus exact tables, WCAG 2.2 AA contrast/focus, reduced motion, and a 1180×760 minimum window. It ships an accessible light theme. Dark mode and brand polish are a separate visual batch.

### 12. Package macOS first without claiming public release

The first package row is:

```text
OS: macOS
architecture: arm64
shell: pinned Tauri 2
sidecar: target-built pinned PyInstaller onedir
artifacts: .app and prototype .dmg
signing: nested-first ad-hoc/local prototype
runtime: fully offline after installation
```

Build order:

1. build and verify Python sidecar from locked inputs;
2. generate frozen evidence manifest;
3. build frontend and Rust core;
4. embed target sidecar and notices;
5. sign native extensions/libraries and sidecar from inside out;
6. bundle/sign outer `.app`;
7. run package and clean-machine tests;
8. build prototype `.dmg`;
9. verify no checkout path, development runtime, private artifact, or external request.

Formal Developer ID signing, notarization, stapling, public download, and updater are separate release work. Documentation records Gatekeeper/quarantine expectations for an ad-hoc prototype.

The future Windows adapter preserves sidecar protocol, v2 schema, analytics, and UI. It requires a Windows-native PyInstaller build, path/Unicode tests, Job Object termination, app cache mapping, installer, and code signing; none is implemented here.

### 13. Test through layers and stop gates

| Layer | Synthetic coverage |
| --- | --- |
| Python unit/integration | v2 classification, all-event dedup, fallback evidence, schema, limits, deterministic chunks, privacy, disk failure, cancellation |
| Production CLI | v1 unchanged; desktop stdin protocol; content-free stdout/stderr; frozen/dev gate parity |
| Packaged sidecar | clean environment, wrong bytes/arch, no Python, startup gate, signals, parent EOF, no network |
| Rust core/IPC | exact commands/events, wrong window/session/generation, sequence, selection opacity, no arbitrary path/process |
| Process lifecycle | graceful cancel, timeout escalation, PID reuse, crash, parent loss, app close, no orphan |
| Session storage | ownership/mode/type, symlink/traversal, exact entries, disk full, cleanup failure, startup remnants |
| Dataset transport | exact manifest/chunk ordinals, tampering, cancellation, no listing/path/remote request |
| Analytics unit | every metric population, boundary, tie, empty, single sender, deterministic fixtures |
| Worker integration | v1/v2 import, compact arrays, one tokenization, shared scans, filters, threshold changes, cancellation |
| Component/browser | workflow states, dashboard, filter exceptions, accessible tables, focus, reduced motion, v1 regression |
| Desktop E2E | picker stubs with synthetic files, success/retry/cancel/crash/close/export/offline |
| Package | `.app`, `.dmg`, resource paths, executable permissions, ad-hoc signature hierarchy, quarantine notes |
| Clean machine | no Python/Node/Rust, synthetic analysis, cancellation, quit, no child/session residue |
| Capacity | 2,000,000 events, 512 MiB v2, 32 MiB chunk, memory, heartbeat, cancellation, cached-query latency |
| OpenSpec | change normal/strict and full repository validation |

High-risk stop gates:

1. **Sol xHigh:** Tauri capability/command surface and Worker dataset transport.
2. **Sol xHigh:** frozen sidecar evidence and source-unopened proof.
3. **Sol High:** v2 schema and all-event dedup semantics before persistence code.
4. **Sol High:** reply/session and yearly-keyword semantic fixtures before UI integration.
5. **Sol xHigh:** 2,000,000-event memory/responsiveness evidence.
6. **Sol High:** process escalation, app-close, cleanup, and no-orphan audit.
7. **Sol High:** nested signing/resource/clean-machine package audit.

Luna Max may implement tasks after each reviewed contract gate; it does not choose a new shell, packaging mode, analytics population, keyword algorithm, or session definition.

### 14. Preserve the Stage 13–15 authorization order

| Work | Synthetic permitted now | Must precede Stage 13.10 | Real-data authority |
| --- | --- | --- | --- |
| Existing Stage 13.1–13.9 browser/Worker verification | Yes | Yes | None |
| Desktop contracts, Tauri shell, sidecar dev integration | Yes | Core preprocessor parity should pass | None |
| V2 event schema and metric semantic fixtures | Yes | V2 parser compatibility should pass | None |
| Analytics/dashboard implementation | Yes | Not required for old v1 checkpoint, but no real product claim before it | None |
| Product session/privacy/process hardening | Yes | Safe sidecar path should pass before productized real run | None |
| Existing Stage 13.10 one-year checkpoint | No in this change | Gate | Explicit separate opt-in; one selected read-only file |
| Existing Stage 14 corrections/capacity | Synthetic work yes | Follows authorized findings | Only content-free authorized findings |
| Product 2,000,000-event gate and desktop E2E | Yes | Before productized full acceptance | None |
| Existing Stage 15.1–15.9 final verification | Yes | Before 15.10 | None |
| Existing Stage 15.10 full-history acceptance | No in this change | Final gate | Explicit separate opt-in |

The practical order is:

1. finish/check the old synthetic Stage 13.1–13.9 baseline;
2. implement productization entirely with synthetic data;
3. if separately authorized, execute old Stage 13.10 and route content-free findings to Stage 14 or a new approved correction;
4. finish old Stage 14 and product capacity/package gates;
5. finish old Stage 15.1–15.9 and product synthetic acceptance;
6. stop for separate Stage 15.10/full productized acceptance authorization.

No old checkbox is changed by productization. If maintainers later want the old task document to express this interleaving, that is a separate OpenSpec planning edit after this change, not an implicit reorder here.

## Risks / Trade-offs

- [Tauri adds Rust and WebView-specific behavior] → Isolate native authority behind small commands and `DatasetByteSource`; run transport/capability spike first and stop if neither opaque transport works.
- [System WebView versions differ] → Pin the supported macOS range, record WebView/OS in E2E and capacity evidence, and avoid browser-engine-specific semantic calculations.
- [Frozen Python layout invalidates the installed-wheel gate] → Build an explicit frozen evidence manifest and prove source-unopened behavior before any integration proceeds.
- [PyInstaller sidecar increases package size] → Use `onedir` for inspectability and lifecycle correctness; report measured size, never trade privacy or reproducibility for `onefile`.
- [V2 all-event fallback cannot perfectly deduplicate evidence-poor media] → Prefer retaining an occurrence, expose an aggregate warning, and never claim exact dedup where evidence is insufficient.
- [V2 increases disk and Worker memory] → Enforce explicit event/byte/chunk limits, release chunk content, use compact arrays, and keep support behind the mandatory synthetic gate.
- [Custom protocol behavior may differ in WKWebView Workers] → Test before shell expansion; use the predesigned bounded command/channel adapter if required.
- [App crash can leave private session data] → Parent-EOF sidecar cancellation plus startup recognition and one-session-at-a-time safe cleanup; unsafe objects remain untouched with in-app recovery.
- [Targeted forced termination can hit PID reuse] → Retain and revalidate start fingerprint, executable, nonce, and process group before every signal.
- [Session threshold changes interpretation] → Offer fixed reviewed presets, display the active threshold, recompute both reply and initiator metrics together, and prohibit relationship-quality language.
- [Keyword scores can look authoritative] → Expose thresholds and all score inputs, label single-year fallback, and keep summaries traceable.
- [Aggregate exports remain sensitive] → Require explicit native save, label privacy, use generic names, and exclude bodies/identifiers/paths/hidden metadata.
- [Ad-hoc prototype is confused with a release] → Separate package and release gates in tasks/docs; never claim notarization or public distribution.
- [Old Stage tasks and implemented code appear inconsistent] → Treat checkbox state as acceptance authority, preserve it, and document dependencies without inferring completion.

## Migration Plan

1. Freeze TypeScript/Rust/Python IPC, session, v2 schema, metric-version, and error contracts with synthetic contract tests.
2. Pass the Tauri opaque transport and frozen-sidecar evidence spikes; stop for OpenSpec correction on failure.
3. Refactor Python message handling into canonical event plus v1 projection, then implement deterministic v2 staging/output without changing v1 bytes.
4. Build the analytics Worker layers and semantic fixtures; pass deterministic normal/empty/boundary cases before UI work.
5. Add the Tauri supervisor, native selection, sidecar stdin protocol, opaque handoff, cancel/escalation, and cleanup around synthetic files.
6. Build the functional workflow and dashboard against typed aggregate fixtures, then integrate the real Worker DTOs.
7. Harden CSP, navigation, path validation, logs, app close, crash recovery, disk failure, and export.
8. Produce the macOS arm64 `.app`/`.dmg` prototype and pass local, offline, clean-install, and clean-machine synthetic tests.
9. Pass the 2,000,000-event synthetic gate and all v1 regression suites.
10. Reconcile every specification scenario and stop at the existing real-data authorization boundaries.

Rollback removes the future Tauri/Rust package, v2 mode, and product UI adapters while leaving the v1 Python CLI, normalized v1 output, browser Worker, and loopback launcher functional. Private raw inputs are never migrated. Ephemeral product sessions are deleted through the normal validated cleanup before rollback.

## Open Questions

No core architecture or metric decision remains open for Luna Max. Three evidence questions are intentionally converted into implementation stop gates rather than delegated choices:

1. Does the target Tauri/WebView build support cancellable opaque-protocol reads from the module Worker, or must the predefined bounded command/channel adapter be used?
2. Does the PyInstaller `onedir` frozen evidence gate prove equivalent source-unopened and native-backend trust on a clean arm64 Mac?
3. Does the compact/partitioned implementation pass the documented 2,000,000-event memory, responsiveness, and cancellation thresholds?

Failure of a stop gate requires an OpenSpec correction before downstream implementation; it does not authorize renderer path access, a weaker startup gate, silent capacity reduction, main-thread analysis, cloud fallback, or a different desktop shell.
