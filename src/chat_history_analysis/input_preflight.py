"""Explicit input roles and metadata-only local path preflight."""

from __future__ import annotations

from dataclasses import dataclass
import os
from pathlib import Path
import stat
import subprocess
from typing import Final, Iterable

from .errors import (
    FailureCategory,
    InputPreflightError,
    InputPreflightReasonCode,
)


GIT_EXECUTABLE: Final = "git"
MAX_RAW_INPUT_BYTES: Final = 536_870_912
MAX_ANNUAL_SOURCES: Final = 20
MAX_AGGREGATE_RAW_INPUT_BYTES: Final = 2_147_483_648
_GIT_REPOSITORY_ENVIRONMENT: Final = frozenset(
    {
        "GIT_ALTERNATE_OBJECT_DIRECTORIES",
        "GIT_CEILING_DIRECTORIES",
        "GIT_COMMON_DIR",
        "GIT_DIR",
        "GIT_DISCOVERY_ACROSS_FILESYSTEM",
        "GIT_INDEX_FILE",
        "GIT_OBJECT_DIRECTORY",
        "GIT_PREFIX",
        "GIT_WORK_TREE",
    }
)


@dataclass(frozen=True)
class InputSelection:
    """Unvalidated paths assigned only by their explicit CLI options."""

    annual_sources: tuple[Path, ...]
    overlap_verifications: tuple[Path, ...]
    output_directory: Path


@dataclass(frozen=True)
class PreflightedInputs:
    """Normalized local paths that passed the immutable metadata preflight."""

    annual_sources: tuple[Path, ...]
    overlap_verifications: tuple[Path, ...]
    output_directory: Path


@dataclass(frozen=True)
class _SourceMetadata:
    """Trusted, content-free metadata retained only for final revalidation."""

    lexical_path: Path
    resolved_path: Path
    device: int
    inode: int
    size_bytes: int


def _reject(
    reason_code: InputPreflightReasonCode = (
        InputPreflightReasonCode.INPUT_PREFLIGHT_FAILED
    ),
    category: FailureCategory = FailureCategory.INPUT_VALIDATION,
) -> None:
    raise InputPreflightError(reason_code, category)


def _reject_output() -> None:
    _reject(
        InputPreflightReasonCode.OUTPUT_IGNORE_POLICY_FAILED,
        FailureCategory.IGNORE_POLICY,
    )


def _lexical_absolute(
    path: Path,
    category: FailureCategory = FailureCategory.INPUT_VALIDATION,
) -> Path:
    try:
        value = os.fspath(path)
        if not value or "\x00" in value:
            if category is FailureCategory.IGNORE_POLICY:
                _reject_output()
            _reject()
        return Path(os.path.abspath(value))
    except InputPreflightError:
        raise
    except (OSError, TypeError, ValueError):
        if category is FailureCategory.IGNORE_POLICY:
            _reject_output()
        _reject()


def _path_is_readable(path: Path, mode: int) -> bool:
    if mode & (stat.S_IRUSR | stat.S_IRGRP | stat.S_IROTH) == 0:
        return False
    try:
        return os.access(
            path,
            os.R_OK,
            effective_ids=True,
            follow_symlinks=False,
        )
    except (NotImplementedError, TypeError):
        return os.access(path, os.R_OK)
    except OSError:
        return False


def _is_same_regular_file(
    metadata: os.stat_result,
    expected: _SourceMetadata,
) -> bool:
    return (
        stat.S_ISREG(metadata.st_mode)
        and metadata.st_dev == expected.device
        and metadata.st_ino == expected.inode
        and metadata.st_size == expected.size_bytes
    )


def _preflight_source(path: Path) -> _SourceMetadata:
    lexical_candidate = _lexical_absolute(path)
    try:
        metadata = os.lstat(lexical_candidate)
    except (OSError, ValueError):
        _reject()
    if stat.S_ISLNK(metadata.st_mode) or not stat.S_ISREG(metadata.st_mode):
        _reject()
    if not isinstance(metadata.st_size, int) or metadata.st_size < 0:
        _reject()
    if not _path_is_readable(lexical_candidate, metadata.st_mode):
        _reject()
    expected = _SourceMetadata(
        lexical_path=lexical_candidate,
        resolved_path=lexical_candidate,
        device=metadata.st_dev,
        inode=metadata.st_ino,
        size_bytes=metadata.st_size,
    )
    try:
        resolved = lexical_candidate.resolve(strict=True)
        final_metadata = os.lstat(lexical_candidate)
        resolved_metadata = os.stat(resolved, follow_symlinks=False)
    except (OSError, RuntimeError, ValueError):
        _reject()
    if (
        stat.S_ISLNK(final_metadata.st_mode)
        or not _is_same_regular_file(final_metadata, expected)
        or not _is_same_regular_file(resolved_metadata, expected)
    ):
        _reject()
    return _SourceMetadata(
        lexical_path=lexical_candidate,
        resolved_path=resolved,
        device=metadata.st_dev,
        inode=metadata.st_ino,
        size_bytes=metadata.st_size,
    )


