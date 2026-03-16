// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later
//! Plugin runtime selection helpers.
//!
//! OpenVCS now runs plugin modules as long-lived Node.js scripts.

use crate::plugin_runtime::instance::PluginRuntimeInstance;
use crate::plugin_runtime::node_instance::NodePluginRuntimeInstance;
use crate::plugin_runtime::spawn::SpawnConfig;
use log::{debug, trace};
use std::path::Path;
use std::sync::Arc;

/// Returns whether a module path is a supported Node.js entry file.
pub fn is_node_module(path: &Path) -> bool {
    trace!("is_node_module: path='{}'", path.display());

    if !path.is_file() {
        debug!("is_node_module: path is not a file");
        return false;
    }
    let ext = path
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.trim().to_ascii_lowercase())
        .unwrap_or_default();
    matches!(ext.as_str(), "js" | "mjs" | "cjs")
}

/// Selects and creates a runtime instance for a plugin module.
pub fn create_runtime_instance(
    spawn: SpawnConfig,
) -> Result<Arc<dyn PluginRuntimeInstance>, String> {
    trace!(
        "create_runtime_instance: plugin_id='{}', exec_path='{}'",
        spawn.plugin_id,
        spawn.exec_path.display()
    );

    if !is_node_module(&spawn.exec_path) {
        return Err(format!(
            "plugin runtime: '{}' must be a .js/.mjs/.cjs Node entrypoint",
            spawn.exec_path.display()
        ));
    }

    let runtime: Arc<dyn PluginRuntimeInstance> = create_node_runtime_instance(spawn)?;
    Ok(runtime)
}

/// Creates a concrete runtime instance used by VCS proxy adapters.
pub fn create_node_runtime_instance(
    spawn: SpawnConfig,
) -> Result<Arc<NodePluginRuntimeInstance>, String> {
    if !is_node_module(&spawn.exec_path) {
        return Err(format!(
            "plugin runtime: '{}' must be a .js/.mjs/.cjs Node entrypoint",
            spawn.exec_path.display()
        ));
    }
    Ok(Arc::new(NodePluginRuntimeInstance::new(spawn)))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    #[test]
    /// Verifies non-script files are rejected by node runtime detection.
    fn non_script_path_is_not_detected_as_node_module() {
        let temp = tempdir().expect("tempdir");
        let file_path = temp.path().join("plugin.bin");
        fs::write(&file_path, b"binary").expect("write file");

        assert!(!is_node_module(&file_path));
    }

    #[test]
    /// Verifies `.mjs` files are accepted as runtime modules.
    fn mjs_path_is_detected_as_node_module() {
        let temp = tempdir().expect("tempdir");
        let script_path = temp.path().join("plugin.mjs");
        fs::write(&script_path, b"export {}\n").expect("write script");

        assert!(is_node_module(&script_path));
    }
}
