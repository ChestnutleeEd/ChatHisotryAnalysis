"""Stage 12 coverage against the production preprocessor composition.

The synthetic cases in this module deliberately enter through the public
application/CLI path.  Test-only seams are limited to deterministic failure
injection for SQLite policy and cleanup assertions; parser behavior and the
normal successful pipeline use the installed native ijson backend.
"""

from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import secrets
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

from chat_history_analysis.application import run_startup_check
from chat_history_analysis.dataset_persistence import (
    DATABASE_NAME,
    DatasetPersistenceError,
    DatasetPersistenceReasonCode,
    DatasetStagingConsumer,
    MANIFEST_NAME,
    STAGING_MARKER,
    STAGING_PREFIX,
    verify_dataset_directory,
)
from chat_history_analysis.errors import (
    FailureCategory,
    SourceRole,
    SourceValidationError,
    SourceValidationReasonCode,
)
from tests.stage3_support import HAS_IJSON, OWNER, PEER, message, write_export


REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
PUBLIC_FIXTURE = (
    REPOSITORY_ROOT / "data" / "mock" / "ciphertalk_detailed_chat_2025.json"
)
PUBLIC_FIXTURE_SHA256 = (
    "de6c09bac2c9ae2b3742a65f7d5f93886ff70c55be19aa5cacd09ca35e6dc839"
)


def _test_root() -> Path:
    """Create a synthetic-only scratch root outside the repository."""

    return Path(tempfile.mkdtemp(prefix="chat-history-analysis-stage12-")).resolve()


def _cli_environment() -> dict[str, str]:
    environment = os.environ.copy()
    existing_pythonpath = environment.get("PYTHONPATH")
    source_path = os.fspath(REPOSITORY_ROOT / "src")
    environment["PYTHONPATH"] = (
        source_path
        if not existing_pythonpath
        else source_path + os.pathsep + existing_pythonpath
    )
    environment["PYTHONDONTWRITEBYTECODE"] = "1"
    return environment


def _run_production_cli(*arguments: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, "-m", "chat_history_analysis", *arguments],
        cwd=REPOSITORY_ROOT,
        env=_cli_environment(),
        capture_output=True,
        text=True,
        check=False,
    )


def _published_dataset_bytes(destination: Path) -> dict[str, bytes]:
    manifest = json.loads((destination / MANIFEST_NAME).read_bytes())
    names = [MANIFEST_NAME, *(chunk["name"] for chunk in manifest["chunks"])]
    return {name: (destination / name).read_bytes() for name in names}


def _remove_published_dataset(destination: Path) -> None:
    """Remove only the explicitly named files produced by this test."""

    if not destination.exists():
        return
    manifest_path = destination / MANIFEST_NAME
    if manifest_path.exists():
        manifest = json.loads(manifest_path.read_bytes())
        for chunk in manifest["chunks"]:
            (destination / chunk["name"]).unlink()
        manifest_path.unlink()
    destination.rmdir()


def _new_output(case: unittest.TestCase) -> Path:
    destination = (
        REPOSITORY_ROOT
        / "data"
        / "exports"
        / f"stage12-test-{secrets.token_hex(12)}"
    )
    case.addCleanup(_remove_published_dataset, destination)
    return destination


def _json_lines(stdout: str) -> list[dict[str, object]]:
    return [json.loads(line) for line in stdout.splitlines() if line]


def _assert_progress_only(case: unittest.TestCase, stdout: str) -> None:
    payloads = _json_lines(stdout)
    case.assertTrue(payloads)
    case.assertTrue(
        all(payload.get("event") == "progress" for payload in payloads)
    )


