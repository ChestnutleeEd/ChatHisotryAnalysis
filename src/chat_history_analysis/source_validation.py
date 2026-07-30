"""Bounded binary, JSON-event, and private-session source validation."""

from __future__ import annotations

import codecs
from contextlib import contextmanager
from dataclasses import dataclass, field
import hashlib
import os
from pathlib import Path
import stat
import struct
from typing import Any, BinaryIO, Callable, Final, Iterator

from .backend import BackendEvidence
from .errors import (
    CancellationError,
    DatasetPersistenceError,
    FailureCategory,
    SOURCE_DIGEST_PHASE,
    SOURCE_VALIDATION_PHASE,
    SourceRole,
    SourceValidationError,
    SourceValidationReasonCode,
)
from .operation_control import ProgressScope, current_operation_control
from .input_preflight import (
    MAX_AGGREGATE_RAW_INPUT_BYTES,
    MAX_RAW_INPUT_BYTES,
)
from .message_capacity import AggregateMessageCounter
from .startup import PARSER_BUFFER_SIZE


_BINARY_BUFFER_SIZE: Final = 65_536
_UTF8_BOM: Final = codecs.BOM_UTF8
_MAX_ROOT_FIELDS: Final = 64
_MAX_METADATA_FIELDS: Final = 256
_MAX_MESSAGE_NESTING: Final = 64
_MAX_IDENTITY_COMPONENT_BYTES: Final = 4_096
_MIN_SIGNED_64: Final = -(2**63)
_MAX_SIGNED_64: Final = (2**63) - 1
_FINGERPRINT_DOMAIN: Final = (
    b"ChatHistoryAnalysis/conversation-fingerprint/v1"
)

ParserEvent = tuple[str, str, Any]
MessageCallback = Callable[[int, dict[str, Any]], None]


@dataclass(frozen=True)
class SourceContext:
    """A private path paired with its only permitted public identity."""

    role: SourceRole
    source_ordinal: int
    path: Path = field(repr=False)


@dataclass(frozen=True)
class FirstPassEvidence:
    """Content evidence retained without any source text."""

    sha256: str
    size_bytes: int
    device: int = field(repr=False)
    inode: int = field(repr=False)
    modified_time_ns: int = field(repr=False)
    changed_time_ns: int = field(repr=False)


@dataclass(frozen=True, repr=False)
class SessionIdentity:
    """Transient sensitive identity components used only for hashing."""

    platform: str
    owner_identity: str
    peer_identity: str
    participants: tuple[str, ...]


@dataclass(frozen=True)
class SourcePassSummary:
    """Content-free facts derived while discarding every message."""

    message_count: int
    minimum_create_time: int
    maximum_create_time: int
    conversation_fingerprint: str
    session_identity: SessionIdentity = field(repr=False, compare=False)


@dataclass
class AggregateRawByteCounter:
    """Recheck byte limits while the first binary passes actually stream."""

    count: int = 0

    def observe(self, context: SourceContext, file_count: int, block_size: int) -> None:
        next_file_count = file_count + block_size
        if next_file_count > MAX_RAW_INPUT_BYTES:
            raise SourceValidationError(
                SourceValidationReasonCode.RAW_INPUT_FILE_LIMIT_EXCEEDED,
                phase=SOURCE_DIGEST_PHASE,
                role=context.role,
                source_ordinal=context.source_ordinal,
                category=FailureCategory.CAPACITY,
            )
        next_aggregate = self.count + block_size
        if next_aggregate > MAX_AGGREGATE_RAW_INPUT_BYTES:
            raise SourceValidationError(
                SourceValidationReasonCode.AGGREGATE_RAW_INPUT_LIMIT_EXCEEDED,
                phase=SOURCE_DIGEST_PHASE,
                role=context.role,
                source_ordinal=context.source_ordinal,
                category=FailureCategory.CAPACITY,
            )
        self.count = next_aggregate


