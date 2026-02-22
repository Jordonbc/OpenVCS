// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later
use crate::plugin_bundles::{
    ApprovalState, InstalledPlugin, InstalledPluginIndex, PluginBundleStore,
};
use crate::plugin_runtime::instance::PluginRuntimeInstance;
use crate::plugin_runtime::settings_store;
use crate::plugins;
use crate::state::AppState;
use log::{debug, error, info, trace, warn};
use openvcs_core::settings::{SettingKv, SettingValue};
use openvcs_core::ui::{Menu, UiElement};
use serde_json::Value;
use std::sync::Arc;
use tauri::Emitter;
use tauri::Manager;
use tauri::{Runtime, State, Window};

/// JSON-friendly plugin setting entry payload.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct PluginSettingEntry {
    /// Stable setting id.
    pub id: String,
    /// JSON value persisted by the host.
    pub value: Value,
}

/// Choice item for settings rendered as a select input.
#[derive(Debug, Clone, serde::Serialize)]
pub struct PluginSettingOptionPayload {
    /// Persisted value for the option.
    pub value: String,
    /// User-visible option label.
    pub label: String,
}

/// Plugin setting metadata and current value payload.
#[derive(Debug, Clone, serde::Serialize)]
pub struct PluginSettingFieldPayload {
    /// Stable setting id.
    pub id: String,
    /// Setting value kind (`bool`, `s32`, `u32`, `f64`, `text`).
    pub kind: String,
    /// User-visible label.
    pub label: String,
    /// Optional help text.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// Default setting value.
    pub default_value: Value,
    /// Effective current value (persisted override or default).
    pub value: Value,
    /// Optional options for text-select style inputs.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub options: Vec<PluginSettingOptionPayload>,
    /// Origin of this schema (`runtime`).
    pub source: String,
}

/// JSON-friendly plugin menu payload returned to frontend.
#[derive(Debug, Clone, serde::Serialize)]
pub struct PluginMenuPayload {
    /// Owning plugin id.
    pub plugin_id: String,
    /// Menu id.
    pub id: String,
    /// User-visible label.
    pub label: String,
    /// Renderable menu elements.
    pub elements: Vec<Value>,
}

/// Permission metadata returned for a plugin's current installed version.
#[derive(Debug, Clone, serde::Serialize)]
pub struct PluginPermissionsPayload {
    /// Plugin id these permissions belong to.
    pub plugin_id: String,
    /// Current installed version, when available.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    /// Current approval state (`pending`, `approved`, `denied`).
    pub approval_state: String,
    /// Capability ids requested by the plugin.
    #[serde(default)]
    pub requested_capabilities: Vec<String>,
    /// Capability ids currently approved for the plugin.
    #[serde(default)]
    pub approved_capabilities: Vec<String>,
}

#[tauri::command]
/// Lists plugin summaries discovered by the backend.
///
/// # Returns
/// - Plugin summaries for built-in and user plugins.
pub fn list_plugins() -> Vec<plugins::PluginSummary> {
    plugins::list_plugins()
}

#[tauri::command]
/// Lists plugin ids whose most recent runtime startup attempt failed.
///
/// # Parameters
/// - `state`: Application state.
///
/// # Returns
/// - Sorted plugin id list.
pub fn list_plugin_start_failures(state: State<'_, AppState>) -> Vec<String> {
    state.plugin_runtime().failed_plugin_starts()
}

#[tauri::command]
/// Loads details for a specific plugin id.
///
/// # Parameters
/// - `id`: Plugin id to load.
///
/// # Returns
/// - `Ok(PluginPayload)` when found.
/// - `Err(String)` when loading fails.
pub fn load_plugin(id: String) -> Result<plugins::PluginPayload, String> {
    plugins::load_plugin(id.trim())
}

