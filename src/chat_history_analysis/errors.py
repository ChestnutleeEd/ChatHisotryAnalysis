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
MESSAGE_NORMALIZATION_PHASE: Final = "message-normalization"
DATASET_STAGING_PHASE: Final = "dataset-staging"
OUTPUT_SERIALIZATION_PHASE: Final = "output-serialization"
OUTPUT_VERIFICATION_PHASE: Final = "output-verification"
OUTPUT_PROMOTION_PHASE: Final = "output-promotion"
OVERLAP_VERIFICATION_PHASE: Final = "overlap-verification"
RECOVERY_PHASE: Final = "recovery"
PRESENTATION_PHASES: Final = frozenset(
    {
        STARTUP_PHASE,
        ARGUMENT_PHASE,
        INPUT_PREFLIGHT_PHASE,
        SOURCE_DIGEST_PHASE,
        SOURCE_VALIDATION_PHASE,
        SOURCE_STAGING_PHASE,
        SESSION_VALIDATION_PHASE,
        MESSAGE_NORMALIZATION_PHASE,
        DATASET_STAGING_PHASE,
        OUTPUT_SERIALIZATION_PHASE,
        OUTPUT_VERIFICATION_PHASE,
        OUTPUT_PROMOTION_PHASE,
        OVERLAP_VERIFICATION_PHASE,
        RECOVERY_PHASE,
    }
)
PRESENTATION_FIELDS: Final = frozenset(
    {
        "exportInfo",
        "exportInfo.format",
        "messages",
        "messages.createTime",
        "messages.localType",
        "messages.senderUsername",
        "session",
    }
)


class ExitCode(IntEnum):
    """Stable, non-overlapping process outcomes."""

    SUCCESS = 0
    STARTUP_FAILURE = 2
    ARGUMENT_FAILURE = 64
    INPUT_VALIDATION_FAILURE = 65
    IGNORE_POLICY_FAILURE = 66
    CAPACITY_FAILURE = 67
    OUTPUT_FAILURE = 68
    VERIFICATION_FAILURE = 69
    CANCELLATION = 130


class FailureCategory(str, Enum):
    """Stable public CLI failure classifications."""

    STARTUP = "startup"
    ARGUMENT = "argument"
    INPUT_VALIDATION = "input-validation"
    IGNORE_POLICY = "ignore-policy"
    CAPACITY = "capacity"
    OUTPUT = "output"
    VERIFICATION = "verification"
    CANCELLATION = "cancellation"


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
    UNSAFE_LOCAL_TYPE = "UNSAFE_LOCAL_TYPE"
    DIFFERENT_CONVERSATION = "DIFFERENT_CONVERSATION"
    SOURCE_MUTATED = "SOURCE_MUTATED"
    RAW_INPUT_FILE_LIMIT_EXCEEDED = "RAW_INPUT_FILE_LIMIT_EXCEEDED"
    AGGREGATE_RAW_INPUT_LIMIT_EXCEEDED = (
        "AGGREGATE_RAW_INPUT_LIMIT_EXCEEDED"
    )
    RAW_MESSAGE_LIMIT_EXCEEDED = "RAW_MESSAGE_LIMIT_EXCEEDED"


