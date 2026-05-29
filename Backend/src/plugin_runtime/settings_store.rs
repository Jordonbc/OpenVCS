// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

//! Filesystem persistence for plugin settings JSON.

use serde_json::{Map, Value};
use std::fs;
use std::path::{Path, PathBuf};

#[cfg(test)]
use parking_lot::RwLock;

#[cfg(test)]
use std::sync::OnceLock;

#[cfg(test)]
static TEST_PLUGIN_DATA_ROOT: OnceLock<RwLock<Option<PathBuf>>> = OnceLock::new();

/// Returns the test-only plugin data root override, when configured.
#[cfg(test)]
fn test_plugin_data_root() -> Option<PathBuf> {
    TEST_PLUGIN_DATA_ROOT
        .get_or_init(|| RwLock::new(None))
        .read()
        .clone()
}

/// Sets the test-only plugin data root override.
#[cfg(test)]
pub(crate) fn set_test_plugin_data_root(root: PathBuf) {
    *TEST_PLUGIN_DATA_ROOT
        .get_or_init(|| RwLock::new(None))
        .write() = Some(root);
}

/// Clears the test-only plugin data root override.
#[cfg(test)]
pub(crate) fn clear_test_plugin_data_root() {
    *TEST_PLUGIN_DATA_ROOT
        .get_or_init(|| RwLock::new(None))
        .write() = None;
}

/// Returns the root plugin data directory under the app config directory.
fn plugin_data_root() -> PathBuf {
    #[cfg(test)]
    if let Some(root) = test_plugin_data_root() {
        return root;
    }

    if let Some(pd) = crate::app_identity::project_dirs() {
        pd.config_dir().join("plugin-data")
    } else {
        PathBuf::from("plugin-data")
    }
}

/// Builds the plugin settings JSON file path for a plugin id.
fn settings_file(plugin_id: &str) -> PathBuf {
    plugin_data_root()
        .join(plugin_id.trim().to_ascii_lowercase())
        .join("settings.json")
}

/// Loads plugin settings from disk.
///
/// # Parameters
/// - `plugin_id`: Plugin id used to resolve settings path.
///
/// # Returns
/// - Loaded JSON object map.
/// - Empty map when no settings file exists.
pub fn load_settings(plugin_id: &str) -> Result<Map<String, Value>, String> {
    let path = settings_file(plugin_id);
    if !path.is_file() {
        return Ok(Map::new());
    }
    let text = fs::read_to_string(&path).map_err(|e| format!("read {}: {e}", path.display()))?;
    let value: Value =
        serde_json::from_str(&text).map_err(|e| format!("parse {}: {e}", path.display()))?;
    Ok(value.as_object().cloned().unwrap_or_default())
}

/// Saves plugin settings to disk using an atomic rename.
///
/// # Parameters
/// - `plugin_id`: Plugin id used to resolve settings path.
/// - `settings`: Settings object map to persist.
///
/// # Returns
/// - `Ok(())` when saved.
/// - `Err(String)` on IO or serialization failure.
pub fn save_settings(plugin_id: &str, settings: &Map<String, Value>) -> Result<(), String> {
    let path = settings_file(plugin_id);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("create {}: {e}", parent.display()))?;
    }
    let data = serde_json::to_string_pretty(settings)
        .map_err(|e| format!("serialize settings for {plugin_id}: {e}"))?;
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, data).map_err(|e| format!("write {}: {e}", tmp.display()))?;
    fs::rename(&tmp, &path)
        .map_err(|e| format!("rename {} -> {}: {e}", tmp.display(), path.display()))
}

/// Removes persisted settings for a plugin.
///
/// # Parameters
/// - `plugin_id`: Plugin id used to resolve settings path.
///
/// # Returns
/// - `Ok(())` when removed or not present.
/// - `Err(String)` on IO failure.
pub fn reset_settings(plugin_id: &str) -> Result<(), String> {
    let path = settings_file(plugin_id);
    remove_file_if_exists(&path)
}

/// Removes a file if it exists.
fn remove_file_if_exists(path: &Path) -> Result<(), String> {
    if path.is_file() {
        fs::remove_file(path).map_err(|e| format!("remove {}: {e}", path.display()))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    include!("../../tests/plugin_runtime/settings_store.rs");
}
