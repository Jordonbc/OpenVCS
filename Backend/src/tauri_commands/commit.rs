// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later
use std::path::PathBuf;
use std::sync::Arc;

use log::{error, info};
use tauri::{Manager, Runtime, State, Window, async_runtime};

use crate::core::OnEvent;
use crate::core::models::{HunkSelection, VcsEvent};
use crate::repo::Repo;
use crate::state::AppState;

use super::{current_repo_or_err, progress_bridge, run_repo_task};

fn build_commit_message(summary: &str, description: &str) -> String {
    if description.trim().is_empty() {
        summary.to_string()
    } else {
        format!("{summary}\n\n{description}")
    }
}

fn has_commit_selection(patch: &str, files_len: usize, stage_paths_len: usize) -> bool {
    !patch.trim().is_empty() || files_len > 0 || stage_paths_len > 0
}

fn trimmed_non_empty(value: &str, error: &str) -> Result<String, String> {
    let value = value.trim().to_string();
    if value.is_empty() {
        Err(error.to_string())
    } else {
        Ok(value)
    }
}

/// Resolves the repository commit identity from VCS config.
///
/// # Parameters
/// - `repo`: Active repository handle.
///
/// # Returns
/// - `Ok((name, email))` when the repository has a configured identity.
/// - `Err(String)` when the repository has no usable commit identity.
fn commit_identity(repo: &Repo) -> Result<(String, String), String> {
    repo.inner()
        .get_identity()
        .map_err(|e| e.to_string())?
        .ok_or_else(|| {
            "No VCS commit identity configured for this repository; set user.name and user.email in the repository settings".to_string()
        })
}

/// Runs the shared commit command lifecycle on a blocking task.
///
/// Resolves the current repository, builds the commit message from the
/// summary/description, and executes the command-specific `run` steps on a
/// blocking worker with progress events bridged to the UI. `join_error` maps
/// a blocking-task join failure into the command-specific error context.
///
/// # Parameters
/// - `window`: Calling window handle for progress events.
/// - `state`: Shared application state.
/// - `summary`: Commit summary line.
/// - `description`: Optional commit body text.
/// - `run`: Command-specific staging/commit steps executed in order; receives
///   the repository, the progress bridge callback, and the built message.
/// - `join_error`: Maps a blocking-task join failure to the command error.
///
/// # Returns
/// - `Ok(String)` created commit id.
/// - `Err(String)` when no repo is selected or the command steps fail.
async fn commit_runner<R: Runtime, F, J>(
    window: Window<R>,
    state: State<'_, AppState>,
    summary: String,
    description: String,
    run: F,
    join_error: J,
) -> Result<String, String>
where
    F: FnOnce(Arc<Repo>, OnEvent, String) -> Result<String, String> + Send + 'static,
    J: FnOnce(String) -> String + Send,
{
    let repo = state
        .current_repo()
        .ok_or_else(|| "No repository selected".to_string())?;
    let repo = repo.clone();
    let app = window.app_handle().clone();
    let message = build_commit_message(&summary, &description);

    async_runtime::spawn_blocking(move || {
        let on = progress_bridge(app);
        run(repo, on, message)
    })
    .await
    .map_err(|e| join_error(e.to_string()))?
}

#[tauri::command]
/// Commits all staged/working-tree changes using summary + optional description.
///
/// # Parameters
/// - `window`: Calling window handle for progress events.
/// - `state`: Shared application state.
/// - `summary`: Commit summary line.
/// - `description`: Optional commit body text.
///
/// # Returns
/// - `Ok(String)` created commit id.
/// - `Err(String)` when no repo is selected or commit fails.
pub async fn commit_changes<R: Runtime>(
    window: Window<R>,
    state: State<'_, AppState>,
    summary: String,
    description: String,
) -> Result<String, String> {
    info!("commit_changes called (summary: \"{}\")", summary);

    commit_runner(
        window,
        state,
        summary,
        description,
        move |repo, on, message| {
            on(VcsEvent::Info {
                msg: "Staging changes…".into(),
            });
            info!("Staging changes for commit");

            let (name, email) = commit_identity(repo.as_ref())?;
            info!("Using identity: {} <{}>", name, email);

            on(VcsEvent::Info {
                msg: "Writing commit…".into(),
            });
            let oid = repo
                .inner()
                .commit(&message, &name, &email, &[])
                .map_err(|e| {
                    error!("Commit failed: {e}");
                    e.to_string()
                })?;
            info!("Commit created successfully: {oid}");

            on(VcsEvent::Info {
                msg: "Commit created.".into(),
            });
            Ok(oid)
        },
        |e| {
            error!("commit_changes task join error: {e}");
            format!("commit task failed: {e}")
        },
    )
    .await
}

