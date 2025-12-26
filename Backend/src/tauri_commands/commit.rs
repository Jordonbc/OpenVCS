use std::path::PathBuf;

use log::{error, info};
use tauri::{async_runtime, Manager, Runtime, State, Window};

use openvcs_core::models::VcsEvent;

use crate::state::AppState;

use super::{current_repo_or_err, progress_bridge, run_repo_task};

#[tauri::command]
pub async fn commit_changes<R: Runtime>(
    window: Window<R>,
    state: State<'_, AppState>,
    summary: String,
    description: String,
) -> Result<String, String> {
    info!("commit_changes called (summary: \"{}\")", summary);

    let repo = state
        .current_repo()
        .ok_or_else(|| "No repository selected".to_string())?;
    let repo = repo.clone();
    let app = window.app_handle().clone();

    let message = if description.trim().is_empty() {
        summary.clone()
    } else {
        format!("{summary}\n\n{description}")
    };

    async_runtime::spawn_blocking(move || {
        let on = progress_bridge(app);
        on(VcsEvent::Info("Staging changes…"));
        info!("Staging changes for commit");

        let (name, email) = repo
            .inner()
            .get_identity()
            .ok()
            .flatten()
            .or_else(|| {
                let n = std::env::var("GIT_AUTHOR_NAME").ok();
                let e = std::env::var("GIT_AUTHOR_EMAIL").ok();
                match (n, e) {
                    (Some(n), Some(e)) if !n.is_empty() && !e.is_empty() => Some((n, e)),
                    _ => None,
                }
            })
            .unwrap_or_else(|| ("OpenVCS".into(), "openvcs@example".into()));
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
pub async fn commit_selected<R: Runtime>(
    window: Window<R>,
    state: State<'_, AppState>,
    summary: String,
    description: String,
    files: Vec<String>,
) -> Result<String, String> {
    info!("commit_selected called ({} file(s))", files.len());

    let repo = state
        .current_repo()
        .ok_or_else(|| "No repository selected".to_string())?;
    let repo = repo.clone();
    let app = window.app_handle().clone();

    let message = if description.trim().is_empty() {
        summary.clone()
    } else {
        format!("{summary}\n\n{description}")
    };

    async_runtime::spawn_blocking(move || {
        let on = progress_bridge(app);
        on(VcsEvent::Info("Staging selected files…"));

        let (name, email) = repo
            .inner()
            .get_identity()
            .ok()
            .flatten()
            .or_else(|| {
                let n = std::env::var("GIT_AUTHOR_NAME").ok();
                let e = std::env::var("GIT_AUTHOR_EMAIL").ok();
                match (n, e) {
                    (Some(n), Some(e)) if !n.is_empty() && !e.is_empty() => Some((n, e)),
                    _ => None,
                }
            })
            .unwrap_or_else(|| ("OpenVCS".into(), "openvcs@example".into()));

        let paths: Vec<PathBuf> = files.into_iter().map(PathBuf::from).collect();

        on(VcsEvent::Info("Writing commit…"));
        let oid = repo
            .inner()
            .commit(&message, &name, &email, &paths)
            .map_err(|e| {
                error!("Commit (selected) failed: {e}");
                e.to_string()
            })?;
        Ok(oid)
    })
    .await
    .map_err(|e| format!("commit_selected task failed: {e}"))?
}

#[tauri::command]
pub async fn commit_patch<R: Runtime>(
    window: Window<R>,
    state: State<'_, AppState>,
    summary: String,
    description: String,
    patch: String,
) -> Result<String, String> {
    info!("commit_patch called (patch size: {} bytes)", patch.len());
    let repo = state
        .current_repo()
        .ok_or_else(|| "No repository selected".to_string())?;
    let repo = repo.clone();
    let app = window.app_handle().clone();

    let message = if description.trim().is_empty() {
        summary.clone()
    } else {
        format!("{summary}\n\n{description}")
    };

    async_runtime::spawn_blocking(move || {
        let on = progress_bridge(app);
        on(VcsEvent::Info("Staging selected hunks…"));

        repo.inner().stage_patch(&patch).map_err(|e| {
            error!("stage_patch failed: {e}");
            e.to_string()
        })?;

        let (name, email) = repo
            .inner()
            .get_identity()
            .ok()
            .flatten()
            .or_else(|| {
                let n = std::env::var("GIT_AUTHOR_NAME").ok();
                let e = std::env::var("GIT_AUTHOR_EMAIL").ok();
                match (n, e) {
                    (Some(n), Some(e)) if !n.is_empty() && !e.is_empty() => Some((n, e)),
                    _ => None,
                }
            })
            .unwrap_or_else(|| ("OpenVCS".into(), "openvcs@example".into()));

        on(VcsEvent::Info("Committing staged hunks…"));
        let oid = repo
            .inner()
            .commit_index(&message, &name, &email)
            .map_err(|e| {
                error!("commit_index failed: {e}");
                e.to_string()
            })?;
        Ok(oid)
    })
    .await
    .map_err(|e| format!("commit_patch task failed: {e}"))?
}

#[tauri::command]
pub async fn commit_patch_and_files<R: Runtime>(
    window: Window<R>,
    state: State<'_, AppState>,
    summary: String,
    description: String,
    patch: String,
    files: Vec<String>,
) -> Result<String, String> {
    info!(
        "commit_patch_and_files called (patch bytes={}, files={})",
        patch.len(),
        files.len()
    );
    let repo = state
        .current_repo()
        .ok_or_else(|| "No repository selected".to_string())?;
    let repo = repo.clone();
    let app = window.app_handle().clone();

    let message = if description.trim().is_empty() {
        summary.clone()
    } else {
        format!("{summary}\n\n{description}")
    };

    async_runtime::spawn_blocking(move || {
        let on = progress_bridge(app);
        on(VcsEvent::Info("Staging selected hunks…"));

        if !patch.trim().is_empty() {
            repo.inner().stage_patch(&patch).map_err(|e| {
                error!("stage_patch failed: {e}");
                e.to_string()
            })?;
        }

        let (name, email) = repo
            .inner()
            .get_identity()
            .ok()
            .flatten()
            .or_else(|| {
                let n = std::env::var("GIT_AUTHOR_NAME").ok();
                let e = std::env::var("GIT_AUTHOR_EMAIL").ok();
                match (n, e) {
                    (Some(n), Some(e)) if !n.is_empty() && !e.is_empty() => Some((n, e)),
                    _ => None,
                }
            })
            .unwrap_or_else(|| ("OpenVCS".into(), "openvcs@example".into()));

        on(VcsEvent::Info("Writing commit…"));
        let oid = if files.is_empty() {
            repo.inner()
                .commit_index(&message, &name, &email)
                .map_err(|e| e.to_string())?
        } else {
            let paths: Vec<PathBuf> = files.into_iter().map(PathBuf::from).collect();
            repo.inner()
                .commit(&message, &name, &email, &paths)
                .map_err(|e| e.to_string())?
        };
        on(VcsEvent::Info("Commit complete"));
        Ok(oid)
    })
    .await
    .map_err(|e| format!("commit_patch_and_files task failed: {e}"))?
}

#[tauri::command]
pub async fn git_cherry_pick_to_branch<R: Runtime>(
    window: Window<R>,
    state: State<'_, AppState>,
    id: String,
    branch: String,
) -> Result<(), String> {
    info!("git_cherry_pick_to_branch called (id={}, branch={})", id, branch);

    let repo = current_repo_or_err(&state)?;
    let app = window.app_handle().clone();
    run_repo_task("git_cherry_pick_to_branch", repo, move |repo| {
        let id = id.trim().to_string();
        let branch = branch.trim().to_string();
        if id.is_empty() {
            return Err("Commit id cannot be empty".into());
        }
        if branch.is_empty() {
            return Err("Target branch cannot be empty".into());
        }

        let on = progress_bridge(app);
        on(VcsEvent::Progress { phase: "git", detail: format!("Checking out '{branch}'…") });
        repo.inner()
            .checkout_branch(&branch)
            .map_err(|e| e.to_string())?;

        on(VcsEvent::Progress { phase: "git", detail: format!("Cherry-picking {id}…") });
        repo.inner().cherry_pick(&id).map_err(|e| e.to_string())?;

        on(VcsEvent::Info("Cherry-pick complete".into()));
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn git_revert_commit<R: Runtime>(
    window: Window<R>,
    state: State<'_, AppState>,
    id: String,
) -> Result<(), String> {
    info!("git_revert_commit called (id={})", id);

    let repo = current_repo_or_err(&state)?;
    let app = window.app_handle().clone();
    run_repo_task("git_revert_commit", repo, move |repo| {
        let id = id.trim().to_string();
        if id.is_empty() {
            return Err("Commit id cannot be empty".into());
        }

        let on = progress_bridge(app);
        on(VcsEvent::Progress { phase: "git", detail: format!("Reverting {id}…") });
        repo.inner()
            .revert_commit(&id, true)
            .map_err(|e| e.to_string())?;
        on(VcsEvent::Info("Revert complete".into()));
        Ok(())
    })
    .await
}
