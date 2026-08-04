//! Bounded command/channel transport for one verified desktop dataset.
//!
//! The legacy fixture owns one active session; the production-shaped path owns
//! each opaque session/dataset capability in a host registry. A chunk is moved
//! into the fixed-capacity response bridge and released as it is consumed; a
//! close/cancel/disconnect drops the whole registry entry instead of leaving a
//! boolean tombstone or a long-lived clone of the dataset.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{HashMap, VecDeque};
use std::sync::{
    atomic::{AtomicBool, AtomicU64, Ordering},
    Arc, Mutex,
};
use tokio::sync::{mpsc, Mutex as AsyncMutex, OwnedSemaphorePermit, Semaphore};

use crate::ipc::{MAX_SAFE_INTEGER, PROTOCOL_VERSION};

pub const MAX_MANIFEST_BYTES: usize = 4 * 1024 * 1024;
pub const MAX_CHUNK_BYTES: usize = 33_554_432;
pub const MAX_DATASET_BYTES: usize = 536_870_912;
pub const MAX_RECORD_COUNT: u64 = 2_000_000;
pub const MAX_CHUNK_COUNT: usize = 16_384;
pub const CHANNEL_CAPACITY: usize = 2;
pub const MAX_IN_FLIGHT_BYTES: usize = 64 * 1024 * 1024;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DatasetTransportRequest {
    pub protocol_version: String,
    pub session_id: String,
    pub generation: u64,
    pub kind: String,
    pub ordinal: Option<u64>,
    pub expected_bytes: Option<u64>,
}

#[derive(Debug)]
pub struct DatasetRegistration {
    pub window_label: String,
    pub session_id: String,
    pub generation: u64,
    pub dataset_identity: String,
    pub record_count: u64,
    pub manifest: Vec<u8>,
    pub chunks: Vec<Vec<u8>>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub enum DatasetTransportError {
    InvalidRequest,
    UnknownSession,
    StaleGeneration,
    WrongWindow,
    Cancelled,
    Closed,
    SizeMismatch,
    LimitExceeded,
    OrderingViolation,
    DuplicateOrdinal,
    MissingOrdinal,
    DuplicateCompletion,
    Backpressure,
    ReceiverDisconnected,
}

#[derive(Debug, Default)]
pub struct BoundedCommandBridge {
    pending: VecDeque<Vec<u8>>,
    in_flight_bytes: usize,
}

impl BoundedCommandBridge {
    fn can_send(&self, payload_bytes: usize) -> bool {
        self.pending.len() < CHANNEL_CAPACITY
            && payload_bytes <= MAX_IN_FLIGHT_BYTES
            && self.in_flight_bytes.saturating_add(payload_bytes) <= MAX_IN_FLIGHT_BYTES
    }

    pub fn try_send(&mut self, payload: Vec<u8>) -> Result<(), DatasetTransportError> {
        if !self.can_send(payload.len()) {
            return Err(DatasetTransportError::Backpressure);
        }
        self.in_flight_bytes += payload.len();
        self.pending.push_back(payload);
        Ok(())
    }

    pub fn receive(&mut self) -> Option<Vec<u8>> {
        let payload = self.pending.pop_front()?;
        self.in_flight_bytes = self.in_flight_bytes.saturating_sub(payload.len());
        Some(payload)
    }

    pub fn pending_count(&self) -> usize {
        self.pending.len()
    }

    pub fn in_flight_bytes(&self) -> usize {
        self.in_flight_bytes
    }

    pub fn disconnect(&mut self) {
        self.pending.clear();
        self.in_flight_bytes = 0;
    }
}

#[derive(Debug)]
struct ActiveDataset {
    window_label: String,
    session_id: String,
    generation: u64,
    dataset_identity: String,
    record_count: u64,
    manifest: Option<Vec<u8>>,
    chunks: Vec<Option<Vec<u8>>>,
    total_bytes: usize,
    consumed_bytes: usize,
    next_ordinal: u64,
    completed: bool,
    bridge: BoundedCommandBridge,
}

#[derive(Debug, Default)]
pub struct BoundedDatasetTransport {
    active: Option<ActiveDataset>,
}

impl BoundedDatasetTransport {
    /// Compatibility entry point for the foundation fixtures.  Real callers
    /// must use `register_owned`, which supplies the trusted window and opaque
    /// dataset identity explicitly.
    pub fn register(
        &mut self,
        session_id: String,
        generation: u64,
        manifest: Vec<u8>,
        chunks: Vec<Vec<u8>>,
    ) -> Result<(), DatasetTransportError> {
        self.register_owned(DatasetRegistration {
            window_label: "main".to_string(),
            session_id,
            generation,
            dataset_identity: "dat_00000000000000000000000000000001".to_string(),
            record_count: MAX_RECORD_COUNT,
            manifest,
            chunks,
        })
    }

    pub fn register_owned(
        &mut self,
        registration: DatasetRegistration,
    ) -> Result<(), DatasetTransportError> {
        let DatasetRegistration {
            window_label,
            session_id,
            generation,
            dataset_identity,
            record_count,
            manifest,
            chunks,
        } = registration;
        if self.active.is_some()
            || !valid_window_label(&window_label)
            || !valid_session_id(&session_id)
            || !valid_dataset_identity(&dataset_identity)
            || generation == 0
            || generation > MAX_SAFE_INTEGER
        {
            return Err(DatasetTransportError::InvalidRequest);
        }
        let total_bytes =
            validate_dataset_limits(manifest.len(), chunks.iter().map(Vec::len), record_count)?;

        self.active = Some(ActiveDataset {
            window_label,
            session_id,
            generation,
            dataset_identity,
            record_count,
            manifest: Some(manifest),
            chunks: chunks.into_iter().map(Some).collect(),
            total_bytes,
            consumed_bytes: 0,
            next_ordinal: 1,
            completed: false,
            bridge: BoundedCommandBridge::default(),
        });
        Ok(())
    }