#[tauri::command]
/// Stages and commits only selected file paths.
///
/// # Parameters
/// - `window`: Calling window handle for progress events.
/// - `state`: Shared application state.
/// - `summary`: Commit summary line.
/// - `description`: Optional commit body text.
/// - `files`: Repository-relative file paths to include.
///
/// # Returns
/// - `Ok(String)` created commit id.
/// - `Err(String)` when commit fails.
pub async fn commit_selected<R: Runtime>(
    window: Window<R>,
    state: State<'_, AppState>,
    summary: String,
    description: String,
    files: Vec<String>,
) -> Result<String, String> {
    info!("commit_selected called ({} file(s))", files.len());

    commit_runner(
        window,
        state,
        summary,
        description,
        move |repo, on, message| {
            let (name, email) = commit_identity(repo.as_ref())?;

            let paths: Vec<PathBuf> = files.into_iter().map(PathBuf::from).collect();

            on(VcsEvent::Info {
                msg: "Staging selected files…".into(),
            });
            repo.inner().stage_paths(&paths).map_err(|e| {
                error!("stage_paths failed: {e}");
                e.to_string()
            })?;

            on(VcsEvent::Info {
                msg: "Writing commit…".into(),
            });
            let oid = repo
                .inner()
                .commit_index(&message, &name, &email)
                .map_err(|e| {
                    error!("Commit (selected) failed: {e}");
                    e.to_string()
                })?;
            Ok(oid)
        },
        |e| format!("commit_selected task failed: {e}"),
    )
    .await
}

#[tauri::command]
/// Applies a patch to the index, stages selected files, and commits the staged index.
///
/// # Parameters
/// - `window`: Calling window handle for progress events.
/// - `state`: Shared application state.
/// - `summary`: Commit summary line.
/// - `description`: Optional commit body text.
/// - `patch`: Unified patch to stage.
///
/// # Returns
/// - `Ok(String)` created commit id.
/// - `Err(String)` when staging or commit fails.
pub async fn commit_patch<R: Runtime>(
    window: Window<R>,
    state: State<'_, AppState>,
    summary: String,
    description: String,
    patch: String,
) -> Result<String, String> {
    info!("commit_patch called (patch size: {} bytes)", patch.len());

    commit_runner(
        window,
        state,
        summary,
        description,
        move |repo, on, message| {
            on(VcsEvent::Info {
                msg: "Staging selected hunks…".into(),
            });

            repo.inner().stage_patch(&patch).map_err(|e| {
                error!("stage_patch failed: {e}");
                e.to_string()
            })?;

            let (name, email) = commit_identity(repo.as_ref())?;

            on(VcsEvent::Info {
                msg: "Committing staged hunks…".into(),
            });
            let oid = repo
                .inner()
                .commit_index(&message, &name, &email)
                .map_err(|e| {
                    error!("commit_index failed: {e}");
                    e.to_string()
                })?;
            Ok(oid)
        },
        |e| format!("commit_patch task failed: {e}"),
    )
    .await
}

#[tauri::command]
/// Commits a mix of staged patch hunks and explicit files.
///
/// # Parameters
/// - `window`: Calling window handle for progress events.
/// - `state`: Shared application state.
/// - `summary`: Commit summary line.
/// - `description`: Optional commit body text.
/// - `patch`: Optional patch text to stage first.
/// - `files`: Explicit commit path list.
/// - `stage_paths`: Full-file paths to stage directly before commit.
///
/// # Returns
/// - `Ok(String)` created commit id.
/// - `Err(String)` when staging or commit fails.
pub async fn commit_patch_and_files<R: Runtime>(
    window: Window<R>,
    state: State<'_, AppState>,
    summary: String,
    description: String,
    patch: String,
    files: Vec<String>,
    stage_paths: Vec<String>,
) -> Result<String, String> {
    info!(
        "commit_patch_and_files called (patch bytes={}, files={}, stage_paths={})",
        patch.len(),
        files.len(),
        stage_paths.len()
    );

    commit_runner(
        window,
        state,
        summary,
        description,
        move |repo, on, message| {
            on(VcsEvent::Info {
                msg: "Staging selected hunks…".into(),
            });

            if !patch.trim().is_empty() {
                repo.inner().stage_patch(&patch).map_err(|e| {
                    error!("stage_patch failed: {e}");
                    e.to_string()
                })?;
            }

            let (name, email) = commit_identity(repo.as_ref())?;

            on(VcsEvent::Info {
                msg: "Writing commit…".into(),
            });
            let stage_paths: Vec<PathBuf> = stage_paths.iter().map(PathBuf::from).collect();
            if !stage_paths.is_empty() {
                on(VcsEvent::Info {
                    msg: "Staging selected files…".into(),
                });
                repo.inner().stage_paths(&stage_paths).map_err(|e| {
                    error!("stage_paths failed: {e}");
                    e.to_string()
                })?;
            }
            let has_selection = has_commit_selection(&patch, files.len(), stage_paths.len());
            if !has_selection {
                return Err("No commit paths provided".into());
            }

            let oid = repo
                .inner()
                .commit_index(&message, &name, &email)
                .map_err(|e| e.to_string())?;
            on(VcsEvent::Info {
                msg: "Commit complete".into(),
            });
            Ok(oid)
        },
        |e| format!("commit_patch_and_files task failed: {e}"),
    )
    .await
}

