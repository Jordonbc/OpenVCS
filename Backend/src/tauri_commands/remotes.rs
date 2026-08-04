// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later
use crate::core::models::{CommitItem, LogQuery, VcsEvent};
use crate::core::{Vcs, VcsError};
use crate::state::AppState;

use log::{error, info, warn};
use tauri::{Emitter, Manager, Runtime, State, Window};

use super::{
    ProgressPayload, current_repo_or_err, first_remote_name, parse_upstream_ref, progress_bridge,
    run_repo_task,
};

use crate::urlparse::host_from_remote_url;


// BLOCKED-CROSS-REPO VCS-19: error-phrase heuristics cannot be replaced with
// structured plugin errors until the cross-repo error contract lands; do not
// change this logic.
/// Heuristically detects unknown-host-key style errors.
///
/// # Parameters
/// - `msg`: Error text.
///
/// # Returns
/// - `true` when text resembles host-key issues.
/// - `false` otherwise.
fn looks_like_unknown_host_key(msg: &str) -> bool {
    let m = msg.to_lowercase();
    m.contains("the authenticity of host")
        || m.contains("host key verification failed")
        || m.contains("no hostkey alg")
        || m.contains("could not resolve hostname")
        || m.contains("known_hosts")
        || m.contains("strict host key checking")
}

// BLOCKED-CROSS-REPO VCS-19: error-phrase heuristics cannot be replaced with
// structured plugin errors until the cross-repo error contract lands; do not
// change this logic.
/// Heuristically detects SSH authentication failures.
///
/// # Parameters
/// - `msg`: Error text.
///
/// # Returns
/// - `true` when text resembles auth failure.
/// - `false` otherwise.
fn looks_like_ssh_auth_failure(msg: &str) -> bool {
    let m = msg.to_lowercase();
    m.contains("permission denied")
        || m.contains("publickey")
        || m.contains("could not read from remote repository")
        || m.contains("authentication failed")
}

// BLOCKED-CROSS-REPO VCS-19: error-phrase heuristics cannot be replaced with
// structured plugin errors until the cross-repo error contract lands; do not
// change this logic.
/// Heuristically detects fast-forward-only divergence failures.
///
/// # Parameters
/// - `msg`: Error text.
///
/// # Returns
/// - `true` when text resembles a diverged ff-only pull.
/// - `false` otherwise.
fn looks_like_ff_only_divergence(msg: &str) -> bool {
    let m = msg.to_lowercase();
    m.contains("not possible to fast-forward")
        || m.contains("can't be fast-forwarded")
        || m.contains("cannot be fast-forwarded")
        || (m.contains("fast-forward") && m.contains("diverg"))
}

/// Returns remote URL for a named remote.
///
/// # Parameters
/// - `repo`: Repository backend.
/// - `remote`: Remote name.
///
/// # Returns
/// - `Some(String)` URL when found.
/// - `None` otherwise.
fn remote_url_for(repo: &dyn Vcs, remote: &str) -> Option<String> {
    let remote = remote.trim();
    if remote.is_empty() {
        return None;
    }

    let remotes = repo.list_remotes().ok()?;
    remotes
        .into_iter()
        .find_map(|(name, url)| if name == remote { Some(url) } else { None })
}

/// Emits SSH host-key/auth prompt events based on failure text.
///
/// # Parameters
/// - `app`: App handle for event emission.
/// - `remote`: Remote name.
/// - `url`: Remote URL.
/// - `msg`: Error message.
///
/// # Returns
/// - `()`.
fn emit_ssh_prompt<R: Runtime>(app: &tauri::AppHandle<R>, remote: &str, url: &str, msg: &str) {
    if looks_like_unknown_host_key(msg) {
        if let Some(host) = host_from_remote_url(url) {
            let _ = app.emit(
                "ui:ssh-hostkey",
                SshHostKeyPrompt {
                    host,
                    remote: remote.to_string(),
                    url: url.to_string(),
                    message: msg.to_string(),
                },
            );
        }
    } else if looks_like_ssh_auth_failure(msg)
        && let Some(host) = host_from_remote_url(url)
    {
        let _ = app.emit(
            "ui:ssh-auth",
            SshAuthPrompt {
                host,
                remote: remote.to_string(),
                url: url.to_string(),
                message: msg.to_string(),
            },
        );
    }
}

