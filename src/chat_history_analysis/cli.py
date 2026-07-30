"""Content-free local CLI using the single production composition root."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys
from typing import Callable, Sequence

from .application import (
    PreprocessingResult,
    run_overlap_verification,
    run_preprocessing,
    run_startup_check,
    run_staging_recovery,
)
from .errors import (
    OUTPUT_PROMOTION_PHASE,
    OUTPUT_SERIALIZATION_PHASE,
    OVERLAP_VERIFICATION_PHASE,
    RECOVERY_PHASE,
    SOURCE_VALIDATION_PHASE,
    STARTUP_PHASE,
    ArgumentError,
    DatasetPersistenceError,
    DatasetPersistenceReasonCode,
    ExitCode,
    FailureCategory,
    InputPreflightError,
    SourceValidationError,
    StartupError,
    StartupReasonCode,
)
from .input_preflight import InputSelection, OverlapVerificationSelection
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
    verify = commands.add_parser(
        "verify-overlap",
        help="compare explicit verification sources with a normalized dataset",
    )
    verify.add_argument(
        "--dataset-dir",
        required=True,
        type=Path,
        metavar="DIRECTORY",
    )
    verify.add_argument(
        "--overlap-verification",
        action="append",
        required=True,
        type=Path,
        metavar="FILE",
    )
    recovery = commands.add_parser(
        "recover-staging",
        help="inspect or remove one recognized private staging remnant",
    )
    recovery.add_argument(
        "--output-parent",
        required=True,
        type=Path,
        metavar="DIRECTORY",
    )
    recovery.add_argument(
        "--candidate-ordinal",
        type=int,
        metavar="N",
    )
    recovery.add_argument(
        "--confirm",
        action="store_true",
    )
    return parser


def _run_for_test(
    argv: Sequence[str] | None,
    application_runner: Callable[[], None],
    input_preflight_runner: Callable[
        [InputSelection],
        ValidationResult | object | None,
    ] = run_preprocessing,
    overlap_verification_runner=run_overlap_verification,
    recovery_runner=run_staging_recovery,
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
                        "eligibleTextCount": (
                            result.annual_normalization.eligible_count
                        ),
                        "skippedRecordCount": (
                            result.annual_normalization.skipped_count
                        ),
                        "warningCount": (
                            result.annual_normalization.warning_count
                        ),
                    }
                )
            elif isinstance(result, PreprocessingResult):
                validation = result.validation
                success_payload.update(
                    {
                        "annualSourceCount": len(
                            validation.annual_sources
                        ),
                        "overlapVerificationCount": len(
                            validation.overlap_verifications
                        ),
                        "rawMessageCount": (
                            validation.aggregate_raw_message_count
                        ),
                        "eligibleTextCount": (
                            validation.annual_normalization.eligible_count
                        ),
                        "skippedRecordCount": (
                            validation.annual_normalization.skipped_count
                        ),
                        "warningCount": (
                            result.dataset.warning_count
                        ),
                        "normalizedRecordCount": (
                            result.dataset.normalized_record_count
                        ),
                        "duplicateRecordCount": (
                            result.dataset.duplicate_record_count
                        ),
                        "chunkCount": result.dataset.chunk_count,
                        "annualRangeOverlapCount": (
                            result.dataset.annual_range_overlap_count
                        ),
                        "suspiciousAnnualOverlapCount": (
                            result.dataset.suspicious_annual_overlap_count
                        ),
                        "matchedVerificationRecordCount": (
                            result.dataset.matched_verification_record_count
                        ),
                        "unmatchedVerificationRecordCount": (
                            result.dataset.unmatched_verification_record_count
                        ),
                        "verificationMatchPercentage": (
                            0
                            if (
                                result.dataset.matched_verification_record_count
                                + result.dataset.unmatched_verification_record_count
                                == 0
                            )
                            else round(
                                100
                                * result.dataset.matched_verification_record_count
                                / (
                                    result.dataset.matched_verification_record_count
                                    + result.dataset.unmatched_verification_record_count
                                ),
                                2,
                            )
                        ),
                    }
                )
                phase = OUTPUT_PROMOTION_PHASE
                success_payload["phase"] = phase
        elif arguments.command == "verify-overlap":
            result = overlap_verification_runner(
                OverlapVerificationSelection(
                    dataset_directory=arguments.dataset_dir,
                    overlap_verifications=tuple(
                        arguments.overlap_verification
                    ),
                )
            )
            success_payload = {
                "phase": OVERLAP_VERIFICATION_PHASE,
                "status": "ready",
                "sourceCount": result.source_count,
                "eligibleRecordCount": result.eligible_record_count,
                "matchedRecordCount": result.matched_record_count,
                "unmatchedRecordCount": result.unmatched_record_count,
                "matchPercentage": (
                    0
                    if result.eligible_record_count == 0
                    else round(
                        100
                        * result.matched_record_count
                        / result.eligible_record_count,
                        2,
                    )
                ),
            }
        elif arguments.command == "recover-staging":
            result = recovery_runner(
                arguments.output_parent,
                candidate_ordinal=arguments.candidate_ordinal,
                confirmed=arguments.confirm,
            )
            success_payload = {
                "phase": RECOVERY_PHASE,
                "status": "ready",
                "candidateCount": result.candidate_count,
                "removedCount": result.removed_count,
                "stateCodes": list(result.state_codes),
            }
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
    except DatasetPersistenceError as error:
        print(json.dumps(error.public_payload(), sort_keys=True), file=sys.stderr)
        return _classified_exit(error.category)
    except Exception:
        if arguments.command == "startup-check":
            error = StartupError(
                StartupReasonCode.IJSON_PARSER_INITIALIZATION_FAILED
            )
            exit_code = ExitCode.STARTUP_FAILURE
        elif arguments.command == "preprocess":
            error = DatasetPersistenceError(
                DatasetPersistenceReasonCode.OUTPUT_WRITE_FAILED,
                phase=OUTPUT_SERIALIZATION_PHASE,
                category=FailureCategory.OUTPUT,
            )
            exit_code = ExitCode.OUTPUT_FAILURE
        elif arguments.command == "verify-overlap":
            error = DatasetPersistenceError(
                DatasetPersistenceReasonCode.OVERLAP_VERIFICATION_FAILED,
                phase=OVERLAP_VERIFICATION_PHASE,
                category=FailureCategory.VERIFICATION,
            )
            exit_code = ExitCode.VERIFICATION_FAILURE
        elif arguments.command == "recover-staging":
            error = DatasetPersistenceError(
                DatasetPersistenceReasonCode.RECOVERY_CLEANUP_FAILED,
                phase=RECOVERY_PHASE,
                category=FailureCategory.OUTPUT,
            )
            exit_code = ExitCode.OUTPUT_FAILURE
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
    if category is FailureCategory.OUTPUT:
        return int(ExitCode.OUTPUT_FAILURE)
    if category is FailureCategory.VERIFICATION:
        return int(ExitCode.VERIFICATION_FAILURE)
    return int(ExitCode.INPUT_VALIDATION_FAILURE)


def main(argv: Sequence[str] | None = None) -> int:
    """Run the non-injectable production readiness command."""

    return _run_for_test(
        argv,
        run_startup_check,
        run_preprocessing,
    )
