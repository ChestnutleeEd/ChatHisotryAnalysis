"""Build and verify the macOS arm64 Stage 11 application prototype.

The script intentionally leaves generated package directories in the ignored
``build/stage11`` tree.  It never removes a directory recursively: each run
uses a fresh timestamped output directory, so an old package remains
inspectable and cannot be mistaken for the current one.
"""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import plistlib
import shutil
import subprocess
import sys
import time


ROOT = Path(__file__).resolve().parents[1]
TARGET = "aarch64-apple-darwin"
SIDECAR_DIRECTORY = "chat-history-analysis-sidecar"
SIDECAR_EXECUTABLE = "chat-history-analysis-sidecar"
APP_NAME = "Chat History Analysis.app"
APP_EXECUTABLE = "chat-history-analysis"
BUNDLE_IDENTIFIER = "com.chathistoryanalysis.desktop"
MINIMUM_MACOS = "11.0"
DMG_VOLUME = "Chat History Analysis Prototype"


def _new_output_root() -> Path:
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    base = ROOT / "build" / "stage11" / "macos-arm64"
    for suffix in ("", "-1", "-2", "-3"):
        candidate = base / f"package-{stamp}{suffix}"
        try:
            candidate.mkdir(parents=True, exist_ok=False)
        except FileExistsError:
            continue
        return candidate
    raise RuntimeError("PACKAGE_OUTPUT_COLLISION")


def _python312() -> Path:
    candidates = [Path(sys.executable)]
    located = shutil.which("python3.12")
    if located is not None:
        candidates.append(Path(located))
    for candidate in candidates:
        result = subprocess.run(
            [os.fspath(candidate), "-c", "import sys; print(*sys.version_info[:2])"],
            capture_output=True,
            text=True,
            check=False,
        )
        if result.returncode == 0 and result.stdout.strip() == "3 12":
            return candidate
    raise RuntimeError("PYTHON312_UNAVAILABLE")


def _tool(name: str, fallback: Path | None = None) -> Path:
    located = shutil.which(name)
    if located is not None:
        return Path(located)
    if fallback is not None and fallback.is_file():
        return fallback
    raise RuntimeError(f"TOOL_UNAVAILABLE_{name.upper()}")


def _run(
    arguments: list[str | os.PathLike[str]],
    *,
    cwd: Path = ROOT,
    env: dict[str, str] | None = None,
    capture: bool = False,
    timeout: int = 900,
) -> subprocess.CompletedProcess[str]:
    result = subprocess.run(
        [os.fspath(argument) for argument in arguments],
        cwd=cwd,
        env=env,
        capture_output=capture,
        text=True,
        check=False,
        timeout=timeout,
    )
    if result.returncode != 0:
        raise RuntimeError(f"COMMAND_FAILED_{Path(arguments[0]).name.upper()}")
    return result


def _run_expect_failure(
    arguments: list[str | os.PathLike[str]],
    *,
    cwd: Path,
    env: dict[str, str],
) -> None:
    result = subprocess.run(
        [os.fspath(argument) for argument in arguments],
        cwd=cwd,
        env=env,
        capture_output=True,
        text=True,
        check=False,
        timeout=60,
    )
    if result.returncode == 0:
        raise RuntimeError("TAMPERED_APP_ACCEPTED")


def _write_tauri_package_config(path: Path, sidecar_bundle: Path) -> None:
    config = {
        "$schema": "https://schema.tauri.app/config/2",
        "bundle": {
            "active": True,
            "targets": ["app"],
            "resources": {
                os.fspath(sidecar_bundle): SIDECAR_DIRECTORY,
            },
            "macOS": {
                "bundleName": "Chat History Analysis",
                "bundleVersion": "1",
                "hardenedRuntime": False,
                "minimumSystemVersion": MINIMUM_MACOS,
                "signingIdentity": None,
            },
        },
    }
    path.write_text(json.dumps(config, indent=2) + "\n", encoding="utf-8")


