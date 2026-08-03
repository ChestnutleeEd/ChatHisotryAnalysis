//! Host-owned aggregate export and atomic native save.

use std::fmt;
use std::path::{Path, PathBuf};
use std::sync::mpsc;

use crate::analytics_results::ResultRegistry;
use crate::analytics_results::ResultRegistryError;
use crate::export_schema::{ApprovedChartKey, PrivacySafeExportSnapshot, MAX_EXPORT_BYTES};
use crate::secure_storage::{
    SecureStorage, StorageErrorCode, MAX_EXPORT_BYTES as STORAGE_MAX_EXPORT_BYTES,
};

pub const MAX_PNG_BYTES: usize = 25 * 1024 * 1024;
pub const PNG_LOGICAL_WIDTH: usize = 800;
pub const PNG_LOGICAL_HEIGHT: usize = 450;
pub const PNG_PIXEL_RATIO: usize = 2;
pub const PNG_WIDTH: usize = PNG_LOGICAL_WIDTH * PNG_PIXEL_RATIO;
pub const PNG_HEIGHT: usize = PNG_LOGICAL_HEIGHT * PNG_PIXEL_RATIO;
pub const DEFAULT_EXPORT_NAMES: [&str; 3] = [
    "chat-analysis-export.png",
    "chat-analysis-export.csv",
    "chat-analysis-export.json",
];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ExportFormat {
    Png,
    Csv,
    Json,
}

impl ExportFormat {
    pub fn parse(value: &str) -> Option<Self> {
        Some(match value {
            "png" => Self::Png,
            "csv" => Self::Csv,
            "json" => Self::Json,
            _ => return None,
        })
    }

    pub const fn extension(self) -> &'static str {
        match self {
            Self::Png => "png",
            Self::Csv => "csv",
            Self::Json => "json",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ExportErrorCode {
    Busy,
    ResultPending,
    StaleResult,
    SchemaInvalid,
    LimitExceeded,
    RenderFailed,
    PermissionDenied,
    DiskFull,
    WriteFailed,
    FlushFailed,
    DurabilityUncertain,
    RenameFailed,
    CleanupRequired,
    Cancelled,
    DialogUnavailable,
    ResultNotFound,
}

impl ExportErrorCode {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Busy => "EXPORT_BUSY",
            Self::ResultPending => "EXPORT_RESULT_PENDING",
            Self::StaleResult => "EXPORT_STALE_RESULT",
            Self::SchemaInvalid => "EXPORT_SCHEMA_INVALID",
            Self::LimitExceeded => "EXPORT_LIMIT_EXCEEDED",
            Self::RenderFailed => "EXPORT_RENDER_FAILED",
            Self::PermissionDenied => "EXPORT_PERMISSION_DENIED",
            Self::DiskFull => "EXPORT_DISK_FULL",
            Self::WriteFailed => "EXPORT_WRITE_FAILED",
            Self::FlushFailed => "EXPORT_FLUSH_FAILED",
            Self::DurabilityUncertain => "EXPORT_DURABILITY_UNCERTAIN",
            Self::RenameFailed => "EXPORT_RENAME_FAILED",
            Self::CleanupRequired => "EXPORT_CLEANUP_REQUIRED",
            Self::Cancelled => "EXPORT_CANCELLED",
            Self::DialogUnavailable => "EXPORT_DIALOG_UNAVAILABLE",
            Self::ResultNotFound => "EXPORT_RESULT_NOT_FOUND",
        }
    }
}

impl fmt::Display for ExportErrorCode {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(self.as_str())
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ExportError {
    pub code: ExportErrorCode,
}

impl ExportError {
    const fn new(code: ExportErrorCode) -> Self {
        Self { code }
    }
}

impl fmt::Display for ExportError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.code.fmt(formatter)
    }
}

impl std::error::Error for ExportError {}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ExportOutcome {
    Saved,
    Cancelled,
}

