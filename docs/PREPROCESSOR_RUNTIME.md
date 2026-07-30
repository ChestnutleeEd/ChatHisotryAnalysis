# Python preprocessor runtime boundary

Stage 1 supports exactly CPython 3.12.x on macOS arm64. Other Python
implementations, Python minors, operating systems, and architectures fail before
the Python 3.12 application import chain and before any raw source operation can
run.

The project wheel declares Python 3.9 or newer only so the installed
`chat-history-analysis` bootstrap entry point can execute on Apple Python 3.9
and return `UNSUPPORTED_PYTHON_RUNTIME`. This packaging compatibility is not an
expansion of the supported application runtime.

## Verified runtime dependency

The preprocessor has one runtime dependency:

| Package | Version | Official artifact | Wheel tag | SHA-256 | License |
| --- | --- | --- | --- | --- | --- |
| `ijson` | `3.5.1` | `ijson-3.5.1-cp312-cp312-macosx_11_0_arm64.whl` | `cp312-cp312-macosx_11_0_arm64` | `b9517efbe6604bce16f3e50d49b0cd1bdc58917f98cf2eab026599c5c0422991` | `BSD-3-Clause AND ISC` |

The version, filename, tag, SHA-256, absence of runtime dependencies, and
license expression were verified against the official PyPI release metadata
and wheel. The wheel contains the native `yajl2_c` extension.

Authoritative sources:

- <https://pypi.org/pypi/ijson/3.5.1/json>
- <https://github.com/ICRAR/ijson/blob/v3.5.1/LICENSE.txt>

## Trusted bootstrap

`scripts/bootstrap_preprocessor.py` runs only on the approved runtime tuple. It
either downloads the one hard-coded official artifact or accepts an explicit
file whose basename is the exact approved filename. Before installation it:

1. rejects symlinks and non-regular inputs;
2. recomputes the archive SHA-256;
3. verifies the ZIP structure, distribution name, version, license expression,
   exact wheel tag, non-purelib status, and required native member;
4. retains an exact copy at the deterministic
   `sys.prefix/share/chat-history-analysis/` location;
5. installs only that retained local archive through an isolated
   `python -I -m pip --isolated` subprocess with dependency resolution, index
   access, configuration files, caches, and interactive input disabled;
6. runs the production installed-distribution, native-backend, and positive and
   negative parser readiness verifiers before reporting success.

The bootstrap refuses a virtual environment inside the repository. It never
uses an environment variable or installer cache as the evidence location. The
pip child receives a new minimal environment: caller `PYTHON*` and `PIP_*`
values cannot replace pip, select user configuration, or redirect installation
through a target, prefix, root, or user site. Normal runtime code performs no
download or network operation.

## Reproducible wheel installation

Run these commands from a clean source copy outside the repository. The
placeholders denote directories chosen outside that source copy; they are not
machine-specific required paths.

```bash
python3.12 -m venv <external-venv>

<external-venv>/bin/python -m pip install \
  --require-hashes \
  --no-deps \
  -r requirements-build.lock

mkdir <download-directory> <wheel-directory>

<external-venv>/bin/python -m pip download \
  --require-hashes \
  --no-deps \
  --only-binary=:all: \
  --dest <download-directory> \
  -r requirements-preprocessor.lock

<external-venv>/bin/python -I scripts/bootstrap_preprocessor.py \
  --wheel <download-directory>/ijson-3.5.1-cp312-cp312-macosx_11_0_arm64.whl

<external-venv>/bin/python -m pip wheel \
  --no-deps \
  --no-build-isolation \
  --wheel-dir <wheel-directory> \
  .

<external-venv>/bin/python -m pip install \
  --no-deps \
  --no-index \
  --force-reinstall \
  <wheel-directory>/chat_history_analysis-0.1.0-py3-none-any.whl

<external-venv>/bin/chat-history-analysis startup-check
```

`requirements-build.lock` pins the official `pip 25.1.1` and
`setuptools 80.9.0` wheels by exact URL and SHA-256. Both have no required
transitive dependencies in this workflow. Build isolation is disabled only
after that boundary is installed. The runtime wheel and project wheel are
installed locally with dependency resolution and index access disabled. The
console command does not rely on `PYTHONPATH` or an editable installation.
Every direct URL lock entry has exactly one authoritative `--hash` value; URL
fragments do not provide an alternative accepted digest.

## Runtime provenance and installed-byte verification

The retained archive is the trust root. Every startup:

