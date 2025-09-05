use std::path::{Path, PathBuf};
use std::sync::Arc;

use log::{debug, error, info, warn};
use tauri::{async_runtime, Emitter, Manager, Runtime, State, Window};
use crate::state::AppState;
use crate::utilities::utilities;
use crate::validate;

use openvcs_core::{OnEvent, VcsEvent, models::{BranchItem, StatusPayload, CommitItem}, get_backend, list_backends, Repo as CoreRepo, BackendId};
use openvcs_core::models::LogQuery;

fn selected_backend_id(state: &State<'_, AppState>) -> BackendId {
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
pub async fn add_repo<R: Runtime>(
    window: Window<R>,
    state: State<'_, AppState>,
    path: String,
) -> Result<(), String> {
    info!("add_repo: requested path = {}", path);

    let be = selected_backend_id(&state);
    let desc = get_backend(&be)
        .ok_or_else(|| {
            let m = format!("Backend not found: {be}");
            error!("{m}");
            m
        })?;

    let handle = (desc.open)(Path::new(&path)).map_err(|e| {
        let m = format!("Failed to open repo with backend `{}`: {}", be, e);
        error!("{m}");
        m
    })?;

    // Persist both the path and the handle
    state.set_current_repo(PathBuf::from(&path));
    state.set_current_repo_handle(handle);

    // Notify the UI
    if let Err(e) = window.app_handle().emit("repo:selected", &path) {
        warn!("add_repo: failed to emit repo:selected: {}", e);
    }

    info!("add_repo: repository opened and stored for backend `{}`", be);
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
    if !state.has_repo() {
        return None;
    }

    state.current_repo().map(|p| p.to_string_lossy().to_string())
}

#[tauri::command]
pub fn list_recent_repos(state: State<'_, AppState>) -> Vec<String> {
    state.recents().into_iter().map(|p| p.to_string_lossy().to_string()).collect()
}

/* ---------- helpers ---------- */
fn get_repo_root(state: &State<'_, AppState>) -> Result<PathBuf, String> {
    if !state.has_repo() {
        return Err("No repository selected".to_string());
    }

    state.current_repo().ok_or_else(|| "No repository selected".to_string())
}

/* ---------- list_branches ---------- */
#[tauri::command]
pub fn list_branches(state: State<'_, AppState>) -> Result<Vec<BranchItem>, String> {
    info!("list_branches: fetching branch list");

    if !state.has_repo() {
        return Err("No repository selected".to_string());
    }

    let repo = get_open_repo(&state)
        .map_err(|e| {
            error!("list_branches: failed to open repo: {e}");
            e
        })?;

    let current = repo.inner().current_branch()
        .map_err(|e| {
            error!("list_branches: failed to get current branch: {e}");
            e.to_string()
        })?;

    let locals = repo.inner().local_branches()
        .map_err(|e| {
            error!("list_branches: failed to list local branches: {e}");
            e.to_string()
        })?;

    debug!("list_branches: current={:?}, locals={:?}", current, locals);

    Ok(locals.into_iter().map(|name| BranchItem {
        current: current.as_deref() == Some(name.as_str()),
        name,
    }).collect())
}

/* ---------- git_status ---------- */
#[tauri::command]
pub fn git_status(state: State<'_, AppState>) -> Result<StatusPayload, String> {
    info!("git_status: fetching repo status");

    let core_repo = state
        .current_repo_handle()
        .ok_or_else(|| "No repository selected".to_string())?;
    let vcs = core_repo.inner();

    let payload = vcs.status_payload().map_err(|e| {
        error!("git_status: failed to compute status: {e}");
        e.to_string()
    })?;

    debug!("git_status: files={}, ahead={}, behind={}",
        payload.files.len(), payload.ahead, payload.behind);

    Ok(payload)
}


/* ---------- git_log ---------- */
#[tauri::command]
pub fn git_log(
    state: State<'_, AppState>,
    limit: Option<usize>,
) -> Result<Vec<CommitItem>, String> {
    // Acquire the CoreRepo wrapper the right way
    let core_repo = state
        .current_repo_handle()
        .ok_or_else(|| "No repository selected".to_string())?;

    // Call the backend directly via &dyn Vcs
    let vcs = core_repo.inner();

    let q = LogQuery {
        rev: None,
        path: None,
        since_utc: None,
        until_utc: None,
        author_contains: None,
        skip: 0,
        limit: (limit.unwrap_or(100)).min(1000) as u32,
        topo_order: true,
        include_merges: true,
    };

    vcs.log_commits(&q).map_err(|e| e.to_string())
}

/* ---------- optional: branch ops used by your JS ---------- */
#[tauri::command]
pub fn git_checkout_branch(state: State<'_, AppState>, name: String) -> Result<(), String> {
    info!("git_checkout_branch: attempting to checkout branch '{}'", name);

    if !state.has_repo() {
        return Err("No repository selected".to_string());
    }

    let repo = get_open_repo(&state)?;
    match repo.inner().checkout_branch(&name) {
        Ok(_) => {
            info!("git_checkout_branch: successfully checked out '{}'", name);
            Ok(())
        }
        Err(e) => {
            error!("git_checkout_branch: failed to checkout '{}': {}", name, e);
            Err(e.to_string())
        }
    }
}

#[tauri::command]
pub fn git_create_branch(
    state: State<'_, AppState>,
    name: String,
    from: Option<String>,
    checkout: Option<bool>,
) -> Result<(), String> {
    info!("git_create_branch: requested branch '{}', from={:?}, checkout={:?}", name, from, checkout);

    if !state.has_repo() {
        return Err("No repository selected".to_string());
    }

    let repo = get_open_repo(&state)?;

    // If a base branch is provided, check it out first.
    if let Some(from) = from.clone() {
        match repo.inner().checkout_branch(&from) {
            Ok(_) => info!("git_create_branch: successfully checked out base branch '{}'", from),
            Err(e) => {
                error!("git_create_branch: failed to checkout base branch '{}': {}", from, e);
                return Err(format!("base branch not found or cannot checkout: {e}"));
            }
        }
    }

    match repo.inner().create_branch(&name, checkout.unwrap_or(false)) {
        Ok(_) => {
            info!("git_create_branch: successfully created branch '{}'", name);
            Ok(())
        }
        Err(e) => {
            error!("git_create_branch: failed to create branch '{}': {}", name, e);
            Err(e.to_string())
        }
    }
}

#[tauri::command]
pub fn git_diff_file(state: State<'_, AppState>, _path: String) -> Result<Vec<String>, String> {
    if !state.has_repo() {
        return Err("No repository selected".to_string());
    }

    info!("git_diff_file: called but not implemented for the generic VCS backend");
    Err("git_diff_file not implemented for the generic VCS yet".into())
}

#[tauri::command]
pub async fn commit_changes<R: Runtime>(
    window: Window<R>,
    state: State<'_, AppState>,
    summary: String,
    description: String,
) -> Result<String, String> {
    info!("commit_changes called (summary: \"{}\")", summary);

    if !state.has_repo() {
        return Err("No repository selected".to_string());
    }

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
        info!("Staging changes for commit");

        // Backend-agnostic identity fallback; wire a real identity source later.
        let name = std::env::var("GIT_AUTHOR_NAME").unwrap_or_else(|_| "OpenVCS".into());
        let email = std::env::var("GIT_AUTHOR_EMAIL").unwrap_or_else(|_| "openvcs@example".into());
        info!("Using identity: {} <{}>", name, email);

        on(VcsEvent::Info("Writing commit…"));
        let oid = repo
            .inner()
            .commit(&message, &name, &email, &[])
            .map_err(|e| {
                error!("Commit failed: {e}");
                e.to_string()
            })?;
        info!("Commit created successfully: {oid}");

        on(VcsEvent::Info("Commit created."));
        Ok(oid)
    })
    .await
    .map_err(|e| {
        error!("commit_changes task join error: {e}");
        format!("commit task failed: {e}")
    })?
}

