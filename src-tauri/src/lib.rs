mod vcs;
mod utilities;
mod tauri_commands;
mod menus;
mod workarounds;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    workarounds::apply_linux_nvidia_workaround();

    println!("Running OpenVCS...");

    tauri::Builder::default()
        .setup(|app| {
            menus::build_and_attach_menu(app)?;
            Ok(())
        })
        .on_menu_event(menus::handle_menu_event::<_>)
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(build_invoke_handler::<_>())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

/// Returns the set of command handlers for the app.
fn build_invoke_handler<R: tauri::Runtime>() -> impl Fn(tauri::ipc::Invoke<R>) -> bool + Send + Sync + 'static {
    tauri::generate_handler![
        tauri_commands::about_info,
        tauri_commands::show_licenses
    ]
}
