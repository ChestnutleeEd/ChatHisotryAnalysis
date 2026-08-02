from __future__ import annotations

from datetime import datetime, timedelta, timezone
from io import BytesIO, StringIO
import json
import os
from pathlib import Path
import stat
import struct
import subprocess
import sys
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from chat_history_analysis.canonical_dataset import (
    CanonicalEventStagingConsumer,
    verify_canonical_dataset_directory,
)
from chat_history_analysis.dataset_persistence import (
    IdentityDigests,
    canonical_event_identity,
    fallback_identity_v2,
)
from chat_history_analysis.errors import (
    DatasetPersistenceError,
    DatasetPersistenceReasonCode,
    FailureCategory,
    InputPreflightError,
    SourceRole,
)
from chat_history_analysis.input_preflight import (
    InputSelection,
    ensure_desktop_session_root,
    preflight_desktop_inputs,
    preflight_desktop_output_directory,
    preflight_inputs,
)
from chat_history_analysis.message_normalization import (
    CanonicalEventCandidate,
    CanonicalEventNormalizationConsumer,
    MessageCategory,
)
from chat_history_analysis.preprocessing_validation import (
    SourceFingerprint,
    ValidatedSourceDescriptor,
    validate_preflighted_inputs_v2,
)
from chat_history_analysis.sidecar_protocol import (
    SIDECAR_PROTOCOL_VERSION,
    SidecarConfiguration,
    SidecarProtocolError,
    emit_failure,
    emit_progress,
    emit_result,
    encode_configuration,
    parse_failure_line,
    parse_stdout_lines,
    read_configuration,
)
from tests.stage3_support import HAS_IJSON, message, real_backend, write_export


FINGERPRINT = "ab" * 32
OWNER = "synthetic-owner"
PEER = "synthetic-peer"


def _descriptor(
    path: Path,
    *,
    ordinal: int = 1,
    rank: int | None = 0,
    role: SourceRole = SourceRole.ANNUAL_SOURCE,
) -> ValidatedSourceDescriptor:
    metadata = path.stat()
    return ValidatedSourceDescriptor(
        fingerprint=SourceFingerprint(
            role=role,
            supplied_ordinal=ordinal,
            size_bytes=metadata.st_size,
            sha256="00" * 32,
        ),
        raw_message_count=1,
        minimum_create_time=0,
        maximum_create_time=100,
        conversation_fingerprint=FINGERPRINT,
        file_rank=rank,
        path=path,
        source_device=metadata.st_dev,
        source_inode=metadata.st_ino,
        source_modified_time_ns=metadata.st_mtime_ns,
        source_changed_time_ns=metadata.st_ctime_ns,
    )


def _candidate(
    *,
    create_time: int = 0,
    category: str = "text",
    sender: str | None = "owner",
    eligible: bool = True,
    content: str | None = "synthetic text",
    raw_content: str | None = "synthetic text",
    platform_id: str | None = None,
    local_id: str | None = None,
    source_index: int = 0,
    rank: int = 0,
    role: SourceRole = SourceRole.ANNUAL_SOURCE,
    ordinal: int = 1,
) -> CanonicalEventCandidate:
    local = datetime(1970, 1, 1, tzinfo=timezone.utc) + timedelta(
        seconds=create_time,
        hours=8,
    )
    return CanonicalEventCandidate(
        source_role=role,
        source_ordinal=ordinal,
        file_rank=rank if role is SourceRole.ANNUAL_SOURCE else None,
        source_array_index=source_index,
        create_time=create_time,
        formatted_time=local.strftime("%Y-%m-%d %H:%M:%S"),
        calendar_date=local.strftime("%Y-%m-%d"),
        sender_scope=sender,
        message_category=category,
        text_eligible=eligible,
        content=content,
        platform_message_id=platform_id,
        local_id=local_id,
        raw_classification=(("chatLabType", 0), ("localType", 1)),
        raw_content=raw_content,
    )