def _revalidate_source(source: _SourceMetadata) -> None:
    try:
        if source.lexical_path.resolve(strict=True) != source.resolved_path:
            _reject()
        lexical_metadata = os.lstat(source.lexical_path)
        resolved_metadata = os.stat(
            source.resolved_path,
            follow_symlinks=False,
        )
    except InputPreflightError:
        raise
    except (OSError, RuntimeError, ValueError):
        _reject()
    if (
        stat.S_ISLNK(lexical_metadata.st_mode)
        or not _is_same_regular_file(lexical_metadata, source)
        or not _is_same_regular_file(resolved_metadata, source)
        or not _path_is_readable(source.lexical_path, lexical_metadata.st_mode)
    ):
        _reject()


def _nearest_existing_directory(path: Path) -> Path:
    current = path
    while True:
        try:
            metadata = os.lstat(current)
        except FileNotFoundError:
            parent = current.parent
            if parent == current:
                _reject_output()
            current = parent
            continue
        except OSError:
            _reject_output()
        if stat.S_ISLNK(metadata.st_mode) or not stat.S_ISDIR(metadata.st_mode):
            _reject_output()
        return current


def _git_environment() -> dict[str, str]:
    environment = {
        key: value
        for key, value in os.environ.items()
        if key not in _GIT_REPOSITORY_ENVIRONMENT
    }
    environment["LC_ALL"] = "C"
    return environment


def _run_git(
    working_directory: Path,
    arguments: Iterable[str],
    *,
    capture_stdout: bool = False,
) -> subprocess.CompletedProcess[str]:
    try:
        return subprocess.run(
            [
                GIT_EXECUTABLE,
                "-C",
                os.fspath(working_directory),
                *arguments,
            ],
            check=False,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE if capture_stdout else subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            text=True,
            encoding="utf-8",
            errors="strict",
            env=_git_environment(),
            timeout=10,
        )
    except (OSError, subprocess.SubprocessError, UnicodeError, ValueError):
        _reject_output()


def _repository_root(existing_directory: Path) -> Path:
    result = _run_git(
        existing_directory,
        ("rev-parse", "--show-toplevel"),
        capture_stdout=True,
    )
    if result.returncode != 0:
        _reject_output()
    try:
        root_text = result.stdout.strip()
        if not root_text:
            _reject_output()
        root = Path(root_text).resolve(strict=True)
        metadata = os.stat(root, follow_symlinks=False)
    except InputPreflightError:
        raise
    except (OSError, RuntimeError, ValueError):
        _reject_output()
    if not stat.S_ISDIR(metadata.st_mode):
        _reject_output()
    return root


def _verify_lexical_repository_boundary(
    lexical_candidate: Path,
    repository_root: Path,
    canonical_relative: Path,
) -> None:
    lexical_root = lexical_candidate
    for _ in canonical_relative.parts:
        lexical_root = lexical_root.parent
    try:
        lexical_root_metadata = os.lstat(lexical_root)
        if (
            stat.S_ISLNK(lexical_root_metadata.st_mode)
            or not stat.S_ISDIR(lexical_root_metadata.st_mode)
            or lexical_root.resolve(strict=True) != repository_root
        ):
            _reject_output()
        lexical_relative = lexical_candidate.relative_to(lexical_root)
    except InputPreflightError:
        raise
    except (OSError, RuntimeError, ValueError):
        _reject_output()

    current = lexical_root
    for component in lexical_relative.parts:
        current /= component
        try:
            metadata = os.lstat(current)
        except FileNotFoundError:
            return
        except OSError:
            _reject_output()
        if stat.S_ISLNK(metadata.st_mode):
            _reject_output()
        if current != lexical_candidate and not stat.S_ISDIR(metadata.st_mode):
            _reject_output()


