"""Bounded Stage 4 classification and normalization for one message at a time."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from enum import Enum
import re
from types import MappingProxyType
import unicodedata
from typing import Callable, Final, Mapping

from .canonical_event_v2 import MAX_CANONICAL_CREATE_TIME

from .errors import (
    FailureCategory,
    MESSAGE_NORMALIZATION_PHASE,
    SourceRole,
    SourceValidationError,
    SourceValidationReasonCode,
)


MAX_SAFE_INTEGER: Final = (2**53) - 1
_EPOCH_UTC: Final = datetime(1970, 1, 1, tzinfo=timezone.utc)
_FIXED_UTC_OFFSET: Final = timedelta(hours=8)
_FORMATTED_TIME_PATTERN: Final = re.compile(
    r"[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}\Z"
)
_XML_LIKE_PATTERN: Final = re.compile(
    r"<\s*(?:[!?]|/?[A-Za-z_][A-Za-z0-9_.:-]*(?:\s|/?>))"
)
_URL_PATTERN: Final = re.compile(
    r"(?i)(?<![A-Za-z0-9_])(?:https?://|www\.)[^\s<>\"']+"
)
_BRACKETED_PLACEHOLDERS: Final = frozenset(
    {
        "[动画表情]",
        "[位置]",
        "[名片]",
        "[图片]",
        "[小程序]",
        "[文件]",
        "[撤回消息]",
        "[系统消息]",
        "[视频]",
        "[视频通话]",
        "[语音消息]",
        "[语音通话]",
        "[通话]",
        "[链接]",
    }
)


class MessageCategory(str, Enum):
    TEXT = "text"
    IMAGE = "image"
    VOICE = "voice"
    VIDEO = "video"
    FILE = "file"
    ANIMATED_EMOJI = "animated-emoji"
    STRUCTURED = "structured"
    LOCATION = "location"
    CALL = "call"
    MINI_PROGRAM = "mini-program"
    REPLY = "reply"
    CONTACT_CARD = "contact-card"
    SYSTEM = "system"
    OTHER = "other"
    UNKNOWN = "unknown"


CHAT_LAB_TYPE_CATEGORIES: Final[Mapping[int, MessageCategory]] = MappingProxyType(
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
    }
)

_TYPE_CATEGORIES: Final = {
    "文本消息": MessageCategory.TEXT,
    "图片消息": MessageCategory.IMAGE,
    "语音消息": MessageCategory.VOICE,
    "视频消息": MessageCategory.VIDEO,
    "文件消息": MessageCategory.FILE,
    "动画表情": MessageCategory.ANIMATED_EMOJI,
    "链接消息": MessageCategory.STRUCTURED,
    "应用消息": MessageCategory.STRUCTURED,
    "位置消息": MessageCategory.LOCATION,
    "通话消息": MessageCategory.CALL,
    "小程序消息": MessageCategory.MINI_PROGRAM,
    "分享消息": MessageCategory.MINI_PROGRAM,
    "引用消息": MessageCategory.REPLY,
    "回复消息": MessageCategory.REPLY,
    "名片消息": MessageCategory.CONTACT_CARD,
    "系统消息": MessageCategory.SYSTEM,
    "其他消息": MessageCategory.OTHER,
    "特殊交易消息": MessageCategory.OTHER,
}


class SkipReason(str, Enum):
    NON_TEXT = "NON_TEXT"
    CLASSIFICATION_CONFLICT = "CLASSIFICATION_CONFLICT"
    UNKNOWN_CHAT_LAB_TYPE = "UNKNOWN_CHAT_LAB_TYPE"
    MALFORMED_CLASSIFICATION = "MALFORMED_CLASSIFICATION"
    MALFORMED_CONTENT = "MALFORMED_CONTENT"
    BRACKETED_PLACEHOLDER = "BRACKETED_PLACEHOLDER"
    XML_LIKE_CONTENT = "XML_LIKE_CONTENT"
    URL_ONLY_CONTENT = "URL_ONLY_CONTENT"
    INVALID_SENDER = "INVALID_SENDER"
    MALFORMED_TIME = "MALFORMED_TIME"
    TIME_CONFLICT = "TIME_CONFLICT"


class WarningReason(str, Enum):
    CLASSIFICATION_CONFLICT = "CLASSIFICATION_CONFLICT"
    SENDER_METADATA_CONFLICT = "SENDER_METADATA_CONFLICT"


@dataclass(frozen=True, slots=True)
class NormalizedMessage:
    """Transient minimized record; content is deliberately excluded from repr."""

    source_role: SourceRole
    source_ordinal: int
    file_rank: int | None
    source_array_index: int
    create_time: int
    formatted_time: str
    calendar_date: str
    sender_scope: str
    content: str = field(repr=False)


@dataclass(frozen=True, slots=True)
class NormalizationSummary:
    """Content-free aggregate evidence retained after streaming."""

    observed_count: int
    eligible_count: int
    owner_count: int
    other_count: int
    skipped_by_reason: tuple[tuple[str, int], ...]
    warnings_by_reason: tuple[tuple[str, int], ...]

    @property
    def skipped_count(self) -> int:
        return sum(count for _, count in self.skipped_by_reason)

    @property
    def warning_count(self) -> int:
        return sum(count for _, count in self.warnings_by_reason)


@dataclass(slots=True)
class _MutableStats:
    observed_count: int = 0
    eligible_count: int = 0
    owner_count: int = 0
    other_count: int = 0
    skipped: dict[SkipReason, int] = field(default_factory=dict)
    warnings: dict[WarningReason, int] = field(default_factory=dict)

    def skip(self, reason: SkipReason) -> None:
        self.skipped[reason] = self.skipped.get(reason, 0) + 1

    def warn(self, reason: WarningReason) -> None:
        self.warnings[reason] = self.warnings.get(reason, 0) + 1

    def snapshot(self) -> NormalizationSummary:
        return NormalizationSummary(
            observed_count=self.observed_count,
            eligible_count=self.eligible_count,
            owner_count=self.owner_count,
            other_count=self.other_count,
            skipped_by_reason=tuple(
                sorted((reason.value, count) for reason, count in self.skipped.items())
            ),
            warnings_by_reason=tuple(
                sorted(
                    (reason.value, count)
                    for reason, count in self.warnings.items()
                )
            ),
        )


def _is_safe_integer(value: object) -> bool:
    return (
        isinstance(value, int)
        and not isinstance(value, bool)
        and -MAX_SAFE_INTEGER <= value <= MAX_SAFE_INTEGER
    )


def _classification(
    message: dict[str, object],
    stats: _MutableStats,
) -> MessageCategory | None:
    local_type = message.get("localType")
    if not _is_safe_integer(local_type):
        raise ValueError("unsafe-local-type")

    chat_lab_type = message.get("chatLabType")
    if isinstance(chat_lab_type, bool) or not isinstance(chat_lab_type, int):
        stats.skip(SkipReason.MALFORMED_CLASSIFICATION)
        return None
    primary = CHAT_LAB_TYPE_CATEGORIES.get(chat_lab_type)
    if primary is None:
        stats.skip(SkipReason.UNKNOWN_CHAT_LAB_TYPE)
        return None

    raw_type = message.get("type")
    corroborating = (
        _TYPE_CATEGORIES.get(raw_type) if isinstance(raw_type, str) else None
    )
    if primary is MessageCategory.TEXT:
        if raw_type != "文本消息" or local_type != 1:
            stats.skip(SkipReason.CLASSIFICATION_CONFLICT)
            stats.warn(WarningReason.CLASSIFICATION_CONFLICT)
            return None
        return primary

    if corroborating is None or corroborating is not primary:
        stats.skip(SkipReason.CLASSIFICATION_CONFLICT)
        stats.warn(WarningReason.CLASSIFICATION_CONFLICT)
    else:
        stats.skip(SkipReason.NON_TEXT)
    return None


def _replace_controls(value: str) -> str:
    return "".join(
        " " if unicodedata.category(character).startswith("C") else character
        for character in value
    )


def _clean_content(
    value: object,
) -> tuple[str | None, SkipReason | None]:
    if not isinstance(value, str):
        return None, SkipReason.MALFORMED_CONTENT
    stripped = value.strip()
    if not stripped:
        return None, SkipReason.MALFORMED_CONTENT
    if stripped in _BRACKETED_PLACEHOLDERS:
        return None, SkipReason.BRACKETED_PLACEHOLDER
    if _XML_LIKE_PATTERN.search(stripped):
        return None, SkipReason.XML_LIKE_CONTENT
    without_urls = _URL_PATTERN.sub("", stripped)
    cleaned = " ".join(_replace_controls(without_urls).split())
    if not cleaned:
        if without_urls != stripped:
            return None, SkipReason.URL_ONLY_CONTENT
        return None, SkipReason.MALFORMED_CONTENT
    return cleaned, None


def _sender_scope(
    message: dict[str, object],
    *,
    owner_identity: str,
    peer_identity: str,
    stats: _MutableStats,
) -> str | None:
    is_send = message.get("isSend")
    if isinstance(is_send, bool) or not isinstance(is_send, int):
        stats.skip(SkipReason.INVALID_SENDER)
        return None
    if is_send == 1:
        scope = "owner"
        expected_sender = owner_identity
    elif is_send == 0:
        scope = "other"
        expected_sender = peer_identity
    else:
        stats.skip(SkipReason.INVALID_SENDER)
        return None
    sender = message.get("senderUsername")
    if isinstance(sender, str) and sender and sender != expected_sender:
        stats.warn(WarningReason.SENDER_METADATA_CONFLICT)
    return scope


def _canonical_time(
    message: dict[str, object],
    stats: _MutableStats,
) -> tuple[int, str, str] | None:
    create_time = message.get("createTime")
    formatted_time = message.get("formattedTime")
    if (
        isinstance(create_time, bool)
        or not isinstance(create_time, int)
        or not isinstance(formatted_time, str)
        or _FORMATTED_TIME_PATTERN.fullmatch(formatted_time) is None
    ):
        stats.skip(SkipReason.MALFORMED_TIME)
        return None
    try:
        local_time = _EPOCH_UTC + timedelta(seconds=create_time) + _FIXED_UTC_OFFSET
        expected = (
            f"{local_time.year:04d}-{local_time.month:02d}-{local_time.day:02d} "
            f"{local_time.hour:02d}:{local_time.minute:02d}:"
            f"{local_time.second:02d}"
        )
    except (OverflowError, ValueError):
        stats.skip(SkipReason.MALFORMED_TIME)
        return None
    if formatted_time != expected:
        stats.skip(SkipReason.TIME_CONFLICT)
        return None
    return create_time, formatted_time, expected[:10]


class MessageNormalizationConsumer:
    """Classify each callback synchronously and retain aggregate counters only."""

    __slots__ = (
        "_annual",
        "_complete",
        "_on_annual_eligible",
        "_on_verification_eligible",
        "_verification",
    )

    def __init__(
        self,
        on_annual_eligible: Callable[
            [object, NormalizedMessage, object, str, str],
            None,
        ]
        | None = None,
        on_verification_eligible: Callable[
            [object, NormalizedMessage, object, str, str],
            None,
        ]
        | None = None,
    ) -> None:
        self._annual = _MutableStats()
        self._verification = _MutableStats()
        self._on_annual_eligible = on_annual_eligible or (
            lambda descriptor, record, platform_id, owner, peer: None
        )
        self._on_verification_eligible = on_verification_eligible or (
            lambda descriptor, record, platform_id, owner, peer: None
        )
        self._complete = False

    @property
    def annual_summary(self) -> NormalizationSummary:
        return self._annual.snapshot()

    @property
    def verification_summary(self) -> NormalizationSummary:
        return self._verification.snapshot()

    def _observe(
        self,
        descriptor: object,
        source_array_index: int,
        message: dict[str, object],
        *,
        owner_identity: str,
        peer_identity: str,
        stats: _MutableStats,
        on_eligible: Callable[
            [object, NormalizedMessage, object, str, str],
            None,
        ],
    ) -> None:
        stats.observed_count += 1
        try:
            category = _classification(message, stats)
        except ValueError:
            raise SourceValidationError(
                SourceValidationReasonCode.UNSAFE_LOCAL_TYPE,
                phase=MESSAGE_NORMALIZATION_PHASE,
                role=descriptor.role,
                source_ordinal=descriptor.supplied_ordinal,
                category=(
                    FailureCategory.VERIFICATION
                    if descriptor.role is SourceRole.OVERLAP_VERIFICATION
                    else FailureCategory.INPUT_VALIDATION
                ),
                field="messages.localType",
                record_ordinal=source_array_index + 1,
            ) from None
        if category is not MessageCategory.TEXT:
            return

        content, content_error = _clean_content(message.get("content"))
        if content_error is not None:
            stats.skip(content_error)
            return
        scope = _sender_scope(
            message,
            owner_identity=owner_identity,
            peer_identity=peer_identity,
            stats=stats,
        )
        if scope is None:
            return
        canonical_time = _canonical_time(message, stats)
        if canonical_time is None:
            return
        create_time, formatted_time, calendar_date = canonical_time
        stats.eligible_count += 1
        if scope == "owner":
            stats.owner_count += 1
        else:
            stats.other_count += 1
        if content is None:
            raise TypeError
        normalized = NormalizedMessage(
            source_role=descriptor.role,
            source_ordinal=descriptor.supplied_ordinal,
            file_rank=descriptor.file_rank,
            source_array_index=source_array_index,
            create_time=create_time,
            formatted_time=formatted_time,
            calendar_date=calendar_date,
            sender_scope=scope,
            content=content,
        )
        on_eligible(
            descriptor,
            normalized,
            message.get("platformMessageId"),
            owner_identity,
            peer_identity,
        )

    def stage_annual_message(
        self,
        descriptor: object,
        source_array_index: int,
        message: dict[str, object],
        *,
        owner_identity: str,
        peer_identity: str,
    ) -> None:
        self._observe(
            descriptor,
            source_array_index,
            message,
            owner_identity=owner_identity,
            peer_identity=peer_identity,
            stats=self._annual,
            on_eligible=self._on_annual_eligible,
        )

    def observe_verification_message(
        self,
        descriptor: object,
        source_array_index: int,
        message: dict[str, object],
        *,
        owner_identity: str,
        peer_identity: str,
    ) -> None:
        self._observe(
            descriptor,
            source_array_index,
            message,
            owner_identity=owner_identity,
            peer_identity=peer_identity,
            stats=self._verification,
            on_eligible=self._on_verification_eligible,
        )

    def complete(self) -> None:
        self._complete = True

    def abort(self) -> None:
        self._annual = _MutableStats()
        self._verification = _MutableStats()
        self._complete = False


@dataclass(frozen=True, slots=True, repr=False)
class CanonicalEventCandidate:
    """Transient v2 event evidence before identity calculation.

    The candidate deliberately keeps source identifiers and raw payload only
    until the v2 staging consumer calculates a cryptographic identity.  Its
    repr never exposes those values, and no candidate is retained after the
    callback returns.
    """

    source_role: SourceRole
    source_ordinal: int
    file_rank: int | None
    source_array_index: int
    create_time: int
    formatted_time: str
    calendar_date: str
    sender_scope: str | None
    message_category: str
    text_eligible: bool
    content: str | None = field(repr=False)
    platform_message_id: str | None = field(repr=False)
    local_id: str | None = field(repr=False)
    raw_classification: tuple[tuple[str, int], ...]
    raw_content: str | None = field(repr=False)
    classification_warnings: tuple[str, ...] = ()


@dataclass(frozen=True, slots=True)
class CanonicalNormalizationSummary:
    """Content-free v2 normalization evidence."""

    observed_count: int
    emitted_count: int
    eligible_count: int
    owner_count: int
    other_count: int
    category_counts: tuple[tuple[str, int], ...]
    skipped_by_reason: tuple[tuple[str, int], ...]
    warnings_by_reason: tuple[tuple[str, int], ...]

    @property
    def skipped_count(self) -> int:
        return sum(count for _, count in self.skipped_by_reason)

    @property
    def warning_count(self) -> int:
        return sum(count for _, count in self.warnings_by_reason)


@dataclass(slots=True)
class _CanonicalMutableStats:
    observed_count: int = 0
    emitted_count: int = 0
    eligible_count: int = 0
    owner_count: int = 0
    other_count: int = 0
    categories: dict[str, int] = field(default_factory=dict)
    skipped: dict[str, int] = field(default_factory=dict)
    warnings: dict[str, int] = field(default_factory=dict)

    def skip(self, reason: str) -> None:
        self.skipped[reason] = self.skipped.get(reason, 0) + 1

    def warn(self, reason: str) -> None:
        self.warnings[reason] = self.warnings.get(reason, 0) + 1

    def category(self, value: str) -> None:
        self.categories[value] = self.categories.get(value, 0) + 1

    def snapshot(self) -> CanonicalNormalizationSummary:
        return CanonicalNormalizationSummary(
            observed_count=self.observed_count,
            emitted_count=self.emitted_count,
            eligible_count=self.eligible_count,
            owner_count=self.owner_count,
            other_count=self.other_count,
            category_counts=tuple(sorted(self.categories.items())),
            skipped_by_reason=tuple(sorted(self.skipped.items())),
            warnings_by_reason=tuple(sorted(self.warnings.items())),
        )


def _safe_identity_string(value: object) -> str | None:
    if not isinstance(value, str) or not value or "\x00" in value:
        return None
    try:
        if len(value.encode("utf-8")) > 4_096:
            return None
    except UnicodeError:
        return None
    return value


def _canonical_classification(
    message: dict[str, object],
) -> tuple[MessageCategory, tuple[str, ...]]:
    """Classify every safe record without guessing a new known category."""

    local_type = message.get("localType")
    if not _is_safe_integer(local_type):
        raise ValueError("unsafe-local-type")

    chat_lab_type = message.get("chatLabType")
    primary = (
        CHAT_LAB_TYPE_CATEGORIES.get(chat_lab_type)
        if isinstance(chat_lab_type, int) and not isinstance(chat_lab_type, bool)
        else None
    )
    raw_type = message.get("type")
    corroborating = (
        _TYPE_CATEGORIES.get(raw_type) if isinstance(raw_type, str) else None
    )
    if primary is not None and corroborating is primary:
        if primary is MessageCategory.TEXT and local_type != 1:
            return MessageCategory.UNKNOWN, ("CLASSIFICATION_CONFLICT",)
        return primary, ()
    if primary is None:
        return MessageCategory.UNKNOWN, (
            "MALFORMED_CLASSIFICATION"
            if not isinstance(chat_lab_type, int)
            or isinstance(chat_lab_type, bool)
            else "UNKNOWN_MESSAGE_CATEGORY",
        )
    return MessageCategory.UNKNOWN, ("CLASSIFICATION_CONFLICT",)


def _canonical_sender_scope(
    message: dict[str, object],
    *,
    owner_identity: str,
    peer_identity: str,
) -> tuple[str | None, tuple[str, ...]]:
    stats = _MutableStats()
    scope = _sender_scope(
        message,
        owner_identity=owner_identity,
        peer_identity=peer_identity,
        stats=stats,
    )
    warnings = tuple(reason for reason, _count in stats.warnings.items())
    return scope, warnings


def _canonical_time_v2(
    message: dict[str, object],
) -> tuple[tuple[int, str, str] | None, str | None]:
    stats = _MutableStats()
    value = _canonical_time(message, stats)
    if value is None:
        if stats.skipped:
            return None, next(iter(stats.skipped)).value
        return None, "MALFORMED_TIME"
    create_time = value[0]
    if not 0 <= create_time <= MAX_CANONICAL_CREATE_TIME:
        return None, "CANONICAL_TIME_RANGE"
    return value, None


class CanonicalEventNormalizationConsumer:
    """Emit minimized v2 candidates while retaining the v1 consumer intact."""

    __slots__ = (
        "_annual",
        "_complete",
        "_on_annual_event",
        "_on_verification_event",
        "_verification",
    )

    def __init__(
        self,
        on_annual_event: Callable[[object, CanonicalEventCandidate], None]
        | None = None,
        on_verification_event: Callable[[object, CanonicalEventCandidate], None]
        | None = None,
    ) -> None:
        self._annual = _CanonicalMutableStats()
        self._verification = _CanonicalMutableStats()
        self._on_annual_event = on_annual_event or (
            lambda _descriptor, _candidate: None
        )
        self._on_verification_event = on_verification_event or (
            lambda _descriptor, _candidate: None
        )
        self._complete = False

    @property
    def annual_summary(self) -> CanonicalNormalizationSummary:
        return self._annual.snapshot()

    @property
    def verification_summary(self) -> CanonicalNormalizationSummary:
        return self._verification.snapshot()

    def _observe(
        self,
        descriptor: object,
        source_array_index: int,
        message: dict[str, object],
        *,
        owner_identity: str,
        peer_identity: str,
        stats: _CanonicalMutableStats,
        on_event: Callable[[object, CanonicalEventCandidate], None],
    ) -> None:
        stats.observed_count += 1
        try:
            category, classification_warnings = _canonical_classification(message)
        except ValueError:
            raise SourceValidationError(
                SourceValidationReasonCode.UNSAFE_LOCAL_TYPE,
                phase=MESSAGE_NORMALIZATION_PHASE,
                role=descriptor.role,
                source_ordinal=descriptor.supplied_ordinal,
                category=(
                    FailureCategory.VERIFICATION
                    if descriptor.role is SourceRole.OVERLAP_VERIFICATION
                    else FailureCategory.INPUT_VALIDATION
                ),
                field="messages.localType",
                record_ordinal=source_array_index + 1,
            ) from None

        for warning in classification_warnings:
            stats.warn(warning)

        if category is MessageCategory.SYSTEM:
            sender_scope = None
            sender_warnings: tuple[str, ...] = ()
        else:
            sender_scope, sender_warnings = _canonical_sender_scope(
                message,
                owner_identity=owner_identity,
                peer_identity=peer_identity,
            )
            if sender_scope is None:
                stats.skip("INVALID_SENDER")
                return
        for warning in sender_warnings:
            stats.warn(warning)

        canonical_time, time_error = _canonical_time_v2(message)
        if canonical_time is None:
            stats.skip(time_error or "MALFORMED_TIME")
            return
        create_time, formatted_time, calendar_date = canonical_time

        content: str | None = None
        text_eligible = False
        if category is MessageCategory.TEXT:
            cleaned, content_error = _clean_content(message.get("content"))
            if content_error is None:
                content = cleaned
                text_eligible = True
                stats.eligible_count += 1
            else:
                stats.skip(content_error.value)

        category_value = category.value
        stats.emitted_count += 1
        stats.category(category_value)
        if sender_scope == "owner":
            stats.owner_count += 1
        elif sender_scope == "other":
            stats.other_count += 1

        raw_classification: list[tuple[str, int]] = []
        for key in ("chatLabType", "localType"):
            value = message.get(key)
            if _is_safe_integer(value):
                raw_classification.append((key, value))
        candidate = CanonicalEventCandidate(
            source_role=descriptor.role,
            source_ordinal=descriptor.supplied_ordinal,
            file_rank=descriptor.file_rank,
            source_array_index=source_array_index,
            create_time=create_time,
            formatted_time=formatted_time,
            calendar_date=calendar_date,
            sender_scope=sender_scope,
            message_category=category_value,
            text_eligible=text_eligible,
            content=content,
            platform_message_id=_safe_identity_string(
                message.get("platformMessageId")
            ),
            local_id=_safe_identity_string(message.get("localId")),
            raw_classification=tuple(raw_classification),
            raw_content=_safe_identity_string(message.get("content")),
            classification_warnings=tuple(
                (*classification_warnings, *sender_warnings)
            ),
        )
        on_event(descriptor, candidate)

    def stage_annual_message(
        self,
        descriptor: object,
        source_array_index: int,
        message: dict[str, object],
        *,
        owner_identity: str,
        peer_identity: str,
    ) -> None:
        self._observe(
            descriptor,
            source_array_index,
            message,
            owner_identity=owner_identity,
            peer_identity=peer_identity,
            stats=self._annual,
            on_event=self._on_annual_event,
        )

    def observe_verification_message(
        self,
        descriptor: object,
        source_array_index: int,
        message: dict[str, object],
        *,
        owner_identity: str,
        peer_identity: str,
    ) -> None:
        self._observe(
            descriptor,
            source_array_index,
            message,
            owner_identity=owner_identity,
            peer_identity=peer_identity,
            stats=self._verification,
            on_event=self._on_verification_event,
        )

    def complete(self) -> None:
        self._complete = True

    def abort(self) -> None:
        self._annual = _CanonicalMutableStats()
        self._verification = _CanonicalMutableStats()
        self._complete = False
