// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later
use crate::plugin_bundles::ApprovalState;
use std::path::PathBuf;

/// Runtime launch configuration for a plugin module instance.
#[derive(Debug, Clone)]
pub struct SpawnConfig {
    /// Canonical plugin identifier used for logging and routing.
    pub plugin_id: String,
    /// Path to the plugin component/module executable.
    pub exec_path: PathBuf,
    /// Persisted capability approval state for this plugin install.
    pub approval: ApprovalState,
    /// Optional workspace root constraining file/process host operations.
    pub allowed_workspace_root: Option<PathBuf>,
}
