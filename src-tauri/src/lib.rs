mod git;
mod utilities;
mod tauri_commands;
mod menus;
mod workarounds;
mod state;
mod validate;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    workarounds::apply_linux_nvidia_workaround();

    println!("Running OpenVCS...");

    tauri::Builder::default()
        .manage(state::AppState::default())
        .setup(|app| {
            menus::build_and_attach_menu(app)?;
            Ok(())
        })
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
    ]
}
