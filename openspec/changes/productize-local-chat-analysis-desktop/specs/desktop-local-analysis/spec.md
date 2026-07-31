## ADDED Requirements

### Requirement: One-click raw CipherTalk analysis
The desktop product SHALL provide the default workflow `open application -> select one or more explicit CipherTalk detailed JSON files -> start analysis -> validate, normalize, deduplicate, and calculate locally -> show results`. Annual sources SHALL be selected explicitly and SHALL contribute to the dataset. An optional advanced verification selection SHALL remain separate and SHALL never contribute records or periods. The workflow SHALL NOT require an installed Python, virtual environment, Node.js, terminal command, manual preprocessor invocation, normalized-file selection, or manual temporary-file cleanup.

#### Scenario: Analyze selected annual exports
- **WHEN** the user selects one or more annual CipherTalk detailed JSON files and activates Start analysis
- **THEN** the desktop application processes only those explicit files and transitions to results without asking for a normalized manifest or chunk

#### Scenario: Add an optional verification export
- **WHEN** the user uses the advanced verification control to select an overlap-verification file
- **THEN** the application labels its non-contributing role and the preprocessor excludes it from all totals and periods

#### Scenario: Decline file selection
- **WHEN** the native file picker is cancelled
- **THEN** no session, sidecar, output directory, or error state is created

#### Scenario: Preserve selected inputs
- **WHEN** analysis succeeds, fails, is cancelled, or the application closes
- **THEN** every selected raw input remains byte-for-byte unchanged and no persistent raw copy is created

#### Scenario: Reject unsupported input safely
- **WHEN** an explicitly selected file fails the existing runtime, size, UTF-8, JSON, schema, private-session, or same-conversation contract
- **THEN** the product reports a stable content-free category and offers a fresh selection without exposing the file name, path, participant, or content

### Requirement: Tauri desktop shell and minimum renderer authority
The product SHALL use a pinned Tauri 2 desktop shell around the existing React/TypeScript/Vite renderer. The Rust desktop core SHALL exclusively own native dialogs, selected paths, sidecar execution, session directories, process termination, cleanup, and aggregate export writes. The renderer SHALL receive no shell, arbitrary process, arbitrary filesystem, HTTP client, updater, opener, or raw-path capability. Production SHALL load only bundled application code and SHALL disable developer tools unless an explicit development build is running.

#### Scenario: Select files through the desktop core
- **WHEN** the renderer requests raw-source selection
- **THEN** the Rust core opens a native dialog and returns an opaque selection ID plus a count, not any path or basename

#### Scenario: Attempt an unlisted desktop command
- **WHEN** renderer code invokes a command outside the generated application command allow-list
- **THEN** Tauri rejects it before filesystem, process, dialog, or session state is accessed

#### Scenario: Attempt arbitrary filesystem access
- **WHEN** renderer code supplies a path, URL, executable name, command line, or shell fragment to a desktop command
- **THEN** schema validation rejects the request and no privileged operation occurs

#### Scenario: Load bundled production content
- **WHEN** the packaged application opens its main window
- **THEN** it loads only bundled local assets in the single declared main webview with production developer tools disabled

### Requirement: Packaged Python preprocessor sidecar
The macOS arm64 product SHALL bundle the production Python preprocessor as a pinned PyInstaller `onedir` sidecar built on macOS arm64 from hash-locked project, Python, PyInstaller, and `ijson` inputs. It SHALL NOT use PyInstaller `onefile`, a system Python, user `PATH`, a virtual environment, runtime package installation, or network download. The build SHALL emit a target-specific sidecar evidence manifest covering target triple, source revision, preprocessor version, Python version, PyInstaller version, `ijson` version, native backend identity, and hashes of executable and native runtime members.

Development mode SHALL continue to use the installed CPython 3.12 startup gate already defined by the MVP. Packaged mode SHALL replace distribution-metadata assumptions that are unavailable in a frozen application with an equivalent frozen-runtime gate that verifies the signed bundle location, evidence manifest, embedded bytes, exact `yajl2_c` backend, parser probes, and target triple before opening an input. Both modes SHALL execute the same production preprocessing composition after their gate.

#### Scenario: Run on a clean supported Mac
- **WHEN** a clean macOS arm64 machine launches the packaged application without Python or Node.js installed
- **THEN** the bundled sidecar passes its frozen-runtime gate and can preprocess a supported synthetic selection

#### Scenario: Run from source in development
- **WHEN** a developer starts the desktop shell in the documented development environment
- **THEN** the sidecar adapter uses the existing installed CPython 3.12 gate and the same production preprocessing pipeline

