#!/bin/zsh

set -euo pipefail
umask 077

PROJECT_ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd -P)"
PYTHON312="${CHAT_HISTORY_ANALYSIS_PYTHON312:-/opt/anaconda3/bin/python3.12}"

fail() {
  print -u2 -- "macOS Alpha verification failed: $1"
  exit 2
}

[[ "$(uname -s)" == "Darwin" ]] || fail "TARGET_OS_NOT_MACOS"
[[ "$(uname -m)" == "arm64" ]] || fail "TARGET_ARCH_NOT_ARM64"
[[ -x "$PYTHON312" ]] || fail "PYTHON312_NOT_FOUND"

if [[ "$#" -ge 1 ]]; then
  MANIFEST_PATH="$1"
else
  MANIFEST_PATH="$(find "$PROJECT_ROOT/build/stage11/macos-arm64" -type f -name package-manifest.json -print | sort | tail -n 1)"
fi
[[ -n "$MANIFEST_PATH" && -f "$MANIFEST_PATH" ]] || fail "PACKAGE_MANIFEST_NOT_FOUND"

MANIFEST_PATH="$(cd "$(dirname "$MANIFEST_PATH")" && pwd -P)/$(basename "$MANIFEST_PATH")"
case "$MANIFEST_PATH" in
  "$PROJECT_ROOT/build/stage11/macos-arm64"/*) ;;
  *) fail "MANIFEST_OUTSIDE_IGNORED_BUILD_ROOT" ;;
esac

read_manifest_value() {
  local expression="$1"
  "$PYTHON312" - "$MANIFEST_PATH" "$expression" <<'PY'
import json
import pathlib
import sys

manifest = json.loads(pathlib.Path(sys.argv[1]).read_text(encoding="utf-8"))
expression = sys.argv[2]
value = manifest
for part in expression.split("."):
    value = value[part]
print(value)
PY
}

MANIFEST_DIR="$(dirname "$MANIFEST_PATH")"
APP_REPOSITORY_PATH="$($PYTHON312 - "$MANIFEST_PATH" <<'PY'
import json
import pathlib
import sys

manifest = json.loads(pathlib.Path(sys.argv[1]).read_text(encoding="utf-8"))
print(manifest.get("app", {}).get("repositoryRelativePath", ""))
PY
)"
if [[ -n "$APP_REPOSITORY_PATH" ]]; then
  APP_PATH="$PROJECT_ROOT/$APP_REPOSITORY_PATH"
else
  APP_PATH="$PROJECT_ROOT/src-tauri/target/aarch64-apple-darwin/release/bundle/macos/$(read_manifest_value 'app.relativePath')"
fi
DMG_PATH="$MANIFEST_DIR/$(read_manifest_value 'dmg.relativePath')"
[[ -d "$APP_PATH" ]] || fail "APP_NOT_FOUND"
[[ -f "$DMG_PATH" ]] || fail "DMG_NOT_FOUND"
[[ "$(read_manifest_value 'schema')" == "chat-history-analysis.stage11-package-manifest.v1" ]] || fail "MANIFEST_SCHEMA_INVALID"
[[ "$(read_manifest_value 'target.architecture')" == "arm64" ]] || fail "MANIFEST_ARCH_INVALID"
[[ "$(read_manifest_value 'app.resourceResolution')" == "bundle-relative" ]] || fail "RESOURCE_RESOLUTION_INVALID"
[[ "$(read_manifest_value 'signing.mode')" == "ad-hoc" ]] || fail "SIGNING_MODE_INVALID"
[[ "$(read_manifest_value 'signing.nestedFirst')" == "True" ]] || fail "SIGNING_ORDER_INVALID"
[[ "$(read_manifest_value 'signing.notarized')" == "False" ]] || fail "UNEXPECTED_NOTARIZATION_CLAIM"
[[ "$(read_manifest_value 'privacy.syntheticOnly')" == "True" ]] || fail "NON_SYNTHETIC_PACKAGE"
[[ "$(read_manifest_value 'privacy.sourceTreeDependency')" == "False" ]] || fail "SOURCE_TREE_DEPENDENCY"
[[ "$(read_manifest_value 'privacy.systemPythonDependency')" == "False" ]] || fail "SYSTEM_PYTHON_DEPENDENCY"
[[ "$(read_manifest_value 'privacy.nodeDependency')" == "False" ]] || fail "NODE_DEPENDENCY"
[[ "$(read_manifest_value 'privacy.networkDependency')" == "False" ]] || fail "NETWORK_DEPENDENCY"

APP_EXECUTABLE="$APP_PATH/Contents/MacOS/chat-history-analysis"
SIDECAR_ROOT="$APP_PATH/Contents/Resources/chat-history-analysis-sidecar"
SIDECAR_EXECUTABLE="$SIDECAR_ROOT/chat-history-analysis-sidecar"
[[ -x "$APP_EXECUTABLE" ]] || fail "APP_EXECUTABLE_NOT_FOUND"
[[ -x "$SIDECAR_EXECUTABLE" ]] || fail "SIDECAR_EXECUTABLE_NOT_FOUND"
[[ -f "$SIDECAR_ROOT/sidecar-evidence.json" ]] || fail "SIDECAR_EVIDENCE_NOT_FOUND"
[[ -f "$SIDECAR_ROOT/sidecar-trust-anchor.json" ]] || fail "SIDECAR_ANCHOR_NOT_FOUND"

/usr/bin/file "$APP_EXECUTABLE" | rg -q 'Mach-O.*arm64' || fail "APP_ARCH_INVALID"
/usr/bin/file "$SIDECAR_EXECUTABLE" | rg -q 'Mach-O.*arm64' || fail "SIDECAR_ARCH_INVALID"
/usr/bin/lipo -archs "$APP_EXECUTABLE" | rg -xq 'arm64' || fail "APP_ARCH_SLICE_INVALID"
/usr/bin/lipo -archs "$SIDECAR_EXECUTABLE" | rg -xq 'arm64' || fail "SIDECAR_ARCH_SLICE_INVALID"
/usr/bin/codesign --verify --deep --strict "$APP_PATH" || fail "APP_SIGNATURE_INVALID"
/usr/bin/codesign --verify --strict "$SIDECAR_EXECUTABLE" || fail "SIDECAR_SIGNATURE_INVALID"
/usr/bin/hdiutil verify "$DMG_PATH" >/dev/null || fail "DMG_VERIFY_FAILED"

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

MOUNT_PATH="$(mktemp -d /tmp/chat-history-analysis-alpha-mount.XXXXXX)"
ATTACHED=0
cleanup_mount() {
  if [[ "$ATTACHED" == "1" ]]; then
    /usr/bin/hdiutil detach "$MOUNT_PATH" >/dev/null
  fi
  rmdir "$MOUNT_PATH" 2>/dev/null || true
}
trap cleanup_mount EXIT

/usr/bin/hdiutil attach "$DMG_PATH" -readonly -nobrowse -mountpoint "$MOUNT_PATH" >/dev/null
ATTACHED=1
[[ -d "$MOUNT_PATH/Chat History Analysis.app" ]] || fail "DMG_APP_MISSING"
[[ -L "$MOUNT_PATH/Applications" ]] || fail "DMG_APPLICATIONS_LINK_MISSING"

TRACKED_GENERATED="$(git ls-files | rg '(^|/)(target|dist|build|node_modules)/|\.app$|\.dmg$' || true)"
[[ -z "$TRACKED_GENERATED" ]] || fail "GENERATED_ARTIFACT_TRACKED"
git diff --check
git diff --cached --check

print -- "manifest=$MANIFEST_PATH"
print -- "app=$APP_PATH"
print -- "app-bundle-manifest-sha256=$(bundle_manifest_hash "$APP_PATH")"
print -- "dmg=$DMG_PATH"
print -- "dmg-sha256=$(shasum -a 256 "$DMG_PATH" | awk '{print $1}')"
print -- "dmg-mount-copy-unmount=passed"
print -- "status=passed"
