import json
import tempfile
import unittest
from pathlib import Path

from scripts.generate_mock_chat import generate_dataset, write_dataset


class GenerateMockChatTests(unittest.TestCase):
    COUNT = 1200
    YEAR = 2025
    SEED = 20250729

    @classmethod
    def setUpClass(cls):
        cls.dataset = generate_dataset(cls.COUNT, cls.YEAR, cls.SEED)
        cls.messages = cls.dataset["messages"]

    def test_exact_requested_message_count(self):
        self.assertEqual(len(self.messages), self.COUNT)

    def test_deterministic_output_for_same_seed(self):
        first = generate_dataset(300, self.YEAR, self.SEED)
        second = generate_dataset(300, self.YEAR, self.SEED)
        self.assertEqual(first, second)

    def test_chronological_ordering(self):
        timestamps = [message["createTime"] for message in self.messages]
        self.assertEqual(timestamps, sorted(timestamps))
        self.assertTrue(all(message["formattedTime"].startswith("2025-") for message in self.messages))

    def test_unique_local_ids(self):
        local_ids = [message["localId"] for message in self.messages]
        self.assertEqual(local_ids, list(range(1, self.COUNT + 1)))

    def test_unique_platform_message_ids(self):
        message_ids = [message["platformMessageId"] for message in self.messages]
        self.assertEqual(len(message_ids), len(set(message_ids)))

    def test_session_timestamp_boundaries(self):
        session = self.dataset["session"]
        self.assertEqual(session["firstTimestamp"], self.messages[0]["createTime"])
        self.assertEqual(session["lastTimestamp"], self.messages[-1]["createTime"])

    def test_session_message_count(self):
        self.assertEqual(self.dataset["session"]["messageCount"], self.COUNT)

    def test_sender_values_are_synthetic_accounts(self):
        allowed = {
            ("wxid_mock_me", "我", 1),
            ("wxid_mock_friend", "小雨", 0),
        }
        observed = {
            (message["senderUsername"], message["senderDisplayName"], message["isSend"])
            for message in self.messages
        }
        self.assertTrue(observed)
        self.assertLessEqual(observed, allowed)

    def test_valid_message_type_codes(self):
        valid_pairs = {(1, 0), (3, 1), (34, 2), (43, 3), (47, 5), (49, 4), (50, 6)}
        observed = {(message["localType"], message["chatLabType"]) for message in self.messages}
        self.assertLessEqual(observed, valid_pairs)
        self.assertEqual({pair[0] for pair in observed}, {1, 3, 34, 43, 47, 49, 50})

    def test_reply_references_an_earlier_message(self):
        positions = {
            message["platformMessageId"]: index for index, message in enumerate(self.messages)
        }
        replies = [message for message in self.messages if "replyToMessageId" in message]
        self.assertTrue(replies)
        for index, message in enumerate(self.messages):
            if "replyToMessageId" in message:
                self.assertIn(message["replyToMessageId"], positions)
                self.assertLess(positions[message["replyToMessageId"]], index)

    def test_generated_json_loads_successfully(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "nested" / "fixture.json"
            write_dataset(output, 250, self.YEAR, self.SEED)
            with output.open(encoding="utf-8") as handle:
                loaded = json.load(handle)
        self.assertEqual(loaded, generate_dataset(250, self.YEAR, self.SEED))

    def test_type_distribution_and_sender_ratio(self):
        counts = {}
        for message in self.messages:
            counts[message["localType"]] = counts.get(message["localType"], 0) + 1
        self.assertAlmostEqual(counts[1] / self.COUNT, 0.82, delta=0.01)
        owner_ratio = sum(message["isSend"] for message in self.messages) / self.COUNT
        self.assertAlmostEqual(owner_ratio, 0.48, delta=0.002)


if __name__ == "__main__":
    unittest.main()
