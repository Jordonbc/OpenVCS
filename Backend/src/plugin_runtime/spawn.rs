// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later
use crate::plugin_bundles::ApprovalState;
use std::path::PathBuf;

#[derive(Debug, Clone)]
pub struct SpawnConfig {
    pub plugin_id: String,
    pub exec_path: PathBuf,
    pub approval: ApprovalState,
    pub allowed_workspace_root: Option<PathBuf>,
}
