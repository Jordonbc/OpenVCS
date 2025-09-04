use std::path::Path;

use tauri::{Emitter, Manager, Runtime, State, Window};
use crate::state::AppState;
use crate::utilities::utilities;
use crate::validate;

#[tauri::command]
pub fn about_info() -> utilities::AboutInfo {
  utilities::AboutInfo::gather()
}

#[tauri::command]
pub fn show_licenses() -> Result<(), String> {
  // open a bundled licenses file, or a window, or external URL
  Ok(())
}

#[tauri::command]
pub async fn browse_directory<R: Runtime>(
    window: Window<R>,
    purpose: Option<String>,
) -> Option<String> {
    let title = match purpose.as_deref() {
        Some("clone_dest") => "Choose destination folder",
        Some("add_repo")   => "Select an existing Git repository folder",
        _                  => "Select a folder",
    };
    utilities::browse_directory_async(window.app_handle().clone(), title).await
}

#[tauri::command]
pub async fn add_repo<R: Runtime>(window: Window<R>, state: State<'_, AppState>, path: String) -> Result<(), String> {
    let p = Path::new(&path);

    let v = validate_add_path(path.clone());
    if !v.ok { return Err(v.reason.unwrap_or("Invalid path".into())); }

    match git2::Repository::open(&p) {
         Ok(_) => {}
         Err(e) => return Err(format!("Not a Git repository: {path} ({e})")),
    }

    // Persist as the active repo in state
    state.set_current_repo(p.to_path_buf());

    // Notify the UI
    let _ = window.app_handle().emit("repo:selected", &path);

    Ok(())
}

#[tauri::command]
pub fn validate_git_url(url: String) -> validate::Validation {
    validate::validate_git_url(url)
}

#[tauri::command]
pub fn validate_add_path(path: String) -> validate::Validation {
    validate::validate_add_path(path)
}


#[tauri::command]
pub fn validate_clone_input(url: String, dest: String) -> validate::Validation {
    validate::validate_clone_input(url, dest)
}

#[tauri::command]
pub fn current_repo_path(state: State<'_, AppState>) -> Option<String> {
    state.current_repo().map(|p| p.to_string_lossy().to_string())
}

#[tauri::command]
pub fn list_recent_repos(state: State<'_, AppState>) -> Vec<String> {
    state.recents().into_iter().map(|p| p.to_string_lossy().to_string()).collect()
}
