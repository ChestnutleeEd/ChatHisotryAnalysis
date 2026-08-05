//! Descriptor-relative, allow-listed storage for private desktop sessions and
//! native aggregate exports.
//!
//! The renderer never supplies a path to this module.  Session paths are
//! derived from a host-owned application cache root and export destinations
//! are returned by a native save panel.  On Unix, every privileged operation
//! is rooted in an opened directory descriptor and uses `openat`/`unlinkat`
//! with `O_NOFOLLOW` plus post-open identity checks.  The small path checks
//! that remain are only used to locate the initial trusted parent descriptor;
//! the actual mutation is descriptor-relative.

use std::ffi::{CStr, CString, OsStr};
use std::fmt;
#[cfg(test)]
use std::fs;
use std::fs::File;
use std::io::{self, Read, Write};
use std::path::{Component, Path, PathBuf};
use std::sync::Arc;

use serde::{Deserialize, Serialize};

#[cfg(unix)]
use std::os::fd::{AsRawFd, FromRawFd, OwnedFd, RawFd};

use crate::session_supervisor::{ANALYSIS_SESSIONS_DIRECTORY, SESSION_MARKER_CONTENT};

pub const SESSION_STATE_NAME: &str = "session-state";
pub const OWNER_RECORD_NAME: &str = ".owner-record";
pub const OWNER_RECORD_SCHEMA_VERSION: &str = "chat-history-analysis.owner-record.v1";
pub const NORMALIZED_DIRECTORY_NAME: &str = "normalized";
pub const MAX_SESSION_FILE_BYTES: usize = 536_870_912;
pub const MAX_EXPORT_BYTES: usize = 32 * 1024 * 1024;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OwnerRecord {
    pub schema_version: String,
    pub state_version: String,
    pub pid: u32,
    pub process_group_id: i32,
    pub start_fingerprint: String,
    pub executable_fingerprint: String,
    pub session_id: String,
    pub generation: u64,
    pub nonce: String,
}

impl OwnerRecord {
    pub fn validate(&self, expected_session_id: &str) -> bool {
        self.schema_version == OWNER_RECORD_SCHEMA_VERSION
            && self.state_version == "active.v1"
            && self.pid > 0
            && self.process_group_id > 0
            && self.session_id == expected_session_id
            && valid_session_id(&self.session_id)
            && self.generation > 0
            && self.start_fingerprint.len() <= 128
            && !self.start_fingerprint.is_empty()
            && self
                .start_fingerprint
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b':' | b'.' | b'-'))
            && self.executable_fingerprint.len() == 64
            && self
                .executable_fingerprint
                .bytes()
                .all(|byte| byte.is_ascii_hexdigit())
            && self.nonce.len() == 38
            && self.nonce.starts_with("nonce_")
            && self.nonce[6..].bytes().all(|byte| byte.is_ascii_hexdigit())
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RecoveryDisposition {
    Dead,
    Terminated,
    LiveOwned,
    UnownedLive,
    Unverifiable,
    TerminationFailed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StorageErrorCode {
    RootUnavailable,
    PermissionDenied,
    WriteFailed,
    FlushFailed,
    DurabilityUncertain,
    RenameFailed,
    DiskSpaceInsufficient,
    DatasetHandoffInvalid,
    DatasetTampered,
    CleanupRequired,
    UnsafeEntry,
    OwnerMismatch,
    ModeMismatch,
    TypeMismatch,
    Symlink,
    Traversal,
    LinkCountChanged,
    InodeChanged,
    NotFound,
    InvalidName,
    LeaseRevoked,
}

impl StorageErrorCode {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::RootUnavailable => "STORAGE_ROOT_UNAVAILABLE",
            Self::PermissionDenied => "STORAGE_PERMISSION_DENIED",
            Self::WriteFailed => "STORAGE_WRITE_FAILED",
            Self::FlushFailed => "STORAGE_FLUSH_FAILED",
            Self::DurabilityUncertain => "STORAGE_DURABILITY_UNCERTAIN",
            Self::RenameFailed => "STORAGE_RENAME_FAILED",
            Self::DiskSpaceInsufficient => "DISK_SPACE_INSUFFICIENT",
            Self::DatasetHandoffInvalid => "DATASET_HANDOFF_INVALID",
            Self::DatasetTampered => "DATASET_TAMPERED",
            Self::CleanupRequired => "CLEANUP_REQUIRED",
            Self::UnsafeEntry => "CLEANUP_UNSAFE_ENTRY",
            Self::OwnerMismatch => "CLEANUP_OWNER_MISMATCH",
            Self::ModeMismatch => "CLEANUP_MODE_MISMATCH",
            Self::TypeMismatch => "CLEANUP_TYPE_MISMATCH",
            Self::Symlink => "STORAGE_SYMLINK_REJECTED",
            Self::Traversal => "STORAGE_TRAVERSAL_REJECTED",
            Self::LinkCountChanged => "STORAGE_LINK_COUNT_CHANGED",
            Self::InodeChanged => "STORAGE_INODE_CHANGED",
            Self::NotFound => "STORAGE_NOT_FOUND",
            Self::InvalidName => "STORAGE_INVALID_NAME",
            Self::LeaseRevoked => "EXPORT_LEASE_REVOKED",
        }
    }
}

impl fmt::Display for StorageErrorCode {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(self.as_str())
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct StorageError {
    pub code: StorageErrorCode,
    pub secondary: Option<StorageErrorCode>,
}

impl StorageError {
    const fn new(code: StorageErrorCode) -> Self {
        Self {
            code,
            secondary: None,
        }
    }

    const fn with_secondary(self, secondary: StorageErrorCode) -> Self {
        Self {
            code: self.code,
            secondary: Some(secondary),
        }
    }
}

impl fmt::Display for StorageError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.code.fmt(formatter)
    }
}

impl std::error::Error for StorageError {}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CleanupOutcome {
    Complete { removed_entry_count: u64 },
    Required,
    UnsafeEntry,
    OwnerMismatch,
    ModeMismatch,
    TypeMismatch,
}

impl CleanupOutcome {
    pub const fn code(self) -> &'static str {
        match self {
            Self::Complete { .. } => "CLEANUP_COMPLETE",
            Self::Required => "CLEANUP_REQUIRED",
            Self::UnsafeEntry => "CLEANUP_UNSAFE_ENTRY",
            Self::OwnerMismatch => "CLEANUP_OWNER_MISMATCH",
            Self::ModeMismatch => "CLEANUP_MODE_MISMATCH",
            Self::TypeMismatch => "CLEANUP_TYPE_MISMATCH",
        }
    }

    pub const fn is_complete(self) -> bool {
        matches!(self, Self::Complete { .. })
    }
}

#[derive(Debug, Clone)]
pub struct SecureStorage {
    root: PathBuf,
    #[cfg(unix)]
    root_descriptor: Arc<OwnedFd>,
    #[cfg(unix)]
    root_identity: DirectoryIdentity,
    #[cfg(unix)]
    sessions_descriptor: Arc<OwnedFd>,
    #[cfg(unix)]
    sessions_identity: DirectoryIdentity,
}

impl SecureStorage {
    /// Open an already-created application cache root.  The root itself must
    /// be owner-only; this constructor never creates a privileged parent.
    pub fn new(root: impl Into<PathBuf>) -> Result<Self, StorageError> {
        let root = root.into();
        validate_initial_path(&root)?;
        let descriptor = open_root_descriptor(&root, false)?;
        Self::from_root_descriptor(root, descriptor)
    }

    /// Bootstrap a missing application cache root from its already-existing
    /// fixed parent.  The parent is opened component-by-component first; the
    /// final child is created with `mkdirat`, reopened with `openat`, and
    /// validated before any session descriptor is retained.
    pub fn new_or_create(root: impl Into<PathBuf>) -> Result<Self, StorageError> {
        let root = root.into();
        validate_initial_path(&root)?;
        let descriptor = open_root_descriptor(&root, true)?;
        Self::from_root_descriptor(root, descriptor)
    }