#### Scenario: Reject a modified sidecar member
- **WHEN** the executable, Python runtime, `ijson` module, native parser, or evidence manifest differs from the build evidence
- **THEN** the sidecar fails before opening raw input with a stable packaged-runtime reason code

#### Scenario: Resolve the packaged executable
- **WHEN** the `.app` is moved to another supported location
- **THEN** the Rust core resolves the target-specific sidecar from application resources without using a hard-coded checkout path or user `PATH`

#### Scenario: Refuse wrong-architecture artifacts
- **WHEN** an arm64 package contains a sidecar or native member for another target
- **THEN** the frozen-runtime gate fails before input access

### Requirement: Path-free sidecar invocation and protocol
The Rust core SHALL spawn the sidecar directly without a shell. Private source and session paths SHALL be delivered through one bounded, length-prefixed, strict-JSON configuration on the child's stdin after spawn and SHALL NOT appear in argv, renderer messages, progress, result events, logs, or user-visible errors. The sidecar SHALL emit zero or more newline-delimited progress objects followed by exactly one success object on stdout, or exactly one structured failure object on stderr and a stable exit code. The core SHALL enforce exact fields, types, phase values, monotonic percentages, role/ordinal labels, line-size and event-count limits, and a terminal-event rule; unparsed child output SHALL be discarded rather than logged or shown.

#### Scenario: Start a valid sidecar session
- **WHEN** the core owns a valid selection and private session directory
- **THEN** it spawns the allow-listed resource executable and sends one exact stdin configuration containing the selected annual and verification roles

#### Scenario: Receive valid progress
- **WHEN** the sidecar emits a valid progress object
- **THEN** the core maps it to one versioned session event without adding a path, name, content, hash, or child exception

#### Scenario: Receive a valid terminal result
- **WHEN** the sidecar exits successfully after one valid result object
- **THEN** the core verifies the known session output before announcing preprocessing completion

#### Scenario: Receive malformed or excessive output
- **WHEN** stdout or stderr contains an unknown field, oversized line, invalid JSON, invalid sequence, duplicate terminal event, raw text, or trailing data
- **THEN** the core discards the raw bytes, terminates the session safely, and reports only `SIDECAR_PROTOCOL_INVALID`

#### Scenario: Child exits without a terminal event
- **WHEN** the child crashes or exits without the required structured result or failure
- **THEN** the core reports only `SIDECAR_CRASHED`, retains no raw child output, and starts cleanup

### Requirement: Versioned desktop IPC and stale-event suppression
Every renderer command and core event SHALL validate against an explicit versioned schema. Commands SHALL be limited to source selection, analysis start, cancellation, retry, session discard, aggregate export, and safe application-close decisions. Every session-bound message SHALL contain protocol version, opaque session ID, monotonically increasing generation, and command request ID or event sequence. The core SHALL bind opaque IDs to the originating main window and active generation. The renderer and core SHALL both discard stale, duplicate, out-of-order, wrong-window, unknown-session, and post-terminal messages.

#### Scenario: Accept a current command
- **WHEN** the main window sends an allow-listed command with the current schema, session ID, and generation
- **THEN** the core validates it once and performs only the named operation

#### Scenario: Suppress a stale completion
- **WHEN** an earlier sidecar or Worker completes after a replacement analysis has advanced the generation
- **THEN** neither the core nor renderer changes the current progress, dataset, result, error, or focus

#### Scenario: Reject an invented session
- **WHEN** a renderer submits a syntactically valid but unowned or terminal session ID
- **THEN** the core returns a stable invalid-session error without disclosing whether a path or remnant exists

#### Scenario: Reject event reordering
- **WHEN** the renderer observes a duplicate or non-increasing session event sequence
- **THEN** it ignores that event and preserves the last valid state

### Requirement: Supervised session and process lifecycle
The desktop core SHALL implement the state machine `idle -> selecting -> ready -> preprocessing -> handoff -> analyzing -> complete`, with explicit `cancelling`, `failed`, `discarding`, and `closing` transitions. At most one analysis generation SHALL own a live sidecar and one analytics Worker. A retry SHALL create a new generation and an absent output destination. A terminal generation SHALL never return to a running state.

#### Scenario: Complete the normal lifecycle
- **WHEN** selection, preprocessing, verified handoff, Worker indexing, and initial analytics all succeed
- **THEN** state transitions occur in order and the result is committed atomically for the active generation

#### Scenario: Retry a failed session
- **WHEN** a retryable failure is shown and the user activates Retry
- **THEN** the core increments the generation, cleans or isolates the prior candidate, creates a new absent output destination, and reruns from explicit retained selection authority