class CanonicalNormalizationTests(unittest.TestCase):
    def test_every_category_unknown_system_and_invalid_records(self) -> None:
        descriptor = SimpleNamespace(
            role=SourceRole.ANNUAL_SOURCE,
            supplied_ordinal=1,
            file_rank=0,
        )
        emitted: list[CanonicalEventCandidate] = []
        consumer = CanonicalEventNormalizationConsumer(
            on_annual_event=lambda _descriptor, candidate: emitted.append(candidate)
        )
        category_inputs = (
            (0, "文本消息", 1),
            (1, "图片消息", 3),
            (2, "语音消息", 34),
            (3, "视频消息", 43),
            (4, "文件消息", 6),
            (5, "动画表情", 47),
            (7, "链接消息", 49),
            (8, "位置消息", 1),
            (23, "通话消息", 50),
            (24, "小程序消息", 51),
            (25, "引用消息", 57),
            (27, "名片消息", 42),
            (80, "系统消息", 10000),
            (99, "其他消息", 1),
        )
        for index, (chat_lab_type, raw_type, local_type) in enumerate(
            category_inputs
        ):
            value = message(
                index,
                OWNER,
                chatLabType=chat_lab_type,
                type=raw_type,
                localType=local_type,
                isSend=0 if chat_lab_type == 80 else 1,
            )
            consumer.stage_annual_message(
                descriptor,
                index,
                value,
                owner_identity=OWNER,
                peer_identity=PEER,
            )
        consumer.stage_annual_message(
            descriptor,
            14,
            message(
                14,
                PEER,
                chatLabType=404,
                type="未来消息",
                localType=99,
                content="future payload",
            ),
            owner_identity=OWNER,
            peer_identity=PEER,
        )
        consumer.stage_annual_message(
            descriptor,
            15,
            message(
                15,
                PEER,
                isSend=2,
            ),
            owner_identity=OWNER,
            peer_identity=PEER,
        )
        invalid_time = message(16, PEER)
        invalid_time["formattedTime"] = "1970-01-01 08:01:17"
        consumer.stage_annual_message(
            descriptor,
            16,
            invalid_time,
            owner_identity=OWNER,
            peer_identity=PEER,
        )
        consumer.stage_annual_message(
            descriptor,
            17,
            message(17, PEER, content="https://example.invalid"),
            owner_identity=OWNER,
            peer_identity=PEER,
        )

        self.assertEqual(len(emitted), 16)
        self.assertEqual(
            {candidate.message_category for candidate in emitted},
            {category.value for category in MessageCategory},
        )
        system = next(
            candidate
            for candidate in emitted
            if candidate.message_category == "system"
        )
        self.assertIsNone(system.sender_scope)
        self.assertFalse(system.text_eligible)
        self.assertIsNone(system.content)
        media = next(
            candidate
            for candidate in emitted
            if candidate.message_category == "image"
        )
        self.assertIsNone(media.content)
        self.assertFalse(media.text_eligible)
        ineligible_text = [
            candidate
            for candidate in emitted
            if candidate.message_category == "text" and not candidate.text_eligible
        ]
        self.assertEqual(len(ineligible_text), 1)
        self.assertEqual(consumer.annual_summary.observed_count, 18)
        self.assertEqual(consumer.annual_summary.eligible_count, 1)
        self.assertIn(
            ("UNKNOWN_MESSAGE_CATEGORY", 1),
            consumer.annual_summary.warnings_by_reason,
        )


