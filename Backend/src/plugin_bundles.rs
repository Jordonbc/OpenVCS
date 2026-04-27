// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later
//! Installed plugin indexing, synchronization, and component discovery.

use crate::logging::LogTimer;
use crate::plugin_manifest::{has_package_manifest, read_openvcs_manifest};
use crate::plugin_paths::{built_in_plugin_dirs, ensure_dir, plugins_dir};
use log::{info, trace, warn};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, HashSet};
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard, OnceLock};

const MODULE: &str = "plugin_bundles";
const INVALID_PLUGIN_ID: &str = "plugin id is empty";
/// File name used for plugin source metadata.
pub const PLUGIN_SOURCE_METADATA_NAME: &str = "source.json";

/// Normalizes a plugin id for comparisons and map keys.
///
/// # Parameters
/// - `plugin_id`: Raw plugin id string.
///
/// # Returns
/// - `Ok(String)` lowercase normalized plugin id.
/// - `Err(String)` when the id is empty.
pub fn normalize_plugin_id(plugin_id: &str) -> Result<String, String> {
    let normalized = plugin_id.trim().to_ascii_lowercase();
    if normalized.is_empty() {
        Err(INVALID_PLUGIN_ID.to_string())
    } else {
        Ok(normalized)
    }
}

/// Legacy approval state recorded for an installed plugin version.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ApprovalState {
    Pending,
    Approved {
        #[serde(default)]
        capabilities: Vec<String>,
        approved_at_unix_ms: u64,
    },
    Denied {
        denied_at_unix_ms: u64,
        #[serde(default)]
        reason: Option<String>,
    },
}

/// Versioned installation metadata for a plugin.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InstalledPluginVersion {
    pub version: String,
    pub bundle_sha256: String,
    pub installed_at_unix_ms: u64,
    #[serde(default)]
    pub requested_capabilities: Vec<String>,
    pub approval: ApprovalState,
}

/// Persisted plugin index stored under `<plugin>/index.json`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InstalledPluginIndex {
    pub plugin_id: String,
    #[serde(default)]
    pub current: Option<String>,
    #[serde(default)]
    pub versions: BTreeMap<String, InstalledPluginVersion>,
}

/// Pointer to the active installed version stored in `current.json`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CurrentPointer {
    pub version: String,
}

/// Result metadata returned after installing a plugin.
#[derive(Debug, Clone, Serialize)]
pub struct InstalledPlugin {
    pub plugin_id: String,
    pub version: String,
    pub bundle_sha256: String,
    #[serde(default)]
    pub requested_capabilities: Vec<String>,
    pub approval: ApprovalState,
    pub install_dir: PathBuf,
}

/// Persisted source metadata for an installed plugin.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct InstalledPluginSourceMetadata {
    /// Manager responsible for reconciling the plugin.
    pub managed_by: String,
    /// Source kind such as `npm`, `path`, or `built-in-resource`.
    pub kind: String,
    /// Original config or build spec used to resolve the plugin.
    pub spec: String,
}

/// Manifest representation of backend declarations in `package.json#openvcs`.
#[derive(Debug, Deserialize)]
#[serde(untagged)]
pub enum VcsBackendProvide {
    Id(String),
    Named {
        id: String,
        #[serde(default)]
        name: Option<String>,
        #[serde(default)]
        action_labels: BTreeMap<String, String>,
    },
}

/// Manifest module component declaration.
#[derive(Debug, Deserialize)]
pub struct PluginManifestModule {
    #[serde(default)]
    pub exec: Option<String>,
    #[serde(default)]
    pub vcs_backends: Vec<VcsBackendProvide>,
}

/// Parsed plugin manifest payload.
#[derive(Debug, Deserialize)]
pub struct PluginManifest {
    pub id: String,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub version: Option<String>,
    #[serde(default)]
    pub default_enabled: bool,
    #[serde(default)]
    pub capabilities: Vec<String>,
    #[serde(default)]
    pub module: Option<PluginManifestModule>,
    #[serde(default)]
    pub functions: Option<serde_json::Value>,
}

/// Filesystem-backed store for installed plugins.
pub struct PluginBundleStore {
    root: PathBuf,
}

