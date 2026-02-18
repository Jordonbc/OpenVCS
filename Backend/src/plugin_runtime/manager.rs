// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later
use crate::plugin_bundles::{InstalledPluginComponents, PluginBundleStore};
use crate::plugin_runtime::instance::PluginRuntimeInstance;
use crate::plugin_runtime::runtime_select::create_runtime_instance;
use crate::plugin_runtime::spawn::SpawnConfig;
use crate::settings::AppConfig;
use log::{debug, info, trace, warn};
use parking_lot::Mutex;
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::Arc;

#[derive(Clone)]
/// Fully resolved runtime spec for a module-capable plugin.
struct ModuleRuntimeSpec {
    /// Canonical plugin identifier.
    plugin_id: String,
    /// Normalized lowercase process map key.
    key: String,
    /// Manifest default-enabled value for this plugin.
    default_enabled: bool,
    /// Spawn configuration used to instantiate runtime transport.
    spawn: SpawnConfig,
}

/// Owns long-lived module plugin processes and coordinates lifecycle actions.
pub struct PluginRuntimeManager {
    /// Bundle store used to resolve installed plugin metadata.
    store: PluginBundleStore,
    /// Running plugin runtime instances keyed by normalized plugin id.
    processes: Mutex<HashMap<String, RunningPlugin>>,
}

/// Runtime handle tracked for a running plugin.
struct RunningPlugin {
    /// Runtime instance for dispatching plugin RPC calls.
    runtime: Arc<dyn PluginRuntimeInstance>,
    /// Workspace confinement root associated with the runtime instance.
    workspace_root: Option<PathBuf>,
}

impl Default for PluginRuntimeManager {
    /// Creates a runtime manager backed by the default plugin bundle store.
    ///
    /// # Returns
    /// - Default [`PluginRuntimeManager`].
    fn default() -> Self {
        Self::new(PluginBundleStore::new_default())
    }
}

impl PluginRuntimeManager {
    /// Creates a runtime manager using a specific plugin bundle store.
    ///
    /// # Parameters
    /// - `store`: Plugin bundle store used to resolve installed components.
    ///
    /// # Returns
    /// - New runtime manager instance.
    pub fn new(store: PluginBundleStore) -> Self {
        Self {
            store,
            processes: Mutex::new(HashMap::new()),
        }
    }

    /// Starts a plugin module process if needed.
    ///
    /// This operation is idempotent. If the plugin is already running, it
    /// validates readiness and returns success.
    ///
    /// # Parameters
    /// - `plugin_id`: Plugin identifier.
    ///
    /// # Returns
    /// - `Ok(())` when the plugin is running.
    /// - `Err(String)` when plugin lookup/startup fails.
    pub fn start_plugin(&self, plugin_id: &str) -> Result<(), String> {
        trace!("start_plugin: plugin_id='{}'", plugin_id);
        let key = normalize_plugin_key(plugin_id)?;
        debug!("start_plugin: key='{}'", key);

        if let Some(existing) = self.processes.lock().get(&key) {
            debug!("start_plugin: found existing runtime for key='{}'", key);
            return existing.runtime.ensure_running();
        }

        trace!("start_plugin: resolving module runtime spec");
        let spec = self.resolve_module_runtime_spec(plugin_id, None)?;
        debug!(
            "start_plugin: resolved spec for plugin_id='{}', key='{}'",
            spec.plugin_id, spec.key
        );

        trace!("start_plugin: starting plugin spec");
        self.start_plugin_spec(spec)?;
        trace!("start_plugin: completed successfully");
        info!("plugin: started '{}'", plugin_id);
        Ok(())
    }

    /// Stops a plugin module process when present.
    ///
    /// This operation is idempotent. Stopping an already-stopped plugin
    /// returns success.
    ///
    /// # Parameters
    /// - `plugin_id`: Plugin identifier.
    ///
    /// # Returns
    /// - `Ok(())` after stop/removal.
    /// - `Err(String)` if the identifier is invalid.
    pub fn stop_plugin(&self, plugin_id: &str) -> Result<(), String> {
        trace!("stop_plugin: plugin_id='{}'", plugin_id);
        let key = normalize_plugin_key(plugin_id)?;
        debug!("stop_plugin: key='{}'", key);

        let process = self.processes.lock().remove(&key);
        debug!("stop_plugin: removed from processes={}", process.is_some());

        if let Some(process) = process {
            trace!("stop_plugin: calling runtime.stop()");
            process.runtime.stop();
            info!("plugin: stopped '{}'", plugin_id);
        } else {
            trace!("stop_plugin: no running process found");
        }
        Ok(())
    }

