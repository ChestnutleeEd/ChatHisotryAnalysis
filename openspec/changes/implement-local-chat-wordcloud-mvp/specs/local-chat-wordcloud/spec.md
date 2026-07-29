## ADDED Requirements

### Requirement: Local CipherTalk file input
The system SHALL accept one user-selected local `.json` file at a time, read it in the browser, and SHALL NOT upload the file or its contents to an external service. The MVP SHALL support files no larger than 33,554,432 bytes (32 MiB).

#### Scenario: Select one JSON export
- **WHEN** the user selects a readable local file whose name ends in `.json` and whose `File.size` is at most 33,554,432 bytes
- **THEN** the system begins local validation without making an external network request for analysis

#### Scenario: Select an unsupported file type
- **WHEN** the user selects a file whose name does not end in `.json`
- **THEN** the system rejects the file with a clear error explaining that one JSON file is required

#### Scenario: Accept a file exactly at the byte limit
- **WHEN** an otherwise valid JSON file has a `File.size` of exactly 33,554,432 bytes
- **THEN** the system permits decoding and subsequent validation

#### Scenario: Reject a file over the byte limit
- **WHEN** a selected file has a `File.size` greater than 33,554,432 bytes
- **THEN** the system rejects the entire candidate before reading its bytes, explains the 32 MiB MVP limit, and remains usable

#### Scenario: Replace the current file
- **WHEN** another JSON file passes all file-level checks after a file is already loaded
- **THEN** the system atomically replaces the prior in-memory dataset rather than combining the two files

#### Scenario: Reject a replacement candidate
- **WHEN** a replacement file fails a file-level check
- **THEN** the system does not partially analyze it and leaves the last successfully loaded dataset unchanged

### Requirement: Export structure validation
The system SHALL decode input as UTF-8 with fatal error behavior equivalent to `TextDecoder("utf-8", { fatal: true })`, parse valid JSON, and accept only the provisional private-chat CipherTalk `detailed-json` contract. A supported file SHALL have an object root, object `exportInfo` with `format` exactly equal to `detailed-json`, object `session` with `isGroup` exactly `false` and `type` exactly `私聊`, and a `messages` array containing no more than 50,000 records. File-level contract failures SHALL reject the entire candidate with an understandable error. The current schema documentation and synthetic fixture SHALL remain the source of truth until an authorized real CipherTalk export is obtained.

#### Scenario: Load the supported structure
- **WHEN** a fatally decoded and parsed JSON value satisfies the complete supported private-chat contract
- **THEN** the system accepts the export for normalization

#### Scenario: Reject invalid UTF-8
- **WHEN** the selected file contains a byte sequence that is not valid UTF-8
- **THEN** the system rejects the file with a clear encoding error and does not introduce replacement characters into analyzed text

#### Scenario: Load invalid JSON
- **WHEN** valid UTF-8 input cannot be parsed as JSON
- **THEN** the system displays an error that identifies malformed JSON without exposing the file contents

#### Scenario: Load an unsupported top-level value
- **WHEN** the parsed value is not an object or lacks object `exportInfo`, object `session`, or array `messages`
- **THEN** the system rejects the entire candidate with an error that names the missing or invalid top-level field

#### Scenario: Reject same-shaped unsupported JSON
- **WHEN** a parsed object has fields named `exportInfo`, `session`, and `messages` but fails any supported contract discriminator
- **THEN** the system rejects the entire candidate as an unsupported export and identifies the failing discriminator

#### Scenario: Reject the wrong export format
- **WHEN** `exportInfo.format` is missing or is not exactly `detailed-json`
- **THEN** the system rejects the entire candidate as an unsupported export format

#### Scenario: Reject a non-array messages value
- **WHEN** `messages` is present but is not an array
- **THEN** the system rejects the entire candidate with an error explaining that `messages` must be an array

#### Scenario: Reject a group-chat export
- **WHEN** `session.isGroup` is not exactly `false`, `session.type` is not exactly `私聊`, or the two fields conflict about private-chat status
- **THEN** the system rejects the entire candidate as unsupported because group or ambiguous sessions are outside the MVP