class EventIdentityAndStagingTests(unittest.TestCase):
    def setUp(self) -> None:
        temporary = tempfile.TemporaryDirectory(prefix="chat-history-stage2-")
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name).resolve()
        self.source = self.root / "synthetic-source.json"
        self.source.write_bytes(b"synthetic-source")

    def test_platform_and_fallback_identity_rules(self) -> None:
        platform_text = _candidate(platform_id="platform-1")
        platform_media = _candidate(
            category="image",
            eligible=False,
            content=None,
            raw_content="[图片]",
            platform_id="platform-1",
        )
        self.assertEqual(
            canonical_event_identity(FINGERPRINT, platform_text),
            canonical_event_identity(FINGERPRINT, platform_media),
        )
        fallback_media = _candidate(
            category="image",
            eligible=False,
            content=None,
            raw_content="[图片]",
        )
        self.assertEqual(
            fallback_identity_v2(FINGERPRINT, fallback_media),
            fallback_identity_v2(
                FINGERPRINT,
                _candidate(
                    category="image",
                    eligible=False,
                    content=None,
                    raw_content="[图片]",
                    source_index=99,
                ),
            ),
        )
        local_id_only = _candidate(
            category="image",
            eligible=False,
            content=None,
            raw_content=None,
            local_id="same-local-id",
        )
        self.assertIsNone(fallback_identity_v2(FINGERPRINT, local_id_only))
        self.assertNotEqual(
            fallback_identity_v2(
                FINGERPRINT,
                _candidate(
                    category="image",
                    eligible=False,
                    content=None,
                    raw_content="[图片-1]",
                ),
            ),
            fallback_identity_v2(
                FINGERPRINT,
                _candidate(
                    category="image",
                    eligible=False,
                    content=None,
                    raw_content="[图片-2]",
                ),
            ),
        )

    def test_private_v2_schema_dedup_and_cleanup(self) -> None:
        destination = self.root / "dataset"
        consumer = CanonicalEventStagingConsumer(destination)
        descriptor = _descriptor(self.source)
        consumer.stage_annual_event(
            descriptor,
            _candidate(platform_id="private-platform-id", raw_content="private-payload"),
        )
        consumer.stage_annual_event(
            _descriptor(self.source, ordinal=2, rank=1),
            _candidate(
                platform_id="private-platform-id",
                raw_content="different-payload",
                source_index=1,
                rank=1,
                ordinal=2,
            ),
        )
        consumer.stage_annual_event(
            descriptor,
            _candidate(
                category="image",
                eligible=False,
                content=None,
                raw_content="private-media-payload",
                source_index=2,
            ),
        )
        consumer.stage_annual_event(
            descriptor,
            _candidate(
                category="image",
                eligible=False,
                content=None,
                raw_content="private-media-payload",
                source_index=3,
            ),
        )
        consumer.stage_annual_event(
            descriptor,
            _candidate(
                category="image",
                eligible=False,
                content=None,
                raw_content=None,
                local_id="repeated-local-id",
                source_index=4,
            ),
        )
        consumer.stage_annual_event(
            descriptor,
            _candidate(
                category="image",
                eligible=False,
                content=None,
                raw_content=None,
                local_id="repeated-local-id",
                source_index=5,
            ),
        )
        connection = consumer._connection_required()
        columns = [
            row[1] for row in connection.execute("PRAGMA table_info(staging_events)")
        ]
        self.assertEqual(
            columns,
            [
                "event_id",
                "identity_kind",
                "identity_digest",
                "identity_verifier",
                "create_time",
                "formatted_time",
                "calendar_date",
                "sender_scope",
                "message_category",
                "text_eligible",
                "content",
                "file_rank",
                "source_array_index",
                "source_ordinal",
            ],
        )
        self.assertEqual(
            connection.execute("SELECT COUNT(*) FROM staging_events").fetchone()[0],
            4,
        )
        self.assertEqual(consumer.warning_count, 2)
        self.assertEqual(connection.execute("PRAGMA journal_mode").fetchone()[0], "delete")
        self.assertEqual(connection.execute("PRAGMA temp_store").fetchone()[0], 2)
        self.assertEqual(connection.execute("PRAGMA secure_delete").fetchone()[0], 1)
        self.assertEqual(connection.execute("PRAGMA busy_timeout").fetchone()[0], 0)
        database_bytes = consumer._database.read_bytes()
        self.assertNotIn(b"private-platform-id", database_bytes)
        self.assertNotIn(b"private-media-payload", database_bytes)
        self.assertFalse(Path(os.fspath(consumer._database) + "-wal").exists())
        consumer.complete()
        consumer.abort()
        self.assertFalse(destination.exists())
        self.assertFalse(any(path.name.startswith(".chathistoryanalysis-stage-v2-") for path in self.root.iterdir()))

    def test_mismatched_verifier_is_fatal(self) -> None:
        consumer = CanonicalEventStagingConsumer(self.root / "dataset")
        descriptor = _descriptor(self.source)
        identities = iter(
            (
                IdentityDigests("fallback-v2", b"a" * 32, b"a" * 16),
                IdentityDigests("fallback-v2", b"a" * 32, b"b" * 16),
            )
        )
        with patch(
            "chat_history_analysis.canonical_dataset.canonical_event_identity",
            side_effect=lambda _fingerprint, _candidate: next(identities),
        ):
            consumer.stage_annual_event(descriptor, _candidate())
            with self.assertRaises(DatasetPersistenceError) as raised:
                consumer.stage_annual_event(
                    descriptor,
                    _candidate(source_index=1),
                )
        self.assertEqual(
            raised.exception.reason_code,
            DatasetPersistenceReasonCode.CRYPTOGRAPHIC_IDENTITY_COLLISION,
        )
        consumer.abort()

    def test_v2_capacity_and_empty_dataset_gates(self) -> None:
        descriptor = _descriptor(self.source)

        collision = self.root / "collision-dataset"
        collision.mkdir(mode=0o700)
        with self.assertRaises(DatasetPersistenceError) as collision_error:
            CanonicalEventStagingConsumer(collision)
        self.assertEqual(
            collision_error.exception.reason_code,
            DatasetPersistenceReasonCode.OUTPUT_DESTINATION_EXISTS,
        )

        empty = CanonicalEventStagingConsumer(self.root / "empty-dataset")
        empty.complete()
        with self.assertRaises(DatasetPersistenceError) as empty_error:
            empty._write_chunks()
        self.assertEqual(
            empty_error.exception.reason_code,
            DatasetPersistenceReasonCode.CANONICAL_NO_EVENTS,
        )
        empty.abort()

        over_event_limit = CanonicalEventStagingConsumer(
            self.root / "event-limit-dataset"
        )
        over_event_limit.stage_annual_event(
            descriptor,
            _candidate(platform_id="event-limit-1"),
        )
        over_event_limit.stage_annual_event(
            descriptor,
            _candidate(create_time=1, source_index=1, platform_id="event-limit-2"),
        )
        over_event_limit.complete()
        with patch(
            "chat_history_analysis.canonical_dataset.MAX_CANONICAL_EVENTS",
            1,
        ):
            with self.assertRaises(DatasetPersistenceError) as event_error:
                over_event_limit._write_chunks()
        self.assertEqual(
            event_error.exception.reason_code,
            DatasetPersistenceReasonCode.CANONICAL_EVENT_LIMIT_EXCEEDED,
        )
        over_event_limit.abort()

        over_dataset_limit = CanonicalEventStagingConsumer(
            self.root / "dataset-byte-limit"
        )
        over_dataset_limit.stage_annual_event(
            descriptor,
            _candidate(platform_id="dataset-limit"),
        )
        over_dataset_limit.complete()
        with patch(
            "chat_history_analysis.canonical_dataset.MAX_CANONICAL_DATASET_BYTES",
            1,
        ):
            with self.assertRaises(DatasetPersistenceError) as byte_error:
                over_dataset_limit._write_chunks()
        self.assertEqual(
            byte_error.exception.reason_code,
            DatasetPersistenceReasonCode.CANONICAL_DATASET_LIMIT_EXCEEDED,
        )
        over_dataset_limit.abort()

        split = CanonicalEventStagingConsumer(self.root / "split-dataset")
        split.stage_annual_event(
            descriptor,
            _candidate(content="x", raw_content="x", platform_id="split-1"),
        )
        split.stage_annual_event(
            descriptor,
            _candidate(
                create_time=1,
                content="y",
                raw_content="y",
                source_index=1,
                platform_id="split-2",
            ),
        )
        split.complete()
        with patch(
            "chat_history_analysis.canonical_dataset.MAX_CANONICAL_CHUNK_BYTES",
            256,
        ):
            chunks, _stats = split._write_chunks()
        self.assertEqual(len(chunks), 2)
        split.abort()

        chunk_limit = CanonicalEventStagingConsumer(
            self.root / "chunk-count-limit"
        )
        chunk_limit.stage_annual_event(
            descriptor,
            _candidate(content="x", raw_content="x", platform_id="count-1"),
        )
        chunk_limit.stage_annual_event(
            descriptor,
            _candidate(
                create_time=1,
                content="y",
                raw_content="y",
                source_index=1,
                platform_id="count-2",
            ),
        )
        chunk_limit.complete()
        with patch(
            "chat_history_analysis.canonical_dataset.MAX_CANONICAL_CHUNK_BYTES",
            256,
        ), patch(
            "chat_history_analysis.canonical_dataset.MAX_CANONICAL_CHUNK_COUNT",
            1,
        ):
            with self.assertRaises(DatasetPersistenceError) as chunk_error:
                chunk_limit._write_chunks()
        self.assertEqual(
            chunk_error.exception.reason_code,
            DatasetPersistenceReasonCode.CANONICAL_CHUNK_LIMIT_EXCEEDED,
        )
        chunk_limit.abort()

        disk_failure = CanonicalEventStagingConsumer(self.root / "disk-failure")
        disk_failure.stage_annual_event(
            descriptor,
            _candidate(platform_id="disk-failure"),
        )
        disk_failure.complete()
        simulated_disk_error = DatasetPersistenceError(
            DatasetPersistenceReasonCode.OUTPUT_WRITE_FAILED,
            phase="output-serialization",
            category=FailureCategory.OUTPUT,
        )
        with patch(
            "chat_history_analysis.canonical_dataset._write_all",
            side_effect=simulated_disk_error,
        ):
            with self.assertRaises(DatasetPersistenceError) as disk_error:
                disk_failure._write_chunks()
        self.assertEqual(
            disk_error.exception.reason_code,
            DatasetPersistenceReasonCode.OUTPUT_WRITE_FAILED,
        )
        disk_failure.abort()