    /// Stops all running plugins.
    pub fn stop_all_plugins(&self) {
        let running: Vec<String> = {
            let mut processes = self.processes.lock();
            let keys: Vec<String> = processes.keys().cloned().collect();
            for (_, process) in processes.iter_mut() {
                process.runtime.stop();
            }
            processes.clear();
            keys
        };
        if !running.is_empty() {
            info!("plugin: stopped all ({} plugins)", running.len());
        }
    }

    /// Ensures a plugin is running or stopped based on enabled state.
    ///
    /// This is more efficient than sync_plugin_runtime_with_config when
    /// only one plugin's state has changed.
    ///
    /// # Parameters
    /// - `plugin_id`: Plugin identifier.
    /// - `enabled`: Whether the plugin should be running.
    ///
    /// # Returns
    /// - `Ok(())` when the operation succeeds.
    /// - `Err(String)` when the operation fails.
    pub fn set_plugin_enabled(&self, plugin_id: &str, enabled: bool) -> Result<(), String> {
        trace!(
            "set_plugin_enabled: plugin_id='{}', enabled={}",
            plugin_id,
            enabled
        );
        let key = normalize_plugin_key(plugin_id)?;
        let is_running = self.processes.lock().contains_key(&key);
        debug!(
            "set_plugin_enabled: key='{}', currently_running={}",
            key, is_running
        );

        if enabled && !is_running {
            trace!("set_plugin_enabled: calling start_plugin");
            self.start_plugin(plugin_id)?;
            info!("plugin: enabled '{}'", plugin_id);
        } else if !enabled && is_running {
            trace!("set_plugin_enabled: calling stop_plugin");
            self.stop_plugin(plugin_id)?;
            info!("plugin: disabled '{}'", plugin_id);
        } else {
            trace!("set_plugin_enabled: no action needed (already in desired state)");
        }
        Ok(())
    }

    /// Synchronizes runtime process state with current persisted plugin settings.
    ///
    /// # Returns
    /// - `Ok(())` when sync succeeds.
    /// - `Err(String)` when one or more start/stop operations fail.
    pub fn sync_plugin_runtime(&self) -> Result<(), String> {
        let cfg = AppConfig::load_or_default();
        self.sync_plugin_runtime_with_config(&cfg)
    }

    /// Synchronizes runtime process state with an explicit configuration snapshot.
    ///
    /// # Parameters
    /// - `cfg`: Application config used to determine enabled plugins.
    ///
    /// # Returns
    /// - `Ok(())` when sync succeeds.
    /// - `Err(String)` when one or more start/stop operations fail.
    pub fn sync_plugin_runtime_with_config(&self, cfg: &AppConfig) -> Result<(), String> {
        let components = self.store.list_current_components()?;
        let mut desired_running = HashSet::new();
        let mut errors = Vec::new();

        let before: Vec<String> = self.processes.lock().keys().cloned().collect();

        for component in components {
            let plugin_id = component.plugin_id.trim();
            if plugin_id.is_empty() || component.module.is_none() {
                continue;
            }

            let key = plugin_id.to_ascii_lowercase();
            if cfg.is_plugin_enabled(plugin_id, component.default_enabled) {
                desired_running.insert(key.clone());
                if let Err(err) = self.start_plugin(plugin_id) {
                    errors.push(format!("start {}: {}", plugin_id, err));
                }
            }
        }

        let running: Vec<String> = self.processes.lock().keys().cloned().collect();
        for plugin_id in running {
            if !desired_running.contains(&plugin_id) {
                if let Err(err) = self.stop_plugin(&plugin_id) {
                    errors.push(format!("stop {}: {}", plugin_id, err));
                }
            }
        }

        let after: Vec<String> = self.processes.lock().keys().cloned().collect();
        let started: Vec<&String> = after.iter().filter(|p| !before.contains(p)).collect();
        let stopped: Vec<&String> = before.iter().filter(|p| !after.contains(p)).collect();

        if !started.is_empty() || !stopped.is_empty() {
            let mut parts = Vec::new();
            if !started.is_empty() {
                parts.push(format!(
                    "started: {}",
                    started
                        .iter()
                        .map(|s| s.as_str())
                        .collect::<Vec<_>>()
                        .join(", ")
                ));
            }
            if !stopped.is_empty() {
                parts.push(format!(
                    "stopped: {}",
                    stopped
                        .iter()
                        .map(|s| s.as_str())
                        .collect::<Vec<_>>()
                        .join(", ")
                ));
            }
            info!("plugin: sync complete - {}", parts.join("; "));
        }

        if errors.is_empty() {
            Ok(())
        } else {
            warn!("plugin: sync completed with errors: {}", errors.join("; "));
            Err(errors.join("; "))
        }
    }