pub fn render_current_chart_png(
    snapshot: &PrivacySafeExportSnapshot,
    chart_key: ApprovedChartKey,
) -> Result<Vec<u8>, ExportError> {
    snapshot
        .validate()
        .map_err(|_| ExportError::new(ExportErrorCode::SchemaInvalid))?;
    let chart_points = points_for_chart(snapshot, chart_key);
    let points = chart_points.as_slice();
    let max = points
        .iter()
        .map(|point| point.value as f64)
        .fold(1.0f64, f64::max);
    let bar_color = match chart_key {
        ApprovedChartKey::Trends => [75, 104, 86, 255],
        ApprovedChartKey::SenderComparison => [72, 96, 128, 255],
        ApprovedChartKey::Hour => [130, 96, 72, 255],
        ApprovedChartKey::Weekday => [105, 88, 128, 255],
        ApprovedChartKey::MessageTypes => [75, 119, 112, 255],
        ApprovedChartKey::ReplyBins => [128, 96, 112, 255],
        ApprovedChartKey::InitiatorCounts => [96, 112, 72, 255],
    };
    let mut pixels = vec![0u8; PNG_WIDTH * PNG_HEIGHT * 4];
    for pixel in pixels.chunks_exact_mut(4) {
        pixel.copy_from_slice(&[247, 248, 245, 255]);
    }
    // A packaged, opaque chart surface.  Bars are aggregate values only; no
    // DOM, screenshot, font, path, or source content crosses the host side.
    let chart_left = 80usize;
    let chart_right = PNG_WIDTH.saturating_sub(80);
    let chart_top = 96usize;
    let chart_bottom = PNG_HEIGHT.saturating_sub(96);
    let chart_width = chart_right.saturating_sub(chart_left);
    let chart_height = chart_bottom.saturating_sub(chart_top);
    for point_index in 0..points.len() {
        let point = &points[point_index];
        let count = points.len().max(1);
        let slot = chart_width / count;
        let x0 = chart_left + point_index.saturating_mul(slot) + slot / 8;
        let x1 = (chart_left + (point_index + 1).saturating_mul(slot) - slot / 8).min(chart_right);
        let ratio = ((point.value as f64) / max).clamp(0.0, 1.0);
        let height = (ratio * chart_height as f64).round() as usize;
        let y0 = chart_bottom.saturating_sub(height);
        fill_rect(&mut pixels, x0, y0, x1.max(x0 + 1), chart_bottom, bar_color);
    }
    // The footer is a fixed host-rendered glyph layout.  It contains only
    // approved filter enums, dates, metric definition, and methodology id.
    fill_rect(
        &mut pixels,
        0,
        PNG_HEIGHT.saturating_sub(96),
        PNG_WIDTH,
        PNG_HEIGHT,
        [226, 231, 222, 255],
    );
    let footer = snapshot.footer_context(chart_key);
    let lines = [
        format!("UTC+08:00  {}..{}", footer.start_date, footer.end_date),
        format!(
            "SENDER={}  THRESHOLD={}H  CHART={}",
            footer.sender, footer.threshold_hours, footer.chart_key
        ),
        format!(
            "METRIC={}  METHOD=AGGREGATE-V1",
            footer.metric_definition_version
        ),
    ];
    for (line_index, line) in lines.iter().enumerate() {
        draw_fixed_text(
            &mut pixels,
            24,
            PNG_HEIGHT.saturating_sub(88) + line_index * 28,
            line,
            3,
            [43, 54, 45, 255],
        );
    }

    let mut bytes = Vec::new();
    let mut encoder = png::Encoder::new(&mut bytes, PNG_WIDTH as u32, PNG_HEIGHT as u32);
    encoder.set_color(png::ColorType::Rgba);
    encoder.set_depth(png::BitDepth::Eight);
    let mut writer = encoder
        .write_header()
        .map_err(|_| ExportError::new(ExportErrorCode::RenderFailed))?;
    writer
        .write_image_data(&pixels)
        .map_err(|_| ExportError::new(ExportErrorCode::RenderFailed))?;
    drop(writer);
    if bytes.len() > MAX_PNG_BYTES {
        return Err(ExportError::new(ExportErrorCode::LimitExceeded));
    }
    Ok(bytes)
}

