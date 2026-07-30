"""Stage 3 orchestration for validated, ranked, content-free descriptors."""

from __future__ import annotations

from dataclasses import dataclass, field, replace
from pathlib import Path
from typing import Any, Protocol

from .backend import BackendEvidence
from .errors import (
    FailureCategory,
    SESSION_VALIDATION_PHASE,
    SOURCE_STAGING_PHASE,
    SourceRole,
    SourceValidationError,
    SourceValidationReasonCode,
)
from .input_preflight import PreflightedInputs
from .message_capacity import (
    MAX_AGGREGATE_RAW_MESSAGES,
    AggregateMessageCounter,
)
from .message_normalization import (
    MessageNormalizationConsumer,
    NormalizedMessage,
    NormalizationSummary,
)
from .source_validation import (
    AggregateRawByteCounter,
    FirstPassEvidence,
    SourceContext,
    SourcePassSummary,
    digest_and_validate_utf8,
    parse_and_validate_source,
)


@dataclass(frozen=True)
class SourceFingerprint:
    """Stable source evidence with no path, basename, or raw content."""

    role: SourceRole
    supplied_ordinal: int
    size_bytes: int
    sha256: str


@dataclass(frozen=True)
class ValidatedSourceDescriptor:
    """A re-openable internal descriptor whose repr hides its private path."""

    fingerprint: SourceFingerprint
    raw_message_count: int
    minimum_create_time: int
    maximum_create_time: int
    conversation_fingerprint: str
    file_rank: int | None
    path: Path = field(repr=False, compare=False)
    source_device: int = field(repr=False, compare=False)
    source_inode: int = field(repr=False, compare=False)
    source_modified_time_ns: int = field(repr=False, compare=False)
    source_changed_time_ns: int = field(repr=False, compare=False)

    @property
    def role(self) -> SourceRole:
        return self.fingerprint.role

    @property
    def supplied_ordinal(self) -> int:
        return self.fingerprint.supplied_ordinal


@dataclass(frozen=True)
class ValidationResult:
    """Content-free Stage 3 result; no message object survives the call."""

    annual_sources: tuple[ValidatedSourceDescriptor, ...]
    overlap_verifications: tuple[ValidatedSourceDescriptor, ...]
    conversation_fingerprint: str
    aggregate_raw_message_count: int
    annual_staged_message_count: int
    verification_streamed_message_count: int
    annual_normalization: NormalizationSummary
    verification_normalization: NormalizationSummary


class StagingConsumer(Protocol):
    """Stage 5 boundary receiving only Stage 4 eligible records."""

    def stage_annual_record(
        self,
        descriptor: ValidatedSourceDescriptor,
        record: NormalizedMessage,
        platform_message_id: object,
        *,
        owner_identity: str,
        peer_identity: str,
    ) -> None: ...

    def observe_verification_record(
        self,
        descriptor: ValidatedSourceDescriptor,
        record: NormalizedMessage,
        platform_message_id: object,
        *,
        owner_identity: str,
        peer_identity: str,
    ) -> None: ...

    def complete(self) -> None: ...

    def abort(self) -> None: ...


@dataclass
class DiscardingStagingConsumer:
    """Default sink that retains counts but no normalized body."""

    annual_record_count: int = 0
    verification_record_count: int = 0
    _complete: bool = False

    def stage_annual_record(
        self,
        descriptor: ValidatedSourceDescriptor,
        record: NormalizedMessage,
        platform_message_id: object,
        *,
        owner_identity: str,
        peer_identity: str,
    ) -> None:
        self.annual_record_count += 1

    def observe_verification_record(
        self,
        descriptor: ValidatedSourceDescriptor,
        record: NormalizedMessage,
        platform_message_id: object,
        *,
        owner_identity: str,
        peer_identity: str,
    ) -> None:
        self.verification_record_count += 1

    def complete(self) -> None:
        self._complete = True

    def abort(self) -> None:
        self.annual_record_count = 0
        self.verification_record_count = 0
        self._complete = False


def _contexts(
    inputs: PreflightedInputs,
) -> tuple[tuple[SourceContext, ...], tuple[SourceContext, ...]]:
    annual = tuple(
        SourceContext(
            role=SourceRole.ANNUAL_SOURCE,
            source_ordinal=ordinal,
            path=path,
        )
        for ordinal, path in enumerate(inputs.annual_sources, start=1)
    )
    verification = tuple(
        SourceContext(
            role=SourceRole.OVERLAP_VERIFICATION,
            source_ordinal=ordinal,
            path=path,
        )
        for ordinal, path in enumerate(
            inputs.overlap_verifications,
            start=1,
        )
    )
    return annual, verification