#[derive(Clone, serde::Serialize)]
/// UI event payload requesting unknown-host-key confirmation.
struct SshHostKeyPrompt {
    /// Remote host name requiring trust confirmation.
    host: String,
    /// Remote alias involved in the failed operation.
    remote: String,
    /// Remote URL associated with the host.
    url: String,
    /// Raw backend error message.
    message: String,
}

#[derive(Clone, serde::Serialize)]
/// UI event payload requesting SSH authentication troubleshooting.
struct SshAuthPrompt {
    /// Remote host that rejected authentication.
    host: String,
    /// Remote alias involved in the failed operation.
    remote: String,
    /// Remote URL associated with the host.
    url: String,
    /// Raw backend error message.
    message: String,
}

#[tauri::command]
/// Creates or updates a remote URL by name.
///
/// # Parameters
/// - `state`: Shared application state.
/// - `name`: Remote name.
/// - `url`: Remote URL.
///
/// # Returns
/// - `Ok(())` when remote is set.
/// - `Err(String)` on validation or backend failure.
pub async fn vcs_set_remote_url(
    state: State<'_, AppState>,
    name: String,
    url: String,
) -> Result<(), String> {
    let repo = current_repo_or_err(&state)?;
    let name = name.trim().to_string();
    let url = url.trim().to_string();

    if name.is_empty() {
        return Err("Remote name cannot be empty".to_string());
    }
    if url.is_empty() {
        return Err("Remote URL cannot be empty".to_string());
    }

    run_repo_task("vcs_set_remote_url", repo, move |repo| {
        repo.inner()
            .ensure_remote(&name, &url)
            .map_err(|e| e.to_string())?;
        Ok(())
    })
    .await?;

    Ok(())
}

#[tauri::command]
/// Fetches updates for the current branch's upstream (or default remote).
///
/// # Parameters
/// - `window`: Calling window handle for progress/events.
/// - `state`: Shared application state.
///
/// # Returns
/// - `Ok(())` when fetch completes.
/// - `Err(String)` when no repo/branch is selected or fetch fails.
pub async fn vcs_fetch<R: Runtime>(
    window: Window<R>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let repo = current_repo_or_err(&state)?;
    let app = window.app_handle().clone();
    let current = run_repo_task("vcs_fetch", repo, move |repo| {
        info!("vcs_fetch called");
        let on = Some(progress_bridge(app.clone()));
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

        // Remote selection is host-side: prefer the current branch's resolved
        // upstream remote (derived from its upstream ref), else the first
        // configured remote, else error.
        let upstream = repo.inner().branch_upstream(&current).ok().flatten();
        let (remote, refspec) = match upstream.as_deref().and_then(parse_upstream_ref) {
            Some((remote, upstream_branch)) => (remote, upstream_branch),
            None => {
                let remote = first_remote_name(repo.inner())
                    .ok_or_else(|| "no remotes configured".to_string())?;
                (remote, current.clone())
            }
        };

        info!("Fetching '{refspec}' from remote '{remote}' (current branch '{current}')");
        if let Err(e) = repo.inner().fetch(&remote, &refspec, on) {
            let msg = e.user_message();
            let url = remote_url_for(repo.inner(), &remote).unwrap_or_default();
            emit_ssh_prompt(&app, &remote, &url, &msg);
            error!("Fetch failed for branch '{current}': {e}");
            return Err(msg);
        }

        info!("Fetch completed successfully for branch '{current}'");
        Ok(current)
    })
    .await?;

    let _ = window.app_handle().emit(
        "vcs-progress",
        ProgressPayload {
            message: format!("Fetch complete ({current})"),
        },
    );
    Ok(())
}

