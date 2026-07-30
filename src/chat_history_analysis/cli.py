"""Readiness-only local CLI using the production composition root."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys
from typing import Callable, Sequence

from .application import run_input_preflight, run_startup_check
from .errors import (
    INPUT_PREFLIGHT_PHASE,
    STARTUP_PHASE,
    InputPreflightError,
    StartupError,
    StartupReasonCode,
)
from .input_preflight import InputSelection, PreflightedInputs


class _ContentFreeArgumentParser(argparse.ArgumentParser):
    def error(self, message: str) -> None:
        """Reject invalid readiness invocations without echoing user input."""

        self.print_usage(sys.stderr)
        raise SystemExit(2)


def _parser() -> argparse.ArgumentParser:
    parser = _ContentFreeArgumentParser(prog="chat-history-analysis")
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser(
        "startup-check",
        help="verify the approved local preprocessing runtime",
    )
    preprocess = commands.add_parser(
        "preprocess",
        help="validate explicit local preprocessing inputs",
    )
    preprocess.add_argument(
        "--annual-source",
        action="append",
        required=True,
        type=Path,
        metavar="FILE",
    )
    preprocess.add_argument(
        "--overlap-verification",
        action="append",
        default=[],
        type=Path,
        metavar="FILE",
    )
    preprocess.add_argument(
        "--output-dir",
        required=True,
        type=Path,
        metavar="DIRECTORY",
    )
    return parser


def _run_for_test(
    argv: Sequence[str] | None,
    application_runner: Callable[[], None],
    input_preflight_runner: Callable[
        [InputSelection],
        PreflightedInputs | None,
    ] = run_input_preflight,
) -> int:
    """Private dependency-injection seam; production main never accepts it."""

    arguments = _parser().parse_args(argv)

    try:
        if arguments.command == "startup-check":
            application_runner()
            phase = STARTUP_PHASE
        elif arguments.command == "preprocess":
            selection = InputSelection(
                annual_sources=tuple(arguments.annual_source),
                overlap_verifications=tuple(arguments.overlap_verification),
                output_directory=arguments.output_dir,
            )
            input_preflight_runner(selection)
            phase = INPUT_PREFLIGHT_PHASE
        else:
            return 2
    except StartupError as error:
        print(json.dumps(error.public_payload(), sort_keys=True), file=sys.stderr)
        return 2
    except InputPreflightError as error:
        print(json.dumps(error.public_payload(), sort_keys=True), file=sys.stderr)
        return 2
    except Exception:
        if arguments.command == "startup-check":
            error = StartupError(
                StartupReasonCode.IJSON_PARSER_INITIALIZATION_FAILED
            )
        else:
            error = InputPreflightError()
        print(json.dumps(error.public_payload(), sort_keys=True), file=sys.stderr)
        return 2

    print(json.dumps({"phase": phase, "status": "ready"}, sort_keys=True))
    return 0


def main(argv: Sequence[str] | None = None) -> int:
    """Run the non-injectable production readiness command."""

    return _run_for_test(argv, run_startup_check, run_input_preflight)