#[tauri::command]
/// Installs an `.ovcsp` plugin bundle.
///
/// # Parameters
/// - `window`: Calling window handle used for capability prompt events.
/// - `bundle_path`: Filesystem path to the bundle.
///
/// # Returns
/// - `Ok(InstalledPlugin)` with install metadata.
/// - `Err(String)` when installation fails.
pub async fn install_ovcsp<R: Runtime>(
    window: Window<R>,
    state: State<'_, AppState>,
    bundle_path: String,
) -> Result<InstalledPlugin, String> {
    let store = PluginBundleStore::new_default();
    let installed = store.install_ovcsp(std::path::Path::new(bundle_path.trim()))?;

    info!(
        "plugin: installed '{}' v{}",
        installed.plugin_id, installed.version
    );

    if !installed.requested_capabilities.is_empty() {
        let _ = window.app_handle().emit(
            "plugins:capabilities-requested",
            serde_json::json!({
                "pluginId": installed.plugin_id,
                "version": installed.version,
                "capabilities": installed.requested_capabilities,
            }),
        );
    }

    if let Err(err) = state.plugin_runtime().sync_plugin_runtime() {
        warn!("plugins: runtime sync after install failed: {}", err);
    }

    Ok(installed)
}

#[tauri::command]
/// Lists installed plugin bundle indices.
///
/// # Returns
/// - `Ok(Vec<InstalledPluginIndex>)` on success.
/// - `Err(String)` when listing fails.
pub fn list_installed_bundles() -> Result<Vec<InstalledPluginIndex>, String> {
    PluginBundleStore::new_default().list_installed()
}

#[tauri::command]
/// Uninstalls a plugin by id.
///
/// # Parameters
/// - `plugin_id`: Plugin id to remove.
///
/// # Returns
/// - `Ok(())` when removal succeeds.
/// - `Err(String)` when validation/removal fails.
pub fn uninstall_plugin(state: State<'_, AppState>, plugin_id: String) -> Result<(), String> {
    let plugin_id = plugin_id.trim().to_string();
    state.plugin_runtime().stop_plugin(&plugin_id)?;
    PluginBundleStore::new_default().uninstall_plugin(&plugin_id)?;
    info!("plugin: uninstalled '{}'", plugin_id);
    Ok(())
}

#[tauri::command]
/// Enables or disables a plugin and persists the override.
///
/// This updates runtime state immediately and writes the corresponding
/// `plugins.enabled`/`plugins.disabled` override in global settings so the
/// toggle remains stable across settings reloads and app restarts.
///
/// # Parameters
/// - `state`: Application state.
/// - `plugin_id`: Plugin id to toggle.
/// - `enabled`: Whether the plugin should be enabled.
///
/// # Returns
/// - `Ok(())` when the operation succeeds.
/// - `Err(String)` when the operation fails.
pub async fn set_plugin_enabled(
    state: State<'_, AppState>,
    plugin_id: String,
    enabled: bool,
) -> Result<(), String> {
    trace!(
        "set_plugin_enabled: entering with plugin_id='{}', enabled={}",
        plugin_id,
        enabled
    );

    let plugin_id = plugin_id.trim().to_string();
    debug!("set_plugin_enabled: trimmed plugin_id='{}'", plugin_id);

    info!(
        "set_plugin_enabled: plugin={}, enabled={}",
        plugin_id, enabled
    );

    let plugin_key = plugin_id.trim().to_ascii_lowercase();

    let runtime = state.plugin_runtime();
    let plugin_id_for_runtime = plugin_id.clone();
    let runtime_result = tauri::async_runtime::spawn_blocking(move || {
        runtime
            .set_plugin_enabled(&plugin_id_for_runtime, enabled)
            .map_err(|e| {
                error!(
                    "set_plugin_enabled failed: plugin={}, error={}",
                    plugin_id_for_runtime, e
                );
                e
            })
    })
    .await
    .map_err(|e| format!("set_plugin_enabled task join failed: {e}"))?;

    if let Err(err) = runtime_result {
        if enabled {
            let mut fallback_cfg = state.config();
            fallback_cfg
                .plugins
                .enabled
                .retain(|id| !id.trim().eq_ignore_ascii_case(&plugin_key));
            fallback_cfg
                .plugins
                .disabled
                .retain(|id| !id.trim().eq_ignore_ascii_case(&plugin_key));
            fallback_cfg.plugins.disabled.push(plugin_key.clone());
            if let Err(persist_error) = state.set_config(fallback_cfg) {
                warn!(
                    "set_plugin_enabled: failed to persist disable fallback for {}: {}",
                    plugin_id, persist_error
                );
            }
            let _ = state.plugin_runtime().stop_plugin(&plugin_id);
        }
        return Err(err);
    }

    let mut cfg = state.config();
    cfg.plugins
        .enabled
        .retain(|id| !id.trim().eq_ignore_ascii_case(&plugin_key));
    cfg.plugins
        .disabled
        .retain(|id| !id.trim().eq_ignore_ascii_case(&plugin_key));

    if enabled {
        cfg.plugins.enabled.push(plugin_key.clone());
    } else {
        cfg.plugins.disabled.push(plugin_key.clone());
    }

    state.set_config(cfg).map_err(|e| {
        error!(
            "set_plugin_enabled: failed to persist plugin override for {}: {}",
            plugin_id, e
        );
        e
    })?;

    Ok(())
}

