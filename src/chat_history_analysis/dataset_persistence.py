"""Private SQLite staging and deterministic normalized dataset publication."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
import ctypes
import errno
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import sqlite3
import stat
import struct
import sys
from typing import Any, BinaryIO, Final, Iterator, Mapping
from urllib.parse import quote

from . import __version__
from .backend import BackendEvidence
from .errors import (
    DATASET_STAGING_PHASE,
    OUTPUT_PROMOTION_PHASE,
    OUTPUT_SERIALIZATION_PHASE,
    OUTPUT_VERIFICATION_PHASE,
    OVERLAP_VERIFICATION_PHASE,
    RECOVERY_PHASE,
    SOURCE_STAGING_PHASE,
    DatasetPersistenceError,
    DatasetPersistenceReasonCode,
    FailureCategory,
    SourceRole,
    SourceValidationError,
    SourceValidationReasonCode,
)
from .input_preflight import PreflightedOverlapVerification
from .message_capacity import AggregateMessageCounter
from .message_normalization import (
    CanonicalEventCandidate,
    MessageNormalizationConsumer,
    NormalizedMessage,
    NormalizationSummary,
)
from .operation_control import current_operation_control
from .preprocessing_validation import (
    SourceFingerprint,
    StagingConsumer,
    ValidatedSourceDescriptor,
    ValidationResult,
)
from .source_validation import (
    AggregateRawByteCounter,
    FirstPassEvidence,
    SourceContext,
    SourcePassSummary,
    digest_and_validate_utf8,
    parse_and_validate_source,
)


NORMALIZED_SCHEMA_VERSION: Final = (
    "chat-history-analysis.normalized-record.v1"
)
MANIFEST_SCHEMA_VERSION: Final = "chat-history-analysis.manifest.v1"
TIME_POLICY: Final = "UTC+08:00"
MAX_NORMALIZED_RECORDS: Final = 1_000_000
MAX_NORMALIZED_DATASET_BYTES: Final = 134_217_728
MAX_CHUNK_BYTES: Final = 33_554_432
MAX_MANIFEST_BYTES: Final = 4_194_304
STAGING_PREFIX: Final = ".chathistoryanalysis-stage-v1-"
STAGING_MARKER: Final = ".chathistoryanalysis-private-stage-v1"
DATABASE_NAME: Final = ".staging-records.sqlite3"
MANIFEST_NAME: Final = "manifest.json"
SUSPICIOUS_OVERLAP_SECONDS: Final = 31 * 24 * 60 * 60

PLATFORM_ID_DOMAIN: Final = b"ChatHistoryAnalysis/dedup/platform-id/v1"
PLATFORM_ID_VERIFIER_DOMAIN: Final = (
    b"ChatHistoryAnalysis/dedup/platform-id-verifier/v1"
)
FALLBACK_DOMAIN: Final = b"ChatHistoryAnalysis/dedup/fallback/v1"
FALLBACK_VERIFIER_DOMAIN: Final = (
    b"ChatHistoryAnalysis/dedup/fallback-verifier/v1"
)
EVENT_FALLBACK_DOMAIN_V2: Final = (
    b"ChatHistoryAnalysis/dedup/event-fallback/v2"
)
EVENT_FALLBACK_VERIFIER_DOMAIN_V2: Final = (
    b"ChatHistoryAnalysis/dedup/event-fallback-verifier/v2"
)
NORMALIZED_MESSAGE_TYPE: Final = b"text"

NORMALIZED_RECORD_FIELDS: Final = (
    "createTime",
    "formattedTime",
    "calendarDate",
    "senderScope",
    "content",
    "fileRank",
    "sourceIndex",
)
_MANIFEST_FIELDS: Final = frozenset(
    {
        "aggregates",
        "chunks",
        "conversationFingerprint",
        "inputs",
        "normalizedSchemaVersion",
        "preprocessorVersion",
        "privacyValidation",
        "schemaVersion",
        "timePolicy",
        "timeRange",
    }
)
_AGGREGATE_FIELDS: Final = frozenset(
    {
        "annualSourceCount",
        "duplicateRecordCount",
        "eligibleTextRecordCount",
        "normalizedRecordCount",
        "overlap",
        "overlapVerificationCount",
        "rawMessageCount",
        "senderCounts",
        "skippedByReason",
        "skippedRecordCount",
        "sourceCount",
        "warningCount",
        "warningsByReason",
    }
)
_OVERLAP_FIELDS: Final = frozenset(
    {
        "annualRangeOverlapCount",
        "matchedEligibleRecordCount",
        "suspiciousAnnualOverlapCount",
        "unmatchedEligibleRecordCount",
        "verificationSourceCount",
    }
)
_TIME_RANGE_FIELDS: Final = frozenset(
    {
        "maximumCalendarDate",
        "maximumCreateTime",
        "maximumFormattedTime",
        "minimumCalendarDate",
        "minimumCreateTime",
        "minimumFormattedTime",
    }
)
_INPUT_FIELDS: Final = frozenset(
    {"byteSize", "fileRank", "role", "sha256", "suppliedOrdinal"}
)
_CHUNK_FIELDS: Final = frozenset(
    {"byteSize", "name", "recordCount", "sha256"}
)
_PRIVACY_FIELDS: Final = frozenset(
    {"forbiddenFieldCount", "status"}
)
_SENDER_COUNT_FIELDS: Final = frozenset({"other", "owner"})
_FORBIDDEN_KEYS: Final = frozenset(
    value.casefold()
    for value in {
        "rawContent",
        "source",
        "senderUsername",
        "senderDisplayName",
        "senderAvatar",
        "nickname",
        "remark",
        "displayName",
        "wxid",
        "ownerId",
        "platformMessageId",
        "localId",
        "avatar",
        "url",
        "chatRecords",
        "replyToMessageId",
        "groupNickname",
        "media",
        "payload",
        "path",
        "basename",
    }
)
_URL_PATTERN: Final = re.compile(
    r"(?i)(?<![A-Za-z0-9_])(?:https?://|www\.)[^\s<>\"']+"
)
_XML_PATTERN: Final = re.compile(
    r"<\s*(?:[!?]|/?[A-Za-z_][A-Za-z0-9_.:-]*(?:\s|/?>))"
)
_TIME_PATTERN: Final = re.compile(
    r"[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}\Z"
)
_DATE_PATTERN: Final = re.compile(
    r"[0-9]{4}-[0-9]{2}-[0-9]{2}\Z"
)
_FINGERPRINT_PATTERN: Final = re.compile(r"[0-9a-f]{64}\Z")
_CHUNK_NAME_PATTERN: Final = re.compile(r"chunk-[0-9]{4}\.ndjson\Z")
_MIN_SIGNED_64: Final = -(2**63)
_MAX_SIGNED_64: Final = (2**63) - 1
_EPOCH_UTC: Final = datetime(1970, 1, 1, tzinfo=timezone.utc)
_UTC_EIGHT: Final = timedelta(hours=8)


@dataclass(frozen=True, slots=True)
class IdentityDigests:
    kind: str
    digest: bytes = field(repr=False)
    verifier: bytes = field(repr=False)


@dataclass(frozen=True, slots=True)
class ChunkDescriptor:
    name: str
    byte_size: int
    record_count: int
    sha256: str


@dataclass(frozen=True, slots=True)
class DatasetBuildResult:
    normalized_record_count: int
    chunk_count: int
    duplicate_record_count: int
    warning_count: int
    annual_range_overlap_count: int
    suspicious_annual_overlap_count: int
    matched_verification_record_count: int
    unmatched_verification_record_count: int
    manifest_sha256: str


@dataclass(frozen=True, slots=True)
class VerifiedDataset:
    manifest: Mapping[str, Any]
    directory: Path = field(repr=False, compare=False)


@dataclass(frozen=True, slots=True)
class OverlapVerificationResult:
    source_count: int
    eligible_record_count: int
    matched_record_count: int
    unmatched_record_count: int


@dataclass(frozen=True, slots=True)
class RecoveryResult:
    candidate_count: int
    state_codes: tuple[str, ...]
    removed_count: int


@dataclass
class _OutputStats:
    record_count: int = 0
    byte_count: int = 0
    owner_count: int = 0
    other_count: int = 0
    minimum_create_time: int | None = None
    maximum_create_time: int | None = None
    minimum_formatted_time: str | None = None
    maximum_formatted_time: str | None = None
    minimum_calendar_date: str | None = None
    maximum_calendar_date: str | None = None

    def observe(self, record: Mapping[str, Any], encoded_size: int) -> None:
        self.record_count += 1
        self.byte_count += encoded_size
        if record["senderScope"] == "owner":
            self.owner_count += 1
        else:
            self.other_count += 1
        if self.minimum_create_time is None:
            self.minimum_create_time = record["createTime"]
            self.minimum_formatted_time = record["formattedTime"]
            self.minimum_calendar_date = record["calendarDate"]
        self.maximum_create_time = record["createTime"]
        self.maximum_formatted_time = record["formattedTime"]
        self.maximum_calendar_date = record["calendarDate"]


def _persistence_error(
    reason: DatasetPersistenceReasonCode,
    *,
    phase: str,
    category: FailureCategory = FailureCategory.OUTPUT,
    aggregate_count: int | None = None,
) -> DatasetPersistenceError:
    return DatasetPersistenceError(
        reason,
        phase=phase,
        category=category,
        aggregate_count=aggregate_count,
    )


def _is_integer(value: object) -> bool:
    return isinstance(value, int) and not isinstance(value, bool)


def _length_prefixed(value: bytes) -> bytes:
    return struct.pack(">Q", len(value)) + value


def _fingerprint_bytes(value: str) -> bytes:
    if _FINGERPRINT_PATTERN.fullmatch(value) is None:
        raise _persistence_error(
            DatasetPersistenceReasonCode.NORMALIZED_SCHEMA_INVALID,
            phase=DATASET_STAGING_PHASE,
            category=FailureCategory.INPUT_VALIDATION,
        )
    return bytes.fromhex(value)


def platform_identity(
    conversation_fingerprint: str,
    platform_message_id: str,
) -> IdentityDigests:
    """Digest one exact string platform ID without retaining it."""

    fingerprint = _fingerprint_bytes(conversation_fingerprint)
    identifier = platform_message_id.encode("utf-8")
    primary = (
        PLATFORM_ID_DOMAIN
        + _length_prefixed(fingerprint)
        + _length_prefixed(identifier)
    )
    verifier = (
        PLATFORM_ID_VERIFIER_DOMAIN
        + _length_prefixed(fingerprint)
        + _length_prefixed(identifier)
    )
    return IdentityDigests(
        kind="platform-id-v1",
        digest=hashlib.sha256(primary).digest(),
        verifier=hashlib.blake2b(verifier, digest_size=16).digest(),
    )


def fallback_identity(
    conversation_fingerprint: str,
    record: NormalizedMessage | Mapping[str, Any],
) -> IdentityDigests:
    """Digest the content hash and canonical minimized fields."""

    fingerprint = _fingerprint_bytes(conversation_fingerprint)
    if isinstance(record, NormalizedMessage):
        create_time = record.create_time
        formatted_time = record.formatted_time
        sender_scope = record.sender_scope
        content = record.content
    else:
        create_time = record["createTime"]
        formatted_time = record["formattedTime"]
        sender_scope = record["senderScope"]
        content = record["content"]
    content_digest = hashlib.sha256(content.encode("utf-8")).digest()

    def encoded(domain: bytes) -> bytes:
        return (
            domain
            + _length_prefixed(fingerprint)
            + struct.pack(">q", create_time)
            + _length_prefixed(formatted_time.encode("utf-8"))
            + _length_prefixed(sender_scope.encode("utf-8"))
            + _length_prefixed(NORMALIZED_MESSAGE_TYPE)
            + _length_prefixed(content_digest)
        )

    return IdentityDigests(
        kind="fallback-v1",
        digest=hashlib.sha256(encoded(FALLBACK_DOMAIN)).digest(),
        verifier=hashlib.blake2b(
            encoded(FALLBACK_VERIFIER_DOMAIN),
            digest_size=16,
        ).digest(),
    )


def _typed_transient_digest(tag: str, value: str) -> bytes:
    """Hash one transient value with an unambiguous type tag."""

    return hashlib.sha256(
        _length_prefixed(tag.encode("ascii"))
        + _length_prefixed(value.encode("utf-8"))
    ).digest()


def fallback_identity_v2(
    conversation_fingerprint: str,
    candidate: CanonicalEventCandidate | Mapping[str, Any],
) -> IdentityDigests | None:
    """Build the event-wide v2 fallback identity from transient evidence.

    A timestamp/category/sender tuple is intentionally insufficient.  The
    caller retains that occurrence when no typed payload digest is available,
    so an evidence-poor media event is never silently dropped.
    """

    fingerprint = _fingerprint_bytes(conversation_fingerprint)
    if isinstance(candidate, CanonicalEventCandidate):
        create_time = candidate.create_time
        sender_scope = candidate.sender_scope
        category = candidate.message_category
        raw_classification = candidate.raw_classification
        local_id = candidate.local_id
        content = candidate.content
        raw_content = candidate.raw_content
    else:
        create_time = candidate["createTime"]
        sender_scope = candidate["senderScope"]
        category = candidate["messageCategory"]
        raw_classification = tuple(candidate.get("rawClassification", ()))
        local_id = candidate.get("localId")
        content = candidate.get("content")
        raw_content = candidate.get("rawContent")

    if (
        not _is_integer(create_time)
        or not _MIN_SIGNED_64 <= create_time <= _MAX_SIGNED_64
        or sender_scope not in {None, "owner", "other"}
        or not isinstance(category, str)
    ):
        raise _persistence_error(
            DatasetPersistenceReasonCode.NORMALIZED_SCHEMA_INVALID,
            phase=DATASET_STAGING_PHASE,
            category=FailureCategory.INPUT_VALIDATION,
        )

    safe_local_id = (
        local_id
        if isinstance(local_id, str)
        and local_id
        and "\x00" not in local_id
        and len(local_id.encode("utf-8")) <= 4_096
        else None
    )
    safe_content = content if isinstance(content, str) and content else None
    safe_raw_content = (
        raw_content
        if isinstance(raw_content, str) and raw_content
        else None
    )
    # A local ID is only corroborating evidence.  It can never make an
    # otherwise evidence-free occurrence deduplicable by itself.
    if safe_content is None and safe_raw_content is None:
        return None

    sender_marker = "system" if sender_scope is None else sender_scope
    classification_bytes = bytearray()
    for key, value in raw_classification:
        if (
            not isinstance(key, str)
            or not isinstance(value, int)
            or isinstance(value, bool)
            or not -(2**53 - 1) <= value <= 2**53 - 1
        ):
            raise _persistence_error(
                DatasetPersistenceReasonCode.NORMALIZED_SCHEMA_INVALID,
                phase=DATASET_STAGING_PHASE,
                category=FailureCategory.INPUT_VALIDATION,
            )
        classification_bytes.extend(_length_prefixed(key.encode("ascii")))
        classification_bytes.extend(struct.pack(">q", value))

    def encoded(domain: bytes) -> bytes:
        output = bytearray(domain)
        output.extend(_length_prefixed(fingerprint))
        output.extend(struct.pack(">q", create_time))
        output.extend(_length_prefixed(sender_marker.encode("ascii")))
        output.extend(_length_prefixed(category.encode("utf-8")))
        output.extend(_length_prefixed(bytes(classification_bytes)))
        if safe_local_id is None:
            output.extend(_length_prefixed(b"local-id:absent"))
        else:
            output.extend(
                _length_prefixed(
                    b"local-id:" + _typed_transient_digest("localId", safe_local_id)
                )
            )
        if safe_content is None:
            output.extend(_length_prefixed(b"content:absent"))
        else:
            output.extend(
                _length_prefixed(
                    b"content:" + _typed_transient_digest("content", safe_content)
                )
            )
        if safe_raw_content is None:
            output.extend(_length_prefixed(b"raw-content:absent"))
        else:
            output.extend(
                _length_prefixed(
                    b"raw-content:"
                    + _typed_transient_digest("rawContent", safe_raw_content)
                )
            )
        return bytes(output)

    return IdentityDigests(
        kind="fallback-v2",
        digest=hashlib.sha256(encoded(EVENT_FALLBACK_DOMAIN_V2)).digest(),
        verifier=hashlib.blake2b(
            encoded(EVENT_FALLBACK_VERIFIER_DOMAIN_V2),
            digest_size=16,
        ).digest(),
    )


def canonical_event_identity(
    conversation_fingerprint: str,
    candidate: CanonicalEventCandidate,
) -> IdentityDigests | None:
    """Return a v2 identity or ``None`` for insufficient fallback evidence."""

    if candidate.platform_message_id:
        return platform_identity(
            conversation_fingerprint,
            candidate.platform_message_id,
        )
    return fallback_identity_v2(conversation_fingerprint, candidate)


def _identity_for(
    conversation_fingerprint: str,
    record: NormalizedMessage,
    platform_message_id: object,
    *,
    phase: str = DATASET_STAGING_PHASE,
    category: FailureCategory = FailureCategory.INPUT_VALIDATION,
) -> IdentityDigests:
    try:
        if isinstance(platform_message_id, str) and platform_message_id:
            return platform_identity(
                conversation_fingerprint,
                platform_message_id,
            )
        return fallback_identity(conversation_fingerprint, record)
    except UnicodeError:
        raise _persistence_error(
            DatasetPersistenceReasonCode.NORMALIZED_SCHEMA_INVALID,
            phase=phase,
            category=category,
        ) from None


def _mode(metadata: os.stat_result) -> int:
    return stat.S_IMODE(metadata.st_mode)


def _directory_flags() -> int:
    flags = os.O_RDONLY
    if hasattr(os, "O_DIRECTORY"):
        flags |= os.O_DIRECTORY
    if hasattr(os, "O_NOFOLLOW"):
        flags |= os.O_NOFOLLOW
    return flags


def _ensure_private_parent(path: Path) -> tuple[int, os.stat_result]:
    """Create missing parent components with no symlink traversal."""

    missing: list[str] = []
    current = path
    while True:
        try:
            metadata = os.lstat(current)
            break
        except FileNotFoundError:
            if current.parent == current:
                raise _persistence_error(
                    DatasetPersistenceReasonCode.OUTPUT_PARENT_UNSAFE,
                    phase=DATASET_STAGING_PHASE,
                )
            missing.append(current.name)
            current = current.parent
        except OSError:
            raise _persistence_error(
                DatasetPersistenceReasonCode.OUTPUT_PARENT_UNSAFE,
                phase=DATASET_STAGING_PHASE,
            ) from None
    if stat.S_ISLNK(metadata.st_mode) or not stat.S_ISDIR(metadata.st_mode):
        raise _persistence_error(
            DatasetPersistenceReasonCode.OUTPUT_PARENT_UNSAFE,
            phase=DATASET_STAGING_PHASE,
        )
    descriptor = -1
    try:
        descriptor = os.open(current, _directory_flags())
        for component in reversed(missing):
            try:
                os.mkdir(component, 0o700, dir_fd=descriptor)
            except FileExistsError:
                pass
            child = os.open(component, _directory_flags(), dir_fd=descriptor)
            child_metadata = os.fstat(child)
            if (
                not stat.S_ISDIR(child_metadata.st_mode)
                or child_metadata.st_uid != os.getuid()
                or _mode(child_metadata) & 0o022
            ):
                os.close(child)
                raise OSError
            os.close(descriptor)
            descriptor = child
        final_metadata = os.fstat(descriptor)
        if (
            not stat.S_ISDIR(final_metadata.st_mode)
            or final_metadata.st_uid != os.getuid()
            or _mode(final_metadata) & 0o022
            or Path(os.path.realpath(path)) != path
        ):
            raise OSError
        return descriptor, final_metadata
    except DatasetPersistenceError:
        if descriptor >= 0:
            os.close(descriptor)
        raise
    except (OSError, TypeError, ValueError):
        if descriptor >= 0:
            os.close(descriptor)
        raise _persistence_error(
            DatasetPersistenceReasonCode.OUTPUT_PARENT_UNSAFE,
            phase=DATASET_STAGING_PHASE,
        ) from None


def _secure_create_file(path: Path) -> BinaryIO:
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
    if hasattr(os, "O_NOFOLLOW"):
        flags |= os.O_NOFOLLOW
    descriptor = -1
    try:
        descriptor = os.open(path, flags, 0o600)
        metadata = os.fstat(descriptor)
        if (
            not stat.S_ISREG(metadata.st_mode)
            or metadata.st_uid != os.getuid()
            or _mode(metadata) != 0o600
        ):
            raise OSError
        return os.fdopen(descriptor, "wb")
    except (OSError, TypeError, ValueError):
        if descriptor >= 0:
            try:
                os.close(descriptor)
            except OSError:
                pass
        raise _persistence_error(
            DatasetPersistenceReasonCode.OUTPUT_WRITE_FAILED,
            phase=OUTPUT_SERIALIZATION_PHASE,
        ) from None


def _write_all(handle: BinaryIO, value: bytes) -> None:
    try:
        if handle.write(value) != len(value):
            raise OSError
    except (OSError, ValueError):
        raise _persistence_error(
            DatasetPersistenceReasonCode.OUTPUT_WRITE_FAILED,
            phase=OUTPUT_SERIALIZATION_PHASE,
        ) from None


def _flush_close(handle: BinaryIO) -> None:
    try:
        handle.flush()
        os.fsync(handle.fileno())
        handle.close()
    except (OSError, ValueError):
        try:
            handle.close()
        except OSError:
            pass
        raise _persistence_error(
            DatasetPersistenceReasonCode.OUTPUT_FLUSH_FAILED,
            phase=OUTPUT_SERIALIZATION_PHASE,
        ) from None


def _safe_unlink(path: Path) -> None:
    try:
        metadata = os.lstat(path)
    except FileNotFoundError:
        return
    except OSError:
        raise _persistence_error(
            DatasetPersistenceReasonCode.OUTPUT_CLEANUP_FAILED,
            phase=OUTPUT_PROMOTION_PHASE,
        ) from None
    if stat.S_ISDIR(metadata.st_mode) and not stat.S_ISLNK(metadata.st_mode):
        raise _persistence_error(
            DatasetPersistenceReasonCode.OUTPUT_CLEANUP_FAILED,
            phase=OUTPUT_PROMOTION_PHASE,
        )
    try:
        os.unlink(path)
    except OSError:
        raise _persistence_error(
            DatasetPersistenceReasonCode.OUTPUT_CLEANUP_FAILED,
            phase=OUTPUT_PROMOTION_PHASE,
        ) from None


def _remove_stage_entries(stage: Path) -> None:
    try:
        entries = list(os.scandir(stage))
    except FileNotFoundError:
        return
    except OSError:
        raise _persistence_error(
            DatasetPersistenceReasonCode.OUTPUT_CLEANUP_FAILED,
            phase=OUTPUT_PROMOTION_PHASE,
        ) from None
    for entry in entries:
        candidate = stage / entry.name
        try:
            metadata = os.lstat(candidate)
            if stat.S_ISDIR(metadata.st_mode) and not stat.S_ISLNK(
                metadata.st_mode
            ):
                os.rmdir(candidate)
            else:
                os.unlink(candidate)
        except OSError:
            raise _persistence_error(
                DatasetPersistenceReasonCode.OUTPUT_CLEANUP_FAILED,
                phase=OUTPUT_PROMOTION_PHASE,
            ) from None
    try:
        os.rmdir(stage)
    except FileNotFoundError:
        return
    except OSError:
        raise _persistence_error(
            DatasetPersistenceReasonCode.OUTPUT_CLEANUP_FAILED,
            phase=OUTPUT_PROMOTION_PHASE,
        ) from None


def _atomic_rename_exclusive(source: Path, destination: Path) -> None:
    source_bytes = os.fsencode(source)
    destination_bytes = os.fsencode(destination)
    libc = ctypes.CDLL(None, use_errno=True)
    result = -1
    if sys.platform == "darwin" and hasattr(libc, "renamex_np"):
        renamex = libc.renamex_np
        renamex.argtypes = [ctypes.c_char_p, ctypes.c_char_p, ctypes.c_uint]
        renamex.restype = ctypes.c_int
        result = renamex(source_bytes, destination_bytes, 0x00000004)
    elif sys.platform.startswith("linux") and hasattr(libc, "renameat2"):
        renameat2 = libc.renameat2
        renameat2.argtypes = [
            ctypes.c_int,
            ctypes.c_char_p,
            ctypes.c_int,
            ctypes.c_char_p,
            ctypes.c_uint,
        ]
        renameat2.restype = ctypes.c_int
        result = renameat2(
            -100,
            source_bytes,
            -100,
            destination_bytes,
            1,
        )
    if result != 0:
        observed_errno = ctypes.get_errno()
        if observed_errno in {errno.EEXIST, errno.ENOTEMPTY}:
            raise _persistence_error(
                DatasetPersistenceReasonCode.OUTPUT_DESTINATION_EXISTS,
                phase=OUTPUT_PROMOTION_PHASE,
            )
        raise _persistence_error(
            DatasetPersistenceReasonCode.OUTPUT_PROMOTION_FAILED,
            phase=OUTPUT_PROMOTION_PHASE,
        )


def _json_without_duplicates(value: str) -> Any:
    def object_pairs(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
        result: dict[str, Any] = {}
        for key, item in pairs:
            if key in result:
                raise ValueError
            result[key] = item
        return result

    return json.loads(
        value,
        object_pairs_hook=object_pairs,
        parse_constant=lambda constant: (_ for _ in ()).throw(ValueError()),
    )


def _canonical_record_bytes(record: Mapping[str, Any]) -> bytes:
    ordered = {field: record[field] for field in NORMALIZED_RECORD_FIELDS}
    try:
        encoded = json.dumps(
            ordered,
            ensure_ascii=False,
            separators=(",", ":"),
            allow_nan=False,
        ).encode("utf-8") + b"\n"
    except (TypeError, ValueError, UnicodeError):
        raise _persistence_error(
            DatasetPersistenceReasonCode.NORMALIZED_SCHEMA_INVALID,
            phase=OUTPUT_SERIALIZATION_PHASE,
            category=FailureCategory.INPUT_VALIDATION,
        ) from None
    return encoded


def _canonical_manifest_bytes(manifest: Mapping[str, Any]) -> bytes:
    try:
        return json.dumps(
            manifest,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
            allow_nan=False,
        ).encode("utf-8") + b"\n"
    except (TypeError, ValueError, UnicodeError):
        raise _persistence_error(
            DatasetPersistenceReasonCode.NORMALIZED_SCHEMA_INVALID,
            phase=OUTPUT_SERIALIZATION_PHASE,
            category=FailureCategory.INPUT_VALIDATION,
        ) from None


def _validate_forbidden(value: Any, *, record_payload: bool = False) -> None:
    if isinstance(value, Mapping):
        for key, item in value.items():
            if not isinstance(key, str) or key.casefold() in _FORBIDDEN_KEYS:
                raise ValueError
            _validate_forbidden(item, record_payload=record_payload)
        return
    if isinstance(value, list):
        for item in value:
            _validate_forbidden(item, record_payload=record_payload)
        return
    if isinstance(value, float):
        raise ValueError
    if isinstance(value, str):
        if "\x00" in value:
            raise ValueError
        if record_payload and (
            _URL_PATTERN.search(value) is not None
            or _XML_PATTERN.search(value) is not None
        ):
            raise ValueError


def _expected_time(create_time: int) -> tuple[str, str]:
    local = _EPOCH_UTC + timedelta(seconds=create_time) + _UTC_EIGHT
    formatted = (
        f"{local.year:04d}-{local.month:02d}-{local.day:02d} "
        f"{local.hour:02d}:{local.minute:02d}:{local.second:02d}"
    )
    return formatted, formatted[:10]


def validate_normalized_record(record: Any) -> None:
    """Validate the exact Stage 6 allow-list and payload contract."""

    try:
        if not isinstance(record, dict) or tuple(record) != NORMALIZED_RECORD_FIELDS:
            raise ValueError
        if (
            not _is_integer(record["createTime"])
            or not _MIN_SIGNED_64
            <= record["createTime"]
            <= _MAX_SIGNED_64
            or not isinstance(record["formattedTime"], str)
            or _TIME_PATTERN.fullmatch(record["formattedTime"]) is None
            or not isinstance(record["calendarDate"], str)
            or _DATE_PATTERN.fullmatch(record["calendarDate"]) is None
            or record["senderScope"] not in {"owner", "other"}
            or not isinstance(record["content"], str)
            or not record["content"]
            or not _is_integer(record["fileRank"])
            or record["fileRank"] < 0
            or not _is_integer(record["sourceIndex"])
            or record["sourceIndex"] < 0
        ):
            raise ValueError
        formatted, calendar = _expected_time(record["createTime"])
        if (
            record["formattedTime"] != formatted
            or record["calendarDate"] != calendar
        ):
            raise ValueError
        _validate_forbidden(record, record_payload=True)
    except (OverflowError, TypeError, ValueError):
        raise _persistence_error(
            DatasetPersistenceReasonCode.NORMALIZED_SCHEMA_INVALID,
            phase=OUTPUT_VERIFICATION_PHASE,
            category=FailureCategory.INPUT_VALIDATION,
        ) from None


def _exact_keys(value: Any, expected: frozenset[str]) -> dict[str, Any]:
    if not isinstance(value, dict) or frozenset(value) != expected:
        raise ValueError
    return value


def _validate_count_map(value: Any) -> None:
    if not isinstance(value, dict):
        raise ValueError
    for key, count in value.items():
        if (
            not isinstance(key, str)
            or not key
            or not _is_integer(count)
            or count < 0
        ):
            raise ValueError


def validate_manifest(manifest: Any) -> None:
    """Reject unknown fields, invalid types, and forbidden manifest payloads."""

    try:
        root = _exact_keys(manifest, _MANIFEST_FIELDS)
        if (
            root["schemaVersion"] != MANIFEST_SCHEMA_VERSION
            or root["normalizedSchemaVersion"] != NORMALIZED_SCHEMA_VERSION
            or root["preprocessorVersion"] != __version__
            or root["timePolicy"] != TIME_POLICY
            or not isinstance(root["conversationFingerprint"], str)
            or _FINGERPRINT_PATTERN.fullmatch(
                root["conversationFingerprint"]
            )
            is None
        ):
            raise ValueError
        inputs = root["inputs"]
        chunks = root["chunks"]
        if not isinstance(inputs, list) or not inputs:
            raise ValueError
        if not isinstance(chunks, list) or not chunks:
            raise ValueError
        seen_input_roles: dict[str, set[int]] = {
            SourceRole.ANNUAL_SOURCE.value: set(),
            SourceRole.OVERLAP_VERIFICATION.value: set(),
        }
        ranks: set[int] = set()
        for descriptor in inputs:
            item = _exact_keys(descriptor, _INPUT_FIELDS)
            role = item["role"]
            ordinal = item["suppliedOrdinal"]
            file_rank = item["fileRank"]
            if (
                role not in seen_input_roles
                or not _is_integer(ordinal)
                or ordinal < 1
                or ordinal in seen_input_roles[role]
                or not _is_integer(item["byteSize"])
                or item["byteSize"] < 0
                or not isinstance(item["sha256"], str)
                or _FINGERPRINT_PATTERN.fullmatch(item["sha256"]) is None
            ):
                raise ValueError
            seen_input_roles[role].add(ordinal)
            if role == SourceRole.ANNUAL_SOURCE.value:
                if (
                    not _is_integer(file_rank)
                    or file_rank < 0
                    or file_rank in ranks
                ):
                    raise ValueError
                ranks.add(file_rank)
            elif file_rank is not None:
                raise ValueError
        if ranks != set(range(len(seen_input_roles["annual-source"]))):
            raise ValueError
        expected_inputs = [
            (SourceRole.ANNUAL_SOURCE.value, ordinal)
            for ordinal in range(
                1,
                len(seen_input_roles[SourceRole.ANNUAL_SOURCE.value]) + 1,
            )
        ] + [
            (SourceRole.OVERLAP_VERIFICATION.value, ordinal)
            for ordinal in range(
                1,
                len(
                    seen_input_roles[
                        SourceRole.OVERLAP_VERIFICATION.value
                    ]
                )
                + 1,
            )
        ]
        if [
            (item["role"], item["suppliedOrdinal"])
            for item in inputs
        ] != expected_inputs:
            raise ValueError

        seen_chunks: set[str] = set()
        for index, descriptor in enumerate(chunks, start=1):
            item = _exact_keys(descriptor, _CHUNK_FIELDS)
            expected_name = f"chunk-{index:04d}.ndjson"
            if (
                item["name"] != expected_name
                or _CHUNK_NAME_PATTERN.fullmatch(item["name"]) is None
                or item["name"] in seen_chunks
                or not _is_integer(item["byteSize"])
                or not 0 < item["byteSize"] <= MAX_CHUNK_BYTES
                or not _is_integer(item["recordCount"])
                or item["recordCount"] < 1
                or not isinstance(item["sha256"], str)
                or _FINGERPRINT_PATTERN.fullmatch(item["sha256"]) is None
            ):
                raise ValueError
            seen_chunks.add(item["name"])

        aggregates = _exact_keys(root["aggregates"], _AGGREGATE_FIELDS)
        for key in (
            "annualSourceCount",
            "duplicateRecordCount",
            "eligibleTextRecordCount",
            "normalizedRecordCount",
            "overlapVerificationCount",
            "rawMessageCount",
            "skippedRecordCount",
            "sourceCount",
            "warningCount",
        ):
            if not _is_integer(aggregates[key]) or aggregates[key] < 0:
                raise ValueError
        if (
            aggregates["annualSourceCount"]
            != len(seen_input_roles["annual-source"])
            or aggregates["overlapVerificationCount"]
            != len(seen_input_roles["overlap-verification"])
            or aggregates["sourceCount"] != len(inputs)
            or aggregates["normalizedRecordCount"] < 1
            or aggregates["normalizedRecordCount"] > MAX_NORMALIZED_RECORDS
            or aggregates["normalizedRecordCount"]
            != sum(item["recordCount"] for item in chunks)
            or aggregates["eligibleTextRecordCount"]
            != (
                aggregates["normalizedRecordCount"]
                + aggregates["duplicateRecordCount"]
            )
            or (
                aggregates["eligibleTextRecordCount"]
                + aggregates["skippedRecordCount"]
                > aggregates["rawMessageCount"]
            )
        ):
            raise ValueError
        sender_counts = _exact_keys(
            aggregates["senderCounts"],
            _SENDER_COUNT_FIELDS,
        )
        if any(
            not _is_integer(count) or count < 0
            for count in sender_counts.values()
        ) or sum(sender_counts.values()) != aggregates["normalizedRecordCount"]:
            raise ValueError
        _validate_count_map(aggregates["skippedByReason"])
        _validate_count_map(aggregates["warningsByReason"])
        if (
            sum(aggregates["skippedByReason"].values())
            != aggregates["skippedRecordCount"]
            or sum(aggregates["warningsByReason"].values())
            != aggregates["warningCount"]
        ):
            raise ValueError
        overlap = _exact_keys(aggregates["overlap"], _OVERLAP_FIELDS)
        if any(
            not _is_integer(count) or count < 0
            for count in overlap.values()
        ):
            raise ValueError
        if (
            overlap["verificationSourceCount"]
            != aggregates["overlapVerificationCount"]
            or overlap["suspiciousAnnualOverlapCount"]
            > overlap["annualRangeOverlapCount"]
            or overlap["annualRangeOverlapCount"]
            > (
                aggregates["annualSourceCount"]
                * (aggregates["annualSourceCount"] - 1)
                // 2
            )
            or overlap["matchedEligibleRecordCount"]
            + overlap["unmatchedEligibleRecordCount"]
            > aggregates["rawMessageCount"]
            or aggregates["warningsByReason"].get(
                "SUSPICIOUS_ANNUAL_OVERLAP",
                0,
            )
            != overlap["suspiciousAnnualOverlapCount"]
        ):
            raise ValueError

        time_range = _exact_keys(root["timeRange"], _TIME_RANGE_FIELDS)
        if (
            not _is_integer(time_range["minimumCreateTime"])
            or not _is_integer(time_range["maximumCreateTime"])
            or time_range["minimumCreateTime"]
            > time_range["maximumCreateTime"]
            or not isinstance(time_range["minimumFormattedTime"], str)
            or not isinstance(time_range["maximumFormattedTime"], str)
            or not isinstance(time_range["minimumCalendarDate"], str)
            or not isinstance(time_range["maximumCalendarDate"], str)
        ):
            raise ValueError
        minimum_formatted, minimum_calendar = _expected_time(
            time_range["minimumCreateTime"]
        )
        maximum_formatted, maximum_calendar = _expected_time(
            time_range["maximumCreateTime"]
        )
        if (
            time_range["minimumFormattedTime"] != minimum_formatted
            or time_range["maximumFormattedTime"] != maximum_formatted
            or time_range["minimumCalendarDate"] != minimum_calendar
            or time_range["maximumCalendarDate"] != maximum_calendar
        ):
            raise ValueError
        privacy = _exact_keys(root["privacyValidation"], _PRIVACY_FIELDS)
        if privacy != {"forbiddenFieldCount": 0, "status": "passed"}:
            raise ValueError
        _validate_forbidden(root)
    except (OverflowError, TypeError, ValueError):
        raise _persistence_error(
            DatasetPersistenceReasonCode.NORMALIZED_SCHEMA_INVALID,
            phase=OUTPUT_VERIFICATION_PHASE,
            category=FailureCategory.INPUT_VALIDATION,
        ) from None


def _read_owned_regular(path: Path, *, maximum: int) -> bytes:
    descriptor = -1
    control = current_operation_control()
    try:
        control.checkpoint(OUTPUT_VERIFICATION_PHASE, "disk-read-before")
        flags = os.O_RDONLY
        if hasattr(os, "O_NOFOLLOW"):
            flags |= os.O_NOFOLLOW
        descriptor = os.open(path, flags)
        metadata = os.fstat(descriptor)
        if (
            not stat.S_ISREG(metadata.st_mode)
            or metadata.st_uid != os.getuid()
            or _mode(metadata) != 0o600
            or metadata.st_size > maximum
        ):
            raise OSError
        with os.fdopen(descriptor, "rb") as handle:
            descriptor = -1
            value = handle.read(maximum + 1)
        if len(value) > maximum:
            raise OSError
        control.checkpoint(OUTPUT_VERIFICATION_PHASE, "disk-read-after")
        return value
    except (OSError, ValueError):
        if descriptor >= 0:
            try:
                os.close(descriptor)
            except OSError:
                pass
        raise _persistence_error(
            DatasetPersistenceReasonCode.OUTPUT_INTEGRITY_FAILED,
            phase=OUTPUT_VERIFICATION_PHASE,
        ) from None


def _load_manifest(directory: Path) -> tuple[dict[str, Any], bytes]:
    raw = _read_owned_regular(
        directory / MANIFEST_NAME,
        maximum=MAX_MANIFEST_BYTES,
    )
    if raw.startswith(b"\xef\xbb\xbf") or not raw.endswith(b"\n"):
        raise _persistence_error(
            DatasetPersistenceReasonCode.OUTPUT_INTEGRITY_FAILED,
            phase=OUTPUT_VERIFICATION_PHASE,
        )
    try:
        text = raw.decode("utf-8", errors="strict")
        manifest = _json_without_duplicates(text)
    except (UnicodeError, ValueError, json.JSONDecodeError):
        raise _persistence_error(
            DatasetPersistenceReasonCode.NORMALIZED_SCHEMA_INVALID,
            phase=OUTPUT_VERIFICATION_PHASE,
            category=FailureCategory.INPUT_VALIDATION,
        ) from None
    validate_manifest(manifest)
    if _canonical_manifest_bytes(manifest) != raw:
        raise _persistence_error(
            DatasetPersistenceReasonCode.OUTPUT_INTEGRITY_FAILED,
            phase=OUTPUT_VERIFICATION_PHASE,
        )
    return manifest, raw


def _open_verified_chunk(path: Path, expected_size: int) -> BinaryIO:
    descriptor = -1
    try:
        flags = os.O_RDONLY
        if hasattr(os, "O_NOFOLLOW"):
            flags |= os.O_NOFOLLOW
        descriptor = os.open(path, flags)
        metadata = os.fstat(descriptor)
        if (
            not stat.S_ISREG(metadata.st_mode)
            or metadata.st_uid != os.getuid()
            or _mode(metadata) != 0o600
            or metadata.st_size != expected_size
        ):
            raise OSError
        return os.fdopen(descriptor, "rb")
    except (OSError, ValueError):
        if descriptor >= 0:
            try:
                os.close(descriptor)
            except OSError:
                pass
        raise _persistence_error(
            DatasetPersistenceReasonCode.OUTPUT_INTEGRITY_FAILED,
            phase=OUTPUT_VERIFICATION_PHASE,
        ) from None


def _iter_dataset_records(
    directory: Path,
    manifest: Mapping[str, Any],
) -> Iterator[dict[str, Any]]:
    control = current_operation_control()
    for chunk in manifest["chunks"]:
        digest = hashlib.sha256()
        count = 0
        size = 0
        with _open_verified_chunk(
            directory / chunk["name"],
            chunk["byteSize"],
        ) as handle:
            for raw_line in handle:
                control.checkpoint(
                    OUTPUT_VERIFICATION_PHASE,
                    "disk-verification-line-before",
                )
                size += len(raw_line)
                digest.update(raw_line)
                if not raw_line.endswith(b"\n") or raw_line == b"\n":
                    raise _persistence_error(
                        DatasetPersistenceReasonCode.NORMALIZED_SCHEMA_INVALID,
                        phase=OUTPUT_VERIFICATION_PHASE,
                        category=FailureCategory.INPUT_VALIDATION,
                    )
                try:
                    text = raw_line.decode("utf-8", errors="strict")
                    record = _json_without_duplicates(text)
                except (UnicodeError, ValueError, json.JSONDecodeError):
                    raise _persistence_error(
                        DatasetPersistenceReasonCode.NORMALIZED_SCHEMA_INVALID,
                        phase=OUTPUT_VERIFICATION_PHASE,
                        category=FailureCategory.INPUT_VALIDATION,
                    ) from None
                validate_normalized_record(record)
                if _canonical_record_bytes(record) != raw_line:
                    raise _persistence_error(
                        DatasetPersistenceReasonCode.OUTPUT_INTEGRITY_FAILED,
                        phase=OUTPUT_VERIFICATION_PHASE,
                    )
                count += 1
                yield record
                control.checkpoint(
                    OUTPUT_VERIFICATION_PHASE,
                    "disk-verification-line-after",
                )
        if (
            size != chunk["byteSize"]
            or count != chunk["recordCount"]
            or digest.hexdigest() != chunk["sha256"]
        ):
            raise _persistence_error(
                DatasetPersistenceReasonCode.OUTPUT_INTEGRITY_FAILED,
                phase=OUTPUT_VERIFICATION_PHASE,
            )


def verify_dataset_directory(
    directory: Path,
    *,
    require_exact_entries: bool = True,
    progress_base: int | None = None,
    progress_total: int | None = None,
) -> VerifiedDataset:
    """Re-read and verify a complete candidate or published dataset."""

    control = current_operation_control()
    if (progress_base is None) != (progress_total is None):
        raise ValueError
    if progress_base is not None and progress_total is not None:
        control.phase_progress(
            OUTPUT_VERIFICATION_PHASE,
            progress_base,
            progress_total,
            force=True,
        )
    control.checkpoint(
        OUTPUT_VERIFICATION_PHASE,
        "disk-verification-before",
    )
    try:
        metadata = os.lstat(directory)
        if (
            stat.S_ISLNK(metadata.st_mode)
            or not stat.S_ISDIR(metadata.st_mode)
            or metadata.st_uid != os.getuid()
            or _mode(metadata) != 0o700
        ):
            raise OSError
    except OSError:
        raise _persistence_error(
            DatasetPersistenceReasonCode.DATASET_SELECTION_INVALID,
            phase=OUTPUT_VERIFICATION_PHASE,
            category=FailureCategory.INPUT_VALIDATION,
        ) from None
    manifest, raw_manifest = _load_manifest(directory)
    expected_names = {
        MANIFEST_NAME,
        *(chunk["name"] for chunk in manifest["chunks"]),
    }
    if require_exact_entries:
        try:
            observed_names = set()
            for entry in os.scandir(directory):
                candidate = directory / entry.name
                entry_metadata = os.lstat(candidate)
                if (
                    stat.S_ISLNK(entry_metadata.st_mode)
                    or not stat.S_ISREG(entry_metadata.st_mode)
                    or entry_metadata.st_uid != os.getuid()
                    or _mode(entry_metadata) != 0o600
                ):
                    raise OSError
                observed_names.add(entry.name)
            if observed_names != expected_names:
                raise OSError
        except OSError:
            raise _persistence_error(
                DatasetPersistenceReasonCode.OUTPUT_INTEGRITY_FAILED,
                phase=OUTPUT_VERIFICATION_PHASE,
            ) from None

    aggregate = manifest["aggregates"]
    sender_counts = {"owner": 0, "other": 0}
    record_count = 0
    minimum: dict[str, Any] | None = None
    maximum: dict[str, Any] | None = None
    previous_order: tuple[int, int] | None = None
    for record in _iter_dataset_records(directory, manifest):
        if record["sourceIndex"] != record_count:
            raise _persistence_error(
                DatasetPersistenceReasonCode.OUTPUT_INTEGRITY_FAILED,
                phase=OUTPUT_VERIFICATION_PHASE,
            )
        if record["fileRank"] >= aggregate["annualSourceCount"]:
            raise _persistence_error(
                DatasetPersistenceReasonCode.OUTPUT_INTEGRITY_FAILED,
                phase=OUTPUT_VERIFICATION_PHASE,
            )
        order = (record["createTime"], record["fileRank"])
        if previous_order is not None and order < previous_order:
            raise _persistence_error(
                DatasetPersistenceReasonCode.OUTPUT_INTEGRITY_FAILED,
                phase=OUTPUT_VERIFICATION_PHASE,
            )
        previous_order = order
        sender_counts[record["senderScope"]] += 1
        if minimum is None:
            minimum = record
        maximum = record
        record_count += 1
    if minimum is None or maximum is None:
        raise _persistence_error(
            DatasetPersistenceReasonCode.NO_ELIGIBLE_TEXT_RECORDS,
            phase=OUTPUT_VERIFICATION_PHASE,
            category=FailureCategory.INPUT_VALIDATION,
        )
    time_range = manifest["timeRange"]
    if (
        record_count != aggregate["normalizedRecordCount"]
        or sender_counts != aggregate["senderCounts"]
        or time_range["minimumCreateTime"] != minimum["createTime"]
        or time_range["minimumFormattedTime"] != minimum["formattedTime"]
        or time_range["minimumCalendarDate"] != minimum["calendarDate"]
        or time_range["maximumCreateTime"] != maximum["createTime"]
        or time_range["maximumFormattedTime"] != maximum["formattedTime"]
        or time_range["maximumCalendarDate"] != maximum["calendarDate"]
        or len(raw_manifest)
        + sum(chunk["byteSize"] for chunk in manifest["chunks"])
        > MAX_NORMALIZED_DATASET_BYTES
    ):
        raise _persistence_error(
            DatasetPersistenceReasonCode.OUTPUT_INTEGRITY_FAILED,
            phase=OUTPUT_VERIFICATION_PHASE,
        )
    control.checkpoint(
        OUTPUT_VERIFICATION_PHASE,
        "disk-verification-complete",
    )
    if progress_base is not None and progress_total is not None:
        control.phase_progress(
            OUTPUT_VERIFICATION_PHASE,
            progress_base + 1,
            progress_total,
            force=True,
        )
    return VerifiedDataset(manifest=manifest, directory=directory)


class DatasetStagingConsumer(StagingConsumer):
    """Stream eligible records into one exact private SQLite table."""

    __slots__ = (
        "_complete",
        "_connection",
        "_database",
        "_destination",
        "_duplicate_count",
        "_matched_verification",
        "_published",
        "_stage",
        "_unmatched_verification",
        "_verification_uses_normalized_comparison",
        "_verification_eligible",
    )

    def __init__(
        self,
        destination: Path,
        *,
        allow_existing_destination: bool = False,
    ) -> None:
        self._destination = destination
        self._stage = destination
        self._database = destination
        self._connection: sqlite3.Connection | None = None
        self._duplicate_count = 0
        self._verification_eligible = 0
        self._matched_verification = 0
        self._unmatched_verification = 0
        self._verification_uses_normalized_comparison = (
            allow_existing_destination
        )
        self._complete = False
        self._published = False
        old_umask = os.umask(0o077)
        try:
            if not allow_existing_destination:
                try:
                    os.lstat(destination)
                except FileNotFoundError:
                    pass
                else:
                    raise _persistence_error(
                        DatasetPersistenceReasonCode.OUTPUT_DESTINATION_EXISTS,
                        phase=DATASET_STAGING_PHASE,
                    )
            parent_descriptor, parent_metadata = _ensure_private_parent(
                destination.parent
            )
            try:
                self._stage = self._create_stage(
                    destination.parent,
                    parent_descriptor,
                )
            finally:
                os.close(parent_descriptor)
            stage_metadata = os.lstat(self._stage)
            if (
                stage_metadata.st_dev != parent_metadata.st_dev
                or _mode(stage_metadata) != 0o700
            ):
                raise _persistence_error(
                    DatasetPersistenceReasonCode.OUTPUT_PARENT_UNSAFE,
                    phase=DATASET_STAGING_PHASE,
                )
            self._create_marker()
            self._database = self._stage / DATABASE_NAME
            with _secure_create_file(self._database):
                pass
            self._connection = self._open_database()
        except BaseException:
            try:
                if self._connection is not None:
                    self._connection.close()
            except sqlite3.Error:
                pass
            if self._stage != destination:
                try:
                    _remove_stage_entries(self._stage)
                except DatasetPersistenceError:
                    pass
            raise
        finally:
            os.umask(old_umask)

    @staticmethod
    def _create_stage(parent: Path, parent_descriptor: int) -> Path:
        for _ in range(32):
            name = STAGING_PREFIX + secrets.token_hex(16)
            try:
                os.mkdir(name, 0o700, dir_fd=parent_descriptor)
            except FileExistsError:
                continue
            except OSError:
                raise _persistence_error(
                    DatasetPersistenceReasonCode.OUTPUT_STAGING_FAILED,
                    phase=DATASET_STAGING_PHASE,
                ) from None
            stage = parent / name
            try:
                anchored = os.stat(
                    name,
                    dir_fd=parent_descriptor,
                    follow_symlinks=False,
                )
                lexical = os.lstat(stage)
                safe = (
                    stat.S_ISDIR(anchored.st_mode)
                    and stat.S_ISDIR(lexical.st_mode)
                    and not stat.S_ISLNK(lexical.st_mode)
                    and anchored.st_uid == os.getuid()
                    and lexical.st_uid == os.getuid()
                    and _mode(anchored) == 0o700
                    and _mode(lexical) == 0o700
                    and (anchored.st_dev, anchored.st_ino)
                    == (lexical.st_dev, lexical.st_ino)
                )
            except OSError:
                safe = False
            if not safe:
                try:
                    os.rmdir(name, dir_fd=parent_descriptor)
                except OSError:
                    pass
                raise _persistence_error(
                    DatasetPersistenceReasonCode.OUTPUT_STAGING_FAILED,
                    phase=DATASET_STAGING_PHASE,
                )
            return stage
        raise _persistence_error(
            DatasetPersistenceReasonCode.OUTPUT_STAGING_FAILED,
            phase=DATASET_STAGING_PHASE,
        )

    def _create_marker(self) -> None:
        handle = _secure_create_file(self._stage / STAGING_MARKER)
        _write_all(handle, b"chat-history-analysis-private-stage-v1\n")
        _flush_close(handle)

    def _open_database(self) -> sqlite3.Connection:
        uri = "file:" + quote(os.fspath(self._database), safe="/")
        uri += "?mode=rw&cache=private"
        try:
            connection = sqlite3.connect(
                uri,
                uri=True,
                timeout=0,
                isolation_level=None,
            )
            expected = (
                ("journal_mode", "DELETE", "delete"),
                ("temp_store", "MEMORY", 2),
                ("secure_delete", "ON", 1),
                ("busy_timeout", "0", 0),
            )
            for name, setting, observed in expected:
                row = connection.execute(
                    f"PRAGMA {name}={setting}"
                ).fetchone()
                if name == "journal_mode":
                    value = row[0] if row else None
                else:
                    queried = connection.execute(
                        f"PRAGMA {name}"
                    ).fetchone()
                    value = queried[0] if queried else None
                if value != observed:
                    raise sqlite3.DatabaseError
            connection.execute(
                """
                CREATE TABLE staging_records (
                    identity_kind TEXT NOT NULL
                        CHECK(identity_kind IN ('platform-id-v1','fallback-v1')),
                    identity_digest BLOB NOT NULL
                        CHECK(length(identity_digest) = 32),
                    identity_verifier BLOB NOT NULL
                        CHECK(length(identity_verifier) = 16),
                    create_time INTEGER NOT NULL,
                    formatted_time TEXT NOT NULL,
                    calendar_date TEXT NOT NULL,
                    sender_scope TEXT NOT NULL
                        CHECK(sender_scope IN ('owner','other')),
                    content TEXT NOT NULL,
                    file_rank INTEGER NOT NULL CHECK(file_rank >= 0),
                    source_array_index INTEGER NOT NULL
                        CHECK(source_array_index >= 0),
                    UNIQUE (
                        identity_kind,
                        identity_digest,
                        identity_verifier
                    )
                )
                """
            )
            connection.execute(
                """
                CREATE INDEX staging_collision_lookup
                ON staging_records(identity_kind, identity_digest)
                """
            )
            connection.execute(
                """
                CREATE INDEX staging_canonical_order
                ON staging_records(
                    create_time,
                    file_rank,
                    source_array_index
                )
                """
            )
            connection.execute("BEGIN IMMEDIATE")
            return connection
        except (sqlite3.Error, ValueError):
            try:
                connection.close()
            except (UnboundLocalError, sqlite3.Error):
                pass
            raise _persistence_error(
                DatasetPersistenceReasonCode.SQLITE_POLICY_FAILED,
                phase=DATASET_STAGING_PHASE,
            ) from None

    @property
    def duplicate_count(self) -> int:
        return self._duplicate_count

    def _connection_required(self) -> sqlite3.Connection:
        if self._connection is None:
            raise _persistence_error(
                DatasetPersistenceReasonCode.OUTPUT_STAGING_FAILED,
                phase=DATASET_STAGING_PHASE,
            )
        return self._connection

    @staticmethod
    def _validate_transient_record(
        descriptor: ValidatedSourceDescriptor,
        record: NormalizedMessage,
        owner_identity: str,
        peer_identity: str,
    ) -> None:
        try:
            if (
                descriptor.file_rank is None
                or record.file_rank != descriptor.file_rank
                or record.source_role is not descriptor.role
                or record.source_ordinal != descriptor.supplied_ordinal
                or not _is_integer(record.create_time)
                or not _MIN_SIGNED_64
                <= record.create_time
                <= _MAX_SIGNED_64
                or not _is_integer(record.source_array_index)
                or record.source_array_index < 0
                or record.sender_scope not in {"owner", "other"}
                or not record.content
            ):
                raise ValueError
            sensitive = (
                owner_identity,
                peer_identity,
                os.fspath(descriptor.path),
                descriptor.path.name,
            )
            if any(value and value in record.content for value in sensitive):
                raise ValueError
            if (
                _URL_PATTERN.search(record.content) is not None
                or _XML_PATTERN.search(record.content) is not None
            ):
                raise ValueError
        except (TypeError, ValueError):
            raise _persistence_error(
                DatasetPersistenceReasonCode.PRIVACY_VALIDATION_FAILED,
                phase=DATASET_STAGING_PHASE,
                category=FailureCategory.INPUT_VALIDATION,
            ) from None

    def _insert(
        self,
        identity: IdentityDigests,
        record: NormalizedMessage,
        *,
        file_rank: int,
        source_array_index: int,
    ) -> bool:
        connection = self._connection_required()
        try:
            existing = connection.execute(
                """
                SELECT identity_verifier, file_rank, source_array_index
                FROM staging_records
                WHERE identity_kind = ? AND identity_digest = ?
                """,
                (identity.kind, identity.digest),
            ).fetchone()
            if existing is not None:
                if bytes(existing[0]) != identity.verifier:
                    raise _persistence_error(
                        DatasetPersistenceReasonCode.CRYPTOGRAPHIC_IDENTITY_COLLISION,
                        phase=DATASET_STAGING_PHASE,
                        category=FailureCategory.INPUT_VALIDATION,
                    )
                if (file_rank, source_array_index) < (
                    existing[1],
                    existing[2],
                ):
                    connection.execute(
                        """
                        UPDATE staging_records
                        SET create_time = ?,
                            formatted_time = ?,
                            calendar_date = ?,
                            sender_scope = ?,
                            content = ?,
                            file_rank = ?,
                            source_array_index = ?
                        WHERE identity_kind = ?
                          AND identity_digest = ?
                          AND identity_verifier = ?
                        """,
                        (
                            record.create_time,
                            record.formatted_time,
                            record.calendar_date,
                            record.sender_scope,
                            record.content,
                            file_rank,
                            source_array_index,
                            identity.kind,
                            identity.digest,
                            identity.verifier,
                        ),
                    )
                return False
            connection.execute(
                """
                INSERT INTO staging_records VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    identity.kind,
                    identity.digest,
                    identity.verifier,
                    record.create_time,
                    record.formatted_time,
                    record.calendar_date,
                    record.sender_scope,
                    record.content,
                    file_rank,
                    source_array_index,
                ),
            )
            return True
        except DatasetPersistenceError:
            raise
        except sqlite3.Error:
            raise _persistence_error(
                DatasetPersistenceReasonCode.OUTPUT_WRITE_FAILED,
                phase=DATASET_STAGING_PHASE,
            ) from None

    def stage_annual_record(
        self,
        descriptor: ValidatedSourceDescriptor,
        record: NormalizedMessage,
        platform_message_id: object,
        *,
        owner_identity: str,
        peer_identity: str,
    ) -> None:
        self._validate_transient_record(
            descriptor,
            record,
            owner_identity,
            peer_identity,
        )
        identity = _identity_for(
            descriptor.conversation_fingerprint,
            record,
            platform_message_id,
        )
        inserted = self._insert(
            identity,
            record,
            file_rank=descriptor.file_rank,
            source_array_index=record.source_array_index,
        )
        if not inserted:
            self._duplicate_count += 1
        current_operation_control().checkpoint(
            DATASET_STAGING_PHASE,
            "sqlite-record-boundary",
        )

    def observe_verification_record(
        self,
        descriptor: ValidatedSourceDescriptor,
        record: NormalizedMessage,
        platform_message_id: object,
        *,
        owner_identity: str,
        peer_identity: str,
    ) -> None:
        if descriptor.role is not SourceRole.OVERLAP_VERIFICATION:
            raise TypeError
        try:
            connection = self._connection_required()
            if self._verification_uses_normalized_comparison:
                row = connection.execute(
                    """
                    SELECT 1
                    FROM staging_records
                    WHERE create_time = ?
                      AND formatted_time = ?
                      AND calendar_date = ?
                      AND sender_scope = ?
                      AND content = ?
                    LIMIT 1
                    """,
                    (
                        record.create_time,
                        record.formatted_time,
                        record.calendar_date,
                        record.sender_scope,
                        record.content,
                    ),
                ).fetchone()
            else:
                identity = _identity_for(
                    descriptor.conversation_fingerprint,
                    record,
                    platform_message_id,
                    phase=OVERLAP_VERIFICATION_PHASE,
                    category=FailureCategory.VERIFICATION,
                )
                row = connection.execute(
                    """
                    SELECT identity_verifier
                    FROM staging_records
                    WHERE identity_kind = ? AND identity_digest = ?
                    """,
                    (identity.kind, identity.digest),
                ).fetchone()
                if row is not None and bytes(row[0]) != identity.verifier:
                    raise _persistence_error(
                        DatasetPersistenceReasonCode.CRYPTOGRAPHIC_IDENTITY_COLLISION,
                        phase=OVERLAP_VERIFICATION_PHASE,
                        category=FailureCategory.VERIFICATION,
                    )
        except sqlite3.Error:
            raise _persistence_error(
                DatasetPersistenceReasonCode.OVERLAP_VERIFICATION_FAILED,
                phase=OVERLAP_VERIFICATION_PHASE,
                category=FailureCategory.VERIFICATION,
            ) from None
        self._verification_eligible += 1
        if row is None:
            self._unmatched_verification += 1
        else:
            self._matched_verification += 1
        current_operation_control().checkpoint(
            DATASET_STAGING_PHASE,
            "sqlite-record-boundary",
        )

    def stage_existing_record(
        self,
        conversation_fingerprint: str,
        record: Mapping[str, Any],
    ) -> None:
        transient = NormalizedMessage(
            source_role=SourceRole.ANNUAL_SOURCE,
            source_ordinal=1,
            file_rank=record["fileRank"],
            source_array_index=record["sourceIndex"],
            create_time=record["createTime"],
            formatted_time=record["formattedTime"],
            calendar_date=record["calendarDate"],
            sender_scope=record["senderScope"],
            content=record["content"],
        )
        identity = fallback_identity(conversation_fingerprint, record)
        self._insert(
            identity,
            transient,
            file_rank=record["fileRank"],
            source_array_index=record["sourceIndex"],
        )

    def complete(self) -> None:
        try:
            self._connection_required().execute("COMMIT")
            self._complete = True
        except sqlite3.Error:
            raise _persistence_error(
                DatasetPersistenceReasonCode.OUTPUT_FLUSH_FAILED,
                phase=DATASET_STAGING_PHASE,
            ) from None

    def _close_database(self) -> None:
        connection = self._connection
        self._connection = None
        if connection is not None:
            try:
                connection.close()
            except sqlite3.Error:
                raise _persistence_error(
                    DatasetPersistenceReasonCode.OUTPUT_FLUSH_FAILED,
                    phase=OUTPUT_PROMOTION_PHASE,
                ) from None

    def abort(self) -> None:
        if self._published:
            return
        connection = self._connection
        self._connection = None
        if connection is not None:
            try:
                connection.rollback()
            except sqlite3.Error:
                pass
            try:
                connection.close()
            except sqlite3.Error:
                pass
        if self._stage != self._destination:
            _remove_stage_entries(self._stage)

    def _write_chunks(
        self,
    ) -> tuple[tuple[ChunkDescriptor, ...], _OutputStats]:
        connection = self._connection_required()
        try:
            cursor = connection.execute(
                """
                SELECT create_time, formatted_time, calendar_date,
                       sender_scope, content, file_rank
                FROM staging_records
                ORDER BY create_time, file_rank, source_array_index
                """
            )
        except sqlite3.Error:
            raise _persistence_error(
                DatasetPersistenceReasonCode.OUTPUT_WRITE_FAILED,
                phase=OUTPUT_SERIALIZATION_PHASE,
            ) from None

        try:
            total_records = int(
                connection.execute(
                    "SELECT COUNT(*) FROM staging_records"
                ).fetchone()[0]
            )
        except (sqlite3.Error, TypeError, ValueError):
            raise _persistence_error(
                DatasetPersistenceReasonCode.OUTPUT_WRITE_FAILED,
                phase=OUTPUT_SERIALIZATION_PHASE,
            ) from None
        progress_total = max(total_records, 1) + 1
        control = current_operation_control()
        control.phase_progress(
            OUTPUT_SERIALIZATION_PHASE,
            0,
            progress_total,
            force=True,
        )
        control.checkpoint(
            OUTPUT_SERIALIZATION_PHASE,
            "chunk-writing-before",
        )
        chunks: list[ChunkDescriptor] = []
        stats = _OutputStats()
        handle: BinaryIO | None = None
        chunk_name = ""
        chunk_size = 0
        chunk_count = 0
        chunk_digest = hashlib.sha256()

        def close_chunk() -> None:
            nonlocal handle, chunk_size, chunk_count, chunk_digest
            if handle is None:
                return
            _flush_close(handle)
            handle = None
            chunks.append(
                ChunkDescriptor(
                    name=chunk_name,
                    byte_size=chunk_size,
                    record_count=chunk_count,
                    sha256=chunk_digest.hexdigest(),
                )
            )

        try:
            for row in cursor:
                control.checkpoint(
                    OUTPUT_SERIALIZATION_PHASE,
                    "chunk-record-before",
                )
                if stats.record_count >= MAX_NORMALIZED_RECORDS:
                    raise _persistence_error(
                        DatasetPersistenceReasonCode.NORMALIZED_RECORD_LIMIT_EXCEEDED,
                        phase=OUTPUT_SERIALIZATION_PHASE,
                        category=FailureCategory.CAPACITY,
                    )
                record = {
                    "createTime": row[0],
                    "formattedTime": row[1],
                    "calendarDate": row[2],
                    "senderScope": row[3],
                    "content": row[4],
                    "fileRank": row[5],
                    "sourceIndex": stats.record_count,
                }
                validate_normalized_record(record)
                encoded = _canonical_record_bytes(record)
                if len(encoded) > MAX_CHUNK_BYTES:
                    raise _persistence_error(
                        DatasetPersistenceReasonCode.NORMALIZED_RECORD_TOO_LARGE,
                        phase=OUTPUT_SERIALIZATION_PHASE,
                        category=FailureCategory.CAPACITY,
                    )
                if handle is not None and chunk_size + len(encoded) > (
                    MAX_CHUNK_BYTES
                ):
                    close_chunk()
                    chunk_size = 0
                    chunk_count = 0
                    chunk_digest = hashlib.sha256()
                if handle is None:
                    chunk_name = f"chunk-{len(chunks) + 1:04d}.ndjson"
                    handle = _secure_create_file(self._stage / chunk_name)
                _write_all(handle, encoded)
                chunk_size += len(encoded)
                chunk_count += 1
                chunk_digest.update(encoded)
                stats.observe(record, len(encoded))
                control.phase_progress(
                    OUTPUT_SERIALIZATION_PHASE,
                    stats.record_count,
                    progress_total,
                )
                control.checkpoint(
                    OUTPUT_SERIALIZATION_PHASE,
                    "chunk-record-after",
                )
                if stats.byte_count > MAX_NORMALIZED_DATASET_BYTES:
                    raise _persistence_error(
                        DatasetPersistenceReasonCode.NORMALIZED_DATASET_LIMIT_EXCEEDED,
                        phase=OUTPUT_SERIALIZATION_PHASE,
                        category=FailureCategory.CAPACITY,
                    )
            close_chunk()
        except BaseException:
            if handle is not None:
                try:
                    handle.close()
                except OSError:
                    pass
            raise
        if stats.record_count == 0:
            raise _persistence_error(
                DatasetPersistenceReasonCode.NO_ELIGIBLE_TEXT_RECORDS,
                phase=OUTPUT_SERIALIZATION_PHASE,
                category=FailureCategory.INPUT_VALIDATION,
            )
        return tuple(chunks), stats

    @staticmethod
    def _range_overlap(
        result: ValidationResult,
    ) -> tuple[int, int]:
        overlap_count = 0
        suspicious_count = 0
        for index, descriptor in enumerate(result.annual_sources):
            for earlier in result.annual_sources[:index]:
                duration = min(
                    earlier.maximum_create_time,
                    descriptor.maximum_create_time,
                ) - max(
                    earlier.minimum_create_time,
                    descriptor.minimum_create_time,
                )
                if duration < 0:
                    continue
                overlap_count += 1
                if duration > SUSPICIOUS_OVERLAP_SECONDS:
                    suspicious_count += 1
        return overlap_count, suspicious_count

    def _manifest(
        self,
        result: ValidationResult,
        chunks: tuple[ChunkDescriptor, ...],
        stats: _OutputStats,
    ) -> dict[str, Any]:
        overlap_count, suspicious_count = self._range_overlap(result)
        warnings = dict(result.annual_normalization.warnings_by_reason)
        if suspicious_count:
            warnings["SUSPICIOUS_ANNUAL_OVERLAP"] = suspicious_count
        inputs = []
        for descriptor in sorted(
            result.annual_sources,
            key=lambda item: item.supplied_ordinal,
        ):
            inputs.append(
                {
                    "role": descriptor.role.value,
                    "suppliedOrdinal": descriptor.supplied_ordinal,
                    "fileRank": descriptor.file_rank,
                    "byteSize": descriptor.fingerprint.size_bytes,
                    "sha256": descriptor.fingerprint.sha256,
                }
            )
        for descriptor in sorted(
            result.overlap_verifications,
            key=lambda item: item.supplied_ordinal,
        ):
            inputs.append(
                {
                    "role": descriptor.role.value,
                    "suppliedOrdinal": descriptor.supplied_ordinal,
                    "fileRank": None,
                    "byteSize": descriptor.fingerprint.size_bytes,
                    "sha256": descriptor.fingerprint.sha256,
                }
            )
        if (
            stats.minimum_create_time is None
            or stats.maximum_create_time is None
            or stats.minimum_formatted_time is None
            or stats.maximum_formatted_time is None
            or stats.minimum_calendar_date is None
            or stats.maximum_calendar_date is None
        ):
            raise TypeError
        return {
            "schemaVersion": MANIFEST_SCHEMA_VERSION,
            "normalizedSchemaVersion": NORMALIZED_SCHEMA_VERSION,
            "preprocessorVersion": __version__,
            "conversationFingerprint": result.conversation_fingerprint,
            "timePolicy": TIME_POLICY,
            "inputs": inputs,
            "chunks": [
                {
                    "name": chunk.name,
                    "byteSize": chunk.byte_size,
                    "recordCount": chunk.record_count,
                    "sha256": chunk.sha256,
                }
                for chunk in chunks
            ],
            "aggregates": {
                "sourceCount": len(inputs),
                "annualSourceCount": len(result.annual_sources),
                "overlapVerificationCount": len(
                    result.overlap_verifications
                ),
                "rawMessageCount": result.aggregate_raw_message_count,
                "eligibleTextRecordCount": (
                    result.annual_normalization.eligible_count
                ),
                "normalizedRecordCount": stats.record_count,
                "skippedRecordCount": (
                    result.annual_normalization.skipped_count
                ),
                "duplicateRecordCount": self._duplicate_count,
                "warningCount": sum(warnings.values()),
                "senderCounts": {
                    "owner": stats.owner_count,
                    "other": stats.other_count,
                },
                "skippedByReason": dict(
                    result.annual_normalization.skipped_by_reason
                ),
                "warningsByReason": dict(sorted(warnings.items())),
                "overlap": {
                    "annualRangeOverlapCount": overlap_count,
                    "suspiciousAnnualOverlapCount": suspicious_count,
                    "verificationSourceCount": len(
                        result.overlap_verifications
                    ),
                    "matchedEligibleRecordCount": (
                        self._matched_verification
                    ),
                    "unmatchedEligibleRecordCount": (
                        self._unmatched_verification
                    ),
                },
            },
            "timeRange": {
                "minimumCreateTime": stats.minimum_create_time,
                "maximumCreateTime": stats.maximum_create_time,
                "minimumFormattedTime": stats.minimum_formatted_time,
                "maximumFormattedTime": stats.maximum_formatted_time,
                "minimumCalendarDate": stats.minimum_calendar_date,
                "maximumCalendarDate": stats.maximum_calendar_date,
            },
            "privacyValidation": {
                "status": "passed",
                "forbiddenFieldCount": 0,
            },
        }

    def _remove_non_output_entries(
        self,
        output_names: set[str],
    ) -> None:
        self._close_database()
        control = current_operation_control()
        try:
            for entry in list(os.scandir(self._stage)):
                if entry.name in output_names:
                    continue
                control.checkpoint(
                    OUTPUT_PROMOTION_PHASE,
                    "pre-promotion-cleanup-entry",
                )
                candidate = self._stage / entry.name
                metadata = os.lstat(candidate)
                if (
                    stat.S_ISLNK(metadata.st_mode)
                    or not stat.S_ISREG(metadata.st_mode)
                    or metadata.st_uid != os.getuid()
                    or _mode(metadata) != 0o600
                ):
                    raise OSError
                os.unlink(candidate)
        except OSError:
            raise _persistence_error(
                DatasetPersistenceReasonCode.OUTPUT_CLEANUP_FAILED,
                phase=OUTPUT_PROMOTION_PHASE,
            ) from None
        try:
            observed = {entry.name for entry in os.scandir(self._stage)}
        except OSError:
            raise _persistence_error(
                DatasetPersistenceReasonCode.OUTPUT_CLEANUP_FAILED,
                phase=OUTPUT_PROMOTION_PHASE,
            ) from None
        if observed != output_names:
            raise _persistence_error(
                DatasetPersistenceReasonCode.OUTPUT_CLEANUP_FAILED,
                phase=OUTPUT_PROMOTION_PHASE,
            )

    def publish(self, result: ValidationResult) -> DatasetBuildResult:
        if not self._complete or self._published:
            raise _persistence_error(
                DatasetPersistenceReasonCode.OUTPUT_STAGING_FAILED,
                phase=OUTPUT_SERIALIZATION_PHASE,
            )
        control = current_operation_control()
        chunks, stats = self._write_chunks()
        manifest = self._manifest(result, chunks, stats)
        validate_manifest(manifest)
        manifest_bytes = _canonical_manifest_bytes(manifest)
        if stats.byte_count + len(manifest_bytes) > (
            MAX_NORMALIZED_DATASET_BYTES
        ):
            raise _persistence_error(
                DatasetPersistenceReasonCode.NORMALIZED_DATASET_LIMIT_EXCEEDED,
                phase=OUTPUT_SERIALIZATION_PHASE,
                category=FailureCategory.CAPACITY,
            )
        manifest_handle = _secure_create_file(self._stage / MANIFEST_NAME)
        control.checkpoint(
            OUTPUT_SERIALIZATION_PHASE,
            "manifest-write-before",
        )
        _write_all(manifest_handle, manifest_bytes)
        _flush_close(manifest_handle)
        control.checkpoint(
            OUTPUT_SERIALIZATION_PHASE,
            "manifest-write-after",
        )
        control.phase_progress(
            OUTPUT_SERIALIZATION_PHASE,
            stats.record_count + 1,
            stats.record_count + 1,
            force=True,
        )
        candidate = verify_dataset_directory(
            self._stage,
            require_exact_entries=False,
            progress_base=0,
            progress_total=4,
        )
        if candidate.manifest != manifest:
            raise _persistence_error(
                DatasetPersistenceReasonCode.OUTPUT_INTEGRITY_FAILED,
                phase=OUTPUT_VERIFICATION_PHASE,
            )
        output_names = {
            MANIFEST_NAME,
            *(chunk.name for chunk in chunks),
        }
        self._remove_non_output_entries(output_names)
        verified = verify_dataset_directory(
            self._stage,
            progress_base=1,
            progress_total=4,
        )
        if verified.manifest != manifest:
            raise _persistence_error(
                DatasetPersistenceReasonCode.OUTPUT_INTEGRITY_FAILED,
                phase=OUTPUT_VERIFICATION_PHASE,
            )
        control.phase_progress(
            OUTPUT_VERIFICATION_PHASE,
            2,
            4,
            force=True,
        )
        control.checkpoint(
            OUTPUT_VERIFICATION_PHASE,
            "input-reverification-before",
        )
        _verify_inputs_unchanged(result)
        control.checkpoint(
            OUTPUT_VERIFICATION_PHASE,
            "input-reverification-after",
        )
        control.phase_progress(
            OUTPUT_VERIFICATION_PHASE,
            3,
            4,
            force=True,
        )
        try:
            os.lstat(self._destination)
        except FileNotFoundError:
            pass
        else:
            raise _persistence_error(
                DatasetPersistenceReasonCode.OUTPUT_DESTINATION_EXISTS,
                phase=OUTPUT_PROMOTION_PHASE,
            )
        parent_metadata = os.stat(
            self._destination.parent,
            follow_symlinks=False,
        )
        stage_metadata = os.stat(self._stage, follow_symlinks=False)
        if parent_metadata.st_dev != stage_metadata.st_dev:
            raise _persistence_error(
                DatasetPersistenceReasonCode.OUTPUT_PARENT_UNSAFE,
                phase=OUTPUT_PROMOTION_PHASE,
            )
        parent_descriptor = -1
        stage_descriptor = -1
        try:
            parent_descriptor = os.open(
                self._destination.parent,
                _directory_flags(),
            )
            stage_descriptor = os.open(self._stage, _directory_flags())
            os.fsync(stage_descriptor)
            os.fsync(parent_descriptor)
        except OSError:
            raise _persistence_error(
                DatasetPersistenceReasonCode.OUTPUT_FLUSH_FAILED,
                phase=OUTPUT_PROMOTION_PHASE,
            ) from None
        finally:
            if stage_descriptor >= 0:
                os.close(stage_descriptor)
            if parent_descriptor >= 0:
                os.close(parent_descriptor)
        control.checkpoint(
            OUTPUT_VERIFICATION_PHASE,
            "promotion-readiness-complete",
        )
        control.phase_progress(
            OUTPUT_VERIFICATION_PHASE,
            4,
            4,
            force=True,
        )
        control.phase_progress(
            OUTPUT_PROMOTION_PHASE,
            0,
            1,
            force=True,
        )
        with control.promotion_commit():
            _atomic_rename_exclusive(self._stage, self._destination)
            self._published = True
        parent_descriptor = -1
        try:
            parent_descriptor = os.open(
                self._destination.parent,
                _directory_flags(),
            )
            os.fsync(parent_descriptor)
        except OSError:
            # The exclusive rename has already produced a complete, validated
            # final dataset. A post-rename durability hint cannot safely turn
            # that successful atomic state transition into a reported failure.
            pass
        finally:
            if parent_descriptor >= 0:
                os.close(parent_descriptor)
        control.phase_progress(
            OUTPUT_PROMOTION_PHASE,
            1,
            1,
            force=True,
        )
        return DatasetBuildResult(
            normalized_record_count=stats.record_count,
            chunk_count=len(chunks),
            duplicate_record_count=self._duplicate_count,
            warning_count=manifest["aggregates"]["warningCount"],
            annual_range_overlap_count=manifest["aggregates"]["overlap"][
                "annualRangeOverlapCount"
            ],
            suspicious_annual_overlap_count=manifest["aggregates"][
                "overlap"
            ]["suspiciousAnnualOverlapCount"],
            matched_verification_record_count=self._matched_verification,
            unmatched_verification_record_count=self._unmatched_verification,
            manifest_sha256=hashlib.sha256(manifest_bytes).hexdigest(),
        )


