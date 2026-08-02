//! Native, metadata-only source selection for the desktop workflow.
//!
//! The renderer receives only an opaque selection identifier and source
//! counts.  The selected paths stay in this host-owned registry until a
//! supervised session consumes them.

use std::collections::HashSet;
use std::fmt;
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::sync::mpsc;

use tauri::WebviewWindow;

pub const MAX_SELECTED_SOURCES: usize = 20;
const JSON_EXTENSION: &str = "json";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SourceRole {
    Annual,
    Verification,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SelectionErrorCode {
    NoSourceSelected,
    SourceCountExceeded,
    UnsupportedFileType,
    SourceUnreadable,
    DuplicateSource,
    DialogUnavailable,
    SelectionStale,
    InvalidSelection,
}

impl SelectionErrorCode {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::NoSourceSelected => "NO_SOURCE_SELECTED",
            Self::SourceCountExceeded => "SOURCE_COUNT_EXCEEDED",
            Self::UnsupportedFileType => "UNSUPPORTED_FILE_TYPE",
            Self::SourceUnreadable => "SOURCE_UNREADABLE",
            Self::DuplicateSource => "DUPLICATE_SOURCE",
            Self::DialogUnavailable => "DIALOG_UNAVAILABLE",
            Self::SelectionStale => "SELECTION_STALE",
            Self::InvalidSelection => "SOURCE_SET_INVALID",
        }
    }
}

impl fmt::Display for SelectionErrorCode {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(self.as_str())
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SelectionError {
    pub code: SelectionErrorCode,
}

impl SelectionError {
    const fn new(code: SelectionErrorCode) -> Self {
        Self { code }
    }
}

impl fmt::Display for SelectionError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.code.fmt(formatter)
    }
}

impl std::error::Error for SelectionError {}

#[derive(Clone)]
pub struct SelectionRecord {
    selection_id: String,
    annual_sources: Vec<PathBuf>,
    verification_sources: Vec<PathBuf>,
}

impl fmt::Debug for SelectionRecord {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("SelectionRecord")
            .field("selection_id", &self.selection_id)
            .field("annual_source_count", &self.annual_sources.len())
            .field(
                "verification_source_count",
                &self.verification_sources.len(),
            )
            .finish()
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SelectionSummary {
    pub selection_id: String,
    pub annual_source_count: u64,
    pub verification_source_count: u64,
}

impl SelectionRecord {
    pub fn summary(&self) -> SelectionSummary {
        SelectionSummary {
            selection_id: self.selection_id.clone(),
            annual_source_count: self.annual_sources.len() as u64,
            verification_source_count: self.verification_sources.len() as u64,
        }
    }

    pub fn selection_id(&self) -> &str {
        &self.selection_id
    }

    pub fn annual_sources(&self) -> &[PathBuf] {
        &self.annual_sources
    }

    pub fn verification_sources(&self) -> &[PathBuf] {
        &self.verification_sources
    }
}

#[derive(Debug, Default)]
pub struct SelectionRegistry {
    current: Option<SelectionRecord>,
}

impl SelectionRegistry {
    pub fn current(&self) -> Option<SelectionRecord> {
        self.current.clone()
    }

    pub fn replace_role(
        &mut self,
        role: SourceRole,
        paths: Vec<PathBuf>,
    ) -> Result<SelectionSummary, SelectionError> {
        let normalized = validate_and_sort_paths(paths)?;
        let mut annual_sources = self
            .current
            .as_ref()
            .map_or_else(Vec::new, |record| record.annual_sources.clone());
        let mut verification_sources = self
            .current
            .as_ref()
            .map_or_else(Vec::new, |record| record.verification_sources.clone());
        match role {
            SourceRole::Annual => annual_sources = normalized,
            SourceRole::Verification => verification_sources = normalized,
        }
        validate_no_cross_role_duplicates(&annual_sources, &verification_sources)?;
        let selection_id = opaque_selection_id()
            .map_err(|_| SelectionError::new(SelectionErrorCode::InvalidSelection))?;
        let record = SelectionRecord {
            selection_id,
            annual_sources,
            verification_sources,
        };
        let summary = record.summary();
        self.current = Some(record);
        Ok(summary)
    }

    pub fn clear(&mut self) {
        self.current = None;
    }

