// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later
//! Filesystem-backed installed plugin store.

use crate::logging::LogTimer;
use crate::plugin_manifest::has_package_manifest;
use crate::plugin_paths::{built_in_plugin_dirs, ensure_dir, plugins_dir};
use log::{info, trace, warn};
use std::collections::{BTreeMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};

use super::types::{
    ApprovalState, CurrentPointer, INVALID_PLUGIN_ID, InstalledPlugin, InstalledPluginComponents,
    InstalledPluginIndex, InstalledPluginSourceMetadata, InstalledPluginVersion, MODULE,
    ModuleComponent, ModuleVcsBackend, VcsBackendProvide, acquire_plugin_store_write_lock,
    built_in_plugin_ids, copy_directory_recursive, derive_install_version, normalize_capabilities,
    normalize_exec, normalize_plugin_id, now_unix_ms, platform_exec_name,
    read_manifest_from_plugin_dir, read_plugin_source_metadata, sha256_hex_directory,
    validate_entrypoint, write_plugin_source_metadata,
};

/// Filesystem-backed store for installed plugins.
pub struct PluginBundleStore {
    /// Root directory for the plugin store (public for testing access).
    pub(crate) root: PathBuf,
}

impl PluginBundleStore {
    /// Creates a store rooted at the default plugins directory.
    pub fn new_default() -> Self {
        let root = plugins_dir();
        ensure_dir(&root);
        trace!("PluginBundleStore::new_default: root={}", root.display());
        Self { root }
    }

    #[cfg(test)]
    /// Creates a store rooted at an explicit test directory.
    pub(crate) fn new_at(root: PathBuf) -> Self {
        Self { root }
    }

    /// Installs a prepared plugin directory into the writable plugin store.
    pub fn install_prepared_plugin_dir(
        &self,
        source_dir: &Path,
        source_metadata: &InstalledPluginSourceMetadata,
        auto_approve: bool,
    ) -> Result<InstalledPlugin, String> {
        let _timer = LogTimer::new(MODULE, "install_prepared_plugin_dir");
        let manifest = read_manifest_from_plugin_dir(source_dir)?;
        if manifest.functions.is_some() {
            return Err(
                "manifest uses unsupported field 'functions'; use module.exec only".to_string(),
            );
        }

        let plugin_id = manifest.id.trim().to_string();
        if plugin_id.is_empty() {
            return Err("manifest id is empty".to_string());
        }

        let bundle_sha256 = sha256_hex_directory(source_dir)?;
        let version = derive_install_version(&manifest, &bundle_sha256);
        let requested_capabilities = normalize_capabilities(manifest.capabilities.clone());
        let _lock = acquire_plugin_store_write_lock()?;
        let plugin_dir = self.root.join(&plugin_id);

        if let Some(installed) = self.get_current_installed(&plugin_id)?
            && installed.bundle_sha256 == bundle_sha256
            && installed.version == version
        {
            write_plugin_source_metadata(&plugin_dir, source_metadata)?;
            if auto_approve {
                self.approve_capabilities(&plugin_id, &version, true)?;
            }
            let approval = self
                .get_current_installed(&plugin_id)?
                .map(|current| current.approval)
                .unwrap_or(installed.approval);
            return Ok(InstalledPlugin {
                plugin_id,
                version,
                bundle_sha256,
                requested_capabilities,
                approval,
                install_dir: plugin_dir,
            });
        }

        let staging = self
            .root
            .join(format!(".staging-{}-{}", plugin_id, now_unix_ms()));
        let staging_version_dir = staging.join(&version);
        fs::create_dir_all(&staging_version_dir)
            .map_err(|e| format!("create {}: {e}", staging_version_dir.display()))?;
        copy_directory_recursive(source_dir, &staging_version_dir)?;

        let module_exec = normalize_exec(manifest.module.and_then(|module| module.exec));
        validate_entrypoint(&staging_version_dir, module_exec.as_deref(), "module")?;

        if plugin_dir.exists() {
            fs::remove_dir_all(&plugin_dir)
                .map_err(|e| format!("remove {}: {e}", plugin_dir.display()))?;
        }
        fs::rename(&staging_version_dir, &plugin_dir).map_err(|e| {
            format!(
                "move installed plugin into place {} -> {}: {e}",
                staging_version_dir.display(),
                plugin_dir.display()
            )
        })?;
        if let Err(e) = fs::remove_dir_all(&staging) {
            warn!(
                "install_plugin_dir: failed to remove staging directory '{}': {e}",
                staging.display()
            );
        }
        write_plugin_source_metadata(&plugin_dir, source_metadata)?;

        let approval = if auto_approve {
            ApprovalState::Approved {
                capabilities: requested_capabilities.clone(),
                approved_at_unix_ms: now_unix_ms(),
            }
        } else {
            ApprovalState::Pending
        };

        let mut index = self.read_index(&plugin_id).unwrap_or(InstalledPluginIndex {
            plugin_id: plugin_id.clone(),
            current: None,
            versions: BTreeMap::new(),
        });
        index.current = Some(version.clone());
        index.versions.insert(
            version.clone(),
            InstalledPluginVersion {
                version: version.clone(),
                bundle_sha256: bundle_sha256.clone(),
                installed_at_unix_ms: now_unix_ms(),
                requested_capabilities: requested_capabilities.clone(),
                approval: approval.clone(),
            },
        );
        self.write_index(&plugin_id, &index)?;
        self.write_current(
            &plugin_id,
            &CurrentPointer {
                version: version.clone(),
            },
        )?;

        Ok(InstalledPlugin {
            plugin_id,
            version,
            bundle_sha256,
            requested_capabilities,
            approval,
            install_dir: plugin_dir,
        })
    }

