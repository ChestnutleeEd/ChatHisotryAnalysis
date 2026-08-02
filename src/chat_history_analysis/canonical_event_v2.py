"""Exact, cross-language canonical event and manifest v2 contracts.

Stage 1 freezes validation and serialization only.  It deliberately does not
replace the existing v1 production preprocessor.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
import json
import re
from typing import Final, Literal, Mapping, TypedDict, cast


CANONICAL_EVENT_SCHEMA_VERSION: Final = "chat-history-analysis.canonical-event.v2"
CANONICAL_MANIFEST_SCHEMA_VERSION: Final = "chat-history-analysis.manifest.v2"
CANONICAL_V1_MANIFEST_SCHEMA_VERSION: Final = "chat-history-analysis.manifest.v1"
CANONICAL_PREPROCESSOR_VERSION: Final = "0.1.0"
CANONICAL_TIME_POLICY: Final = "UTC+08:00"

MAX_CANONICAL_EVENTS: Final = 2_000_000
MAX_CANONICAL_DATASET_BYTES: Final = 536_870_912
MAX_CANONICAL_CHUNK_BYTES: Final = 33_554_432
MAX_CANONICAL_CHUNK_COUNT: Final = 16_384
MIN_CANONICAL_CREATE_TIME: Final = 0
MAX_CANONICAL_CREATE_TIME: Final = 253_402_243_199
MAX_SAFE_INTEGER: Final = 2**53 - 1

CANONICAL_EVENT_FIELDS: Final = (
    "createTime",
    "formattedTime",
    "calendarDate",
    "senderScope",
    "messageCategory",
    "textEligible",
    "content",
    "fileRank",
    "sourceIndex",
)
CANONICAL_MANIFEST_FIELDS: Final = (
    "schemaVersion",
    "canonicalSchemaVersion",
    "preprocessorVersion",
    "timePolicy",
    "metricDefinitionVersions",
    "chunks",
    "aggregates",
    "limits",
    "privacyValidation",
)
CANONICAL_CHUNK_FIELDS: Final = (
    "ordinal",
    "name",
    "byteSize",
    "recordCount",
    "sha256",
)
CANONICAL_AGGREGATE_FIELDS: Final = (
    "eventCount",
    "userMessageCount",
    "eligibleTextCount",
    "systemEventCount",
    "chunkCount",
    "totalBytes",
    "warningCount",
    "messageCategoryCounts",
    "unknownSenderCount",
)
CANONICAL_LIMIT_FIELDS: Final = (
    "maxEvents",
    "maxDatasetBytes",
    "maxChunkBytes",
    "maxChunkCount",
)
CANONICAL_PRIVACY_FIELDS: Final = (
    "status",
    "forbiddenFieldCount",
    "contentPolicy",
)

CANONICAL_MESSAGE_CATEGORIES: Final = (
    "text",
    "image",
    "voice",
    "video",
    "file",
    "animated-emoji",
    "structured",
    "location",
    "call",
    "mini-program",
    "reply",
    "contact-card",
    "system",
    "other",
    "unknown",
)
CanonicalMessageCategory = Literal[
    "text",
    "image",
    "voice",
    "video",
    "file",
    "animated-emoji",
    "structured",
    "location",
    "call",
    "mini-program",
    "reply",
    "contact-card",
    "system",
    "other",
    "unknown",
]
CanonicalSenderScope = Literal["owner", "other"] | None

METRIC_DEFINITION_VERSIONS: Final = {
    "population": "chat-history-analysis.metric.population.v1",
    "time": "chat-history-analysis.metric.time.utc-plus-8.v1",
    "tokens": "chat-history-analysis.metric.tokens.jieba.v1",
    "keywords": "chat-history-analysis.metric.keywords.log-odds.v1",
    "sessions": "chat-history-analysis.metric.sessions.threshold.v1",
}
METRIC_DEFINITION_FIELDS: Final = tuple(METRIC_DEFINITION_VERSIONS)


class CanonicalEventV2Mapping(TypedDict):
    createTime: int
    formattedTime: str
    calendarDate: str
    senderScope: CanonicalSenderScope
    messageCategory: CanonicalMessageCategory
    textEligible: bool
    content: str | None
    fileRank: int
    sourceIndex: int


@dataclass(frozen=True)
class CanonicalEventV2:
    create_time: int
    formatted_time: str
    calendar_date: str
    sender_scope: CanonicalSenderScope
    message_category: CanonicalMessageCategory
    text_eligible: bool
    content: str | None
    file_rank: int
    source_index: int

    def as_mapping(self) -> CanonicalEventV2Mapping:
        return {
            "createTime": self.create_time,
            "formattedTime": self.formatted_time,
            "calendarDate": self.calendar_date,
            "senderScope": self.sender_scope,
            "messageCategory": self.message_category,
            "textEligible": self.text_eligible,
            "content": self.content,
            "fileRank": self.file_rank,
            "sourceIndex": self.source_index,
        }


@dataclass(frozen=True)
class CanonicalChunkDescriptorV2:
    ordinal: int
    name: str
    byte_size: int
    record_count: int
    sha256: str

    def as_mapping(self) -> dict[str, object]:
        return {
            "ordinal": self.ordinal,
            "name": self.name,
            "byteSize": self.byte_size,
            "recordCount": self.record_count,
            "sha256": self.sha256,
        }


@dataclass(frozen=True)
class CanonicalAggregatesV2:
    event_count: int
    user_message_count: int
    eligible_text_count: int
    system_event_count: int
    chunk_count: int
    total_bytes: int
    warning_count: int
    message_category_counts: Mapping[CanonicalMessageCategory, int]
    unknown_sender_count: int

    def as_mapping(self) -> dict[str, object]:
        return {
            "eventCount": self.event_count,
            "userMessageCount": self.user_message_count,
            "eligibleTextCount": self.eligible_text_count,
            "systemEventCount": self.system_event_count,
            "chunkCount": self.chunk_count,
            "totalBytes": self.total_bytes,
            "warningCount": self.warning_count,
            "messageCategoryCounts": {
                category: self.message_category_counts[category]
                for category in CANONICAL_MESSAGE_CATEGORIES
            },
            "unknownSenderCount": self.unknown_sender_count,
        }


@dataclass(frozen=True)
class CanonicalManifestV2:
    chunks: tuple[CanonicalChunkDescriptorV2, ...]
    aggregates: CanonicalAggregatesV2

    def as_mapping(self) -> dict[str, object]:
        return {
            "schemaVersion": CANONICAL_MANIFEST_SCHEMA_VERSION,
            "canonicalSchemaVersion": CANONICAL_EVENT_SCHEMA_VERSION,
            "preprocessorVersion": CANONICAL_PREPROCESSOR_VERSION,
            "timePolicy": CANONICAL_TIME_POLICY,
            "metricDefinitionVersions": dict(METRIC_DEFINITION_VERSIONS),
            "chunks": [chunk.as_mapping() for chunk in self.chunks],
            "aggregates": self.aggregates.as_mapping(),
            "limits": {
                "maxEvents": MAX_CANONICAL_EVENTS,
                "maxDatasetBytes": MAX_CANONICAL_DATASET_BYTES,
                "maxChunkBytes": MAX_CANONICAL_CHUNK_BYTES,
                "maxChunkCount": MAX_CANONICAL_CHUNK_COUNT,
            },
            "privacyValidation": {
                "status": "passed",
                "forbiddenFieldCount": 0,
                "contentPolicy": "eligible-text-only",
            },
        }


class CanonicalEventValidationError(ValueError):
    """Content-free marker for a malformed v2 contract value."""


_DATE_PATTERN = re.compile(r"^[0-9]{4}-[0-9]{2}-[0-9]{2}$")
_TIME_PATTERN = re.compile(r"^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$")
_HASH_PATTERN = re.compile(r"^[0-9a-f]{64}$")
_V1_DATASET_FIELDS: Final = ("records", "schemaVersion", "summary")
_V1_SUMMARY_FIELDS: Final = (
    "chunkCount",
    "maximumCalendarDate",
    "minimumCalendarDate",
    "normalizedRecordCount",
    "pseudonymous",
    "warningCount",
    "warningsByReason",
)
_V1_RECORD_FIELDS: Final = (
    "calendarDate",
    "content",
    "createTime",
    "fileRank",
    "formattedTime",
    "senderScope",
    "sourceIndex",
)
_V2_DATASET_FIELDS: Final = ("events", "schemaVersion", "summary")


def _is_safe_integer(value: object, minimum: int | None = None) -> bool:
    if isinstance(value, bool) or not isinstance(value, int):
        return False
    if not -MAX_SAFE_INTEGER <= value <= MAX_SAFE_INTEGER:
        return False
    return minimum is None or value >= minimum


def _has_exact_fields(value: Mapping[str, object], fields: tuple[str, ...]) -> bool:
    return len(value) == len(fields) and set(value) == set(fields)


def _valid_date(value: object) -> bool:
    if not isinstance(value, str) or not _DATE_PATTERN.fullmatch(value):
        return False
    try:
        datetime.strptime(value, "%Y-%m-%d")
    except ValueError:
        return False
    return True


def _valid_time(value: object) -> bool:
    if not isinstance(value, str) or not _TIME_PATTERN.fullmatch(value):
        return False
    try:
        datetime.strptime(value, "%Y-%m-%d %H:%M:%S")
    except ValueError:
        return False
    return True


def _expected_time(create_time: int) -> tuple[str, str]:
    if not _is_safe_integer(create_time, 0) or not (
        MIN_CANONICAL_CREATE_TIME <= create_time <= MAX_CANONICAL_CREATE_TIME
    ):
        raise CanonicalEventValidationError("CANONICAL_TIME_RANGE")
    local = datetime(1970, 1, 1, tzinfo=timezone.utc) + timedelta(
        seconds=create_time,
        hours=8,
    )
    calendar = local.strftime("%Y-%m-%d")
    formatted = local.strftime("%Y-%m-%d %H:%M:%S")
    if not _valid_date(calendar) or not _valid_time(formatted):
        raise CanonicalEventValidationError("CANONICAL_TIME_RANGE")
    return formatted, calendar


def validate_canonical_event(value: object) -> CanonicalEventV2:
    if not isinstance(value, dict) or not _has_exact_fields(value, CANONICAL_EVENT_FIELDS):
        raise CanonicalEventValidationError("CANONICAL_EVENT_FIELDS")
    create_time = value["createTime"]
    file_rank = value["fileRank"]
    source_index = value["sourceIndex"]
    if not _is_safe_integer(create_time, 0):
        raise CanonicalEventValidationError("CANONICAL_EVENT_TIME")
    if not _is_safe_integer(file_rank, 0) or not _is_safe_integer(source_index, 0):
        raise CanonicalEventValidationError("CANONICAL_EVENT_ORDER")
    if (
        not isinstance(value["formattedTime"], str)
        or not isinstance(value["calendarDate"], str)
        or value["senderScope"] not in (None, "owner", "other")
        or value["messageCategory"] not in CANONICAL_MESSAGE_CATEGORIES
        or not isinstance(value["textEligible"], bool)
        or (value["content"] is not None and not isinstance(value["content"], str))
    ):
        raise CanonicalEventValidationError("CANONICAL_EVENT_VALUE")
    formatted, calendar = _expected_time(cast(int, create_time))
    if value["formattedTime"] != formatted or value["calendarDate"] != calendar:
        raise CanonicalEventValidationError("CANONICAL_EVENT_TIME")
    category = cast(CanonicalMessageCategory, value["messageCategory"])
    sender_scope = cast(CanonicalSenderScope, value["senderScope"])
    text_eligible = cast(bool, value["textEligible"])
    content = cast(str | None, value["content"])
    if category == "system":
        if sender_scope is not None or text_eligible or content is not None:
            raise CanonicalEventValidationError("CANONICAL_EVENT_SYSTEM")
    elif (
        sender_scope is None
        or (content is None) != (not text_eligible)
        or (text_eligible and category != "text")
    ):
        raise CanonicalEventValidationError("CANONICAL_EVENT_PRIVACY")
    return CanonicalEventV2(
        create_time=cast(int, create_time),
        formatted_time=cast(str, value["formattedTime"]),
        calendar_date=cast(str, value["calendarDate"]),
        sender_scope=sender_scope,
        message_category=category,
        text_eligible=text_eligible,
        content=content,
        file_rank=cast(int, file_rank),
        source_index=cast(int, source_index),
    )


def _positive_int(value: object) -> bool:
    return _is_safe_integer(value, 1)


def validate_canonical_manifest(value: object) -> CanonicalManifestV2:
    if not isinstance(value, dict) or not _has_exact_fields(value, CANONICAL_MANIFEST_FIELDS):
        raise CanonicalEventValidationError("CANONICAL_MANIFEST_FIELDS")
    if (
        value["schemaVersion"] != CANONICAL_MANIFEST_SCHEMA_VERSION
        or value["canonicalSchemaVersion"] != CANONICAL_EVENT_SCHEMA_VERSION
        or value["preprocessorVersion"] != CANONICAL_PREPROCESSOR_VERSION
        or value["timePolicy"] != CANONICAL_TIME_POLICY
    ):
        raise CanonicalEventValidationError("CANONICAL_MANIFEST_VERSION")
    metrics = value["metricDefinitionVersions"]
    if (
        not isinstance(metrics, dict)
        or not _has_exact_fields(metrics, METRIC_DEFINITION_FIELDS)
        or any(metrics[field] != METRIC_DEFINITION_VERSIONS[field] for field in METRIC_DEFINITION_FIELDS)
    ):
        raise CanonicalEventValidationError("CANONICAL_METRICS")

    raw_chunks = value["chunks"]
    if not isinstance(raw_chunks, list) or not raw_chunks:
        raise CanonicalEventValidationError("CANONICAL_CHUNKS")
    if len(raw_chunks) > MAX_CANONICAL_CHUNK_COUNT:
        raise CanonicalEventValidationError("CANONICAL_CHUNK_LIMIT")
    chunks: list[CanonicalChunkDescriptorV2] = []
    total_bytes = 0
    event_count = 0
    for index, raw_chunk in enumerate(raw_chunks):
        if not isinstance(raw_chunk, dict) or not _has_exact_fields(raw_chunk, CANONICAL_CHUNK_FIELDS):
            raise CanonicalEventValidationError("CANONICAL_CHUNK_FIELDS")
        ordinal = raw_chunk["ordinal"]
        name = raw_chunk["name"]
        byte_size = raw_chunk["byteSize"]
        record_count = raw_chunk["recordCount"]
        digest = raw_chunk["sha256"]
        if (
            not _is_safe_integer(ordinal, 0)
            or ordinal != index
            or not isinstance(name, str)
            or name != f"chunk-{index:04d}.ndjson"
            or not _positive_int(byte_size)
            or cast(int, byte_size) > MAX_CANONICAL_CHUNK_BYTES
            or not _positive_int(record_count)
            or cast(int, record_count) > MAX_CANONICAL_EVENTS
            or not isinstance(digest, str)
            or not _HASH_PATTERN.fullmatch(digest)
        ):
            raise CanonicalEventValidationError("CANONICAL_CHUNK_VALUE")
        total_bytes += cast(int, byte_size)
        event_count += cast(int, record_count)
        if total_bytes > MAX_CANONICAL_DATASET_BYTES or event_count > MAX_CANONICAL_EVENTS:
            raise CanonicalEventValidationError("CANONICAL_LIMIT")
        chunks.append(
            CanonicalChunkDescriptorV2(
                ordinal=cast(int, ordinal),
                name=name,
                byte_size=cast(int, byte_size),
                record_count=cast(int, record_count),
                sha256=digest,
            )
        )

    aggregates = value["aggregates"]
    if not isinstance(aggregates, dict) or not _has_exact_fields(aggregates, CANONICAL_AGGREGATE_FIELDS):
        raise CanonicalEventValidationError("CANONICAL_AGGREGATES")
    if any(
        not _is_safe_integer(aggregates[field], 0)
        for field in (
            "eventCount",
            "userMessageCount",
            "eligibleTextCount",
            "systemEventCount",
            "chunkCount",
            "totalBytes",
            "warningCount",
            "unknownSenderCount",
        )
    ):
        raise CanonicalEventValidationError("CANONICAL_AGGREGATES")
    category_counts = aggregates["messageCategoryCounts"]
    if (
        not isinstance(category_counts, dict)
        or not _has_exact_fields(category_counts, CANONICAL_MESSAGE_CATEGORIES)
        or any(
            not _is_safe_integer(category_counts[category], 0)
            for category in CANONICAL_MESSAGE_CATEGORIES
        )
    ):
        raise CanonicalEventValidationError("CANONICAL_AGGREGATES")
    typed_category_counts = {
        category: cast(int, category_counts[category])
        for category in CANONICAL_MESSAGE_CATEGORIES
    }
    aggregate = CanonicalAggregatesV2(
        event_count=cast(int, aggregates["eventCount"]),
        user_message_count=cast(int, aggregates["userMessageCount"]),
        eligible_text_count=cast(int, aggregates["eligibleTextCount"]),
        system_event_count=cast(int, aggregates["systemEventCount"]),
        chunk_count=cast(int, aggregates["chunkCount"]),
        total_bytes=cast(int, aggregates["totalBytes"]),
        warning_count=cast(int, aggregates["warningCount"]),
        message_category_counts=typed_category_counts,
        unknown_sender_count=cast(int, aggregates["unknownSenderCount"]),
    )
    category_total = sum(typed_category_counts.values())
    non_system_category_total = category_total - typed_category_counts["system"]
    if (
        event_count == 0
        or
        aggregate.event_count != event_count
        or aggregate.user_message_count + aggregate.system_event_count
        != aggregate.event_count
        or aggregate.user_message_count > aggregate.event_count
        or aggregate.eligible_text_count > aggregate.user_message_count
        or aggregate.eligible_text_count
        > typed_category_counts["text"]
        or aggregate.system_event_count > aggregate.event_count
        or category_total != aggregate.event_count
        or typed_category_counts["system"] != aggregate.system_event_count
        or non_system_category_total != aggregate.user_message_count
        or aggregate.unknown_sender_count > aggregate.user_message_count
        or aggregate.chunk_count != len(chunks)
        or aggregate.total_bytes != total_bytes
        or aggregate.total_bytes > MAX_CANONICAL_DATASET_BYTES
    ):
        raise CanonicalEventValidationError("CANONICAL_AGGREGATES")

    limits = value["limits"]
    if (
        not isinstance(limits, dict)
        or not _has_exact_fields(limits, CANONICAL_LIMIT_FIELDS)
        or limits != {
            "maxEvents": MAX_CANONICAL_EVENTS,
            "maxDatasetBytes": MAX_CANONICAL_DATASET_BYTES,
            "maxChunkBytes": MAX_CANONICAL_CHUNK_BYTES,
            "maxChunkCount": MAX_CANONICAL_CHUNK_COUNT,
        }
    ):
        raise CanonicalEventValidationError("CANONICAL_LIMITS")
    privacy = value["privacyValidation"]
    if (
        not isinstance(privacy, dict)
        or not _has_exact_fields(privacy, CANONICAL_PRIVACY_FIELDS)
        or privacy
        != {
            "status": "passed",
            "forbiddenFieldCount": 0,
            "contentPolicy": "eligible-text-only",
        }
    ):
        raise CanonicalEventValidationError("CANONICAL_PRIVACY")
    return CanonicalManifestV2(tuple(chunks), aggregate)


def _validate_v1_dataset_contract(value: object) -> dict[str, object]:
    if (
        not isinstance(value, dict)
        or not _has_exact_fields(value, _V1_DATASET_FIELDS)
        or value["schemaVersion"] != CANONICAL_V1_MANIFEST_SCHEMA_VERSION
        or not isinstance(value["summary"], dict)
        or not _has_exact_fields(cast(dict[str, object], value["summary"]), _V1_SUMMARY_FIELDS)
        or not isinstance(value["records"], list)
        or not value["records"]
    ):
        raise CanonicalEventValidationError("DATASET_V1_INVALID")
    summary = cast(dict[str, object], value["summary"])
    for field in ("chunkCount", "normalizedRecordCount", "warningCount"):
        if not _is_safe_integer(summary[field], 0):
            raise CanonicalEventValidationError("DATASET_V1_INVALID")
    if (
        cast(int, summary["chunkCount"]) < 1
        or cast(int, summary["normalizedRecordCount"]) != len(value["records"])
        or summary["pseudonymous"] is not True
        or not _valid_date(summary["minimumCalendarDate"])
        or not _valid_date(summary["maximumCalendarDate"])
        or not isinstance(summary["warningsByReason"], dict)
    ):
        raise CanonicalEventValidationError("DATASET_V1_INVALID")
    warning_total = 0
    for reason, count in cast(dict[str, object], summary["warningsByReason"]).items():
        if not isinstance(reason, str) or not reason or not _is_safe_integer(count, 0):
            raise CanonicalEventValidationError("DATASET_V1_INVALID")
        warning_total += cast(int, count)
    if warning_total != summary["warningCount"]:
        raise CanonicalEventValidationError("DATASET_V1_INVALID")
    for record in value["records"]:
        if not isinstance(record, dict) or not _has_exact_fields(record, _V1_RECORD_FIELDS):
            raise CanonicalEventValidationError("DATASET_V1_INVALID")
        if (
            not _is_safe_integer(record["createTime"], 0)
            or not _is_safe_integer(record["fileRank"], 0)
            or not _is_safe_integer(record["sourceIndex"], 0)
            or record["senderScope"] not in ("owner", "other")
            or not isinstance(record["content"], str)
            or not record["content"]
            or not isinstance(record["formattedTime"], str)
            or not isinstance(record["calendarDate"], str)
        ):
            raise CanonicalEventValidationError("DATASET_V1_INVALID")
        formatted, calendar = _expected_time(cast(int, record["createTime"]))
        if record["formattedTime"] != formatted or record["calendarDate"] != calendar:
            raise CanonicalEventValidationError("DATASET_V1_INVALID")
    return value


def _validate_v2_dataset_contract(value: object) -> dict[str, object]:
    if (
        not isinstance(value, dict)
        or not _has_exact_fields(value, _V2_DATASET_FIELDS)
        or value["schemaVersion"] != CANONICAL_MANIFEST_SCHEMA_VERSION
        or not isinstance(value["summary"], dict)
        or not _has_exact_fields(
            cast(dict[str, object], value["summary"]), CANONICAL_AGGREGATE_FIELDS
        )
        or not isinstance(value["events"], list)
        or not value["events"]
    ):
        raise CanonicalEventValidationError("DATASET_V2_INVALID")
    events = [validate_canonical_event(event).as_mapping() for event in value["events"]]
    summary = cast(dict[str, object], value["summary"])
    scalar_fields = (
        "eventCount",
        "userMessageCount",
        "eligibleTextCount",
        "systemEventCount",
        "chunkCount",
        "totalBytes",
        "warningCount",
        "unknownSenderCount",
    )
    if any(not _is_safe_integer(summary[field], 0) for field in scalar_fields):
        raise CanonicalEventValidationError("DATASET_V2_INVALID")
    category_counts = summary["messageCategoryCounts"]
    if (
        not isinstance(category_counts, dict)
        or not _has_exact_fields(category_counts, CANONICAL_MESSAGE_CATEGORIES)
        or any(not _is_safe_integer(category_counts[category], 0) for category in CANONICAL_MESSAGE_CATEGORIES)
    ):
        raise CanonicalEventValidationError("DATASET_V2_INVALID")
    observed_categories = {category: 0 for category in CANONICAL_MESSAGE_CATEGORIES}
    observed_eligible = 0
    observed_system = 0
    for event in events:
        observed_categories[cast(str, event["messageCategory"])] += 1
        observed_eligible += int(cast(bool, event["textEligible"]))
        observed_system += int(event["messageCategory"] == "system")
    event_count = cast(int, summary["eventCount"])
    user_count = cast(int, summary["userMessageCount"])
    if (
        event_count != len(events)
        or user_count + cast(int, summary["systemEventCount"]) != event_count
        or cast(int, summary["systemEventCount"]) != observed_system
        or cast(int, summary["eligibleTextCount"]) != observed_eligible
        or cast(int, summary["chunkCount"]) < 1
        or cast(int, summary["totalBytes"]) < 1
        or cast(int, summary["unknownSenderCount"]) != 0
        or any(cast(int, category_counts[category]) != observed_categories[category] for category in CANONICAL_MESSAGE_CATEGORIES)
    ):
        raise CanonicalEventValidationError("DATASET_V2_INVALID")
    return {**value, "events": events}


def validate_compatible_dataset_contract(value: object) -> object:
    """Reject shorthand/mixed v1-v2 discriminants at the shared boundary."""

    if not isinstance(value, dict) or not isinstance(value.get("schemaVersion"), str):
        raise CanonicalEventValidationError("DATASET_SCHEMA_VERSION")
    schema_version = value["schemaVersion"]
    if schema_version == CANONICAL_MANIFEST_SCHEMA_VERSION:
        return _validate_v2_dataset_contract(value)
    if schema_version == CANONICAL_V1_MANIFEST_SCHEMA_VERSION:
        return _validate_v1_dataset_contract(value)
    raise CanonicalEventValidationError("DATASET_SCHEMA_VERSION")


def is_canonical_manifest(value: object) -> bool:
    try:
        validate_canonical_manifest(value)
    except CanonicalEventValidationError:
        return False
    return True


def serialize_canonical_event(event: CanonicalEventV2) -> str:
    validate_canonical_event(event.as_mapping())
    return json.dumps(event.as_mapping(), ensure_ascii=False, separators=(",", ":"))


def serialize_canonical_manifest(manifest: CanonicalManifestV2) -> str:
    validate_canonical_manifest(manifest.as_mapping())
    return json.dumps(manifest.as_mapping(), ensure_ascii=False, separators=(",", ":"))
