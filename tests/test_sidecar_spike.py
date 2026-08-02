from pathlib import Path
import unittest

from chat_history_analysis.sidecar_trust import (
    TRUST_ROOT,
    bundle_merkle_root,
    evidence_digest,
    verify_evidence_against_anchor,
)


ROOT = Path(__file__).resolve().parents[1]


class SidecarSpikeContractTests(unittest.TestCase):
    def test_build_lock_is_pinned_and_dependency_complete(self):
        lock = (ROOT / "requirements-sidecar-build.lock").read_text(encoding="utf-8")
        for requirement in (
            "ijson==3.5.1",
            "pyinstaller==6.21.0",
            "pyinstaller-hooks-contrib==2026.6",
            "macholib==1.16.4",
            "setuptools==80.9.0",
        ):
            self.assertIn(requirement, lock)
        self.assertIn("https://pypi.tuna.tsinghua.edu.cn/simple", lock)
        self.assertIn("--require-hashes", lock)
        self.assertIn("--only-binary=:all:", lock)
        self.assertNotIn("--no-deps", lock)

    def test_probe_enters_the_production_composition(self):
        probe = (ROOT / "scripts" / "sidecar" / "frozen_probe.py").read_text(
            encoding="utf-8"
        )
        spec = (ROOT / "scripts" / "sidecar" / "chat_history_analysis_sidecar.spec").read_text(
            encoding="utf-8"
        )
        builder = (ROOT / "scripts" / "build_sidecar_spike.py").read_text(
            encoding="utf-8"
        )
        frozen_gate = (ROOT / "src" / "chat_history_analysis" / "frozen_runtime.py").read_text(
            encoding="utf-8"
        )
        host_gate = (ROOT / "src-tauri" / "src" / "trust_anchor.rs").read_text(
            encoding="utf-8"
        )
        host_startup = (ROOT / "src-tauri" / "src" / "lib.rs").read_text(
            encoding="utf-8"
        )
        transport = (ROOT / "src-tauri" / "src" / "dataset_transport.rs").read_text(
            encoding="utf-8"
        )

        self.assertIn("run_preprocessing", probe)
        self.assertIn("InputSelection", probe)
        self.assertNotIn('"messageCount": 2', probe)
        self.assertIn("yajl2_c", probe)
        self.assertIn("exclude_binaries=True", spec)
        self.assertIn("chat_history_analysis.application", spec)
        self.assertIn("sandbox-exec", builder)
        self.assertIn('"network": "blocked-and-probed"', builder)
        self.assertIn("input_manifest", builder)
        self.assertIn("sidecar-trust-anchor.json", spec)
        self.assertIn('"pythonMajorMinor"', frozen_gate)
        self.assertIn("TRUST_ROOT", frozen_gate)
        self.assertIn("verify_evidence_against_anchor", frozen_gate)
        self.assertIn("CHAT_HISTORY_ANALYSIS_BUILD_PROBE", frozen_gate)
        self.assertIn("candidate.name in (EVIDENCE_NAME, TRUST_ANCHOR_NAME)", frozen_gate)
        self.assertIn("_normalize_base_library_zip", builder)
        self.assertLess(builder.index('offline ='), builder.index('evidence["evidenceDigest"]'))
        self.assertLess(
            builder.index('evidence["evidenceDigest"]'),
            builder.index("_write_evidence(output_dir"),
        )
        application = (ROOT / "src" / "chat_history_analysis" / "application.py").read_text(
            encoding="utf-8"
        )
        self.assertLess(
            application.index("backend = self._gate.verify()"),
            application.index("inputs = preflight_inputs(selection)"),
        )
        self.assertIn("if (bundle_root / EVIDENCE_NAME).exists()", frozen_gate)
        self.assertIn("verify_evidence_against_anchor", frozen_gate)
        self.assertIn("pub fn verify_sidecar_bundle", host_gate)
        self.assertIn("verify_sidecar_bundle", host_startup)
        self.assertIn("mark_sidecar_verified", host_startup)
        self.assertIn("sidecar_verified", transport)

    def test_host_anchor_rejects_bundle_and_adjacent_evidence_tampering(self):
        members = [
            {
                "name": "chat_history_analysis/application.py",
                "byteSize": 12,
                "sha256": "1" * 64,
            }
        ]
        anchor = {
            "anchorVersion": "chat-history-analysis.sidecar-trust-anchor.v1",
            "anchorId": "test-anchor",
            "targetTriple": "macos-arm64",
            "pythonMajorMinor": "3.12",
            "executableName": "sidecar",
            "nativeBackend": "ijson.backends.yajl2_c",
            "sourceRevision": "a" * 40,
            "dependencyLockDigest": "2" * 64,
            "specDigest": "3" * 64,
            "productionEntrypointDigest": "4" * 64,
            "fixtureSha256": "5" * 64,
            "buildInputDigest": "6" * 64,
            "expectedBundleMerkleRoot": bundle_merkle_root(members),
            "expectedEvidenceDigest": "0" * 64,
            "trustRoot": TRUST_ROOT,
        }
        evidence = {
            "trustAnchorId": "test-anchor",
            "trustRoot": TRUST_ROOT,
            "targetTriple": "macos-arm64",
            "pythonMajorMinor": "3.12",
            "executableName": "sidecar",
            "nativeBackend": "ijson.backends.yajl2_c",
            "sourceRevision": "a" * 40,
            "dependencyLockDigest": "2" * 64,
            "specDigest": "3" * 64,
            "productionEntrypointDigest": "4" * 64,
            "fixtureSha256": "5" * 64,
            "buildInputDigest": "6" * 64,
            "bundleMerkleRoot": bundle_merkle_root(members),
        }
        evidence["evidenceDigest"] = evidence_digest(evidence)
        anchor["expectedEvidenceDigest"] = evidence["evidenceDigest"]

        verify_evidence_against_anchor(anchor, evidence, members)

        tampered_members = [dict(members[0], sha256="7" * 64)]
        tampered_evidence = dict(evidence)
        tampered_evidence["bundleMerkleRoot"] = bundle_merkle_root(tampered_members)
        tampered_evidence["evidenceDigest"] = evidence_digest(tampered_evidence)
        with self.assertRaises(ValueError):
            verify_evidence_against_anchor(anchor, tampered_evidence, tampered_members)

        changed_evidence = dict(evidence)
        changed_evidence["sourceRevision"] = "b" * 40
        changed_evidence["evidenceDigest"] = evidence_digest(changed_evidence)
        with self.assertRaises(ValueError):
            verify_evidence_against_anchor(anchor, changed_evidence, members)

        changed_anchor = dict(anchor)
        changed_anchor["expectedBundleMerkleRoot"] = "8" * 64
        with self.assertRaises(ValueError):
            verify_evidence_against_anchor(changed_anchor, evidence, members)


if __name__ == "__main__":
    unittest.main()
