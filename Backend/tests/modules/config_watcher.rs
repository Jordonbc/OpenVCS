// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

use super::{begin_config_reload, event_targets_config};
use std::path::PathBuf;
use std::thread;
use std::time::Duration;

#[test]
/// Verifies watcher path matching covers config file and temp sibling names.
fn matches_config_and_temp_paths() {
    let config = PathBuf::from("/tmp/openvcs/config.toml");
    assert!(event_targets_config(&[config.clone()], &config));
    assert!(event_targets_config(&[PathBuf::from("/tmp/openvcs/config.toml.tmp")], &config));
    assert!(!event_targets_config(&[PathBuf::from("/tmp/openvcs/other.toml")], &config));
}

#[test]
/// Verifies reload debounce blocks back-to-back triggers and then clears.
fn debounces_reload_start() {
    let guard = begin_config_reload().expect("first reload should begin");
    assert!(begin_config_reload().is_none());
    drop(guard);
    thread::sleep(Duration::from_millis(260));
    assert!(begin_config_reload().is_some());
}