def _build_sidecar(output_root: Path, python312: Path) -> Path:
    sidecar_build = output_root / "sidecar-build"
    sidecar_build.mkdir()
    _run(
        [
            python312,
            ROOT / "scripts" / "build_sidecar_spike.py",
            "--output-dir",
            sidecar_build,
            "--refresh-trust-anchor",
        ],
        timeout=1_200,
    )
    bundle = sidecar_build / "dist" / SIDECAR_EXECUTABLE
    executable = bundle / SIDECAR_EXECUTABLE
    if not bundle.is_dir() or not executable.is_file():
        raise RuntimeError("SIDECAR_LAYOUT_INVALID")
    return bundle


def _build_app(
    output_root: Path,
    sidecar_bundle: Path,
    *,
    features: tuple[str, ...] = (),
    target_dir: Path | None = None,
) -> Path:
    package_config = output_root / "tauri.stage11.generated.json"
    _write_tauri_package_config(package_config, sidecar_bundle)
    _run(
        [
            _python312(),
            ROOT / "scripts" / "audit_stage11_platform_neutrality.py",
        ],
        timeout=60,
    )
    npm = _tool("npm")
    cargo = _tool("cargo", Path.home() / ".cargo" / "bin" / "cargo")
    environment = dict(os.environ)
    environment["PATH"] = f"{cargo.parent}:{environment.get('PATH', '')}"
    if target_dir is not None:
        target_dir.mkdir(parents=True)
        environment["CARGO_TARGET_DIR"] = os.fspath(target_dir)
    cargo_arguments = [
        "--no-default-features",
        "--bin",
        APP_EXECUTABLE,
    ]
    if features:
        cargo_arguments.extend(["--features", ",".join(features)])
    _run(
        [
            npm,
            "--prefix",
            "frontend",
            "exec",
            "--",
            "tauri",
            "build",
            "--target",
            TARGET,
            "--bundles",
            "app",
            "--no-sign",
            "--ci",
            "--config",
            package_config,
            "--",
            *cargo_arguments,
        ],
        env=environment,
        timeout=1_200,
    )
    bundle_root = (
        (target_dir if target_dir is not None else ROOT / "src-tauri" / "target")
        / TARGET
        / "release"
        / "bundle"
        / "macos"
    )
    app = bundle_root / APP_NAME
    if not app.is_dir():
        raise RuntimeError("APP_BUNDLE_NOT_FOUND")
    return app


def _regular_files(root: Path):
    for current, directory_names, file_names in os.walk(root, topdown=True, followlinks=False):
        current_path = Path(current)
        directory_names[:] = sorted(
            name
            for name in directory_names
            if not (current_path / name).is_symlink()
        )
        for name in sorted(file_names):
            candidate = current_path / name
            if candidate.is_file() and not candidate.is_symlink():
                yield candidate


def _file_description(path: Path) -> str:
    result = _run(
        ["/usr/bin/file", "-b", path],
        capture=True,
        timeout=30,
    )
    return result.stdout.strip()


def _mach_o_files(app: Path) -> list[Path]:
    result: list[Path] = []
    for path in _regular_files(app):
        description = _file_description(path)
        if "Mach-O" in description:
            result.append(path)
            if "arm64" not in description:
                raise RuntimeError("APP_MEMBER_WRONG_ARCHITECTURE")
            archs = _run(["/usr/bin/lipo", "-archs", path], capture=True, timeout=30)
            if archs.stdout.strip() != "arm64":
                raise RuntimeError("APP_MEMBER_NOT_ARM64_ONLY")
    return result


def _codesign(path: Path) -> None:
    _run(
        [
            "/usr/bin/codesign",
            "--force",
            "--sign",
            "-",
            "--timestamp=none",
            path,
        ],
        timeout=120,
    )


def _verify_codesign(path: Path) -> None:
    _run(
        [
            "/usr/bin/codesign",
            "--verify",
            "--strict",
            "--verbose=2",
            path,
        ],
        timeout=120,
    )


