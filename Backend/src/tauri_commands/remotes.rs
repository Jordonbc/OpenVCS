use log::{error, info, warn};
use tauri::{Emitter, Manager, Runtime, State, Window};

use openvcs_core::models::{CommitItem, LogQuery, VcsEvent};

use crate::state::AppState;

use super::{current_repo_or_err, progress_bridge, run_repo_task, ProgressPayload};

#[tauri::command]
pub async fn git_fetch<R: Runtime>(
    window: Window<R>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let repo = current_repo_or_err(&state)?;
    let app = window.app_handle().clone();
    let current = run_repo_task("git_fetch", repo, move |repo| {
        info!("git_fetch called");
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

        info!("Fetching branch '{current}' from origin");
        repo.inner().fetch("origin", &current, on).map_err(|e| {
            error!("Fetch failed for branch '{current}': {e}");
            e.to_string()
        })?;

        info!("Fetch completed successfully for branch '{current}'");
        Ok(current)
    })
    .await?;

    let _ = window.app_handle().emit(
        "git-progress",
        ProgressPayload {
            message: format!("Fetch complete ({current})"),
        },
    );
    Ok(())
}

#[tauri::command]
pub async fn git_fetch_all<R: Runtime>(
    window: Window<R>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let repo = current_repo_or_err(&state)?;
    let app = window.app_handle().clone();
    run_repo_task("git_fetch_all", repo, move |repo| {
        info!("git_fetch_all called");
        let on = Some(progress_bridge(app));
        let remotes = repo.inner().list_remotes().map_err(|e| {
            error!("Failed to list remotes: {e}");
            e.to_string()
        })?;

        for (r, _url) in remotes.into_iter() {
            info!("Fetching all refs from remote '{r}'");
            if let Err(e) = repo.inner().fetch(&r, "", on.clone()) {
                error!("Fetch failed for remote '{r}': {e}");
                return Err(e.to_string());
            }
        }
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn git_pull<R: Runtime>(
    window: Window<R>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let repo = current_repo_or_err(&state)?;
    let app = window.app_handle().clone();
    let current = run_repo_task("git_pull", repo, move |repo| {
        info!("git_pull called");
        let on = Some(progress_bridge(app));
        let current = repo
            .inner()
            .current_branch()
            .map_err(|e| {
                error!("Failed to get current branch: {e}");
                e.to_string()
            })?
            .ok_or_else(|| {
                warn!("Detached HEAD detected, cannot determine upstream branch for pull");
                "Detached HEAD; cannot determine upstream".to_string()
            })?;

        info!("Fast-forward pulling branch '{current}' from origin");
        repo.inner()
            .pull_ff_only("origin", &current, on)
            .map_err(|e| {
                error!("Pull (ff-only) failed for branch '{current}': {e}");
                e.to_string()
            })?;

        info!("Pull (ff-only) completed successfully for branch '{current}'");
        Ok(current)
    })
    .await?;

    let _ = window.app_handle().emit(
        "git-progress",
        ProgressPayload {
            message: format!("Pull complete ({current})"),
        },
    );
    Ok(())
}

#[tauri::command]
pub async fn git_push<R: Runtime>(
    window: Window<R>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let repo = current_repo_or_err(&state)?;
    let app = window.app_handle().clone();
    let current = run_repo_task("git_push", repo, move |repo| {
        info!("git_push called");
        let on = Some(progress_bridge(app));

        let current = repo
            .inner()
            .current_branch()
            .map_err(|e| {
                error!("Failed to determine current branch: {e}");
                e.to_string()
            })?
            .ok_or_else(|| {
                warn!("Detached HEAD, cannot push");
                "detached HEAD".to_string()
            })?;

        let refspec = format!("refs/heads/{0}:refs/heads/{0}", current);
        info!("Pushing branch '{current}' with refspec '{refspec}'");

        repo.inner().push("origin", &refspec, on).map_err(|e| {
            error!("Push failed for branch '{current}': {e}");
            e.to_string()
        })?;

        info!("Push completed successfully for '{current}'");
        Ok(current)
    })
    .await?;

    let _ = window.app_handle().emit(
        "git-progress",
        ProgressPayload {
            message: format!("Push complete ({current})"),
        },
    );

    Ok(())
}

#[tauri::command]
pub async fn git_undo_since_push<R: Runtime>(
    window: Window<R>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    info!("git_undo_since_push called");

    let repo = current_repo_or_err(&state)?;
    let app = window.app_handle().clone();
    run_repo_task("git_undo_since_push", repo, move |repo| {
        let status = repo.inner().status_payload().map_err(|e| e.to_string())?;
        if status.ahead == 0 {
            return Err("Nothing to undo (no unpushed commits)".into());
        }
        let on = progress_bridge(app);
        on(VcsEvent::Info("Undoing unpushed commits (soft reset)…"));
        match repo.inner().reset_soft_to("@{upstream}") {
            Ok(_) => Ok(()),
            Err(_e) => {
                let cur = repo
                    .inner()
                    .current_branch()
                    .map_err(|e| e.to_string())?
                    .ok_or_else(|| "Detached HEAD; cannot resolve upstream".to_string())?;
                let remote_short = format!("origin/{}", cur);
                repo.inner()
                    .reset_soft_to(&remote_short)
                    .map_err(|e| e.to_string())
            }
        }
    })
    .await
}

#[tauri::command]
pub async fn git_undo_to_commit<R: Runtime>(
    window: Window<R>,
    state: State<'_, AppState>,
    id: String,
) -> Result<(), String> {
    info!("git_undo_to_commit called for {id}");

    let repo = current_repo_or_err(&state)?;
    let app = window.app_handle().clone();
    run_repo_task("git_undo_to_commit", repo, move |repo| {
        let mut ahead_list: Vec<CommitItem> = Vec::new();
        {
            let mut q = LogQuery::head(1000);
            q.rev = Some("@{upstream}..HEAD".to_string());
            match repo.inner().log_commits(&q) {
                Ok(list) => ahead_list = list,
                Err(_) => {
                    if let Some(cur) = repo.inner().current_branch().map_err(|e| e.to_string())? {
                        let mut q2 = LogQuery::head(1000);
                        q2.rev = Some(format!("origin/{}..HEAD", cur));
                        if let Ok(list) = repo.inner().log_commits(&q2) {
                            ahead_list = list;
                        }
                    }
                }
            }
        }

        let target = id.trim();
        if !ahead_list.is_empty() {
            let target_in_ahead = ahead_list.iter().any(|c| c.id.starts_with(target));
            if !target_in_ahead {
                return Err("Selected commit is not ahead of upstream".into());
            }
        }

        let on = progress_bridge(app);
        on(VcsEvent::Info("Undoing to selected commit (soft reset)…"));
        let rev = format!("{}^", target);
        repo.inner()
            .reset_soft_to(&rev)
            .map_err(|e| e.to_string())?;
        Ok(())
    })
    .await
}
