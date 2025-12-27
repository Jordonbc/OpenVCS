use crate::plugins;

#[tauri::command]
pub fn list_plugins() -> Vec<plugins::PluginSummary> {
    plugins::list_plugins()
}

#[tauri::command]
pub fn load_plugin(id: String) -> Result<plugins::PluginPayload, String> {
    plugins::load_plugin(id.trim())
}
