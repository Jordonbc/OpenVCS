// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later
use crate::{plugins, settings, state::AppState, themes};
use std::collections::HashSet;
use tauri::State;

/// Normalizes an optional plugin id into the lowercase identifier used by theme filtering.
fn normalize_plugin_id(plugin_id: Option<&str>) -> String {
    plugin_id
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| value.to_ascii_lowercase())
        .unwrap_or_default()
}

/// Returns whether a theme should be visible for the current enabled-plugin set.
fn theme_allowed_for_enabled_plugins(
    source: &themes::ThemeSource,
    plugin_id: Option<&str>,
    enabled_plugins: &HashSet<String>,
) -> bool {
    if !matches!(source, themes::ThemeSource::Plugin) {
        return true;
    }

    let plugin_id = normalize_plugin_id(plugin_id);
    !plugin_id.is_empty() && enabled_plugins.contains(&plugin_id)
}

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
        .filter(|theme| {
            theme_allowed_for_enabled_plugins(&theme.source, theme.plugin_id.as_deref(), &enabled)
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
    if !theme_allowed_for_enabled_plugins(
        &payload.summary.source,
        payload.summary.plugin_id.as_deref(),
        &enabled,
    ) {
        let plugin_id = normalize_plugin_id(payload.summary.plugin_id.as_deref());
        if !plugin_id.is_empty() {
            return Err(format!(
                "theme `{}` belongs to a disabled plugin",
                payload.summary.id
            ));
        }
    }
    Ok(payload)
}

#[cfg(test)]
mod tests {
    include!("../../tests/tauri_commands/themes.rs");
}
