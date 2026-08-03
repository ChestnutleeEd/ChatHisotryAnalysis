## Why

The implemented local word-cloud MVP still requires users to run a Python environment and manually hand normalized files to a browser, while its text-only normalized schema cannot support accurate whole-conversation, media, reply, or session statistics. Productization needs one privacy-preserving desktop workflow and one shared, testable analytics contract before feature implementation continues.

## What Changes

- Add a macOS-first desktop application that lets a user select one or more explicit CipherTalk detailed JSON exports and runs validation, conversion, deduplication, analysis, and presentation without Python, a virtual environment, a terminal, or manual normalized-file handling.
- Package the existing production preprocessor as a pinned, platform-specific sidecar while preserving its streaming validation, deterministic deduplication, atomic publication, content-free diagnostics, cancellation, and offline boundaries.
- Add a versioned canonical event dataset that preserves minimized metadata for post-dedup user and system events while retaining cleaned content only for eligible text. The existing v1 eligible-text dataset and browser word-cloud workflow remain supported as a compatibility path.
- Add one schema-validated, session-scoped IPC boundary between the desktop core, sidecar, renderer, and analytics Worker, with an explicit command allow-list, opaque renderer identifiers, stale-event suppression, no arbitrary filesystem or process access, and no default network path.
- Define supervised sidecar lifecycle, cancellation escalation, crash and app-close behavior, orphan detection, retry, and startup recovery so no child process remains after a handled exit.
- Define owner-only per-analysis temporary storage, input read-only behavior, atomic handoff, startup and shutdown cleanup, disk-full behavior, malicious path/manifest rejection, and explicit aggregate-export boundaries.
- Add deterministic shared analytics for daily/monthly/yearly trends, sender counts and shares, hour and weekday activity, chat-day streaks, yearly word changes, message length, yearly keywords, traceable yearly summaries, message types, reply intervals, and conversation-session initiators.
- Replace chart-local scans and metric-specific definitions with one analytics Worker that builds compact indexes and tokens once, calculates shared aggregates, derives metrics through pure selectors, reports progress, supports cancellation, and enforces a synthetic 2,000,000-message performance gate.
- Add a product information architecture covering onboarding, privacy, selection, validation, progress, recovery, dashboards, filters, metric definitions, export, re-analysis, and close-time data handling, with functional accessibility requirements separated from a later visual-polish phase.
- Add an unsigned/ad-hoc macOS arm64 `.app` and `.dmg` prototype path, clean-machine acceptance, and explicit signing/notarization boundaries without claiming a production release.
- Record synthetic-only implementation gates and the dependency on the existing MVP Stage 13–15 authorization checkpoints without running, reordering, or marking any existing real-data task complete.
- Keep Windows packaging, formal signing/notarization, automatic updates, accounts, upload, cloud analysis, external model APIs, database extraction, and relationship or psychological judgement out of this change.

## Stage 1 Alpha foundation boundary

The current productization Stage 1 is an unsigned local macOS Alpha foundation
gate. It is intended to prove the one-click architecture, privacy boundary,
host-owned opaque transport, production Worker integration, bounded lifecycle,
browser compatibility, and clean-installable source build. It does not claim a
public release or complete release evidence.

Stage 1 Alpha MUST still enforce local-only processing, permanent isolation of
`data/private`, renderer privilege minimization, explicit user selection,
host-owned session/dataset authority, deterministic multi-file handling,
Worker stale-operation suppression, bounded chunks/datasets/records/channels,
basic cancellation and cleanup, pinned Python 3.12 dependencies, a true
hash-locked install, and a buildable unsigned macOS arm64 path. All automated
fixtures remain public or synthetic.

The following remain explicit unchecked Beta/Release hardening work and do not
block the unsigned local Alpha: packaged WebKit permission runtime proof,
independent signed sidecar trust roots, complete tamper and lifecycle/crash
matrices, formal codesign/notarization, `.app`/`.dmg` clean-machine release
acceptance, exhaustive IPC conformance, 512 MiB peak-memory proof, release
supply-chain evidence, and Windows hardening. These requirements are retained
in the change's deferred task section and must be completed before a formal
release claim.

## Stage 10 Alpha boundary correction

Stage 10 protects the selected raw JSON, canonical dataset and staging store,
aggregate results, explicit export files, owner-only session/cache storage,
the fixed-digest Alpha sidecar, dataset transport, content-free logs, and all
host session/generation/result capabilities.

The trusted boundary is the Rust/Tauri host, host-owned registries and
`SecureStorage`, the fixed-digest Alpha sidecar, and operating-system native
open/save dialogs. The renderer, React UI, analytics Worker, and every message
between them are one untrusted frontend domain. Tauri/WebView does not provide
a trustworthy Worker-vs-renderer caller identity, so the host does not claim
to prove that distinction. Instead, host commands accept no paths, filenames,
message bodies, arbitrary strings, schemas, or export payloads; the result
commit seam accepts only a closed, runtime-validated numeric aggregate DTO
bound to the current window, session, generation, dataset, canonical query,
and analytics contract.

Alpha resists malformed or oversized input, forged/stale/replayed capabilities,
unsafe storage objects and directory escape, unsafe navigation/network paths,
content-bearing logs, orphan cleanup mistakes, and write/rename/fsync failure.
It does not claim to eliminate the theoretical macOS PID/PGID reuse window
between identity validation and a signal syscall, prove race freedom against a
fully malicious same-UID process, distinguish a compromised renderer from its
Worker, or remediate OS, kernel, filesystem, or WebKit vulnerabilities. Those
limits are accepted owner-only local-Alpha residuals. Packaged WebKit/runtime
permission evidence maps to D.1; exhaustive storage/tamper combinations to
D.3; exhaustive lifecycle/crash/disconnect/reuse evidence to D.4; exhaustive
IPC/capability conformance to D.8; and formal capacity/performance/resource
certification to D.9.

## Capabilities

### New Capabilities

- `desktop-local-analysis`: Native desktop selection, packaged preprocessor sidecar supervision, secure IPC, ephemeral data lifecycle, offline operation, and macOS-first packaging with a future Windows boundary.
- `deterministic-chat-analytics`: Versioned minimized event data, shared compact analytics indexes, exact metric semantics, deterministic aggregation, filtering, cancellation, and supported-scale gates.
- `product-analysis-dashboard`: Product workflow states, dashboard navigation and filter scope, metric presentation and explanations, local aggregate export, accessibility, and visual-phase boundaries.

### Modified Capabilities

None. The unarchived `local-chat-wordcloud` change remains the v1 prerequisite and compatibility contract; this change adds productization capabilities without rewriting its requirements or task state.

## Impact

- Adds a future Tauri 2 Rust desktop core and narrowly scoped renderer bridge around the existing React/TypeScript/Vite application.
- Adds a future pinned PyInstaller `onedir` build of the Python preprocessor for macOS arm64; other targets require independent native builds and evidence.
- Introduces a canonical event/manifest v2 contract and adapter boundaries while preserving normalized-record/manifest v1 browser behavior.
- Refactors the current Worker/importer/token cache into reusable validation and analytics modules, but keeps complete-dataset work off the renderer main thread.
- Adds future synthetic Python, Rust, TypeScript, component, browser, packaged-sidecar, desktop E2E, offline, lifecycle, security, capacity, `.app`, and `.dmg` coverage.
- Does not authorize production implementation in this planning batch, private-data access, Stage 13.10, Stage 15.10, Windows release, cloud services, telemetry, or automatic update infrastructure.
