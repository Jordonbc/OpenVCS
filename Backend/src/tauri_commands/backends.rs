// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later
use std::path::Path;
use std::sync::Arc;

use log::{error, info, warn};
use tauri::{async_runtime, State};

use openvcs_core::BackendId;
use std::collections::BTreeMap;

use crate::plugin_vcs_backends;
use crate::repo::Repo;
use crate::state::AppState;

#[tauri::command]
/// Lists VCS backends currently available from plugins.
///
/// # Parameters
/// - `state`: Shared application state.
///
/// # Returns
/// - A list of `(backend_id, display_name)` tuples.
pub fn list_vcs_backends_cmd(state: State<'_, AppState>) -> Vec<(String, String)> {
    info!("list_vcs_backends_cmd called");

    let mut map: BTreeMap<String, String> = BTreeMap::new();

    if let Ok(plugin_bes) = plugin_vcs_backends::list_plugin_vcs_backends() {
        for p in plugin_bes {
            let label = p
                .backend_name
                .clone()
                .or_else(|| p.plugin_name.clone())
                .unwrap_or_else(|| p.backend_id.as_ref().to_string());
            // Prefer plugin-provided VCS backends when IDs overlap.
            map.insert(p.backend_id.as_ref().to_string(), label);
        }
    }

    let backends: Vec<(String, String)> = map.into_iter().collect();

    if backends.len() == 1 {
        let only_backend_id = backends[0].0.as_str();
        let mut cfg = state.config();
        if cfg.general.default_backend.trim() != only_backend_id {
            cfg.general.default_backend = only_backend_id.to_string();
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
    }

    info!("Found {} registered VCS backends", backends.len());
    for (id, name) in &backends {
        info!("  - {} ({})", id, name);
    }

    backends
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