#### Scenario: Accept the maximum message count
- **WHEN** a supported parsed export contains exactly 50,000 entries in `messages`
- **THEN** the system permits message normalization

#### Scenario: Reject an excessive message count
- **WHEN** a supported parsed export contains more than 50,000 entries in `messages`
- **THEN** the system rejects the entire candidate before per-message normalization, explains the 50,000-message MVP limit, and remains usable

#### Scenario: Encounter provisional-schema differences
- **WHEN** otherwise supported records contain unknown fields
- **THEN** the system ignores those fields and identifies the schema as provisional rather than treating unknown fields alone as fatal

### Requirement: Loaded-session summary
After successful loading, the system SHALL display the selected file name, session display name, total message count, and available message time range.

#### Scenario: Show fixture summary
- **WHEN** the existing 5000-message synthetic fixture loads successfully
- **THEN** the system shows its file name, `session.displayName`, a count of 5000, and the first-to-last message time range

#### Scenario: Session metadata conflicts with messages
- **WHEN** `session.messageCount`, `session.firstTimestamp`, or `session.lastTimestamp` conflicts with the valid normalized messages
- **THEN** the system uses values derived from the normalized messages for the displayed summary and presents a non-fatal validation warning

### Requirement: Message normalization
The system SHALL create a new normalized message model for every recoverable message record without mutating the source JSON. A recoverable record SHALL be an object with an integer `localType`, string `type`, string-or-null `content`, numeric `isSend` equal to `0` or `1`, and at least one usable time field. The model SHALL normalize `createTime`, `formattedTime`, `localType`, `type`, `content`, `isSend`, nullable `senderUsername`, and nullable `senderDisplayName`.

#### Scenario: Normalize a documented message
- **WHEN** a message follows the documented synthetic-fixture structure
- **THEN** the system produces a normalized record containing all required normalized fields and a stable reference to its input order

#### Scenario: Skip a partially malformed message
- **WHEN** an individual entry is not an object or cannot normalize the minimum type, sender-scope, time, or content fields
- **THEN** the system skips only that entry, records a non-content-bearing warning with its array position, and continues processing other recoverable records

#### Scenario: Accept missing optional sender fields
- **WHEN** a recoverable message lacks `senderUsername` or `senderDisplayName`
- **THEN** the system normalizes the missing value to null and continues without crashing or inventing an identity

#### Scenario: Preserve source data
- **WHEN** loading, normalizing, filtering, analyzing, regenerating, or exporting completes
- **THEN** the original file remains unchanged and the parsed source object is not mutated

### Requirement: Canonical message time
The system SHALL use strict `YYYY-MM-DD HH:mm:ss` `formattedTime` as the canonical exported wall-clock value for display, calendar-date control bounds, and inclusive date filtering. It SHALL use integer Unix-second `createTime` as the canonical chronological ordering value and original source-array index as the stable secondary key. Conversion between the two fields SHALL use the provisional fixed UTC+08:00 export offset and SHALL NOT use the host timezone.

#### Scenario: Normalize two valid consistent time fields
- **WHEN** `formattedTime` is a real calendar value in the documented format and agrees with valid integer Unix-second `createTime` at fixed UTC+08:00
- **THEN** the system preserves `formattedTime` for wall-clock behavior and `createTime` for chronological ordering

#### Scenario: Preserve a conflicting formatted time
- **WHEN** both fields are valid but `formattedTime` disagrees with the fixed-UTC+08:00 wall time derived from `createTime`
- **THEN** the system preserves `formattedTime` for display and calendar filtering, preserves `createTime` for ordering, and emits a non-fatal conflict warning

#### Scenario: Fall back from invalid formatted time
- **WHEN** `formattedTime` is missing or invalid but `createTime` is a valid integer Unix-second value
- **THEN** the system derives `formattedTime` and its calendar-date key at fixed UTC+08:00, marks the record as fallback-normalized, and emits a warning

