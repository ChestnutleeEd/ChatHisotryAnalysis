from __future__ import annotations

import json
from pathlib import Path
import subprocess
import sys
import unittest


ROOT = Path(__file__).resolve().parents[1]


class Stage11SourceContractTests(unittest.TestCase):
    def test_target_config_declares_local_mac_boundary(self) -> None:
        config = json.loads(
            (ROOT / "src-tauri" / "tauri.macos.conf.json").read_text(
                encoding="utf-8"
            )
        )
        macos = config["bundle"]["macOS"]
        self.assertEqual(config["bundle"]["targets"], ["app"])
        self.assertEqual(macos["bundleName"], "Chat History Analysis")
        self.assertEqual(macos["bundleVersion"], "1")
        self.assertEqual(macos["minimumSystemVersion"], "11.0")
        self.assertIsNone(macos["signingIdentity"])
        self.assertFalse(macos["hardenedRuntime"])

    def test_packager_uses_host_only_release_and_bundle_relative_resources(self) -> None:
        source = (ROOT / "scripts" / "package_macos_prototype.py").read_text(
            encoding="utf-8"
        )
        for required in (
            '"--target",\n            TARGET',
            '"--bundles",\n            "app"',
            '"--no-sign"',
            '"--no-default-features"',
            '"--bin",\n            APP_EXECUTABLE',
            '"resourceResolution": "bundle-relative"',
            'deny network*',
            '"/usr/bin/codesign"',
            '"/usr/bin/hdiutil"',
        ):
            self.assertIn(required, source)
        self.assertNotIn("rm -rf", source)
        self.assertNotIn("Remove-Item -Recurse", source)

    def test_sidecar_hashes_signed_members_before_evidence(self) -> None:
        source = (ROOT / "scripts" / "build_sidecar_spike.py").read_text(
            encoding="utf-8"
        )
        self.assertLess(
            source.index("_sign_nested_first(bundle)"),
            source.index("members = _members(bundle)"),
        )
        self.assertIn('"--sign",\n                "-"', source)
        self.assertIn('"--verify",\n                "--strict"', source)

    def test_helper_bins_are_feature_gated_out_of_the_app(self) -> None:
        cargo = (ROOT / "src-tauri" / "Cargo.toml").read_text(encoding="utf-8")
        self.assertIn('default = ["synthetic-test-helpers"]', cargo)
        self.assertEqual(cargo.count('required-features = ["synthetic-test-helpers"]'), 2)
        self.assertIn('packaged-b6-acceptance = ["synthetic-dialog-adapter"]', cargo)

    def test_b6_fixtures_are_small_synthetic_and_cover_the_frozen_families(self) -> None:
        fixture_root = ROOT / "contracts" / "b6-fixtures"
        core = [
            json.loads((fixture_root / name).read_text(encoding="utf-8"))
            for name in (
                "core-2023-2024.json",
                "core-2024-2025.json",
                "core-2025-2026.json",
            )
        ]
        messages = [message for document in core for message in document["messages"]]
        self.assertGreaterEqual(
            len({message["formattedTime"][:4] for message in messages}),
            3,
        )
        self.assertEqual(
            len({message["platformMessageId"] for message in messages}),
            len(messages) - 3,
        )
        self.assertEqual(
            {message["isSend"] for message in messages},
            {0, 1},
        )
        self.assertGreaterEqual(len({message["chatLabType"] for message in messages}), 3)
        self.assertLess(sum(path.stat().st_size for path in fixture_root.glob("core-*.json")), 30_000)
        edge = json.loads((fixture_root / "edge-sparse.json").read_text(encoding="utf-8"))
        self.assertLessEqual(len(edge["messages"]), 2)
        self.assertEqual({message["isSend"] for message in edge["messages"]}, {0, 1})
        with self.assertRaises(json.JSONDecodeError):
            json.loads((fixture_root / "malformed.json").read_text(encoding="utf-8"))

    def test_b6_packaging_has_one_explicit_work_root_and_no_recursive_cleanup(self) -> None:
        source = (ROOT / "scripts" / "package_macos_prototype.py").read_text(
            encoding="utf-8"
        )
        self.assertIn('B6_WORK_ROOT_RELATIVE = Path("build/stage11/macos-arm64/b6-final-acceptance")', source)
        self.assertIn('output_root = candidate / "final-release"', source)
        self.assertIn('"--b6-acceptance"', source)
        self.assertNotIn("shutil.rmtree", source)
        self.assertNotIn("rm -rf", source)

    def test_packaged_smoke_uses_stable_home_annual_entry_contract(self) -> None:
        home = (ROOT / "frontend" / "src" / "presentation" / "beta" / "BetaHome.tsx").read_text(
            encoding="utf-8"
        )
        smoke = (ROOT / "src-tauri" / "src" / "lib.rs").read_text(encoding="utf-8")
        self.assertIn('data-testid="beta-home-annual-report"', home)
        self.assertIn('[data-testid="beta-home-annual-report"]', smoke)
        self.assertNotIn('button("查看年度聊天报告")', smoke)

    def test_placeholder_icons_are_real_assets(self) -> None:
        png = (ROOT / "src-tauri" / "icons" / "icon.png").read_bytes()
        icns = (ROOT / "src-tauri" / "icons" / "icon.icns").read_bytes()
        self.assertTrue(png.startswith(b"\x89PNG\r\n\x1a\n"))
        self.assertTrue(icns.startswith(b"icns"))
        self.assertGreater(len(png), 1024)
        self.assertGreater(len(icns), 1024)

    def test_platform_neutrality_audit_passes(self) -> None:
        result = subprocess.run(
            [
                sys.executable,
                str(ROOT / "scripts" / "audit_stage11_platform_neutrality.py"),
            ],
            cwd=ROOT,
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.strip(), "platform-neutrality=passed")


if __name__ == "__main__":
    unittest.main()
