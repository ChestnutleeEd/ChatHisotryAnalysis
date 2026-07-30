#!/usr/bin/env python3
"""Install the approved ijson wheel and retain its archive in an external venv."""

import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import stat
import subprocess
import sys
from urllib.request import urlopen
import zipfile


EXPECTED_IMPLEMENTATION = "CPython"
EXPECTED_PYTHON = (3, 12)
EXPECTED_SYSTEM = "Darwin"
EXPECTED_ARCHITECTURE = "arm64"
EXPECTED_FILENAME = "ijson-3.5.1-cp312-cp312-macosx_11_0_arm64.whl"
EXPECTED_SHA256 = "b9517efbe6604bce16f3e50d49b0cd1bdc58917f98cf2eab026599c5c0422991"
EXPECTED_TAG = "cp312-cp312-macosx_11_0_arm64"
EXPECTED_URL = (
    "https://files.pythonhosted.org/packages/30/c7/"
    "6e3e591324fd4c7a7a9e1bc23548bacbd84c0d91766b71f09f13e945e7e9/"
    + EXPECTED_FILENAME
)
EVIDENCE_PARTS = ("share", "chat-history-analysis")
NATIVE_MEMBER = "ijson/backends/_yajl2.cpython-312-darwin.so"
METADATA_MEMBER = "ijson-3.5.1.dist-info/METADATA"
WHEEL_MEMBER = "ijson-3.5.1.dist-info/WHEEL"
ALLOWED_FAILURE_REASONS = frozenset(
    {
        "UNSUPPORTED_PYTHON_RUNTIME",
        "IJSON_DISTRIBUTION_UNVERIFIED",
        "IJSON_BACKEND_UNAVAILABLE",
        "IJSON_BACKEND_MISMATCH",
        "IJSON_PARSER_INITIALIZATION_FAILED",
    }
)
POST_INSTALL_CHECK = (
    "import json,sys\n"
    "sys.path.insert(0,sys.argv[1])\n"
    "reason_code=None\n"
    "try:\n"
    "    from chat_history_analysis.application import run_startup_check\n"
    "    from chat_history_analysis.errors import StartupError\n"
    "    try:\n"
    "        run_startup_check()\n"
    "    except StartupError as error:\n"
    "        reason_code=error.reason_code.value\n"
    "except Exception:\n"
    "    reason_code='IJSON_DISTRIBUTION_UNVERIFIED'\n"
    "if reason_code is not None:\n"
    "    print(json.dumps({'reasonCode':reason_code},sort_keys=True))\n"
    "    raise SystemExit(2)\n"
)


class BootstrapFailure(Exception):
    """Content-free internal bootstrap failure."""

    def __init__(self, reason_code="IJSON_DISTRIBUTION_UNVERIFIED"):
        if reason_code not in ALLOWED_FAILURE_REASONS:
            reason_code = "IJSON_DISTRIBUTION_UNVERIFIED"
        self.reason_code = reason_code
        super().__init__()


class _ContentFreeArgumentParser(argparse.ArgumentParser):
    def error(self, message):
        self.print_usage(sys.stderr)
        raise SystemExit(2)


def _runtime_is_supported():
    return (
        platform.python_implementation() == EXPECTED_IMPLEMENTATION
        and sys.version_info[:2] == EXPECTED_PYTHON
        and platform.system() == EXPECTED_SYSTEM
        and platform.machine() == EXPECTED_ARCHITECTURE
    )


def _is_within(candidate, parent):
    try:
        candidate.relative_to(parent)
    except ValueError:
        return False
    return True


def _open_regular(path):
    try:
        metadata = os.lstat(path)
        if stat.S_ISLNK(metadata.st_mode) or not stat.S_ISREG(metadata.st_mode):
            raise BootstrapFailure
        flags = os.O_RDONLY
        if hasattr(os, "O_NOFOLLOW"):
            flags |= os.O_NOFOLLOW
        descriptor = os.open(path, flags)
        opened = os.fstat(descriptor)
        if not stat.S_ISREG(opened.st_mode):
            os.close(descriptor)
            raise BootstrapFailure
        return os.fdopen(descriptor, "rb")
    except (OSError, ValueError):
        raise BootstrapFailure from None


