// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

use log::{debug, error, info};
use tauri::State;

use crate::core::models::BranchItem;
use crate::core::{BackendId, Vcs};

use crate::plugin_runtime::settings_store;
use crate::plugin_vcs_backends;
use crate::settings::DEFAULT_MERGE_TEMPLATE;
use crate::state::AppState;
use crate::urlparse::{repo_name_from_origin, repo_username_from_origin};

use super::{current_repo_or_err, default_remote_name, run_repo_task};

/// Resolves repo owner/name metadata for merge-message templates from the
/// default remote: the current branch's upstream remote when resolvable,
/// else the first configured remote. Falls back to the workdir name with an
/// empty owner when no remote is available.
///
/// # Parameters
/// - `vcs`: Repository backend.
/// - `branch`: Branch used to resolve the upstream remote.
/// - `workdir_name`: Repository directory name used as a name fallback.
///
/// # Returns
/// - `(owner, name)` metadata pair.
fn merge_message_repo_metadata(
    vcs: &dyn Vcs,
    branch: &str,
    workdir_name: &str,
) -> (String, String) {
    let remote_url = default_remote_name(vcs, branch).and_then(|remote_name| {
        vcs.list_remotes()
            .ok()?
            .into_iter()
            .find(|(name, _)| name == &remote_name)
            .map(|(_, url)| url)
    });
    match remote_url {
        Some(url) => {
            let username = repo_username_from_origin(&url).unwrap_or_default();
            let name = repo_name_from_origin(&url).unwrap_or_else(|| workdir_name.to_string());
            (username, name)
        }
        None => (String::new(), workdir_name.to_string()),
    }
}

/// Expands merge-message template placeholders.
///
/// # Parameters
/// - `template`: Template string.
/// - `source_branch`: Source branch name.
/// - `target_branch`: Target branch name.
/// - `repo_name`: Repository name.
/// - `repo_username`: Repository owner/user.
///
/// # Returns
/// - Rendered merge message.
fn apply_merge_template(
    template: &str,
    source_branch: &str,
    target_branch: &str,
    repo_name: &str,
    repo_username: &str,
) -> String {
    template
        .replace("{branch:source}", source_branch)
        .replace("{branch:target}", target_branch)
        .replace("{repo:name}", repo_name)
        .replace("{repo:username}", repo_username)
}

/// Returns the merge message template from the active backend plugin settings.
fn backend_merge_message_template(backend_id: &BackendId) -> String {
    let value = plugin_vcs_backends::plugin_vcs_backend_descriptor(backend_id)
        .ok()
        .and_then(|descriptor| settings_store::load_settings(&descriptor.plugin_id).ok())
        .and_then(|settings| settings.get("merge_commit_message_template").cloned())
        .and_then(|value| value.as_str().map(str::to_string))
        .unwrap_or_default();

    let trimmed = value.trim();
    if trimmed.is_empty() {
        DEFAULT_MERGE_TEMPLATE.to_string()
    } else {
        trimmed.to_string()
    }
}

#[tauri::command]
/// Returns normalized local/remote branches for the current repository.
///
/// # Parameters
/// - `state`: Shared application state.
///
/// # Returns
/// - `Ok(Vec<BranchItem>)` sorted branch list.
/// - `Err(String)` when repository access fails.
pub async fn vcs_list_branches(state: State<'_, AppState>) -> Result<Vec<BranchItem>, String> {
    let repo = current_repo_or_err(&state)?;
    run_repo_task("vcs_list_branches", repo, move |repo| {
        info!("list_branches: fetching unified branches via Vcs::branches()");
        let vcs = repo.inner();
        debug!("list_branches: workdir={}", vcs.workdir().display());

        let items = vcs.branches().map_err(|e| {
            error!("list_branches: branches() failed: {e:?}");
            e.to_string()
        })?;

        let current_local = vcs.current_branch().map_err(|e| {
            error!("list_branches: current_branch failed: {e:?}");
            e.to_string()
        })?;

        let out = super::snapshot::normalize_branches(items, current_local.as_deref());

        debug!(
            "list_branches: current_local={:?}, returned={}",
            current_local,
            out.len()
        );

        Ok(out)
    })
    .await
}

#[derive(serde::Serialize)]
/// HEAD state payload for branch/commit status checks.
pub struct HeadStatus {
    /// Whether HEAD is detached from a local branch.
    pub detached: bool,
    /// Current local branch name when attached.
    pub branch: Option<String>,
    /// Current HEAD commit id when available.
    pub commit: Option<String>,
}

