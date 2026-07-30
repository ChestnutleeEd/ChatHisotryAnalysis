"""Content-free project error categories."""

from __future__ import annotations

from enum import Enum
from typing import Final


STARTUP_PHASE: Final = "startup"
INPUT_PREFLIGHT_PHASE: Final = "input-preflight"


class StartupReasonCode(str, Enum):
    """Stable public startup failure categories."""

    UNSUPPORTED_PYTHON_RUNTIME = "UNSUPPORTED_PYTHON_RUNTIME"
    IJSON_DISTRIBUTION_UNVERIFIED = "IJSON_DISTRIBUTION_UNVERIFIED"
    IJSON_BACKEND_UNAVAILABLE = "IJSON_BACKEND_UNAVAILABLE"
    IJSON_BACKEND_MISMATCH = "IJSON_BACKEND_MISMATCH"
    IJSON_PARSER_INITIALIZATION_FAILED = "IJSON_PARSER_INITIALIZATION_FAILED"


class StartupError(Exception):
    """A startup failure whose public form contains no internal exception data."""

    def __init__(self, reason_code: StartupReasonCode) -> None:
        self.reason_code = reason_code
        super().__init__(reason_code.value)

    def public_payload(self) -> dict[str, str]:
        """Return the complete allow-listed user-visible representation."""

        return {
            "phase": STARTUP_PHASE,
            "reasonCode": self.reason_code.value,
        }


class InputPreflightReasonCode(str, Enum):
    """One bounded Stage 2A category, before task 2.8 exit-code work."""

    INPUT_PREFLIGHT_FAILED = "INPUT_PREFLIGHT_FAILED"


class InputPreflightError(Exception):
    """An input preflight failure with no path or internal exception data."""

    def __init__(
        self,
        reason_code: InputPreflightReasonCode = (
            InputPreflightReasonCode.INPUT_PREFLIGHT_FAILED
        ),
    ) -> None:
        self.reason_code = reason_code
        super().__init__(reason_code.value)

    def public_payload(self) -> dict[str, str]:
        """Return the complete allow-listed user-visible representation."""

        return {
            "phase": INPUT_PREFLIGHT_PHASE,
            "reasonCode": self.reason_code.value,
        }