def _copy_stream(source, destination):
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
    if hasattr(os, "O_NOFOLLOW"):
        flags |= os.O_NOFOLLOW
    try:
        descriptor = os.open(destination, flags, 0o600)
        digest = hashlib.sha256()
        with os.fdopen(descriptor, "wb") as output:
            while True:
                block = source.read(65_536)
                if not block:
                    break
                digest.update(block)
                output.write(block)
            output.flush()
            os.fsync(output.fileno())
        return digest.hexdigest()
    except (OSError, ValueError):
        raise BootstrapFailure from None


def _metadata_value(text, key):
    prefix = key + ":"
    values = [
        line[len(prefix) :].strip()
        for line in text.splitlines()
        if line.startswith(prefix)
    ]
    if len(values) != 1:
        raise BootstrapFailure
    return values[0]


def _validate_archive(path):
    with _open_regular(path) as archive_file:
        digest = hashlib.sha256()
        for block in iter(lambda: archive_file.read(65_536), b""):
            digest.update(block)
        if digest.hexdigest() != EXPECTED_SHA256:
            raise BootstrapFailure
        archive_file.seek(0)
        try:
            with zipfile.ZipFile(archive_file) as archive:
                if archive.testzip() is not None:
                    raise BootstrapFailure
                names = [item.filename for item in archive.infolist()]
                if len(names) != len(set(names)):
                    raise BootstrapFailure
                if (
                    METADATA_MEMBER not in names
                    or WHEEL_MEMBER not in names
                    or NATIVE_MEMBER not in names
                ):
                    raise BootstrapFailure
                metadata_text = archive.read(METADATA_MEMBER).decode("utf-8")
                wheel_text = archive.read(WHEEL_MEMBER).decode("utf-8")
        except (KeyError, OSError, UnicodeError, zipfile.BadZipFile):
            raise BootstrapFailure from None

    if _metadata_value(metadata_text, "Name") != "ijson":
        raise BootstrapFailure
    if _metadata_value(metadata_text, "Version") != "3.5.1":
        raise BootstrapFailure
    if _metadata_value(metadata_text, "License-Expression") != (
        "BSD-3-Clause AND ISC"
    ):
        raise BootstrapFailure
    tags = {
        line.removeprefix("Tag:").strip()
        for line in wheel_text.splitlines()
        if line.startswith("Tag:")
    }
    if tags != {EXPECTED_TAG}:
        raise BootstrapFailure
    if _metadata_value(wheel_text, "Root-Is-Purelib").lower() != "false":
        raise BootstrapFailure


def _evidence_directory():
    try:
        prefix = Path(sys.prefix).resolve(strict=True)
        repository = Path(__file__).resolve(strict=True).parent.parent
    except OSError:
        raise BootstrapFailure from None
    if prefix == repository or _is_within(prefix, repository):
        raise BootstrapFailure

    evidence = prefix.joinpath(*EVIDENCE_PARTS)
    try:
        evidence.mkdir(mode=0o700, parents=True, exist_ok=True)
        if evidence.is_symlink() or not evidence.is_dir():
            raise BootstrapFailure
        evidence.chmod(0o700)
    except OSError:
        raise BootstrapFailure from None
    return evidence