#[tauri::command]
pub fn git_fetch<R: Runtime>(window: Window<R>, state: State<'_, AppState>) -> Result<(), String> {
    info!("git_fetch called");

    if !state.has_repo() {
        return Err("No repository selected".to_string());
    }

    let repo = get_open_repo(&state)?;
    let app = window.app_handle().clone();
    let on = Some(progress_bridge(app));

    let current = repo
        .inner()
        .current_branch()
        .map_err(|e| {
            error!("Failed to get current branch: {e}");
            e.to_string()
        })?
        .ok_or_else(|| {
            warn!("Detached HEAD detected, cannot determine upstream branch");
            "Detached HEAD; cannot determine upstream".to_string()
        })?;

    info!("Fetching branch '{}' from origin", current);

    repo.inner()
        .fetch("origin", &current, on)
        .map_err(|e| {
            error!("Fetch failed for branch '{}': {e}", current);
            e.to_string()
        })?;

    info!("Fetch completed successfully for branch '{}'", current);
    Ok(())
}

#[tauri::command]
pub async fn git_push<R: Runtime>(
    window: Window<R>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    info!("git_push called");

    if !state.has_repo() {
        return Err("No repository selected".to_string());
    }

    let repo = get_open_repo(&state)?;
    let app_for_worker = window.app_handle().clone();
    let app_for_final  = window.app_handle().clone();

    async_runtime::spawn_blocking(move || -> Result<(), String> {
        let on = Some(progress_bridge(app_for_worker));

        let current = repo.inner().current_branch().map_err(|e| {
            error!("Failed to determine current branch: {e}");
            e.to_string()
        })?.ok_or_else(|| {
            warn!("Detached HEAD, cannot push");
            "detached HEAD".to_string()
        })?;

        let refspec = format!("refs/heads/{0}:refs/heads/{0}", current);
        info!("Pushing branch '{}' with refspec '{}'", current, refspec);

        repo.inner().push("origin", &refspec, on).map_err(|e| {
            error!("Push failed for branch '{}': {e}", current);
            e.to_string()
        })
    })
    .await
    .map_err(|e| {
        error!("Join error in git_push task: {e}");
        e.to_string()
    })??;

    let _ = app_for_final.emit(
        "git-progress",
        ProgressPayload { message: "Push complete".into() }
    );

    info!("Push completed successfully.");
    Ok(())
}