    fn from_root_descriptor(root: PathBuf, descriptor: OwnedFd) -> Result<Self, StorageError> {
        validate_directory_fd(&descriptor).map_err(StorageError::new)?;
        #[cfg(unix)]
        {
            let sessions_name = valid_component(ANALYSIS_SESSIONS_DIRECTORY)?;
            let sessions = match open_directory_at(root_fd(&descriptor), sessions_name) {
                Ok(sessions) => sessions,
                Err(error) if error.code == StorageErrorCode::NotFound => {
                    match mkdir_at(root_fd(&descriptor), sessions_name) {
                        Ok(()) => {}
                        Err(error) if error.code != StorageErrorCode::RenameFailed => {
                            return Err(error);
                        }
                        Err(_) => {}
                    }
                    open_directory_at(root_fd(&descriptor), sessions_name)?
                }
                Err(error) => return Err(error),
            };
            validate_directory_fd(&sessions).map_err(StorageError::new)?;
            let identity = directory_identity(&descriptor).map_err(StorageError::new)?;
            let sessions_identity = directory_identity(&sessions).map_err(StorageError::new)?;
            Ok(Self {
                root,
                root_descriptor: Arc::new(descriptor),
                root_identity: identity,
                sessions_descriptor: Arc::new(sessions),
                sessions_identity,
            })
        }
        #[cfg(not(unix))]
        {
            Ok(Self { root })
        }
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    #[cfg(unix)]
    fn root_descriptor(&self) -> Result<&OwnedFd, StorageError> {
        Ok(self.root_descriptor.as_ref())
    }

    #[cfg(not(unix))]
    fn root_descriptor(&self) -> Result<OwnedFd, StorageError> {
        open_directory(&self.root).map_err(|error| map_open_error(error, true))
    }

    #[cfg(unix)]
    fn sessions_descriptor(&self) -> Result<&OwnedFd, StorageError> {
        Ok(self.sessions_descriptor.as_ref())
    }

    #[cfg(not(unix))]
    fn sessions_descriptor(&self) -> Result<OwnedFd, StorageError> {
        open_directory(&self.root.join(ANALYSIS_SESSIONS_DIRECTORY))
            .map_err(|error| map_open_error(error, false))
    }

    #[cfg(unix)]
    fn validate_root_descriptor(&self, descriptor: &OwnedFd) -> Result<(), StorageError> {
        let current = directory_identity(descriptor).map_err(StorageError::new)?;
        compare_directory_identity(&self.root_identity, &current)
    }

    #[cfg(not(unix))]
    fn validate_root_descriptor(&self, _descriptor: &OwnedFd) -> Result<(), StorageError> {
        Ok(())
    }

    #[cfg(unix)]
    fn validate_sessions_descriptor(&self, descriptor: &OwnedFd) -> Result<(), StorageError> {
        let current = directory_identity(descriptor).map_err(StorageError::new)?;
        compare_directory_identity(&self.sessions_identity, &current)
    }

    #[cfg(not(unix))]
    fn validate_sessions_descriptor(&self, _descriptor: &OwnedFd) -> Result<(), StorageError> {
        Ok(())
    }

    /// Create or open the host-owned `analysis-sessions` directory using the
    /// root descriptor.  Missing roots are a stable storage failure, not an
    /// invitation to create a broad tree.
    #[allow(clippy::needless_borrow)]
    pub fn sessions_root(&self) -> Result<(), StorageError> {
        let root = self.root_descriptor()?;
        self.validate_root_descriptor(&root)?;
        let sessions = self.sessions_descriptor()?;
        self.validate_sessions_descriptor(&sessions)?;
        validate_directory_fd(&sessions).map_err(StorageError::new)
    }

    /// Create one host-owned session through the pinned sessions descriptor.
    /// The normalized child is intentionally left absent: the sidecar's
    /// canonical pipeline preflights that destination as absent and publishes
    /// it with an exclusive staging-to-final rename.  The returned path is
    /// only an opaque, host-owned sidecar configuration value; no mutation
    /// below it uses the path again.
    pub fn create_session(
        &self,
        session_id: &str,
        generation: u64,
    ) -> Result<PathBuf, StorageError> {
        if !valid_session_id(session_id) || generation == 0 {
            return Err(StorageError::new(StorageErrorCode::InvalidName));
        }
        self.sessions_root()?;
        let sessions = self.sessions_descriptor()?;
        let session_name = valid_component(session_id)?;
        mkdir_at(sessions_fd(sessions), session_name)?;
        let session = match open_directory_at(sessions_fd(sessions), session_name) {
            Ok(value) => value,
            Err(error) => {
                let _ = unlink_at(sessions_fd(sessions), session_name, true);
                return Err(error);
            }
        };
        if let Err(error) = validate_directory_fd(&session).map_err(StorageError::new) {
            let _ = unlink_at(sessions_fd(sessions), session_name, true);
            return Err(error);
        }
        if let Err(error) = create_private_file_at(
            directory_fd(&session),
            ".session-marker",
            SESSION_MARKER_CONTENT,
        )
        .and_then(|_| {
            create_private_file_at(
                directory_fd(&session),
                SESSION_STATE_NAME,
                format!("sessionId={session_id}\ngeneration={generation}\n").as_bytes(),
            )
        })
        .and_then(|_| sync_directory(&session))
        .and_then(|_| sync_directory(sessions))
        {
            // This is a bounded rollback of names created by this call.  It
            // does not inspect or recursively remove arbitrary content.
            let _ = unlink_at(directory_fd(&session), SESSION_STATE_NAME, false);
            let _ = unlink_at(directory_fd(&session), ".session-marker", false);
            let _ = unlink_at(sessions_fd(sessions), session_name, true);
            return Err(error);
        }
        Ok(self
            .root
            .join(ANALYSIS_SESSIONS_DIRECTORY)
            .join(session_id)
            .join(NORMALIZED_DIRECTORY_NAME))
    }

    /// Atomically publish the host owner record through the pinned session
    /// descriptor.  The path-based supervisor writer is intentionally not
    /// used for this identity-bearing file.
    pub fn write_owner_record(
        &self,
        session_id: &str,
        record: &OwnerRecord,
    ) -> Result<(), StorageError> {
        if !record.validate(session_id) {
            return Err(StorageError::new(StorageErrorCode::InvalidName));
        }
        self.sessions_root()?;
        let sessions = self.sessions_descriptor()?;
        let session = open_directory_at(sessions_fd(sessions), valid_component(session_id)?)?;
        validate_directory_fd(&session).map_err(StorageError::new)?;
        let mut bytes = serde_json::to_vec(record)
            .map_err(|_| StorageError::new(StorageErrorCode::WriteFailed))?;
        bytes.push(b'\n');
        let temporary_name = temporary_name(".owner-record");
        let temporary = create_temp_file(directory_fd(&session), &temporary_name)?;
        let result = (|| {
            let before = stat_fd(&temporary).map_err(StorageError::new)?;
            let mut file = File::from(temporary);
            file.write_all(&bytes)
                .map_err(|_| StorageError::new(StorageErrorCode::WriteFailed))?;
            file.sync_all()
                .map_err(|_| StorageError::new(StorageErrorCode::FlushFailed))?;
            drop(file);
            let after = stat_at(directory_fd(&session), &temporary_name)?;
            compare_identity(&before, &after)?;
            let previous = stat_at(directory_fd(&session), OWNER_RECORD_NAME).ok();
            if let Some(previous) = previous.as_ref() {
                validate_regular_stat(previous).map_err(StorageError::new)?;
            }
            rename_at(directory_fd(&session), &temporary_name, OWNER_RECORD_NAME)?;
            sync_directory(&session)
        })();
        if let Err(error) = result {
            let _ = unlink_at(directory_fd(&session), &temporary_name, false);
            return Err(error);
        }
        Ok(())
    }

    pub fn list_normalized_entries(&self, session_id: &str) -> Result<Vec<String>, StorageError> {
        let normalized = self.open_normalized_directory(session_id)?;
        let names = read_directory_names(&normalized)?;
        for name in &names {
            let stat = stat_at(directory_fd(&normalized), name)?;
            validate_regular_stat(&stat).map_err(StorageError::new)?;
        }
        Ok(names)
    }

    pub fn read_normalized_entry(
        &self,
        session_id: &str,
        name: &str,
        maximum: usize,
    ) -> Result<Vec<u8>, StorageError> {
        let normalized = self.open_normalized_directory(session_id)?;
        read_bounded_at(directory_fd(&normalized), valid_component(name)?, maximum)
    }

    pub fn read_session_entry(
        &self,
        session_id: &str,
        name: &str,
        maximum: usize,
    ) -> Result<Vec<u8>, StorageError> {
        self.sessions_root()?;
        let sessions = self.sessions_descriptor()?;
        let session = open_directory_at(sessions_fd(sessions), valid_component(session_id)?)?;
        validate_directory_fd(&session).map_err(StorageError::new)?;
        read_bounded_at(directory_fd(&session), valid_component(name)?, maximum)
    }

    fn open_normalized_directory(&self, session_id: &str) -> Result<OwnedFd, StorageError> {
        self.sessions_root()?;
        let sessions = self.sessions_descriptor()?;
        let session = open_directory_at(sessions_fd(sessions), valid_component(session_id)?)?;
        validate_directory_fd(&session).map_err(StorageError::new)?;
        let normalized = open_directory_at(directory_fd(&session), NORMALIZED_DIRECTORY_NAME)?;
        validate_directory_fd(&normalized).map_err(StorageError::new)?;
        Ok(normalized)
    }

    /// Remove one recognized session entry-by-entry.  An unknown or unsafe
    /// object is left untouched and never traversed.
    pub fn cleanup_session(&self, session_id: &str) -> CleanupOutcome {
        let result = self.cleanup_session_inner(session_id);
        match result {
            Ok(outcome) => outcome,
            Err(error) => match error.code {
                StorageErrorCode::OwnerMismatch => CleanupOutcome::OwnerMismatch,
                StorageErrorCode::ModeMismatch => CleanupOutcome::ModeMismatch,
                StorageErrorCode::TypeMismatch => CleanupOutcome::TypeMismatch,
                StorageErrorCode::UnsafeEntry
                | StorageErrorCode::Symlink
                | StorageErrorCode::Traversal
                | StorageErrorCode::LinkCountChanged
                | StorageErrorCode::InodeChanged => CleanupOutcome::UnsafeEntry,
                _ => CleanupOutcome::Required,
            },
        }
    }

    /// Perform startup recovery serially.  Only direct children of the
    /// application-owned sessions root are inspected.
    pub fn recover_startup(&self) -> Result<StartupRecovery, StorageError> {
        self.recover_startup_with(|_| RecoveryDisposition::Dead)
    }

    /// Startup recovery seam with host process-identity arbitration.  The
    /// owner record is read through the already-open session descriptor; a
    /// live or unverifiable owner must explicitly authorize cleanup.
    pub fn recover_startup_with<F>(
        &self,
        mut owner_handler: F,
    ) -> Result<StartupRecovery, StorageError>
    where
        F: FnMut(&OwnerRecord) -> RecoveryDisposition,
    {
        self.sessions_root()?;
        let sessions = self.sessions_descriptor()?;
        self.validate_sessions_descriptor(sessions)?;
        let names = read_directory_names(sessions)?;
        let mut recovery = StartupRecovery::default();
        for name in names {
            if !valid_session_id(&name) {
                recovery.cleanup_required = true;
                continue;
            }
            let entry = match stat_at(sessions_fd(sessions), &name) {
                Ok(stat) => stat,
                Err(_) => {
                    recovery.cleanup_required = true;
                    continue;
                }
            };
            if !is_directory_stat(&entry) {
                recovery.cleanup_required = true;
                continue;
            }
            let session = match open_directory_at(sessions_fd(sessions), &name) {
                Ok(session) => session,
                Err(_) => {
                    recovery.cleanup_required = true;
                    continue;
                }
            };
            match validate_directory_fd(&session).map_err(StorageError::new) {
                Ok(()) => match recognized_session_state_fd(&session, &name) {
                    Ok(true) => {
                        recovery.recognized_session_count += 1;
                        let disposition = match read_owner_record_fd(&session, &name) {
                            Ok(owner) => owner_handler(&owner),
                            Err(error) if error.code == StorageErrorCode::NotFound => {
                                RecoveryDisposition::Dead
                            }
                            Err(_) => RecoveryDisposition::Unverifiable,
                        };
                        if matches!(
                            disposition,
                            RecoveryDisposition::Dead | RecoveryDisposition::Terminated
                        ) {
                            match self.cleanup_session(&name) {
                                CleanupOutcome::Complete { .. } => {
                                    recovery.cleaned_session_count += 1;
                                }
                                _ => recovery.cleanup_required = true,
                            }
                        } else {
                            recovery.cleanup_required = true;
                        }
                    }
                    Ok(false) | Err(_) => recovery.cleanup_required = true,
                },
                Err(_) => recovery.cleanup_required = true,
            }
        }
        Ok(recovery)
    }

    pub fn read_owner_record(&self, session_id: &str) -> Result<OwnerRecord, StorageError> {
        self.sessions_root()?;
        if !valid_session_id(session_id) {
            return Err(StorageError::new(StorageErrorCode::InvalidName));
        }
        let sessions = self.sessions_descriptor()?;
        self.validate_sessions_descriptor(sessions)?;
        let session = open_directory_at(sessions_fd(sessions), valid_component(session_id)?)?;
        validate_directory_fd(&session).map_err(StorageError::new)?;
        read_owner_record_fd(&session, session_id)
    }

    /// Read a bounded regular file after validating identity both before and
    /// after opening it.  This is used by adversarial handoff tests and keeps
    /// path strings out of all public failures.
    pub fn read_verified(&self, path: &Path, maximum: usize) -> Result<Vec<u8>, StorageError> {
        let (parent, name) = open_parent_for_destination(path)?;
        let before = stat_at(parent_fd(&parent), &name)?;
        validate_regular_stat(&before).map_err(StorageError::new)?;
        let file = open_regular_at(parent_fd(&parent), &name)?;
        let after = stat_fd(&file).map_err(StorageError::new)?;
        compare_identity(&before, &after)?;
        if after.st_size < 0 || after.st_size as usize > maximum {
            return Err(StorageError::new(StorageErrorCode::DatasetHandoffInvalid));
        }
        let mut file = File::from(file);
        let mut bytes = Vec::with_capacity(after.st_size as usize);
        file.read_to_end(&mut bytes)
            .map_err(|_| StorageError::new(StorageErrorCode::WriteFailed))?;
        if bytes.len() > maximum {
            return Err(StorageError::new(StorageErrorCode::DatasetHandoffInvalid));
        }
        Ok(bytes)
    }

    /// Write a bounded destination atomically.  The caller must pass the
    /// result of the native confirmation for an existing target; a missing
    /// target never gets overwritten by a race.
    pub fn atomic_write_to_path(
        &self,
        destination: &Path,
        bytes: &[u8],
        overwrite_confirmed: bool,
    ) -> Result<(), StorageError> {
        Self::atomic_write_destination(destination, bytes, overwrite_confirmed)
    }

    /// Descriptor-relative atomic save seam for native export destinations.
    /// The save panel, not the renderer, supplies the destination and the
    /// caller supplies the result of its overwrite confirmation.
    pub fn atomic_write_destination(
        destination: &Path,
        bytes: &[u8],
        overwrite_confirmed: bool,
    ) -> Result<(), StorageError> {
        Self::atomic_write_destination_fenced(destination, bytes, overwrite_confirmed, || Ok(()))
    }

    /// Atomic save with a caller-owned fence.  The fence is checked before
    /// temp creation, write, fsync, and rename.  Cleanup failure is retained
    /// as a secondary error instead of being discarded.
    pub fn atomic_write_destination_fenced<F>(
        destination: &Path,
        bytes: &[u8],
        overwrite_confirmed: bool,
        fence: F,
    ) -> Result<(), StorageError>
    where
        F: FnMut() -> Result<(), StorageErrorCode>,
    {
        Self::atomic_write_destination_fenced_with_parent_sync(
            destination,
            bytes,
            overwrite_confirmed,
            fence,
            sync_directory,
        )
    }

    fn atomic_write_destination_fenced_with_parent_sync<F, S>(
        destination: &Path,
        bytes: &[u8],
        overwrite_confirmed: bool,
        mut fence: F,
        mut parent_sync: S,
    ) -> Result<(), StorageError>
    where
        F: FnMut() -> Result<(), StorageErrorCode>,
        S: FnMut(&OwnedFd) -> Result<(), StorageError>,
    {
        if bytes.len() > MAX_EXPORT_BYTES {
            return Err(StorageError::new(StorageErrorCode::WriteFailed));
        }
        let (parent, name) = open_parent_for_destination(destination)?;
        let existing = match stat_at(parent_fd(&parent), &name) {
            Ok(stat) => {
                validate_regular_stat(&stat).map_err(StorageError::new)?;
                if !overwrite_confirmed {
                    return Err(StorageError::new(StorageErrorCode::RenameFailed));
                }
                Some(stat)
            }
            Err(error) if error.code == StorageErrorCode::NotFound => None,
            Err(error) => return Err(error),
        };

        let temporary_name = temporary_name(".chat-analysis-export");
        fence().map_err(StorageError::new)?;
        let temp = create_temp_file(parent_fd(&parent), &temporary_name)?;
        let temp_identity = stat_fd(&temp).map_err(StorageError::new)?;
        let mut renamed = false;
        let write_result = (|| {
            fence().map_err(StorageError::new)?;
            let mut file = File::from(temp);
            file.write_all(bytes)
                .map_err(|_| StorageError::new(StorageErrorCode::WriteFailed))?;
            fence().map_err(StorageError::new)?;
            file.sync_all()
                .map_err(|_| StorageError::new(StorageErrorCode::FlushFailed))?;
            drop(file);

            let current_temp = stat_at(parent_fd(&parent), &temporary_name)?;
            compare_identity(&temp_identity, &current_temp)?;

            let current = stat_at(parent_fd(&parent), &name);
            match (existing, current) {
                (Some(before), Ok(after)) => compare_identity(&before, &after)?,
                (None, Ok(_)) => {
                    return Err(StorageError::new(StorageErrorCode::RenameFailed));
                }
                (None, Err(error)) if error.code == StorageErrorCode::NotFound => {}
                (_, Err(error)) => return Err(error),
            }
            fence().map_err(StorageError::new)?;
            let current_temp = stat_at(parent_fd(&parent), &temporary_name)?;
            compare_identity(&temp_identity, &current_temp)?;
            rename_at(parent_fd(&parent), &temporary_name, &name)?;
            renamed = true;
            parent_sync(&parent).map_err(|error| {
                StorageError::new(StorageErrorCode::DurabilityUncertain).with_secondary(error.code)
            })?;
            Ok(())
        })();

        if let Err(primary) = write_result {
            if renamed {
                // The final name is already published.  Do not attempt to
                // unlink the old temporary name or report that the
                // destination is absent; the only uncertainty is durability
                // of the parent directory sync.
                return Err(primary);
            }
            return match unlink_at(parent_fd(&parent), &temporary_name, false) {
                Ok(()) => Err(primary),
                Err(_) => Err(primary.with_secondary(StorageErrorCode::CleanupRequired)),
            };
        }
        Ok(())
    }

    fn cleanup_session_inner(&self, session_id: &str) -> Result<CleanupOutcome, StorageError> {
        if !valid_session_id(session_id) {
            return Ok(CleanupOutcome::UnsafeEntry);
        }
        self.sessions_root()?;
        let sessions = self.sessions_descriptor()?;
        self.validate_sessions_descriptor(sessions)?;
        let session = match open_directory_at(sessions_fd(sessions), session_id) {
            Ok(session) => session,
            Err(error) if error.code == StorageErrorCode::NotFound => {
                return Ok(CleanupOutcome::Complete {
                    removed_entry_count: 0,
                });
            }
            Err(error) => return Err(error),
        };
        validate_directory_fd(&session).map_err(StorageError::new)?;
        #[cfg(unix)]
        let session_identity = directory_identity(&session).map_err(StorageError::new)?;
        match recognized_session_state_fd(&session, session_id)? {
            true => {}
            false => return Ok(CleanupOutcome::UnsafeEntry),
        }
        let names = read_directory_names(&session)?;
        for name in &names {
            let stat = stat_at(sessions_fd(&session), name)?;
            if is_directory_stat(&stat) {
                if name == NORMALIZED_DIRECTORY_NAME || is_known_staging_directory(name) {
                    validate_flat_directory(sessions_fd(&session), name)?;
                } else {
                    return Ok(CleanupOutcome::UnsafeEntry);
                }
            } else if is_known_session_file(name) {
                validate_regular_stat(&stat).map_err(StorageError::new)?;
            } else {
                return Ok(CleanupOutcome::UnsafeEntry);
            }
        }
        let mut removed = 0u64;
        for name in &names {
            let stat = stat_at(sessions_fd(&session), name)?;
            if is_directory_stat(&stat) {
                if name == NORMALIZED_DIRECTORY_NAME || is_known_staging_directory(name) {
                    removed += cleanup_flat_directory(sessions_fd(&session), name)?;
                } else {
                    return Ok(CleanupOutcome::UnsafeEntry);
                }
            } else if is_known_session_file(name) {
                validate_regular_stat(&stat).map_err(StorageError::new)?;
                remove_regular_at(sessions_fd(&session), name, &stat)?;
                removed += 1;
            } else {
                return Ok(CleanupOutcome::UnsafeEntry);
            }
        }
        if !read_directory_names(&session)?.is_empty() {
            return Ok(CleanupOutcome::Required);
        }
        #[cfg(unix)]
        {
            let current = stat_at(sessions_fd(sessions), session_id)?;
            if !same_directory_identity(&session_identity, &current) {
                return Err(StorageError::new(StorageErrorCode::InodeChanged));
            }
        }
        unlink_at(sessions_fd(sessions), session_id, true)?;
        sync_directory(sessions)?;
        removed += 1;
        Ok(CleanupOutcome::Complete {
            removed_entry_count: removed,
        })
    }
}

fn validate_flat_directory(parent_fd: RawFd, name: &str) -> Result<(), StorageError> {
    let directory = open_directory_at(parent_fd, valid_component(name)?)?;
    validate_directory_fd(&directory).map_err(StorageError::new)?;
    for child in read_directory_names(&directory)? {
        let stat = stat_at(directory_fd(&directory), &child)?;
        if !is_known_nested_file(&child) || !is_regular_stat(&stat) {
            return Err(StorageError::new(StorageErrorCode::UnsafeEntry));
        }
        validate_regular_stat(&stat).map_err(StorageError::new)?;
    }
    Ok(())
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct StartupRecovery {
    pub recognized_session_count: u64,
    pub cleaned_session_count: u64,
    pub cleanup_required: bool,
}

fn cleanup_flat_directory(parent_fd: RawFd, name: &str) -> Result<u64, StorageError> {
    let directory = open_directory_at(parent_fd, valid_component(name)?)?;
    validate_directory_fd(&directory).map_err(StorageError::new)?;
    #[cfg(unix)]
    let identity = directory_identity(&directory).map_err(StorageError::new)?;
    let names = read_directory_names(&directory)?;
    let mut removed = 0u64;
    for child in names {
        let stat = stat_at(directory_fd(&directory), &child)?;
        if !is_known_nested_file(&child) {
            return Err(StorageError::new(StorageErrorCode::UnsafeEntry));
        }
        if is_directory_stat(&stat) || !is_regular_stat(&stat) {
            return Err(StorageError::new(StorageErrorCode::TypeMismatch));
        }
        validate_regular_stat(&stat).map_err(StorageError::new)?;
        remove_regular_at(directory_fd(&directory), &child, &stat)?;
        removed += 1;
    }
    if !read_directory_names(&directory)?.is_empty() {
        return Err(StorageError::new(StorageErrorCode::CleanupRequired));
    }
    #[cfg(unix)]
    {
        let current = stat_at(parent_fd, name)?;
        if !same_directory_identity(&identity, &current) {
            return Err(StorageError::new(StorageErrorCode::InodeChanged));
        }
    }
    unlink_at(parent_fd, name, true)?;
    Ok(removed + 1)
}

fn recognized_session_state_fd(session: &OwnedFd, session_id: &str) -> Result<bool, StorageError> {
    let marker = read_bounded_at(directory_fd(session), ".session-marker", 128)?;
    if marker != SESSION_MARKER_CONTENT {
        return Ok(false);
    }
    let state = read_bounded_at(directory_fd(session), SESSION_STATE_NAME, 256)?;
    let prefix = format!("sessionId={session_id}\ngeneration=");
    let Ok(state) = std::str::from_utf8(&state) else {
        return Ok(false);
    };
    let suffix = state
        .strip_prefix(&prefix)
        .and_then(|value| value.strip_suffix('\n'));
    Ok(suffix
        .and_then(|value| value.parse::<u64>().ok())
        .is_some_and(|generation| generation > 0))
}

fn read_owner_record_fd(session: &OwnedFd, session_id: &str) -> Result<OwnerRecord, StorageError> {
    let bytes = read_bounded_at(directory_fd(session), OWNER_RECORD_NAME, 1024)?;
    let record = serde_json::from_slice::<OwnerRecord>(&bytes)
        .map_err(|_| StorageError::new(StorageErrorCode::UnsafeEntry))?;
    if record.validate(session_id) {
        Ok(record)
    } else {
        Err(StorageError::new(StorageErrorCode::UnsafeEntry))
    }
}

fn read_bounded_at(parent_fd: RawFd, name: &str, maximum: usize) -> Result<Vec<u8>, StorageError> {
    let stat = stat_at(parent_fd, name)?;
    validate_regular_stat(&stat).map_err(StorageError::new)?;
    let file = open_regular_at(parent_fd, name)?;
    let after = stat_fd(&file).map_err(StorageError::new)?;
    compare_identity(&stat, &after)?;
    if after.st_size < 0 || after.st_size as usize > maximum {
        return Err(StorageError::new(StorageErrorCode::TypeMismatch));
    }
    let mut file = File::from(file);
    let mut bytes = Vec::with_capacity(after.st_size as usize);
    file.read_to_end(&mut bytes)
        .map_err(|_| StorageError::new(StorageErrorCode::WriteFailed))?;
    if bytes.len() > maximum {
        return Err(StorageError::new(StorageErrorCode::TypeMismatch));
    }
    Ok(bytes)
}

fn read_directory_names(directory: &OwnedFd) -> Result<Vec<String>, StorageError> {
    let duplicate = unsafe { libc::dup(directory_fd(directory)) };
    if duplicate < 0 {
        return Err(StorageError::new(StorageErrorCode::CleanupRequired));
    }
    let stream = unsafe { libc::fdopendir(duplicate) };
    if stream.is_null() {
        unsafe { libc::close(duplicate) };
        return Err(StorageError::new(StorageErrorCode::CleanupRequired));
    }
    let mut names = Vec::new();
    loop {
        let entry = unsafe { libc::readdir(stream) };
        if entry.is_null() {
            break;
        }
        let name = unsafe { CStr::from_ptr((*entry).d_name.as_ptr()) }
            .to_str()
            .map_err(|_| StorageError::new(StorageErrorCode::CleanupRequired))?
            .to_string();
        if name != "." && name != ".." {
            names.push(name);
        }
    }
    unsafe { libc::closedir(stream) };
    names.sort();
    Ok(names)
}

fn is_known_nested_file(name: &str) -> bool {
    is_known_session_file(name)
        || matches!(
            name,
            ".staging-events.sqlite3" | ".chathistoryanalysis-private-stage-v2"
        )
}

fn is_known_session_file(name: &str) -> bool {
    matches!(
        name,
        ".session-marker"
            | SESSION_STATE_NAME
            | OWNER_RECORD_NAME
            | "manifest.json"
            | ".canonical-dataset-complete-v2"
            | ".cleanup-required"
    ) || is_known_owner_temporary_file(name)
        || (name.starts_with("chunk-")
            && name.ends_with(".ndjson")
            && name.len() > 6 + ".ndjson".len()
            && name[6..name.len() - ".ndjson".len()]
                .bytes()
                .all(|byte| byte.is_ascii_digit()))
}

fn is_known_owner_temporary_file(name: &str) -> bool {
    const PREFIX: &str = ".owner-record";
    const SUFFIX: &str = ".tmp";
    name.starts_with(PREFIX)
        && name.ends_with(SUFFIX)
        && name.len() == PREFIX.len() + 32 + SUFFIX.len()
        && name[PREFIX.len()..name.len() - SUFFIX.len()]
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
}

fn is_known_staging_directory(name: &str) -> bool {
    const PREFIX: &str = ".chathistoryanalysis-stage-v2-";
    name.starts_with(PREFIX)
        && name.len() == PREFIX.len() + 32
        && name[PREFIX.len()..]
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
}

fn valid_session_id(value: &str) -> bool {
    value.len() == 36
        && value.starts_with("ses_")
        && value[4..]
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
}

fn valid_component(value: &str) -> Result<&str, StorageError> {
    if value.is_empty()
        || value == "."
        || value == ".."
        || value.contains('/')
        || value.contains('\\')
        || value.as_bytes().contains(&0)
    {
        return Err(StorageError::new(StorageErrorCode::InvalidName));
    }
    Ok(value)
}

fn validate_initial_path(path: &Path) -> Result<(), StorageError> {
    if !path.is_absolute()
        || path.to_str().is_none()
        || path
            .components()
            .any(|component| matches!(component, Component::ParentDir | Component::CurDir))
    {
        return Err(StorageError::new(StorageErrorCode::Traversal));
    }
    Ok(())
}

#[cfg(unix)]
fn open_directory_chain(path: &Path) -> io::Result<OwnedFd> {
    let walk_path = {
        #[cfg(target_os = "macos")]
        {
            // macOS exposes /var as the well-known /private/var symlink.  It
            // is safe to translate that OS alias before descriptor walking;
            // arbitrary symlinks are still rejected by every openat below.
            if path.starts_with("/var") {
                Path::new("/private").join(path.strip_prefix("/").unwrap_or(path))
            } else {
                path.to_path_buf()
            }
        }
        #[cfg(not(target_os = "macos"))]
        {
            path.to_path_buf()
        }
    };

    let mut descriptor = open_directory(Path::new("/"))?;
    for component in walk_path.components() {
        let Component::Normal(component) = component else {
            continue;
        };
        let component = component
            .to_str()
            .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "path component"))?;
        descriptor =
            open_directory_at(parent_fd(&descriptor), component).map_err(storage_error_to_io)?;
    }
    Ok(descriptor)
}

