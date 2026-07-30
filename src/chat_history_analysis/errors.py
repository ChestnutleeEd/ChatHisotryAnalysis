"""Single authority for content-free project errors and CLI exit codes."""

from __future__ import annotations

from enum import Enum, IntEnum
from typing import Final, Mapping


STARTUP_PHASE: Final = "startup"
ARGUMENT_PHASE: Final = "argument"
INPUT_PREFLIGHT_PHASE: Final = "input-preflight"
SOURCE_DIGEST_PHASE: Final = "source-digest"
SOURCE_VALIDATION_PHASE: Final = "source-validation"
SOURCE_STAGING_PHASE: Final = "source-staging"
SESSION_VALIDATION_PHASE: Final = "session-validation"


class ExitCode(IntEnum):
    """Stable, non-overlapping process outcomes."""

    SUCCESS = 0
    STARTUP_FAILURE = 2
    ARGUMENT_FAILURE = 64
    INPUT_VALIDATION_FAILURE = 65
    IGNORE_POLICY_FAILURE = 66
    CAPACITY_FAILURE = 67


class FailureCategory(str, Enum):
    """Stable public CLI failure classifications."""

    STARTUP = "startup"
    ARGUMENT = "argument"
    INPUT_VALIDATION = "input-validation"
    IGNORE_POLICY = "ignore-policy"
    CAPACITY = "capacity"


class StartupReasonCode(str, Enum):
    """Stable public startup failure categories."""

    UNSUPPORTED_PYTHON_RUNTIME = "UNSUPPORTED_PYTHON_RUNTIME"
    IJSON_DISTRIBUTION_UNVERIFIED = "IJSON_DISTRIBUTION_UNVERIFIED"
    IJSON_BACKEND_UNAVAILABLE = "IJSON_BACKEND_UNAVAILABLE"
    IJSON_BACKEND_MISMATCH = "IJSON_BACKEND_MISMATCH"
    IJSON_PARSER_INITIALIZATION_FAILED = "IJSON_PARSER_INITIALIZATION_FAILED"


class StartupError(Exception):
    """A startup failure whose public form contains no internal exception data."""

    def __init__(self, reason_code: StartupReasonCode) -> None:
        self.reason_code = reason_code
        super().__init__(reason_code.value)

    def public_payload(self) -> dict[str, str]:
        """Return the complete allow-listed user-visible representation."""

        return {
            "category": FailureCategory.STARTUP.value,
            "phase": STARTUP_PHASE,
            "reasonCode": self.reason_code.value,
        }


class ArgumentReasonCode(str, Enum):
    """Content-free argument parser failure."""

    ARGUMENT_FAILURE = "ARGUMENT_FAILURE"


class ArgumentError(Exception):
    """An invocation failure that never retains argparse's input excerpt."""

    reason_code = ArgumentReasonCode.ARGUMENT_FAILURE

    def __init__(self) -> None:
        super().__init__(self.reason_code.value)

    def public_payload(self) -> dict[str, str]:
        return {
            "category": FailureCategory.ARGUMENT.value,
            "phase": ARGUMENT_PHASE,
            "reasonCode": self.reason_code.value,
        }


class InputPreflightReasonCode(str, Enum):
    """Content-free metadata preflight reasons."""

    INPUT_PREFLIGHT_FAILED = "INPUT_PREFLIGHT_FAILED"
    OUTPUT_IGNORE_POLICY_FAILED = "OUTPUT_IGNORE_POLICY_FAILED"
    RAW_INPUT_FILE_LIMIT_EXCEEDED = "RAW_INPUT_FILE_LIMIT_EXCEEDED"
    ANNUAL_SOURCE_COUNT_LIMIT_EXCEEDED = (
        "ANNUAL_SOURCE_COUNT_LIMIT_EXCEEDED"
    )
    AGGREGATE_RAW_INPUT_LIMIT_EXCEEDED = (
        "AGGREGATE_RAW_INPUT_LIMIT_EXCEEDED"
    )