    /// Calls a module RPC method through the persistent plugin process.
    ///
    /// # Parameters
    /// - `cfg`: App config snapshot used to enforce enabled-state checks.
    /// - `plugin_id`: Plugin identifier.
    /// - `method`: RPC method name.
    /// - `params`: JSON method params.
    ///
    /// # Returns
    /// - `Ok(Value)` plugin RPC result.
    /// - `Err(String)` when plugin is disabled/not available or RPC fails.
    pub fn call_module_method_with_config(
        &self,
        cfg: &AppConfig,
        plugin_id: &str,
        method: &str,
        params: Value,
    ) -> Result<Value, String> {
        self.call_module_method_for_workspace_with_config(cfg, plugin_id, method, params, None)
    }

    /// Calls a module RPC method through the persistent plugin process with an
    /// optional workspace-root confinement.
    ///
    /// # Parameters
    /// - `cfg`: App config snapshot used for enabled-state checks.
    /// - `plugin_id`: Plugin identifier.
    /// - `method`: RPC method name.
    /// - `params`: JSON RPC parameters.
    /// - `allowed_workspace_root`: Optional workspace root for host capability confinement.
    ///
    /// # Returns
    /// - `Ok(Value)` plugin RPC response payload.
    /// - `Err(String)` when plugin state validation or RPC dispatch fails.
    pub fn call_module_method_for_workspace_with_config(
        &self,
        cfg: &AppConfig,
        plugin_id: &str,
        method: &str,
        params: Value,
        allowed_workspace_root: Option<PathBuf>,
    ) -> Result<Value, String> {
        let spec = self.resolve_module_runtime_spec(plugin_id, allowed_workspace_root)?;
        if !cfg.is_plugin_enabled(&spec.plugin_id, spec.default_enabled) {
            return Err(format!("plugin `{}` is disabled", spec.plugin_id));
        }

        self.start_plugin_spec(spec.clone())?;
        let rpc = self
            .processes
            .lock()
            .get(&spec.key)
            .map(|p| Arc::clone(&p.runtime))
            .ok_or_else(|| format!("plugin `{}` is not running", spec.plugin_id))?;
        rpc.call(method, params)
    }

    /// Returns the persistent runtime instance for a plugin workspace.
    ///
    /// # Parameters
    /// - `cfg`: App config snapshot used for enabled-state checks.
    /// - `plugin_id`: Plugin identifier.
    /// - `allowed_workspace_root`: Optional workspace root for host capability confinement.
    ///
    /// # Returns
    /// - `Ok(Arc<dyn PluginRuntimeInstance>)` running runtime instance.
    /// - `Err(String)` when plugin state validation or startup fails.
    pub fn runtime_for_workspace_with_config(
        &self,
        cfg: &AppConfig,
        plugin_id: &str,
        allowed_workspace_root: Option<PathBuf>,
    ) -> Result<Arc<dyn PluginRuntimeInstance>, String> {
        let spec = self.resolve_module_runtime_spec(plugin_id, allowed_workspace_root)?;
        if !cfg.is_plugin_enabled(&spec.plugin_id, spec.default_enabled) {
            return Err(format!("plugin `{}` is disabled", spec.plugin_id));
        }

        self.start_plugin_spec(spec.clone())?;
        self.processes
            .lock()
            .get(&spec.key)
            .map(|p| Arc::clone(&p.runtime))
            .ok_or_else(|| format!("plugin `{}` is not running", spec.plugin_id))
    }