#[tauri::command]
/// Returns HEAD status (detached/current branch/commit).
///
/// # Parameters
/// - `state`: Shared application state.
///
/// # Returns
/// - `Ok(HeadStatus)` with branch and commit data.
/// - `Err(String)` when repository queries fail.
pub async fn vcs_head_status(state: State<'_, AppState>) -> Result<HeadStatus, String> {
    use crate::core::models::LogQuery;

    let repo = current_repo_or_err(&state)?;
    run_repo_task("vcs_head_status", repo, move |repo| {
        let branch = repo.inner().current_branch().map_err(|e| e.to_string())?;
        let q = LogQuery {
            rev: Some("HEAD".into()),
            limit: Some(1),
            ..Default::default()
        };
        let head = repo.inner().log_commits(&q).map_err(|e| e.to_string())?;
        let commit = head.first().map(|c| c.id.clone());

        Ok(HeadStatus {
            detached: branch.is_none(),
            branch,
            commit,
        })
    })
    .await
}

#[tauri::command]
/// Checks out an existing branch.
///
/// # Parameters
/// - `state`: Shared application state.
/// - `name`: Branch name to checkout.
///
/// # Returns
/// - `Ok(())` when checkout succeeds.
/// - `Err(String)` when validation or checkout fails.
pub async fn vcs_checkout_branch(state: State<'_, AppState>, name: String) -> Result<(), String> {
    let branch = name.trim();
    if branch.is_empty() {
        return Err("Branch name cannot be empty".to_string());
    }

    info!("vcs_checkout_branch: attempting to checkout '{branch}'");

    let repo = current_repo_or_err(&state)?;
    let branch = branch.to_string();
    run_repo_task("vcs_checkout_branch", repo, move |repo| {
        repo.inner().checkout_branch(&branch).map_err(|e| {
            error!("vcs_checkout_branch: failed to checkout '{}': {e}", branch);
            e.to_string()
        })?;

        info!("vcs_checkout_branch: successfully checked out '{}'", branch);
        Ok(())
    })
    .await
}

#[tauri::command]
/// Deletes a branch.
///
/// # Parameters
/// - `state`: Shared application state.
/// - `name`: Branch name to delete.
/// - `force`: Optional force-delete flag.
///
/// # Returns
/// - `Ok(())` when deletion succeeds.
/// - `Err(String)` when validation or deletion fails.
pub async fn vcs_delete_branch(
    state: State<'_, AppState>,
    name: String,
    force: Option<bool>,
) -> Result<(), String> {
    let name = name.trim();
    if name.is_empty() {
        return Err("Branch name cannot be empty".to_string());
    }
    let repo = current_repo_or_err(&state)?;
    let force = force.unwrap_or(false);
    let branch = name.to_string();
    run_repo_task("vcs_delete_branch", repo, move |repo| {
        repo.inner()
            .delete_branch(&branch, force)
            .map_err(|e| e.to_string())
    })
    .await
}

#[tauri::command]
/// Renames a branch.
///
/// # Parameters
/// - `state`: Shared application state.
/// - `old_name`: Existing branch name.
/// - `new_name`: New branch name.
///
/// # Returns
/// - `Ok(())` when rename succeeds.
/// - `Err(String)` when validation or rename fails.
pub async fn vcs_rename_branch(
    state: State<'_, AppState>,
    old_name: String,
    new_name: String,
) -> Result<(), String> {
    let old = old_name.trim();
    let newn = new_name.trim();
    if old.is_empty() || newn.is_empty() {
        return Err("Branch name cannot be empty".into());
    }
    if old == newn {
        return Ok(());
    }
    let repo = current_repo_or_err(&state)?;
    let old = old.to_string();
    let newn = newn.to_string();
    run_repo_task("vcs_rename_branch", repo, move |repo| {
        repo.inner()
            .rename_branch(&old, &newn)
            .map_err(|e| e.to_string())
    })
    .await
}

#[tauri::command]
/// Returns the merge strategies advertised by the current VCS backend.
///
/// An empty list means only the default merge strategy is available.
///
/// # Parameters
/// - `state`: Shared application state.
///
/// # Returns
/// - `Ok(Vec<String>)` — supported strategy names (e.g. `"squash"`, `"rebase"`).
pub async fn vcs_merge_strategies(state: State<'_, AppState>) -> Result<Vec<String>, String> {
    let repo = current_repo_or_err(&state)?;
    run_repo_task("vcs_merge_strategies", repo, move |repo| {
        let caps = repo.inner().caps().map_err(|e| e.to_string())?;
        Ok(caps.merge_strategies)
    })
    .await
}

