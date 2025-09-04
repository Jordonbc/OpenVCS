use std::path::{Path, PathBuf};
use std::sync::Arc;

use tauri::{async_runtime, Emitter, Manager, Runtime, State, Window};
use crate::state::AppState;
use crate::utilities::utilities;
use crate::validate;

use openvcs_core::{
    OnEvent, VcsEvent,
    models::{BranchItem, StatusPayload, CommitItem},
    get_backend, list_backends, Repo as CoreRepo,
};

fn selected_backend_id(state: &State<'_, AppState>) -> String {
    state.backend_id()
}

fn get_open_repo(state: &State<'_, AppState>) -> Result<CoreRepo, String> {
    state.current_repo_handle().ok_or_else(|| "No repository opened".to_string())
}

// Bridge core events → UI messages
fn progress_bridge<R: Runtime>(app: tauri::AppHandle<R>) -> OnEvent {
    Arc::new(move |evt| {
        let msg = match evt {
            VcsEvent::Progress{ detail, .. } => detail,
            VcsEvent::RemoteMessage(s) => s,
            VcsEvent::Auth{ method, detail } => format!("auth[{method}]: {detail}"),
            VcsEvent::PushStatus{ refname, status } =>
                status.map(|s| format!("{refname} → {s}")).unwrap_or_else(|| format!("{refname} ok")),
            VcsEvent::Info(s) => s.to_string(),
            VcsEvent::Warning(s) | VcsEvent::Error(s) => s,
        };
        let _ = app.emit("git-progress", ProgressPayload { message: msg });
    })
}


#[derive(serde::Serialize, Clone)]
struct ProgressPayload {
    message: String
}

#[tauri::command]
pub fn about_info() -> utilities::AboutInfo {
  utilities::AboutInfo::gather()
}

#[tauri::command]
pub fn show_licenses() -> Result<(), String> {
  // open a bundled licenses file, or a window, or external URL
  Ok(())
}

#[tauri::command]
pub async fn browse_directory<R: Runtime>(
    window: Window<R>,
    purpose: Option<String>,
) -> Option<String> {
    let title = match purpose.as_deref() {
        Some("clone_dest") => "Choose destination folder",
        Some("add_repo")   => "Select an existing Git repository folder",
        _                  => "Select a folder",
    };
    utilities::browse_directory_async(window.app_handle().clone(), title).await
}

#[tauri::command]
pub async fn add_repo<R: Runtime>(window: Window<R>, state: State<'_, AppState>, path: String) -> Result<(), String> {
    let be = selected_backend_id(&state);
    let desc = get_backend(&be).ok_or_else(|| format!("Backend not found: {be}"))?;
    // Try opening with the selected backend; report a nice error if not a repo
    (desc.open)(Path::new(&path)).map_err(|e| e.to_string())?;
    // Persist path + clear/open handle lazily later if you like
    state.set_current_repo(PathBuf::from(&path));
    let _ = window.app_handle().emit("repo:selected", &path);
    Ok(())
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
    state.current_repo().map(|p| p.to_string_lossy().to_string())
}

#[tauri::command]
pub fn list_recent_repos(state: State<'_, AppState>) -> Vec<String> {
    state.recents().into_iter().map(|p| p.to_string_lossy().to_string()).collect()
}

/* ---------- helpers ---------- */
fn get_repo_root(state: &State<'_, AppState>) -> Result<PathBuf, String> {
    state
        .current_repo()
        .ok_or_else(|| "No repository selected".to_string())
}

/* ---------- list_branches ---------- */
#[tauri::command]
pub fn list_branches(state: State<'_, AppState>) -> Result<Vec<BranchItem>, String> {
    let repo = get_open_repo(&state)?;
    let current = repo.inner().current_branch().map_err(|e| e.to_string())?;
    let locals  = repo.inner().local_branches().map_err(|e| e.to_string())?;
    Ok(locals.into_iter().map(|name| BranchItem {
        current: current.as_deref() == Some(name.as_str()),
        name,
    }).collect())
}

/* ---------- git_status ---------- */
#[tauri::command]
pub fn git_status(state: State<'_, AppState>) -> Result<StatusPayload, String> {
    let repo = get_open_repo(&state)?;
    let _s = repo.inner().status_summary().map_err(|e| e.to_string())?;
    // TODO: once the Vcs trait exposes file lists + ahead/behind, populate them here.
    Ok(StatusPayload { files: vec![], ahead: 0, behind: 0 })
}

