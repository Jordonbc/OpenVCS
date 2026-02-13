use crate::plugin_runtime::instance::PluginRuntimeInstance;
use crate::plugin_runtime::stdio_rpc::{RpcConfig, SpawnConfig, StdioRpcProcess};
use serde_json::Value;

/// Stdio-backed runtime instance implementation.
///
/// Deprecated: this exists as a migration fallback while component runtime
/// support is being rolled out.
pub struct StdioPluginRuntimeInstance {
    rpc: StdioRpcProcess,
}

impl StdioPluginRuntimeInstance {
    /// Creates a new stdio-backed runtime instance.
    pub fn new(spawn: SpawnConfig) -> Self {
        Self {
            rpc: StdioRpcProcess::new(spawn, RpcConfig::default()),
        }
    }
}

impl PluginRuntimeInstance for StdioPluginRuntimeInstance {
    fn ensure_running(&self) -> Result<(), String> {
        self.rpc.ensure_running()
    }

    fn call(&self, method: &str, params: Value) -> Result<Value, String> {
        self.rpc
            .call(method, params)
            .map_err(|e| format!("{}: {}", e.code, e.message))
    }

    fn stop(&self) {
        self.rpc.stop();
    }
}