#[tauri::command]
/// Merges a source branch into the current branch.
///
/// # Parameters
/// - `state`: Shared application state.
/// - `name`: Source branch to merge.
/// - `strategy`: Optional merge strategy (`merge`, `squash`, or `rebase`).
///
/// # Returns
/// - `Ok(())` when merge succeeds.
/// - `Err(String)` when validation or merge fails.
pub async fn vcs_merge_branch(
    state: State<'_, AppState>,
    name: String,
    strategy: Option<String>,
) -> Result<(), String> {
    let name = name.trim();
    if name.is_empty() {
        return Err("Branch name cannot be empty".to_string());
    }
    // Validate strategy before dispatching
    let validated_strategy: Option<String> = match strategy.as_deref() {
        None | Some("merge") => None,
        Some(s) if s.trim().is_empty() => {
            return Err("Merge strategy cannot be empty".to_string());
        }
        Some("squash") | Some("rebase") => strategy,
        Some(other) => {
            return Err(format!(
                "Unknown merge strategy '{other}'. Must be 'merge', 'squash', or 'rebase'."
            ));
        }
    };

    let repo = current_repo_or_err(&state)?;
    let branch = name.to_string();
    let template = backend_merge_message_template(&repo.id());
    run_repo_task("vcs_merge_branch", repo, move |repo| {
        // Backend-side capability guard: reject strategy if not in supported list
        if let Some(ref strat) = validated_strategy {
            let caps = repo.inner().caps().map_err(|e| e.to_string())?;
            if !caps.merge_strategies.iter().any(|s| s == strat) {
                return Err(format!("Backend does not support merge strategy '{strat}'"));
            }
        }

        let vcs = repo.inner();
        let target_branch = vcs
            .current_branch()
            .ok()
            .flatten()
            .unwrap_or_else(|| "HEAD".to_string());

        let workdir_name = vcs
            .workdir()
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("repo")
            .to_string();

        let (repo_username, repo_name) =
            merge_message_repo_metadata(vcs, &target_branch, &workdir_name);

        let msg = template.trim();
        let message = if msg.is_empty() {
            None
        } else {
            Some(apply_merge_template(
                msg,
                &branch,
                &target_branch,
                &repo_name,
                &repo_username,
            ))
        };

        vcs.merge_into_current_with_message(
            &branch,
            message.as_deref(),
            validated_strategy.as_deref(),
        )
        .map_err(|e| e.to_string())
    })
    .await
}

#[derive(serde::Serialize)]
/// Merge-state payload consumed by the UI.
pub struct MergeContext {
    /// Whether an in-progress merge is detected in the repository.
    pub in_progress: bool,
}

#[tauri::command]
/// Returns whether a merge operation is currently in progress.
///
/// # Parameters
/// - `state`: Shared application state.
///
/// # Returns
/// - `Ok(MergeContext)` merge state payload.
/// - `Err(String)` when repository access fails.
pub async fn vcs_merge_context(state: State<'_, AppState>) -> Result<MergeContext, String> {
    let repo = current_repo_or_err(&state)?;
    run_repo_task("vcs_merge_context", repo, move |repo| {
        let in_progress = repo.inner().merge_in_progress().unwrap_or(false);
        Ok(MergeContext { in_progress })
    })
    .await
}

#[tauri::command]
/// Aborts the current merge operation.
///
/// # Parameters
/// - `state`: Shared application state.
///
/// # Returns
/// - `Ok(())` when abort succeeds.
/// - `Err(String)` when abort fails.
pub async fn vcs_merge_abort(state: State<'_, AppState>) -> Result<(), String> {
    let repo = current_repo_or_err(&state)?;
    run_repo_task("vcs_merge_abort", repo, move |repo| {
        repo.inner().merge_abort().map_err(|e| e.to_string())
    })
    .await
}

#[tauri::command]
/// Continues the current merge operation.
///
/// # Parameters
/// - `state`: Shared application state.
///
/// # Returns
/// - `Ok(())` when continuation succeeds.
/// - `Err(String)` when continuation fails.
pub async fn vcs_merge_continue(state: State<'_, AppState>) -> Result<(), String> {
    let repo = current_repo_or_err(&state)?;
    run_repo_task("vcs_merge_continue", repo, move |repo| {
        repo.inner().merge_continue().map_err(|e| e.to_string())
    })
    .await
}

