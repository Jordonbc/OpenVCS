// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later
use std::path::PathBuf;
use std::process::{Command, Stdio};

use crate::core::models::{ConflictDetails, ConflictSide};
use log::{debug, error, info, trace, warn};
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
pub async fn vcs_conflict_details(
    state: State<'_, AppState>,
    path: String,
) -> Result<ConflictDetails, String> {
    let start = std::time::Instant::now();
    info!("vcs_conflict_details: path='{}'", path);

    let repo = current_repo_or_err(&state)?;
    let path_clone = path.clone();
    let result = run_repo_task("vcs_conflict_details", repo, move |repo| {
        repo.inner()
            .conflict_details(&PathBuf::from(&path))
            .map_err(|e| {
                error!("vcs_conflict_details: failed for '{}': {}", path, e);
                e.to_string()
            })
    })
    .await;

    match &result {
        Ok(details) => {
            debug!(
                "vcs_conflict_details: found conflict details for '{}' ({:?})",
                path_clone,
                start.elapsed()
            );
            trace!("vcs_conflict_details: binary={}", details.binary);
        }
        Err(e) => {
            error!("vcs_conflict_details: failed: {}", e);
        }
    }

    result
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
pub async fn vcs_resolve_conflict_side(
    state: State<'_, AppState>,
    path: String,
    side: String,
) -> Result<(), String> {
    let start = std::time::Instant::now();
    info!(
        "vcs_resolve_conflict_side: path='{}', side='{}'",
        path, side
    );

    let repo = current_repo_or_err(&state)?;
    let path_clone = path.clone();
    let side_clone = side.clone();
    let result = run_repo_task("vcs_resolve_conflict_side", repo, move |repo| {
        let which = match side.to_lowercase().as_str() {
            "ours" => ConflictSide::Ours,
            "theirs" => ConflictSide::Theirs,
            other => {
                warn!("vcs_resolve_conflict_side: invalid side '{}'", other);
                return Err(format!("invalid conflict side '{other}'"));
            }
        };
        repo.inner()
            .checkout_conflict_side(&PathBuf::from(&path), which)
            .map_err(|e| {
                error!("vcs_resolve_conflict_side: failed for '{}': {}", path, e);
                e.to_string()
            })
    })
    .await;

    match &result {
        Ok(()) => {
            debug!(
                "vcs_resolve_conflict_side: resolved '{}' with '{}' ({:?})",
                path_clone,
                side_clone,
                start.elapsed()
            );
        }
        Err(e) => {
            error!("vcs_resolve_conflict_side: failed: {}", e);
        }
    }

    result
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
pub async fn vcs_save_merge_result(
    state: State<'_, AppState>,
    path: String,
    content: String,
) -> Result<(), String> {
    let start = std::time::Instant::now();
    info!(
        "vcs_save_merge_result: path='{}', content_len={}",
        path,
        content.len()
    );

    let repo = current_repo_or_err(&state)?;
    let path_clone = path.clone();
    let result = run_repo_task("vcs_save_merge_result", repo, move |repo| {
        repo.inner()
            .write_merge_result(&PathBuf::from(&path), content.as_bytes())
            .map_err(|e| {
                error!("vcs_save_merge_result: failed for '{}': {}", path, e);
                e.to_string()
            })
    })
    .await;

    match &result {
        Ok(()) => {
            debug!(
                "vcs_save_merge_result: saved '{}' ({:?})",
                path_clone,
                start.elapsed()
            );
        }
        Err(e) => {
            error!("vcs_save_merge_result: failed: {}", e);
        }
    }

    result
}

/// Splits external tool config into executable path and args.
///
/// # Parameters
/// - `tool`: External tool configuration.
///
/// # Returns
/// - Tuple of executable path and parsed args.
fn tool_args(tool: &ExternalTool) -> (String, Vec<String>) {
    let path = tool.path.clone();
    let args = split(tool.args.trim())
        .unwrap_or_default()
        .into_iter()
        .collect::<Vec<_>>();
    trace!("tool_args: path='{}', args={:?}", path, args);
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
pub async fn vcs_launch_merge_tool(state: State<'_, AppState>, path: String) -> Result<(), String> {
    let start = std::time::Instant::now();
    info!("vcs_launch_merge_tool: path='{}'", path);

    let cfg = state.config();
    let tool = cfg.diff.external_merge.clone();

    if !tool.enabled {
        warn!("vcs_launch_merge_tool: external merge tool is disabled");
        return Err("no external merge tool configured".into());
    }

    if tool.path.trim().is_empty() {
        warn!("vcs_launch_merge_tool: no tool path configured");
        return Err("no external merge tool configured".into());
    }

    debug!(
        "vcs_launch_merge_tool: tool='{}', args='{}'",
        tool.path, tool.args
    );

    let repo = current_repo_or_err(&state)?;
    let (tool_path, args_template) = tool_args(&tool);
    let has_args = !tool.args.trim().is_empty();
    let includes_placeholder = args_template.iter().any(|arg| arg.contains("{path}"));
    let path_for_log = path.clone();

    let result = run_repo_task("vcs_launch_merge_tool", repo, move |repo| {
        let repo_root = repo.inner().workdir().to_path_buf();
        let rel = PathBuf::from(&path);
        let abs = if rel.is_absolute() {
            rel.clone()
        } else {
            repo_root.join(&rel)
        };

        trace!(
            "vcs_launch_merge_tool: repo_root='{}', abs_path='{}'",
            repo_root.display(),
            abs.display()
        );

        let mut cmd = Command::new(&tool_path);
        cmd.current_dir(&repo_root);
        cmd.stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        #[cfg(windows)]
        {
            crate::process_utils::hide_window(&mut cmd);
        }

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
            "vcs_launch_merge_tool: spawning '{}' with args {:?}",
            tool_path, expanded
        );

        cmd.spawn().map(|_| ()).map_err(|e| {
            error!(
                "vcs_launch_merge_tool: failed to spawn '{}': {}",
                tool_path, e
            );
            e.to_string()
        })
    })
    .await;

    match &result {
        Ok(()) => {
            info!(
                "vcs_launch_merge_tool: launched tool for '{}' ({:?})",
                path_for_log,
                start.elapsed()
            );
        }
        Err(e) => {
            error!("vcs_launch_merge_tool: failed: {}", e);
        }
    }

    result
}
