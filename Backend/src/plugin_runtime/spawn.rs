use crate::plugin_bundles::ApprovalState;
use std::path::PathBuf;

#[derive(Debug, Clone)]
pub struct SpawnConfig {
    pub plugin_id: String,
    pub component_label: String,
    pub exec_path: PathBuf,
    pub args: Vec<String>,
    pub requested_capabilities: Vec<String>,
    pub approval: ApprovalState,
    pub allowed_workspace_root: Option<PathBuf>,
}