fn points_for_chart(
    snapshot: &PrivacySafeExportSnapshot,
    chart_key: ApprovedChartKey,
) -> Vec<crate::export_schema::ChartPoint> {
    snapshot.chart_points(chart_key)
}

fn fill_rect(
    pixels: &mut [u8],
    left: usize,
    top: usize,
    right: usize,
    bottom: usize,
    color: [u8; 4],
) {
    let left = left.min(PNG_WIDTH);
    let right = right.min(PNG_WIDTH);
    let top = top.min(PNG_HEIGHT);
    let bottom = bottom.min(PNG_HEIGHT);
    for y in top..bottom {
        for x in left..right {
            let offset = (y * PNG_WIDTH + x) * 4;
            pixels[offset..offset + 4].copy_from_slice(&color);
        }
    }
}

fn draw_fixed_text(
    pixels: &mut [u8],
    left: usize,
    top: usize,
    text: &str,
    scale: usize,
    color: [u8; 4],
) {
    let mut x = left;
    for character in text.chars() {
        let glyph = fixed_glyph(character);
        for (row, bits) in glyph.iter().enumerate() {
            for column in 0..5 {
                if bits & (1 << (4 - column)) != 0 {
                    fill_rect(
                        pixels,
                        x + column * scale,
                        top + row * scale,
                        x + (column + 1) * scale,
                        top + (row + 1) * scale,
                        color,
                    );
                }
            }
        }
        x = x.saturating_add(6 * scale);
        if x >= PNG_WIDTH.saturating_sub(6 * scale) {
            break;
        }
    }
}