#[tauri::command]
/// Approves or denies requested capabilities for a plugin version.
///
/// # Parameters
/// - `plugin_id`: Plugin id.
/// - `version`: Installed plugin version.
/// - `approved`: Approval decision.
///
/// # Returns
/// - `Ok(())` when state is updated.
/// - `Err(String)` when update fails.
pub fn approve_plugin_capabilities(
    state: State<'_, AppState>,
    plugin_id: String,
    version: String,
    approved: bool,
) -> Result<(), String> {
    let plugin_id = plugin_id.trim().to_string();
    let version = version.trim();
    PluginBundleStore::new_default().approve_capabilities(&plugin_id, version, approved)?;

    if approved {
        info!(
            "plugin: capabilities approved for '{}' v{}",
            plugin_id, version
        );
    } else {
        info!(
            "plugin: capabilities denied for '{}' v{}",
            plugin_id, version
        );
    }

    if !approved {
        let _ = state.plugin_runtime().stop_plugin(&plugin_id);
    } else if let Err(err) = state.plugin_runtime().sync_plugin_runtime() {
        warn!("plugins: runtime sync after approval failed: {}", err);
    }

    Ok(())
}

#[tauri::command]
/// Returns permission metadata for a plugin's current installed version.
///
/// # Parameters
/// - `plugin_id`: Plugin id.
///
/// # Returns
/// - `Ok(PluginPermissionsPayload)` on success.
/// - `Err(String)` when lookup fails.
pub fn get_plugin_permissions(plugin_id: String) -> Result<PluginPermissionsPayload, String> {
    let plugin_id = plugin_id.trim().to_string();
    if plugin_id.is_empty() {
        return Err("plugin id is empty".to_string());
    }

    let Some(current) = PluginBundleStore::new_default().get_current_installed(&plugin_id)? else {
        return Ok(PluginPermissionsPayload {
            plugin_id,
            version: None,
            approval_state: "pending".to_string(),
            requested_capabilities: Vec::new(),
            approved_capabilities: Vec::new(),
        });
    };

    let (approval_state, approved_capabilities) = match current.approval {
        ApprovalState::Pending => ("pending".to_string(), Vec::new()),
        ApprovalState::Denied { .. } => ("denied".to_string(), Vec::new()),
        ApprovalState::Approved { capabilities, .. } => ("approved".to_string(), capabilities),
    };

    Ok(PluginPermissionsPayload {
        plugin_id,
        version: Some(current.version),
        approval_state,
        requested_capabilities: current.requested_capabilities,
        approved_capabilities,
    })
}

#[tauri::command]
/// Applies a selected approved-capabilities set for the current plugin version.
///
/// # Parameters
/// - `state`: Application state.
/// - `plugin_id`: Plugin id.
/// - `approved_capabilities`: Selected capability ids to approve.
///
/// # Returns
/// - `Ok(())` when permissions are saved.
/// - `Err(String)` when update fails.
pub fn set_plugin_permissions(
    state: State<'_, AppState>,
    plugin_id: String,
    approved_capabilities: Vec<String>,
) -> Result<(), String> {
    let plugin_id = plugin_id.trim().to_string();
    if plugin_id.is_empty() {
        return Err("plugin id is empty".to_string());
    }

    PluginBundleStore::new_default()
        .set_current_approved_capabilities(&plugin_id, approved_capabilities)?;

    if let Err(err) = state.plugin_runtime().stop_plugin(&plugin_id) {
        warn!(
            "plugins: stop runtime after permissions update failed for {}: {}",
            plugin_id, err
        );
    }
    if let Err(err) = state.plugin_runtime().sync_plugin_runtime() {
        warn!(
            "plugins: runtime sync after permissions update failed for {}: {}",
            plugin_id, err
        );
    }

    Ok(())
}

