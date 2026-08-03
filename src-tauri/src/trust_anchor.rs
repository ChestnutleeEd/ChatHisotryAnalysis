//! Host-compiled sidecar trust anchor.
//!
//! The sidecar evidence file is untrusted input.  A release host calls
//! `verify_sidecar_evidence` before opening any source stream, comparing the
//! evidence payload and bundle-member root with this separately compiled
//! descriptor.

use serde::Deserialize;
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};
use std::fs;
use std::path::Path;

const TRUST_ANCHOR_JSON: &str = include_str!("../resources/sidecar-trust-anchor.json");
pub const TRUST_ANCHOR_VERSION: &str = "chat-history-analysis.sidecar-trust-anchor.v1";
pub const TRUST_ROOT: &str = "bundle-member-hashes-excluding-evidence+host-anchor-v1";
pub const SIDECAR_BUNDLE_DIRECTORY: &str = "chat-history-analysis-sidecar";
const EVIDENCE_NAME: &str = "sidecar-evidence.json";

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TrustAnchor {
    pub anchor_version: String,
    pub anchor_id: String,
    pub target_triple: String,
    pub python_major_minor: String,
    pub executable_name: String,
    pub native_backend: String,
    pub source_revision: String,
    pub dependency_lock_digest: String,
    pub spec_digest: String,
    pub production_entrypoint_digest: String,
    pub fixture_sha256: String,
    pub build_input_digest: String,
    pub expected_bundle_merkle_root: String,
    pub expected_evidence_digest: String,
    pub trust_root: String,
}

pub fn embedded_anchor() -> Result<TrustAnchor, &'static str> {
    let anchor: TrustAnchor =
        serde_json::from_str(TRUST_ANCHOR_JSON).map_err(|_| "TRUST_ANCHOR_INVALID")?;
    if anchor.anchor_version != TRUST_ANCHOR_VERSION || anchor.trust_root != TRUST_ROOT {
        return Err("TRUST_ANCHOR_INVALID");
    }
    Ok(anchor)
}

pub fn verify_embedded_anchor() -> Result<(), &'static str> {
    embedded_anchor().map(|_| ())
}

/// Verify the fixed resource bundle with the host-compiled anchor.  The path
/// is resolved by the host's resource API; it is never accepted from the
/// renderer.  The adjacent anchor is excluded from the member root because
/// the compiled host anchor is the final authority.
pub fn verify_sidecar_bundle(bundle_root: &Path) -> Result<(), &'static str> {
    let root = fs::canonicalize(bundle_root).map_err(|_| "SIDECAR_EVIDENCE_INVALID")?;
    let evidence_path = root.join(EVIDENCE_NAME);
    let evidence_bytes = read_regular_file(&evidence_path)?;
    let evidence: Value =
        serde_json::from_slice(&evidence_bytes).map_err(|_| "SIDECAR_EVIDENCE_INVALID")?;
    let members = bundle_members(&root)?;
    verify_sidecar_evidence(&evidence, &members)
}

pub fn verify_sidecar_evidence(
    evidence: &Value,
    bundle_members: &Value,
) -> Result<(), &'static str> {
    let anchor = embedded_anchor()?;
    let object = evidence.as_object().ok_or("SIDECAR_EVIDENCE_INVALID")?;
    if object.get("members") != Some(bundle_members) {
        return Err("BUNDLE_MEMBER_MISMATCH");
    }
    if object.get("evidenceVersion")
        != Some(&Value::String(
            "chat-history-analysis.sidecar-evidence.v1".to_string(),
        ))
        || object.get("buildMode") != Some(&Value::String("onedir".to_string()))
        || object.get("targetTriple") != Some(&Value::String(anchor.target_triple.clone()))
        || object.get("pythonMajorMinor") != Some(&Value::String(anchor.python_major_minor.clone()))
        || object.get("nativeBackend") != Some(&Value::String(anchor.native_backend.clone()))
        || object.get("executableArchitecture") != Some(&Value::String("arm64".to_string()))
        || object.get("network") != Some(&Value::String("blocked-and-probed".to_string()))
        || !probes_are_passed(object.get("probeResults"))
        || object.get("trustAnchorId") != Some(&Value::String(anchor.anchor_id.clone()))
        || object.get("trustRoot") != Some(&Value::String(TRUST_ROOT.to_string()))
        || object.get("executableName") != Some(&Value::String(anchor.executable_name.clone()))
        || object.get("sourceRevision") != Some(&Value::String(anchor.source_revision.clone()))
        || object.get("dependencyLockDigest")
            != Some(&Value::String(anchor.dependency_lock_digest.clone()))
        || object.get("specDigest") != Some(&Value::String(anchor.spec_digest.clone()))
        || object.get("productionEntrypointDigest")
            != Some(&Value::String(anchor.production_entrypoint_digest.clone()))
        || object.get("fixtureSha256") != Some(&Value::String(anchor.fixture_sha256.clone()))
        || object.get("buildInputDigest") != Some(&Value::String(anchor.build_input_digest.clone()))
    {
        return Err("TRUST_ANCHOR_MISMATCH");
    }

    let bundle_root = digest_value(bundle_members);
    if object.get("bundleMerkleRoot") != Some(&Value::String(bundle_root.clone()))
        || bundle_root != anchor.expected_bundle_merkle_root
    {
        return Err("BUNDLE_MEMBER_MISMATCH");
    }
    let mut payload = object.clone();
    payload.remove("evidenceDigest");
    let digest = digest_value(&Value::Object(payload));
    if object.get("evidenceDigest") != Some(&Value::String(digest.clone()))
        || digest != anchor.expected_evidence_digest
    {
        return Err("EVIDENCE_DIGEST_MISMATCH");
    }
    Ok(())
}