def _descriptor_for_verification(
    context: SourceContext,
    evidence: FirstPassEvidence,
    summary: SourcePassSummary,
) -> ValidatedSourceDescriptor:
    return ValidatedSourceDescriptor(
        fingerprint=SourceFingerprint(
            role=context.role,
            supplied_ordinal=context.source_ordinal,
            size_bytes=evidence.size_bytes,
            sha256=evidence.sha256,
        ),
        raw_message_count=summary.message_count,
        minimum_create_time=summary.minimum_create_time,
        maximum_create_time=summary.maximum_create_time,
        conversation_fingerprint=summary.conversation_fingerprint,
        file_rank=None,
        path=context.path,
        source_device=evidence.device,
        source_inode=evidence.inode,
        source_modified_time_ns=evidence.modified_time_ns,
        source_changed_time_ns=evidence.changed_time_ns,
    )


def _evidence_for_descriptor(
    descriptor: ValidatedSourceDescriptor,
) -> FirstPassEvidence:
    return FirstPassEvidence(
        sha256=descriptor.fingerprint.sha256,
        size_bytes=descriptor.fingerprint.size_bytes,
        device=descriptor.source_device,
        inode=descriptor.source_inode,
        modified_time_ns=descriptor.source_modified_time_ns,
        changed_time_ns=descriptor.source_changed_time_ns,
    )