class DatasetPersistenceReasonCode(str, Enum):
    """Stable Stage 5/6 reasons that never carry internal exception text."""

    SOURCE_EVENT_INVALID = "SOURCE_EVENT_INVALID"
    OUTPUT_DESTINATION_EXISTS = "OUTPUT_DESTINATION_EXISTS"
    OUTPUT_PARENT_UNSAFE = "OUTPUT_PARENT_UNSAFE"
    OUTPUT_STAGING_FAILED = "OUTPUT_STAGING_FAILED"
    SQLITE_POLICY_FAILED = "SQLITE_POLICY_FAILED"
    CRYPTOGRAPHIC_IDENTITY_COLLISION = (
        "CRYPTOGRAPHIC_IDENTITY_COLLISION"
    )
    OVERLAP_VERIFICATION_FAILED = "OVERLAP_VERIFICATION_FAILED"
    NO_ELIGIBLE_TEXT_RECORDS = "NO_ELIGIBLE_TEXT_RECORDS"
    NORMALIZED_RECORD_TOO_LARGE = "NORMALIZED_RECORD_TOO_LARGE"
    NORMALIZED_RECORD_LIMIT_EXCEEDED = (
        "NORMALIZED_RECORD_LIMIT_EXCEEDED"
    )
    NORMALIZED_DATASET_LIMIT_EXCEEDED = (
        "NORMALIZED_DATASET_LIMIT_EXCEEDED"
    )
    NORMALIZED_SCHEMA_INVALID = "NORMALIZED_SCHEMA_INVALID"
    PRIVACY_VALIDATION_FAILED = "PRIVACY_VALIDATION_FAILED"
    OUTPUT_WRITE_FAILED = "OUTPUT_WRITE_FAILED"
    OUTPUT_FLUSH_FAILED = "OUTPUT_FLUSH_FAILED"
    OUTPUT_INTEGRITY_FAILED = "OUTPUT_INTEGRITY_FAILED"
    OUTPUT_CLEANUP_FAILED = "OUTPUT_CLEANUP_FAILED"
    OUTPUT_PROMOTION_FAILED = "OUTPUT_PROMOTION_FAILED"
    DATASET_SELECTION_INVALID = "DATASET_SELECTION_INVALID"
    RECOVERY_PARENT_UNSAFE = "RECOVERY_PARENT_UNSAFE"
    RECOVERY_CANDIDATE_INVALID = "RECOVERY_CANDIDATE_INVALID"
    RECOVERY_CONFIRMATION_REQUIRED = "RECOVERY_CONFIRMATION_REQUIRED"
    RECOVERY_CLEANUP_FAILED = "RECOVERY_CLEANUP_FAILED"
    CANONICAL_EVENT_LIMIT_EXCEEDED = "CANONICAL_EVENT_LIMIT_EXCEEDED"
    CANONICAL_DATASET_LIMIT_EXCEEDED = "CANONICAL_DATASET_LIMIT_EXCEEDED"
    CANONICAL_CHUNK_LIMIT_EXCEEDED = "CANONICAL_CHUNK_LIMIT_EXCEEDED"
    CANONICAL_NO_EVENTS = "CANONICAL_NO_EVENTS"
    CANONICAL_SCHEMA_INVALID = "CANONICAL_SCHEMA_INVALID"
    CANONICAL_PRIVACY_VALIDATION_FAILED = (
        "CANONICAL_PRIVACY_VALIDATION_FAILED"
    )
    SIDECAR_PROTOCOL_INVALID = "SIDECAR_PROTOCOL_INVALID"
    SIDECAR_CRASHED = "SIDECAR_CRASHED"


class DatasetPersistenceError(Exception):
    """A Stage 5/6 failure with a deliberately tiny public representation."""

    def __init__(
        self,
        reason_code: DatasetPersistenceReasonCode,
        *,
        phase: str,
        category: FailureCategory = FailureCategory.OUTPUT,
        aggregate_count: int | None = None,
    ) -> None:
        if (
            phase not in PRESENTATION_PHASES
            or (
                aggregate_count is not None
                and (
                    isinstance(aggregate_count, bool)
                    or not isinstance(aggregate_count, int)
                    or aggregate_count < 0
                )
            )
        ):
            raise ValueError
        self.reason_code = reason_code
        self.phase = phase
        self.category = category
        self.aggregate_count = aggregate_count
        super().__init__(reason_code.value)

    def public_payload(self) -> Mapping[str, str | int]:
        payload: dict[str, str | int] = {
            "category": self.category.value,
            "phase": self.phase,
            "reasonCode": self.reason_code.value,
        }
        if self.aggregate_count is not None:
            payload["aggregateCount"] = self.aggregate_count
        return payload


class CancellationReasonCode(str, Enum):
    """Stable cancellation reasons independent of source content."""

    USER_CANCELLED = "USER_CANCELLED"


class CancellationError(Exception):
    """A requested stop observed at a production safe checkpoint."""

    reason_code = CancellationReasonCode.USER_CANCELLED

    def __init__(self, *, phase: str) -> None:
        if phase not in PRESENTATION_PHASES:
            raise ValueError
        self.phase = phase
        super().__init__(self.reason_code.value)

    def public_payload(self) -> Mapping[str, str]:
        return {
            "category": FailureCategory.CANCELLATION.value,
            "phase": self.phase,
            "reasonCode": self.reason_code.value,
        }


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
        if (
            phase not in PRESENTATION_PHASES
            or not isinstance(role, SourceRole)
            or isinstance(source_ordinal, bool)
            or not isinstance(source_ordinal, int)
            or source_ordinal < 1
            or (field is not None and field not in PRESENTATION_FIELDS)
            or (
                record_ordinal is not None
                and (
                    isinstance(record_ordinal, bool)
                    or not isinstance(record_ordinal, int)
                    or record_ordinal < 1
                )
            )
        ):
            raise ValueError
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
