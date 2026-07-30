from __future__ import annotations

from copy import deepcopy
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import stat
import tempfile
import unittest
from unittest.mock import patch

from chat_history_analysis.dataset_persistence import (
    DATABASE_NAME,
    FALLBACK_DOMAIN,
    FALLBACK_VERIFIER_DOMAIN,
    MANIFEST_NAME,
    MANIFEST_SCHEMA_VERSION,
    MAX_CHUNK_BYTES,
    NORMALIZED_RECORD_FIELDS,
    NORMALIZED_SCHEMA_VERSION,
    PLATFORM_ID_DOMAIN,
    PLATFORM_ID_VERIFIER_DOMAIN,
    STAGING_MARKER,
    STAGING_PREFIX,
    DatasetStagingConsumer,
    IdentityDigests,
    verify_overlap_against_dataset,
    _canonical_record_bytes,
    fallback_identity,
    platform_identity,
    recover_staging_remnant,
    validate_manifest,
    validate_normalized_record,
    verify_dataset_directory,
)
from chat_history_analysis.errors import (
    DatasetPersistenceError,
    DatasetPersistenceReasonCode,
    FailureCategory,
    SourceRole,
    SourceValidationError,
    SourceValidationReasonCode,
)
from chat_history_analysis.message_normalization import (
    NormalizationSummary,
    NormalizedMessage,
)
from chat_history_analysis.input_preflight import (
    PreflightedInputs,
    PreflightedOverlapVerification,
)
from chat_history_analysis.preprocessing_validation import (
    SourceFingerprint,
    ValidatedSourceDescriptor,
    ValidationResult,
    validate_preflighted_inputs,
)
from tests.stage3_support import (
    HAS_IJSON,
    OWNER as EXPORT_OWNER,
    PEER as EXPORT_PEER,
    message,
    real_backend,
    write_export,
)


FINGERPRINT = "ab" * 32
OWNER = "synthetic-owner"
PEER = "synthetic-peer"


def private_mode(path: Path) -> int:
    return stat.S_IMODE(os.lstat(path).st_mode)


def normalized(
    *,
    role: SourceRole = SourceRole.ANNUAL_SOURCE,
    ordinal: int = 1,
    rank: int | None = 0,
    source_index: int = 0,
    create_time: int = 0,
    sender: str = "owner",
    content: str = "synthetic normalized message",
) -> NormalizedMessage:
    local_time = create_time + (8 * 60 * 60)
    days, seconds = divmod(local_time, 24 * 60 * 60)
    if days != 0:
        raise ValueError("test helper supports only the Unix epoch day")
    hour, seconds = divmod(seconds, 60 * 60)
    minute, second = divmod(seconds, 60)
    formatted = f"1970-01-01 {hour:02d}:{minute:02d}:{second:02d}"
    return NormalizedMessage(
        source_role=role,
        source_ordinal=ordinal,
        file_rank=rank,
        source_array_index=source_index,
        create_time=create_time,
        formatted_time=formatted,
        calendar_date="1970-01-01",
        sender_scope=sender,
        content=content,
    )


def summary(
    *,
    observed: int,
    eligible: int,
    skipped: tuple[tuple[str, int], ...] = (),
    warnings: tuple[tuple[str, int], ...] = (),
) -> NormalizationSummary:
    return NormalizationSummary(
        observed_count=observed,
        eligible_count=eligible,
        owner_count=eligible,
        other_count=0,
        skipped_by_reason=skipped,
        warnings_by_reason=warnings,
    )