fn probes_are_passed(value: Option<&Value>) -> bool {
    let Some(probes) = value.and_then(Value::as_object) else {
        return false;
    };
    [
        "parser",
        "productionSuccess",
        "productionFailure",
        "differentCwd",
        "offline",
    ]
    .iter()
    .all(|name| probes.get(*name) == Some(&Value::String("passed".to_string())))
        && probes.len() == 5
}

fn read_regular_file(path: &Path) -> Result<Vec<u8>, &'static str> {
    let metadata = fs::symlink_metadata(path).map_err(|_| "SIDECAR_EVIDENCE_INVALID")?;
    if !metadata.is_file() || metadata.file_type().is_symlink() {
        return Err("SIDECAR_EVIDENCE_INVALID");
    }
    fs::read(path).map_err(|_| "SIDECAR_EVIDENCE_INVALID")
}

fn bundle_members(root: &Path) -> Result<Value, &'static str> {
    let metadata = fs::symlink_metadata(root).map_err(|_| "SIDECAR_EVIDENCE_INVALID")?;
    if !metadata.is_dir() || metadata.file_type().is_symlink() {
        return Err("SIDECAR_EVIDENCE_INVALID");
    }
    let root = fs::canonicalize(root).map_err(|_| "SIDECAR_EVIDENCE_INVALID")?;
    let mut members = Vec::new();
    collect_bundle_members(&root, &root, &mut members)?;
    members.sort_by(|left, right| {
        left.get("name")
            .and_then(Value::as_str)
            .cmp(&right.get("name").and_then(Value::as_str))
    });
    Ok(Value::Array(members))
}

fn collect_bundle_members(
    root: &Path,
    current: &Path,
    members: &mut Vec<Value>,
) -> Result<(), &'static str> {
    for entry in fs::read_dir(current).map_err(|_| "SIDECAR_EVIDENCE_INVALID")? {
        let entry = entry.map_err(|_| "SIDECAR_EVIDENCE_INVALID")?;
        let path = entry.path();
        let metadata = fs::symlink_metadata(&path).map_err(|_| "SIDECAR_EVIDENCE_INVALID")?;
        if metadata.file_type().is_symlink() {
            return Err("SIDECAR_EVIDENCE_INVALID");
        }
        if metadata.is_dir() {
            collect_bundle_members(root, &path, members)?;
            continue;
        }
        if !metadata.is_file() {
            return Err("SIDECAR_EVIDENCE_INVALID");
        }
        let relative = path
            .strip_prefix(root)
            .map_err(|_| "SIDECAR_EVIDENCE_INVALID")?;
        let name = relative
            .to_str()
            .ok_or("SIDECAR_EVIDENCE_INVALID")?
            .replace('\\', "/");
        if Path::new(&name)
            .file_name()
            .and_then(|file_name| file_name.to_str())
            .is_some_and(|file_name| {
                file_name == EVIDENCE_NAME || file_name == "sidecar-trust-anchor.json"
            })
        {
            continue;
        }
        let bytes = read_regular_file(&path)?;
        members.push(json!({
            "name": name,
            "byteSize": bytes.len(),
            "sha256": digest_bytes(&bytes),
        }));
    }
    Ok(())
}

fn digest_value(value: &Value) -> String {
    let canonical = canonicalize(value);
    let bytes = serde_json::to_vec(&canonical).expect("canonical JSON is serializable");
    let mut digest = Sha256::new();
    digest.update(bytes);
    format!("{:x}", digest.finalize())
}

fn digest_bytes(value: &[u8]) -> String {
    let mut digest = Sha256::new();
    digest.update(value);
    format!("{:x}", digest.finalize())
}

fn canonicalize(value: &Value) -> Value {
    match value {
        Value::Array(values) => Value::Array(values.iter().map(canonicalize).collect()),
        Value::Object(values) => {
            let mut canonical = Map::new();
            let mut keys = values.keys().collect::<Vec<_>>();
            keys.sort();
            for key in keys {
                canonical.insert(key.clone(), canonicalize(&values[key]));
            }
            Value::Object(canonical)
        }
        _ => value.clone(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn embedded_anchor_is_present_and_not_runtime_config() {
        let anchor = embedded_anchor().expect("committed host anchor");
        assert_eq!(anchor.anchor_version, TRUST_ANCHOR_VERSION);
        assert_ne!(anchor.expected_bundle_merkle_root, "0".repeat(64));
        assert_ne!(anchor.expected_evidence_digest, "0".repeat(64));
    }

    #[test]
    #[ignore = "requires the clean Alpha sidecar bundle path"]
    fn host_verifier_accepts_the_clean_alpha_bundle() {
        let bundle = std::env::var_os("CHAT_HISTORY_ANALYSIS_ALPHA_BUNDLE")
            .expect("Alpha matrix must provide a clean sidecar bundle");
        verify_sidecar_bundle(Path::new(&bundle)).expect("host fixed-root verification");
    }
}
