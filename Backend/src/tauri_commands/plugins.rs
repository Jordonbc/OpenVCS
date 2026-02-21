// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later
use crate::plugin_bundles::{InstalledPlugin, InstalledPluginIndex, PluginBundleStore};
use crate::plugin_runtime::settings_store;
use crate::plugins;
use crate::state::AppState;
use log::{debug, error, info, trace, warn};
use openvcs_core::settings::{SettingKv, SettingValue};
use openvcs_core::ui::{Menu, UiElement};
use serde_json::Value;
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

#[tauri::command]
/// Lists plugin summaries discovered by the backend.
///
/// # Returns
/// - Plugin summaries for built-in and user plugins.
pub fn list_plugins() -> Vec<plugins::PluginSummary> {
    plugins::list_plugins()
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
pub fn set_plugin_enabled(
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

    state
        .plugin_runtime()
        .set_plugin_enabled(&plugin_id, enabled)
        .map_err(|e| {
            error!(
                "set_plugin_enabled failed: plugin={}, error={}",
                plugin_id, e
            );
            e
        })?;

    let mut cfg = state.config();
    let plugin_key = plugin_id.trim().to_ascii_lowercase();
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
/// Lists callable functions exported by a plugin module component.
///
/// # Parameters
/// - `plugin_id`: Plugin id to inspect.
///
/// # Returns
/// - `Ok(Value)` containing function descriptors.
/// - `Err(String)` when plugin lookup or RPC fails.
pub fn list_plugin_functions(
    state: State<'_, AppState>,
    plugin_id: String,
) -> Result<Value, String> {
    let cfg = state.config();
    state.plugin_runtime().call_module_method_with_config(
        &cfg,
        plugin_id.trim(),
        "functions.list",
        Value::Null,
    )
}

#[tauri::command]
/// Invokes a plugin function by id.
///
/// # Parameters
/// - `plugin_id`: Plugin id to invoke.
/// - `function_id`: Function id exported by the plugin.
/// - `args`: JSON argument payload.
///
/// # Returns
/// - `Ok(Value)` function result payload.
/// - `Err(String)` when invocation fails.
pub fn invoke_plugin_function(
    state: State<'_, AppState>,
    plugin_id: String,
    function_id: String,
    args: Value,
) -> Result<Value, String> {
    let cfg = state.config();
    state.plugin_runtime().call_module_method_with_config(
        &cfg,
        plugin_id.trim(),
        "functions.invoke",
        serde_json::json!({ "id": function_id.trim(), "args": args }),
    )
}

#[tauri::command]
/// Calls an arbitrary method on a plugin module component.
///
/// # Parameters
/// - `plugin_id`: Plugin id to invoke.
/// - `method`: Module RPC method name.
/// - `params`: Optional JSON params payload.
///
/// # Returns
/// - `Ok(Value)` method result payload.
/// - `Err(String)` when lookup/validation/RPC fails.
pub fn call_plugin_module_method(
    state: State<'_, AppState>,
    plugin_id: String,
    method: String,
    params: Option<Value>,
) -> Result<Value, String> {
    let method = method.trim();
    if method.is_empty() {
        return Err("method is empty".to_string());
    }

    let cfg = state.config();
    let params = params.unwrap_or(Value::Null);
    state
        .plugin_runtime()
        .call_module_method_with_config(&cfg, plugin_id.trim(), method, params)
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
    let mut out: Vec<PluginMenuPayload> = Vec::new();

    for summary in plugins::list_plugins() {
        let plugin_id = summary.id.trim().to_string();
        if plugin_id.is_empty() {
            continue;
        }
        if !cfg.is_plugin_enabled(&plugin_id, summary.default_enabled) {
            continue;
        }

        let runtime = match state
            .plugin_runtime()
            .runtime_for_workspace_with_config(&cfg, &plugin_id, None)
        {
            Ok(runtime) => runtime,
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
            out.push(menu_to_payload(&plugin_id, menu));
        }
    }

    out.sort_by(|a, b| {
        a.label
            .to_ascii_lowercase()
            .cmp(&b.label.to_ascii_lowercase())
            .then_with(|| a.plugin_id.cmp(&b.plugin_id))
    });

    Ok(out)
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
    let runtime = state
        .plugin_runtime()
        .runtime_for_workspace_with_config(&cfg, &plugin_id, None)?;
    let defaults = runtime.settings_defaults()?;
    let incoming = merge_settings_with_defaults(defaults, values)?;
    let normalized = runtime.settings_on_save(incoming)?;
    settings_store::save_settings(&plugin_id, &settings_to_json_map(&normalized))?;
    runtime.settings_on_apply(normalized)
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
    let runtime = state
        .plugin_runtime()
        .runtime_for_workspace_with_config(&cfg, &plugin_id, None)?;
    runtime.settings_on_reset()?;
    settings_store::reset_settings(&plugin_id)?;
    let defaults = runtime.settings_defaults()?;
    runtime.settings_on_apply(defaults)
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