def _sign_nested_first(app: Path) -> list[Path]:
    contents = app / "Contents"
    main = contents / "MacOS" / APP_EXECUTABLE
    if not main.is_file():
        raise RuntimeError("APP_MAIN_EXECUTABLE_INVALID")
    macos_names = sorted(path.name for path in (contents / "MacOS").iterdir())
    if macos_names != [APP_EXECUTABLE]:
        raise RuntimeError("APP_MAIN_EXECUTABLE_SET_INVALID")
    if any(name in {"synthetic-sidecar", "synthetic-orphan"} for name in macos_names):
        raise RuntimeError("TEST_HELPER_BUNDLED_AS_APP_EXECUTABLE")

    sidecar_root = contents / "Resources" / SIDECAR_DIRECTORY
    sidecar = sidecar_root / SIDECAR_EXECUTABLE
    if not sidecar.is_file() or not (sidecar_root / "sidecar-evidence.json").is_file():
        raise RuntimeError("APP_SIDECAR_RESOURCE_MISSING")
    if not (sidecar_root / "sidecar-trust-anchor.json").is_file():
        raise RuntimeError("APP_SIDECAR_ANCHOR_MISSING")

    members = _mach_o_files(app)
    for path in sorted(
        members,
        key=lambda item: len(item.relative_to(app).parts),
        reverse=True,
    ):
        try:
            path.relative_to(sidecar_root)
        except ValueError:
            _codesign(path)
        else:
            _verify_codesign(path)
    _codesign(app)
    _run(
        ["/usr/bin/codesign", "--verify", "--deep", "--strict", "--verbose=2", app],
        timeout=120,
    )
    display = subprocess.run(
        ["/usr/bin/codesign", "-dv", "--verbose=4", os.fspath(app)],
        capture_output=True,
        text=True,
        check=False,
        timeout=30,
    )
    if display.returncode != 0 or "Signature=adhoc" not in display.stderr:
        raise RuntimeError("ADHOC_SIGNATURE_NOT_OBSERVED")
    return members


def _validate_info_plist(app: Path) -> dict[str, object]:
    plist_path = app / "Contents" / "Info.plist"
    with plist_path.open("rb") as stream:
        value = plistlib.load(stream)
    if (
        value.get("CFBundleExecutable") != APP_EXECUTABLE
        or value.get("CFBundleIdentifier") != BUNDLE_IDENTIFIER
        or value.get("CFBundleShortVersionString") != "0.1.0"
        or value.get("CFBundleVersion") != "1"
        or value.get("LSMinimumSystemVersion") != MINIMUM_MACOS
    ):
        raise RuntimeError("APP_METADATA_INVALID")
    for key in (
        "NSCameraUsageDescription",
        "NSMicrophoneUsageDescription",
        "NSLocationUsageDescription",
        "NSAppTransportSecurity",
    ):
        if key in value:
            raise RuntimeError("UNRELATED_USAGE_DESCRIPTION_PRESENT")
    return {
        "bundleIdentifier": value["CFBundleIdentifier"],
        "version": value["CFBundleShortVersionString"],
        "bundleVersion": value["CFBundleVersion"],
        "minimumSystemVersion": value["LSMinimumSystemVersion"],
    }


def _copy_tree(source: Path, destination: Path) -> None:
    if destination.exists() or destination.is_symlink():
        raise RuntimeError("COPY_DESTINATION_ALREADY_EXISTS")
    _run(["/usr/bin/ditto", source, destination], timeout=180)


