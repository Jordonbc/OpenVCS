// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later
use std::sync::Arc;

use openvcs_core::models::VcsEvent;
use openvcs_core::OnEvent;
use tauri::{async_runtime, AppHandle, Emitter, Manager, Runtime, State};

use crate::output_log::{OutputLevel, OutputLogEntry};
use crate::plugin_vcs_backends;
use crate::repo::Repo;
use crate::state::AppState;

#[derive(serde::Serialize, Clone)]
/// Generic progress event payload sent to the UI.
pub struct ProgressPayload {
    /// Human-readable progress message.
    pub message: String,
}

/// Creates a callback that forwards VCS events to UI progress/log channels.
///
/// # Parameters
/// - `app`: Application handle used to emit events and access state.
///
/// # Returns
/// - An [`OnEvent`] callback compatible with backend VCS operations.
pub(crate) fn progress_bridge<R: Runtime>(app: AppHandle<R>) -> OnEvent {
    Arc::new(move |evt| {
        let (level, msg) = match evt {
            VcsEvent::Progress { detail, .. } => (OutputLevel::Info, detail),
            VcsEvent::RemoteMessage { msg } => (OutputLevel::Info, msg),
            VcsEvent::Auth { method, detail } => {
                (OutputLevel::Info, format!("auth[{method}]: {detail}"))
            }
            VcsEvent::PushStatus { refname, status } => (
                OutputLevel::Info,
                status
                    .map(|s| format!("{refname} → {s}"))
                    .unwrap_or_else(|| format!("{refname} ok")),
            ),
            VcsEvent::Info { msg } => (OutputLevel::Info, msg),
            VcsEvent::Warning { msg } => (OutputLevel::Warn, msg),
            VcsEvent::Error { msg } => (OutputLevel::Error, msg),
        };

        let ts_ms = time::OffsetDateTime::now_utc().unix_timestamp_nanos() / 1_000_000;
        let entry = OutputLogEntry::new(ts_ms as i64, level, "git", msg.clone());
        let state = app.state::<AppState>();
        state.push_output_log(entry.clone());

        let _ = app.emit("vcs:log", entry);
        let _ = app.emit("git-progress", ProgressPayload { message: msg });
    })
}

/// Returns the current repository if its backend is still available.
///
/// # Parameters
/// - `state`: Shared application state.
///
/// # Returns
/// - `Ok(Arc<Repo>)` for the active repository.
/// - `Err(String)` when no repo is selected or backend is unavailable.
pub(crate) fn current_repo_or_err(state: &State<'_, AppState>) -> Result<Arc<Repo>, String> {
    let repo = state
        .current_repo()
        .ok_or_else(|| "No repository selected".to_string())?;

    let backend_id = repo.id();
    let is_available = plugin_vcs_backends::has_plugin_vcs_backend(&backend_id);

    if !is_available {
        // If the backend disappears (e.g. plugin disabled), prevent further operations on a stale handle.
        state.clear_current_repo();
        return Err(format!(
            "Backend `{}` is no longer available (plugin disabled?). Reopen the repository.",
            backend_id.as_ref()
        ));
    }

    Ok(Arc::clone(&repo))
}

/// Runs a repository task on the blocking thread pool and maps join errors.
///
/// # Parameters
/// - `label`: Human-readable task name for error context.
/// - `repo`: Repository handle captured by the task.
/// - `task`: Closure executed in a blocking worker thread.
///
/// # Returns
/// - `Ok(T)` with the closure result.
/// - `Err(String)` if join fails or the closure returns an error.
pub(crate) async fn run_repo_task<T, F>(
    label: &'static str,
    repo: Arc<Repo>,
    task: F,
) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce(Arc<Repo>) -> Result<T, String> + Send + 'static,
{
    async_runtime::spawn_blocking(move || task(repo))
        .await
        .map_err(|e| format!("{label} task failed: {e}"))?
}