#### Scenario: Replace an active analysis
- **WHEN** the user starts a new selection while a session is running
- **THEN** the old generation enters cancellation and cannot publish events or results into the new generation

#### Scenario: Reject an invalid transition
- **WHEN** a command requests analysis, retry, export, or discard from a state that does not permit it
- **THEN** the core returns a stable state error without performing a partial action

### Requirement: Cancellation, close, crash, and orphan control
Cancellation SHALL first request the existing cooperative sidecar cancellation and Worker cancellation. If the child does not exit within the documented grace period, the core SHALL revalidate the retained child identity and escalate through targeted termination to a final target-specific kill. The macOS implementation SHALL create a dedicated child process group, never invoke a shell, and verify the retained PID, process start fingerprint, executable, session nonce, and group before every escalation. The sidecar SHALL monitor its parent lifetime and request its own safe cancellation if the desktop core disappears. Application close SHALL wait for bounded cancellation and cleanup before exit; after a handled close no child or Worker SHALL remain.

#### Scenario: Cancel cooperatively
- **WHEN** the user cancels during a safe preprocessing phase
- **THEN** the sidecar observes cancellation at a checkpoint, removes its staging entries, exits with the stable cancellation code, and the core terminates the Worker

#### Scenario: Cancel during atomic promotion
- **WHEN** cancellation arrives after the existing preprocessor commit boundary begins
- **THEN** the complete atomic promotion finishes, the result is treated as complete, and subsequent session cleanup handles it without exposing a partial dataset

#### Scenario: Escalate an unresponsive child
- **WHEN** cooperative cancellation and the bounded graceful interval expire
- **THEN** the core revalidates child identity before each targeted escalation and never signals an unrelated or PID-reused process

#### Scenario: Close the application during analysis
- **WHEN** the user closes the last window while the sidecar or Worker is active
- **THEN** the application enters closing state, performs bounded cancellation and entry-by-entry cleanup, then exits with no retained background process

#### Scenario: Desktop core crashes
- **WHEN** the parent-lifetime monitor observes that the owning core has disappeared
- **THEN** the sidecar requests cancellation, performs its existing safe cleanup, and exits rather than becoming an orphan

#### Scenario: Refuse unsafe process identity
- **WHEN** PID, start fingerprint, executable, nonce, process-group identity, or ownership no longer matches
- **THEN** escalation is refused, no unrelated process is signalled, and a content-free orphan-cleanup error is recorded for the next safe startup

### Requirement: Owner-only per-analysis storage
The desktop core SHALL resolve an application-owned cache root through the platform API and SHALL create an owner-only analysis root plus one unpredictable session directory per analysis. On macOS, directories SHALL be `0700` and regular files SHALL be `0600`; symbolic links and unexpected owners, modes, types, or containment SHALL be rejected. Inputs SHALL be opened read-only in place and SHALL NOT be copied. The sidecar SHALL publish canonical event chunks and a manifest only inside the active session through its existing same-filesystem staging and atomic-rename model.

#### Scenario: Create a session directory
- **WHEN** a valid selection starts analysis
- **THEN** the core creates one owner-only marked session under the resolved application cache root and no location is returned to the renderer

#### Scenario: Keep inputs in place
- **WHEN** the sidecar processes selected exports
- **THEN** it opens the explicit originals read-only and creates no persistent raw-body copy in cache, application support, logs, or the app bundle

#### Scenario: Reject a symbolic-link escape
- **WHEN** the cache root, session, staging entry, output entry, or path component is a symlink or resolves outside its authorized parent
- **THEN** processing stops before private data is written through that path

#### Scenario: Handle insufficient disk space
- **WHEN** preflight estimates insufficient free space or a write/flush later reports disk exhaustion
- **THEN** no final session dataset is handed to the Worker, cleanup is attempted entry by entry, and the UI reports a stable disk-space category

### Requirement: Opaque verified dataset handoff
After sidecar success, the desktop core SHALL independently verify the known session manifest, exact chunk allow-list, containment, ownership, permissions, sizes, hashes, schema version, and privacy declaration before Worker access. The renderer SHALL receive only an opaque session capability and aggregate-safe summary. The desktop Worker SHALL read manifest and chunk bytes through a core-owned, read-only, session-scoped transport that accepts only the active session and manifest-declared chunk ordinals; arbitrary paths, directory listing, writes, network hosts, redirects, queries, and traversal SHALL be impossible. The existing browser `File` adapter SHALL remain available for v1 regression.

