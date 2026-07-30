from __future__ import annotations

from contextlib import redirect_stderr, redirect_stdout
import ast
from datetime import datetime, timedelta, timezone
import io
import json
import os
from pathlib import Path
from types import SimpleNamespace
import tempfile
import unittest

from chat_history_analysis.errors import (
    SourceRole,
    SourceValidationError,
    SourceValidationReasonCode,
)
from chat_history_analysis.cli import _run_for_test
from chat_history_analysis.input_preflight import PreflightedInputs
from chat_history_analysis.message_normalization import (
    CHAT_LAB_TYPE_CATEGORIES,
    MAX_SAFE_INTEGER,
    MessageCategory,
    MessageNormalizationConsumer,
    NormalizedMessage,
)
from chat_history_analysis.preprocessing_validation import (
    validate_preflighted_inputs,
)
from tests.stage3_support import (
    HAS_IJSON,
    OWNER,
    PEER,
    backend_with_parse,
    message,
    real_backend,
    write_export,
)


SENSITIVE = "sensitive-normalization-injection"
EPOCH = datetime(1970, 1, 1, tzinfo=timezone.utc)


def formatted_time(create_time: int) -> str:
    local = EPOCH + timedelta(seconds=create_time, hours=8)
    return (
        f"{local.year:04d}-{local.month:02d}-{local.day:02d} "
        f"{local.hour:02d}:{local.minute:02d}:{local.second:02d}"
    )


def descriptor() -> SimpleNamespace:
    return SimpleNamespace(
        role=SourceRole.ANNUAL_SOURCE,
        supplied_ordinal=2,
        file_rank=3,
    )


def eligible_message(
    *,
    create_time: int = 0,
    sender: str = OWNER,
    is_send: object = 1,
    content: object = "synthetic eligible text",
    **updates: object,
) -> dict[str, object]:
    value: dict[str, object] = {
        "chatLabType": 0,
        "type": "文本消息",
        "localType": 1,
        "content": content,
        "isSend": is_send,
        "senderUsername": sender,
        "createTime": create_time,
        "formattedTime": formatted_time(create_time),
    }
    value.update(updates)
    return value


def observe(
    consumer: MessageNormalizationConsumer,
    value: dict[str, object],
    source_array_index: int = 0,
) -> None:
    consumer.stage_annual_message(
        descriptor(),
        source_array_index,
        value,
        owner_identity=OWNER,
        peer_identity=PEER,
    )


def collect_annual(
    records: list[NormalizedMessage],
) -> MessageNormalizationConsumer:
    return MessageNormalizationConsumer(
        on_annual_eligible=lambda _descriptor, record, _platform_id, _owner, _peer: (
            records.append(record)
        )
    )