- derives its evidence path from `sys.prefix`;
- rejects missing, symlinked, non-regular, renamed, or hash-mismatched evidence;
- reopens the verified wheel and derives a manifest directly from every
  `ijson/` wheel member;
- compares every installed package file by size and SHA-256;
- separately requires the native
  `backends/_yajl2.cpython-312-darwin.so` bytes to match;
- rejects missing, changed, symlinked, non-regular, or unexpected package
  files and directories.

The only installation-generated package-tree allowance is CPython 3.12
bytecode in an expected `__pycache__` directory, with a basename corresponding
to a trusted wheel Python source. Bytecode is not provenance evidence.
Dist-info files such as `INSTALLER`, `REQUESTED`, `direct_url.json`, and
`RECORD` may exist, but installed `METADATA`, `WHEEL`, `RECORD`,
`direct_url.json`, `ijson.__version__`, inferred filenames, cache paths, and
environment variables are never trust roots.

## Backend and parser self-check

Only explicit `ijson.backends.yajl2_c` is accepted. Startup also requires:

- the package-selected parser to be the same native parser;
- backend Python, native extension, and parser error module origins to be the
  verified installation;
- `IJSON_BACKEND` or any other automatic selection not to substitute another
  backend.

The self-check uses binary in-memory inputs and fully consumes every iterator
with `use_float=False`, `multiple_values=False`, `allow_comments=False`, and
`buf_size=65536`.

The positive document is `{"ready":[1]}` and must produce the exact map, key,
array, integer, and closing event sequence. These negative documents must each
raise the trusted ijson parser error category:

- incomplete JSON;
- JSON containing a comment;
- two top-level JSON values.

Unexpected acceptance or any different exception category becomes
`IJSON_PARSER_INITIALIZATION_FAILED`.

## Production gate and privacy

The public console entry point has no gate-injection parameter. It enters the
single production composition root, which runs:

```text
startup gate -> authorization capability -> source-operation continuation
```

Authorization cannot be constructed by an ordinary caller. A continuation is
called exactly once after every gate succeeds and never from an error or
`finally` path. The verified `BackendEvidence` is carried through that
authorization into the sole production streaming composition; raw parsing
cannot select a second backend or bypass the gate.

Stable startup failures are:

- `UNSUPPORTED_PYTHON_RUNTIME`
- `IJSON_DISTRIBUTION_UNVERIFIED`
- `IJSON_BACKEND_UNAVAILABLE`
- `IJSON_BACKEND_MISMATCH`
- `IJSON_PARSER_INITIALIZATION_FAILED`

User-visible startup failures contain only the fixed category, phase, and
stable reason code. They do not include retained archive paths, package paths,
member names, local hashes, URLs, parser excerpts, raw exceptions, or
tracebacks.

## Stages 2–6 preprocessing boundary

After startup and metadata-only input preflight, `preprocess` performs these
bounded passes over each explicitly selected source:

1. binary SHA-256 plus strict incremental UTF-8 validation in 65,536-byte
   blocks; a UTF-8 BOM is outside the supported export boundary and is rejected;
2. one `ijson.backends.yajl2_c.parse` validation/range stream with
   `use_float=False`, `multiple_values=False`, `allow_comments=False`, and
   `buf_size=65536`, while recomputing the source hash;
3. after annual ranges determine final rank, one ranked annual staging stream
   and one separate verification stream, again recomputing the source hash.
4. immediately before final promotion, one binary digest/UTF-8/file-identity
   pass over every annual and verification source, compared with pass-one
   evidence.

The event adapter accepts one object root with object `exportInfo`, object
`session`, array `messages`, exact `exportInfo.format=detailed-json`, and exact
private discriminators. It retains selected small metadata and only one
message object at a time. Every message must provide a signed-64-bit integer
`createTime` and a bounded non-empty `senderUsername`; the observed participant
set must equal the session owner/peer set. File names never define time range
or order.

The first pass records content SHA-256, byte size, device, and inode. Every
later pass checks the opened descriptor and post-pass path identity plus byte
count and SHA-256. A changed, replaced, truncated, or extended source fails
closed. The staging consumer has distinct annual and verification methods, so
verification records cannot enter annual staging. Any staging-pass failure
calls `abort` before returning.

The aggregate raw-message counter is shared across annual and verification
validation streams. It accepts exactly 2,000,000 entries and raises before
advancing beyond the event that starts entry 2,000,001. Production always uses
that fixed limit; tests exercise the same counter with synthetic iterators and
smaller limits.

