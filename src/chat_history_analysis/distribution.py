"""Verify ijson from a retained approved wheel, never installed metadata."""

from __future__ import annotations

from dataclasses import dataclass
import hashlib
import os
from pathlib import Path, PurePosixPath
import stat
import sys
import sysconfig
from typing import BinaryIO, Final
import zipfile


EXPECTED_DISTRIBUTION_NAME: Final = "ijson"
EXPECTED_DISTRIBUTION_VERSION: Final = "3.5.1"
EXPECTED_LICENSE_EXPRESSION: Final = "BSD-3-Clause AND ISC"
EXPECTED_WHEEL_TAG: Final = "cp312-cp312-macosx_11_0_arm64"
EVIDENCE_DIRECTORY_PARTS: Final = ("share", "chat-history-analysis")


@dataclass(frozen=True)
class ApprovedArtifact:
    """The sole archive approved for the supported runtime tuple."""

    filename: str
    sha256: str
    wheel_tag: str


APPROVED_ARTIFACT: Final = ApprovedArtifact(
    filename="ijson-3.5.1-cp312-cp312-macosx_11_0_arm64.whl",
    sha256="b9517efbe6604bce16f3e50d49b0cd1bdc58917f98cf2eab026599c5c0422991",
    wheel_tag=EXPECTED_WHEEL_TAG,
)

NATIVE_EXTENSION_RELATIVE_PATH: Final = (
    "backends/_yajl2.cpython-312-darwin.so"
)
REQUIRED_PACKAGE_FILES: Final = frozenset(
    {
        "__init__.py",
        "backends/yajl2_c.py",
        NATIVE_EXTENSION_RELATIVE_PATH,
    }
)
METADATA_MEMBER: Final = "ijson-3.5.1.dist-info/METADATA"
WHEEL_MEMBER: Final = "ijson-3.5.1.dist-info/WHEEL"


class DistributionVerificationFailure(Exception):
    """Content-free marker for retained-archive or installation failure."""


@dataclass(frozen=True)
class InstalledDistributionEvidence:
    """Path-free facts derived from the retained archive and installed bytes."""

    name: str
    version: str
    license_expression: str
    artifact_filename: str
    artifact_sha256: str
    wheel_tags: frozenset[str]
    installed_files_match: bool
    native_extension_matches: bool


@dataclass(frozen=True)
class _TrustedFile:
    size: int
    sha256: str


def retained_archive_path(prefix: Path | None = None) -> Path:
    """Return the deterministic environment-relative evidence location."""

    selected_prefix = Path(sys.prefix) if prefix is None else prefix
    return selected_prefix.joinpath(
        *EVIDENCE_DIRECTORY_PARTS,
        APPROVED_ARTIFACT.filename,
    )


def installed_package_root() -> Path:
    """Return the deterministic environment package root without metadata."""

    purelib = Path(sysconfig.get_path("purelib"))
    prefix = Path(sys.prefix)
    try:
        resolved_prefix = prefix.resolve(strict=True)
        resolved_purelib = purelib.resolve(strict=True)
        resolved_purelib.relative_to(resolved_prefix)
    except (OSError, ValueError):
        raise DistributionVerificationFailure from None
    return resolved_purelib / EXPECTED_DISTRIBUTION_NAME


def installed_package_file(relative_name: str) -> Path:
    """Return one expected installed package file without importing ijson."""

    relative = PurePosixPath(relative_name)
    if relative.is_absolute() or ".." in relative.parts:
        raise DistributionVerificationFailure
    return installed_package_root().joinpath(*relative.parts)


def _open_regular_no_symlink(path: Path) -> BinaryIO:
    try:
        metadata = os.lstat(path)
        if stat.S_ISLNK(metadata.st_mode) or not stat.S_ISREG(metadata.st_mode):
            raise DistributionVerificationFailure
        flags = os.O_RDONLY
        if hasattr(os, "O_NOFOLLOW"):
            flags |= os.O_NOFOLLOW
        descriptor = os.open(path, flags)
        opened = os.fstat(descriptor)
        if not stat.S_ISREG(opened.st_mode):
            os.close(descriptor)
            raise DistributionVerificationFailure
        return os.fdopen(descriptor, "rb")
    except (OSError, ValueError):
        raise DistributionVerificationFailure from None


