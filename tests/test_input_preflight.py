from __future__ import annotations

from contextlib import redirect_stderr, redirect_stdout
import io
import json
import os
from pathlib import Path
import socket
import stat
import subprocess
import tempfile
import unittest
from unittest.mock import Mock, patch

from chat_history_analysis.application import run_input_preflight
from chat_history_analysis.cli import _run_for_test
from chat_history_analysis.errors import (
    InputPreflightError,
    StartupError,
    StartupReasonCode,
)
from chat_history_analysis.input_preflight import (
    GIT_EXECUTABLE,
    InputSelection,
    preflight_inputs,
)


SENSITIVE_NAME = "annual-overlap-2025-secret-message.json"


class CliInputRoleTests(unittest.TestCase):
    def capture_selection(self, arguments: list[str]) -> InputSelection:
        captured: list[InputSelection] = []
        stdout = io.StringIO()
        stderr = io.StringIO()
        with redirect_stdout(stdout), redirect_stderr(stderr):
            exit_code = _run_for_test(
                arguments,
                lambda: None,
                lambda selection: captured.append(selection),
            )
        self.assertEqual(exit_code, 0)
        self.assertEqual(stderr.getvalue(), "")
        self.assertEqual(
            json.loads(stdout.getvalue()),
            {"phase": "source-validation", "status": "ready"},
        )
        self.assertEqual(len(captured), 1)
        return captured[0]

    def assert_argument_rejected(self, arguments: list[str]) -> str:
        stdout = io.StringIO()
        stderr = io.StringIO()
        runner = Mock()
        with redirect_stdout(stdout), redirect_stderr(stderr):
            exit_code = _run_for_test(arguments, lambda: None, runner)
        self.assertEqual(exit_code, 64)
        self.assertEqual(stdout.getvalue(), "")
        runner.assert_not_called()
        return stderr.getvalue()

    def test_one_annual_source_and_output_directory(self):
        selection = self.capture_selection(
            [
                "preprocess",
                "--annual-source",
                "source-a",
                "--output-dir",
                "ignored-output",
            ]
        )
        self.assertEqual(selection.annual_sources, (Path("source-a"),))
        self.assertEqual(selection.overlap_verifications, ())
        self.assertEqual(selection.output_directory, Path("ignored-output"))

    def test_repeated_annual_sources_preserve_explicit_order(self):
        selection = self.capture_selection(
            [
                "preprocess",
                "--annual-source",
                "source-c",
                "--annual-source",
                "source-a",
                "--annual-source",
                "source-b",
                "--output-dir",
                "ignored-output",
            ]
        )
        self.assertEqual(
            selection.annual_sources,
            (Path("source-c"), Path("source-a"), Path("source-b")),
        )

    def test_overlap_verification_is_optional(self):
        selection = self.capture_selection(
            [
                "preprocess",
                "--annual-source",
                "source-a",
                "--output-dir",
                "ignored-output",
            ]
        )
        self.assertEqual(selection.overlap_verifications, ())

    def test_repeated_overlap_verifications_preserve_explicit_order(self):
        selection = self.capture_selection(
            [
                "preprocess",
                "--overlap-verification",
                "verification-b",
                "--annual-source",
                "source-a",
                "--overlap-verification",
                "verification-a",
                "--output-dir",
                "ignored-output",
            ]
        )
        self.assertEqual(
            selection.overlap_verifications,
            (Path("verification-b"), Path("verification-a")),
        )

    def test_missing_annual_source_fails_closed(self):
        error = self.assert_argument_rejected(
            [
                "preprocess",
                "--overlap-verification",
                "verification-a",
                "--output-dir",
                "ignored-output",
            ]
        )
        self.assertNotIn("verification-a", error)
        self.assertNotIn("ignored-output", error)

    def test_missing_output_directory_fails_closed(self):
        error = self.assert_argument_rejected(
            [
                "preprocess",
                "--annual-source",
                "source-a",
            ]
        )
        self.assertNotIn("source-a", error)

    def test_names_and_positional_paths_never_infer_roles(self):
        error = self.assert_argument_rejected(
            [
                "preprocess",
                SENSITIVE_NAME,
                "--output-dir",
                "ignored-output",
            ]
        )
        self.assertNotIn(SENSITIVE_NAME, error)
        self.assertNotIn("ignored-output", error)

    def test_annual_and_overlap_roles_remain_independent(self):
        selection = self.capture_selection(
            [
                "preprocess",
                "--overlap-verification",
                "same-looking-name",
                "--annual-source",
                "same-looking-name",
                "--output-dir",
                "ignored-output",
            ]
        )
        self.assertEqual(
            selection.annual_sources,
            (Path("same-looking-name"),),
        )
        self.assertEqual(
            selection.overlap_verifications,
            (Path("same-looking-name"),),
        )