@unittest.skipUnless(HAS_IJSON, "ijson==3.5.1 is required")
class Stage12ProductionCliTests(unittest.TestCase):
    """Exercise the real CLI, native parser, staging, and publication path."""

    def test_public_fixture_cli_output_is_canonical_and_repeatable(self) -> None:
        fixture_bytes = PUBLIC_FIXTURE.read_bytes()
        self.assertEqual(
            hashlib.sha256(fixture_bytes).hexdigest(),
            PUBLIC_FIXTURE_SHA256,
        )

        first_destination = _new_output(self)
        second_destination = _new_output(self)
        first = _run_production_cli(
            "preprocess",
            "--annual-source",
            os.fspath(PUBLIC_FIXTURE),
            "--output-dir",
            os.fspath(first_destination),
        )
        second = _run_production_cli(
            "preprocess",
            "--annual-source",
            os.fspath(PUBLIC_FIXTURE),
            "--output-dir",
            os.fspath(second_destination),
        )

        for result in (first, second):
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(result.stderr, "")
            payloads = _json_lines(result.stdout)
            self.assertTrue(payloads)
            self.assertEqual(payloads[-1]["status"], "ready")
            self.assertEqual(payloads[-1]["phase"], "output-promotion")
            self.assertTrue(
                all(payload.get("event") == "progress" for payload in payloads[:-1])
            )
            self.assertNotIn(os.fspath(PUBLIC_FIXTURE), result.stdout)
            self.assertNotIn(os.fspath(first_destination), result.stdout)
            self.assertNotIn("Traceback", result.stdout)

        first_manifest = verify_dataset_directory(first_destination).manifest
        second_manifest = verify_dataset_directory(second_destination).manifest
        self.assertEqual(first_manifest, second_manifest)
        self.assertEqual(
            first_manifest["aggregates"]["rawMessageCount"],
            5_000,
        )
        self.assertEqual(
            first_manifest["aggregates"]["normalizedRecordCount"],
            4_100,
        )
        self.assertEqual(
            first_manifest["aggregates"]["eligibleTextRecordCount"],
            4_100,
        )
        self.assertEqual(
            first_manifest["aggregates"]["skippedRecordCount"],
            900,
        )
        self.assertNotIn(PUBLIC_FIXTURE.name, json.dumps(first_manifest))
        self.assertNotIn(os.fspath(PUBLIC_FIXTURE), json.dumps(first_manifest))
        self.assertEqual(
            _published_dataset_bytes(first_destination),
            _published_dataset_bytes(second_destination),
        )

    def test_cli_deduplicates_platform_and_fallback_ids_without_using_local_id(
        self,
    ) -> None:
        root = _test_root()
        first = write_export(
            root / "first-source.json",
            (
                message(
                    100,
                    OWNER,
                    content="synthetic fallback duplicate",
                    localId="same-local-id-a",
                ),
                message(
                    101,
                    PEER,
                    content="synthetic platform duplicate",
                    localId="same-local-id-a",
                    platformMessageId="synthetic-platform-shared",
                ),
            ),
        )
        second = write_export(
            root / "second-source.json",
            (
                message(
                    100,
                    OWNER,
                    content="synthetic fallback duplicate",
                    localId="same-local-id-b",
                ),
                message(
                    101,
                    PEER,
                    content="synthetic platform duplicate",
                    localId="same-local-id-b",
                    platformMessageId="synthetic-platform-shared",
                ),
                message(
                    102,
                    OWNER,
                    content="synthetic distinct owner",
                    localId="same-local-id-b",
                    platformMessageId="synthetic-platform-owner",
                ),
                message(
                    103,
                    PEER,
                    content="synthetic distinct peer",
                    localId="same-local-id-b",
                    platformMessageId="synthetic-platform-peer",
                ),
            ),
        )
        verification = write_export(
            root / "overlap-source.json",
            (
                message(
                    100,
                    OWNER,
                    content="synthetic fallback duplicate",
                ),
                message(
                    106,
                    PEER,
                    content="synthetic verification-only record",
                ),
            ),
        )
        destination = _new_output(self)

        result = _run_production_cli(
            "preprocess",
            "--annual-source",
            os.fspath(first),
            "--annual-source",
            os.fspath(second),
            "--overlap-verification",
            os.fspath(verification),
            "--output-dir",
            os.fspath(destination),
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stderr, "")
        final = _json_lines(result.stdout)[-1]
        self.assertEqual(final["normalizedRecordCount"], 4)
        self.assertEqual(final["duplicateRecordCount"], 2)
        self.assertEqual(final["matchedVerificationRecordCount"], 1)
        self.assertEqual(final["unmatchedVerificationRecordCount"], 1)

        manifest = verify_dataset_directory(destination).manifest
        self.assertEqual(manifest["aggregates"]["normalizedRecordCount"], 4)
        self.assertEqual(manifest["aggregates"]["duplicateRecordCount"], 2)
        self.assertEqual(
            manifest["aggregates"]["overlap"]["matchedEligibleRecordCount"],
            1,
        )
        records = []
        for chunk in manifest["chunks"]:
            records.extend(
                json.loads(line)
                for line in (destination / chunk["name"]).read_text(
                    encoding="utf-8"
                ).splitlines()
            )
        self.assertEqual([record["sourceIndex"] for record in records], [0, 1, 2, 3])
        self.assertEqual(
            [record["content"] for record in records],
            [
                "synthetic fallback duplicate",
                "synthetic platform duplicate",
                "synthetic distinct owner",
                "synthetic distinct peer",
            ],
        )
        rendered = json.dumps(records)
        self.assertNotIn("same-local-id", rendered)
        self.assertNotIn("synthetic-platform-", rendered)

    def test_separate_overlap_cli_is_read_only_and_destination_collision_is_stable(
        self,
    ) -> None:
        root = _test_root()
        annual = write_export(
            root / "annual.json",
            (
                message(10, OWNER, content="synthetic overlap one"),
                message(11, PEER, content="synthetic overlap two"),
            ),
        )
        verification = write_export(
            root / "verification.json",
            (
                message(10, OWNER, content="synthetic overlap one"),
                message(12, PEER, content="synthetic overlap extra"),
            ),
        )
        destination = _new_output(self)
        first = _run_production_cli(
            "preprocess",
            "--annual-source",
            os.fspath(annual),
            "--output-dir",
            os.fspath(destination),
        )
        self.assertEqual(first.returncode, 0, first.stderr)
        before = _published_dataset_bytes(destination)

        separate = _run_production_cli(
            "verify-overlap",
            "--dataset-dir",
            os.fspath(destination),
            "--overlap-verification",
            os.fspath(verification),
        )
        self.assertEqual(separate.returncode, 0, separate.stderr)
        self.assertEqual(separate.stderr, "")
        self.assertEqual(
            _json_lines(separate.stdout)[-1],
            {
                "eligibleRecordCount": 2,
                "matchedRecordCount": 1,
                "matchPercentage": 50.0,
                "phase": "overlap-verification",
                "sourceCount": 1,
                "status": "ready",
                "unmatchedRecordCount": 1,
            },
        )
        self.assertEqual(before, _published_dataset_bytes(destination))

        collision = _run_production_cli(
            "preprocess",
            "--annual-source",
            os.fspath(annual),
            "--output-dir",
            os.fspath(destination),
        )
        self.assertEqual(collision.returncode, 68)
        _assert_progress_only(self, collision.stdout)
        collision_payload = json.loads(collision.stderr)
        self.assertEqual(
            collision_payload["reasonCode"],
            "OUTPUT_DESTINATION_EXISTS",
        )
        self.assertNotIn(os.fspath(destination), collision.stderr)
        self.assertEqual(before, _published_dataset_bytes(destination))

    def test_real_cli_failure_is_content_free_and_cleans_candidate_output(self) -> None:
        root = _test_root()
        secret = "synthetic-parser-secret-path-url"
        source = root / f"{secret}.json"
        source.write_bytes(
            (
                '{"sensitive":"'
                + secret
                + ' https://synthetic.invalid/body"'
            ).encode("utf-8")
        )
        destination = _new_output(self)
        result = _run_production_cli(
            "preprocess",
            "--annual-source",
            os.fspath(source),
            "--output-dir",
            os.fspath(destination),
        )
        self.assertEqual(result.returncode, 65)
        _assert_progress_only(self, result.stdout)
        self.assertNotIn(secret, result.stderr)
        self.assertNotIn(os.fspath(source), result.stderr)
        self.assertNotIn(os.fspath(destination), result.stderr)
        self.assertNotIn("https://", result.stderr)
        self.assertNotIn("Traceback", result.stderr)
        self.assertFalse(destination.exists())