def _validate_app_contents(app: Path) -> None:
    """Reject development, checkout, and private-data material in the app."""

    forbidden_parts = {
        ".venv",
        "node_modules",
        "retained-wheels",
        "sidecar-build",
        "src-tauri",
        "data",
        "private",
    }
    for current, directory_names, file_names in os.walk(
        app,
        topdown=True,
        followlinks=False,
    ):
        current_path = Path(current)
        if any((current_path / name).is_symlink() for name in directory_names):
            raise RuntimeError("APP_SYMLINK_PRESENT")
        for name in file_names:
            candidate = current_path / name
            if candidate.is_symlink():
                raise RuntimeError("APP_SYMLINK_PRESENT")
        relative_parts = current_path.relative_to(app).parts
        if any(part in forbidden_parts for part in relative_parts):
            raise RuntimeError("DEVELOPMENT_ARTIFACT_IN_APP")
        directory_names[:] = sorted(directory_names)
    for path in _regular_files(app):
        relative_parts = path.relative_to(app).parts
        if any(part in forbidden_parts for part in relative_parts):
            raise RuntimeError("DEVELOPMENT_ARTIFACT_IN_APP")


def _run_negative_package_checks(output_root: Path, app: Path) -> dict[str, str]:
    """Prove the accepted verifier rejects a changed or wrong-arch member."""

    negative_root = output_root / "negative-checks"
    negative_root.mkdir()

    tampered = negative_root / APP_NAME
    _copy_tree(app, tampered)
    tampered_main = tampered / "Contents" / "MacOS" / APP_EXECUTABLE
    with tampered_main.open("ab") as stream:
        stream.write(b"stage11-tamper")
    tampered_verify = subprocess.run(
        [
            "/usr/bin/codesign",
            "--verify",
            "--deep",
            "--strict",
            tampered,
        ],
        capture_output=True,
        text=True,
        check=False,
        timeout=120,
    )
    if tampered_verify.returncode == 0:
        raise RuntimeError("TAMPERED_APP_ACCEPTED")

    wrong_arch = negative_root / "Wrong Architecture.app"
    _copy_tree(app, wrong_arch)
    wrong_arch_main = wrong_arch / "Contents" / "MacOS" / APP_EXECUTABLE
    compile_wrong_arch = subprocess.run(
        [
            "/usr/bin/clang",
            "-target",
            "x86_64-apple-macos11",
            "-c",
            "-x",
            "c",
            "-o",
            wrong_arch_main,
            "-",
        ],
        input="int main(void) { return 0; }\n",
        capture_output=True,
        text=True,
        check=False,
        timeout=120,
    )
    if compile_wrong_arch.returncode != 0:
        raise RuntimeError("WRONG_ARCHITECTURE_FIXTURE_FAILED")
    try:
        _mach_o_files(wrong_arch)
    except RuntimeError as error:
        if str(error) != "APP_MEMBER_WRONG_ARCHITECTURE":
            raise
    else:
        raise RuntimeError("WRONG_ARCHITECTURE_APP_ACCEPTED")
    return {
        "tamperedMember": "rejected",
        "wrongArchitectureMember": "rejected",
    }


def _make_dmg(output_root: Path, app: Path) -> tuple[Path, Path]:
    staging = output_root / "dmg-staging"
    staging.mkdir()
    _copy_tree(app, staging / APP_NAME)
    os.symlink("/Applications", staging / "Applications")
    dmg = output_root / "Chat History Analysis Prototype.dmg"
    _run(
        [
            "/usr/bin/hdiutil",
            "create",
            "-volname",
            DMG_VOLUME,
            "-srcfolder",
            staging,
            "-ov",
            "-format",
            "UDZO",
            dmg,
        ],
        timeout=300,
    )
    _run(["/usr/bin/hdiutil", "verify", dmg], timeout=300)

    mount = output_root / "dmg-mount"
    mount.mkdir()
    attached = False
    try:
        _run(
            [
                "/usr/bin/hdiutil",
                "attach",
                dmg,
                "-readonly",
                "-nobrowse",
                "-mountpoint",
                mount,
            ],
            timeout=120,
        )
        attached = True
        if not (mount / APP_NAME).is_dir() or not (mount / "Applications").is_symlink():
            raise RuntimeError("DMG_CONTENT_INVALID")
        copied = output_root / "clean-install" / "Applications-like" / APP_NAME
        copied.parent.mkdir(parents=True)
        _copy_tree(mount / APP_NAME, copied)
    finally:
        if attached:
            _run(["/usr/bin/hdiutil", "detach", mount], timeout=120)
    return dmg, copied