class DatasetPersistenceTests(unittest.TestCase):
    def setUp(self) -> None:
        temporary = tempfile.TemporaryDirectory(
            prefix="chat-analysis-stage56-",
            dir="/tmp",
        )
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name).resolve()
        self.source = self.root / "synthetic-source.json"
        self.source.write_bytes(b"synthetic-source")

    def descriptor(
        self,
        *,
        ordinal: int = 1,
        rank: int | None = 0,
        role: SourceRole = SourceRole.ANNUAL_SOURCE,
        minimum: int = 0,
        maximum: int = 10,
    ) -> ValidatedSourceDescriptor:
        metadata = self.source.stat()
        return ValidatedSourceDescriptor(
            fingerprint=SourceFingerprint(
                role=role,
                supplied_ordinal=ordinal,
                size_bytes=metadata.st_size,
                sha256=hashlib.sha256(self.source.read_bytes()).hexdigest(),
            ),
            raw_message_count=1,
            minimum_create_time=minimum,
            maximum_create_time=maximum,
            conversation_fingerprint=FINGERPRINT,
            file_rank=rank,
            path=self.source,
            source_device=metadata.st_dev,
            source_inode=metadata.st_ino,
            source_modified_time_ns=metadata.st_mtime_ns,
            source_changed_time_ns=metadata.st_ctime_ns,
        )

    def result(
        self,
        annual: tuple[ValidatedSourceDescriptor, ...],
        *,
        eligible: int,
        observed: int | None = None,
        skipped: tuple[tuple[str, int], ...] = (),
        warnings: tuple[tuple[str, int], ...] = (),
        verification: tuple[ValidatedSourceDescriptor, ...] = (),
    ) -> ValidationResult:
        observed_count = eligible if observed is None else observed
        return ValidationResult(
            annual_sources=annual,
            overlap_verifications=verification,
            conversation_fingerprint=FINGERPRINT,
            aggregate_raw_message_count=(
                observed_count + len(verification)
            ),
            annual_staged_message_count=observed_count,
            verification_streamed_message_count=len(verification),
            annual_normalization=summary(
                observed=observed_count,
                eligible=eligible,
                skipped=skipped,
                warnings=warnings,
            ),
            verification_normalization=summary(
                observed=len(verification),
                eligible=len(verification),
            ),
        )

    def stage(
        self,
        consumer: DatasetStagingConsumer,
        descriptor: ValidatedSourceDescriptor,
        record: NormalizedMessage,
        platform_id: object,
    ) -> None:
        consumer.stage_annual_record(
            descriptor,
            record,
            platform_id,
            owner_identity=OWNER,
            peer_identity=PEER,
        )

    def test_identity_domains_lengths_and_decimal_strings_are_exact(self) -> None:
        decimal = "00090071992547409930001"
        primary = platform_identity(FINGERPRINT, decimal)
        fallback = fallback_identity(FINGERPRINT, normalized())
        self.assertEqual(primary.kind, "platform-id-v1")
        self.assertEqual(fallback.kind, "fallback-v1")
        self.assertEqual((len(primary.digest), len(primary.verifier)), (32, 16))
        self.assertEqual((len(fallback.digest), len(fallback.verifier)), (32, 16))
        self.assertNotEqual(primary.digest, fallback.digest)
        self.assertNotEqual(
            platform_identity(FINGERPRINT, "a").digest,
            platform_identity(FINGERPRINT, "a\x00").digest,
        )
        self.assertEqual(
            PLATFORM_ID_DOMAIN,
            b"ChatHistoryAnalysis/dedup/platform-id/v1",
        )
        self.assertEqual(
            PLATFORM_ID_VERIFIER_DOMAIN,
            b"ChatHistoryAnalysis/dedup/platform-id-verifier/v1",
        )
        self.assertEqual(
            FALLBACK_DOMAIN,
            b"ChatHistoryAnalysis/dedup/fallback/v1",
        )
        self.assertEqual(
            FALLBACK_VERIFIER_DOMAIN,
            b"ChatHistoryAnalysis/dedup/fallback-verifier/v1",
        )

    def test_staging_schema_indexes_pragmas_permissions_and_raw_id_absence(
        self,
    ) -> None:
        destination = self.root / "dataset"
        consumer = DatasetStagingConsumer(destination)
        self.addCleanup(consumer.abort)
        descriptor = self.descriptor()
        raw_id = "private-platform-id-never-stored"
        self.stage(consumer, descriptor, normalized(), raw_id)
        connection = consumer._connection_required()
        columns = connection.execute(
            "PRAGMA table_info(staging_records)"
        ).fetchall()
        self.assertEqual(
            [row[1] for row in columns],
            [
                "identity_kind",
                "identity_digest",
                "identity_verifier",
                "create_time",
                "formatted_time",
                "calendar_date",
                "sender_scope",
                "content",
                "file_rank",
                "source_array_index",
            ],
        )
        indexes = connection.execute(
            "PRAGMA index_list(staging_records)"
        ).fetchall()
        self.assertEqual(len(indexes), 3)
        self.assertEqual(
            {row[1] for row in indexes if not row[1].startswith("sqlite_")},
            {"staging_collision_lookup", "staging_canonical_order"},
        )
        self.assertEqual(
            connection.execute("PRAGMA journal_mode").fetchone()[0],
            "delete",
        )
        self.assertEqual(
            connection.execute("PRAGMA temp_store").fetchone()[0],
            2,
        )
        self.assertEqual(
            connection.execute("PRAGMA secure_delete").fetchone()[0],
            1,
        )
        self.assertEqual(
            connection.execute("PRAGMA busy_timeout").fetchone()[0],
            0,
        )
        consumer.complete()
        consumer._close_database()
        self.assertEqual(private_mode(consumer._stage), 0o700)
        self.assertEqual(private_mode(consumer._database), 0o600)
        self.assertEqual(
            private_mode(consumer._stage / STAGING_MARKER),
            0o600,
        )
        self.assertNotIn(raw_id.encode(), consumer._database.read_bytes())
        self.assertFalse((Path(os.fspath(consumer._database) + "-wal")).exists())
        self.assertFalse((Path(os.fspath(consumer._database) + "-shm")).exists())

    def test_duplicate_survivor_collision_and_identity_verification(self) -> None:
        destination = self.root / "dataset"
        consumer = DatasetStagingConsumer(destination)
        self.addCleanup(consumer.abort)
        later = self.descriptor(ordinal=2, rank=1)
        earlier = self.descriptor(ordinal=1, rank=0)
        self.stage(
            consumer,
            later,
            normalized(
                ordinal=2,
                rank=1,
                content="synthetic later duplicate",
            ),
            "same-id",
        )
        self.stage(
            consumer,
            earlier,
            normalized(content="synthetic earlier survivor"),
            "same-id",
        )
        row = consumer._connection_required().execute(
            "SELECT content, file_rank, source_array_index FROM staging_records"
        ).fetchone()
        self.assertEqual(
            row,
            ("synthetic earlier survivor", 0, 0),
        )
        self.assertEqual(consumer.duplicate_count, 1)

        verification = self.descriptor(
            role=SourceRole.OVERLAP_VERIFICATION,
            rank=None,
        )
        consumer.observe_verification_record(
            verification,
            normalized(
                role=SourceRole.OVERLAP_VERIFICATION,
                rank=None,
            ),
            "same-id",
            owner_identity=OWNER,
            peer_identity=PEER,
        )
        consumer.observe_verification_record(
            verification,
            normalized(
                role=SourceRole.OVERLAP_VERIFICATION,
                rank=None,
                content="synthetic unmatched",
            ),
            "different-id",
            owner_identity=OWNER,
            peer_identity=PEER,
        )
        self.assertEqual(
            (consumer._matched_verification, consumer._unmatched_verification),
            (1, 1),
        )

        fixed_digest = b"d" * 32
        identities = (
            IdentityDigests("platform-id-v1", fixed_digest, b"a" * 16),
            IdentityDigests("platform-id-v1", fixed_digest, b"b" * 16),
        )
        collision = DatasetStagingConsumer(self.root / "collision")
        self.addCleanup(collision.abort)
        with patch(
            "chat_history_analysis.dataset_persistence._identity_for",
            side_effect=identities,
        ):
            self.stage(collision, earlier, normalized(), "first")
            with self.assertRaises(DatasetPersistenceError) as raised:
                self.stage(
                    collision,
                    earlier,
                    normalized(
                        source_index=1,
                        content="synthetic collision",
                    ),
                    "second",
                )
        self.assertEqual(
            raised.exception.reason_code,
            DatasetPersistenceReasonCode.CRYPTOGRAPHIC_IDENTITY_COLLISION,
        )
        self.assertEqual(
            raised.exception.category,
            FailureCategory.INPUT_VALIDATION,
        )

    def test_deterministic_output_order_manifest_privacy_and_permissions(
        self,
    ) -> None:
        descriptor = self.descriptor()

        def build(destination: Path) -> tuple[bytes, bytes]:
            consumer = DatasetStagingConsumer(destination)
            self.stage(
                consumer,
                descriptor,
                normalized(
                    source_index=1,
                    content="synthetic second by raw index",
                ),
                "id-second",
            )
            self.stage(
                consumer,
                descriptor,
                normalized(
                    source_index=0,
                    content="synthetic first by raw index",
                ),
                "id-first",
            )
            consumer.complete()
            built = consumer.publish(
                self.result((descriptor,), eligible=2)
            )
            self.assertEqual(built.normalized_record_count, 2)
            self.assertEqual(built.chunk_count, 1)
            verified = verify_dataset_directory(destination)
            manifest_bytes = (destination / MANIFEST_NAME).read_bytes()
            chunk_bytes = (destination / "chunk-0001.ndjson").read_bytes()
            self.assertEqual(
                verified.manifest["schemaVersion"],
                MANIFEST_SCHEMA_VERSION,
            )
            self.assertEqual(
                verified.manifest["normalizedSchemaVersion"],
                NORMALIZED_SCHEMA_VERSION,
            )
            self.assertNotIn(os.fspath(self.source), manifest_bytes.decode())
            self.assertNotIn(self.source.name, manifest_bytes.decode())
            self.assertNotIn(OWNER, manifest_bytes.decode())
            self.assertNotIn(PEER, manifest_bytes.decode())
            self.assertEqual(private_mode(destination), 0o700)
            for entry in destination.iterdir():
                self.assertEqual(private_mode(entry), 0o600)
            records = [
                json.loads(line)
                for line in chunk_bytes.decode("utf-8").splitlines()
            ]
            self.assertEqual(
                [record["content"] for record in records],
                [
                    "synthetic first by raw index",
                    "synthetic second by raw index",
                ],
            )
            self.assertEqual(
                [record["sourceIndex"] for record in records],
                [0, 1],
            )
            self.assertEqual(
                tuple(records[0]),
                NORMALIZED_RECORD_FIELDS,
            )
            return manifest_bytes, chunk_bytes

        first = build(self.root / "dataset-one")
        second = build(self.root / "dataset-two")
        self.assertEqual(first, second)
        self.assertEqual(
            [
                entry.name
                for entry in self.root.iterdir()
                if entry.name.startswith(STAGING_PREFIX)
            ],
            [],
        )

    def test_chunk_exact_boundary_split_and_first_byte_over(self) -> None:
        descriptor = self.descriptor()
        first = normalized(content="synthetic boundary one")
        encoded_size = len(
            _canonical_record_bytes(
                {
                    "createTime": first.create_time,
                    "formattedTime": first.formatted_time,
                    "calendarDate": first.calendar_date,
                    "senderScope": first.sender_scope,
                    "content": first.content,
                    "fileRank": 0,
                    "sourceIndex": 0,
                }
            )
        )
        with patch(
            "chat_history_analysis.dataset_persistence.MAX_CHUNK_BYTES",
            encoded_size,
        ):
            consumer = DatasetStagingConsumer(self.root / "split")
            self.addCleanup(consumer.abort)
            self.stage(consumer, descriptor, first, "first")
            self.stage(
                consumer,
                descriptor,
                normalized(
                    source_index=1,
                    content="x",
                ),
                "second",
            )
            consumer.complete()
            result = consumer.publish(
                self.result((descriptor,), eligible=2)
            )
            self.assertEqual(result.chunk_count, 2)
            self.assertEqual(
                (self.root / "split" / "chunk-0001.ndjson").stat().st_size,
                encoded_size,
            )

        with patch(
            "chat_history_analysis.dataset_persistence.MAX_CHUNK_BYTES",
            encoded_size - 1,
        ):
            consumer = DatasetStagingConsumer(self.root / "oversized")
            self.addCleanup(consumer.abort)
            self.stage(consumer, descriptor, first, "first")
            consumer.complete()
            with self.assertRaises(DatasetPersistenceError) as raised:
                consumer.publish(self.result((descriptor,), eligible=1))
            self.assertEqual(
                raised.exception.reason_code,
                DatasetPersistenceReasonCode.NORMALIZED_RECORD_TOO_LARGE,
            )
            consumer.abort()
            self.assertFalse((self.root / "oversized").exists())

    def test_pairwise_overlap_threshold_and_normalized_limits(self) -> None:
        first = self.descriptor(
            ordinal=1,
            rank=0,
            minimum=0,
            maximum=10_000_000,
        )
        second = self.descriptor(
            ordinal=2,
            rank=1,
            minimum=1,
            maximum=1_000_000,
        )
        third = self.descriptor(
            ordinal=3,
            rank=2,
            minimum=3_000_000,
            maximum=6_000_000,
        )
        overlap_result = self.result(
            (first, second, third),
            eligible=0,
        )
        self.assertEqual(
            DatasetStagingConsumer._range_overlap(overlap_result),
            (2, 1),
        )

        consumer = DatasetStagingConsumer(self.root / "record-limit")
        self.addCleanup(consumer.abort)
        self.stage(consumer, first, normalized(), "first")
        self.stage(
            consumer,
            first,
            normalized(source_index=1, content="synthetic second"),
            "second",
        )
        consumer.complete()
        with patch(
            "chat_history_analysis.dataset_persistence.MAX_NORMALIZED_RECORDS",
            1,
        ):
            with self.assertRaises(DatasetPersistenceError) as raised:
                consumer.publish(self.result((first,), eligible=2))
        self.assertEqual(
            raised.exception.reason_code,
            DatasetPersistenceReasonCode.NORMALIZED_RECORD_LIMIT_EXCEEDED,
        )
        consumer.abort()
        self.assertFalse((self.root / "record-limit").exists())

        consumer = DatasetStagingConsumer(self.root / "dataset-limit")
        self.addCleanup(consumer.abort)
        self.stage(consumer, first, normalized(), "first")
        consumer.complete()
        with patch(
            "chat_history_analysis.dataset_persistence.MAX_NORMALIZED_DATASET_BYTES",
            1,
        ):
            with self.assertRaises(DatasetPersistenceError) as raised:
                consumer.publish(self.result((first,), eligible=1))
        self.assertEqual(
            raised.exception.reason_code,
            DatasetPersistenceReasonCode.NORMALIZED_DATASET_LIMIT_EXCEEDED,
        )
        consumer.abort()
        self.assertFalse((self.root / "dataset-limit").exists())

    def test_zero_records_destination_collision_and_privacy_failure(self) -> None:
        descriptor = self.descriptor()
        empty = DatasetStagingConsumer(self.root / "empty")
        self.addCleanup(empty.abort)
        empty.complete()
        with self.assertRaises(DatasetPersistenceError) as raised:
            empty.publish(self.result((descriptor,), eligible=0))
        self.assertEqual(
            raised.exception.reason_code,
            DatasetPersistenceReasonCode.NO_ELIGIBLE_TEXT_RECORDS,
        )
        empty.abort()
        self.assertFalse((self.root / "empty").exists())

        existing = self.root / "existing"
        existing.mkdir(mode=0o700)
        with self.assertRaises(DatasetPersistenceError) as raised:
            DatasetStagingConsumer(existing)
        self.assertEqual(
            raised.exception.reason_code,
            DatasetPersistenceReasonCode.OUTPUT_DESTINATION_EXISTS,
        )
        self.assertEqual(list(existing.iterdir()), [])

        private = DatasetStagingConsumer(self.root / "private")
        self.addCleanup(private.abort)
        with self.assertRaises(DatasetPersistenceError) as raised:
            self.stage(
                private,
                descriptor,
                normalized(content=f"contains {self.source.name}"),
                "id",
            )
        self.assertEqual(
            raised.exception.reason_code,
            DatasetPersistenceReasonCode.PRIVACY_VALIDATION_FAILED,
        )
        rendered = json.dumps(raised.exception.public_payload())
        self.assertNotIn(self.source.name, rendered)

    def test_staging_name_collision_and_write_failure_clean_up_safely(
        self,
    ) -> None:
        token = "0" * 32
        collision = self.root / f"{STAGING_PREFIX}{token}"
        collision.mkdir(mode=0o700)
        with patch(
            "chat_history_analysis.dataset_persistence.secrets.token_hex",
            return_value=token,
        ):
            with self.assertRaises(DatasetPersistenceError) as raised:
                DatasetStagingConsumer(self.root / "collision-target")
        self.assertEqual(
            raised.exception.reason_code,
            DatasetPersistenceReasonCode.OUTPUT_STAGING_FAILED,
        )
        self.assertTrue(collision.exists())

        descriptor = self.descriptor()
        destination = self.root / "write-failure"
        consumer = DatasetStagingConsumer(destination)
        self.stage(consumer, descriptor, normalized(), "id")
        consumer.complete()
        failure = DatasetPersistenceError(
            DatasetPersistenceReasonCode.OUTPUT_WRITE_FAILED,
            phase="output-serialization",
        )
        with patch(
            "chat_history_analysis.dataset_persistence._write_all",
            side_effect=failure,
        ):
            with self.assertRaises(DatasetPersistenceError):
                consumer.publish(self.result((descriptor,), eligible=1))
        consumer.abort()
        self.assertFalse(destination.exists())
        self.assertFalse(consumer._stage.exists())

    def test_manifest_and_chunk_validation_reject_tampering(self) -> None:
        descriptor = self.descriptor()
        destination = self.root / "dataset"
        consumer = DatasetStagingConsumer(destination)
        self.stage(consumer, descriptor, normalized(), "id")
        consumer.complete()
        consumer.publish(self.result((descriptor,), eligible=1))
        manifest_path = destination / MANIFEST_NAME
        original_manifest = manifest_path.read_bytes()
        manifest = json.loads(original_manifest)
        changed = deepcopy(manifest)
        changed["unexpected"] = 1
        with self.assertRaises(DatasetPersistenceError):
            validate_manifest(changed)
        manifest_path.write_bytes(
            (
                '{"schemaVersion":"'
                + MANIFEST_SCHEMA_VERSION
                + '",'
            ).encode("utf-8")
            + original_manifest[1:]
        )
        os.chmod(manifest_path, 0o600)
        with self.assertRaises(DatasetPersistenceError) as raised:
            verify_dataset_directory(destination)
        self.assertEqual(
            raised.exception.reason_code,
            DatasetPersistenceReasonCode.NORMALIZED_SCHEMA_INVALID,
        )
        manifest_path.write_bytes(original_manifest)
        os.chmod(manifest_path, 0o600)
        record = {
            "createTime": 0,
            "formattedTime": "1970-01-01 08:00:00",
            "calendarDate": "1970-01-01",
            "senderScope": "owner",
            "content": "https://example.invalid/private",
            "fileRank": 0,
            "sourceIndex": 0,
        }
        with self.assertRaises(DatasetPersistenceError):
            validate_normalized_record(record)

        chunk = destination / "chunk-0001.ndjson"
        original = chunk.read_bytes()
        chunk.write_bytes(original.replace(b"synthetic", b"synthetix", 1))
        os.chmod(chunk, 0o600)
        with self.assertRaises(DatasetPersistenceError) as raised:
            verify_dataset_directory(destination)
        self.assertEqual(
            raised.exception.reason_code,
            DatasetPersistenceReasonCode.OUTPUT_INTEGRITY_FAILED,
        )

    def test_promotion_failure_leaves_no_final_and_recovery_is_explicit(
        self,
    ) -> None:
        descriptor = self.descriptor()
        destination = self.root / "failed"
        consumer = DatasetStagingConsumer(destination)
        self.stage(consumer, descriptor, normalized(), "id")
        consumer.complete()
        failure = DatasetPersistenceError(
            DatasetPersistenceReasonCode.OUTPUT_PROMOTION_FAILED,
            phase="output-promotion",
        )
        with patch(
            "chat_history_analysis.dataset_persistence._atomic_rename_exclusive",
            side_effect=failure,
        ):
            with self.assertRaises(DatasetPersistenceError):
                consumer.publish(self.result((descriptor,), eligible=1))
        self.assertFalse(destination.exists())
        consumer.abort()
        self.assertFalse(consumer._stage.exists())

        remnant = DatasetStagingConsumer(self.root / "never-published")
        remnant.complete()
        remnant._close_database()
        stage = remnant._stage
        inspected = recover_staging_remnant(self.root)
        self.assertEqual(inspected.candidate_count, 1)
        self.assertEqual(
            inspected.state_codes,
            ("RECOGNIZED_PRIVATE_REMNANT",),
        )
        with self.assertRaises(DatasetPersistenceError) as raised:
            recover_staging_remnant(
                self.root,
                candidate_ordinal=1,
            )
        self.assertEqual(
            raised.exception.reason_code,
            DatasetPersistenceReasonCode.RECOVERY_CONFIRMATION_REQUIRED,
        )
        removed = recover_staging_remnant(
            self.root,
            candidate_ordinal=1,
            confirmed=True,
        )
        self.assertEqual(removed.removed_count, 1)
        self.assertFalse(stage.exists())

    def test_recovery_rejects_symlinks_and_wrong_marker_content(self) -> None:
        unsafe = self.root / f"{STAGING_PREFIX}unsafe"
        unsafe.mkdir(mode=0o700)
        marker = unsafe / STAGING_MARKER
        marker.write_bytes(b"wrong marker\n")
        os.chmod(marker, 0o600)
        inspected = recover_staging_remnant(self.root)
        self.assertEqual(inspected.state_codes, ("UNSAFE_CANDIDATE",))
        with self.assertRaises(DatasetPersistenceError):
            recover_staging_remnant(
                self.root,
                candidate_ordinal=1,
                confirmed=True,
            )
        self.assertTrue(unsafe.exists())


