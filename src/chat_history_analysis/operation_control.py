"""Content-free progress and cooperative cancellation for production work."""

from __future__ import annotations

from contextlib import contextmanager
from contextvars import ContextVar, Token
from dataclasses import dataclass
import signal
import threading
from typing import Callable, Final, Iterator, Mapping

from .errors import (
    ARGUMENT_PHASE,
    DATASET_STAGING_PHASE,
    INPUT_PREFLIGHT_PHASE,
    MESSAGE_NORMALIZATION_PHASE,
    OUTPUT_PROMOTION_PHASE,
    OUTPUT_SERIALIZATION_PHASE,
    OUTPUT_VERIFICATION_PHASE,
    OVERLAP_VERIFICATION_PHASE,
    RECOVERY_PHASE,
    SESSION_VALIDATION_PHASE,
    SOURCE_DIGEST_PHASE,
    SOURCE_STAGING_PHASE,
    SOURCE_VALIDATION_PHASE,
    STARTUP_PHASE,
    CancellationError,
    DatasetPersistenceError,
    DatasetPersistenceReasonCode,
    FailureCategory,
    SourceRole,
)


ProgressSink = Callable[[Mapping[str, str | int]], None]
CheckpointHook = Callable[[str], None]

_KNOWN_PHASES: Final = frozenset(
    {
        STARTUP_PHASE,
        ARGUMENT_PHASE,
        INPUT_PREFLIGHT_PHASE,
        SOURCE_DIGEST_PHASE,
        SOURCE_VALIDATION_PHASE,
        SESSION_VALIDATION_PHASE,
        MESSAGE_NORMALIZATION_PHASE,
        SOURCE_STAGING_PHASE,
        DATASET_STAGING_PHASE,
        OUTPUT_SERIALIZATION_PHASE,
        OUTPUT_VERIFICATION_PHASE,
        OUTPUT_PROMOTION_PHASE,
        OVERLAP_VERIFICATION_PHASE,
        RECOVERY_PHASE,
    }
)
_PHASE_RANGES: Final[Mapping[str, tuple[int, int]]] = {
    STARTUP_PHASE: (0, 4),
    INPUT_PREFLIGHT_PHASE: (4, 8),
    SOURCE_DIGEST_PHASE: (8, 22),
    SOURCE_VALIDATION_PHASE: (22, 42),
    SESSION_VALIDATION_PHASE: (42, 46),
    SOURCE_STAGING_PHASE: (46, 66),
    DATASET_STAGING_PHASE: (66, 70),
    OUTPUT_SERIALIZATION_PHASE: (70, 82),
    OUTPUT_VERIFICATION_PHASE: (82, 96),
    OUTPUT_PROMOTION_PHASE: (96, 100),
}
_PROGRESS_STEP: Final = 2


@dataclass(frozen=True, slots=True)
class ProgressScope:
    """One source's fixed share of a production phase."""

    phase: str
    role: SourceRole
    source_ordinal: int
    input_index: int
    input_count: int

    def __post_init__(self) -> None:
        if (
            self.phase not in _PHASE_RANGES
            or isinstance(self.source_ordinal, bool)
            or not isinstance(self.source_ordinal, int)
            or self.source_ordinal < 1
            or isinstance(self.input_index, bool)
            or not isinstance(self.input_index, int)
            or isinstance(self.input_count, bool)
            or not isinstance(self.input_count, int)
            or self.input_count < 1
            or not 1 <= self.input_index <= self.input_count
        ):
            raise ValueError


