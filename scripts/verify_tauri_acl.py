"""Reproducible, path-independent assertion for the renderer ACL surface."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
# Updated only when the reviewed capability/config surface intentionally changes.
EXPECTED_ACL_DIGEST = "50d1171cb471e5fc14195c5cbfe3289769612dabc200ba3ef54ef35d4ef8aa2f"
FORBIDDEN_PERMISSION_WORDS = (
    "event",
    "devtools",
    "window",
    "webview",
    "enumeration",
    "filesystem",
    "shell",
    "http",
    "process",
)


def _read(relative: str) -> dict[str, object]:
    value = json.loads((ROOT / relative).read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise AssertionError(f"{relative} must be an object")
    return value


def _window(config: dict[str, object], relative: str) -> dict[str, object]:
    app = config.get("app")
    windows = app.get("windows") if isinstance(app, dict) else None
    if not isinstance(windows, list) or len(windows) != 1 or not isinstance(windows[0], dict):
        raise AssertionError(f"{relative} must declare one main window")
    window = windows[0]
    if window.get("label") != "main" or window.get("devtools") is not False:
        raise AssertionError(f"{relative} exposes a renderer privilege")
    return window


def compute_acl_digest() -> str:
    capability = _read("src-tauri/capabilities/default.json")
    permissions = capability.get("permissions")
    if permissions != []:
        raise AssertionError("renderer permissions must remain empty")
    if capability.get("windows") != ["main"]:
        raise AssertionError("renderer ACL must target only main")
    if any(
        any(word in str(permission).lower() for word in FORBIDDEN_PERMISSION_WORDS)
        for permission in permissions
    ):
        raise AssertionError("forbidden renderer permission present")

    release = _read("src-tauri/tauri.conf.json")
    development = _read("src-tauri/tauri.dev.conf.json")
    release_window = _window(release, "src-tauri/tauri.conf.json")
    development_window = _window(development, "src-tauri/tauri.dev.conf.json")
    if release_window.get("create") is not False or development_window.get("create") is not False:
        raise AssertionError("window creation must remain host-owned")
    if release.get("app", {}).get("withGlobalTauri") is not False:
        raise AssertionError("global Tauri bridge must remain disabled")

    payload = {
        "capability": capability,
        "release": release,
        "development": development,
    }
    canonical = json.dumps(
        payload,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return hashlib.sha256(canonical).hexdigest()


def main() -> int:
    digest = compute_acl_digest()
    if digest != EXPECTED_ACL_DIGEST:
        raise SystemExit(f"ACL_DIGEST_MISMATCH:{digest}")
    print(f"tauri-acl-sha256={digest}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