class MessageClassificationTests(unittest.TestCase):
    def test_complete_primary_mapping_is_exact(self) -> None:
        self.assertEqual(
            CHAT_LAB_TYPE_CATEGORIES,
            {
                0: MessageCategory.TEXT,
                1: MessageCategory.IMAGE,
                2: MessageCategory.VOICE,
                3: MessageCategory.VIDEO,
                4: MessageCategory.FILE,
                5: MessageCategory.ANIMATED_EMOJI,
                7: MessageCategory.STRUCTURED,
                8: MessageCategory.LOCATION,
                23: MessageCategory.CALL,
                24: MessageCategory.MINI_PROGRAM,
                25: MessageCategory.REPLY,
                27: MessageCategory.CONTACT_CARD,
                80: MessageCategory.SYSTEM,
                99: MessageCategory.OTHER,
            },
        )

    def test_implementation_has_no_32_bit_or_bitwise_coercion(self) -> None:
        module_path = (
            Path(__file__).resolve().parents[1]
            / "src"
            / "chat_history_analysis"
            / "message_normalization.py"
        )
        source = module_path.read_text(encoding="utf-8")
        tree = ast.parse(source)
        prohibited = (ast.BitAnd, ast.BitOr, ast.BitXor, ast.LShift, ast.RShift)

        class ExecutableBitwiseVisitor(ast.NodeVisitor):
            found = False

            def visit_BinOp(self, node: ast.BinOp) -> None:
                if isinstance(node.op, prohibited):
                    self.found = True
                self.generic_visit(node)

            def visit_arg(self, node: ast.arg) -> None:
                return

            def visit_AnnAssign(self, node: ast.AnnAssign) -> None:
                if node.value is not None:
                    self.visit(node.value)

            def visit_FunctionDef(self, node: ast.FunctionDef) -> None:
                for decorator in node.decorator_list:
                    self.visit(decorator)
                for default in (*node.args.defaults, *node.args.kw_defaults):
                    if default is not None:
                        self.visit(default)
                for statement in node.body:
                    self.visit(statement)

        visitor = ExecutableBitwiseVisitor()
        visitor.visit(tree)
        self.assertFalse(visitor.found)
        self.assertNotIn("Int32Array", source)
        self.assertNotIn("c_int32", source)
        self.assertNotIn("sqlite", source.lower())

    def test_every_known_non_text_category_is_disposed(self) -> None:
        labels = {
            1: "图片消息",
            2: "语音消息",
            3: "视频消息",
            4: "文件消息",
            5: "动画表情",
            7: "链接消息",
            8: "位置消息",
            23: "通话消息",
            24: "小程序消息",
            25: "引用消息",
            27: "名片消息",
            80: "系统消息",
            99: "其他消息",
        }
        consumer = MessageNormalizationConsumer()
        for index, (code, label) in enumerate(labels.items()):
            value = eligible_message(
                chatLabType=code,
                type=label,
                localType=2**32 + index,
                content=f"{SENSITIVE}-{index}",
            )
            observe(consumer, value, index)
        summary = consumer.annual_summary
        self.assertEqual(summary.observed_count, len(labels))
        self.assertEqual(summary.eligible_count, 0)
        self.assertEqual(
            summary.skipped_by_reason,
            (("NON_TEXT", len(labels)),),
        )
        self.assertNotIn(SENSITIVE, repr(summary))

    def test_unknown_and_conflicting_primary_types_fail_closed(self) -> None:
        consumer = MessageNormalizationConsumer()
        observe(
            consumer,
            eligible_message(chatLabType=123456, content=SENSITIVE),
        )
        observe(
            consumer,
            eligible_message(chatLabType=1, type="文本消息", content=SENSITIVE),
            1,
        )
        observe(
            consumer,
            eligible_message(chatLabType="0", content=SENSITIVE),
            2,
        )
        self.assertEqual(
            dict(consumer.annual_summary.skipped_by_reason),
            {
                "CLASSIFICATION_CONFLICT": 1,
                "MALFORMED_CLASSIFICATION": 1,
                "UNKNOWN_CHAT_LAB_TYPE": 1,
            },
        )
        self.assertEqual(
            dict(consumer.annual_summary.warnings_by_reason),
            {"CLASSIFICATION_CONFLICT": 1},
        )

    def test_safe_large_and_unknown_local_type_is_transient(self) -> None:
        consumer = MessageNormalizationConsumer()
        observe(
            consumer,
            eligible_message(
                chatLabType=7,
                type="链接消息",
                localType=MAX_SAFE_INTEGER,
                content=SENSITIVE,
            ),
        )
        self.assertEqual(consumer.annual_summary.eligible_count, 0)
        self.assertNotIn(SENSITIVE, repr(consumer))
        self.assertNotIn("localType", repr(consumer))

    def test_unsafe_local_type_is_fatal_and_content_free(self) -> None:
        for unsafe in (True, 1.5, "1", None, MAX_SAFE_INTEGER + 1):
            with self.subTest(kind=type(unsafe).__name__):
                consumer = MessageNormalizationConsumer()
                with self.assertRaises(SourceValidationError) as raised:
                    observe(
                        consumer,
                        eligible_message(localType=unsafe, content=SENSITIVE),
                    )
                self.assertEqual(
                    raised.exception.reason_code,
                    SourceValidationReasonCode.UNSAFE_LOCAL_TYPE,
                )
                rendered = json.dumps(
                    raised.exception.public_payload(),
                    sort_keys=True,
                )
                self.assertNotIn(SENSITIVE, rendered)
                self.assertNotIn("unsafe-local-type", rendered)


