// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later
use std::path::PathBuf;

use log::{error, info};
use tauri::State;

use crate::core::models::StashItem;
use crate::state::AppState;

use super::{current_repo_or_err, run_repo_task};

/// Returns the stash message that should be used for a new stash entry.
fn stash_message_or_default(message: Option<String>) -> String {
    message.unwrap_or_else(|| "WIP".to_string())
}

/// Returns whether untracked files should be included in the stash command.
fn include_untracked_or_default(include_untracked: Option<bool>) -> bool {
    include_untracked.unwrap_or(true)
}

/// Normalizes optional stash path filters into owned path buffers.
fn stash_paths(paths: Option<Vec<String>>) -> Vec<PathBuf> {
    paths
        .unwrap_or_default()
        .into_iter()
        .map(PathBuf::from)
        .collect()
}

/// Normalizes optional stash selectors to the backend's empty-string convention.
fn stash_selector_or_default(selector: Option<String>) -> String {
    selector.unwrap_or_default()
}

#[tauri::command]
/// Lists stash entries for the current repository.
///
/// # Parameters
/// - `state`: Shared application state.
///
/// # Returns
/// - `Ok(Vec<StashItem>)` stash list.
/// - `Err(String)` when listing fails.
pub async fn vcs_stash_list(state: State<'_, AppState>) -> Result<Vec<StashItem>, String> {
    let repo = current_repo_or_err(&state)?;
    run_repo_task("vcs_stash_list", repo, move |repo| {
        match repo.inner().stash_list() {
            Ok(items) => {
                info!("vcs_stash_list: count={}", items.len());
                for item in &items {
                    info!(
                        "vcs_stash_list: selector='{}' msg='{}' meta='{}'",
                        item.selector, item.msg, item.meta
                    );
                }
                Ok(items)
            }
            Err(e) => {
                error!("vcs_stash_list: failed: {}", e);
                Err(e.to_string())
            }
        }
    })
    .await
}

#[tauri::command]
/// Creates a stash entry.
///
/// # Parameters
/// - `state`: Shared application state.
/// - `message`: Optional stash message.
/// - `include_untracked`: Optional include-untracked flag.
/// - `paths`: Optional path subset.
///
/// # Returns
/// - `Ok(())` on success.
/// - `Err(String)` on stash failure.
pub async fn vcs_stash_push(
    state: State<'_, AppState>,
    message: Option<String>,
    include_untracked: Option<bool>,
    paths: Option<Vec<String>>,
) -> Result<(), String> {
    let repo = current_repo_or_err(&state)?;
    let msg = stash_message_or_default(message);
    let iu = include_untracked_or_default(include_untracked);
    let pathbufs = stash_paths(paths);
    run_repo_task("vcs_stash_push", repo, move |repo| {
        repo.inner()
            .stash_push(&msg, iu, &pathbufs)
            .map_err(|e| e.to_string())
    })
    .await
}

#[tauri::command]
/// Applies a stash entry without dropping it.
///
/// # Parameters
/// - `state`: Shared application state.
/// - `selector`: Optional stash selector (defaults to latest).
///
/// # Returns
/// - `Ok(())` on success.
/// - `Err(String)` on apply failure.
pub async fn vcs_stash_apply(
    state: State<'_, AppState>,
    selector: Option<String>,
) -> Result<(), String> {
    let repo = current_repo_or_err(&state)?;
    let selector = stash_selector_or_default(selector);
    run_repo_task("vcs_stash_apply", repo, move |repo| {
        repo.inner()
            .stash_apply(selector.as_str())
            .map_err(|e| e.to_string())
    })
    .await
}

#[tauri::command]
/// Pops a stash entry (apply + drop).
///
/// # Parameters
/// - `state`: Shared application state.
/// - `selector`: Optional stash selector (defaults to latest).
///
/// # Returns
/// - `Ok(())` on success.
/// - `Err(String)` on pop failure.
pub async fn vcs_stash_pop(
    state: State<'_, AppState>,
    selector: Option<String>,
) -> Result<(), String> {
    let repo = current_repo_or_err(&state)?;
    let selector = stash_selector_or_default(selector);
    run_repo_task("vcs_stash_pop", repo, move |repo| {
        repo.inner()
            .stash_pop(selector.as_str())
            .map_err(|e| e.to_string())
    })
    .await
}

#[tauri::command]
/// Drops a stash entry.
///
/// # Parameters
/// - `state`: Shared application state.
/// - `selector`: Optional stash selector (defaults to latest).
///
/// # Returns
/// - `Ok(())` on success.
/// - `Err(String)` on drop failure.
pub async fn vcs_stash_drop(
    state: State<'_, AppState>,
    selector: Option<String>,
) -> Result<(), String> {
    let repo = current_repo_or_err(&state)?;
    let selector = stash_selector_or_default(selector);
    run_repo_task("vcs_stash_drop", repo, move |repo| {
        info!("vcs_stash_drop: selector='{}'", selector);
        match repo.inner().stash_drop(selector.as_str()) {
            Ok(()) => {
                info!("vcs_stash_drop: success selector='{}'", selector);
                Ok(())
            }
            Err(e) => {
                error!("vcs_stash_drop: failed selector='{}': {}", selector, e);
                Err(e.to_string())
            }
        }
    })
    .await
}

#[tauri::command]
/// Shows patch lines for a stash entry.
///
/// # Parameters
/// - `state`: Shared application state.
/// - `selector`: Optional stash selector (defaults to latest).
///
/// # Returns
/// - `Ok(Vec<String>)` patch lines.
/// - `Err(String)` on lookup failure.
pub async fn vcs_stash_show(
    state: State<'_, AppState>,
    selector: Option<String>,
) -> Result<Vec<String>, String> {
    let repo = current_repo_or_err(&state)?;
    let selector = stash_selector_or_default(selector);
    run_repo_task("vcs_stash_show", repo, move |repo| {
        repo.inner()
            .stash_show(selector.as_str())
            .map_err(|e| e.to_string())
    })
    .await
}

#[cfg(test)]
mod tests {
    include!("../../tests/tauri_commands/stash.rs");
}
