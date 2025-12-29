use crate::plugins;
use crate::plugin_bundles::{InstalledPlugin, InstalledPluginIndex, PluginBundleStore};
use crate::plugin_runtime::stdio_rpc::{RpcConfig, SpawnConfig, StdioRpcProcess};
use serde_json::Value;
use tauri::Emitter;
use tauri::Manager;
use tauri::{Runtime, Window};

#[tauri::command]
pub fn list_plugins() -> Vec<plugins::PluginSummary> {
    plugins::list_plugins()
}

#[tauri::command]
pub fn load_plugin(id: String) -> Result<plugins::PluginPayload, String> {
    plugins::load_plugin(id.trim())
}

#[tauri::command]
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
pub fn list_installed_bundles() -> Result<Vec<InstalledPluginIndex>, String> {
    PluginBundleStore::new_default().list_installed()
}

#[tauri::command]
pub fn uninstall_plugin(plugin_id: String) -> Result<(), String> {
    PluginBundleStore::new_default().uninstall_plugin(plugin_id.trim())
}

#[tauri::command]
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
pub fn list_plugin_functions(plugin_id: String) -> Result<Value, String> {
    let store = PluginBundleStore::new_default();
    let Some(components) = store.load_current_components(plugin_id.trim())? else {
        return Err("plugin not installed".to_string());
    };
    let Some(functions) = components.functions else {
        return Err("plugin has no functions component".to_string());
    };

    let installed = store
        .get_current_installed(&components.plugin_id)?
        .ok_or_else(|| "plugin is not installed".to_string())?;

    let rpc = StdioRpcProcess::new(
        SpawnConfig {
            plugin_id: components.plugin_id,
            component_label: "functions".into(),
            exec_path: functions.exec_path,
            args: Vec::new(),
            workdir: components.install_dir,
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
pub fn invoke_plugin_function(
    plugin_id: String,
    function_id: String,
    args: Value,
) -> Result<Value, String> {
    let store = PluginBundleStore::new_default();
    let Some(components) = store.load_current_components(plugin_id.trim())? else {
        return Err("plugin not installed".to_string());
    };
    let Some(functions) = components.functions else {
        return Err("plugin has no functions component".to_string());
    };

    let installed = store
        .get_current_installed(&components.plugin_id)?
        .ok_or_else(|| "plugin is not installed".to_string())?;

    let rpc = StdioRpcProcess::new(
        SpawnConfig {
            plugin_id: components.plugin_id,
            component_label: "functions".into(),
            exec_path: functions.exec_path,
            args: Vec::new(),
            workdir: components.install_dir,
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
pub fn call_plugin_method(
    plugin_id: String,
    method: String,
    params: Option<Value>,
) -> Result<Value, String> {
    let store = PluginBundleStore::new_default();
    let Some(components) = store.load_current_components(plugin_id.trim())? else {
        return Err("plugin not installed".to_string());
    };
    let Some(backend) = components.backend else {
        return Err("plugin has no backend component".to_string());
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
            component_label: "backend".into(),
            exec_path: backend.exec_path,
            args: Vec::new(),
            workdir: components.install_dir,
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