class OperationControl:
    """Own progress ordering, cancellation state, and promotion commit state."""

    __slots__ = (
        "_cancel_requested",
        "_checkpoint_hook",
        "_commit_started",
        "_disabled",
        "_last_percentage",
        "_last_phase",
        "_last_source",
        "_signal_count",
        "_sink",
    )

    def __init__(
        self,
        *,
        progress_sink: ProgressSink | None = None,
        checkpoint_hook: CheckpointHook | None = None,
        disabled: bool = False,
    ) -> None:
        self._sink = progress_sink
        self._checkpoint_hook = checkpoint_hook
        self._disabled = disabled
        self._cancel_requested = False
        self._commit_started = False
        self._signal_count = 0
        self._last_percentage = 0
        self._last_phase: str | None = None
        self._last_source: tuple[SourceRole, int] | None = None

    @property
    def cancellation_requested(self) -> bool:
        return self._cancel_requested

    @property
    def commit_started(self) -> bool:
        return self._commit_started

    @property
    def signal_count(self) -> int:
        return self._signal_count

    def request_cancellation(self) -> None:
        """Record cancellation only; never raise from a signal handler."""

        self._cancel_requested = True
        self._signal_count += 1

    def checkpoint(self, phase: str, checkpoint_id: str) -> None:
        """Stop only between completed pipeline operations."""

        if self._disabled:
            return
        if phase not in _KNOWN_PHASES or not checkpoint_id:
            raise ValueError
        if self._checkpoint_hook is not None:
            self._checkpoint_hook(checkpoint_id)
        if self._cancel_requested and not self._commit_started:
            raise CancellationError(phase=phase)

    def _emit(
        self,
        *,
        phase: str,
        percentage: int,
        status: str,
        aggregate_count: int,
        capacity_value: int,
        role: SourceRole | None = None,
        source_ordinal: int | None = None,
    ) -> None:
        if self._disabled or self._sink is None:
            return
        if (
            phase not in _PHASE_RANGES
            or status not in {"running", "completed"}
            or isinstance(percentage, bool)
            or not isinstance(percentage, int)
            or not self._last_percentage <= percentage <= 100
            or isinstance(aggregate_count, bool)
            or not isinstance(aggregate_count, int)
            or aggregate_count < 0
            or isinstance(capacity_value, bool)
            or not isinstance(capacity_value, int)
            or capacity_value < 1
            or aggregate_count > capacity_value
            or (role is None) != (source_ordinal is None)
            or (
                source_ordinal is not None
                and (
                    isinstance(source_ordinal, bool)
                    or not isinstance(source_ordinal, int)
                    or source_ordinal < 1
                )
            )
        ):
            raise ValueError
        payload: dict[str, str | int] = {
            "aggregateCount": aggregate_count,
            "capacityValue": capacity_value,
            "event": "progress",
            "percentage": percentage,
            "phase": phase,
            "status": status,
        }
        if role is not None and source_ordinal is not None:
            payload["role"] = role.value
            payload["sourceOrdinal"] = source_ordinal
        try:
            self._sink(payload)
        except (OSError, RuntimeError, ValueError):
            raise DatasetPersistenceError(
                DatasetPersistenceReasonCode.OUTPUT_WRITE_FAILED,
                phase=phase,
                category=FailureCategory.OUTPUT,
            ) from None
        self._last_percentage = percentage
        self._last_phase = phase
        self._last_source = (
            (role, source_ordinal)
            if role is not None and source_ordinal is not None
            else None
        )

    def phase_progress(
        self,
        phase: str,
        completed: int,
        total: int,
        *,
        force: bool = False,
    ) -> None:
        """Report a fixed operation phase without content-derived counters."""

        if self._disabled:
            return
        if (
            phase not in _PHASE_RANGES
            or isinstance(completed, bool)
            or not isinstance(completed, int)
            or isinstance(total, bool)
            or not isinstance(total, int)
            or total < 1
            or not 0 <= completed <= total
        ):
            raise ValueError
        start, end = _PHASE_RANGES[phase]
        target = start + ((end - start) * completed // total)
        self._emit_progress_targets(
            phase=phase,
            target=target,
            status="completed" if completed == total else "running",
            aggregate_count=completed,
            capacity_value=total,
            force=force,
        )

    def source_progress(
        self,
        scope: ProgressScope,
        completed: int,
        total: int,
        *,
        force: bool = False,
    ) -> None:
        """Report a source slice while revealing only role/ordinal and percent."""

        if self._disabled:
            return
        if (
            isinstance(completed, bool)
            or not isinstance(completed, int)
            or isinstance(total, bool)
            or not isinstance(total, int)
            or total < 1
            or not 0 <= completed <= total
        ):
            raise ValueError
        start, end = _PHASE_RANGES[scope.phase]
        phase_units = scope.input_count * total
        completed_units = ((scope.input_index - 1) * total) + completed
        target = start + (
            (end - start) * completed_units // phase_units
        )
        self._emit_progress_targets(
            phase=scope.phase,
            target=target,
            status=(
                "completed"
                if scope.input_index == scope.input_count
                and completed == total
                else "running"
            ),
            aggregate_count=(
                scope.input_index
                if completed == total
                else scope.input_index - 1
            ),
            capacity_value=scope.input_count,
            role=scope.role,
            source_ordinal=scope.source_ordinal,
            force=force,
        )

    def _emit_progress_targets(
        self,
        *,
        phase: str,
        target: int,
        status: str,
        aggregate_count: int,
        capacity_value: int,
        role: SourceRole | None = None,
        source_ordinal: int | None = None,
        force: bool,
    ) -> None:
        if target < self._last_percentage:
            raise ValueError
        next_boundary = (
            ((self._last_percentage // _PROGRESS_STEP) + 1)
            * _PROGRESS_STEP
        )
        emitted = False
        while next_boundary <= target:
            self._emit(
                phase=phase,
                percentage=next_boundary,
                status=status if next_boundary == target else "running",
                aggregate_count=aggregate_count,
                capacity_value=capacity_value,
                role=role,
                source_ordinal=source_ordinal,
            )
            emitted = True
            next_boundary += _PROGRESS_STEP
        if (
            force
            and (
                not emitted
                or self._last_phase != phase
                or self._last_source
                != (
                    (role, source_ordinal)
                    if role is not None and source_ordinal is not None
                    else None
                )
                or self._last_percentage != target
            )
        ):
            self._emit(
                phase=phase,
                percentage=target,
                status=status,
                aggregate_count=aggregate_count,
                capacity_value=capacity_value,
                role=role,
                source_ordinal=source_ordinal,
            )

    @contextmanager
    def promotion_commit(self) -> Iterator[None]:
        """Close the cancel-before-rename race and defer once rename commits."""

        if self._disabled:
            yield
            return
        if self._commit_started:
            raise RuntimeError
        self._commit_started = True
        if self._checkpoint_hook is not None:
            self._checkpoint_hook("promotion-commit-boundary")
        if self._cancel_requested:
            self._commit_started = False
            raise CancellationError(phase=OUTPUT_PROMOTION_PHASE)
        try:
            yield
        except BaseException:
            self._commit_started = False
            raise


_DISABLED_CONTROL: Final = OperationControl(disabled=True)
_CURRENT_CONTROL: ContextVar[OperationControl] = ContextVar(
    "chat_history_analysis_operation_control",
    default=_DISABLED_CONTROL,
)


def current_operation_control() -> OperationControl:
    return _CURRENT_CONTROL.get()


@contextmanager
def use_operation_control(control: OperationControl) -> Iterator[None]:
    token: Token[OperationControl] = _CURRENT_CONTROL.set(control)
    try:
        yield
    finally:
        _CURRENT_CONTROL.reset(token)


@contextmanager
def install_sigint_handler(control: OperationControl) -> Iterator[None]:
    """Convert SIGINT into an idempotent flag while production work runs."""

    if threading.current_thread() is not threading.main_thread():
        yield
        return
    previous = signal.getsignal(signal.SIGINT)

    def request_stop(signum: int, frame: object) -> None:
        del signum, frame
        control.request_cancellation()

    signal.signal(signal.SIGINT, request_stop)
    try:
        yield
    finally:
        signal.signal(signal.SIGINT, previous)