#[tauri::command]
pub fn list_backends_cmd() -> Vec<(String, String)> {
    info!("list_backends_cmd called");
    let backends: Vec<(String, String)> =
        list_backends().map(|b| (b.id.to_string(), b.name.to_string())).collect();

    info!("Found {} registered backends", backends.len());
    for (id, name) in &backends {
        info!("  - {} ({})", id, name);
    }

    backends
}

#[tauri::command]
pub fn set_backend_cmd(state: State<'_, AppState>, backend_id: BackendId) -> Result<(), String> {
    use log::{info, warn, error};
    use std::path::Path;

    info!("set_backend_cmd: requested backend = {}", &backend_id);

    let desc = match get_backend(&backend_id) {
        Some(d) => d,
        None => {
            warn!("set_backend_cmd: unknown backend `{}`", backend_id);
            return Err(format!("Unknown backend: {backend_id}"));
        }
    };

    // Update the selected backend id.
    state.set_backend_id(backend_id.clone());
    info!("set_backend_cmd: backend switched to {} ({})", backend_id, desc.name);

    // If a repo path is already selected, try to reopen it with the new backend.
    if let Some(path) = state.current_repo() {
        info!("set_backend_cmd: reopening current repo with new backend: {}", path.display());
        match (desc.open)(Path::new(&path)) {
            Ok(handle) => {
                state.set_current_repo_handle(handle);
                info!("set_backend_cmd: repo reopened with backend `{}`", backend_id);
            }
            Err(e) => {
                // Clear stale handle
                state.clear_current_repo_handle();
                error!(
                    "set_backend_cmd: failed to reopen repo `{}` with backend `{}`: {}",
                    path.display(),
                    backend_id,
                    e
                );
                return Err(format!("Failed to reopen repo with `{backend_id}`: {e}"));
            }
        }
    } else {
        // No repo selected; just ensure there's no stale handle.
        state.clear_current_repo_handle();
        info!("set_backend_cmd: no current repo; cleared any existing handle");
    }

    Ok(())
}