def _error(
    context: SourceContext,
    reason_code: SourceValidationReasonCode,
    *,
    phase: str,
    field: str | None = None,
    record_ordinal: int | None = None,
) -> SourceValidationError:
    return SourceValidationError(
        reason_code,
        phase=phase,
        role=context.role,
        source_ordinal=context.source_ordinal,
        category=(
            FailureCategory.VERIFICATION
            if context.role is SourceRole.OVERLAP_VERIFICATION
            else FailureCategory.INPUT_VALIDATION
        ),
        field=field,
        record_ordinal=record_ordinal,
    )


@contextmanager
def _open_source(
    context: SourceContext,
    *,
    phase: str,
) -> Iterator[BinaryIO]:
    descriptor = -1
    handle: BinaryIO | None = None
    try:
        flags = os.O_RDONLY
        if hasattr(os, "O_NOFOLLOW"):
            flags |= os.O_NOFOLLOW
        descriptor = os.open(context.path, flags)
        opened = os.fstat(descriptor)
        if not stat.S_ISREG(opened.st_mode):
            raise OSError
        handle = os.fdopen(descriptor, "rb")
        descriptor = -1
    except (OSError, TypeError, ValueError):
        raise _error(
            context,
            SourceValidationReasonCode.SOURCE_READ_FAILED,
            phase=phase,
        ) from None
    try:
        yield handle
    finally:
        if handle is not None:
            try:
                handle.close()
            except OSError:
                pass
        elif descriptor >= 0:
            try:
                os.close(descriptor)
            except OSError:
                pass


def digest_and_validate_utf8(
    context: SourceContext,
    aggregate_bytes: AggregateRawByteCounter,
    *,
    progress_scope: ProgressScope | None = None,
    checkpoint_phase: str = SOURCE_DIGEST_PHASE,
) -> FirstPassEvidence:
    """Hash one binary source and validate UTF-8 without retaining decoded text."""

    digest = hashlib.sha256()
    decoder = codecs.getincrementaldecoder("utf-8")(errors="strict")
    size_bytes = 0
    device = -1
    inode = -1
    modified_time_ns = -1
    changed_time_ns = -1
    first_block = True
    control = current_operation_control()
    try:
        with _open_source(context, phase=SOURCE_DIGEST_PHASE) as handle:
            opened_before = os.fstat(handle.fileno())
            progress_total = max(opened_before.st_size, 1)
            if progress_scope is not None:
                control.source_progress(
                    progress_scope,
                    0,
                    progress_total,
                    force=True,
                )
            control.checkpoint(
                progress_scope.phase
                if progress_scope is not None
                else checkpoint_phase,
                "source-digest-before-read",
            )
            device = opened_before.st_dev
            inode = opened_before.st_ino
            modified_time_ns = opened_before.st_mtime_ns
            changed_time_ns = opened_before.st_ctime_ns
            while True:
                block = handle.read(_BINARY_BUFFER_SIZE)
                if not block:
                    break
                aggregate_bytes.observe(context, size_bytes, len(block))
                if first_block and block.startswith(_UTF8_BOM):
                    raise _error(
                        context,
                        SourceValidationReasonCode.UTF8_BOM_NOT_SUPPORTED,
                        phase=SOURCE_DIGEST_PHASE,
                    )
                first_block = False
                digest.update(block)
                size_bytes += len(block)
                decoder.decode(block, final=False)
                if progress_scope is not None:
                    control.source_progress(
                        progress_scope,
                        min(size_bytes, progress_total),
                        progress_total,
                    )
                control.checkpoint(
                    progress_scope.phase
                    if progress_scope is not None
                    else checkpoint_phase,
                    "source-digest-block",
                )
            decoder.decode(b"", final=True)
            opened_after = os.fstat(handle.fileno())
            path_after = os.lstat(context.path)
            if (
                stat.S_ISLNK(path_after.st_mode)
                or not stat.S_ISREG(path_after.st_mode)
                or (opened_after.st_dev, opened_after.st_ino)
                != (device, inode)
                or (path_after.st_dev, path_after.st_ino) != (device, inode)
                or path_after.st_size != size_bytes
                or opened_after.st_mtime_ns != modified_time_ns
                or opened_after.st_ctime_ns != changed_time_ns
                or path_after.st_mtime_ns != modified_time_ns
                or path_after.st_ctime_ns != changed_time_ns
            ):
                raise _error(
                    context,
                    SourceValidationReasonCode.SOURCE_MUTATED,
                    phase=SOURCE_DIGEST_PHASE,
                )
            if progress_scope is not None:
                control.source_progress(
                    progress_scope,
                    progress_total,
                    progress_total,
                    force=True,
                )
            control.checkpoint(
                progress_scope.phase
                if progress_scope is not None
                else checkpoint_phase,
                "source-digest-complete",
            )
    except UnicodeError:
        raise _error(
            context,
            SourceValidationReasonCode.INVALID_UTF8,
            phase=SOURCE_DIGEST_PHASE,
        ) from None
    except OSError:
        raise _error(
            context,
            SourceValidationReasonCode.SOURCE_READ_FAILED,
            phase=SOURCE_DIGEST_PHASE,
        ) from None
    return FirstPassEvidence(
        sha256=digest.hexdigest(),
        size_bytes=size_bytes,
        device=device,
        inode=inode,
        modified_time_ns=modified_time_ns,
        changed_time_ns=changed_time_ns,
    )


