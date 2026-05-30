// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};

use tauri::{AppHandle, Emitter, Manager, Runtime, State, async_runtime};

use crate::core::OnEvent;
use crate::core::models::VcsEvent;
use crate::output_log::{OutputLevel, OutputLogEntry};
use crate::plugin_vcs_backends;
use crate::repo::Repo;
use crate::state::AppState;

static ACTIVE_REPO_TASKS: AtomicUsize = AtomicUsize::new(0);

struct RepoTaskBusyGuard;

impl Drop for RepoTaskBusyGuard {
    fn drop(&mut self) {
        ACTIVE_REPO_TASKS.fetch_sub(1, Ordering::SeqCst);
    }
}

/// Returns whether any repository task is currently active.
pub(crate) fn repo_task_active() -> bool {
    ACTIVE_REPO_TASKS.load(Ordering::SeqCst) > 0
}

/// Marks the current thread as executing a repository task until dropped.
fn begin_repo_task() -> RepoTaskBusyGuard {
    ACTIVE_REPO_TASKS.fetch_add(1, Ordering::SeqCst);
    RepoTaskBusyGuard
}

/// Converts a backend task label and error into a consistent user-facing message.
fn format_task_failure(label: &'static str, error: &str) -> String {
    format!("{label} task failed: {error}")
}

/// Converts a VCS event into the output-log level and message sent to the UI.
fn progress_message_for_event(evt: VcsEvent) -> (OutputLevel, String) {
    match evt {
        VcsEvent::Progress { detail, .. } => (OutputLevel::Info, detail),
        VcsEvent::RemoteMessage { msg } => (OutputLevel::Info, msg),
        VcsEvent::Auth { method, detail } => {
            (OutputLevel::Info, format!("auth[{method}]: {detail}"))
        }
        VcsEvent::PushStatus { refname, status } => (
            OutputLevel::Info,
            status
                .map(|value| format!("{refname} → {value}"))
                .unwrap_or_else(|| format!("{refname} ok")),
        ),
        VcsEvent::Info { msg } => (OutputLevel::Info, msg),
        VcsEvent::Warning { msg } => (OutputLevel::Warn, msg),
        VcsEvent::Error { msg } => (OutputLevel::Error, msg),
    }
}

/// Returns the message shown when the active backend disappears during an operation.
fn backend_unavailable_message(backend_id: &str) -> String {
    format!(
        "Backend `{backend_id}` is no longer available (plugin disabled?). Reopen the repository."
    )
}

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
        let (level, msg) = progress_message_for_event(evt);

        let ts_ms = time::OffsetDateTime::now_utc().unix_timestamp_nanos() / 1_000_000;
        let entry = OutputLogEntry::new(ts_ms as i64, level, "vcs", msg.clone());
        let state = app.state::<AppState>();
        state.push_output_log(entry.clone());

        let _ = app.emit("vcs:log", entry);
        let _ = app.emit("vcs-progress", ProgressPayload { message: msg });
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
    let repo = match state.current_repo() {
        Some(repo) => repo,
        None => {
            log::warn!(
                "repo command aborted: no repository selected; possible causes include no VCS backend available, reopen/startup failure, or the active repo being cleared"
            );
            return Err("No repository selected".to_string());
        }
    };

    let backend_id = repo.id();
    let is_available = plugin_vcs_backends::has_plugin_vcs_backend(&backend_id);

    if !is_available {
        // If the backend disappears (e.g. plugin disabled), prevent further operations on a stale handle.
        state.clear_current_repo();
        log::error!(
            "repo command aborted: backend '{}' is no longer available; plugin may be disabled or missing",
            backend_id.as_ref()
        );
        return Err(backend_unavailable_message(backend_id.as_ref()));
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
    let _busy = begin_repo_task();
    async_runtime::spawn_blocking(move || task(repo))
        .await
        .map_err(|error| format_task_failure(label, &error.to_string()))?
}

#[cfg(test)]
mod tests {
    include!("../../tests/tauri_commands/shared.rs");
}
