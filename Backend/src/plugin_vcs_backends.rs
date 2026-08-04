// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later
//! Discovery and opening logic for plugin-provided VCS backends.

use crate::core::{BackendId, Result as VcsResult, Vcs, VcsError};
use crate::logging::LogTimer;
use crate::plugin_bundles::PluginBundleStore;
use crate::plugin_runtime::instance::PluginRuntimeInstance;
use crate::plugin_runtime::runtime_select::create_node_runtime_instance;
use crate::plugin_runtime::settings_store;
use crate::plugin_runtime::{PluginRuntimeManager, vcs_proxy::PluginVcsProxy};
use crate::settings::AppConfig;
use crate::utilities::inner::recover_poisoned;
use log::{debug, error, info, trace, warn};
use std::collections::BTreeMap;
#[cfg(test)]
use std::collections::BTreeSet;
use std::path::Path;
use std::sync::{Arc, OnceLock, RwLock};

const MODULE: &str = "plugin_vcs_backends";

static BACKEND_CACHE: OnceLock<RwLock<Option<Vec<PluginBackendDescriptor>>>> = OnceLock::new();

fn backend_cache() -> &'static RwLock<Option<Vec<PluginBackendDescriptor>>> {
    BACKEND_CACHE.get_or_init(|| RwLock::new(None))
}

// Thread-local per-test override so parallel tests do not
// contend over the shared BACKEND_CACHE global.
#[cfg(test)]
std::thread_local! {
    static TEST_BACKEND_CACHE: std::cell::RefCell<Option<Vec<PluginBackendDescriptor>>> =
        const { std::cell::RefCell::new(None) };
}

// Process-wide test-only backend availability registry.
// Populated by store_backends() for any backend whose plugin_id starts with
// "test.".  Never cleared by invalidate_plugin_vcs_backend_cache(), so
// has_plugin_vcs_backend() remains correct even when Tauri dispatches async
// command handlers on tokio worker threads that lack the thread-local cache.
#[cfg(test)]
static TEST_BACKEND_IDS: OnceLock<RwLock<BTreeSet<String>>> = OnceLock::new();

#[cfg(test)]
fn test_backend_ids() -> &'static RwLock<BTreeSet<String>> {
    TEST_BACKEND_IDS.get_or_init(|| RwLock::new(BTreeSet::new()))
}

fn cached_backends() -> Option<Vec<PluginBackendDescriptor>> {
    #[cfg(test)]
    if let Some(cached) = TEST_BACKEND_CACHE.with(|tls| tls.borrow().clone()) {
        return Some(cached);
    }

    backend_cache()
        .read()
        .unwrap_or_else(recover_poisoned)
        .clone()
}

pub(crate) fn store_backends(backends: Vec<PluginBackendDescriptor>) {
    #[cfg(test)]
    {
        TEST_BACKEND_CACHE.with(|tls| *tls.borrow_mut() = Some(backends.clone()));
        let mut ids = test_backend_ids()
            .write()
            .unwrap_or_else(recover_poisoned);
        for b in &backends {
            if b.plugin_id.starts_with("test.") {
                ids.insert(b.backend_id.as_ref().to_string());
            }
        }
    }

    *backend_cache()
        .write()
        .unwrap_or_else(recover_poisoned) = Some(backends);
}