class IsolatedGitPreflightTestCase(unittest.TestCase):
    def setUp(self):
        self.temporary_directory = tempfile.TemporaryDirectory(
            prefix="chat-analysis-stage2a-"
        )
        self.addCleanup(self.temporary_directory.cleanup)
        self.root = Path(self.temporary_directory.name)
        self.git("init", "--quiet")
        (self.root / ".gitignore").write_text(
            "ignored/\ntracked-output/\n",
            encoding="utf-8",
        )

    def git(
        self,
        *arguments: str,
        input_bytes: bytes | None = None,
    ) -> subprocess.CompletedProcess[bytes]:
        return subprocess.run(
            [GIT_EXECUTABLE, "-C", os.fspath(self.root), *arguments],
            check=True,
            input=input_bytes,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )

    def source(
        self,
        name: str = "synthetic-source.bin",
        content: bytes = b"not-json-and-not-read",
    ) -> Path:
        path = self.root / name
        path.write_bytes(content)
        return path

    def ignored_output(self) -> Path:
        return self.root / "ignored" / "dataset"

    def selection(
        self,
        *,
        annual_sources: tuple[Path, ...] | None = None,
        overlap_verifications: tuple[Path, ...] = (),
        output_directory: Path | None = None,
    ) -> InputSelection:
        selected_annual_sources = (
            (self.source(),)
            if annual_sources is None
            else annual_sources
        )
        selected_output = (
            self.ignored_output()
            if output_directory is None
            else output_directory
        )
        return InputSelection(
            annual_sources=selected_annual_sources,
            overlap_verifications=overlap_verifications,
            output_directory=selected_output,
        )

    def assert_rejected(self, selection: InputSelection) -> InputPreflightError:
        with self.assertRaises(InputPreflightError) as raised:
            preflight_inputs(selection)
        self.assertEqual(
            raised.exception.public_payload(),
            {
                "category": "input-validation",
                "phase": "input-preflight",
                "reasonCode": "INPUT_PREFLIGHT_FAILED",
            },
        )
        return raised.exception


class SourcePreflightTests(IsolatedGitPreflightTestCase):
    def test_readable_regular_file_passes_without_json_validation(self):
        source = self.source(content=b"\xff malformed and deliberately unread")
        result = preflight_inputs(
            self.selection(annual_sources=(source,))
        )
        self.assertEqual(result.annual_sources, (source.resolve(strict=True),))

    def test_preflight_preserves_source_order_for_both_roles(self):
        annual_b = self.source("annual-b")
        annual_a = self.source("annual-a")
        verification_b = self.source("verification-b")
        verification_a = self.source("verification-a")
        result = preflight_inputs(
            self.selection(
                annual_sources=(annual_b, annual_a),
                overlap_verifications=(verification_b, verification_a),
            )
        )
        self.assertEqual(
            result.annual_sources,
            (annual_b.resolve(), annual_a.resolve()),
        )
        self.assertEqual(
            result.overlap_verifications,
            (verification_b.resolve(), verification_a.resolve()),
        )

    def test_missing_source_is_rejected(self):
        self.assert_rejected(
            self.selection(annual_sources=(self.root / "missing-source",))
        )

    def test_directory_source_is_rejected(self):
        directory = self.root / "source-directory"
        directory.mkdir()
        self.assert_rejected(self.selection(annual_sources=(directory,)))

    def test_fifo_source_is_rejected(self):
        fifo = self.root / "source-fifo"
        os.mkfifo(fifo)
        self.assert_rejected(self.selection(annual_sources=(fifo,)))

    def test_unix_socket_source_is_rejected(self):
        short_directory = Path(
            tempfile.mkdtemp(prefix="cha-stage2a-", dir="/tmp")
        )
        socket_path = short_directory / "s"
        local_socket = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        try:
            local_socket.bind(os.fspath(socket_path))
            local_socket.close()
            self.assert_rejected(self.selection(annual_sources=(socket_path,)))
        finally:
            local_socket.close()
            if os.path.lexists(socket_path):
                socket_path.unlink()
            short_directory.rmdir()

    def test_unreadable_source_is_rejected(self):
        source = self.source()
        source.chmod(0)
        try:
            self.assert_rejected(self.selection(annual_sources=(source,)))
        finally:
            source.chmod(stat.S_IRUSR | stat.S_IWUSR)

    def test_symlink_source_is_rejected(self):
        source = self.source()
        symlink = self.root / "source-symlink"
        symlink.symlink_to(source)
        self.assert_rejected(self.selection(annual_sources=(symlink,)))

    def test_source_error_output_contains_no_sensitive_path_or_name(self):
        missing = self.root / SENSITIVE_NAME
        stdout = io.StringIO()
        stderr = io.StringIO()
        with redirect_stdout(stdout), redirect_stderr(stderr):
            exit_code = _run_for_test(
                [
                    "preprocess",
                    "--annual-source",
                    os.fspath(missing),
                    "--output-dir",
                    os.fspath(self.ignored_output()),
                ],
                lambda: None,
                preflight_inputs,
            )
        self.assertEqual(exit_code, 65)
        self.assertEqual(stdout.getvalue(), "")
        self.assertEqual(
            json.loads(stderr.getvalue()),
            {
                "category": "input-validation",
                "phase": "input-preflight",
                "reasonCode": "INPUT_PREFLIGHT_FAILED",
            },
        )
        self.assertNotIn(SENSITIVE_NAME, stderr.getvalue())
        self.assertNotIn(os.fspath(self.root), stderr.getvalue())

    def test_preflight_never_reads_source_body(self):
        source = self.source(content=b"body-read-sentinel")
        with (
            patch("builtins.open", side_effect=AssertionError("body read")),
            patch.object(
                Path,
                "read_bytes",
                side_effect=AssertionError("body read"),
            ),
            patch.object(
                Path,
                "read_text",
                side_effect=AssertionError("body read"),
            ),
        ):
            result = preflight_inputs(
                self.selection(annual_sources=(source,))
            )
        self.assertEqual(result.annual_sources, (source.resolve(),))

    def test_failure_does_not_modify_a_preflighted_source(self):
        source = self.source(content=b"immutable-synthetic-source")
        original_content = source.read_bytes()
        original_metadata = source.stat()
        self.assert_rejected(
            self.selection(
                annual_sources=(source, self.root / "missing-source")
            )
        )
        final_metadata = source.stat()
        self.assertEqual(source.read_bytes(), original_content)
        self.assertEqual(final_metadata.st_size, original_metadata.st_size)
        self.assertEqual(final_metadata.st_mode, original_metadata.st_mode)
        self.assertEqual(final_metadata.st_mtime_ns, original_metadata.st_mtime_ns)


