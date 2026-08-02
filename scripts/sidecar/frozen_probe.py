"""Frozen parser and production-composition probes.

All inputs are the committed synthetic fixture.  The probe emits only stable
counts and failure classifications; it never accepts a user path.
"""

from __future__ import annotations

import io
import json
import os
from pathlib import Path
import platform
import sys


_FIXTURE_NAME = "sidecar-synthetic-fixture.json"
_POSITIVE_DOCUMENT = b'{"messages":[{"createTime":1},{"createTime":2}]}'
_REJECTED_DOCUMENTS = (
    b'{"messages":[{"createTime":1}]',
    b'{"messages":/*synthetic*/[]}',
    b'{"messages":[]} {"extra":1}',
)


def _parse_events(document: bytes):
    from ijson.backends import yajl2_c

    return tuple(
        yajl2_c.parse(
            io.BytesIO(document),
            use_float=False,
            multiple_values=False,
            allow_comments=False,
            buf_size=65_536,
        )
    )


def _parser_probe() -> dict[str, object]:
    from ijson.backends import yajl2_c
    from ijson.common import JSONError

    events = _parse_events(_POSITIVE_DOCUMENT)
    if not events or not any(event[1] == "number" for event in events):
        raise RuntimeError("PARSER_PROBE_FAILED")
    for document in _REJECTED_DOCUMENTS:
        try:
            _parse_events(document)
        except (JSONError, ValueError):
            continue
        raise RuntimeError("PARSER_REJECTION_PROBE_FAILED")
    return {
        "backend": "yajl2_c",
        "backendModule": getattr(yajl2_c, "__name__", ""),
        "architecture": platform.machine(),
        "pythonMajorMinor": f"{sys.version_info.major}.{sys.version_info.minor}",
        "frozen": bool(getattr(sys, "frozen", False)),
    }


def _fixture_bytes() -> bytes:
    candidates = []
    meipass = getattr(sys, "_MEIPASS", None)
    if isinstance(meipass, str):
        candidates.append(Path(meipass) / _FIXTURE_NAME)
    candidates.append(Path(__file__).resolve().parents[2] / "contracts" / _FIXTURE_NAME)
    for candidate in candidates:
        try:
            if candidate.is_file():
                return candidate.read_bytes()
        except OSError:
            continue
    raise RuntimeError("FIXTURE_UNAVAILABLE")


def _remove_generated_output(output: Path, manifest: dict[str, object] | None) -> None:
    names = ["manifest.json"]
    if isinstance(manifest, dict) and isinstance(manifest.get("chunks"), list):
        for chunk in manifest["chunks"]:
            if isinstance(chunk, dict) and isinstance(chunk.get("name"), str):
                names.append(chunk["name"])
    for name in names:
        candidate = output / name
        try:
            candidate.unlink()
        except FileNotFoundError:
            pass
        except OSError:
            raise RuntimeError("SYNTHETIC_CLEANUP_FAILED") from None
    try:
        output.rmdir()
    except FileNotFoundError:
        pass
    except OSError:
        raise RuntimeError("SYNTHETIC_CLEANUP_FAILED") from None


def _run_production_success() -> dict[str, object]:
    from chat_history_analysis.application import run_preprocessing
    from chat_history_analysis.input_preflight import InputSelection

    bundle_root = Path(sys.executable).resolve().parent
    ordinal = str(os.getpid())
    probe_root = bundle_root.parent / f".synthetic-probe-{ordinal}"
    probe_root.mkdir()
    source = probe_root / "input.json"
    output = probe_root / "output"
    manifest: dict[str, object] | None = None
    try:
        source.write_bytes(_fixture_bytes())
        result = run_preprocessing(
            InputSelection(
                annual_sources=(source,),
                overlap_verifications=(),
                output_directory=output,
            )
        )
        manifest_path = output / "manifest.json"
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        if not isinstance(manifest, dict):
            raise RuntimeError("PRODUCTION_MANIFEST_INVALID")
        return {
            "status": "synthetic-cli-ready",
            "backend": "yajl2_c",
            "rawMessageCount": result.validation.aggregate_raw_message_count,
            "normalizedRecordCount": result.dataset.normalized_record_count,
            "chunkCount": result.dataset.chunk_count,
            "schemaVersion": manifest.get("schemaVersion"),
        }
    finally:
        _remove_generated_output(output, manifest)
        try:
            source.unlink()
        except FileNotFoundError:
            pass
        except OSError:
            raise RuntimeError("SYNTHETIC_CLEANUP_FAILED") from None
        try:
            probe_root.rmdir()
        except FileNotFoundError:
            pass
        except OSError:
            raise RuntimeError("SYNTHETIC_CLEANUP_FAILED") from None


def _run_production_failure() -> dict[str, object]:
    from chat_history_analysis.application import run_preprocessing
    from chat_history_analysis.input_preflight import InputSelection

    bundle_root = Path(sys.executable).resolve().parent
    ordinal = str(os.getpid())
    probe_root = bundle_root.parent / f".synthetic-failure-probe-{ordinal}"
    probe_root.mkdir()
    source = probe_root / "input.json"
    output = probe_root / "output"
    try:
        source.write_bytes(b'{"exportInfo":{"format":"detailed-json"}}\n')
        try:
            run_preprocessing(
                InputSelection(
                    annual_sources=(source,),
                    overlap_verifications=(),
                    output_directory=output,
                )
            )
        except Exception:
            return {
                "status": "synthetic-cli-failure",
                "failureClass": "SOURCE_VALIDATION_FAILED",
            }
        raise RuntimeError("EXPECTED_PRODUCTION_FAILURE_NOT_OBSERVED")
    finally:
        try:
            source.unlink()
        except FileNotFoundError:
            pass
        except OSError:
            raise RuntimeError("SYNTHETIC_CLEANUP_FAILED") from None
        if output.exists():
            _remove_generated_output(output, None)
        try:
            probe_root.rmdir()
        except FileNotFoundError:
            pass
        except OSError:
            raise RuntimeError("SYNTHETIC_CLEANUP_FAILED") from None


def main(argv: list[str] | None = None) -> int:
    supplied = tuple(sys.argv[1:] if argv is None else argv)
    if supplied not in ((), ("--probe",), ("--synthetic-cli",), ("--synthetic-failure",)):
        print(json.dumps({"code": "INVALID_REQUEST"}, sort_keys=True), file=sys.stderr)
        return 2
    try:
        result = _parser_probe()
        if supplied == ("--synthetic-cli",):
            result = {**result, **_run_production_success()}
        elif supplied == ("--synthetic-failure",):
            result = {**result, **_run_production_failure()}
        else:
            result = {"status": "ready", **result}
    except Exception:
        print(json.dumps({"code": "PROBE_FAILED"}, sort_keys=True), file=sys.stderr)
        return 3
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
