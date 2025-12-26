use crate::{settings, state::AppState, themes};
use std::collections::HashSet;
use tauri::State;

#[tauri::command]
pub fn list_themes(state: State<'_, AppState>) -> Vec<themes::ThemeSummary> {
    let cfg: settings::AppConfig = state.config();
    let disabled: HashSet<String> = cfg.plugins.disabled.into_iter().collect();

    themes::list_themes()
        .into_iter()
        .filter(|t| {
            if !matches!(t.source, themes::ThemeSource::Plugin) {
                return true;
            }
            let plugin_id = t
                .plugin_id
                .as_ref()
                .map(|s| s.trim().to_ascii_lowercase())
                .unwrap_or_default();
            !plugin_id.is_empty() && !disabled.contains(&plugin_id)
        })
        .collect()
}

#[tauri::command]
pub fn load_theme(state: State<'_, AppState>, id: String) -> Result<themes::ThemePayload, String> {
    let cfg: settings::AppConfig = state.config();
    let disabled: HashSet<String> = cfg.plugins.disabled.into_iter().collect();

    let payload = themes::load_theme(id.trim())?;
    if matches!(payload.summary.source, themes::ThemeSource::Plugin) {
        let plugin_id = payload
            .summary
            .plugin_id
            .as_ref()
            .map(|s| s.trim().to_ascii_lowercase())
            .unwrap_or_default();
        if !plugin_id.is_empty() && disabled.contains(&plugin_id) {
            return Err(format!("theme `{}` belongs to a disabled plugin", payload.summary.id));
        }
    }
    Ok(payload)
}
