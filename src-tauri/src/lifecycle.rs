//! Shared lifecycle coordination primitives.
//!
//! Cleanup is keyed by the trusted window identity, opaque session ID, and
//! generation.  The coordinator makes cleanup single-flight and caches the
//! terminal outcome so duplicate close/replacement paths cannot signal a
//! process twice or delete a session twice.

use std::collections::HashMap;
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::sync::mpsc::{self, Sender};
use std::sync::{Arc, Mutex};

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct CleanupKey {
    pub window_identity: String,
    pub session_id: String,
    pub generation: u64,
}

impl CleanupKey {
    pub fn new(
        window_identity: impl Into<String>,
        session_id: impl Into<String>,
        generation: u64,
    ) -> Self {
        Self {
            window_identity: window_identity.into(),
            session_id: session_id.into(),
            generation,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CleanupTerminal {
    Complete { removed_entry_count: u64 },
    Required,
    Timeout,
    UnsafeEntry,
    OwnerMismatch,
    ModeMismatch,
    TypeMismatch,
}

impl CleanupTerminal {
    pub const fn code(self) -> &'static str {
        match self {
            Self::Complete { .. } => "CLEANUP_COMPLETE",
            Self::Required => "CLEANUP_REQUIRED",
            Self::Timeout => "CLEANUP_TIMEOUT",
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

enum Entry {
    Running {
        waiters: Vec<Sender<CleanupTerminal>>,
    },
    Complete(CleanupTerminal),
}

#[derive(Clone, Default)]
pub struct CleanupCoordinator {
    entries: Arc<Mutex<HashMap<CleanupKey, Entry>>>,
}

impl std::fmt::Debug for CleanupCoordinator {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let size = self
            .entries
            .lock()
            .map(|entries| entries.len())
            .unwrap_or(0);
        formatter
            .debug_struct("CleanupCoordinator")
            .field("entry_count", &size)
            .finish()
    }
}

impl CleanupCoordinator {
    /// Run one cleanup operation.  Concurrent callers wait for the owner and
    /// receive the exact same terminal value; no caller runs the operation a
    /// second time.
    pub fn run<F>(&self, key: CleanupKey, operation: F) -> CleanupTerminal
    where
        F: FnOnce() -> CleanupTerminal,
    {
        self.run_with_waiter_ready(key, || {}, operation)
    }

    /// Test and host orchestration seam that fires once a caller has joined a
    /// running cleanup.  It makes barriers/latches possible without timing
    /// sleeps while preserving the same single-flight implementation.
    pub fn run_with_waiter_ready<F, H>(
        &self,
        key: CleanupKey,
        waiter_ready: H,
        operation: F,
    ) -> CleanupTerminal
    where
        F: FnOnce() -> CleanupTerminal,
        H: FnOnce(),
    {
        let (owner, receiver) = {
            let mut entries = match self.entries.lock() {
                Ok(entries) => entries,
                Err(_) => return CleanupTerminal::Required,
            };
            match entries.get_mut(&key) {
                Some(Entry::Complete(outcome)) => return *outcome,
                Some(Entry::Running { waiters }) => {
                    let (sender, receiver) = mpsc::channel();
                    waiters.push(sender);
                    (false, Some(receiver))
                }
                None => {
                    entries.insert(
                        key.clone(),
                        Entry::Running {
                            waiters: Vec::new(),
                        },
                    );
                    (true, None)
                }
            }
        };

        if !owner {
            waiter_ready();
            return receiver
                .expect("waiting cleanup receiver")
                .recv()
                .unwrap_or(CleanupTerminal::Required);
        }

        let operation_result = catch_unwind(AssertUnwindSafe(operation));
        let panicked = operation_result.is_err();
        let outcome = operation_result.unwrap_or(CleanupTerminal::Required);
        let waiters = match self.entries.lock() {
            Ok(mut entries) => match entries.remove(&key) {
                Some(Entry::Running { waiters }) => {
                    if !panicked {
                        entries.insert(key, Entry::Complete(outcome));
                    }
                    waiters
                }
                Some(Entry::Complete(_)) | None => Vec::new(),
            },
            Err(_) => Vec::new(),
        };
        for waiter in waiters {
            let _ = waiter.send(outcome);
        }
        outcome
    }

    pub fn cached(&self, key: &CleanupKey) -> Option<CleanupTerminal> {
        self.entries
            .lock()
            .ok()
            .and_then(|entries| match entries.get(key) {
                Some(Entry::Complete(outcome)) => Some(*outcome),
                Some(Entry::Running { .. }) | None => None,
            })
    }

    /// Drop a completed cache entry only after the owning session registry has
    /// released all references.  This is never used to cancel an in-flight
    /// cleanup.
    pub fn forget(&self, key: &CleanupKey) {
        if let Ok(mut entries) = self.entries.lock() {
            if matches!(entries.get(key), Some(Entry::Complete(_))) {
                entries.remove(key);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::mpsc;
    use std::thread;

    #[test]
    fn duplicate_cleanup_is_single_flight_and_returns_same_terminal_value() {
        let coordinator = CleanupCoordinator::default();
        let calls = Arc::new(AtomicUsize::new(0));
        for generation in 1..=100 {
            let key = CleanupKey::new(
                "main",
                format!("ses_duplicate_{generation:032x}"),
                generation,
            );
            let (owner_started_tx, owner_started_rx) = mpsc::channel();
            let (release_tx, release_rx) = mpsc::channel();
            let first_coordinator = coordinator.clone();
            let first_calls = calls.clone();
            let first_key = key.clone();
            let first = thread::spawn(move || {
                first_coordinator.run(first_key, || {
                    first_calls.fetch_add(1, Ordering::SeqCst);
                    owner_started_tx.send(()).unwrap();
                    release_rx.recv().unwrap();
                    CleanupTerminal::Complete {
                        removed_entry_count: 4,
                    }
                })
            });
            owner_started_rx.recv().unwrap();

            let (waiter_ready_tx, waiter_ready_rx) = mpsc::channel();
            let second_coordinator = coordinator.clone();
            let second_key = key.clone();
            let second = thread::spawn(move || {
                second_coordinator.run_with_waiter_ready(
                    second_key,
                    || waiter_ready_tx.send(()).unwrap(),
                    || panic!("duplicate cleanup must not execute"),
                )
            });
            waiter_ready_rx.recv().unwrap();
            release_tx.send(()).unwrap();
            assert_eq!(
                first.join().unwrap(),
                CleanupTerminal::Complete {
                    removed_entry_count: 4
                }
            );
            assert_eq!(
                second.join().unwrap(),
                CleanupTerminal::Complete {
                    removed_entry_count: 4
                }
            );
            assert_eq!(
                coordinator.cached(&key),
                Some(CleanupTerminal::Complete {
                    removed_entry_count: 4
                })
            );
            coordinator.forget(&key);
        }
        assert_eq!(calls.load(Ordering::SeqCst), 100);
    }

    #[test]
    fn multiple_cleanup_waiters_receive_one_terminal_value_across_one_hundred_runs() {
        for generation in 1..=100 {
            let coordinator = CleanupCoordinator::default();
            let key = CleanupKey::new("main", format!("ses_waiters_{generation:032x}"), generation);
            let (owner_started_tx, owner_started_rx) = mpsc::channel();
            let (release_tx, release_rx) = mpsc::channel();
            let owner_coordinator = coordinator.clone();
            let owner_key = key.clone();
            let owner = thread::spawn(move || {
                owner_coordinator.run(owner_key, || {
                    owner_started_tx.send(()).unwrap();
                    release_rx.recv().unwrap();
                    CleanupTerminal::Complete {
                        removed_entry_count: 7,
                    }
                })
            });
            owner_started_rx.recv().unwrap();

            let mut waiters = Vec::new();
            let (ready_tx, ready_rx) = mpsc::channel();
            for _ in 0..3 {
                let waiter_coordinator = coordinator.clone();
                let waiter_key = key.clone();
                let waiter_ready = ready_tx.clone();
                waiters.push(thread::spawn(move || {
                    waiter_coordinator.run_with_waiter_ready(
                        waiter_key,
                        || waiter_ready.send(()).unwrap(),
                        || panic!("waiter must not execute cleanup"),
                    )
                }));
            }
            for _ in 0..3 {
                ready_rx.recv().unwrap();
            }
            release_tx.send(()).unwrap();
            assert_eq!(
                owner.join().unwrap(),
                CleanupTerminal::Complete {
                    removed_entry_count: 7,
                }
            );
            for waiter in waiters {
                assert_eq!(
                    waiter.join().unwrap(),
                    CleanupTerminal::Complete {
                        removed_entry_count: 7,
                    }
                );
            }
        }
    }

    #[test]
    fn cleanup_failure_categories_are_stable_and_cached() {
        let coordinator = CleanupCoordinator::default();
        let key = CleanupKey::new("main", "ses_synthetic", 8);
        let outcome = coordinator.run(key.clone(), || CleanupTerminal::UnsafeEntry);
        assert_eq!(outcome.code(), "CLEANUP_UNSAFE_ENTRY");
        assert_eq!(
            coordinator.run(key.clone(), || CleanupTerminal::Complete {
                removed_entry_count: 0
            }),
            outcome
        );
        coordinator.forget(&key);
        assert_eq!(coordinator.cached(&key), None);
    }

    #[test]
    fn bounded_lifecycle_stress_does_not_retain_completed_generations() {
        let coordinator = CleanupCoordinator::default();
        let calls = Arc::new(AtomicUsize::new(0));
        for generation in 1..=128 {
            let key = CleanupKey::new("main", format!("ses_{generation:032x}"), generation);
            let operation_calls = calls.clone();
            assert_eq!(
                coordinator.run(key.clone(), || {
                    operation_calls.fetch_add(1, Ordering::SeqCst);
                    CleanupTerminal::Complete {
                        removed_entry_count: 1,
                    }
                }),
                CleanupTerminal::Complete {
                    removed_entry_count: 1,
                }
            );
            assert!(coordinator.cached(&key).is_some());
            coordinator.forget(&key);
            assert_eq!(coordinator.cached(&key), None);
        }
        assert_eq!(calls.load(Ordering::SeqCst), 128);
    }

    #[test]
    fn owner_panic_wakes_waiter_and_allows_deterministic_retry() {
        for generation in 1..=100 {
            let coordinator = CleanupCoordinator::default();
            let key = CleanupKey::new("main", format!("ses_panic_{generation:032x}"), generation);
            let (owner_started_tx, owner_started_rx) = mpsc::channel();
            let (release_tx, release_rx) = mpsc::channel();
            let owner_coordinator = coordinator.clone();
            let owner_key = key.clone();
            let owner = thread::spawn(move || {
                owner_coordinator.run(owner_key, || -> CleanupTerminal {
                    owner_started_tx.send(()).unwrap();
                    release_rx.recv().unwrap();
                    panic!("synthetic cleanup owner panic");
                })
            });
            owner_started_rx.recv().unwrap();

            let (waiter_ready_tx, waiter_ready_rx) = mpsc::channel();
            let waiter_coordinator = coordinator.clone();
            let waiter_key = key.clone();
            let waiter = thread::spawn(move || {
                waiter_coordinator.run_with_waiter_ready(
                    waiter_key,
                    || waiter_ready_tx.send(()).unwrap(),
                    || CleanupTerminal::Complete {
                        removed_entry_count: 99,
                    },
                )
            });
            waiter_ready_rx.recv().unwrap();
            release_tx.send(()).unwrap();
            assert_eq!(owner.join().unwrap(), CleanupTerminal::Required);
            assert_eq!(waiter.join().unwrap(), CleanupTerminal::Required);
            assert_eq!(coordinator.cached(&key), None);
            assert_eq!(
                coordinator.run(key, || CleanupTerminal::Complete {
                    removed_entry_count: 1,
                }),
                CleanupTerminal::Complete {
                    removed_entry_count: 1
                }
            );
        }
    }

    #[test]
    fn panic_recovery_is_stable_across_one_hundred_retries() {
        for generation in 1..=100 {
            let coordinator = CleanupCoordinator::default();
            let key = CleanupKey::new("main", format!("ses_panic_{generation:032x}"), generation);
            assert_eq!(
                coordinator.run(key.clone(), || -> CleanupTerminal {
                    panic!("synthetic owner panic");
                }),
                CleanupTerminal::Required
            );
            assert_eq!(coordinator.cached(&key), None);
            assert!(coordinator
                .run(key, || CleanupTerminal::Complete {
                    removed_entry_count: 1,
                })
                .is_complete());
        }
    }
}