class _HashingReader:
    """Minimal read wrapper used directly by the trusted ijson parser."""

    __slots__ = (
        "_context",
        "_digest",
        "_handle",
        "_maximum",
        "_phase",
        "_progress_scope",
        "bytes_read",
    )

    def __init__(
        self,
        handle: BinaryIO,
        *,
        context: SourceContext,
        maximum_bytes: int,
        phase: str,
        progress_scope: ProgressScope | None,
    ) -> None:
        self._handle = handle
        self._context = context
        self._maximum = maximum_bytes
        self._phase = phase
        self._progress_scope = progress_scope
        self._digest = hashlib.sha256()
        self.bytes_read = 0

    def read(self, size: int = -1) -> bytes:
        block = self._handle.read(size)
        next_size = self.bytes_read + len(block)
        if next_size > self._maximum:
            raise _error(
                self._context,
                SourceValidationReasonCode.SOURCE_MUTATED,
                phase=self._phase,
            )
        self._digest.update(block)
        self.bytes_read = next_size
        control = current_operation_control()
        if self._progress_scope is not None:
            total = max(self._maximum, 1)
            control.source_progress(
                self._progress_scope,
                min(next_size, total),
                total,
            )
        control.checkpoint(self._phase, "parser-read-boundary")
        return block

    def hexdigest(self) -> str:
        return self._digest.hexdigest()


def _next_event(
    events: Iterator[ParserEvent],
    context: SourceContext,
    *,
    phase: str,
) -> ParserEvent:
    current_operation_control().checkpoint(phase, "parser-event-boundary")
    try:
        return next(events)
    except StopIteration:
        raise _error(
            context,
            SourceValidationReasonCode.INVALID_JSON,
            phase=phase,
        ) from None


def _skip_value(
    first: ParserEvent,
    events: Iterator[ParserEvent],
    context: SourceContext,
    *,
    phase: str,
) -> None:
    event = first[1]
    if event in {"null", "boolean", "number", "string"}:
        return
    if event not in {"start_map", "start_array"}:
        raise _error(
            context,
            SourceValidationReasonCode.UNSUPPORTED_TOP_LEVEL_STRUCTURE,
            phase=phase,
        )
    depth = 1
    while depth:
        current = _next_event(events, context, phase=phase)[1]
        if current in {"start_map", "start_array"}:
            depth += 1
        elif current in {"end_map", "end_array"}:
            depth -= 1