#### Scenario: Fall back from invalid create time
- **WHEN** `createTime` is missing or invalid but `formattedTime` is valid
- **THEN** the system derives an ordering timestamp by interpreting `formattedTime` at fixed UTC+08:00, marks the record as fallback-normalized, and emits a warning

#### Scenario: Skip a message with no usable time
- **WHEN** neither `formattedTime` nor `createTime` can produce a valid normalized time
- **THEN** the system skips the message with a non-content-bearing warning and continues

#### Scenario: Order identical timestamps deterministically
- **WHEN** two normalized messages have identical chronological timestamps
- **THEN** the system orders the message with the lower original source-array index first

#### Scenario: Preserve midnight calendar boundaries
- **WHEN** normalized wall-clock values fall immediately before and after midnight at fixed UTC+08:00
- **THEN** the messages receive different calendar-date keys matching their canonical `formattedTime` dates

#### Scenario: Remain independent of host timezone
- **WHEN** identical input is normalized on hosts configured with different local timezones
- **THEN** normalized wall-clock values, calendar-date keys, ordering, and warnings are identical

### Requirement: Private-chat sender semantics
For this MVP, numeric `isSend` is the authoritative sender-scope discriminator: integer `1` SHALL normalize to owner-sent and integer `0` SHALL normalize to other-participant. Boolean, string, null, missing, and other numeric values SHALL be invalid rather than coerced. `session.ownerId` SHALL be optional consistency metadata; its absence SHALL NOT prevent analysis when valid `isSend` values exist. Because group chats are rejected, every valid non-owner message SHALL belong to the one other-participant scope.

#### Scenario: Normalize supported sender values
- **WHEN** a message has numeric integer `isSend` equal to `1` or `0`
- **THEN** the system normalizes it to owner or other-participant scope respectively

#### Scenario: Skip an invalid sender value
- **WHEN** `isSend` is missing, boolean, string, null, non-integer, or a number other than `0` or `1`
- **THEN** the system skips that message with a non-content-bearing warning

#### Scenario: Load without owner ID
- **WHEN** `session.ownerId` is missing or unusable but recoverable messages have valid `isSend` values
- **THEN** the system accepts the file, uses `isSend` for scope, and emits a session-level warning

#### Scenario: Warn about sender metadata conflict
- **WHEN** usable `ownerId` and `senderUsername` conflict with the role indicated by `isSend`
- **THEN** the system keeps the `isSend`-derived scope and emits a warning without changing or exposing the sender identifier

#### Scenario: Normalize an unknown optional sender name
- **WHEN** a message has valid `isSend` but missing or previously unseen optional sender identity fields
- **THEN** the system retains the `isSend`-derived scope and uses nullable identity fields without crashing

### Requirement: Extensible text-message filtering
Only messages with usable textual content SHALL enter frequency analysis. By default, the filtering pipeline SHALL exclude image, voice, video, animation-emoji, system, and call messages; empty or null content; raw XML; URLs as tokens; and standalone numbers. Filtering rules SHALL be organized so additional message-type and content rules can be added without changing frequency calculation.

#### Scenario: Include a usable text message
- **WHEN** a normalized text message has non-empty human-readable content after cleaning
- **THEN** its remaining text enters tokenization

#### Scenario: Exclude non-text message types
- **WHEN** a message is identified by normalized type or `localType` as an image, voice, video, animation emoji, system event, or call
- **THEN** the entire message is excluded from frequency analysis

#### Scenario: Exclude empty and markup content
- **WHEN** content is null, empty after trimming, a media placeholder, or raw XML rather than human-readable text
- **THEN** the message is excluded from frequency analysis

#### Scenario: Exclude punctuation-only content
- **WHEN** content contains no Chinese or English word characters after URL, emoji, punctuation, and whitespace cleaning
- **THEN** the message is rejected before tokenization and does not count as an analyzed text message

#### Scenario: Remove URLs from mixed text
- **WHEN** otherwise usable text contains one or more URLs
- **THEN** URL spans are removed and any remaining usable text is analyzed