#[tauri::command]
/// Sets upstream tracking branch for a local branch.
///
/// # Parameters
/// - `state`: Shared application state.
/// - `branch`: Local branch name.
/// - `upstream`: Upstream ref name.
///
/// # Returns
/// - `Ok(())` when upstream is updated.
/// - `Err(String)` when validation or update fails.
pub async fn vcs_set_upstream(
    state: State<'_, AppState>,
    branch: String,
    upstream: String,
) -> Result<(), String> {
    let branch = branch.trim();
    let upstream = upstream.trim();
    if branch.is_empty() || upstream.is_empty() {
        return Err("Branch/upstream cannot be empty".to_string());
    }

    let repo = current_repo_or_err(&state)?;
    let branch = branch.to_string();
    let upstream = upstream.to_string();
    run_repo_task("vcs_set_upstream", repo, move |repo| {
        repo.inner()
            .set_branch_upstream(&branch, &upstream)
            .map_err(|e| e.to_string())
    })
    .await
}

#[tauri::command]
/// Creates a branch, optionally from another branch and optionally checks it out.
///
/// # Parameters
/// - `state`: Shared application state.
/// - `name`: New branch name.
/// - `from`: Optional base branch to checkout before creation.
/// - `checkout`: Optional flag to checkout the new branch.
///
/// # Returns
/// - `Ok(())` when creation succeeds.
/// - `Err(String)` when backend operations fail.
pub async fn vcs_create_branch(
    state: State<'_, AppState>,
    name: String,
    from: Option<String>,
    checkout: Option<bool>,
) -> Result<(), String> {
    info!(
        "vcs_create_branch: requested branch '{}', from={:?}, checkout={:?}",
        name, from, checkout
    );

    let repo = current_repo_or_err(&state)?;
    let checkout_flag = checkout.unwrap_or(false);
    let branch_name = name.clone();
    let from_branch = from.map(|s| s.to_string());
    run_repo_task("vcs_create_branch", repo, move |repo| {
        let vcs = repo.inner();

        if let Some(from) = from_branch.as_ref().map(|value| value.trim()).filter(|value| !value.is_empty()) {
            let current = vcs.current_branch().map_err(|e| e.to_string())?.unwrap_or_default();
            if from != current {
                return Err(
                    "creating a branch from a non-current base is not supported by the active backend"
                        .to_string(),
                );
            }
        }

        vcs.create_branch(&branch_name, checkout_flag)
            .map_err(|e| {
                error!("vcs_create_branch: failed to create branch '{branch_name}': {e}");
                e.to_string()
            })?;

        info!("vcs_create_branch: successfully created branch '{branch_name}'");
        Ok(())
    })
    .await
}

#[derive(serde::Serialize)]
/// Compact repository snapshot used by quick status views.
pub struct RepoSummary {
    /// Absolute repository worktree path.
    path: String,
    /// Current branch name, or `HEAD` when detached.
    current_branch: String,
    /// Normalized local/remote branch list.
    branches: Vec<BranchItem>,
}

#[tauri::command]
/// Returns a compact summary of the current repository.
///
/// # Parameters
/// - `state`: Shared application state.
///
/// # Returns
/// - `Ok(RepoSummary)` containing path/current branch/branch list.
/// - `Err(String)` when repository access fails.
pub async fn get_repo_summary(state: State<'_, AppState>) -> Result<RepoSummary, String> {
    let repo = current_repo_or_err(&state)?;
    let (path, current) = run_repo_task("get_repo_summary", repo, move |repo| {
        let vcs = repo.inner();
        let path = vcs.workdir().to_string_lossy().to_string();
        let current = vcs
            .current_branch()
            .map_err(|e| e.to_string())?
            .unwrap_or_else(|| "HEAD".into());
        Ok::<_, String>((path, current))
    })
    .await?;

    let normalized = vcs_list_branches(state).await?;

    Ok(RepoSummary {
        path,
        current_branch: current,
        branches: normalized,
    })
}

#[tauri::command]
/// Returns the current local branch name.
///
/// # Parameters
/// - `state`: Shared application state.
///
/// # Returns
/// - `Ok(String)` branch name.
/// - `Err(String)` when detached HEAD or backend failure occurs.
pub async fn vcs_current_branch(state: State<'_, AppState>) -> Result<String, String> {
    let repo = current_repo_or_err(&state)?;
    run_repo_task("vcs_current_branch", repo, move |repo| {
        repo.inner()
            .current_branch()
            .map_err(|e| e.to_string())?
            .ok_or_else(|| "Detached HEAD".to_string())
    })
    .await
}

#[cfg(test)]
mod tests {
    include!("../../tests/tauri_commands/branches.rs");
}
