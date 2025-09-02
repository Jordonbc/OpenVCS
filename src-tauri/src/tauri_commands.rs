use crate::utilities::utilities::AboutInfo;

#[tauri::command]
pub fn about_info() -> AboutInfo {
  AboutInfo::gather()
}

#[tauri::command]
pub fn show_licenses() -> Result<(), String> {
  // open a bundled licenses file, or a window, or external URL
  Ok(())
}

