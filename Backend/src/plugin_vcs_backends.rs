// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later
//! Discovery and opening logic for plugin-provided VCS backends.

use crate::logging::LogTimer;
use crate::plugin_bundles::{PluginBundleStore, PluginManifest, VcsBackendProvide};
use crate::plugin_paths::{built_in_plugin_dirs, PLUGIN_MANIFEST_NAME};
use crate::plugin_runtime::instance::PluginRuntimeInstance;
use crate::plugin_runtime::runtime_select::create_component_runtime_instance;
use crate::plugin_runtime::{vcs_proxy::PluginVcsProxy, PluginRuntimeManager};
use crate::settings::AppConfig;
use log::{debug, error, info, trace, warn};
use openvcs_core::{BackendId, Result as VcsResult, Vcs, VcsError};
use std::{
    collections::BTreeMap,
    fs,
    path::{Path, PathBuf},
    sync::Arc,
};

const MODULE: &str = "plugin_vcs_backends";

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
    let enabled = cfg.is_plugin_enabled(plugin_id, default_enabled);
    trace!(
        "is_plugin_enabled_in_settings: plugin={}, default={}, result={}",
        plugin_id,
        default_enabled,
        enabled
    );
    enabled
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
    trace!(
        "load_manifest_from_dir: loading from {}",
        manifest_path.display()
    );

    let text = fs::read_to_string(&manifest_path).ok()?;
    let manifest: PluginManifest = serde_json::from_str(&text).ok()?;

    debug!(
        "load_manifest_from_dir: loaded manifest for plugin '{}'",
        manifest.id
    );
    Some(manifest)
}

