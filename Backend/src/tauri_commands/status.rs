// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later
use std::path::PathBuf;

use log::{debug, error, info};
use tauri::State;

use crate::core::models::{CommitItem, LogQuery, StatusPayload};
use crate::state::AppState;

use super::{current_repo_or_err, run_repo_task};

/// Normalizes the commit history limit for `vcs_log`.
///
/// A missing limit keeps the historical default of 100 commits, `0` becomes
/// `None` (unlimited), and positive limits are clamped to the backend safety cap.
fn normalize_log_limit(limit: Option<usize>) -> Option<u32> {
    match limit.unwrap_or(100) {
        0 => None,
        n => Some(n.min(1000) as u32),
    }
}

#[tauri::command]
/// Returns repository status payload (files + ahead/behind).
///
/// # Parameters
/// - `state`: Shared application state.
///
/// # Returns
/// - `Ok(StatusPayload)` status details.
/// - `Err(String)` when status computation fails.
pub async fn vcs_status(state: State<'_, AppState>) -> Result<StatusPayload, String> {
    let repo = current_repo_or_err(&state)?;
    run_repo_task("vcs_status", repo, move |repo| {
        info!("vcs_status: fetching repo status");
        let payload = repo.inner().status_payload().map_err(|e| {
            error!("vcs_status: failed to compute status: {e}");
            e.to_string()
        })?;

        debug!(
            "vcs_status: files={}, ahead={}, behind={}",
            payload.files.len(),
            payload.ahead,
            payload.behind
        );

        Ok(payload)
    })
    .await
}

#[tauri::command]
/// Returns commit log entries for a rev range.
///
/// # Parameters
/// - `state`: Shared application state.
/// - `limit`: Optional max commit count.
/// - `rev`: Optional revision/range expression.
///
/// # Returns
/// - `Ok(Vec<CommitItem>)` commit list.
/// - `Err(String)` on backend failure.
pub async fn vcs_log(
    state: State<'_, AppState>,
    limit: Option<usize>,
    rev: Option<String>,
) -> Result<Vec<CommitItem>, String> {
    let repo = current_repo_or_err(&state)?;
    run_repo_task("vcs_log", repo, move |repo| {
        let q = LogQuery {
            rev,
            path: None,
            since_utc: None,
            until_utc: None,
            author_contains: None,
            skip: 0,
            limit: normalize_log_limit(limit),
            topo_order: true,
            include_merges: true,
        };

        repo.inner().log_commits(&q).map_err(|e| e.to_string())
    })
    .await
}

#[cfg(test)]
mod tests {
    include!("../../tests/tauri_commands/status.rs");
}

#[tauri::command]
/// Returns diff lines for a single file.
///
/// # Parameters
/// - `state`: Shared application state.
/// - `path`: Repository-relative file path.
///
/// # Returns
/// - `Ok(Vec<String>)` diff lines.
/// - `Err(String)` on backend failure.
pub async fn vcs_diff_file(
    state: State<'_, AppState>,
    path: String,
) -> Result<Vec<String>, String> {
    let repo = current_repo_or_err(&state)?;
    run_repo_task("vcs_diff_file", repo, move |repo| {
        repo.inner()
            .diff_file(&PathBuf::from(path))
            .map_err(|e| e.to_string())
    })
    .await
}

#[tauri::command]
/// Returns diff lines for a commit/revision.
///
/// # Parameters
/// - `state`: Shared application state.
/// - `id`: Commit id or revision spec.
///
/// # Returns
/// - `Ok(Vec<String>)` diff lines.
/// - `Err(String)` on backend failure.
pub async fn vcs_diff_commit(
    state: State<'_, AppState>,
    id: String,
) -> Result<Vec<String>, String> {
    let repo = current_repo_or_err(&state)?;
    run_repo_task("vcs_diff_commit", repo, move |repo| {
        repo.inner().diff_commit(&id).map_err(|e| e.to_string())
    })
    .await
}

#[tauri::command]
/// Discards changes for explicit file paths.
///
/// # Parameters
/// - `state`: Shared application state.
/// - `paths`: Repository-relative paths to discard.
///
/// # Returns
/// - `Ok(())` on success.
/// - `Err(String)` on backend failure.
pub async fn vcs_discard_paths(
    state: State<'_, AppState>,
    paths: Vec<String>,
) -> Result<(), String> {
    let repo = current_repo_or_err(&state)?;
    run_repo_task("vcs_discard_paths", repo, move |repo| {
        let pb: Vec<PathBuf> = paths.into_iter().map(PathBuf::from).collect();
        repo.inner().discard_paths(&pb).map_err(|e| e.to_string())
    })
    .await
}

#[tauri::command]
/// Applies a reverse patch to discard selected hunks.
///
/// # Parameters
/// - `state`: Shared application state.
/// - `patch`: Unified patch text.
///
/// # Returns
/// - `Ok(())` on success.
/// - `Err(String)` on backend failure.
pub async fn vcs_discard_patch(state: State<'_, AppState>, patch: String) -> Result<(), String> {
    let repo = current_repo_or_err(&state)?;
    run_repo_task("vcs_discard_patch", repo, move |repo| {
        repo.inner()
            .apply_reverse_patch(&patch)
            .map_err(|e| e.to_string())
    })
    .await
}
