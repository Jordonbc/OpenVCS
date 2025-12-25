use log::warn;
use tauri::State;
use std::collections::{HashMap, HashSet};

use crate::repo_settings::{RepoConfig, RemoteConfig};
use crate::settings::AppConfig;
use crate::state::AppState;

use super::run_repo_task;

#[tauri::command]
pub fn get_global_settings(state: State<'_, AppState>) -> Result<AppConfig, String> {
    Ok(state.config())
}

#[tauri::command]
pub fn set_global_settings(state: State<'_, AppState>, cfg: AppConfig) -> Result<(), String> {
    state.set_config(cfg)
}

#[tauri::command]
pub async fn get_repo_settings(state: State<'_, AppState>) -> Result<RepoConfig, String> {
    let mut cfg = state.repo_config();
    if let Some(repo) = state.current_repo() {
        let (identity, remotes) = run_repo_task("get_repo_settings", repo, move |repo| {
            let identity = match repo.inner().get_identity() {
                Ok(Some((name, email))) => Some((name, email)),
                Ok(None) => None,
                Err(e) => {
                    warn!("get_repo_settings: get_identity failed: {e}");
                    None
                }
            };

            let remotes = match repo.inner().list_remotes() {
                Ok(list) => {
                    let mut remotes: Vec<RemoteConfig> = list
                        .into_iter()
                        .map(|(name, url)| RemoteConfig { name, url })
                        .collect();
                    remotes.sort_by(|a, b| a.name.cmp(&b.name));
                    Some(remotes)
                }
                Err(e) => {
                    warn!("get_repo_settings: list_remotes failed: {e}");
                    None
                }
            };

            Ok::<_, String>((identity, remotes))
        })
        .await?;

        if let Some((name, email)) = identity {
            cfg.user_name = Some(name);
            cfg.user_email = Some(email);
        }
        if let Some(remotes) = remotes {
            cfg.origin_url = remotes
                .iter()
                .find(|r| r.name == "origin")
                .map(|r| r.url.clone());
            cfg.remotes = Some(remotes);
        }
    }

    Ok(cfg)
}

#[tauri::command]
pub async fn set_repo_settings(state: State<'_, AppState>, cfg: RepoConfig) -> Result<(), String> {
    let cfg_clone = cfg.clone();
    state.set_repo_config(RepoConfig { ..cfg.clone() })?;

    if let Some(repo) = state.current_repo() {
        run_repo_task("set_repo_settings", repo, move |repo| {
            if let (Some(name), Some(email)) = (
                cfg_clone.user_name.as_deref(),
                cfg_clone.user_email.as_deref(),
            ) {
                repo.inner()
                    .set_identity_local(name, email)
                    .map_err(|e| e.to_string())?;
            }

            // Back-compat: if `remotes` is omitted, only update origin (legacy UI behavior).
            if let Some(remotes) = cfg_clone.remotes.as_ref() {
                let mut desired: HashMap<&str, &str> = HashMap::new();
                for remote in remotes {
                    let name = remote.name.trim();
                    let url = remote.url.trim();
                    if name.is_empty() || url.is_empty() {
                        continue;
                    }
                    desired.insert(name, url);
                }

                let existing = repo.inner().list_remotes().map_err(|e| e.to_string())?;
                let desired_names: HashSet<&str> = desired.keys().copied().collect();

                for (name, url) in desired {
                    repo.inner().ensure_remote(name, url).map_err(|e| e.to_string())?;
                }

                for (name, _url) in existing {
                    if !desired_names.contains(name.as_str()) {
                        repo.inner().remove_remote(&name).map_err(|e| e.to_string())?;
                    }
                }
            } else if let Some(url) = cfg_clone.origin_url.as_deref() {
                let url = url.trim();
                if !url.is_empty() {
                    repo.inner().ensure_remote("origin", url).map_err(|e| e.to_string())?;
                }
            }
            Ok(())
        })
        .await?;
    }
    Ok(())
}
