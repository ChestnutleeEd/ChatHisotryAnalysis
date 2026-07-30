from __future__ import annotations

import hashlib
import os
from pathlib import Path
import signal
import tempfile
import unittest
from unittest.mock import patch

from chat_history_analysis.application import run_preprocessing
from chat_history_analysis.backend import BackendEvidence
from chat_history_analysis.dataset_persistence import (
    DatasetPersistenceError,
    DatasetPersistenceReasonCode,
    STAGING_PREFIX,
    _atomic_rename_exclusive,
    _remove_stage_entries,
    verify_dataset_directory,
)
from chat_history_analysis.errors import (
    CancellationError,
    FailureCategory,
    OUTPUT_PROMOTION_PHASE,
)
from chat_history_analysis.input_preflight import (
    InputSelection,
    PreflightedInputs,
)
from chat_history_analysis.operation_control import (
    OperationControl,
    install_sigint_handler,
    use_operation_control,
)


SENSITIVE = "private-progress-secret"
EXPECTED_PHASES = (
    "startup",
    "input-preflight",
    "source-digest",
    "source-validation",
    "session-validation",
    "source-staging",
    "dataset-staging",
    "output-serialization",
    "output-verification",
    "output-promotion",
)
PROGRESS_FIELDS = frozenset(
    {
        "aggregateCount",
        "capacityValue",
        "event",
        "percentage",
        "phase",
        "role",
        "sourceOrdinal",
        "status",
    }
)


class SyntheticParserError(Exception):
    pass


def _events(value: object, prefix: str = ""):
    if isinstance(value, dict):
        yield prefix, "start_map", None
        for key, nested in value.items():
            yield prefix, "map_key", key
            child = f"{prefix}.{key}" if prefix else key
            yield from _events(nested, child)
        yield prefix, "end_map", None
        return
    if isinstance(value, list):
        yield prefix, "start_array", None
        for nested in value:
            child = f"{prefix}.item" if prefix else "item"
            yield from _events(nested, child)
        yield prefix, "end_array", None
        return
    if value is None:
        event = "null"
    elif isinstance(value, bool):
        event = "boolean"
    elif isinstance(value, (int, float)):
        event = "number"
    else:
        event = "string"
    yield prefix, event, value


def _document() -> dict[str, object]:
    return {
        "exportInfo": {"format": "detailed-json"},
        "session": {
            "isGroup": False,
            "type": "私聊",
            "platform": "synthetic-platform",
            "ownerId": "synthetic-owner",
            "wxid": "synthetic-peer",
        },
        "messages": [
            {
                "createTime": 0,
                "formattedTime": "1970-01-01 08:00:00",
                "senderUsername": "synthetic-owner",
                "content": "synthetic alpha",
                "chatLabType": 0,
                "type": "文本消息",
                "localType": 1,
                "isSend": 1,
                "platformMessageId": "synthetic-primary-1",
            },
            {
                "createTime": 1,
                "formattedTime": "1970-01-01 08:00:01",
                "senderUsername": "synthetic-peer",
                "content": "synthetic beta",
                "chatLabType": 0,
                "type": "文本消息",
                "localType": 1,
                "isSend": 0,
                "platformMessageId": "synthetic-primary-2",
            },
        ],
    }


def _backend() -> BackendEvidence:
    document = _document()

    def parse(reader, **options):
        if options != {
            "use_float": False,
            "multiple_values": False,
            "allow_comments": False,
            "buf_size": 65_536,
        }:
            raise SyntheticParserError
        while reader.read(17):
            pass
        yield from _events(document)

    return BackendEvidence(
        module_name="ijson.backends.yajl2_c",
        backend_name="yajl2_c",
        selected_backend_name="yajl2_c",
        selected_parse_matches=True,
        module_origin_matches_distribution=True,
        native_origin_matches_distribution=True,
        parser_error_origin_matches_distribution=True,
        parse=parse,
        parser_error_types=(SyntheticParserError,),
    )


class _Gate:
    def verify(self) -> BackendEvidence:
        return _backend()