/// Returns plugin-contributed menus for enabled plugins.
///
/// # Parameters
/// - `state`: Application state.
///
/// # Returns
/// - `Ok(Vec<PluginMenuPayload>)` sorted by plugin/menu label.
/// - `Err(String)` when runtime access fails.
#[tauri::command]
pub fn list_plugin_menus(state: State<'_, AppState>) -> Result<Vec<PluginMenuPayload>, String> {
    let cfg = state.config();
    let mut collected: Vec<(String, Menu)> = Vec::new();

    for summary in plugins::list_plugins() {
        let plugin_id = summary.id.trim().to_string();
        if plugin_id.is_empty() {
            continue;
        }
        if !cfg.is_plugin_enabled(&plugin_id, summary.default_enabled) {
            continue;
        }
        match state.plugin_runtime().has_module(&plugin_id) {
            Ok(Some(true)) => {}
            Ok(Some(false)) | Ok(None) => continue,
            Err(err) => {
                warn!("list_plugin_menus: skip plugin {}: {}", plugin_id, err);
                continue;
            }
        }

        let runtime = match state
            .plugin_runtime()
            .running_runtime_for_plugin(&plugin_id)
        {
            Ok(Some(runtime)) => runtime,
            Ok(None) => {
                debug!(
                    "list_plugin_menus: skip plugin {} because runtime is not running",
                    plugin_id
                );
                continue;
            }
            Err(err) => {
                warn!("list_plugin_menus: skip plugin {}: {}", plugin_id, err);
                continue;
            }
        };

        let menus = match runtime.get_menus() {
            Ok(menus) => menus,
            Err(err) => {
                warn!(
                    "list_plugin_menus: plugin {} menu error: {}",
                    plugin_id, err
                );
                continue;
            }
        };

        for menu in menus {
            collected.push((plugin_id.clone(), menu));
        }
    }

    collected.sort_by(|a, b| {
        let a_order = a.1.order;
        let b_order = b.1.order;

        a_order
            .is_none()
            .cmp(&b_order.is_none())
            .then_with(|| {
                a_order
                    .unwrap_or(u32::MAX)
                    .cmp(&b_order.unwrap_or(u32::MAX))
            })
            .then_with(|| {
                a.1.label
                    .to_ascii_lowercase()
                    .cmp(&b.1.label.to_ascii_lowercase())
            })
            .then_with(|| a.0.cmp(&b.0))
            .then_with(|| a.1.id.cmp(&b.1.id))
    });

    let out = collected
        .into_iter()
        .map(|(plugin_id, menu)| menu_to_payload(&plugin_id, menu))
        .collect::<Vec<_>>();

    Ok(out)
}

/// Converts a plugin menu model to frontend payload.
fn menu_to_payload(plugin_id: &str, menu: Menu) -> PluginMenuPayload {
    let elements = menu
        .elements
        .into_iter()
        .map(|element| match element {
            UiElement::Text(text) => serde_json::json!({
                "type": "text",
                "id": text.id,
                "content": text.content,
            }),
            UiElement::Button(button) => serde_json::json!({
                "type": "button",
                "id": button.id,
                "label": button.label,
            }),
        })
        .collect::<Vec<_>>();

    PluginMenuPayload {
        plugin_id: plugin_id.to_string(),
        id: menu.id,
        label: menu.label,
        elements,
    }
}