@unittest.skipUnless(HAS_IJSON, "real ijson backend is required")
class CanonicalDatasetPipelineTests(unittest.TestCase):
    def setUp(self) -> None:
        temporary = tempfile.TemporaryDirectory(prefix="chat-history-pipeline-stage2-")
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name).resolve()

    def _publish(
        self,
        messages: list[dict[str, object]],
        *,
        destination_name: str,
        overlap_messages: list[dict[str, object]] | None = None,
    ):
        source = self.root / f"{destination_name}-annual.json"
        write_export(source, messages)
        overlap: tuple[Path, ...] = ()
        if overlap_messages is not None:
            verification = self.root / f"{destination_name}-verification.json"
            write_export(verification, overlap_messages)
            overlap = (verification,)
        cache = self.root / f"{destination_name}-cache"
        sessions = ensure_desktop_session_root(cache)
        destination = sessions / f"synthetic-{destination_name}-01"
        inputs = preflight_desktop_inputs(
            InputSelection((source,), overlap, destination)
        )
        consumer = CanonicalEventStagingConsumer(inputs.output_directory)
        try:
            validation = validate_preflighted_inputs_v2(
                inputs,
                real_backend(),
                canonical_event_consumer=consumer,
            )
            result = consumer.publish(validation)
        except BaseException:
            consumer.abort()
            raise
        return source, destination, validation, result

    def test_media_only_overlap_and_byte_identical_rerun(self) -> None:
        annual = [
            message(
                100,
                OWNER,
                content="[图片]",
                chatLabType=1,
                type="图片消息",
                localType=3,
                platformMessageId="media-platform-id",
            ),
            message(
                101,
                PEER,
                content="[图片]",
                chatLabType=1,
                type="图片消息",
                localType=3,
            ),
        ]
        verification = [
            message(
                100,
                OWNER,
                content="[图片]",
                chatLabType=1,
                type="图片消息",
                localType=3,
                platformMessageId="media-platform-id",
            ),
            message(
                101,
                PEER,
                content="[图片]",
                chatLabType=1,
                type="图片消息",
                localType=3,
            ),
        ]
        _, first, validation, first_result = self._publish(
            annual,
            destination_name="first",
            overlap_messages=verification,
        )
        _, second, _, second_result = self._publish(
            annual,
            destination_name="second",
            overlap_messages=verification,
        )
        self.assertEqual(first_result.event_count, 2)
        self.assertEqual(first_result.eligible_text_count, 0)
        self.assertEqual(first_result.matched_verification_event_count, 2)
        self.assertEqual(validation.canonical_normalization.eligible_count, 0)
        self.assertEqual(
            (first / "manifest.json").read_bytes(),
            (second / "manifest.json").read_bytes(),
        )
        self.assertEqual(
            (first / "chunk-0000.ndjson").read_bytes(),
            (second / "chunk-0000.ndjson").read_bytes(),
        )
        verify_canonical_dataset_directory(first)
        first_chunk = first / "chunk-0000.ndjson"
        first_chunk.write_bytes(first_chunk.read_bytes() + b"tamper\n")
        with self.assertRaises(DatasetPersistenceError) as tamper_error:
            verify_canonical_dataset_directory(first)
        self.assertEqual(
            tamper_error.exception.reason_code,
            DatasetPersistenceReasonCode.OUTPUT_INTEGRITY_FAILED,
        )
        output_bytes = b"".join(path.read_bytes() for path in first.iterdir())
        self.assertNotIn(b"media-platform-id", output_bytes)
        self.assertNotIn("[图片]".encode("utf-8"), output_bytes)
        self.assertEqual(first_result.manifest_sha256, second_result.manifest_sha256)

    def test_fallback_duplicate_across_annual_sources(self) -> None:
        messages = [
            message(
                100,
                OWNER,
                content="[图片]",
                chatLabType=1,
                type="图片消息",
                localType=3,
            ),
            message(
                101,
                PEER,
                content="[图片-2]",
                chatLabType=1,
                type="图片消息",
                localType=3,
            ),
        ]
        first_source = self.root / "fallback-first.json"
        second_source = self.root / "fallback-second.json"
        write_export(first_source, messages)
        write_export(second_source, messages)
        cache = self.root / "fallback-cache"
        destination = ensure_desktop_session_root(cache) / "synthetic-fallback-01"
        inputs = preflight_desktop_inputs(
            InputSelection((first_source, second_source), (), destination)
        )
        consumer = CanonicalEventStagingConsumer(inputs.output_directory)
        try:
            validation = validate_preflighted_inputs_v2(
                inputs,
                real_backend(),
                canonical_event_consumer=consumer,
            )
            result = consumer.publish(validation)
        except BaseException:
            consumer.abort()
            raise
        self.assertEqual(result.event_count, 2)
        self.assertEqual(result.duplicate_event_count, 2)
        self.assertEqual(result.eligible_text_count, 0)