/// Installed VCS backend metadata resolved from a plugin module.
#[derive(Debug, Clone)]
pub struct ModuleVcsBackend {
    /// Logical backend identifier.
    pub id: String,
    /// Optional human-readable backend name.
    pub name: Option<String>,
    /// Optional action-label map keyed by namespaced VCS actions.
    pub action_labels: BTreeMap<String, String>,
}

/// Installed module component metadata and resolved executable path.
#[derive(Debug, Clone)]
pub struct ModuleComponent {
    pub exec: String,
    pub exec_path: PathBuf,
    pub vcs_backends: Vec<ModuleVcsBackend>,
}

/// Active component metadata for a plugin selected by `current.json`.
#[derive(Debug, Clone)]
pub struct InstalledPluginComponents {
    pub plugin_id: String,
    pub name: Option<String>,
    pub default_enabled: bool,
    pub module: Option<ModuleComponent>,
}

/// Returns current Unix timestamp in milliseconds.
fn now_unix_ms() -> u64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

/// Computes a deterministic SHA-256 digest for a directory tree.
fn sha256_hex_directory(root: &Path) -> Result<String, String> {
    let mut files = Vec::new();
    collect_directory_files(root, root, &mut files)?;
    files.sort();

    let mut hasher = Sha256::new();
    for relative in files {
        hasher.update(relative.to_string_lossy().as_bytes());
        let full_path = root.join(&relative);
        let mut file =
            fs::File::open(&full_path).map_err(|e| format!("open {}: {e}", full_path.display()))?;
        let mut buf = [0u8; 8192];
        loop {
            let n = file
                .read(&mut buf)
                .map_err(|e| format!("read {}: {e}", full_path.display()))?;
            if n == 0 {
                break;
            }
            hasher.update(&buf[..n]);
        }
    }
    Ok(hex::encode(hasher.finalize()))
}

/// Collects all regular files under a directory tree.
fn collect_directory_files(
    root: &Path,
    current: &Path,
    out: &mut Vec<PathBuf>,
) -> Result<(), String> {
    let entries = fs::read_dir(current).map_err(|e| format!("read {}: {e}", current.display()))?;
    for entry in entries {
        let entry = entry.map_err(|e| format!("read entry {}: {e}", current.display()))?;
        let path = entry.path();
        let metadata =
            fs::symlink_metadata(&path).map_err(|e| format!("metadata {}: {e}", path.display()))?;
        if metadata.file_type().is_symlink() {
            return Err(format!(
                "plugin directory contains unsupported symlink: {}",
                path.display()
            ));
        }
        if metadata.is_dir() {
            collect_directory_files(root, &path, out)?;
            continue;
        }
        if metadata.is_file() {
            let relative = path
                .strip_prefix(root)
                .map_err(|e| format!("strip prefix {}: {e}", path.display()))?;
            out.push(relative.to_path_buf());
        }
    }
    Ok(())
}

/// Copies a plugin directory recursively without following symlinks.
fn copy_directory_recursive(source: &Path, dest: &Path) -> Result<(), String> {
    fs::create_dir_all(dest).map_err(|e| format!("create {}: {e}", dest.display()))?;
    let entries = fs::read_dir(source).map_err(|e| format!("read {}: {e}", source.display()))?;
    for entry in entries {
        let entry = entry.map_err(|e| format!("read entry {}: {e}", source.display()))?;
        let source_path = entry.path();
        let dest_path = dest.join(entry.file_name());
        let metadata = fs::symlink_metadata(&source_path)
            .map_err(|e| format!("metadata {}: {e}", source_path.display()))?;
        if metadata.file_type().is_symlink() {
            return Err(format!(
                "plugin directory contains unsupported symlink: {}",
                source_path.display()
            ));
        }
        if metadata.is_dir() {
            copy_directory_recursive(&source_path, &dest_path)?;
            continue;
        }
        if metadata.is_file() {
            fs::copy(&source_path, &dest_path)
                .map_err(|e| format!("copy {}: {e}", source_path.display()))?;
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                let _ = fs::set_permissions(
                    &dest_path,
                    fs::Permissions::from_mode(metadata.permissions().mode()),
                );
            }
        }
    }
    Ok(())
}

