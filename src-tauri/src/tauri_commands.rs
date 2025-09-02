use std::{path::{PathBuf}, sync::Arc};
use serde_json::{json, Value};
use crate::vcs::vcs::Vcs;
use crate::utilities::utilities::AboutInfo;

#[tauri::command]
pub fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[tauri::command]
pub async fn init_repo(path: String, state: tauri::State<'_, Arc<dyn Vcs>>) -> Result<(), String> {
  let p = PathBuf::from(path);
  state.init_repo(&p).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn list_branches(path: String, state: tauri::State<'_, Arc<dyn Vcs>>) -> Result<Vec<String>, String> {
  let p = PathBuf::from(path);
  state.list_branches(&p).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn about_info() -> AboutInfo {
  AboutInfo::gather()
}

#[tauri::command]
pub fn show_licenses() -> Result<(), String> {
  // open a bundled licenses file, or a window, or external URL
  Ok(())
}