#### Scenario: Exclude a standalone URL or number
- **WHEN** content becomes only a URL or a number after normalization
- **THEN** the message is excluded from frequency analysis

### Requirement: Local Chinese text processing
The system SHALL clean and segment Chinese text locally with pinned `jieba-wasm@2.4.0`, its embedded default dictionary, default accurate `cut` mode, and HMM disabled. The MVP SHALL NOT mutate or replace that dictionary. It SHALL normalize whitespace and punctuation, apply a configurable stop-word list, remove tokens below a configurable minimum length, and SHALL NOT call an online segmentation or AI API.

#### Scenario: Segment Chinese text
- **WHEN** usable content contains Chinese text
- **THEN** the system emits segmented Chinese tokens after punctuation, stop-word, and minimum-length filtering

#### Scenario: Apply stop words
- **WHEN** a token exactly matches an entry in the active normalized stop-word set
- **THEN** that token is omitted from the frequency input

#### Scenario: Apply minimum token length
- **WHEN** a token contains fewer Unicode code points than the configured minimum length
- **THEN** that token is omitted from the frequency input

#### Scenario: Analyze without a network
- **WHEN** the application has loaded and the user generates or regenerates analysis while offline
- **THEN** text cleaning, segmentation, filtering, and counting complete without a network dependency

#### Scenario: Preserve the fixed segmentation configuration
- **WHEN** analysis tokenizes any Chinese text
- **THEN** it uses `cut(text, false)` from the pinned package and does not invoke full, search, HMM, `add_word`, or `with_dict` behavior

#### Scenario: Fail local tokenizer initialization
- **WHEN** the locally bundled WASM module cannot initialize
- **THEN** the system shows a non-content-bearing local-initialization error, does not fall back to an online tokenizer, and does not generate partial analysis

### Requirement: Multilingual and malformed-content handling
The text pipeline SHALL handle English words, emojis, mixed Chinese-English text, repeated punctuation, and malformed content consistently without aborting the analysis.

#### Scenario: Normalize English words
- **WHEN** usable text contains English alphabetic words
- **THEN** the system lowercases and tokenizes them as words before applying stop-word and minimum-length rules

#### Scenario: Handle mixed Chinese-English text
- **WHEN** content contains both Chinese and English text
- **THEN** the system combines tokens from both scripts into the same frequency calculation

#### Scenario: Handle emojis
- **WHEN** text contains Unicode emoji alongside usable words
- **THEN** emoji are treated as separators and excluded from word frequencies while surrounding words remain analyzable

#### Scenario: Collapse punctuation and whitespace
- **WHEN** content contains repeated punctuation or repeated whitespace
- **THEN** those sequences act as separators and do not produce tokens

#### Scenario: Handle malformed content safely
- **WHEN** a content value is not a string or contains invalid or unrecognized text fragments
- **THEN** the system skips the unusable value or fragment, reports an aggregate warning where appropriate, and continues without displaying raw content in the error

### Requirement: Analysis controls
The system SHALL let the user analyze all participants, only owner-sent messages, or only other-participant messages; choose the full available time range or an inclusive custom start and end date; set the maximum displayed words; and set the minimum word frequency. Available date bounds and inclusion SHALL use normalized canonical `formattedTime` calendar-date keys.

#### Scenario: Select sender scope
- **WHEN** the user selects all participants, owner only, or other participant only
- **THEN** the next analysis includes only messages matching that sender scope, using normalized `isSend` semantics for the two private-chat roles

#### Scenario: Select full time range
- **WHEN** the user selects the full available time range
- **THEN** the next analysis includes every otherwise eligible message from the first through last available message date

#### Scenario: Select custom date range
- **WHEN** the user selects a valid start and end date within the available range
- **THEN** the next analysis includes eligible messages on both boundary dates and every date between them

#### Scenario: Include both date boundaries
- **WHEN** eligible messages have canonical calendar-date keys equal to the selected start date or selected end date
- **THEN** the next analysis includes those messages

