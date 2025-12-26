use std::collections::HashSet;

use log::{debug, error, info, warn};
use tauri::State;

use openvcs_core::models::{BranchItem, BranchKind};

use crate::state::AppState;

use super::{current_repo_or_err, run_repo_task};

fn repo_username_from_origin(url: &str) -> Option<String> {
    let u = url.trim();
    if u.is_empty() {
        return None;
    }

    // https://host/owner/repo(.git)
    if let Some(rest) = u.strip_prefix("https://").or_else(|| u.strip_prefix("http://")) {
        let path = rest.splitn(2, '/').nth(1).unwrap_or("");
        let mut seg = path.split('/').filter(|s| !s.is_empty());
        let owner = seg.next()?;
        return Some(owner.to_string());
    }

    // git@host:owner/repo(.git)
    if let Some(rest) = u.splitn(2, ':').nth(1) {
        let mut seg = rest.split('/').filter(|s| !s.is_empty());
        let owner = seg.next()?;
        return Some(owner.to_string());
    }

    None
}

fn repo_name_from_origin(url: &str) -> Option<String> {
    let u = url.trim();
    if u.is_empty() {
        return None;
    }

    // https://host/owner/repo(.git)
    if let Some(rest) = u.strip_prefix("https://").or_else(|| u.strip_prefix("http://")) {
        let path = rest.splitn(2, '/').nth(1).unwrap_or("");
        let last = path.split('/').filter(|s| !s.is_empty()).last()?;
        return Some(last.strip_suffix(".git").unwrap_or(last).to_string());
    }

    // git@host:owner/repo(.git)
    if let Some(rest) = u.splitn(2, ':').nth(1) {
        let last = rest.split('/').filter(|s| !s.is_empty()).last()?;
        return Some(last.strip_suffix(".git").unwrap_or(last).to_string());
    }

    None
}

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