def _read_selected_map(
    first: ParserEvent,
    events: Iterator[ParserEvent],
    context: SourceContext,
    *,
    phase: str,
    field: str,
    selected_fields: frozenset[str],
) -> dict[str, Any]:
    if first[1] != "start_map":
        raise _error(
            context,
            SourceValidationReasonCode.UNSUPPORTED_TOP_LEVEL_STRUCTURE,
            phase=phase,
            field=field,
        )
    values: dict[str, Any] = {}
    seen_selected: set[str] = set()
    field_count = 0
    while True:
        event = _next_event(events, context, phase=phase)
        if event[1] == "end_map":
            return values
        if event[1] != "map_key" or not isinstance(event[2], str):
            raise _error(
                context,
                SourceValidationReasonCode.UNSUPPORTED_TOP_LEVEL_STRUCTURE,
                phase=phase,
                field=field,
            )
        field_count += 1
        if field_count > _MAX_METADATA_FIELDS:
            raise _error(
                context,
                SourceValidationReasonCode.UNSUPPORTED_TOP_LEVEL_STRUCTURE,
                phase=phase,
                field=field,
            )
        key = event[2]
        value_event = _next_event(events, context, phase=phase)
        if key not in selected_fields:
            _skip_value(value_event, events, context, phase=phase)
            continue
        if key in seen_selected:
            raise _error(
                context,
                SourceValidationReasonCode.UNSUPPORTED_TOP_LEVEL_STRUCTURE,
                phase=phase,
                field=field,
            )
        seen_selected.add(key)
        if value_event[1] not in {"null", "boolean", "number", "string"}:
            raise _error(
                context,
                SourceValidationReasonCode.UNSUPPORTED_TOP_LEVEL_STRUCTURE,
                phase=phase,
                field=field,
            )
        values[key] = value_event[2]


def _build_message_value(
    first: ParserEvent,
    events: Iterator[ParserEvent],
    context: SourceContext,
    *,
    phase: str,
    record_ordinal: int,
    depth: int = 0,
) -> Any:
    if depth > _MAX_MESSAGE_NESTING:
        raise _error(
            context,
            SourceValidationReasonCode.UNSUPPORTED_TOP_LEVEL_STRUCTURE,
            phase=phase,
            field="messages",
            record_ordinal=record_ordinal,
        )
    event = first[1]
    if event in {"null", "boolean", "number", "string"}:
        return first[2]
    if event == "start_array":
        result: list[Any] = []
        while True:
            current = _next_event(events, context, phase=phase)
            if current[1] == "end_array":
                return result
            result.append(
                _build_message_value(
                    current,
                    events,
                    context,
                    phase=phase,
                    record_ordinal=record_ordinal,
                    depth=depth + 1,
                )
            )
    if event == "start_map":
        result_map: dict[str, Any] = {}
        while True:
            current = _next_event(events, context, phase=phase)
            if current[1] == "end_map":
                return result_map
            if current[1] != "map_key" or not isinstance(current[2], str):
                break
            key = current[2]
            if key in result_map:
                break
            result_map[key] = _build_message_value(
                _next_event(events, context, phase=phase),
                events,
                context,
                phase=phase,
                record_ordinal=record_ordinal,
                depth=depth + 1,
            )
    raise _error(
        context,
        SourceValidationReasonCode.UNSUPPORTED_TOP_LEVEL_STRUCTURE,
        phase=phase,
        field="messages",
        record_ordinal=record_ordinal,
    )


def _valid_identity_component(value: object) -> bool:
    if not isinstance(value, str) or not value:
        return False
    try:
        return len(value.encode("utf-8")) <= _MAX_IDENTITY_COMPONENT_BYTES
    except UnicodeError:
        return False


def _length_prefix(value: bytes) -> bytes:
    return struct.pack(">Q", len(value)) + value


def canonical_session_serialization(identity: SessionIdentity) -> bytes:
    """Serialize one private-session identity without delimiter ambiguity."""

    components = (
        identity.platform,
        "private",
        identity.owner_identity,
        identity.peer_identity,
    )
    output = bytearray(_FINGERPRINT_DOMAIN)
    for component in components:
        output.extend(_length_prefix(component.encode("utf-8")))
    output.extend(struct.pack(">Q", len(identity.participants)))
    for participant in identity.participants:
        output.extend(_length_prefix(participant.encode("utf-8")))
    return bytes(output)