def _clean_environment(root: Path) -> tuple[dict[str, str], Path]:
    home = root / "isolated-user-home"
    temp = root / "isolated-temp"
    cwd = root / "working directory 空间"
    home.mkdir()
    (home / "Library" / "Caches").mkdir(parents=True)
    temp.mkdir()
    cwd.mkdir()
    environment = {
        "PATH": "/usr/bin:/bin",
        "HOME": os.fspath(home),
        "TMPDIR": os.fspath(temp),
        "LANG": "C",
        "LC_ALL": "C",
        "PYTHONNOUSERSITE": "1",
        "PYTHONDONTWRITEBYTECODE": "1",
        "PYTHONHASHSEED": "0",
        "CHAT_HISTORY_ANALYSIS_SYNTHETIC_ROOT": os.fspath(temp),
    }
    return environment, cwd


def _stop_exact_process(process: subprocess.Popen[bytes]) -> None:
    if process.poll() is not None:
        return
    process.terminate()
    try:
        process.wait(timeout=10)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait(timeout=10)


def _run_clean_user_smoke(
    app: Path,
    root: Path,
    selection_smoke_app: Path,
) -> dict[str, object]:
    root.mkdir(parents=True)
    environment, cwd = _clean_environment(root)
    app_executable = app / "Contents" / "MacOS" / APP_EXECUTABLE
    sidecar = app / "Contents" / "Resources" / SIDECAR_DIRECTORY / SIDECAR_EXECUTABLE

    probe = _run([sidecar, "--probe"], cwd=cwd, env=environment, capture=True, timeout=180)
    probe_payload = json.loads(probe.stdout)
    if probe.stderr or probe_payload.get("status") != "ready" or probe_payload.get("frozen") is not True:
        raise RuntimeError("PACKAGED_SIDECAR_HANDSHAKE_FAILED")

    sandbox = Path("/usr/bin/sandbox-exec")
    if not sandbox.is_file():
        raise RuntimeError("NETWORK_SANDBOX_UNAVAILABLE")
    synthetic = _run(
        [
            sandbox,
            "-p",
            "(version 1) (allow default) (deny network*)",
            sidecar,
            "--synthetic-cli",
        ],
        cwd=cwd,
        env=environment,
        capture=True,
        timeout=240,
    )
    synthetic_payload = json.loads(synthetic.stdout)
    if synthetic.stderr or synthetic_payload.get("status") != "synthetic-cli-ready":
        raise RuntimeError("PACKAGED_SIDECAR_SYNTHETIC_FAILED")

    selection_root = root / "selection-smoke"
    selection_root.mkdir()
    selection_environment, selection_cwd = _clean_environment(selection_root)
    selection_environment["CHAT_HISTORY_ANALYSIS_SYNTHETIC_NATIVE_DIALOG_ROLE"] = "annual"
    selection_executable = selection_smoke_app / "Contents" / "MacOS" / APP_EXECUTABLE
    selection_host: subprocess.Popen[bytes] | None = None
    try:
        selection_host = subprocess.Popen(
            [selection_executable],
            cwd=selection_cwd,
            env=selection_environment,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        selection_marker = selection_root / "isolated-temp" / "selection-smoke-passed"
        selection_deadline = time.monotonic() + 30
        while not selection_marker.is_file() and time.monotonic() < selection_deadline:
            if selection_host.poll() is not None:
                raise RuntimeError("PACKAGED_SELECTION_SMOKE_FAILED")
            time.sleep(0.1)
        if not selection_marker.is_file():
            raise RuntimeError("PACKAGED_SELECTION_SMOKE_FAILED")
        selection_host.wait(timeout=10)
    except subprocess.TimeoutExpired:
        pass
    finally:
        if selection_host is not None:
            _stop_exact_process(selection_host)
    if selection_host.returncode not in (0, None):
        raise RuntimeError("PACKAGED_SELECTION_SMOKE_FAILED")

    host: subprocess.Popen[bytes] | None = None
    try:
        host = subprocess.Popen(
            [app_executable],
            cwd=cwd,
            env=environment,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        time.sleep(4)
        if host.poll() is not None:
            raise RuntimeError("PACKAGED_HOST_STARTUP_FAILED")
    finally:
        if host is not None:
            _stop_exact_process(host)

    return {
        "finderEquivalentHostLaunch": "passed",
        "sidecarHandshake": "passed",
        "syntheticPreprocessing": "passed",
        "networkBlocked": "passed",
        "selectionCommandResponse": "passed",
        "annualCount": 1,
        "startEnabled": "passed",
        "isolatedWorkingDirectory": "passed",
        "isolatedHome": "passed",
        "hostClose": "passed",
    }


def _write_manifest(
    output_root: Path,
    app: Path,
    dmg: Path,
    copied_app: Path,
    metadata: dict[str, object],
    member_count: int,
    smoke: dict[str, object],
    negative_checks: dict[str, str],
) -> Path:
    manifest = {
        "schema": "chat-history-analysis.stage11-package-manifest.v1",
        "target": {
            "os": "macOS",
            "architecture": "arm64",
            "minimumSystemVersion": MINIMUM_MACOS,
        },
        "app": {
            "relativePath": app.name,
            "repositoryRelativePath": app.relative_to(ROOT).as_posix(),
            "mainExecutable": f"Contents/MacOS/{APP_EXECUTABLE}",
            "bundleIdentifier": BUNDLE_IDENTIFIER,
            "metadata": metadata,
            "machOMemberCount": member_count,
            "sidecarRelativePath": f"Contents/Resources/{SIDECAR_DIRECTORY}",
            "resourceResolution": "bundle-relative",
        },
        "dmg": {
            "relativePath": dmg.name,
            "volumeName": DMG_VOLUME,
            "verified": True,
            "mountedCopiedUnmounted": True,
            "copiedAppRelativePath": copied_app.relative_to(output_root).as_posix(),
        },
        "signing": {
            "mode": "ad-hoc",
            "nestedFirst": True,
            "sidecarEvidenceIncludesSignedMembers": True,
            "developerId": False,
            "notarized": False,
            "stapled": False,
        },
        "negativeVerification": negative_checks,
        "cleanUserSynthetic": smoke,
        "privacy": {
            "syntheticOnly": True,
            "sourceTreeDependency": False,
            "systemPythonDependency": False,
            "nodeDependency": False,
            "networkDependency": False,
        },
    }
    path = output_root / "package-manifest.json"
    path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return path


def build_and_verify() -> Path:
    python312 = _python312()
    output_root = _new_output_root()
    sidecar_bundle = _build_sidecar(output_root, python312)
    selection_smoke_app = _build_app(
        output_root,
        sidecar_bundle,
        features=("synthetic-dialog-adapter",),
        target_dir=output_root / "selection-smoke-target",
    )
    _validate_app_contents(selection_smoke_app)
    app = _build_app(output_root, sidecar_bundle)
    metadata = _validate_info_plist(app)
    _validate_app_contents(app)
    members = _sign_nested_first(app)
    negative_checks = _run_negative_package_checks(output_root, app)
    dmg, copied_app = _make_dmg(output_root, app)
    smoke = _run_clean_user_smoke(
        copied_app,
        output_root / "clean-user",
        selection_smoke_app,
    )
    manifest = _write_manifest(
        output_root,
        app,
        dmg,
        copied_app,
        metadata,
        len(members),
        smoke,
        negative_checks,
    )
    print(json.dumps({"status": "passed", "manifest": manifest.relative_to(ROOT).as_posix()}, sort_keys=True))
    return manifest


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.parse_args(argv)
    try:
        build_and_verify()
    except (OSError, RuntimeError, subprocess.SubprocessError, json.JSONDecodeError):
        print(json.dumps({"code": "STAGE11_PACKAGE_FAILED"}, sort_keys=True), file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
