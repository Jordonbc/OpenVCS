// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later
use std::path::Path;
use std::sync::Arc;

use log::{error, info, warn};
use tauri::{State, async_runtime};

use std::collections::BTreeMap;

use crate::core::BackendId;
use crate::plugin_vcs_backends;
use crate::repo::Repo;
use crate::settings::DEFAULT_BACKEND_ID;
use crate::state::AppState;

/// Response payload for the `list_vcs_backends_cmd` IPC command.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ListVcsBackendsResponse {
    /// Available `(backend_id, display_label)` entries.
    pub backends: Vec<(String, String)>,
    /// Backend id shown as selected when no explicit default is configured.
    pub default_backend_id: String,
}

/// Resolves the display label shown for a backend entry.
fn backend_display_label(
    backend_name: Option<&str>,
    plugin_name: Option<&str>,
    backend_id: &BackendId,
) -> String {
    backend_name
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .or_else(|| {
            plugin_name
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string)
        })
        .unwrap_or_else(|| backend_id.as_ref().to_string())
}

/// Returns the sole backend id that should become the default when exactly one backend exists.
fn auto_default_backend_id(current_default: &str, backends: &[(String, String)]) -> Option<String> {
    if backends.len() != 1 {
        return None;
    }

    let only_backend_id = backends[0].0.trim();
    if only_backend_id.is_empty() || current_default.trim() == only_backend_id {
        None
    } else {
        Some(only_backend_id.to_string())
    }
}

#[tauri::command]
/// Lists VCS backends currently available from plugins.
///
/// # Parameters
/// - `state`: Shared application state.
///
/// # Returns
/// - A [`ListVcsBackendsResponse`] with `(backend_id, display_name)` entries
///   and the default backend id.
pub fn list_vcs_backends_cmd(state: State<'_, AppState>) -> ListVcsBackendsResponse {
    info!("list_vcs_backends_cmd called");

    let mut map: BTreeMap<String, String> = BTreeMap::new();

    if let Ok(plugin_bes) = plugin_vcs_backends::list_plugin_vcs_backends() {
        for p in plugin_bes {
            let label = backend_display_label(
                p.backend_name.as_deref(),
                p.plugin_name.as_deref(),
                &p.backend_id,
            );
            // Prefer plugin-provided VCS backends when IDs overlap.
            map.insert(p.backend_id.as_ref().to_string(), label);
        }
    }

    let backends: Vec<(String, String)> = map.into_iter().collect();

    if let Some(only_backend_id) =
        auto_default_backend_id(&state.config().general.default_backend, &backends)
    {
        let mut cfg = state.config();
        cfg.general.default_backend = only_backend_id.clone();
        if let Err(err) = state.set_config(cfg) {
            warn!(
                "list_vcs_backends_cmd: failed to persist auto default backend `{}`: {}",
                only_backend_id, err
            );
        } else {
            info!(
                "list_vcs_backends_cmd: auto-selected sole backend `{}` as default",
                only_backend_id
            );
        }
    }

    info!("Found {} registered VCS backends", backends.len());
    for (id, name) in &backends {
        info!("  - {} ({})", id, name);
    }

    ListVcsBackendsResponse {
        backends,
        default_backend_id: DEFAULT_BACKEND_ID.to_string(),
    }
}

#[tauri::command]
/// Returns the action-label map for the currently selected backend.
///
/// # Parameters
/// - `state`: Shared application state.
///
/// # Returns
/// - A list of `(action_key, label)` tuples for the active backend.
pub fn current_vcs_action_labels(
    state: State<'_, AppState>,
) -> Result<Vec<(String, String)>, String> {
    let repo = state
        .current_repo()
        .ok_or_else(|| "No repository selected".to_string())?;
    let desc = plugin_vcs_backends::plugin_vcs_backend_descriptor(&repo.id())?;
    Ok(desc.action_labels.into_iter().collect())
}

#[tauri::command]
/// Sets the default backend and reopens the current repository with it when possible.
///
/// # Parameters
/// - `state`: Shared application state.
/// - `backend_id`: Backend id to activate.
///
/// # Returns
/// - `Ok(())` when backend selection/reopen succeeds.
/// - `Err(String)` when the backend id is unknown or reopen fails.
pub async fn set_vcs_backend_cmd(
    state: State<'_, AppState>,
    backend_id: BackendId,
) -> Result<(), String> {
    info!(
        "set_vcs_backend_cmd: requested VCS backend = {}",
        backend_id
    );

    if plugin_vcs_backends::plugin_vcs_backend_descriptor(&backend_id).is_err() {
        warn!("set_vcs_backend_cmd: unknown VCS backend `{}`", backend_id);
        return Err(format!("Unknown VCS backend: {backend_id}"));
    }

    if let Some(repo) = state.current_repo() {
        let path = repo.inner().workdir().to_path_buf();
        info!(
            "set_vcs_backend_cmd: reopening current repo with backend {} → {}",
            repo.id(),
            backend_id
        );

        let open_path = path.clone();
        let backend_label = backend_id.as_ref().to_string();
        let cfg = state.config();
        let runtime_manager = state.plugin_runtime();
        let handle = async_runtime::spawn_blocking(move || {
            plugin_vcs_backends::open_repo_via_plugin_vcs_backend(
                runtime_manager.as_ref(),
                &cfg,
                backend_id,
                Path::new(&open_path),
            )
        })
        .await
        .map_err(|e| format!("set_vcs_backend_cmd task failed: {e}"))?
        .map_err(|e| {
            error!(
                "set_vcs_backend_cmd: failed to reopen repo '{}' with backend `{}`: {}",
                path.display(),
                backend_label,
                e
            );
            format!("Failed to reopen repo with `{backend_label}`: {e}")
        })?;

        let new_repo = Arc::new(Repo::new(handle));
        state.set_current_repo(new_repo);
        info!(
            "set_vcs_backend_cmd: repo reopened with backend `{}` (path={})",
            backend_label,
            path.display()
        );
    } else {
        info!(
            "set_vcs_backend_cmd: no repo open; will use `{}` when opening a repo",
            backend_id
        );
    }

    Ok(())
}

#[tauri::command]
/// Reopens the currently selected repository using its current backend id.
///
/// # Parameters
/// - `state`: Shared application state.
///
/// # Returns
/// - `Ok(())` when no repo is open or reopen succeeds.
/// - `Err(String)` when reopen fails.
pub async fn reopen_current_repo_cmd(state: State<'_, AppState>) -> Result<(), String> {
    let Some(repo) = state.current_repo() else {
        return Ok(());
    };

    let backend_id = repo.id();
    let path = repo.inner().workdir().to_path_buf();

    let backend_label = backend_id.as_ref().to_string();
    let open_path = path.clone();
    let cfg = state.config();
    let runtime_manager = state.plugin_runtime();
    let handle = async_runtime::spawn_blocking(move || {
        plugin_vcs_backends::open_repo_via_plugin_vcs_backend(
            runtime_manager.as_ref(),
            &cfg,
            backend_id,
            Path::new(&open_path),
        )
    })
    .await
    .map_err(|e| format!("reopen_current_repo_cmd task failed: {e}"))?
    .map_err(|e| format!("Failed to reopen repo with `{backend_label}`: {e}"))?;

    let new_repo = Arc::new(Repo::new(handle));
    state.set_current_repo(new_repo);
    Ok(())
}

#[cfg(test)]
mod tests {
    include!("../../tests/tauri_commands/backends.rs");
}
