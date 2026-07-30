"""Single production composition root for readiness and future source access."""

from __future__ import annotations

from typing import Callable, TypeVar

from .backend import BackendEvidence
from .errors import StartupError, StartupReasonCode
from .input_preflight import InputSelection, PreflightedInputs, preflight_inputs
from .preprocessing_validation import (
    ValidationResult,
    validate_preflighted_inputs,
)
from .startup import StartupGate


T = TypeVar("T")
_CONSTRUCTION_KEY = object()
_AUTHORIZATION_KEY = object()


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
        backend = self._gate.verify()
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
        inputs = preflight_inputs(selection)
        return validate_preflighted_inputs(
            inputs,
            authorization.trusted_backend(),
        )

    return run_source_operation(validate)
