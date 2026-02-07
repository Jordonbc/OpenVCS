use log::warn;
use openvcs_core::BackendId;
use std::sync::Arc;
use tauri::path::BaseDirectory;
use tauri::WindowEvent;
use tauri::{Emitter, Manager};
use tauri_plugin_updater::UpdaterExt;

mod logging;
mod output_log;
mod plugin_bundles;
mod plugin_paths;
mod plugin_runtime;
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

fn preferred_vcs_backend_id(_cfg: &settings::AppConfig) -> Option<BackendId> {
    let desired = _cfg.general.default_backend.trim().to_string();
    if !desired.is_empty() {
        let desired = BackendId::from(desired);
        if crate::plugin_vcs_backends::has_plugin_vcs_backend(&desired) {
            return Some(desired);
        }
    }

    crate::plugin_vcs_backends::list_plugin_vcs_backends().ok().and_then(|mut backends| {
        backends.sort_by(|a, b| a.backend_id.as_ref().cmp(b.backend_id.as_ref()));
        backends.into_iter().next().map(|b| b.backend_id)
    })
}

/// Attempt to reopen the most recent repository at startup if the
/// global setting `general.reopen_last_repos` is enabled.
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
            match crate::plugin_vcs_backends::open_repo_via_plugin_vcs_backend(
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
                Err(error) => log::warn!("startup reopen: failed to open repo: {}", error),
            }
        } else {
            log::warn!("startup reopen: backend not available");
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Initialize logging
    logging::init();

    workarounds::apply_linux_nvidia_workaround();

    println!("Running OpenVCS...");

    tauri::Builder::default()
        .manage(state::AppState::new_with_config())
        .setup(|app| {
            let store = crate::plugin_bundles::PluginBundleStore::new_default();
            if let Err(err) = store.sync_built_in_plugins() {
                warn!("plugins: failed to sync built-in bundles: {}", err);
            }
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

/// Returns the set of command handlers for the app.
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
        tauri_commands::call_vcs_backend_method,
        tauri_commands::validate_git_url,
        tauri_commands::validate_add_path,
        tauri_commands::validate_clone_input,
        tauri_commands::current_repo_path,
        tauri_commands::list_recent_repos,
        tauri_commands::git_list_branches,
        tauri_commands::git_status,
        tauri_commands::git_log,
        tauri_commands::git_stash_list,
        tauri_commands::git_stash_push,
        tauri_commands::git_stash_apply,
        tauri_commands::git_stash_pop,
        tauri_commands::git_stash_drop,
        tauri_commands::git_stash_show,
        tauri_commands::git_head_status,
        tauri_commands::git_checkout_branch,
        tauri_commands::git_create_branch,
        tauri_commands::git_rename_branch,
        tauri_commands::git_current_branch,
        tauri_commands::get_repo_summary,
        tauri_commands::open_repo,
        tauri_commands::clone_repo,
        tauri_commands::git_diff_file,
        tauri_commands::git_conflict_details,
        tauri_commands::git_resolve_conflict_side,
        tauri_commands::git_save_merge_result,
        tauri_commands::git_launch_merge_tool,
        tauri_commands::git_delete_branch,
        tauri_commands::git_merge_branch,
        tauri_commands::git_merge_context,
        tauri_commands::git_merge_abort,
        tauri_commands::git_merge_continue,
        tauri_commands::git_set_upstream,
        tauri_commands::git_diff_commit,
        tauri_commands::git_cherry_pick_to_branch,
        tauri_commands::git_revert_commit,
        tauri_commands::commit_changes,
        tauri_commands::commit_selected,
        tauri_commands::commit_patch,
        tauri_commands::commit_patch_and_files,
        tauri_commands::git_discard_paths,
        tauri_commands::git_discard_patch,
        tauri_commands::git_set_remote_url,
        tauri_commands::git_fetch,
        tauri_commands::git_fetch_all,
        tauri_commands::git_pull,
        tauri_commands::git_push,
        tauri_commands::git_undo_since_push,
        tauri_commands::git_undo_to_commit,
        tauri_commands::git_add_to_gitignore_paths,
        tauri_commands::open_repo_file,
        tauri_commands::read_repo_file_text,
        tauri_commands::list_themes,
        tauri_commands::load_theme,
        tauri_commands::list_plugins,
        tauri_commands::load_plugin,
        tauri_commands::install_ovcsp,
        tauri_commands::list_installed_bundles,
        tauri_commands::uninstall_plugin,
        tauri_commands::approve_plugin_capabilities,
        tauri_commands::list_plugin_functions,
        tauri_commands::invoke_plugin_function,
        tauri_commands::call_plugin_module_method,
        tauri_commands::get_global_settings,
        tauri_commands::set_global_settings,
        tauri_commands::get_repo_settings,
        tauri_commands::set_repo_settings,
        tauri_commands::ssh_trust_host,
        tauri_commands::ssh_agent_list_keys,
        tauri_commands::ssh_key_candidates,
        tauri_commands::ssh_add_key,
        tauri_commands::updater_install_now,
        tauri_commands::open_repo_dotfile,
        tauri_commands::open_docs,
        tauri_commands::open_output_log_window,
        tauri_commands::get_output_log,
        tauri_commands::clear_output_log,
        tauri_commands::tail_app_log,
        tauri_commands::clear_app_log,
        tauri_commands::exit_app,
        tauri_commands::check_for_updates,
    ]
}