class ProgressCancellationTests(unittest.TestCase):
    def setUp(self) -> None:
        temporary = tempfile.TemporaryDirectory(
            prefix="chat-analysis-stage7-",
            dir="/tmp",
        )
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name).resolve()
        self.source = self.root / f"{SENSITIVE}.json"
        self.source.write_text(
            f"synthetic bytes {SENSITIVE} https://invalid.example/private",
            encoding="utf-8",
        )
        self.source_hash = hashlib.sha256(self.source.read_bytes()).hexdigest()
        self.selection = InputSelection(
            annual_sources=(self.source,),
            overlap_verifications=(),
            output_directory=self.root / "dataset",
        )
        self.inputs = PreflightedInputs(
            annual_sources=(self.source,),
            overlap_verifications=(),
            output_directory=self.selection.output_directory,
        )

    def _run(
        self,
        control: OperationControl,
        destination: Path | None = None,
    ):
        selected_destination = destination or self.selection.output_directory
        selection = InputSelection(
            annual_sources=(self.source,),
            overlap_verifications=(),
            output_directory=selected_destination,
        )
        inputs = PreflightedInputs(
            annual_sources=(self.source,),
            overlap_verifications=(),
            output_directory=selected_destination,
        )
        with (
            patch(
                "chat_history_analysis.application.StartupGate",
                return_value=_Gate(),
            ),
            patch(
                "chat_history_analysis.application.preflight_inputs",
                return_value=inputs,
            ),
            use_operation_control(control),
        ):
            return run_preprocessing(selection)

    def _stage_entries(self) -> list[Path]:
        return sorted(
            (
                path
                for path in self.root.iterdir()
                if path.name.startswith(STAGING_PREFIX)
            ),
            key=lambda path: path.name,
        )

    def assert_source_unchanged(self) -> None:
        self.assertEqual(
            hashlib.sha256(self.source.read_bytes()).hexdigest(),
            self.source_hash,
        )

    def test_production_progress_is_ordered_monotonic_and_content_free(
        self,
    ) -> None:
        events: list[dict[str, str | int]] = []
        result = self._run(OperationControl(progress_sink=events.append))
        self.assertEqual(result.dataset.normalized_record_count, 2)
        self.assertTrue(self.selection.output_directory.is_dir())
        verify_dataset_directory(self.selection.output_directory)
        self.assertTrue(events)
        percentages = [int(event["percentage"]) for event in events]
        self.assertEqual(percentages, sorted(percentages))
        self.assertEqual(percentages[-1], 100)
        observed_phases = tuple(dict.fromkeys(event["phase"] for event in events))
        self.assertEqual(observed_phases, EXPECTED_PHASES)
        for event in events:
            self.assertEqual(set(event).difference(PROGRESS_FIELDS), set())
            self.assertEqual(event["event"], "progress")
            self.assertIn(event["status"], {"running", "completed"})
            rendered = repr(event)
            self.assertNotIn(SENSITIVE, rendered)
            self.assertNotIn(self.source.name, rendered)
            self.assertNotIn(os.fspath(self.root), rendered)
            self.assertNotIn("http", rendered)
            self.assertNotIn(self.source_hash, rendered)
        for phase in EXPECTED_PHASES:
            phase_events = [event for event in events if event["phase"] == phase]
            counts = [int(event["aggregateCount"]) for event in phase_events]
            self.assertEqual(counts, sorted(counts))
            self.assertEqual(phase_events[-1]["status"], "completed")
        self.assert_source_unchanged()

    def test_controlled_cancellation_cleans_every_pre_promotion_phase(
        self,
    ) -> None:
        checkpoints = (
            "source-digest-block",
            "parser-event-boundary",
            "sqlite-record-boundary",
            "chunk-record-after",
            "disk-verification-line-after",
            "pre-promotion-cleanup-entry",
            "promotion-commit-boundary",
        )
        for index, checkpoint in enumerate(checkpoints):
            with self.subTest(checkpoint=checkpoint):
                destination = self.root / f"cancelled-{index}"
                control: OperationControl
                requested = False

                def hook(observed: str) -> None:
                    nonlocal requested
                    if observed == checkpoint and not requested:
                        requested = True
                        control.request_cancellation()

                control = OperationControl(checkpoint_hook=hook)
                with self.assertRaises(CancellationError) as raised:
                    self._run(control, destination)
                self.assertEqual(
                    raised.exception.reason_code.value,
                    "USER_CANCELLED",
                )
                self.assertTrue(requested)
                self.assertFalse(destination.exists())
                self.assertEqual(self._stage_entries(), [])
                self.assert_source_unchanged()
                rerun = self._run(OperationControl(), destination)
                self.assertEqual(rerun.dataset.normalized_record_count, 2)
                verify_dataset_directory(destination)

    def test_repeated_sigint_sets_one_stable_cancellation_outcome(self) -> None:
        control = OperationControl()
        previous = signal.getsignal(signal.SIGINT)
        with install_sigint_handler(control):
            os.kill(os.getpid(), signal.SIGINT)
            os.kill(os.getpid(), signal.SIGINT)
            with self.assertRaises(CancellationError) as raised:
                control.checkpoint("source-validation", "test-safe-boundary")
        self.assertIs(signal.getsignal(signal.SIGINT), previous)
        self.assertEqual(control.signal_count, 2)
        self.assertEqual(raised.exception.reason_code.value, "USER_CANCELLED")

    def test_cleanup_failure_is_fatal_output_and_leaves_only_recovery_state(
        self,
    ) -> None:
        control: OperationControl
        requested = False

        def hook(observed: str) -> None:
            nonlocal requested
            if observed == "chunk-record-after" and not requested:
                requested = True
                control.request_cancellation()

        control = OperationControl(checkpoint_hook=hook)
        cleanup_error = DatasetPersistenceError(
            DatasetPersistenceReasonCode.OUTPUT_CLEANUP_FAILED,
            phase=OUTPUT_PROMOTION_PHASE,
            category=FailureCategory.OUTPUT,
        )
        try:
            with (
                patch(
                    "chat_history_analysis.dataset_persistence._remove_stage_entries",
                    side_effect=cleanup_error,
                ),
                self.assertRaises(DatasetPersistenceError) as raised,
            ):
                self._run(control)
            self.assertEqual(
                raised.exception.reason_code,
                DatasetPersistenceReasonCode.OUTPUT_CLEANUP_FAILED,
            )
            self.assertFalse(self.selection.output_directory.exists())
            remnants = self._stage_entries()
            self.assertEqual(len(remnants), 1)
            self.assert_source_unchanged()
        finally:
            for remnant in self._stage_entries():
                _remove_stage_entries(remnant)

    def test_sigint_inside_atomic_promotion_finishes_valid_commit(self) -> None:
        events: list[dict[str, str | int]] = []
        control = OperationControl(progress_sink=events.append)

        def rename(source: Path, destination: Path) -> None:
            control.request_cancellation()
            control.request_cancellation()
            _atomic_rename_exclusive(source, destination)

        with patch(
            "chat_history_analysis.dataset_persistence._atomic_rename_exclusive",
            side_effect=rename,
        ):
            result = self._run(control)
        self.assertTrue(control.commit_started)
        self.assertEqual(control.signal_count, 2)
        self.assertEqual(result.dataset.normalized_record_count, 2)
        self.assertEqual(events[-1]["percentage"], 100)
        self.assertEqual(events[-1]["status"], "completed")
        verify_dataset_directory(self.selection.output_directory)
        self.assertEqual(self._stage_entries(), [])
        self.assert_source_unchanged()

    def test_existing_destination_is_never_removed_or_replaced(self) -> None:
        self._run(OperationControl())
        manifest = self.selection.output_directory / "manifest.json"
        before = hashlib.sha256(manifest.read_bytes()).hexdigest()
        with self.assertRaises(DatasetPersistenceError) as raised:
            self._run(OperationControl())
        self.assertEqual(
            raised.exception.reason_code,
            DatasetPersistenceReasonCode.OUTPUT_DESTINATION_EXISTS,
        )
        self.assertEqual(hashlib.sha256(manifest.read_bytes()).hexdigest(), before)
        verify_dataset_directory(self.selection.output_directory)
        self.assertEqual(self._stage_entries(), [])
        self.assert_source_unchanged()


if __name__ == "__main__":
    unittest.main()
