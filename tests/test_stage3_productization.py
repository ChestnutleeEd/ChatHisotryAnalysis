from __future__ import annotations

import copy
from contextlib import nullcontext
import hashlib
from io import BytesIO, StringIO
from pathlib import Path
import tempfile
import time
import unittest
from unittest.mock import patch

from chat_history_analysis import frozen_runtime
from chat_history_analysis.cli import run_sidecar_streams
from chat_history_analysis.errors import CancellationError, ExitCode
from chat_history_analysis.operation_control import current_operation_control
from chat_history_analysis.sidecar_protocol import SidecarConfiguration, encode_configuration
from chat_history_analysis.sidecar_trust import (
    TRUST_ROOT,
    bundle_merkle_root,
    evidence_digest,
)


class FrozenGateSourceBoundaryTests(unittest.TestCase):
    def setUp(self) -> None:
        self.root = Path(tempfile.mkdtemp(prefix="stage3-frozen-gate-"))
        self.bundle = self.root / "sidecar-bundle"
        self.bundle.mkdir()
        self.executable = self.bundle / "synthetic-sidecar"
        self.executable.write_bytes(b"synthetic")
        member = {
            "name": self.executable.name,
            "byteSize": self.executable.stat().st_size,
            "sha256": hashlib.sha256(self.executable.read_bytes()).hexdigest(),
        }
        self.evidence = {
            "evidenceVersion": frozen_runtime.EVIDENCE_VERSION,
            "buildMode": "onedir",
            "targetTriple": "macos-arm64",
            "pythonMajorMinor": "3.12",
            "pyinstallerVersion": "6.21.0",
            "preprocessorVersion": "0.1.0",
            "ijsonVersion": "3.5.1",
            "nativeBackend": "ijson.backends.yajl2_c",
            "executableName": self.executable.name,
            "executableArchitecture": "arm64",
            "sourceRevision": "a" * 40,
            "trustAnchorId": "stage3-test-anchor",
            "dependencyLockDigest": "b" * 64,
            "specDigest": "c" * 64,
            "productionEntrypointDigest": "d" * 64,
            "fixtureSha256": "e" * 64,
            "buildInputDigest": "f" * 64,
            "network": "blocked-and-probed",
            "trustRoot": TRUST_ROOT,
            "members": [member],
            "bundleMerkleRoot": bundle_merkle_root([member]),
            "probeResults": {
                "parser": "passed",
                "productionSuccess": "passed",
                "productionFailure": "passed",
                "differentCwd": "passed",
                "offline": "passed",
            },
        }
        self.evidence["evidenceDigest"] = evidence_digest(self.evidence)
        self.anchor = {
            "anchorVersion": "chat-history-analysis.sidecar-trust-anchor.v1",
            "anchorId": self.evidence["trustAnchorId"],
            "targetTriple": self.evidence["targetTriple"],
            "pythonMajorMinor": self.evidence["pythonMajorMinor"],
            "executableName": self.evidence["executableName"],
            "nativeBackend": self.evidence["nativeBackend"],
            "sourceRevision": self.evidence["sourceRevision"],
            "dependencyLockDigest": self.evidence["dependencyLockDigest"],
            "specDigest": self.evidence["specDigest"],
            "productionEntrypointDigest": self.evidence[
                "productionEntrypointDigest"
            ],
            "fixtureSha256": self.evidence["fixtureSha256"],
            "buildInputDigest": self.evidence["buildInputDigest"],
            "expectedBundleMerkleRoot": self.evidence["bundleMerkleRoot"],
            "expectedEvidenceDigest": self.evidence["evidenceDigest"],
            "trustRoot": TRUST_ROOT,
        }
        self.source_opened = False

    def tearDown(self) -> None:
        if self.executable.exists():
            self.executable.unlink()
        if self.bundle.exists():
            self.bundle.rmdir()
        if self.root.exists():
            self.root.rmdir()

    def _run_gate(
        self,
        *,
        evidence: dict[str, object] | None = None,
        machine: str = "arm64",
        read_evidence: bool = True,
    ) -> None:
        selected_evidence = self.evidence if evidence is None else evidence
        evidence_patch = (
            patch.object(
                frozen_runtime,
                "_read_evidence",
                return_value=copy.deepcopy(selected_evidence),
            )
            if read_evidence
            else nullcontext()
        )
        with (
            patch.object(frozen_runtime.sys, "executable", str(self.executable)),
            patch.object(frozen_runtime.sys, "frozen", True, create=True),
            patch.object(frozen_runtime.platform, "system", return_value="Darwin"),
            patch.object(frozen_runtime.platform, "machine", return_value=machine),
            patch.object(frozen_runtime, "_read_anchor", return_value=self.anchor),
            evidence_patch,
            patch.object(frozen_runtime, "_load_frozen_backend", return_value=object()),
            patch(
                "chat_history_analysis.startup.StartupGate._verify_parser_initialization",
                return_value=None,
            ),
        ):
            frozen_runtime.verify_frozen_runtime()

    def test_successful_gate_is_the_only_path_to_source_continuation(self) -> None:
        self._run_gate()
        self.source_opened = True
        self.assertTrue(self.source_opened)

    def test_mutated_member_fails_before_source_open(self) -> None:
        mutated = copy.deepcopy(self.evidence)
        mutated["members"][0]["sha256"] = "0" * 64
        with self.assertRaises(Exception):
            self._run_gate(evidence=mutated)
        self.assertFalse(self.source_opened)

    def test_wrong_architecture_fails_before_source_open(self) -> None:
        with self.assertRaises(Exception):
            self._run_gate(machine="x86_64")
        self.assertFalse(self.source_opened)

    def test_missing_evidence_fails_before_source_open(self) -> None:
        evidence_path = self.bundle / frozen_runtime.EVIDENCE_NAME
        with self.assertRaises(Exception):
            self._run_gate(read_evidence=False)
        self.assertFalse(self.source_opened)
        self.assertFalse(evidence_path.exists())


class ParentEofTests(unittest.TestCase):
    def test_parent_eof_requests_cooperative_cancellation_without_private_output(self) -> None:
        configuration = SidecarConfiguration(
            session_id="ses_stage3_parent_eof",
            generation=1,
            annual_sources=(Path("/tmp/synthetic-parent-eof.json"),),
            verification_sources=(),
            application_cache_root=Path("/tmp/stage3-cache"),
            output_directory=Path(
                "/tmp/stage3-cache/analysis-sessions/ses_stage3_parent_eof"
            ),
            session_nonce="nonce_stage3_parent_eof",
        )

        def wait_for_parent_loss(_selection):
            control = current_operation_control()
            deadline = time.monotonic() + 2.0
            while not control.cancellation_requested and time.monotonic() < deadline:
                time.sleep(0.01)
            if not control.cancellation_requested:
                raise AssertionError("parent EOF did not reach operation control")
            raise CancellationError(phase="startup")

        output = StringIO()
        error = StringIO()
        with patch("chat_history_analysis.cli.run_preprocessing_v2", wait_for_parent_loss):
            result = run_sidecar_streams(
                BytesIO(encode_configuration(configuration)),
                output,
                error,
            )
        self.assertEqual(result, int(ExitCode.CANCELLATION))
        self.assertEqual(error.getvalue(), "")
        self.assertNotIn("parent-eof", output.getvalue())


if __name__ == "__main__":
    unittest.main()