def _descriptor(
    context: SourceContext,
    evidence: FirstPassEvidence,
    summary: SourcePassSummary,
) -> ValidatedSourceDescriptor:
    return ValidatedSourceDescriptor(
        fingerprint=SourceFingerprint(
            role=context.role,
            supplied_ordinal=context.source_ordinal,
            size_bytes=evidence.size_bytes,
            sha256=evidence.sha256,
        ),
        raw_message_count=summary.message_count,
        minimum_create_time=summary.minimum_create_time,
        maximum_create_time=summary.maximum_create_time,
        conversation_fingerprint=summary.conversation_fingerprint,
        file_rank=None,
        path=context.path,
        source_device=evidence.device,
        source_inode=evidence.inode,
        source_modified_time_ns=evidence.modified_time_ns,
        source_changed_time_ns=evidence.changed_time_ns,
    )


def _conversation_error(
    descriptor: ValidatedSourceDescriptor,
) -> SourceValidationError:
    return SourceValidationError(
        SourceValidationReasonCode.DIFFERENT_CONVERSATION,
        phase=SESSION_VALIDATION_PHASE,
        role=descriptor.role,
        source_ordinal=descriptor.supplied_ordinal,
        category=(
            FailureCategory.VERIFICATION
            if descriptor.role is SourceRole.OVERLAP_VERIFICATION
            else FailureCategory.INPUT_VALIDATION
        ),
        field="session",
    )


def _validate_conversation_set(
    annual: tuple[ValidatedSourceDescriptor, ...],
    verification: tuple[ValidatedSourceDescriptor, ...],
) -> str:
    baseline = annual[0].conversation_fingerprint
    for descriptor in (*annual[1:], *verification):
        if descriptor.conversation_fingerprint != baseline:
            raise _conversation_error(descriptor)
    return baseline


def _rank_annual_sources(
    annual: tuple[ValidatedSourceDescriptor, ...],
) -> tuple[ValidatedSourceDescriptor, ...]:
    ranked = sorted(
        annual,
        key=lambda descriptor: (
            descriptor.minimum_create_time,
            descriptor.maximum_create_time,
            descriptor.supplied_ordinal,
        ),
    )
    return tuple(
        replace(descriptor, file_rank=file_rank)
        for file_rank, descriptor in enumerate(ranked)
    )


def _context_for(descriptor: ValidatedSourceDescriptor) -> SourceContext:
    return SourceContext(
        role=descriptor.role,
        source_ordinal=descriptor.supplied_ordinal,
        path=descriptor.path,
    )


def _evidence_for(descriptor: ValidatedSourceDescriptor) -> FirstPassEvidence:
    return FirstPassEvidence(
        sha256=descriptor.fingerprint.sha256,
        size_bytes=descriptor.fingerprint.size_bytes,
        device=descriptor.source_device,
        inode=descriptor.source_inode,
        modified_time_ns=descriptor.source_modified_time_ns,
        changed_time_ns=descriptor.source_changed_time_ns,
    )


def _assert_same_pass(
    descriptor: ValidatedSourceDescriptor,
    observed: SourcePassSummary,
) -> None:
    if (
        observed.message_count != descriptor.raw_message_count
        or observed.minimum_create_time != descriptor.minimum_create_time
        or observed.maximum_create_time != descriptor.maximum_create_time
        or observed.conversation_fingerprint
        != descriptor.conversation_fingerprint
    ):
        raise SourceValidationError(
            SourceValidationReasonCode.SOURCE_MUTATED,
            phase=SOURCE_STAGING_PHASE,
            role=descriptor.role,
            source_ordinal=descriptor.supplied_ordinal,
            category=(
                FailureCategory.VERIFICATION
                if descriptor.role is SourceRole.OVERLAP_VERIFICATION
                else FailureCategory.INPUT_VALIDATION
            ),
        )


