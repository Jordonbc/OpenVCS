// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later
use crate::plugin_bundles::{InstalledPlugin, InstalledPluginIndex, PluginBundleStore};
use crate::plugins;
use crate::state::AppState;
use log::{debug, error, info, trace, warn};
use serde_json::Value;
use tauri::Emitter;
use tauri::Manager;
use tauri::{Runtime, State, Window};

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
