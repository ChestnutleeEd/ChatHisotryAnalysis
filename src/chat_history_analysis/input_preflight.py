"""Explicit input roles and metadata-only local path preflight."""

from __future__ import annotations

from dataclasses import dataclass
import os
from pathlib import Path
import stat
import subprocess
from typing import Final, Iterable

from .errors import InputPreflightError


GIT_EXECUTABLE: Final = "git"
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
    """Normalized local paths that passed the bounded Stage 2A preflight."""

    annual_sources: tuple[Path, ...]
    overlap_verifications: tuple[Path, ...]
    output_directory: Path


def _reject() -> None:
    raise InputPreflightError


def _lexical_absolute(path: Path) -> Path:
    try:
        value = os.fspath(path)
        if not value or "\x00" in value:
            _reject()
        return Path(os.path.abspath(value))
    except InputPreflightError:
        raise
    except (OSError, TypeError, ValueError):
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


def _preflight_source(path: Path) -> Path:
    lexical_candidate = _lexical_absolute(path)
    try:
        metadata = os.lstat(lexical_candidate)
    except (OSError, ValueError):
        _reject()
    if stat.S_ISLNK(metadata.st_mode) or not stat.S_ISREG(metadata.st_mode):
        _reject()
    if not _path_is_readable(lexical_candidate, metadata.st_mode):
        _reject()
    try:
        resolved = lexical_candidate.resolve(strict=True)
        final_metadata = os.lstat(lexical_candidate)
        resolved_metadata = os.stat(resolved, follow_symlinks=False)
    except (OSError, RuntimeError, ValueError):
        _reject()
    if (
        stat.S_ISLNK(final_metadata.st_mode)
        or not stat.S_ISREG(final_metadata.st_mode)
        or not stat.S_ISREG(resolved_metadata.st_mode)
        or (final_metadata.st_dev, final_metadata.st_ino)
        != (metadata.st_dev, metadata.st_ino)
        or (resolved_metadata.st_dev, resolved_metadata.st_ino)
        != (metadata.st_dev, metadata.st_ino)
    ):
        _reject()
    return resolved


def _nearest_existing_directory(path: Path) -> Path:
    current = path
    while True:
        try:
            metadata = os.lstat(current)
        except FileNotFoundError:
            parent = current.parent
            if parent == current:
                _reject()
            current = parent
            continue
        except OSError:
            _reject()
        if stat.S_ISLNK(metadata.st_mode) or not stat.S_ISDIR(metadata.st_mode):
            _reject()
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
        _reject()


def _repository_root(existing_directory: Path) -> Path:
    result = _run_git(
        existing_directory,
        ("rev-parse", "--show-toplevel"),
        capture_stdout=True,
    )
    if result.returncode != 0:
        _reject()
    try:
        root_text = result.stdout.strip()
        if not root_text:
            _reject()
        root = Path(root_text).resolve(strict=True)
        metadata = os.stat(root, follow_symlinks=False)
    except InputPreflightError:
        raise
    except (OSError, RuntimeError, ValueError):
        _reject()
    if not stat.S_ISDIR(metadata.st_mode):
        _reject()
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
            _reject()
        lexical_relative = lexical_candidate.relative_to(lexical_root)
    except InputPreflightError:
        raise
    except (OSError, RuntimeError, ValueError):
        _reject()

    current = lexical_root
    for component in lexical_relative.parts:
        current /= component
        try:
            metadata = os.lstat(current)
        except FileNotFoundError:
            return
        except OSError:
            _reject()
        if stat.S_ISLNK(metadata.st_mode):
            _reject()
        if current != lexical_candidate and not stat.S_ISDIR(metadata.st_mode):
            _reject()


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
            _reject()
        return
    except InputPreflightError:
        raise
    except (OSError, RuntimeError, ValueError):
        _reject()

    if (
        initial_metadata is None
        or stat.S_ISLNK(final_metadata.st_mode)
        or not stat.S_ISDIR(final_metadata.st_mode)
        or (final_metadata.st_dev, final_metadata.st_ino)
        != (initial_metadata.st_dev, initial_metadata.st_ino)
    ):
        _reject()


def _preflight_output_directory(path: Path) -> Path:
    lexical_candidate = _lexical_absolute(path)

    try:
        candidate_metadata = os.lstat(lexical_candidate)
    except FileNotFoundError:
        candidate_metadata = None
    except OSError:
        _reject()
    if candidate_metadata is not None:
        if stat.S_ISLNK(candidate_metadata.st_mode) or not stat.S_ISDIR(
            candidate_metadata.st_mode
        ):
            _reject()

    try:
        candidate = lexical_candidate.resolve(strict=False)
    except (OSError, RuntimeError):
        _reject()

    existing_directory = _nearest_existing_directory(candidate)
    repository_root = _repository_root(existing_directory)
    try:
        relative = candidate.relative_to(repository_root)
    except ValueError:
        _reject()
    if relative == Path("."):
        _reject()
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
        _reject()
    if tracked.returncode != 1:
        _reject()

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
        _reject()
    _revalidate_output_target(
        lexical_candidate,
        candidate,
        candidate_metadata,
    )
    return candidate


def preflight_inputs(selection: InputSelection) -> PreflightedInputs:
    """Validate roles and paths without opening or reading source content."""

    if not selection.annual_sources:
        _reject()

    annual_sources = tuple(
        _preflight_source(path) for path in selection.annual_sources
    )
    overlap_verifications = tuple(
        _preflight_source(path) for path in selection.overlap_verifications
    )
    output_directory = _preflight_output_directory(selection.output_directory)
    return PreflightedInputs(
        annual_sources=annual_sources,
        overlap_verifications=overlap_verifications,
        output_directory=output_directory,
    )
