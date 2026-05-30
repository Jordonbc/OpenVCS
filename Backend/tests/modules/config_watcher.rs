// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

use super::{begin_config_reload, event_targets_config};
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};
use std::thread;
use std::time::Duration;

fn reload_lock() -> std::sync::MutexGuard<'static, ()> {
    static RELOAD_LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    RELOAD_LOCK
        .get_or_init(|| Mutex::new(()))
        .lock()
        .expect("reload lock")
}

#[test]
/// Verifies watcher path matching covers config file and temp sibling names.
fn matches_config_and_temp_paths() {
    let _lock = reload_lock();
    let config = PathBuf::from("/tmp/openvcs/config.toml");
    assert!(event_targets_config(std::slice::from_ref(&config), &config));
    assert!(event_targets_config(&[PathBuf::from("/tmp/openvcs/config.toml.tmp")], &config));
    assert!(!event_targets_config(&[PathBuf::from("/tmp/openvcs/other.toml")], &config));
}

#[test]
fn ignores_events_when_config_file_name_is_missing() {
    let _lock = reload_lock();
    let config = PathBuf::from("/");
    assert!(!event_targets_config(&[PathBuf::from("/tmp/openvcs/config.toml")], &config));
}

#[test]
/// Verifies reload debounce blocks back-to-back triggers and then clears.
fn debounces_reload_start() {
    let _lock = reload_lock();
    thread::sleep(Duration::from_millis(260));
    let guard = begin_config_reload().expect("first reload should begin");
    assert!(begin_config_reload().is_none());
    drop(guard);
    thread::sleep(Duration::from_millis(260));
    assert!(begin_config_reload().is_some());
}

#[test]
fn in_progress_reload_blocks_parallel_start_until_guard_drops() {
    let _lock = reload_lock();
    thread::sleep(Duration::from_millis(260));
    let guard = begin_config_reload().expect("first reload should begin");
    assert!(begin_config_reload().is_none());
    drop(guard);
    thread::sleep(Duration::from_millis(260));
    let second_guard = begin_config_reload().expect("reload should restart after drop");
    drop(second_guard);
}
