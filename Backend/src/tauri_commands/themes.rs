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

/// Resolves a requested theme id against an explicit theme list.
///
/// # Parameters
/// - `theme_id`: Requested theme id.
/// - `mode`: Requested appearance mode (`light` or `dark`).
/// - `themes`: Available theme summaries to search.
///
/// # Returns
/// - Resolved theme id when a pairing exists.
/// - The original id when no pairing is needed or no match exists.
fn resolve_theme_target_from_themes(
    theme_id: &str,
    mode: &str,
    themes: &[themes::ThemeSummary],
) -> String {
    let requested = theme_id.trim();
    if requested.is_empty() {
        return requested.to_string();
    }

    let target_mode = mode.trim().to_ascii_lowercase();
    if target_mode != "light" && target_mode != "dark" {
        return requested.to_string();
    }

    let current = themes
        .iter()
        .find(|theme| theme.id.eq_ignore_ascii_case(requested));
    let Some(summary) = current else {
        return requested.to_string();
    };

    let appearance = summary
        .appearance
        .as_deref()
        .map(str::trim)
        .map(str::to_ascii_lowercase);
    match appearance.as_deref() {
        Some("light") | Some("dark") => {}
        Some("both") => return requested.to_string(),
        _ => return requested.to_string(),
    }

    if appearance.as_deref() == Some(target_mode.as_str()) {
        return requested.to_string();
    }

    let paired = summary
        .paired_with
        .as_deref()
        .map(str::trim)
        .unwrap_or_default();
    if !paired.is_empty() && !paired.eq_ignore_ascii_case(requested) {
        return paired.to_string();
    }

    let lowered = requested.to_ascii_lowercase();
    let candidates = [
        lowered
            .strip_suffix("-dark")
            .map(|base| format!("{}-light", base)),
        lowered
            .strip_suffix("-light")
            .map(|base| format!("{}-dark", base)),
        lowered
            .strip_suffix("_dark")
            .map(|base| format!("{}_light", base)),
        lowered
            .strip_suffix("_light")
            .map(|base| format!("{}_dark", base)),
    ];

    for candidate in candidates.into_iter().flatten() {
        if themes
            .iter()
            .any(|theme| theme.id.eq_ignore_ascii_case(&candidate))
        {
            return candidate;
        }
    }

    requested.to_string()
}

/// Returns themes that should be visible for the current enabled-plugin set.
fn enabled_plugin_themes(cfg: &settings::AppConfig) -> Vec<themes::ThemeSummary> {
    let enabled = enabled_plugins(cfg);
    themes::list_themes()
        .into_iter()
        .filter(|theme| {
            theme_allowed_for_enabled_plugins(&theme.source, theme.plugin_id.as_deref(), &enabled)
        })
        .collect()
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
    enabled_plugin_themes(&cfg)
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
        return Err(format!(
            "theme `{}` belongs to a disabled plugin",
            payload.summary.id
        ));
    }
    Ok(payload)
}

#[tauri::command]
/// Resolves a requested theme id to the theme that should actually load for an appearance mode.
///
/// # Parameters
/// - `id`: Requested theme id.
/// - `mode`: Requested appearance mode (`light` or `dark`).
///
/// # Returns
/// - Resolved theme id string.
pub fn resolve_theme_target(state: State<'_, AppState>, id: String, mode: String) -> String {
    let cfg: settings::AppConfig = state.config();
    let filtered = enabled_plugin_themes(&cfg);
    resolve_theme_target_from_themes(id.trim(), mode.trim(), &filtered)
}

#[cfg(test)]
mod tests {
    include!("../../tests/tauri_commands/themes.rs");
}
