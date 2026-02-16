// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later
//! Discovery and opening logic for plugin-provided VCS backends.

use crate::plugin_bundles::{PluginBundleStore, PluginManifest, VcsBackendProvide};
use crate::plugin_paths::{built_in_plugin_dirs, PLUGIN_MANIFEST_NAME};
use crate::plugin_runtime::{vcs_proxy::PluginVcsProxy, PluginRuntimeManager};
use crate::settings::AppConfig;
use log::warn;
use openvcs_core::{BackendId, Result as VcsResult, Vcs, VcsError};
use std::{
    collections::BTreeMap,
    fs,
    path::{Path, PathBuf},
    sync::Arc,
};

/// Determines whether a plugin is enabled considering config overrides.
///
/// # Parameters
/// - `plugin_id`: Plugin id.
/// - `default_enabled`: Manifest default enabled flag.
///
/// # Returns
/// - `true` when plugin should be active.
/// - `false` otherwise.
fn is_plugin_enabled_in_settings(plugin_id: &str, default_enabled: bool) -> bool {
    let cfg = AppConfig::load_or_default();
    cfg.is_plugin_enabled(plugin_id, default_enabled)
}

/// Metadata describing a single plugin-provided backend implementation.
#[derive(Debug, Clone)]
pub struct PluginBackendDescriptor {
    /// Logical backend identifier (for example `git`).
    pub backend_id: BackendId,
    /// Optional human-readable backend name.
    pub backend_name: Option<String>,
    /// Owning plugin identifier.
    pub plugin_id: String,
    /// Optional human-readable plugin name.
    pub plugin_name: Option<String>,
}

/// Normalizes capability ids (trim/sort/dedup).
///
/// # Parameters
/// - `caps`: Raw capability list.
///
/// # Returns
/// - Normalized capability list.
/// Reads a plugin manifest from a plugin directory.
///
/// # Parameters
/// - `plugin_dir`: Plugin directory path.
///
/// # Returns
/// - `Some(PluginManifest)` on success.
/// - `None` on read/parse failure.
fn load_manifest_from_dir(plugin_dir: &Path) -> Option<PluginManifest> {
    let manifest_path = plugin_dir.join(PLUGIN_MANIFEST_NAME);
    let text = fs::read_to_string(&manifest_path).ok()?;
    serde_json::from_str(&text).ok()
}

/// Lists manifests from built-in plugin directories.
///
/// # Returns
/// - Directory/manifest pairs for readable built-in plugins.
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

/// Lists VCS backends currently available from installed and built-in plugins.
///
/// # Returns
/// - `Ok(Vec<PluginBackendDescriptor>)` containing discovered backend descriptors.
/// - `Err(String)` if installed plugin components cannot be loaded.
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

        for (id, name) in module.vcs_backends {
            let backend_id = BackendId::from(id.as_str());
            let candidate = PluginBackendDescriptor {
                backend_id: backend_id.clone(),
                backend_name: name,
                plugin_id: p.plugin_id.clone(),
                plugin_name: p.name.clone(),
            };
            let key = backend_id.as_ref().to_string();
            map.insert(key, candidate);
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
            let candidate = PluginBackendDescriptor {
                backend_id: backend_id.clone(),
                backend_name: label,
                plugin_id: plugin_id.to_string(),
                plugin_name: plugin_name.clone(),
            };
            map.insert(key, candidate);
        }
    }

    Ok(map.into_values().collect())
}

/// Returns whether a plugin-provided backend exists for the given backend id.
///
/// # Parameters
/// - `backend_id`: Backend identifier to probe.
///
/// # Returns
/// - `true` when a matching plugin backend is available.
/// - `false` otherwise.
pub fn has_plugin_vcs_backend(backend_id: &BackendId) -> bool {
    list_plugin_vcs_backends().ok().is_some_and(|v| {
        v.iter()
            .any(|b| b.backend_id.as_ref() == backend_id.as_ref())
    })
}

/// Resolves the descriptor for a specific plugin-provided backend id.
///
/// # Parameters
/// - `backend_id`: Backend identifier to resolve.
///
/// # Returns
/// - `Ok(PluginBackendDescriptor)` for the matching backend.
/// - `Err(String)` if the backend is unknown or lookup fails.
pub fn plugin_vcs_backend_descriptor(
    backend_id: &BackendId,
) -> Result<PluginBackendDescriptor, String> {
    list_plugin_vcs_backends()?
        .into_iter()
        .find(|d| d.backend_id.as_ref() == backend_id.as_ref())
        .ok_or_else(|| format!("Unknown VCS backend: {backend_id}"))
}

/// Opens a repository through a plugin backend process.
///
/// # Parameters
/// - `backend_id`: Backend identifier to open through.
/// - `path`: Repository working tree path.
///
/// # Returns
/// - `Ok(Arc<dyn Vcs>)` with an opened backend proxy.
/// - `Err(VcsError)` when descriptor resolution or backend startup fails.
pub fn open_repo_via_plugin_vcs_backend(
    runtime_manager: &PluginRuntimeManager,
    cfg: &AppConfig,
    backend_id: BackendId,
    path: &Path,
) -> VcsResult<Arc<dyn Vcs>> {
    let desc = plugin_vcs_backend_descriptor(&backend_id)
        .map_err(|_| VcsError::Unsupported(backend_id.clone()))?;

    let cfg_value = serde_json::to_value(cfg).map_err(|e| VcsError::Backend {
        backend: backend_id.clone(),
        msg: format!("serialize config: {e}"),
    })?;

    let runtime = runtime_manager
        .runtime_for_workspace_with_config(cfg, &desc.plugin_id, Some(path.to_path_buf()))
        .map_err(|e| VcsError::Backend {
            backend: backend_id.clone(),
            msg: e,
        })?;

    PluginVcsProxy::open_with_process(backend_id, runtime, path, cfg_value)
}
