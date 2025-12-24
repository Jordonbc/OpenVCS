use std::path::PathBuf;

use log::info;
use tauri::State;

use crate::state::AppState;

use super::{current_repo_or_err, lfs_config, run_repo_task, LfsEnvGuard};

#[tauri::command]
pub async fn git_lfs_fetch_all(state: State<'_, AppState>) -> Result<(), String> {
    info!("git_lfs_fetch_all called");
    let cfg = lfs_config(&state);
    if !cfg.enabled {
        return Err("Git LFS integration is disabled".into());
    }

    let repo = current_repo_or_err(&state)?;
    run_repo_task("git_lfs_fetch_all", repo, move |repo| {
        let _guard = LfsEnvGuard::apply(&cfg);
        repo.inner().lfs_fetch().map_err(|e| e.to_string())
    })
    .await
}

#[tauri::command]
pub async fn git_lfs_pull(state: State<'_, AppState>) -> Result<(), String> {
    info!("git_lfs_pull called");
    let cfg = lfs_config(&state);
    if !cfg.enabled {
        return Err("Git LFS integration is disabled".into());
    }

    let repo = current_repo_or_err(&state)?;
    run_repo_task("git_lfs_pull", repo, move |repo| {
        let _guard = LfsEnvGuard::apply(&cfg);
        repo.inner().lfs_pull().map_err(|e| e.to_string())
    })
    .await
}

#[tauri::command]
pub async fn git_lfs_prune(state: State<'_, AppState>) -> Result<(), String> {
    info!("git_lfs_prune called");
    let cfg = lfs_config(&state);
    if !cfg.enabled {
        return Err("Git LFS integration is disabled".into());
    }

    let repo = current_repo_or_err(&state)?;
    run_repo_task("git_lfs_prune", repo, move |repo| {
        let _guard = LfsEnvGuard::apply(&cfg);
        repo.inner().lfs_prune().map_err(|e| e.to_string())
    })
    .await
}

#[tauri::command]
pub async fn git_lfs_track_paths(
    state: State<'_, AppState>,
    paths: Vec<String>,
) -> Result<(), String> {
    info!("git_lfs_track_paths called (count={})", paths.len());
    if paths.is_empty() {
        return Ok(());
    }

    let cfg = lfs_config(&state);
    if !cfg.enabled {
        return Err("Git LFS integration is disabled".into());
    }

    let repo = current_repo_or_err(&state)?;
    run_repo_task("git_lfs_track_paths", repo, move |repo| {
        let _guard = LfsEnvGuard::apply(&cfg);
        let list: Vec<PathBuf> = paths.into_iter().map(PathBuf::from).collect();
        repo.inner().lfs_track(&list).map_err(|e| e.to_string())
    })
    .await
}

#[tauri::command]
pub async fn git_lfs_is_tracked(state: State<'_, AppState>, path: String) -> Result<bool, String> {
    let repo = current_repo_or_err(&state)?;
    run_repo_task("git_lfs_is_tracked", repo, move |repo| {
        repo.inner()
            .lfs_is_tracked(&PathBuf::from(path))
            .map_err(|e| e.to_string())
    })
    .await
}