class InputPreflightError(Exception):
    """An input preflight failure with no path or internal exception data."""

    def __init__(
        self,
        reason_code: InputPreflightReasonCode = (
            InputPreflightReasonCode.INPUT_PREFLIGHT_FAILED
        ),
        category: FailureCategory = FailureCategory.INPUT_VALIDATION,
    ) -> None:
        self.reason_code = reason_code
        self.category = category
        super().__init__(reason_code.value)

    def public_payload(self) -> dict[str, str]:
        """Return the complete allow-listed user-visible representation."""

        return {
            "category": self.category.value,
            "phase": INPUT_PREFLIGHT_PHASE,
            "reasonCode": self.reason_code.value,
        }


class SourceValidationReasonCode(str, Enum):
    """Stable source-validation reasons with no source-derived values."""

    SOURCE_READ_FAILED = "SOURCE_READ_FAILED"
    INVALID_UTF8 = "INVALID_UTF8"
    UTF8_BOM_NOT_SUPPORTED = "UTF8_BOM_NOT_SUPPORTED"
    INVALID_JSON = "INVALID_JSON"
    UNSUPPORTED_TOP_LEVEL_STRUCTURE = "UNSUPPORTED_TOP_LEVEL_STRUCTURE"
    UNSUPPORTED_EXPORT_FORMAT = "UNSUPPORTED_EXPORT_FORMAT"
    UNSUPPORTED_SESSION = "UNSUPPORTED_SESSION"
    SESSION_IDENTITY_INVALID = "SESSION_IDENTITY_INVALID"
    PARTICIPANT_INVALID = "PARTICIPANT_INVALID"
    MESSAGE_TIME_INVALID = "MESSAGE_TIME_INVALID"
    MESSAGE_TIME_RANGE_UNAVAILABLE = "MESSAGE_TIME_RANGE_UNAVAILABLE"
    DIFFERENT_CONVERSATION = "DIFFERENT_CONVERSATION"
    SOURCE_MUTATED = "SOURCE_MUTATED"
    RAW_INPUT_FILE_LIMIT_EXCEEDED = "RAW_INPUT_FILE_LIMIT_EXCEEDED"
    AGGREGATE_RAW_INPUT_LIMIT_EXCEEDED = (
        "AGGREGATE_RAW_INPUT_LIMIT_EXCEEDED"
    )
    RAW_MESSAGE_LIMIT_EXCEEDED = "RAW_MESSAGE_LIMIT_EXCEEDED"


class SourceRole(str, Enum):
    """Only the fixed role label may identify a raw source publicly."""

    ANNUAL_SOURCE = "annual-source"
    OVERLAP_VERIFICATION = "overlap-verification"


class SourceValidationError(Exception):
    """A source failure whose public representation is an explicit allow-list."""

    def __init__(
        self,
        reason_code: SourceValidationReasonCode,
        *,
        phase: str,
        role: SourceRole,
        source_ordinal: int,
        category: FailureCategory = FailureCategory.INPUT_VALIDATION,
        field: str | None = None,
        record_ordinal: int | None = None,
    ) -> None:
        self.reason_code = reason_code
        self.phase = phase
        self.role = role
        self.source_ordinal = source_ordinal
        self.category = category
        self.field = field
        self.record_ordinal = record_ordinal
        super().__init__(reason_code.value)

    def public_payload(self) -> Mapping[str, str | int]:
        payload: dict[str, str | int] = {
            "category": self.category.value,
            "phase": self.phase,
            "reasonCode": self.reason_code.value,
            "role": self.role.value,
            "sourceOrdinal": self.source_ordinal,
        }
        if self.field is not None:
            payload["field"] = self.field
        if self.record_ordinal is not None:
            payload["recordOrdinal"] = self.record_ordinal
        return payload