    /// Removes managed plugins that are no longer present in the desired id set.
    pub fn prune_managed_plugins(
        &self,
        managed_by: &str,
        desired_ids: &HashSet<String>,
    ) -> Result<(), String> {
        let _lock = acquire_plugin_store_write_lock()?;
        if !self.root.is_dir() {
            return Ok(());
        }

        let entries =
            fs::read_dir(&self.root).map_err(|e| format!("read {}: {e}", self.root.display()))?;
        for entry in entries {
            let entry = entry.map_err(|e| format!("read entry {}: {e}", self.root.display()))?;
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }
            let Some(plugin_id) = path.file_name().and_then(|value| value.to_str()) else {
                continue;
            };
            let Some(metadata) = read_plugin_source_metadata(&path) else {
                continue;
            };
            if metadata.managed_by.trim() != managed_by {
                continue;
            }
            if desired_ids.contains(&normalize_plugin_id(plugin_id)?) {
                continue;
            }
            fs::remove_dir_all(&path).map_err(|e| format!("remove {}: {e}", path.display()))?;
        }
        Ok(())
    }

    /// Ensures shipped built-in plugin directories are installed and up to date locally.
    pub fn sync_built_in_plugins(&self) -> Result<(), String> {
        let _timer = LogTimer::new(MODULE, "sync_built_in_plugins");
        let plugin_dirs = built_in_plugin_dirs();
        info!(
            "sync_built_in_plugins: syncing {} built-in plugin directories",
            plugin_dirs.len()
        );

        let mut desired_ids = HashSet::new();
        let mut errors = Vec::new();
        for plugin_dir in &plugin_dirs {
            match self.ensure_built_in_plugin_dir(plugin_dir) {
                Ok(installed) => {
                    desired_ids.insert(normalize_plugin_id(&installed.plugin_id)?);
                }
                Err(err) => {
                    let message = format!("{}: {}", plugin_dir.display(), err);
                    warn!("sync_built_in_plugins: failed to sync: {}", message);
                    errors.push(message);
                }
            }
        }

        if errors.is_empty() {
            self.prune_managed_plugins("built-in", &desired_ids)?;
            Ok(())
        } else {
            Err(errors.join("; "))
        }
    }

    /// Installs or updates one built-in plugin directory when needed.
    fn ensure_built_in_plugin_dir(&self, plugin_dir: &Path) -> Result<InstalledPlugin, String> {
        let metadata =
            read_plugin_source_metadata(plugin_dir).unwrap_or(InstalledPluginSourceMetadata {
                managed_by: "built-in".to_string(),
                kind: "built-in-resource".to_string(),
                spec: plugin_dir.display().to_string(),
            });
        self.install_prepared_plugin_dir(plugin_dir, &metadata, true)
    }

    /// Removes an installed non-built-in plugin and all of its versions.
    pub fn uninstall_plugin(&self, plugin_id: &str) -> Result<(), String> {
        let _timer = LogTimer::new(MODULE, "uninstall_plugin");
        let id = plugin_id.trim();
        if id.is_empty() {
            return Err("plugin id is empty".to_string());
        }
        let _lock = acquire_plugin_store_write_lock()?;
        let lower = normalize_plugin_id(id)?;
        if built_in_plugin_ids().contains(&lower) {
            return Err("built-in plugins cannot be removed".to_string());
        }
        let dir = self.root.join(id);
        if !dir.exists() {
            return Ok(());
        }
        fs::remove_dir_all(&dir).map_err(|e| format!("remove {}: {e}", dir.display()))
    }

    /// Lists installed plugin indices discovered from the plugin store root.
    pub fn list_installed(&self) -> Result<Vec<InstalledPluginIndex>, String> {
        if !self.root.is_dir() {
            return Ok(Vec::new());
        }
        let mut out = Vec::new();
        let entries =
            fs::read_dir(&self.root).map_err(|e| format!("read {}: {e}", self.root.display()))?;
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }
            let index_path = path.join("index.json");
            if !index_path.is_file() {
                continue;
            }
            if let Ok(text) = fs::read_to_string(&index_path)
                && let Ok(index) = serde_json::from_str::<InstalledPluginIndex>(&text)
            {
                out.push(index);
            }
        }
        out.sort_by(|a, b| a.plugin_id.cmp(&b.plugin_id));
        Ok(out)
    }

    /// Resolves the filesystem directory for the current version of a plugin.
    pub fn get_current_dir(&self, plugin_id: &str) -> Result<Option<PathBuf>, String> {
        let id = plugin_id.trim();
        if id.is_empty() {
            return Err(INVALID_PLUGIN_ID.to_string());
        }
        let plugin_dir = self.root.join(id);
        let current_path = plugin_dir.join("current.json");
        if !current_path.is_file() {
            return Ok(None);
        }
        let text = fs::read_to_string(&current_path)
            .map_err(|e| format!("read {}: {e}", current_path.display()))?;
        let cur: CurrentPointer = serde_json::from_str(&text)
            .map_err(|e| format!("parse {}: {e}", current_path.display()))?;
        let version_dir = plugin_dir.join(cur.version);
        if version_dir.is_dir() {
            Ok(Some(version_dir))
        } else if has_package_manifest(&plugin_dir) {
            Ok(Some(plugin_dir))
        } else {
            Ok(None)
        }
    }

    /// Returns metadata for the currently selected plugin version, if present.
    pub fn get_current_installed(
        &self,
        plugin_id: &str,
    ) -> Result<Option<InstalledPluginVersion>, String> {
        let Some(index) = self.read_index(plugin_id) else {
            return Ok(None);
        };
        let Some(version) = index.current.as_deref() else {
            return Ok(None);
        };
        Ok(index.versions.get(version).cloned())
    }

    /// Updates capability approval for a specific plugin version.
    pub fn approve_capabilities(
        &self,
        plugin_id: &str,
        version: &str,
        approved: bool,
    ) -> Result<(), String> {
        let mut index = self
            .read_index(plugin_id)
            .ok_or_else(|| "plugin is not installed".to_string())?;
        let ver = version.trim();
        let Some(current) = index.versions.get_mut(ver) else {
            return Err("version is not installed".to_string());
        };
        current.approval = if approved {
            ApprovalState::Approved {
                capabilities: current.requested_capabilities.clone(),
                approved_at_unix_ms: now_unix_ms(),
            }
        } else {
            ApprovalState::Denied {
                denied_at_unix_ms: now_unix_ms(),
                reason: None,
            }
        };
        self.write_index(plugin_id, &index)
    }

    /// Loads resolved components for the current plugin version.
    pub fn load_current_components(
        &self,
        plugin_id: &str,
    ) -> Result<Option<InstalledPluginComponents>, String> {
        let Some(version_dir) = self.get_current_dir(plugin_id)? else {
            return Ok(None);
        };
        let manifest = read_manifest_from_plugin_dir(&version_dir)?;
        if manifest.functions.is_some() {
            return Err(
                "manifest uses unsupported field 'functions'; use module.exec only".to_string(),
            );
        }

        let id = manifest.id.trim().to_string();
        if id.is_empty() {
            return Err("manifest id is empty".to_string());
        }
        if id != plugin_id.trim() {
            return Err(format!(
                "manifest id '{}' does not match installed plugin id '{}'",
                id,
                plugin_id.trim()
            ));
        }

        let module = manifest.module.and_then(|module| {
            let exec = module.exec?.trim().to_string();
            if exec.is_empty() {
                return None;
            }
            let exec_path = version_dir.join("bin").join(platform_exec_name(&exec));
            Some(ModuleComponent {
                exec,
                exec_path,
                vcs_backends: module
                    .vcs_backends
                    .into_iter()
                    .filter_map(|backend| match backend {
                        VcsBackendProvide::Id(id) => {
                            let id = id.trim().to_string();
                            (!id.is_empty()).then_some(ModuleVcsBackend {
                                id,
                                name: None,
                                action_labels: BTreeMap::new(),
                            })
                        }
                        VcsBackendProvide::Named {
                            id,
                            name,
                            action_labels,
                        } => {
                            let id = id.trim().to_string();
                            if id.is_empty() {
                                return None;
                            }
                            let name = name
                                .as_deref()
                                .map(str::trim)
                                .filter(|value| !value.is_empty())
                                .map(str::to_string);
                            Some(ModuleVcsBackend {
                                id,
                                name,
                                action_labels,
                            })
                        }
                    })
                    .collect(),
            })
        });

        if let Some(module) = &module {
            validate_entrypoint(&version_dir, Some(&module.exec), "module")?;
        }

        Ok(Some(InstalledPluginComponents {
            plugin_id: id,
            name: manifest
                .name
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty()),
            default_enabled: manifest.default_enabled,
            module,
        }))
    }

    /// Lists resolved components for every plugin with a valid current version.
    pub fn list_current_components(&self) -> Result<Vec<InstalledPluginComponents>, String> {
        if !self.root.is_dir() {
            return Ok(Vec::new());
        }
        let entries =
            fs::read_dir(&self.root).map_err(|e| format!("read {}: {e}", self.root.display()))?;
        let mut out = Vec::new();
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }
            let Some(plugin_id) = path.file_name().and_then(|value| value.to_str()) else {
                continue;
            };
            match self.load_current_components(plugin_id) {
                Ok(Some(components)) => out.push(components),
                Ok(None) => {}
                Err(err) => warn!(
                    "list_current_components: skipping invalid plugin '{}': {}",
                    plugin_id, err
                ),
            }
        }
        out.sort_by(|a, b| a.plugin_id.cmp(&b.plugin_id));
        Ok(out)
    }

    /// Reads plugin index metadata from disk.
    fn read_index(&self, plugin_id: &str) -> Option<InstalledPluginIndex> {
        let path = self.root.join(plugin_id).join("index.json");
        let text = fs::read_to_string(&path).ok()?;
        serde_json::from_str(&text).ok()
    }

    /// Writes plugin index metadata atomically.
    fn write_index(&self, plugin_id: &str, index: &InstalledPluginIndex) -> Result<(), String> {
        let path = self.root.join(plugin_id).join("index.json");
        let tmp = path.with_extension("json.tmp");
        let text =
            serde_json::to_string_pretty(index).map_err(|e| format!("serialize index: {e}"))?;
        fs::write(&tmp, text).map_err(|e| format!("write {}: {e}", tmp.display()))?;
        fs::rename(&tmp, &path).map_err(|e| format!("rename {}: {e}", path.display()))
    }

    /// Writes current-version pointer atomically.
    fn write_current(&self, plugin_id: &str, cur: &CurrentPointer) -> Result<(), String> {
        let path = self.root.join(plugin_id).join("current.json");
        let tmp = path.with_extension("json.tmp");
        let text =
            serde_json::to_string_pretty(cur).map_err(|e| format!("serialize current: {e}"))?;
        fs::write(&tmp, text).map_err(|e| format!("write {}: {e}", tmp.display()))?;
        fs::rename(&tmp, &path).map_err(|e| format!("rename {}: {e}", path.display()))
    }
}
