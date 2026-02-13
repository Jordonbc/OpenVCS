use openvcs_core::models::VcsEvent;
use serde_json::Value;
use std::sync::Arc;

/// Runtime instance abstraction used by the plugin runtime manager.
pub trait PluginRuntimeInstance: Send + Sync {
    /// Returns runtime transport kind identifier (`component` or `stdio`).
    fn runtime_kind(&self) -> &'static str;

    /// Ensures the underlying runtime instance is started.
    fn ensure_running(&self) -> Result<(), String>;

    /// Calls a plugin method and returns JSON payload.
    fn call(&self, method: &str, params: Value) -> Result<Value, String>;

    /// Installs an optional event sink for runtime-emitted events.
    fn set_event_sink(&self, _sink: Option<Arc<dyn Fn(VcsEvent) + Send + Sync + 'static>>) {}

    /// Stops the runtime instance.
    fn stop(&self);
}