    pub fn read(
        &mut self,
        trusted_window_label: &str,
        request: &DatasetTransportRequest,
    ) -> Result<Vec<u8>, DatasetTransportError> {
        validate_request(request)?;
        let active = self
            .active
            .as_mut()
            .ok_or(DatasetTransportError::UnknownSession)?;
        if active.window_label != trusted_window_label {
            return Err(DatasetTransportError::WrongWindow);
        }
        if active.session_id != request.session_id {
            return Err(DatasetTransportError::UnknownSession);
        }
        if active.generation != request.generation {
            return Err(DatasetTransportError::StaleGeneration);
        }
        if active.completed {
            return Err(DatasetTransportError::Closed);
        }

        let payload = match request.kind.as_str() {
            "manifest" => {
                if request.ordinal.is_some() || request.expected_bytes.is_some() {
                    return Err(DatasetTransportError::InvalidRequest);
                }
                let size = active
                    .manifest
                    .as_ref()
                    .ok_or(DatasetTransportError::DuplicateOrdinal)?
                    .len();
                if !active.bridge.can_send(size) {
                    return Err(DatasetTransportError::Backpressure);
                }
                active
                    .manifest
                    .take()
                    .ok_or(DatasetTransportError::DuplicateOrdinal)?
            }
            "chunk" => {
                let ordinal = request
                    .ordinal
                    .ok_or(DatasetTransportError::InvalidRequest)?;
                let expected_bytes = request
                    .expected_bytes
                    .ok_or(DatasetTransportError::InvalidRequest)?;
                if ordinal != active.next_ordinal {
                    return Err(if ordinal < active.next_ordinal {
                        DatasetTransportError::DuplicateOrdinal
                    } else {
                        DatasetTransportError::OrderingViolation
                    });
                }
                let index = usize::try_from(ordinal - 1)
                    .map_err(|_| DatasetTransportError::OrderingViolation)?;
                let chunk_ref = active
                    .chunks
                    .get(index)
                    .ok_or(DatasetTransportError::MissingOrdinal)?
                    .as_ref()
                    .ok_or(DatasetTransportError::DuplicateOrdinal)?;
                if chunk_ref.len() as u64 != expected_bytes {
                    return Err(DatasetTransportError::SizeMismatch);
                }
                if !active.bridge.can_send(chunk_ref.len()) {
                    return Err(DatasetTransportError::Backpressure);
                }
                let chunk = active
                    .chunks
                    .get_mut(index)
                    .ok_or(DatasetTransportError::MissingOrdinal)?
                    .take()
                    .ok_or(DatasetTransportError::DuplicateOrdinal)?;
                active.next_ordinal = active
                    .next_ordinal
                    .checked_add(1)
                    .ok_or(DatasetTransportError::OrderingViolation)?;
                chunk
            }
            _ => return Err(DatasetTransportError::InvalidRequest),
        };

        active.consumed_bytes = active
            .consumed_bytes
            .checked_add(payload.len())
            .ok_or(DatasetTransportError::LimitExceeded)?;
        // The bridge is the bounded producer/consumer boundary.  The command
        // handler consumes its one response immediately for this synchronous
        // spike; asynchronous callers can exercise the same bridge directly
        // and receive Backpressure when it is full.
        active.bridge.try_send(payload)?;
        active
            .bridge
            .receive()
            .ok_or(DatasetTransportError::ReceiverDisconnected)
    }

    pub fn complete(
        &mut self,
        trusted_window_label: &str,
        session_id: &str,
        generation: u64,
    ) -> Result<(), DatasetTransportError> {
        let active = self
            .active
            .as_mut()
            .ok_or(DatasetTransportError::UnknownSession)?;
        if active.window_label != trusted_window_label {
            return Err(DatasetTransportError::WrongWindow);
        }
        if active.session_id != session_id {
            return Err(DatasetTransportError::UnknownSession);
        }
        if active.generation != generation {
            return Err(DatasetTransportError::StaleGeneration);
        }
        if active.completed {
            return Err(DatasetTransportError::DuplicateCompletion);
        }
        if active.manifest.is_some()
            || active.chunks.iter().any(Option::is_some)
            || active.consumed_bytes != active.total_bytes
        {
            return Err(DatasetTransportError::MissingOrdinal);
        }
        active.completed = true;
        Ok(())
    }

    pub fn cancel(
        &mut self,
        trusted_window_label: &str,
        session_id: &str,
        generation: u64,
    ) -> Result<(), DatasetTransportError> {
        self.close_owned(trusted_window_label, session_id, generation)
            .map(|_| ())
    }

    pub fn close(
        &mut self,
        trusted_window_label: &str,
        session_id: &str,
        generation: u64,
    ) -> Result<(), DatasetTransportError> {
        self.close_owned(trusted_window_label, session_id, generation)
            .map(|_| ())
    }

    pub fn close_window(&mut self, trusted_window_label: &str) -> bool {
        if self
            .active
            .as_ref()
            .is_some_and(|active| active.window_label == trusted_window_label)
        {
            self.active.take();
            true
        } else {
            false
        }
    }

    pub fn receiver_disconnected(&mut self, trusted_window_label: &str) -> bool {
        self.close_window(trusted_window_label)
    }

    pub fn active_memory_bytes(&self) -> usize {
        self.active.as_ref().map_or(0, |active| {
            active.manifest.as_ref().map_or(0, Vec::len)
                + active.chunks.iter().flatten().map(Vec::len).sum::<usize>()
                + active.bridge.in_flight_bytes()
        })
    }

    pub fn active_record_count(&self) -> Option<u64> {
        self.active.as_ref().map(|active| active.record_count)
    }

    pub fn active_dataset_identity(&self) -> Option<&str> {
        self.active
            .as_ref()
            .map(|active| active.dataset_identity.as_str())
    }

    pub fn try_enqueue_for_test(
        &mut self,
        trusted_window_label: &str,
        payload: Vec<u8>,
    ) -> Result<(), DatasetTransportError> {
        let active = self
            .active
            .as_mut()
            .ok_or(DatasetTransportError::UnknownSession)?;
        if active.window_label != trusted_window_label {
            return Err(DatasetTransportError::WrongWindow);
        }
        active.bridge.try_send(payload)
    }

    pub fn consume_for_test(&mut self, trusted_window_label: &str) -> Option<Vec<u8>> {
        self.active
            .as_mut()
            .filter(|active| active.window_label == trusted_window_label)
            .and_then(|active| active.bridge.receive())
    }

