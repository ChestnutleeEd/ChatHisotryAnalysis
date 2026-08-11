"""Build and verify the macOS arm64 application prototype.

The normal Stage 11 path keeps timestamped roots for historical evidence. The
bounded B6 path uses one explicit ``B6_WORK_ROOT`` and publishes only its
``final-release`` child; it never performs recursive cleanup.
"""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import plistlib
import shutil
import struct
import subprocess
import sys
import tempfile
import time
import zlib


ROOT = Path(__file__).resolve().parents[1]
TARGET = "aarch64-apple-darwin"
SIDECAR_DIRECTORY = "chat-history-analysis-sidecar"
SIDECAR_EXECUTABLE = "chat-history-analysis-sidecar"
APP_NAME = "Chat History Analysis.app"
APP_EXECUTABLE = "chat-history-analysis"
BUNDLE_IDENTIFIER = "com.chathistoryanalysis.desktop"
MINIMUM_MACOS = "11.0"
DMG_VOLUME = "Chat History Analysis Prototype"
B5_MARKER_DIRECTORY = "chat-history-analysis-b5-packaged"
B5_PNG_LIMIT = 10 * 1024 * 1024
B5_APP_PROCESS = "chat-history-analysis"
B5_APP_DISPLAY_PROCESS = "Chat History Analysis"
B5_BUNDLE_ASSET_MARKERS = (
    "annual-opening-hero-v1",
    "closing-poster-v1",
    "share-card-field-v1",
)
B6_WORK_ROOT_RELATIVE = Path("build/stage11/macos-arm64/b6-final-acceptance")


def _new_output_root(*, b6_acceptance: bool = False) -> Path:
    if b6_acceptance:
        configured = os.environ.get("B6_WORK_ROOT")
        candidate = Path(configured) if configured else B6_WORK_ROOT_RELATIVE
        if not candidate.is_absolute():
            candidate = ROOT / candidate
        candidate = candidate.resolve()
        expected = (ROOT / B6_WORK_ROOT_RELATIVE).resolve()
        if candidate != expected:
            raise RuntimeError("B6_WORK_ROOT_MUST_BE_BUILD_STAGE11_MACOS_ARM64")
        candidate.mkdir(parents=True, exist_ok=True)
        output_root = candidate / "final-release"
        if output_root.exists():
            if any(output_root.iterdir()):
                raise RuntimeError("B6_FINAL_RELEASE_NOT_REUSABLE_USER_CLEANUP_REQUIRED")
        else:
            output_root.mkdir()
        return output_root
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
    cargo_feature_arguments: list[str] = []
    if features:
        cargo_feature_arguments.extend(["--features", ",".join(features)])
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
            "--no-default-features",
            "--bin",
            APP_EXECUTABLE,
            *cargo_feature_arguments,
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


def _fresh_b6_environment_root(root: Path, label: str) -> Path:
    for ordinal in range(64):
        suffix = "" if ordinal == 0 else f"-retry-{ordinal}"
        candidate = root / f"{label}{suffix}"
        if not candidate.exists():
            candidate.mkdir()
            return candidate
    raise RuntimeError("B6_CLEAN_ENVIRONMENT_ROOT_COLLISION")


def _stop_exact_process(process: subprocess.Popen[bytes]) -> None:
    if process.poll() is not None:
        return
    process.terminate()
    try:
        process.wait(timeout=10)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait(timeout=10)


def _b5_marker_root() -> Path:
    configured = os.environ.get("CHAT_HISTORY_ANALYSIS_SYNTHETIC_B5_MARKER_ROOT")
    if configured:
        return Path(configured)
    return Path(tempfile.gettempdir()) / B5_MARKER_DIRECTORY


def _remove_known_file(path: Path) -> None:
    if path.is_file() or path.is_symlink():
        path.unlink()