def conversation_fingerprint(identity: SessionIdentity) -> str:
    """Return the lowercase SHA-256 fingerprint of canonical session bytes."""

    return hashlib.sha256(canonical_session_serialization(identity)).hexdigest()


@dataclass
class _MessageFacts:
    count: int = 0
    minimum_time: int | None = None
    maximum_time: int | None = None
    participants: set[str] = field(default_factory=set)

    def observe(
        self,
        message: dict[str, Any],
        *,
        context: SourceContext,
        phase: str,
        record_ordinal: int,
    ) -> None:
        self.count += 1
        create_time = message.get("createTime")
        if (
            isinstance(create_time, int)
            and not isinstance(create_time, bool)
            and _MIN_SIGNED_64 <= create_time <= _MAX_SIGNED_64
        ):
            self.minimum_time = (
                create_time
                if self.minimum_time is None
                else min(self.minimum_time, create_time)
            )
            self.maximum_time = (
                create_time
                if self.maximum_time is None
                else max(self.maximum_time, create_time)
            )
        sender = message.get("senderUsername")
        if _valid_identity_component(sender):
            self.participants.add(sender)
        if len(self.participants) > 2:
            raise _error(
                context,
                SourceValidationReasonCode.PARTICIPANT_INVALID,
                phase=phase,
                field="messages.senderUsername",
                record_ordinal=record_ordinal,
            )


def _finalize_summary(
    *,
    context: SourceContext,
    phase: str,
    export_info: dict[str, Any] | None,
    session: dict[str, Any] | None,
    messages_seen: bool,
    facts: _MessageFacts,
) -> SourcePassSummary:
    if export_info is None:
        raise _error(
            context,
            SourceValidationReasonCode.UNSUPPORTED_TOP_LEVEL_STRUCTURE,
            phase=phase,
            field="exportInfo",
        )
    if session is None:
        raise _error(
            context,
            SourceValidationReasonCode.UNSUPPORTED_TOP_LEVEL_STRUCTURE,
            phase=phase,
            field="session",
        )
    if not messages_seen:
        raise _error(
            context,
            SourceValidationReasonCode.UNSUPPORTED_TOP_LEVEL_STRUCTURE,
            phase=phase,
            field="messages",
        )
    if export_info.get("format") != "detailed-json":
        raise _error(
            context,
            SourceValidationReasonCode.UNSUPPORTED_EXPORT_FORMAT,
            phase=phase,
            field="exportInfo.format",
        )
    if session.get("isGroup") is not False or session.get("type") != "私聊":
        raise _error(
            context,
            SourceValidationReasonCode.UNSUPPORTED_SESSION,
            phase=phase,
            field="session",
        )
    platform = session.get("platform")
    owner = session.get("ownerId")
    peer = session.get("wxid")
    if (
        not _valid_identity_component(platform)
        or not _valid_identity_component(owner)
        or not _valid_identity_component(peer)
        or owner == peer
    ):
        raise _error(
            context,
            SourceValidationReasonCode.SESSION_IDENTITY_INVALID,
            phase=phase,
            field="session",
        )
    expected_participants = {owner, peer}
    if facts.participants != expected_participants:
        raise _error(
            context,
            SourceValidationReasonCode.PARTICIPANT_INVALID,
            phase=phase,
            field="messages.senderUsername",
        )
    if facts.minimum_time is None or facts.maximum_time is None:
        raise _error(
            context,
            SourceValidationReasonCode.MESSAGE_TIME_RANGE_UNAVAILABLE,
            phase=phase,
            field="messages.createTime",
        )
    identity = SessionIdentity(
        platform=platform,
        owner_identity=owner,
        peer_identity=peer,
        participants=tuple(sorted(expected_participants)),
    )
    return SourcePassSummary(
        message_count=facts.count,
        minimum_create_time=facts.minimum_time,
        maximum_create_time=facts.maximum_time,
        conversation_fingerprint=conversation_fingerprint(identity),
        session_identity=identity,
    )