/// Reads source metadata from an installed plugin root when available.
pub fn read_plugin_source_metadata(plugin_root: &Path) -> Option<InstalledPluginSourceMetadata> {
    let metadata_path = plugin_root.join(PLUGIN_SOURCE_METADATA_NAME);
    let text = fs::read_to_string(&metadata_path).ok()?;
    serde_json::from_str(&text).ok()
}

/// Writes source metadata next to an installed plugin root.
fn write_plugin_source_metadata(
    plugin_root: &Path,
    metadata: &InstalledPluginSourceMetadata,
) -> Result<(), String> {
    let metadata_path = plugin_root.join(PLUGIN_SOURCE_METADATA_NAME);
    let text = serde_json::to_string_pretty(metadata)
        .map_err(|e| format!("serialize {}: {e}", metadata_path.display()))?;
    fs::write(&metadata_path, format!("{text}\n"))
        .map_err(|e| format!("write {}: {e}", metadata_path.display()))
}

/// Reads a plugin manifest from a prepared plugin directory.
fn read_manifest_from_plugin_dir(plugin_dir: &Path) -> Result<PluginManifest, String> {
    read_openvcs_manifest(plugin_dir)
}

/// Chooses an install version string from manifest version or content hash.
fn derive_install_version(manifest: &PluginManifest, bundle_sha256: &str) -> String {
    manifest
        .version
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| format!("sha256-{}", &bundle_sha256[..12]))
}

/// Normalizes capability identifiers.
fn normalize_capabilities(mut caps: Vec<String>) -> Vec<String> {
    for cap in &mut caps {
        *cap = cap.trim().to_string();
    }
    caps.retain(|cap| !cap.is_empty());
    caps.sort();
    caps.dedup();
    caps
}

