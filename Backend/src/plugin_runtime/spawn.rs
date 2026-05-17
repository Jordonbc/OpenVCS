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
    include!("../../tests/plugin_runtime/spawn.rs");
}
