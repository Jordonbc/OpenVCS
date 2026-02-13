use serde_json::Value;

/// Runtime instance abstraction used by the plugin runtime manager.
pub trait PluginRuntimeInstance: Send + Sync {
    /// Ensures the underlying runtime instance is started.
    fn ensure_running(&self) -> Result<(), String>;

    /// Calls a plugin method and returns JSON payload.
    fn call(&self, method: &str, params: Value) -> Result<Value, String>;

    /// Stops the runtime instance.
    fn stop(&self);
}
