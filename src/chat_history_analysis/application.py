"""Single production composition root for readiness and future source access."""

from __future__ import annotations

from typing import Callable, TypeVar

from .input_preflight import InputSelection, PreflightedInputs, preflight_inputs
from .startup import StartupGate


T = TypeVar("T")
_CONSTRUCTION_KEY = object()
_AUTHORIZATION_KEY = object()


class _SourceAuthorization:
    """Unforgeable-by-construction capability passed only after readiness."""

    __slots__ = ()

    def __new__(cls, key: object) -> "_SourceAuthorization":
        if key is not _AUTHORIZATION_KEY:
            raise TypeError
        return super().__new__(cls)


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
        self._gate.verify()
        authorization = _SourceAuthorization(_AUTHORIZATION_KEY)
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
