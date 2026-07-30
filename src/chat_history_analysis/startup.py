"""Deterministic pre-open startup gate."""

from __future__ import annotations

from dataclasses import dataclass
import io
from typing import Callable, Final

from .backend import (
    BackendEvidence,
    BackendLoadFailure,
    backend_identity_is_exact,
    load_exact_backend,
)
from .distribution import (
    EXPECTED_DISTRIBUTION_VERSION,
    InstalledDistributionEvidence,
    distribution_is_approved,
    inspect_installed_distribution,
)
from .errors import StartupError, StartupReasonCode
from .runtime import (
    EXPECTED_ARCHITECTURE,
    EXPECTED_IMPLEMENTATION,
    EXPECTED_PYTHON_MAJOR,
    EXPECTED_PYTHON_MINOR,
    EXPECTED_SYSTEM,
    RuntimeFacts,
    inspect_runtime,
)


SELF_CHECK_DOCUMENT: Final = b'{"ready":[1]}'
SELF_CHECK_REJECTED_DOCUMENTS: Final = (
    b'{"ready":[1]',
    b'{"ready":/*comment*/[1]}',
    b'{"ready":[1]} {"extra":2}',
)
SELF_CHECK_EVENTS: Final = (
    ("", "start_map", None),
    ("", "map_key", "ready"),
    ("ready", "start_array", None),
    ("ready.item", "number", 1),
    ("ready", "end_array", None),
    ("", "end_map", None),
)
PARSER_BUFFER_SIZE: Final = 65_536

RuntimeProvider = Callable[[], RuntimeFacts]
DistributionProvider = Callable[[], InstalledDistributionEvidence]
BackendProvider = Callable[[], BackendEvidence]


@dataclass(frozen=True)
class StartupGate:
    """Run every approved startup check before a source-open continuation."""

    runtime_provider: RuntimeProvider = inspect_runtime
    distribution_provider: DistributionProvider = inspect_installed_distribution
    backend_provider: BackendProvider = load_exact_backend

    def verify(self) -> BackendEvidence:
        """Fail closed in the approved deterministic order."""

        runtime = self._runtime_facts()
        self._verify_implementation(runtime)
        self._verify_python_version(runtime)
        self._verify_system(runtime)
        self._verify_architecture(runtime)
        self._verify_distribution()
        backend = self._verify_backend_available()
        self._verify_backend_identity(backend)
        self._verify_parser_initialization(backend)
        return backend

    def _runtime_facts(self) -> RuntimeFacts:
        try:
            return self.runtime_provider()
        except Exception:
            raise StartupError(StartupReasonCode.UNSUPPORTED_PYTHON_RUNTIME) from None

    @staticmethod
    def _verify_implementation(runtime: RuntimeFacts) -> None:
        if runtime.implementation != EXPECTED_IMPLEMENTATION:
            raise StartupError(StartupReasonCode.UNSUPPORTED_PYTHON_RUNTIME)

    @staticmethod
    def _verify_python_version(runtime: RuntimeFacts) -> None:
        if runtime.version[:2] != (EXPECTED_PYTHON_MAJOR, EXPECTED_PYTHON_MINOR):
            raise StartupError(StartupReasonCode.UNSUPPORTED_PYTHON_RUNTIME)

    @staticmethod
    def _verify_system(runtime: RuntimeFacts) -> None:
        if runtime.system != EXPECTED_SYSTEM:
            raise StartupError(StartupReasonCode.UNSUPPORTED_PYTHON_RUNTIME)

    @staticmethod
    def _verify_architecture(runtime: RuntimeFacts) -> None:
        if runtime.architecture != EXPECTED_ARCHITECTURE:
            raise StartupError(StartupReasonCode.UNSUPPORTED_PYTHON_RUNTIME)

    def _verify_distribution(self) -> None:
        try:
            evidence = self.distribution_provider()
        except Exception:
            raise StartupError(
                StartupReasonCode.IJSON_DISTRIBUTION_UNVERIFIED
            ) from None

        if evidence.version != EXPECTED_DISTRIBUTION_VERSION:
            raise StartupError(StartupReasonCode.IJSON_DISTRIBUTION_UNVERIFIED)
        if not distribution_is_approved(evidence):
            raise StartupError(StartupReasonCode.IJSON_DISTRIBUTION_UNVERIFIED)

    def _verify_backend_available(self) -> BackendEvidence:
        try:
            return self.backend_provider()
        except BackendLoadFailure:
            raise StartupError(StartupReasonCode.IJSON_BACKEND_UNAVAILABLE) from None
        except Exception:
            raise StartupError(StartupReasonCode.IJSON_BACKEND_UNAVAILABLE) from None

    @staticmethod
    def _verify_backend_identity(backend: BackendEvidence) -> None:
        if not backend_identity_is_exact(backend):
            raise StartupError(StartupReasonCode.IJSON_BACKEND_MISMATCH)

    @staticmethod
    def _verify_parser_initialization(backend: BackendEvidence) -> None:
        try:
            events = tuple(
                backend.parse(
                    io.BytesIO(SELF_CHECK_DOCUMENT),
                    use_float=False,
                    multiple_values=False,
                    allow_comments=False,
                    buf_size=PARSER_BUFFER_SIZE,
                )
            )
        except Exception:
            raise StartupError(
                StartupReasonCode.IJSON_PARSER_INITIALIZATION_FAILED
            ) from None
        if events != SELF_CHECK_EVENTS:
            raise StartupError(StartupReasonCode.IJSON_PARSER_INITIALIZATION_FAILED)
        for rejected_document in SELF_CHECK_REJECTED_DOCUMENTS:
            try:
                tuple(
                    backend.parse(
                        io.BytesIO(rejected_document),
                        use_float=False,
                        multiple_values=False,
                        allow_comments=False,
                        buf_size=PARSER_BUFFER_SIZE,
                    )
                )
            except backend.parser_error_types:
                continue
            except Exception:
                raise StartupError(
                    StartupReasonCode.IJSON_PARSER_INITIALIZATION_FAILED
                ) from None
            raise StartupError(StartupReasonCode.IJSON_PARSER_INITIALIZATION_FAILED)
