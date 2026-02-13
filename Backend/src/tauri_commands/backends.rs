use std::path::{Path, PathBuf};
use std::sync::Arc;

use log::{error, info, warn};
use serde_json::Value;
use tauri::{async_runtime, Manager, Runtime, State, Window};

use openvcs_core::BackendId;
use std::collections::BTreeMap;

use crate::plugin_runtime::runtime_select::create_runtime_instance;
use crate::plugin_runtime::stdio_rpc::SpawnConfig;
use crate::plugin_vcs_backends;
use crate::repo::Repo;
use crate::state::AppState;
use crate::tauri_commands::shared::progress_bridge;

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
        let handle = async_runtime::spawn_blocking(move || {
            plugin_vcs_backends::open_repo_via_plugin_vcs_backend(backend_id, Path::new(&open_path))
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
    let handle = async_runtime::spawn_blocking(move || {
        plugin_vcs_backends::open_repo_via_plugin_vcs_backend(backend_id, Path::new(&open_path))
    })
    .await
    .map_err(|e| format!("reopen_current_repo_cmd task failed: {e}"))?
    .map_err(|e| format!("Failed to reopen repo with `{backend_label}`: {e}"))?;

    let new_repo = Arc::new(Repo::new(handle));
    state.set_current_repo(new_repo);
    Ok(())
}

/// Call an arbitrary RPC method on a VCS backend module.
///
/// This is intentionally backend-agnostic so plugin UI can access backend-specific helpers
/// (e.g. Git LFS) without hardcoding them into the host's generic VCS trait.
///
/// # Parameters
/// - `window`: Calling Tauri window handle.
/// - `state`: Shared application state.
/// - `backend_id`: Backend id to invoke.
/// - `method`: RPC method name.
/// - `params`: JSON payload passed to the backend method.
///
/// # Returns
/// - `Ok(Value)` containing the backend method result.
/// - `Err(String)` when validation, backend resolution, or RPC execution fails.
#[tauri::command]
pub async fn call_vcs_backend_method<R: Runtime>(
    window: Window<R>,
    state: State<'_, AppState>,
    backend_id: BackendId,
    method: String,
    params: Value,
) -> Result<Value, String> {
    let backend_id_str = backend_id.as_ref().to_string();
    let method = method.trim().to_string();
    if method.is_empty() {
        return Err("method is empty".to_string());
    }

    let desc = plugin_vcs_backends::plugin_vcs_backend_descriptor(&backend_id)
        .map_err(|_| format!("Unknown VCS backend: {backend_id_str}"))?;

    let repo_root = state
        .current_repo()
        .map(|repo| repo.inner().workdir().to_path_buf())
        .ok_or_else(|| "No repository selected".to_string())?;
    let allowed_workspace_root = resolve_allowed_workspace_root(&repo_root, &params)?;

    // Run the backend RPC on a blocking thread so the Tauri main thread and
    // webview are not blocked by long-running operations (e.g. LFS transfers).
    let backend_id_clone = backend_id_str.clone();
    let method_clone = method.clone();
    let params_clone = params.clone();
    let desc_clone = desc.clone();
    let on_event = progress_bridge(window.app_handle().clone());

    let call_task = async_runtime::spawn_blocking(move || {
        let runtime = create_runtime_instance(SpawnConfig {
            plugin_id: desc_clone.plugin_id,
            component_label: format!("vcs-backend-{}", backend_id_clone),
            exec_path: desc_clone.exec_path,
            args: Vec::new(),
            requested_capabilities: desc_clone.requested_capabilities,
            approval: desc_clone.approval,
            allowed_workspace_root,
        });
        runtime.set_event_sink(Some(on_event));
        let call = runtime.call(&method_clone, params_clone);
        runtime.stop();
        call
    });

    let call_res = call_task
        .await
        .map_err(|e| format!("call_vcs_backend_method task failed: {e}"))?;

    call_res
}

/// Resolves optional backend workspace path and enforces repo-root confinement.
///
/// # Parameters
/// - `repo_root`: Repository root path.
/// - `params`: Backend method params.
///
/// # Returns
/// - `Ok(Some(PathBuf))` resolved workspace path.
/// - `Ok(None)` when no path restriction should be applied.
/// - `Err(String)` when requested path escapes repo root.
fn resolve_allowed_workspace_root(
    repo_root: &Path,
    params: &Value,
) -> Result<Option<PathBuf>, String> {
    let repo_root = std::fs::canonicalize(repo_root)
        .map_err(|e| format!("Failed to resolve repository root: {e}"))?;

    let requested = params
        .get("path")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(PathBuf::from);

    let Some(requested) = requested else {
        return Ok(Some(repo_root));
    };

    let requested_abs = if requested.is_absolute() {
        requested
    } else {
        repo_root.join(requested)
    };
    let requested_abs = std::fs::canonicalize(&requested_abs)
        .map_err(|e| format!("Invalid backend workspace path: {e}"))?;

    if requested_abs == repo_root || requested_abs.starts_with(&repo_root) {
        Ok(Some(requested_abs))
    } else {
        Err(format!(
            "Backend workspace path escapes repository root: {}",
            requested_abs.display()
        ))
    }
}