#[cfg(unix)]
fn open_root_descriptor(path: &Path, create_if_missing: bool) -> Result<OwnedFd, StorageError> {
    if !create_if_missing {
        return open_directory_chain(path).map_err(|error| map_open_error(error, true));
    }
    let parent = path
        .parent()
        .ok_or_else(|| StorageError::new(StorageErrorCode::RootUnavailable))?;
    let name = path
        .file_name()
        .and_then(OsStr::to_str)
        .ok_or_else(|| StorageError::new(StorageErrorCode::InvalidName))?;
    let name = valid_component(name)?;
    let parent_descriptor =
        open_directory_chain(parent).map_err(|error| map_open_error(error, true))?;
    match open_directory_at(parent_fd(&parent_descriptor), name) {
        Ok(descriptor) => Ok(descriptor),
        Err(error) if error.code == StorageErrorCode::NotFound => {
            match mkdir_at(parent_fd(&parent_descriptor), name) {
                Ok(()) => {}
                Err(error) if error.code != StorageErrorCode::RenameFailed => return Err(error),
                Err(_) => {}
            }
            open_directory_at(parent_fd(&parent_descriptor), name)
        }
        Err(error) => Err(error),
    }
}

#[cfg(not(unix))]
fn open_root_descriptor(path: &Path, create_if_missing: bool) -> Result<OwnedFd, StorageError> {
    let _ = (path, create_if_missing);
    Err(StorageError::new(StorageErrorCode::RootUnavailable))
}

