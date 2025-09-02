mod vcs;
mod utilities;
mod tauri_commands;
use tauri::{menu::{MenuBuilder, MenuItem, PredefinedMenuItem, SubmenuBuilder}, Emitter, Manager};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    apply_linux_nvidia_workaround();

    println!("Running OpenVCS...");

    tauri::Builder::default()
        .setup(|app| {
            //
            // ----- File -----
            //
            let clone_item = MenuItem::with_id(app, "clone_repo", "Clone…", true, Some("Ctrl+Shift+C"))?;
            let add_item   = MenuItem::with_id(app, "add_repo",   "Add Existing…", true, Some("Ctrl+O"))?;
            let open_item  = MenuItem::with_id(app, "open_repo",  "Switch…", true, Some("Ctrl+R"))?;

            let file_menu = SubmenuBuilder::new(app, "File")
                .item(&clone_item)
                .item(&add_item)
                .item(&open_item)
                .separator()
                .item(&PredefinedMenuItem::quit(app, None)?)
                .build()?;

            //
            // ----- Edit -----
            //
            let edit_menu = SubmenuBuilder::new(app, "Edit")
                .item(&PredefinedMenuItem::undo(app, None)?)
                .item(&PredefinedMenuItem::redo(app, None)?)
                .separator()
                .item(&PredefinedMenuItem::cut(app, None)?)
                .item(&PredefinedMenuItem::copy(app, None)?)
                .item(&PredefinedMenuItem::paste(app, None)?)
                .item(&PredefinedMenuItem::select_all(app, None)?)
                .build()?;

            //
            // ----- View -----
            //
            let toggle_theme = MenuItem::with_id(app, "toggle_theme", "Toggle Theme", true, Some("Ctrl+J"))?;
            let toggle_left  = MenuItem::with_id(app, "toggle_left",  "Toggle Left Panel", true, Some("Ctrl+B"))?;
            let view_menu = SubmenuBuilder::new(app, "View")
                .item(&toggle_theme)
                .item(&toggle_left)
                .build()?;

            //
            // ----- Repository -----
            //
            let fetch_item  = MenuItem::with_id(app, "fetch",  "Fetch",  true, Some("F5"))?;
            let push_item   = MenuItem::with_id(app, "push",   "Push",   true, Some("Ctrl+P"))?;
            let commit_item = MenuItem::with_id(app, "commit", "Commit", true, Some("Ctrl+Enter"))?;
            let repo_menu = SubmenuBuilder::new(app, "Repository")
                .item(&fetch_item)
                .item(&push_item)
                .item(&commit_item)
                .build()?;

            //
            // ----- Help -----
            //
            let docs_item  = MenuItem::with_id(app, "docs",  "Documentation", true, None::<&str>)?;
            let about_item = MenuItem::with_id(app, "about", "About",         true, None::<&str>)?;
            let help_menu = SubmenuBuilder::new(app, "Help")
                .item(&docs_item)
                .item(&about_item)
                .build()?;

            //
            // ----- Attach to app -----
            //
            let menu = MenuBuilder::new(app)
                .items(&[&file_menu, &edit_menu, &view_menu, &repo_menu, &help_menu])
                .build()?;

            app.set_menu(menu)?;
            Ok(())
        })
        // forward native menu selections to the webview (your JS listens for "menu")
        .on_menu_event(|app, event| {
            let id = event.id().0.to_string();
            // Broadcast to all windows (v2)
            let _ = app.app_handle().emit("menu", id);
        })
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            tauri_commands::greet,
            tauri_commands::about_info,
            tauri_commands::show_licenses
            ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(target_os = "linux")]
fn apply_linux_nvidia_workaround() {
    // Only apply if we're on Wayland + NVIDIA
    let is_wayland = std::env::var("XDG_SESSION_TYPE")
        .map(|v| v.eq_ignore_ascii_case("wayland"))
        .unwrap_or(false);

    let is_nvidia = {
        // NVIDIA usually sets this env var when using GLVND
        if let Ok(v) = std::env::var("__GLX_VENDOR_LIBRARY_NAME") {
            v.eq_ignore_ascii_case("nvidia")
        } else if std::env::var("__NV_PRIME_RENDER_OFFLOAD").is_ok() {
            true
        } else {
            // Fallback: check for NVIDIA in /proc/driver/nvidia/version
            std::fs::read_to_string("/proc/driver/nvidia/version")
                .map(|s| s.contains("NVIDIA"))
                .unwrap_or(false)
        }
    };

    if is_wayland && is_nvidia {
        const KEY: &str = "WEBKIT_DISABLE_DMABUF_RENDERER";
        if std::env::var_os(KEY).is_none() {
            eprintln!("Applying NVIDIA Wayland workaround: {KEY}=1");
            std::env::set_var(KEY, "1");
        }
    }
}