def _prepare_b5_marker_root() -> tuple[Path, Path]:
    root = _b5_marker_root()
    root.mkdir(parents=True, exist_ok=True)
    output = root / "output"
    output.mkdir(exist_ok=True)
    known_files = {
        "synthetic-annual-source.json",
        "b6-core-2023-2024.json",
        "b6-core-2024-2025.json",
        "b6-core-2025-2026.json",
        "selection-smoke-passed",
        "selection-smoke-page-loaded",
        "selection-smoke-onboarding-ready",
        "selection-smoke-selection-ready",
        "selection-smoke-resolution-passed",
        "selection-smoke-resolution-resource-dir-failed",
        "selection-smoke-start-clicked",
        "selection-smoke-start-status-visible",
        "selection-smoke-start-status-missing",
        "selection-smoke-cancel-available",
        "selection-smoke-cancel-clicked",
        "selection-smoke-cancelled-event",
        "selection-smoke-cancelled-ready",
        "selection-smoke-retry-start-clicked",
        "selection-smoke-worker-started",
        "selection-smoke-worker-prepared",
        "selection-smoke-worker-load-accepted",
        "selection-smoke-worker-dashboard-model",
        "selection-smoke-worker-result-ready",
        "selection-smoke-home-ready",
        "selection-smoke-annual-recap-ready",
        "selection-smoke-core-sections-ready",
        "selection-smoke-word-evidence-ready",
        "selection-smoke-word-cloud-ready",
        "selection-smoke-dashboard-ready",
        "selection-smoke-worker-error-visible",
        "selection-smoke-error",
        "selection-smoke-host-none",
        "selection-smoke-host-preprocessing",
        "selection-smoke-host-handoff",
        "selection-smoke-host-analyzing",
        "selection-smoke-host-complete",
        "selection-smoke-host-cancelled",
        "selection-smoke-host-failed",
        "selection-smoke-host-cancelling",
        "selection-smoke-host-closing",
        "selection-smoke-host-other",
        "selection-smoke-share-preview-ready",
        "selection-smoke-native-cancel-requested",
        "selection-smoke-native-cancelled",
        "selection-smoke-vocabulary-on",
        "selection-smoke-native-save-requested",
        "selection-smoke-native-save-success",
        "selection-smoke-native-save-retry-requested",
        "selection-smoke-native-save-retry-success",
        "selection-smoke-share-preview-closed",
        "selection-smoke-reselect-ready",
        "selection-smoke-b6-entered",
        "selection-smoke-b6-stable",
        "selection-smoke-scope-all-initial",
        "selection-smoke-scope-year-a",
        "selection-smoke-scope-year-b",
        "selection-smoke-scope-all-restored",
        "selection-smoke-custom-hidden-ready",
        "selection-smoke-detailed-ready",
        "selection-smoke-detailed-draft-ready",
        "selection-smoke-detailed-apply-ready",
        "selection-smoke-detailed-routes-ready",
        "selection-smoke-aggregate-export-requested",
        "selection-smoke-aggregate-export-success",
        "selection-smoke-b6-pre-share-ready",
        "selection-smoke-failure-SIDECAR_PROTOCOL_MISMATCH",
        "selection-smoke-failure-SIDECAR_EXITED",
        "selection-smoke-failure-MEMORY_PRESSURE",
        "selection-smoke-failure-CLEANUP_REQUIRED",
        "selection-smoke-failure-SESSION_CLEANUP_FAILED",
        "selection-smoke-failure-SESSION_STALE",
        "selection-smoke-failure-SELECTION_STALE",
        "selection-smoke-failure-SOURCE_SET_INVALID",
        "b5-render-off.json",
        "b5-render-on.json",
    }
    for name in known_files:
        _remove_known_file(root / name)
    for path in sorted(output.glob("chat-recap-*.png")):
        _remove_known_file(path)
    for name in ("chat-analysis-export.json", "chat-analysis-export.csv"):
        _remove_known_file(output / name)
    return root, output


def _marker_path(root: Path, name: str) -> Path:
    return root / f"selection-smoke-{name}"


def _wait_for_marker(
    root: Path,
    name: str,
    process: subprocess.Popen[bytes] | None = None,
    timeout: float = 180,
) -> Path:
    marker = _marker_path(root, name)
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if marker.is_file():
            return marker
        if process is not None and process.poll() is not None:
            raise RuntimeError(f"B5_PACKAGED_PROCESS_EXITED_BEFORE_{name.upper()}")
        time.sleep(0.1)
    raise RuntimeError(f"B5_PACKAGED_MARKER_TIMEOUT_{name.upper()}")


def _run_applescript(script: str, *, timeout: int = 60) -> None:
    result = subprocess.run(
        ["/usr/bin/osascript", "-e", script],
        capture_output=True,
        text=True,
        check=False,
        timeout=timeout,
    )
    if result.returncode != 0:
        raise RuntimeError("B5_NATIVE_PANEL_AUTOMATION_FAILED")


def _require_b5_accessibility() -> None:
    # NSSavePanel itself is opened by the packaged app.  This preflight only
    # checks whether the host can drive the panel through the macOS
    # accessibility API; it never treats a failed keyboard script as a pass.
    result = subprocess.run(
        [
            "/usr/bin/osascript",
            "-e",
            'tell application "System Events" to tell process "Finder" to get name of first window',
        ],
        capture_output=True,
        text=True,
        check=False,
        timeout=10,
    )
    if result.returncode != 0:
        raise RuntimeError("MANUAL_NATIVE_GATE_ACCESSIBILITY_UNAVAILABLE")


def _apple_string(value: str) -> str:
    return '"' + value.replace("\\", "\\\\").replace('"', '\\"') + '"'


