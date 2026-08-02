# Desktop local analysis: Stage 4

Stage 4 adds the one-click Tauri path for synthetic/local development and
packaged sidecar runs. The browser-only v1 entry remains unchanged: browser
users still select an explicit normalized dataset and the existing Worker
continues to own that flow.

## Host-owned source selection

On macOS, the desktop renderer invokes two native `NSOpenPanel` actions:
annual sources are required and verification sources are optional and shown
as a separate role. The host validates regular owner-readable JSON files,
rejects unsupported/unreadable/duplicate selections, and keeps paths in a
Rust-only registry. Renderer events contain only a random `sel_...` identifier
and the two source counts. Cancelling the native panel is a no-op. No session
directory is created until Start succeeds.

The desktop UI never renders a source name, path, basename, raw content,
session directory, child command, or process identity. The Tauri command set
contains only the versioned selection/session lifecycle operations already
listed in `contracts/desktop-ipc-v1.vectors.json`.

## Session and sidecar boundary

Start resolves Tauri's application cache directory and creates one owner-only
`analysis-sessions/ses_<opaque-id>` directory. On Unix, the session and
`normalized` directory use `0700`; marker/state, manifest, and chunk files use
`0600`. The session marker and generation-bound state are written before the
sidecar starts. The normalized destination is absent at that point, and the
host performs a conservative free-space preflight before creating private
state.

The sidecar is launched directly with fixed host-owned arguments. The selected
annual and verification paths, cache root, normalized destination, and nonce
travel only in one bounded length-prefixed stdin configuration. They do not
appear in argv, stdout, stderr, progress, result events, or renderer errors.
The production and development paths use the same canonical-event-v2
composition; the synthetic Rust sidecar is test-only and is never bundled.

## Verified opaque handoff

After a successful sidecar terminal result, Rust independently checks the
session marker/state, owner/mode/type, exact normalized file set, containment,
manifest schema and limits, chunk sizes/hashes/order, canonical event fields,
UTC+08:00 dates, privacy declaration, and aggregate reconciliation. Only then
does it mint the opaque `dat_...` dataset capability and `res_...` result ID.

The Worker transport accepts only the active window, session, generation,
dataset capability, manifest, and the next manifest-declared ordinal. It has
no path, listing, write, query, redirect, or network operation. A verified
dataset stays available in the host registry until its session closes, so a
Worker restart can reopen the same verified bytes. Session replacement,
application close, renderer reload, and window destruction remove the session
transport and validated temporary entries entry by entry.

## Lifecycle and recovery

The host supervisor owns one live generation. User cancellation requests the
sidecar/Worker cancellation path and escalates only after identity revalidation;
replacement enters a cancelling state and closes the old generation; retry
requires a failed, clean generation and creates a fresh opaque destination.
Normal completion retains the verified temporary dataset only for the current
session so Worker restart remains possible. Full quit removes it.

At startup, only direct children of the application-owned session root are
inspected. Exact owner-only marker/state sessions are cleaned individually;
unknown, malformed, symlinked, wrong-owner, or unsafe entries are left
untouched and set a content-free cleanup-required flag. No recursive delete or
forensic-erasure claim is used. While that flag remains, the native selection
and Start commands retry the same bounded recovery check and refuse to create a
session with the stable `CLEANUP_REQUIRED` category; the desktop retry action
routes back through that check without exposing a path or requiring terminal
cleanup.

Stage 4 intentionally does not add the full analytics dashboard, aggregate
export implementation, codesigning/notarization/DMG/Windows packaging, or
real-data acceptance. Those remain later OpenSpec stages.

## Synthetic verification

From the repository root:

```bash
/Users/chestnut/.cargo/bin/cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
/Users/chestnut/.cargo/bin/cargo test --manifest-path src-tauri/Cargo.toml --lib --tests
PYTHONPATH=src /opt/anaconda3/bin/python3.12 -m unittest discover -s tests -v
cd frontend
npm run type-check
npm run lint
npm test -- --run
npm run test:browser:dev
npm run test:browser:preview
cd ..
openspec validate productize-local-chat-analysis-desktop --type change --strict --no-interactive
```

All desktop fixtures use fabricated source paths/content. Real chat exports
must not be used for this matrix.
