use tauri::{async_runtime, menu, Emitter, Manager};
use tauri_plugin_updater::UpdaterExt;
use tauri::menu::{Menu, MenuBuilder, MenuEvent, MenuItem};
use tauri_plugin_opener::OpenerExt;

use crate::utilities::utilities;
use crate::state::AppState;
use std::fs::OpenOptions;
use std::path::PathBuf;

const WIKI_URL: &str = "https://github.com/jordonbc/OpenVCS/wiki";

/// Builds all submenus and attaches the composed menu to the app.
pub fn build_and_attach_menu<R: tauri::Runtime>(app: &tauri::App<R>) -> tauri::Result<()> {
    let file_menu = build_file_menu(app)?;
    let repo_menu = build_repository_menu(app)?;
    let help_menu = build_help_menu(app)?;

    let menu: Menu<R> = MenuBuilder::new(app)
        .items(&[&file_menu, &repo_menu, &help_menu])
        .build()?;

    app.set_menu(menu)?;
    Ok(())
}

/// ----- File -----
fn build_file_menu<R: tauri::Runtime>(app: &tauri::App<R>) -> tauri::Result<menu::Submenu<R>> {
    let clone_item = MenuItem::with_id(app, "clone_repo", "Clone…", true, Some("Ctrl+Shift+C"))?;
    let add_repo_item   = MenuItem::with_id(app, "add_repo",   "Add Existing…", true, Some("Ctrl+O"))?;
    let open_repo_item  = MenuItem::with_id(app, "open_repo",  "Switch…", true, Some("Ctrl+R"))?;
    let settings_item = MenuItem::with_id(app, "settings", "Preferences…", true, Some("Ctrl+P"))?;

    // macOS: keep native Quit in the App/File menu
    #[cfg(target_os = "macos")]
    {
        return menu::SubmenuBuilder::new(app, "File")
            .item(&clone_item)
            .item(&add_repo_item)
            .item(&open_repo_item)
            .separator()
            .item(&settings_item)
            .separator()
            .item(&menu::PredefinedMenuItem::quit(app, None)?)
            .build();
    }

    // Other platforms: add explicit "Exit" item
    #[cfg(not(target_os = "macos"))]
    {
        let exit_item = MenuItem::with_id(app, "exit", "Exit", true, None::<&str>)?;
        return menu::SubmenuBuilder::new(app, "File")
            .item(&clone_item)
            .item(&add_repo_item)
            .item(&open_repo_item)
            .separator()
            .item(&settings_item)
            .separator()
            .item(&exit_item)
            .build();
    }
}

/// ----- Repository -----
fn build_repository_menu<R: tauri::Runtime>(app: &tauri::App<R>) -> tauri::Result<menu::Submenu<R>> {
    let fetch_item  = MenuItem::with_id(app, "fetch",  "Fetch/Pull",  true, Some("F5"))?;
    let push_item   = MenuItem::with_id(app, "push",   "Push",   true, Some("Ctrl+P"))?;
    let commit_item = MenuItem::with_id(app, "commit", "Commit", true, Some("Ctrl+Enter"))?;
    let repo_settings_item = MenuItem::with_id(app, "repo-settings", "Repository Settings", true, None::<&str>)?;
    let edit_gitignore_item = MenuItem::with_id(app, "repo-edit-gitignore", "Edit .gitignore", true, None::<&str>)?;
    let edit_gitattributes_item = MenuItem::with_id(app, "repo-edit-gitattributes", "Edit .gitattributes", true, None::<&str>)?;
    menu::SubmenuBuilder::new(app, "Repository")
        .item(&fetch_item)
        .item(&push_item)
        .item(&commit_item)
        .separator()
        .item(&edit_gitignore_item)
        .item(&edit_gitattributes_item)
        .item(&repo_settings_item)
        .build()
}

/// ----- Help -----
fn build_help_menu<R: tauri::Runtime>(app: &tauri::App<R>) -> tauri::Result<menu::Submenu<R>> {
    let docs_item  = MenuItem::with_id(app, "docs",  "Documentation", true, None::<&str>)?;
    let updates_item = MenuItem::with_id(app, "check_updates", "Check for Updates…", true, None::<&str>)?;
    let about_item = MenuItem::with_id(app, "about", "About",         true, None::<&str>)?;
    menu::SubmenuBuilder::new(app, "Help")
        .item(&docs_item)
        .item(&updates_item)
        .item(&about_item)
        .build()
}

/// Centralized native menu event handler.
/// Emits `"menu"` to the webview for everything except explicit items we intercept.
pub fn handle_menu_event<R: tauri::Runtime>(app: &tauri::AppHandle<R>, event: MenuEvent) {
    let id = event.id().0.to_string();
    match id.as_str() {
        "exit" => {
            // Gracefully exit the application
            app.exit(0);
        }
        "docs" => {
            let _ = app.opener().open_url(WIKI_URL, None::<&str>);
        }
        "repo-edit-gitignore" => {
            open_repo_dotfile(app, ".gitignore");
        }
        "repo-edit-gitattributes" => {
            open_repo_dotfile(app, ".gitattributes");
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
        "check_updates" => {
            let app_cloned = app.clone();
            async_runtime::spawn(async move {
                match app_cloned.updater() {
                    Ok(updater) => match updater.check().await {
                        Ok(Some(_u)) => {
                            let _ = app_cloned.emit("ui:update-available", serde_json::json!({"source":"updater"}));
                        }
                        Ok(None) => {
                            let _ = app_cloned.emit("ui:notify", "Already up to date");
                        }
                        Err(_) => {
                            let _ = app_cloned.emit("ui:notify", "Update check failed");
                        }
                    },
                    Err(_) => {
                        let _ = app_cloned.emit("ui:notify", "Updater unavailable");
                    }
                }
            });
        }
        _ => {
            // Fallback: forward other menu IDs if you already rely on this
            let _ = app.emit("menu", id);
        }
    }
}

/// Open or create a repository dotfile in the user's default editor.
fn open_repo_dotfile<R: tauri::Runtime>(app_handle: &tauri::AppHandle<R>, name: &str) {
    // Resolve current repo path from managed state
    let state = app_handle.state::<AppState>();
    let root = match state.current_repo() {
        Some(repo) => repo.inner().workdir().to_path_buf(),
        None => {
            let _ = app_handle.emit("ui:notify", "No repository selected");
            return;
        }
    };

    let mut path = PathBuf::from(root);
    path.push(name);

    // Ensure the file exists (create if missing)
    if !path.exists() {
        let _ = OpenOptions::new()
            .create(true)
            .write(true)
            .open(&path);
    }

    // Open with system default editor/handler
    let _ = app_handle.opener().open_path(path.to_string_lossy().to_string(), None::<&str>);
}