#[tauri::command]
/// Fetches all branch refs from all configured remotes.
///
/// # Parameters
/// - `window`: Calling window handle for progress/events.
/// - `state`: Shared application state.
///
/// # Returns
/// - `Ok(())` when all remotes fetch successfully.
/// - `Err(String)` when one or more remotes fail.
pub async fn vcs_fetch_all<R: Runtime>(
    window: Window<R>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let repo = current_repo_or_err(&state)?;
    let app = window.app_handle().clone();
    run_repo_task("vcs_fetch_all", repo, move |repo| {
        info!("vcs_fetch_all called");
        let on = Some(progress_bridge(app.clone()));
        let remotes = repo.inner().list_remotes().map_err(|e| {
            error!("Failed to list remotes: {e}");
            e.to_string()
        })?;

        if log::log_enabled!(log::Level::Trace) {
            log::trace!("vcs_fetch_all: remotes={:?}", remotes);
        }

        let mut failures: Vec<String> = Vec::new();
        for (r, url) in remotes.into_iter() {
            info!("Fetching all refs from remote '{r}'");
            let refspec_force = format!("+refs/heads/*:refs/remotes/{r}/*");
            let refspec = format!("refs/heads/*:refs/remotes/{r}/*");

            // Some backends/environments can be picky about force-refspec syntax; fall back to a
            // non-force refspec so we still populate `refs/remotes/<remote>/*` for the UI.
            if let Err(e) = repo.inner().fetch(&r, &refspec_force, on.clone()) {
                warn!("Fetch (force refspec) failed for remote '{r}': {e}; retrying without '+'");
                if let Err(e2) = repo.inner().fetch(&r, &refspec, on.clone()) {
                    let msg = e2.user_message();
                    emit_ssh_prompt(&app, &r, &url, &msg);
                    error!("Fetch failed for remote '{r}': {e2}");
                    failures.push(format!("{r}: {msg}"));
                    continue;
                }
            }
        }

        if log::log_enabled!(log::Level::Trace) {
            match repo.inner().branches() {
                Ok(mut branches) => {
                    branches.sort_by(|a, b| a.full_ref.cmp(&b.full_ref));
                    log::trace!("vcs_fetch_all: branches() returned {} refs", branches.len());
                    for b in branches {
                        log::trace!(
                            "vcs_fetch_all: branch ref={} name={} kind={:?} current={}",
                            b.full_ref,
                            b.name,
                            b.kind,
                            b.current
                        );
                    }
                }
                Err(e) => log::trace!("vcs_fetch_all: branches() failed: {e}"),
            }
        }

        if failures.is_empty() {
            Ok(())
        } else {
            Err(failures.join("\n"))
        }
    })
    .await
}

#[cfg(test)]
mod tests {
    include!("../../tests/tauri_commands/remotes.rs");
}