/// Clears cached VCS backend discovery results.
pub fn invalidate_plugin_vcs_backend_cache() {
    #[cfg(test)]
    TEST_BACKEND_CACHE.with(|tls| *tls.borrow_mut() = None);

    *backend_cache()
        .write()
        .unwrap_or_else(recover_poisoned) = None;
}

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
fn is_plugin_enabled_in_settings(cfg: &AppConfig, plugin_id: &str, default_enabled: bool) -> bool {
    let enabled = cfg.is_plugin_enabled(plugin_id, default_enabled);
    trace!(
        "is_plugin_enabled_in_settings: plugin={}, default={}, result={}",
        plugin_id, default_enabled, enabled
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
    /// Optional action-label map keyed by namespaced VCS actions.
    pub action_labels: BTreeMap<String, String>,
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
/// # Returns
/// - `Ok(Vec<PluginBackendDescriptor>)` containing discovered backend descriptors.
/// - `Err(String)` if installed plugin components cannot be loaded.
pub fn list_plugin_vcs_backends() -> Result<Vec<PluginBackendDescriptor>, String> {
    let _timer = LogTimer::new(MODULE, "list_plugin_vcs_backends");

    if let Some(cached) = cached_backends() {
        debug!(
            "list_plugin_vcs_backends: cache hit with {} cached backend(s)",
            cached.len()
        );
        return Ok(cached);
    }

    info!("list_plugin_vcs_backends: discovering VCS backends");
    let discovered = discover_plugin_vcs_backends()?;
    store_backends(discovered.clone());
    Ok(discovered)
}

fn discover_plugin_vcs_backends() -> Result<Vec<PluginBackendDescriptor>, String> {
    let store = PluginBundleStore::new_default();
    let cfg = AppConfig::load_or_default();
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
        if !is_plugin_enabled_in_settings(&cfg, &p.plugin_id, p.default_enabled) {
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

        for backend in module.vcs_backends {
            let backend_id = BackendId::from(backend.id.as_str());
            debug!(
                "list_plugin_vcs_backends: found backend '{}' from plugin '{}'",
                backend_id, p.plugin_id
            );
            let candidate = PluginBackendDescriptor {
                backend_id: backend_id.clone(),
                backend_name: backend.name,
                action_labels: backend.action_labels,
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

    #[cfg(test)]
    if test_backend_ids()
        .read()
        .unwrap_or_else(recover_poisoned)
        .contains(backend_id.as_ref())
    {
        return true;
    }

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

    let repo_path = std::fs::canonicalize(path).map_err(|e| VcsError::Backend {
        backend: backend_id.clone(),
        msg: format!("canonicalize repo root: {e}"),
    })?;

    let runtime = runtime_manager
        .runtime_for_vcs_backend_with_config(cfg, &desc.plugin_id)
        .map_err(|e| {
            error!(
                "open_repo_via_plugin_vcs_backend: failed to reuse runtime for plugin {}: {}",
                desc.plugin_id, e
            );
            VcsError::Backend {
                backend: backend_id.clone(),
                msg: e,
            }
        })?;

    debug!("open_repo_via_plugin_vcs_backend: opening via plugin proxy",);

    let result =
        PluginVcsProxy::open_with_process(backend_id.clone(), runtime, &repo_path, cfg_value);

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

/// Clones a repository through a plugin VCS backend.
///
/// # Parameters
/// - `runtime_manager`: Plugin runtime manager used to resolve the backend module.
/// - `cfg`: App config snapshot used for enabled-state checks.
/// - `backend_id`: Backend identifier selected for the clone.
/// - `url`: Repository source URL.
/// - `target`: Full destination path for the cloned repository.
/// - `on`: Optional event sink for clone progress messages.
///
/// # Returns
/// - `Ok(())` when the plugin clone operation succeeds.
/// - `Err(VcsError)` when backend resolution, startup, or clone fails.
pub fn clone_repo_via_plugin_vcs_backend(
    runtime_manager: &PluginRuntimeManager,
    cfg: &AppConfig,
    backend_id: BackendId,
    url: &str,
    target: &Path,
    on: Option<crate::core::models::OnEvent>,
) -> VcsResult<()> {
    let desc = plugin_vcs_backend_descriptor(&backend_id)
        .map_err(|_| VcsError::Unsupported(backend_id.clone()))?;
    let workspace_root = target.parent().unwrap_or(target).to_path_buf();
    let spawn = runtime_manager
        .vcs_spawn_for_workspace_with_config(cfg, &desc.plugin_id, workspace_root)
        .map_err(|e| VcsError::Backend {
            backend: backend_id.clone(),
            msg: e,
        })?;
    let runtime = create_node_runtime_instance(spawn).map_err(|e| VcsError::Backend {
        backend: backend_id.clone(),
        msg: e,
    })?;
    runtime.ensure_running().map_err(|e| VcsError::Backend {
        backend: backend_id.clone(),
        msg: e,
    })?;

    runtime.set_event_sink(on);
    let result = runtime.vcs_clone_repo(url, &target.to_string_lossy());
    runtime.set_event_sink(None);
    runtime.stop();

    result.map_err(|e| VcsError::Backend {
        backend: backend_id,
        msg: e,
    })
}

#[cfg(test)]
mod tests {
    include!("../tests/modules/plugin_vcs_backends.rs");
}