def _digest_stream(stream: BinaryIO) -> tuple[str, int]:
    digest = hashlib.sha256()
    size = 0
    for block in iter(lambda: stream.read(65_536), b""):
        digest.update(block)
        size += len(block)
    return digest.hexdigest(), size


def _metadata_value(text: str, key: str) -> str:
    prefix = key + ":"
    values = [
        line[len(prefix) :].strip()
        for line in text.splitlines()
        if line.startswith(prefix)
    ]
    if len(values) != 1:
        raise DistributionVerificationFailure
    return values[0]


def _trusted_manifest(
    archive: zipfile.ZipFile,
) -> tuple[dict[str, _TrustedFile], str, str, str, frozenset[str]]:
    infos = archive.infolist()
    names = [info.filename for info in infos]
    if len(names) != len(set(names)):
        raise DistributionVerificationFailure
    try:
        metadata_text = archive.read(METADATA_MEMBER).decode("utf-8")
        wheel_text = archive.read(WHEEL_MEMBER).decode("utf-8")
    except (KeyError, OSError, UnicodeError):
        raise DistributionVerificationFailure from None

    name = _metadata_value(metadata_text, "Name")
    version = _metadata_value(metadata_text, "Version")
    license_expression = _metadata_value(metadata_text, "License-Expression")
    wheel_tags = frozenset(
        line.removeprefix("Tag:").strip()
        for line in wheel_text.splitlines()
        if line.startswith("Tag:")
    )
    if _metadata_value(wheel_text, "Root-Is-Purelib").lower() != "false":
        raise DistributionVerificationFailure

    manifest: dict[str, _TrustedFile] = {}
    for info in infos:
        path = PurePosixPath(info.filename)
        if not path.parts or path.parts[0] != EXPECTED_DISTRIBUTION_NAME:
            continue
        if path.is_absolute() or ".." in path.parts:
            raise DistributionVerificationFailure
        mode = (info.external_attr >> 16) & 0o170000
        if info.is_dir():
            if mode and not stat.S_ISDIR(mode):
                raise DistributionVerificationFailure
            continue
        if mode and not stat.S_ISREG(mode):
            raise DistributionVerificationFailure
        relative_name = PurePosixPath(*path.parts[1:]).as_posix()
        if not relative_name or relative_name in manifest:
            raise DistributionVerificationFailure
        try:
            with archive.open(info, "r") as member:
                digest, size = _digest_stream(member)
        except (OSError, RuntimeError, zipfile.BadZipFile):
            raise DistributionVerificationFailure from None
        if size != info.file_size:
            raise DistributionVerificationFailure
        manifest[relative_name] = _TrustedFile(size=size, sha256=digest)

    if not REQUIRED_PACKAGE_FILES <= manifest.keys():
        raise DistributionVerificationFailure
    return manifest, name, version, license_expression, wheel_tags


def _expected_directories(manifest: dict[str, _TrustedFile]) -> set[str]:
    expected = {""}
    for relative_name in manifest:
        parent = PurePosixPath(relative_name).parent
        while parent.as_posix() != ".":
            expected.add(parent.as_posix())
            parent = parent.parent
    return expected


def _is_allowed_bytecode(
    relative_name: str,
    manifest: dict[str, _TrustedFile],
) -> bool:
    path = PurePosixPath(relative_name)
    if path.parent.name != "__pycache__" or path.suffix != ".pyc":
        return False
    source_parent = path.parent.parent
    cache_tag = sys.implementation.cache_tag
    if cache_tag != "cpython-312":
        return False
    for source_name in manifest:
        source = PurePosixPath(source_name)
        if source.suffix != ".py" or source.parent != source_parent:
            continue
        prefix = source.stem + "." + cache_tag
        if path.name in {
            prefix + ".pyc",
            prefix + ".opt-1.pyc",
            prefix + ".opt-2.pyc",
        }:
            return True
    return False


