from __future__ import annotations

from contextlib import redirect_stderr, redirect_stdout
import hashlib
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from chat_history_analysis.application import run_preprocessing_validation
from chat_history_analysis.cli import _run_for_test
from chat_history_analysis.errors import (
    SourceValidationError,
    SourceValidationReasonCode,
)
from chat_history_analysis.input_preflight import (
    InputSelection,
    PreflightedInputs,
)
from chat_history_analysis.preprocessing_validation import (
    StagingConsumer,
    ValidatedSourceDescriptor,
    validate_preflighted_inputs,
)
from chat_history_analysis.source_validation import (
    SessionIdentity,
    canonical_session_serialization,
    conversation_fingerprint,
)
from tests.stage3_support import (
    HAS_IJSON,
    OWNER,
    PEER,
    backend_with_parse,
    export_document,
    message,
    real_backend,
    write_export,
)


SENSITIVE = "private-message-path-token-do-not-echo"


class CanonicalSessionFingerprintTests(unittest.TestCase):
    def test_length_prefixing_avoids_ambiguous_component_boundaries(self) -> None:
        first = SessionIdentity(
            platform="ab",
            owner_identity="c",
            peer_identity="d",
            participants=("c", "d"),
        )
        second = SessionIdentity(
            platform="a",
            owner_identity="bc",
            peer_identity="d",
            participants=("bc", "d"),
        )
        self.assertNotEqual(
            canonical_session_serialization(first),
            canonical_session_serialization(second),
        )
        self.assertNotEqual(
            conversation_fingerprint(first),
            conversation_fingerprint(second),
        )

    def test_fingerprint_is_stable_lowercase_sha256(self) -> None:
        identity = SessionIdentity(
            platform="synthetic-platform",
            owner_identity=OWNER,
            peer_identity=PEER,
            participants=tuple(sorted((OWNER, PEER))),
        )
        first = conversation_fingerprint(identity)
        second = conversation_fingerprint(identity)
        self.assertEqual(first, second)
        self.assertEqual(len(first), 64)
        self.assertEqual(first, first.lower())
        int(first, 16)


class RecordingConsumer(StagingConsumer):
    def __init__(self) -> None:
        self.annual: list[tuple[int, int | None, int]] = []
        self.verification: list[tuple[int, int]] = []
        self.complete_called = False
        self.abort_called = False

    def stage_annual_message(
        self,
        descriptor: ValidatedSourceDescriptor,
        source_array_index: int,
        message_value: dict[str, object],
        *,
        owner_identity: str,
        peer_identity: str,
    ) -> None:
        self.annual.append(
            (
                descriptor.supplied_ordinal,
                descriptor.file_rank,
                source_array_index,
            )
        )

    def observe_verification_message(
        self,
        descriptor: ValidatedSourceDescriptor,
        source_array_index: int,
        message_value: dict[str, object],
        *,
        owner_identity: str,
        peer_identity: str,
    ) -> None:
        self.verification.append(
            (descriptor.supplied_ordinal, source_array_index)
        )

    def complete(self) -> None:
        self.complete_called = True

    def abort(self) -> None:
        self.annual.clear()
        self.verification.clear()
        self.abort_called = True
        self.complete_called = False