#[tauri::command]
/// Performs a fast-forward-only pull from the current branch upstream.
///
/// # Parameters
/// - `window`: Calling window handle for progress/events.
/// - `state`: Shared application state.
///
/// # Returns
/// - `Ok(PullResult)` describing whether pull executed or was skipped.
/// - `Err(String)` when pull fails.
pub async fn vcs_pull<R: Runtime>(
    window: Window<R>,
    state: State<'_, AppState>,
) -> Result<PullResult, String> {
    let repo = current_repo_or_err(&state)?;
    let app = window.app_handle().clone();
    let result = run_repo_task("vcs_pull", repo, move |repo| {
        info!("vcs_pull called");
        let on = Some(progress_bridge(app.clone()));
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

        let upstream = match repo.inner().branch_upstream(&current) {
            Ok(upstream) => upstream,
            Err(e) => {
                warn!("Failed to determine upstream for branch '{current}': {e}");
                None
            }
        };

        let Some(upstream) = upstream else {
            info!("Pull skipped for branch '{current}' (no upstream configured)");
            return Ok(PullResult {
                pulled: false,
                branch: current,
                reason: Some("No upstream configured for this branch; pull skipped".to_string()),
            });
        };

        let up = upstream.trim().trim_start_matches("refs/remotes/");
        let Some((remote, upstream_branch)) = up.split_once('/') else {
            warn!("Unrecognized upstream format for branch '{current}': '{upstream}'");
            return Ok(PullResult {
                pulled: false,
                branch: current,
                reason: Some("Unrecognized upstream format; pull skipped".to_string()),
            });
        };

        let remote = remote.trim();
        let upstream_branch = upstream_branch.trim();
        if remote.is_empty() || upstream_branch.is_empty() {
            warn!("Unrecognized upstream format for branch '{current}': '{upstream}'");
            return Ok(PullResult {
                pulled: false,
                branch: current,
                reason: Some("Unrecognized upstream format; pull skipped".to_string()),
            });
        }

        info!("Pulling '{current}' from {remote}/{upstream_branch}");
        match repo.inner().pull_ff_only(remote, upstream_branch, on) {
            Ok(()) => {
                info!("Pull completed successfully for branch '{current}'");
                Ok(PullResult {
                    pulled: true,
                    branch: current,
                    reason: None,
                })
            }
            Err(VcsError::NoUpstream) => {
                info!("Pull skipped for branch '{current}' (no upstream configured)");
                Ok(PullResult {
                    pulled: false,
                    branch: current,
                    reason: Some(
                        "No upstream configured for this branch; pull skipped".to_string(),
                    ),
                })
            }
            Err(e) => {
                let msg = e.user_message();
                if looks_like_ff_only_divergence(&msg) {
                    info!("Pull skipped for branch '{current}': {e}");
                    return Ok(PullResult {
                        pulled: false,
                        branch: current.clone(),
                        reason: Some(format!(
                            "Branch '{current}' diverged from {remote}/{upstream_branch}; fast-forward pull skipped"
                        )),
                    });
                }

                let url = remote_url_for(repo.inner(), remote).unwrap_or_default();
                emit_ssh_prompt(&app, remote, &url, &msg);
                error!("Pull failed for branch '{current}': {e}");
                Err(msg)
            }
        }
    })
    .await?;

    let msg = if result.pulled {
        format!("Pull complete ({})", result.branch)
    } else {
        format!("Pull skipped ({})", result.branch)
    };
    let _ = window
        .app_handle()
        .emit("vcs-progress", ProgressPayload { message: msg });
    Ok(result)
}

#[derive(serde::Serialize)]
/// Pull execution result returned to the frontend.
pub struct PullResult {
    /// Whether a pull operation ran and updated local refs.
    pub pulled: bool,
    /// Branch name evaluated for the pull.
    pub branch: String,
    /// Skip/failure context when no pull was performed.
    pub reason: Option<String>,
}

#[tauri::command]
/// Pushes the current branch to its default remote, refreshes tracking refs, and
/// best-effort ensures the branch tracks the corresponding upstream on that remote
/// when one is not already configured.
///
/// # Parameters
/// - `window`: Calling window handle for progress/events.
/// - `state`: Shared application state.
///
/// # Returns
/// - `Ok(())` when push completes.
/// - `Err(String)` when push fails.
pub async fn vcs_push<R: Runtime>(
    window: Window<R>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let repo = current_repo_or_err(&state)?;
    let app = window.app_handle().clone();
    let current = run_repo_task("vcs_push", repo, move |repo| {
        info!("vcs_push called");
        let on = Some(progress_bridge(app.clone()));

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
        // Remote selection is host-side: prefer the current branch's resolved
        // upstream remote (derived from its upstream ref), else the first
        // configured remote, else error.
        let upstream = repo.inner().branch_upstream(&current).ok().flatten();
        let upstream_remote = upstream
            .as_deref()
            .and_then(parse_upstream_ref)
            .map(|(remote, _)| remote);
        let remote = match &upstream_remote {
            Some(remote) => remote.clone(),
            None => first_remote_name(repo.inner())
                .ok_or_else(|| "no remotes configured".to_string())?,
        };
        info!("Pushing branch '{current}' with refspec '{refspec}'");

        repo.inner().push(&remote, &refspec, on).map_err(|e| {
            let msg = e.user_message();
            error!("Push failed for branch '{current}': {e}");
            msg
        })?;

        // Pushing does not update local remote-tracking refs (refs/remotes/<remote>/*),
        // which the UI uses for ahead/behind; refresh them best-effort.
        let on_fetch = Some(progress_bridge(app));
        if let Err(e) = repo.inner().fetch(&remote, &current, on_fetch) {
            warn!("Post-push fetch failed for branch '{current}': {e}");
        }

        if upstream_remote.is_none()
            && let Err(e) = repo
                .inner()
                .set_branch_upstream(&current, &format!("{remote}/{current}"))
        {
            warn!("Failed to set upstream for published branch '{current}': {e}");
        }
        info!("Push completed successfully for '{current}'");
        Ok(current)
    })
    .await?;

    let _ = window.app_handle().emit(
        "vcs-progress",
        ProgressPayload {
            message: format!("Push complete ({current})"),
        },
    );

    Ok(())
}

