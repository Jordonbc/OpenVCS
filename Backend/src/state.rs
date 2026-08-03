// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later
//! Application-level mutable state and persistence helpers.

use std::{fs, io};
use std::{path::PathBuf, sync::Arc};

use log::{debug, info};
use parking_lot::RwLock;

use crate::output_log::OutputLogEntry;
use crate::plugin_runtime::PluginRuntimeManager;
use crate::repo::Repo;
use crate::repo_settings::RepoConfig;
use crate::settings::AppConfig;
use serde::{Deserialize, Serialize};

/// Default number of recent repositories stored when settings are missing or invalid.
pub const MAX_RECENTS: usize = 10;

/// A recent repository entry with its VCS backend ID.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct RecentEntry {
    /// Repository path.
    pub path: PathBuf,
    /// VCS backend ID that opened this repo (e.g. "git", "lore").
    pub backend_id: String,
}

/// Central application state.
/// Keeps track of the currently open repo and MRU recents with backend IDs.
#[derive(Default)]
pub struct AppState {
    /// Global settings (loaded on startup), thread-safe.
    config: RwLock<AppConfig>,

    /// Repository-specific settings (in-memory for now)
    repo_config: RwLock<RepoConfig>,

    /// In-memory output log (VCS commands/output)
    output_log: RwLock<Vec<OutputLogEntry>>,

    /// Currently open repository
    current_repo: RwLock<Option<Arc<Repo>>>,

    /// MRU list for "Recents" — each entry stores path + backend_id
    recents: RwLock<Vec<RecentEntry>>,

    /// Long-lived plugin process runtime manager.
    plugin_runtime: Arc<PluginRuntimeManager>,
}

impl AppState {
    /// Creates app state from a preloaded settings snapshot and recent repositories.
    ///
    /// # Returns
    /// - A fully initialized [`AppState`] with config and recent repositories loaded.
    pub fn new_with_config(cfg: AppConfig) -> Self {
        let s = Self {
            config: RwLock::new(cfg),
            repo_config: RwLock::new(RepoConfig::default()),
            output_log: RwLock::new(Vec::new()),
            ..Default::default()
        };
        // Attempt to load recents from app data (not config dir)
        if let Ok(list) = load_recents_from_disk() {
            *s.recents.write() = list;
        }
        s
    }

    // Persist current config to disk.

    /* -------- config access -------- */

    /// Snapshot of current config (cheap clone; sections are small).
    ///
    /// # Returns
    /// - A cloned [`AppConfig`] representing the current global settings.
    pub fn config(&self) -> AppConfig {
        self.config.read().clone()
    }

    /// Replace whole config: validate → save → swap (readers never see an unsaved state).
    ///
    /// # Parameters
    /// - `next`: New config value to validate, normalize, persist, and install.
    ///
    /// # Returns
    /// - `Ok(())` when the config was saved and applied.
    /// - `Err(String)` if persistence fails.
    pub fn set_config(&self, mut next: AppConfig) -> Result<(), String> {
        next.validate();
        next.save().map_err(|e| e.to_string())?;
        crate::monitoring::sync_backend_monitoring(&next);
        crate::plugin_vcs_backends::invalidate_plugin_vcs_backend_cache();
        *self.config.write() = next;
        self.enforce_recents_limit_and_persist();
        Ok(())
    }

    /* -------- repo config -------- */

    /// Replaces repository-local settings kept in memory.
    ///
    /// # Parameters
    /// - `cfg`: Repository-local settings to store.
    ///
    /// # Returns
    /// - `Ok(())` after updating the in-memory state.
    pub fn set_repo_config(&self, cfg: RepoConfig) -> Result<(), String> {
        *self.repo_config.write() = cfg;
        Ok(())
    }

    /* -------- output log -------- */

    /// Appends a log entry to the in-memory output log and enforces size limits.
    ///
    /// # Parameters
    /// - `entry`: Output event to append.
    ///
    /// # Returns
    /// - `()`.
    pub fn push_output_log(&self, entry: OutputLogEntry) {
        const MAX: usize = 2000;
        let mut log = self.output_log.write();
        log.push(entry);
        if log.len() > MAX {
            let extra = log.len() - MAX;
            log.drain(0..extra);
        }
    }

    /// Returns the current in-memory output log snapshot.
    ///
    /// # Returns
    /// - A cloned list of [`OutputLogEntry`] values.
    pub fn output_log(&self) -> Vec<OutputLogEntry> {
        self.output_log.read().clone()
    }

    /// Clears all in-memory output log entries.
    ///
    /// # Returns
    /// - `()`.
    pub fn clear_output_log(&self) {
        self.output_log.write().clear();
    }

    /* -------- repo lifecycle -------- */

    /// Sets the active repository and updates the recent repository list.
    ///
    /// # Parameters
    /// - `repo`: Opened repository handle to make active.
    ///
    /// # Returns
    /// - `()`.
    pub fn set_current_repo(&self, repo: Arc<Repo>) {
        let path = repo.inner().workdir().to_path_buf();
        let backend_id = repo.id().as_ref().to_string();

        info!(
            "AppState: set current repo (backend={}, path={})",
            backend_id,
            path.display()
        );

        *self.current_repo.write() = Some(repo);

        // Update recents (front insert, unique, cap N from settings)
        let mut r = self.recents.write();
        r.retain(|entry| entry.path != path);
        r.insert(
            0,
            RecentEntry {
                path: path.clone(),
                backend_id: backend_id.clone(),
            },
        );
        let limit = self.config.read().ux.recents_limit as usize;
        let max_items = if limit == 0 { MAX_RECENTS } else { limit };
        if r.len() > max_items {
            r.truncate(max_items);
        }

        debug!(
            "AppState: recents -> [{}]",
            r.iter()
                .map(|entry| format!("{} ({})", entry.path.display(), entry.backend_id))
                .collect::<Vec<_>>()
                .join(", ")
        );

        // Persist recents; ignore failures but log
        if let Err(e) = save_recents_to_disk(&r.clone()) {
            // clone small vec
            log::warn!("AppState: failed to persist recents: {}", e);
        }
    }

