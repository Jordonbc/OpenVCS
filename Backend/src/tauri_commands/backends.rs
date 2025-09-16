use std::path::Path;
use std::sync::Arc;

use log::{error, info, warn};
use tauri::{async_runtime, State};

use openvcs_core::backend_descriptor::{get_backend, list_backends};
use openvcs_core::{BackendId, Repo};

use crate::state::AppState;

#[tauri::command]
pub fn list_backends_cmd() -> Vec<(String, String)> {
    info!("list_backends_cmd called");

    let backends: Vec<(String, String)> = list_backends()
        .map(|b| (b.id.as_ref().to_string(), b.name.to_string()))
        .collect();

    info!("Found {} registered backends", backends.len());
    for (id, name) in &backends {
        info!("  - {} ({})", id, name);
    }

    backends
}

#[tauri::command]
pub async fn set_backend_cmd(
    state: State<'_, AppState>,
    backend_id: BackendId,
) -> Result<(), String> {
    info!("set_backend_cmd: requested backend = {}", backend_id);

    let desc = match get_backend(&backend_id) {
        Some(d) => d,
        None => {
            warn!("set_backend_cmd: unknown backend `{}`", backend_id);
            return Err(format!("Unknown backend: {backend_id}"));
        }
    };

    if let Some(repo) = state.current_repo() {
        let path = repo.inner().workdir().to_path_buf();
        info!(
            "set_backend_cmd: reopening current repo with backend {} → {}",
            repo.id(),
            backend_id
        );

        let open_path = path.clone();
        let backend_label = backend_id.as_ref().to_string();
        let handle = async_runtime::spawn_blocking(move || (desc.open)(Path::new(&open_path)))
            .await
            .map_err(|e| format!("set_backend_cmd task failed: {e}"))?
            .map_err(|e| {
                error!(
                    "set_backend_cmd: failed to reopen repo '{}' with backend `{}`: {}",
                    path.display(),
                    backend_label,
                    e
                );
                format!("Failed to reopen repo with `{backend_label}`: {e}")
            })?;

        let new_repo = Arc::new(Repo::new(handle));
        state.set_current_repo(new_repo);
        info!(
            "set_backend_cmd: repo reopened with backend `{}` (path={})",
            backend_label,
            path.display()
        );
    } else {
        info!(
            "set_backend_cmd: no repo open; will use `{}` when opening a repo",
            backend_id
        );
    }

    Ok(())
}