    fn close_owned(
        &mut self,
        trusted_window_label: &str,
        session_id: &str,
        generation: u64,
    ) -> Result<ActiveDataset, DatasetTransportError> {
        let active = self
            .active
            .as_ref()
            .ok_or(DatasetTransportError::UnknownSession)?;
        if active.window_label != trusted_window_label {
            return Err(DatasetTransportError::WrongWindow);
        }
        if active.session_id != session_id {
            return Err(DatasetTransportError::UnknownSession);
        }
        if active.generation != generation {
            return Err(DatasetTransportError::StaleGeneration);
        }
        self.active.take().ok_or(DatasetTransportError::Closed)
    }
}

fn validate_request(request: &DatasetTransportRequest) -> Result<(), DatasetTransportError> {
    if request.protocol_version != PROTOCOL_VERSION
        || !valid_session_id(&request.session_id)
        || request.generation == 0
        || request.generation > MAX_SAFE_INTEGER
    {
        return Err(DatasetTransportError::InvalidRequest);
    }
    match request.kind.as_str() {
        "manifest" => {
            if request.ordinal.is_some() || request.expected_bytes.is_some() {
                return Err(DatasetTransportError::InvalidRequest);
            }
        }
        "chunk" => {
            let Some(ordinal) = request.ordinal else {
                return Err(DatasetTransportError::InvalidRequest);
            };
            let Some(expected_bytes) = request.expected_bytes else {
                return Err(DatasetTransportError::InvalidRequest);
            };
            if ordinal == 0
                || ordinal > MAX_CHUNK_COUNT as u64
                || expected_bytes == 0
                || expected_bytes > MAX_CHUNK_BYTES as u64
                || expected_bytes > MAX_SAFE_INTEGER
            {
                return Err(DatasetTransportError::LimitExceeded);
            }
        }
        _ => return Err(DatasetTransportError::InvalidRequest),
    }
    Ok(())
}

fn validate_dataset_limits(
    manifest_bytes: usize,
    chunk_lengths: impl IntoIterator<Item = usize>,
    record_count: u64,
) -> Result<usize, DatasetTransportError> {
    if record_count == 0
        || record_count > MAX_RECORD_COUNT
        || manifest_bytes == 0
        || manifest_bytes > MAX_MANIFEST_BYTES
    {
        return Err(DatasetTransportError::InvalidRequest);
    }
    let mut chunk_count = 0usize;
    let mut chunk_bytes = 0usize;
    for length in chunk_lengths {
        chunk_count += 1;
        if chunk_count > MAX_CHUNK_COUNT {
            return Err(DatasetTransportError::InvalidRequest);
        }
        if length == 0 || length > MAX_CHUNK_BYTES {
            return Err(DatasetTransportError::LimitExceeded);
        }
        chunk_bytes = chunk_bytes
            .checked_add(length)
            .ok_or(DatasetTransportError::LimitExceeded)?;
    }
    if chunk_count == 0 {
        return Err(DatasetTransportError::InvalidRequest);
    }
    let total_bytes = manifest_bytes
        .checked_add(chunk_bytes)
        .ok_or(DatasetTransportError::LimitExceeded)?;
    if total_bytes > MAX_DATASET_BYTES {
        return Err(DatasetTransportError::LimitExceeded);
    }
    Ok(total_bytes)
}

fn valid_window_label(value: &str) -> bool {
    value == "main"
}

fn valid_session_id(value: &str) -> bool {
    value.len() == 36
        && value.starts_with("ses_")
        && value[4..]
            .bytes()
            .all(|byte| matches!(byte, b'0'..=b'9' | b'a'..=b'f'))
}

fn valid_dataset_identity(value: &str) -> bool {
    value.len() == 36
        && value.starts_with("dat_")
        && value[4..]
            .bytes()
            .all(|byte| matches!(byte, b'0'..=b'9' | b'a'..=b'f'))
}

// -------------------------------------------------------------------------
// Production transport path
// -------------------------------------------------------------------------

/// The command-facing open request contains only opaque capabilities.  The
/// host registry, not the renderer, supplies every dataset statistic and byte.
/// There is intentionally no record count, chunk count, chunk size, dataset
/// byte, path, argv, environment, cwd, URL, or filename field at this boundary.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DatasetStreamOpenRequest {
    pub protocol_version: String,
    pub session_id: String,
    pub generation: u64,
    pub dataset_id: String,
}

