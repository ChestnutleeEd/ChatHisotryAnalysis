## Why

CipherTalk private-chat history can span multiple large annual exports that the former one-file browser import cannot analyze safely. The MVP needs a local preprocessing boundary that removes unnecessary sensitive fields before a responsive browser application performs text analysis and visualization.

## What Changes

- **BREAKING** Replace direct browser import of raw CipherTalk JSON with a local macOS Python CLI that streams one raw annual source at a time, validates a single private conversation, minimizes data, deduplicates across files, merges chronologically, and writes deterministic normalized artifacts.
- Add explicit `annual source` and optional `overlap verification` input roles; verification exports never contribute records or periods to complete-history totals.
- Separate data use into authoritative public synthetic fixtures, an explicitly opted-in private one-year local validation dataset, and an explicitly opted-in private full final acceptance dataset; private datasets are never fixtures or CI inputs.
- Add the earliest private one-year local validation checkpoint only after the single-file preprocessing, privacy/error, Worker tokenization, frequency, and word-cloud workflow has passed its synthetic tests; retain private full multi-file acceptance for the final stage.
- Replace the former small raw-browser limits with implementation-ready raw-preprocessing and normalized-browser limits sized for the audited scale.
- Define a data-minimized local analysis dataset as one normalized manifest plus deterministic bounded NDJSON chunks under a Git-ignored output location.
- Use `chatLabType` as the primary message classifier, `type` as consistency and conservative fallback metadata, and safe-integer `localType` as raw metadata only.
- Admit text only when all three observed text signals agree and content survives privacy-safe placeholder, XML, and URL filtering.
- Use pseudonymous same-conversation fingerprints, immediately digested string message identifiers, independently verified primary and fallback identities, deterministic file ranking, cross-file deduplication, and canonical ordering.
- Stage only minimized fields in an owner-only same-filesystem SQLite workspace with fixed privacy PRAGMAs, exhaustive cleanup, atomic promotion, and an explicit crash-remnant recovery flow.
- Define exact record, chunk, zero-record, destination-collision, disk-failure, and promotion-failure behavior without partial output.
- Move normalized chunk loading, Jieba WASM initialization, tokenization, compact cached sender/date filtering, and frequency calculation into a browser Web Worker with progress, cancellation, and a mandatory maximum-boundary memory decision gate.
- Restrict every user-visible and diagnostic error surface to a content-free metadata allow-list and fail the CLI startup gate before opening raw input when the pinned Python or `ijson` runtime cannot be verified.
- Keep the React/TypeScript word cloud, ranking, controls, accessibility, PNG export, loopback launch, deterministic frequency behavior, and entirely local operation.
- Add repository-root Finder-launchable start and stop commands that self-locate the project, install an incomplete project-local dependency tree from the authoritative lockfile without manual terminal input, bind only loopback, open the default browser after readiness, maintain owner-only symlink-safe runtime files, reject duplicate or conflicting instances, and stop only a launcher process verified by an unpredictable instance identity, creation fingerprint, actual executable, exact structured arguments, and a held-open identity file.
- Preserve license and copyright notices for embedded dictionaries and bundled third-party code in a public notice file copied unchanged into every production build.
- Update the public schema documentation with aggregate-safe confirmed observations, implementation policy, and remaining provisional behavior.
- Continue to exclude sentiment analysis, AI summarization, relationship scoring, annual relationship reports, topic modeling, timelines, heatmaps, group chats, media transcription or recognition, direct WeChat database access, CipherTalk decryption, cloud services, public deployment, accounts, and Electron/Tauri packaging.

## Capabilities

### New Capabilities

- `local-chat-wordcloud`: Preprocess multiple annual private-chat CipherTalk exports locally into a data-minimized deterministic dataset, then analyze the complete normalized history in a responsive local browser application and present word-cloud and ranked-frequency results.

### Modified Capabilities

None.

## Impact

- Introduces a future local Python preprocessing CLI and one pinned streaming-parser dependency; it is a local command, not a server or backend API.
- Introduces deterministic normalized-manifest and NDJSON-chunk contracts plus private, temporary SQLite staging stored only in ignored local output roots.
- Introduces a React/TypeScript/Vite browser application that accepts normalized artifacts only and performs analysis in a Web Worker using pinned `jieba-wasm@2.4.0`.
- Adds future synthetic multi-year, overlap, deduplication, capacity, Worker, privacy, accessibility, and offline test coverage while retaining synthetic fixtures as the authoritative public automation boundary.
- Permits only explicit, local, read-only private validation; default CLI, browser launch, automated tests, and CI never discover private storage, and all derived private artifacts remain ignored and local.
- Raw exports and normalized datasets remain outside Git; no cloud upload, remote analysis API, database, telemetry containing private data, or source-file mutation is introduced.