fn open_parent_for_destination(path: &Path) -> Result<(OwnedFd, String), StorageError> {
    if !path.is_absolute()
        || path.to_str().is_none()
        || path
            .components()
            .any(|component| matches!(component, Component::ParentDir | Component::CurDir))
    {
        return Err(StorageError::new(StorageErrorCode::Traversal));
    }
    let name = path
        .file_name()
        .and_then(OsStr::to_str)
        .ok_or_else(|| StorageError::new(StorageErrorCode::InvalidName))?;
    let name = valid_component(name)?.to_string();
    let parent = path
        .parent()
        .ok_or_else(|| StorageError::new(StorageErrorCode::RootUnavailable))?;
    #[cfg(target_os = "macos")]
    let walk_parent = if parent.starts_with("/var") {
        Path::new("/private").join(parent.strip_prefix("/").unwrap_or(parent))
    } else {
        parent.to_path_buf()
    };
    #[cfg(not(target_os = "macos"))]
    let walk_parent = parent.to_path_buf();

    let components = walk_parent
        .components()
        .filter_map(|component| match component {
            Component::Normal(value) => Some(value.to_os_string()),
            Component::RootDir | Component::Prefix(_) => None,
            _ => None,
        })
        .collect::<Vec<_>>();
    let mut descriptor =
        open_directory(Path::new("/")).map_err(|error| map_open_error(error, false))?;
    for (index, component) in components.iter().enumerate() {
        let component = component
            .to_str()
            .ok_or_else(|| StorageError::new(StorageErrorCode::InvalidName))?;
        let next = open_directory_at(parent_fd(&descriptor), valid_component(component)?)?;
        if index + 1 == components.len() {
            validate_destination_directory_fd(&next).map_err(StorageError::new)?;
        }
        descriptor = next;
    }
    Ok((descriptor, name))
}

