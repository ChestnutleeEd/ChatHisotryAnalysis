"""Strict, path-free stdin configuration and NDJSON sidecar protocol."""

from __future__ import annotations

from dataclasses import dataclass, field
import json
import os
from pathlib import Path
import re
import struct
from typing import Any, BinaryIO, Iterable, Mapping, TextIO


SIDECAR_PROTOCOL_VERSION = "chat-history-analysis.sidecar.v1"
SIDECAR_CONFIG_FIELDS = (
    "protocolVersion",
    "sessionId",
    "generation",
    "annualSources",
    "verificationSources",
    "applicationCacheRoot",
    "outputDirectory",
    "sessionNonce",
    "preprocessorMode",
)
SIDECAR_PROGRESS_FIELDS = (
    "protocolVersion",
    "type",
    "sessionId",
    "generation",
    "phase",
    "percentage",
    "status",
    "aggregateCount",
    "capacityValue",
)
SIDECAR_HEARTBEAT_FIELDS = (
    "protocolVersion",
    "type",
    "sessionId",
    "generation",
)
SIDECAR_RESULT_FIELDS = (
    "protocolVersion",
    "type",
    "sessionId",
    "generation",
    "status",
    "eventCount",
    "eligibleTextCount",
    "chunkCount",
    "duplicateEventCount",
    "warningCount",
)
SIDECAR_FAILURE_FIELDS = (
    "protocolVersion",
    "type",
    "reasonCode",
)
SIDECAR_MAX_CONFIG_BYTES = 1_048_576
SIDECAR_MAX_LINE_BYTES = 16_384
SIDECAR_MAX_EVENT_COUNT = 4_096
SIDECAR_MAX_PATH_BYTES = 4_096
SIDECAR_MAX_SOURCES = 20
_OPAQUE_ID_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$")
_PHASES = frozenset(
    {
        "startup",
        "input-preflight",
        "source-digest",
        "source-validation",
        "session-validation",
        "source-staging",
        "dataset-staging",
        "output-serialization",
        "output-verification",
        "output-promotion",
    }
)
_ROLES = frozenset({"annual-source", "overlap-verification"})


class SidecarProtocolError(ValueError):
    """A stable protocol failure with no raw input retained in the message."""

    def __init__(self, reason_code: str = "SIDECAR_PROTOCOL_INVALID") -> None:
        self.reason_code = reason_code
        super().__init__(reason_code)


@dataclass(frozen=True, slots=True, repr=False)
class SidecarConfiguration:
    """Validated internal configuration; repr hides every private path."""

    session_id: str
    generation: int
    annual_sources: tuple[Path, ...] = field(repr=False)
    verification_sources: tuple[Path, ...] = field(repr=False)
    application_cache_root: Path = field(repr=False)
    output_directory: Path = field(repr=False)
    session_nonce: str = field(repr=False)
    preprocessor_mode: str = "canonical-event-v2"

    def as_mapping(self) -> dict[str, object]:
        return {
            "protocolVersion": SIDECAR_PROTOCOL_VERSION,
            "sessionId": self.session_id,
            "generation": self.generation,
            "annualSources": [os.fspath(path) for path in self.annual_sources],
            "verificationSources": [
                os.fspath(path) for path in self.verification_sources
            ],
            "applicationCacheRoot": os.fspath(self.application_cache_root),
            "outputDirectory": os.fspath(self.output_directory),
            "sessionNonce": self.session_nonce,
            "preprocessorMode": self.preprocessor_mode,
        }


def _exact_keys(value: Mapping[str, object], expected: tuple[str, ...]) -> bool:
    return len(value) == len(expected) and set(value) == set(expected)


def _safe_path(value: object) -> Path:
    if not isinstance(value, str) or not value or "\x00" in value:
        raise SidecarProtocolError()
    try:
        encoded = value.encode("utf-8")
    except UnicodeError:
        raise SidecarProtocolError() from None
    if len(encoded) > SIDECAR_MAX_PATH_BYTES or not os.path.isabs(value):
        raise SidecarProtocolError()
    return Path(value)


def _safe_path_list(value: object, *, required: bool) -> tuple[Path, ...]:
    if not isinstance(value, list) or len(value) > SIDECAR_MAX_SOURCES:
        raise SidecarProtocolError()
    if required and not value:
        raise SidecarProtocolError()
    return tuple(_safe_path(item) for item in value)