class EligibleTextTests(unittest.TestCase):
    def test_owner_other_and_source_evidence_are_normalized(self) -> None:
        records: list[NormalizedMessage] = []
        consumer = collect_annual(records)
        observe(consumer, eligible_message(), 7)
        observe(
            consumer,
            eligible_message(sender=PEER, is_send=0, content="other text"),
            8,
        )
        self.assertEqual(len(records), 2)
        self.assertEqual(records[0].sender_scope, "owner")
        self.assertEqual(records[1].sender_scope, "other")
        self.assertEqual(records[0].source_role, SourceRole.ANNUAL_SOURCE)
        self.assertEqual(records[0].source_ordinal, 2)
        self.assertEqual(records[0].file_rank, 3)
        self.assertEqual(records[0].source_array_index, 7)
        self.assertEqual(
            (consumer.annual_summary.owner_count, consumer.annual_summary.other_count),
            (1, 1),
        )

    def test_exact_text_conjunction_is_required(self) -> None:
        consumer = MessageNormalizationConsumer()
        observe(consumer, eligible_message(chatLabType=1))
        observe(consumer, eligible_message(type="图片消息"), 1)
        observe(consumer, eligible_message(localType=2), 2)
        self.assertEqual(consumer.annual_summary.eligible_count, 0)
        self.assertEqual(consumer.annual_summary.skipped_count, 3)

    def test_content_exclusions_and_mixed_url_cleanup(self) -> None:
        records: list[NormalizedMessage] = []
        consumer = collect_annual(records)
        excluded = (
            "",
            " \t\n ",
            "\u0000\u001f",
            "[图片]",
            "<msg><title>synthetic</title></msg>",
            "https://example.invalid/synthetic",
            "www.example.invalid/synthetic",
            None,
            ["synthetic"],
        )
        for index, content in enumerate(excluded):
            observe(consumer, eligible_message(content=content), index)
        observe(
            consumer,
            eligible_message(
                content=(
                    "synthetic before https://example.invalid/private "
                    "synthetic after"
                )
            ),
            len(excluded),
        )
        observe(
            consumer,
            eligible_message(content="synthetic\u0000human\ttext"),
            len(excluded) + 1,
        )
        self.assertEqual(
            [record.content for record in records],
            ["synthetic before synthetic after", "synthetic human text"],
        )
        reasons = dict(consumer.annual_summary.skipped_by_reason)
        self.assertEqual(reasons["MALFORMED_CONTENT"], 5)
        self.assertEqual(reasons["BRACKETED_PLACEHOLDER"], 1)
        self.assertEqual(reasons["XML_LIKE_CONTENT"], 1)
        self.assertEqual(reasons["URL_ONLY_CONTENT"], 2)

    def test_invalid_sender_skips_without_coercion(self) -> None:
        consumer = MessageNormalizationConsumer()
        for index, invalid in enumerate((True, "1", None, 2, -1)):
            observe(
                consumer,
                eligible_message(is_send=invalid, content=SENSITIVE),
                index,
            )
        self.assertEqual(
            consumer.annual_summary.skipped_by_reason,
            (("INVALID_SENDER", 5),),
        )
        self.assertNotIn(SENSITIVE, repr(consumer))

    def test_valid_is_send_is_authoritative_on_metadata_conflict(self) -> None:
        records: list[NormalizedMessage] = []
        consumer = collect_annual(records)
        observe(
            consumer,
            eligible_message(sender=PEER, is_send=1),
        )
        self.assertEqual(records[0].sender_scope, "owner")
        self.assertEqual(
            consumer.annual_summary.warnings_by_reason,
            (("SENDER_METADATA_CONFLICT", 1),),
        )

    def test_fixed_utc_plus_eight_time_and_failures(self) -> None:
        records: list[NormalizedMessage] = []
        consumer = collect_annual(records)
        observe(consumer, eligible_message(create_time=-28_800))
        observe(
            consumer,
            eligible_message(
                create_time=951_782_400,
                formattedTime="2000-02-29 08:00:00",
            ),
            1,
        )
        observe(
            consumer,
            eligible_message(formattedTime="1970-01-01 07:59:59"),
            2,
        )
        observe(
            consumer,
            eligible_message(formattedTime="1970-1-1 08:00:00"),
            3,
        )
        observe(consumer, eligible_message(createTime=True), 4)
        self.assertEqual(records[0].formatted_time, "1970-01-01 00:00:00")
        self.assertEqual(records[0].calendar_date, "1970-01-01")
        self.assertEqual(records[1].calendar_date, "2000-02-29")
        self.assertEqual(
            dict(consumer.annual_summary.skipped_by_reason),
            {"MALFORMED_TIME": 2, "TIME_CONFLICT": 1},
        )

    def test_recoverable_record_continues_and_default_sink_is_bounded(self) -> None:
        consumer = MessageNormalizationConsumer()
        for index in range(20_000):
            content = " " if index == 0 else "synthetic bounded text"
            observe(consumer, eligible_message(content=content), index)
        summary = consumer.annual_summary
        self.assertEqual(summary.observed_count, 20_000)
        self.assertEqual(summary.eligible_count, 19_999)
        self.assertEqual(summary.skipped_count, 1)
        self.assertEqual(
            set(MessageNormalizationConsumer.__slots__),
            {
                "_annual",
                "_complete",
                "_on_annual_eligible",
                "_on_verification_eligible",
                "_verification",
            },
        )
        self.assertLessEqual(len(consumer._annual.skipped), 1)
        self.assertEqual(len(consumer._annual.warnings), 0)

    def test_normalized_record_repr_hides_body(self) -> None:
        records: list[NormalizedMessage] = []
        consumer = collect_annual(records)
        observe(
            consumer,
            eligible_message(
                content=SENSITIVE,
                platformMessageId=SENSITIVE,
                localId=SENSITIVE,
                rawContent=SENSITIVE,
                source=SENSITIVE,
                senderDisplayName=SENSITIVE,
            ),
        )
        self.assertNotIn(SENSITIVE, repr(records[0]))
        self.assertNotIn(SENSITIVE, repr(consumer))
        self.assertNotIn(SENSITIVE, repr(consumer.annual_summary))
        self.assertNotIn(OWNER, repr(records[0]))
        self.assertNotIn(PEER, repr(records[0]))


