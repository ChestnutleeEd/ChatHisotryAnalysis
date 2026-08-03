# Stage 10 Alpha synthetic evidence

This record covers the Tenth Luna Max Stage 10 security-correction batch on
2026-08-03. Stage 10.1–10.7 is complete under the frozen local macOS Alpha
boundary. All fixtures and stress data are synthetic. No real chat export,
`data/private`, Stage 13.10, or Stage 15.10 material was accessed or used.

## Alpha boundary correction

Protected assets are selected raw JSON, canonical dataset and SQLite staging,
aggregate results, explicit export output, owner-only session/cache storage,
the fixed-digest Alpha sidecar, dataset transport, structured logs, and host
session/generation/result capabilities.

Trusted components are the Rust/Tauri host, host-owned registries and
`SecureStorage`, the fixed-digest Alpha sidecar, and native operating-system
open/save dialogs. The renderer/UI, analytics Worker, and every message
between them are one untrusted frontend domain. The host does not claim to
prove Worker-vs-renderer caller identity. It accepts no path, filename, body,
arbitrary string, arbitrary schema, or arbitrary export payload; it accepts
only a closed, runtime-validated numeric aggregate DTO bound to window,
session, generation, dataset, canonical query, and analytics contract.

Accepted residuals are the macOS PID/PGID reuse window between identity
validation and a signal syscall, formal race freedom against a fully malicious
same-UID process, renderer/Worker indistinguishability after renderer
compromise, and OS/kernel/filesystem/WebKit vulnerabilities. These are not
Alpha blockers. Packaged WKWebView/runtime permissions map to D.1; exhaustive
storage/tamper combinations to D.3; exhaustive lifecycle,
crash/disconnect/reuse evidence to D.4; exhaustive IPC/capability conformance
to D.8; and formal capacity/performance/resource certification to D.9.

## Implemented controls

- The host owns the closed `chat-analysis-export.v2` schema, methodology,
  timezone, filter labels, metric order, and date labels. Renderer input is a
  bounded numeric aggregate only: no text, path, body, keyword, participant,
  renderer snapshot, or generic dimensions cross the commit seam.
- Result export uses a host registry with opaque result IDs, revocation epoch,
  per-export token, pending/commit states, and revalidation before dialog,
  render, temporary-file creation, write, fsync, and rename. A stale fence
  leaves the old destination unchanged and removes the temporary file.
- The production sidecar lifecycle is Ready → Preprocessing → Handoff →
  Analyzing; only a host-bound Worker lease can commit the exact aggregate and
  transition to Complete. CloseRequested, app quit, reload, cancellation,
  replacement, and discard cancel the Worker and sidecar through the host.
- Owner records are content-free and contain PID/PGID, start and executable
  fingerprints, session/generation/nonce, and state versions. Startup recovery
  cleans only an identity-matching owned orphan; mismatches remain untouched.
- SecureStorage pins the application and `analysis-sessions` descriptors,
  performs descriptor-relative fixed-identity mutation, rejects symlink,
  hard-link, mode, type, traversal, and inode swaps, and retains cleanup
  failures as secondary errors.
- CleanupCoordinator is panic-safe, single-flight, retryable, and bounded.
  Production correlation IDs are random, short-lived, non-persistent, and
  never derived from content or paths.
- PNG export is a fixed-size opaque host-rendered chart with a visible footer
  containing only approved timezone/date/filter/threshold/chart/methodology
  fields and no ancillary text metadata.

## Synthetic test matrix

