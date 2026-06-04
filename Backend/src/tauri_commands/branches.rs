// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later
use std::collections::HashSet;

use log::{debug, error, info, warn};
use tauri::State;

use crate::core::BackendId;
use crate::core::models::{BranchItem, BranchKind};

use crate::plugin_runtime::settings_store;
use crate::plugin_vcs_backends;
use crate::state::AppState;

use super::{current_repo_or_err, run_repo_task};

const DEFAULT_MERGE_TEMPLATE: &str = "Merged branch '{branch:source}' into '{branch:target}'";

/// Extracts repository owner/user segment from remote URL.
///
/// # Parameters
/// - `url`: Remote URL.
///
/// # Returns
/// - `Some(String)` owner segment.
/// - `None` when not parseable.
fn repo_username_from_origin(url: &str) -> Option<String> {
    let u = url.trim();
    if u.is_empty() {
        return None;
    }

    // https://host/owner/repo(.git)
    if let Some(rest) = u
        .strip_prefix("https://")
        .or_else(|| u.strip_prefix("http://"))
    {
        let path = rest.split_once('/').map(|x| x.1).unwrap_or("");
        let mut seg = path.split('/').filter(|s| !s.is_empty());
        let owner = seg.next()?;
        return Some(owner.to_string());
    }

    // git@host:owner/repo(.git)
    if let Some(rest) = u.split_once(':').map(|x| x.1) {
        let mut seg = rest.split('/').filter(|s| !s.is_empty());
        let owner = seg.next()?;
        return Some(owner.to_string());
    }

    None
}

/// Extracts repository name segment from remote URL.
///
/// # Parameters
/// - `url`: Remote URL.
///
/// # Returns
/// - `Some(String)` repository name.
/// - `None` when not parseable.
fn repo_name_from_origin(url: &str) -> Option<String> {
    let u = url.trim();
    if u.is_empty() {
        return None;
    }

    // https://host/owner/repo(.git)
    if let Some(rest) = u
        .strip_prefix("https://")
        .or_else(|| u.strip_prefix("http://"))
    {
        let path = rest.split_once('/').map(|x| x.1).unwrap_or("");
        let last = path.split('/').rfind(|s| !s.is_empty())?;
        return Some(last.strip_suffix(".git").unwrap_or(last).to_string());
    }

    // git@host:owner/repo(.git)
    if let Some(rest) = u.split_once(':').map(|x| x.1) {
        let last = rest.split('/').rfind(|s| !s.is_empty())?;
        return Some(last.strip_suffix(".git").unwrap_or(last).to_string());
    }

    None
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

        let mut items = vcs.branches().map_err(|e| {
            error!("list_branches: branches() failed: {e:?}");
            e.to_string()
        })?;

        let current_local = vcs.current_branch().map_err(|e| {
            error!("list_branches: current_branch failed: {e:?}");
            e.to_string()
        })?;

        /// Infers branch kind from full ref prefix.
        ///
        /// # Parameters
        /// - `full_ref`: Full ref name.
        ///
        /// # Returns
        /// - Inferred branch kind.
        fn infer_kind(full_ref: &str) -> BranchKind {
            if let Some(rest) = full_ref.strip_prefix("refs/heads/") {
                let _ = rest;
                BranchKind::Local
            } else if let Some(rest) = full_ref.strip_prefix("refs/remotes/") {
                if let Some((remote, _name)) = rest.split_once('/') {
                    return BranchKind::Remote {
                        remote: remote.to_string(),
                    };
                }
                BranchKind::Remote {
                    remote: String::from("unknown"),
                }
            } else {
                BranchKind::Unknown
            }
        }

        let current_name = current_local.as_deref();
        let mut seen: HashSet<String> = HashSet::new();
        let mut out: Vec<BranchItem> = Vec::with_capacity(items.len());

        for mut it in items.drain(..) {
            it.name = it.name.trim().to_string();
            it.full_ref = it.full_ref.trim().to_string();

            if it.name.is_empty() || it.full_ref.is_empty() {
                warn!(
                    "list_branches: dropping branch with empty name/full_ref: {:?}",
                    it
                );
                continue;
            }

            if matches!(it.kind, BranchKind::Unknown) {
                it.kind = infer_kind(&it.full_ref);
            }

            it.current = match (&it.kind, current_name) {
                (BranchKind::Local, Some(curr)) => it.name == *curr,
                _ => false,
            };

            if !seen.insert(it.full_ref.clone()) {
                debug!("list_branches: dedup duplicate ref {}", it.full_ref);
                continue;
            }

            out.push(it);
        }

        out.sort_by(|a, b| {
            let bucket = |x: &BranchItem| {
                if x.current {
                    0
                } else {
                    match x.kind {
                        BranchKind::Local => 1,
                        BranchKind::Remote { .. } => 2,
                        BranchKind::Unknown => 3,
                    }
                }
            };
            bucket(a).cmp(&bucket(b)).then_with(|| a.name.cmp(&b.name))
        });

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
/// Returns whether the current VCS backend supports merge strategy selection.
///
/// # Parameters
/// - `state`: Shared application state.
///
/// # Returns
/// - `Ok(bool)` indicating whether merge strategies are supported.
pub async fn vcs_merge_strategy_supported(state: State<'_, AppState>) -> Result<bool, String> {
    let repo = current_repo_or_err(&state)?;
    run_repo_task("vcs_merge_strategy_supported", repo, move |repo| {
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
    let validated_strategy = match strategy.as_deref() {
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
    let needs_caps_check = validated_strategy.is_some();

    let repo = current_repo_or_err(&state)?;
    let branch = name.to_string();
    let template = backend_merge_message_template(&repo.id());
    let strategy_clone = validated_strategy.clone();
    run_repo_task("vcs_merge_branch", repo, move |repo| {
        // Backend-side capability guard: reject squash/rebase if unsupported
        if needs_caps_check {
            let caps = repo.inner().caps().map_err(|e| e.to_string())?;
            if !caps.merge_strategies {
                return Err("Backend does not support merge strategies".to_string());
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

        let (repo_username, repo_name) = match vcs.list_remotes() {
            Ok(remotes) => {
                let origin = remotes
                    .iter()
                    .find(|(n, _)| n == "origin")
                    .map(|(_, url)| url.as_str())
                    .unwrap_or("");
                let username = repo_username_from_origin(origin).unwrap_or_default();
                let name = repo_name_from_origin(origin).unwrap_or_else(|| workdir_name.clone());
                (username, name)
            }
            Err(_) => (String::new(), workdir_name.clone()),
        };

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

        vcs.merge_into_current_with_message(&branch, message.as_deref(), strategy_clone.as_deref())
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