@unittest.skipUnless(HAS_IJSON, "ijson==3.5.1 is required")
class Stage12RuntimeAndSQLitePolicyTests(unittest.TestCase):
    """Cover native startup and the fail-closed private staging policy."""

    def test_real_startup_gate_succeeds_before_real_source_operation(self) -> None:
        run_startup_check()

    def test_sqlite_uses_private_cache_and_required_pragmas(self) -> None:
        root = _test_root()
        destination = root / "synthetic-dataset"
        with patch(
            "chat_history_analysis.dataset_persistence.sqlite3.connect",
            wraps=sqlite3.connect,
        ) as connect:
            consumer = DatasetStagingConsumer(destination)
            self.addCleanup(consumer.abort)
            connection = consumer._connection_required()
            self.assertIn("cache=private", connect.call_args.args[0])
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
            self.assertNotEqual(
                connection.execute("PRAGMA journal_mode").fetchone()[0],
                "wal",
            )
            columns = connection.execute(
                "PRAGMA table_info(staging_records)"
            ).fetchall()
            self.assertEqual(len(columns), 10)
            self.assertEqual(
                [column[1] for column in columns],
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
            self.assertEqual(
                {index[1] for index in indexes if not index[1].startswith("sqlite_")},
                {"staging_collision_lookup", "staging_canonical_order"},
            )
            self.assertEqual(
                os.stat(consumer._stage).st_mode & 0o777,
                0o700,
            )
            self.assertEqual(
                os.stat(consumer._database).st_mode & 0o777,
                0o600,
            )
            self.assertEqual(
                os.stat(consumer._stage / STAGING_MARKER).st_mode & 0o777,
                0o600,
            )
            self.assertFalse(Path(os.fspath(consumer._database) + "-wal").exists())
            self.assertFalse(Path(os.fspath(consumer._database) + "-shm").exists())

    def test_sqlite_memory_policy_failure_stops_before_private_insertion(self) -> None:
        root = _test_root()
        destination = root / "synthetic-memory-policy-failure"

        class FakeCursor:
            def __init__(self, value: object) -> None:
                self.value = value

            def fetchone(self):
                return (self.value,)

        class FakeConnection:
            def execute(self, sql: str):
                if sql == "PRAGMA journal_mode=DELETE":
                    return FakeCursor("delete")
                if sql == "PRAGMA temp_store=MEMORY":
                    return FakeCursor(1)
                if sql == "PRAGMA secure_delete=ON":
                    return FakeCursor(1)
                if sql == "PRAGMA busy_timeout=0":
                    return FakeCursor(0)
                if sql == "PRAGMA temp_store":
                    return FakeCursor(1)
                return FakeCursor(None)

            def close(self) -> None:
                return None

        with patch(
            "chat_history_analysis.dataset_persistence.sqlite3.connect",
            return_value=FakeConnection(),
        ):
            with self.assertRaises(DatasetPersistenceError) as raised:
                DatasetStagingConsumer(destination)
        self.assertEqual(
            raised.exception.reason_code,
            DatasetPersistenceReasonCode.SQLITE_POLICY_FAILED,
        )
        self.assertFalse(destination.exists())
        self.assertEqual(
            [
                path.name
                for path in root.iterdir()
                if path.name.startswith(STAGING_PREFIX)
            ],
            [],
        )


if __name__ == "__main__":
    unittest.main()