def _stage_verified_archive(evidence, input_path):
    retained = evidence / EXPECTED_FILENAME
    temporary = evidence / (".bootstrap-" + str(os.getpid()) + ".tmp")
    if retained.exists() or retained.is_symlink():
        if input_path is not None:
            supplied = Path(input_path)
            if supplied.name != EXPECTED_FILENAME:
                raise BootstrapFailure
            _validate_archive(supplied)
        _validate_archive(retained)
        return retained

    try:
        if input_path is None:
            with urlopen(EXPECTED_URL, timeout=60) as response:
                observed_hash = _copy_stream(response, temporary)
        else:
            supplied = Path(input_path)
            if supplied.name != EXPECTED_FILENAME:
                raise BootstrapFailure
            with _open_regular(supplied) as source:
                observed_hash = _copy_stream(source, temporary)
        if observed_hash != EXPECTED_SHA256:
            raise BootstrapFailure
        _validate_archive(temporary)
        os.replace(temporary, retained)
        retained.chmod(0o600)
        _validate_archive(retained)
        return retained
    except Exception as error:
        if temporary.exists() and not temporary.is_symlink():
            try:
                temporary.unlink()
            except OSError:
                pass
        if isinstance(error, BootstrapFailure):
            raise
        raise BootstrapFailure from None


def _install_verified_archive(retained):
    environment = {
        "PIP_CONFIG_FILE": os.devnull,
        "PIP_DISABLE_PIP_VERSION_CHECK": "1",
        "PIP_NO_CACHE_DIR": "1",
        "PIP_NO_INPUT": "1",
        "PYTHONNOUSERSITE": "1",
    }
    result = subprocess.run(
        [
            sys.executable,
            "-I",
            "-m",
            "pip",
            "--isolated",
            "--disable-pip-version-check",
            "--no-cache-dir",
            "install",
            "--no-input",
            "--no-deps",
            "--no-index",
            "--force-reinstall",
            str(retained),
        ],
        check=False,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        env=environment,
    )
    if result.returncode != 0:
        raise BootstrapFailure


def _project_source_root():
    try:
        source_root = Path(__file__).resolve(strict=True).parent.parent / "src"
        source_root = source_root.resolve(strict=True)
        if source_root.is_symlink() or not source_root.is_dir():
            raise BootstrapFailure
    except OSError:
        raise BootstrapFailure from None
    return source_root


def _verify_installed_environment():
    result = subprocess.run(
        [
            sys.executable,
            "-I",
            "-c",
            POST_INSTALL_CHECK,
            str(_project_source_root()),
        ],
        check=False,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        env={
            "PIP_CONFIG_FILE": os.devnull,
            "PYTHONNOUSERSITE": "1",
        },
    )
    if result.returncode == 0:
        if result.stdout or result.stderr:
            raise BootstrapFailure
        return

    try:
        payload = json.loads(result.stdout)
        if set(payload) != {"reasonCode"}:
            raise ValueError
        reason_code = payload["reasonCode"]
        if not isinstance(reason_code, str):
            raise ValueError
    except (TypeError, ValueError, json.JSONDecodeError):
        raise BootstrapFailure from None
    raise BootstrapFailure(reason_code)


def _parser():
    parser = _ContentFreeArgumentParser(prog="bootstrap-preprocessor")
    parser.add_argument(
        "--wheel",
        help="use an explicitly supplied approved wheel instead of downloading it",
    )
    return parser


def _emit_error(reason_code):
    print(
        json.dumps(
            {"phase": "bootstrap", "reasonCode": reason_code},
            sort_keys=True,
        ),
        file=sys.stderr,
    )


def main(argv=None):
    if not _runtime_is_supported():
        _emit_error("UNSUPPORTED_PYTHON_RUNTIME")
        return 2
    try:
        arguments = _parser().parse_args(argv)
        evidence = _evidence_directory()
        retained = _stage_verified_archive(evidence, arguments.wheel)
        _install_verified_archive(retained)
        _verify_installed_environment()
    except SystemExit:
        raise
    except BootstrapFailure as error:
        _emit_error(error.reason_code)
        return 2
    except Exception:
        _emit_error("IJSON_DISTRIBUTION_UNVERIFIED")
        return 2
    print(json.dumps({"phase": "bootstrap", "status": "ready"}, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
