use crate::themes;

#[tauri::command]
pub fn list_themes() -> Vec<themes::ThemeSummary> {
    themes::list_themes()
}

#[tauri::command]
pub fn load_theme(id: String) -> Result<themes::ThemePayload, String> {
    themes::load_theme(id.trim())
}