def _adapt_events(
    raw_events: Iterator[ParserEvent],
    *,
    context: SourceContext,
    phase: str,
    aggregate_messages: AggregateMessageCounter | None,
    on_message: MessageCallback,
) -> SourcePassSummary:
    first = _next_event(raw_events, context, phase=phase)
    if first[:2] != ("", "start_map"):
        raise _error(
            context,
            SourceValidationReasonCode.UNSUPPORTED_TOP_LEVEL_STRUCTURE,
            phase=phase,
        )

    export_info: dict[str, Any] | None = None
    session: dict[str, Any] | None = None
    messages_seen = False
    seen_required: set[str] = set()
    root_field_count = 0
    facts = _MessageFacts()

    while True:
        event = _next_event(raw_events, context, phase=phase)
        if event[:2] == ("", "end_map"):
            break
        if event[0] != "" or event[1] != "map_key" or not isinstance(
            event[2], str
        ):
            raise _error(
                context,
                SourceValidationReasonCode.UNSUPPORTED_TOP_LEVEL_STRUCTURE,
                phase=phase,
            )
        root_field_count += 1
        if root_field_count > _MAX_ROOT_FIELDS:
            raise _error(
                context,
                SourceValidationReasonCode.UNSUPPORTED_TOP_LEVEL_STRUCTURE,
                phase=phase,
            )
        key = event[2]
        value_event = _next_event(raw_events, context, phase=phase)
        if key not in {"exportInfo", "session", "messages"}:
            _skip_value(value_event, raw_events, context, phase=phase)
            continue
        if key in seen_required:
            raise _error(
                context,
                SourceValidationReasonCode.UNSUPPORTED_TOP_LEVEL_STRUCTURE,
                phase=phase,
                field=key,
            )
        seen_required.add(key)

        if key == "exportInfo":
            export_info = _read_selected_map(
                value_event,
                raw_events,
                context,
                phase=phase,
                field="exportInfo",
                selected_fields=frozenset({"format"}),
            )
            continue
        if key == "session":
            session = _read_selected_map(
                value_event,
                raw_events,
                context,
                phase=phase,
                field="session",
                selected_fields=frozenset(
                    {"isGroup", "type", "platform", "ownerId", "wxid"}
                ),
            )
            continue
        if value_event[1] != "start_array":
            raise _error(
                context,
                SourceValidationReasonCode.UNSUPPORTED_TOP_LEVEL_STRUCTURE,
                phase=phase,
                field="messages",
            )
        messages_seen = True
        while True:
            item_event = _next_event(raw_events, context, phase=phase)
            if item_event[1] == "end_array":
                break
            record_ordinal = facts.count + 1
            if aggregate_messages is not None:
                aggregate_messages.observe(
                    role=context.role,
                    source_ordinal=context.source_ordinal,
                    record_ordinal=record_ordinal,
                )
            if item_event[1] != "start_map":
                raise _error(
                    context,
                    SourceValidationReasonCode.UNSUPPORTED_TOP_LEVEL_STRUCTURE,
                    phase=phase,
                    field="messages",
                    record_ordinal=record_ordinal,
                )
            message = _build_message_value(
                item_event,
                raw_events,
                context,
                phase=phase,
                record_ordinal=record_ordinal,
            )
            if not isinstance(message, dict):
                raise _error(
                    context,
                    SourceValidationReasonCode.UNSUPPORTED_TOP_LEVEL_STRUCTURE,
                    phase=phase,
                    field="messages",
                    record_ordinal=record_ordinal,
                )
            facts.observe(
                message,
                context=context,
                phase=phase,
                record_ordinal=record_ordinal,
            )
            on_message(record_ordinal - 1, message)

    try:
        trailing = next(raw_events)
    except StopIteration:
        trailing = None
    if trailing is not None:
        raise _error(
            context,
            SourceValidationReasonCode.INVALID_JSON,
            phase=phase,
        )
    return _finalize_summary(
        context=context,
        phase=phase,
        export_info=export_info,
        session=session,
        messages_seen=messages_seen,
        facts=facts,
    )


