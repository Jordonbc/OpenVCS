mod vcs;
mod tauri_commands;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    println!("Running OpenVCS...");

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![tauri_commands::greet])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