    #[cfg(test)]
    pub fn replace_for_test(
        &mut self,
        annual_sources: Vec<PathBuf>,
        verification_sources: Vec<PathBuf>,
    ) -> Result<SelectionSummary, SelectionError> {
        let annual = validate_and_sort_paths(annual_sources)?;
        let verification = validate_and_sort_paths(verification_sources)?;
        validate_no_cross_role_duplicates(&annual, &verification)?;
        let record = SelectionRecord {
            selection_id: opaque_selection_id()
                .map_err(|_| SelectionError::new(SelectionErrorCode::InvalidSelection))?,
            annual_sources: annual,
            verification_sources: verification,
        };
        let summary = record.summary();
        self.current = Some(record);
        Ok(summary)
    }
}

/// Return `None` when the user cancels the native panel.  Cancellation is a
/// normal no-op and must not create a session or a private destination.
pub fn choose_sources(
    window: &WebviewWindow,
    role: SourceRole,
) -> Result<Option<Vec<PathBuf>>, SelectionError> {
    let _ = role;
    #[cfg(target_os = "macos")]
    {
        let (sender, receiver) = mpsc::sync_channel(1);
        window
            .run_on_main_thread(move || {
                let _ = sender.send(show_macos_panel());
            })
            .map_err(|_| SelectionError::new(SelectionErrorCode::DialogUnavailable))?;
        return receiver
            .recv()
            .map_err(|_| SelectionError::new(SelectionErrorCode::DialogUnavailable))?;
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = window;
        Err(SelectionError::new(SelectionErrorCode::DialogUnavailable))
    }
}

#[cfg(target_os = "macos")]
fn show_macos_panel() -> Result<Option<Vec<PathBuf>>, SelectionError> {
    use objc2::MainThreadMarker;
    use objc2_app_kit::{NSModalResponseOK, NSOpenPanel};

    let marker = MainThreadMarker::new()
        .ok_or_else(|| SelectionError::new(SelectionErrorCode::DialogUnavailable))?;
    let panel = NSOpenPanel::openPanel(marker);
    panel.setCanChooseFiles(true);
    panel.setCanChooseDirectories(false);
    panel.setAllowsMultipleSelection(true);
    panel.setResolvesAliases(false);
    if panel.runModal() != NSModalResponseOK {
        return Ok(None);
    }
    let urls = panel.URLs();
    let mut paths = Vec::with_capacity(urls.count());
    for index in 0..urls.count() {
        let url = urls.objectAtIndex(index);
        let path = url
            .path()
            .ok_or_else(|| SelectionError::new(SelectionErrorCode::SourceUnreadable))?;
        paths.push(PathBuf::from(path.to_string()));
    }
    Ok(Some(paths))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
struct FileIdentity {
    device: u64,
    inode: u64,
}

fn validate_and_sort_paths(mut paths: Vec<PathBuf>) -> Result<Vec<PathBuf>, SelectionError> {
    if paths.is_empty() {
        return Err(SelectionError::new(SelectionErrorCode::NoSourceSelected));
    }
    if paths.len() > MAX_SELECTED_SOURCES {
        return Err(SelectionError::new(SelectionErrorCode::SourceCountExceeded));
    }
    let mut identities = HashSet::with_capacity(paths.len());
    for path in &paths {
        if !path.is_absolute()
            || path
                .components()
                .any(|component| matches!(component, Component::ParentDir | Component::CurDir))
            || !path_has_no_symlink_components(path)
        {
            return Err(SelectionError::new(SelectionErrorCode::InvalidSelection));
        }
        if path
            .extension()
            .and_then(|extension| extension.to_str())
            .is_none_or(|extension| !extension.eq_ignore_ascii_case(JSON_EXTENSION))
        {
            return Err(SelectionError::new(SelectionErrorCode::UnsupportedFileType));
        }
        let metadata = fs::symlink_metadata(path)
            .map_err(|_| SelectionError::new(SelectionErrorCode::SourceUnreadable))?;
        if metadata.file_type().is_symlink() || !metadata.is_file() {
            return Err(SelectionError::new(SelectionErrorCode::SourceUnreadable));
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            if metadata.permissions().mode() & 0o400 == 0 {
                return Err(SelectionError::new(SelectionErrorCode::SourceUnreadable));
            }
        }
        let file = fs::File::open(path)
            .map_err(|_| SelectionError::new(SelectionErrorCode::SourceUnreadable))?;
        drop(file);
        let identity = file_identity(&metadata, path);
        if !identities.insert(identity) {
            return Err(SelectionError::new(SelectionErrorCode::DuplicateSource));
        }
    }
    paths.sort_by(|left, right| left.as_os_str().cmp(right.as_os_str()));
    Ok(paths)
}

fn path_has_no_symlink_components(path: &Path) -> bool {
    let mut current = PathBuf::new();
    for component in path.components() {
        current.push(component);
        match fs::symlink_metadata(&current) {
            Ok(metadata) if metadata.file_type().is_symlink() => {
                #[cfg(target_os = "macos")]
                if current == Path::new("/var")
                    && fs::canonicalize(&current).ok().as_deref() == Some(Path::new("/private/var"))
                {
                    continue;
                }
                return false;
            }
            Ok(_) => {}
            Err(_) => return false,
        }
    }
    true
}

fn validate_no_cross_role_duplicates(
    annual_sources: &[PathBuf],
    verification_sources: &[PathBuf],
) -> Result<(), SelectionError> {
    let annual = annual_sources
        .iter()
        .map(|path| identity_for_path(path))
        .collect::<Result<HashSet<_>, _>>()?;
    for path in verification_sources {
        if annual.contains(&identity_for_path(path)?) {
            return Err(SelectionError::new(SelectionErrorCode::DuplicateSource));
        }
    }
    Ok(())
}

fn identity_for_path(path: &Path) -> Result<FileIdentity, SelectionError> {
    let metadata = fs::symlink_metadata(path)
        .map_err(|_| SelectionError::new(SelectionErrorCode::SourceUnreadable))?;
    Ok(file_identity(&metadata, path))
}

#[cfg(unix)]
fn file_identity(metadata: &fs::Metadata, _path: &Path) -> FileIdentity {
    use std::os::unix::fs::MetadataExt;
    FileIdentity {
        device: metadata.dev(),
        inode: metadata.ino(),
    }
}

#[cfg(not(unix))]
fn file_identity(metadata: &fs::Metadata, path: &Path) -> FileIdentity {
    use std::hash::{Hash, Hasher};
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    path.hash(&mut hasher);
    FileIdentity {
        device: metadata.len(),
        inode: hasher.finish(),
    }
}

fn opaque_selection_id() -> std::io::Result<String> {
    let mut bytes = [0u8; 16];
    #[cfg(unix)]
    {
        use std::io::Read;
        std::fs::File::open("/dev/urandom")?.read_exact(&mut bytes)?;
    }
    #[cfg(not(unix))]
    {
        return Err(std::io::Error::new(
            std::io::ErrorKind::Unsupported,
            "random source unavailable",
        ));
    }
    let mut value = String::from("sel_");
    for byte in bytes {
        value.push_str(&format!("{byte:02x}"));
    }
    Ok(value)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs::File;
    use std::io::Write;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn fixture() -> (PathBuf, PathBuf, PathBuf) {
        let root = std::env::temp_dir().join(format!(
            "chat-history-selection-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("clock")
                .as_nanos()
        ));
        fs::create_dir(&root).expect("root");
        let first = root.join("first.JSON");
        let second = root.join("second.json");
        let unsupported = root.join("third.txt");
        for path in [&first, &second, &unsupported] {
            let mut file = File::create(path).expect("file");
            file.write_all(b"{}").expect("bytes");
        }
        (root, first, second)
    }

    #[test]
    fn selection_rejects_cancel_empty_duplicate_mixed_role_and_unsupported_files() {
        let (root, first, second) = fixture();
        let mut registry = SelectionRegistry::default();
        assert_eq!(
            validate_and_sort_paths(Vec::new()).unwrap_err().code,
            SelectionErrorCode::NoSourceSelected
        );
        assert_eq!(
            registry
                .replace_role(SourceRole::Annual, vec![first.clone(), first.clone()])
                .unwrap_err()
                .code,
            SelectionErrorCode::DuplicateSource
        );
        assert_eq!(
            registry
                .replace_role(SourceRole::Annual, vec![root.join("third.txt")])
                .unwrap_err()
                .code,
            SelectionErrorCode::UnsupportedFileType
        );
        registry
            .replace_role(SourceRole::Annual, vec![first.clone()])
            .expect("annual");
        assert_eq!(
            registry
                .replace_role(SourceRole::Verification, vec![first.clone()])
                .unwrap_err()
                .code,
            SelectionErrorCode::DuplicateSource
        );
        let summary = registry
            .replace_role(SourceRole::Verification, vec![second.clone()])
            .expect("verification");
        assert_eq!(summary.annual_source_count, 1);
        assert_eq!(summary.verification_source_count, 1);
        assert!(
            format!("{:?}", registry.current().expect("record")).contains("annual_source_count")
        );
        fs::remove_file(first).expect("remove first");
        fs::remove_file(second).expect("remove second");
        fs::remove_file(root.join("third.txt")).expect("remove unsupported");
        fs::remove_dir(root).expect("remove root");
    }

    #[test]
    fn selection_order_is_deterministic_and_paths_stay_out_of_debug() {
        let (root, first, second) = fixture();
        let mut registry = SelectionRegistry::default();
        registry
            .replace_role(SourceRole::Annual, vec![second.clone(), first.clone()])
            .expect("selection");
        let record = registry.current().expect("record");
        assert_eq!(record.annual_sources(), &[first.clone(), second.clone()]);
        let debug = format!("{record:?}");
        assert!(!debug.contains(root.to_string_lossy().as_ref()));
        fs::remove_file(first).expect("remove first");
        fs::remove_file(second).expect("remove second");
        fs::remove_file(root.join("third.txt")).expect("remove unsupported");
        fs::remove_dir(root).expect("remove root");
    }
}
