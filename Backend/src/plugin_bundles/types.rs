// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later
//! Plugin bundle type definitions, helpers, and shared primitives.

use log::warn;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, HashSet};
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard, OnceLock};

pub(crate) const MODULE: &str = "plugin_bundles";
pub(crate) const INVALID_PLUGIN_ID: &str = "plugin id is empty";
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
pub(crate) fn now_unix_ms() -> u64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

/// Computes a deterministic SHA-256 digest for a directory tree.
pub(crate) fn sha256_hex_directory(root: &Path) -> Result<String, String> {
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
pub(crate) fn copy_directory_recursive(source: &Path, dest: &Path) -> Result<(), String> {
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
                if let Err(e) = fs::set_permissions(
                    &dest_path,
                    fs::Permissions::from_mode(metadata.permissions().mode()),
                ) {
                    warn!(
                        "copy_recursive: failed to set permissions on '{}': {e}",
                        dest_path.display()
                    );
                }
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
pub(crate) fn write_plugin_source_metadata(
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
pub(crate) fn read_manifest_from_plugin_dir(plugin_dir: &Path) -> Result<PluginManifest, String> {
    crate::plugin_manifest::read_openvcs_manifest(plugin_dir)
}

/// Chooses an install version string from manifest version or content hash.
pub(crate) fn derive_install_version(manifest: &PluginManifest, bundle_sha256: &str) -> String {
    manifest
        .version
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| format!("sha256-{}", &bundle_sha256[..12]))
}

/// Normalizes capability identifiers.
pub(crate) fn normalize_capabilities(mut caps: Vec<String>) -> Vec<String> {
    for cap in &mut caps {
        *cap = cap.trim().to_string();
    }
    caps.retain(|cap| !cap.is_empty());
    caps.sort();
    caps.dedup();
    caps
}

/// Normalizes optional exec name values.
pub(crate) fn normalize_exec(exec: Option<String>) -> Option<String> {
    exec.map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

/// Applies platform-specific executable naming.
pub(crate) fn platform_exec_name(base: &str) -> String {
    base.to_string()
}

/// Validates that a declared entrypoint exists and is a Node module.
pub(crate) fn validate_entrypoint(
    version_dir: &Path,
    exec: Option<&str>,
    label: &str,
) -> Result<(), String> {
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

static BUILT_IN_PLUGIN_IDS: OnceLock<HashSet<String>> = OnceLock::new();
static PLUGIN_STORE_WRITE_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

/// Returns the shared lock used to serialize plugin store mutations.
fn plugin_store_write_lock() -> &'static Mutex<()> {
    PLUGIN_STORE_WRITE_LOCK.get_or_init(|| Mutex::new(()))
}

/// Acquires the shared plugin store write lock.
pub(crate) fn acquire_plugin_store_write_lock() -> Result<MutexGuard<'static, ()>, String> {
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
    for plugin_dir in crate::plugin_paths::built_in_plugin_dirs() {
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
        if !id.is_empty()
            && let Ok(normalized) = normalize_plugin_id(id)
        {
            out.insert(normalized);
        }
    }
    out
}
