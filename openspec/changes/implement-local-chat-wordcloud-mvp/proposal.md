## Why

The repository has a deterministic CipherTalk-shaped fixture and provisional export schema, but no usable product increment that turns a local export into an understandable word-frequency view. A narrowly scoped, local-only word-cloud MVP will validate the core parsing and Chinese text-analysis workflow before broader chat-analysis features are considered.

## What Changes

- Add a bounded single-file flow for fatally decoding UTF-8 and validating one local private-chat CipherTalk `detailed-json` export with `exportInfo`, `session`, and `messages`; explicitly reject group chats and unsupported same-shaped JSON.
- Normalize message fields and exclude non-textual, unsafe, or unusable content through extensible filtering rules.
- Segment and clean Chinese text locally with one pinned `jieba-wasm@2.4.0` configuration, apply configurable stop words and token thresholds, and calculate deterministic frequencies.
- Add sender, date-range, maximum-word, and minimum-frequency controls.
- Display a word cloud, ranked high-frequency words, and analysis summary metrics, with PNG export for the word cloud.
- Define fixture-scale validation, automated test coverage, accessibility basics, and explicit local-data privacy boundaries.
- Define 32 MiB and 50,000-message MVP input limits with graceful whole-file rejection beyond either limit.
- Treat `docs/CIPHERTALK_EXPORT_SCHEMA.md` and `data/mock/ciphertalk_detailed_chat_2025.json` as the current source of truth while clearly marking the schema provisional until an authorized real CipherTalk export can be examined.
- Explicitly defer annual reports, sentiment analysis, AI summaries, relationship scoring, topic modeling, timeline charts, heatmaps, group chats, direct WeChat database access, CipherTalk database decryption, media analysis, cloud upload or storage, public deployment, desktop-wrapper packaging, and user accounts to possible future changes.

## Capabilities

### New Capabilities

- `local-chat-wordcloud`: Load one local CipherTalk export, normalize and filter messages, analyze Chinese text deterministically, present configurable word-cloud results, and export the visualization without transmitting chat content.

### Modified Capabilities

None.

## Impact

- Introduces a future local React and TypeScript application surface plus browser-side parsing, analysis, visualization, and PNG-export modules, launched through a local same-origin HTTP server rather than `file://`.
- Adds the exact `jieba-wasm@2.4.0` browser dependency with its embedded dictionary, a configurable local stop-word asset, and a browser-side word-cloud visualization dependency during implementation.
- Adds unit and integration tests against the existing synthetic 5000-message fixture.
- Does not add a backend, network API, database, cloud upload or storage, desktop wrapper, telemetry containing chat content, or changes to the existing fixture in this change.
