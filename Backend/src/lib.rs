use tauri::{Emitter, Manager};
use openvcs_core::{backend_descriptor, backend_id, BackendId};

mod utilities;
mod tauri_commands;
mod menus;
mod workarounds;
mod state;
mod validate;

#[cfg(feature = "with-git")]
#[allow(unused_imports)]
use openvcs_git as _;

#[cfg(feature = "with-git-libgit2")]
#[allow(unused_imports)]
use openvcs_git_libgit2 as _;

pub const GIT_SYSTEM_ID: BackendId = backend_id!("git-system");

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
        .manage(state::AppState::default())
        .setup(|app| {
            menus::build_and_attach_menu(app)?;
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
        tauri_commands::list_branches,
        tauri_commands::git_status,
        tauri_commands::git_log,
        tauri_commands::git_checkout_branch,
        tauri_commands::git_create_branch,
        tauri_commands::git_diff_file,
        tauri_commands::commit_changes,
        tauri_commands::git_fetch,
        tauri_commands::git_push,
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
