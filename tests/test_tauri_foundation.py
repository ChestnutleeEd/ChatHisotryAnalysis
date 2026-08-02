from __future__ import annotations

import json
from pathlib import Path
import subprocess
import unittest


ROOT = Path(__file__).resolve().parents[1]


class TauriFoundationTests(unittest.TestCase):
    def test_hooks_are_cwd_independent_and_not_nested_frontend(self) -> None:
        for config_name, command_key in (
            ("tauri.conf.json", "beforeBuildCommand"),
            ("tauri.dev.conf.json", "beforeDevCommand"),
        ):
            config = json.loads(
                (ROOT / "src-tauri" / config_name).read_text(encoding="utf-8")
            )
            command = config["build"][command_key]
            self.assertIn("tauri-frontend-hook.mjs", command)
            self.assertNotIn("frontend/frontend", command)
            self.assertNotIn("npm --prefix frontend", command)

        hook = ROOT / "scripts" / "tauri-frontend-hook.mjs"
        for cwd in (ROOT, ROOT / "src-tauri", ROOT / "frontend"):
            result = subprocess.run(
                ["node", str(hook), "--check"],
                cwd=cwd,
                capture_output=True,
                text=True,
                check=False,
            )
            # --check is intentionally handled as a read-only configuration probe.
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertNotIn("frontend/frontend/package.json", result.stderr)

    def test_production_capability_has_no_default_or_privileged_plugin_set(self) -> None:
        capability = json.loads(
            (ROOT / "src-tauri" / "capabilities" / "default.json").read_text(
                encoding="utf-8"
            )
        )
        permissions = capability["permissions"]
        self.assertEqual(permissions, [])
        forbidden = ("default", "filesystem", "shell", "http", "opener", "process", "updater", "remote")
        self.assertFalse(any(any(word in permission.lower() for word in forbidden) for permission in permissions))

    def test_acl_digest_script_replays_the_reviewed_surface(self) -> None:
        result = subprocess.run(
            ["python3", str(ROOT / "scripts" / "verify_tauri_acl.py")],
            cwd=ROOT,
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertRegex(result.stdout, r"^tauri-acl-sha256=[0-9a-f]{64}$")

    def test_release_shell_installs_the_native_fail_closed_delegate(self) -> None:
        lib = (ROOT / "src-tauri" / "src" / "lib.rs").read_text(encoding="utf-8")
        self.assertIn("webview_permissions::install(&window)?", lib)
        self.assertIn("NewWindowResponse::Deny", lib)
        self.assertIn("security::allow_navigation", lib)


if __name__ == "__main__":
    unittest.main()