/// Normalizes optional exec name values.
fn normalize_exec(exec: Option<String>) -> Option<String> {
    exec.map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

/// Applies platform-specific executable naming.
fn platform_exec_name(base: &str) -> String {
    base.to_string()
}

/// Validates that a declared entrypoint exists and is a Node module.
fn validate_entrypoint(version_dir: &Path, exec: Option<&str>, label: &str) -> Result<(), String> {
    let Some(exec) = exec else {
        return Ok(());
    };
    let trimmed = exec.trim();
    if trimmed.is_empty() {
        return Ok(());
    }

    let lower = trimmed.to_ascii_lowercase();
    if !(lower.ends_with(".js") || lower.ends_with(".mjs") || lower.ends_with(".cjs")) {
        return Err(format!(
            "{} entrypoint must be a .js/.mjs/.cjs Node module, got: {}",
            label, trimmed
        ));
    }

    let path = version_dir.join("bin").join(platform_exec_name(trimmed));
    if !path.is_file() {
        return Err(format!(
            "{} entrypoint is missing: {}",
            label,
            path.display()
        ));
    }

    Ok(())
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

        if let Some(installed) = self.get_current_installed(&plugin_id)? {
            if installed.bundle_sha256 == bundle_sha256 && installed.version == version {
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
        let _ = fs::remove_dir_all(&staging);
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
            if let Ok(text) = fs::read_to_string(&index_path) {
                if let Ok(index) = serde_json::from_str::<InstalledPluginIndex>(&text) {
                    out.push(index);
                }
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

static BUILT_IN_PLUGIN_IDS: OnceLock<HashSet<String>> = OnceLock::new();
static PLUGIN_STORE_WRITE_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

/// Returns the shared lock used to serialize plugin store mutations.
fn plugin_store_write_lock() -> &'static Mutex<()> {
    PLUGIN_STORE_WRITE_LOCK.get_or_init(|| Mutex::new(()))
}

/// Acquires the shared plugin store write lock.
fn acquire_plugin_store_write_lock() -> Result<MutexGuard<'static, ()>, String> {
    plugin_store_write_lock()
        .lock()
        .map_err(|_| "plugin store write lock is poisoned".to_string())
}

/// Returns the set of built-in plugin identifiers normalized to lowercase.
pub fn built_in_plugin_ids() -> &'static HashSet<String> {
    BUILT_IN_PLUGIN_IDS.get_or_init(read_built_in_plugin_ids)
}

/// Reads built-in plugin ids from bundled plugin directories.
fn read_built_in_plugin_ids() -> HashSet<String> {
    let mut out = HashSet::new();
    for plugin_dir in built_in_plugin_dirs() {
        let manifest = match read_manifest_from_plugin_dir(&plugin_dir) {
            Ok(manifest) => manifest,
            Err(err) => {
                warn!(
                    "plugins: failed to locate manifest in built-in plugin {}: {}",
                    plugin_dir.display(),
                    err
                );
                continue;
            }
        };
        let id = manifest.id.trim();
        if !id.is_empty() {
            if let Ok(normalized) = normalize_plugin_id(id) {
                out.insert(normalized);
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    /// Writes a minimal prepared plugin directory for tests.
    fn write_plugin(root: &Path, plugin_id: &str) {
        fs::create_dir_all(root.join("bin")).unwrap();
        fs::write(
            root.join("package.json"),
            format!(
                "{{\n  \"name\": \"{plugin_id}\",\n  \"version\": \"0.1.0\",\n  \"openvcs\": {{\n    \"id\": \"{plugin_id}\",\n    \"name\": \"Test\",\n    \"version\": \"0.1.0\",\n    \"module\": {{ \"exec\": \"plugin.js\" }}\n  }}\n}}\n"
            ),
        )
        .unwrap();
        fs::write(root.join("bin").join("plugin.js"), "export {};\n").unwrap();
    }

    /// Writes a prepared plugin directory with backend action labels.
    fn write_plugin_with_labels(root: &Path, plugin_id: &str) {
        fs::create_dir_all(root.join("bin")).unwrap();
        fs::write(
            root.join("package.json"),
            format!(
                "{{\n  \"name\": \"{plugin_id}\",\n  \"version\": \"0.1.0\",\n  \"openvcs\": {{\n    \"id\": \"{plugin_id}\",\n    \"name\": \"Test\",\n    \"version\": \"0.1.0\",\n    \"module\": {{\n      \"exec\": \"plugin.js\",\n      \"vcs_backends\": [{{\n        \"id\": \"git\",\n        \"name\": \"Git\",\n        \"action_labels\": {{\n          \"VCS.Commit\": \"Commit\",\n          \"VCS.Push\": \"Push\"\n        }}\n      }}]\n    }}\n  }}\n}}\n"
            ),
        )
        .unwrap();
        fs::write(root.join("bin").join("plugin.js"), "export {};\n").unwrap();
    }

    #[test]
    fn install_prepared_plugin_dir_writes_index_and_source() {
        let dir = tempdir().unwrap();
        let store = PluginBundleStore::new_at(dir.path().join("plugins"));
        let prepared = dir.path().join("prepared");
        write_plugin(&prepared, "example.plugin");

        let installed = store
            .install_prepared_plugin_dir(
                &prepared,
                &InstalledPluginSourceMetadata {
                    managed_by: "user-config".to_string(),
                    kind: "path".to_string(),
                    spec: "../example".to_string(),
                },
                true,
            )
            .unwrap();

        assert_eq!(installed.plugin_id, "example.plugin");
        assert!(store.get_current_dir("example.plugin").unwrap().is_some());
        assert!(
            read_plugin_source_metadata(&store.root.join("example.plugin"))
                .is_some_and(|metadata| metadata.kind == "path")
        );
    }

    #[test]
    fn load_current_components_reads_backend_action_labels() {
        let dir = tempdir().unwrap();
        let store = PluginBundleStore::new_at(dir.path().join("plugins"));
        let prepared = dir.path().join("prepared");
        write_plugin_with_labels(&prepared, "example.plugin");

        store
            .install_prepared_plugin_dir(
                &prepared,
                &InstalledPluginSourceMetadata {
                    managed_by: "user-config".to_string(),
                    kind: "path".to_string(),
                    spec: "../example".to_string(),
                },
                true,
            )
            .unwrap();

        let components = store.load_current_components("example.plugin").unwrap();
        let module = components.and_then(|c| c.module).expect("module component");
        let backend = module
            .vcs_backends
            .into_iter()
            .find(|backend| backend.id == "git")
            .expect("git backend");
        assert_eq!(backend.name.as_deref(), Some("Git"));
        assert_eq!(
            backend.action_labels.get("VCS.Commit").map(String::as_str),
            Some("Commit")
        );
        assert_eq!(
            backend.action_labels.get("VCS.Push").map(String::as_str),
            Some("Push")
        );
    }
}
