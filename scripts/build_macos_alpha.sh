#!/bin/zsh

set -euo pipefail
umask 077

PROJECT_ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd -P)"
PYTHON312="${CHAT_HISTORY_ANALYSIS_PYTHON312:-/opt/anaconda3/bin/python3.12}"

fail() {
  print -u2 -- "macOS Alpha build failed: $1"
  exit 2
}

[[ "$(uname -s)" == "Darwin" ]] || fail "TARGET_OS_NOT_MACOS"
[[ "$(uname -m)" == "arm64" ]] || fail "TARGET_ARCH_NOT_ARM64"
[[ -x "$PYTHON312" ]] || fail "PYTHON312_NOT_FOUND"
[[ -x "$PROJECT_ROOT/frontend/node_modules/.bin/tauri" ]] || fail "FRONTEND_DEPENDENCIES_NOT_INSTALLED"
[[ -f "$PROJECT_ROOT/frontend/package-lock.json" ]] || fail "FRONTEND_LOCK_MISSING"
[[ -f "$PROJECT_ROOT/src-tauri/Cargo.lock" ]] || fail "CARGO_LOCK_MISSING"
[[ -f "$PROJECT_ROOT/requirements-sidecar-build.lock" ]] || fail "SIDECAR_LOCK_MISSING"
[[ -x "/usr/bin/hdiutil" ]] || fail "HDIUTIL_NOT_FOUND"
[[ -x "/usr/bin/codesign" ]] || fail "CODESIGN_NOT_FOUND"
[[ -x "/usr/bin/sandbox-exec" ]] || fail "NETWORK_SANDBOX_NOT_FOUND"

PYTHON_VERSION="$($PYTHON312 -c 'import platform, sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')"
[[ "$PYTHON_VERSION" == "3.12" ]] || fail "PYTHON312_VERSION_MISMATCH"

cd "$PROJECT_ROOT"
git diff --check

print -- "Building synthetic-only macOS arm64 Alpha package"
"$PYTHON312" scripts/package_macos_prototype.py

MANIFEST_PATH="$(find "$PROJECT_ROOT/build/stage11/macos-arm64" -type f -name package-manifest.json -print | sort | tail -n 1)"
[[ -n "$MANIFEST_PATH" && -f "$MANIFEST_PATH" ]] || fail "PACKAGE_MANIFEST_NOT_FOUND"

"$PROJECT_ROOT/scripts/verify_macos_alpha.sh" "$MANIFEST_PATH"

bundle_manifest_hash() {
  "$PYTHON312" - "$1" <<'PY'
import hashlib
import pathlib
import sys

root = pathlib.Path(sys.argv[1]).resolve()
digest = hashlib.sha256()
for path in sorted(root.rglob("*")):
    if not path.is_file() or path.is_symlink():
        continue
    relative = path.relative_to(root).as_posix().encode("utf-8")
    data = path.read_bytes()
    digest.update(len(relative).to_bytes(8, "big"))
    digest.update(relative)
    digest.update(len(data).to_bytes(8, "big"))
    digest.update(data)
print(digest.hexdigest())
PY
}

APP_PATH="$($PYTHON312 - "$MANIFEST_PATH" <<'PY'
import json
import pathlib
import sys

manifest_path = pathlib.Path(sys.argv[1]).resolve()
manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
root = manifest_path.parent
print(root / manifest["app"]["relativePath"])
PY
)"
DMG_PATH="$($PYTHON312 - "$MANIFEST_PATH" <<'PY'
import json
import pathlib
import sys

manifest_path = pathlib.Path(sys.argv[1]).resolve()
manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
root = manifest_path.parent
print(root / manifest["dmg"]["relativePath"])
PY
)"

print -- "alpha-manifest=$MANIFEST_PATH"
print -- "app=$APP_PATH"
print -- "app-bundle-manifest-sha256=$(bundle_manifest_hash "$APP_PATH")"
print -- "dmg=$DMG_PATH"
print -- "dmg-sha256=$(shasum -a 256 "$DMG_PATH" | awk '{print $1}')"
print -- "status=passed"