def _assert_unchanged(
    descriptor: ValidatedSourceDescriptor,
    summary: SourcePassSummary,
) -> None:
    if (
        descriptor.raw_message_count != summary.message_count
        or descriptor.minimum_create_time != summary.minimum_create_time
        or descriptor.maximum_create_time != summary.maximum_create_time
        or descriptor.conversation_fingerprint
        != summary.conversation_fingerprint
    ):
        raise SourceValidationError(
            SourceValidationReasonCode.SOURCE_MUTATED,
            phase=SOURCE_STAGING_PHASE,
            role=descriptor.role,
            source_ordinal=descriptor.supplied_ordinal,
            category=FailureCategory.VERIFICATION,
        )


def _verify_inputs_unchanged(result: ValidationResult) -> None:
    """Re-hash every raw input immediately before final promotion."""

    aggregate_bytes = AggregateRawByteCounter()
    for descriptor in (
        *result.annual_sources,
        *result.overlap_verifications,
    ):
        context = SourceContext(
            role=descriptor.role,
            source_ordinal=descriptor.supplied_ordinal,
            path=descriptor.path,
        )
        observed = digest_and_validate_utf8(
            context,
            aggregate_bytes,
            checkpoint_phase=OUTPUT_VERIFICATION_PHASE,
        )
        expected = _evidence_for_descriptor(descriptor)
        if observed != expected:
            raise SourceValidationError(
                SourceValidationReasonCode.SOURCE_MUTATED,
                phase=OUTPUT_VERIFICATION_PHASE,
                role=descriptor.role,
                source_ordinal=descriptor.supplied_ordinal,
                category=(
                    FailureCategory.VERIFICATION
                    if descriptor.role is SourceRole.OVERLAP_VERIFICATION
                    else FailureCategory.INPUT_VALIDATION
                ),
            )


