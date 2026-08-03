# Stage 11 macOS arm64 application and DMG prototype evidence

This record covers the Eleventh Luna Max productization batch on 2026-08-03.
The result is a local macOS arm64 application and DMG prototype. All package
and runtime fixtures are synthetic. No real chat export was opened, read,
enumerated, or used.

## Baseline and boundary

The implementation started from the required clean baseline:

- branch: `feat/implement-local-chat-wordcloud-mvp`
- `HEAD`: `a40c83e9fe5f0250d9437a2737e170edb39491b5`
- worktree: clean before implementation
- upstream divergence: `0 0`
- privacy check: `git check-ignore -v data/private` matched the repository
  ignore rule

The only private-data-related operation was that allowed ignore check. The
directory itself was never listed, searched, opened, or traversed.

Stage 11 is limited to tasks 11.1–11.7. Stage 12 and D.1–D.10 remain
unchecked. Existing Stage 13.10 and Stage 15.10 were not run and were not
changed.

## Implemented package boundary

The source/configuration changes provide:

- `src-tauri/tauri.macos.conf.json` with an active app target, bundle name,
  bundle version, `com.chathistoryanalysis.desktop` identity, macOS 11.0
  minimum, no formal signing identity, and no hardened-runtime claim.
- `scripts/package_macos_prototype.py`, which supplies a generated target
  config mapping the target-built PyInstaller onedir sidecar to
  `Contents/Resources/chat-history-analysis-sidecar`.
- `icon.icns` plus the checked-in PNG placeholder used by the Tauri bundle;
  the Tauri build no longer creates an icon in `build.rs`.
- Cargo feature-gating for `synthetic-sidecar` and `synthetic-orphan`. The
  package command uses `--no-default-features --bin chat-history-analysis`,
  so only `Contents/MacOS/chat-history-analysis` is an app executable.
- Application cache resolution through Tauri's `app_cache_dir()`. The
  packaged sidecar is resolved from `resource_dir()` and its fixed resource
  directory; the release host has no checkout-relative Python fallback.

The accepted app contains the host executable, the bundle-relative sidecar,
`Info.plist`, and the icon. It does not contain source checkout files,
`node_modules`, the PyInstaller build environment, retained wheels, or
private-data material.

## Signing and trust evidence

The sidecar builder now signs its arm64 Mach-O members before calculating the
sidecar evidence manifest and fixed Alpha host anchor. The outer package then
verifies those existing sidecar signatures, signs the Rust host executable,
and signs the outer `.app` last. Each nested member and the outer app is
verified with strict ad-hoc codesign checks.

The final ignored package manifest was produced at:

`build/stage11/macos-arm64/package-20260803T163413Z/package-manifest.json`

It records:

- target `macOS/arm64`, minimum macOS `11.0`, bundle version `1`;
- 60 arm64-only Mach-O members;
- bundle-relative resource resolution;
- `ad-hoc` / nested-first signing;
- tampered-member rejection;
- wrong-architecture-member rejection;
- no Developer ID, notarization, or stapling claim.

This is still the existing Alpha fixed host-compiled trust anchor model. It
is not the independently signed release trust root in D.2.

## DMG prototype

The accepted app was copied into `Chat History Analysis Prototype.dmg` with
an `/Applications` symlink. `hdiutil verify` passed, the image mounted
read-only, the app copied to a clean-install destination, and the image
detached successfully.

The local prototype procedure is:

1. Mount the DMG and copy the app to a local Applications directory.
2. Launch the copied app from Finder, or use the app bundle executable for a
   deterministic command-line smoke.
3. Because the package is ad-hoc, has `hardenedRuntime: false`, and has no
   Developer ID/notarization ticket, macOS may show an unverified-developer or
   quarantine/Gatekeeper warning. A local prototype user may use the normal
   Finder **Open** confirmation or the permitted Privacy & Security approval
   for that local build. This procedure does not bypass Gatekeeper and does
   not claim release trust.

Quarantine behavior for a downloaded artifact, formal Gatekeeper acceptance,
notarization, stapling, and release signing remain D.6/D.7 work.

## Clean-user and offline evidence

The package script creates a fresh synthetic clean-user root with:

- `PATH=/usr/bin:/bin`;
- isolated `HOME`, `TMPDIR`, and a Unicode/space-containing working directory;
- no Python, Node.js, npm, Rust, source checkout, or network dependency in the
  child runtime;
- `sandbox-exec` with `deny network*` for synthetic preprocessing;
- an explicit synthetic scratch root so the read-only copied app never writes
  beside its bundle.

The final manifest reports `passed` for the Finder-equivalent app launch,
sidecar handshake, synthetic preprocessing, network blocking, isolated home,
isolated working directory, and full host close. The existing Rust and
frontend synthetic suites additionally cover selection, cancellation,
restart/replacement, cleanup, and export seams; no private input was used.

This is a local prototype clean-user check, not the clean-machine release
proof required by D.7. Packaged WebKit permission callbacks remain the D.1
boundary.

## Platform-neutrality and dependency review

`scripts/audit_stage11_platform_neutrality.py` passed over the shared
TypeScript contracts, Worker analytics, Python normalization, and Python
canonical event modules. No macOS-only path, signal, AppKit, WebKit, bundle,
or DMG assumption entered those shared modules. Windows remains a documented
future boundary; no Windows build or release claim was added.

The runtime sidecar dependency remains the pinned `ijson 3.5.1` arm64 wheel
with license expression `BSD-3-Clause AND ISC`, as documented in
`docs/PREPROCESSOR_RUNTIME.md`. The PyInstaller build inputs remain hash
locked in `requirements-sidecar-build.lock` and use the configured domestic
mirror. Retained build wheels and the virtual environment are outside the
app and DMG. A complete supply-chain/license release audit remains D.5.

## Verification matrix

| Area | Command/evidence | Result |
| --- | --- | --- |
| Package | `python3.12 scripts/package_macos_prototype.py` | app, DMG, negative checks, clean-user and offline smoke passed |
| Rust format | `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check` | passed |
| Rust unit/integration | `cargo test --manifest-path src-tauri/Cargo.toml --locked --lib --tests` | 60 library + 17 integration passed; 3 packaged-runtime tests intentionally ignored |
| Python package contracts | targeted sidecar, Tauri, Stage 3, and Stage 11 tests | 18 passed |
| Frontend | `npm --prefix frontend run type-check` | passed |
| Frontend lint | `npm --prefix frontend run lint` | passed |
| Frontend tests | `npm --prefix frontend run test` | 21 files / 138 tests passed |
| ACL | `python3 scripts/verify_tauri_acl.py` | passed with the intentional icon-config digest update |
| Shared boundary | `python3.12 scripts/audit_stage11_platform_neutrality.py` | `platform-neutrality=passed` |
| Diff hygiene | `git diff --check` and ignored-output checks | passed; `.app`, `.dmg`, target/dist/build outputs remain ignored |
| OpenSpec | normal/strict validation after checking 11.1–11.7 | passed |

The Vite build emitted the existing large-chunk advisory for the current
frontend bundle. It is recorded as a non-blocking pre-existing build warning;
this batch did not add a new runtime warning class.

## OpenSpec status and residuals

Tasks 11.1–11.7 are checked. OpenSpec is 83/102 complete. Stage 12 and D.1–
D.10 remain unchecked. This batch does not claim formal signing,
notarization, release Gatekeeper acceptance, Windows support, exhaustive
tamper/lifecycle proof, real-data validation, or clean-machine release
certification.

The next authorized scope is **Twelfth Luna Max productization implementation
batch**.