#[tauri::command]
/// Soft-resets HEAD to upstream to undo unpushed commits.
///
/// # Parameters
/// - `window`: Calling window handle for progress/events.
/// - `state`: Shared application state.
///
/// # Returns
/// - `Ok(())` when reset succeeds.
/// - `Err(String)` when nothing is ahead or reset fails.
pub async fn vcs_undo_since_push<R: Runtime>(
    window: Window<R>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    info!("vcs_undo_since_push called");

    let repo = current_repo_or_err(&state)?;
    let app = window.app_handle().clone();
    run_repo_task("vcs_undo_since_push", repo, move |repo| {
        let status = repo.inner().status_payload().map_err(|e| e.to_string())?;
        if status.ahead == 0 {
            return Err("Nothing to undo (no unpushed commits)".into());
        }
        let on = progress_bridge(app);
        on(VcsEvent::Info {
            msg: "Undoing unpushed commits (soft reset)…".into(),
        });
        let cur = repo
            .inner()
            .current_branch()
            .map_err(|e| e.to_string())?
            .ok_or_else(|| VcsError::NoUpstream.user_message())?;
        let upstream = repo
            .inner()
            .branch_upstream(&cur)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| VcsError::NoUpstream.user_message())?;
        repo.inner()
            .reset_soft_to(&upstream)
            .map_err(|e| e.to_string())
    })
    .await
}

#[tauri::command]
/// Soft-resets HEAD to a selected commit, constrained to ahead-of-upstream history.
///
/// # Parameters
/// - `window`: Calling window handle for progress/events.
/// - `state`: Shared application state.
/// - `id`: Target commit id/prefix.
/// - `parent`: When true, reset to `id~1` (undo the commit itself, not everything above it).
///
/// # Returns
/// - `Ok(())` when reset succeeds.
/// - `Err(String)` when validation or reset fails.
pub async fn vcs_undo_to_commit<R: Runtime>(
    window: Window<R>,
    state: State<'_, AppState>,
    id: String,
    parent: Option<bool>,
) -> Result<(), String> {
    let parent = parent.unwrap_or(false);
    info!("vcs_undo_to_commit called for {id} (parent={parent})");

    let repo = current_repo_or_err(&state)?;
    let app = window.app_handle().clone();
    run_repo_task("vcs_undo_to_commit", repo, move |repo| {
        let mut ahead_list: Vec<CommitItem> = Vec::new();
        {
            // BLOCKED-CROSS-REPO VCS-04: directional range semantics need generic
            // {from,to} history — literal kept until cross-repo protocol lands.
            let mut q = LogQuery::head(1000);
            q.rev = Some("@{upstream}..HEAD".to_string());
            match repo.inner().log_commits(&q) {
                Ok(list) => ahead_list = list,
                Err(_) => {
                    if let Some(cur) = repo.inner().current_branch().map_err(|e| e.to_string())? {
                        // BLOCKED-CROSS-REPO VCS-04: `origin/{branch}..HEAD` literal is
                        // VCS-specific; blocked until generic {from,to} history exists.
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
        if !parent && !ahead_list.is_empty() {
            let target_in_ahead = ahead_list.iter().any(|c| c.id.starts_with(target));
            if !target_in_ahead {
                return Err("Selected commit is not ahead of upstream".into());
            }
        }

        let on = progress_bridge(app);
        on(VcsEvent::Info {
            msg: "Undoing to selected commit (soft reset)…".into(),
        });
        let rev = if parent {
            format!("{}~1", target)
        } else {
            target.to_string()
        };
        repo.inner()
            .reset_soft_to(&rev)
            .map_err(|e| e.to_string())?;
        Ok(())
    })
    .await
}
