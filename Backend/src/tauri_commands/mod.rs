use std::sync::Arc;

use openvcs_core::models::VcsEvent;
use openvcs_core::{OnEvent, Repo};
use serde::Serialize;
use tauri::{async_runtime, Emitter, Manager, Runtime, State};

use crate::state::AppState;

mod backend;
mod commits;
mod general;
mod git;
mod lfs;
mod repo;
mod settings_cmd;
mod stash;
mod sync;
mod updater;
mod validation;

pub use backend::{list_backends_cmd, set_backend_cmd};
pub use commits::{commit_changes, commit_patch, commit_patch_and_files, commit_selected};
pub use general::{about_info, browse_directory, show_licenses};
pub use git::{
    get_repo_summary, git_checkout_branch, git_create_branch, git_current_branch,
    git_delete_branch, git_diff_commit, git_diff_file, git_discard_patch, git_discard_paths,
    git_head_status, git_list_branches, git_log, git_merge_branch, git_rename_branch, git_status,
};
pub use lfs::{git_lfs_fetch_all, git_lfs_prune, git_lfs_pull, git_lfs_track_paths};
pub use repo::{add_repo, clone_repo, current_repo_path, list_recent_repos, open_repo};
pub use settings_cmd::{
    get_global_settings, get_repo_settings, set_global_settings, set_repo_settings,
};
pub use stash::{
    git_stash_apply, git_stash_drop, git_stash_list, git_stash_pop, git_stash_push, git_stash_show,
};
pub use sync::{
    git_fetch, git_fetch_all, git_pull, git_push, git_undo_since_push, git_undo_to_commit,
};
pub use updater::updater_install_now;
pub use validation::{validate_add_path, validate_clone_input, validate_git_url};

pub(super) fn current_repo_or_err(state: &State<'_, AppState>) -> Result<Arc<Repo>, String> {
    state
        .current_repo()
        .ok_or_else(|| "No repository selected".to_string())
        .map(Arc::clone)
}

pub(super) async fn run_repo_task<T, F>(
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

pub(super) fn progress_bridge<R: Runtime>(app: tauri::AppHandle<R>) -> OnEvent {
    Arc::new(move |evt| {
        let msg = match evt {
            VcsEvent::Progress { detail, .. } => detail,
            VcsEvent::RemoteMessage(s) => s,
            VcsEvent::Auth { method, detail } => format!("auth[{method}]: {detail}"),
            VcsEvent::PushStatus { refname, status } => status
                .map(|s| format!("{refname} → {s}"))
                .unwrap_or_else(|| format!("{refname} ok")),
            VcsEvent::Info(s) => s.to_string(),
            VcsEvent::Warning(s) | VcsEvent::Error(s) => s,
        };
        let _ = app.emit("git-progress", ProgressPayload { message: msg });
    })
}

#[derive(Serialize, Clone)]
pub(super) struct ProgressPayload {
    pub message: String,
}
