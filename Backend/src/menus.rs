use tauri::{async_runtime, menu, Emitter};
use tauri::menu::{Menu, MenuBuilder, MenuEvent, MenuItem};
use tauri_plugin_opener::OpenerExt;

use crate::utilities::utilities;

const WIKI_URL: &str = "https://github.com/jordonbc/OpenVCS/wiki";

/// Builds all submenus and attaches the composed menu to the app.
pub fn build_and_attach_menu<R: tauri::Runtime>(app: &tauri::App<R>) -> tauri::Result<()> {
    let file_menu = build_file_menu(app)?;
    let edit_menu = build_edit_menu(app)?;
    let view_menu = build_view_menu(app)?;
    let repo_menu = build_repository_menu(app)?;
    let help_menu = build_help_menu(app)?;

    let menu: Menu<R> = MenuBuilder::new(app)
        .items(&[&file_menu, &edit_menu, &view_menu, &repo_menu, &help_menu])
        .build()?;

    app.set_menu(menu)?;
    Ok(())
}

/// ----- File -----
fn build_file_menu<R: tauri::Runtime>(app: &tauri::App<R>) -> tauri::Result<menu::Submenu<R>> {
    let clone_item = MenuItem::with_id(app, "clone_repo", "Clone…", true, Some("Ctrl+Shift+C"))?;
    let add_item   = MenuItem::with_id(app, "add_repo",   "Add Existing…", true, Some("Ctrl+O"))?;
    let open_item  = MenuItem::with_id(app, "open_repo",  "Switch…", true, Some("Ctrl+R"))?;
    let prefs_item = MenuItem::with_id(app, "settings", "Preferences…", true, Some("Ctrl+P"))?;

    menu::SubmenuBuilder::new(app, "File")
        .item(&clone_item)
        .item(&add_item)
        .item(&open_item)
        .separator()
        .item(&menu::PredefinedMenuItem::quit(app, None)?)
        .item(&prefs_item)
        .build()
}

/// ----- Edit -----
fn build_edit_menu<R: tauri::Runtime>(app: &tauri::App<R>) -> tauri::Result<menu::Submenu<R>> {
    menu::SubmenuBuilder::new(app, "Edit")
        .item(&menu::PredefinedMenuItem::undo(app, None)?)
        .item(&menu::PredefinedMenuItem::redo(app, None)?)
        .separator()
        .item(&menu::PredefinedMenuItem::cut(app, None)?)
        .item(&menu::PredefinedMenuItem::copy(app, None)?)
        .item(&menu::PredefinedMenuItem::paste(app, None)?)
        .item(&menu::PredefinedMenuItem::select_all(app, None)?)
        .build()
}

/// ----- View -----
fn build_view_menu<R: tauri::Runtime>(app: &tauri::App<R>) -> tauri::Result<menu::Submenu<R>> {
    let toggle_theme = MenuItem::with_id(app, "toggle_theme", "Toggle Theme", true, Some("Ctrl+J"))?;
    menu::SubmenuBuilder::new(app, "View")
        .item(&toggle_theme)
        .build()
}

/// ----- Repository -----
fn build_repository_menu<R: tauri::Runtime>(app: &tauri::App<R>) -> tauri::Result<menu::Submenu<R>> {
    let fetch_item  = MenuItem::with_id(app, "fetch",  "Fetch",  true, Some("F5"))?;
    let push_item   = MenuItem::with_id(app, "push",   "Push",   true, Some("Ctrl+P"))?;
    let commit_item = MenuItem::with_id(app, "commit", "Commit", true, Some("Ctrl+Enter"))?;
    let repo_settings_item = MenuItem::with_id(app, "repo-settings", "Repository Settings", true, None::<&str>)?;
    menu::SubmenuBuilder::new(app, "Repository")
        .item(&fetch_item)
        .item(&push_item)
        .item(&commit_item)
        .item(&repo_settings_item)
        .build()
}

/// ----- Help -----
fn build_help_menu<R: tauri::Runtime>(app: &tauri::App<R>) -> tauri::Result<menu::Submenu<R>> {
    let docs_item  = MenuItem::with_id(app, "docs",  "Documentation", true, None::<&str>)?;
    let about_item = MenuItem::with_id(app, "about", "About",         true, None::<&str>)?;
    menu::SubmenuBuilder::new(app, "Help")
        .item(&docs_item)
        .item(&about_item)
        .build()
}

/// Centralized native menu event handler.
/// Emits `"menu"` to the webview for everything except explicit items we intercept.
pub fn handle_menu_event<R: tauri::Runtime>(app: &tauri::AppHandle<R>, event: MenuEvent) {
    let id = event.id().0.to_string();
    match id.as_str() {
        "docs" => {
            let _ = app.opener().open_url(WIKI_URL, None::<&str>);
        }
        "add_repo" => {
            let app_cloned = app.clone();
            async_runtime::spawn(async move {
                if let Some(path) = utilities::browse_directory_async(
                    app_cloned.clone(),
                    "Select an existing Git repository folder",
                ).await {
                    let _ = app_cloned.emit("repo:add_existing:selected", path);
                } else {
                    let _ = app_cloned.emit("repo:add_existing:cancelled", ());
                }
            });
        }
        "settings" => {
            // Tell the webview to open the Settings modal
            let _ = app.emit("ui:open-settings", ());
        }
        "repo-settings" => {
            // Tell the webview to open the Settings modal
            let _ = app.emit("ui:open-repo-settings", ());
        }
        _ => {
            // Fallback: forward other menu IDs if you already rely on this
            let _ = app.emit("menu", id);
        }
    }
}
