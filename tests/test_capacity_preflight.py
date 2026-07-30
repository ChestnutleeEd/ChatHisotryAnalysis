from __future__ import annotations

from contextlib import redirect_stderr, redirect_stdout
import io
import json
import os
from pathlib import Path
import socket
import subprocess
import tempfile
import unittest
from unittest.mock import Mock, patch

from chat_history_analysis.application import run_input_preflight
from chat_history_analysis.cli import _run_for_test
from chat_history_analysis.errors import (
    InputPreflightError,
    InputPreflightReasonCode,
    StartupError,
    StartupReasonCode,
)
import chat_history_analysis.input_preflight as preflight_module
from chat_history_analysis.input_preflight import (
    GIT_EXECUTABLE,
    MAX_AGGREGATE_RAW_INPUT_BYTES,
    MAX_ANNUAL_SOURCES,
    MAX_RAW_INPUT_BYTES,
    InputSelection,
    preflight_inputs,
)


SENSITIVE_FRAGMENT = "private-path-injection-do-not-echo"


class CapacityPreflightTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory(
            prefix="chat-analysis-stage2b-",
            dir="/tmp",
        )
        self.addCleanup(self.temporary_directory.cleanup)
        self.root = Path(self.temporary_directory.name)
        subprocess.run(
            [GIT_EXECUTABLE, "-C", os.fspath(self.root), "init", "--quiet"],
            check=True,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        (self.root / ".gitignore").write_text(
            "ignored/\n",
            encoding="utf-8",
        )
        self.output_directory = self.root / "ignored" / "dataset"
        self._source_ordinal = 0

    def sparse_source(
        self,
        size_bytes: int,
        *,
        name: str | None = None,
    ) -> Path:
        self._source_ordinal += 1
        path = self.root / (
            name or f"synthetic-capacity-{self._source_ordinal}.bin"
        )
        path.touch()
        os.truncate(path, size_bytes)
        return path

    def selection(
        self,
        annual_sources: tuple[Path, ...],
        overlap_verifications: tuple[Path, ...] = (),
    ) -> InputSelection:
        return InputSelection(
            annual_sources=annual_sources,
            overlap_verifications=overlap_verifications,
            output_directory=self.output_directory,
        )

    def assert_rejected(
        self,
        selection: InputSelection,
        reason_code: InputPreflightReasonCode,
    ) -> InputPreflightError:
        with self.assertRaises(InputPreflightError) as raised:
            preflight_inputs(selection)
        self.assertEqual(raised.exception.reason_code, reason_code)
        self.assertEqual(
            raised.exception.public_payload(),
            {
                "category": (
                    "input-validation"
                    if reason_code
                    is InputPreflightReasonCode.INPUT_PREFLIGHT_FAILED
                    else "capacity"
                ),
                "phase": "input-preflight",
                "reasonCode": reason_code.value,
            },
        )
        return raised.exception

    def test_zero_byte_regular_file_passes_capacity_preflight(self) -> None:
        source = self.sparse_source(0)
        result = preflight_inputs(self.selection((source,)))
        self.assertEqual(result.annual_sources, (source.resolve(),))

    def test_exact_per_file_limit_is_accepted(self) -> None:
        source = self.sparse_source(MAX_RAW_INPUT_BYTES)
        result = preflight_inputs(self.selection((source,)))
        self.assertEqual(result.annual_sources, (source.resolve(),))

    def test_first_byte_over_per_file_limit_is_rejected(self) -> None:
        source = self.sparse_source(MAX_RAW_INPUT_BYTES + 1)
        self.assert_rejected(
            self.selection((source,)),
            InputPreflightReasonCode.RAW_INPUT_FILE_LIMIT_EXCEEDED,
        )

    def test_oversized_annual_source_is_rejected(self) -> None:
        source = self.sparse_source(MAX_RAW_INPUT_BYTES + 1)
        self.assert_rejected(
            self.selection((source,)),
            InputPreflightReasonCode.RAW_INPUT_FILE_LIMIT_EXCEEDED,
        )

    def test_oversized_overlap_source_is_rejected(self) -> None:
        annual = self.sparse_source(0)
        overlap = self.sparse_source(MAX_RAW_INPUT_BYTES + 1)
        self.assert_rejected(
            self.selection((annual,), (overlap,)),
            InputPreflightReasonCode.RAW_INPUT_FILE_LIMIT_EXCEEDED,
        )

    def test_any_oversized_source_rejects_a_multi_file_selection(self) -> None:
        annual_a = self.sparse_source(1)
        annual_b = self.sparse_source(MAX_RAW_INPUT_BYTES + 1)
        overlap = self.sparse_source(1)
        self.assert_rejected(
            self.selection((annual_a, annual_b), (overlap,)),
            InputPreflightReasonCode.RAW_INPUT_FILE_LIMIT_EXCEEDED,
        )

    def test_capacity_error_does_not_disclose_sensitive_input(self) -> None:
        source = self.sparse_source(
            MAX_RAW_INPUT_BYTES + 1,
            name=f"{SENSITIVE_FRAGMENT}.bin",
        )
        stdout = io.StringIO()
        stderr = io.StringIO()
        with redirect_stdout(stdout), redirect_stderr(stderr):
            exit_code = _run_for_test(
                [
                    "preprocess",
                    "--annual-source",
                    os.fspath(source),
                    "--output-dir",
                    os.fspath(self.output_directory),
                ],
                lambda: None,
                preflight_inputs,
            )
        self.assertEqual(exit_code, 67)
        self.assertEqual(stdout.getvalue(), "")
        self.assertEqual(
            json.loads(stderr.getvalue()),
            {
                "category": "capacity",
                "phase": "input-preflight",
                "reasonCode": "RAW_INPUT_FILE_LIMIT_EXCEEDED",
            },
        )
        self.assertNotIn(SENSITIVE_FRAGMENT, stderr.getvalue())
        self.assertNotIn(source.name, stderr.getvalue())
        self.assertNotIn(os.fspath(self.root), stderr.getvalue())

    def test_one_annual_source_is_accepted(self) -> None:
        source = self.sparse_source(1)
        result = preflight_inputs(self.selection((source,)))
        self.assertEqual(len(result.annual_sources), 1)

    def test_exact_annual_source_count_is_accepted(self) -> None:
        annual_sources = tuple(
            self.sparse_source(0) for _ in range(MAX_ANNUAL_SOURCES)
        )
        result = preflight_inputs(self.selection(annual_sources))
        self.assertEqual(len(result.annual_sources), MAX_ANNUAL_SOURCES)

    def test_first_annual_source_over_count_limit_is_rejected(self) -> None:
        annual_sources = tuple(
            self.sparse_source(0) for _ in range(MAX_ANNUAL_SOURCES + 1)
        )
        self.assert_rejected(
            self.selection(annual_sources),
            InputPreflightReasonCode.ANNUAL_SOURCE_COUNT_LIMIT_EXCEEDED,
        )

    def test_overlap_sources_do_not_count_as_annual_sources(self) -> None:
        annual_sources = tuple(
            self.sparse_source(0) for _ in range(MAX_ANNUAL_SOURCES)
        )
        overlap_sources = tuple(self.sparse_source(0) for _ in range(21))
        result = preflight_inputs(
            self.selection(annual_sources, overlap_sources)
        )
        self.assertEqual(len(result.annual_sources), MAX_ANNUAL_SOURCES)
        self.assertEqual(len(result.overlap_verifications), 21)

    def test_capacity_preflight_preserves_both_role_orders(self) -> None:
        annual_sources = (
            self.sparse_source(3, name="annual-c"),
            self.sparse_source(2, name="annual-a"),
            self.sparse_source(1, name="annual-b"),
        )
        overlap_sources = (
            self.sparse_source(5, name="overlap-b"),
            self.sparse_source(4, name="overlap-a"),
        )
        result = preflight_inputs(
            self.selection(annual_sources, overlap_sources)
        )
        self.assertEqual(
            result.annual_sources,
            tuple(path.resolve() for path in annual_sources),
        )
        self.assertEqual(
            result.overlap_verifications,
            tuple(path.resolve() for path in overlap_sources),
        )

    def test_exact_aggregate_limit_is_accepted(self) -> None:
        annual_sources = tuple(
            self.sparse_source(MAX_RAW_INPUT_BYTES) for _ in range(4)
        )
        result = preflight_inputs(self.selection(annual_sources))
        self.assertEqual(len(result.annual_sources), 4)

    def test_first_byte_over_aggregate_limit_is_rejected(self) -> None:
        annual_sources = tuple(
            self.sparse_source(MAX_RAW_INPUT_BYTES) for _ in range(4)
        )
        overlap = self.sparse_source(1)
        self.assert_rejected(
            self.selection(annual_sources, (overlap,)),
            InputPreflightReasonCode.AGGREGATE_RAW_INPUT_LIMIT_EXCEEDED,
        )

    def test_annual_only_sources_can_reach_exact_aggregate_limit(self) -> None:
        annual_sources = tuple(
            self.sparse_source(MAX_RAW_INPUT_BYTES) for _ in range(4)
        )
        result = preflight_inputs(self.selection(annual_sources))
        self.assertEqual(result.overlap_verifications, ())

    def test_mixed_roles_can_reach_exact_aggregate_limit(self) -> None:
        annual_sources = tuple(
            self.sparse_source(MAX_RAW_INPUT_BYTES) for _ in range(3)
        )
        overlap = self.sparse_source(MAX_RAW_INPUT_BYTES)
        result = preflight_inputs(
            self.selection(annual_sources, (overlap,))
        )
        self.assertEqual(len(result.annual_sources), 3)
        self.assertEqual(result.overlap_verifications, (overlap.resolve(),))

    def test_multiple_small_files_can_exceed_aggregate_limit(self) -> None:
        each_size = (MAX_AGGREGATE_RAW_INPUT_BYTES // 5) + 1
        annual_sources = tuple(
            self.sparse_source(each_size) for _ in range(5)
        )
        self.assertLess(each_size, MAX_RAW_INPUT_BYTES)
        self.assert_rejected(
            self.selection(annual_sources),
            InputPreflightReasonCode.AGGREGATE_RAW_INPUT_LIMIT_EXCEEDED,
        )

    def test_aggregate_arithmetic_has_no_float_or_integer_truncation(self) -> None:
        annual_sources = tuple(
            self.sparse_source(MAX_RAW_INPUT_BYTES - 1) for _ in range(4)
        )
        overlap = self.sparse_source(4)
        result = preflight_inputs(
            self.selection(annual_sources, (overlap,))
        )
        self.assertEqual(len(result.annual_sources), 4)
        os.truncate(overlap, 5)
        self.assert_rejected(
            self.selection(annual_sources, (overlap,)),
            InputPreflightReasonCode.AGGREGATE_RAW_INPUT_LIMIT_EXCEEDED,
        )

    def test_failed_startup_gate_prevents_stat_and_size_access(self) -> None:
        selection = self.selection((Path(SENSITIVE_FRAGMENT),))

        class FailingGate:
            def verify(self) -> None:
                raise StartupError(
                    StartupReasonCode.IJSON_PARSER_INITIALIZATION_FAILED
                )

        with (
            patch(
                "chat_history_analysis.application.StartupGate",
                return_value=FailingGate(),
            ),
            patch.object(preflight_module.os, "lstat") as lstat_mock,
            patch.object(preflight_module.os, "stat") as stat_mock,
        ):
            with self.assertRaises(StartupError):
                run_input_preflight(selection)
        lstat_mock.assert_not_called()
        stat_mock.assert_not_called()

    def test_argument_failure_precedes_all_source_metadata_access(self) -> None:
        invalid_selection = InputSelection(
            annual_sources=(),
            overlap_verifications=(),
            output_directory=self.output_directory,
        )
        with (
            patch.object(preflight_module.os, "lstat") as lstat_mock,
            patch.object(preflight_module.os, "stat") as stat_mock,
        ):
            self.assert_rejected(
                invalid_selection,
                InputPreflightReasonCode.INPUT_PREFLIGHT_FAILED,
            )
        lstat_mock.assert_not_called()
        stat_mock.assert_not_called()

    def test_preflight_never_opens_or_reads_source_content(self) -> None:
        annual = self.sparse_source(17)
        overlap = self.sparse_source(19)
        with (
            patch("builtins.open", side_effect=AssertionError("body open")),
            patch.object(Path, "open", side_effect=AssertionError("body open")),
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
                self.selection((annual,), (overlap,))
            )
        self.assertEqual(result.annual_sources, (annual.resolve(),))
        self.assertEqual(result.overlap_verifications, (overlap.resolve(),))

    def test_success_does_not_modify_source_content_or_metadata(self) -> None:
        source = self.root / "immutable-synthetic-source.bin"
        source.write_bytes(b"synthetic-content-only")
        before_content = source.read_bytes()
        before = source.stat()
        preflight_inputs(self.selection((source,)))
        after = source.stat()
        self.assertEqual(source.read_bytes(), before_content)
        self.assertEqual(after.st_size, before.st_size)
        self.assertEqual(after.st_mode, before.st_mode)
        self.assertEqual(after.st_mtime_ns, before.st_mtime_ns)
        self.assertEqual((after.st_dev, after.st_ino), (before.st_dev, before.st_ino))

    def test_capacity_failure_creates_no_output_or_intermediate_artifact(
        self,
    ) -> None:
        source = self.sparse_source(MAX_RAW_INPUT_BYTES + 1)
        before = {
            path.relative_to(self.root)
            for path in self.root.rglob("*")
        }
        self.assert_rejected(
            self.selection((source,)),
            InputPreflightReasonCode.RAW_INPUT_FILE_LIMIT_EXCEEDED,
        )
        after = {
            path.relative_to(self.root)
            for path in self.root.rglob("*")
        }
        self.assertEqual(after, before)
        self.assertFalse(self.output_directory.exists())

    def test_size_change_before_final_revalidation_fails_closed(self) -> None:
        source = self.sparse_source(10)
        real_output_preflight = preflight_module._preflight_output_directory

        def mutate_size(path: Path) -> Path:
            result = real_output_preflight(path)
            os.truncate(source, 11)
            return result

        with patch.object(
            preflight_module,
            "_preflight_output_directory",
            side_effect=mutate_size,
        ):
            self.assert_rejected(
                self.selection((source,)),
                InputPreflightReasonCode.INPUT_PREFLIGHT_FAILED,
            )

    def test_inode_change_before_final_revalidation_fails_closed(self) -> None:
        source = self.sparse_source(10)
        replacement = self.sparse_source(10, name="replacement-source.bin")
        real_output_preflight = preflight_module._preflight_output_directory

        def replace_source(path: Path) -> Path:
            result = real_output_preflight(path)
            os.replace(replacement, source)
            return result

        with patch.object(
            preflight_module,
            "_preflight_output_directory",
            side_effect=replace_source,
        ):
            self.assert_rejected(
                self.selection((source,)),
                InputPreflightReasonCode.INPUT_PREFLIGHT_FAILED,
            )

    def test_non_regular_sources_remain_rejected(self) -> None:
        regular = self.sparse_source(0)
        symlink = self.root / "synthetic-symlink"
        symlink.symlink_to(regular)
        fifo = self.root / "synthetic-fifo"
        os.mkfifo(fifo)
        socket_path = self.root / "synthetic-socket"
        local_socket = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        try:
            local_socket.bind(os.fspath(socket_path))
            for candidate in (symlink, fifo, socket_path):
                with self.subTest(candidate_type=candidate.name):
                    self.assert_rejected(
                        self.selection((candidate,)),
                        InputPreflightReasonCode.INPUT_PREFLIGHT_FAILED,
                    )
        finally:
            local_socket.close()

    def test_device_source_remains_rejected(self) -> None:
        device = Path("/dev/null")
        self.assertTrue(device.exists())
        self.assert_rejected(
            self.selection((device,)),
            InputPreflightReasonCode.INPUT_PREFLIGHT_FAILED,
        )

    def test_capacity_reason_codes_are_content_independent(self) -> None:
        sources = (
            self.sparse_source(
                MAX_RAW_INPUT_BYTES + 1,
                name=f"{SENSITIVE_FRAGMENT}-a.bin",
            ),
            self.sparse_source(
                MAX_RAW_INPUT_BYTES + 1,
                name=f"{SENSITIVE_FRAGMENT}-b.bin",
            ),
        )
        payloads = [
            self.assert_rejected(
                self.selection((source,)),
                InputPreflightReasonCode.RAW_INPUT_FILE_LIMIT_EXCEEDED,
            ).public_payload()
            for source in sources
        ]
        self.assertEqual(payloads[0], payloads[1])
        serialized = json.dumps(payloads, sort_keys=True)
        self.assertNotIn(SENSITIVE_FRAGMENT, serialized)
        self.assertNotIn(os.fspath(self.root), serialized)

    def test_duplicate_path_selections_count_each_occurrence(self) -> None:
        source = self.sparse_source(450_000_000)
        self.assert_rejected(
            self.selection((source,), (source, source, source, source)),
            InputPreflightReasonCode.AGGREGATE_RAW_INPUT_LIMIT_EXCEEDED,
        )
        self.assert_rejected(
            self.selection((source,) * (MAX_ANNUAL_SOURCES + 1)),
            InputPreflightReasonCode.ANNUAL_SOURCE_COUNT_LIMIT_EXCEEDED,
        )

    def test_source_validation_precedes_annual_count(self) -> None:
        regular = self.sparse_source(0)
        fifo = self.root / "late-synthetic-fifo"
        os.mkfifo(fifo)
        sources = (regular,) * MAX_ANNUAL_SOURCES + (fifo,)
        self.assert_rejected(
            self.selection(sources),
            InputPreflightReasonCode.INPUT_PREFLIGHT_FAILED,
        )

    def test_cli_argument_failure_does_not_call_preflight(self) -> None:
        runner = Mock()
        with redirect_stdout(io.StringIO()), redirect_stderr(io.StringIO()):
            exit_code = _run_for_test(
                [
                    "preprocess",
                    "--output-dir",
                    os.fspath(self.output_directory),
                ],
                lambda: None,
                runner,
            )
        self.assertEqual(exit_code, 64)
        runner.assert_not_called()


if __name__ == "__main__":
    unittest.main()