def verify_overlap_against_dataset(
    inputs: PreflightedOverlapVerification,
    backend: BackendEvidence,
) -> OverlapVerificationResult:
    """Validate raw verification sources against an immutable dataset."""

    verified = verify_dataset_directory(inputs.dataset_directory)
    fingerprint = verified.manifest["conversationFingerprint"]
    consumer = DatasetStagingConsumer(
        inputs.dataset_directory,
        allow_existing_destination=True,
    )
    try:
        for record in _iter_dataset_records(
            inputs.dataset_directory,
            verified.manifest,
        ):
            consumer.stage_existing_record(fingerprint, record)
        contexts = tuple(
            SourceContext(
                role=SourceRole.OVERLAP_VERIFICATION,
                source_ordinal=ordinal,
                path=path,
            )
            for ordinal, path in enumerate(
                inputs.overlap_verifications,
                start=1,
            )
        )
        aggregate_bytes = AggregateRawByteCounter()
        messages = AggregateMessageCounter()
        descriptors: list[ValidatedSourceDescriptor] = []
        identities: list[SourcePassSummary] = []
        for context in contexts:
            evidence = digest_and_validate_utf8(context, aggregate_bytes)
            summary = parse_and_validate_source(
                context,
                evidence,
                backend,
                aggregate_messages=messages,
            )
            if summary.conversation_fingerprint != fingerprint:
                raise SourceValidationError(
                    SourceValidationReasonCode.DIFFERENT_CONVERSATION,
                    phase=OVERLAP_VERIFICATION_PHASE,
                    role=context.role,
                    source_ordinal=context.source_ordinal,
                    category=FailureCategory.VERIFICATION,
                    field="session",
                )
            descriptors.append(
                _descriptor_for_verification(context, evidence, summary)
            )
            identities.append(summary)
        normalizer = MessageNormalizationConsumer(
            on_verification_eligible=(
                lambda descriptor, record, platform_id, owner, peer: (
                    consumer.observe_verification_record(
                        descriptor,
                        record,
                        platform_id,
                        owner_identity=owner,
                        peer_identity=peer,
                    )
                )
            )
        )
        for descriptor, identity in zip(
            descriptors,
            identities,
            strict=True,
        ):
            context = SourceContext(
                role=descriptor.role,
                source_ordinal=descriptor.supplied_ordinal,
                path=descriptor.path,
            )
            observed = parse_and_validate_source(
                context,
                _evidence_for_descriptor(descriptor),
                backend,
                phase=SOURCE_STAGING_PHASE,
                on_message=lambda index, message, selected=descriptor,
                expected=identity.session_identity: (
                    normalizer.observe_verification_message(
                        selected,
                        index,
                        message,
                        owner_identity=expected.owner_identity,
                        peer_identity=expected.peer_identity,
                    )
                ),
            )
            _assert_unchanged(descriptor, observed)
        normalizer.complete()
        consumer.complete()
        result = OverlapVerificationResult(
            source_count=len(descriptors),
            eligible_record_count=(
                normalizer.verification_summary.eligible_count
            ),
            matched_record_count=consumer._matched_verification,
            unmatched_record_count=consumer._unmatched_verification,
        )
        consumer.abort()
        return result
    except BaseException:
        try:
            consumer.abort()
        except DatasetPersistenceError:
            pass
        raise