def validate_configuration(value: object) -> SidecarConfiguration:
    if not isinstance(value, dict) or not _exact_keys(value, SIDECAR_CONFIG_FIELDS):
        raise SidecarProtocolError()
    if value["protocolVersion"] != SIDECAR_PROTOCOL_VERSION:
        raise SidecarProtocolError("SIDECAR_PROTOCOL_VERSION_UNSUPPORTED")
    session_id = value["sessionId"]
    nonce = value["sessionNonce"]
    if (
        not isinstance(session_id, str)
        or _OPAQUE_ID_PATTERN.fullmatch(session_id) is None
        or not isinstance(nonce, str)
        or _OPAQUE_ID_PATTERN.fullmatch(nonce) is None
        or not isinstance(value["generation"], int)
        or isinstance(value["generation"], bool)
        or not 1 <= value["generation"] <= (2**53 - 1)
        or value["preprocessorMode"] != "canonical-event-v2"
    ):
        raise SidecarProtocolError()
    annual = _safe_path_list(value["annualSources"], required=True)
    verification = _safe_path_list(value["verificationSources"], required=False)
    cache_root = _safe_path(value["applicationCacheRoot"])
    output = _safe_path(value["outputDirectory"])
    normalized_cache = Path(os.path.abspath(os.fspath(cache_root)))
    normalized_output = Path(os.path.abspath(os.fspath(output)))
    nested_output = normalized_output.name == "normalized"
    session_directory = normalized_output.parent if nested_output else normalized_output
    session_parent = session_directory.parent
    if (
        session_directory.name != session_id
        or session_parent.name != "analysis-sessions"
        or session_parent.parent != normalized_cache
        or (
            nested_output
            and (
                not session_directory.is_dir()
                or not (session_directory / ".session-marker").is_file()
                or not (session_directory / "session-state").is_file()
            )
        )
    ):
        raise SidecarProtocolError()
    return SidecarConfiguration(
        session_id=session_id,
        generation=value["generation"],
        annual_sources=annual,
        verification_sources=verification,
        application_cache_root=cache_root,
        output_directory=output,
        session_nonce=nonce,
    )


def encode_configuration(configuration: SidecarConfiguration) -> bytes:
    value = configuration.as_mapping()
    validate_configuration(value)
    try:
        payload = json.dumps(
            value,
            ensure_ascii=False,
            separators=(",", ":"),
            allow_nan=False,
        ).encode("utf-8")
    except (TypeError, ValueError, UnicodeError):
        raise SidecarProtocolError() from None
    if not 0 < len(payload) <= SIDECAR_MAX_CONFIG_BYTES:
        raise SidecarProtocolError("SIDECAR_CONFIGURATION_TOO_LARGE")
    return struct.pack(">I", len(payload)) + payload


def _read_exact(stream: BinaryIO, size: int) -> bytes:
    value = bytearray()
    while len(value) < size:
        block = stream.read(size - len(value))
        if not block:
            raise SidecarProtocolError()
        value.extend(block)
    return bytes(value)


def _buffered_extra_available(stream: BinaryIO) -> bool:
    """Check already-available trailing bytes without waiting for stdin EOF."""

    if hasattr(stream, "getbuffer"):
        try:
            return len(stream.getbuffer()) != stream.tell()
        except (AttributeError, TypeError, ValueError):
            return False

    peek = getattr(stream, "peek", None)
    if not callable(peek):
        return False
    try:
        descriptor = stream.fileno()
        was_blocking = os.get_blocking(descriptor)
        os.set_blocking(descriptor, False)
        try:
            return bool(peek(1))
        finally:
            os.set_blocking(descriptor, was_blocking)
    except (BlockingIOError, OSError, AttributeError, TypeError, ValueError):
        return False


def read_configuration(
    stream: BinaryIO,
    *,
    reject_buffered_extra: bool = True,
) -> SidecarConfiguration:
    """Read exactly one uint32-prefixed strict JSON configuration."""

    length = struct.unpack(">I", _read_exact(stream, 4))[0]
    if not 0 < length <= SIDECAR_MAX_CONFIG_BYTES:
        raise SidecarProtocolError("SIDECAR_CONFIGURATION_TOO_LARGE")
    payload = _read_exact(stream, length)
    if reject_buffered_extra:
        if isinstance(stream, (bytearray,)) or _buffered_extra_available(stream):
            raise SidecarProtocolError()
    try:
        decoded = payload.decode("utf-8", errors="strict")

        def reject_constant(_value: str) -> Any:
            raise SidecarProtocolError()

        value = json.loads(
            decoded,
            parse_constant=reject_constant,
            object_pairs_hook=lambda pairs: _unique_object(pairs),
        )
    except SidecarProtocolError:
        raise
    except (UnicodeError, ValueError, json.JSONDecodeError):
        raise SidecarProtocolError() from None
    return validate_configuration(value)