#[cfg(unix)]
fn open_directory(path: &Path) -> io::Result<OwnedFd> {
    let path = CString::new(path.to_string_lossy().as_bytes())
        .map_err(|_| io::Error::new(io::ErrorKind::InvalidInput, "path"))?;
    let fd = unsafe {
        libc::open(
            path.as_ptr(),
            libc::O_RDONLY | libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC,
            0,
        )
    };
    if fd < 0 {
        Err(io::Error::last_os_error())
    } else {
        Ok(unsafe { OwnedFd::from_raw_fd(fd) })
    }
}

fn storage_error_to_io(error: StorageError) -> io::Error {
    let kind = match error.code {
        StorageErrorCode::NotFound => io::ErrorKind::NotFound,
        StorageErrorCode::PermissionDenied | StorageErrorCode::OwnerMismatch => {
            io::ErrorKind::PermissionDenied
        }
        StorageErrorCode::InvalidName | StorageErrorCode::Traversal | StorageErrorCode::Symlink => {
            io::ErrorKind::InvalidInput
        }
        _ => io::ErrorKind::Other,
    };
    io::Error::new(kind, error.code.as_str())
}

#[cfg(not(unix))]
fn open_directory(path: &Path) -> io::Result<OwnedFd> {
    let _ = path;
    Err(io::Error::new(
        io::ErrorKind::Unsupported,
        "descriptor storage",
    ))
}

#[cfg(unix)]
fn open_directory_at(parent: RawFd, name: &str) -> Result<OwnedFd, StorageError> {
    let name = CString::new(name).map_err(|_| StorageError::new(StorageErrorCode::InvalidName))?;
    let fd = unsafe {
        libc::openat(
            parent,
            name.as_ptr(),
            libc::O_RDONLY | libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC,
            0,
        )
    };
    if fd < 0 {
        Err(map_open_error(io::Error::last_os_error(), false))
    } else {
        Ok(unsafe { OwnedFd::from_raw_fd(fd) })
    }
}

#[cfg(not(unix))]
fn open_directory_at(_parent: i32, _name: &str) -> Result<OwnedFd, StorageError> {
    Err(StorageError::new(StorageErrorCode::RootUnavailable))
}

#[cfg(unix)]
fn open_regular_at(parent: RawFd, name: &str) -> Result<OwnedFd, StorageError> {
    let name = CString::new(name).map_err(|_| StorageError::new(StorageErrorCode::InvalidName))?;
    let fd = unsafe {
        libc::openat(
            parent,
            name.as_ptr(),
            libc::O_RDONLY | libc::O_NOFOLLOW | libc::O_CLOEXEC,
            0,
        )
    };
    if fd < 0 {
        Err(map_open_error(io::Error::last_os_error(), false))
    } else {
        Ok(unsafe { OwnedFd::from_raw_fd(fd) })
    }
}

#[cfg(not(unix))]
fn open_regular_at(_parent: i32, _name: &str) -> Result<OwnedFd, StorageError> {
    Err(StorageError::new(StorageErrorCode::RootUnavailable))
}

#[cfg(unix)]
fn create_temp_file(parent: RawFd, name: &str) -> Result<OwnedFd, StorageError> {
    let name = CString::new(name).map_err(|_| StorageError::new(StorageErrorCode::InvalidName))?;
    let fd = unsafe {
        libc::openat(
            parent,
            name.as_ptr(),
            libc::O_WRONLY | libc::O_CREAT | libc::O_EXCL | libc::O_NOFOLLOW | libc::O_CLOEXEC,
            0o600,
        )
    };
    if fd < 0 {
        Err(map_open_error(io::Error::last_os_error(), false))
    } else {
        let fd = unsafe { OwnedFd::from_raw_fd(fd) };
        let stat = stat_fd(&fd).map_err(StorageError::new)?;
        validate_regular_stat(&stat).map_err(StorageError::new)?;
        Ok(fd)
    }
}

#[cfg(unix)]
fn create_private_file_at(parent: RawFd, name: &str, contents: &[u8]) -> Result<(), StorageError> {
    let name = CString::new(valid_component(name)?)
        .map_err(|_| StorageError::new(StorageErrorCode::InvalidName))?;
    let fd = unsafe {
        libc::openat(
            parent,
            name.as_ptr(),
            libc::O_WRONLY | libc::O_CREAT | libc::O_EXCL | libc::O_NOFOLLOW | libc::O_CLOEXEC,
            0o600,
        )
    };
    if fd < 0 {
        return Err(map_open_error(io::Error::last_os_error(), false));
    }
    let fd = unsafe { OwnedFd::from_raw_fd(fd) };
    let stat = match stat_fd(&fd).map_err(StorageError::new) {
        Ok(stat) => stat,
        Err(error) => {
            drop(fd);
            let _ = unlink_at(parent, &name.to_string_lossy(), false);
            return Err(error);
        }
    };
    if let Err(error) = validate_regular_stat(&stat).map_err(StorageError::new) {
        drop(fd);
        let _ = unlink_at(parent, &name.to_string_lossy(), false);
        return Err(error);
    }
    let mut file = File::from(fd);
    if let Err(error) = file
        .write_all(contents)
        .map_err(|_| StorageError::new(StorageErrorCode::WriteFailed))
        .and_then(|_| {
            file.sync_all()
                .map_err(|_| StorageError::new(StorageErrorCode::FlushFailed))
        })
    {
        drop(file);
        let _ = unlink_at(parent, &name.to_string_lossy(), false);
        return Err(error);
    }
    drop(file);
    Ok(())
}

#[cfg(not(unix))]
fn create_temp_file(_parent: i32, _name: &str) -> Result<OwnedFd, StorageError> {
    Err(StorageError::new(StorageErrorCode::RootUnavailable))
}

#[cfg(unix)]
fn stat_fd(fd: &OwnedFd) -> Result<libc::stat, StorageErrorCode> {
    let mut stat = std::mem::MaybeUninit::<libc::stat>::zeroed();
    let result = unsafe { libc::fstat(fd.as_raw_fd(), stat.as_mut_ptr()) };
    if result != 0 {
        Err(StorageErrorCode::TypeMismatch)
    } else {
        Ok(unsafe { stat.assume_init() })
    }
}