fn fixed_glyph(character: char) -> [u8; 7] {
    match character.to_ascii_uppercase() {
        '0' => [
            0b01110, 0b10001, 0b10011, 0b10101, 0b11001, 0b10001, 0b01110,
        ],
        '1' => [
            0b00100, 0b01100, 0b00100, 0b00100, 0b00100, 0b00100, 0b01110,
        ],
        '2' => [
            0b01110, 0b10001, 0b00001, 0b00010, 0b00100, 0b01000, 0b11111,
        ],
        '3' => [
            0b11110, 0b00001, 0b00001, 0b01110, 0b00001, 0b00001, 0b11110,
        ],
        '4' => [
            0b00010, 0b00110, 0b01010, 0b10010, 0b11111, 0b00010, 0b00010,
        ],
        '5' => [
            0b11111, 0b10000, 0b10000, 0b11110, 0b00001, 0b00001, 0b11110,
        ],
        '6' => [
            0b00110, 0b01000, 0b10000, 0b11110, 0b10001, 0b10001, 0b01110,
        ],
        '7' => [
            0b11111, 0b00001, 0b00010, 0b00100, 0b01000, 0b01000, 0b01000,
        ],
        '8' => [
            0b01110, 0b10001, 0b10001, 0b01110, 0b10001, 0b10001, 0b01110,
        ],
        '9' => [
            0b01110, 0b10001, 0b10001, 0b01111, 0b00001, 0b00010, 0b11100,
        ],
        'A' => [
            0b01110, 0b10001, 0b10001, 0b11111, 0b10001, 0b10001, 0b10001,
        ],
        'B' => [
            0b11110, 0b10001, 0b10001, 0b11110, 0b10001, 0b10001, 0b11110,
        ],
        'C' => [
            0b01110, 0b10001, 0b10000, 0b10000, 0b10000, 0b10001, 0b01110,
        ],
        'D' => [
            0b11110, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b11110,
        ],
        'E' => [
            0b11111, 0b10000, 0b10000, 0b11110, 0b10000, 0b10000, 0b11111,
        ],
        'F' => [
            0b11111, 0b10000, 0b10000, 0b11110, 0b10000, 0b10000, 0b10000,
        ],
        'G' => [
            0b01110, 0b10001, 0b10000, 0b10111, 0b10001, 0b10001, 0b01110,
        ],
        'H' => [
            0b10001, 0b10001, 0b10001, 0b11111, 0b10001, 0b10001, 0b10001,
        ],
        'I' => [
            0b11111, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b11111,
        ],
        'J' => [
            0b00111, 0b00010, 0b00010, 0b00010, 0b10010, 0b10010, 0b01100,
        ],
        'K' => [
            0b10001, 0b10010, 0b10100, 0b11000, 0b10100, 0b10010, 0b10001,
        ],
        'L' => [
            0b10000, 0b10000, 0b10000, 0b10000, 0b10000, 0b10000, 0b11111,
        ],
        'M' => [
            0b10001, 0b11011, 0b10101, 0b10101, 0b10001, 0b10001, 0b10001,
        ],
        'N' => [
            0b10001, 0b11001, 0b10101, 0b10011, 0b10001, 0b10001, 0b10001,
        ],
        'O' => [
            0b01110, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b01110,
        ],
        'P' => [
            0b11110, 0b10001, 0b10001, 0b11110, 0b10000, 0b10000, 0b10000,
        ],
        'Q' => [
            0b01110, 0b10001, 0b10001, 0b10001, 0b10101, 0b10010, 0b01101,
        ],
        'R' => [
            0b11110, 0b10001, 0b10001, 0b11110, 0b10100, 0b10010, 0b10001,
        ],
        'S' => [
            0b01111, 0b10000, 0b10000, 0b01110, 0b00001, 0b00001, 0b11110,
        ],
        'T' => [
            0b11111, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100,
        ],
        'U' => [
            0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b01110,
        ],
        'V' => [
            0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b01010, 0b00100,
        ],
        'W' => [
            0b10001, 0b10001, 0b10001, 0b10101, 0b10101, 0b11011, 0b10001,
        ],
        'X' => [
            0b10001, 0b10001, 0b01010, 0b00100, 0b01010, 0b10001, 0b10001,
        ],
        'Y' => [
            0b10001, 0b10001, 0b01010, 0b00100, 0b00100, 0b00100, 0b00100,
        ],
        'Z' => [
            0b11111, 0b00001, 0b00010, 0b00100, 0b01000, 0b10000, 0b11111,
        ],
        ':' => [0, 0b00100, 0b00100, 0, 0b00100, 0b00100, 0],
        '-' => [0, 0, 0, 0b11111, 0, 0, 0],
        '.' => [0, 0, 0, 0, 0, 0b00110, 0b00110],
        '=' => [0, 0b11111, 0, 0b11111, 0, 0, 0],
        '+' => [0, 0b00100, 0b00100, 0b11111, 0b00100, 0b00100, 0],
        '/' => [0b00001, 0b00010, 0b00100, 0b01000, 0b10000, 0, 0],
        '|' => [
            0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100,
        ],
        _ => [0, 0, 0, 0, 0, 0, 0],
    }
}

pub fn bytes_for_format(
    snapshot: &PrivacySafeExportSnapshot,
    format: ExportFormat,
    chart_key: ApprovedChartKey,
) -> Result<Vec<u8>, ExportError> {
    match format {
        ExportFormat::Png => render_current_chart_png(snapshot, chart_key),
        ExportFormat::Csv => snapshot.to_csv_bytes().map_err(export_schema_error),
        ExportFormat::Json => snapshot.to_json_bytes().map_err(export_schema_error),
    }
}

fn export_schema_error(code: &'static str) -> ExportError {
    ExportError::new(match code {
        "EXPORT_LIMIT_EXCEEDED" => ExportErrorCode::LimitExceeded,
        _ => ExportErrorCode::SchemaInvalid,
    })
}

/// Pure host save seam used by integration tests and the native command.  A
/// native dialog has already confirmed `overwrite_confirmed`; the renderer
/// cannot pass a path or overwrite flag into this function.
pub fn save_to_destination(
    destination: &Path,
    bytes: &[u8],
    overwrite_confirmed: bool,
) -> Result<(), ExportError> {
    save_to_destination_fenced(destination, bytes, overwrite_confirmed, || Ok(()))
}

