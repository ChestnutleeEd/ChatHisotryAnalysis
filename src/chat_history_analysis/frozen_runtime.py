"""Hash-locked readiness gate for the frozen onedir sidecar."""

from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import platform
import re
import sys
from typing import Any, Final

from .backend import BackendEvidence
from .errors import StartupError, StartupReasonCode
from .sidecar_trust import (
    TRUST_ANCHOR_NAME,
    TRUST_ROOT,
    load_anchor,
    verify_evidence_against_anchor,
)


EVIDENCE_VERSION: Final = "chat-history-analysis.sidecar-evidence.v1"
EVIDENCE_NAME: Final = "sidecar-evidence.json"
BUILD_PROBE_ENVIRONMENT: Final = "CHAT_HISTORY_ANALYSIS_BUILD_PROBE"
HASH_PATTERN: Final = re.compile(r"^[0-9a-f]{64}$")
REVISION_PATTERN: Final = re.compile(r"^[0-9a-f]{40}$")
EVIDENCE_FIELDS: Final = frozenset(
    {
        "evidenceVersion",
        "buildMode",
        "targetTriple",
        "pythonMajorMinor",
        "pyinstallerVersion",
        "preprocessorVersion",
        "ijsonVersion",
        "nativeBackend",
        "executableName",
        "executableArchitecture",
        "sourceRevision",
        "trustAnchorId",
        "dependencyLockDigest",
        "specDigest",
        "productionEntrypointDigest",
        "fixtureSha256",
        "buildInputDigest",
        "network",
        "trustRoot",
        "members",
        "bundleMerkleRoot",
        "evidenceDigest",
        "probeResults",
    }
)
MEMBER_FIELDS: Final = frozenset({"name", "byteSize", "sha256"})


def _failure() -> StartupError:
    return StartupError(StartupReasonCode.IJSON_DISTRIBUTION_UNVERIFIED)


def _sha256(path: Path) -> tuple[str, int]:
    digest = hashlib.sha256()
    size = 0
    try:
        with path.open("rb") as stream:
            for block in iter(lambda: stream.read(65_536), b""):
                digest.update(block)
                size += len(block)
    except (OSError, ValueError):
        raise _failure() from None
    return digest.hexdigest(), size


def _safe_regular_file(path: Path) -> None:
    try:
        metadata = os.lstat(path)
        if not os.path.isfile(path) or os.path.islink(path) or metadata.st_size < 0:
            raise _failure()
        resolved = path.resolve(strict=True)
    except StartupError:
        raise
    except (OSError, RuntimeError, ValueError):
        raise _failure() from None
    if resolved != path.resolve(strict=False):
        raise _failure()


def _bundle_members(bundle_root: Path) -> list[dict[str, object]]:
    records: list[dict[str, object]] = []
    root = bundle_root.resolve(strict=True)
    for current, directory_names, file_names in os.walk(root, topdown=True, followlinks=False):
        current_path = Path(current)
        safe_directories: list[str] = []
        for name in sorted(directory_names):
            candidate = current_path / name
            try:
                if os.path.islink(candidate) or not candidate.is_dir():
                    raise _failure()
            except StartupError:
                raise
            except OSError:
                raise _failure() from None
            safe_directories.append(name)
        directory_names[:] = safe_directories
        for name in sorted(file_names):
            candidate = current_path / name
            _safe_regular_file(candidate)
            try:
                relative = candidate.resolve(strict=True).relative_to(root)
            except (OSError, RuntimeError, ValueError):
                raise _failure() from None
            relative_name = relative.as_posix()
            if candidate.name in (EVIDENCE_NAME, TRUST_ANCHOR_NAME):
                continue
            digest, size = _sha256(candidate)
            records.append(
                {"name": relative_name, "byteSize": size, "sha256": digest}
            )
    return sorted(records, key=lambda item: str(item["name"]))


def _read_evidence(bundle_root: Path) -> dict[str, Any]:
    evidence_path = bundle_root / EVIDENCE_NAME
    _safe_regular_file(evidence_path)
    try:
        value = json.loads(evidence_path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError):
        raise _failure() from None
    if not isinstance(value, dict) or set(value) != EVIDENCE_FIELDS:
        raise _failure()
    return value


def _read_anchor(bundle_root: Path) -> dict[str, Any]:
    try:
        return load_anchor(bundle_root / TRUST_ANCHOR_NAME)
    except ValueError:
        raise _failure() from None


