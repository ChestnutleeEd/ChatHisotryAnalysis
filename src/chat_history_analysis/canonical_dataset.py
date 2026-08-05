"""Private v2 event staging and deterministic canonical dataset publication.

This module is deliberately separate from the frozen v1 normalized dataset
path.  It shares only the trusted filesystem primitives and input
revalidation boundary; v1 output bytes and its zero-eligible rejection stay
unchanged.
"""

from __future__ import annotations

from dataclasses import dataclass
import hashlib
import json
import os
from pathlib import Path
import secrets
import sqlite3
import stat
from typing import Any, BinaryIO, Iterator, Mapping
from urllib.parse import quote

from .canonical_event_v2 import (
    CANONICAL_EVENT_SCHEMA_VERSION,
    CANONICAL_MESSAGE_CATEGORIES,
    CanonicalAggregatesV2,
    CanonicalEventV2,
    CanonicalManifestV2,
    CanonicalPublicationCountsV2,
    MAX_CANONICAL_CHUNK_BYTES,
    MAX_CANONICAL_CHUNK_COUNT,
    MAX_CANONICAL_DATASET_BYTES,
    MAX_CANONICAL_EVENTS,
    serialize_canonical_event,
    serialize_canonical_manifest,
    validate_canonical_event,
    validate_canonical_manifest,
)
from .dataset_persistence import (
    _atomic_rename_exclusive,
    _directory_flags,
    _ensure_private_parent,
    _flush_close,
    _json_without_duplicates,
    _mode,
    _remove_stage_entries,
    _secure_create_file,
    _verify_inputs_unchanged,
    _write_all,
    canonical_event_identity,
)
from .errors import (
    DATASET_STAGING_PHASE,
    FailureCategory,
    OUTPUT_PROMOTION_PHASE,
    OUTPUT_SERIALIZATION_PHASE,
    OUTPUT_VERIFICATION_PHASE,
    DatasetPersistenceError,
    DatasetPersistenceReasonCode,
    SourceRole,
)
from .message_normalization import CanonicalEventCandidate
from .operation_control import current_operation_control
from .preprocessing_validation import ValidatedSourceDescriptor, ValidationResult


CANONICAL_MANIFEST_NAME = "manifest.json"
CANONICAL_PUBLICATION_MARKER_NAME = ".canonical-dataset-complete-v2"
CANONICAL_PUBLICATION_MARKER = b"chat-history-analysis-canonical-dataset-v2-complete\n"
CANONICAL_DATABASE_NAME = ".staging-events.sqlite3"
CANONICAL_STAGING_MARKER = ".chathistoryanalysis-private-stage-v2"
CANONICAL_STAGING_PREFIX = ".chathistoryanalysis-stage-v2-"
CANONICAL_MANIFEST_MAX_BYTES = 4_194_304


@dataclass(frozen=True, slots=True)
class CanonicalChunkDescriptor:
    ordinal: int
    name: str
    byte_size: int
    record_count: int
    sha256: str

    def as_mapping(self) -> dict[str, object]:
        return {
            "ordinal": self.ordinal,
            "name": self.name,
            "byteSize": self.byte_size,
            "recordCount": self.record_count,
            "sha256": self.sha256,
        }


@dataclass(frozen=True, slots=True)
class CanonicalDatasetBuildResult:
    event_count: int
    eligible_text_count: int
    chunk_count: int
    duplicate_event_count: int
    warning_count: int
    matched_verification_event_count: int
    unmatched_verification_event_count: int
    manifest_sha256: str
    source_count: int
    raw_accepted_event_count: int


@dataclass(frozen=True, slots=True)
class VerifiedCanonicalDataset:
    manifest: Mapping[str, Any]
    directory: Path


def _error(
    reason: DatasetPersistenceReasonCode,
    *,
    phase: str,
    category: FailureCategory = FailureCategory.OUTPUT,
) -> DatasetPersistenceError:
    return DatasetPersistenceError(reason, phase=phase, category=category)


def _secure_stage(parent: Path, parent_descriptor: int) -> Path:
    for _ in range(32):
        name = CANONICAL_STAGING_PREFIX + secrets.token_hex(16)
        try:
            os.mkdir(name, 0o700, dir_fd=parent_descriptor)
        except FileExistsError:
            continue
        except OSError:
            raise _error(
                DatasetPersistenceReasonCode.OUTPUT_STAGING_FAILED,
                phase=DATASET_STAGING_PHASE,
            ) from None
        stage = parent / name
        try:
            anchored = os.stat(name, dir_fd=parent_descriptor, follow_symlinks=False)
            lexical = os.lstat(stage)
            if not (
                stat.S_ISDIR(anchored.st_mode)
                and stat.S_ISDIR(lexical.st_mode)
                and not stat.S_ISLNK(lexical.st_mode)
                and anchored.st_uid == os.getuid()
                and lexical.st_uid == os.getuid()
                and _mode(anchored) == 0o700
                and _mode(lexical) == 0o700
                and (anchored.st_dev, anchored.st_ino)
                == (lexical.st_dev, lexical.st_ino)
            ):
                raise OSError
        except OSError:
            try:
                os.rmdir(name, dir_fd=parent_descriptor)
            except OSError:
                pass
            raise _error(
                DatasetPersistenceReasonCode.OUTPUT_STAGING_FAILED,
                phase=DATASET_STAGING_PHASE,
            ) from None
        return stage
    raise _error(
        DatasetPersistenceReasonCode.OUTPUT_STAGING_FAILED,
        phase=DATASET_STAGING_PHASE,
    )


