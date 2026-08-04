// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later
//! Plugin runtime selection helpers.
//!
//! OpenVCS now runs plugin modules as long-lived Node.js scripts.

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

/// Ensures a module path is a supported Node.js entry file.
///
/// # Parameters
/// - `path`: Candidate entry file path.
///
/// # Returns
/// - `Ok(())` when the path is a Node.js module.
/// - `Err(String)` when the path is not a Node.js module.
fn ensure_node_module(path: &Path) -> Result<(), String> {
    if is_node_module(path) {
        Ok(())
    } else {
        Err(format!(
            "plugin runtime: '{}' must be a .js/.mjs/.cjs Node entrypoint",
            path.display()
        ))
    }
}

/// Selects and creates a runtime instance for a plugin module.
#[cfg_attr(test, allow(dead_code))]
pub fn create_runtime_instance(
    spawn: SpawnConfig,
) -> Result<Arc<dyn crate::plugin_runtime::instance::PluginRuntimeInstance>, String> {
    trace!(
        "create_runtime_instance: plugin_id='{}', exec_path='{}'",
        spawn.plugin_id,
        spawn.exec_path.display()
    );

    ensure_node_module(&spawn.exec_path)?;

    let runtime: Arc<dyn crate::plugin_runtime::instance::PluginRuntimeInstance> =
        create_node_runtime_instance(spawn)?;
    Ok(runtime)
}

/// Creates a concrete runtime instance used by VCS proxy adapters.
pub fn create_node_runtime_instance(
    spawn: SpawnConfig,
) -> Result<Arc<NodePluginRuntimeInstance>, String> {
    ensure_node_module(&spawn.exec_path)?;
    Ok(Arc::new(NodePluginRuntimeInstance::new(spawn)))
}

#[cfg(test)]
mod tests {
    include!("../../tests/plugin_runtime/runtime_select.rs");
}
