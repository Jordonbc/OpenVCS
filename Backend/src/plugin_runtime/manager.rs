use crate::plugin_bundles::{InstalledPluginComponents, PluginBundleStore};
use crate::plugin_runtime::instance::PluginRuntimeInstance;
use crate::plugin_runtime::runtime_select::create_runtime_instance;
use crate::plugin_runtime::stdio_rpc::SpawnConfig;
use crate::settings::AppConfig;
use parking_lot::Mutex;
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::sync::Arc;

#[derive(Clone)]
struct ModuleRuntimeSpec {
    plugin_id: String,
    key: String,
    default_enabled: bool,
    spawn: SpawnConfig,
}

/// Owns long-lived module plugin processes and coordinates lifecycle actions.
pub struct PluginRuntimeManager {
    store: PluginBundleStore,
    processes: Mutex<HashMap<String, Arc<dyn PluginRuntimeInstance>>>,
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
        let key = normalize_plugin_key(plugin_id)?;
        if let Some(existing) = self.processes.lock().get(&key).cloned() {
            return existing.ensure_running();
        }
        let spec = self.resolve_module_runtime_spec(plugin_id)?;
        self.start_plugin_spec(spec)
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
        let key = normalize_plugin_key(plugin_id)?;
        let process = self.processes.lock().remove(&key);
        if let Some(process) = process {
            process.stop();
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

        if errors.is_empty() {
            Ok(())
        } else {
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
        let spec = self.resolve_module_runtime_spec(plugin_id)?;
        if !cfg.is_plugin_enabled(&spec.plugin_id, spec.default_enabled) {
            return Err(format!("plugin `{}` is disabled", spec.plugin_id));
        }

        self.start_plugin_spec(spec.clone())?;
        let rpc = self
            .processes
            .lock()
            .get(&spec.key)
            .cloned()
            .ok_or_else(|| format!("plugin `{}` is not running", spec.plugin_id))?;
        rpc.call(method, params)
    }

    fn start_plugin_spec(&self, spec: ModuleRuntimeSpec) -> Result<(), String> {
        if let Some(existing) = self.processes.lock().get(&spec.key).cloned() {
            return existing.ensure_running();
        }

        let instance = self.create_instance(&spec);
        instance.ensure_running()?;

        let mut lock = self.processes.lock();
        if let Some(existing) = lock.get(&spec.key).cloned() {
            drop(lock);
            return existing.ensure_running();
        }
        lock.insert(spec.key, instance);
        Ok(())
    }

    fn create_instance(&self, spec: &ModuleRuntimeSpec) -> Arc<dyn PluginRuntimeInstance> {
        create_runtime_instance(spec.spawn.clone())
    }

    fn resolve_module_runtime_spec(&self, plugin_id: &str) -> Result<ModuleRuntimeSpec, String> {
        let requested = plugin_id.trim();
        if requested.is_empty() {
            return Err("plugin id is empty".to_string());
        }

        let components = self.find_components(requested)?;
        let module = components
            .module
            .ok_or_else(|| "plugin has no module component".to_string())?;
        let installed = self
            .store
            .get_current_installed(&components.plugin_id)?
            .ok_or_else(|| "plugin is not installed".to_string())?;
        let key = components.plugin_id.to_ascii_lowercase();

        Ok(ModuleRuntimeSpec {
            plugin_id: components.plugin_id.clone(),
            key,
            default_enabled: components.default_enabled,
            spawn: SpawnConfig {
                plugin_id: components.plugin_id,
                component_label: "module".into(),
                exec_path: module.exec_path,
                args: Vec::new(),
                requested_capabilities: installed.requested_capabilities,
                approval: installed.approval,
                allowed_workspace_root: None,
            },
        })
    }

    fn find_components(&self, plugin_id: &str) -> Result<InstalledPluginComponents, String> {
        self.store
            .list_current_components()?
            .into_iter()
            .find(|components| components.plugin_id.eq_ignore_ascii_case(plugin_id))
            .ok_or_else(|| "plugin not installed".to_string())
    }
}

fn normalize_plugin_key(plugin_id: &str) -> Result<String, String> {
    let plugin_id = plugin_id.trim().to_ascii_lowercase();
    if plugin_id.is_empty() {
        return Err("plugin id is empty".to_string());
    }
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
