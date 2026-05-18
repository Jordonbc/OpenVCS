// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

use super::AppState;
use crate::output_log::{OutputLevel, OutputLogEntry};
use crate::repo_settings::RepoConfig;
use crate::settings::AppConfig;
use std::sync::Arc;

#[test]
/// Verifies app state snapshots config and owns a shared runtime manager.
fn constructs_state_from_config() {
    let cfg = AppConfig::default();
    let state = AppState::new_with_config(cfg.clone());
    assert_eq!(state.config(), cfg);
    assert!(Arc::strong_count(&state.plugin_runtime()) >= 1);
}

#[test]
/// Verifies repo config updates are stored in memory.
fn stores_repo_config_in_memory() {
    let state = AppState::new_with_config(AppConfig::default());
    let repo_cfg = RepoConfig {
        user_name: Some("Alice".into()),
        user_email: Some("alice@example.com".into()),
        origin_url: None,
        remotes: None,
    };
    assert!(state.set_repo_config(repo_cfg).is_ok());
}

#[test]
/// Verifies output log entries append and clear in memory.
fn manages_output_log_entries() {
    let state = AppState::new_with_config(AppConfig::default());
    state.push_output_log(OutputLogEntry::new(1, OutputLevel::Info, "core", "hello"));
    state.push_output_log(OutputLogEntry::new(2, OutputLevel::Warn, "core", "warn"));
    assert_eq!(state.output_log().len(), 2);

    state.clear_output_log();
    assert!(state.output_log().is_empty());
}