#### Scenario: Filter across midnight
- **WHEN** a custom range ends on one calendar date and an otherwise eligible message has a canonical key for the following date
- **THEN** the next analysis excludes that following-date message regardless of its `createTime` ordering proximity

#### Scenario: Enter an invalid date range
- **WHEN** the custom start date is after the end date or either date is outside the available range
- **THEN** the system explains the problem and prevents generation until the range is valid

#### Scenario: Set result thresholds
- **WHEN** the user changes maximum displayed words or minimum word frequency to valid positive integers
- **THEN** the next result applies both limits to the displayed frequency set

### Requirement: Deterministic frequency calculation
For the same normalized input, tokenizer and dictionary version, stop-word set, and analysis settings, the system SHALL produce the same token counts and ranking order. Ranking ties SHALL use a documented stable token ordering.

#### Scenario: Repeat identical analysis
- **WHEN** analysis is run multiple times with identical input and settings
- **THEN** token counts and ranked order are identical

#### Scenario: Rank equal frequencies
- **WHEN** two tokens have the same frequency
- **THEN** the system orders them using ascending Unicode code-point order

### Requirement: Analysis results and regeneration
The system SHALL display a word cloud, a ranked high-frequency-word list, analyzed text-message count, unique-token count before display thresholds, selected sender scope, and selected date range. “Analyzed text-message count” SHALL mean the number of messages that survive normalization, sender filtering, date filtering, text-message type filtering, and content-level exclusion and are submitted to tokenization. A submitted message SHALL continue to count even if later token filters leave no displayed token. A message rejected before tokenization SHALL not count. The system SHALL support regenerating all results after settings change.

#### Scenario: Generate non-empty results
- **WHEN** the selected scope and settings yield usable tokens
- **THEN** the system displays the word cloud, ranking, counts, sender scope, and date range from the same frequency result

#### Scenario: Generate an empty result
- **WHEN** filtering and thresholds yield no displayable tokens
- **THEN** the system presents a clear empty state and does not render a misleading word cloud

#### Scenario: Count a stop-word-only message
- **WHEN** a usable text message is submitted to tokenization and all resulting tokens are removed by the stop-word set
- **THEN** the analyzed text-message count includes that message even though it contributes no final token

#### Scenario: Do not count punctuation-only content
- **WHEN** a message is excluded before tokenization because cleaning leaves punctuation or separators only
- **THEN** the analyzed text-message count excludes that message

#### Scenario: Do not count an excluded placeholder
- **WHEN** a media placeholder or excluded message type is rejected before tokenization
- **THEN** the analyzed text-message count excludes that message

#### Scenario: Count text with no displayed token
- **WHEN** a submitted text message produces tokens that are later removed by token-length, minimum-frequency, or maximum-display rules
- **THEN** the analyzed text-message count includes that message

#### Scenario: Regenerate after settings change
- **WHEN** the user changes a control and requests regeneration
- **THEN** the system replaces the cloud, ranking, and metrics together with results computed from the new settings

### Requirement: Word-cloud PNG export
The system SHALL allow the currently generated word-cloud visualization to be downloaded as a PNG file entirely in the browser.

#### Scenario: Export a generated cloud
- **WHEN** a non-empty word cloud is displayed and the user activates PNG export
- **THEN** the browser downloads a PNG representing the current word cloud without uploading it

#### Scenario: Export before generation
- **WHEN** no non-empty word cloud is available
- **THEN** the export action is unavailable and its accessible state explains that a result must be generated first

### Requirement: Supported local launch and offline model
The MVP SHALL run in development through the Vite local development server and SHALL verify the Vite production build through a local same-origin HTTP server bound to the loopback interface. Direct `file://` execution, a desktop wrapper, a public deployment, and remote asset hosting SHALL be unsupported. Same-origin requests for locally built JavaScript, WASM, dictionaries, styles, fonts, and other assets SHALL be permitted; analysis SHALL require no external request.