#### Scenario: Hand off a valid desktop dataset
- **WHEN** the sidecar atomically publishes a valid session dataset
- **THEN** the core verifies it and the Worker reads each declared chunk by opaque session and ordinal without learning an operating-system path

#### Scenario: Request an undeclared chunk
- **WHEN** renderer or Worker code requests an unknown session, filename, ordinal, query, range outside the file, or traversal form
- **THEN** the transport rejects the request without opening an arbitrary file

#### Scenario: Detect post-handoff tampering
- **WHEN** a verified manifest or chunk changes before or during Worker reading
- **THEN** identity, size, and hash checks reject the candidate and no partial analytics result is committed

#### Scenario: Run browser regression
- **WHEN** the browser-only v1 workflow is tested
- **THEN** it continues to validate explicitly selected v1 `File` objects without any Tauri API

### Requirement: Session cleanup, startup recovery, and explicit export
The default session lifetime SHALL end when the user starts a replacement analysis or fully quits the application. Normal completion MAY retain canonical chunks only until that session ends so retry and Worker restart remain possible. Cleanup SHALL remove only validated entries belonging to one session, one explicit entry at a time, and remove a directory only after it is empty; it SHALL NOT perform broad recursive deletion or claim forensic erasure. Startup SHALL inspect only the application-owned session root, validate fixed markers and state, terminate a verified orphan if necessary, and clean recognized remnants. Unsafe remnants SHALL remain untouched and produce a retryable content-free cleanup state in the UI.

Only an explicit native save action MAY persist an aggregate report or rendered image to a user-selected destination. Version 1 SHALL NOT offer raw-source copies, normalized-dataset retention, automatic history, or background autosave. Exported aggregate files SHALL state active filters, fixed timezone, metric versions, and privacy sensitivity, and SHALL contain no path, raw identifier, message content, or hidden metadata.

#### Scenario: Quit after completed analysis
- **WHEN** the user fully quits with a completed session
- **THEN** canonical chunks, manifest, state, and temporary artifacts are logically removed entry by entry and no automatic analysis history remains

#### Scenario: Recover a recognized crash remnant
- **WHEN** startup finds a safely contained owner-only session with the exact application marker and no valid live owner
- **THEN** it cleans that one session entry by entry without presenting a path or requiring terminal use

#### Scenario: Find an unsafe remnant
- **WHEN** startup encounters a symlink, wrong owner, unsafe mode, unknown entry, invalid marker, or unverified live PID
- **THEN** it does not follow, signal, or delete the object and presents only a stable cleanup-required state with an in-app retry

#### Scenario: Export aggregate results
- **WHEN** the user chooses a supported image or aggregate-table export and confirms a native save destination
- **THEN** only the current filtered aggregate result is written, with no raw or normalized message body

#### Scenario: Decline export
- **WHEN** the native save dialog is cancelled
- **THEN** no file is created and the active result remains usable

### Requirement: Offline, navigation, CSP, and privacy logging
The packaged runtime SHALL have no application network command, telemetry, remote asset, cloud fallback, external model call, or automatic update path. Production CSP SHALL allow only bundled code, required local data/image forms, the Tauri IPC transport, and the opaque dataset transport; it SHALL deny remote connections, objects, frames, and unauthorized navigation. New-window creation, drag navigation, external URL opening, and permission requests SHALL be denied. Logs SHALL contain only version, phase, stable category, aggregate-safe counts, duration bucket, platform/architecture, and session-local opaque IDs; raw child output, paths, basenames, identifiers, text, tokens, frequencies, and private statistics SHALL be absent.

#### Scenario: Run with networking blocked
- **WHEN** every external network route is denied after installation
- **THEN** selection, preprocessing, analytics, visualization, cancellation, and export remain functional

#### Scenario: Attempt external navigation
- **WHEN** bundled content, a link, a dropped object, or script requests an external URL or a new window
- **THEN** navigation is prevented and no external application is opened

#### Scenario: Inspect runtime requests
- **WHEN** desktop E2E records all URL and IPC activity
- **THEN** only bundled origins, Tauri IPC, and active opaque dataset reads are present

#### Scenario: Inject sensitive child output
- **WHEN** a synthetic sidecar emits sensitive-looking text, paths, identifiers, hashes, URLs, or tracebacks
- **THEN** none appears in logs, renderer events, screenshots, snapshots, reports, or user-visible errors

