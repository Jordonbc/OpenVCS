// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use log::{error, info, warn};
use tauri::{async_runtime, Emitter, Manager, Runtime, State, Window};
use tauri_plugin_opener::OpenerExt;
use tauri_plugin_updater::UpdaterExt;

use crate::core::BackendId;
use crate::plugin_vcs_backends;
use crate::repo::Repo;
use crate::state::AppState;
use crate::utilities::utilities;
use crate::validate;

use super::progress_bridge;

const WIKI_URL: &str = "https://github.com/jordonbc/OpenVCS/wiki";

#[derive(serde::Serialize)]
/// Event payload emitted after selecting/opening a repository.
struct RepoSelectedPayload {
    /// Selected repository path.
    path: String,
    /// Backend identifier that opened the repository.
    backend: String,
}

#[tauri::command]
/// Returns static build/runtime information shown in the About dialog.
///
/// # Returns
/// - A populated [`utilities::AboutInfo`] payload.
pub fn about_info() -> utilities::AboutInfo {
    utilities::AboutInfo::gather()
}

#[tauri::command]
/// Opens or resolves project license information.
///
/// # Returns
/// - `Ok(())` on success.
/// - `Err(String)` on failure.
pub fn show_licenses() -> Result<(), String> {
    Ok(())
}

#[tauri::command]
/// Opens a native folder picker dialog.
///
/// # Parameters
/// - `window`: Calling window handle.
/// - `purpose`: Optional purpose hint used to customize dialog title.
///
/// # Returns
/// - `Some(String)` with the selected folder path.
/// - `None` when canceled.
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
/// Opens a native file picker dialog.
///
/// # Parameters
/// - `window`: Calling window handle.
/// - `purpose`: Optional purpose hint used for title/filter selection.
///
/// # Returns
/// - `Some(String)` with the selected file path.
/// - `None` when canceled.
pub async fn browse_file<R: Runtime>(window: Window<R>, purpose: Option<String>) -> Option<String> {
    let title = match purpose.as_deref() {
        Some("install_plugin") => "Select an OpenVCS plugin bundle (.ovcsp)",
        _ => "Select a file",
    };
    let exts = match purpose.as_deref() {
        Some("install_plugin") => &["ovcsp"][..],
        _ => &[][..],
    };
    utilities::browse_file_async(window.app_handle().clone(), title, exts).await
}

#[tauri::command]
/// Opens a repository using the selected or default backend.
///
/// # Parameters
/// - `window`: Calling window handle.
/// - `state`: Shared application state.
/// - `path`: Repository path to open.
/// - `backend_id`: Optional explicit backend id.
///
/// # Returns
/// - `Ok(())` when the repository is opened.
/// - `Err(String)` when backend resolution or open fails.
pub async fn add_repo<R: Runtime>(
    window: Window<R>,
    state: State<'_, AppState>,
    path: String,
    backend_id: Option<BackendId>,
) -> Result<(), String> {
    let be = backend_id
        .or_else(|| default_backend_id(&state))
        .ok_or_else(|| {
            "No VCS backend is available (install/enable a backend plugin)".to_string()
        })?;
    add_repo_internal(window, state, path, be).await
}

/// Chooses default backend from settings or first available backend.
///
/// # Parameters
/// - `state`: Application state.
///
/// # Returns
/// - `Some(BackendId)` when available.
/// - `None` when no backend is available.
fn default_backend_id(state: &AppState) -> Option<BackendId> {
    let mut backends = crate::plugin_vcs_backends::list_plugin_vcs_backends().ok()?;
    backends.sort_by(|a, b| a.backend_id.as_ref().cmp(b.backend_id.as_ref()));

    let desired = state.config().general.default_backend.trim().to_string();
    if !desired.is_empty() {
        let desired = BackendId::from(desired);
        if backends
            .iter()
            .any(|backend| backend.backend_id.as_ref() == desired.as_ref())
        {
            return Some(desired);
        }
    }

    backends.into_iter().next().map(|b| b.backend_id)
}