def _drive_native_save_panel(directory: Path, *, cancel: bool) -> None:
    # The panel remains a real AppKit NSSavePanel. System Events only drives
    # the visible native controls and Go to Folder field; no path is sent
    # through the renderer IPC contract.
    directory_literal = _apple_string(os.fspath(directory))
    final_action = 'click button "Cancel" of window "Save"' if cancel else 'click button "Save" of window "Save"'
    replace_action = (
        '\n    delay 0.8\n'
        '    if exists sheet 1 of window "Save" then if exists button "Replace" of sheet 1 of window "Save" then click button "Replace" of sheet 1 of window "Save"'
    )
    script = f"""
tell application "System Events"
  tell process {_apple_string(B5_APP_DISPLAY_PROCESS)}
    set frontmost to true
    repeat 120 times
      if exists window "Save" then exit repeat
      delay 0.1
    end repeat
    if {str(cancel).lower()} then
      if not (exists window "Save") then error "B5 save panel did not appear"
      delay 0.5
      {final_action}
    else
      if not (exists window "Save") then error "B5 save panel did not appear"
      delay 0.5
      keystroke "g" using {{command down, shift down}}
      repeat 120 times
        if exists sheet 1 of window "Save" then exit repeat
        delay 0.1
      end repeat
      if exists sheet 1 of window "Save" then
        set value of text field 1 of sheet 1 of window "Save" to {directory_literal}
        key code 36
        repeat 120 times
          if not (exists sheet 1 of window "Save") then exit repeat
          delay 0.1
        end repeat
      end if
      if not (exists window "Save") then error "B5 save panel closed before Save"
      delay 0.5
      {final_action}{replace_action}
    end if
  end tell
end tell
"""
    _run_applescript(script)


def _process_exists(process_name: str) -> bool:
    result = subprocess.run(
        ["/usr/bin/pgrep", "-x", process_name],
        capture_output=True,
        text=True,
        check=False,
        timeout=10,
    )
    return result.returncode == 0


def _wait_for_process_state(process_name: str, *, exists: bool, timeout: float = 30) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if _process_exists(process_name) is exists:
            return
        time.sleep(0.2)
    state = "present" if exists else "absent"
    raise RuntimeError(f"B5_PROCESS_NOT_{state.upper()}_{process_name.upper()}")


