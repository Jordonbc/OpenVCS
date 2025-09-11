use tauri::{Emitter, Manager};
use std::sync::Arc;
use openvcs_core::{backend_id, BackendId};
use tauri_plugin_updater::UpdaterExt;

mod utilities;
mod tauri_commands;
mod menus;
mod workarounds;
mod state;
mod validate;
mod settings;
mod repo_settings;
mod logging;

#[cfg(feature = "with-git")]
#[allow(unused_imports)]
use openvcs_git as _;

#[cfg(feature = "with-git-libgit2")]
#[allow(unused_imports)]
use openvcs_git_libgit2 as _;

pub const GIT_SYSTEM_ID: BackendId = backend_id!("git-system");

/// Attempt to reopen the most recent repository at startup if the
/// global setting `general.reopen_last_repos` is enabled.
fn try_reopen_last_repo<R: tauri::Runtime>(app_handle: &tauri::AppHandle<R>) {
    use openvcs_core::{backend_descriptor::get_backend, Repo};
    use std::path::Path;

    let state = app_handle.state::<state::AppState>();
    let app_config = state.config();
    if !app_config.general.reopen_last_repos { return; }

    let recents = state.recents();
    if let Some(path) = recents.into_iter().find(|p| p.exists()) {
        let backend: BackendId = match app_config.git.backend {
            settings::GitBackend::System => GIT_SYSTEM_ID,
            settings::GitBackend::Libgit2 => backend_id!("libgit2"),
        };

        let path_str = path.to_string_lossy().to_string();
        match get_backend(&backend) {
            Some(description) => match (description.open)(Path::new(&path)) {
                Ok(backend_handle) => {
                    let existing_repo = Arc::new(Repo::new(backend_handle));
                    state.set_current_repo(existing_repo);
                    if let Err(error) = app_handle.emit("repo:selected", &path_str) {
                        log::warn!("startup reopen: failed to emit repo:selected: {}", error);
                    }
                }
                Err(error) => log::warn!("startup reopen: failed to open repo: {}", error),
            },
            None => log::warn!("startup reopen: unknown backend `{}`", backend),
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    
    // Initialize logging
    logging::init();

    {
        use openvcs_core::backend_descriptor;

        // (Optional) prove the registry is populated at startup
        for backend in backend_descriptor::list_backends() {
            log::info!("backend loaded: {} ({})", backend.id, backend.name);
        }
    }

    workarounds::apply_linux_nvidia_workaround();

    println!("Running OpenVCS...");

    tauri::Builder::default()
        .manage(state::AppState::new_with_config())
        .setup(|app| {
            menus::build_and_attach_menu(app)?;

            // On startup, optionally reopen the last repository if enabled in settings.
            try_reopen_last_repo(&app.handle());

            // Optionally check for updates on launch and show custom dialog when available.
            let app_handle = app.handle().clone();
            let check_updates = {
                let s = app_handle.state::<state::AppState>();
                s.config().general.checks_on_launch
            };
            if check_updates {
                tauri::async_runtime::spawn(async move {
                    if let Ok(updater) = app_handle.updater() {
                        match updater.check().await {
                            Ok(Some(_u)) => {
                                let _ = app_handle.emit("ui:update-available", serde_json::json!({"source":"startup"}));
                            }
                            _ => {}
                        }
                    }
                });
            }

            Ok(())
        })
        .on_window_event(handle_window_event::<_>)
        .on_menu_event(menus::handle_menu_event::<_>)
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(build_invoke_handler::<_>())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

/// Returns the set of command handlers for the app.
fn build_invoke_handler<R: tauri::Runtime>() -> impl Fn(tauri::ipc::Invoke<R>) -> bool + Send + Sync + 'static {
    tauri::generate_handler![
        tauri_commands::about_info,
        tauri_commands::show_licenses,
        tauri_commands::browse_directory,
        tauri_commands::add_repo,
        tauri_commands::validate_git_url,
        tauri_commands::validate_add_path,
        tauri_commands::validate_clone_input,
        tauri_commands::current_repo_path,
        tauri_commands::list_recent_repos,
        tauri_commands::git_list_branches,
        tauri_commands::git_status,
        tauri_commands::git_log,
        tauri_commands::git_head_status,
        tauri_commands::git_checkout_branch,
        tauri_commands::git_create_branch,
        tauri_commands::git_rename_branch,
        tauri_commands::git_current_branch,
        tauri_commands::get_repo_summary,
        tauri_commands::open_repo,
        tauri_commands::clone_repo,
        tauri_commands::git_diff_file,
        tauri_commands::git_delete_branch,
        tauri_commands::git_merge_branch,
        tauri_commands::git_diff_commit,
        tauri_commands::commit_changes,
        tauri_commands::commit_selected,
        tauri_commands::commit_patch,
        tauri_commands::commit_patch_and_files,
        tauri_commands::git_discard_paths,
        tauri_commands::git_discard_patch,
        tauri_commands::git_fetch,
        tauri_commands::git_pull,
        tauri_commands::git_push,
        tauri_commands::get_global_settings,
        tauri_commands::set_global_settings,
        tauri_commands::get_repo_settings,
        tauri_commands::set_repo_settings,
        tauri_commands::updater_install_now,
    ]
}

fn handle_window_event<R: tauri::Runtime>(win: &tauri::Window<R>, event: &tauri::WindowEvent) {
    match event {
        tauri::WindowEvent::Focused(true) => {
            // Fire a custom event to the frontend
            let _ = win.emit("app:focus", ());
        }
        _ => {}
    }
}
