//! Native PNG save authority for the beta annual recap presentation.
//!
//! This module is deliberately separate from the aggregate export DTO.  The
//! renderer sends one top-level raw byte body and an opaque, short-lived lease
//! header.  The host validates the complete PNG before it opens the native
//! save panel, and the destination never crosses the IPC boundary.

use std::collections::HashMap;
use std::io::Cursor;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::ipc::{InvokeBody, Request};

use crate::export::{ExportErrorCode, ExportFormat};
use crate::ipc::{FailureCode, IpcCoreState, IpcError, MAX_SAFE_INTEGER};

pub const PRESENTATION_SAVE_PROTOCOL_VERSION: &str =
    "chat-history-analysis.presentation-png-save.v1";
pub const PRESENTATION_SAVE_PURPOSE: &str = "presentation-png";
pub const PRESENTATION_LEASE_HEADER: &str = "x-chat-analysis-export-lease";
pub const PRESENTATION_LEASE_PREFIX: &str = "lease_";
pub const PRESENTATION_LEASE_TTL_MILLIS: u64 = 60 * 1_000;
pub const PRESENTATION_PNG_SCHEMA_VERSION: &str = "chat-history-analysis.share-card-view-model.v1";
pub const PRESENTATION_RENDERER_VERSION: &str = "chat-history-analysis.share-card-renderer.v1";
pub const PRESENTATION_PNG_WIDTH: u32 = 1_200;
pub const PRESENTATION_PNG_HEIGHT: u32 = 1_500;
pub const PRESENTATION_MAX_PNG_BYTES: usize = 10 * 1024 * 1024;
const PRESENTATION_MAX_DECODE_BYTES: usize = 16 * 1024 * 1024;

const PNG_SIGNATURE: [u8; 8] = [137, 80, 78, 71, 13, 10, 26, 10];
const FORBIDDEN_PNG_CHUNKS: [&[u8; 4]; 5] = [b"tEXt", b"zTXt", b"iTXt", b"eXIf", b"iCCP"];

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PreparePresentationPngRequest {
    pub protocol_version: String,
    pub purpose: String,
    pub schema_version: String,
    pub session_id: String,
    pub generation: u64,
    pub result_id: String,
    pub view_model_digest: String,
    pub renderer_version: String,
    pub width: u32,
    pub height: u32,
    pub suggested_filename: String,
}