/* ---------- git_log ---------- */
#[tauri::command]
pub fn git_log(_state: State<'_, AppState>, _limit: Option<usize>) -> Result<Vec<CommitItem>, String> {
    Err("git_log not implemented for the generic VCS yet".into())
}


/* ---------- optional: branch ops used by your JS ---------- */
#[tauri::command]
pub fn git_checkout_branch(state: State<'_, AppState>, name: String) -> Result<(), String> {
    let repo = get_open_repo(&state)?;
    repo.inner().checkout_branch(&name).map_err(|e| e.to_string())
}


#[tauri::command]
pub fn git_create_branch(
    state: State<'_, AppState>,
    name: String,
    from: Option<String>,
    checkout: Option<bool>,) -> Result<(), String> {
    let repo = get_open_repo(&state)?;

    // If a base branch is provided, check it out first.
    if let Some(from) = from {
        repo.inner()
            .checkout_branch(&from)
            .map_err(|e| format!("base branch not found or cannot checkout: {e}"))?;
    }

    repo.inner()
        .create_branch(&name, checkout.unwrap_or(false))
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn git_diff_file(_state: State<'_, AppState>, _path: String) -> Result<Vec<String>, String> {
    Err("git_diff_file not implemented for the generic VCS yet".into())
}

#[tauri::command]
pub async fn commit_changes<R: Runtime>(
    window: Window<R>,
    state: State<'_, AppState>,
    summary: String,
    description: String,
) -> Result<String, String> {
    let app = window.app_handle().clone();
    let repo = get_open_repo(&state)?;

    let message = if description.trim().is_empty() {
        summary.clone()
    } else {
        format!("{summary}\n\n{description}")
    };

    async_runtime::spawn_blocking(move || {
        let on = progress_bridge(app);
        on(VcsEvent::Info("Staging changes…"));

        // Backend-agnostic identity fallback; wire a real identity source later.
        let name = std::env::var("GIT_AUTHOR_NAME").unwrap_or_else(|_| "OpenVCS".into());
        let email = std::env::var("GIT_AUTHOR_EMAIL").unwrap_or_else(|_| "openvcs@example".into());

        on(VcsEvent::Info("Writing commit…"));
        let oid = repo.inner().commit(&message, &name, &email, &[]).map_err(|e| e.to_string())?;
        on(VcsEvent::Info("Commit created."));
        Ok(oid)
    })
    .await
    .map_err(|e| format!("commit task failed: {e}"))?
}


#[tauri::command]
pub fn git_fetch<R: Runtime>(window: Window<R>, state: State<'_, AppState>) -> Result<(), String> {
    let repo = get_open_repo(&state)?;
    let app = window.app_handle().clone();
    let on = Some(progress_bridge(app));

    let current = repo
        .inner()
        .current_branch()
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Detached HEAD; cannot determine upstream".to_string())?;

    repo.inner().fetch("origin", &current, on).map_err(|e| e.to_string())
}


#[tauri::command]
pub async fn git_push<R: tauri::Runtime>(
    window: tauri::Window<R>,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    let repo = get_open_repo(&state)?;
    let app_for_worker = window.app_handle().clone();

    async_runtime::spawn_blocking(move || -> Result<(), String> {
        let on = Some(progress_bridge(app_for_worker));
        let current = repo.inner().current_branch().map_err(|e| e.to_string())?
            .ok_or_else(|| "detached HEAD".to_string())?;
        let refspec = format!("refs/heads/{0}:refs/heads/{0}", current);
        repo.inner().push("origin", &refspec, on).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())??;

    let _ = window.app_handle().emit("git-progress", ProgressPayload { message: "Push complete".into() });
    Ok(())
}

#[tauri::command]
pub fn list_backends_cmd() -> Vec<(String, String)> {
    list_backends().map(|b| (b.id.to_string(), b.name.to_string())).collect()
}

#[tauri::command]
pub fn set_backend_cmd(state: State<'_, AppState>, backend_id: String) -> Result<(), String> {
    if get_backend(&backend_id).is_none() {
        return Err(format!("Unknown backend: {backend_id}"));
    }
    state.set_backend_id(backend_id);
    Ok(())
}



