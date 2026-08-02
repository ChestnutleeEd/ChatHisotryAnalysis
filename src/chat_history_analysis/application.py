"""Single production composition root for readiness and future source access."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Callable, TypeVar

from .backend import BackendEvidence
from .canonical_dataset import (
    CanonicalDatasetBuildResult,
    CanonicalEventStagingConsumer,
)
from .errors import (
    INPUT_PREFLIGHT_PHASE,
    STARTUP_PHASE,
    StartupError,
    StartupReasonCode,
)
from .dataset_persistence import (
    DatasetBuildResult,
    DatasetStagingConsumer,
    OverlapVerificationResult,
    RecoveryResult,
    recover_staging_remnant,
    verify_overlap_against_dataset,
)
from .input_preflight import (
    InputSelection,
    OverlapVerificationSelection,
    PreflightedInputs,
    preflight_desktop_inputs,
    preflight_ignored_existing_directory,
    preflight_inputs,
    preflight_overlap_verification,
)
from .preprocessing_validation import (
    ValidationResult,
    validate_preflighted_inputs,
    validate_preflighted_inputs_v2,
)
from .operation_control import current_operation_control
from .startup import StartupGate


T = TypeVar("T")
_CONSTRUCTION_KEY = object()
_AUTHORIZATION_KEY = object()


@dataclass(frozen=True)
class PreprocessingResult:
    """Content-free successful Stage 5/6 outcome."""

    validation: ValidationResult
    dataset: DatasetBuildResult


@dataclass(frozen=True)
class CanonicalPreprocessingResult:
    """Successful product v2 event-dataset publication."""

    validation: ValidationResult
    dataset: CanonicalDatasetBuildResult


class _SourceAuthorization:
    """Unforgeable-by-construction capability passed only after readiness."""

    __slots__ = ("_backend",)

    def __new__(
        cls,
        key: object,
        backend: BackendEvidence | None = None,
    ) -> "_SourceAuthorization":
        if key is not _AUTHORIZATION_KEY:
            raise TypeError
        instance = super().__new__(cls)
        instance._backend = backend
        return instance

    def trusted_backend(self) -> BackendEvidence:
        """Return only backend evidence produced by the completed gate."""

        if not isinstance(self._backend, BackendEvidence):
            raise StartupError(
                StartupReasonCode.IJSON_PARSER_INITIALIZATION_FAILED
            )
        return self._backend


class _PreprocessorApplication:
    """Own the mandatory gate-to-source-operation ordering."""

    __slots__ = ("_gate",)

    def __init__(self, key: object, gate: StartupGate) -> None:
        if key is not _CONSTRUCTION_KEY:
            raise TypeError
        self._gate = gate

    def run_source_operation(
        self,
        operation: Callable[[_SourceAuthorization], T],
    ) -> T:
        control = current_operation_control()
        control.phase_progress(STARTUP_PHASE, 0, 1, force=True)
        control.checkpoint(STARTUP_PHASE, "startup-before-gate")
        backend = self._gate.verify()
        control.checkpoint(STARTUP_PHASE, "startup-after-gate")
        control.phase_progress(STARTUP_PHASE, 1, 1, force=True)
        authorization = _SourceAuthorization(_AUTHORIZATION_KEY, backend)
        return operation(authorization)


def _production_application() -> _PreprocessorApplication:
    return _PreprocessorApplication(_CONSTRUCTION_KEY, StartupGate())


def run_source_operation(
    operation: Callable[[_SourceAuthorization], T],
) -> T:
    """Run the sole production continuation path after the real startup gate."""

    return _production_application().run_source_operation(operation)


def run_startup_check() -> None:
    """Use the production source-access root with a no-op readiness continuation."""

    run_source_operation(lambda authorization: None)


def run_input_preflight(selection: InputSelection) -> PreflightedInputs:
    """Validate selected paths only after the complete production startup gate."""

    return run_source_operation(
        lambda authorization: preflight_inputs(selection),
    )


def run_preprocessing_validation(
    selection: InputSelection,
) -> ValidationResult:
    """Run metadata and all streaming passes behind the production gate."""

    def validate(authorization: _SourceAuthorization) -> ValidationResult:
        control = current_operation_control()
        control.phase_progress(INPUT_PREFLIGHT_PHASE, 0, 1, force=True)
        control.checkpoint(INPUT_PREFLIGHT_PHASE, "preflight-before")
        inputs = preflight_inputs(selection)
        control.checkpoint(INPUT_PREFLIGHT_PHASE, "preflight-after")
        control.phase_progress(INPUT_PREFLIGHT_PHASE, 1, 1, force=True)
        return validate_preflighted_inputs(
            inputs,
            authorization.trusted_backend(),
        )

    return run_source_operation(validate)


def run_preprocessing(selection: InputSelection) -> PreprocessingResult:
    """Run the complete production pipeline and atomically publish output."""

    def preprocess(authorization: _SourceAuthorization) -> PreprocessingResult:
        control = current_operation_control()
        control.phase_progress(INPUT_PREFLIGHT_PHASE, 0, 1, force=True)
        control.checkpoint(INPUT_PREFLIGHT_PHASE, "preflight-before")
        inputs = preflight_inputs(selection)
        control.checkpoint(INPUT_PREFLIGHT_PHASE, "preflight-after")
        control.phase_progress(INPUT_PREFLIGHT_PHASE, 1, 1, force=True)
        consumer = DatasetStagingConsumer(inputs.output_directory)
        try:
            validation = validate_preflighted_inputs(
                inputs,
                authorization.trusted_backend(),
                staging_consumer=consumer,
            )
            dataset = consumer.publish(validation)
            return PreprocessingResult(
                validation=validation,
                dataset=dataset,
            )
        except BaseException:
            consumer.abort()
            raise

    return run_source_operation(preprocess)


def run_preprocessing_v2(
    selection: InputSelection,
) -> CanonicalPreprocessingResult:
    """Run v2 with the application-cache output policy."""

    def preprocess(
        authorization: _SourceAuthorization,
    ) -> CanonicalPreprocessingResult:
        control = current_operation_control()
        control.phase_progress(INPUT_PREFLIGHT_PHASE, 0, 1, force=True)
        control.checkpoint(INPUT_PREFLIGHT_PHASE, "preflight-v2-before")
        inputs = preflight_desktop_inputs(selection)
        control.checkpoint(INPUT_PREFLIGHT_PHASE, "preflight-v2-after")
        control.phase_progress(INPUT_PREFLIGHT_PHASE, 1, 1, force=True)
        consumer = CanonicalEventStagingConsumer(inputs.output_directory)
        try:
            validation = validate_preflighted_inputs_v2(
                inputs,
                authorization.trusted_backend(),
                canonical_event_consumer=consumer,
            )
            dataset = consumer.publish(validation)
            return CanonicalPreprocessingResult(
                validation=validation,
                dataset=dataset,
            )
        except BaseException:
            consumer.abort()
            raise

    return run_source_operation(preprocess)


def run_overlap_verification(
    selection: OverlapVerificationSelection,
) -> OverlapVerificationResult:
    """Run the separate read-only verification command."""

    def verify(authorization: _SourceAuthorization) -> OverlapVerificationResult:
        inputs = preflight_overlap_verification(selection)
        return verify_overlap_against_dataset(
            inputs,
            authorization.trusted_backend(),
        )

    return run_source_operation(verify)


def run_staging_recovery(
    output_parent: Path,
    *,
    candidate_ordinal: int | None,
    confirmed: bool,
) -> RecoveryResult:
    """Inspect or logically remove one explicitly selected crash remnant."""

    def recover(authorization: _SourceAuthorization) -> RecoveryResult:
        parent = preflight_ignored_existing_directory(output_parent)
        return recover_staging_remnant(
            parent,
            candidate_ordinal=candidate_ordinal,
            confirmed=confirmed,
        )

    return run_source_operation(recover)
