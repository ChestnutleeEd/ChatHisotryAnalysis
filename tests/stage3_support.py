from __future__ import annotations

from dataclasses import replace
from datetime import datetime, timedelta, timezone
import importlib.util
import json
from pathlib import Path
from typing import Any, Iterable

from chat_history_analysis.backend import BackendEvidence


HAS_IJSON = importlib.util.find_spec("ijson") is not None
OWNER = "synthetic-owner"
PEER = "synthetic-peer"


def real_backend() -> BackendEvidence:
    from ijson.backends import yajl2_c
    from ijson.common import JSONError

    return BackendEvidence(
        module_name="ijson.backends.yajl2_c",
        backend_name="yajl2_c",
        selected_backend_name="yajl2_c",
        selected_parse_matches=True,
        module_origin_matches_distribution=True,
        native_origin_matches_distribution=True,
        parser_error_origin_matches_distribution=True,
        parse=yajl2_c.parse,
        parser_error_types=(JSONError,),
    )


def backend_with_parse(parse: Any) -> BackendEvidence:
    return replace(real_backend(), parse=parse)


def message(
    create_time: Any,
    sender: Any,
    *,
    content: Any = "synthetic-message",
    **extra: Any,
) -> dict[str, Any]:
    if (
        isinstance(create_time, int)
        and not isinstance(create_time, bool)
        and -(2**62) <= create_time <= 2**62
    ):
        try:
            formatted_time = (
                datetime(1970, 1, 1, tzinfo=timezone.utc)
                + timedelta(seconds=create_time, hours=8)
            ).strftime("%Y-%m-%d %H:%M:%S")
        except (OverflowError, ValueError):
            formatted_time = "1970-01-01 08:00:00"
    else:
        formatted_time = "1970-01-01 08:00:00"
    value = {
        "createTime": create_time,
        "formattedTime": formatted_time,
        "senderUsername": sender,
        "content": content,
        "chatLabType": 0,
        "type": "文本消息",
        "localType": 1,
        "isSend": 1 if sender == OWNER else 0,
    }
    value.update(extra)
    return value


def export_document(
    messages: Iterable[Any],
    *,
    export_info: Any = None,
    session: Any = None,
    extra_root: dict[str, Any] | None = None,
) -> dict[str, Any]:
    selected_export_info = (
        {"format": "detailed-json", "version": "synthetic"}
        if export_info is None
        else export_info
    )
    selected_session = (
        {
            "isGroup": False,
            "type": "私聊",
            "platform": "synthetic-platform",
            "ownerId": OWNER,
            "wxid": PEER,
        }
        if session is None
        else session
    )
    document = {
        "exportInfo": selected_export_info,
        "session": selected_session,
        "messages": list(messages),
    }
    if extra_root:
        document.update(extra_root)
    return document


def write_export(
    path: Path,
    messages: Iterable[Any],
    *,
    export_info: Any = None,
    session: Any = None,
    extra_root: dict[str, Any] | None = None,
) -> Path:
    path.write_text(
        json.dumps(
            export_document(
                messages,
                export_info=export_info,
                session=session,
                extra_root=extra_root,
            ),
            ensure_ascii=False,
            separators=(",", ":"),
        ),
        encoding="utf-8",
    )
    return path
