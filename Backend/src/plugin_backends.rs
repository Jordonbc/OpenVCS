use crate::plugin_bundles::{ApprovalState, PluginBundleStore};
use crate::plugin_runtime::vcs_proxy::PluginVcsProxy;
use crate::settings::AppConfig;
use openvcs_core::{BackendId, Result as VcsResult, Vcs, VcsError};
use std::path::Path;
use std::sync::Arc;

fn is_plugin_enabled_in_settings(plugin_id: &str) -> bool {
    let plugin_id = plugin_id.trim().to_lowercase();
    if plugin_id.is_empty() {
        return false;
    }

    let cfg = AppConfig::load_or_default();
    let disabled: Vec<String> = cfg
        .plugins
        .disabled
        .iter()
        .map(|s| s.trim().to_lowercase())
        .filter(|s| !s.is_empty())
        .collect();
    if disabled.iter().any(|id| id == &plugin_id) {
        return false;
    }

    let enabled: Vec<String> = cfg
        .plugins
        .enabled
        .iter()
        .map(|s| s.trim().to_lowercase())
        .filter(|s| !s.is_empty())
        .collect();

    if !enabled.is_empty() {
        enabled.iter().any(|id| id == &plugin_id)
    } else {
        true
    }
}

#[derive(Debug, Clone)]
pub struct PluginBackendDescriptor {
    pub backend_id: BackendId,
    pub backend_name: Option<String>,
    pub plugin_id: String,
    pub plugin_name: Option<String>,
    pub exec_path: std::path::PathBuf,
    pub requested_capabilities: Vec<String>,
    pub approval: ApprovalState,
}

pub fn list_plugin_backends() -> Result<Vec<PluginBackendDescriptor>, String> {
    let store = PluginBundleStore::new_default();
    let plugins = store.list_current_components()?;
    let mut out = Vec::new();

    for p in plugins {
        if !is_plugin_enabled_in_settings(&p.plugin_id) {
            continue;
        }
        let Some(backend) = p.backend else {
            continue;
        };
        let installed = store.get_current_installed(&p.plugin_id)?.unwrap_or_else(|| {
            crate::plugin_bundles::InstalledPluginVersion {
                version: p.version.clone(),
                bundle_sha256: String::new(),
                installed_at_unix_ms: 0,
                requested_capabilities: p.requested_capabilities.clone(),
                approval: ApprovalState::Pending,
            }
        });

        for (id, name) in backend.provides {
            let backend_id = BackendId::from(id.as_str());
            out.push(PluginBackendDescriptor {
                backend_id,
                backend_name: name,
                plugin_id: p.plugin_id.clone(),
                plugin_name: p.name.clone(),
                exec_path: backend.exec_path.clone(),
                requested_capabilities: installed.requested_capabilities.clone(),
                approval: installed.approval.clone(),
            });
        }
    }

    out.sort_by(|a, b| a.backend_id.as_ref().cmp(b.backend_id.as_ref()));
    Ok(out)
}

pub fn has_plugin_backend(backend_id: &BackendId) -> bool {
    list_plugin_backends()
        .ok()
        .is_some_and(|v| v.iter().any(|b| b.backend_id.as_ref() == backend_id.as_ref()))
}

pub fn open_repo_via_plugin_backend(
    backend_id: BackendId,
    path: &Path,
) -> VcsResult<Arc<dyn Vcs>> {
    let backend_id_for_err = backend_id.clone();
    let list = list_plugin_backends()
        .map_err(|e| VcsError::Backend { backend: backend_id_for_err, msg: e })?;
    let desc = list
        .into_iter()
        .find(|d| d.backend_id.as_ref() == backend_id.as_ref())
        .ok_or_else(|| VcsError::Unsupported(backend_id.clone()))?;

    PluginVcsProxy::open_with_process(
        desc.plugin_id,
        backend_id,
        desc.exec_path,
        desc.approval,
        desc.requested_capabilities,
        path,
    )
}
