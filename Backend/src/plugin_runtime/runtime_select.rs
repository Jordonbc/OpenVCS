// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later
use crate::plugin_runtime::component_instance::ComponentPluginRuntimeInstance;
use crate::plugin_runtime::instance::PluginRuntimeInstance;
use crate::plugin_runtime::spawn::SpawnConfig;
use std::path::Path;
use std::sync::Arc;
use wasmtime::component::Component;
use wasmtime::Engine;

/// Returns whether a module path is a valid component-model artifact.
pub fn is_component_module(path: &Path) -> bool {
    if !path.is_file() {
        return false;
    }

    let engine = Engine::default();
    Component::from_file(&engine, path).is_ok()
}

/// Selects and creates a runtime instance for a plugin module.
pub fn create_runtime_instance(
    spawn: SpawnConfig,
) -> Result<Arc<dyn PluginRuntimeInstance>, String> {
    if !is_component_module(&spawn.exec_path) {
        return Err(format!(
            "plugin runtime: `{}` is not a component-model plugin (stdio runtime removed)",
            spawn.exec_path.display()
        ));
    }

    let runtime: Arc<dyn PluginRuntimeInstance> =
        Arc::new(ComponentPluginRuntimeInstance::new(spawn.clone()));
    log::info!(
        "plugin runtime: selected `component` transport for plugin `{}` ({})",
        spawn.plugin_id,
        spawn.exec_path.display()
    );
    Ok(runtime)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::plugin_bundles::ApprovalState;
    use std::fs;
    use tempfile::tempdir;

    const MINIMAL_WASM: &[u8] = &[
        0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, 0x01, 0x04, 0x01, 0x60, 0x00, 0x00, 0x03,
        0x02, 0x01, 0x00, 0x07, 0x0b, 0x01, 0x06, 0x5f, 0x73, 0x74, 0x61, 0x72, 0x74, 0x00, 0x00,
        0x0a, 0x04, 0x01, 0x02, 0x00, 0x0b,
    ];

    #[test]
    fn core_wasm_is_not_detected_as_component() {
        let temp = tempdir().expect("tempdir");
        let wasm_path = temp.path().join("plugin.wasm");
        fs::write(&wasm_path, MINIMAL_WASM).expect("write wasm");

        assert!(!is_component_module(&wasm_path));
    }

    #[test]
    fn selection_rejects_core_wasm() {
        let temp = tempdir().expect("tempdir");
        let wasm_path = temp.path().join("plugin.wasm");
        fs::write(&wasm_path, MINIMAL_WASM).expect("write wasm");

        let err = match create_runtime_instance(SpawnConfig {
            plugin_id: "test.plugin".to_string(),
            exec_path: wasm_path,
            approval: ApprovalState::Approved {
                capabilities: Vec::new(),
                approved_at_unix_ms: 0,
            },
            allowed_workspace_root: None,
        }) {
            Ok(_) => panic!("expected non-component runtime rejection"),
            Err(err) => err,
        };
        assert!(err.contains("stdio runtime removed"));
    }
}
