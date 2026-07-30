"""Python 3.9-compatible runtime rejection before application imports."""

import json
import platform
import sys


_EXPECTED_IMPLEMENTATION = "CPython"
_EXPECTED_PYTHON = (3, 12)
_EXPECTED_SYSTEM = "Darwin"
_EXPECTED_ARCHITECTURE = "arm64"
_STARTUP_PHASE = "startup"
_UNSUPPORTED_RUNTIME = "UNSUPPORTED_PYTHON_RUNTIME"
_INTERNAL_FAILURE = "IJSON_PARSER_INITIALIZATION_FAILED"


def _runtime_is_supported():
    return (
        platform.python_implementation() == _EXPECTED_IMPLEMENTATION
        and sys.version_info[:2] == _EXPECTED_PYTHON
        and platform.system() == _EXPECTED_SYSTEM
        and platform.machine() == _EXPECTED_ARCHITECTURE
    )


def _emit_failure(reason_code):
    print(
        json.dumps(
            {"phase": _STARTUP_PHASE, "reasonCode": reason_code},
            sort_keys=True,
        ),
        file=sys.stderr,
    )


def main(argv=None):
    """Reject unsupported runtimes before importing the application."""

    if not _runtime_is_supported():
        _emit_failure(_UNSUPPORTED_RUNTIME)
        return 2
    try:
        from .cli import main as application_main
    except Exception:
        _emit_failure(_INTERNAL_FAILURE)
        return 2
    return application_main(argv)