#### Scenario: Launch development locally
- **WHEN** a developer starts the documented Vite development command
- **THEN** the application and all analysis dependencies load from the local development origin

#### Scenario: Verify the production build locally
- **WHEN** a developer builds the application and runs the documented local loopback preview command
- **THEN** the built HTML, JavaScript, WASM, embedded dictionary, styles, fonts, and visualization assets load from that same local origin

#### Scenario: Attempt direct file execution
- **WHEN** a user opens the built `index.html` through a `file://` URL
- **THEN** correct application operation is not guaranteed and the documentation directs the user to the supported local HTTP command

#### Scenario: Block external network access
- **WHEN** all non-loopback requests are blocked and locally packaged assets have loaded
- **THEN** file loading, regeneration, visualization, and PNG export continue without an external network dependency or third-party content request

### Requirement: Privacy boundaries
All chat parsing and analysis SHALL occur locally. The application SHALL NOT send telemetry containing chat content. Real chat data SHALL NOT be committed to Git; `data/private/` and exported user-file locations SHALL remain ignored; and the existing synthetic fixture SHALL be the only committed chat dataset.

#### Scenario: Inspect analysis network activity
- **WHEN** a user loads and analyzes a chat export
- **THEN** no request containing the file, message content, tokens, frequencies, participant identifiers, or derived chat metadata is sent

#### Scenario: Work with real exports during development
- **WHEN** a developer uses an authorized real export for manual verification
- **THEN** the file remains only in an ignored private or export-data location and is not added to version control

#### Scenario: Commit test data
- **WHEN** automated tests need chat records
- **THEN** tests use the existing synthetic fixture or smaller explicitly synthetic records and never real chat content

### Requirement: Fixture-scale robustness
The system SHALL load, normalize, filter, analyze, and render the existing 2,634,343-byte, 5000-message fixture in a current desktop browser without an uncaught error, application crash, or unusable controls. Processing SHALL provide visible progress or a busy state whenever work is long enough to delay interaction perceptibly. The byte and message limits are supported MVP boundaries, not claims about absolute browser capacity.

#### Scenario: Analyze the baseline fixture
- **WHEN** the existing 5000-message fixture is loaded and analyzed with default settings
- **THEN** the workflow confirms it is below both MVP limits, completes, and remains usable with a rendered result or a meaningful empty state

#### Scenario: Recover after oversized input
- **WHEN** a candidate is rejected for exceeding either MVP input limit
- **THEN** no partial candidate data is analyzed, the source file is unchanged, the last successful dataset remains intact, and file selection remains usable

#### Scenario: Analysis is in progress
- **WHEN** parsing or analysis takes long enough to delay a user action
- **THEN** the system exposes a visible and programmatically determinable busy state and prevents conflicting generation actions

### Requirement: Automated analysis verification
The implementation SHALL include automated tests for fatal UTF-8 decoding, byte and message limits, private-chat structural validation, normalization, sender and time fallbacks, filtering, segmentation boundaries, frequency calculation, stable tie-breaking, settings, local-only asset loading, and fixture-scale integration.

#### Scenario: Run deterministic unit tests
- **WHEN** the automated unit suite runs on fixed synthetic inputs
- **THEN** it verifies exact filtering decisions, token counts, and ranking order

#### Scenario: Run fixture integration test
- **WHEN** the integration test processes `data/mock/ciphertalk_detailed_chat_2025.json`
- **THEN** it verifies successful handling of 5000 messages without modifying the fixture

### Requirement: Accessible file and analysis controls
File selection, sender scope, date inputs, numeric settings, generation, and export SHALL be operable by keyboard, have programmatically associated names, expose validation and busy states, and maintain visible focus indicators.

#### Scenario: Operate controls by keyboard
- **WHEN** a keyboard-only user moves through the analysis workflow
- **THEN** every interactive control can be reached, understood, and activated in a logical order with visible focus

#### Scenario: Announce validation feedback
- **WHEN** file or control validation fails
- **THEN** the error is associated with the relevant control and announced to assistive technology without relying on color alone
