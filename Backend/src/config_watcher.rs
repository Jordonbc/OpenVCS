// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later
//! Watches the user config file and reapplies plugin sync when it changes.

use crate::settings::AppConfig;
use crate::state::AppState;
use log::{info, warn};
use notify::{Config, RecommendedWatcher, RecursiveMode, Watcher};
use parking_lot::Mutex;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use tauri::Manager;

static CONFIG_WATCHER: OnceLock<Mutex<Option<RecommendedWatcher>>> = OnceLock::new();

/// Starts the process-wide config watcher when it is not already running.
///
/// # Parameters
/// - `app_handle`: Tauri app handle used to access application state.
///
/// # Returns
/// - `()`. Failures are logged and leave config watching disabled.
pub fn start_config_watcher<R: tauri::Runtime>(app_handle: tauri::AppHandle<R>) {
    let watcher_slot = CONFIG_WATCHER.get_or_init(|| Mutex::new(None));
    if watcher_slot.lock().is_some() {
        return;
    }

    let config_path = AppConfig::path();
    let watch_root = config_path
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or_else(|| PathBuf::from("."));
    let callback_handle = app_handle.clone();
    let callback_config_path = config_path.clone();

    let watcher = RecommendedWatcher::new(
        move |result: notify::Result<notify::Event>| match result {
            Ok(event) => {
                if !event_targets_config(&event.paths, &callback_config_path) {
                    return;
                }

                let state = callback_handle.state::<AppState>();
                let next = AppConfig::load_or_default();
                if state.config() == next {
                    return;
                }

                if let Err(err) = state.set_config(next.clone()) {
                    warn!("config watcher: failed to persist reloaded config: {}", err);
                    return;
                }
                if let Err(err) =
                    crate::plugin_bundles::PluginBundleStore::new_default().sync_built_in_plugins()
                {
                    warn!("config watcher: built-in sync failed: {}", err);
                }
                if let Err(err) = crate::plugin_sources::sync_configured_plugins(&next) {
                    warn!("config watcher: configured plugin sync failed: {}", err);
                }
                if let Err(err) = state
                    .plugin_runtime()
                    .sync_plugin_runtime_with_config(&next)
                {
                    warn!("config watcher: runtime sync failed: {}", err);
                }
                info!(
                    "config watcher: reloaded {}",
                    callback_config_path.display()
                );
            }
            Err(err) => warn!("config watcher: notify error: {}", err),
        },
        Config::default(),
    );

    let mut watcher = match watcher {
        Ok(watcher) => watcher,
        Err(err) => {
            warn!("config watcher: failed to start watcher: {}", err);
            return;
        }
    };

    if let Err(err) = watcher.watch(&watch_root, RecursiveMode::NonRecursive) {
        warn!(
            "config watcher: failed to watch {}: {}",
            watch_root.display(),
            err
        );
        return;
    }

    *watcher_slot.lock() = Some(watcher);
}

/// Returns whether an event path list targets the OpenVCS config file.
///
/// # Parameters
/// - `paths`: Event path list.
/// - `config_path`: Canonical config file path.
///
/// # Returns
/// - `true` when the event should trigger config reload.
/// - `false` otherwise.
fn event_targets_config(paths: &[PathBuf], config_path: &Path) -> bool {
    let Some(config_name) = config_path.file_name() else {
        return false;
    };
    let config_name = config_name.to_string_lossy().to_string();
    let temp_name = format!("{}.tmp", config_name);

    paths.iter().any(|path| {
        path == config_path
            || path
                .file_name()
                .and_then(|name| name.to_str())
                .is_some_and(|name| name == config_name || name == temp_name)
    })
}
