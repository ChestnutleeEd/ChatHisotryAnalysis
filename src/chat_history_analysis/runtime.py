"""Supported interpreter and platform boundary."""

from __future__ import annotations

from dataclasses import dataclass
import platform
import sys
from typing import Final


EXPECTED_IMPLEMENTATION: Final = "CPython"
EXPECTED_PYTHON_MAJOR: Final = 3
EXPECTED_PYTHON_MINOR: Final = 12
EXPECTED_SYSTEM: Final = "Darwin"
EXPECTED_ARCHITECTURE: Final = "arm64"


@dataclass(frozen=True)
class RuntimeFacts:
    """Non-I/O runtime facts used by the startup gate."""

    implementation: str
    version: tuple[int, int, int]
    system: str
    architecture: str


def inspect_runtime() -> RuntimeFacts:
    """Inspect the current interpreter without opening user data."""

    return RuntimeFacts(
        implementation=platform.python_implementation(),
        version=(sys.version_info.major, sys.version_info.minor, sys.version_info.micro),
        system=platform.system(),
        architecture=platform.machine(),
    )
