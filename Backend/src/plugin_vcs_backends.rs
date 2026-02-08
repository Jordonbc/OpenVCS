use crate::plugin_bundles::{ApprovalState, PluginBundleStore, PluginManifest, VcsBackendProvide};
use crate::plugin_paths::{built_in_plugin_dirs, PLUGIN_MANIFEST_NAME};
use crate::plugin_runtime::vcs_proxy::PluginVcsProxy;
use crate::settings::AppConfig;
use log::warn;
use openvcs_core::{BackendId, Result as VcsResult, Vcs, VcsError};
use std::{
    collections::BTreeMap,
    fs,
    path::{Path, PathBuf},
    sync::Arc,
};

fn is_plugin_enabled_in_settings(plugin_id: &str, default_enabled: bool) -> bool {
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

    // `enabled` is additive (explicit opt-in), not an allowlist.
    // Plugins remain active by their manifest default unless explicitly disabled.
    default_enabled || enabled.iter().any(|id| id == &plugin_id)
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

fn normalize_capabilities(mut caps: Vec<String>) -> Vec<String> {
    for cap in &mut caps {
        *cap = cap.trim().to_string();
    }
    caps.retain(|cap| !cap.is_empty());
    caps.sort();
    caps.dedup();
    caps
}

fn load_manifest_from_dir(plugin_dir: &Path) -> Option<PluginManifest> {
    let manifest_path = plugin_dir.join(PLUGIN_MANIFEST_NAME);
    let text = fs::read_to_string(&manifest_path).ok()?;
    serde_json::from_str(&text).ok()
}

fn builtin_plugin_manifests() -> Vec<(PathBuf, PluginManifest)> {
    let mut out = Vec::new();
    for root in built_in_plugin_dirs() {
        if !root.is_dir() {
            continue;
        }
        let entries = match fs::read_dir(&root) {
            Ok(entries) => entries,
            Err(_) => continue,
        };
        for entry in entries.flatten() {
            let plugin_dir = entry.path();
            if !plugin_dir.is_dir() {
                continue;
            }
            if let Some(manifest) = load_manifest_from_dir(&plugin_dir) {
                out.push((plugin_dir, manifest));
            }
        }
    }
    out
}

pub fn list_plugin_vcs_backends() -> Result<Vec<PluginBackendDescriptor>, String> {
    let store = PluginBundleStore::new_default();
    let plugins = store.list_current_components()?;
    let mut map: BTreeMap<String, PluginBackendDescriptor> = BTreeMap::new();

    for p in plugins {
        if !is_plugin_enabled_in_settings(&p.plugin_id, p.default_enabled) {
            continue;
        }
        let Some(module) = p.module else {
            continue;
        };
        let installed = store
            .get_current_installed(&p.plugin_id)?
            .unwrap_or_else(|| crate::plugin_bundles::InstalledPluginVersion {
                version: p.version.clone(),
                bundle_sha256: String::new(),
                installed_at_unix_ms: 0,
                requested_capabilities: p.requested_capabilities.clone(),
                approval: ApprovalState::Pending,
            });

        for (id, name) in module.vcs_backends {
            let backend_id = BackendId::from(id.as_str());
            let key = backend_id.as_ref().to_string();
            map.insert(
                key,
                PluginBackendDescriptor {
                    backend_id,
                    backend_name: name,
                    plugin_id: p.plugin_id.clone(),
                    plugin_name: p.name.clone(),
                    exec_path: module.exec_path.clone(),
                    requested_capabilities: installed.requested_capabilities.clone(),
                    approval: installed.approval.clone(),
                },
            );
        }
    }

    for (plugin_dir, manifest) in builtin_plugin_manifests() {
        let plugin_id = manifest.id.trim();
        if plugin_id.is_empty() {
            continue;
        }
        if !is_plugin_enabled_in_settings(plugin_id, manifest.default_enabled) {
            continue;
        }
        let Some(module) = &manifest.module else {
            continue;
        };
        let Some(exec_name) = module
            .exec
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
        else {
            continue;
        };
        let exec_path = plugin_dir.join("bin").join(exec_name);
        if !exec_path.is_file() {
            warn!(
                "plugin_vcs_backends: built-in plugin {} is missing module exec {}",
                plugin_id,
                exec_path.display()
            );
            continue;
        }
        let requested_capabilities = normalize_capabilities(manifest.capabilities.clone());
        let approval_caps = requested_capabilities.clone();
        let plugin_name = manifest.name.clone();
        for provide in &module.vcs_backends {
            let (id, label) = match provide {
                VcsBackendProvide::Id(id) => (id.clone(), None),
                VcsBackendProvide::Named { id, name } => (id.clone(), name.clone()),
            };
            let backend_id = BackendId::from(id.as_str());
            let key = backend_id.as_ref().to_string();
            if map.contains_key(&key) {
                continue;
            }
            map.insert(
                key,
                PluginBackendDescriptor {
                    backend_id,
                    backend_name: label,
                    plugin_id: plugin_id.to_string(),
                    plugin_name: plugin_name.clone(),
                    exec_path: exec_path.clone(),
                    requested_capabilities: requested_capabilities.clone(),
                    approval: ApprovalState::Approved {
                        capabilities: approval_caps.clone(),
                        approved_at_unix_ms: 0,
                    },
                },
            );
        }
    }

    Ok(map.into_values().collect())
}

pub fn has_plugin_vcs_backend(backend_id: &BackendId) -> bool {
    list_plugin_vcs_backends().ok().is_some_and(|v| {
        v.iter()
            .any(|b| b.backend_id.as_ref() == backend_id.as_ref())
    })
}

pub fn open_repo_via_plugin_vcs_backend(
    backend_id: BackendId,
    path: &Path,
) -> VcsResult<Arc<dyn Vcs>> {
    let backend_id_for_err = backend_id.clone();
    let list = list_plugin_vcs_backends().map_err(|e| VcsError::Backend {
        backend: backend_id_for_err,
        msg: e,
    })?;
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
