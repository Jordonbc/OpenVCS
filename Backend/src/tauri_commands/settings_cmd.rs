use log::warn;
use tauri::State;

use crate::repo_settings::RepoConfig;
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
        let (identity, origin) = run_repo_task("get_repo_settings", repo, move |repo| {
            let identity = match repo.inner().get_identity() {
                Ok(Some((name, email))) => Some((name, email)),
                Ok(None) => None,
                Err(e) => {
                    warn!("get_repo_settings: get_identity failed: {e}");
                    None
                }
            };

            let origin = match repo.inner().list_remotes() {
                Ok(list) => list
                    .into_iter()
                    .find(|(n, _)| n == "origin")
                    .map(|(_, url)| url),
                Err(e) => {
                    warn!("get_repo_settings: list_remotes failed: {e}");
                    None
                }
            };

            Ok::<_, String>((identity, origin))
        })
        .await?;

        if let Some((name, email)) = identity {
            cfg.user_name = Some(name);
            cfg.user_email = Some(email);
        }
        if let Some(url) = origin {
            cfg.origin_url = Some(url);
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
            if let Some(url) = cfg_clone.origin_url.as_deref() {
                if !url.trim().is_empty() {
                    repo.inner()
                        .ensure_remote("origin", url)
                        .map_err(|e| e.to_string())?;
                }
            }
            Ok(())
        })
        .await?;
    }
    Ok(())
}