def _recovery_state(candidate: Path) -> str:
    try:
        metadata = os.lstat(candidate)
        if (
            stat.S_ISLNK(metadata.st_mode)
            or not stat.S_ISDIR(metadata.st_mode)
            or metadata.st_uid != os.getuid()
            or _mode(metadata) != 0o700
            or candidate.parent / candidate.name != candidate
        ):
            return "UNSAFE_CANDIDATE"
        marker = candidate / STAGING_MARKER
        marker_metadata = os.lstat(marker)
        if (
            stat.S_ISLNK(marker_metadata.st_mode)
            or not stat.S_ISREG(marker_metadata.st_mode)
            or marker_metadata.st_uid != os.getuid()
            or _mode(marker_metadata) != 0o600
            or _read_owned_regular(marker, maximum=128)
            != b"chat-history-analysis-private-stage-v1\n"
        ):
            return "UNSAFE_CANDIDATE"
        for entry in os.scandir(candidate):
            entry_metadata = os.lstat(candidate / entry.name)
            if (
                stat.S_ISLNK(entry_metadata.st_mode)
                or not stat.S_ISREG(entry_metadata.st_mode)
                or entry_metadata.st_uid != os.getuid()
                or _mode(entry_metadata) != 0o600
            ):
                return "UNSAFE_CANDIDATE"
        return "RECOGNIZED_PRIVATE_REMNANT"
    except (DatasetPersistenceError, OSError):
        return "UNSAFE_CANDIDATE"