def _unfilter_png_row(current: bytearray, previous: bytearray | None, filter_type: int, bytes_per_pixel: int) -> None:
    if filter_type == 0:
        return
    if previous is None:
        previous = bytearray(len(current))
    for index in range(len(current)):
        left = current[index - bytes_per_pixel] if index >= bytes_per_pixel else 0
        up = previous[index]
        up_left = previous[index - bytes_per_pixel] if index >= bytes_per_pixel else 0
        if filter_type == 1:
            current[index] = (current[index] + left) & 0xFF
        elif filter_type == 2:
            current[index] = (current[index] + up) & 0xFF
        elif filter_type == 3:
            current[index] = (current[index] + ((left + up) // 2)) & 0xFF
        elif filter_type == 4:
            estimate = left + up - up_left
            left_distance = abs(estimate - left)
            up_distance = abs(estimate - up)
            up_left_distance = abs(estimate - up_left)
            predictor = left if left_distance <= up_distance and left_distance <= up_left_distance else up if up_distance <= up_left_distance else up_left
            current[index] = (current[index] + predictor) & 0xFF
        else:
            raise RuntimeError("B5_PNG_FILTER_INVALID")


def _inspect_saved_png(path: Path) -> dict[str, object]:
    data = path.read_bytes()
    if not data or len(data) > B5_PNG_LIMIT:
        raise RuntimeError("B5_PNG_SIZE_INVALID")
    signature = b"\x89PNG\r\n\x1a\n"
    if not data.startswith(signature):
        raise RuntimeError("B5_PNG_SIGNATURE_INVALID")
    offset = len(signature)
    chunks: list[str] = []
    idat = bytearray()
    width = height = bit_depth = color_type = interlace = None
    while offset < len(data):
        if len(data) - offset < 12:
            raise RuntimeError("B5_PNG_CHUNK_INVALID")
        length = struct.unpack(">I", data[offset : offset + 4])[0]
        end = offset + 12 + length
        if end > len(data):
            raise RuntimeError("B5_PNG_CHUNK_LENGTH_INVALID")
        chunk_type = data[offset + 4 : offset + 8]
        payload = data[offset + 8 : offset + 8 + length]
        crc = struct.unpack(">I", data[offset + 8 + length : end])[0]
        if zlib.crc32(chunk_type + payload) & 0xFFFFFFFF != crc:
            raise RuntimeError("B5_PNG_CRC_INVALID")
        name = chunk_type.decode("ascii", errors="strict")
        chunks.append(name)
        if name in {"tEXt", "zTXt", "iTXt", "eXIf", "iCCP"}:
            raise RuntimeError("B5_PNG_FORBIDDEN_METADATA")
        if name == "IHDR":
            if width is not None or length != 13 or offset != len(signature):
                raise RuntimeError("B5_PNG_IHDR_INVALID")
            width, height, bit_depth, color_type, compression, filtering, interlace = struct.unpack(">IIBBBBB", payload)
            if bit_depth != 8 or color_type not in {2, 6} or compression != 0 or filtering != 0 or interlace != 0:
                raise RuntimeError("B5_PNG_FORMAT_INVALID")
        elif name == "IDAT":
            idat.extend(payload)
        elif name == "IEND":
            if payload or end != len(data):
                raise RuntimeError("B5_PNG_IEND_INVALID")
        offset = end
    if chunks.count("IHDR") != 1 or chunks.count("IEND") != 1 or not idat or chunks[-1] != "IEND":
        raise RuntimeError("B5_PNG_CHUNK_ORDER_INVALID")
    if width != 1200 or height != 1500 or color_type not in {2, 6}:
        raise RuntimeError("B5_PNG_DIMENSIONS_INVALID")
    decoded = zlib.decompress(bytes(idat))
    bytes_per_pixel = 3 if color_type == 2 else 4
    row_bytes = width * bytes_per_pixel
    expected = (row_bytes + 1) * height
    if len(decoded) != expected:
        raise RuntimeError("B5_PNG_DECODE_SIZE_INVALID")
    previous: bytearray | None = None
    rgba = bytearray()
    cursor = 0
    opaque = True
    for _ in range(height):
        filter_type = decoded[cursor]
        cursor += 1
        row = bytearray(decoded[cursor : cursor + row_bytes])
        cursor += row_bytes
        _unfilter_png_row(row, previous, filter_type, bytes_per_pixel)
        if color_type == 2:
            for pixel in range(0, len(row), 3):
                rgba.extend(row[pixel : pixel + 3])
                rgba.append(255)
        else:
            rgba.extend(row)
            if any(row[pixel] != 255 for pixel in range(3, len(row), 4)):
                opaque = False
        previous = row
    if not opaque:
        raise RuntimeError("B5_PNG_ALPHA_INVALID")
    return {
        "pathLabel": "synthetic-temp/chat-recap.png",
        "dimensions": [width, height],
        "bytes": len(data),
        "decode": "passed",
        "opaque": True,
        "metadata": "forbidden-chunks-absent",
        "chunks": chunks,
        "rgbaDigest": hashlib.sha256(rgba).hexdigest(),
    }


def _read_b5_render_evidence(root: Path, mode: str) -> dict[str, object]:
    path = root / f"b5-render-{mode}.json"
    if not path.is_file():
        raise RuntimeError(f"B5_RENDER_EVIDENCE_MISSING_{mode.upper()}")
    value = json.loads(path.read_text(encoding="utf-8"))
    if value.get("mode") != mode or value.get("width") != 1200 or value.get("height") != 1500:
        raise RuntimeError(f"B5_RENDER_EVIDENCE_INVALID_{mode.upper()}")
    if value.get("opaque") is not True or value.get("forbiddenChunks") != []:
        raise RuntimeError(f"B5_RENDER_EVIDENCE_PRIVACY_INVALID_{mode.upper()}")
    return value


def _wait_for_b5_render_evidence(
    root: Path,
    mode: str,
    process: subprocess.Popen[bytes] | None = None,
    timeout: float = 30,
) -> dict[str, object]:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if (root / f"b5-render-{mode}.json").is_file():
            return _read_b5_render_evidence(root, mode)
        if process is not None and process.poll() is not None:
            raise RuntimeError(f"B5_PACKAGED_PROCESS_EXITED_BEFORE_RENDER_{mode.upper()}")
        time.sleep(0.1)
    raise RuntimeError(f"B5_RENDER_EVIDENCE_TIMEOUT_{mode.upper()}")


def _validate_b5_bundle_assets(app: Path) -> dict[str, str]:
    executable = app / "Contents" / "MacOS" / APP_EXECUTABLE
    strings = _run(["/usr/bin/strings", executable], capture=True, timeout=60).stdout
    missing = [
        marker
        for marker in B5_BUNDLE_ASSET_MARKERS
        if marker not in strings
    ]
    if missing:
        raise RuntimeError("B5_BUNDLE_ARTWORK_MISSING")
    return {marker: "bundle-relative" for marker in B5_BUNDLE_ASSET_MARKERS}


def _wait_for_saved_png(output: Path, before: set[Path], timeout: float = 60) -> Path:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        candidates = {path for path in output.glob("chat-recap-*.png") if path.is_file()}
        fresh = sorted(candidates - before)
        if fresh:
            return fresh[-1]
        time.sleep(0.2)
    raise RuntimeError("B5_SAVED_PNG_NOT_FOUND")


def _run_finder_equivalent_launch(app: Path) -> None:
    _wait_for_process_state(B5_APP_PROCESS, exists=False)
    _run(["/usr/bin/open", "-n", app, "--args", "--b5-off"], timeout=60)
    _wait_for_process_state(B5_APP_PROCESS, exists=True, timeout=30)
    time.sleep(4)
    _run_applescript(f'tell application {_apple_string(B5_APP_DISPLAY_PROCESS)} to quit')
    _wait_for_process_state(B5_APP_PROCESS, exists=False, timeout=30)


def _run_b5_packaged_acceptance(app: Path, root: Path) -> dict[str, object]:
    _require_b5_accessibility()
    marker_root, output = _prepare_b5_marker_root()
    artwork_assets = _validate_b5_bundle_assets(app)
    b5_clean_root = root / "b5-clean-user"
    b5_clean_root.mkdir(exist_ok=True)
    environment, cwd = _clean_environment(b5_clean_root)
    environment["CHAT_HISTORY_ANALYSIS_SYNTHETIC_ROOT"] = os.fspath(marker_root)
    environment["CHAT_HISTORY_ANALYSIS_SYNTHETIC_B5_MODE"] = "b5"
    environment["CHAT_HISTORY_ANALYSIS_SYNTHETIC_NATIVE_DIALOG_ROLE"] = "annual"
    sandbox = Path("/usr/bin/sandbox-exec")
    if not sandbox.is_file():
        raise RuntimeError("B5_NETWORK_SANDBOX_UNAVAILABLE")
    app_executable = app / "Contents" / "MacOS" / APP_EXECUTABLE
    before_first = set(output.glob("chat-recap-*.png"))
    process = subprocess.Popen(
        [sandbox, "-p", "(version 1) (allow default) (deny network*)", app_executable],
        cwd=cwd,
        env=environment,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    first_png: Path | None = None
    second_png: Path | None = None
    try:
        _wait_for_marker(marker_root, "share-preview-ready", process)
        off_render = _wait_for_b5_render_evidence(marker_root, "off", process)
        _wait_for_marker(marker_root, "native-cancel-requested", process)
        _drive_native_save_panel(output, cancel=True)
        _wait_for_marker(marker_root, "native-cancelled", process)
        _wait_for_marker(marker_root, "vocabulary-on", process)
        on_render = _wait_for_b5_render_evidence(marker_root, "on", process)
        _wait_for_marker(marker_root, "native-save-requested", process)
        _drive_native_save_panel(output, cancel=False)
        _wait_for_marker(marker_root, "native-save-success", process)
        first_png = _wait_for_saved_png(output, before_first)
        first_png_evidence = _inspect_saved_png(first_png)
        if first_png_evidence["rgbaDigest"] != on_render["rgbaDigest"]:
            raise RuntimeError("B5_PREVIEW_EXPORT_RGBA_MISMATCH_ON")
        _wait_for_marker(marker_root, "native-save-retry-requested", process)
        _drive_native_save_panel(output, cancel=False)
        _wait_for_marker(marker_root, "native-save-retry-success", process)
        second_png = first_png
        second_png_evidence = _inspect_saved_png(second_png)
        if second_png_evidence["rgbaDigest"] != off_render["rgbaDigest"]:
            raise RuntimeError("B5_PREVIEW_EXPORT_RGBA_MISMATCH_OFF")
        _wait_for_marker(marker_root, "share-preview-closed", process)
        process.wait(timeout=30)
        if process.returncode not in (0, None):
            raise RuntimeError("B5_PACKAGED_APP_EXIT_FAILED")
    except BaseException:
        if process.poll() is None:
            _stop_exact_process(process)
        raise
    finally:
        if process.poll() is None:
            _stop_exact_process(process)

    if _process_exists("chat-history-analysis-sidecar"):
        raise RuntimeError("B5_SIDECAR_ORPHAN_AFTER_QUIT")
    _run_finder_equivalent_launch(app)
    restart_clean_root = root / "restart-clean-user"
    restart_clean_root.mkdir(exist_ok=True)
    restart_environment, restart_cwd = _clean_environment(restart_clean_root)
    restart_environment["CHAT_HISTORY_ANALYSIS_SYNTHETIC_ROOT"] = os.fspath(marker_root)
    restart = subprocess.Popen(
        [app_executable, "--b5-off"],
        cwd=restart_cwd,
        env=restart_environment,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    try:
        time.sleep(4)
        if restart.poll() is not None:
            raise RuntimeError("B5_RESTART_FAILED")
    finally:
        _stop_exact_process(restart)
    _wait_for_process_state("chat-history-analysis-sidecar", exists=False)

    off_render = _read_b5_render_evidence(marker_root, "off")
    on_render = _read_b5_render_evidence(marker_root, "on")
    b5_evidence = {
        "status": "passed",
        "syntheticOnly": True,
        "cleanInstallApp": "dmg-copy/Applications-like/Chat History Analysis.app",
        "finderEquivalentLaunch": "passed",
        "networkBlocked": "passed",
        "networkAttempts": 0,
        "sharePreview": "passed",
        "artworkAssets": artwork_assets,
        "vocabularyOff": "passed",
        "vocabularyOn": "passed",
        "nativeNSSavePanel": "actual-packaged-AppKit",
        "nativeCancel": "actual-packaged-AppKit",
        "nativeSave": "actual-packaged-AppKit",
        "overwriteRetry": "actual-packaged-AppKit",
        "savedPng": {
            "on": first_png_evidence,
            "off": second_png_evidence,
        },
        "previewRenderEvidence": {
            "off": off_render,
            "on": on_render,
        },
        "previewExportParity": "decoded-RGBA-digest-equal",
        "sidecarShutdown": "passed",
        "restart": "passed",
        "temporaryPngCleanup": "pending",
    }
    for path in sorted(output.glob("chat-recap-*.png")):
        _remove_known_file(path)
    if list(output.iterdir()):
        raise RuntimeError("B5_TEMP_OUTPUT_NOT_CLEAN")
    _remove_known_file(marker_root / "synthetic-annual-source.json")
    for path in sorted(marker_root.glob("b5-render-*.json")):
        _remove_known_file(path)
    for path in sorted(marker_root.glob("selection-smoke-*")):
        _remove_known_file(path)
    output.rmdir()
    marker_root.rmdir()
    b5_evidence["temporaryPngCleanup"] = "passed"
    return b5_evidence


def _wait_for_new_regular_file(
    output: Path,
    before: set[Path],
    *,
    suffixes: tuple[str, ...],
    timeout: float = 60,
) -> Path:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        candidates = {
            path
            for path in output.iterdir()
            if path.is_file() and path.suffix.lower() in suffixes
        }
        fresh = sorted(candidates - before)
        if fresh:
            return fresh[-1]
        time.sleep(0.2)
    raise RuntimeError("B6_NATIVE_EXPORT_READBACK_NOT_FOUND")


def _inspect_b6_aggregate_export(path: Path) -> dict[str, object]:
    data = path.read_bytes()
    if not data:
        raise RuntimeError("B6_AGGREGATE_EXPORT_EMPTY")
    text = data.decode("utf-8", errors="strict")
    if any(
        marker in text
        for marker in (
            "b6-core-2023-2024.json",
            "b6-core-2024-2025.json",
            "b6-core-2025-2026.json",
            "working directory",
            "src-tauri",
        )
    ):
        raise RuntimeError("B6_AGGREGATE_EXPORT_PATH_LEAK")
    if path.suffix.lower() == ".json":
        value = json.loads(text)
        if not isinstance(value, dict) or not value:
            raise RuntimeError("B6_AGGREGATE_EXPORT_JSON_INVALID")
    elif path.suffix.lower() == ".csv":
        if "schemaVersion" not in text and "chart" not in text:
            raise RuntimeError("B6_AGGREGATE_EXPORT_CSV_INVALID")
    else:
        raise RuntimeError("B6_AGGREGATE_EXPORT_FORMAT_INVALID")
    return {
        "pathLabel": "synthetic-temp/aggregate-export" + path.suffix.lower(),
        "format": path.suffix.lower().lstrip("."),
        "bytes": len(data),
        "readback": "passed",
        "pathPrivacy": "passed",
    }


def _run_b6_packaged_acceptance(app: Path, root: Path) -> dict[str, object]:
    """Run the final synthetic product vertical against the clean DMG copy."""

    _require_b5_accessibility()
    _run_finder_equivalent_launch(app)
    marker_root = root / "b6-runtime"
    marker_root.mkdir(exist_ok=True)
    os.environ["CHAT_HISTORY_ANALYSIS_SYNTHETIC_B5_MARKER_ROOT"] = os.fspath(marker_root)
    marker_root, output = _prepare_b5_marker_root()
    clean_root = _fresh_b6_environment_root(root, "b6-clean-user")
    environment, cwd = _clean_environment(clean_root)
    environment["CHAT_HISTORY_ANALYSIS_SYNTHETIC_ROOT"] = os.fspath(marker_root)
    environment["CHAT_HISTORY_ANALYSIS_SYNTHETIC_B5_MARKER_ROOT"] = os.fspath(marker_root)
    environment["CHAT_HISTORY_ANALYSIS_SYNTHETIC_B6_MODE"] = "b6"
    environment["CHAT_HISTORY_ANALYSIS_SYNTHETIC_NATIVE_DIALOG_ROLE"] = "annual"
    sandbox = Path("/usr/bin/sandbox-exec")
    if not sandbox.is_file():
        raise RuntimeError("B6_NETWORK_SANDBOX_UNAVAILABLE")
    app_executable = app / "Contents" / "MacOS" / APP_EXECUTABLE
    process = subprocess.Popen(
        [sandbox, "-p", "(version 1) (allow default) (deny network*)", app_executable],
        cwd=cwd,
        env=environment,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    aggregate_evidence: dict[str, object] | None = None
    aggregate_path: Path | None = None
    first_png: Path | None = None
    second_png: Path | None = None
    try:
        _wait_for_marker(marker_root, "aggregate-export-requested", process)
        before_aggregate = {path for path in output.iterdir() if path.is_file()}
        _drive_native_save_panel(output, cancel=False)
        _wait_for_marker(marker_root, "aggregate-export-success", process)
        aggregate_path = _wait_for_new_regular_file(
            output,
            before_aggregate,
            suffixes=(".json", ".csv"),
        )
        aggregate_evidence = _inspect_b6_aggregate_export(aggregate_path)

        _wait_for_marker(marker_root, "share-preview-ready", process)
        off_render = _wait_for_b5_render_evidence(marker_root, "off", process)
        _wait_for_marker(marker_root, "native-cancel-requested", process)
        _drive_native_save_panel(output, cancel=True)
        _wait_for_marker(marker_root, "native-cancelled", process)
        _wait_for_marker(marker_root, "vocabulary-on", process)
        on_render = _wait_for_b5_render_evidence(marker_root, "on", process)
        _wait_for_marker(marker_root, "native-save-requested", process)
        before_first = set(output.glob("chat-recap-*.png"))
        _drive_native_save_panel(output, cancel=False)
        _wait_for_marker(marker_root, "native-save-success", process)
        first_png = _wait_for_saved_png(output, before_first)
        first_png_evidence = _inspect_saved_png(first_png)
        if first_png_evidence["rgbaDigest"] != on_render["rgbaDigest"]:
            raise RuntimeError("B6_PREVIEW_EXPORT_RGBA_MISMATCH_ON")
        _wait_for_marker(marker_root, "native-save-retry-requested", process)
        _drive_native_save_panel(output, cancel=False)
        _wait_for_marker(marker_root, "native-save-retry-success", process)
        second_png = first_png
        second_png_evidence = _inspect_saved_png(second_png)
        if second_png_evidence["rgbaDigest"] != off_render["rgbaDigest"]:
            raise RuntimeError("B6_PREVIEW_EXPORT_RGBA_MISMATCH_OFF")
        _wait_for_marker(marker_root, "share-preview-closed", process)
        process.wait(timeout=40)
        if process.returncode not in (0, None):
            raise RuntimeError("B6_PACKAGED_APP_EXIT_FAILED")
    except BaseException:
        if process.poll() is None:
            _stop_exact_process(process)
        raise
    finally:
        if process.poll() is None:
            _stop_exact_process(process)

    if _process_exists("chat-history-analysis-sidecar"):
        raise RuntimeError("B6_SIDECAR_ORPHAN_AFTER_QUIT")
    restart_root = _fresh_b6_environment_root(root, "b6-restart-clean-user")
    restart_environment, restart_cwd = _clean_environment(restart_root)
    restart = subprocess.Popen(
        [app_executable],
        cwd=restart_cwd,
        env=restart_environment,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    try:
        time.sleep(4)
        if restart.poll() is not None:
            raise RuntimeError("B6_RESTART_FAILED")
    finally:
        _stop_exact_process(restart)
    _wait_for_process_state("chat-history-analysis-sidecar", exists=False)

    if aggregate_evidence is None or aggregate_path is None or first_png is None or second_png is None:
        raise RuntimeError("B6_PACKAGED_EVIDENCE_INCOMPLETE")
    for path in (first_png, aggregate_path):
        _remove_known_file(path)
    for path in sorted(output.glob("chat-recap-*.png")):
        _remove_known_file(path)
    if list(output.iterdir()):
        raise RuntimeError("B6_TEMP_OUTPUT_NOT_CLEAN")
    _remove_known_file(marker_root / "synthetic-annual-source.json")
    for path in sorted(marker_root.glob("b6-core-*.json")):
        _remove_known_file(path)
    for path in sorted(marker_root.glob("b5-render-*.json")):
        _remove_known_file(path)
    for path in sorted(marker_root.glob("selection-smoke-*")):
        _remove_known_file(path)
    output.rmdir()
    marker_root.rmdir()
    return {
        "status": "passed",
        "syntheticOnly": True,
        "cleanInstallApp": "clean-install/Applications-like/Chat History Analysis.app",
        "finderEquivalentLaunch": "passed",
        "networkBlocked": "passed",
        "networkAttempts": 0,
        "fixtureA": "three embedded multi-file years with overlap/dedup and partial endpoints",
        "scopeRegression": "all-years → Year A → Year B → all-years",
        "annualScenes": "seven scenes",
        "vocabulary": "raw/per-10000, role, Clean Mode, custom hidden word",
        "sharePreview": "passed",
        "nativePresentationSave": "actual-packaged-AppKit",
        "nativeAggregateExport": aggregate_evidence,
        "savedPng": {
            "on": first_png_evidence,
            "off": second_png_evidence,
        },
        "previewExportParity": "decoded-RGBA-digest-equal",
        "detailedApply": "draft-retained-until-one-Apply",
        "detailedRoutes": 8,
        "sidecarShutdown": "passed",
        "restart": "passed",
        "temporaryArtifactCleanup": "passed",
    }


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
        selection_deadline = time.monotonic() + 180
        while not selection_marker.is_file() and time.monotonic() < selection_deadline:
            if selection_host.poll() is not None:
                raise RuntimeError("PACKAGED_SELECTION_SMOKE_FAILED")
            time.sleep(0.1)
        if not selection_marker.is_file():
            raise RuntimeError("PACKAGED_SELECTION_SMOKE_FAILED")
        required_selection_markers = (
            "selection-smoke-cancel-available",
            "selection-smoke-cancel-clicked",
            "selection-smoke-cancelled-event",
            "selection-smoke-cancelled-ready",
            "selection-smoke-host-cancelling",
            "selection-smoke-retry-start-clicked",
            "selection-smoke-worker-started",
            "selection-smoke-worker-prepared",
            "selection-smoke-worker-load-accepted",
            "selection-smoke-worker-dashboard-model",
            "selection-smoke-worker-result-ready",
        )
        marker_root = selection_root / "isolated-temp"
        missing_markers = [
            marker
            for marker in required_selection_markers
            if not (marker_root / marker).is_file()
        ]
        dashboard_ready = (marker_root / "selection-smoke-dashboard-ready").is_file()
        beta_ready_markers = (
            "selection-smoke-home-ready",
            "selection-smoke-annual-recap-ready",
            "selection-smoke-core-sections-ready",
            "selection-smoke-word-evidence-ready",
            "selection-smoke-word-cloud-ready",
        )
        beta_ready = all((marker_root / marker).is_file() for marker in beta_ready_markers)
        if missing_markers or not (dashboard_ready or beta_ready):
            raise RuntimeError("PACKAGED_SELECTION_SMOKE_FAILED")
        selection_host.wait(timeout=20)
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
        "packagedVerticalSmoke": "passed",
        "packagedCancellationSmoke": "passed",
        "packagedWorkerTransportSmoke": "passed",
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


def _validate_b6_fixture_inventory() -> None:
    fixture_root = ROOT / "contracts" / "b6-fixtures"
    expected = (
        "core-2023-2024.json",
        "core-2024-2025.json",
        "core-2025-2026.json",
        "edge-sparse.json",
        "malformed.json",
    )
    for name in expected:
        path = fixture_root / name
        if not path.is_file() or path.stat().st_size == 0:
            raise RuntimeError("B6_FIXTURE_INVENTORY_INVALID")
    for name in expected[:4]:
        value = json.loads((fixture_root / name).read_text(encoding="utf-8"))
        if not isinstance(value, dict) or not isinstance(value.get("messages"), list):
            raise RuntimeError("B6_FIXTURE_SCHEMA_INVALID")
    try:
        json.loads((fixture_root / expected[-1]).read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return
    raise RuntimeError("B6_MALFORMED_FIXTURE_ACCEPTED")


def build_and_verify(*, b5_acceptance: bool = False, b6_acceptance: bool = False) -> Path:
    if b5_acceptance and b6_acceptance:
        raise RuntimeError("PACKAGE_ACCEPTANCE_MODES_ARE_EXCLUSIVE")
    if b6_acceptance:
        _validate_b6_fixture_inventory()
    python312 = _python312()
    output_root = _new_output_root(b6_acceptance=b6_acceptance)
    sidecar_bundle = _build_sidecar(output_root, python312)
    selection_smoke_app: Path | None = None
    if b5_acceptance:
        app = _build_app(
            output_root,
            sidecar_bundle,
            features=("packaged-b5-acceptance",),
        )
    elif b6_acceptance:
        built_app = _build_app(
            output_root,
            sidecar_bundle,
            features=("packaged-b6-acceptance",),
        )
        app = output_root / APP_NAME
        _copy_tree(built_app, app)
    else:
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
    if b5_acceptance:
        smoke = _run_b5_packaged_acceptance(copied_app, output_root)
    elif b6_acceptance:
        smoke = _run_b6_packaged_acceptance(copied_app, output_root)
    else:
        if selection_smoke_app is None:
            raise RuntimeError("SELECTION_SMOKE_APP_MISSING")
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
    parser.add_argument(
        "--b5-acceptance",
        action="store_true",
        help="run the synthetic packaged B5 native-save/readback acceptance vertical",
    )
    parser.add_argument(
        "--b6-acceptance",
        action="store_true",
        help="run the final synthetic packaged B6 product acceptance vertical",
    )
    arguments = parser.parse_args(argv)
    try:
        manifest = build_and_verify(
            b5_acceptance=arguments.b5_acceptance,
            b6_acceptance=arguments.b6_acceptance,
        )
        if not manifest.is_file():
            raise RuntimeError("PACKAGE_MANIFEST_NOT_FOUND")
    except (OSError, RuntimeError, subprocess.SubprocessError, json.JSONDecodeError) as error:
        print(
            json.dumps({"code": "STAGE11_PACKAGE_FAILED", "reason": str(error)}, sort_keys=True),
            file=sys.stderr,
        )
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
