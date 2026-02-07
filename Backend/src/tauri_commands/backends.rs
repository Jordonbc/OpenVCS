use std::path::Path;
use std::sync::Arc;

use log::{error, info, warn};
use serde_json::Value;
use tauri::{async_runtime, Manager, Runtime, State, Window};

use openvcs_core::BackendId;
use std::collections::BTreeMap;

use crate::plugin_runtime::stdio_rpc::{RpcConfig, SpawnConfig, StdioRpcProcess};
use crate::plugin_vcs_backends;
use crate::repo::Repo;
use crate::state::AppState;
use crate::tauri_commands::shared::progress_bridge;

#[tauri::command]
pub fn list_vcs_backends_cmd() -> Vec<(String, String)> {
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

    info!("Found {} registered VCS backends", backends.len());
    for (id, name) in &backends {
        info!("  - {} ({})", id, name);
    }

    backends
}

#[tauri::command]
pub async fn set_vcs_backend_cmd(
    state: State<'_, AppState>,
    backend_id: BackendId,
) -> Result<(), String> {
    info!(
        "set_vcs_backend_cmd: requested VCS backend = {}",
        backend_id
    );

    let prefer_plugin = plugin_vcs_backends::has_plugin_vcs_backend(&backend_id);
    if !prefer_plugin {
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
#[tauri::command]
pub async fn call_vcs_backend_method<R: Runtime>(
    window: Window<R>,
    backend_id: BackendId,
    method: String,
    params: Value,
) -> Result<Value, String> {
    let backend_id_str = backend_id.as_ref().to_string();
    let method = method.trim().to_string();
    if method.is_empty() {
        return Err("method is empty".to_string());
    }

    let list = plugin_vcs_backends::list_plugin_vcs_backends()?;
    let desc = list
        .into_iter()
        .find(|d| d.backend_id.as_ref() == backend_id.as_ref())
        .ok_or_else(|| format!("Unknown VCS backend: {backend_id_str}"))?;

    // If params contain a `path`, use it as the workspace root for capability checks.
    let allowed_workspace_root = params
        .get("path")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(std::path::PathBuf::from);

    // Run the backend RPC on a blocking thread so the Tauri main thread and
    // webview are not blocked by long-running operations (e.g. LFS transfers).
    let backend_id_clone = backend_id_str.clone();
    let method_clone = method.clone();
    let params_clone = params.clone();
    let desc_clone = desc.clone();
    let on_event = progress_bridge(window.app_handle().clone());

    let call_task = async_runtime::spawn_blocking(move || {
        let rpc = StdioRpcProcess::new(
            SpawnConfig {
                plugin_id: desc_clone.plugin_id,
                component_label: format!("vcs-backend-{}", backend_id_clone),
                exec_path: desc_clone.exec_path,
                args: vec!["--backend".into(), backend_id_clone.clone()],
                requested_capabilities: desc_clone.requested_capabilities,
                approval: desc_clone.approval,
                allowed_workspace_root,
            },
            RpcConfig::default(),
        );
        rpc.set_event_sink(Some(on_event));

        rpc.call(&method_clone, params_clone)
    });

    let call_res = call_task
        .await
        .map_err(|e| format!("call_vcs_backend_method task failed: {e}"))?;

    call_res.map_err(|e| format!("{}: {}", e.code, e.message))
}