def recover_staging_remnant(
    parent: Path,
    *,
    candidate_ordinal: int | None = None,
    confirmed: bool = False,
) -> RecoveryResult:
    """Inspect or remove one recognized remnant without exposing its name."""

    try:
        metadata = os.lstat(parent)
        if (
            stat.S_ISLNK(metadata.st_mode)
            or not stat.S_ISDIR(metadata.st_mode)
            or metadata.st_uid != os.getuid()
            or _mode(metadata) & 0o022
        ):
            raise OSError
        candidates = sorted(
            (
                parent / entry.name
                for entry in os.scandir(parent)
                if entry.name.startswith(STAGING_PREFIX)
            ),
            key=lambda path: path.name,
        )
    except OSError:
        raise _persistence_error(
            DatasetPersistenceReasonCode.RECOVERY_PARENT_UNSAFE,
            phase=RECOVERY_PHASE,
            category=FailureCategory.INPUT_VALIDATION,
        ) from None
    states = tuple(_recovery_state(candidate) for candidate in candidates)
    if candidate_ordinal is None:
        return RecoveryResult(
            candidate_count=len(candidates),
            state_codes=states,
            removed_count=0,
        )
    if (
        not _is_integer(candidate_ordinal)
        or candidate_ordinal < 1
        or candidate_ordinal > len(candidates)
    ):
        raise _persistence_error(
            DatasetPersistenceReasonCode.RECOVERY_CANDIDATE_INVALID,
            phase=RECOVERY_PHASE,
            category=FailureCategory.INPUT_VALIDATION,
        )
    if not confirmed:
        raise _persistence_error(
            DatasetPersistenceReasonCode.RECOVERY_CONFIRMATION_REQUIRED,
            phase=RECOVERY_PHASE,
            category=FailureCategory.INPUT_VALIDATION,
        )
    selected = candidates[candidate_ordinal - 1]
    if states[candidate_ordinal - 1] != "RECOGNIZED_PRIVATE_REMNANT":
        raise _persistence_error(
            DatasetPersistenceReasonCode.RECOVERY_CANDIDATE_INVALID,
            phase=RECOVERY_PHASE,
            category=FailureCategory.INPUT_VALIDATION,
        )
    parent_descriptor = -1
    selected_descriptor = -1
    try:
        parent_descriptor = os.open(parent, _directory_flags())
        selected_descriptor = os.open(
            selected.name,
            _directory_flags(),
            dir_fd=parent_descriptor,
        )
        selected_metadata = os.fstat(selected_descriptor)
        selected_path_metadata = os.lstat(selected)
        if (
            not stat.S_ISDIR(selected_metadata.st_mode)
            or selected_metadata.st_uid != os.getuid()
            or _mode(selected_metadata) != 0o700
            or (selected_metadata.st_dev, selected_metadata.st_ino)
            != (
                selected_path_metadata.st_dev,
                selected_path_metadata.st_ino,
            )
            or _recovery_state(selected) != "RECOGNIZED_PRIVATE_REMNANT"
        ):
            raise OSError
        entries = list(os.scandir(selected_descriptor))
        for entry in entries:
            metadata = os.stat(
                entry.name,
                dir_fd=selected_descriptor,
                follow_symlinks=False,
            )
            if (
                stat.S_ISLNK(metadata.st_mode)
                or not stat.S_ISREG(metadata.st_mode)
                or metadata.st_uid != os.getuid()
                or _mode(metadata) != 0o600
            ):
                raise OSError
            os.unlink(entry.name, dir_fd=selected_descriptor)
        os.close(selected_descriptor)
        selected_descriptor = -1
        os.rmdir(selected.name, dir_fd=parent_descriptor)
    except OSError:
        raise _persistence_error(
            DatasetPersistenceReasonCode.RECOVERY_CLEANUP_FAILED,
            phase=RECOVERY_PHASE,
        ) from None
    finally:
        if selected_descriptor >= 0:
            os.close(selected_descriptor)
        if parent_descriptor >= 0:
            os.close(parent_descriptor)
    return RecoveryResult(
        candidate_count=len(candidates),
        state_codes=states,
        removed_count=1,
    )
