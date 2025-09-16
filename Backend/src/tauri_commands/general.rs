use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use log::{error, info, warn};
use tauri::{async_runtime, Emitter, Manager, Runtime, State, Window};

use openvcs_core::backend_descriptor::get_backend;
use openvcs_core::{backend_id, BackendId, Repo};

use crate::state::AppState;
use crate::utilities::utilities;
use crate::validate;

use super::progress_bridge;

#[derive(serde::Serialize)]
struct RepoSelectedPayload {
    path: String,
    backend: String,
}

#[tauri::command]
pub fn about_info() -> utilities::AboutInfo {
    utilities::AboutInfo::gather()
}

#[tauri::command]
pub fn show_licenses() -> Result<(), String> {
    Ok(())
}

#[tauri::command]
pub async fn browse_directory<R: Runtime>(
    window: Window<R>,
    purpose: Option<String>,
) -> Option<String> {
    let title = match purpose.as_deref() {
        Some("clone_dest") => "Choose destination folder",
        Some("add_repo") => "Select an existing Git repository folder",
        _ => "Select a folder",
    };
    utilities::browse_directory_async(window.app_handle().clone(), title).await
}

#[tauri::command]
pub async fn add_repo<R: Runtime>(
    window: Window<R>,
    state: State<'_, AppState>,
    path: String,
    backend_id: Option<BackendId>,
) -> Result<(), String> {
    let be = backend_id.unwrap_or_else(|| backend_id!("git-system"));
    add_repo_internal(window, state, path, be).await
}

pub async fn add_repo_internal<R: Runtime>(
    window: Window<R>,
    state: State<'_, AppState>,
    path: String,
    backend_id: BackendId,
) -> Result<(), String> {
    info!(
        "add_repo: requested path = {}, backend = {}",
        path, backend_id
    );

    if !Path::new(&path).exists() {
        let m = format!("Path does not exist: {}", path);
        error!("{m}");
        return Err(m);
    }

    let desc = get_backend(&backend_id).ok_or_else(|| {
        let m = format!("Backend not found: {backend_id}");
        error!("{m}");
        m
    })?;
    let open_path = path.clone();
    let handle = async_runtime::spawn_blocking(move || (desc.open)(Path::new(&open_path)))
        .await
        .map_err(|e| format!("add_repo task failed: {e}"))?
        .map_err(|e| {
            let m = format!("Failed to open repo with backend `{backend_id}`: {e}");
            error!("{m}");
            m
        })?;

    let repo = Arc::new(Repo::new(handle));
    state.set_current_repo(repo);

    let payload = RepoSelectedPayload {
        path: path.clone(),
        backend: backend_id.as_ref().to_owned(),
    };
    if let Err(e) = window.app_handle().emit("repo:selected", &payload) {
        warn!("add_repo: failed to emit repo:selected: {}", e);
    }

    info!(
        "add_repo: repository opened and stored (backend = {})",
        backend_id
    );
    Ok(())
}

#[tauri::command]
pub async fn clone_repo<R: Runtime>(
    window: Window<R>,
    state: State<'_, AppState>,
    url: String,
    dest: String,
    backend_id: Option<BackendId>,
) -> Result<(), String> {
    let be = backend_id.unwrap_or_else(|| backend_id!("git-system"));
    let desc = get_backend(&be).ok_or_else(|| format!("Backend not found: {be}"))?;

    let folder = infer_repo_dir_from_url(&url);
    if folder.is_empty() {
        return Err("Cannot infer target directory from URL".into());
    }
    let target: PathBuf = Path::new(&dest).join(&folder);

    fs::create_dir_all(&dest).map_err(|e| format!("Failed to create dest: {e}"))?;

    let clone_url = url.clone();
    let clone_target = target.clone();
    let be_label = be.as_ref().to_string();
    let app_handle = window.app_handle().clone();
    async_runtime::spawn_blocking(move || {
        let on = Some(progress_bridge(app_handle));
        info!(
            "clone_repo: cloning via backend {} into {}",
            be_label,
            clone_target.display()
        );
        (desc.clone_repo)(&clone_url, &clone_target, on)
    })
    .await
    .map_err(|e| format!("clone_repo task failed: {e}"))?
    .map_err(|e| format!("Clone failed: {e}"))?;

    add_repo_internal(window, state, target.to_string_lossy().to_string(), be).await
}

#[tauri::command]
pub fn validate_git_url(url: String) -> validate::Validation {
    validate::validate_git_url(url)
}

#[tauri::command]
pub fn validate_add_path(path: String) -> validate::Validation {
    validate::validate_add_path(path)
}

#[tauri::command]
pub fn validate_clone_input(url: String, dest: String) -> validate::Validation {
    validate::validate_clone_input(url, dest)
}

#[tauri::command]
pub fn current_repo_path(state: State<'_, AppState>) -> Option<String> {
    state
        .current_repo()
        .map(|repo| repo.inner().workdir().to_string_lossy().to_string())
}

#[derive(serde::Serialize)]
pub struct RecentRepoDto {
    path: String,
    name: Option<String>,
}

#[tauri::command]
pub fn list_recent_repos(state: State<'_, AppState>) -> Vec<RecentRepoDto> {
    state
        .recents()
        .into_iter()
        .map(|p| {
            let name = p
                .file_name()
                .and_then(|os| os.to_str())
                .map(|s| s.to_string());
            RecentRepoDto {
                path: p.to_string_lossy().to_string(),
                name,
            }
        })
        .collect()
}

#[tauri::command]
pub async fn open_repo<R: Runtime>(
    window: Window<R>,
    state: State<'_, AppState>,
    path: String,
    backend_id: Option<BackendId>,
) -> Result<(), String> {
    let be = backend_id.unwrap_or_else(|| backend_id!("git-system"));
    add_repo_internal(window, state, path, be).await
}

fn infer_repo_dir_from_url(url: &str) -> String {
    let trimmed = url.trim_end_matches('/');
    let last = trimmed.rsplit('/').next().unwrap_or(trimmed);
    last.trim_end_matches(".git").to_string()
}