#[cfg(unix)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct DirectoryIdentity {
    device: libc::dev_t,
    inode: libc::ino_t,
    owner: libc::uid_t,
    mode: libc::mode_t,
    file_type: libc::mode_t,
    link_count: libc::nlink_t,
}

#[cfg(unix)]
fn directory_identity(fd: &OwnedFd) -> Result<DirectoryIdentity, StorageErrorCode> {
    let stat = stat_fd(fd)?;
    if !is_directory_stat(&stat) {
        return Err(StorageErrorCode::TypeMismatch);
    }
    Ok(DirectoryIdentity {
        device: stat.st_dev,
        inode: stat.st_ino,
        owner: stat.st_uid,
        mode: stat.st_mode & 0o777,
        file_type: stat.st_mode & libc::S_IFMT,
        link_count: stat.st_nlink,
    })
}

#[cfg(unix)]
fn same_directory_identity(expected: &DirectoryIdentity, current: &libc::stat) -> bool {
    expected.device == current.st_dev
        && expected.inode == current.st_ino
        && expected.owner == current.st_uid
        && expected.mode == current.st_mode & 0o777
        && expected.file_type == current.st_mode & libc::S_IFMT
        && current.st_nlink > 0
}

#[cfg(unix)]
fn compare_directory_identity(
    expected: &DirectoryIdentity,
    current: &DirectoryIdentity,
) -> Result<(), StorageError> {
    if expected.device != current.device || expected.inode != current.inode {
        return Err(StorageError::new(StorageErrorCode::InodeChanged));
    }
    if expected.owner != current.owner {
        return Err(StorageError::new(StorageErrorCode::OwnerMismatch));
    }
    if expected.mode != current.mode {
        return Err(StorageError::new(StorageErrorCode::ModeMismatch));
    }
    if expected.file_type != current.file_type {
        return Err(StorageError::new(StorageErrorCode::TypeMismatch));
    }
    if expected.link_count == 0 || current.link_count == 0 {
        return Err(StorageError::new(StorageErrorCode::LinkCountChanged));
    }
    Ok(())
}

#[cfg(unix)]
fn stat_at(parent: RawFd, name: &str) -> Result<libc::stat, StorageError> {
    let name = CString::new(name).map_err(|_| StorageError::new(StorageErrorCode::InvalidName))?;
    let mut stat = std::mem::MaybeUninit::<libc::stat>::zeroed();
    let result = unsafe {
        libc::fstatat(
            parent,
            name.as_ptr(),
            stat.as_mut_ptr(),
            libc::AT_SYMLINK_NOFOLLOW,
        )
    };
    if result != 0 {
        let error = io::Error::last_os_error();
        if error.kind() == io::ErrorKind::NotFound {
            Err(StorageError::new(StorageErrorCode::NotFound))
        } else {
            Err(map_open_error(error, false))
        }
    } else {
        Ok(unsafe { stat.assume_init() })
    }
}

#[cfg(not(unix))]
fn stat_fd(_fd: &OwnedFd) -> Result<(), StorageErrorCode> {
    Err(StorageErrorCode::RootUnavailable)
}

#[cfg(not(unix))]
fn stat_at(_parent: i32, _name: &str) -> Result<(), StorageError> {
    Err(StorageError::new(StorageErrorCode::RootUnavailable))
}

#[cfg(unix)]
fn validate_directory_fd(fd: &OwnedFd) -> Result<(), StorageErrorCode> {
    let stat = stat_fd(fd)?;
    if !is_directory_stat(&stat) {
        return Err(StorageErrorCode::TypeMismatch);
    }
    let uid = unsafe { libc::geteuid() } as libc::uid_t;
    if stat.st_uid != uid {
        return Err(StorageErrorCode::OwnerMismatch);
    }
    if stat.st_mode & 0o777 != 0o700 {
        return Err(StorageErrorCode::ModeMismatch);
    }
    if stat.st_nlink == 0 {
        return Err(StorageErrorCode::LinkCountChanged);
    }
    Ok(())
}

#[cfg(unix)]
fn validate_destination_directory_fd(fd: &OwnedFd) -> Result<(), StorageErrorCode> {
    let stat = stat_fd(fd)?;
    if !is_directory_stat(&stat) {
        return Err(StorageErrorCode::TypeMismatch);
    }
    let uid = unsafe { libc::geteuid() } as libc::uid_t;
    if stat.st_uid != uid {
        return Err(StorageErrorCode::OwnerMismatch);
    }
    // A native export may target a normal user-owned 0755 folder, but never a
    // group/world-writable parent whose identity can be replaced by another
    // user between validation and rename.
    if stat.st_mode & 0o022 != 0 {
        return Err(StorageErrorCode::ModeMismatch);
    }
    if stat.st_nlink == 0 {
        return Err(StorageErrorCode::LinkCountChanged);
    }
    Ok(())
}

#[cfg(not(unix))]
fn validate_destination_directory_fd(_fd: &OwnedFd) -> Result<(), StorageErrorCode> {
    Ok(())
}

#[cfg(not(unix))]
fn validate_directory_fd(_fd: &OwnedFd) -> Result<(), StorageErrorCode> {
    Ok(())
}

#[cfg(unix)]
fn validate_regular_stat(stat: &libc::stat) -> Result<(), StorageErrorCode> {
    if !is_regular_stat(stat) {
        return Err(StorageErrorCode::TypeMismatch);
    }
    if stat.st_uid != unsafe { libc::geteuid() } as libc::uid_t {
        return Err(StorageErrorCode::OwnerMismatch);
    }
    if stat.st_mode & 0o777 != 0o600 {
        return Err(StorageErrorCode::ModeMismatch);
    }
    if stat.st_nlink != 1 {
        return Err(StorageErrorCode::LinkCountChanged);
    }
    Ok(())
}

#[cfg(not(unix))]
fn validate_regular_stat(_stat: &()) -> Result<(), StorageErrorCode> {
    Ok(())
}

#[cfg(unix)]
fn compare_identity(before: &libc::stat, after: &libc::stat) -> Result<(), StorageError> {
    if before.st_dev != after.st_dev || before.st_ino != after.st_ino {
        return Err(StorageError::new(StorageErrorCode::InodeChanged));
    }
    if before.st_uid != after.st_uid {
        return Err(StorageError::new(StorageErrorCode::OwnerMismatch));
    }
    if before.st_mode & 0o777 != after.st_mode & 0o777 {
        return Err(StorageError::new(StorageErrorCode::ModeMismatch));
    }
    if before.st_mode & libc::S_IFMT != after.st_mode & libc::S_IFMT {
        return Err(StorageError::new(StorageErrorCode::TypeMismatch));
    }
    if before.st_nlink != after.st_nlink || after.st_nlink != 1 {
        return Err(StorageError::new(StorageErrorCode::LinkCountChanged));
    }
    Ok(())
}

#[cfg(not(unix))]
fn compare_identity(_before: &(), _after: &()) -> Result<(), StorageError> {
    Ok(())
}

#[cfg(unix)]
fn is_directory_stat(stat: &libc::stat) -> bool {
    stat.st_mode & libc::S_IFMT == libc::S_IFDIR
}

#[cfg(unix)]
fn is_regular_stat(stat: &libc::stat) -> bool {
    stat.st_mode & libc::S_IFMT == libc::S_IFREG
}

#[cfg(not(unix))]
fn is_directory_stat(_stat: &()) -> bool {
    true
}

#[cfg(not(unix))]
fn is_regular_stat(_stat: &()) -> bool {
    true
}

#[cfg(unix)]
fn mkdir_at(parent: RawFd, name: &str) -> Result<(), StorageError> {
    let name = CString::new(name).map_err(|_| StorageError::new(StorageErrorCode::InvalidName))?;
    let result = unsafe { libc::mkdirat(parent, name.as_ptr(), 0o700) };
    if result != 0 {
        Err(map_open_error(io::Error::last_os_error(), true))
    } else {
        Ok(())
    }
}

#[cfg(not(unix))]
fn mkdir_at(_parent: i32, _name: &str) -> Result<(), StorageError> {
    Err(StorageError::new(StorageErrorCode::RootUnavailable))
}

#[cfg(unix)]
fn remove_regular_at(parent: RawFd, name: &str, before: &libc::stat) -> Result<(), StorageError> {
    let after = stat_at(parent, name)?;
    compare_identity(before, &after)?;
    unlink_at(parent, name, false)
}

#[cfg(not(unix))]
fn remove_regular_at(_parent: i32, _name: &str, _before: &()) -> Result<(), StorageError> {
    Err(StorageError::new(StorageErrorCode::RootUnavailable))
}

#[cfg(unix)]
fn unlink_at(parent: RawFd, name: &str, directory: bool) -> Result<(), StorageError> {
    let name = CString::new(name).map_err(|_| StorageError::new(StorageErrorCode::InvalidName))?;
    let flags = if directory { libc::AT_REMOVEDIR } else { 0 };
    let result = unsafe { libc::unlinkat(parent, name.as_ptr(), flags) };
    if result != 0 {
        Err(map_open_error(io::Error::last_os_error(), false))
    } else {
        Ok(())
    }
}

#[cfg(not(unix))]
fn unlink_at(_parent: i32, _name: &str, _directory: bool) -> Result<(), StorageError> {
    Err(StorageError::new(StorageErrorCode::RootUnavailable))
}

#[cfg(unix)]
fn rename_at(parent: RawFd, from: &str, to: &str) -> Result<(), StorageError> {
    let from = CString::new(from).map_err(|_| StorageError::new(StorageErrorCode::InvalidName))?;
    let to = CString::new(to).map_err(|_| StorageError::new(StorageErrorCode::InvalidName))?;
    let result = unsafe { libc::renameat(parent, from.as_ptr(), parent, to.as_ptr()) };
    if result != 0 {
        Err(StorageError::new(StorageErrorCode::RenameFailed))
    } else {
        Ok(())
    }
}