### Requirement: macOS arm64 package prototype
The first desktop target SHALL be macOS arm64. The implementation SHALL produce a locally runnable `.app` and `.dmg` prototype containing bundled frontend assets and the `onedir` sidecar, with correct nested executable permissions, target architecture, bundle resource resolution, quarantine behavior documentation, and ad-hoc signing suitable for local prototype verification. Nested sidecar executables, Python libraries, and native extensions SHALL be signed before the outer app. Formal Developer ID signing, notarization, stapling, and public distribution SHALL remain a later release gate and SHALL NOT be claimed by this change.

#### Scenario: Build a local app bundle
- **WHEN** the documented macOS arm64 package command runs from locked inputs
- **THEN** it produces an `.app` whose renderer assets and sidecar resolve without checkout-relative paths

#### Scenario: Build a DMG prototype
- **WHEN** the app bundle passes local package tests
- **THEN** the documented bundle command produces an installable prototype `.dmg`

#### Scenario: Launch on a clean Mac account
- **WHEN** the prototype is copied to a clean supported Mac account with no development runtimes
- **THEN** Finder launch, native selection, synthetic analysis, cancellation, full quit, and cleanup pass without Python, Node.js, or Rust installed

#### Scenario: Distinguish prototype from release
- **WHEN** the package is ad-hoc signed or not notarized
- **THEN** documentation and UI do not describe it as a notarized public release and record the expected Gatekeeper/quarantine boundary

### Requirement: Future Windows boundary
The architecture SHALL isolate platform process, path, cache, signing, and packaging behavior behind target adapters. A future Windows build SHALL use a Windows-built target-specific PyInstaller `onedir` sidecar, native path and Unicode handling, a Job Object configured to terminate child processes when the owning core closes, application-local temporary storage, and Windows signing/installer gates. The macOS implementation SHALL NOT hard-code POSIX separators, signals, bundle paths, or permission assumptions into renderer, canonical dataset, analytics, or UI contracts. Windows implementation and release SHALL remain outside this change.

#### Scenario: Compile platform-neutral contracts
- **WHEN** shared TypeScript schemas, canonical dataset validation, analytics, and UI tests run
- **THEN** they contain no macOS-only path, signal, or bundle assumption

#### Scenario: Add a future Windows sidecar
- **WHEN** Windows productization is later authorized
- **THEN** its native build and process adapter can implement the existing protocol without changing metric or dashboard semantics

#### Scenario: Defer Windows release
- **WHEN** this change reaches completion
- **THEN** no Windows installer, Windows signing claim, or Windows clean-machine acceptance is required

### Requirement: Synthetic gates and existing Stage 13–15 authorization
All implementation, security, lifecycle, package, and semantic automation in this change SHALL use fabricated public fixtures. It SHALL NOT discover, enumerate, or open private storage. The existing MVP Stage 13.1–13.9 synthetic/browser checks and Stage 14 synthetic capacity work remain prerequisites for claiming the v1 compatibility baseline. Existing Stage 13.10 one-year validation and Stage 15.10 full-history acceptance SHALL remain explicit user authorization gates and SHALL NOT be run, checked, reordered, or redefined by this change.

The productization shell, sidecar protocol, event v2 contract, analytics, dashboard, lifecycle hardening, and package prototype SHALL be completed with synthetic fixtures before any productized real-data checkpoint. Findings from an authorized Stage 13.10 SHALL be handled in the existing Stage 14 correction boundary or a separately approved change. Productized full-history acceptance SHALL wait until the existing Stage 15.1–15.9 gates, all productization synthetic gates, and a separate authorization are complete.

#### Scenario: Implement before real-data authorization
- **WHEN** productization tasks through synthetic desktop E2E are executed
- **THEN** they use only fabricated inputs and neither Stage 13.10 nor Stage 15.10 is entered

#### Scenario: Reach the one-year gate
- **WHEN** existing Stage 12 and 13.1–13.9 plus the productization preprocessor/sidecar synthetic compatibility prerequisites pass
- **THEN** work stops for explicit authorization rather than opening a real one-year file

#### Scenario: Receive one-year findings
- **WHEN** a separately authorized Stage 13.10 later reports a content-free compatibility finding
- **THEN** correction is planned under Stage 14 or a separately approved change without recording private aggregates or content

#### Scenario: Reach full-history acceptance
- **WHEN** existing Stage 15.1–15.9, productization synthetic E2E, supported-scale, package, offline, cleanup, and clean-machine gates pass
- **THEN** work stops for separate Stage 15.10 authorization

#### Scenario: Preserve existing task state
- **WHEN** this change is implemented or validated
- **THEN** no checkbox in `implement-local-chat-wordcloud-mvp` is changed automatically
