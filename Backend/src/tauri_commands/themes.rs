use crate::{plugins, settings, state::AppState, themes};
use std::collections::HashSet;
use tauri::State;

/// Computes set of enabled plugin ids based on settings and plugin defaults.
///
/// # Parameters
/// - `cfg`: App configuration snapshot.
///
/// # Returns
/// - Lowercase set of enabled plugin ids.
fn enabled_plugins(cfg: &settings::AppConfig) -> HashSet<String> {
    let mut out = HashSet::new();
    for p in plugins::list_plugins() {
        let id = p.id.trim().to_ascii_lowercase();
        if id.is_empty() {
            continue;
        }
        if cfg.is_plugin_enabled(&id, p.default_enabled) {
            out.insert(id);
        }
    }
    out
}

#[tauri::command]
/// Lists themes filtered to those from enabled plugins (plus built-ins).
///
/// # Parameters
/// - `state`: Shared application state.
///
/// # Returns
/// - Theme summaries visible to the current configuration.
pub fn list_themes(state: State<'_, AppState>) -> Vec<themes::ThemeSummary> {
    let cfg: settings::AppConfig = state.config();
    let enabled = enabled_plugins(&cfg);

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
            !plugin_id.is_empty() && enabled.contains(&plugin_id)
        })
        .collect()
}

#[tauri::command]
/// Loads a theme payload, rejecting themes from disabled plugins.
///
/// # Parameters
/// - `state`: Shared application state.
/// - `id`: Theme id to load.
///
/// # Returns
/// - `Ok(ThemePayload)` when theme is found and allowed.
/// - `Err(String)` when load fails or the owning plugin is disabled.
pub fn load_theme(state: State<'_, AppState>, id: String) -> Result<themes::ThemePayload, String> {
    let cfg: settings::AppConfig = state.config();
    let enabled = enabled_plugins(&cfg);

    let payload = themes::load_theme(id.trim())?;
    if matches!(payload.summary.source, themes::ThemeSource::Plugin) {
        let plugin_id = payload
            .summary
            .plugin_id
            .as_ref()
            .map(|s| s.trim().to_ascii_lowercase())
            .unwrap_or_default();
        if !plugin_id.is_empty() && !enabled.contains(&plugin_id) {
            return Err(format!(
                "theme `{}` belongs to a disabled plugin",
                payload.summary.id
            ));
        }
    }
    Ok(payload)
}
