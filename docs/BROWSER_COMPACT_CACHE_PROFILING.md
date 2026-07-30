# Browser compact-cache profiling decision

## Decision

Stage 9 uses **compact token-ID arrays with one shared token table**. Each
accepted message contributes one contiguous range of `Uint32` token IDs.
Parallel typed arrays hold the record offsets, sender scope, and a compact
integer calendar-date code. The Worker discards the construction
map after validation and cache construction; it retains only the token table
and compact typed arrays. Normalized text and the current chunk buffer are
released before the next chunk is read.

This is the only production cache representation. The rejected comparison
implementations described below existed only in an untracked `/tmp` profiling
harness and are not part of the application.

## Gate and environment

The mandatory decision profile used only generated synthetic normalized
records. It did not discover, enumerate, or read private storage.

| Field | Observed value |
| --- | --- |
| Browser | Chrome for Testing 151.0.7922.34 (Playwright Chromium) |
| Operating system | macOS 15.7.7 (24G720) |
| Architecture | arm64 |
| Physical memory | 16 GiB |
| Tokenizer | `jieba-wasm@2.4.0`, embedded dictionary, `cut(text, false)` |
| Large selected input | 132,120,486 bytes in four 31.5 MiB synthetic chunks |
| Large selected-input records | 674,651 canonical-shaped NDJSON records |
| Record-boundary tokenization run | 1,000,000 generated message texts |
| Baseline run | 5,000 generated message texts |

The selected input is below the inclusive 134,217,728-byte aggregate limit
and each chunk is below the inclusive 33,554,432-byte chunk limit. The
separate 1,000,000-record run exercises the record-count cache boundary.
Those boundaries are separate because the smallest valid canonical record,
including its required increasing `sourceIndex` and LF, makes a one-million
record on-disk dataset exceed 128 MiB.

The qualitative OpenSpec stop gate was interpreted literally: the run had to
finish without browser termination, persistent main-thread unresponsiveness,
incomplete tokenization, retained normalized text, unusable cancellation, or
an unexplained memory result. The operational review thresholds used to make
those conditions reproducible were:

- main-thread heartbeat gap below 250 ms;
- Stop acknowledgement below 1,000 ms;
- cached recalculation below 1,000 ms;
- exact retained compact arrays below 256 MiB;
- browser renderer RSS below 1.5 GiB on the recorded 16 GiB host.

## Results

Three permitted representations were built from the same six-token-per-record
Jieba output and queried across the same alternating sender selection.

| Representation | Cache build | Sender query | Exact compact bytes | Result |
| --- | ---: | ---: | ---: | --- |
| Token IDs + shared token table | 28.75 ms | 5.14 ms | 31,000,045 | selected |
| Metadata + repeated token-offset byte pool | 332.72 ms | 271.69 ms | 72,000,008 | rejected |
| 20 partitioned token-ID caches | 56.60 ms | 46.03 ms | 31,000,900 | rejected |

Additional measured evidence:

- 132,120,486 bytes read and SHA-256 digested in 93.33 ms
  (1,350.05 MiB/s);
- Jieba initialized in 34.33 ms;
- 1,000,000 real `cut(text, false)` calls completed in 3,831.02 ms;
- the full large profiling operation completed in 4,505.01 ms;
- Worker Stop was acknowledged in 35.13 ms at a cooperative checkpoint;
- a fresh Worker completed the 5,000-record restart run in 180.13 ms;
- the largest main-thread 10 ms heartbeat delay was 1.83 ms;
- the conservative peak Chromium renderer RSS was 450,288 KiB and the peak
  Chromium process-tree RSS was 613,152 KiB while all three comparison caches
  were constructed;
- the profiling page produced zero console errors.

Chrome exposed `performance.measureUserAgentSpecificMemory` but refused the
measurement in this headless context. Peak Worker heap therefore was not
separately observable. The profile records exact retained typed-array and
UTF-8 table payload bytes, while renderer RSS is a conservative upper bound
that also includes the page, WASM, browser runtime, and temporary comparison
caches. Production browser tests additionally verify Worker termination and
that no candidate cache remains after Stop or replacement.

## Rejected alternatives

The repeated token-offset byte pool duplicates UTF-8 bytes for every token
occurrence. It used 2.32 times the selected compact payload and made the same
query about 52.9 times slower because aggregation had to decode occurrences.

Partitioning kept compact payload bytes close to the selected representation,
but repeated token tables and required a merge across every partition. The
same query was about 9 times slower. The measured selected cache is small
enough that partitioning provides no compensating safety benefit at the
supported record boundary.

A reduced supported limit is not selected: the large input, record-boundary
tokenization, cancellation, restart, responsiveness, and conservative memory
envelope all passed.

## Production constraints

The production Worker must:

- tokenize each accepted record exactly once;
- assign token IDs through one construction-only map;
- append token IDs to compact typed-array storage without retaining normalized
  text, then release the construction map before the initial aggregate;
- retain sender and date metadata in typed arrays;
- release each verified chunk text and buffer before loading the next;
- discard the whole candidate cache on validation failure, cancellation,
  replacement, Worker termination, or component unmount;
- reuse the cache for sender, date, minimum-frequency, and maximum-word
  changes;
- never move complete-dataset parsing, tokenization, or aggregation to the
  main thread.