/// Trusted host metadata returned after the host has accepted a registry
/// entry.  A renderer may observe this response, but it cannot provide or
/// override any of these values in the open request.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HostDatasetCapability {
    pub protocol_version: &'static str,
    pub session_id: String,
    pub generation: u64,
    pub dataset_id: String,
    pub manifest_bytes: usize,
    pub record_count: u64,
    pub chunk_count: u64,
    pub chunk_bytes: u64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DatasetStreamReadRequest {
    pub protocol_version: String,
    pub session_id: String,
    pub generation: u64,
    pub dataset_id: String,
    pub kind: String,
    pub ordinal: Option<u64>,
    pub expected_bytes: Option<u64>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DatasetStreamControlRequest {
    pub protocol_version: String,
    pub session_id: String,
    pub generation: u64,
    pub dataset_id: String,
}

pub type DatasetStreamOpened = HostDatasetCapability;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DatasetStreamAck {
    pub protocol_version: &'static str,
    pub session_id: String,
    pub generation: u64,
    pub dataset_id: String,
    pub closed: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum StreamFrameKind {
    Manifest,
    Chunk,
    Complete,
}

#[derive(Debug)]
struct QueuedFrame {
    kind: StreamFrameKind,
    ordinal: Option<u64>,
    payload: Vec<u8>,
    _memory_permit: Option<OwnedSemaphorePermit>,
}

#[derive(Debug, Default)]
struct StreamCursor {
    manifest_consumed: bool,
    next_ordinal: u64,
    completed: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
struct StreamKey {
    session_id: String,
    generation: u64,
    dataset_id: String,
}

#[derive(Debug)]
struct ActiveStream {
    window_label: String,
    key: StreamKey,
    chunk_count: u64,
    chunk_sizes: Vec<u64>,
    receiver: AsyncMutex<mpsc::Receiver<QueuedFrame>>,
    cursor: AsyncMutex<StreamCursor>,
    cancelled: Arc<AtomicBool>,
    abort_handle: tokio::task::AbortHandle,
}

#[derive(Debug)]
struct HostDataset {
    window_label: String,
    key: StreamKey,
    record_count: u64,
    manifest: Arc<Vec<u8>>,
    chunks: Arc<Vec<Vec<u8>>>,
}

#[derive(Debug, Clone, Default)]
pub struct DatasetTransportState {
    streams: Arc<Mutex<HashMap<StreamKey, Arc<ActiveStream>>>>,
    host_datasets: Arc<Mutex<HashMap<StreamKey, HostDataset>>>,
    next_opaque_id: Arc<AtomicU64>,
    sidecar_verified: Arc<AtomicBool>,
}

impl DatasetTransportState {
    /// Mark the fixed host resource bundle as verified.  This is deliberately
    /// not a Tauri command; only native startup/supervision code can advance
    /// this gate, and renderer commands can only observe a fail-closed error
    /// until it has been set.
    pub fn mark_sidecar_verified(&self) {
        self.sidecar_verified.store(true, Ordering::Release);
    }

    /// Register a verified host-owned source and mint opaque capabilities for
    /// it.  This method is intentionally not a Tauri command: only trusted
    /// host code may create a session/dataset entry.  The renderer receives
    /// the returned capability after verification and cannot choose its IDs or
    /// metadata.
    pub fn register_host_dataset(
        &self,
        trusted_window_label: &str,
        generation: u64,
        manifest: Vec<u8>,
        chunks: Vec<Vec<u8>>,
    ) -> Result<HostDatasetCapability, DatasetTransportError> {
        if !valid_window_label(trusted_window_label)
            || generation == 0
            || generation > MAX_SAFE_INTEGER
        {
            return Err(DatasetTransportError::InvalidRequest);
        }
        let record_count = derive_host_record_count(&manifest)?;
        validate_dataset_limits(manifest.len(), chunks.iter().map(Vec::len), record_count)?;
        let manifest_bytes = manifest.len();
        let chunk_count = chunks.len();
        let chunk_bytes = chunks.iter().map(Vec::len).max().unwrap_or(0);
        let sequence = self
            .next_opaque_id
            .fetch_add(1, Ordering::Relaxed)
            .checked_add(1)
            .ok_or(DatasetTransportError::LimitExceeded)?;
        if sequence > MAX_SAFE_INTEGER {
            return Err(DatasetTransportError::LimitExceeded);
        }
        let session_id = format!("ses_{sequence:032x}");
        let dataset_id = format!("dat_{sequence:032x}");
        let key = StreamKey {
            session_id: session_id.clone(),
            generation,
            dataset_id: dataset_id.clone(),
        };
        let mut registry = self
            .host_datasets
            .lock()
            .map_err(|_| DatasetTransportError::Closed)?;
        if registry.values().any(|entry| {
            entry.window_label == trusted_window_label && entry.key.session_id == session_id
        }) {
            return Err(DatasetTransportError::InvalidRequest);
        }
        registry.insert(
            key,
            HostDataset {
                window_label: trusted_window_label.to_string(),
                key: StreamKey {
                    session_id: session_id.clone(),
                    generation,
                    dataset_id: dataset_id.clone(),
                },
                record_count,
                manifest: Arc::new(manifest),
                chunks: Arc::new(chunks),
            },
        );
        Ok(HostDatasetCapability {
            protocol_version: PROTOCOL_VERSION,
            session_id,
            generation,
            dataset_id,
            manifest_bytes,
            record_count,
            chunk_count: chunk_count as u64,
            chunk_bytes: chunk_bytes as u64,
        })
    }

    /// Register the verified bytes under an existing supervised session. The
    /// session id is supplied by the supervisor; only the dataset capability
    /// is minted here. This keeps a stale renderer from pairing bytes with a
    /// different generation.
    pub fn register_host_dataset_for_session(
        &self,
        trusted_window_label: &str,
        session_id: &str,
        generation: u64,
        manifest: Vec<u8>,
        chunks: Vec<Vec<u8>>,
    ) -> Result<HostDatasetCapability, DatasetTransportError> {
        if !valid_window_label(trusted_window_label)
            || !valid_session_id(session_id)
            || generation == 0
            || generation > MAX_SAFE_INTEGER
        {
            return Err(DatasetTransportError::InvalidRequest);
        }
        let record_count = derive_host_record_count(&manifest)?;
        validate_dataset_limits(manifest.len(), chunks.iter().map(Vec::len), record_count)?;
        let manifest_bytes = manifest.len();
        let chunk_count = chunks.len();
        let chunk_bytes = chunks.iter().map(Vec::len).max().unwrap_or(0);
        let sequence = self
            .next_opaque_id
            .fetch_add(1, Ordering::Relaxed)
            .checked_add(1)
            .ok_or(DatasetTransportError::LimitExceeded)?;
        if sequence > MAX_SAFE_INTEGER {
            return Err(DatasetTransportError::LimitExceeded);
        }
        let dataset_id = format!("dat_{sequence:032x}");
        let key = StreamKey {
            session_id: session_id.to_string(),
            generation,
            dataset_id: dataset_id.clone(),
        };
        let mut registry = self
            .host_datasets
            .lock()
            .map_err(|_| DatasetTransportError::Closed)?;
        if registry.values().any(|entry| {
            entry.window_label == trusted_window_label
                && entry.key.session_id == session_id
                && entry.key.generation == generation
        }) {
            return Err(DatasetTransportError::InvalidRequest);
        }
        registry.insert(
            key.clone(),
            HostDataset {
                window_label: trusted_window_label.to_string(),
                key,
                record_count,
                manifest: Arc::new(manifest),
                chunks: Arc::new(chunks),
            },
        );
        Ok(HostDatasetCapability {
            protocol_version: PROTOCOL_VERSION,
            session_id: session_id.to_string(),
            generation,
            dataset_id,
            manifest_bytes,
            record_count,
            chunk_count: chunk_count as u64,
            chunk_bytes: chunk_bytes as u64,
        })
    }

    pub fn open(
        &self,
        trusted_window_label: &str,
        request: DatasetStreamOpenRequest,
    ) -> Result<DatasetStreamOpened, DatasetTransportError> {
        validate_open_request(&request)?;
        if !self.sidecar_verified.load(Ordering::Acquire) {
            return Err(DatasetTransportError::InvalidRequest);
        }
        if !valid_window_label(trusted_window_label) {
            return Err(DatasetTransportError::WrongWindow);
        }

        let key = StreamKey {
            session_id: request.session_id.clone(),
            generation: request.generation,
            dataset_id: request.dataset_id.clone(),
        };
        let mut registry = self
            .streams
            .lock()
            .map_err(|_| DatasetTransportError::Closed)?;
        if registry.contains_key(&key)
            || registry.values().any(|stream| {
                stream.window_label == trusted_window_label
                    && stream.key.session_id == key.session_id
            })
        {
            return Err(DatasetTransportError::InvalidRequest);
        }

        let host_registry = self
            .host_datasets
            .lock()
            .map_err(|_| DatasetTransportError::Closed)?;
        let host_dataset = host_registry
            .get(&key)
            .ok_or(DatasetTransportError::UnknownSession)?;
        if host_dataset.window_label != trusted_window_label {
            return Err(DatasetTransportError::WrongWindow);
        }
        let host_window_label = host_dataset.window_label.clone();
        let host_key = host_dataset.key.clone();
        let record_count = host_dataset.record_count;
        let manifest = Arc::clone(&host_dataset.manifest);
        let chunks = Arc::clone(&host_dataset.chunks);
        let manifest_bytes = manifest.len();
        let chunk_count = chunks.len() as u64;
        let chunk_bytes = chunks.iter().map(Vec::len).max().unwrap_or(0) as u64;
        let chunk_sizes = chunks
            .iter()
            .map(|chunk| chunk.len() as u64)
            .collect::<Vec<_>>();
        let dataset_id = host_key.dataset_id.clone();
        let session_id = host_key.session_id.clone();
        let generation = host_key.generation;
        drop(host_registry);

        let (sender, receiver) = mpsc::channel(CHANNEL_CAPACITY);
        let cancelled = Arc::new(AtomicBool::new(false));
        let cancellation = Arc::clone(&cancelled);
        let memory = Arc::new(Semaphore::new(MAX_IN_FLIGHT_BYTES));
        let manifest_for_producer = Arc::clone(&manifest);
        let chunks_for_producer = Arc::clone(&chunks);
        let producer_task = async move {
            let manifest_size = manifest_for_producer.len();
            if !send_frame(
                &sender,
                &memory,
                &cancellation,
                StreamFrameKind::Manifest,
                None,
                manifest_size,
                move || manifest_for_producer.as_ref().clone(),
            )
            .await
            {
                return;
            }
            for (index, chunk) in chunks_for_producer.iter().enumerate() {
                if cancellation.load(Ordering::Acquire) {
                    return;
                }
                let ordinal = (index + 1) as u64;
                let chunk = chunk.clone();
                let size = chunk.len();
                if !send_frame(
                    &sender,
                    &memory,
                    &cancellation,
                    StreamFrameKind::Chunk,
                    Some(ordinal),
                    size,
                    move || chunk,
                )
                .await
                {
                    return;
                }
            }
            let _ = send_frame(
                &sender,
                &memory,
                &cancellation,
                StreamFrameKind::Complete,
                None,
                0,
                Vec::new,
            )
            .await;
        };
        // Tauri command handlers are synchronous on the macOS main thread;
        // use the global Tauri runtime there, while retaining the caller's
        // current runtime in async tests and async host callers.
        let abort_handle = match tokio::runtime::Handle::try_current() {
            Ok(handle) => handle.spawn(producer_task).abort_handle(),
            Err(_) => tauri::async_runtime::spawn(producer_task)
                .inner()
                .abort_handle(),
        };
        registry.insert(
            key.clone(),
            Arc::new(ActiveStream {
                window_label: host_window_label,
                key,
                chunk_count,
                chunk_sizes,
                receiver: AsyncMutex::new(receiver),
                cursor: AsyncMutex::new(StreamCursor {
                    next_ordinal: 1,
                    ..StreamCursor::default()
                }),
                cancelled,
                abort_handle,
            }),
        );

        Ok(DatasetStreamOpened {
            protocol_version: PROTOCOL_VERSION,
            session_id,
            generation,
            dataset_id,
            manifest_bytes,
            record_count,
            chunk_count,
            chunk_bytes,
        })
    }

    pub async fn receive(
        &self,
        trusted_window_label: &str,
        request: DatasetStreamReadRequest,
    ) -> Result<Vec<u8>, DatasetTransportError> {
        validate_read_request(&request)?;
        let stream = self.lookup(
            trusted_window_label,
            &request.session_id,
            request.generation,
            &request.dataset_id,
        )?;
        let mut cursor = stream.cursor.lock().await;
        if cursor.completed {
            return Err(DatasetTransportError::Closed);
        }
        match request.kind.as_str() {
            "manifest" => {
                if cursor.manifest_consumed
                    || request.ordinal.is_some()
                    || request.expected_bytes.is_some()
                {
                    return Err(DatasetTransportError::OrderingViolation);
                }
            }
            "chunk" => {
                let Some(ordinal) = request.ordinal else {
                    return Err(DatasetTransportError::InvalidRequest);
                };
                let Some(expected_bytes) = request.expected_bytes else {
                    return Err(DatasetTransportError::InvalidRequest);
                };
                if !cursor.manifest_consumed || ordinal != cursor.next_ordinal {
                    return Err(if ordinal < cursor.next_ordinal {
                        DatasetTransportError::DuplicateOrdinal
                    } else {
                        DatasetTransportError::OrderingViolation
                    });
                }
                let Some(chunk_size) = stream.chunk_sizes.get((ordinal - 1) as usize).copied()
                else {
                    return Err(DatasetTransportError::MissingOrdinal);
                };
                if expected_bytes != chunk_size {
                    return Err(DatasetTransportError::SizeMismatch);
                }
            }
            _ => return Err(DatasetTransportError::InvalidRequest),
        }
        let mut receiver = stream.receiver.lock().await;
        let frame = receiver
            .recv()
            .await
            .ok_or(DatasetTransportError::ReceiverDisconnected)?;
        match request.kind.as_str() {
            "manifest" => {
                if frame.kind != StreamFrameKind::Manifest {
                    return Err(DatasetTransportError::OrderingViolation);
                }
                cursor.manifest_consumed = true;
            }
            "chunk" => {
                let Some(ordinal) = request.ordinal else {
                    return Err(DatasetTransportError::InvalidRequest);
                };
                let Some(expected_bytes) = request.expected_bytes else {
                    return Err(DatasetTransportError::InvalidRequest);
                };
                if frame.kind != StreamFrameKind::Chunk
                    || frame.ordinal != Some(ordinal)
                    || frame.payload.len() as u64 != expected_bytes
                {
                    return Err(DatasetTransportError::OrderingViolation);
                }
                cursor.next_ordinal = cursor
                    .next_ordinal
                    .checked_add(1)
                    .ok_or(DatasetTransportError::OrderingViolation)?;
            }
            _ => return Err(DatasetTransportError::InvalidRequest),
        }
        Ok(frame.payload)
    }

    pub async fn complete(
        &self,
        trusted_window_label: &str,
        request: DatasetStreamControlRequest,
    ) -> Result<DatasetStreamAck, DatasetTransportError> {
        validate_control_request(&request)?;
        let stream = self.lookup(
            trusted_window_label,
            &request.session_id,
            request.generation,
            &request.dataset_id,
        )?;
        let mut cursor = stream.cursor.lock().await;
        if cursor.completed {
            return Err(DatasetTransportError::DuplicateCompletion);
        }
        if !cursor.manifest_consumed || cursor.next_ordinal != stream.chunk_count + 1 {
            return Err(DatasetTransportError::MissingOrdinal);
        }
        let mut receiver = stream.receiver.lock().await;
        let marker = receiver
            .recv()
            .await
            .ok_or(DatasetTransportError::ReceiverDisconnected)?;
        if marker.kind != StreamFrameKind::Complete {
            return Err(DatasetTransportError::MissingOrdinal);
        }
        cursor.completed = true;
        Ok(DatasetStreamAck {
            protocol_version: PROTOCOL_VERSION,
            session_id: request.session_id,
            generation: request.generation,
            dataset_id: request.dataset_id,
            closed: false,
        })
    }

    pub fn cancel(
        &self,
        trusted_window_label: &str,
        request: DatasetStreamControlRequest,
    ) -> Result<DatasetStreamAck, DatasetTransportError> {
        self.close_owned(trusted_window_label, &request, true)
    }

    pub fn close(
        &self,
        trusted_window_label: &str,
        request: DatasetStreamControlRequest,
    ) -> Result<DatasetStreamAck, DatasetTransportError> {
        self.close_owned(trusted_window_label, &request, true)
    }

    pub fn close_window(&self, trusted_window_label: &str) -> usize {
        let Ok(mut registry) = self.streams.lock() else {
            return 0;
        };
        let keys = registry
            .iter()
            .filter(|(_, stream)| stream.window_label == trusted_window_label)
            .map(|(key, _)| key.clone())
            .collect::<Vec<_>>();
        let mut removed = 0;
        for key in keys {
            if let Some(stream) = registry.remove(&key) {
                stream.cancelled.store(true, Ordering::Release);
                stream.abort_handle.abort();
                removed += 1;
            }
        }
        drop(registry);
        if let Ok(mut host_registry) = self.host_datasets.lock() {
            host_registry.retain(|_, dataset| dataset.window_label != trusted_window_label);
        }
        removed
    }

    /// Drop every host dataset and active stream owned by one supervised
    /// session/generation. This is host cleanup, not a renderer-controlled
    /// filesystem operation.
    pub fn close_session(
        &self,
        trusted_window_label: &str,
        session_id: &str,
        generation: u64,
    ) -> usize {
        if !valid_window_label(trusted_window_label)
            || !valid_session_id(session_id)
            || generation == 0
            || generation > MAX_SAFE_INTEGER
        {
            return 0;
        }
        let mut removed = 0;
        if let Ok(mut registry) = self.streams.lock() {
            let keys = registry
                .iter()
                .filter(|(_, stream)| {
                    stream.window_label == trusted_window_label
                        && stream.key.session_id == session_id
                        && stream.key.generation == generation
                })
                .map(|(key, _)| key.clone())
                .collect::<Vec<_>>();
            for key in keys {
                if let Some(stream) = registry.remove(&key) {
                    stream.cancelled.store(true, Ordering::Release);
                    stream.abort_handle.abort();
                    removed += 1;
                }
            }
        }
        if let Ok(mut registry) = self.host_datasets.lock() {
            let before = registry.len();
            registry.retain(|_, dataset| {
                !(dataset.window_label == trusted_window_label
                    && dataset.key.session_id == session_id
                    && dataset.key.generation == generation)
            });
            removed += (before - registry.len()) as usize;
        }
        removed
    }

    #[cfg(test)]
    fn active_count(&self) -> usize {
        self.streams.lock().map_or(0, |streams| streams.len())
    }

    fn lookup(
        &self,
        trusted_window_label: &str,
        session_id: &str,
        generation: u64,
        dataset_id: &str,
    ) -> Result<Arc<ActiveStream>, DatasetTransportError> {
        if !valid_window_label(trusted_window_label) {
            return Err(DatasetTransportError::WrongWindow);
        }
        let key = StreamKey {
            session_id: session_id.to_string(),
            generation,
            dataset_id: dataset_id.to_string(),
        };
        let registry = self
            .streams
            .lock()
            .map_err(|_| DatasetTransportError::Closed)?;
        if let Some(stream) = registry.get(&key) {
            if stream.window_label != trusted_window_label {
                return Err(DatasetTransportError::WrongWindow);
            }
            return Ok(Arc::clone(stream));
        }
        if registry.values().any(|stream| {
            stream.window_label == trusted_window_label
                && stream.key.session_id == session_id
                && stream.key.dataset_id == dataset_id
        }) {
            return Err(DatasetTransportError::StaleGeneration);
        }
        Err(DatasetTransportError::UnknownSession)
    }

    fn close_owned(
        &self,
        trusted_window_label: &str,
        request: &DatasetStreamControlRequest,
        closed: bool,
    ) -> Result<DatasetStreamAck, DatasetTransportError> {
        validate_control_request(request)?;
        let stream = self.lookup(
            trusted_window_label,
            &request.session_id,
            request.generation,
            &request.dataset_id,
        )?;
        let mut registry = self
            .streams
            .lock()
            .map_err(|_| DatasetTransportError::Closed)?;
        let Some(removed) = registry.remove(&stream.key) else {
            return Err(DatasetTransportError::Closed);
        };
        removed.cancelled.store(true, Ordering::Release);
        removed.abort_handle.abort();
        Ok(DatasetStreamAck {
            protocol_version: PROTOCOL_VERSION,
            session_id: request.session_id.clone(),
            generation: request.generation,
            dataset_id: request.dataset_id.clone(),
            closed,
        })
    }
}

async fn send_frame(
    sender: &mpsc::Sender<QueuedFrame>,
    memory: &Arc<Semaphore>,
    cancelled: &Arc<AtomicBool>,
    kind: StreamFrameKind,
    ordinal: Option<u64>,
    payload_bytes: usize,
    make_payload: impl FnOnce() -> Vec<u8>,
) -> bool {
    if cancelled.load(Ordering::Acquire) {
        return false;
    }
    if payload_bytes > MAX_IN_FLIGHT_BYTES {
        return false;
    }
    let channel_permit = match sender.reserve().await {
        Ok(permit) => permit,
        Err(_) => return false,
    };
    let memory_permit = if payload_bytes == 0 {
        None
    } else {
        let Ok(bytes) = u32::try_from(payload_bytes) else {
            return false;
        };
        match Arc::clone(memory).acquire_many_owned(bytes).await {
            Ok(permit) => Some(permit),
            Err(_) => return false,
        }
    };
    if cancelled.load(Ordering::Acquire) {
        return false;
    }
    let payload = make_payload();
    if payload.len() != payload_bytes {
        return false;
    }
    channel_permit.send(QueuedFrame {
        kind,
        ordinal,
        payload,
        _memory_permit: memory_permit,
    });
    true
}

fn validate_open_request(request: &DatasetStreamOpenRequest) -> Result<(), DatasetTransportError> {
    if request.protocol_version != PROTOCOL_VERSION
        || !valid_session_id(&request.session_id)
        || !valid_dataset_identity(&request.dataset_id)
        || request.generation == 0
        || request.generation > MAX_SAFE_INTEGER
    {
        return Err(DatasetTransportError::InvalidRequest);
    }
    Ok(())
}

fn derive_host_record_count(manifest: &[u8]) -> Result<u64, DatasetTransportError> {
    let value: Value =
        serde_json::from_slice(manifest).map_err(|_| DatasetTransportError::InvalidRequest)?;
    let count = value
        .pointer("/aggregates/normalizedRecordCount")
        .or_else(|| value.pointer("/aggregates/eventCount"))
        .or_else(|| value.get("recordCount"))
        .and_then(Value::as_u64)
        .ok_or(DatasetTransportError::InvalidRequest)?;
    if count == 0 || count > MAX_RECORD_COUNT {
        return Err(DatasetTransportError::InvalidRequest);
    }
    Ok(count)
}

fn validate_read_request(request: &DatasetStreamReadRequest) -> Result<(), DatasetTransportError> {
    if request.protocol_version != PROTOCOL_VERSION
        || !valid_session_id(&request.session_id)
        || !valid_dataset_identity(&request.dataset_id)
        || request.generation == 0
        || request.generation > MAX_SAFE_INTEGER
    {
        return Err(DatasetTransportError::InvalidRequest);
    }
    match request.kind.as_str() {
        "manifest" => {
            if request.ordinal.is_some() || request.expected_bytes.is_some() {
                return Err(DatasetTransportError::InvalidRequest);
            }
        }
        "chunk" => {
            let Some(ordinal) = request.ordinal else {
                return Err(DatasetTransportError::InvalidRequest);
            };
            let Some(expected_bytes) = request.expected_bytes else {
                return Err(DatasetTransportError::InvalidRequest);
            };
            if ordinal == 0
                || ordinal > MAX_CHUNK_COUNT as u64
                || expected_bytes == 0
                || expected_bytes > MAX_CHUNK_BYTES as u64
                || expected_bytes > MAX_SAFE_INTEGER
            {
                return Err(DatasetTransportError::LimitExceeded);
            }
        }
        _ => return Err(DatasetTransportError::InvalidRequest),
    }
    Ok(())
}

fn validate_control_request(
    request: &DatasetStreamControlRequest,
) -> Result<(), DatasetTransportError> {
    if request.protocol_version != PROTOCOL_VERSION
        || !valid_session_id(&request.session_id)
        || !valid_dataset_identity(&request.dataset_id)
        || request.generation == 0
        || request.generation > MAX_SAFE_INTEGER
    {
        return Err(DatasetTransportError::InvalidRequest);
    }
    Ok(())
}

#[tauri::command]
pub fn open_dataset_stream(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, DatasetTransportState>,
    request: DatasetStreamOpenRequest,
) -> Result<DatasetStreamOpened, DatasetTransportError> {
    state.open(window.label(), request)
}

#[tauri::command]
pub async fn receive_dataset_chunk(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, DatasetTransportState>,
    request: DatasetStreamReadRequest,
) -> Result<Vec<u8>, DatasetTransportError> {
    state.receive(window.label(), request).await
}

#[tauri::command]
pub async fn complete_dataset_stream(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, DatasetTransportState>,
    request: DatasetStreamControlRequest,
) -> Result<DatasetStreamAck, DatasetTransportError> {
    state.complete(window.label(), request).await
}

#[tauri::command]
pub fn cancel_dataset_stream(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, DatasetTransportState>,
    request: DatasetStreamControlRequest,
) -> Result<DatasetStreamAck, DatasetTransportError> {
    state.cancel(window.label(), request)
}

#[tauri::command]
pub fn close_dataset_stream(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, DatasetTransportState>,
    request: DatasetStreamControlRequest,
) -> Result<DatasetStreamAck, DatasetTransportError> {
    state.close(window.label(), request)
}

#[cfg(test)]
mod tests {
    use super::*;

    const SESSION: &str = "ses_00000000000000000000000000000001";
    const DATASET: &str = "dat_00000000000000000000000000000001";

    fn request(
        kind: &str,
        ordinal: Option<u64>,
        expected_bytes: Option<u64>,
    ) -> DatasetTransportRequest {
        DatasetTransportRequest {
            protocol_version: PROTOCOL_VERSION.to_string(),
            session_id: SESSION.to_string(),
            generation: 1,
            kind: kind.to_string(),
            ordinal,
            expected_bytes,
        }
    }

    fn make_transport() -> BoundedDatasetTransport {
        let mut transport = BoundedDatasetTransport::default();
        transport
            .register_owned(DatasetRegistration {
                window_label: "main".to_string(),
                session_id: SESSION.to_string(),
                generation: 1,
                dataset_identity: DATASET.to_string(),
                record_count: 3,
                manifest: b"manifest\n".to_vec(),
                chunks: vec![b"one\n".to_vec(), b"two\n".to_vec()],
            })
            .unwrap();
        transport
    }

    #[test]
    fn normal_multi_chunk_read_is_strict_and_releases_bytes() {
        let mut transport = make_transport();
        assert_eq!(
            transport.read("main", &request("manifest", None, None)),
            Ok(b"manifest\n".to_vec())
        );
        assert_eq!(
            transport.read("main", &request("chunk", Some(1), Some(4))),
            Ok(b"one\n".to_vec())
        );
        assert_eq!(
            transport.read("main", &request("chunk", Some(2), Some(4))),
            Ok(b"two\n".to_vec())
        );
        assert_eq!(transport.active_memory_bytes(), 0);
        transport.complete("main", SESSION, 1).unwrap();
        assert_eq!(
            transport.complete("main", SESSION, 1),
            Err(DatasetTransportError::DuplicateCompletion)
        );
    }

    #[test]
    fn ordering_duplicate_stale_wrong_window_and_path_requests_fail_closed() {
        let mut transport = make_transport();
        assert_eq!(
            transport.read("main", &request("chunk", Some(2), Some(4))),
            Err(DatasetTransportError::OrderingViolation)
        );
        assert_eq!(
            transport.read("main", &request("manifest", None, None)),
            Ok(b"manifest\n".to_vec())
        );
        assert_eq!(
            transport.read("main", &request("chunk", Some(1), Some(4))),
            Ok(b"one\n".to_vec())
        );
        assert_eq!(
            transport.read("main", &request("chunk", Some(1), Some(4))),
            Err(DatasetTransportError::DuplicateOrdinal)
        );
        assert_eq!(
            transport.read("other", &request("chunk", Some(2), Some(4))),
            Err(DatasetTransportError::WrongWindow)
        );
        let mut stale = request("chunk", Some(2), Some(4));
        stale.generation = 2;
        assert_eq!(
            transport.read("main", &stale),
            Err(DatasetTransportError::StaleGeneration)
        );
        let mut path_like = request("chunk", Some(2), Some(4));
        path_like.kind = "../chunk-0002.ndjson".to_string();
        assert_eq!(
            transport.read("main", &path_like),
            Err(DatasetTransportError::InvalidRequest)
        );
    }

    #[test]
    fn limits_boundary_and_backpressure_are_enforced() {
        let mut transport = BoundedDatasetTransport::default();
        transport
            .register_owned(DatasetRegistration {
                window_label: "main".to_string(),
                session_id: SESSION.to_string(),
                generation: 1,
                dataset_identity: DATASET.to_string(),
                record_count: MAX_RECORD_COUNT,
                manifest: vec![b'x'; MAX_MANIFEST_BYTES],
                chunks: vec![vec![b'x'; MAX_CHUNK_BYTES]],
            })
            .unwrap();
        assert!(transport
            .try_enqueue_for_test("main", vec![0; MAX_IN_FLIGHT_BYTES / 2])
            .is_ok());
        assert!(transport
            .try_enqueue_for_test("main", vec![0; MAX_IN_FLIGHT_BYTES / 2])
            .is_ok());
        assert_eq!(
            transport.try_enqueue_for_test("main", vec![0]),
            Err(DatasetTransportError::Backpressure)
        );
        assert_eq!(
            transport.consume_for_test("main").unwrap().len(),
            MAX_IN_FLIGHT_BYTES / 2
        );
        assert!(transport.try_enqueue_for_test("main", vec![0]).is_ok());
        let mut too_many_records = BoundedDatasetTransport::default();
        assert_eq!(
            too_many_records.register_owned(DatasetRegistration {
                window_label: "main".to_string(),
                session_id: SESSION.to_string(),
                generation: 1,
                dataset_identity: DATASET.to_string(),
                record_count: MAX_RECORD_COUNT + 1,
                manifest: b"x".to_vec(),
                chunks: vec![b"x".to_vec()],
            },),
            Err(DatasetTransportError::InvalidRequest)
        );
    }

    #[test]
    fn dataset_and_chunk_count_limits_reject_without_large_allocations() {
        assert_eq!(
            validate_dataset_limits(1, std::iter::repeat_n(1usize, MAX_CHUNK_COUNT + 1), 1,),
            Err(DatasetTransportError::InvalidRequest)
        );
        assert_eq!(
            validate_dataset_limits(1, std::iter::repeat_n(MAX_CHUNK_BYTES, MAX_CHUNK_COUNT), 1,),
            Err(DatasetTransportError::LimitExceeded)
        );
    }

    #[test]
    fn cancel_close_and_disconnect_delete_the_registry_entry() {
        let mut transport = make_transport();
        assert!(transport.active_dataset_identity().is_some());
        transport.cancel("main", SESSION, 1).unwrap();
        assert_eq!(transport.active_memory_bytes(), 0);
        assert_eq!(transport.active_record_count(), None);
        let mut next = make_transport();
        assert!(next.receiver_disconnected("main"));
        assert!(!next.close_window("main"));
    }

    fn open_request(generation: u64) -> DatasetStreamOpenRequest {
        DatasetStreamOpenRequest {
            protocol_version: PROTOCOL_VERSION.to_string(),
            session_id: SESSION.to_string(),
            generation,
            dataset_id: DATASET.to_string(),
        }
    }

    fn register_host_dataset(state: &DatasetTransportState, generation: u64) {
        let capability = state
            .register_host_dataset(
                "main",
                generation,
                b"{\"recordCount\":3}\n".to_vec(),
                vec![b"aaaa".to_vec(), b"bbbb".to_vec()],
            )
            .unwrap();
        assert_eq!(capability.session_id, SESSION);
        assert_eq!(capability.dataset_id, DATASET);
        assert_eq!(capability.record_count, 3);
        assert_eq!(capability.chunk_count, 2);
        assert_eq!(capability.chunk_bytes, 4);
    }

    fn stream_read(
        kind: &str,
        ordinal: Option<u64>,
        expected_bytes: Option<u64>,
    ) -> DatasetStreamReadRequest {
        DatasetStreamReadRequest {
            protocol_version: PROTOCOL_VERSION.to_string(),
            session_id: SESSION.to_string(),
            generation: 1,
            dataset_id: DATASET.to_string(),
            kind: kind.to_string(),
            ordinal,
            expected_bytes,
        }
    }

    fn stream_control() -> DatasetStreamControlRequest {
        DatasetStreamControlRequest {
            protocol_version: PROTOCOL_VERSION.to_string(),
            session_id: SESSION.to_string(),
            generation: 1,
            dataset_id: DATASET.to_string(),
        }
    }

    #[test]
    fn real_async_stream_is_ordered_and_channel_bounded() {
        tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap()
            .block_on(async {
                let state = DatasetTransportState::default();
                register_host_dataset(&state, 1);
                state.mark_sidecar_verified();
                let opened = state.open("main", open_request(1)).unwrap();
                assert_eq!(opened.chunk_count, 2);
                tokio::task::yield_now().await;
                let stream = state
                    .lookup("main", SESSION, 1, DATASET)
                    .expect("registered stream");
                assert_eq!(stream.receiver.lock().await.len(), CHANNEL_CAPACITY);

                let manifest = state
                    .receive("main", stream_read("manifest", None, None))
                    .await
                    .unwrap();
                assert_eq!(manifest, b"{\"recordCount\":3}\n");
                let first = state
                    .receive("main", stream_read("chunk", Some(1), Some(4)))
                    .await
                    .unwrap();
                let second = state
                    .receive("main", stream_read("chunk", Some(2), Some(4)))
                    .await
                    .unwrap();
                assert_eq!(first, b"aaaa");
                assert_eq!(second, b"bbbb");
                assert!(state.complete("main", stream_control()).await.is_ok());
                assert_eq!(
                    state.complete("main", stream_control()).await,
                    Err(DatasetTransportError::DuplicateCompletion)
                );
            });
    }

    #[test]
    fn real_async_stream_fails_closed_for_capability_races_and_reload() {
        tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap()
            .block_on(async {
                let state = DatasetTransportState::default();
                register_host_dataset(&state, 1);
                state.mark_sidecar_verified();
                state.open("main", open_request(1)).unwrap();
                let mut stale = stream_read("manifest", None, None);
                stale.generation = 2;
                assert_eq!(
                    state.receive("main", stale).await,
                    Err(DatasetTransportError::StaleGeneration)
                );
                assert_eq!(
                    state
                        .receive("other", stream_read("manifest", None, None))
                        .await,
                    Err(DatasetTransportError::WrongWindow)
                );
                let mut wrong_dataset = stream_read("manifest", None, None);
                wrong_dataset.dataset_id = "dat_00000000000000000000000000000002".to_string();
                assert_eq!(
                    state.receive("main", wrong_dataset).await,
                    Err(DatasetTransportError::UnknownSession)
                );
                assert_eq!(state.active_count(), 1);
                assert_eq!(state.close_window("main"), 1);
                assert_eq!(state.active_count(), 0);
                assert_eq!(
                    state
                        .receive("main", stream_read("manifest", None, None))
                        .await,
                    Err(DatasetTransportError::UnknownSession)
                );
            });
    }

    #[test]
    fn verified_dataset_can_be_reopened_after_worker_restart_until_session_close() {
        tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap()
            .block_on(async {
                let state = DatasetTransportState::default();
                register_host_dataset(&state, 1);
                state.mark_sidecar_verified();
                state.open("main", open_request(1)).unwrap();
                state.close("main", stream_control()).unwrap();

                let reopened = state.open("main", open_request(1)).unwrap();
                assert_eq!(reopened.chunk_count, 2);
                let manifest = state
                    .receive("main", stream_read("manifest", None, None))
                    .await
                    .unwrap();
                assert_eq!(manifest, b"{\"recordCount\":3}\n");
                state.close("main", stream_control()).unwrap();

                assert_eq!(state.close_session("main", SESSION, 1), 1);
                assert_eq!(
                    state.open("main", open_request(1)),
                    Err(DatasetTransportError::UnknownSession)
                );
            });
    }

    #[test]
    fn host_registry_mints_opaque_capability_and_rejects_renderer_metadata() {
        tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap()
            .block_on(async {
                let state = DatasetTransportState::default();
                let capability = state
                    .register_host_dataset(
                        "main",
                        1,
                        b"{\"recordCount\":1}\n".to_vec(),
                        vec![b"synthetic\n".to_vec()],
                    )
                    .unwrap();
                assert!(valid_session_id(&capability.session_id));
                assert!(valid_dataset_identity(&capability.dataset_id));
                assert_eq!(capability.record_count, 1);
                assert_eq!(capability.chunk_count, 1);

                let renderer_request = serde_json::json!({
                    "protocolVersion": PROTOCOL_VERSION,
                    "sessionId": capability.session_id,
                    "generation": 1,
                    "datasetId": capability.dataset_id,
                    "recordCount": 999,
                    "chunkCount": 999,
                    "chunkBytes": 999
                });
                assert!(
                    serde_json::from_value::<DatasetStreamOpenRequest>(renderer_request).is_err()
                );
                state.mark_sidecar_verified();
                let opened = state
                    .open(
                        "main",
                        DatasetStreamOpenRequest {
                            protocol_version: PROTOCOL_VERSION.to_string(),
                            session_id: capability.session_id.clone(),
                            generation: capability.generation,
                            dataset_id: capability.dataset_id.clone(),
                        },
                    )
                    .unwrap();
                assert_eq!(opened.record_count, 1);
                assert_eq!(opened.chunk_count, 1);
                assert_eq!(opened.chunk_bytes, b"synthetic\n".len() as u64);
            });
    }

    #[test]
    fn source_open_requires_the_host_sidecar_gate() {
        tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap()
            .block_on(async {
                let state = DatasetTransportState::default();
                register_host_dataset(&state, 1);
                assert_eq!(
                    state.open("main", open_request(1)),
                    Err(DatasetTransportError::InvalidRequest)
                );
                state.mark_sidecar_verified();
                assert!(state.open("main", open_request(1)).is_ok());
            });
    }
}