impl PreparePresentationPngRequest {
    fn validate(&self) -> Result<(), FailureCode> {
        if self.protocol_version != PRESENTATION_SAVE_PROTOCOL_VERSION
            || self.purpose != PRESENTATION_SAVE_PURPOSE
            || self.schema_version != PRESENTATION_PNG_SCHEMA_VERSION
            || self.renderer_version != PRESENTATION_RENDERER_VERSION
            || self.width != PRESENTATION_PNG_WIDTH
            || self.height != PRESENTATION_PNG_HEIGHT
            || self.generation == 0
            || self.generation > MAX_SAFE_INTEGER
            || !valid_opaque_id(&self.session_id, "ses_")
            || !valid_opaque_id(&self.result_id, "res_")
            || !valid_hex(&self.view_model_digest, 64)
            || !valid_suggested_filename(&self.suggested_filename)
        {
            return Err(FailureCode::ExportSchemaInvalid);
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CancelPresentationPngRequest {
    lease_id: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PreparePresentationPngAck {
    pub protocol_version: &'static str,
    pub accepted: bool,
    pub lease_id: String,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum PresentationSaveOutcome {
    Saved,
    Cancelled,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PresentationSaveAck {
    pub protocol_version: &'static str,
    pub accepted: bool,
    pub outcome: PresentationSaveOutcome,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct PresentationLease {
    pub(crate) lease_id: String,
    pub(crate) window_label: String,
    pub(crate) session_id: String,
    pub(crate) generation: u64,
    pub(crate) result_id: String,
    pub(crate) schema_version: String,
    pub(crate) view_model_digest: String,
    pub(crate) renderer_version: String,
    pub(crate) width: u32,
    pub(crate) height: u32,
    pub(crate) suggested_filename: String,
    expires_at_millis: u64,
    in_flight: bool,
}

#[derive(Debug, Default)]
struct LeaseInner {
    leases: HashMap<String, PresentationLease>,
}

/// Host-owned, bounded, per-window presentation lease authority.
///
/// A new prepare replaces every older lease for that window.  A save marks a
/// lease in-flight before opening the native panel, so the same bearer cannot
/// be replayed while the panel is open.  Invalidation removes both active and
/// in-flight leases.
#[derive(Clone, Default)]
pub(crate) struct PresentationLeaseRegistry {
    inner: Arc<Mutex<LeaseInner>>,
}

impl std::fmt::Debug for PresentationLeaseRegistry {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let count = self
            .inner
            .lock()
            .map(|inner| inner.leases.len())
            .unwrap_or(0);
        formatter
            .debug_struct("PresentationLeaseRegistry")
            .field("lease_count", &count)
            .finish()
    }
}

impl PresentationLeaseRegistry {
    pub(crate) fn prepare(
        &self,
        window_label: &str,
        request: &PreparePresentationPngRequest,
        now_millis: u64,
    ) -> Result<PresentationLease, FailureCode> {
        request.validate()?;
        let nonce =
            crate::session_supervisor::new_worker_nonce().map_err(|_| FailureCode::InvalidState)?;
        let lease_id = format!(
            "{PRESENTATION_LEASE_PREFIX}{}",
            nonce
                .strip_prefix("nonce_")
                .ok_or(FailureCode::InvalidState)?
        );
        let lease = PresentationLease {
            lease_id: lease_id.clone(),
            window_label: window_label.to_string(),
            session_id: request.session_id.clone(),
            generation: request.generation,
            result_id: request.result_id.clone(),
            schema_version: request.schema_version.clone(),
            view_model_digest: request.view_model_digest.clone(),
            renderer_version: request.renderer_version.clone(),
            width: request.width,
            height: request.height,
            suggested_filename: request.suggested_filename.clone(),
            expires_at_millis: now_millis.saturating_add(PRESENTATION_LEASE_TTL_MILLIS),
            in_flight: false,
        };
        let mut inner = self.inner.lock().map_err(|_| FailureCode::InvalidState)?;
        prune_expired(&mut inner, now_millis);
        inner
            .leases
            .retain(|_, existing| existing.window_label != window_label);
        inner.leases.insert(lease_id, lease.clone());
        Ok(lease)
    }

    pub(crate) fn take_for_save(
        &self,
        window_label: &str,
        lease_id: &str,
        now_millis: u64,
    ) -> Result<PresentationLease, LeaseTakeError> {
        let mut inner = self.inner.lock().map_err(|_| LeaseTakeError::Stale)?;
        prune_expired(&mut inner, now_millis);
        let Some(lease) = inner.leases.get_mut(lease_id) else {
            return Err(LeaseTakeError::Stale);
        };
        if lease.window_label != window_label || lease.expires_at_millis <= now_millis {
            inner.leases.remove(lease_id);
            return Err(LeaseTakeError::Stale);
        }
        if lease.in_flight {
            return Err(LeaseTakeError::Replay);
        }
        lease.in_flight = true;
        Ok(lease.clone())
    }

    pub(crate) fn cancel(
        &self,
        window_label: &str,
        lease_id: &str,
        now_millis: u64,
    ) -> Result<(), LeaseTakeError> {
        let mut inner = self.inner.lock().map_err(|_| LeaseTakeError::Stale)?;
        prune_expired(&mut inner, now_millis);
        let Some(lease) = inner.leases.get(lease_id) else {
            return Err(LeaseTakeError::Stale);
        };
        if lease.window_label != window_label || lease.in_flight {
            return Err(LeaseTakeError::Replay);
        }
        inner.leases.remove(lease_id);
        Ok(())
    }

    pub(crate) fn is_in_flight(&self, window_label: &str, lease_id: &str, now_millis: u64) -> bool {
        let Ok(mut inner) = self.inner.lock() else {
            return false;
        };
        prune_expired(&mut inner, now_millis);
        inner
            .leases
            .get(lease_id)
            .is_some_and(|lease| lease.window_label == window_label && lease.in_flight)
    }

    pub(crate) fn finish(&self, window_label: &str, lease_id: &str) {
        if let Ok(mut inner) = self.inner.lock() {
            if inner
                .leases
                .get(lease_id)
                .is_some_and(|lease| lease.window_label == window_label)
            {
                inner.leases.remove(lease_id);
            }
        }
    }

    pub(crate) fn invalidate_session(&self, window_label: &str, session_id: &str, generation: u64) {
        if let Ok(mut inner) = self.inner.lock() {
            inner.leases.retain(|_, lease| {
                !(lease.window_label == window_label
                    && lease.session_id == session_id
                    && lease.generation == generation)
            });
        }
    }

    pub(crate) fn invalidate_window(&self, window_label: &str) {
        if let Ok(mut inner) = self.inner.lock() {
            inner
                .leases
                .retain(|_, lease| lease.window_label != window_label);
        }
    }

    pub(crate) fn invalidate_all(&self) {
        if let Ok(mut inner) = self.inner.lock() {
            inner.leases.clear();
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum LeaseTakeError {
    Stale,
    Replay,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum PngValidationError {
    LimitExceeded,
    Invalid,
    ForbiddenMetadata,
    Transparent,
}

#[tauri::command]
pub fn prepare_presentation_png(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, IpcCoreState>,
    request: Value,
) -> Result<PreparePresentationPngAck, IpcError> {
    let request: PreparePresentationPngRequest = serde_json::from_value(request)
        .map_err(|_| IpcError::with_code(None, FailureCode::ExportSchemaInvalid))?;
    request
        .validate()
        .map_err(|code| IpcError::with_code(None, code))?;
    if state
        .close_started
        .load(std::sync::atomic::Ordering::Acquire)
    {
        return Err(IpcError::with_code(None, FailureCode::ExportStaleResult));
    }
    state
        .validate_owned_session(window.label(), &request.session_id, request.generation)
        .map_err(|code| IpcError::with_code(None, code))?;
    let _fence = state
        .presentation_save_fence
        .lock()
        .map_err(|_| IpcError::with_code(None, FailureCode::InvalidState))?;
    if state
        .close_started
        .load(std::sync::atomic::Ordering::Acquire)
        || state
            .result_registry()
            .current_result_id(window.label(), &request.session_id, request.generation)
            .as_deref()
            != Some(request.result_id.as_str())
    {
        return Err(IpcError::with_code(None, FailureCode::ExportStaleResult));
    }
    let lease = state
        .presentation_leases
        .prepare(window.label(), &request, now_unix_millis())
        .map_err(|code| IpcError::with_code(None, code))?;
    Ok(PreparePresentationPngAck {
        protocol_version: PRESENTATION_SAVE_PROTOCOL_VERSION,
        accepted: true,
        lease_id: lease.lease_id,
    })
}

#[tauri::command]
pub fn cancel_presentation_png(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, IpcCoreState>,
    request: Value,
) -> Result<PresentationSaveAck, IpcError> {
    let request: CancelPresentationPngRequest = serde_json::from_value(request)
        .map_err(|_| IpcError::with_code(None, FailureCode::ExportSchemaInvalid))?;
    if !valid_lease_id(&request.lease_id) {
        return Err(IpcError::with_code(None, FailureCode::ExportStaleResult));
    }
    let _fence = state
        .presentation_save_fence
        .lock()
        .map_err(|_| IpcError::with_code(None, FailureCode::InvalidState))?;
    state
        .presentation_leases
        .cancel(window.label(), &request.lease_id, now_unix_millis())
        .map_err(|_| IpcError::with_code(None, FailureCode::ExportStaleResult))?;
    Ok(PresentationSaveAck {
        protocol_version: PRESENTATION_SAVE_PROTOCOL_VERSION,
        accepted: true,
        outcome: PresentationSaveOutcome::Cancelled,
    })
}

#[tauri::command]
pub fn save_presentation_png(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, IpcCoreState>,
    request: Request<'_>,
) -> Result<PresentationSaveAck, IpcError> {
    let lease_id = raw_lease_header(&request)
        .map_err(|_| IpcError::with_code(None, FailureCode::ExportStaleResult))?;
    let bytes = raw_body(&request)
        .map_err(|_| IpcError::with_code(None, FailureCode::ExportSchemaInvalid))?;
    let lease = state
        .presentation_leases
        .take_for_save(window.label(), &lease_id, now_unix_millis())
        .map_err(|_| IpcError::with_code(None, FailureCode::ExportStaleResult))?;

    let result = save_presentation_body(&window, state.inner(), &lease, bytes);
    state.presentation_leases.finish(window.label(), &lease_id);
    match result {
        Ok(PresentationSaveOutcome::Saved) => Ok(PresentationSaveAck {
            protocol_version: PRESENTATION_SAVE_PROTOCOL_VERSION,
            accepted: true,
            outcome: PresentationSaveOutcome::Saved,
        }),
        Ok(PresentationSaveOutcome::Cancelled) => Ok(PresentationSaveAck {
            protocol_version: PRESENTATION_SAVE_PROTOCOL_VERSION,
            accepted: true,
            outcome: PresentationSaveOutcome::Cancelled,
        }),
        Err(code) => Err(IpcError::with_code(None, code)),
    }
}

fn save_presentation_body(
    window: &tauri::WebviewWindow,
    state: &IpcCoreState,
    lease: &PresentationLease,
    bytes: &[u8],
) -> Result<PresentationSaveOutcome, FailureCode> {
    validate_presentation_png(bytes, lease.width, lease.height).map_err(map_png_error)?;
    let destination = choose_native_presentation_destination(window, &lease.suggested_filename)
        .map_err(|error| map_export_error(error.code))?;
    let Some(destination) = destination else {
        return Ok(PresentationSaveOutcome::Cancelled);
    };
    if !is_png_destination(&destination) {
        return Err(FailureCode::ExportSchemaInvalid);
    }

    let _fence = state
        .presentation_save_fence
        .lock()
        .map_err(|_| FailureCode::InvalidState)?;
    if state
        .close_started
        .load(std::sync::atomic::Ordering::Acquire)
        || !state.presentation_leases.is_in_flight(
            window.label(),
            &lease.lease_id,
            now_unix_millis(),
        )
        || state
            .validate_owned_session(window.label(), &lease.session_id, lease.generation)
            .is_err()
        || state
            .result_registry()
            .current_result_id(window.label(), &lease.session_id, lease.generation)
            .as_deref()
            != Some(lease.result_id.as_str())
    {
        return Err(FailureCode::ExportStaleResult);
    }
    crate::export::save_to_destination(&destination, bytes, true)
        .map(|()| PresentationSaveOutcome::Saved)
        .map_err(|error| map_export_error(error.code))
}

fn raw_body<'a>(request: &'a Request<'_>) -> Result<&'a [u8], ()> {
    raw_body_value(request.body())
}

fn raw_body_value(body: &InvokeBody) -> Result<&[u8], ()> {
    match body {
        InvokeBody::Raw(bytes) if !bytes.is_empty() => Ok(bytes.as_slice()),
        InvokeBody::Raw(_) | InvokeBody::Json(_) => Err(()),
    }
}

fn raw_lease_header(request: &Request<'_>) -> Result<String, ()> {
    raw_lease_header_value(request.headers())
}

fn raw_lease_header_value(headers: &tauri::http::HeaderMap) -> Result<String, ()> {
    let mut values = headers.get_all(PRESENTATION_LEASE_HEADER).iter();
    let Some(value) = values.next() else {
        return Err(());
    };
    if values.next().is_some() {
        return Err(());
    }
    let value = value.to_str().map_err(|_| ())?;
    if !valid_lease_id(value) {
        return Err(());
    }
    Ok(value.to_string())
}

fn validate_presentation_png(
    bytes: &[u8],
    expected_width: u32,
    expected_height: u32,
) -> Result<(), PngValidationError> {
    if bytes.len() > PRESENTATION_MAX_PNG_BYTES {
        return Err(PngValidationError::LimitExceeded);
    }
    if bytes.len() < PNG_SIGNATURE.len() + 12 || bytes[..PNG_SIGNATURE.len()] != PNG_SIGNATURE {
        return Err(PngValidationError::Invalid);
    }

    let mut offset = PNG_SIGNATURE.len();
    let mut saw_ihdr = false;
    let mut saw_idat = false;
    let mut saw_iend = false;
    let mut color_type = 0u8;
    while offset < bytes.len() {
        if bytes.len().saturating_sub(offset) < 12 {
            return Err(PngValidationError::Invalid);
        }
        let length = u32::from_be_bytes(
            bytes[offset..offset + 4]
                .try_into()
                .map_err(|_| PngValidationError::Invalid)?,
        ) as usize;
        let chunk_end = offset
            .checked_add(12)
            .and_then(|value| value.checked_add(length))
            .ok_or(PngValidationError::Invalid)?;
        if chunk_end > bytes.len() {
            return Err(PngValidationError::Invalid);
        }
        let chunk_type: &[u8; 4] = bytes[offset + 4..offset + 8]
            .try_into()
            .map_err(|_| PngValidationError::Invalid)?;
        if !chunk_type.iter().all(|byte| byte.is_ascii_alphabetic()) {
            return Err(PngValidationError::Invalid);
        }
        let data = &bytes[offset + 8..offset + 8 + length];
        let expected_crc = u32::from_be_bytes(
            bytes[offset + 8 + length..chunk_end]
                .try_into()
                .map_err(|_| PngValidationError::Invalid)?,
        );
        let mut crc_input = Vec::with_capacity(4 + data.len());
        crc_input.extend_from_slice(chunk_type);
        crc_input.extend_from_slice(data);
        if png_crc32(&crc_input) != expected_crc {
            return Err(PngValidationError::Invalid);
        }

        if FORBIDDEN_PNG_CHUNKS
            .iter()
            .any(|forbidden| forbidden == &chunk_type)
        {
            return Err(PngValidationError::ForbiddenMetadata);
        }
        if saw_iend {
            return Err(PngValidationError::Invalid);
        }
        match chunk_type {
            b"IHDR" => {
                if saw_ihdr || offset != PNG_SIGNATURE.len() || data.len() != 13 {
                    return Err(PngValidationError::Invalid);
                }
                let width = u32::from_be_bytes(
                    data[0..4]
                        .try_into()
                        .map_err(|_| PngValidationError::Invalid)?,
                );
                let height = u32::from_be_bytes(
                    data[4..8]
                        .try_into()
                        .map_err(|_| PngValidationError::Invalid)?,
                );
                if width != expected_width
                    || height != expected_height
                    || data[8] != 8
                    || !matches!(data[9], 2 | 6)
                    || data[10] != 0
                    || data[11] != 0
                    || data[12] != 0
                {
                    return Err(PngValidationError::Invalid);
                }
                color_type = data[9];
                saw_ihdr = true;
            }
            b"IDAT" => {
                if !saw_ihdr {
                    return Err(PngValidationError::Invalid);
                }
                saw_idat = true;
            }
            b"IEND" => {
                if !saw_ihdr || !saw_idat || !data.is_empty() || chunk_end != bytes.len() {
                    return Err(PngValidationError::Invalid);
                }
                saw_iend = true;
            }
            _ => {
                if !saw_ihdr {
                    return Err(PngValidationError::Invalid);
                }
            }
        }
        if saw_idat && chunk_type != b"IDAT" && chunk_type != b"IEND" {
            return Err(PngValidationError::Invalid);
        }
        offset = chunk_end;
    }
    if !saw_ihdr || !saw_idat || !saw_iend || !matches!(color_type, 2 | 6) {
        return Err(PngValidationError::Invalid);
    }

    let mut decoder = png::Decoder::new(Cursor::new(bytes));
    decoder.set_limits(png::Limits {
        bytes: PRESENTATION_MAX_DECODE_BYTES,
    });
    let mut reader = decoder
        .read_info()
        .map_err(|_| PngValidationError::Invalid)?;
    let output_size = reader
        .output_buffer_size()
        .ok_or(PngValidationError::Invalid)?;
    if output_size > PRESENTATION_MAX_DECODE_BYTES {
        return Err(PngValidationError::LimitExceeded);
    }
    let mut output = vec![0u8; output_size];
    let info = reader
        .next_frame(&mut output)
        .map_err(|_| PngValidationError::Invalid)?;
    if info.width != expected_width
        || info.height != expected_height
        || info.bit_depth != png::BitDepth::Eight
    {
        return Err(PngValidationError::Invalid);
    }
    match info.color_type {
        png::ColorType::Rgb => {}
        png::ColorType::Rgba => {
            if output[..info.buffer_size()]
                .chunks_exact(4)
                .any(|pixel| pixel[3] != 255)
            {
                return Err(PngValidationError::Transparent);
            }
        }
        _ => return Err(PngValidationError::Invalid),
    }
    Ok(())
}

fn map_png_error(error: PngValidationError) -> FailureCode {
    match error {
        PngValidationError::LimitExceeded => FailureCode::ExportLimitExceeded,
        PngValidationError::Invalid
        | PngValidationError::ForbiddenMetadata
        | PngValidationError::Transparent => FailureCode::ExportSchemaInvalid,
    }
}

fn map_export_error(code: ExportErrorCode) -> FailureCode {
    match code {
        ExportErrorCode::PermissionDenied => FailureCode::ExportPermissionDenied,
        ExportErrorCode::DiskFull => FailureCode::ExportDiskFull,
        ExportErrorCode::WriteFailed => FailureCode::ExportWriteFailed,
        ExportErrorCode::FlushFailed => FailureCode::ExportFlushFailed,
        ExportErrorCode::DurabilityUncertain => FailureCode::ExportDurabilityUncertain,
        ExportErrorCode::RenameFailed => FailureCode::ExportRenameFailed,
        ExportErrorCode::CleanupRequired => FailureCode::ExportCleanupRequired,
        ExportErrorCode::DialogUnavailable => FailureCode::ExportDialogUnavailable,
        ExportErrorCode::LimitExceeded => FailureCode::ExportLimitExceeded,
        ExportErrorCode::SchemaInvalid => FailureCode::ExportSchemaInvalid,
        ExportErrorCode::StaleResult => FailureCode::ExportStaleResult,
        ExportErrorCode::Busy => FailureCode::ExportBusy,
        ExportErrorCode::ResultPending => FailureCode::ExportResultPending,
        ExportErrorCode::RenderFailed => FailureCode::ExportRenderFailed,
        ExportErrorCode::ResultNotFound => FailureCode::ExportResultNotFound,
        ExportErrorCode::Cancelled => FailureCode::ExportStaleResult,
    }
}

fn choose_native_presentation_destination(
    window: &tauri::WebviewWindow,
    default_name: &str,
) -> Result<Option<PathBuf>, crate::export::ExportError> {
    #[cfg(target_os = "macos")]
    {
        let (sender, receiver) = std::sync::mpsc::sync_channel(1);
        let default_name = default_name.to_string();
        window
            .run_on_main_thread(move || {
                let _ = sender.send(show_macos_presentation_save_panel(&default_name));
            })
            .map_err(|_| export_error(ExportErrorCode::DialogUnavailable))?;
        receiver
            .recv()
            .map_err(|_| export_error(ExportErrorCode::DialogUnavailable))?
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (window, default_name);
        Err(export_error(ExportErrorCode::DialogUnavailable))
    }
}

#[cfg(target_os = "macos")]
fn show_macos_presentation_save_panel(
    default_name: &str,
) -> Result<Option<PathBuf>, crate::export::ExportError> {
    use objc2::MainThreadMarker;
    use objc2_app_kit::{NSModalResponseOK, NSSavePanel};
    use objc2_foundation::{NSArray, NSString};

    let marker = MainThreadMarker::new().ok_or(export_error(ExportErrorCode::DialogUnavailable))?;
    let panel = NSSavePanel::savePanel(marker);
    panel.setCanCreateDirectories(false);
    panel.setAllowsOtherFileTypes(false);
    panel.setExtensionHidden(false);
    let png_extension = NSString::from_str(ExportFormat::Png.extension());
    #[allow(deprecated)]
    let allowed_types = NSArray::from_retained_slice(&[png_extension]);
    #[allow(deprecated)]
    panel.setAllowedFileTypes(Some(&allowed_types));
    panel.setNameFieldStringValue(&NSString::from_str(default_name));
    if panel.runModal() != NSModalResponseOK {
        return Ok(None);
    }
    let url = panel
        .URL()
        .ok_or(export_error(ExportErrorCode::DialogUnavailable))?;
    let path = url
        .path()
        .ok_or(export_error(ExportErrorCode::DialogUnavailable))?;
    Ok(Some(PathBuf::from(path.to_string())))
}

fn export_error(code: ExportErrorCode) -> crate::export::ExportError {
    crate::export::ExportError { code }
}

fn is_png_destination(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case(ExportFormat::Png.extension()))
}

fn valid_opaque_id(value: &str, prefix: &str) -> bool {
    value.len() == prefix.len() + 32
        && value.starts_with(prefix)
        && valid_hex(&value[prefix.len()..], 32)
}

fn valid_lease_id(value: &str) -> bool {
    valid_opaque_id(value, PRESENTATION_LEASE_PREFIX)
}

fn valid_hex(value: &str, expected_len: usize) -> bool {
    value.len() == expected_len && value.bytes().all(|byte| byte.is_ascii_hexdigit())
}

fn valid_suggested_filename(value: &str) -> bool {
    let Some(core) = value
        .strip_prefix("chat-recap-")
        .and_then(|value| value.strip_suffix(".png"))
    else {
        return false;
    };
    let parts: Vec<&str> = core.split('-').collect();
    if !(parts.len() == 1 || parts.len() == 2)
        || parts
            .iter()
            .any(|part| part.len() != 4 || !part.bytes().all(|byte| byte.is_ascii_digit()))
    {
        return false;
    }
    if parts.len() == 2 {
        let start = parts[0].parse::<u16>().ok();
        let end = parts[1].parse::<u16>().ok();
        start.zip(end).is_some_and(|(start, end)| start <= end)
    } else {
        true
    }
}

fn prune_expired(inner: &mut LeaseInner, now_millis: u64) {
    inner
        .leases
        .retain(|_, lease| lease.expires_at_millis > now_millis);
}

fn now_unix_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis().min(u128::from(u64::MAX)) as u64)
        .unwrap_or(0)
}

fn png_crc32(bytes: &[u8]) -> u32 {
    let mut crc = 0xffff_ffffu32;
    for byte in bytes {
        crc ^= u32::from(*byte);
        for _ in 0..8 {
            crc = if crc & 1 == 1 {
                (crc >> 1) ^ 0xedb8_8320
            } else {
                crc >> 1
            };
        }
    }
    !crc
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn request() -> PreparePresentationPngRequest {
        PreparePresentationPngRequest {
            protocol_version: PRESENTATION_SAVE_PROTOCOL_VERSION.to_string(),
            purpose: PRESENTATION_SAVE_PURPOSE.to_string(),
            schema_version: PRESENTATION_PNG_SCHEMA_VERSION.to_string(),
            session_id: "ses_0123456789abcdef0123456789abcdef".to_string(),
            generation: 7,
            result_id: "res_0123456789abcdef0123456789abcdef".to_string(),
            view_model_digest: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
                .to_string(),
            renderer_version: PRESENTATION_RENDERER_VERSION.to_string(),
            width: PRESENTATION_PNG_WIDTH,
            height: PRESENTATION_PNG_HEIGHT,
            suggested_filename: "chat-recap-2025.png".to_string(),
        }
    }

    fn synthetic_png(color_type: png::ColorType, alpha: u8) -> Vec<u8> {
        let mut bytes = Vec::new();
        let mut encoder =
            png::Encoder::new(&mut bytes, PRESENTATION_PNG_WIDTH, PRESENTATION_PNG_HEIGHT);
        encoder.set_color(color_type);
        encoder.set_depth(png::BitDepth::Eight);
        let mut writer = encoder.write_header().unwrap();
        let samples = match color_type {
            png::ColorType::Rgb => 3,
            png::ColorType::Rgba => 4,
            _ => panic!("test helper only creates RGB/RGBA"),
        };
        let mut pixels =
            vec![128u8; (PRESENTATION_PNG_WIDTH * PRESENTATION_PNG_HEIGHT) as usize * samples];
        if color_type == png::ColorType::Rgba {
            for pixel in pixels.chunks_exact_mut(4) {
                pixel[3] = alpha;
            }
        }
        writer.write_image_data(&pixels).unwrap();
        drop(writer);
        bytes
    }

    fn append_chunk(output: &mut Vec<u8>, chunk_type: &[u8; 4], data: &[u8]) {
        output.extend_from_slice(&(data.len() as u32).to_be_bytes());
        output.extend_from_slice(chunk_type);
        output.extend_from_slice(data);
        let mut crc_input = Vec::with_capacity(4 + data.len());
        crc_input.extend_from_slice(chunk_type);
        crc_input.extend_from_slice(data);
        output.extend_from_slice(&png_crc32(&crc_input).to_be_bytes());
    }

    fn insert_text_chunk(bytes: &[u8]) -> Vec<u8> {
        let ihdr_end = 8 + 12 + 13;
        let mut result = bytes[..ihdr_end].to_vec();
        append_chunk(&mut result, b"tEXt", b"synthetic\0fixture");
        result.extend_from_slice(&bytes[ihdr_end..]);
        result
    }

    #[test]
    fn lease_is_per_window_single_use_and_replaced() {
        let registry = PresentationLeaseRegistry::default();
        let first = registry.prepare("main", &request(), 1_000).unwrap();
        let second = registry.prepare("main", &request(), 2_000).unwrap();
        assert_ne!(first.lease_id, second.lease_id);
        assert_eq!(
            registry.take_for_save("main", &first.lease_id, 2_000),
            Err(LeaseTakeError::Stale)
        );
        let taken = registry
            .take_for_save("main", &second.lease_id, 2_000)
            .unwrap();
        assert_eq!(taken.result_id, second.result_id);
        assert_eq!(
            registry.take_for_save("main", &second.lease_id, 2_000),
            Err(LeaseTakeError::Replay)
        );
        registry.invalidate_session("main", &taken.session_id, taken.generation);
        assert!(!registry.is_in_flight("main", &taken.lease_id, 2_000));
    }

    #[test]
    fn lease_rejects_wrong_window_and_schema_purpose() {
        let registry = PresentationLeaseRegistry::default();
        let lease = registry.prepare("main", &request(), 1_000).unwrap();
        assert_eq!(
            registry.take_for_save("secondary", &lease.lease_id, 1_000),
            Err(LeaseTakeError::Stale)
        );

        let mut invalid = request();
        invalid.purpose = "generic-write".to_string();
        assert_eq!(
            registry.prepare("main", &invalid, 1_000),
            Err(FailureCode::ExportSchemaInvalid)
        );
    }

    #[test]
    fn lease_expires_and_cancel_only_accepts_active_leases() {
        let registry = PresentationLeaseRegistry::default();
        let lease = registry.prepare("main", &request(), 1_000).unwrap();
        assert_eq!(
            registry.cancel(
                "main",
                &lease.lease_id,
                1_000 + PRESENTATION_LEASE_TTL_MILLIS
            ),
            Err(LeaseTakeError::Stale)
        );
        let active = registry.prepare("main", &request(), 3_000).unwrap();
        assert!(registry.cancel("main", &active.lease_id, 3_000).is_ok());
        assert_eq!(
            registry.cancel("main", &active.lease_id, 3_000),
            Err(LeaseTakeError::Stale)
        );
    }

    #[test]
    fn png_validator_accepts_opaque_rgb_and_rgba_at_exact_dimensions() {
        let rgb = synthetic_png(png::ColorType::Rgb, 255);
        let rgba = synthetic_png(png::ColorType::Rgba, 255);
        assert!(
            validate_presentation_png(&rgb, PRESENTATION_PNG_WIDTH, PRESENTATION_PNG_HEIGHT)
                .is_ok()
        );
        assert!(
            validate_presentation_png(&rgba, PRESENTATION_PNG_WIDTH, PRESENTATION_PNG_HEIGHT)
                .is_ok()
        );
    }

    #[test]
    fn png_validator_rejects_transparency_metadata_crc_and_limits() {
        let transparent = synthetic_png(png::ColorType::Rgba, 0);
        assert_eq!(
            validate_presentation_png(
                &transparent,
                PRESENTATION_PNG_WIDTH,
                PRESENTATION_PNG_HEIGHT
            ),
            Err(PngValidationError::Transparent)
        );
        let text = insert_text_chunk(&synthetic_png(png::ColorType::Rgba, 255));
        assert_eq!(
            validate_presentation_png(&text, PRESENTATION_PNG_WIDTH, PRESENTATION_PNG_HEIGHT),
            Err(PngValidationError::ForbiddenMetadata)
        );
        let mut corrupted = synthetic_png(png::ColorType::Rgb, 255);
        let index = corrupted.len() - 1;
        corrupted[index] ^= 1;
        assert_eq!(
            validate_presentation_png(&corrupted, PRESENTATION_PNG_WIDTH, PRESENTATION_PNG_HEIGHT),
            Err(PngValidationError::Invalid)
        );
        let oversized = vec![0u8; PRESENTATION_MAX_PNG_BYTES + 1];
        assert_eq!(
            validate_presentation_png(&oversized, PRESENTATION_PNG_WIDTH, PRESENTATION_PNG_HEIGHT),
            Err(PngValidationError::LimitExceeded)
        );

        let valid = synthetic_png(png::ColorType::Rgb, 255);
        assert_eq!(
            validate_presentation_png(&[], PRESENTATION_PNG_WIDTH, PRESENTATION_PNG_HEIGHT),
            Err(PngValidationError::Invalid)
        );
        let mut wrong_signature = valid.clone();
        wrong_signature[0] ^= 1;
        assert_eq!(
            validate_presentation_png(
                &wrong_signature,
                PRESENTATION_PNG_WIDTH,
                PRESENTATION_PNG_HEIGHT
            ),
            Err(PngValidationError::Invalid)
        );
        assert_eq!(
            validate_presentation_png(&valid, PRESENTATION_PNG_WIDTH - 1, PRESENTATION_PNG_HEIGHT),
            Err(PngValidationError::Invalid)
        );
    }

    #[test]
    fn filename_policy_is_generic_and_png_only() {
        assert!(valid_suggested_filename("chat-recap-2025.png"));
        assert!(valid_suggested_filename("chat-recap-2024-2025.png"));
        assert!(!valid_suggested_filename("chat-recap-2025-2024.png"));
        assert!(!valid_suggested_filename("chat-recap-private-2025.png"));
        assert!(!valid_suggested_filename("chat-recap-2025.png.png"));
        assert!(is_png_destination(Path::new("/tmp/chat-recap-2025.PNG")));
        assert!(!is_png_destination(Path::new("/tmp/chat-recap-2025.json")));
    }

    #[test]
    fn raw_body_and_ascii_lease_header_contract_is_not_json_or_array_transport() {
        use tauri::http::{HeaderMap, HeaderValue};

        let bytes = vec![137u8, 80, 78, 71];
        let raw = InvokeBody::Raw(bytes.clone());
        assert_eq!(raw_body_value(&raw).unwrap(), bytes.as_slice());
        assert!(raw_body_value(&InvokeBody::Json(Value::Null)).is_err());
        assert!(raw_body_value(&InvokeBody::Raw(Vec::new())).is_err());

        let mut headers = HeaderMap::new();
        headers.insert(
            PRESENTATION_LEASE_HEADER,
            HeaderValue::from_static("lease_0123456789abcdef0123456789abcdef"),
        );
        assert_eq!(
            raw_lease_header_value(&headers).unwrap(),
            "lease_0123456789abcdef0123456789abcdef"
        );
        assert!(raw_lease_header_value(&headers).is_ok());
    }

    #[test]
    fn cancellation_and_native_error_mapping_are_typed_and_content_free() {
        assert_eq!(
            serde_json::to_value(PresentationSaveOutcome::Cancelled).unwrap(),
            Value::String("cancelled".to_string())
        );
        assert_eq!(
            map_export_error(ExportErrorCode::PermissionDenied),
            FailureCode::ExportPermissionDenied
        );
        assert_eq!(
            map_export_error(ExportErrorCode::DiskFull),
            FailureCode::ExportDiskFull
        );
        assert_eq!(
            map_export_error(ExportErrorCode::CleanupRequired),
            FailureCode::ExportCleanupRequired
        );
    }

    #[test]
    fn atomic_presentation_write_has_no_temporary_fixture_files() {
        let root =
            std::env::temp_dir().join(format!("chat-analysis-presentation-{}", now_unix_millis()));
        fs::create_dir(&root).unwrap();
        let destination = root.join("chat-recap-2025.png");
        crate::export::save_to_destination(&destination, b"synthetic-png", true).unwrap();
        assert_eq!(fs::read(&destination).unwrap(), b"synthetic-png");
        assert_eq!(fs::read_dir(&root).unwrap().count(), 1);
        fs::remove_file(&destination).unwrap();
        fs::remove_dir(&root).unwrap();
    }
}