pub fn save_to_destination_fenced<F>(
    destination: &Path,
    bytes: &[u8],
    overwrite_confirmed: bool,
    mut fence: F,
) -> Result<(), ExportError>
where
    F: FnMut() -> Result<(), ExportError>,
{
    if bytes.len() > MAX_EXPORT_BYTES.max(STORAGE_MAX_EXPORT_BYTES) {
        return Err(ExportError::new(ExportErrorCode::LimitExceeded));
    }
    SecureStorage::atomic_write_destination_fenced(destination, bytes, overwrite_confirmed, || {
        fence().map_err(|error| {
            if error.code == ExportErrorCode::StaleResult {
                StorageErrorCode::LeaseRevoked
            } else {
                StorageErrorCode::CleanupRequired
            }
        })
    })
    .map_err(|error| {
        if error.secondary == Some(StorageErrorCode::CleanupRequired) {
            return ExportError::new(ExportErrorCode::CleanupRequired);
        }
        match error.code {
            StorageErrorCode::PermissionDenied | StorageErrorCode::OwnerMismatch => {
                ExportError::new(ExportErrorCode::PermissionDenied)
            }
            StorageErrorCode::DiskSpaceInsufficient => ExportError::new(ExportErrorCode::DiskFull),
            StorageErrorCode::FlushFailed => ExportError::new(ExportErrorCode::FlushFailed),
            StorageErrorCode::DurabilityUncertain => {
                ExportError::new(ExportErrorCode::DurabilityUncertain)
            }
            StorageErrorCode::RenameFailed => ExportError::new(ExportErrorCode::RenameFailed),
            StorageErrorCode::LeaseRevoked => ExportError::new(ExportErrorCode::StaleResult),
            StorageErrorCode::CleanupRequired => ExportError::new(ExportErrorCode::CleanupRequired),
            _ => ExportError::new(ExportErrorCode::WriteFailed),
        }
    })
}

/// Native save flow.  The result registry is host-owned and the destination
/// is obtained from a platform-native save panel, never from renderer data.
pub fn export_registered_result(
    window: &tauri::WebviewWindow,
    registry: &ResultRegistry,
    session_id: &str,
    generation: u64,
    result_id: &str,
    format: ExportFormat,
    chart_key: ApprovedChartKey,
) -> Result<ExportOutcome, ExportError> {
    let lease = registry
        .begin_export(window.label(), session_id, generation, result_id)
        .map_err(map_result_error)?;
    lease.revalidate().map_err(map_result_error)?;
    let bytes = bytes_for_format(lease.snapshot(), format, chart_key)?;
    lease.revalidate().map_err(map_result_error)?;
    let Some(destination) = choose_native_destination(window, format)? else {
        return Ok(ExportOutcome::Cancelled);
    };
    // The registry lock is held for the final lease check, parent descriptor
    // validation, temp identity check, and rename.  A concurrent commit or
    // cleanup therefore cannot revoke this operation between validation and
    // publication.
    let saved = registry
        .with_critical_section(&lease, || save_to_destination(&destination, &bytes, true))
        .map_err(map_result_error)?;
    saved?;
    Ok(ExportOutcome::Saved)
}

fn map_result_error(error: ResultRegistryError) -> ExportError {
    ExportError::new(match error {
        ResultRegistryError::Busy => ExportErrorCode::Busy,
        ResultRegistryError::Pending => ExportErrorCode::ResultPending,
        ResultRegistryError::Stale => ExportErrorCode::StaleResult,
        ResultRegistryError::SchemaInvalid => ExportErrorCode::SchemaInvalid,
        ResultRegistryError::LimitExceeded => ExportErrorCode::LimitExceeded,
        ResultRegistryError::NotFound => ExportErrorCode::ResultNotFound,
        ResultRegistryError::InvalidState | ResultRegistryError::RandomUnavailable => {
            ExportErrorCode::WriteFailed
        }
    })
}