def _unique_object(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    value: dict[str, Any] = {}
    for key, item in pairs:
        if key in value:
            raise SidecarProtocolError()
        value[key] = item
    return value


def _write_json_line(stream: TextIO, value: Mapping[str, object]) -> None:
    try:
        encoded = json.dumps(
            value,
            ensure_ascii=False,
            separators=(",", ":"),
            allow_nan=False,
        ).encode("utf-8")
        if len(encoded) + 1 > SIDECAR_MAX_LINE_BYTES:
            raise SidecarProtocolError("SIDECAR_EVENT_TOO_LARGE")
        stream.write(encoded.decode("utf-8") + "\n")
        stream.flush()
    except SidecarProtocolError:
        raise
    except (OSError, UnicodeError, TypeError, ValueError):
        raise SidecarProtocolError()


def emit_progress(stream: TextIO, configuration: SidecarConfiguration, payload: Mapping[str, object]) -> None:
    """Map the existing content-free progress payload to exact sidecar NDJSON."""

    phase = payload.get("phase")
    percentage = payload.get("percentage")
    status = payload.get("status")
    aggregate = payload.get("aggregateCount")
    capacity = payload.get("capacityValue")
    role = payload.get("role")
    ordinal = payload.get("sourceOrdinal")
    value: dict[str, object] = {
        "protocolVersion": SIDECAR_PROTOCOL_VERSION,
        "type": "progress",
        "sessionId": configuration.session_id,
        "generation": configuration.generation,
        "phase": phase,
        "percentage": percentage,
        "status": status,
        "aggregateCount": aggregate,
        "capacityValue": capacity,
    }
    if role is not None or ordinal is not None:
        if role not in _ROLES or not isinstance(ordinal, int) or isinstance(ordinal, bool) or ordinal < 1:
            raise SidecarProtocolError()
        value["role"] = role
        value["sourceOrdinal"] = ordinal
    _validate_progress(value, configuration.session_id, configuration.generation, None)
    _write_json_line(stream, value)


def emit_heartbeat(stream: TextIO, configuration: SidecarConfiguration) -> None:
    """Emit content-free liveness independent of pipeline progress."""

    value = {
        "protocolVersion": SIDECAR_PROTOCOL_VERSION,
        "type": "heartbeat",
        "sessionId": configuration.session_id,
        "generation": configuration.generation,
    }
    _validate_heartbeat(value, configuration.session_id, configuration.generation)
    _write_json_line(stream, value)


def emit_result(stream: TextIO, configuration: SidecarConfiguration, result: Mapping[str, object]) -> None:
    value = {
        "protocolVersion": SIDECAR_PROTOCOL_VERSION,
        "type": "result",
        "sessionId": configuration.session_id,
        "generation": configuration.generation,
        "status": "success",
        "eventCount": result.get("eventCount"),
        "eligibleTextCount": result.get("eligibleTextCount"),
        "chunkCount": result.get("chunkCount"),
        "duplicateEventCount": result.get("duplicateEventCount"),
        "warningCount": result.get("warningCount"),
    }
    _validate_result(value, configuration.session_id, configuration.generation)
    _write_json_line(stream, value)


def emit_failure(stream: TextIO, reason_code: str) -> None:
    if not isinstance(reason_code, str) or not re.fullmatch(r"[A-Z0-9_]{1,64}", reason_code):
        reason_code = "SIDECAR_PROTOCOL_INVALID"
    _write_json_line(
        stream,
        {
            "protocolVersion": SIDECAR_PROTOCOL_VERSION,
            "type": "failure",
            "reasonCode": reason_code,
        },
    )


def _validate_progress(
    value: Mapping[str, object],
    session_id: str,
    generation: int,
    previous_percentage: int | None,
) -> int:
    expected = set(SIDECAR_PROGRESS_FIELDS)
    actual = set(value)
    if actual not in (expected, expected | {"role", "sourceOrdinal"}):
        raise SidecarProtocolError()
    if (
        value.get("protocolVersion") != SIDECAR_PROTOCOL_VERSION
        or value.get("type") != "progress"
        or value.get("sessionId") != session_id
        or value.get("generation") != generation
        or value.get("phase") not in _PHASES
        or value.get("status") not in {"running", "completed"}
        or not isinstance(value.get("percentage"), int)
        or isinstance(value.get("percentage"), bool)
        or not 0 <= value["percentage"] <= 100
        or not isinstance(value.get("aggregateCount"), int)
        or isinstance(value.get("aggregateCount"), bool)
        or value["aggregateCount"] < 0
        or not isinstance(value.get("capacityValue"), int)
        or isinstance(value.get("capacityValue"), bool)
        or value["capacityValue"] < 1
        or value["aggregateCount"] > value["capacityValue"]
        or (
            previous_percentage is not None
            and value["percentage"] < previous_percentage
        )
    ):
        raise SidecarProtocolError()
    if "role" in value and (
        value["role"] not in _ROLES
        or not isinstance(value.get("sourceOrdinal"), int)
        or isinstance(value.get("sourceOrdinal"), bool)
        or value["sourceOrdinal"] < 1
    ):
        raise SidecarProtocolError()
    return value["percentage"]


def _validate_heartbeat(
    value: Mapping[str, object],
    session_id: str,
    generation: int,
) -> None:
    if not _exact_keys(value, SIDECAR_HEARTBEAT_FIELDS) or (
        value.get("protocolVersion") != SIDECAR_PROTOCOL_VERSION
        or value.get("type") != "heartbeat"
        or value.get("sessionId") != session_id
        or value.get("generation") != generation
    ):
        raise SidecarProtocolError()


def _validate_result(value: Mapping[str, object], session_id: str, generation: int) -> None:
    if not _exact_keys(value, SIDECAR_RESULT_FIELDS) or (
        value.get("protocolVersion") != SIDECAR_PROTOCOL_VERSION
        or value.get("type") != "result"
        or value.get("sessionId") != session_id
        or value.get("generation") != generation
        or value.get("status") != "success"
    ):
        raise SidecarProtocolError()
    for field_name in SIDECAR_RESULT_FIELDS[5:]:
        value_item = value[field_name]
        if not isinstance(value_item, int) or isinstance(value_item, bool) or value_item < 0:
            raise SidecarProtocolError()


def parse_stdout_lines(
    lines: Iterable[bytes | str],
    *,
    session_id: str,
    generation: int,
) -> tuple[tuple[dict[str, object], ...], dict[str, object]]:
    """Validate a sidecar stdout stream and return progress plus its result."""

    progress: list[dict[str, object]] = []
    terminal: dict[str, object] | None = None
    previous_percentage: int | None = None
    for index, raw in enumerate(lines):
        if index >= SIDECAR_MAX_EVENT_COUNT:
            raise SidecarProtocolError("SIDECAR_EVENT_COUNT_EXCEEDED")
        if isinstance(raw, bytes):
            if len(raw) > SIDECAR_MAX_LINE_BYTES:
                raise SidecarProtocolError("SIDECAR_EVENT_TOO_LARGE")
            try:
                text = raw.decode("utf-8")
            except UnicodeError:
                raise SidecarProtocolError() from None
        elif isinstance(raw, str):
            text = raw
            if len(text.encode("utf-8")) > SIDECAR_MAX_LINE_BYTES:
                raise SidecarProtocolError("SIDECAR_EVENT_TOO_LARGE")
        else:
            raise SidecarProtocolError()
        if not text.endswith("\n"):
            raise SidecarProtocolError()
        text = text[:-1]
        if not text or terminal is not None:
            raise SidecarProtocolError()
        try:
            value = json.loads(
                text,
                parse_constant=lambda _value: (_ for _ in ()).throw(
                    SidecarProtocolError()
                ),
                object_pairs_hook=_unique_object,
            )
        except SidecarProtocolError:
            raise
        except (UnicodeError, ValueError, json.JSONDecodeError):
            raise SidecarProtocolError() from None
        if not isinstance(value, dict):
            raise SidecarProtocolError()
        if value.get("type") == "progress":
            previous_percentage = _validate_progress(
                value,
                session_id,
                generation,
                previous_percentage,
            )
            progress.append(value)
        elif value.get("type") == "heartbeat":
            _validate_heartbeat(value, session_id, generation)
        elif value.get("type") == "result":
            _validate_result(value, session_id, generation)
            terminal = value
        else:
            raise SidecarProtocolError()
    if terminal is None:
        raise SidecarProtocolError("SIDECAR_TERMINAL_MISSING")
    return tuple(progress), terminal


def parse_failure_line(raw: bytes | str) -> dict[str, str]:
    if isinstance(raw, bytes):
        try:
            text = raw.decode("utf-8")
        except UnicodeError:
            raise SidecarProtocolError() from None
    elif isinstance(raw, str):
        text = raw
    else:
        raise SidecarProtocolError()
    if len(text.encode("utf-8")) > SIDECAR_MAX_LINE_BYTES:
        raise SidecarProtocolError("SIDECAR_EVENT_TOO_LARGE")
    if not text.endswith("\n"):
        raise SidecarProtocolError()
    text = text[:-1]
    try:
        value = json.loads(text, object_pairs_hook=_unique_object)
    except (UnicodeError, ValueError, json.JSONDecodeError, SidecarProtocolError):
        raise SidecarProtocolError() from None
    if (
        not isinstance(value, dict)
        or not _exact_keys(value, SIDECAR_FAILURE_FIELDS)
        or value.get("protocolVersion") != SIDECAR_PROTOCOL_VERSION
        or value.get("type") != "failure"
        or not isinstance(value.get("reasonCode"), str)
        or re.fullmatch(r"[A-Z0-9_]{1,64}", value["reasonCode"]) is None
    ):
        raise SidecarProtocolError()
    return {"protocolVersion": value["protocolVersion"], "reasonCode": value["reasonCode"]}