#[tauri::command]
/// Commits structured hunk/line selections (VCS-agnostic).
///
/// The frontend sends selection indices instead of a pre-built patch,
/// so each VCS plugin can handle its own diff format internally.
pub async fn commit_selection<R: Runtime>(
    window: Window<R>,
    state: State<'_, AppState>,
    summary: String,
    description: String,
    selections: Vec<HunkSelection>,
    stage_paths: Vec<String>,
) -> Result<String, String> {
    info!(
        "commit_selection called (selections={}, stage_paths={})",
        selections.len(),
        stage_paths.len(),
    );

    commit_runner(
        window,
        state,
        summary,
        description,
        move |repo, on, message| {
            on(VcsEvent::Info {
                msg: "Staging selected hunks…".into(),
            });

            if !selections.is_empty() {
                repo.inner().stage_selections(&selections).map_err(|e| {
                    error!("stage_selections failed: {e}");
                    e.to_string()
                })?;
            }

            let (name, email) = commit_identity(repo.as_ref())?;

            let stage_paths: Vec<PathBuf> = stage_paths.iter().map(PathBuf::from).collect();
            if !stage_paths.is_empty() {
                on(VcsEvent::Info {
                    msg: "Staging selected files…".into(),
                });
                repo.inner().stage_paths(&stage_paths).map_err(|e| {
                    error!("stage_paths failed: {e}");
                    e.to_string()
                })?;
            }

            if selections.is_empty() && stage_paths.is_empty() {
                return Err("No commit paths provided".into());
            }

            on(VcsEvent::Info {
                msg: "Writing commit…".into(),
            });
            let oid = repo
                .inner()
                .commit_index(&message, &name, &email)
                .map_err(|e| e.to_string())?;
            on(VcsEvent::Info {
                msg: "Commit complete".into(),
            });
            Ok(oid)
        },
        |e| format!("commit_selection task failed: {e}"),
    )
    .await
}

#[tauri::command]
/// Cherry-picks a commit onto a target branch.
///
/// # Parameters
/// - `window`: Calling window handle for progress events.
/// - `state`: Shared application state.
/// - `id`: Commit id/revision to cherry-pick.
/// - `branch`: Target branch name.
///
/// # Returns
/// - `Ok(())` on success.
/// - `Err(String)` on validation or cherry-pick failure.
pub async fn vcs_cherry_pick_to_branch<R: Runtime>(
    window: Window<R>,
    state: State<'_, AppState>,
    id: String,
    branch: String,
) -> Result<(), String> {
    info!(
        "vcs_cherry_pick_to_branch called (id={}, branch={})",
        id, branch
    );

    let repo = current_repo_or_err(&state)?;
    let app = window.app_handle().clone();
    run_repo_task("vcs_cherry_pick_to_branch", repo, move |repo| {
        let id = trimmed_non_empty(&id, "Commit id cannot be empty")?;
        let branch = trimmed_non_empty(&branch, "Target branch cannot be empty")?;

        let on = progress_bridge(app);
        on(VcsEvent::Progress {
            phase: "vcs".into(),
            detail: format!("Checking out '{branch}'…"),
        });
        repo.inner()
            .checkout_branch(&branch)
            .map_err(|e| e.to_string())?;

        on(VcsEvent::Progress {
            phase: "vcs".into(),
            detail: format!("Cherry-picking {id}…"),
        });
        repo.inner().cherry_pick(&id).map_err(|e| e.to_string())?;

        on(VcsEvent::Info {
            msg: "Cherry-pick complete".into(),
        });
        Ok(())
    })
    .await
}

#[tauri::command]
/// Reverts a commit by creating a new inverse commit.
///
/// # Parameters
/// - `window`: Calling window handle for progress events.
/// - `state`: Shared application state.
/// - `id`: Commit id/revision to revert.
///
/// # Returns
/// - `Ok(())` on success.
/// - `Err(String)` on validation or revert failure.
pub async fn vcs_revert_commit<R: Runtime>(
    window: Window<R>,
    state: State<'_, AppState>,
    id: String,
) -> Result<(), String> {
    info!("vcs_revert_commit called (id={})", id);

    let repo = current_repo_or_err(&state)?;
    let app = window.app_handle().clone();
    run_repo_task("vcs_revert_commit", repo, move |repo| {
        let id = trimmed_non_empty(&id, "Commit id cannot be empty")?;

        let on = progress_bridge(app);
        on(VcsEvent::Progress {
            phase: "vcs".into(),
            detail: format!("Reverting {id}…"),
        });
        repo.inner()
            .revert_commit(&id, true)
            .map_err(|e| e.to_string())?;
        on(VcsEvent::Info {
            msg: "Revert complete".into(),
        });
        Ok(())
    })
    .await
}

#[cfg(test)]
mod tests {
    include!("../../tests/tauri_commands/commit.rs");
}
