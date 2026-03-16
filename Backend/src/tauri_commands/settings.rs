// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later
use log::{info, warn};
use std::collections::{HashMap, HashSet};
use tauri::State;

use crate::repo_settings::{RemoteConfig, RepoConfig};
use crate::settings::AppConfig;
use crate::state::AppState;

use super::run_repo_task;

fn diff_configs(old_cfg: &AppConfig, new_cfg: &AppConfig) -> Vec<String> {
    let mut changes = Vec::new();

    if old_cfg.general != new_cfg.general {
        changes.push("general".to_string());
    }
    if old_cfg.git != new_cfg.git {
        changes.push("git".to_string());
    }
    if old_cfg.credentials != new_cfg.credentials {
        changes.push("credentials".to_string());
    }
    if old_cfg.diff != new_cfg.diff {
        changes.push("diff".to_string());
    }
    if old_cfg.lfs != new_cfg.lfs {
        changes.push("lfs".to_string());
    }
    if old_cfg.performance != new_cfg.performance {
        changes.push("performance".to_string());
    }
    if old_cfg.integrations != new_cfg.integrations {
        changes.push("integrations".to_string());
    }
    if old_cfg.plugins != new_cfg.plugins {
        changes.push("plugins".to_string());
    }
    if old_cfg.ux != new_cfg.ux {
        changes.push("ux".to_string());
    }
    if old_cfg.advanced != new_cfg.advanced {
        changes.push("advanced".to_string());
    }
    if old_cfg.experimental != new_cfg.experimental {
        changes.push("experimental".to_string());
    }
    if old_cfg.logging != new_cfg.logging {
        changes.push("logging".to_string());
    }

    changes
}

#[tauri::command]
/// Returns global application settings.
///
/// # Parameters
/// - `state`: Shared application state.
///
/// # Returns
/// - `Ok(AppConfig)` with current settings.
pub fn get_global_settings(state: State<'_, AppState>) -> Result<AppConfig, String> {
    Ok(state.config())
}

#[tauri::command]
/// Replaces and persists global application settings.
///
/// # Parameters
/// - `state`: Shared application state.
/// - `cfg`: New global settings payload.
///
/// # Returns
/// - `Ok(())` when settings are applied.
/// - `Err(String)` when validation/persistence fails.
pub fn set_global_settings(state: State<'_, AppState>, cfg: AppConfig) -> Result<(), String> {
    let old_cfg = state.config();
    state.set_config(cfg.clone())?;
    state
        .plugin_runtime()
        .sync_plugin_runtime_with_config(&cfg)
        .map_err(|err| format!("settings saved but plugin runtime sync failed: {err}"))?;

    let changes = diff_configs(&old_cfg, &cfg);
    if changes.is_empty() {
        info!("settings: global config saved (no changes detected)");
    } else {
        info!(
            "settings: global config updated - changed: {}",
            changes.join(", ")
        );
    }
    Ok(())
}

#[tauri::command]
/// Returns repository-local settings merged with current repo values when available.
///
/// # Parameters
/// - `state`: Shared application state.
///
/// # Returns
/// - `Ok(RepoConfig)` current effective repository settings.
/// - `Err(String)` when repo queries fail.
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
/// Updates repository-local settings and applies identity/remote changes.
///
/// # Parameters
/// - `state`: Shared application state.
/// - `cfg`: Repository settings payload.
///
/// # Returns
/// - `Ok(())` when updates are applied.
/// - `Err(String)` when backend operations fail.
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
                    repo.inner()
                        .ensure_remote(name, url)
                        .map_err(|e| e.to_string())?;
                }

                for (name, _url) in existing {
                    if !desired_names.contains(name.as_str()) {
                        repo.inner()
                            .remove_remote(&name)
                            .map_err(|e| e.to_string())?;
                    }
                }
            } else if let Some(url) = cfg_clone.origin_url.as_deref() {
                let url = url.trim();
                if !url.is_empty() {
                    repo.inner()
                        .ensure_remote("origin", url)
                        .map_err(|e| e.to_string())?;
                }
            }
            Ok(())
        })
        .await?;
    }
    info!("settings: repository config updated");
    Ok(())
}
