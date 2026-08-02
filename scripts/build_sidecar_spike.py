"""Build and verify the production-shaped PyInstaller onedir sidecar."""

from __future__ import annotations

import argparse
import hashlib
import importlib.metadata
import json
import os
from pathlib import Path
import platform
import shutil
import subprocess
import sys
import zipfile
from typing import Iterable


ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, os.fspath(ROOT / "src"))

from chat_history_analysis.sidecar_trust import (  # noqa: E402
    TRUST_ANCHOR_NAME,
    TRUST_ROOT,
    bundle_merkle_root,
    evidence_digest,
    load_anchor,
    source_input_digest,
    verify_evidence_against_anchor,
)


LOCKFILE = ROOT / "requirements-sidecar-build.lock"
SPECFILE = ROOT / "scripts" / "sidecar" / "chat_history_analysis_sidecar.spec"
ENTRYPOINT = ROOT / "scripts" / "sidecar" / "sidecar_entry.py"
FIXTURE = ROOT / "contracts" / "sidecar-synthetic-fixture.json"
EVIDENCE_VERSION = "chat-history-analysis.sidecar-evidence.v1"
SIDECAR_NAME = "chat-history-analysis-sidecar-probe"
EVIDENCE_NAME = "sidecar-evidence.json"
TRUST_ANCHOR = ROOT / "src-tauri" / "resources" / TRUST_ANCHOR_NAME


def _sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(65_536), b""):
            digest.update(block)
    return digest.hexdigest()


def _members(root: Path) -> list[dict[str, object]]:
    records: list[dict[str, object]] = []
    for path in sorted(root.rglob("*")):
        if path.is_symlink():
            raise RuntimeError("SIDECAR_LAYOUT_INVALID")
        if not path.is_file() or path.name in (EVIDENCE_NAME, TRUST_ANCHOR_NAME):
            continue
        records.append(
            {
                "name": path.relative_to(root).as_posix(),
                "byteSize": path.stat().st_size,
                "sha256": _sha256(path),
            }
        )
    return records


