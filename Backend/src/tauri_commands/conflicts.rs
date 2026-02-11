use std::path::PathBuf;
use std::process::Command;

use log::{debug, warn};
use openvcs_core::models::{ConflictDetails, ConflictSide};
use shlex::split;
use tauri::State;

use crate::settings::ExternalTool;
use crate::state::AppState;

use super::{current_repo_or_err, run_repo_task};

#[tauri::command]
/// Returns conflict details for a repository file.
///
/// # Parameters
/// - `state`: Shared application state.
/// - `path`: Repository-relative path in conflict.
///
/// # Returns
/// - `Ok(ConflictDetails)` with conflict metadata/content.
/// - `Err(String)` when lookup fails.
pub async fn git_conflict_details(
    state: State<'_, AppState>,
    path: String,
) -> Result<ConflictDetails, String> {
    let repo = current_repo_or_err(&state)?;
    run_repo_task("git_conflict_details", repo, move |repo| {
        repo.inner()
            .conflict_details(&PathBuf::from(&path))
            .map_err(|e| e.to_string())
    })
    .await
}

#[tauri::command]
/// Resolves a conflict file by checking out `ours` or `theirs`.
///
/// # Parameters
/// - `state`: Shared application state.
/// - `path`: Repository-relative conflict file path.
/// - `side`: Conflict side selector (`ours` or `theirs`).
///
/// # Returns
/// - `Ok(())` on success.
/// - `Err(String)` on validation or checkout failure.
pub async fn git_resolve_conflict_side(
    state: State<'_, AppState>,
    path: String,
    side: String,
) -> Result<(), String> {
    let repo = current_repo_or_err(&state)?;
    run_repo_task("git_resolve_conflict_side", repo, move |repo| {
        let which = match side.to_lowercase().as_str() {
            "ours" => ConflictSide::Ours,
            "theirs" => ConflictSide::Theirs,
            other => {
                return Err(format!("invalid conflict side '{other}'"));
            }
        };
        repo.inner()
            .checkout_conflict_side(&PathBuf::from(&path), which)
            .map_err(|e| e.to_string())
    })
    .await
}

#[tauri::command]
/// Writes merge-result content to a conflicted file.
///
/// # Parameters
/// - `state`: Shared application state.
/// - `path`: Repository-relative file path.
/// - `content`: Resolved file content to write.
///
/// # Returns
/// - `Ok(())` on success.
/// - `Err(String)` when write/save fails.
pub async fn git_save_merge_result(
    state: State<'_, AppState>,
    path: String,
    content: String,
) -> Result<(), String> {
    let repo = current_repo_or_err(&state)?;
    run_repo_task("git_save_merge_result", repo, move |repo| {
        repo.inner()
            .write_merge_result(&PathBuf::from(&path), content.as_bytes())
            .map_err(|e| e.to_string())
    })
    .await
}

fn tool_args(tool: &ExternalTool) -> (String, Vec<String>) {
    let path = tool.path.clone();
    let args = split(tool.args.trim())
        .unwrap_or_default()
        .into_iter()
        .collect::<Vec<_>>();
    (path, args)
}

#[tauri::command]
/// Launches the configured external merge tool for a file.
///
/// # Parameters
/// - `state`: Shared application state.
/// - `path`: Repository-relative path to open in the tool.
///
/// # Returns
/// - `Ok(())` when the tool process is started.
/// - `Err(String)` when tool config is missing or spawn fails.
pub async fn git_launch_merge_tool(state: State<'_, AppState>, path: String) -> Result<(), String> {
    let cfg = state.config();
    let tool = cfg.diff.external_merge.clone();
    if !tool.enabled || tool.path.trim().is_empty() {
        return Err("no external merge tool configured".into());
    }

    let repo = current_repo_or_err(&state)?;
    let (tool_path, args_template) = tool_args(&tool);
    let has_args = !tool.args.trim().is_empty();
    let includes_placeholder = args_template.iter().any(|arg| arg.contains("{path}"));

    run_repo_task("git_launch_merge_tool", repo, move |repo| {
        let repo_root = repo.inner().workdir().to_path_buf();
        let rel = PathBuf::from(&path);
        let abs = if rel.is_absolute() {
            rel.clone()
        } else {
            repo_root.join(&rel)
        };

        let mut cmd = Command::new(&tool_path);
        cmd.current_dir(&repo_root);

        let replace_tokens = |raw: &str| {
            raw.replace("{path}", abs.to_string_lossy().as_ref())
                .replace("{repo}", repo_root.to_string_lossy().as_ref())
        };

        let mut expanded: Vec<String> = Vec::new();
        if !has_args {
            expanded.push(abs.to_string_lossy().to_string());
        } else {
            for arg in args_template {
                expanded.push(replace_tokens(&arg));
            }
            if !includes_placeholder {
                expanded.push(abs.to_string_lossy().to_string());
            }
        }

        for arg in &expanded {
            cmd.arg(arg);
        }

        debug!(
            "git_launch_merge_tool: spawning {} with args {:?}",
            tool_path, expanded
        );

        cmd.spawn().map(|_| ()).map_err(|e| {
            warn!("git_launch_merge_tool: failed to spawn merge tool: {e}");
            e.to_string()
        })
    })
    .await
}