fn choose_native_destination(
    window: &tauri::WebviewWindow,
    format: ExportFormat,
) -> Result<Option<PathBuf>, ExportError> {
    #[cfg(target_os = "macos")]
    {
        let (sender, receiver) = mpsc::sync_channel(1);
        let default_name = DEFAULT_EXPORT_NAMES[match format {
            ExportFormat::Png => 0,
            ExportFormat::Csv => 1,
            ExportFormat::Json => 2,
        }]
        .to_string();
        window
            .run_on_main_thread(move || {
                let _ = sender.send(show_macos_save_panel(&default_name));
            })
            .map_err(|_| ExportError::new(ExportErrorCode::DialogUnavailable))?;
        receiver
            .recv()
            .map_err(|_| ExportError::new(ExportErrorCode::DialogUnavailable))?
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (window, format);
        Err(ExportError::new(ExportErrorCode::DialogUnavailable))
    }
}

#[cfg(target_os = "macos")]
fn show_macos_save_panel(default_name: &str) -> Result<Option<PathBuf>, ExportError> {
    use objc2::MainThreadMarker;
    use objc2_app_kit::{NSModalResponseOK, NSSavePanel};
    use objc2_foundation::NSString;

    let marker =
        MainThreadMarker::new().ok_or(ExportError::new(ExportErrorCode::DialogUnavailable))?;
    let panel = NSSavePanel::savePanel(marker);
    panel.setCanCreateDirectories(false);
    panel.setNameFieldStringValue(&NSString::from_str(default_name));
    if panel.runModal() != NSModalResponseOK {
        return Ok(None);
    }
    let url = panel
        .URL()
        .ok_or(ExportError::new(ExportErrorCode::DialogUnavailable))?;
    let path = url
        .path()
        .ok_or(ExportError::new(ExportErrorCode::DialogUnavailable))?;
    Ok(Some(PathBuf::from(path.to_string())))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::export_schema::PrivacySafeExportSnapshot;
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn current_chart_png_is_fixed_size_and_opaque() {
        let snapshot =
            PrivacySafeExportSnapshot::from_dataset(4, "2025-01-01", "2025-01-02").unwrap();
        let bytes = render_current_chart_png(&snapshot, ApprovedChartKey::Trends).unwrap();
        assert!(bytes.starts_with(b"\x89PNG\r\n\x1a\n"));
        assert!(bytes.len() < MAX_PNG_BYTES);
        assert!(!bytes.windows(4).any(|window| window == b"tEXt"));
    }

    #[test]
    fn save_flow_is_atomic_and_cleans_exact_destination() {
        let root = std::env::temp_dir().join(format!(
            "chat-analysis-export-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir(&root).unwrap();
        let destination = root.join("chat-analysis-export.json");
        save_to_destination(&destination, b"synthetic\n", false).unwrap();
        assert_eq!(fs::read(&destination).unwrap(), b"synthetic\n");
        let temporary = fs::read_dir(&root)
            .unwrap()
            .map(|entry| entry.unwrap().file_name())
            .filter(|name| name.to_string_lossy().contains(".tmp"))
            .count();
        assert_eq!(temporary, 0);
        fs::remove_file(destination).unwrap();
        fs::remove_dir(root).unwrap();
    }

    #[test]
    fn revoked_save_fence_preserves_existing_destination_and_temp_free_state() {
        for fence_failure in 1..=4u8 {
            let root = std::env::temp_dir().join(format!(
                "chat-analysis-export-fence-{}-{}",
                SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap()
                    .as_nanos(),
                fence_failure
            ));
            fs::create_dir(&root).unwrap();
            let destination = root.join("chat-analysis-export.json");
            save_to_destination(&destination, b"old\n", false).unwrap();

            let mut fence_calls = 0u8;
            let error = save_to_destination_fenced(&destination, b"new\n", true, || {
                fence_calls += 1;
                if fence_calls == fence_failure {
                    Err(ExportError::new(ExportErrorCode::StaleResult))
                } else {
                    Ok(())
                }
            })
            .unwrap_err();

            assert_eq!(error.code, ExportErrorCode::StaleResult);
            assert_eq!(fs::read(&destination).unwrap(), b"old\n");
            assert_eq!(
                fs::read_dir(&root)
                    .unwrap()
                    .map(|entry| entry.unwrap().file_name())
                    .filter(|name| name.to_string_lossy().contains(".tmp"))
                    .count(),
                0
            );
            fs::remove_file(destination).unwrap();
            fs::remove_dir(root).unwrap();
        }
    }
}