def _validate_preflighted_inputs(
    inputs: PreflightedInputs,
    backend: BackendEvidence,
    *,
    message_limit: int = MAX_AGGREGATE_RAW_MESSAGES,
    staging_consumer: StagingConsumer | None = None,
) -> ValidationResult:
    """Run every digest, validation, ranking, and staging-stream pass."""

    annual_contexts, verification_contexts = _contexts(inputs)
    aggregate_bytes = AggregateRawByteCounter()
    message_counter = AggregateMessageCounter(limit=message_limit)
    evidence_by_context: dict[SourceContext, FirstPassEvidence] = {}
    summaries_by_context: dict[SourceContext, SourcePassSummary] = {}

    for context in (*annual_contexts, *verification_contexts):
        evidence = digest_and_validate_utf8(context, aggregate_bytes)
        summary = parse_and_validate_source(
            context,
            evidence,
            backend,
            aggregate_messages=message_counter,
        )
        evidence_by_context[context] = evidence
        summaries_by_context[context] = summary

    annual_descriptors = tuple(
        _descriptor(
            context,
            evidence_by_context[context],
            summaries_by_context[context],
        )
        for context in annual_contexts
    )
    verification_descriptors = tuple(
        _descriptor(
            context,
            evidence_by_context[context],
            summaries_by_context[context],
        )
        for context in verification_contexts
    )
    fingerprint = _validate_conversation_set(
        annual_descriptors,
        verification_descriptors,
    )
    ranked_annual = _rank_annual_sources(annual_descriptors)
    consumer = staging_consumer or DiscardingStagingConsumer()
    normalizer = MessageNormalizationConsumer(
        on_annual_eligible=lambda descriptor, record, platform_id, owner, peer: (
            consumer.stage_annual_record(
                descriptor,
                record,
                platform_id,
                owner_identity=owner,
                peer_identity=peer,
            )
        ),
        on_verification_eligible=(
            lambda descriptor, record, platform_id, owner, peer: (
                consumer.observe_verification_record(
                    descriptor,
                    record,
                    platform_id,
                    owner_identity=owner,
                    peer_identity=peer,
                )
            )
        ),
    )

    try:
        for descriptor in ranked_annual:
            identity = summaries_by_context[
                _context_for(descriptor)
            ].session_identity
            summary = parse_and_validate_source(
                _context_for(descriptor),
                _evidence_for(descriptor),
                backend,
                phase=SOURCE_STAGING_PHASE,
                on_message=lambda source_index, message, selected=descriptor,
                expected=identity: (
                    normalizer.stage_annual_message(
                        selected,
                        source_index,
                        message,
                        owner_identity=expected.owner_identity,
                        peer_identity=expected.peer_identity,
                    )
                ),
            )
            _assert_same_pass(descriptor, summary)
        for descriptor in verification_descriptors:
            identity = summaries_by_context[
                _context_for(descriptor)
            ].session_identity
            summary = parse_and_validate_source(
                _context_for(descriptor),
                _evidence_for(descriptor),
                backend,
                phase=SOURCE_STAGING_PHASE,
                on_message=lambda source_index, message, selected=descriptor,
                expected=identity: (
                    normalizer.observe_verification_message(
                        selected,
                        source_index,
                        message,
                        owner_identity=expected.owner_identity,
                        peer_identity=expected.peer_identity,
                    )
                ),
            )
            _assert_same_pass(descriptor, summary)
        normalizer.complete()
        consumer.complete()
    except BaseException:
        try:
            normalizer.abort()
        except BaseException:
            pass
        try:
            consumer.abort()
        except BaseException:
            pass
        raise

    annual_staged = sum(
        descriptor.raw_message_count for descriptor in ranked_annual
    )
    verification_streamed = sum(
        descriptor.raw_message_count
        for descriptor in verification_descriptors
    )
    return ValidationResult(
        annual_sources=ranked_annual,
        overlap_verifications=verification_descriptors,
        conversation_fingerprint=fingerprint,
        aggregate_raw_message_count=message_counter.count,
        annual_staged_message_count=annual_staged,
        verification_streamed_message_count=verification_streamed,
        annual_normalization=normalizer.annual_summary,
        verification_normalization=normalizer.verification_summary,
    )


def validate_preflighted_inputs(
    inputs: PreflightedInputs,
    backend: BackendEvidence,
    *,
    message_limit: int = MAX_AGGREGATE_RAW_MESSAGES,
    staging_consumer: StagingConsumer | None = None,
) -> ValidationResult:
    """Own a supplied staging consumer across every validation phase."""

    try:
        return _validate_preflighted_inputs(
            inputs,
            backend,
            message_limit=message_limit,
            staging_consumer=staging_consumer,
        )
    except BaseException:
        if staging_consumer is not None:
            try:
                staging_consumer.abort()
            except BaseException:
                pass
        raise
