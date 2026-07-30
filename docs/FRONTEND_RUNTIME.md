# Frontend runtime boundary

Stage 1B provides a minimal React/TypeScript/Vite infrastructure shell under
`frontend/`. It contains only synthetic Worker/WASM and ECharts word-cloud
probes. It does not import chat files or implement normalization, filtering,
frequency analysis, or a business UI.

## Supported local toolchain

- Node.js: `^20.19.0`, `^22.13.0`, or `>=24.0.0`
- npm: `>=10.0.0,<12.0.0`
- package manager recorded by the project: `npm@11.16.0`

The repository does not install or change Node/npm globally. For direct
terminal development, install the exact lockfile locally:

```bash
cd frontend
PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm ci
```

The authoritative lockfile uses the public npm registry baseline. A user in a
region that requires a mirror may configure npm for that invocation or in
their own environment; the project does not modify global npm configuration
and does not force a mirror.

Development and preview bind only explicit loopback addresses:

```bash
npm run dev
npm run build
npm run preview
```

The required verification commands are:

```bash
npm run type-check
npm run lint
npm run test
npm run test:browser:install
npm run test:browser:dev
npm run test:browser:preview
```

`test:browser:install` installs only the Chromium revision selected by the
locked `@playwright/test` version. Ordinary application users do not need this
browser. Contributors and clean CI environments run the install script once
before browser tests. Browser binaries live in Playwright's local user cache
and are not committed. The tests use Playwright-managed Chromium, no system
Chrome channel or profile, and block every non-loopback HTTP(S) or WebSocket
request. Where the default CDN is slow, Playwright's documented
`PLAYWRIGHT_DOWNLOAD_HOST` environment variable may point one invocation at a
compatible artifact mirror; this does not change the lockfile or application
runtime.

## Finder launch and stop

Double-click `Start Chat Analysis.command` in Finder. It resolves the canonical
repository from the real command location and validates Node, npm,
`package.json`, and `package-lock.json`. If `node_modules`, the local Vite
entry, or another critical direct dependency is missing, it automatically runs
`npm ci --no-audit --no-fund` in `frontend/`. This first-use installation may
use the configured npm registry; it is distinct from the offline application
runtime. Installation failure starts no preview, opens no browser, and
publishes no valid state. A complete dependency tree skips `npm ci`.

After dependencies are complete, Start builds the static app and launches
`frontend/scripts/preview-launcher.mjs`. The launcher uses Vite's Node API
inside the actual recorded Node PID at `http://127.0.0.1:4173`; there is no npm
wrapper or unstable child PID. It opens the default browser only after
readiness and secure state publication.

Every new instance receives a 256-bit random nonce. The ignored runtime
directory is a non-symlink, current-user-owned `0700` directory under the
canonical project root. The helper creates unique `0600` identity and log files
with exclusive no-follow semantics. The launcher holds both its own source
file and the identity inode open throughout the server lifetime. State and PID
files are written through random `0600` temporary files and atomic rename.
Runtime symlinks, wrong types/owners/modes, unsafe containment, duplicate or
unknown state fields, and malformed values are rejected.

Double-click `Stop Chat Analysis.command` to stop it. Stop requires the PID file
and strict state file to agree. Before TERM it verifies the full process start
fingerprint, the actual executable reported for the PID, the exact full
launcher command, nonce and structured arguments, and matching device/inode
records for the launcher and identity descriptors reported open by that one
PID. It performs the full verification again before any bounded KILL.
Argv-like Vite substrings, a reused PID, a replaced identity path, or another
Node process are insufficient and are refused without a signal. Stale state is
cleaned only after the recorded PID is absent. Neither script performs a global
process-name or port-owner kill.

`frontend/public/THIRD_PARTY_NOTICES.txt` contains the embedded-dictionary and
bundled-code notices. Vite copies it byte-for-byte to
`dist/THIRD_PARTY_NOTICES.txt`; the shell exposes a same-origin local link.

Direct `file://`, public binding, remote runtime assets, Electron/Tauri, and a
business server are outside the supported model.
