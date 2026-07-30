"""Aggregate raw-message accounting shared by every streaming source role."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Final

from .errors import (
    FailureCategory,
    SOURCE_VALIDATION_PHASE,
    SourceRole,
    SourceValidationError,
    SourceValidationReasonCode,
)


MAX_AGGREGATE_RAW_MESSAGES: Final = 2_000_000


@dataclass
class AggregateMessageCounter:
    """Accept an inclusive limit and fail before consuming the next record."""

    limit: int = MAX_AGGREGATE_RAW_MESSAGES
    count: int = 0

    def __post_init__(self) -> None:
        if isinstance(self.limit, bool) or not isinstance(self.limit, int):
            raise TypeError
        if self.limit < 0:
            raise ValueError

    def observe(
        self,
        *,
        role: SourceRole,
        source_ordinal: int,
        record_ordinal: int,
    ) -> None:
        next_count = self.count + 1
        if next_count > self.limit:
            raise SourceValidationError(
                SourceValidationReasonCode.RAW_MESSAGE_LIMIT_EXCEEDED,
                phase=SOURCE_VALIDATION_PHASE,
                role=role,
                source_ordinal=source_ordinal,
                category=FailureCategory.CAPACITY,
                field="messages",
                record_ordinal=record_ordinal,
            )
        self.count = next_count