    /// Starts or reuses a runtime for a resolved plugin runtime spec.
    fn start_plugin_spec(&self, spec: ModuleRuntimeSpec) -> Result<(), String> {
        trace!(
            "start_plugin_spec: key='{}', workspace_root={:?}",
            spec.key,
            spec.spawn.allowed_workspace_root
        );

        if let Some(existing) = self.processes.lock().get(&spec.key) {
            debug!(
                "start_plugin_spec: found existing runtime for key='{}'",
                spec.key
            );
            if existing.workspace_root == spec.spawn.allowed_workspace_root {
                trace!("start_plugin_spec: reusing existing runtime with matching workspace");
                return existing.runtime.ensure_running();
            }
            debug!("start_plugin_spec: workspace mismatch, will replace runtime");
        }

        trace!("start_plugin_spec: creating new instance");
        let instance = self.create_instance(&spec)?;
        debug!("start_plugin_spec: instance created, ensuring running");
        instance.ensure_running()?;

        let mut lock = self.processes.lock();
        if let Some(existing) = lock.get(&spec.key) {
            if existing.workspace_root == spec.spawn.allowed_workspace_root {
                let runtime = Arc::clone(&existing.runtime);
                drop(lock);
                trace!("start_plugin_spec: found concurrent insert, reusing");
                return runtime.ensure_running();
            }
        }

        let runtime_to_stop = lock
            .get(&spec.key)
            .map(|existing| Arc::clone(&existing.runtime));
        if let Some(runtime) = runtime_to_stop {
            debug!(
                "start_plugin_spec: stopping old runtime for key='{}'",
                spec.key
            );
            runtime.stop();
            lock.remove(&spec.key);
        }

        trace!(
            "start_plugin_spec: inserting new runtime for key='{}'",
            spec.key
        );
        lock.insert(
            spec.key,
            RunningPlugin {
                runtime: instance,
                workspace_root: spec.spawn.allowed_workspace_root.clone(),
            },
        );
        Ok(())
    }

    /// Creates a runtime instance for a resolved plugin spec.
    fn create_instance(
        &self,
        spec: &ModuleRuntimeSpec,
    ) -> Result<Arc<dyn PluginRuntimeInstance>, String> {
        create_runtime_instance(spec.spawn.clone())
    }

    /// Resolves a plugin id into a module runtime specification.
    fn resolve_module_runtime_spec(
        &self,
        plugin_id: &str,
        allowed_workspace_root: Option<PathBuf>,
    ) -> Result<ModuleRuntimeSpec, String> {
        trace!(
            "resolve_module_runtime_spec: plugin_id='{}', workspace_root={:?}",
            plugin_id,
            allowed_workspace_root
        );

        let requested = plugin_id.trim();
        debug!("resolve_module_runtime_spec: trimmed='{}'", requested);

        if requested.is_empty() {
            return Err("plugin id is empty".to_string());
        }

        trace!("resolve_module_runtime_spec: calling find_components");
        let components = self.find_components(requested)?;
        debug!(
            "resolve_module_runtime_spec: found components for plugin_id='{}', has_module={}",
            components.plugin_id,
            components.module.is_some()
        );

        trace!("resolve_module_runtime_spec: checking module component");
        let module = match &components.module {
            Some(m) => {
                debug!(
                    "resolve_module_runtime_spec: module exec_path='{}'",
                    m.exec_path.display()
                );
                m
            }
            None => {
                warn!(
                    "resolve_module_runtime_spec: plugin '{}' has NO module component",
                    components.plugin_id
                );
                return Err("plugin has no module component".to_string());
            }
        };

        trace!("resolve_module_runtime_spec: getting installed plugin info");
        let installed = self
            .store
            .get_current_installed(&components.plugin_id)?
            .ok_or_else(|| "plugin is not installed".to_string())?;
        debug!(
            "resolve_module_runtime_spec: installed approval={:?}",
            installed.approval
        );

        let key = components.plugin_id.to_ascii_lowercase();
        debug!("resolve_module_runtime_spec: resolved key='{}'", key);

        trace!("resolve_module_runtime_spec: building ModuleRuntimeSpec");
        let exec_path = module.exec_path.clone();
        Ok(ModuleRuntimeSpec {
            plugin_id: components.plugin_id.clone(),
            key,
            default_enabled: components.default_enabled,
            spawn: SpawnConfig {
                plugin_id: components.plugin_id,
                exec_path,
                approval: installed.approval,
                allowed_workspace_root,
            },
        })
    }