The Stage 3 result contains only validated/ranked descriptors: fixed role and
ordinal, byte size, source SHA-256, raw message count, actual minimum/maximum
time, final annual rank, and a lowercase SHA-256 conversation fingerprint.
Session serialization uses the versioned
`ChatHistoryAnalysis/conversation-fingerprint/v1` domain, unsigned 64-bit
big-endian byte-length prefixes, canonical private status, owner/peer fields,
and the sorted participant set. Identity components and raw message objects are
discarded; production stdout does not print hashes or fingerprints.

Stage 4 classifies and minimizes one message at a time. Only the exact text
conjunction enters Stage 5; sender scope and UTC+08:00 time are canonical, URL
spans are removed from mixed text, and structured/non-text/raw fields never
cross the staging boundary.

Stage 5 stores eligible annual records in one owner-only, same-filesystem
SQLite sibling with the exact ten-column schema and verified
`DELETE`/`MEMORY`/`secure_delete=ON`/zero-timeout policy. It computes
domain-separated SHA-256 identities plus independent 16-byte BLAKE2b
verifiers, rejects collisions, keeps the lowest rank/index duplicate survivor,
and compares overlap-verification records without adding them to output.

Stage 6 streams canonical records from SQLite into bounded compact UTF-8/LF
NDJSON chunks, writes the deterministic manifest, re-reads and verifies every
candidate byte, removes all non-output entries, and performs one exclusive
same-filesystem directory rename. The destination must be absent. Schema,
limits, permissions, recovery, and standalone verification are specified in
[Normalized local dataset](NORMALIZED_DATASET.md).

Stage 7 extends this same production composition with one cooperative operation
control. It does not add a test-only parser or parallel execution entry.
`preprocess` stdout is NDJSON: zero or more fixed-shape progress objects followed
by one success object. stderr remains empty on success; failure or cancellation
emits exactly one content-free JSON object there. Progress percentages are
monotonic over fixed ranges for startup, input preflight, source digest, source
validation, session validation, ranked staging, SQLite commit, serialization,
disk/input re-verification, and atomic promotion. Source progress contains only
the fixed role and supplied ordinal. Its counts are aggregate phase work units;
fixed percentage boundaries avoid encoding message text length or content.

The SIGINT handler only sets an idempotent cancellation flag. Production checks
it before or after bounded reads, between parser events, after complete SQLite
statements, between complete normalized-record writes, between disk-validation
lines, and between explicit pre-promotion cleanup entries. A handled
cancellation rolls back/closes SQLite, closes open files, removes each staging
entry explicitly, leaves sources unchanged, leaves an absent destination absent,
and returns exit code `130` with `USER_CANCELLED`. Repeated SIGINT has the same
outcome and never injects `KeyboardInterrupt` or a traceback.

The exclusive directory rename has one commit boundary. Cancellation observed
before that boundary prevents promotion and cleans staging. Once the boundary is
entered, the already verified atomic rename is allowed to finish and the command
reports success; it never reports cancellation for a newly published complete
dataset and never exposes a valid partial dataset. Cleanup failure remains a
content-free output failure and leaves only recognized recovery state.

## Stable CLI failure classification

The single `ExitCode` definition is:

| Code | Category | Examples |
| ---: | --- | --- |
| `2` | `startup` | runtime, distribution, backend, parser self-check |
| `64` | `argument` | missing/unknown CLI arguments |
| `65` | `input-validation` | unreadable source, UTF-8/JSON/schema/session/mutation failure |
| `66` | `ignore-policy` | unsafe, tracked, unignored, or unverifiable output target |
| `67` | `capacity` | raw file/count/aggregate byte or aggregate message limit |
| `68` | `output` | SQLite, write, flush, integrity, cleanup, or promotion failure |
| `69` | `verification` | invalid or unverifiable overlap input |
| `130` | `cancellation` | safe user cancellation |

Argument, input-validation, ignore-policy, and capacity codes are distinct and
do not reuse the existing startup status. Every caught internal exception is
translated to a fixed project reason. Failure JSON never contains a source or
output path, basename, participant value, message body, JSON fragment, URL,
individual hash, injected exception text, or traceback.

## Full integration validation

On macOS arm64, run:

```bash
scripts/run_trusted_integration.sh
```

The runner creates a temporary APFS disk image outside the repository, copies
only project source and locks into it, creates isolated CPython 3.12, Apple
Python 3.9, and CPython 3.13 virtual environments, performs the complete
hash-pinned build and trusted bootstrap, exercises the installed console and
actual native backend, then detaches the image and removes that one image file.
It uses no recursive deletion and leaves no virtual environment, wheel,
retained evidence, cache, or build output in the repository.
