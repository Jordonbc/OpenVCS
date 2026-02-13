use crate::plugin_runtime::instance::PluginRuntimeInstance;
use serde_json::Value;
use std::path::PathBuf;

/// Component-model runtime instance placeholder.
///
/// This is intentionally minimal in the current migration slice: runtime
/// detection and selection are wired, and component execution support is the
/// next implementation step.
pub struct ComponentPluginRuntimeInstance {
    plugin_id: String,
    exec_path: PathBuf,
}

impl ComponentPluginRuntimeInstance {
    /// Creates a new component runtime instance placeholder.
    pub fn new(plugin_id: String, exec_path: PathBuf) -> Self {
        Self {
            plugin_id,
            exec_path,
        }
    }
}

impl PluginRuntimeInstance for ComponentPluginRuntimeInstance {
    fn ensure_running(&self) -> Result<(), String> {
        Err(format!(
            "component runtime not implemented yet for plugin `{}` ({})",
            self.plugin_id,
            self.exec_path.display()
        ))
    }

    fn call(&self, _method: &str, _params: Value) -> Result<Value, String> {
        Err(format!(
            "component runtime not implemented yet for plugin `{}`",
            self.plugin_id
        ))
    }

    fn stop(&self) {}
}
