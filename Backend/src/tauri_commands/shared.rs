use std::sync::Arc;

use openvcs_core::models::VcsEvent;
use openvcs_core::OnEvent;
use tauri::{async_runtime, AppHandle, Emitter, Manager, Runtime, State};

use crate::output_log::{OutputLevel, OutputLogEntry};
use crate::plugin_vcs_backends;
use crate::repo::Repo;
use crate::settings::Lfs;
use crate::state::AppState;

#[derive(serde::Serialize, Clone)]
pub struct ProgressPayload {
    pub message: String,
}

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
