use std::path::PathBuf;

use log::info;
use tauri::State;

use crate::settings::Lfs;
use crate::state::AppState;

use super::{current_repo_or_err, run_repo_task};

#[tauri::command]
pub async fn git_lfs_fetch_all(state: State<'_, AppState>) -> Result<(), String> {
    info!("git_lfs_fetch_all called");
    let cfg = lfs_config(&state);
    if !cfg.enabled {
        return Err("Git LFS integration is disabled".into());
    }

    let repo = current_repo_or_err(&state)?;
    run_repo_task("git_lfs_fetch_all", repo, move |repo| {
        let _guard = LfsEnvGuard::apply(&cfg);
        repo.inner().lfs_fetch().map_err(|e| e.to_string())
    })
    .await
}

#[tauri::command]
pub async fn git_lfs_pull(state: State<'_, AppState>) -> Result<(), String> {
    info!("git_lfs_pull called");
    let cfg = lfs_config(&state);
    if !cfg.enabled {
        return Err("Git LFS integration is disabled".into());
    }

    let repo = current_repo_or_err(&state)?;
    run_repo_task("git_lfs_pull", repo, move |repo| {
        let _guard = LfsEnvGuard::apply(&cfg);
        repo.inner().lfs_pull().map_err(|e| e.to_string())
    })
    .await
}

#[tauri::command]
pub async fn git_lfs_prune(state: State<'_, AppState>) -> Result<(), String> {
    info!("git_lfs_prune called");
    let cfg = lfs_config(&state);
    if !cfg.enabled {
        return Err("Git LFS integration is disabled".into());
    }

    let repo = current_repo_or_err(&state)?;
    run_repo_task("git_lfs_prune", repo, move |repo| {
        let _guard = LfsEnvGuard::apply(&cfg);
        repo.inner().lfs_prune().map_err(|e| e.to_string())
    })
    .await
}

#[tauri::command]
pub async fn git_lfs_track_paths(
    state: State<'_, AppState>,
    paths: Vec<String>,
) -> Result<(), String> {
    info!("git_lfs_track_paths called (count={})", paths.len());
    if paths.is_empty() {
        return Ok(());
    }

    let cfg = lfs_config(&state);
    if !cfg.enabled {
        return Err("Git LFS integration is disabled".into());
    }

    let repo = current_repo_or_err(&state)?;
    run_repo_task("git_lfs_track_paths", repo, move |repo| {
        let _guard = LfsEnvGuard::apply(&cfg);
        let list: Vec<PathBuf> = paths.into_iter().map(PathBuf::from).collect();
        repo.inner().lfs_track(&list).map_err(|e| e.to_string())
    })
    .await
}

fn lfs_config(state: &State<'_, AppState>) -> Lfs {
    state.with_config(|cfg| cfg.lfs.clone())
}

struct LfsEnvGuard {
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

    fn apply(cfg: &Lfs) -> Self {
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
