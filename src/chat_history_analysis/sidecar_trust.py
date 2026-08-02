"""Independent sidecar evidence binding used by the native host and probe.

The evidence file is intentionally not its own trust root.  The host embeds a
separately committed anchor and compares the final evidence payload plus the
sorted bundle member digest against that anchor.
"""

from __future__ import annotations

from copy import deepcopy
import hashlib
import json
from pathlib import Path
from typing import Any, Final, Mapping


TRUST_ANCHOR_VERSION: Final = "chat-history-analysis.sidecar-trust-anchor.v1"
TRUST_ANCHOR_NAME: Final = "sidecar-trust-anchor.json"
TRUST_ROOT: Final = "bundle-member-hashes-excluding-evidence+host-anchor-v1"
EVIDENCE_DIGEST_FIELD: Final = "evidenceDigest"

ANCHOR_FIELDS: Final = frozenset(
    {
        "anchorVersion",
        "anchorId",
        "targetTriple",
        "pythonMajorMinor",
        "executableName",
        "nativeBackend",
        "sourceRevision",
        "dependencyLockDigest",
        "specDigest",
        "productionEntrypointDigest",
        "fixtureSha256",
        "buildInputDigest",
        "expectedBundleMerkleRoot",
        "expectedEvidenceDigest",
        "trustRoot",
    }
)
HASH_PATTERN: Final = frozenset("0123456789abcdef")


def canonical_bytes(value: object) -> bytes:
    return json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")


def canonical_digest(value: object) -> str:
    return hashlib.sha256(canonical_bytes(value)).hexdigest()


def bundle_merkle_root(members: list[dict[str, object]]) -> str:
    ordered = sorted(members, key=lambda member: str(member["name"]))
    return canonical_digest(ordered)


def evidence_payload(evidence: Mapping[str, object]) -> dict[str, object]:
    payload = deepcopy(dict(evidence))
    payload.pop(EVIDENCE_DIGEST_FIELD, None)
    return payload


def evidence_digest(evidence: Mapping[str, object]) -> str:
    return canonical_digest(evidence_payload(evidence))


def source_input_digest(inputs: Mapping[str, str]) -> str:
    return canonical_digest(
        [{"name": name, "sha256": inputs[name]} for name in sorted(inputs)]
    )


def _valid_hash(value: object) -> bool:
    return (
        isinstance(value, str)
        and len(value) == 64
        and set(value) <= HASH_PATTERN
    )


def load_anchor(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError):
        raise ValueError("TRUST_ANCHOR_UNAVAILABLE") from None
    if not isinstance(value, dict) or set(value) != ANCHOR_FIELDS:
        raise ValueError("TRUST_ANCHOR_INVALID")
    for field in (
        "dependencyLockDigest",
        "specDigest",
        "productionEntrypointDigest",
        "fixtureSha256",
        "buildInputDigest",
        "expectedBundleMerkleRoot",
        "expectedEvidenceDigest",
    ):
        if not _valid_hash(value[field]):
            raise ValueError("TRUST_ANCHOR_INVALID")
    if (
        value["anchorVersion"] != TRUST_ANCHOR_VERSION
        or value["trustRoot"] != TRUST_ROOT
        or not isinstance(value["anchorId"], str)
        or not isinstance(value["targetTriple"], str)
        or not isinstance(value["pythonMajorMinor"], str)
        or not isinstance(value["executableName"], str)
        or not isinstance(value["nativeBackend"], str)
        or not isinstance(value["sourceRevision"], str)
    ):
        raise ValueError("TRUST_ANCHOR_INVALID")
    return value


def verify_evidence_against_anchor(
    anchor: Mapping[str, object],
    evidence: Mapping[str, object],
    actual_members: list[dict[str, object]],
) -> None:
    if set(anchor) != ANCHOR_FIELDS:
        raise ValueError("TRUST_ANCHOR_INVALID")
    if (
        evidence.get("trustAnchorId") != anchor.get("anchorId")
        or evidence.get("trustRoot") != TRUST_ROOT
        or evidence.get("sourceRevision") != anchor.get("sourceRevision")
        or evidence.get("targetTriple") != anchor.get("targetTriple")
        or evidence.get("pythonMajorMinor") != anchor.get("pythonMajorMinor")
        or evidence.get("executableName") != anchor.get("executableName")
        or evidence.get("nativeBackend") != anchor.get("nativeBackend")
        or evidence.get("dependencyLockDigest") != anchor.get("dependencyLockDigest")
        or evidence.get("specDigest") != anchor.get("specDigest")
        or evidence.get("productionEntrypointDigest")
        != anchor.get("productionEntrypointDigest")
        or evidence.get("fixtureSha256") != anchor.get("fixtureSha256")
        or evidence.get("buildInputDigest") != anchor.get("buildInputDigest")
    ):
        raise ValueError("TRUST_ANCHOR_MISMATCH")
    if evidence.get("bundleMerkleRoot") != bundle_merkle_root(actual_members):
        raise ValueError("BUNDLE_MEMBER_MISMATCH")
    if evidence.get(EVIDENCE_DIGEST_FIELD) != evidence_digest(evidence):
        raise ValueError("EVIDENCE_DIGEST_MISMATCH")
    if evidence.get("bundleMerkleRoot") != anchor.get("expectedBundleMerkleRoot"):
        raise ValueError("TRUST_ANCHOR_MISMATCH")
    if evidence.get(EVIDENCE_DIGEST_FIELD) != anchor.get("expectedEvidenceDigest"):
        raise ValueError("TRUST_ANCHOR_MISMATCH")
