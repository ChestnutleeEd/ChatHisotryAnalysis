from __future__ import annotations

from pathlib import Path
import tempfile
import unittest

from chat_history_analysis.errors import (
    FailureCategory,
    SourceRole,
    SourceValidationError,
    SourceValidationReasonCode,
)
from chat_history_analysis.input_preflight import PreflightedInputs
from chat_history_analysis.message_capacity import (
    MAX_AGGREGATE_RAW_MESSAGES,
    AggregateMessageCounter,
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


class AggregateMessageCounterTests(unittest.TestCase):
    def test_production_limit_is_exactly_two_million(self) -> None:
        self.assertEqual(MAX_AGGREGATE_RAW_MESSAGES, 2_000_000)

    def test_exact_two_million_is_accepted_without_message_objects(self) -> None:
        counter = AggregateMessageCounter()
        for ordinal in range(1, MAX_AGGREGATE_RAW_MESSAGES + 1):
            counter.observe(
                role=SourceRole.ANNUAL_SOURCE,
                source_ordinal=1,
                record_ordinal=ordinal,
            )
        self.assertEqual(counter.count, MAX_AGGREGATE_RAW_MESSAGES)

    def test_first_message_over_limit_is_rejected_without_increment(self) -> None:
        counter = AggregateMessageCounter(limit=2)
        for ordinal in (1, 2):
            counter.observe(
                role=SourceRole.ANNUAL_SOURCE,
                source_ordinal=1,
                record_ordinal=ordinal,
            )
        with self.assertRaises(SourceValidationError) as raised:
            counter.observe(
                role=SourceRole.OVERLAP_VERIFICATION,
                source_ordinal=3,
                record_ordinal=1,
            )
        self.assertEqual(counter.count, 2)
        self.assertEqual(
            raised.exception.reason_code,
            SourceValidationReasonCode.RAW_MESSAGE_LIMIT_EXCEEDED,
        )
        self.assertEqual(raised.exception.category, FailureCategory.CAPACITY)


@unittest.skipUnless(HAS_IJSON, "ijson==3.5.1 is required")
class StreamingMessageCapacityTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory(
            prefix="chat-analysis-stage2c-",
            dir="/tmp",
        )
        self.addCleanup(self.temporary_directory.cleanup)
        self.root = Path(self.temporary_directory.name)

    def inputs(
        self,
        annual: tuple[Path, ...],
        verification: tuple[Path, ...] = (),
    ) -> PreflightedInputs:
        return PreflightedInputs(
            annual_sources=annual,
            overlap_verifications=verification,
            output_directory=self.root / "unused-output",
        )

    def test_annual_and_verification_roles_share_one_counter(self) -> None:
        annual = write_export(
            self.root / "annual.json",
            (message(10, OWNER), message(11, PEER)),
        )
        verification = write_export(
            self.root / "verification.json",
            (message(10, OWNER), message(11, PEER)),
        )
        with self.assertRaises(SourceValidationError) as raised:
            validate_preflighted_inputs(
                self.inputs((annual,), (verification,)),
                real_backend(),
                message_limit=3,
            )
        self.assertEqual(
            raised.exception.reason_code,
            SourceValidationReasonCode.RAW_MESSAGE_LIMIT_EXCEEDED,
        )
        self.assertEqual(
            raised.exception.public_payload(),
            {
                "category": "capacity",
                "field": "messages",
                "phase": "source-validation",
                "reasonCode": "RAW_MESSAGE_LIMIT_EXCEEDED",
                "recordOrdinal": 2,
                "role": "overlap-verification",
                "sourceOrdinal": 1,
            },
        )

    def test_parser_iterator_is_not_consumed_after_first_over_limit(self) -> None:
        source = write_export(
            self.root / "messages.json",
            (
                message(10, OWNER),
                message(11, PEER),
                message(12, OWNER),
                message(13, PEER),
            ),
        )
        observed_item_starts: list[int] = []
        parse = real_backend().parse

        def observing_parse(*args: object, **kwargs: object):
            for event in parse(*args, **kwargs):
                if event[0] == "messages.item" and event[1] == "start_map":
                    observed_item_starts.append(len(observed_item_starts) + 1)
                yield event

        with self.assertRaises(SourceValidationError):
            validate_preflighted_inputs(
                self.inputs((source,)),
                backend_with_parse(observing_parse),
                message_limit=2,
            )
        self.assertEqual(observed_item_starts, [1, 2, 3])


if __name__ == "__main__":
    unittest.main()