def _revalidate_output_target(
    lexical_candidate: Path,
    canonical_candidate: Path,
    initial_metadata: os.stat_result | None,
) -> None:
    try:
        if lexical_candidate.resolve(strict=False) != canonical_candidate:
            _reject()
        final_metadata = os.lstat(lexical_candidate)
    except FileNotFoundError:
        if initial_metadata is not None:
            _reject_output()
        return
    except InputPreflightError:
        raise
    except (OSError, RuntimeError, ValueError):
        _reject_output()

    if (
        initial_metadata is None
        or stat.S_ISLNK(final_metadata.st_mode)
        or not stat.S_ISDIR(final_metadata.st_mode)
        or (final_metadata.st_dev, final_metadata.st_ino)
        != (initial_metadata.st_dev, initial_metadata.st_ino)
    ):
        _reject_output()


def _preflight_output_directory(path: Path) -> Path:
    lexical_candidate = _lexical_absolute(
        path,
        FailureCategory.IGNORE_POLICY,
    )

    try:
        candidate_metadata = os.lstat(lexical_candidate)
    except FileNotFoundError:
        candidate_metadata = None
    except OSError:
        _reject_output()
    if candidate_metadata is not None:
        if stat.S_ISLNK(candidate_metadata.st_mode) or not stat.S_ISDIR(
            candidate_metadata.st_mode
        ):
            _reject_output()

    try:
        candidate = lexical_candidate.resolve(strict=False)
    except (OSError, RuntimeError):
        _reject_output()

    existing_directory = _nearest_existing_directory(candidate)
    repository_root = _repository_root(existing_directory)
    try:
        relative = candidate.relative_to(repository_root)
    except ValueError:
        _reject_output()
    if relative == Path("."):
        _reject_output()
    _verify_lexical_repository_boundary(
        lexical_candidate,
        repository_root,
        relative,
    )

    relative_text = relative.as_posix()
    tracked = _run_git(
        repository_root,
        ("ls-files", "--error-unmatch", "--", relative_text),
    )
    if tracked.returncode == 0:
        _reject_output()
    if tracked.returncode != 1:
        _reject_output()

    ignored = _run_git(
        repository_root,
        (
            "check-ignore",
            "--quiet",
            "--no-index",
            "--",
            relative_text.rstrip("/") + "/",
        ),
    )
    if ignored.returncode != 0:
        _reject_output()
    _revalidate_output_target(
        lexical_candidate,
        candidate,
        candidate_metadata,
    )
    return candidate


def preflight_inputs(selection: InputSelection) -> PreflightedInputs:
    """Validate roles and paths without opening or reading source content."""

    if (
        not isinstance(selection, InputSelection)
        or not isinstance(selection.annual_sources, tuple)
        or not isinstance(selection.overlap_verifications, tuple)
        or not isinstance(selection.output_directory, Path)
        or not selection.annual_sources
        or not all(
            isinstance(path, Path)
            for path in (
                *selection.annual_sources,
                *selection.overlap_verifications,
            )
        )
    ):
        _reject()

    annual_source_metadata = tuple(
        _preflight_source(path) for path in selection.annual_sources
    )
    overlap_verification_metadata = tuple(
        _preflight_source(path) for path in selection.overlap_verifications
    )

    if len(annual_source_metadata) > MAX_ANNUAL_SOURCES:
        _reject(
            InputPreflightReasonCode.ANNUAL_SOURCE_COUNT_LIMIT_EXCEEDED,
            FailureCategory.CAPACITY,
        )

    all_source_metadata = (
        annual_source_metadata + overlap_verification_metadata
    )
    if any(
        source.size_bytes > MAX_RAW_INPUT_BYTES
        for source in all_source_metadata
    ):
        _reject(
            InputPreflightReasonCode.RAW_INPUT_FILE_LIMIT_EXCEEDED,
            FailureCategory.CAPACITY,
        )

    aggregate_size_bytes = sum(
        source.size_bytes for source in all_source_metadata
    )
    if aggregate_size_bytes > MAX_AGGREGATE_RAW_INPUT_BYTES:
        _reject(
            InputPreflightReasonCode.AGGREGATE_RAW_INPUT_LIMIT_EXCEEDED,
            FailureCategory.CAPACITY,
        )

    output_directory = _preflight_output_directory(selection.output_directory)
    for source in all_source_metadata:
        _revalidate_source(source)

    return PreflightedInputs(
        annual_sources=tuple(
            source.resolved_path for source in annual_source_metadata
        ),
        overlap_verifications=tuple(
            source.resolved_path for source in overlap_verification_metadata
        ),
        output_directory=output_directory,
    )