def _open_v2_database(path: Path) -> sqlite3.Connection:
    uri = "file:" + quote(os.fspath(path), safe="/")
    uri += "?mode=rw&cache=private"
    connection: sqlite3.Connection | None = None
    try:
        connection = sqlite3.connect(uri, uri=True, timeout=0, isolation_level=None)
        expected = (
            ("journal_mode", "DELETE", "delete"),
            ("temp_store", "MEMORY", 2),
            ("secure_delete", "ON", 1),
            ("busy_timeout", "0", 0),
        )
        for name, setting, observed in expected:
            row = connection.execute(f"PRAGMA {name}={setting}").fetchone()
            if name == "journal_mode":
                value = row[0] if row else None
            else:
                queried = connection.execute(f"PRAGMA {name}").fetchone()
                value = queried[0] if queried else None
            if value != observed:
                raise sqlite3.DatabaseError
        categories = ", ".join(repr(category) for category in CANONICAL_MESSAGE_CATEGORIES)
        connection.execute(
            f"""
            CREATE TABLE staging_events (
                event_id INTEGER PRIMARY KEY,
                identity_kind TEXT NOT NULL CHECK(
                    identity_kind IN ('platform-id-v1','fallback-v2','unverifiable-v2')
                ),
                identity_digest BLOB,
                identity_verifier BLOB,
                create_time INTEGER NOT NULL CHECK(create_time >= 0),
                formatted_time TEXT NOT NULL,
                calendar_date TEXT NOT NULL,
                sender_scope TEXT CHECK(sender_scope IN ('owner','other') OR sender_scope IS NULL),
                message_category TEXT NOT NULL CHECK(message_category IN ({categories})),
                text_eligible INTEGER NOT NULL CHECK(text_eligible IN (0,1)),
                content TEXT,
                file_rank INTEGER NOT NULL CHECK(file_rank >= 0),
                source_array_index INTEGER NOT NULL CHECK(source_array_index >= 0),
                source_ordinal INTEGER NOT NULL CHECK(source_ordinal >= 1),
                CHECK(
                    (identity_kind = 'unverifiable-v2'
                     AND identity_digest IS NULL AND identity_verifier IS NULL)
                    OR
                    (identity_kind <> 'unverifiable-v2'
                     AND length(identity_digest) = 32
                     AND length(identity_verifier) = 16)
                ),
                CHECK(
                    (message_category = 'system'
                     AND sender_scope IS NULL AND text_eligible = 0 AND content IS NULL)
                    OR
                    (message_category <> 'system'
                     AND sender_scope IS NOT NULL
                     AND ((text_eligible = 1 AND message_category = 'text' AND content IS NOT NULL)
                          OR (text_eligible = 0 AND content IS NULL)))
                )
            )
            """
        )
        connection.execute(
            """
            CREATE INDEX staging_event_identity
            ON staging_events(identity_kind, identity_digest)
            """
        )
        connection.execute(
            """
            CREATE INDEX staging_event_canonical_order
            ON staging_events(create_time, file_rank, source_array_index, event_id)
            """
        )
        connection.execute(
            """
            CREATE INDEX staging_event_category
            ON staging_events(message_category, text_eligible)
            """
        )
        connection.execute("BEGIN IMMEDIATE")
        return connection
    except (sqlite3.Error, ValueError):
        if connection is not None:
            try:
                connection.close()
            except sqlite3.Error:
                pass
        raise _error(
            DatasetPersistenceReasonCode.SQLITE_POLICY_FAILED,
            phase=DATASET_STAGING_PHASE,
        ) from None