def parse_and_validate_source(
    context: SourceContext,
    evidence: FirstPassEvidence,
    backend: BackendEvidence,
    *,
    phase: str = SOURCE_VALIDATION_PHASE,
    aggregate_messages: AggregateMessageCounter | None = None,
    on_message: MessageCallback | None = None,
    progress_scope: ProgressScope | None = None,
) -> SourcePassSummary:
    """Parse one source through the exact backend and verify concurrent hash."""

    callback = on_message or (lambda source_index, message: None)
    control = current_operation_control()
    try:
        with _open_source(context, phase=phase) as handle:
            opened_before = os.fstat(handle.fileno())
            if (opened_before.st_dev, opened_before.st_ino) != (
                evidence.device,
                evidence.inode,
            ) or (
                opened_before.st_size != evidence.size_bytes
                or opened_before.st_mtime_ns != evidence.modified_time_ns
                or opened_before.st_ctime_ns != evidence.changed_time_ns
            ):
                raise _error(
                    context,
                    SourceValidationReasonCode.SOURCE_MUTATED,
                    phase=phase,
                )
            progress_total = max(evidence.size_bytes, 1)
            if progress_scope is not None:
                control.source_progress(
                    progress_scope,
                    0,
                    progress_total,
                    force=True,
                )
            control.checkpoint(phase, "parser-before-stream")
            reader = _HashingReader(
                handle,
                context=context,
                maximum_bytes=evidence.size_bytes,
                phase=phase,
                progress_scope=progress_scope,
            )
            events = iter(
                backend.parse(
                    reader,
                    use_float=False,
                    multiple_values=False,
                    allow_comments=False,
                    buf_size=PARSER_BUFFER_SIZE,
                )
            )
            summary = _adapt_events(
                events,
                context=context,
                phase=phase,
                aggregate_messages=aggregate_messages,
                on_message=callback,
            )
            if (
                reader.bytes_read != evidence.size_bytes
                or reader.hexdigest() != evidence.sha256
            ):
                raise _error(
                    context,
                    SourceValidationReasonCode.SOURCE_MUTATED,
                    phase=phase,
                )
            opened_after = os.fstat(handle.fileno())
            try:
                path_after = os.lstat(context.path)
            except OSError:
                raise _error(
                    context,
                    SourceValidationReasonCode.SOURCE_MUTATED,
                    phase=phase,
                ) from None
            if (
                stat.S_ISLNK(path_after.st_mode)
                or not stat.S_ISREG(path_after.st_mode)
                or (opened_after.st_dev, opened_after.st_ino)
                != (evidence.device, evidence.inode)
                or (path_after.st_dev, path_after.st_ino)
                != (evidence.device, evidence.inode)
                or path_after.st_size != evidence.size_bytes
                or opened_after.st_mtime_ns != evidence.modified_time_ns
                or opened_after.st_ctime_ns != evidence.changed_time_ns
                or path_after.st_mtime_ns != evidence.modified_time_ns
                or path_after.st_ctime_ns != evidence.changed_time_ns
            ):
                raise _error(
                    context,
                    SourceValidationReasonCode.SOURCE_MUTATED,
                    phase=phase,
                )
            if progress_scope is not None:
                control.source_progress(
                    progress_scope,
                    progress_total,
                    progress_total,
                    force=True,
                )
            control.checkpoint(phase, "parser-stream-complete")
            return summary
    except (SourceValidationError, CancellationError, DatasetPersistenceError):
        raise
    except backend.parser_error_types:
        raise _error(
            context,
            SourceValidationReasonCode.INVALID_JSON,
            phase=phase,
        ) from None
    except Exception:
        raise _error(
            context,
            SourceValidationReasonCode.INVALID_JSON,
            phase=phase,
        ) from None