#[cfg(not(unix))]
fn rename_at(_parent: i32, _from: &str, _to: &str) -> Result<(), StorageError> {
    Err(StorageError::new(StorageErrorCode::RootUnavailable))
}

#[cfg(unix)]
fn sync_directory(directory: &OwnedFd) -> Result<(), StorageError> {
    if unsafe { libc::fsync(directory.as_raw_fd()) } != 0 {
        Err(StorageError::new(StorageErrorCode::FlushFailed))
    } else {
        Ok(())
    }
}

#[cfg(not(unix))]
fn sync_directory(_directory: &OwnedFd) -> Result<(), StorageError> {
    Ok(())
}

#[cfg(unix)]
fn root_fd(fd: &OwnedFd) -> RawFd {
    fd.as_raw_fd()
}

#[cfg(unix)]
fn sessions_fd(fd: &OwnedFd) -> RawFd {
    fd.as_raw_fd()
}

#[cfg(unix)]
fn parent_fd(fd: &OwnedFd) -> RawFd {
    fd.as_raw_fd()
}

#[cfg(unix)]
fn directory_fd(fd: &OwnedFd) -> RawFd {
    fd.as_raw_fd()
}

#[cfg(not(unix))]
fn root_fd(_fd: &OwnedFd) -> i32 {
    0
}
#[cfg(not(unix))]
fn sessions_fd(_fd: &OwnedFd) -> i32 {
    0
}
#[cfg(not(unix))]
fn parent_fd(_fd: &OwnedFd) -> i32 {
    0
}
#[cfg(not(unix))]
fn directory_fd(_fd: &OwnedFd) -> i32 {
    0
}

fn temporary_name(prefix: &str) -> String {
    let mut bytes = [0u8; 16];
    let _ = fill_random(&mut bytes);
    let mut value = String::from(prefix);
    for byte in bytes {
        value.push_str(&format!("{byte:02x}"));
    }
    value.push_str(".tmp");
    value
}

fn fill_random(bytes: &mut [u8]) -> io::Result<()> {
    #[cfg(unix)]
    {
        File::open("/dev/urandom")?.read_exact(bytes)
    }
    #[cfg(not(unix))]
    {
        let _ = bytes;
        Err(io::Error::new(io::ErrorKind::Unsupported, "random"))
    }
}

