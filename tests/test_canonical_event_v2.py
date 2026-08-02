import json
from pathlib import Path
import unittest

from chat_history_analysis.canonical_event_v2 import (
    CANONICAL_EVENT_FIELDS,
    CANONICAL_MESSAGE_CATEGORIES,
    MAX_CANONICAL_CHUNK_BYTES,
    MAX_CANONICAL_CHUNK_COUNT,
    MAX_CANONICAL_DATASET_BYTES,
    MAX_CANONICAL_EVENTS,
    CANONICAL_MANIFEST_SCHEMA_VERSION,
    CANONICAL_V1_MANIFEST_SCHEMA_VERSION,
    CanonicalEventValidationError,
    serialize_canonical_event,
    serialize_canonical_manifest,
    validate_canonical_event,
    validate_canonical_manifest,
    validate_compatible_dataset_contract,
)


VECTORS = json.loads(
    (Path(__file__).parents[1] / "contracts" / "canonical-v2.vectors.json").read_text(
        encoding="utf-8"
    )
)


class CanonicalEventV2ContractTests(unittest.TestCase):
    def test_shared_event_vectors_match_python_acceptance_and_goldens(self):
        for vector in VECTORS["validEvents"]:
            with self.subTest(vector=vector["name"]):
                event = validate_canonical_event(vector["value"])
                self.assertEqual(serialize_canonical_event(event), vector["serialized"])
        for vector in VECTORS["invalidEvents"]:
            with self.subTest(vector=vector["name"]):
                with self.assertRaises(CanonicalEventValidationError):
                    validate_canonical_event(vector["value"])

    def test_event_shape_and_categories_are_frozen(self):
        value = VECTORS["validEvents"][0]["value"]
        event = validate_canonical_event(value)
        self.assertEqual(tuple(value), CANONICAL_EVENT_FIELDS)
        self.assertEqual(event.as_mapping(), value)
        self.assertEqual(len(CANONICAL_MESSAGE_CATEGORIES), 15)

    def test_shared_manifest_vectors_match_python_acceptance_and_goldens(self):
        for vector in VECTORS["validManifests"]:
            with self.subTest(vector=vector["name"]):
                manifest = validate_canonical_manifest(vector["value"])
                self.assertEqual(
                    serialize_canonical_manifest(manifest), vector["serialized"]
                )
        for vector in VECTORS["invalidManifests"]:
            with self.subTest(vector=vector["name"]):
                with self.assertRaises(CanonicalEventValidationError):
                    validate_canonical_manifest(vector["value"])

    def test_limits_are_runtime_values_not_documentation_only(self):
        self.assertEqual(MAX_CANONICAL_EVENTS, 2_000_000)
        self.assertEqual(MAX_CANONICAL_DATASET_BYTES, 536_870_912)
        self.assertEqual(MAX_CANONICAL_CHUNK_BYTES, 33_554_432)
        self.assertEqual(MAX_CANONICAL_CHUNK_COUNT, 16_384)

    def test_complete_v1_v2_discriminants_use_exact_runtime_union(self):
        v1 = {
            "schemaVersion": CANONICAL_V1_MANIFEST_SCHEMA_VERSION,
            "summary": {
                "chunkCount": 1,
                "maximumCalendarDate": "2025-01-01",
                "minimumCalendarDate": "2025-01-01",
                "normalizedRecordCount": 1,
                "pseudonymous": True,
                "warningCount": 0,
                "warningsByReason": {},
            },
            "records": [
                {
                    "createTime": 1735689600,
                    "formattedTime": "2025-01-01 08:00:00",
                    "calendarDate": "2025-01-01",
                    "senderScope": "owner",
                    "content": "synthetic text",
                    "fileRank": 0,
                    "sourceIndex": 0,
                }
            ],
        }
        v2 = {
            "schemaVersion": CANONICAL_MANIFEST_SCHEMA_VERSION,
            "summary": {
                "eventCount": 1,
                "userMessageCount": 1,
                "eligibleTextCount": 1,
                "systemEventCount": 0,
                "chunkCount": 1,
                "totalBytes": 1,
                "warningCount": 0,
                "messageCategoryCounts": {
                    category: 1 if category == "text" else 0
                    for category in (
                        "text",
                        "image",
                        "voice",
                        "video",
                        "file",
                        "animated-emoji",
                        "structured",
                        "location",
                        "call",
                        "mini-program",
                        "reply",
                        "contact-card",
                        "system",
                        "other",
                        "unknown",
                    )
                },
                "unknownSenderCount": 0,
            },
            "events": [VECTORS["validEvents"][0]["value"]],
        }
        self.assertEqual(validate_compatible_dataset_contract(v1), v1)
        self.assertEqual(
            validate_compatible_dataset_contract(v2)["schemaVersion"],
            CANONICAL_MANIFEST_SCHEMA_VERSION,
        )
        for invalid in (
            {**v1, "schemaVersion": "v1"},
            {**v2, "schemaVersion": "v2"},
            {**v1, "canonicalSchemaVersion": "mixed"},
            {**v2, "summary": {**v2["summary"], "eventCount": 2}},
        ):
            with self.assertRaises(CanonicalEventValidationError):
                validate_compatible_dataset_contract(invalid)


if __name__ == "__main__":
    unittest.main()
