# Stage 3 sidecar and process supervision

This document records the production boundary implemented by OpenSpec Stage 3
of `productize-local-chat-analysis-desktop`. It covers the packaged Python
sidecar, the development/packaged startup parity, and the Rust-owned
sidecar/session lifecycle. Native file selection, the renderer handoff, the
analytics Worker implementation, and the dashboard remain Stage 4+ work.

## Sidecar build and evidence

The production entrypoint is
`scripts/sidecar/sidecar_entry.py`. It accepts only the fixed `sidecar` mode
for production preprocessing; the probe-only arguments are routed to the
synthetic frozen probe. PyInstaller builds a target-native macOS arm64
`onedir` bundle with the hash-locked inputs in
`requirements-sidecar-build.lock` and no runtime package installation or
network access.

Each clean build emits `sidecar-evidence.json` containing the target triple,
Python/PyInstaller/preprocessor/ijson versions, source and input digests,
every bundle member's size/hash, parser and production probes, a bundle Merkle
root, and a self-digest. The host embeds the separately committed
`src-tauri/resources/sidecar-trust-anchor.json`; the evidence and bundle are
accepted only when both roots and every declared input match.

To reproduce the Stage 3 gate on a supported machine, use two new output
directories under the ignored `build/` directory:

```text
python3.12 scripts/build_sidecar_spike.py \
  --output-dir build/stage3-build-a \
  --refresh-trust-anchor
python3.12 scripts/build_sidecar_spike.py \
  --output-dir build/stage3-build-b
```

The first command is the explicit trust-anchor refresh for a newly reviewed
bundle. The second command verifies the committed anchor without modifying
source. Compare the two `sidecar-evidence.json` files and executable hashes;
only build-container metadata that is explicitly excluded from declared
evidence may differ.

The declared source revision is the revision that produced the bundle. A
metadata-only commit that updates the host anchor does not change that
revision; the normal second build reads it from the committed anchor. This
keeps the evidence stable while still requiring an explicit
`--refresh-trust-anchor` for a newly reviewed source build.

## Frozen startup gate

The frozen gate runs before the production composition can open a selected
source. It verifies executable containment and regular-file identity,
`macos-arm64`, the exact evidence schema, target/runtime/native member hashes,
the embedded `yajl2_c` backend and native extension origin, and positive and
negative parser probes. Any missing, mutated, symlinked, or wrong-architecture
member fails with a stable content-free startup error. Development mode uses
the installed CPython 3.12 gate and then enters the same preprocessing
composition.

## Rust supervisor

`src-tauri/src/session_supervisor.rs` is the only owner of session IDs,
monotonic generations, private selection authority, child identity, process
group, stdin/stdout/stderr, protocol parsing, cancellation deadlines, and
cleanup status. It enforces one live generation and the explicit lifecycle:

```text
idle -> selecting -> ready -> preprocessing -> handoff -> analyzing -> complete
                         \-> cancelling -> failed/discarding/closing
```

The sidecar is spawned directly with fixed arguments and a fixed environment;
no shell, `PATH` lookup, private argv, raw child output, or renderer process
capability is used. Configuration is one bounded big-endian length-prefixed
UTF-8 JSON frame on stdin. Stdout accepts only bounded exact NDJSON progress
and one result; stderr accepts only one structured failure line. Paths,
content, hashes, and child exceptions never enter snapshots or public failure
strings.

On macOS the child becomes a new process group with `pgid == pid`. Every
escalation revalidates PID liveness, start fingerprint, canonical executable,
nonce from the live process environment, and process group before targeted
signals. Cancellation requests the optional host Worker hook and SIGINT, then
closes stdin, revalidates for TERM, and finally revalidates for KILL. Window
disconnect and application exit use the same bounded close path.

Cleanup is entry-by-entry and allow-listed. It rejects symlinks, unexpected
types, ownership/mode mismatches, unknown names, and unsafe containment; such
remnants are preserved and exposed only as `CLEANUP_REQUIRED`.

## Synthetic lifecycle coverage

The Rust integration fixture is `src-tauri/src/bin/synthetic-sidecar.rs`. It
uses fabricated protocol input only and is not bundled into the production
Tauri application. Tests cover successful mapping, malformed and excessive
protocol classes, structured stderr, crash/no-terminal behavior, process-group
descendant termination, Worker cancellation hooks, stale window/generation,
replacement, retry, renderer disconnect, and explicit unsafe-remnant cleanup
retry.

## Sol xHigh Stage 3 stop-gate audit

The Stage 3 audit is closed for the supported macOS arm64 target: the frozen
gate has source-unopened mutation/missing/wrong-architecture sentinels; spawn
is direct and path-free; stdout/stderr are bounded and content-free; process
identity is revalidated before escalation; parent EOF and app/window close use
the same cancellation path; and the real-process suite confirms descendant
termination. Stage 4 selection, Worker handoff, and dashboard integration stay
blocked by scope rather than being claimed here.