@unittest.skipUnless(HAS_IJSON, "ijson==3.5.1 is required")
class DatasetPersistenceStreamingTests(unittest.TestCase):
    def setUp(self) -> None:
        temporary = tempfile.TemporaryDirectory(
            prefix="chat-analysis-stage56-stream-",
            dir="/tmp",
        )
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name).resolve()

    def test_rank_dedup_and_combined_and_separate_overlap_verification(
        self,
    ) -> None:
        later = write_export(
            self.root / "later.json",
            (
                message(
                    10,
                    EXPORT_OWNER,
                    content="synthetic earliest survivor",
                    platformMessageId="shared-id",
                ),
                message(
                    12,
                    EXPORT_PEER,
                    content="synthetic later unique",
                    platformMessageId="later-id",
                ),
            ),
        )
        earlier = write_export(
            self.root / "earlier.json",
            (
                message(
                    10,
                    EXPORT_OWNER,
                    content="synthetic earliest survivor",
                    platformMessageId="shared-id",
                ),
                message(
                    11,
                    EXPORT_PEER,
                    content="synthetic earlier unique",
                    platformMessageId="earlier-id",
                ),
            ),
        )
        verification = write_export(
            self.root / "verification.json",
            (
                message(
                    10,
                    EXPORT_OWNER,
                    content="synthetic earliest survivor",
                    platformMessageId="shared-id",
                ),
                message(
                    11,
                    EXPORT_PEER,
                    content="synthetic earlier unique",
                    platformMessageId="earlier-id",
                ),
                message(
                    13,
                    EXPORT_OWNER,
                    content="synthetic partial overlap",
                    platformMessageId="verification-only-id",
                ),
            ),
        )
        destination = self.root / "dataset"
        consumer = DatasetStagingConsumer(destination)
        validation = validate_preflighted_inputs(
            PreflightedInputs(
                annual_sources=(later, earlier),
                overlap_verifications=(verification,),
                output_directory=destination,
            ),
            real_backend(),
            staging_consumer=consumer,
        )
        self.assertEqual(
            [
                (item.supplied_ordinal, item.file_rank)
                for item in validation.annual_sources
            ],
            [(2, 0), (1, 1)],
        )
        built = consumer.publish(validation)
        self.assertEqual(
            (
                built.normalized_record_count,
                built.duplicate_record_count,
            ),
            (3, 1),
        )
        manifest = verify_dataset_directory(destination).manifest
        self.assertEqual(
            manifest["aggregates"]["overlap"][
                "matchedEligibleRecordCount"
            ],
            2,
        )
        self.assertEqual(
            manifest["aggregates"]["overlap"][
                "unmatchedEligibleRecordCount"
            ],
            1,
        )
        before = {
            entry.name: hashlib.sha256(entry.read_bytes()).hexdigest()
            for entry in destination.iterdir()
        }
        separate = verify_overlap_against_dataset(
            PreflightedOverlapVerification(
                dataset_directory=destination,
                overlap_verifications=(verification,),
            ),
            real_backend(),
        )
        self.assertEqual(
            (
                separate.source_count,
                separate.eligible_record_count,
                separate.matched_record_count,
                separate.unmatched_record_count,
            ),
            (1, 3, 2, 1),
        )
        after = {
            entry.name: hashlib.sha256(entry.read_bytes()).hexdigest()
            for entry in destination.iterdir()
        }
        self.assertEqual(before, after)
        self.assertEqual(
            [
                entry.name
                for entry in self.root.iterdir()
                if entry.name.startswith(STAGING_PREFIX)
            ],
            [],
        )

    def test_public_fixture_publishes_verified_unchanged_dataset(self) -> None:
        fixture = (
            Path(__file__).resolve().parents[1]
            / "data"
            / "mock"
            / "ciphertalk_detailed_chat_2025.json"
        )
        fixture_bytes = fixture.read_bytes()
        self.assertEqual(
            hashlib.sha256(fixture_bytes).hexdigest(),
            "de6c09bac2c9ae2b3742a65f7d5f93886ff70c55be19aa5cacd09ca35e6dc839",
        )
        destination = self.root / "fixture-dataset"
        consumer = DatasetStagingConsumer(destination)
        validation = validate_preflighted_inputs(
            PreflightedInputs(
                annual_sources=(fixture,),
                overlap_verifications=(),
                output_directory=destination,
            ),
            real_backend(),
            staging_consumer=consumer,
        )
        built = consumer.publish(validation)
        self.assertEqual(built.normalized_record_count, 4_100)
        verified = verify_dataset_directory(destination)
        self.assertEqual(
            verified.manifest["aggregates"]["normalizedRecordCount"],
            4_100,
        )
        self.assertEqual(fixture.read_bytes(), fixture_bytes)

    def test_input_mutation_after_staging_blocks_final_promotion(self) -> None:
        source = write_export(
            self.root / "mutable.json",
            (
                message(10, EXPORT_OWNER),
                message(11, EXPORT_PEER),
            ),
        )
        destination = self.root / "mutated-dataset"
        consumer = DatasetStagingConsumer(destination)
        validation = validate_preflighted_inputs(
            PreflightedInputs(
                annual_sources=(source,),
                overlap_verifications=(),
                output_directory=destination,
            ),
            real_backend(),
            staging_consumer=consumer,
        )
        original = source.read_bytes()
        mutated = original.replace(
            b"synthetic-message",
            b"synthetic-messagf",
            1,
        )
        self.assertEqual(len(original), len(mutated))
        source.write_bytes(mutated)
        with self.assertRaises(SourceValidationError) as raised:
            consumer.publish(validation)
        self.assertEqual(
            raised.exception.reason_code,
            SourceValidationReasonCode.SOURCE_MUTATED,
        )
        consumer.abort()
        self.assertFalse(destination.exists())

    def test_invalid_combined_verification_cleans_stage_and_final(self) -> None:
        annual = write_export(
            self.root / "annual.json",
            (
                message(10, EXPORT_OWNER),
                message(11, EXPORT_PEER),
            ),
        )
        other_owner = "synthetic-other-owner"
        other_peer = "synthetic-other-peer"
        verification = write_export(
            self.root / "different-verification.json",
            (
                message(10, other_owner),
                message(11, other_peer),
            ),
            session={
                "isGroup": False,
                "type": "私聊",
                "platform": "synthetic-platform",
                "ownerId": other_owner,
                "wxid": other_peer,
            },
        )
        destination = self.root / "must-remain-absent"
        consumer = DatasetStagingConsumer(destination)
        with self.assertRaises(SourceValidationError) as raised:
            validate_preflighted_inputs(
                PreflightedInputs(
                    annual_sources=(annual,),
                    overlap_verifications=(verification,),
                    output_directory=destination,
                ),
                real_backend(),
                staging_consumer=consumer,
            )
        self.assertEqual(
            raised.exception.reason_code,
            SourceValidationReasonCode.DIFFERENT_CONVERSATION,
        )
        self.assertEqual(
            raised.exception.category,
            FailureCategory.VERIFICATION,
        )
        self.assertFalse(destination.exists())
        self.assertFalse(consumer._stage.exists())


if __name__ == "__main__":
    unittest.main()