/// Lists manifests from built-in plugin directories.
///
/// # Returns
/// - Directory/manifest pairs for readable built-in plugins.
fn builtin_plugin_manifests() -> Vec<(PathBuf, PluginManifest)> {
    let _timer = LogTimer::new(MODULE, "builtin_plugin_manifests");
    trace!("builtin_plugin_manifests: scanning built-in plugin dirs",);

    let mut out = Vec::new();
    let dirs = built_in_plugin_dirs();
    debug!(
        "builtin_plugin_manifests: found {} built-in plugin directories",
        dirs.len()
    );

    for root in dirs {
        if !root.is_dir() {
            trace!(
                "builtin_plugin_manifests: {} is not a directory",
                root.display()
            );
            continue;
        }
        let entries = match fs::read_dir(&root) {
            Ok(entries) => entries,
            Err(e) => {
                warn!(
                    "builtin_plugin_manifests: failed to read {}: {}",
                    root.display(),
                    e
                );
                continue;
            }
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

    debug!(
        "builtin_plugin_manifests: found {} built-in manifests",
        out.len()
    );
    out
}

/// Lists VCS backends currently available from installed and built-in plugins.
///
/// # Returns
/// - `Ok(Vec<PluginBackendDescriptor>)` containing discovered backend descriptors.
/// - `Err(String)` if installed plugin components cannot be loaded.
pub fn list_plugin_vcs_backends() -> Result<Vec<PluginBackendDescriptor>, String> {
    let _timer = LogTimer::new(MODULE, "list_plugin_vcs_backends");
    info!("list_plugin_vcs_backends: discovering VCS backends",);

    let store = PluginBundleStore::new_default();
    let plugins = store.list_current_components().map_err(|e| {
        error!("list_plugin_vcs_backends: failed to list components: {}", e);
        e
    })?;

    debug!(
        "list_plugin_vcs_backends: found {} installed plugins",
        plugins.len()
    );
    let mut map: BTreeMap<String, PluginBackendDescriptor> = BTreeMap::new();

    for p in plugins {
        if !is_plugin_enabled_in_settings(&p.plugin_id, p.default_enabled) {
            trace!(
                "list_plugin_vcs_backends: plugin {} is disabled",
                p.plugin_id
            );
            continue;
        }
        let Some(module) = p.module else {
            trace!(
                "list_plugin_vcs_backends: plugin {} has no module",
                p.plugin_id
            );
            continue;
        };

        for (id, name) in module.vcs_backends {
            let backend_id = BackendId::from(id.as_str());
            debug!(
                "list_plugin_vcs_backends: found backend '{}' from plugin '{}'",
                backend_id, p.plugin_id
            );
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
            warn!(
                "list_plugin_vcs_backends: manifest has empty id at {}",
                plugin_dir.display()
            );
            continue;
        }
        if !is_plugin_enabled_in_settings(plugin_id, manifest.default_enabled) {
            trace!(
                "list_plugin_vcs_backends: built-in plugin {} is disabled",
                plugin_id
            );
            continue;
        }
        let Some(module) = &manifest.module else {
            trace!(
                "list_plugin_vcs_backends: built-in plugin {} has no module",
                plugin_id
            );
            continue;
        };
        let Some(exec_name) = module
            .exec
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
        else {
            trace!(
                "list_plugin_vcs_backends: built-in plugin {} has no exec",
                plugin_id
            );
            continue;
        };
        let exec_path = plugin_dir.join("bin").join(exec_name);
        if !exec_path.is_file() {
            warn!(
                "list_plugin_vcs_backends: built-in plugin {} is missing module exec {}",
                plugin_id,
                exec_path.display()
            );
            continue;
        }

        debug!(
            "list_plugin_vcs_backends: processing built-in plugin {} at {}",
            plugin_id,
            plugin_dir.display()
        );

        let plugin_name = manifest.name.clone();
        for provide in &module.vcs_backends {
            let (id, label) = match provide {
                VcsBackendProvide::Id(id) => (id.clone(), None),
                VcsBackendProvide::Named { id, name } => (id.clone(), name.clone()),
            };
            let backend_id = BackendId::from(id.as_str());
            let key = backend_id.as_ref().to_string();
            if map.contains_key(&key) {
                trace!(
                    "list_plugin_vcs_backends: backend {} already registered",
                    backend_id
                );
                continue;
            }
            debug!(
                "list_plugin_vcs_backends: registering built-in backend '{}' from plugin '{}'",
                backend_id, plugin_id
            );
            let candidate = PluginBackendDescriptor {
                backend_id: backend_id.clone(),
                backend_name: label,
                plugin_id: plugin_id.to_string(),
                plugin_name: plugin_name.clone(),
            };
            map.insert(key, candidate);
        }
    }

    let result: Vec<_> = map.into_values().collect();
    info!(
        "list_plugin_vcs_backends: discovered {} VCS backends",
        result.len()
    );
    Ok(result)
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
    trace!("has_plugin_vcs_backend: checking for {}", backend_id);
    let result = list_plugin_vcs_backends().ok().is_some_and(|v| {
        v.iter()
            .any(|b| b.backend_id.as_ref() == backend_id.as_ref())
    });
    debug!("has_plugin_vcs_backend: {} -> {}", backend_id, result);
    result
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
    trace!("plugin_vcs_backend_descriptor: resolving {}", backend_id);

    let backends = list_plugin_vcs_backends()?;
    let result = backends
        .into_iter()
        .find(|d| d.backend_id.as_ref() == backend_id.as_ref())
        .ok_or_else(|| {
            warn!(
                "plugin_vcs_backend_descriptor: unknown backend {}",
                backend_id
            );
            format!("Unknown VCS backend: {backend_id}")
        })?;

    debug!(
        "plugin_vcs_backend_descriptor: found {} from plugin {}",
        backend_id, result.plugin_id
    );
    Ok(result)
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
    let _timer = LogTimer::new(MODULE, "open_repo_via_plugin_vcs_backend");
    info!(
        "open_repo_via_plugin_vcs_backend: backend={}, path={}",
        backend_id,
        path.display()
    );

    let desc = plugin_vcs_backend_descriptor(&backend_id).map_err(|e| {
        error!(
            "open_repo_via_plugin_vcs_backend: failed to resolve backend {}: {}",
            backend_id, e
        );
        VcsError::Unsupported(backend_id.clone())
    })?;

    debug!(
        "open_repo_via_plugin_vcs_backend: resolved to plugin {}",
        desc.plugin_id
    );

    let cfg_value = serde_json::to_value(cfg).map_err(|e| {
        error!(
            "open_repo_via_plugin_vcs_backend: failed to serialize config: {}",
            e
        );
        VcsError::Backend {
            backend: backend_id.clone(),
            msg: format!("serialize config: {e}"),
        }
    })?;

    let workspace_root = std::fs::canonicalize(path).map_err(|e| VcsError::Backend {
        backend: backend_id.clone(),
        msg: format!("canonicalize repo root: {e}"),
    })?;

    trace!(
        "open_repo_via_plugin_vcs_backend: resolving spawn for plugin {}",
        desc.plugin_id
    );

    let spawn = runtime_manager
        .vcs_spawn_for_workspace_with_config(cfg, &desc.plugin_id, workspace_root)
        .map_err(|e| {
            error!(
                "open_repo_via_plugin_vcs_backend: failed to resolve spawn for plugin {}: {}",
                desc.plugin_id, e
            );
            VcsError::Backend {
                backend: backend_id.clone(),
                msg: e,
            }
        })?;

    let runtime = create_component_runtime_instance(spawn).map_err(|e| {
        error!(
            "open_repo_via_plugin_vcs_backend: failed to create runtime for plugin {}: {}",
            desc.plugin_id, e
        );
        VcsError::Backend {
            backend: backend_id.clone(),
            msg: e,
        }
    })?;

    runtime.ensure_running().map_err(|e| VcsError::Backend {
        backend: backend_id.clone(),
        msg: e,
    })?;

    debug!("open_repo_via_plugin_vcs_backend: opening via plugin proxy",);

    let result = PluginVcsProxy::open_with_process(backend_id.clone(), runtime, path, cfg_value);

    match &result {
        Ok(_) => {
            info!(
                "open_repo_via_plugin_vcs_backend: successfully opened {} via {}",
                path.display(),
                backend_id
            );
        }
        Err(e) => {
            error!(
                "open_repo_via_plugin_vcs_backend: failed to open {} via {}: {}",
                path.display(),
                backend_id,
                e
            );
        }
    }

    result
}