class CanonicalEventStagingConsumer:
    """Stage every valid canonical event without persisting raw identity data."""

    __slots__ = (
        "_complete",
        "_connection",
        "_database",
        "_destination",
        "_duplicate_count",
        "_matched_verification",
        "_published",
        "_stage",
        "_unmatched_verification",
        "_verification_count",
        "_warning_count",
    )

    def __init__(self, destination: Path) -> None:
        self._destination = destination
        self._stage = destination
        self._database = destination
        self._connection: sqlite3.Connection | None = None
        self._duplicate_count = 0
        self._warning_count = 0
        self._verification_count = 0
        self._matched_verification = 0
        self._unmatched_verification = 0
        self._complete = False
        self._published = False
        old_umask = os.umask(0o077)
        try:
            try:
                os.lstat(destination)
            except FileNotFoundError:
                pass
            else:
                raise _error(
                    DatasetPersistenceReasonCode.OUTPUT_DESTINATION_EXISTS,
                    phase=DATASET_STAGING_PHASE,
                )
            parent_descriptor, parent_metadata = _ensure_private_parent(
                destination.parent
            )
            try:
                self._stage = _secure_stage(destination.parent, parent_descriptor)
            finally:
                os.close(parent_descriptor)
            stage_metadata = os.lstat(self._stage)
            if (
                stage_metadata.st_dev != parent_metadata.st_dev
                or _mode(stage_metadata) != 0o700
            ):
                raise _error(
                    DatasetPersistenceReasonCode.OUTPUT_PARENT_UNSAFE,
                    phase=DATASET_STAGING_PHASE,
                )
            marker = _secure_create_file(self._stage / CANONICAL_STAGING_MARKER)
            _write_all(marker, b"chat-history-analysis-private-stage-v2\n")
            _flush_close(marker)
            self._database = self._stage / CANONICAL_DATABASE_NAME
            empty = _secure_create_file(self._database)
            _flush_close(empty)
            self._connection = _open_v2_database(self._database)
        except BaseException:
            if self._connection is not None:
                try:
                    self._connection.close()
                except sqlite3.Error:
                    pass
            if self._stage != destination:
                try:
                    _remove_stage_entries(self._stage)
                except DatasetPersistenceError:
                    pass
            raise
        finally:
            os.umask(old_umask)

    @property
    def duplicate_count(self) -> int:
        return self._duplicate_count

    @property
    def warning_count(self) -> int:
        return self._warning_count

    @property
    def matched_verification_count(self) -> int:
        return self._matched_verification

    @property
    def unmatched_verification_count(self) -> int:
        return self._unmatched_verification

    @property
    def verification_count(self) -> int:
        return self._verification_count

    def _connection_required(self) -> sqlite3.Connection:
        if self._connection is None:
            raise _error(
                DatasetPersistenceReasonCode.OUTPUT_STAGING_FAILED,
                phase=DATASET_STAGING_PHASE,
            )
        return self._connection

    @staticmethod
    def _candidate_event(
        descriptor: ValidatedSourceDescriptor,
        candidate: CanonicalEventCandidate,
    ) -> CanonicalEventV2:
        if (
            descriptor.role is not SourceRole.ANNUAL_SOURCE
            or descriptor.file_rank is None
            or candidate.file_rank != descriptor.file_rank
            or candidate.source_role is not descriptor.role
            or candidate.source_ordinal != descriptor.supplied_ordinal
            or candidate.source_array_index < 0
        ):
            raise _error(
                DatasetPersistenceReasonCode.SOURCE_EVENT_INVALID,
                phase=DATASET_STAGING_PHASE,
                category=FailureCategory.INPUT_VALIDATION,
            )
        event = CanonicalEventV2(
            create_time=candidate.create_time,
            formatted_time=candidate.formatted_time,
            calendar_date=candidate.calendar_date,
            sender_scope=candidate.sender_scope,
            message_category=candidate.message_category,  # type: ignore[arg-type]
            text_eligible=candidate.text_eligible,
            content=candidate.content,
            file_rank=descriptor.file_rank,
            source_index=candidate.source_array_index,
        )
        try:
            validate_canonical_event(event.as_mapping())
        except ValueError:
            raise _error(
                DatasetPersistenceReasonCode.SOURCE_EVENT_INVALID,
                phase=DATASET_STAGING_PHASE,
                category=FailureCategory.INPUT_VALIDATION,
            ) from None
        return event

    def _insert(
        self,
        descriptor: ValidatedSourceDescriptor,
        candidate: CanonicalEventCandidate,
        *,
        identity_kind: str,
        identity_digest: bytes | None,
        identity_verifier: bytes | None,
    ) -> bool:
        event = self._candidate_event(descriptor, candidate)
        connection = self._connection_required()
        try:
            if identity_kind != "unverifiable-v2":
                existing = connection.execute(
                    """
                    SELECT event_id, identity_verifier, file_rank, source_array_index
                    FROM staging_events
                    WHERE identity_kind = ? AND identity_digest = ?
                    LIMIT 1
                    """,
                    (identity_kind, identity_digest),
                ).fetchone()
                if existing is not None:
                    if bytes(existing[1]) != identity_verifier:
                        raise _error(
                            DatasetPersistenceReasonCode.CRYPTOGRAPHIC_IDENTITY_COLLISION,
                            phase=DATASET_STAGING_PHASE,
                            category=FailureCategory.INPUT_VALIDATION,
                        )
                    if (event.file_rank, event.source_index) < (
                        existing[2],
                        existing[3],
                    ):
                        connection.execute(
                            """
                            UPDATE staging_events
                            SET create_time = ?, formatted_time = ?, calendar_date = ?,
                                sender_scope = ?, message_category = ?, text_eligible = ?,
                                content = ?, file_rank = ?, source_array_index = ?,
                                source_ordinal = ?
                            WHERE event_id = ?
                            """,
                            (
                                event.create_time,
                                event.formatted_time,
                                event.calendar_date,
                                event.sender_scope,
                                event.message_category,
                                int(event.text_eligible),
                                event.content,
                                event.file_rank,
                                event.source_index,
                                descriptor.supplied_ordinal,
                                existing[0],
                            ),
                        )
                    return False
            connection.execute(
                """
                INSERT INTO staging_events(
                    identity_kind, identity_digest, identity_verifier,
                    create_time, formatted_time, calendar_date, sender_scope,
                    message_category, text_eligible, content, file_rank,
                    source_array_index, source_ordinal
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    identity_kind,
                    identity_digest,
                    identity_verifier,
                    event.create_time,
                    event.formatted_time,
                    event.calendar_date,
                    event.sender_scope,
                    event.message_category,
                    int(event.text_eligible),
                    event.content,
                    event.file_rank,
                    event.source_index,
                    descriptor.supplied_ordinal,
                ),
            )
            return True
        except DatasetPersistenceError:
            raise
        except sqlite3.Error:
            raise _error(
                DatasetPersistenceReasonCode.OUTPUT_WRITE_FAILED,
                phase=DATASET_STAGING_PHASE,
            ) from None

    def stage_annual_event(
        self,
        descriptor: ValidatedSourceDescriptor,
        candidate: CanonicalEventCandidate,
    ) -> None:
        for warning in candidate.classification_warnings:
            self._warning_count += 1
        identity = canonical_event_identity(
            descriptor.conversation_fingerprint,
            candidate,
        )
        if identity is None:
            self._warning_count += 1
            inserted = self._insert(
                descriptor,
                candidate,
                identity_kind="unverifiable-v2",
                identity_digest=None,
                identity_verifier=None,
            )
        else:
            inserted = self._insert(
                descriptor,
                candidate,
                identity_kind=identity.kind,
                identity_digest=identity.digest,
                identity_verifier=identity.verifier,
            )
        if not inserted:
            self._duplicate_count += 1
        current_operation_control().checkpoint(
            DATASET_STAGING_PHASE,
            "sqlite-v2-event-boundary",
        )

    def observe_verification_event(
        self,
        descriptor: ValidatedSourceDescriptor,
        candidate: CanonicalEventCandidate,
    ) -> None:
        if descriptor.role is not SourceRole.OVERLAP_VERIFICATION:
            raise TypeError
        self._verification_count += 1
        identity = canonical_event_identity(
            descriptor.conversation_fingerprint,
            candidate,
        )
        row = None
        if identity is not None:
            try:
                row = self._connection_required().execute(
                    """
                    SELECT identity_verifier FROM staging_events
                    WHERE identity_kind = ? AND identity_digest = ? LIMIT 1
                    """,
                    (identity.kind, identity.digest),
                ).fetchone()
            except sqlite3.Error:
                raise _error(
                    DatasetPersistenceReasonCode.OVERLAP_VERIFICATION_FAILED,
                    phase=OUTPUT_VERIFICATION_PHASE,
                    category=FailureCategory.VERIFICATION,
                ) from None
            if row is not None and bytes(row[0]) != identity.verifier:
                raise _error(
                    DatasetPersistenceReasonCode.CRYPTOGRAPHIC_IDENTITY_COLLISION,
                    phase=OUTPUT_VERIFICATION_PHASE,
                    category=FailureCategory.VERIFICATION,
                )
        if row is None:
            self._unmatched_verification += 1
        else:
            self._matched_verification += 1
        current_operation_control().checkpoint(
            DATASET_STAGING_PHASE,
            "sqlite-v2-verification-boundary",
        )

    def complete(self) -> None:
        try:
            self._connection_required().execute("COMMIT")
            self._complete = True
        except sqlite3.Error:
            raise _error(
                DatasetPersistenceReasonCode.OUTPUT_FLUSH_FAILED,
                phase=DATASET_STAGING_PHASE,
            ) from None

    def _close_database(self) -> None:
        connection = self._connection
        self._connection = None
        if connection is not None:
            try:
                connection.close()
            except sqlite3.Error:
                raise _error(
                    DatasetPersistenceReasonCode.OUTPUT_FLUSH_FAILED,
                    phase=OUTPUT_PROMOTION_PHASE,
                ) from None

    def abort(self) -> None:
        if self._published:
            return
        connection = self._connection
        self._connection = None
        if connection is not None:
            try:
                connection.rollback()
            except sqlite3.Error:
                pass
            try:
                connection.close()
            except sqlite3.Error:
                pass
        if self._stage != self._destination:
            _remove_stage_entries(self._stage)

    def _write_chunks(
        self,
    ) -> tuple[tuple[CanonicalChunkDescriptor, ...], dict[str, Any]]:
        connection = self._connection_required()
        try:
            cursor = connection.execute(
                """
                SELECT create_time, formatted_time, calendar_date, sender_scope,
                       message_category, text_eligible, content, file_rank,
                       source_array_index, event_id
                FROM staging_events
                ORDER BY create_time, file_rank, source_array_index, event_id
                """
            )
        except sqlite3.Error:
            raise _error(
                DatasetPersistenceReasonCode.OUTPUT_WRITE_FAILED,
                phase=OUTPUT_SERIALIZATION_PHASE,
            ) from None

        control = current_operation_control()
        chunks: list[CanonicalChunkDescriptor] = []
        category_counts = {category: 0 for category in CANONICAL_MESSAGE_CATEGORIES}
        event_count = 0
        eligible_count = 0
        system_count = 0
        byte_count = 0
        handle: BinaryIO | None = None
        chunk_name = ""
        chunk_size = 0
        chunk_records = 0
        chunk_digest = hashlib.sha256()

        def close_chunk() -> None:
            nonlocal handle, chunk_size, chunk_records, chunk_digest
            if handle is None:
                return
            _flush_close(handle)
            chunks.append(
                CanonicalChunkDescriptor(
                    ordinal=len(chunks),
                    name=chunk_name,
                    byte_size=chunk_size,
                    record_count=chunk_records,
                    sha256=chunk_digest.hexdigest(),
                )
            )
            handle = None

        try:
            for row in cursor:
                control.checkpoint(
                    OUTPUT_SERIALIZATION_PHASE,
                    "canonical-chunk-record-before",
                )
                if event_count >= MAX_CANONICAL_EVENTS:
                    raise _error(
                        DatasetPersistenceReasonCode.CANONICAL_EVENT_LIMIT_EXCEEDED,
                        phase=OUTPUT_SERIALIZATION_PHASE,
                        category=FailureCategory.CAPACITY,
                    )
                if row[4] not in category_counts:
                    raise _error(
                        DatasetPersistenceReasonCode.CANONICAL_SCHEMA_INVALID,
                        phase=OUTPUT_SERIALIZATION_PHASE,
                        category=FailureCategory.INPUT_VALIDATION,
                    )
                event = CanonicalEventV2(
                    create_time=row[0],
                    formatted_time=row[1],
                    calendar_date=row[2],
                    sender_scope=row[3],
                    message_category=row[4],  # type: ignore[arg-type]
                    text_eligible=bool(row[5]),
                    content=row[6],
                    file_rank=row[7],
                    source_index=event_count,
                )
                try:
                    validate_canonical_event(event.as_mapping())
                except ValueError:
                    raise _error(
                        DatasetPersistenceReasonCode.CANONICAL_SCHEMA_INVALID,
                        phase=OUTPUT_SERIALIZATION_PHASE,
                        category=FailureCategory.INPUT_VALIDATION,
                    ) from None
                encoded = (serialize_canonical_event(event) + "\n").encode("utf-8")
                if len(encoded) > MAX_CANONICAL_CHUNK_BYTES:
                    raise _error(
                        DatasetPersistenceReasonCode.CANONICAL_CHUNK_LIMIT_EXCEEDED,
                        phase=OUTPUT_SERIALIZATION_PHASE,
                        category=FailureCategory.CAPACITY,
                    )
                if handle is not None and chunk_size + len(encoded) > MAX_CANONICAL_CHUNK_BYTES:
                    close_chunk()
                    chunk_size = 0
                    chunk_records = 0
                    chunk_digest = hashlib.sha256()
                if handle is None:
                    if len(chunks) >= MAX_CANONICAL_CHUNK_COUNT:
                        raise _error(
                            DatasetPersistenceReasonCode.CANONICAL_CHUNK_LIMIT_EXCEEDED,
                            phase=OUTPUT_SERIALIZATION_PHASE,
                            category=FailureCategory.CAPACITY,
                        )
                    chunk_name = f"chunk-{len(chunks):04d}.ndjson"
                    handle = _secure_create_file(self._stage / chunk_name)
                _write_all(handle, encoded)
                chunk_size += len(encoded)
                chunk_records += 1
                chunk_digest.update(encoded)
                byte_count += len(encoded)
                event_count += 1
                category_counts[row[4]] += 1
                if row[5]:
                    eligible_count += 1
                if row[4] == "system":
                    system_count += 1
                if byte_count > MAX_CANONICAL_DATASET_BYTES:
                    raise _error(
                        DatasetPersistenceReasonCode.CANONICAL_DATASET_LIMIT_EXCEEDED,
                        phase=OUTPUT_SERIALIZATION_PHASE,
                        category=FailureCategory.CAPACITY,
                    )
                control.checkpoint(
                    OUTPUT_SERIALIZATION_PHASE,
                    "canonical-chunk-record-after",
                )
            close_chunk()
        except BaseException:
            if handle is not None:
                try:
                    handle.close()
                except OSError:
                    pass
            raise
        if event_count == 0:
            raise _error(
                DatasetPersistenceReasonCode.CANONICAL_NO_EVENTS,
                phase=OUTPUT_SERIALIZATION_PHASE,
                category=FailureCategory.INPUT_VALIDATION,
            )
        if len(chunks) > MAX_CANONICAL_CHUNK_COUNT:
            raise _error(
                DatasetPersistenceReasonCode.CANONICAL_CHUNK_LIMIT_EXCEEDED,
                phase=OUTPUT_SERIALIZATION_PHASE,
                category=FailureCategory.CAPACITY,
            )
        return tuple(chunks), {
            "eventCount": event_count,
            "eligibleTextCount": eligible_count,
            "systemEventCount": system_count,
            "categoryCounts": category_counts,
            "totalBytes": byte_count,
        }

    def _remove_non_output_entries(self, output_names: set[str]) -> None:
        self._close_database()
        try:
            for entry in list(os.scandir(self._stage)):
                if entry.name in output_names:
                    continue
                metadata = os.lstat(self._stage / entry.name)
                if (
                    stat.S_ISLNK(metadata.st_mode)
                    or not stat.S_ISREG(metadata.st_mode)
                    or metadata.st_uid != os.getuid()
                    or _mode(metadata) != 0o600
                ):
                    raise OSError
                os.unlink(self._stage / entry.name)
            if {entry.name for entry in os.scandir(self._stage)} != output_names:
                raise OSError
        except OSError:
            raise _error(
                DatasetPersistenceReasonCode.OUTPUT_CLEANUP_FAILED,
                phase=OUTPUT_PROMOTION_PHASE,
            ) from None

    def publish(self, result: ValidationResult) -> CanonicalDatasetBuildResult:
        if not self._complete or self._published:
            raise _error(
                DatasetPersistenceReasonCode.OUTPUT_STAGING_FAILED,
                phase=OUTPUT_SERIALIZATION_PHASE,
            )
        chunks, stats = self._write_chunks()
        aggregates = CanonicalAggregatesV2(
            event_count=stats["eventCount"],
            user_message_count=stats["eventCount"] - stats["systemEventCount"],
            eligible_text_count=stats["eligibleTextCount"],
            system_event_count=stats["systemEventCount"],
            chunk_count=len(chunks),
            total_bytes=stats["totalBytes"],
            warning_count=self._warning_count,
            message_category_counts=stats["categoryCounts"],
            unknown_sender_count=0,
        )
        manifest = CanonicalManifestV2(
            publication_counts=CanonicalPublicationCountsV2(
                source_count=len(result.annual_sources),
                raw_accepted_event_count=(
                    result.canonical_normalization.emitted_count
                    if result.canonical_normalization is not None
                    else 0
                ),
                canonical_event_count=stats["eventCount"],
                duplicate_event_count=self._duplicate_count,
            ),
            chunks=chunks,  # type: ignore[arg-type]
            aggregates=aggregates,
        )
        manifest_mapping = manifest.as_mapping()
        try:
            validate_canonical_manifest(manifest_mapping)
            manifest_bytes = (
                serialize_canonical_manifest(manifest)
                + "\n"
            ).encode("utf-8")
        except (TypeError, UnicodeError, ValueError):
            raise _error(
                DatasetPersistenceReasonCode.CANONICAL_SCHEMA_INVALID,
                phase=OUTPUT_SERIALIZATION_PHASE,
                category=FailureCategory.INPUT_VALIDATION,
            ) from None
        if len(manifest_bytes) > CANONICAL_MANIFEST_MAX_BYTES:
            raise _error(
                DatasetPersistenceReasonCode.CANONICAL_DATASET_LIMIT_EXCEEDED,
                phase=OUTPUT_SERIALIZATION_PHASE,
                category=FailureCategory.CAPACITY,
            )
        if stats["totalBytes"] + len(manifest_bytes) > MAX_CANONICAL_DATASET_BYTES:
            raise _error(
                DatasetPersistenceReasonCode.CANONICAL_DATASET_LIMIT_EXCEEDED,
                phase=OUTPUT_SERIALIZATION_PHASE,
                category=FailureCategory.CAPACITY,
            )
        manifest_temporary = self._stage / ".manifest.json.tmp"
        manifest_handle = _secure_create_file(manifest_temporary)
        _write_all(manifest_handle, manifest_bytes)
        _flush_close(manifest_handle)
        _atomic_rename_exclusive(
            manifest_temporary,
            self._stage / CANONICAL_MANIFEST_NAME,
        )
        publication_marker = _secure_create_file(
            self._stage / CANONICAL_PUBLICATION_MARKER_NAME
        )
        _write_all(publication_marker, CANONICAL_PUBLICATION_MARKER)
        _flush_close(publication_marker)
        verify_canonical_dataset_directory(self._stage, require_exact_entries=False)
        output_names = {
            CANONICAL_MANIFEST_NAME,
            CANONICAL_PUBLICATION_MARKER_NAME,
            *(chunk.name for chunk in chunks),
        }
        self._remove_non_output_entries(output_names)
        verified = verify_canonical_dataset_directory(self._stage)
        if verified.manifest != manifest_mapping:
            raise _error(
                DatasetPersistenceReasonCode.OUTPUT_INTEGRITY_FAILED,
                phase=OUTPUT_VERIFICATION_PHASE,
            )
        _verify_inputs_unchanged(result)
        try:
            destination_metadata = os.lstat(self._destination)
        except FileNotFoundError:
            destination_metadata = None
        if destination_metadata is not None:
            raise _error(
                DatasetPersistenceReasonCode.OUTPUT_DESTINATION_EXISTS,
                phase=OUTPUT_PROMOTION_PHASE,
            )
        try:
            parent_metadata = os.stat(self._destination.parent, follow_symlinks=False)
            stage_metadata = os.stat(self._stage, follow_symlinks=False)
            if parent_metadata.st_dev != stage_metadata.st_dev:
                raise OSError
            parent_descriptor = os.open(self._destination.parent, _directory_flags())
            stage_descriptor = os.open(self._stage, _directory_flags())
            try:
                os.fsync(stage_descriptor)
                os.fsync(parent_descriptor)
            finally:
                os.close(stage_descriptor)
                os.close(parent_descriptor)
        except OSError:
            raise _error(
                DatasetPersistenceReasonCode.OUTPUT_FLUSH_FAILED,
                phase=OUTPUT_PROMOTION_PHASE,
            ) from None
        control = current_operation_control()
        with control.promotion_commit():
            _atomic_rename_exclusive(self._stage, self._destination)
            self._published = True
        return CanonicalDatasetBuildResult(
            event_count=stats["eventCount"],
            eligible_text_count=stats["eligibleTextCount"],
            chunk_count=len(chunks),
            duplicate_event_count=self._duplicate_count,
            warning_count=self._warning_count,
            matched_verification_event_count=self._matched_verification,
            unmatched_verification_event_count=self._unmatched_verification,
            manifest_sha256=hashlib.sha256(manifest_bytes).hexdigest(),
            source_count=len(result.annual_sources),
            raw_accepted_event_count=(
                result.canonical_normalization.emitted_count
                if result.canonical_normalization is not None
                else 0
            ),
        )


def _read_v2_file(path: Path, maximum: int) -> bytes:
    descriptor = -1
    try:
        flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0)
        descriptor = os.open(path, flags)
        metadata = os.fstat(descriptor)
        if (
            not stat.S_ISREG(metadata.st_mode)
            or metadata.st_uid != os.getuid()
            or _mode(metadata) != 0o600
            or metadata.st_size > maximum
        ):
            raise OSError
        with os.fdopen(descriptor, "rb") as handle:
            descriptor = -1
            value = handle.read(maximum + 1)
        if len(value) > maximum:
            raise OSError
        return value
    except (OSError, ValueError):
        if descriptor >= 0:
            try:
                os.close(descriptor)
            except OSError:
                pass
        raise _error(
            DatasetPersistenceReasonCode.OUTPUT_INTEGRITY_FAILED,
            phase=OUTPUT_VERIFICATION_PHASE,
        ) from None


def _open_v2_chunk(path: Path, size: int) -> BinaryIO:
    descriptor = -1
    try:
        flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0)
        descriptor = os.open(path, flags)
        metadata = os.fstat(descriptor)
        if (
            not stat.S_ISREG(metadata.st_mode)
            or metadata.st_uid != os.getuid()
            or _mode(metadata) != 0o600
            or metadata.st_size != size
        ):
            raise OSError
        return os.fdopen(descriptor, "rb")
    except (OSError, ValueError):
        if descriptor >= 0:
            try:
                os.close(descriptor)
            except OSError:
                pass
        raise _error(
            DatasetPersistenceReasonCode.OUTPUT_INTEGRITY_FAILED,
            phase=OUTPUT_VERIFICATION_PHASE,
        ) from None


def _iter_v2_events(
    directory: Path,
    manifest: Mapping[str, Any],
) -> Iterator[CanonicalEventV2]:
    for chunk in manifest["chunks"]:
        digest = hashlib.sha256()
        size = 0
        count = 0
        with _open_v2_chunk(directory / chunk["name"], chunk["byteSize"]) as handle:
            for raw_line in handle:
                size += len(raw_line)
                digest.update(raw_line)
                if not raw_line.endswith(b"\n") or raw_line == b"\n":
                    raise _error(
                        DatasetPersistenceReasonCode.CANONICAL_SCHEMA_INVALID,
                        phase=OUTPUT_VERIFICATION_PHASE,
                        category=FailureCategory.INPUT_VALIDATION,
                    )
                try:
                    value = _json_without_duplicates(raw_line.decode("utf-8"))
                    event = validate_canonical_event(value)
                except (UnicodeError, ValueError, json.JSONDecodeError):
                    raise _error(
                        DatasetPersistenceReasonCode.CANONICAL_SCHEMA_INVALID,
                        phase=OUTPUT_VERIFICATION_PHASE,
                        category=FailureCategory.INPUT_VALIDATION,
                    ) from None
                count += 1
                yield event
        if (
            size != chunk["byteSize"]
            or count != chunk["recordCount"]
            or digest.hexdigest() != chunk["sha256"]
        ):
            raise _error(
                DatasetPersistenceReasonCode.OUTPUT_INTEGRITY_FAILED,
                phase=OUTPUT_VERIFICATION_PHASE,
            )


def verify_canonical_dataset_directory(
    directory: Path,
    *,
    require_exact_entries: bool = True,
) -> VerifiedCanonicalDataset:
    """Verify v2 bytes, privacy fields, order, hashes, and aggregate counts."""

    try:
        metadata = os.lstat(directory)
        if (
            stat.S_ISLNK(metadata.st_mode)
            or not stat.S_ISDIR(metadata.st_mode)
            or metadata.st_uid != os.getuid()
            or _mode(metadata) != 0o700
        ):
            raise OSError
        raw_manifest = _read_v2_file(
            directory / CANONICAL_MANIFEST_NAME,
            CANONICAL_MANIFEST_MAX_BYTES,
        )
        if not raw_manifest.endswith(b"\n") or raw_manifest.startswith(b"\xef\xbb\xbf"):
            raise ValueError
        manifest = _json_without_duplicates(raw_manifest[:-1].decode("utf-8"))
        validate_canonical_manifest(manifest)
        expected_names = {
            CANONICAL_MANIFEST_NAME,
            CANONICAL_PUBLICATION_MARKER_NAME,
            *(chunk["name"] for chunk in manifest["chunks"]),
        }
        if (
            _read_v2_file(
                directory / CANONICAL_PUBLICATION_MARKER_NAME,
                len(CANONICAL_PUBLICATION_MARKER),
            )
            != CANONICAL_PUBLICATION_MARKER
        ):
            raise ValueError
        if require_exact_entries:
            observed_names: set[str] = set()
            for entry in os.scandir(directory):
                candidate = directory / entry.name
                entry_metadata = os.lstat(candidate)
                if (
                    stat.S_ISLNK(entry_metadata.st_mode)
                    or not stat.S_ISREG(entry_metadata.st_mode)
                    or entry_metadata.st_uid != os.getuid()
                    or _mode(entry_metadata) != 0o600
                ):
                    raise OSError
                observed_names.add(entry.name)
            if observed_names != expected_names:
                raise OSError
        aggregate = manifest["aggregates"]
        category_counts = {category: 0 for category in CANONICAL_MESSAGE_CATEGORIES}
        event_count = 0
        eligible_count = 0
        system_count = 0
        previous_order: tuple[int, int, int] | None = None
        unknown_sender_count = 0
        for event in _iter_v2_events(directory, manifest):
            if event.source_index != event_count:
                raise ValueError
            order = (event.create_time, event.file_rank, event.source_index)
            if previous_order is not None and order < previous_order:
                raise ValueError
            previous_order = order
            category_counts[event.message_category] += 1
            eligible_count += int(event.text_eligible)
            system_count += int(event.message_category == "system")
            unknown_sender_count += int(event.sender_scope is None and event.message_category != "system")
            event_count += 1
        if event_count == 0:
            raise ValueError
        if (
            aggregate["eventCount"] != event_count
            or aggregate["userMessageCount"] != event_count - system_count
            or aggregate["eligibleTextCount"] != eligible_count
            or aggregate["systemEventCount"] != system_count
            or aggregate["chunkCount"] != len(manifest["chunks"])
            or aggregate["totalBytes"] != sum(chunk["byteSize"] for chunk in manifest["chunks"])
            or aggregate["messageCategoryCounts"] != category_counts
            or aggregate["unknownSenderCount"] != unknown_sender_count
            or len(raw_manifest) + aggregate["totalBytes"] > MAX_CANONICAL_DATASET_BYTES
        ):
            raise ValueError
        return VerifiedCanonicalDataset(manifest=manifest, directory=directory)
    except DatasetPersistenceError:
        raise
    except (OSError, UnicodeError, ValueError, TypeError, json.JSONDecodeError):
        raise _error(
            DatasetPersistenceReasonCode.CANONICAL_SCHEMA_INVALID,
            phase=OUTPUT_VERIFICATION_PHASE,
            category=FailureCategory.INPUT_VALIDATION,
        ) from None
