// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later
//! OpenVCS backend application crate.
//!
//! This crate wires together Tauri command handlers, runtime state,
//! plugin discovery, and startup behavior.

use log::{error, warn};
use std::sync::Arc;
use tauri::path::BaseDirectory;
use tauri::WindowEvent;
use tauri::{Emitter, Manager, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_updater::UpdaterExt;

use crate::core::BackendId;

mod app_identity;
mod config_watcher;
mod core;
mod logging;
mod monitoring;
mod output_log;
mod plugin_bundles;
mod plugin_manifest;
mod plugin_paths;
mod plugin_runtime;
mod plugin_sources;
mod plugin_vcs_backends;
mod plugins;
mod repo;
mod repo_settings;
mod settings;
mod state;
mod tauri_commands;
mod themes;
mod utilities;
mod validate;
mod workarounds;

/// Loads `Client/.env` for local development without overwriting existing env vars.
///
/// Missing .env file is silently ignored. Malformed or unreadable .env files
/// are reported with context for debugging before structured logging is ready.
fn load_local_dotenv() {
    let dotenv_path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../.env");

    match dotenvy::from_path(&dotenv_path) {
        Ok(_) => {}
        Err(dotenvy::Error::Io(error)) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(err) => {
            eprintln!(
                "warning: failed to load local .env from {}: {}",
                dotenv_path.display(),
                err
            );
        }
    }
}

/// Selects preferred backend from settings or first available plugin backend.
///
/// # Parameters
/// - `_cfg`: Current application config.
///
/// # Returns
/// - `Some(BackendId)` when a backend is available.
/// - `None` otherwise.
fn preferred_vcs_backend_id(_cfg: &settings::AppConfig) -> Option<BackendId> {
    let desired = _cfg.general.default_backend.trim().to_string();
    if !desired.is_empty() {
        let desired = BackendId::from(desired);
        if crate::plugin_vcs_backends::has_plugin_vcs_backend(&desired) {
            return Some(desired);
        }
    }

    crate::plugin_vcs_backends::list_plugin_vcs_backends()
        .ok()
        .and_then(|mut backends| {
            backends.sort_by(|a, b| a.backend_id.as_ref().cmp(b.backend_id.as_ref()));
            backends.into_iter().next().map(|b| b.backend_id)
        })
}

/// Attempt to reopen the most recent repository at startup if the
/// global setting `general.reopen_last_repos` is enabled.
///
/// # Parameters
/// - `app_handle`: Application handle used to access state and emit events.
///
/// # Returns
/// - `()`.
fn try_reopen_last_repo<R: tauri::Runtime>(app_handle: &tauri::AppHandle<R>) {
    use crate::repo::Repo;
    use std::path::Path;

    let state = app_handle.state::<state::AppState>();
    let app_config = state.config();
    if !app_config.general.reopen_last_repos {
        return;
    }

    let recents = state.recents();
    if let Some(path) = recents.into_iter().find(|p| p.exists()) {
        let Some(backend) = preferred_vcs_backend_id(&app_config) else {
            log::warn!("startup reopen: no VCS backend available");
            return;
        };

        let path_str = path.to_string_lossy().to_string();
        if crate::plugin_vcs_backends::has_plugin_vcs_backend(&backend) {
            let runtime_manager = state.plugin_runtime();
            match crate::plugin_vcs_backends::open_repo_via_plugin_vcs_backend(
                runtime_manager.as_ref(),
                &app_config,
                backend,
                Path::new(&path),
            ) {
                Ok(backend_handle) => {
                    let existing_repo = Arc::new(Repo::new(backend_handle));
                    state.set_current_repo(existing_repo);
                    if let Err(error) = app_handle.emit("repo:selected", &path_str) {
                        log::warn!("startup reopen: failed to emit repo:selected: {}", error);
                    }
                }
                Err(error) => {
                    crate::monitoring::capture_startup_error(
                        "reopen_last_repo",
                        &error.to_string(),
                    );
                    log::warn!("startup reopen: failed to open repo: {}", error)
                }
            }
        } else {
            log::warn!("startup reopen: backend not available");
        }
    }
}

/// Starts the OpenVCS backend runtime and Tauri application.
///
/// This configures logging, plugin synchronization, startup restore
/// behavior, update checks, and all IPC handlers exposed to the frontend.
///
/// # Returns
/// - `()`. This function runs the Tauri event loop until application exit.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    load_local_dotenv();
    let initial_config = settings::AppConfig::load_or_default();
    workarounds::apply_linux_nvidia_workaround();
    workarounds::apply_gpu_acceleration_preference(&initial_config.performance);
    #[cfg(target_os = "windows")]
    let main_window_browser_args =
        workarounds::main_window_browser_args(&initial_config.performance);

    // Initialize logging after startup-only process environment adjustments.
    logging::init();
    log::info!(
        "performance: GPU acceleration {} at startup",
        if initial_config.performance.gpu_accel {
            "enabled"
        } else {
            "disabled"
        }
    );
    let app_state = state::AppState::new_with_config(initial_config);
    monitoring::sync_backend_monitoring(&app_state.config());

    println!("Running OpenVCS...");

    tauri::Builder::default()
        .manage(app_state)
        .setup(|app| {
            crate::plugin_runtime::host_api::set_status_event_emitter({
                let app_handle = app.handle().clone();
                move |message| {
                    if let Err(error) = app_handle.emit("status:set", message.to_string()) {
                        log::warn!("status:set emit failed: {}", error);
                    }
                }
            });

            // If the application bundle includes a `built-in-plugins` resource
            // directory, resolve its location via Tauri and register the
            // containing resource directory so runtime discovery can include
            // embedded built-in plugins.
            if let Ok(resolved) = app
                .path()
                .resolve("built-in-plugins", BaseDirectory::Resource)
            {
                if let Some(parent) = resolved.parent() {
                    crate::plugin_paths::set_resource_dir(parent.to_path_buf());
                    log::info!(
                        "plugins: resolved resource dir via Tauri: {}",
                        parent.display()
                    );
                } else {
                    crate::plugin_paths::set_resource_dir(resolved.clone());
                    log::info!(
                        "plugins: resolved resource dir via Tauri: {}",
                        resolved.display()
                    );
                }
            }
            if let Ok(node_runtime_dir) = app.path().resolve("node-runtime", BaseDirectory::Resource)
            {
                crate::plugin_paths::set_node_runtime_resource_dir(node_runtime_dir.clone());
                if let Some(parent) = node_runtime_dir.parent() {
                    crate::plugin_paths::set_resource_dir(parent.to_path_buf());
                }
            }

            if app.get_webview_window("main").is_none() {
                #[cfg(target_os = "windows")]
                let builder = {
                    let mut builder = WebviewWindowBuilder::new(
                        app,
                        "main",
                        WebviewUrl::App("index.html".into()),
                    )
                    .title("OpenVCS")
                    .inner_size(1100.0, 600.0)
                    .min_inner_size(1100.0, 600.0)
                    .resizable(true);
                    if let Some(args) = main_window_browser_args.clone() {
                        builder = builder.additional_browser_args(args);
                    }
                    builder
                };
                #[cfg(not(target_os = "windows"))]
                let builder = WebviewWindowBuilder::new(
                    app,
                    "main",
                    WebviewUrl::App("index.html".into()),
                )
                .title("OpenVCS")
                .inner_size(1100.0, 600.0)
                .min_inner_size(1100.0, 600.0)
                .resizable(true);
                if let Err(err) = builder.build() {
                    log::error!("failed to create main window: {}", err);
                }
            }

            // Keep resource lookup state populated before resolving bundled Node
            // candidates. `bundled_node_candidate_paths()` uses both the generic
            // RESOURCE_DIR base and the exact Tauri-resolved `node-runtime`
            // directory captured above, so future refactors must preserve this order.
            let node_candidates = crate::plugin_paths::bundled_node_candidate_paths();

            if let Some(bundled_node) = node_candidates.iter().find(|path| path.is_file()) {
                crate::plugin_paths::set_node_executable_path(bundled_node.to_path_buf());
                log::info!(
                    "plugins: using bundled node runtime: {}",
                    bundled_node.display()
                );
            } else if let Some(primary) = node_candidates.first() {
                log::warn!(
                    "plugins: bundled node runtime missing at {}; plugin modules will not start",
                    primary.display()
                );
            } else {
                log::warn!(
                    "plugins: bundled node runtime path could not be resolved; plugin modules will not start"
                );
            }
            let store = crate::plugin_bundles::PluginBundleStore::new_default();
            if let Err(err) = store.sync_built_in_plugins() {
                crate::monitoring::capture_startup_error("sync_built_in_plugins", &err.to_string());
                warn!("plugins: failed to sync built-in plugins: {}", err);
            }
            let state = app.state::<state::AppState>();
            crate::config_watcher::start_config_watcher(app.handle().clone());
            if let Err(err) = crate::plugin_sources::sync_configured_plugins(&state.config()) {
                crate::monitoring::capture_startup_error(
                    "sync_configured_plugins",
                    &err.to_string(),
                );
                warn!("plugins: failed to sync configured plugins: {}", err);
            }
            if let Err(err) = state.plugin_runtime().sync_plugin_runtime() {
                crate::monitoring::capture_startup_error("sync_plugin_runtime", &err.to_string());
                warn!("plugins: failed to sync runtime on startup: {}", err);
            }
            match crate::plugin_vcs_backends::list_plugin_vcs_backends() {
                Ok(backends) if backends.is_empty() => {
                    let configured_default = state.config().general.default_backend;
                    error!(
                        "startup: no VCS backends are available; configured default backend='{}'; repo actions will remain unavailable until a backend plugin is installed, approved, and enabled",
                        configured_default
                    );
                }
                Ok(backends) => {
                    log::info!(
                        "startup: {} VCS backend(s) available after plugin sync",
                        backends.len()
                    );
                }
                Err(err) => {
                    warn!(
                        "startup: failed to discover VCS backends after plugin sync: {}",
                        err
                    );
                }
            }
            // On startup, optionally reopen the last repository if enabled in settings.
            try_reopen_last_repo(app.handle());

            // Optionally check for updates on launch and show custom dialog when available.
            let app_handle = app.handle().clone();
            let check_updates = {
                let s = app_handle.state::<state::AppState>();
                s.config().general.checks_on_launch
            };
            if check_updates {
                tauri::async_runtime::spawn(async move {
                    if let Ok(updater) = app_handle.updater() {
                        if let Ok(Some(_u)) = updater.check().await {
                            let _ = app_handle.emit(
                                "ui:update-available",
                                serde_json::json!({"source":"startup"}),
                            );
                        }
                    }
                });
            }

            Ok(())
        })
        .on_window_event(|window, event| {
            // If the main window is closed, exit the app even if auxiliary windows are open.
            if window.label() == "main" {
                if let WindowEvent::CloseRequested { .. } = event {
                    let state = window.app_handle().state::<state::AppState>();
                    state.plugin_runtime().stop_all_plugins();
                    window.app_handle().exit(0);
                }
            }
        })
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(build_invoke_handler::<_>())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

/// Returns the generated invoke handler that routes frontend IPC calls
/// to the backend command functions.
///
/// # Returns
/// - Tauri invoke handler closure.
fn build_invoke_handler<R: tauri::Runtime>(
) -> impl Fn(tauri::ipc::Invoke<R>) -> bool + Send + Sync + 'static {
    tauri::generate_handler![
        tauri_commands::about_info,
        tauri_commands::show_licenses,
        tauri_commands::browse_directory,
        tauri_commands::browse_file,
        tauri_commands::add_repo,
        tauri_commands::list_vcs_backends_cmd,
        tauri_commands::set_vcs_backend_cmd,
        tauri_commands::reopen_current_repo_cmd,
        tauri_commands::validate_vcs_url,
        tauri_commands::validate_add_path,
        tauri_commands::validate_clone_input,
        tauri_commands::current_repo_path,
        tauri_commands::list_recent_repos,
        tauri_commands::vcs_list_branches,
        tauri_commands::current_vcs_action_labels,
        tauri_commands::vcs_status,
        tauri_commands::vcs_log,
        tauri_commands::vcs_stash_list,
        tauri_commands::vcs_stash_push,
        tauri_commands::vcs_stash_apply,
        tauri_commands::vcs_stash_pop,
        tauri_commands::vcs_stash_drop,
        tauri_commands::vcs_stash_show,
        tauri_commands::vcs_head_status,
        tauri_commands::vcs_checkout_branch,
        tauri_commands::vcs_create_branch,
        tauri_commands::vcs_rename_branch,
        tauri_commands::vcs_current_branch,
        tauri_commands::get_repo_summary,
        tauri_commands::open_repo,
        tauri_commands::clone_repo,
        tauri_commands::vcs_diff_file,
        tauri_commands::vcs_conflict_details,
        tauri_commands::vcs_resolve_conflict_side,
        tauri_commands::vcs_save_merge_result,
        tauri_commands::vcs_launch_merge_tool,
        tauri_commands::vcs_delete_branch,
        tauri_commands::vcs_merge_branch,
        tauri_commands::vcs_merge_context,
        tauri_commands::vcs_merge_abort,
        tauri_commands::vcs_merge_continue,
        tauri_commands::vcs_set_upstream,
        tauri_commands::vcs_diff_commit,
        tauri_commands::vcs_cherry_pick_to_branch,
        tauri_commands::vcs_revert_commit,
        tauri_commands::commit_changes,
        tauri_commands::commit_selected,
        tauri_commands::commit_patch,
        tauri_commands::commit_patch_and_files,
        tauri_commands::vcs_discard_paths,
        tauri_commands::vcs_discard_patch,
        tauri_commands::vcs_set_remote_url,
        tauri_commands::vcs_fetch,
        tauri_commands::vcs_fetch_all,
        tauri_commands::vcs_pull,
        tauri_commands::vcs_push,
        tauri_commands::vcs_undo_since_push,
        tauri_commands::vcs_undo_to_commit,
        tauri_commands::vcs_add_to_gitignore_paths,
        tauri_commands::open_repo_file,
        tauri_commands::read_repo_file_text,
        tauri_commands::list_themes,
        tauri_commands::load_theme,
        tauri_commands::list_plugins,
        tauri_commands::list_plugin_start_failures,
        tauri_commands::load_plugin,
        tauri_commands::list_installed_plugins,
        tauri_commands::sync_configured_plugins,
        tauri_commands::uninstall_plugin,
        tauri_commands::set_plugin_enabled,
        tauri_commands::set_plugin_approval,
        tauri_commands::list_plugin_menus,
        tauri_commands::invoke_plugin_action,
        tauri_commands::get_plugin_settings,
        tauri_commands::save_plugin_settings,
        tauri_commands::reset_plugin_settings,
        tauri_commands::get_global_settings,
        tauri_commands::set_global_settings,
        tauri_commands::get_repo_settings,
        tauri_commands::set_repo_settings,
        tauri_commands::ssh_trust_host,
        tauri_commands::ssh_agent_list_keys,
        tauri_commands::ssh_key_candidates,
        tauri_commands::ssh_add_key,
        tauri_commands::updater_install_now,
        tauri_commands::get_update_status,
        tauri_commands::open_repo_dotfile,
        tauri_commands::open_docs,
        tauri_commands::open_output_log_window,
        tauri_commands::get_output_log,
        tauri_commands::clear_output_log,
        tauri_commands::log_frontend_message,
        tauri_commands::tail_app_log,
        tauri_commands::clear_app_log,
        tauri_commands::report_frontend_error,
        tauri_commands::exit_app,
        tauri_commands::check_for_updates,
    ]
}