@unittest.skipUnless(HAS_IJSON, "ijson==3.5.1 is required")
class Stage4StreamingIntegrationTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory(
            prefix="chat-analysis-stage4-",
            dir="/tmp",
        )
        self.addCleanup(self.temporary_directory.cleanup)
        self.root = Path(self.temporary_directory.name)
        self.output = self.root / "stage6-output-must-not-exist"

    def inputs(self, source: Path) -> PreflightedInputs:
        return PreflightedInputs(
            annual_sources=(source,),
            overlap_verifications=(),
            output_directory=self.output,
        )

    def test_recoverable_message_continues_through_real_stream(self) -> None:
        malformed = message(10, OWNER, content=" ")
        source = write_export(
            self.root / "recoverable.json",
            (
                malformed,
                message(11, PEER, content="synthetic survivor"),
            ),
        )
        result = validate_preflighted_inputs(self.inputs(source), real_backend())
        self.assertEqual(result.annual_normalization.observed_count, 2)
        self.assertEqual(result.annual_normalization.eligible_count, 1)
        self.assertEqual(result.annual_normalization.skipped_count, 1)
        self.assertFalse(self.output.exists())

    def test_fatal_local_type_stops_before_later_message(self) -> None:
        source = write_export(
            self.root / "fatal.json",
            (
                message(10, OWNER, localType=MAX_SAFE_INTEGER + 1),
                message(11, PEER),
                message(12, OWNER),
            ),
        )
        observed = 0
        parser_call = 0
        parse = real_backend().parse

        def counting_parse(*args: object, **kwargs: object):
            nonlocal observed, parser_call
            parser_call += 1
            for event in parse(*args, **kwargs):
                if (
                    parser_call == 2
                    and event[0] == "messages.item"
                    and event[1] == "start_map"
                ):
                    observed += 1
                yield event

        with self.assertRaises(SourceValidationError) as raised:
            validate_preflighted_inputs(
                self.inputs(source),
                backend_with_parse(counting_parse),
            )
        self.assertEqual(
            raised.exception.reason_code,
            SourceValidationReasonCode.UNSAFE_LOCAL_TYPE,
        )
        self.assertEqual(observed, 1)
        self.assertFalse(self.output.exists())

    def test_public_fixture_normalizes_without_stage6_artifacts(self) -> None:
        fixture = (
            Path(__file__).resolve().parents[1]
            / "data"
            / "mock"
            / "ciphertalk_detailed_chat_2025.json"
        )
        result = validate_preflighted_inputs(self.inputs(fixture), real_backend())
        self.assertEqual(result.aggregate_raw_message_count, 5_000)
        self.assertEqual(result.annual_normalization.observed_count, 5_000)
        self.assertEqual(result.annual_normalization.eligible_count, 4_100)
        self.assertFalse(self.output.exists())

    def test_cli_reports_only_content_free_stage4_aggregates(self) -> None:
        source = write_export(
            self.root / f"{SENSITIVE}.json",
            (
                message(10, OWNER, content=SENSITIVE),
                message(11, PEER, content=" "),
            ),
        )

        def runner(selection: object):
            return validate_preflighted_inputs(
                self.inputs(source),
                real_backend(),
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
                    os.fspath(self.output),
                ],
                lambda: None,
                runner,
            )
        self.assertEqual(exit_code, 0)
        self.assertEqual(stderr.getvalue(), "")
        self.assertNotIn(SENSITIVE, stdout.getvalue())
        self.assertNotIn(source.name, stdout.getvalue())
        payload = json.loads(stdout.getvalue())
        self.assertEqual(payload["eligibleTextCount"], 1)
        self.assertEqual(payload["skippedRecordCount"], 1)
        self.assertEqual(payload["warningCount"], 0)
        self.assertFalse(self.output.exists())


if __name__ == "__main__":
    unittest.main()