/// Internal helper that opens a repository and publishes `repo:selected`.
///
/// # Parameters
/// - `window`: Calling window handle.
/// - `state`: Shared application state.
/// - `path`: Repository path to open.
/// - `backend_id`: Backend id used to open the repository.
///
/// # Returns
/// - `Ok(())` when the repo is opened and state/event updates succeed.
/// - `Err(String)` when validation or backend open fails.
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

    let open_path = path.clone();
    let backend_label = backend_id.as_ref().to_string();
    let backend_id_for_task = backend_id.clone();
    let cfg = state.config();
    let runtime_manager = state.plugin_runtime();
    let handle = async_runtime::spawn_blocking(move || {
        plugin_vcs_backends::open_repo_via_plugin_vcs_backend(
            runtime_manager.as_ref(),
            &cfg,
            backend_id_for_task,
            Path::new(&open_path),
        )
    })
    .await
    .map_err(|e| format!("add_repo task failed: {e}"))?
    .map_err(|e| {
        let m = format!("Failed to open repo with backend `{backend_label}`: {e}");
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
/// Clones a repository into `dest` then opens it in the UI.
///
/// # Parameters
/// - `window`: Calling window handle.
/// - `state`: Shared application state.
/// - `url`: Source repository URL.
/// - `dest`: Destination parent directory.
/// - `backend_id`: Optional backend id override.
///
/// # Returns
/// - `Ok(())` when clone/open succeeds.
/// - `Err(String)` when validation or clone/open fails.
pub async fn clone_repo<R: Runtime>(
    window: Window<R>,
    state: State<'_, AppState>,
    url: String,
    dest: String,
    backend_id: Option<BackendId>,
) -> Result<(), String> {
    let be = backend_id
        .or_else(|| default_backend_id(&state))
        .ok_or_else(|| {
            "No VCS backend is available (install/enable a backend plugin)".to_string()
        })?;
    let _prefer_plugin = plugin_vcs_backends::has_plugin_vcs_backend(&be);

    let folder = infer_repo_dir_from_url(&url);
    if folder.is_empty() {
        return Err("Cannot infer target directory from URL".into());
    }
    let target: PathBuf = Path::new(&dest).join(&folder);

    fs::create_dir_all(&dest).map_err(|e| format!("Failed to create dest: {e}"))?;

    let _clone_url = url.clone();
    let clone_target = target.clone();
    let be_label = be.as_ref().to_string();
    let app_handle = window.app_handle().clone();
    let handle = async_runtime::spawn_blocking(move || {
        let on = Some(progress_bridge(app_handle));
        info!(
            "clone_repo: cloning via backend {} into {}",
            be_label,
            clone_target.display()
        );
        // Plugin backends currently do not support clone in the host.
        let _ = on;
        Err(crate::core::VcsError::Unsupported(BackendId::from(
            be_label.as_str(),
        )))
    });
    handle
        .await
        .map_err(|e| format!("clone_repo task failed: {e}"))?
        .map_err(|e| format!("Clone failed: {e}"))?;

    add_repo_internal(window, state, target.to_string_lossy().to_string(), be).await
}

#[tauri::command]
/// Validates a user-entered Git URL.
///
/// # Parameters
/// - `url`: Candidate URL string.
///
/// # Returns
/// - Validation result describing whether the URL is acceptable.
pub fn validate_git_url(url: String) -> validate::Validation {
    validate::validate_git_url(url)
}

#[tauri::command]
/// Validates a repository path for add/open operations.
///
/// # Parameters
/// - `path`: Candidate filesystem path.
///
/// # Returns
/// - Validation result describing whether the path is acceptable.
pub fn validate_add_path(path: String) -> validate::Validation {
    validate::validate_add_path(path)
}

#[tauri::command]
/// Validates clone inputs (URL and destination path).
///
/// # Parameters
/// - `url`: Source repository URL.
/// - `dest`: Destination path.
///
/// # Returns
/// - Validation result describing whether cloning can proceed.
pub fn validate_clone_input(url: String, dest: String) -> validate::Validation {
    validate::validate_clone_input(url, dest)
}

#[tauri::command]
/// Returns the current repository path, if a repo is selected.
///
/// # Parameters
/// - `state`: Shared application state.
///
/// # Returns
/// - `Some(String)` repository path when selected.
/// - `None` otherwise.
pub fn current_repo_path(state: State<'_, AppState>) -> Option<String> {
    state
        .current_repo()
        .map(|repo| repo.inner().workdir().to_string_lossy().to_string())
}

#[derive(serde::Serialize)]
/// Serializable recent-repository item for frontend rendering.
pub struct RecentRepoDto {
    /// Absolute repository path.
    path: String,
    /// Last path segment used as a display name when available.
    name: Option<String>,
}

#[tauri::command]
/// Returns recently opened repositories for UI display.
///
/// # Parameters
/// - `state`: Shared application state.
///
/// # Returns
/// - A list of recent repository DTOs.
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
/// Opens a repository path selected by the UI.
///
/// # Parameters
/// - `window`: Calling window handle.
/// - `state`: Shared application state.
/// - `path`: Repository path to open.
/// - `backend_id`: Optional backend id override.
///
/// # Returns
/// - `Ok(())` when repository open succeeds.
/// - `Err(String)` when backend resolution/open fails.
pub async fn open_repo<R: Runtime>(
    window: Window<R>,
    state: State<'_, AppState>,
    path: String,
    backend_id: Option<BackendId>,
) -> Result<(), String> {
    let be = backend_id
        .or_else(|| default_backend_id(&state))
        .ok_or_else(|| {
            "No VCS backend is available (install/enable a backend plugin)".to_string()
        })?;
    add_repo_internal(window, state, path, be).await
}

#[tauri::command]
/// Opens or creates a repository-local dotfile using the host opener.
///
/// # Parameters
/// - `window`: Calling window handle.
/// - `state`: Shared application state.
/// - `name`: Dotfile name relative to repository root.
///
/// # Returns
/// - `Ok(())` when file open succeeds.
/// - `Err(String)` when no repo is selected or file IO/opening fails.
pub fn open_repo_dotfile<R: Runtime>(
    window: Window<R>,
    state: State<'_, AppState>,
    name: String,
) -> Result<(), String> {
    let repo_state = state
        .current_repo()
        .ok_or_else(|| "No repository selected".to_string())?;
    let mut path = repo_state.inner().workdir().to_path_buf();
    path.push(name);

    if !path.exists() {
        fs::OpenOptions::new()
            .create(true)
            .truncate(true)
            .write(true)
            .open(&path)
            .map_err(|e| format!("Unable to create file: {e}"))?;
    }

    window
        .app_handle()
        .opener()
        .open_path(path.to_string_lossy().to_string(), None::<&str>)
        .map_err(|e| format!("Failed to open file: {e}"))
}

#[tauri::command]
/// Opens the project documentation URL in the system browser.
///
/// # Parameters
/// - `window`: Calling window handle.
///
/// # Returns
/// - `Ok(())` on success.
/// - `Err(String)` when opening the URL fails.
pub fn open_docs<R: Runtime>(window: Window<R>) -> Result<(), String> {
    window
        .app_handle()
        .opener()
        .open_url(WIKI_URL, None::<&str>)
        .map_err(|e| format!("Failed to open docs: {e}"))
}

#[tauri::command]
/// Exits the application process.
///
/// # Parameters
/// - `window`: Calling window handle.
///
/// # Returns
/// - `Ok(())`.
pub fn exit_app<R: Runtime>(window: Window<R>) -> Result<(), String> {
    window.app_handle().exit(0);
    Ok(())
}

#[tauri::command]
/// Performs a manual update check and emits availability events.
///
/// # Parameters
/// - `window`: Calling window handle.
///
/// # Returns
/// - `Ok(true)` when an update is available.
/// - `Ok(false)` when no update is available.
/// - `Err(String)` when updater access/check fails.
pub async fn check_for_updates<R: Runtime>(window: Window<R>) -> Result<bool, String> {
    let app_handle = window.app_handle();
    match app_handle.updater() {
        Ok(updater) => match updater.check().await {
            Ok(Some(_u)) => {
                let _ = app_handle.emit(
                    "ui:update-available",
                    serde_json::json!({"source":"manual"}),
                );
                Ok(true)
            }
            Ok(None) => Ok(false),
            Err(_) => Err("Update check failed".into()),
        },
        Err(_) => Err("Updater unavailable".into()),
    }
}

/// Infers target folder name from repository URL.
///
/// # Parameters
/// - `url`: Source repository URL.
///
/// # Returns
/// - Inferred repository directory name.
fn infer_repo_dir_from_url(url: &str) -> String {
    let trimmed = url.trim_end_matches('/');
    let last = trimmed.rsplit('/').next().unwrap_or(trimmed);
    last.trim_end_matches(".git").to_string()
}