    /// Clears the currently active repository.
    ///
    /// # Returns
    /// - `()`.
    pub fn clear_current_repo(&self) {
        *self.current_repo.write() = None;
        info!("AppState: cleared current repository");
    }

    /* -------- getters -------- */

    /// Returns the currently active repository, if one is open.
    ///
    /// # Returns
    /// - `Some(Arc<Repo>)` when a repository is active.
    /// - `None` when no repository is currently selected.
    pub fn current_repo(&self) -> Option<Arc<Repo>> {
        self.current_repo.read().clone()
    }

    /// Returns a snapshot of the recent repository list.
    ///
    /// # Returns
    /// - A cloned MRU-ordered list of recent entries (path + backend_id).
    pub fn recents(&self) -> Vec<RecentEntry> {
        self.recents.read().clone()
    }

    /// Returns the shared plugin runtime manager.
    ///
    /// # Returns
    /// - Plugin runtime manager reference.
    pub fn plugin_runtime(&self) -> Arc<PluginRuntimeManager> {
        Arc::clone(&self.plugin_runtime)
    }
}

// ──────────────────────────────────────────────────────────────────────────────
// Recents persistence (outside config dir)
// File format: JSON array of objects { path, backend_id }
// ──────────────────────────────────────────────────────────────────────────────

/// On-disk serialization format.
#[derive(Debug, Clone, Serialize, Deserialize)]
struct RecentFileEntry {
    path: String,
    backend_id: String,
}

/// Returns the path for persisted recent repositories JSON file.
///
/// # Returns
/// - Recents file path.
fn recents_file_path() -> PathBuf {
    if let Some(pd) = crate::app_identity::project_dirs() {
        pd.data_dir().join("recents.json")
    } else {
        PathBuf::from("recents.json")
    }
}

/// Loads recent repositories from disk.
///
/// # Returns
/// - `Ok(Vec<RecentEntry>)` loaded recent entries (path + backend_id).
/// - `Err(String)` on read failures.
fn load_recents_from_disk() -> Result<Vec<RecentEntry>, String> {
    let p = recents_file_path();
    let data = match fs::read_to_string(&p) {
        Ok(s) => s,
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(vec![]),
        Err(e) => return Err(format!("read recents: {e}")),
    };

    // Canonical format only: JSON array of { path, backend_id } objects.
    // Legacy string-only entries, missing/blank backend_id, and malformed
    // rows are skipped. A malformed or non-array file yields empty recents;
    // the file is left untouched until the next normal save (canonical overwrite).
    let items = match serde_json::from_str::<serde_json::Value>(&data) {
        Ok(serde_json::Value::Array(items)) => items,
        Ok(_) | Err(_) => {
            debug!("AppState: recents file has unsupported shape; ignoring it");
            return Ok(vec![]);
        }
    };

    let mut out: Vec<RecentEntry> = Vec::new();
    for it in items {
        let serde_json::Value::Object(map) = it else {
            debug!("AppState: skipping non-object recents entry");
            continue;
        };
        let path = map
            .get("path")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim()
            .to_string();
        let backend_id = map
            .get("backend_id")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim()
            .to_string();
        if path.is_empty() || backend_id.is_empty() {
            debug!("AppState: skipping recents entry with missing path or backend_id");
            continue;
        }
        out.push(RecentEntry {
            path: PathBuf::from(&path),
            backend_id,
        });
    }
    Ok(out)
}

/// Persists recent repositories to disk.
///
/// # Parameters
/// - `list`: Recent repository entries (path + backend_id) to persist.
///
/// # Returns
/// - `Ok(())` on success.
/// - `Err(String)` on serialization/write failures.
fn save_recents_to_disk(list: &[RecentEntry]) -> Result<(), String> {
    #[cfg(test)]
    crate::app_identity::assert_test_isolation();
    let p = recents_file_path();
    if let Some(parent) = p.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let entries: Vec<RecentFileEntry> = list
        .iter()
        .map(|e| RecentFileEntry {
            path: e.path.to_string_lossy().to_string(),
            backend_id: e.backend_id.clone(),
        })
        .collect();
    let json = serde_json::to_string_pretty(&entries).map_err(|e| e.to_string())?;
    fs::write(&p, json).map_err(|e| e.to_string())
}

impl AppState {
    /// Enforces recents limit from config and persists resulting list.
    ///
    /// # Returns
    /// - `()`.
    fn enforce_recents_limit_and_persist(&self) {
        let limit = self.config.read().ux.recents_limit as usize;
        let max_items = if limit == 0 { MAX_RECENTS } else { limit };
        let mut r = self.recents.write();
        if r.len() > max_items {
            r.truncate(max_items);
        }
        if let Err(e) = save_recents_to_disk(&r.clone()) {
            log::warn!(
                "AppState: failed to persist recents after settings change: {}",
                e
            );
        }
    }
}

#[cfg(test)]
mod tests {
    include!("../tests/modules/state.rs");
}
