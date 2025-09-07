use tauri::{Emitter, Manager};
use std::sync::Arc;
use openvcs_core::{backend_descriptor, backend_id, BackendId};

mod utilities;
mod tauri_commands;
mod menus;
mod workarounds;
mod state;
mod validate;
mod settings;
mod repo_settings;

#[cfg(feature = "with-git")]
#[allow(unused_imports)]
use openvcs_git as _;

#[cfg(feature = "with-git-libgit2")]
#[allow(unused_imports)]
use openvcs_git_libgit2 as _;

pub const GIT_SYSTEM_ID: BackendId = backend_id!("git-system");

/// Attempt to reopen the most recent repository at startup if the
/// global setting `general.reopen_last_repos` is enabled.
fn try_reopen_last_repo<R: tauri::Runtime>(app: &tauri::App<R>) {
    use openvcs_core::{backend_descriptor::get_backend, Repo};
    use std::path::Path;

    let state = app.state::<state::AppState>();
    let cfg = state.config();
    if !cfg.general.reopen_last_repos { return; }

    let recents = state.recents();
    if let Some(path) = recents.into_iter().find(|p| p.exists()) {
        let backend: BackendId = match cfg.git.backend {
            settings::GitBackend::System => GIT_SYSTEM_ID,
            settings::GitBackend::Libgit2 => backend_id!("libgit2"),
        };

        let path_str = path.to_string_lossy().to_string();
        match get_backend(&backend) {
            Some(desc) => match (desc.open)(Path::new(&path_str)) {
                Ok(handle) => {
                    let repo = Arc::new(Repo::new(handle));
                    state.set_current_repo(repo);
                    if let Err(e) = app.emit("repo:selected", &path_str) {
                        log::warn!("startup reopen: failed to emit repo:selected: {}", e);
                    }
                }
                Err(e) => log::warn!("startup reopen: failed to open repo: {}", e),
            },
            None => log::warn!("startup reopen: unknown backend `{}`", backend),
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    if std::env::var_os("RUST_LOG").is_none() {
        // Show info globally; debug for your crates
        std::env::set_var(
            "RUST_LOG",
            "info,openvcs_core=debug,openvcs_git=debug,openvcs_git_libgit2=debug"
        );
    }

    // Pretty timestamps help
    env_logger::Builder::from_default_env()
        .format_timestamp_millis()
        .init();

    // (Optional) prove the registry is populated at startup
    for b in backend_descriptor::list_backends() {
        log::info!("backend loaded: {} ({})", b.id, b.name);
    }

    workarounds::apply_linux_nvidia_workaround();

    println!("Running OpenVCS...");

    tauri::Builder::default()
        .manage(state::AppState::new_with_config())
        .setup(|app| {
            menus::build_and_attach_menu(app)?;

            // On startup, optionally reopen the last repository if enabled in settings.
            try_reopen_last_repo(app);

            Ok(())
        })
        .on_window_event(handle_window_event::<_>)
        .on_menu_event(menus::handle_menu_event::<_>)
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
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
        tauri_commands::git_checkout_branch,
        tauri_commands::git_create_branch,
        tauri_commands::git_current_branch,
        tauri_commands::get_repo_summary,
        tauri_commands::open_repo,
        tauri_commands::clone_repo,
        tauri_commands::git_diff_file,
        tauri_commands::commit_changes,
        tauri_commands::commit_selected,
        tauri_commands::commit_patch,
        tauri_commands::git_fetch,
        tauri_commands::git_pull,
        tauri_commands::git_push,
        tauri_commands::get_global_settings,
        tauri_commands::set_global_settings,
        tauri_commands::get_repo_settings,
        tauri_commands::set_repo_settings,
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