class OutputPolicyTests(IsolatedGitPreflightTestCase):
    def assert_rejected(self, selection: InputSelection) -> InputPreflightError:
        with self.assertRaises(InputPreflightError) as raised:
            preflight_inputs(selection)
        self.assertEqual(
            raised.exception.public_payload(),
            {
                "category": "ignore-policy",
                "phase": "input-preflight",
                "reasonCode": "OUTPUT_IGNORE_POLICY_FAILED",
            },
        )
        return raised.exception

    def test_nonexistent_git_ignored_output_target_passes_without_creation(self):
        output = self.ignored_output()
        self.assertFalse(output.exists())
        result = preflight_inputs(self.selection(output_directory=output))
        self.assertEqual(
            result.output_directory,
            output.resolve(strict=False),
        )
        self.assertFalse(output.exists())

    def test_existing_git_ignored_directory_passes_metadata_preflight(self):
        output = self.ignored_output()
        output.mkdir(parents=True)
        result = preflight_inputs(self.selection(output_directory=output))
        self.assertEqual(result.output_directory, output.resolve(strict=True))

    def test_tracked_output_directory_is_rejected_even_if_ignore_matches(self):
        output = self.root / "tracked-output"
        output.mkdir()
        marker = output / "tracked-marker"
        marker.write_bytes(b"synthetic")
        object_id = self.git(
            "hash-object",
            "-w",
            "--stdin",
            input_bytes=b"synthetic",
        ).stdout.decode("ascii").strip()
        self.git(
            "update-index",
            "--add",
            "--cacheinfo",
            "100644",
            object_id,
            "tracked-output/tracked-marker",
        )
        self.assert_rejected(self.selection(output_directory=output))

    def test_unignored_output_target_is_rejected(self):
        output = self.root / "not-ignored" / "dataset"
        self.assert_rejected(self.selection(output_directory=output))
        self.assertFalse(output.exists())

    def test_symlink_output_target_is_rejected(self):
        ignored_parent = self.root / "ignored"
        ignored_parent.mkdir()
        real_directory = ignored_parent / "real-directory"
        real_directory.mkdir()
        symlink = ignored_parent / "linked-dataset"
        symlink.symlink_to(real_directory, target_is_directory=True)
        self.assert_rejected(self.selection(output_directory=symlink))

    def test_symlink_output_ancestor_escape_is_rejected(self):
        ignored_parent = self.root / "ignored"
        ignored_parent.mkdir()
        unignored_directory = self.root / "outside-ignore-boundary"
        unignored_directory.mkdir()
        linked_parent = ignored_parent / "linked-parent"
        linked_parent.symlink_to(unignored_directory, target_is_directory=True)
        output = linked_parent / "dataset"
        self.assert_rejected(self.selection(output_directory=output))
        self.assertFalse(output.exists())

    def test_symlink_cannot_escape_to_another_ignored_repository(self):
        ignored_parent = self.root / "ignored"
        ignored_parent.mkdir()
        other_repository = self.root / "other-repository"
        other_repository.mkdir()
        subprocess.run(
            [GIT_EXECUTABLE, "-C", os.fspath(other_repository), "init", "--quiet"],
            check=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        (other_repository / ".gitignore").write_text(
            "ignored/\n",
            encoding="utf-8",
        )
        other_ignored = other_repository / "ignored"
        other_ignored.mkdir()
        linked_parent = ignored_parent / "linked-repository"
        linked_parent.symlink_to(other_ignored, target_is_directory=True)
        output = linked_parent / "dataset"
        self.assert_rejected(self.selection(output_directory=output))
        self.assertFalse(output.exists())

    def test_git_ignore_failure_is_content_free(self):
        source = self.source()
        with tempfile.TemporaryDirectory(
            prefix="chat-analysis-no-repository-"
        ) as other_directory:
            output = Path(other_directory) / SENSITIVE_NAME
            stdout = io.StringIO()
            stderr = io.StringIO()
            with redirect_stdout(stdout), redirect_stderr(stderr):
                exit_code = _run_for_test(
                    [
                        "preprocess",
                        "--annual-source",
                        os.fspath(source),
                        "--output-dir",
                        os.fspath(output),
                    ],
                    lambda: None,
                    preflight_inputs,
                )
        self.assertEqual(exit_code, 66)
        self.assertEqual(stdout.getvalue(), "")
        self.assertEqual(
            json.loads(stderr.getvalue()),
            {
                "category": "ignore-policy",
                "phase": "input-preflight",
                "reasonCode": "OUTPUT_IGNORE_POLICY_FAILED",
            },
        )
        self.assertNotIn(SENSITIVE_NAME, stderr.getvalue())
        self.assertNotIn(os.fspath(output), stderr.getvalue())

    def test_failed_output_preflight_creates_no_intermediate_artifact(self):
        source = self.source()
        output = self.root / "unignored-sensitive-output"
        before = {
            path.relative_to(self.root)
            for path in self.root.rglob("*")
        }
        self.assert_rejected(
            self.selection(
                annual_sources=(source,),
                output_directory=output,
            )
        )
        after = {
            path.relative_to(self.root)
            for path in self.root.rglob("*")
        }
        self.assertEqual(after, before)
        self.assertFalse(output.exists())


class CompositionRootPreflightTests(unittest.TestCase):
    def test_startup_gate_precedes_preflight_in_production_composition(self):
        calls: list[str] = []
        selection = InputSelection(
            annual_sources=(Path("synthetic-source"),),
            overlap_verifications=(),
            output_directory=Path("synthetic-output"),
        )
        expected = object()

        class OrderedGate:
            def verify(self):
                calls.append("startup-gate")

        def ordered_preflight(observed: InputSelection):
            self.assertIs(observed, selection)
            calls.append("input-preflight")
            return expected

        with (
            patch(
                "chat_history_analysis.application.StartupGate",
                return_value=OrderedGate(),
            ),
            patch(
                "chat_history_analysis.application.preflight_inputs",
                side_effect=ordered_preflight,
            ),
        ):
            result = run_input_preflight(selection)

        self.assertIs(result, expected)
        self.assertEqual(calls, ["startup-gate", "input-preflight"])

    def test_failed_startup_gate_prevents_all_path_metadata_access(self):
        selection = InputSelection(
            annual_sources=(Path(SENSITIVE_NAME),),
            overlap_verifications=(),
            output_directory=Path("synthetic-output"),
        )

        class FailingGate:
            def verify(self):
                raise StartupError(
                    StartupReasonCode.IJSON_PARSER_INITIALIZATION_FAILED
                )

        with (
            patch(
                "chat_history_analysis.application.StartupGate",
                return_value=FailingGate(),
            ),
            patch(
                "chat_history_analysis.application.preflight_inputs"
            ) as preflight,
        ):
            with self.assertRaises(StartupError):
                run_input_preflight(selection)
        preflight.assert_not_called()


if __name__ == "__main__":
    unittest.main()