def _verify_evidence(
    bundle_root: Path,
    evidence: dict[str, Any],
    anchor: dict[str, Any],
) -> None:
    if (
        evidence["evidenceVersion"] != EVIDENCE_VERSION
        or evidence["buildMode"] != "onedir"
        or evidence["targetTriple"] != "macos-arm64"
        or evidence["nativeBackend"] != "ijson.backends.yajl2_c"
        or evidence["network"] != "blocked-and-probed"
        or evidence["trustRoot"] != TRUST_ROOT
        or evidence["executableName"] != Path(sys.executable).name
        or evidence["executableArchitecture"] != "arm64"
        or platform.system() != "Darwin"
        or platform.machine() != "arm64"
        or evidence["pythonMajorMinor"]
        != f"{sys.version_info.major}.{sys.version_info.minor}"
    ):
        raise _failure()
    if not isinstance(evidence["sourceRevision"], str) or not REVISION_PATTERN.fullmatch(
        evidence["sourceRevision"]
    ):
        raise _failure()
    for key in (
        "dependencyLockDigest",
        "specDigest",
        "productionEntrypointDigest",
        "fixtureSha256",
        "buildInputDigest",
        "bundleMerkleRoot",
        "evidenceDigest",
    ):
        if not isinstance(evidence[key], str) or not HASH_PATTERN.fullmatch(evidence[key]):
            raise _failure()
    for key in (
        "pyinstallerVersion",
        "preprocessorVersion",
        "ijsonVersion",
        "trustAnchorId",
    ):
        if not isinstance(evidence[key], str) or not evidence[key]:
            raise _failure()
    probes = evidence["probeResults"]
    if (
        not isinstance(probes, dict)
        or set(probes) != {"parser", "productionSuccess", "productionFailure", "differentCwd", "offline"}
        or any(probes[key] != "passed" for key in probes)
    ):
        raise _failure()
    members = evidence["members"]
    if not isinstance(members, list):
        raise _failure()
    observed: list[dict[str, object]] = []
    for member in members:
        if (
            not isinstance(member, dict)
            or set(member) != MEMBER_FIELDS
            or not isinstance(member["name"], str)
            or not isinstance(member["byteSize"], int)
            or isinstance(member["byteSize"], bool)
            or member["byteSize"] < 0
            or not isinstance(member["sha256"], str)
            or not HASH_PATTERN.fullmatch(member["sha256"])
        ):
            raise _failure()
        path = PurePosixPath(member["name"])
        if (
            path.is_absolute()
            or ".." in path.parts
            or path.name in (EVIDENCE_NAME, TRUST_ANCHOR_NAME)
        ):
            raise _failure()
        observed.append(member)
    if observed != sorted(observed, key=lambda item: str(item["name"])):
        raise _failure()
    actual_members = _bundle_members(bundle_root)
    if observed != actual_members:
        raise _failure()
    try:
        verify_evidence_against_anchor(anchor, evidence, actual_members)
    except ValueError:
        raise _failure() from None


def _load_frozen_backend(bundle_root: Path) -> BackendEvidence:
    try:
        import importlib

        backend_module = importlib.import_module("ijson.backends.yajl2_c")
        native_module = importlib.import_module("ijson.backends._yajl2")
        common_module = importlib.import_module("ijson.common")
        package_module = importlib.import_module("ijson")
        backend_origin = getattr(backend_module, "__file__", None)
        native_origin = getattr(native_module, "__file__", None)
        if not isinstance(backend_origin, str) or not isinstance(native_origin, str):
            raise TypeError
        backend_file = Path(backend_origin).resolve(strict=False)
        native_file = Path(native_origin).resolve(strict=True)
        backend_file.relative_to(bundle_root.resolve(strict=True))
        native_file.relative_to(bundle_root.resolve(strict=True))
        parser_error = common_module.JSONError
        parser = backend_module.parse
        if (
            backend_module.__name__ != "ijson.backends.yajl2_c"
            or getattr(backend_module, "backend", "") != "yajl2_c"
            or getattr(package_module, "backend", "") != "yajl2_c"
            or package_module.parse is not parser
            or not isinstance(parser_error, type)
            or not issubclass(parser_error, Exception)
        ):
            raise TypeError
    except Exception:
        raise _failure() from None
    return BackendEvidence(
        module_name="ijson.backends.yajl2_c",
        backend_name="yajl2_c",
        selected_backend_name="yajl2_c",
        selected_parse_matches=True,
        module_origin_matches_distribution=True,
        native_origin_matches_distribution=True,
        parser_error_origin_matches_distribution=True,
        parse=parser,
        parser_error_types=(parser_error,),
    )


def _is_build_probe_request() -> bool:
    return os.environ.get(BUILD_PROBE_ENVIRONMENT) == "1" and tuple(
        sys.argv[1:]
    ) in {
        ("--probe",),
        ("--synthetic-cli",),
        ("--synthetic-failure",),
    }


def verify_frozen_runtime() -> BackendEvidence:
    """Verify the executable, evidence root, native parser, and probe gate."""

    if not getattr(sys, "frozen", False):
        raise _failure()
    try:
        executable = Path(sys.executable)
        _safe_regular_file(executable)
        bundle_root = executable.resolve(strict=True).parent
    except (OSError, RuntimeError, ValueError):
        raise _failure() from None
    anchor = _read_anchor(bundle_root)
    if _is_build_probe_request():
        # Build probes run before the final passed evidence is generated.  The
        # only entrypoint accepts synthetic probe commands, so this narrow
        # branch cannot open a user source.  A stale evidence file is rejected
        # to keep the final evidence order deterministic.
        if (bundle_root / EVIDENCE_NAME).exists():
            raise _failure()
        _bundle_members(bundle_root)
        backend = _load_frozen_backend(bundle_root)
        from .startup import StartupGate

        StartupGate._verify_parser_initialization(backend)
        return backend
    evidence = _read_evidence(bundle_root)
    _verify_evidence(bundle_root, evidence, anchor)
    backend = _load_frozen_backend(bundle_root)
    from .startup import StartupGate

    StartupGate._verify_parser_initialization(backend)
    return backend