    /// Finds installed plugin components by plugin id (case-insensitive).
    fn find_components(&self, plugin_id: &str) -> Result<InstalledPluginComponents, String> {
        trace!("find_components: plugin_id='{}'", plugin_id);

        let all_components = self.store.list_current_components()?;
        debug!(
            "find_components: found {} total components",
            all_components.len()
        );

        let found = all_components
            .into_iter()
            .find(|components| components.plugin_id.eq_ignore_ascii_case(plugin_id));

        match found {
            Some(comp) => {
                debug!("find_components: matched plugin_id='{}'", comp.plugin_id);
                Ok(comp)
            }
            None => {
                warn!("find_components: no plugin found matching '{}'", plugin_id);
                Err("plugin not installed".to_string())
            }
        }
    }
}

impl Drop for PluginRuntimeManager {
    /// Stops all runtimes when the manager is dropped.
    fn drop(&mut self) {
        let running = std::mem::take(&mut *self.processes.get_mut());
        for (_, process) in running {
            process.runtime.stop();
        }
    }
}

/// Normalizes plugin ids to process map keys.
fn normalize_plugin_key(plugin_id: &str) -> Result<String, String> {
    trace!("normalize_plugin_key: input='{}'", plugin_id);
    let plugin_id = plugin_id.trim().to_ascii_lowercase();
    if plugin_id.is_empty() {
        return Err("plugin id is empty".to_string());
    }
    debug!("normalize_plugin_key: output='{}'", plugin_id);
    Ok(plugin_id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::plugin_bundles::{ApprovalState, CurrentPointer, InstalledPluginIndex};
    use crate::plugin_bundles::{InstalledPluginVersion, PluginBundleStore};
    use std::collections::BTreeMap;
    use std::fs;
    use tempfile::tempdir;

    const MINIMAL_WASM: &[u8] = &[
        0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, 0x01, 0x04, 0x01, 0x60, 0x00, 0x00, 0x03,
        0x02, 0x01, 0x00, 0x07, 0x0b, 0x01, 0x06, 0x5f, 0x73, 0x74, 0x61, 0x72, 0x74, 0x00, 0x00,
        0x0a, 0x04, 0x01, 0x02, 0x00, 0x0b,
    ];

    #[test]
    /// Verifies repeated start/stop calls keep runtime state stable.
    fn start_and_stop_are_idempotent() {
        let temp = tempdir().expect("tempdir");
        write_plugin(temp.path(), "test.plugin", true);
        let manager = PluginRuntimeManager::new(PluginBundleStore::new_at(temp.path().into()));

        manager.start_plugin("test.plugin").expect("start");
        manager.start_plugin("TEST.PLUGIN").expect("start twice");
        assert_eq!(manager.processes.lock().len(), 1);

        manager.stop_plugin("test.plugin").expect("stop");
        manager.stop_plugin("test.plugin").expect("stop twice");
        assert!(manager.processes.lock().is_empty());
    }

    #[test]
    /// Verifies sync starts and stops plugins according to config toggles.
    fn sync_tracks_enabled_state() {
        let temp = tempdir().expect("tempdir");
        write_plugin(temp.path(), "alpha.plugin", true);
        write_plugin(temp.path(), "beta.plugin", false);
        let manager = PluginRuntimeManager::new(PluginBundleStore::new_at(temp.path().into()));

        let mut cfg = AppConfig::default();
        cfg.plugins.disabled.clear();
        cfg.plugins.enabled.clear();

        manager
            .sync_plugin_runtime_with_config(&cfg)
            .expect("initial sync");
        assert!(manager.processes.lock().contains_key("alpha.plugin"));
        assert!(!manager.processes.lock().contains_key("beta.plugin"));

        cfg.plugins.disabled = vec!["alpha.plugin".into()];
        cfg.plugins.enabled = vec!["beta.plugin".into()];
        cfg.validate();

        manager
            .sync_plugin_runtime_with_config(&cfg)
            .expect("second sync");
        assert!(!manager.processes.lock().contains_key("alpha.plugin"));
        assert!(manager.processes.lock().contains_key("beta.plugin"));
    }

    #[test]
    /// Verifies runtime start rejects plugins without module components.
    fn start_plugin_rejects_plugins_without_module_component() {
        let temp = tempdir().expect("tempdir");
        write_non_runtime_plugin(temp.path(), "themes.plugin", true);
        let manager = PluginRuntimeManager::new(PluginBundleStore::new_at(temp.path().into()));

        let err = manager
            .start_plugin("themes.plugin")
            .expect_err("expected missing module error");
        assert!(err.contains("plugin has no module component"));
    }

    #[test]
    /// Verifies sync ignores non-runtime plugins without module components.
    fn sync_ignores_plugins_without_module_component() {
        let temp = tempdir().expect("tempdir");
        write_plugin(temp.path(), "runtime.plugin", true);
        write_non_runtime_plugin(temp.path(), "themes.plugin", true);
        let manager = PluginRuntimeManager::new(PluginBundleStore::new_at(temp.path().into()));

        let cfg = AppConfig::default();
        manager
            .sync_plugin_runtime_with_config(&cfg)
            .expect("sync succeeds");

        let running = manager.processes.lock();
        assert!(running.contains_key("runtime.plugin"));
        assert!(!running.contains_key("themes.plugin"));
    }

    /// Writes a minimal module-capable plugin layout into a temp store.
    fn write_plugin(root: &std::path::Path, plugin_id: &str, default_enabled: bool) {
        let plugin_dir = root.join(plugin_id);
        fs::create_dir_all(plugin_dir.join("bin")).expect("create plugin dir");
        fs::write(plugin_dir.join("bin").join("plugin.wasm"), MINIMAL_WASM).expect("write wasm");

        let manifest = serde_json::json!({
            "id": plugin_id,
            "name": "Test Plugin",
            "version": "1.0.0",
            "default_enabled": default_enabled,
            "module": {
                "exec": "plugin.wasm",
                "vcs_backends": []
            }
        });
        fs::write(
            plugin_dir.join("openvcs.plugin.json"),
            serde_json::to_vec_pretty(&manifest).expect("serialize manifest"),
        )
        .expect("write manifest");

        let mut versions = BTreeMap::new();
        versions.insert(
            "1.0.0".to_string(),
            InstalledPluginVersion {
                version: "1.0.0".to_string(),
                bundle_sha256: "sha".to_string(),
                installed_at_unix_ms: 0,
                requested_capabilities: Vec::new(),
                approval: ApprovalState::Approved {
                    capabilities: Vec::new(),
                    approved_at_unix_ms: 0,
                },
            },
        );
        let index = InstalledPluginIndex {
            plugin_id: plugin_id.to_string(),
            current: Some("1.0.0".to_string()),
            versions,
        };
        fs::write(
            plugin_dir.join("index.json"),
            serde_json::to_vec_pretty(&index).expect("serialize index"),
        )
        .expect("write index");

        let current = CurrentPointer {
            version: "1.0.0".to_string(),
        };
        fs::write(
            plugin_dir.join("current.json"),
            serde_json::to_vec_pretty(&current).expect("serialize current"),
        )
        .expect("write current");
    }

    /// Writes a plugin layout with manifest/index but no runtime module.
    fn write_non_runtime_plugin(root: &std::path::Path, plugin_id: &str, default_enabled: bool) {
        let plugin_dir = root.join(plugin_id);
        fs::create_dir_all(&plugin_dir).expect("create plugin dir");

        let manifest = serde_json::json!({
            "id": plugin_id,
            "name": "Theme Plugin",
            "version": "1.0.0",
            "default_enabled": default_enabled
        });
        fs::write(
            plugin_dir.join("openvcs.plugin.json"),
            serde_json::to_vec_pretty(&manifest).expect("serialize manifest"),
        )
        .expect("write manifest");

        let mut versions = BTreeMap::new();
        versions.insert(
            "1.0.0".to_string(),
            InstalledPluginVersion {
                version: "1.0.0".to_string(),
                bundle_sha256: "sha".to_string(),
                installed_at_unix_ms: 0,
                requested_capabilities: Vec::new(),
                approval: ApprovalState::Approved {
                    capabilities: Vec::new(),
                    approved_at_unix_ms: 0,
                },
            },
        );
        let index = InstalledPluginIndex {
            plugin_id: plugin_id.to_string(),
            current: Some("1.0.0".to_string()),
            versions,
        };
        fs::write(
            plugin_dir.join("index.json"),
            serde_json::to_vec_pretty(&index).expect("serialize index"),
        )
        .expect("write index");

        let current = CurrentPointer {
            version: "1.0.0".to_string(),
        };
        fs::write(
            plugin_dir.join("current.json"),
            serde_json::to_vec_pretty(&current).expect("serialize current"),
        )
        .expect("write current");
    }
}
