// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later
use std::path::PathBuf;

/// Runtime launch configuration for a plugin module instance.
#[derive(Debug, Clone)]
pub struct SpawnConfig {
    /// Canonical plugin identifier used for logging and routing.
    pub plugin_id: String,
    /// Path to the plugin Node.js module executable.
    pub exec_path: PathBuf,
    /// Optional workspace root captured for backward-compatible APIs.
    pub allowed_workspace_root: Option<PathBuf>,
    /// Whether this plugin exports a VCS backend interface.
    pub is_vcs_backend: bool,
}

#[cfg(test)]
mod tests {
    use super::SpawnConfig;

    #[test]
    /// Verifies spawn configs store their fields plainly.
    fn stores_spawn_configuration_fields() {
        let cfg = SpawnConfig {
            plugin_id: "plugin.demo".into(),
            exec_path: std::path::PathBuf::from("plugin.mjs"),
            allowed_workspace_root: Some(std::path::PathBuf::from("/tmp/workspace")),
            is_vcs_backend: true,
        };

        assert_eq!(cfg.plugin_id, "plugin.demo");
        assert_eq!(cfg.exec_path, std::path::PathBuf::from("plugin.mjs"));
        assert!(cfg.allowed_workspace_root.is_some());
        assert!(cfg.is_vcs_backend);
    }
}