/// Invokes a plugin-provided action by id.
///
/// # Parameters
/// - `state`: Application state.
/// - `plugin_id`: Plugin id.
/// - `action_id`: Action id from `get-menus`.
///
/// # Returns
/// - `Ok(())` when action succeeds.
/// - `Err(String)` when runtime/action invocation fails.
#[tauri::command]
pub fn invoke_plugin_action(
    state: State<'_, AppState>,
    plugin_id: String,
    action_id: String,
) -> Result<(), String> {
    let cfg = state.config();
    let runtime =
        state
            .plugin_runtime()
            .runtime_for_workspace_with_config(&cfg, plugin_id.trim(), None)?;
    runtime.handle_action(action_id.trim())
}

/// Returns plugin settings schema with effective values.
///
/// # Parameters
/// - `state`: Application state.
/// - `plugin_id`: Plugin id.
///
/// # Returns
/// - `Ok(Vec<PluginSettingFieldPayload>)` schema and values.
/// - `Err(String)` when plugin/settings resolution fails.
#[tauri::command]
pub fn get_plugin_settings(
    state: State<'_, AppState>,
    plugin_id: String,
) -> Result<Vec<PluginSettingFieldPayload>, String> {
    let plugin_id = plugin_id.trim().to_string();
    if plugin_id.is_empty() {
        return Err("plugin id is empty".to_string());
    }

    let cfg = state.config();
    let (defaults, _runtime) = resolve_plugin_settings_defaults(&state, &cfg, &plugin_id)?;
    let persisted = settings_store::load_settings(&plugin_id)?;

    Ok(defaults
        .into_iter()
        .map(|default| {
            let id = default.id.trim().to_string();
            let effective_value = persisted
                .get(&id)
                .and_then(|raw| setting_from_json(&id, raw, &default.value).ok())
                .unwrap_or_else(|| default.value.clone());

            PluginSettingFieldPayload {
                id,
                kind: setting_kind_name(&default.value).to_string(),
                label: default.id,
                description: None,
                default_value: setting_value_to_json(&default.value),
                value: setting_value_to_json(&effective_value),
                options: Vec::new(),
                source: "runtime".to_string(),
            }
        })
        .collect::<Vec<_>>())
}

/// Saves plugin settings and applies them immediately.
///
/// # Parameters
/// - `state`: Application state.
/// - `plugin_id`: Plugin id.
/// - `values`: Setting entries from frontend.
///
/// # Returns
/// - `Ok(())` when save + apply succeeds.
/// - `Err(String)` when validation or runtime calls fail.
#[tauri::command]
pub fn save_plugin_settings(
    state: State<'_, AppState>,
    plugin_id: String,
    values: Vec<PluginSettingEntry>,
) -> Result<(), String> {
    let plugin_id = plugin_id.trim().to_string();
    if plugin_id.is_empty() {
        return Err("plugin id is empty".to_string());
    }

    let cfg = state.config();
    let (defaults, runtime) = resolve_plugin_settings_defaults(&state, &cfg, &plugin_id)?;
    if defaults.is_empty() {
        return Err(format!("plugin `{plugin_id}` does not declare settings"));
    }
    let incoming = merge_settings_with_defaults(defaults, values)?;

    let normalized = if let Some(runtime) = runtime.as_ref() {
        runtime.settings_on_save(incoming)?
    } else {
        incoming
    };

    settings_store::save_settings(&plugin_id, &settings_to_json_map(&normalized))?;

    if let Some(runtime) = runtime {
        runtime.settings_on_apply(normalized)?;
    }
    Ok(())
}

/// Resets plugin settings to defaults and applies them immediately.
///
/// # Parameters
/// - `state`: Application state.
/// - `plugin_id`: Plugin id.
///
/// # Returns
/// - `Ok(())` when reset + apply succeeds.
/// - `Err(String)` when runtime calls fail.
#[tauri::command]
pub fn reset_plugin_settings(state: State<'_, AppState>, plugin_id: String) -> Result<(), String> {
    let plugin_id = plugin_id.trim().to_string();
    if plugin_id.is_empty() {
        return Err("plugin id is empty".to_string());
    }

    let cfg = state.config();
    let (_defaults, runtime) = resolve_plugin_settings_defaults(&state, &cfg, &plugin_id)?;

    if let Some(runtime) = runtime.as_ref() {
        runtime.settings_on_reset()?;
    }

    settings_store::reset_settings(&plugin_id)?;

    if let Some(runtime) = runtime {
        let defaults = runtime.settings_defaults()?;
        runtime.settings_on_apply(defaults)?;
    }

    Ok(())
}