fn map_open_error(error: io::Error, root: bool) -> StorageError {
    let code = match error.kind() {
        io::ErrorKind::NotFound => {
            if root {
                StorageErrorCode::RootUnavailable
            } else {
                StorageErrorCode::NotFound
            }
        }
        io::ErrorKind::PermissionDenied => StorageErrorCode::PermissionDenied,
        io::ErrorKind::AlreadyExists => StorageErrorCode::RenameFailed,
        _ => StorageErrorCode::RootUnavailable,
    };
    StorageError::new(code)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::symlink;
    use std::os::unix::fs::PermissionsExt;
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::time::{SystemTime, UNIX_EPOCH};

    static FIXTURE_COUNTER: AtomicU64 = AtomicU64::new(0);

    fn fixture() -> (PathBuf, PathBuf, PathBuf) {
        let root = std::env::temp_dir().join(format!(
            "chat-analysis-secure-storage-{}-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos(),
            FIXTURE_COUNTER.fetch_add(1, Ordering::Relaxed),
        ));
        fs::create_dir(&root).unwrap();
        fs::set_permissions(&root, fs::Permissions::from_mode(0o700)).unwrap();
        let sessions = root.join(ANALYSIS_SESSIONS_DIRECTORY);
        fs::create_dir(&sessions).unwrap();
        fs::set_permissions(&sessions, fs::Permissions::from_mode(0o700)).unwrap();
        (root, sessions, PathBuf::new())
    }

    fn session(root: &Path, id: &str) {
        let dir = root.join(ANALYSIS_SESSIONS_DIRECTORY).join(id);
        fs::create_dir(&dir).unwrap();
        fs::set_permissions(&dir, fs::Permissions::from_mode(0o700)).unwrap();
        fs::write(dir.join(".session-marker"), SESSION_MARKER_CONTENT).unwrap();
        fs::write(
            dir.join(SESSION_STATE_NAME),
            format!("sessionId={id}\ngeneration=1\n"),
        )
        .unwrap();
        fs::set_permissions(
            dir.join(".session-marker"),
            fs::Permissions::from_mode(0o600),
        )
        .unwrap();
        fs::set_permissions(
            dir.join(SESSION_STATE_NAME),
            fs::Permissions::from_mode(0o600),
        )
        .unwrap();
        fs::create_dir(dir.join(NORMALIZED_DIRECTORY_NAME)).unwrap();
        fs::set_permissions(
            dir.join(NORMALIZED_DIRECTORY_NAME),
            fs::Permissions::from_mode(0o700),
        )
        .unwrap();
    }

    #[test]
    fn cleanup_is_allow_listed_and_preserves_unknown_entries() {
        let (root, sessions, _) = fixture();
        let id = "ses_00000000000000000000000000000001";
        session(&root, id);
        let storage = SecureStorage::new(&root).unwrap();
        assert!(matches!(
            storage.cleanup_session(id),
            CleanupOutcome::Complete { .. }
        ));
        assert!(!sessions.join(id).exists());

        session(&root, id);
        fs::write(sessions.join(id).join("unexpected.bin"), b"synthetic").unwrap();
        fs::set_permissions(
            sessions.join(id).join("unexpected.bin"),
            fs::Permissions::from_mode(0o600),
        )
        .unwrap();
        assert_eq!(storage.cleanup_session(id), CleanupOutcome::UnsafeEntry);
        assert!(sessions.join(id).join("unexpected.bin").exists());
        fs::remove_file(sessions.join(id).join("unexpected.bin")).unwrap();
        fs::remove_dir(sessions.join(id).join(NORMALIZED_DIRECTORY_NAME)).unwrap();
        fs::remove_file(sessions.join(id).join(".session-marker")).unwrap();
        fs::remove_file(sessions.join(id).join(SESSION_STATE_NAME)).unwrap();
        fs::remove_dir(sessions.join(id)).unwrap();
        fs::remove_dir(sessions).unwrap();
        fs::remove_dir(root).unwrap();
    }

    #[test]
    fn atomic_write_is_exclusive_and_formula_safe_boundary_is_host_owned() {
        let (root, _sessions, _) = fixture();
        let destination = root.join("synthetic-export.json");
        let storage = SecureStorage::new(&root).unwrap();
        storage
            .atomic_write_to_path(&destination, b"{}\n", false)
            .unwrap();
        assert_eq!(fs::read(&destination).unwrap(), b"{}\n");
        assert_eq!(
            storage
                .atomic_write_to_path(&destination, b"next\n", false)
                .unwrap_err()
                .code,
            StorageErrorCode::RenameFailed
        );
        storage
            .atomic_write_to_path(&destination, b"next\n", true)
            .unwrap();
        assert_eq!(fs::read(&destination).unwrap(), b"next\n");
        fs::remove_file(destination).unwrap();
        fs::remove_dir(root.join(ANALYSIS_SESSIONS_DIRECTORY)).unwrap();
        fs::remove_dir(root).unwrap();
    }

    #[test]
    fn parent_sync_failure_reports_uncertain_after_atomic_publish() {
        let (root, sessions, _) = fixture();
        let destination = root.join("synthetic-durability.json");
        let error = SecureStorage::atomic_write_destination_fenced_with_parent_sync(
            &destination,
            b"published\n",
            false,
            || Ok(()),
            |_parent| Err(StorageError::new(StorageErrorCode::FlushFailed)),
        )
        .unwrap_err();
        assert_eq!(error.code, StorageErrorCode::DurabilityUncertain);
        assert_eq!(fs::read(&destination).unwrap(), b"published\n");
        assert_eq!(
            fs::read_dir(&root)
                .unwrap()
                .filter_map(Result::ok)
                .filter(|entry| entry.file_name().to_string_lossy().contains(".tmp"))
                .count(),
            0
        );
        fs::remove_file(destination).unwrap();
        fs::remove_dir(sessions).unwrap();
        fs::remove_dir(root).unwrap();
    }

    #[test]
    fn export_temp_entry_swap_is_rejected_before_rename_and_cleaned() {
        let (root, sessions, _) = fixture();
        let destination = root.join("synthetic-export.json");
        fs::write(&destination, b"old\n").unwrap();
        fs::set_permissions(&destination, fs::Permissions::from_mode(0o600)).unwrap();
        let mut fence_calls = 0u8;
        let error =
            SecureStorage::atomic_write_destination_fenced(&destination, b"new\n", true, || {
                fence_calls += 1;
                if fence_calls == 2 {
                    let temporary = fs::read_dir(&root)
                        .unwrap()
                        .map(|entry| entry.unwrap().path())
                        .find(|path| {
                            path.file_name()
                                .and_then(|name| name.to_str())
                                .is_some_and(|name| name.starts_with(".chat-analysis-export"))
                        })
                        .expect("temporary export entry");
                    fs::remove_file(&temporary).unwrap();
                    symlink(&destination, &temporary).unwrap();
                }
                Ok(())
            })
            .unwrap_err();
        assert_eq!(error.code, StorageErrorCode::InodeChanged);
        assert_eq!(fs::read(&destination).unwrap(), b"old\n");
        assert_eq!(
            fs::read_dir(&root)
                .unwrap()
                .filter_map(Result::ok)
                .filter(|entry| {
                    entry
                        .file_name()
                        .to_string_lossy()
                        .starts_with(".chat-analysis-export")
                })
                .count(),
            0
        );
        fs::remove_file(destination).unwrap();
        fs::remove_dir(sessions).unwrap();
        fs::remove_dir(root).unwrap();
    }

    #[test]
    fn adversarial_storage_matrix_is_fail_closed_and_preserves_targets() {
        let (root, sessions, _) = fixture();
        let storage = SecureStorage::new(&root).unwrap();

        let hardlink_id = "ses_00000000000000000000000000000002";
        session(&root, hardlink_id);
        let marker = sessions.join(hardlink_id).join(".session-marker");
        let hardlink_target = root.join("synthetic-hardlink-target");
        fs::hard_link(&marker, &hardlink_target).unwrap();
        assert_eq!(
            storage.cleanup_session(hardlink_id),
            CleanupOutcome::UnsafeEntry
        );
        assert!(marker.exists());
        assert!(hardlink_target.exists());
        fs::remove_file(hardlink_target).unwrap();
        assert!(matches!(
            storage.cleanup_session(hardlink_id),
            CleanupOutcome::Complete { .. }
        ));

        let symlink_id = "ses_00000000000000000000000000000003";
        session(&root, symlink_id);
        let normalized = sessions.join(symlink_id).join(NORMALIZED_DIRECTORY_NAME);
        let symlink_target = root.join("synthetic-symlink-target");
        fs::create_dir(&symlink_target).unwrap();
        fs::set_permissions(&symlink_target, fs::Permissions::from_mode(0o700)).unwrap();
        fs::remove_dir(&normalized).unwrap();
        symlink(&symlink_target, &normalized).unwrap();
        assert_eq!(
            storage.cleanup_session(symlink_id),
            CleanupOutcome::UnsafeEntry
        );
        assert!(symlink_target.exists());
        fs::remove_file(&normalized).unwrap();
        fs::remove_dir(symlink_target).unwrap();
        fs::create_dir(&normalized).unwrap();
        fs::set_permissions(&normalized, fs::Permissions::from_mode(0o700)).unwrap();
        assert!(matches!(
            storage.cleanup_session(symlink_id),
            CleanupOutcome::Complete { .. }
        ));

        let mode_id = "ses_00000000000000000000000000000004";
        session(&root, mode_id);
        let mode_marker = sessions.join(mode_id).join(".session-marker");
        fs::set_permissions(&mode_marker, fs::Permissions::from_mode(0o640)).unwrap();
        assert_eq!(
            storage.cleanup_session(mode_id),
            CleanupOutcome::ModeMismatch
        );
        assert!(mode_marker.exists());
        fs::set_permissions(&mode_marker, fs::Permissions::from_mode(0o600)).unwrap();
        assert!(matches!(
            storage.cleanup_session(mode_id),
            CleanupOutcome::Complete { .. }
        ));

        let type_id = "ses_00000000000000000000000000000005";
        session(&root, type_id);
        let state = sessions.join(type_id).join(SESSION_STATE_NAME);
        fs::remove_file(&state).unwrap();
        fs::create_dir(&state).unwrap();
        fs::set_permissions(&state, fs::Permissions::from_mode(0o700)).unwrap();
        assert_eq!(
            storage.cleanup_session(type_id),
            CleanupOutcome::TypeMismatch
        );
        assert!(state.is_dir());
        fs::remove_dir(&state).unwrap();
        fs::write(&state, format!("sessionId={type_id}\ngeneration=1\n")).unwrap();
        fs::set_permissions(&state, fs::Permissions::from_mode(0o600)).unwrap();
        assert!(matches!(
            storage.cleanup_session(type_id),
            CleanupOutcome::Complete { .. }
        ));

        fs::remove_dir(sessions).unwrap();
        fs::remove_dir(root).unwrap();
    }

    #[test]
    fn root_mode_and_traversal_fail_without_mutation() {
        let (root, sessions, _) = fixture();
        fs::set_permissions(&root, fs::Permissions::from_mode(0o755)).unwrap();
        assert_eq!(
            SecureStorage::new(&root).unwrap_err().code,
            StorageErrorCode::ModeMismatch
        );
        fs::set_permissions(&root, fs::Permissions::from_mode(0o700)).unwrap();
        let storage = SecureStorage::new(&root).unwrap();
        let outside = root.join("synthetic-traversal-target");
        fs::write(&outside, b"preserve").unwrap();
        let traversal = root
            .join(ANALYSIS_SESSIONS_DIRECTORY)
            .join("..")
            .join("synthetic-traversal-target");
        assert_eq!(
            storage.read_verified(&traversal, 128).unwrap_err().code,
            StorageErrorCode::Traversal
        );
        assert_eq!(fs::read(&outside).unwrap(), b"preserve");
        fs::remove_file(outside).unwrap();
        fs::remove_dir(sessions).unwrap();
        fs::remove_dir(root).unwrap();
    }

    #[test]
    fn owner_record_is_exact_and_live_mismatch_is_left_untouched() {
        let (root, sessions, _) = fixture();
        let id = "ses_00000000000000000000000000000006";
        session(&root, id);
        let record = OwnerRecord {
            schema_version: OWNER_RECORD_SCHEMA_VERSION.to_string(),
            state_version: "active.v1".to_string(),
            pid: std::process::id(),
            process_group_id: 1,
            start_fingerprint: "synthetic-start".to_string(),
            executable_fingerprint: "a".repeat(64),
            session_id: id.to_string(),
            generation: 1,
            nonce: format!("nonce_{}", "b".repeat(32)),
        };
        assert!(record.validate(id));
        let mut with_unknown = serde_json::to_value(&record).unwrap();
        with_unknown["sourcePath"] = serde_json::Value::String("synthetic-secret".to_string());
        assert!(serde_json::from_value::<OwnerRecord>(with_unknown).is_err());
        fs::write(
            sessions.join(id).join(OWNER_RECORD_NAME),
            serde_json::to_vec(&record).unwrap(),
        )
        .unwrap();
        fs::set_permissions(
            sessions.join(id).join(OWNER_RECORD_NAME),
            fs::Permissions::from_mode(0o600),
        )
        .unwrap();

        let storage = SecureStorage::new(&root).unwrap();
        let recovery = storage
            .recover_startup_with(|owner| {
                assert_eq!(owner.session_id, id);
                RecoveryDisposition::UnownedLive
            })
            .unwrap();
        assert_eq!(recovery.recognized_session_count, 1);
        assert_eq!(recovery.cleaned_session_count, 0);
        assert!(recovery.cleanup_required);
        assert!(sessions.join(id).exists());

        assert!(matches!(
            storage.cleanup_session(id),
            CleanupOutcome::Complete { .. }
        ));
        fs::remove_dir(sessions).unwrap();
        fs::remove_dir(root).unwrap();
    }

    #[test]
    fn pinned_sessions_descriptor_survives_path_swap_without_touching_replacement() {
        let (root, sessions, _) = fixture();
        let id = "ses_00000000000000000000000000000007";
        session(&root, id);
        let storage = SecureStorage::new(&root).unwrap();
        let moved = root.join("synthetic-moved-sessions");
        fs::rename(&sessions, &moved).unwrap();
        fs::create_dir(&sessions).unwrap();
        fs::set_permissions(&sessions, fs::Permissions::from_mode(0o700)).unwrap();
        session(&root, id);

        assert!(matches!(
            storage.cleanup_session(id),
            CleanupOutcome::Complete { .. }
        ));
        assert!(sessions.join(id).exists());
        assert!(!moved.join(id).exists());

        fs::remove_dir(sessions.join(id).join(NORMALIZED_DIRECTORY_NAME)).unwrap();
        fs::remove_file(sessions.join(id).join(".session-marker")).unwrap();
        fs::remove_file(sessions.join(id).join(SESSION_STATE_NAME)).unwrap();
        fs::remove_dir(sessions.join(id)).unwrap();
        fs::remove_dir(sessions).unwrap();
        fs::remove_dir(moved).unwrap();
        fs::remove_dir(root).unwrap();
    }

    #[test]
    fn pinned_root_descriptor_survives_ancestor_swap_without_touching_replacement() {
        let (root, sessions, _) = fixture();
        let storage = SecureStorage::new(&root).unwrap();
        let moved = root.with_file_name(format!(
            "{}-moved",
            root.file_name().and_then(|value| value.to_str()).unwrap()
        ));
        fs::rename(&root, &moved).unwrap();
        fs::create_dir(&root).unwrap();
        fs::set_permissions(&root, fs::Permissions::from_mode(0o700)).unwrap();
        fs::create_dir(root.join(ANALYSIS_SESSIONS_DIRECTORY)).unwrap();
        fs::set_permissions(
            root.join(ANALYSIS_SESSIONS_DIRECTORY),
            fs::Permissions::from_mode(0o700),
        )
        .unwrap();

        let id = "ses_00000000000000000000000000000008";
        storage.create_session(id, 1).unwrap();
        assert!(moved.join(ANALYSIS_SESSIONS_DIRECTORY).join(id).is_dir());
        assert!(!moved
            .join(ANALYSIS_SESSIONS_DIRECTORY)
            .join(id)
            .join(NORMALIZED_DIRECTORY_NAME)
            .exists());
        assert!(!sessions.join(id).exists());
        assert_eq!(
            storage.cleanup_session(id),
            CleanupOutcome::Complete {
                removed_entry_count: 3
            }
        );

        fs::remove_dir(root.join(ANALYSIS_SESSIONS_DIRECTORY)).unwrap();
        fs::remove_dir(root).unwrap();
        fs::remove_dir(moved.join(ANALYSIS_SESSIONS_DIRECTORY)).unwrap();
        fs::remove_dir(moved).unwrap();
    }
}
