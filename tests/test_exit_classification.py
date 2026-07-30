from __future__ import annotations

from contextlib import redirect_stderr, redirect_stdout
import io
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

from chat_history_analysis.cli import _run_for_test
from chat_history_analysis.errors import (
    ExitCode,
    FailureCategory,
    SOURCE_VALIDATION_PHASE,
    SourceRole,
    SourceValidationError,
    SourceValidationReasonCode,
)
from chat_history_analysis.input_preflight import (
    GIT_EXECUTABLE,
    MAX_RAW_INPUT_BYTES,
    preflight_inputs,
)


SENSITIVE = "private-cli-injection-do-not-echo"


class ExitClassificationTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory(
            prefix="chat-analysis-exit-codes-",
            dir="/tmp",
        )
        self.addCleanup(self.temporary_directory.cleanup)
        self.root = Path(self.temporary_directory.name)
        subprocess.run(
            [GIT_EXECUTABLE, "-C", os.fspath(self.root), "init", "--quiet"],
            check=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        (self.root / ".gitignore").write_text(
            "ignored/\n",
            encoding="utf-8",
        )
        self.source = self.root / f"{SENSITIVE}.json"
        self.source.write_bytes(b"synthetic")
        self.ignored_output = self.root / "ignored" / "dataset"

    def run_cli(
        self,
        arguments: list[str],
        runner,
    ) -> tuple[int, str, str]:
        stdout = io.StringIO()
        stderr = io.StringIO()
        with redirect_stdout(stdout), redirect_stderr(stderr):
            exit_code = _run_for_test(
                arguments,
                lambda: None,
                runner,
            )
        return exit_code, stdout.getvalue(), stderr.getvalue()

    def assert_private_failure(
        self,
        exit_code: int,
        stdout: str,
        stderr: str,
        *,
        expected_exit: ExitCode,
        expected_category: FailureCategory,
    ) -> dict[str, object]:
        self.assertEqual(exit_code, int(expected_exit))
        self.assertEqual(stdout, "")
        self.assertNotIn(SENSITIVE, stderr)
        self.assertNotIn(self.source.name, stderr)
        self.assertNotIn(os.fspath(self.root), stderr)
        self.assertNotIn("Traceback", stderr)
        payload = json.loads(stderr)
        self.assertEqual(payload["category"], expected_category.value)
        return payload

    def test_exit_code_values_are_stable_and_non_overlapping(self) -> None:
        expected = {
            ExitCode.STARTUP_FAILURE: 2,
            ExitCode.ARGUMENT_FAILURE: 64,
            ExitCode.INPUT_VALIDATION_FAILURE: 65,
            ExitCode.IGNORE_POLICY_FAILURE: 66,
            ExitCode.CAPACITY_FAILURE: 67,
        }
        self.assertEqual(
            {member: int(member) for member in expected},
            expected,
        )
        self.assertEqual(len(set(expected.values())), len(expected))

    def test_argument_failure_has_its_own_exit_class(self) -> None:
        exit_code, stdout, stderr = self.run_cli(
            ["preprocess", SENSITIVE],
            lambda selection: None,
        )
        payload = self.assert_private_failure(
            exit_code,
            stdout,
            stderr,
            expected_exit=ExitCode.ARGUMENT_FAILURE,
            expected_category=FailureCategory.ARGUMENT,
        )
        self.assertEqual(payload["reasonCode"], "ARGUMENT_FAILURE")

    def test_source_validation_failure_has_its_own_exit_class(self) -> None:
        missing = self.root / f"{SENSITIVE}-missing.json"
        exit_code, stdout, stderr = self.run_cli(
            [
                "preprocess",
                "--annual-source",
                os.fspath(missing),
                "--output-dir",
                os.fspath(self.ignored_output),
            ],
            preflight_inputs,
        )
        self.assert_private_failure(
            exit_code,
            stdout,
            stderr,
            expected_exit=ExitCode.INPUT_VALIDATION_FAILURE,
            expected_category=FailureCategory.INPUT_VALIDATION,
        )

    def test_output_ignore_policy_failure_has_its_own_exit_class(self) -> None:
        unignored = self.root / f"{SENSITIVE}-output"
        exit_code, stdout, stderr = self.run_cli(
            [
                "preprocess",
                "--annual-source",
                os.fspath(self.source),
                "--output-dir",
                os.fspath(unignored),
            ],
            preflight_inputs,
        )
        payload = self.assert_private_failure(
            exit_code,
            stdout,
            stderr,
            expected_exit=ExitCode.IGNORE_POLICY_FAILURE,
            expected_category=FailureCategory.IGNORE_POLICY,
        )
        self.assertEqual(
            payload["reasonCode"],
            "OUTPUT_IGNORE_POLICY_FAILED",
        )

    def test_byte_capacity_failure_has_its_own_exit_class(self) -> None:
        os.truncate(self.source, MAX_RAW_INPUT_BYTES + 1)
        exit_code, stdout, stderr = self.run_cli(
            [
                "preprocess",
                "--annual-source",
                os.fspath(self.source),
                "--output-dir",
                os.fspath(self.ignored_output),
            ],
            preflight_inputs,
        )
        self.assert_private_failure(
            exit_code,
            stdout,
            stderr,
            expected_exit=ExitCode.CAPACITY_FAILURE,
            expected_category=FailureCategory.CAPACITY,
        )

    def test_message_capacity_failure_uses_capacity_exit_class(self) -> None:
        def fail(selection: object) -> object:
            raise SourceValidationError(
                SourceValidationReasonCode.RAW_MESSAGE_LIMIT_EXCEEDED,
                phase=SOURCE_VALIDATION_PHASE,
                role=SourceRole.ANNUAL_SOURCE,
                source_ordinal=1,
                category=FailureCategory.CAPACITY,
                field="messages",
                record_ordinal=2_000_001,
            )

        exit_code, stdout, stderr = self.run_cli(
            [
                "preprocess",
                "--annual-source",
                os.fspath(self.source),
                "--output-dir",
                os.fspath(self.ignored_output),
            ],
            fail,
        )
        payload = self.assert_private_failure(
            exit_code,
            stdout,
            stderr,
            expected_exit=ExitCode.CAPACITY_FAILURE,
            expected_category=FailureCategory.CAPACITY,
        )
        self.assertEqual(
            payload["reasonCode"],
            "RAW_MESSAGE_LIMIT_EXCEEDED",
        )

    def test_unexpected_internal_exception_is_safely_translated(self) -> None:
        def fail(selection: object) -> object:
            raise RuntimeError(SENSITIVE)

        exit_code, stdout, stderr = self.run_cli(
            [
                "preprocess",
                "--annual-source",
                os.fspath(self.source),
                "--output-dir",
                os.fspath(self.ignored_output),
            ],
            fail,
        )
        payload = self.assert_private_failure(
            exit_code,
            stdout,
            stderr,
            expected_exit=ExitCode.INPUT_VALIDATION_FAILURE,
            expected_category=FailureCategory.INPUT_VALIDATION,
        )
        self.assertEqual(payload["reasonCode"], "INPUT_PREFLIGHT_FAILED")


if __name__ == "__main__":
    unittest.main()
