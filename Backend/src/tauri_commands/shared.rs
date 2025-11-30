use std::path::PathBuf;
use std::sync::Arc;

use openvcs_core::models::VcsEvent;
use openvcs_core::{OnEvent, Repo};
use tauri::{async_runtime, AppHandle, Emitter, Runtime, State};

use crate::settings::Lfs;
use crate::state::AppState;

#[derive(serde::Serialize, Clone)]
pub struct ProgressPayload {
    pub message: String,
}

pub(crate) fn progress_bridge<R: Runtime>(app: AppHandle<R>) -> OnEvent {
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

pub(crate) fn current_repo_or_err(state: &State<'_, AppState>) -> Result<Arc<Repo>, String> {
    state
        .current_repo()
        .ok_or_else(|| "No repository selected".to_string())
        .map(|repo| Arc::clone(&repo))
}

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

pub(crate) fn lfs_config(state: &State<'_, AppState>) -> Lfs {
    state.with_config(|cfg| cfg.lfs.clone())
}

pub(crate) struct LfsEnvGuard {
    originals: Vec<(&'static str, Option<String>)>,
}

impl LfsEnvGuard {
    fn capture(key: &'static str) -> Option<String> {
        std::env::var(key).ok()
    }

    fn set(
        key: &'static str,
        value: Option<String>,
        originals: &mut Vec<(&'static str, Option<String>)>,
    ) {
        originals.push((key, Self::capture(key)));
        match value {
            Some(v) => std::env::set_var(key, v),
            None => std::env::remove_var(key),
        }
    }

    pub(crate) fn apply(cfg: &Lfs) -> Self {
        let mut originals = Vec::new();

        Self::set(
            "GIT_LFS_CONCURRENCY",
            Some(cfg.concurrency.clamp(1, 16).to_string()),
            &mut originals,
        );

        let lock_env = if cfg.require_lock_before_edit {
            Some("1".to_string())
        } else {
            None
        };
        Self::set(
            "GIT_LFS_SET_LOCKED_FILES_READONLY",
            lock_env,
            &mut originals,
        );

        let skip_smudge = if cfg.background_fetch_on_checkout {
            None
        } else {
            Some("1".to_string())
        };
        Self::set("GIT_LFS_SKIP_SMUDGE", skip_smudge, &mut originals);

        Self { originals }
    }
}

impl Drop for LfsEnvGuard {
    fn drop(&mut self) {
        for (key, val) in self.originals.drain(..).rev() {
            if let Some(v) = val {
                std::env::set_var(key, v);
            } else {
                std::env::remove_var(key);
            }
        }
    }
}