def _installed_files_match(
    package_root: Path,
    manifest: dict[str, _TrustedFile],
) -> tuple[bool, bool]:
    try:
        root_metadata = os.lstat(package_root)
        if stat.S_ISLNK(root_metadata.st_mode) or not stat.S_ISDIR(
            root_metadata.st_mode
        ):
            return False, False
    except OSError:
        return False, False

    expected_directories = _expected_directories(manifest)
    allowed_cache_directories = {
        (PurePosixPath(directory) / "__pycache__").as_posix()
        if directory
        else "__pycache__"
        for directory in expected_directories
    }
    observed: set[str] = set()
    native_matches = False

    try:
        for current, directories, files in os.walk(package_root, followlinks=False):
            current_path = Path(current)
            current_metadata = os.lstat(current_path)
            if stat.S_ISLNK(current_metadata.st_mode) or not stat.S_ISDIR(
                current_metadata.st_mode
            ):
                return False, False
            relative_directory = current_path.relative_to(package_root).as_posix()
            if relative_directory == ".":
                relative_directory = ""
            if (
                relative_directory not in expected_directories
                and relative_directory not in allowed_cache_directories
            ):
                return False, False

            for directory in directories:
                directory_path = current_path / directory
                directory_metadata = os.lstat(directory_path)
                if stat.S_ISLNK(directory_metadata.st_mode) or not stat.S_ISDIR(
                    directory_metadata.st_mode
                ):
                    return False, False

            for filename in files:
                installed_file = current_path / filename
                relative_name = installed_file.relative_to(package_root).as_posix()
                with _open_regular_no_symlink(installed_file) as handle:
                    observed_hash, observed_size = _digest_stream(handle)
                trusted = manifest.get(relative_name)
                if trusted is None:
                    if not _is_allowed_bytecode(relative_name, manifest):
                        return False, False
                    continue
                observed.add(relative_name)
                if (
                    observed_size != trusted.size
                    or observed_hash != trusted.sha256
                ):
                    return False, False
                if relative_name == NATIVE_EXTENSION_RELATIVE_PATH:
                    native_matches = True
    except (DistributionVerificationFailure, OSError, ValueError):
        return False, False

    return observed == set(manifest), native_matches


def _inspect_at(
    archive_path: Path,
    package_root: Path,
) -> InstalledDistributionEvidence:
    if archive_path.name != APPROVED_ARTIFACT.filename:
        raise DistributionVerificationFailure
    with _open_regular_no_symlink(archive_path) as archive_file:
        archive_hash, _ = _digest_stream(archive_file)
        if archive_hash != APPROVED_ARTIFACT.sha256:
            raise DistributionVerificationFailure
        archive_file.seek(0)
        try:
            with zipfile.ZipFile(archive_file) as archive:
                if archive.testzip() is not None:
                    raise DistributionVerificationFailure
                (
                    manifest,
                    name,
                    version,
                    license_expression,
                    wheel_tags,
                ) = _trusted_manifest(archive)
        except (OSError, RuntimeError, zipfile.BadZipFile):
            raise DistributionVerificationFailure from None

    installed_files_match, native_extension_matches = _installed_files_match(
        package_root,
        manifest,
    )
    return InstalledDistributionEvidence(
        name=name,
        version=version,
        license_expression=license_expression,
        artifact_filename=archive_path.name,
        artifact_sha256=archive_hash,
        wheel_tags=wheel_tags,
        installed_files_match=installed_files_match,
        native_extension_matches=native_extension_matches,
    )


def inspect_installed_distribution() -> InstalledDistributionEvidence:
    """Rehash the retained wheel and compare installation bytes against it."""

    return _inspect_at(retained_archive_path(), installed_package_root())


def distribution_is_approved(evidence: InstalledDistributionEvidence) -> bool:
    """Accept only exact trusted-archive and installed-byte evidence."""

    return (
        evidence.name == EXPECTED_DISTRIBUTION_NAME
        and evidence.version == EXPECTED_DISTRIBUTION_VERSION
        and evidence.license_expression == EXPECTED_LICENSE_EXPRESSION
        and evidence.artifact_filename == APPROVED_ARTIFACT.filename
        and evidence.artifact_sha256 == APPROVED_ARTIFACT.sha256
        and evidence.wheel_tags == frozenset({APPROVED_ARTIFACT.wheel_tag})
        and evidence.installed_files_match
        and evidence.native_extension_matches
    )