| Area | Evidence | Result |
| --- | --- | --- |
| Storage | `secure_storage::tests::adversarial_storage_matrix_is_fail_closed_and_preserves_targets` | adversarial hardlink, symlink, mode, and type cases preserve targets |
| Storage | `secure_storage::tests::pinned_sessions_descriptor_survives_path_swap_without_touching_replacement` | pinned descriptor is used after a path replacement |
| Recovery | `secure_storage::tests::owner_record_is_exact_and_live_mismatch_is_left_untouched` | exact owner record and live identity mismatch are fail-closed |
| Lifecycle | `lifecycle::tests::owner_panic_wakes_waiter_and_allows_deterministic_retry` and 100-retry stress | panic does not strand waiters or poison retry |
| Result registry | `analytics_results::tests::*` | host minting, pending, revocation epoch, stale token, and single-flight export |
| Export fence | `export::tests::revoked_save_fence_preserves_existing_destination_and_temp_free_state` | all four save fences preserve destination and cleanup temp state |
| Export contract | `export_schema::tests::*`, `export::tests::*` | exact JSON/CSV shape, formula-prefix escaping, fixed opaque PNG/footer |
| Supervisor | `stage10_production_representative_sidecar_registry_export_stress_is_bounded` | 128 real compiled synthetic sidecars traverse registry/export/storage cleanup |
| Worker | `frontend/tests/desktop-worker-handler.test.ts` production-generation test | 128 sequential real Worker generations stay bounded and marker-free |
| Shared IPC | Rust and TypeScript vector suites | prepare/commit/cancel/export vectors agree and reject tampering |
| Query binding | `ipc::tests::worker_capability_identity_and_expiry_matrix_fails_closed` plus frontend contract tests | canonical dataset/generation/filter/version identity is required; a valid but mismatched aggregate query is rejected at host commit |
| Export commit point | `secure_storage::tests::parent_sync_failure_reports_uncertain_after_atomic_publish` and export fence tests | rename is the commit point; post-rename parent fsync returns `EXPORT_DURABILITY_UNCERTAIN` without deleting the final |
| Orphan signal | real synthetic orphan and sidecar-group integration tests | each INT/TERM/KILL stage revalidates PID/PGID/start/executable/nonce/session/generation; mismatch leaves residue untouched |
| Privacy | frontend privacy/log tests | remote resources and sensitive-string injection do not reach logs/UI/snapshots |
| Desktop host target | Tauri no-bundle build plus Cargo target inspection | `/Users/chestnut/Projects/ChatHisotryAnalysis/src-tauri/target/release/chat-history-analysis` is the desktop host; `synthetic-sidecar` and `synthetic-orphan` are helper binaries |
| Desktop runtime smoke | release host startup followed by an explicit TERM after initialization | host initialized and exited with expected signal status; no dialog, source, export, or residual host/helper process was involved |

## Verification run

The following final commands passed on 2026-08-03:

- `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`
- `cargo check --manifest-path src-tauri/Cargo.toml --locked`
- `cargo test --manifest-path src-tauri/Cargo.toml --locked --lib --tests` —
  three consecutive runs; each had 60 Rust library tests passed, 3
  packaged-runtime tests ignored, and 17 integration tests passed. No SIGABRT,
  hang, orphan, or residual synthetic process remained.
- `cargo build --manifest-path src-tauri/Cargo.toml --release --locked`
- `cargo clippy --manifest-path src-tauri/Cargo.toml --locked` — passed with
  non-fatal lint warnings.
- `npm --prefix frontend run type-check`, `lint`, `build`, and `test` — 21
  files and 138 tests passed.
- `npm --prefix frontend run test:browser:dev` and `test:browser:preview` —
  4 tests passed in each mode.
- `python3 scripts/verify_tauri_acl.py`
- `PATH="/Users/chestnut/.cargo/bin:$PATH" npm --prefix frontend exec -- tauri build --no-bundle --ci`
- release desktop host startup/close smoke for
  `target/release/chat-history-analysis`; the expected TERM exit was observed
  and the process check was empty.
- targeted and full normal/strict OpenSpec validation — all 2 changes passed;
  the productize change artifacts are complete.
- `git diff --check` and the allowed `git check-ignore -v data/private` check;
  no private or generated artifact is part of the reviewed source diff.

The three ignored Rust tests require a packaged AppKit runtime or a clean
Alpha sidecar bundle path; they are not converted into a security claim here.

## Scope and residuals

OpenSpec is at 76/102 completed tasks. Tasks 10.1–10.7 are checked, with 10.6
using the exact label `Stage 10 privacy and threat-model acceptance gate`;
Stage 11–12 and D.1–D.10 remain unchecked. Stage 13.10 and Stage 15.10 were
not changed or executed. This evidence does not claim Sol High review,
forensic erasure, formal signing/notarization, clean-machine release proof, or
real-data validation. The only private-data check is the allowed
`git check-ignore -v data/private` command. The final Git commit/push is the
Stage 10 handoff; no Stage 11 implementation is included.