/// Resolves plugin settings defaults from runtime hooks.
fn resolve_plugin_settings_defaults(
    state: &AppState,
    cfg: &crate::settings::AppConfig,
    plugin_id: &str,
) -> Result<(Vec<SettingKv>, Option<Arc<dyn PluginRuntimeInstance>>), String> {
    let mut runtime = state
        .plugin_runtime()
        .runtime_for_workspace_with_config(cfg, plugin_id, None)
        .ok();

    if runtime.is_none() {
        let _ = state.plugin_runtime().start_plugin(plugin_id);
        runtime = state
            .plugin_runtime()
            .runtime_for_workspace_with_config(cfg, plugin_id, None)
            .ok();
    }

    if let Some(runtime_ref) = runtime.as_ref() {
        let runtime_defaults = runtime_ref.settings_defaults()?;
        if !runtime_defaults.is_empty() {
            return Ok((runtime_defaults, runtime));
        }
    }

    Ok((Vec::new(), runtime))
}

/// Returns a stable string kind name for a typed setting.
fn setting_kind_name(value: &SettingValue) -> &'static str {
    match value {
        SettingValue::Bool(_) => "bool",
        SettingValue::S32(_) => "s32",
        SettingValue::U32(_) => "u32",
        SettingValue::F64(_) => "f64",
        SettingValue::String(_) => "text",
    }
}

/// Merges incoming frontend values into typed defaults.
fn merge_settings_with_defaults(
    mut defaults: Vec<SettingKv>,
    incoming: Vec<PluginSettingEntry>,
) -> Result<Vec<SettingKv>, String> {
    let mut map: std::collections::HashMap<String, Value> = std::collections::HashMap::new();
    for item in incoming {
        map.insert(item.id.trim().to_string(), item.value);
    }

    for entry in &mut defaults {
        if let Some(value) = map.get(&entry.id) {
            entry.value = setting_from_json(&entry.id, value, &entry.value)?;
        }
    }
    Ok(defaults)
}

/// Converts JSON value into expected typed setting variant.
fn setting_from_json(
    id: &str,
    value: &Value,
    expected: &SettingValue,
) -> Result<SettingValue, String> {
    match expected {
        SettingValue::Bool(_) => value
            .as_bool()
            .map(SettingValue::Bool)
            .ok_or_else(|| format!("setting `{id}` expects bool")),
        SettingValue::S32(_) => value
            .as_i64()
            .and_then(|v| i32::try_from(v).ok())
            .map(SettingValue::S32)
            .ok_or_else(|| format!("setting `{id}` expects s32")),
        SettingValue::U32(_) => value
            .as_u64()
            .and_then(|v| u32::try_from(v).ok())
            .map(SettingValue::U32)
            .ok_or_else(|| format!("setting `{id}` expects u32")),
        SettingValue::F64(_) => value
            .as_f64()
            .map(SettingValue::F64)
            .ok_or_else(|| format!("setting `{id}` expects f64")),
        SettingValue::String(_) => value
            .as_str()
            .map(|v| SettingValue::String(v.to_string()))
            .ok_or_else(|| format!("setting `{id}` expects string")),
    }
}

/// Converts typed settings to JSON object map.
fn settings_to_json_map(values: &[SettingKv]) -> serde_json::Map<String, Value> {
    let mut out = serde_json::Map::new();
    for entry in values {
        out.insert(entry.id.clone(), setting_value_to_json(&entry.value));
    }
    out
}

/// Converts one typed setting variant to JSON.
fn setting_value_to_json(value: &SettingValue) -> Value {
    match value {
        SettingValue::Bool(v) => Value::Bool(*v),
        SettingValue::S32(v) => Value::from(*v),
        SettingValue::U32(v) => Value::from(*v),
        SettingValue::F64(v) => Value::from(*v),
        SettingValue::String(v) => Value::String(v.clone()),
    }
}
