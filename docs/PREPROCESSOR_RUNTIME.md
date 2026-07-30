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
`finally` path. Stage 1 implements no raw-source parsing.

Stable startup failures are:

- `UNSUPPORTED_PYTHON_RUNTIME`
- `IJSON_DISTRIBUTION_UNVERIFIED`
- `IJSON_BACKEND_UNAVAILABLE`
- `IJSON_BACKEND_MISMATCH`
- `IJSON_PARSER_INITIALIZATION_FAILED`

User-visible failures contain only the phase and stable reason code. They do
not include retained archive paths, package paths, member names, local hashes,
URLs, parser excerpts, raw exceptions, or tracebacks.

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