class DesktopPolicyAndProtocolTests(unittest.TestCase):
    def setUp(self) -> None:
        temporary = tempfile.TemporaryDirectory(prefix="chat-history-policy-stage2-")
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name).resolve()

    def _configuration(self) -> SidecarConfiguration:
        cache = self.root / "cache"
        output = cache / "analysis-sessions" / "synthetic-session-01"
        return SidecarConfiguration(
            session_id="synthetic-session-01",
            generation=1,
            annual_sources=(self.root / "annual.json",),
            verification_sources=(),
            application_cache_root=cache,
            output_directory=output,
            session_nonce="synthetic-nonce-01",
        )

    def test_desktop_policy_is_owner_only_and_separate_from_cli_ignore_policy(self) -> None:
        cache = self.root / "cache"
        sessions = ensure_desktop_session_root(cache)
        destination = sessions / "synthetic-session-01"
        self.assertEqual(preflight_desktop_output_directory(destination), destination)
        self.assertEqual(stat.S_IMODE(os.lstat(cache).st_mode), 0o700)
        self.assertEqual(stat.S_IMODE(os.lstat(sessions).st_mode), 0o700)
        destination.mkdir(mode=0o700)
        with self.assertRaises(InputPreflightError):
            preflight_desktop_output_directory(destination)

        unsafe_cache = self.root / "unsafe-cache"
        unsafe_sessions = ensure_desktop_session_root(unsafe_cache)
        os.chmod(unsafe_cache, 0o755)
        with self.assertRaises(InputPreflightError):
            preflight_desktop_output_directory(
                unsafe_sessions / "synthetic-session-02"
            )

        symlink_target = self.root / "real-cache"
        ensure_desktop_session_root(symlink_target)
        symlink_cache = self.root / "linked-cache"
        symlink_cache.symlink_to(symlink_target, target_is_directory=True)
        with self.assertRaises(InputPreflightError):
            preflight_desktop_output_directory(
                symlink_cache
                / "analysis-sessions"
                / "synthetic-session-03"
            )

        source = self.root / "synthetic-source.json"
        source.write_bytes(b"{}")
        with self.assertRaises(InputPreflightError):
            preflight_inputs(
                InputSelection((source,), (), destination / "cli-output")
            )

    def test_length_prefixed_and_exact_ndjson_protocol(self) -> None:
        configuration = self._configuration()
        encoded = encode_configuration(configuration)
        self.assertEqual(
            read_configuration(BytesIO(encoded)).session_id,
            configuration.session_id,
        )
        with self.assertRaises(SidecarProtocolError):
            read_configuration(BytesIO(encoded + b"extra"))

        output = StringIO()
        emit_progress(
            output,
            configuration,
            {
                "phase": "startup",
                "percentage": 0,
                "status": "running",
                "aggregateCount": 0,
                "capacityValue": 1,
            },
        )
        emit_progress(
            output,
            configuration,
            {
                "phase": "output-promotion",
                "percentage": 100,
                "status": "completed",
                "aggregateCount": 1,
                "capacityValue": 1,
            },
        )
        emit_result(
            output,
            configuration,
            {
                "eventCount": 1,
                "eligibleTextCount": 0,
                "chunkCount": 1,
                "duplicateEventCount": 0,
                "warningCount": 0,
            },
        )
        stdout_bytes = output.getvalue().encode("utf-8")
        self.assertNotIn(os.fspath(self.root).encode("utf-8"), stdout_bytes)
        progress, result = parse_stdout_lines(
            stdout_bytes.splitlines(keepends=True),
            session_id=configuration.session_id,
            generation=configuration.generation,
        )
        self.assertEqual(len(progress), 2)
        self.assertEqual(result["eventCount"], 1)

        failure = StringIO()
        emit_failure(failure, "OUTPUT_WRITE_FAILED")
        self.assertEqual(
            parse_failure_line(failure.getvalue()),
            {
                "protocolVersion": SIDECAR_PROTOCOL_VERSION,
                "reasonCode": "OUTPUT_WRITE_FAILED",
            },
        )
        with self.assertRaises(SidecarProtocolError):
            parse_failure_line(failure.getvalue().rstrip("\n"))

        malformed = json.dumps(
            {
                "protocolVersion": SIDECAR_PROTOCOL_VERSION,
                "type": "result",
                "sessionId": configuration.session_id,
                "generation": 1,
                "status": "success",
                "eventCount": 1,
                "eligibleTextCount": 0,
                "chunkCount": 1,
                "duplicateEventCount": 0,
                "warningCount": 0,
                "unexpected": True,
            },
            separators=(",", ":"),
        ).encode("utf-8") + b"\n"
        with self.assertRaises(SidecarProtocolError):
            parse_stdout_lines(
                [malformed],
                session_id=configuration.session_id,
                generation=1,
            )
        with self.assertRaises(SidecarProtocolError):
            parse_stdout_lines(
                [stdout_bytes.splitlines(keepends=True)[-1].rstrip(b"\n")],
                session_id=configuration.session_id,
                generation=1,
            )

    def test_duplicate_json_configuration_is_rejected(self) -> None:
        payload = (
            b'{"protocolVersion":"'
            + SIDECAR_PROTOCOL_VERSION.encode("ascii")
            + b'","protocolVersion":"'
            + SIDECAR_PROTOCOL_VERSION.encode("ascii")
            + b'"}'
        )
        with self.assertRaises(SidecarProtocolError):
            read_configuration(BytesIO(struct.pack(">I", len(payload)) + payload))

    @unittest.skipUnless(HAS_IJSON, "real ijson backend is required")
    def test_production_sidecar_cli_is_path_free_and_terminal(self) -> None:
        source = self.root / "sidecar-annual.json"
        write_export(
            source,
            [
                message(
                    100,
                    OWNER,
                    content="synthetic sidecar text",
                    platformMessageId="synthetic-sidecar-id",
                ),
                message(
                    101,
                    PEER,
                    content="[图片]",
                    chatLabType=1,
                    type="图片消息",
                    localType=3,
                ),
            ],
        )
        cache = self.root / "sidecar-cache"
        sessions = ensure_desktop_session_root(cache)
        configuration = SidecarConfiguration(
            session_id="synthetic-sidecar-01",
            generation=1,
            annual_sources=(source,),
            verification_sources=(),
            application_cache_root=sessions.parent,
            output_directory=sessions / "synthetic-sidecar-01",
            session_nonce="synthetic-sidecar-nonce",
        )
        environment = dict(os.environ)
        environment["PYTHONPATH"] = "src"
        completed = subprocess.run(
            [sys.executable, "-m", "chat_history_analysis", "sidecar"],
            input=encode_configuration(configuration),
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            env=environment,
            check=False,
        )
        self.assertEqual(completed.returncode, 0, completed.stderr)
        self.assertEqual(completed.stderr, b"")
        self.assertNotIn(os.fspath(self.root).encode("utf-8"), completed.stdout)
        _progress, result = parse_stdout_lines(
            completed.stdout.splitlines(keepends=True),
            session_id=configuration.session_id,
            generation=configuration.generation,
        )
        self.assertEqual(result["eventCount"], 2)
        self.assertTrue(configuration.output_directory.exists())


if __name__ == "__main__":
    unittest.main()
