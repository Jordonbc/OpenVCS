use crate::plugin_bundles::{InstalledPlugin, InstalledPluginIndex, PluginBundleStore};
use crate::plugin_runtime::stdio_rpc::{RpcConfig, SpawnConfig, StdioRpcProcess};
use crate::plugins;
use serde_json::Value;
use tauri::Emitter;
use tauri::Manager;
use tauri::{Runtime, Window};

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
    bundle_path: String,
) -> Result<InstalledPlugin, String> {
    let store = PluginBundleStore::new_default();
    let installed = store.install_ovcsp(std::path::Path::new(bundle_path.trim()))?;

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
pub fn uninstall_plugin(plugin_id: String) -> Result<(), String> {
    PluginBundleStore::new_default().uninstall_plugin(plugin_id.trim())
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
    plugin_id: String,
    version: String,
    approved: bool,
) -> Result<(), String> {
    PluginBundleStore::new_default().approve_capabilities(
        plugin_id.trim(),
        version.trim(),
        approved,
    )
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
pub fn list_plugin_functions(plugin_id: String) -> Result<Value, String> {
    let store = PluginBundleStore::new_default();
    let Some(components) = store.load_current_components(plugin_id.trim())? else {
        return Err("plugin not installed".to_string());
    };
    let Some(module) = components.module else {
        return Err("plugin has no module component".to_string());
    };

    let installed = store
        .get_current_installed(&components.plugin_id)?
        .ok_or_else(|| "plugin is not installed".to_string())?;

    let rpc = StdioRpcProcess::new(
        SpawnConfig {
            plugin_id: components.plugin_id,
            component_label: "module".into(),
            exec_path: module.exec_path,
            args: Vec::new(),
            requested_capabilities: installed.requested_capabilities,
            approval: installed.approval,
            allowed_workspace_root: None,
        },
        RpcConfig::default(),
    );

    let v = rpc
        .call("functions.list", Value::Null)
        .map_err(|e| format!("{}: {}", e.code, e.message))?;
    Ok(v)
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
    plugin_id: String,
    function_id: String,
    args: Value,
) -> Result<Value, String> {
    let store = PluginBundleStore::new_default();
    let Some(components) = store.load_current_components(plugin_id.trim())? else {
        return Err("plugin not installed".to_string());
    };
    let Some(module) = components.module else {
        return Err("plugin has no module component".to_string());
    };

    let installed = store
        .get_current_installed(&components.plugin_id)?
        .ok_or_else(|| "plugin is not installed".to_string())?;

    let rpc = StdioRpcProcess::new(
        SpawnConfig {
            plugin_id: components.plugin_id,
            component_label: "module".into(),
            exec_path: module.exec_path,
            args: Vec::new(),
            requested_capabilities: installed.requested_capabilities,
            approval: installed.approval,
            allowed_workspace_root: None,
        },
        RpcConfig::default(),
    );

    let v = rpc
        .call(
            "functions.invoke",
            serde_json::json!({ "id": function_id.trim(), "args": args }),
        )
        .map_err(|e| format!("{}: {}", e.code, e.message))?;
    Ok(v)
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
    plugin_id: String,
    method: String,
    params: Option<Value>,
) -> Result<Value, String> {
    let store = PluginBundleStore::new_default();
    let Some(components) = store.load_current_components(plugin_id.trim())? else {
        return Err("plugin not installed".to_string());
    };
    let Some(module) = components.module else {
        return Err("plugin has no module component".to_string());
    };

    let installed = store
        .get_current_installed(&components.plugin_id)?
        .ok_or_else(|| "plugin is not installed".to_string())?;

    let method = method.trim();
    if method.is_empty() {
        return Err("method is empty".to_string());
    }

    let rpc = StdioRpcProcess::new(
        SpawnConfig {
            plugin_id: components.plugin_id,
            component_label: "module".into(),
            exec_path: module.exec_path,
            args: Vec::new(),
            requested_capabilities: installed.requested_capabilities,
            approval: installed.approval,
            allowed_workspace_root: None,
        },
        RpcConfig::default(),
    );

    let params = params.unwrap_or(Value::Null);
    let v = rpc
        .call(method, params)
        .map_err(|e| format!("{}: {}", e.code, e.message))?;
    Ok(v)
}