def _git_bytes(*arguments: str) -> bytes:
    result = subprocess.run(
        ["git", "-C", os.fspath(ROOT), *arguments],
        check=False,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    if result.returncode != 0:
        raise RuntimeError("SOURCE_EVIDENCE_UNAVAILABLE")
    return result.stdout


def _version(module: str, fallback: str) -> str:
    try:
        return importlib.metadata.version(module)
    except importlib.metadata.PackageNotFoundError:
        return fallback


def _build_input_digests() -> dict[str, str]:
    """Hash the non-circular source allowlist used by the trust anchor."""

    paths = [
        LOCKFILE,
        SPECFILE,
        ENTRYPOINT,
        FIXTURE,
        ROOT / "scripts" / "build_sidecar_spike.py",
        ROOT / "scripts" / "sidecar" / "sidecar_entry.py",
        ROOT / "scripts" / "sidecar" / "frozen_probe.py",
        ROOT / "contracts" / "canonical-v2.vectors.json",
        ROOT / "contracts" / "desktop-ipc-v1.vectors.json",
        *sorted((ROOT / "src" / "chat_history_analysis").glob("*.py")),
    ]
    unique_paths = list(dict.fromkeys(paths))
    return {
        path.relative_to(ROOT).as_posix(): _sha256(path)
        for path in unique_paths
    }


def _run(
    executable: Path,
    *arguments: str,
    cwd: Path,
    network_blocked: bool = False,
) -> dict[str, object]:
    environment = {
        "PATH": "/usr/bin:/bin",
        "PYTHONNOUSERSITE": "1",
        "PYTHONDONTWRITEBYTECODE": "1",
        "PYTHONHASHSEED": "0",
        "SOURCE_DATE_EPOCH": "0",
        "CHAT_HISTORY_ANALYSIS_BUILD_PROBE": "1",
    }
    command = [str(executable), *arguments]
    if network_blocked:
        sandbox = Path("/usr/bin/sandbox-exec")
        if not sandbox.is_file():
            raise RuntimeError("NETWORK_SANDBOX_UNAVAILABLE")
        command = [
            str(sandbox),
            "-p",
            "(version 1) (allow default) (deny network*)",
            *command,
        ]
    result = subprocess.run(
        command,
        check=False,
        cwd=cwd,
        env=environment,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        timeout=180,
    )
    if result.returncode != 0 or result.stderr:
        raise RuntimeError("SIDECAR_PROBE_FAILED")
    try:
        payload = json.loads(result.stdout)
    except json.JSONDecodeError as error:
        raise RuntimeError("SIDECAR_PROTOCOL_INVALID") from error
    if not isinstance(payload, dict):
        raise RuntimeError("SIDECAR_PROTOCOL_INVALID")
    return payload


def _architecture(executable: Path) -> str:
    file_result = subprocess.run(
        ["/usr/bin/file", os.fspath(executable)],
        check=False,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    if file_result.returncode != 0 or "Mach-O" not in file_result.stdout or "arm64" not in file_result.stdout:
        raise RuntimeError("SIDECAR_ARCHITECTURE_INVALID")
    lipo_result = subprocess.run(
        ["/usr/bin/lipo", "-archs", os.fspath(executable)],
        check=False,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    if lipo_result.returncode != 0 or lipo_result.stdout.strip() != "arm64":
        raise RuntimeError("SIDECAR_ARCHITECTURE_INVALID")
    return "arm64"


def _write_evidence(path: Path, evidence: dict[str, object]) -> None:
    path.write_text(
        json.dumps(evidence, ensure_ascii=False, sort_keys=True, indent=2) + "\n",
        encoding="utf-8",
    )


def _normalize_base_library_zip(bundle: Path) -> None:
    """Make PyInstaller's set-derived base archive byte-stable."""

    archive = bundle / "_internal" / "base_library.zip"
    if not archive.is_file():
        raise RuntimeError("SIDECAR_LAYOUT_INVALID")
    normalized = archive.with_name("base_library.zip.normalized")
    try:
        with zipfile.ZipFile(archive, "r") as source, zipfile.ZipFile(
            normalized, "w", compression=zipfile.ZIP_STORED
        ) as target:
            for info in sorted(source.infolist(), key=lambda entry: entry.filename):
                stable = zipfile.ZipInfo(info.filename)
                stable.date_time = (1980, 1, 1, 0, 0, 0)
                stable.compress_type = zipfile.ZIP_STORED
                stable.create_system = info.create_system
                stable.external_attr = info.external_attr
                target.writestr(stable, source.read(info.filename))
        normalized.replace(archive)
    except (OSError, zipfile.BadZipFile):
        try:
            normalized.unlink()
        except FileNotFoundError:
            pass
        raise RuntimeError("SIDECAR_LAYOUT_INVALID") from None


def _fresh_output(output_dir: Path) -> None:
    try:
        output_dir = output_dir.resolve(strict=False)
        output_dir.relative_to(ROOT.resolve(strict=True))
    except (OSError, RuntimeError, ValueError):
        raise RuntimeError("OUTPUT_MUST_BE_REPOSITORY_LOCAL") from None
    output_dir.mkdir(parents=True, exist_ok=True)
    for name in ("dist", "work", ".venv-sidecar", "retained-wheels"):
        if (output_dir / name).exists():
            raise RuntimeError("OUTPUT_NOT_CLEAN")


def _install_clean_environment(output_dir: Path) -> Path:
    if sys.version_info[:2] != (3, 12):
        raise RuntimeError("UNSUPPORTED_PYTHON_RUNTIME")
    venv_dir = output_dir / ".venv-sidecar"
    result = subprocess.run(
        [sys.executable, "-m", "venv", os.fspath(venv_dir)],
        check=False,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        timeout=120,
    )
    if result.returncode != 0:
        raise RuntimeError("CLEAN_ENVIRONMENT_FAILED")
    python = venv_dir / "bin" / "python"
    install = subprocess.run(
        [
            os.fspath(python),
            "-m",
            "pip",
            "install",
            "--disable-pip-version-check",
            "--require-hashes",
            "--only-binary=:all:",
            "-r",
            os.fspath(LOCKFILE),
        ],
        check=False,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        timeout=300,
    )
    if install.returncode != 0:
        raise RuntimeError("HASH_LOCKED_INSTALL_FAILED")
    retained_wheels = output_dir / "retained-wheels"
    retained_wheels.mkdir(parents=True, exist_ok=False)
    download = subprocess.run(
        [
            os.fspath(python),
            "-m",
            "pip",
            "download",
            "--disable-pip-version-check",
            "--require-hashes",
            "--only-binary=:all:",
            "-r",
            os.fspath(LOCKFILE),
            "--dest",
            os.fspath(retained_wheels),
        ],
        check=False,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        timeout=300,
    )
    if download.returncode != 0:
        raise RuntimeError("RETAINED_ARTIFACT_DOWNLOAD_FAILED")
    ijson_wheels = sorted(retained_wheels.glob("ijson-3.5.1-*.whl"))
    if len(ijson_wheels) != 1:
        raise RuntimeError("RETAINED_ARTIFACT_INVALID")
    retained_archive = venv_dir / "share" / "chat-history-analysis"
    retained_archive.mkdir(parents=True, exist_ok=False)
    shutil.copyfile(
        ijson_wheels[0], retained_archive / ijson_wheels[0].name
    )
    return python


def _refreshed_anchor(
    anchor: dict[str, object],
    evidence: dict[str, object],
) -> dict[str, object]:
    """Bind a newly built bundle to the current declared build inputs."""

    source_revision = str(evidence["sourceRevision"])
    return {
        "anchorVersion": anchor["anchorVersion"],
        "anchorId": f"stage3-macos-arm64-{source_revision[:12]}",
        "targetTriple": evidence["targetTriple"],
        "pythonMajorMinor": evidence["pythonMajorMinor"],
        "executableName": evidence["executableName"],
        "nativeBackend": evidence["nativeBackend"],
        "sourceRevision": evidence["sourceRevision"],
        "dependencyLockDigest": evidence["dependencyLockDigest"],
        "specDigest": evidence["specDigest"],
        "productionEntrypointDigest": evidence["productionEntrypointDigest"],
        "fixtureSha256": evidence["fixtureSha256"],
        "buildInputDigest": evidence["buildInputDigest"],
        "expectedBundleMerkleRoot": evidence["bundleMerkleRoot"],
        "expectedEvidenceDigest": evidence.get("evidenceDigest"),
        "trustRoot": evidence["trustRoot"],
    }


def build(output_dir: Path, *, refresh_trust_anchor: bool = False) -> Path:
    if platform.system() != "Darwin" or platform.machine() != "arm64":
        raise RuntimeError("UNSUPPORTED_BUILD_TARGET")
    _fresh_output(output_dir)
    output_dir = output_dir.resolve(strict=True)
    build_python = _install_clean_environment(output_dir)
    dist_dir = output_dir / "dist"
    work_dir = output_dir / "work"
    pyinstaller = subprocess.run(
        [
            os.fspath(build_python),
            "-m",
            "PyInstaller",
            "--noconfirm",
            "--clean",
            "--distpath",
            os.fspath(dist_dir),
            "--workpath",
            os.fspath(work_dir),
            os.fspath(SPECFILE),
        ],
        check=False,
        env={
            "PATH": "/usr/bin:/bin",
            "PYTHONNOUSERSITE": "1",
            "PYTHONDONTWRITEBYTECODE": "1",
            "PYTHONHASHSEED": "0",
            "SOURCE_DATE_EPOCH": "0",
        },
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        timeout=600,
    )
    if pyinstaller.returncode != 0:
        raise RuntimeError("SIDECAR_BUILD_FAILED")

    bundle = dist_dir / SIDECAR_NAME
    executable = bundle / SIDECAR_NAME
    if not bundle.is_dir() or not executable.is_file():
        raise RuntimeError("SIDECAR_LAYOUT_INVALID")
    _normalize_base_library_zip(bundle)
    executable_architecture = _architecture(executable)
    shutil.copyfile(TRUST_ANCHOR, bundle / TRUST_ANCHOR_NAME)
    parser_probe = _run(executable, "--probe", cwd=output_dir)
    if parser_probe.get("backend") != "yajl2_c" or parser_probe.get("architecture") != "arm64":
        raise RuntimeError("SIDECAR_PARSER_PROBE_FAILED")

    input_manifest = _build_input_digests()
    anchor = load_anchor(TRUST_ANCHOR)
    source_revision = _git_bytes("rev-parse", "HEAD").decode().strip()
    if not refresh_trust_anchor:
        # The anchor is committed separately from the source revision that
        # produced the bundle.  This keeps a metadata-only anchor commit from
        # changing the sidecar's declared source revision.
        source_revision = str(anchor["sourceRevision"])
    trust_anchor_id = (
        f"stage3-macos-arm64-{source_revision[:12]}"
        if refresh_trust_anchor
        else anchor["anchorId"]
    )
    input_digests = {
        "dependencyLockDigest": input_manifest[LOCKFILE.relative_to(ROOT).as_posix()],
        "specDigest": input_manifest[SPECFILE.relative_to(ROOT).as_posix()],
        "productionEntrypointDigest": input_manifest[ENTRYPOINT.relative_to(ROOT).as_posix()],
        "fixtureSha256": input_manifest[FIXTURE.relative_to(ROOT).as_posix()],
    }
    evidence: dict[str, object] = {
        "evidenceVersion": EVIDENCE_VERSION,
        "buildMode": "onedir",
        "targetTriple": "macos-arm64",
        "pythonMajorMinor": f"{sys.version_info.major}.{sys.version_info.minor}",
        "pyinstallerVersion": _version("pyinstaller", "6.21.0"),
        "preprocessorVersion": "0.1.0",
        "ijsonVersion": _version("ijson", "3.5.1"),
        "nativeBackend": "ijson.backends.yajl2_c",
        "executableName": SIDECAR_NAME,
        "executableArchitecture": executable_architecture,
        "sourceRevision": source_revision,
        "trustAnchorId": trust_anchor_id,
        **input_digests,
        "buildInputDigest": source_input_digest(input_manifest),
        "network": "blocked-and-probed",
        "trustRoot": TRUST_ROOT,
    }

    synthetic = _run(executable, "--synthetic-cli", cwd=output_dir)
    if (
        synthetic.get("status") != "synthetic-cli-ready"
        or synthetic.get("backend") != "yajl2_c"
        or not isinstance(synthetic.get("rawMessageCount"), int)
        or synthetic.get("rawMessageCount", 0) < 1
        or not isinstance(synthetic.get("normalizedRecordCount"), int)
        or synthetic.get("normalizedRecordCount", 0) < 1
        or synthetic.get("schemaVersion") != "chat-history-analysis.manifest.v1"
    ):
        raise RuntimeError("SIDECAR_PRODUCTION_PROBE_FAILED")
    failure = _run(executable, "--synthetic-failure", cwd=output_dir)
    if failure != {
        "architecture": "arm64",
        "backend": "yajl2_c",
        "backendModule": "ijson.backends.yajl2_c",
        "failureClass": "SOURCE_VALIDATION_FAILED",
        "frozen": True,
        "pythonMajorMinor": "3.12",
        "status": "synthetic-cli-failure",
    }:
        raise RuntimeError("SIDECAR_FAILURE_PROBE_FAILED")
    different_cwd = _run(executable, "--synthetic-cli", cwd=output_dir.parent)
    if different_cwd.get("status") != "synthetic-cli-ready":
        raise RuntimeError("SIDECAR_CWD_PROBE_FAILED")
    offline = _run(executable, "--synthetic-cli", cwd=output_dir, network_blocked=True)
    if offline.get("status") != "synthetic-cli-ready":
        raise RuntimeError("SIDECAR_OFFLINE_PROBE_FAILED")

    members = _members(bundle)
    evidence["members"] = members
    evidence["bundleMerkleRoot"] = bundle_merkle_root(members)
    evidence["probeResults"] = {
        "parser": "passed",
        "productionSuccess": "passed",
        "productionFailure": "passed",
        "differentCwd": "passed",
        "offline": "passed",
    }
    evidence["evidenceDigest"] = evidence_digest(evidence)
    if refresh_trust_anchor:
        anchor = _refreshed_anchor(anchor, evidence)
    try:
        verify_evidence_against_anchor(anchor, evidence, members)
    except ValueError as error:
        raise RuntimeError(str(error)) from None
    if refresh_trust_anchor:
        _write_evidence(TRUST_ANCHOR, anchor)
        shutil.copyfile(TRUST_ANCHOR, bundle / TRUST_ANCHOR_NAME)
    _write_evidence(output_dir / EVIDENCE_NAME, evidence)
    _write_evidence(bundle / EVIDENCE_NAME, evidence)
    return output_dir / EVIDENCE_NAME


def main(argv: Iterable[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output-dir", required=True, type=Path)
    parser.add_argument(
        "--refresh-trust-anchor",
        action="store_true",
        help="bind the committed host anchor to this clean build",
    )
    arguments = parser.parse_args(argv)
    try:
        evidence = build(
            arguments.output_dir,
            refresh_trust_anchor=arguments.refresh_trust_anchor,
        )
    except RuntimeError as error:
        print(json.dumps({"code": str(error)}, sort_keys=True), file=sys.stderr)
        return 2
    print(json.dumps({"status": "ready", "evidence": evidence.name}, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