@unittest.skipUnless(HAS_IJSON, "ijson==3.5.1 is required")
class StreamingValidationTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory(
            prefix="chat-analysis-stage3-",
            dir="/tmp",
        )
        self.addCleanup(self.temporary_directory.cleanup)
        self.root = Path(self.temporary_directory.name)
        self.output = self.root / "formal-output-must-not-exist"

    def inputs(
        self,
        annual: tuple[Path, ...],
        verification: tuple[Path, ...] = (),
    ) -> PreflightedInputs:
        return PreflightedInputs(
            annual_sources=annual,
            overlap_verifications=verification,
            output_directory=self.output,
        )

    def assert_failure(
        self,
        path: Path,
        expected: SourceValidationReasonCode,
    ) -> SourceValidationError:
        with self.assertRaises(SourceValidationError) as raised:
            validate_preflighted_inputs(
                self.inputs((path,)),
                real_backend(),
            )
        self.assertEqual(raised.exception.reason_code, expected)
        self.assertFalse(self.output.exists())
        serialized = json.dumps(
            raised.exception.public_payload(),
            sort_keys=True,
        )
        self.assertNotIn(os.fspath(path), serialized)
        self.assertNotIn(path.name, serialized)
        self.assertNotIn("Traceback", serialized)
        return raised.exception

    def test_public_fixture_streams_through_two_parser_passes(self) -> None:
        fixture = (
            Path(__file__).resolve().parents[1]
            / "data"
            / "mock"
            / "ciphertalk_detailed_chat_2025.json"
        )
        parser_calls = 0
        parse = real_backend().parse

        def counting_parse(*args: object, **kwargs: object):
            nonlocal parser_calls
            parser_calls += 1
            return parse(*args, **kwargs)

        result = validate_preflighted_inputs(
            self.inputs((fixture,)),
            backend_with_parse(counting_parse),
        )
        descriptor = result.annual_sources[0]
        with fixture.open("rb") as handle:
            expected_sha256 = hashlib.file_digest(handle, "sha256").hexdigest()
        self.assertEqual(parser_calls, 2)
        self.assertEqual(result.aggregate_raw_message_count, 5000)
        self.assertEqual(result.annual_staged_message_count, 5000)
        self.assertEqual(result.verification_streamed_message_count, 0)
        self.assertEqual(descriptor.raw_message_count, 5000)
        self.assertEqual(descriptor.minimum_create_time, 1735686720)
        self.assertEqual(descriptor.maximum_create_time, 1767195960)
        self.assertEqual(descriptor.file_rank, 0)
        self.assertEqual(descriptor.fingerprint.sha256, expected_sha256)
        self.assertEqual(descriptor.fingerprint.size_bytes, fixture.stat().st_size)
        rendered = repr(result)
        self.assertNotIn("刚开完会", rendered)
        self.assertNotIn(fixture.name, rendered)
        self.assertFalse(self.output.exists())

    def test_production_composition_carries_the_verified_backend(self) -> None:
        source = write_export(
            self.root / "composition.json",
            (message(10, OWNER), message(11, PEER)),
        )
        inputs = self.inputs((source,))
        expected = object()
        calls: list[str] = []
        backend = real_backend()

        class OrderedGate:
            def verify(self):
                calls.append("startup")
                return backend

        def ordered_preflight(selection: InputSelection) -> PreflightedInputs:
            calls.append("preflight")
            return inputs

        def ordered_validation(
            observed_inputs: PreflightedInputs,
            observed_backend: object,
        ) -> object:
            self.assertIs(observed_inputs, inputs)
            self.assertIs(observed_backend, backend)
            calls.append("streaming")
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
            patch(
                "chat_history_analysis.application.validate_preflighted_inputs",
                side_effect=ordered_validation,
            ),
        ):
            result = run_preprocessing_validation(
                InputSelection(
                    annual_sources=(source,),
                    overlap_verifications=(),
                    output_directory=self.output,
                )
            )
        self.assertIs(result, expected)
        self.assertEqual(calls, ["startup", "preflight", "streaming"])

    def test_ranked_annual_staging_and_verification_are_separate(self) -> None:
        later = write_export(
            self.root / "later.json",
            (message(100, OWNER), message(101, PEER)),
        )
        earlier = write_export(
            self.root / "earlier.json",
            (message(10, OWNER), message(11, PEER)),
        )
        verification = write_export(
            self.root / "verification.json",
            (message(10, OWNER), message(11, PEER)),
        )
        consumer = RecordingConsumer()
        result = validate_preflighted_inputs(
            self.inputs((later, earlier), (verification,)),
            real_backend(),
            staging_consumer=consumer,
        )
        self.assertEqual(
            [
                (
                    descriptor.supplied_ordinal,
                    descriptor.file_rank,
                )
                for descriptor in result.annual_sources
            ],
            [(2, 0), (1, 1)],
        )
        self.assertEqual(
            consumer.annual,
            [(2, 0, 0), (2, 0, 1), (1, 1, 0), (1, 1, 1)],
        )
        self.assertEqual(consumer.verification, [(1, 0), (1, 1)])
        self.assertTrue(consumer.complete_called)
        self.assertFalse(consumer.abort_called)
        self.assertEqual(result.aggregate_raw_message_count, 6)
        self.assertEqual(result.annual_staged_message_count, 4)
        self.assertEqual(result.verification_streamed_message_count, 2)

    def test_root_fields_may_arrive_in_a_different_order(self) -> None:
        path = self.root / "different-order.json"
        document = export_document((message(10, OWNER), message(11, PEER)))
        reordered = {
            "messages": document["messages"],
            "session": document["session"],
            "exportInfo": document["exportInfo"],
        }
        path.write_text(
            json.dumps(reordered, ensure_ascii=False),
            encoding="utf-8",
        )
        result = validate_preflighted_inputs(
            self.inputs((path,)),
            real_backend(),
        )
        self.assertEqual(result.aggregate_raw_message_count, 2)

    def test_malformed_truncated_comments_and_trailing_values_fail(self) -> None:
        cases = {
            "malformed": b'{"exportInfo":]',
            "truncated": b'{"exportInfo":{"format":"detailed-json"}',
            "comment": (
                b'{"exportInfo":/*synthetic*/{"format":"detailed-json"}}'
            ),
            "trailing": b'{} {}',
        }
        for label, body in cases.items():
            with self.subTest(label=label):
                path = self.root / f"{label}.json"
                path.write_bytes(body)
                self.assert_failure(
                    path,
                    SourceValidationReasonCode.INVALID_JSON,
                )

    def test_invalid_utf8_and_bom_fail_in_first_binary_pass(self) -> None:
        invalid = self.root / "invalid-utf8.json"
        invalid.write_bytes(b'{"value":"\xff"}')
        self.assert_failure(
            invalid,
            SourceValidationReasonCode.INVALID_UTF8,
        )

        bom = self.root / "bom.json"
        bom.write_bytes(
            b"\xef\xbb\xbf"
            + json.dumps(
                export_document((message(10, OWNER), message(11, PEER)))
            ).encode("utf-8")
        )
        self.assert_failure(
            bom,
            SourceValidationReasonCode.UTF8_BOM_NOT_SUPPORTED,
        )

    def test_required_top_level_fields_and_types_fail_closed(self) -> None:
        valid = export_document((message(10, OWNER), message(11, PEER)))
        cases: list[tuple[str, object]] = []
        for missing in ("exportInfo", "session", "messages"):
            document = dict(valid)
            document.pop(missing)
            cases.append((f"missing-{missing}", document))
        cases.extend(
            (
                ("root-array", []),
                (
                    "export-info-array",
                    {**valid, "exportInfo": []},
                ),
                ("session-array", {**valid, "session": []}),
                ("messages-object", {**valid, "messages": {}}),
                (
                    "scalar-message",
                    {**valid, "messages": [1]},
                ),
            )
        )
        for label, document in cases:
            with self.subTest(label=label):
                path = self.root / f"{label}.json"
                path.write_text(
                    json.dumps(document, ensure_ascii=False),
                    encoding="utf-8",
                )
                self.assert_failure(
                    path,
                    SourceValidationReasonCode.UNSUPPORTED_TOP_LEVEL_STRUCTURE,
                )

    def test_wrong_format_group_and_ambiguous_session_fail_closed(self) -> None:
        messages = (message(10, OWNER), message(11, PEER))
        wrong_format = write_export(
            self.root / "wrong-format.json",
            messages,
            export_info={"format": "summary-json"},
        )
        self.assert_failure(
            wrong_format,
            SourceValidationReasonCode.UNSUPPORTED_EXPORT_FORMAT,
        )

        for label, session in (
            (
                "group",
                {
                    "isGroup": True,
                    "type": "群聊",
                    "platform": "synthetic-platform",
                    "ownerId": OWNER,
                    "wxid": PEER,
                },
            ),
            (
                "ambiguous",
                {
                    "isGroup": False,
                    "type": "群聊",
                    "platform": "synthetic-platform",
                    "ownerId": OWNER,
                    "wxid": PEER,
                },
            ),
        ):
            with self.subTest(label=label):
                path = write_export(
                    self.root / f"{label}.json",
                    messages,
                    session=session,
                )
                self.assert_failure(
                    path,
                    SourceValidationReasonCode.UNSUPPORTED_SESSION,
                )

    def test_session_identity_and_participant_failures_are_fatal(self) -> None:
        missing_identity = write_export(
            self.root / "missing-identity.json",
            (message(10, OWNER), message(11, PEER)),
            session={
                "isGroup": False,
                "type": "私聊",
                "platform": "synthetic-platform",
                "ownerId": OWNER,
            },
        )
        self.assert_failure(
            missing_identity,
            SourceValidationReasonCode.SESSION_IDENTITY_INVALID,
        )

        for label, messages in (
            (
                "missing-participant",
                (
                    message(10, OWNER),
                    {"createTime": 11},
                ),
            ),
            (
                "unexpected-participant",
                (
                    message(10, OWNER),
                    message(11, "synthetic-third"),
                ),
            ),
            (
                "incomplete-participant-set",
                (
                    message(10, OWNER),
                    message(11, OWNER),
                ),
            ),
        ):
            with self.subTest(label=label):
                path = write_export(self.root / f"{label}.json", messages)
                self.assert_failure(
                    path,
                    SourceValidationReasonCode.PARTICIPANT_INVALID,
                )

    def test_invalid_message_timestamps_are_recoverable_when_range_remains(
        self,
    ) -> None:
        for label, invalid_time in (
            ("missing", None),
            ("boolean", True),
            ("string", "10"),
            ("float", 10.5),
            ("above-int64", 2**63),
        ):
            with self.subTest(label=label):
                invalid_message = message(invalid_time, OWNER)
                if label == "missing":
                    invalid_message.pop("createTime")
                path = write_export(
                    self.root / f"timestamp-{label}.json",
                    (invalid_message, message(11, PEER)),
                )
                result = validate_preflighted_inputs(
                    self.inputs((path,)),
                    real_backend(),
                )
                descriptor = result.annual_sources[0]
                self.assertEqual(descriptor.minimum_create_time, 11)
                self.assertEqual(descriptor.maximum_create_time, 11)
                self.assertEqual(
                    dict(result.annual_normalization.skipped_by_reason)[
                        "MALFORMED_TIME"
                    ],
                    1,
                )

    def test_signed_64_timestamp_range_boundaries_are_deterministic(self) -> None:
        exact = write_export(
            self.root / "timestamp-exact-boundaries.json",
            (
                message(-(2**63), OWNER),
                message((2**63) - 1, PEER),
            ),
        )
        result = validate_preflighted_inputs(
            self.inputs((exact,)),
            real_backend(),
        )
        descriptor = result.annual_sources[0]
        self.assertEqual(descriptor.minimum_create_time, -(2**63))
        self.assertEqual(descriptor.maximum_create_time, (2**63) - 1)

        below = write_export(
            self.root / "timestamp-below-int64.json",
            (
                message(-(2**63) - 1, OWNER),
                message(11, PEER),
            ),
        )
        result = validate_preflighted_inputs(
            self.inputs((below,)),
            real_backend(),
        )
        self.assertEqual(result.annual_sources[0].minimum_create_time, 11)

    def test_source_without_any_valid_timestamp_is_fatal(self) -> None:
        path = write_export(
            self.root / "no-valid-time.json",
            (
                message("invalid", OWNER),
                message(None, PEER),
            ),
        )
        self.assert_failure(
            path,
            SourceValidationReasonCode.MESSAGE_TIME_RANGE_UNAVAILABLE,
        )

    def test_different_annual_or_verification_session_is_rejected(self) -> None:
        baseline = write_export(
            self.root / "baseline.json",
            (message(10, OWNER), message(11, PEER)),
        )
        other_owner = "synthetic-other-owner"
        other_peer = "synthetic-other-peer"
        other = write_export(
            self.root / "other.json",
            (
                message(10, other_owner),
                message(11, other_peer),
            ),
            session={
                "isGroup": False,
                "type": "私聊",
                "platform": "synthetic-platform",
                "ownerId": other_owner,
                "wxid": other_peer,
            },
        )
        for annual, verification in (
            ((baseline, other), ()),
            ((baseline,), (other,)),
        ):
            with self.subTest(verification=bool(verification)):
                with self.assertRaises(SourceValidationError) as raised:
                    validate_preflighted_inputs(
                        self.inputs(annual, verification),
                        real_backend(),
                    )
                self.assertEqual(
                    raised.exception.reason_code,
                    SourceValidationReasonCode.DIFFERENT_CONVERSATION,
                )

    def test_path_replacement_during_staging_is_detected_and_aborted(self) -> None:
        source = write_export(
            self.root / "source.json",
            (message(10, OWNER), message(11, PEER)),
        )

        class ReplacingConsumer(RecordingConsumer):
            def stage_annual_message(
                nested_self,
                descriptor: ValidatedSourceDescriptor,
                source_array_index: int,
                message_value: dict[str, object],
                *,
                owner_identity: str,
                peer_identity: str,
            ) -> None:
                super().stage_annual_message(
                    descriptor,
                    source_array_index,
                    message_value,
                    owner_identity=owner_identity,
                    peer_identity=peer_identity,
                )
                if len(nested_self.annual) == 1:
                    replacement = write_export(
                        self.root / "replacement.json",
                        (message(10, OWNER), message(11, PEER)),
                    )
                    os.replace(replacement, descriptor.path)

        consumer = ReplacingConsumer()
        with self.assertRaises(SourceValidationError) as raised:
            validate_preflighted_inputs(
                self.inputs((source,)),
                real_backend(),
                staging_consumer=consumer,
            )
        self.assertEqual(
            raised.exception.reason_code,
            SourceValidationReasonCode.SOURCE_MUTATED,
        )
        self.assertTrue(consumer.abort_called)
        self.assertEqual(consumer.annual, [])
        self.assertEqual(consumer.verification, [])
        self.assertFalse(consumer.complete_called)
        self.assertFalse(self.output.exists())

    def test_in_place_change_after_parser_buffering_is_detected(self) -> None:
        source = write_export(
            self.root / "in-place-source.json",
            (message(10, OWNER), message(11, PEER)),
        )
        original = source.read_bytes()

        class MutatingConsumer(RecordingConsumer):
            def stage_annual_message(
                nested_self,
                descriptor: ValidatedSourceDescriptor,
                source_array_index: int,
                message_value: dict[str, object],
                *,
                owner_identity: str,
                peer_identity: str,
            ) -> None:
                super().stage_annual_message(
                    descriptor,
                    source_array_index,
                    message_value,
                    owner_identity=owner_identity,
                    peer_identity=peer_identity,
                )
                if len(nested_self.annual) == 1:
                    mutated = original.replace(
                        b"synthetic-message",
                        b"synthetic-messagf",
                        1,
                    )
                    self.assertEqual(len(mutated), len(original))
                    source.write_bytes(mutated)

        consumer = MutatingConsumer()
        with self.assertRaises(SourceValidationError) as raised:
            validate_preflighted_inputs(
                self.inputs((source,)),
                real_backend(),
                staging_consumer=consumer,
            )
        self.assertEqual(
            raised.exception.reason_code,
            SourceValidationReasonCode.SOURCE_MUTATED,
        )
        self.assertTrue(consumer.abort_called)
        self.assertEqual(consumer.annual, [])
        self.assertFalse(self.output.exists())

    def test_duplicate_required_field_and_excessive_nesting_fail_closed(
        self,
    ) -> None:
        duplicate = self.root / "duplicate.json"
        duplicate.write_text(
            '{"exportInfo":{"format":"detailed-json"},'
            '"exportInfo":{"format":"detailed-json"},'
            '"session":{},'
            '"messages":[]}',
            encoding="utf-8",
        )
        self.assert_failure(
            duplicate,
            SourceValidationReasonCode.UNSUPPORTED_TOP_LEVEL_STRUCTURE,
        )

        nested: object = "synthetic-leaf"
        for _ in range(70):
            nested = [nested]
        deeply_nested = write_export(
            self.root / "deeply-nested.json",
            (
                message(10, OWNER, nested=nested),
                message(11, PEER),
            ),
        )
        self.assert_failure(
            deeply_nested,
            SourceValidationReasonCode.UNSUPPORTED_TOP_LEVEL_STRUCTURE,
        )

    def test_injected_sensitive_parser_input_never_reaches_cli_stderr(self) -> None:
        source = self.root / f"{SENSITIVE}.json"
        source.write_text(
            '{"exportInfo":{"format":"detailed-json"},'
            f'"session":"{SENSITIVE}","messages":[{SENSITIVE}]}}',
            encoding="utf-8",
        )
        stdout = io.StringIO()
        stderr = io.StringIO()

        def runner(selection: object) -> object:
            return validate_preflighted_inputs(
                self.inputs((source,)),
                real_backend(),
            )

        with redirect_stdout(stdout), redirect_stderr(stderr):
            exit_code = _run_for_test(
                [
                    "preprocess",
                    "--annual-source",
                    os.fspath(source),
                    "--output-dir",
                    os.fspath(self.output),
                ],
                lambda: None,
                runner,
            )
        self.assertEqual(exit_code, 65)
        self.assertEqual(stdout.getvalue(), "")
        self.assertNotIn(SENSITIVE, stderr.getvalue())
        self.assertNotIn(source.name, stderr.getvalue())
        self.assertNotIn(os.fspath(self.root), stderr.getvalue())
        self.assertNotIn("Traceback", stderr.getvalue())
        payload = json.loads(stderr.getvalue())
        self.assertEqual(payload["category"], "input-validation")
        self.assertIn(
            payload["reasonCode"],
            {"INVALID_JSON", "UNSUPPORTED_TOP_LEVEL_STRUCTURE"},
        )


if __name__ == "__main__":
    unittest.main()
