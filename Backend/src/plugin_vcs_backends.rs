// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later
//! Discovery and opening logic for plugin-provided VCS backends.

use crate::core::{BackendId, Result as VcsResult, Vcs, VcsError};
use crate::logging::LogTimer;
use crate::plugin_bundles::PluginBundleStore;
use crate::plugin_runtime::instance::PluginRuntimeInstance;
use crate::plugin_runtime::runtime_select::create_node_runtime_instance;
use crate::plugin_runtime::settings_store;
use crate::plugin_runtime::{vcs_proxy::PluginVcsProxy, PluginRuntimeManager};
use crate::settings::AppConfig;
use log::{debug, error, info, trace, warn};
use std::{collections::BTreeMap, path::Path, sync::Arc};

const MODULE: &str = "plugin_vcs_backends";

/// Returns plugin-scoped open config for a VCS backend plugin.
fn plugin_open_config(plugin_id: &str) -> serde_json::Value {
    serde_json::Value::Object(settings_store::load_settings(plugin_id).unwrap_or_default())
}

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

/// Lists VCS backends currently available from installed plugins.
///
/// Built-in and user-configured plugins are synchronized into the installed
/// plugin store at startup, so backend discovery must use installed component
/// metadata instead of treating config sources as runtime directories.
///
/// Discovery also performs a best-effort sync before listing components. This
/// keeps packaged backends visible even if startup sync ran before bundled
/// resources were fully ready or if the installed store later needs repair.
///
/// # Returns
/// - `Ok(Vec<PluginBackendDescriptor>)` containing discovered backend descriptors.
/// - `Err(String)` if installed plugin components cannot be loaded.
pub fn list_plugin_vcs_backends() -> Result<Vec<PluginBackendDescriptor>, String> {
    let _timer = LogTimer::new(MODULE, "list_plugin_vcs_backends");
    info!("list_plugin_vcs_backends: discovering VCS backends",);

    let store = PluginBundleStore::new_default();
    if let Err(err) = store.sync_built_in_plugins() {
        warn!(
            "list_plugin_vcs_backends: built-in sync failed before discovery: {}",
            err
        );
    }
    let cfg = AppConfig::load_or_default();
    if let Err(err) = crate::plugin_sources::sync_configured_plugins(&cfg) {
        warn!(
            "list_plugin_vcs_backends: configured plugin sync failed before discovery: {}",
            err
        );
    }
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

        let approved = store
            .get_current_installed(&p.plugin_id)
            .ok()
            .flatten()
            .is_some_and(|installed| {
                matches!(
                    installed.approval,
                    crate::plugin_bundles::ApprovalState::Approved { .. }
                )
            });
        if !approved {
            trace!(
                "list_plugin_vcs_backends: plugin {} is not approved",
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

    let cfg_value = plugin_open_config(&desc.plugin_id);

    let workspace_root = std::fs::canonicalize(path).map_err(|e| VcsError::Backend {
        backend: backend_id.clone(),
        msg: format!("canonicalize repo root: {e}"),
    })?;

    trace!(
        "open_repo_via_plugin_vcs_backend: resolving spawn for plugin {}",
        desc.plugin_id
    );

    let runtime = runtime_manager
        .vcs_spawn_for_workspace_with_config(cfg, &desc.plugin_id, workspace_root.clone())
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

    let runtime = create_node_runtime_instance(runtime).map_err(|e| {
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

    if let Err(e) = runtime_manager.track_node_runtime_for_workspace(
        &desc.plugin_id,
        Some(workspace_root),
        Arc::clone(&runtime),
    ) {
        error!(
            "open_repo_via_plugin_vcs_backend: failed to track runtime for plugin {}: {}",
            desc.plugin_id, e
        );
    }

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