#[tauri::command]
pub async fn git_list_branches(state: State<'_, AppState>) -> Result<Vec<BranchItem>, String> {
    let repo = current_repo_or_err(&state)?;
    run_repo_task("git_list_branches", repo, move |repo| {
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
pub struct HeadStatus {
    pub detached: bool,
    pub branch: Option<String>,
    pub commit: Option<String>,
}

#[tauri::command]
pub async fn git_head_status(state: State<'_, AppState>) -> Result<HeadStatus, String> {
    use openvcs_core::models::LogQuery;

    let repo = current_repo_or_err(&state)?;
    run_repo_task("git_head_status", repo, move |repo| {
        let branch = repo.inner().current_branch().map_err(|e| e.to_string())?;
        let q = LogQuery {
            rev: Some("HEAD".into()),
            limit: 1,
            ..Default::default()
        };
        let head = repo.inner().log_commits(&q).map_err(|e| e.to_string())?;
        let commit = head.get(0).map(|c| c.id.clone());

        Ok(HeadStatus {
            detached: branch.is_none(),
            branch,
            commit,
        })
    })
    .await
}

#[tauri::command]
pub async fn git_checkout_branch(state: State<'_, AppState>, name: String) -> Result<(), String> {
    let branch = name.trim();
    if branch.is_empty() {
        return Err("Branch name cannot be empty".to_string());
    }

    info!("git_checkout_branch: attempting to checkout '{branch}'");

    let repo = current_repo_or_err(&state)?;
    let branch = branch.to_string();
    run_repo_task("git_checkout_branch", repo, move |repo| {
        repo.inner().checkout_branch(&branch).map_err(|e| {
            error!("git_checkout_branch: failed to checkout '{}': {e}", branch);
            e.to_string()
        })?;

        info!("git_checkout_branch: successfully checked out '{}'", branch);
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn git_delete_branch(
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
    run_repo_task("git_delete_branch", repo, move |repo| {
        repo.inner()
            .delete_branch(&branch, force)
            .map_err(|e| e.to_string())
    })
    .await
}

#[tauri::command]
pub async fn git_rename_branch(
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
    run_repo_task("git_rename_branch", repo, move |repo| {
        repo.inner()
            .rename_branch(&old, &newn)
            .map_err(|e| e.to_string())
    })
    .await
}

#[tauri::command]
pub async fn git_merge_branch(state: State<'_, AppState>, name: String) -> Result<(), String> {
    let name = name.trim();
    if name.is_empty() {
        return Err("Branch name cannot be empty".to_string());
    }
    let repo = current_repo_or_err(&state)?;
    let branch = name.to_string();
    let template = state.with_config(|cfg| cfg.git.merge_commit_message_template.clone());
    run_repo_task("git_merge_branch", repo, move |repo| {
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

        vcs.merge_into_current_with_message(&branch, message.as_deref())
            .map_err(|e| e.to_string())
    })
    .await
}

#[derive(serde::Serialize)]
pub struct MergeContext {
    pub in_progress: bool,
}

#[tauri::command]
pub async fn git_merge_context(state: State<'_, AppState>) -> Result<MergeContext, String> {
    let repo = current_repo_or_err(&state)?;
    run_repo_task("git_merge_context", repo, move |repo| {
        let in_progress = repo
            .inner()
            .merge_in_progress()
            .unwrap_or(false);
        Ok(MergeContext { in_progress })
    })
    .await
}

#[tauri::command]
pub async fn git_merge_abort(state: State<'_, AppState>) -> Result<(), String> {
    let repo = current_repo_or_err(&state)?;
    run_repo_task("git_merge_abort", repo, move |repo| {
        repo.inner().merge_abort().map_err(|e| e.to_string())
    })
    .await
}

#[tauri::command]
pub async fn git_merge_continue(state: State<'_, AppState>) -> Result<(), String> {
    let repo = current_repo_or_err(&state)?;
    run_repo_task("git_merge_continue", repo, move |repo| {
        repo.inner().merge_continue().map_err(|e| e.to_string())
    })
    .await
}

#[tauri::command]
pub async fn git_set_upstream(
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
    run_repo_task("git_set_upstream", repo, move |repo| {
        repo.inner()
            .set_branch_upstream(&branch, &upstream)
            .map_err(|e| e.to_string())
    })
    .await
}

#[tauri::command]
pub async fn git_create_branch(
    state: State<'_, AppState>,
    name: String,
    from: Option<String>,
    checkout: Option<bool>,
) -> Result<(), String> {
    info!(
        "git_create_branch: requested branch '{}', from={:?}, checkout={:?}",
        name, from, checkout
    );

    let repo = current_repo_or_err(&state)?;
    let checkout_flag = checkout.unwrap_or(false);
    let branch_name = name.clone();
    let from_branch = from.map(|s| s.to_string());
    run_repo_task("git_create_branch", repo, move |repo| {
        let vcs = repo.inner();

        if let Some(from) = from_branch.as_ref() {
            match vcs.checkout_branch(from) {
                Ok(_) => info!("git_create_branch: successfully checked out base branch '{from}'"),
                Err(e) => {
                    error!("git_create_branch: failed to checkout base branch '{from}': {e}");
                    return Err(format!("base branch not found or cannot checkout: {e}"));
                }
            }
        }

        vcs.create_branch(&branch_name, checkout_flag)
            .map_err(|e| {
                error!("git_create_branch: failed to create branch '{branch_name}': {e}");
                e.to_string()
            })?;

        info!("git_create_branch: successfully created branch '{branch_name}'");
        Ok(())
    })
    .await
}

#[derive(serde::Serialize)]
pub struct RepoSummary {
    path: String,
    current_branch: String,
    branches: Vec<BranchItem>,
}

#[tauri::command]
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

    let normalized = git_list_branches(state).await?;

    Ok(RepoSummary {
        path,
        current_branch: current,
        branches: normalized,
    })
}

#[tauri::command]
pub async fn git_current_branch(state: State<'_, AppState>) -> Result<String, String> {
    let repo = current_repo_or_err(&state)?;
    run_repo_task("git_current_branch", repo, move |repo| {
        repo.inner()
            .current_branch()
            .map_err(|e| e.to_string())?
            .ok_or_else(|| "Detached HEAD".to_string())
    })
    .await
}
