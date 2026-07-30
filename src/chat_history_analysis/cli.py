"""Content-free local CLI using the single production composition root."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys
from typing import Callable, Sequence

from .application import run_preprocessing_validation, run_startup_check
from .errors import (
    SOURCE_VALIDATION_PHASE,
    STARTUP_PHASE,
    ArgumentError,
    ExitCode,
    FailureCategory,
    InputPreflightError,
    SourceValidationError,
    StartupError,
    StartupReasonCode,
)
from .input_preflight import InputSelection
from .preprocessing_validation import ValidationResult


class _ContentFreeArgumentParser(argparse.ArgumentParser):
    def error(self, message: str) -> None:
        """Reject invalid readiness invocations without echoing user input."""

        raise ArgumentError


def _parser() -> argparse.ArgumentParser:
    parser = _ContentFreeArgumentParser(prog="chat-history-analysis")
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser(
        "startup-check",
        help="verify the approved local preprocessing runtime",
    )
    preprocess = commands.add_parser(
        "preprocess",
        help="stream and validate explicit local preprocessing inputs",
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
        ValidationResult | object | None,
    ] = run_preprocessing_validation,
) -> int:
    """Private dependency-injection seam; production main never accepts it."""

    try:
        arguments = _parser().parse_args(argv)
    except ArgumentError as error:
        print(json.dumps(error.public_payload(), sort_keys=True), file=sys.stderr)
        return int(ExitCode.ARGUMENT_FAILURE)

    try:
        if arguments.command == "startup-check":
            application_runner()
            phase = STARTUP_PHASE
            success_payload: dict[str, str | int] = {
                "phase": phase,
                "status": "ready",
            }
        elif arguments.command == "preprocess":
            selection = InputSelection(
                annual_sources=tuple(arguments.annual_source),
                overlap_verifications=tuple(arguments.overlap_verification),
                output_directory=arguments.output_dir,
            )
            result = input_preflight_runner(selection)
            phase = SOURCE_VALIDATION_PHASE
            success_payload = {
                "phase": phase,
                "status": "ready",
            }
            if isinstance(result, ValidationResult):
                success_payload.update(
                    {
                        "annualSourceCount": len(result.annual_sources),
                        "overlapVerificationCount": len(
                            result.overlap_verifications
                        ),
                        "rawMessageCount": (
                            result.aggregate_raw_message_count
                        ),
                    }
                )
        else:
            error = ArgumentError()
            print(
                json.dumps(error.public_payload(), sort_keys=True),
                file=sys.stderr,
            )
            return int(ExitCode.ARGUMENT_FAILURE)
    except StartupError as error:
        print(json.dumps(error.public_payload(), sort_keys=True), file=sys.stderr)
        return int(ExitCode.STARTUP_FAILURE)
    except InputPreflightError as error:
        print(json.dumps(error.public_payload(), sort_keys=True), file=sys.stderr)
        return _classified_exit(error.category)
    except SourceValidationError as error:
        print(json.dumps(error.public_payload(), sort_keys=True), file=sys.stderr)
        return _classified_exit(error.category)
    except Exception:
        if arguments.command == "startup-check":
            error = StartupError(
                StartupReasonCode.IJSON_PARSER_INITIALIZATION_FAILED
            )
            exit_code = ExitCode.STARTUP_FAILURE
        else:
            error = InputPreflightError()
            exit_code = ExitCode.INPUT_VALIDATION_FAILURE
        print(json.dumps(error.public_payload(), sort_keys=True), file=sys.stderr)
        return int(exit_code)

    print(json.dumps(success_payload, sort_keys=True))
    return int(ExitCode.SUCCESS)


def _classified_exit(category: FailureCategory) -> int:
    if category is FailureCategory.IGNORE_POLICY:
        return int(ExitCode.IGNORE_POLICY_FAILURE)
    if category is FailureCategory.CAPACITY:
        return int(ExitCode.CAPACITY_FAILURE)
    return int(ExitCode.INPUT_VALIDATION_FAILURE)


def main(argv: Sequence[str] | None = None) -> int:
    """Run the non-injectable production readiness command."""

    return _run_for_test(
        argv,
        run_startup_check,
        run_preprocessing_validation,
    )
