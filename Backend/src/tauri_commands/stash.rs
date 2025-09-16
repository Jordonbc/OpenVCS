use std::path::PathBuf;

use log::{error, info};
use tauri::State;

use openvcs_core::models::StashItem;

use crate::state::AppState;

use super::{current_repo_or_err, run_repo_task};

#[tauri::command]
pub async fn git_stash_list(state: State<'_, AppState>) -> Result<Vec<StashItem>, String> {
    let repo = current_repo_or_err(&state)?;
    run_repo_task("git_stash_list", repo, move |repo| {
        match repo.inner().stash_list() {
            Ok(items) => {
                info!("git_stash_list: count={}", items.len());
                for item in &items {
                    info!(
                        "git_stash_list: selector='{}' msg='{}' meta='{}'",
                        item.selector, item.msg, item.meta
                    );
                }
                Ok(items)
            }
            Err(e) => {
                error!("git_stash_list: failed: {}", e);
                Err(e.to_string())
            }
        }
    })
    .await
}

#[tauri::command]
pub async fn git_stash_push(
    state: State<'_, AppState>,
    message: Option<String>,
    include_untracked: Option<bool>,
    paths: Option<Vec<String>>,
) -> Result<(), String> {
    let repo = current_repo_or_err(&state)?;
    let msg = message.unwrap_or_else(|| "WIP".to_string());
    let iu = include_untracked.unwrap_or(true);
    let pathbufs: Vec<PathBuf> = paths
        .unwrap_or_default()
        .into_iter()
        .map(PathBuf::from)
        .collect();
    run_repo_task("git_stash_push", repo, move |repo| {
        repo.inner()
            .stash_push(&msg, iu, &pathbufs)
            .map_err(|e| e.to_string())
    })
    .await
}

#[tauri::command]
pub async fn git_stash_apply(
    state: State<'_, AppState>,
    selector: Option<String>,
) -> Result<(), String> {
    let repo = current_repo_or_err(&state)?;
    let selector = selector.unwrap_or_default();
    run_repo_task("git_stash_apply", repo, move |repo| {
        repo.inner()
            .stash_apply(selector.as_str())
            .map_err(|e| e.to_string())
    })
    .await
}

#[tauri::command]
pub async fn git_stash_pop(
    state: State<'_, AppState>,
    selector: Option<String>,
) -> Result<(), String> {
    let repo = current_repo_or_err(&state)?;
    let selector = selector.unwrap_or_default();
    run_repo_task("git_stash_pop", repo, move |repo| {
        repo.inner()
            .stash_pop(selector.as_str())
            .map_err(|e| e.to_string())
    })
    .await
}

#[tauri::command]
pub async fn git_stash_drop(
    state: State<'_, AppState>,
    selector: Option<String>,
) -> Result<(), String> {
    let repo = current_repo_or_err(&state)?;
    let selector = selector.unwrap_or_default();
    run_repo_task("git_stash_drop", repo, move |repo| {
        info!("git_stash_drop: selector='{}'", selector);
        match repo.inner().stash_drop(selector.as_str()) {
            Ok(()) => {
                info!("git_stash_drop: success selector='{}'", selector);
                Ok(())
            }
            Err(e) => {
                error!("git_stash_drop: failed selector='{}': {}", selector, e);
                Err(e.to_string())
            }
        }
    })
    .await
}

#[tauri::command]
pub async fn git_stash_show(
    state: State<'_, AppState>,
    selector: Option<String>,
) -> Result<Vec<String>, String> {
    let repo = current_repo_or_err(&state)?;
    let selector = selector.unwrap_or_default();
    run_repo_task("git_stash_show", repo, move |repo| {
        repo.inner()
            .stash_show(selector.as_str())
            .map_err(|e| e.to_string())
    })
    .await
}
