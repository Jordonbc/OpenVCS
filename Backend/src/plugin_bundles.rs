// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later
//! Plugin bundle installation, indexing, and component discovery.

use crate::logging::LogTimer;
use crate::plugin_paths::{built_in_plugin_dirs, ensure_dir, plugins_dir, PLUGIN_MANIFEST_NAME};
use flate2::read::GzDecoder;
use log::{debug, error, info, trace, warn};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, HashSet};
use std::fs;
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Component, Path, PathBuf};
use std::sync::OnceLock;

const MODULE: &str = "plugin_bundles";
const GZIP_MAGIC: [u8; 2] = [0x1F, 0x8B];

/// Opens a plugin bundle as a decompressed tar reader.
///
/// `.ovcsp` bundles are gzip-compressed tar archives.
///
/// # Parameters
/// - `bundle_path`: Bundle file path.
///
/// # Returns
/// - `Ok(Box<dyn Read>)` with a decompressed tar stream.
/// - `Err(String)` when the bundle cannot be opened or has an unknown format.
fn open_bundle_reader(bundle_path: &Path) -> Result<Box<dyn Read>, String> {
    let mut file =
        fs::File::open(bundle_path).map_err(|e| format!("open {}: {e}", bundle_path.display()))?;
    let mut magic = [0u8; 6];
    let read = file
        .read(&mut magic)
        .map_err(|e| format!("read {}: {e}", bundle_path.display()))?;
    file.seek(SeekFrom::Start(0))
        .map_err(|e| format!("seek {}: {e}", bundle_path.display()))?;

    if read >= GZIP_MAGIC.len() && magic[..GZIP_MAGIC.len()] == GZIP_MAGIC {
        return Ok(Box::new(GzDecoder::new(file)));
    }
    Err(format!(
        "unsupported bundle compression in {}",
        bundle_path.display()
    ))
}

/// Opens a plugin bundle as a tar archive.
///
/// # Parameters
/// - `bundle_path`: Bundle file path.
///
/// # Returns
/// - `Ok(tar::Archive<...>)` when the bundle format is supported.
/// - `Err(String)` when the bundle cannot be decoded.
fn open_bundle_archive(bundle_path: &Path) -> Result<tar::Archive<Box<dyn Read>>, String> {
    let reader = open_bundle_reader(bundle_path)?;
    Ok(tar::Archive::new(reader))
}

/// Safety and resource limits enforced during bundle extraction.
#[derive(Debug, Clone, Copy)]
pub struct InstallerLimits {
    /// Maximum number of files allowed in an extracted bundle.
    pub max_files: u64,
    /// Maximum size of an individual extracted file.
    pub max_file_bytes: u64,
    /// Maximum total extracted bytes for a bundle.
    pub max_total_bytes: u64,
    /// Maximum accepted expansion ratio between compressed and uncompressed bytes.
    pub max_compression_ratio: u64,
}

impl Default for InstallerLimits {
    /// Returns default installer safety limits.
    ///
    /// # Returns
    /// - Default [`InstallerLimits`] values.
    fn default() -> Self {
        Self {
            max_files: 50_000,
            max_file_bytes: 64 * 1024 * 1024,
            max_total_bytes: 512 * 1024 * 1024,
            max_compression_ratio: 200,
        }
    }
}

/// Legacy approval status for an installed plugin version.
///
/// Node runtime currently operates in trust mode and auto-approves installs.
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

/// Result metadata returned after installing a plugin bundle.
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

/// Manifest representation of backend declarations in `openvcs.plugin.json`.
#[derive(Debug, Deserialize)]
#[serde(untagged)]
pub enum VcsBackendProvide {
    Id(String),
    Named {
        id: String,
        #[serde(default)]
        name: Option<String>,
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

/// Returns current Unix timestamp in milliseconds.
///
/// # Returns
/// - Millisecond Unix timestamp.
fn now_unix_ms() -> u64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

/// Computes SHA-256 hex digest for a file.
///
/// # Parameters
/// - `path`: File path.
///
/// # Returns
/// - `Ok(String)` lowercase hex digest.
/// - `Err(String)` when file IO fails.
fn sha256_hex_file(path: &Path) -> Result<String, String> {
    let mut f = fs::File::open(path).map_err(|e| format!("open {}: {e}", path.display()))?;
    let mut hasher = Sha256::new();
    let mut buf = [0u8; 8192];
    loop {
        let n = f
            .read(&mut buf)
            .map_err(|e| format!("read {}: {e}", path.display()))?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Ok(hex::encode(hasher.finalize()))
}

/// Validates and normalizes a tar entry path to prevent path traversal.
///
/// # Parameters
/// - `name`: Raw tar entry path.
///
/// # Returns
/// - `Ok(PathBuf)` sanitized relative path.
/// - `Err(String)` when path is unsafe.
fn sanitize_tar_name(name: &str) -> Result<PathBuf, String> {
    if name.contains('\0') {
        return Err("tar entry contains NUL".to_string());
    }
    let normalized = name.replace('\\', "/");
    if normalized.starts_with('/') {
        return Err(format!("tar entry has an absolute path: {name}"));
    }
    if normalized.len() >= 2 && normalized.as_bytes()[1] == b':' {
        return Err(format!("tar entry has a drive prefix: {name}"));
    }
    let p = Path::new(&normalized);

    for c in p.components() {
        match c {
            Component::Prefix(_) | Component::RootDir => {
                return Err(format!("tar entry has an absolute path: {name}"));
            }
            Component::ParentDir => {
                return Err(format!("tar entry contains '..': {name}"));
            }
            _ => {}
        }
    }

    Ok(p.to_path_buf())
}

/// Filesystem-backed store for installed plugin bundles.
pub struct PluginBundleStore {
    root: PathBuf,
}

/// Installed module component metadata and resolved executable path.
#[derive(Debug, Clone)]
pub struct ModuleComponent {
    pub exec: String,
    pub exec_path: PathBuf,
    pub vcs_backends: Vec<(String, Option<String>)>,
}

/// Active component metadata for a plugin selected by `current.json`.
#[derive(Debug, Clone)]
pub struct InstalledPluginComponents {
    pub plugin_id: String,
    pub name: Option<String>,
    pub default_enabled: bool,
    pub module: Option<ModuleComponent>,
}

impl PluginBundleStore {
    /// Creates a store rooted at the default plugins directory.
    ///
    /// # Returns
    /// - A [`PluginBundleStore`] rooted at [`plugins_dir`].
    pub fn new_default() -> Self {
        let root = plugins_dir();
        ensure_dir(&root);
        trace!("PluginBundleStore::new_default: root={}", root.display());
        Self { root }
    }

    #[cfg(test)]
    /// Creates a store rooted at an explicit test directory.
    ///
    /// # Parameters
    /// - `root`: Store root path.
    ///
    /// # Returns
    /// - Store instance rooted at `root`.
    pub(crate) fn new_at(root: PathBuf) -> Self {
        Self { root }
    }

    /// Installs a `.ovcsp` bundle using default installer limits.
    ///
    /// # Parameters
    /// - `bundle_path`: Path to the plugin bundle archive.
    ///
    /// # Returns
    /// - `Ok(InstalledPlugin)` with installed metadata.
    /// - `Err(String)` when validation, extraction, or index updates fail.
    pub fn install_ovcsp(&self, bundle_path: &Path) -> Result<InstalledPlugin, String> {
        self.install_ovcsp_with_limits(bundle_path, InstallerLimits::default())
    }

    /// Installs a `.ovcsp` bundle and validates extraction against provided limits.
    ///
    /// # Parameters
    /// - `bundle_path`: Path to the plugin bundle archive.
    /// - `limits`: Extraction and compression safety limits to enforce.
    ///
    /// # Returns
    /// - `Ok(InstalledPlugin)` with installed metadata and resolved install directory.
    /// - `Err(String)` when bundle structure is invalid or filesystem operations fail.
    pub fn install_ovcsp_with_limits(
        &self,
        bundle_path: &Path,
        limits: InstallerLimits,
    ) -> Result<InstalledPlugin, String> {
        let _timer = LogTimer::new(MODULE, "install_ovcsp_with_limits");
        let start = std::time::Instant::now();
        info!(
            "install_ovcsp_with_limits: bundle={}",
            bundle_path.display()
        );
        debug!(
            "install_ovcsp_with_limits: limits={{max_files={}, max_file_bytes={}, max_total_bytes={}}}", limits.max_files, limits.max_file_bytes, limits.max_total_bytes
        );

        if !bundle_path.is_file() {
            error!(
                "install_ovcsp_with_limits: bundle is not a file: {}",
                bundle_path.display()
            );
            return Err(format!("bundle is not a file: {}", bundle_path.display()));
        }

        fs::create_dir_all(&self.root).map_err(|e| {
            error!(
                "install_ovcsp_with_limits: failed to create {}: {}",
                self.root.display(),
                e
            );
            format!("create {}: {e}", self.root.display())
        })?;

        let bundle_sha256 = sha256_hex_file(bundle_path)?;
        let bundle_compressed_bytes = fs::metadata(bundle_path)
            .map_err(|e| {
                error!("install_ovcsp_with_limits: failed to get metadata: {}", e);
                format!("metadata {}: {e}", bundle_path.display())
            })?
            .len();

        debug!(
            "install_ovcsp_with_limits: bundle size={} bytes, sha256={}",
            bundle_compressed_bytes,
            &bundle_sha256[..12]
        );

        let (manifest_bundle_path, manifest) = locate_manifest_in_bundle(bundle_path)?;
        let plugin_id = manifest.id.trim().to_string();
        if plugin_id.is_empty() {
            error!("install_ovcsp_with_limits: manifest id is empty",);
            return Err("manifest id is empty".to_string());
        }

        debug!(
            "install_ovcsp_with_limits: plugin_id={}, version={:?}",
            plugin_id, manifest.version
        );

        // Enforce that the top-level directory name matches the manifest id.
        let bundle_root = manifest_bundle_path
            .parent()
            .and_then(|p| p.file_name())
            .and_then(|s| s.to_str())
            .unwrap_or_default()
            .to_string();
        if bundle_root != plugin_id {
            error!(
                "install_ovcsp_with_limits: bundle root '{}' does not match manifest id '{}'",
                bundle_root, plugin_id
            );
            return Err(format!(
                "bundle root folder '{}' does not match manifest id '{}'",
                bundle_root, plugin_id
            ));
        }

        let requested_capabilities = normalize_capabilities(manifest.capabilities.clone());
        let version = derive_install_version(&manifest, &bundle_sha256);

        let plugin_dir = self.root.join(&plugin_id);
        fs::create_dir_all(&self.root)
            .map_err(|e| format!("create {}: {e}", self.root.display()))?;

        let staging = self.root.join(format!(".staging-{}", now_unix_ms()));
        if staging.exists() {
            let _ = fs::remove_dir_all(&staging);
        }
        fs::create_dir_all(&staging).map_err(|e| format!("create {}: {e}", staging.display()))?;
        let staging_version_dir = staging.join(&version);

        trace!(
            "install_ovcsp_with_limits: staging_dir={}, plugin_dir={}",
            staging_version_dir.display(),
            plugin_dir.display()
        );

        fs::create_dir_all(&staging_version_dir)
            .map_err(|e| format!("create {}: {e}", staging_version_dir.display()))?;

        let mut total_files = 0u64;
        let mut total_uncompressed = 0u64;
        let root_canon = fs::canonicalize(&staging_version_dir)
            .map_err(|e| format!("canonicalize {}: {e}", staging_version_dir.display()))?;

        // Extract all entries under `<pluginId>/...` into the staging version directory.
        let mut tar = open_bundle_archive(bundle_path)?;

        for entry in tar.entries().map_err(|e| format!("read tar: {e}"))? {
            let mut entry = entry.map_err(|e| format!("tar entry: {e}"))?;
            let entry_type = entry.header().entry_type();
            let declared_size = entry
                .header()
                .size()
                .map_err(|e| format!("read tar header size: {e}"))?;

            #[cfg(unix)]
            let mut unix_mode = entry.header().mode().unwrap_or(0o644) & 0o777;

            let raw_path = entry.path().map_err(|e| format!("tar entry path: {e}"))?;
            let raw_name = raw_path.to_string_lossy().to_string();
            let name = sanitize_tar_name(&raw_name)?;

            // Reject symlinks/hardlinks outright.
            if entry_type.is_symlink() || entry_type.is_hard_link() {
                return Err(format!("bundle contains a symlink entry: {}", raw_name));
            }

            let mut comps = name.components();
            let root = comps
                .next()
                .and_then(|c| c.as_os_str().to_str())
                .unwrap_or_default()
                .to_string();
            if root != plugin_id {
                if !root.is_empty() {
                    return Err(format!(
                        "bundle contains multiple top-level roots (saw '{}', expected '{}')",
                        root, plugin_id
                    ));
                }
                continue;
            }

            // Strip the top-level folder (plugin id).
            let stripped: PathBuf = comps.collect();
            if stripped.as_os_str().is_empty() {
                continue;
            }

            if entry_type.is_dir() {
                let dir_path = staging_version_dir.join(&stripped);
                fs::create_dir_all(&dir_path)
                    .map_err(|e| format!("create {}: {e}", dir_path.display()))?;
                let dir_canon = fs::canonicalize(&dir_path)
                    .map_err(|e| format!("canonicalize {}: {e}", dir_path.display()))?;
                if !dir_canon.starts_with(&root_canon) {
                    return Err("tar extraction escaped install directory".to_string());
                }
                continue;
            }

            if !entry_type.is_file() {
                return Err(format!("unsupported tar entry type: {}", raw_name));
            }

            if stripped
                .as_os_str()
                .to_string_lossy()
                .to_ascii_lowercase()
                .ends_with(".node")
            {
                return Err(format!(
                    "bundle contains unsupported native Node addon: {}",
                    raw_name
                ));
            }

            total_files += 1;
            if total_files > limits.max_files {
                return Err(format!(
                    "bundle exceeds max file count ({})",
                    limits.max_files
                ));
            }

            if declared_size > limits.max_file_bytes {
                return Err(format!(
                    "bundle contains an oversized file ({} bytes, max {})",
                    declared_size, limits.max_file_bytes
                ));
            }

            total_uncompressed = total_uncompressed
                .checked_add(declared_size)
                .ok_or_else(|| "bundle size overflow".to_string())?;
            if total_uncompressed > limits.max_total_bytes {
                return Err(format!(
                    "bundle exceeds max total size ({} bytes, max {})",
                    total_uncompressed, limits.max_total_bytes
                ));
            }

            let compressed = bundle_compressed_bytes.max(1);
            let ratio = (total_uncompressed / compressed).max(1);
            if ratio > limits.max_compression_ratio && total_uncompressed > 1024 * 1024 {
                return Err("bundle rejected due to suspicious compression ratio".to_string());
            }

            let out_path = staging_version_dir.join(&stripped);
            if let Some(parent) = out_path.parent() {
                fs::create_dir_all(parent)
                    .map_err(|e| format!("create {}: {e}", parent.display()))?;
                let parent_canon = fs::canonicalize(parent)
                    .map_err(|e| format!("canonicalize {}: {e}", parent.display()))?;
                if !parent_canon.starts_with(&root_canon) {
                    return Err("tar extraction escaped install directory".to_string());
                }
            }

            let mut out = fs::OpenOptions::new()
                .create_new(true)
                .write(true)
                .open(&out_path)
                .map_err(|e| format!("create {}: {e}", out_path.display()))?;

            let mut written = 0u64;
            let mut buf = [0u8; 8192];
            loop {
                let n = entry.read(&mut buf).map_err(|e| format!("read tar: {e}"))?;
                if n == 0 {
                    break;
                }
                written += n as u64;
                if written > limits.max_file_bytes {
                    return Err(format!(
                        "bundle contains an oversized file ({} bytes, max {})",
                        written, limits.max_file_bytes
                    ));
                }
                out.write_all(&buf[..n])
                    .map_err(|e| format!("write {}: {e}", out_path.display()))?;
            }

            // Apply safe unix permissions (mask out setuid/setgid/sticky bits).
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                // For files under bin/, ensure executable.
                if stripped
                    .components()
                    .next()
                    .is_some_and(|c| c.as_os_str() == "bin")
                    && (unix_mode & 0o111) == 0
                {
                    unix_mode |= 0o111;
                }
                let _ = fs::set_permissions(&out_path, fs::Permissions::from_mode(unix_mode));
            }

            // Canonicalize the written file and ensure it still lives under the version dir.
            let out_canon = fs::canonicalize(&out_path)
                .map_err(|e| format!("canonicalize {}: {e}", out_path.display()))?;
            if !out_canon.starts_with(&root_canon) {
                return Err("tar extraction escaped install directory".to_string());
            }

            // Ensure we did not create a symlink (defense-in-depth).
            let meta = fs::symlink_metadata(&out_path)
                .map_err(|e| format!("metadata {}: {e}", out_path.display()))?;
            if meta.file_type().is_symlink() {
                return Err("bundle attempted to create a symlink".to_string());
            }
        }

        // Validate required files.
        let extracted_manifest = staging_version_dir.join(PLUGIN_MANIFEST_NAME);
        if !extracted_manifest.is_file() {
            error!(
                "install_ovcsp_with_limits: missing manifest at {}",
                extracted_manifest.display()
            );
            return Err(format!(
                "installed bundle is missing {}",
                extracted_manifest.display()
            ));
        }

        if manifest.functions.is_some() {
            error!("install_ovcsp_with_limits: manifest uses deprecated 'functions' field",);
            return Err(
                "manifest uses unsupported field 'functions'; use module.exec only".to_string(),
            );
        }

        let module_exec = normalize_exec(manifest.module.and_then(|m| m.exec));

        validate_entrypoint(&staging_version_dir, module_exec.as_deref(), "module")?;

        debug!(
            "install_ovcsp_with_limits: extracted {} files, promoting to final location",
            total_files
        );

        // Promote staged version into place (flat layout, drop old version directory).
        if plugin_dir.exists() {
            trace!(
                "install_ovcsp_with_limits: removing existing plugin dir {}",
                plugin_dir.display()
            );
            fs::remove_dir_all(&plugin_dir)
                .map_err(|e| format!("remove {}: {e}", plugin_dir.display()))?;
        }
        fs::rename(&staging_version_dir, &plugin_dir).map_err(|e| {
            error!(
                "install_ovcsp_with_limits: failed to move plugin into place: {}",
                e
            );
            format!(
                "move installed plugin into place {} -> {}: {e}",
                staging_version_dir.display(),
                plugin_dir.display()
            )
        })?;
        let _ = fs::remove_dir_all(&staging);

        let approval = ApprovalState::Pending;

        // Update index + current pointer.
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

        let elapsed = start.elapsed();
        info!(
            "install_ovcsp_with_limits: installed plugin {} v{} in {:?}",
            plugin_id, version, elapsed
        );

        Ok(InstalledPlugin {
            plugin_id,
            version,
            bundle_sha256,
            requested_capabilities,
            approval,
            install_dir: plugin_dir,
        })
    }

    /// Ensures shipped built-in bundles are installed and up to date locally.
    ///
    /// # Returns
    /// - `Ok(())` when all built-in bundles are synchronized.
    /// - `Err(String)` when one or more bundles fail to sync.
    pub fn sync_built_in_plugins(&self) -> Result<(), String> {
        let _timer = LogTimer::new(MODULE, "sync_built_in_plugins");
        let bundles = builtin_bundle_paths();
        info!(
            "sync_built_in_plugins: syncing {} built-in bundles",
            bundles.len()
        );

        let mut errors = Vec::new();
        for bundle in &bundles {
            debug!("sync_built_in_plugins: checking {}", bundle.display());
            if let Err(err) = self.ensure_built_in_bundle(bundle) {
                let msg = format!("{}: {}", bundle.display(), err);
                warn!("sync_built_in_plugins: failed to sync: {}", msg);
                errors.push(msg);
            }
        }

        if errors.is_empty() {
            debug!("sync_built_in_plugins: all bundles synced successfully",);
            Ok(())
        } else {
            error!("sync_built_in_plugins: {} bundles failed", errors.len());
            Err(errors.join("; "))
        }
    }

    /// Installs/updates a single built-in bundle when needed.
    ///
    /// # Parameters
    /// - `bundle_path`: Built-in bundle path.
    ///
    /// # Returns
    /// - `Ok(())` when bundle is already current or installed successfully.
    /// - `Err(String)` on install/validation failures.
    fn ensure_built_in_bundle(&self, bundle_path: &Path) -> Result<(), String> {
        trace!("ensure_built_in_bundle: {}", bundle_path.display());

        let bundle_sha256 = sha256_hex_file(bundle_path)?;
        let (_manifest_path, manifest) = locate_manifest_in_bundle(bundle_path)?;
        let plugin_id = manifest.id.trim();
        if plugin_id.is_empty() {
            error!("ensure_built_in_bundle: bundle manifest id is empty",);
            return Err("bundle manifest id is empty".to_string());
        }
        let plugin_id = plugin_id.to_string();
        let version = derive_install_version(&manifest, &bundle_sha256);

        if let Some(installed) = self.get_current_installed(&plugin_id)? {
            if installed.bundle_sha256 == bundle_sha256 && installed.version == version {
                trace!(
                    "ensure_built_in_bundle: {} already installed and current",
                    plugin_id
                );
                return Ok(());
            }
            debug!(
                "ensure_built_in_bundle: {} needs update (installed={}, new={})",
                plugin_id, installed.version, version
            );
        }

        debug!("ensure_built_in_bundle: installing {}", plugin_id);
        self.install_ovcsp_with_limits(bundle_path, InstallerLimits::default())?;

        if let Err(err) = self.approve_capabilities(&plugin_id, &version, true) {
            warn!(
                "ensure_built_in_bundle: failed to auto-approve built-in {} ({}): {}",
                plugin_id, version, err
            );
        } else {
            debug!(
                "ensure_built_in_bundle: auto-approved built-in {} ({})",
                plugin_id, version
            );
        }
        Ok(())
    }

    /// Removes an installed non-built-in plugin and all of its versions.
    ///
    /// # Parameters
    /// - `plugin_id`: Plugin identifier to uninstall.
    ///
    /// # Returns
    /// - `Ok(())` when the plugin is removed or not installed.
    /// - `Err(String)` if the id is invalid, built-in, or removal fails.
    pub fn uninstall_plugin(&self, plugin_id: &str) -> Result<(), String> {
        let _timer = LogTimer::new(MODULE, "uninstall_plugin");
        let id = plugin_id.trim();
        info!("uninstall_plugin: plugin={}", id);

        if id.is_empty() {
            warn!("uninstall_plugin: empty plugin id");
            return Err("plugin id is empty".to_string());
        }
        let lower = id.to_ascii_lowercase();
        if built_in_plugin_ids().contains(&lower) {
            warn!("uninstall_plugin: cannot uninstall built-in plugin {}", id);
            return Err("built-in plugins cannot be removed".to_string());
        }
        let dir = self.root.join(id);
        if !dir.exists() {
            debug!("uninstall_plugin: plugin {} not installed", id);
            return Ok(());
        }
        fs::remove_dir_all(&dir).map_err(|e| {
            error!(
                "uninstall_plugin: failed to remove {}: {}",
                dir.display(),
                e
            );
            format!("remove {}: {e}", dir.display())
        })?;
        debug!("uninstall_plugin: plugin {} removed", id);
        Ok(())
    }

    /// Lists installed plugin indices discovered from the plugin store root.
    ///
    /// # Returns
    /// - `Ok(Vec<InstalledPluginIndex>)` sorted by plugin id.
    /// - `Err(String)` when the plugin root cannot be read.
    pub fn list_installed(&self) -> Result<Vec<InstalledPluginIndex>, String> {
        let _timer = LogTimer::new(MODULE, "list_installed");
        trace!("list_installed: scanning {}", self.root.display());

        if !self.root.is_dir() {
            debug!("list_installed: root does not exist");
            return Ok(Vec::new());
        }
        let mut out = Vec::new();
        let entries = fs::read_dir(&self.root).map_err(|e| {
            error!(
                "list_installed: failed to read {}: {}",
                self.root.display(),
                e
            );
            format!("read {}: {e}", self.root.display())
        })?;
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
                if let Ok(idx) = serde_json::from_str::<InstalledPluginIndex>(&text) {
                    out.push(idx);
                }
            }
        }
        out.sort_by(|a, b| a.plugin_id.cmp(&b.plugin_id));
        debug!("list_installed: found {} installed plugins", out.len());
        Ok(out)
    }

    /// Resolves the filesystem directory for the current version of a plugin.
    ///
    /// # Parameters
    /// - `plugin_id`: Plugin identifier to query.
    ///
    /// # Returns
    /// - `Ok(Some(PathBuf))` with the current plugin directory.
    /// - `Ok(None)` if no current version is configured.
    /// - `Err(String)` if the id is invalid or metadata cannot be parsed.
    pub fn get_current_dir(&self, plugin_id: &str) -> Result<Option<PathBuf>, String> {
        let id = plugin_id.trim();
        if id.is_empty() {
            return Err("plugin id is empty".to_string());
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
        } else if plugin_dir.join(PLUGIN_MANIFEST_NAME).is_file() {
            Ok(Some(plugin_dir))
        } else {
            Ok(None)
        }
    }

    /// Returns metadata for the currently selected plugin version, if present.
    ///
    /// # Parameters
    /// - `plugin_id`: Plugin identifier to query.
    ///
    /// # Returns
    /// - `Ok(Some(InstalledPluginVersion))` when a current version exists.
    /// - `Ok(None)` when the plugin or current version is missing.
    /// - `Err(String)` if the id is invalid.
    pub fn get_current_installed(
        &self,
        plugin_id: &str,
    ) -> Result<Option<InstalledPluginVersion>, String> {
        trace!("get_current_installed: plugin_id='{}'", plugin_id);

        let id = plugin_id.trim();
        debug!("get_current_installed: trimmed id='{}'", id);

        if id.is_empty() {
            return Err("plugin id is empty".to_string());
        }

        trace!("get_current_installed: reading index");
        let Some(index) = self.read_index(id) else {
            debug!("get_current_installed: no index found for '{}'", id);
            return Ok(None);
        };

        trace!("get_current_installed: checking current pointer");
        let Some(ver) = index.current.as_deref() else {
            debug!("get_current_installed: no current version for '{}'", id);
            return Ok(None);
        };

        debug!("get_current_installed: current version='{}'", ver);
        let result = index.versions.get(ver).cloned();
        debug!("get_current_installed: found={}", result.is_some());
        Ok(result)
    }

    /// Updates capability approval for a specific plugin version.
    ///
    /// # Parameters
    /// - `plugin_id`: Plugin identifier to update.
    /// - `version`: Installed version key to modify.
    /// - `approved`: `true` to approve, `false` to deny.
    ///
    /// # Returns
    /// - `Ok(())` when approval state is updated.
    /// - `Err(String)` if the plugin/version is missing or index write fails.
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
        let Some(v) = index.versions.get_mut(ver) else {
            return Err("version is not installed".to_string());
        };
        v.approval = if approved {
            ApprovalState::Approved {
                capabilities: v.requested_capabilities.clone(),
                approved_at_unix_ms: now_unix_ms(),
            }
        } else {
            ApprovalState::Denied {
                denied_at_unix_ms: now_unix_ms(),
                reason: None,
            }
        };
        self.write_index(plugin_id, &index)?;
        Ok(())
    }

    /// Loads resolved components for the current plugin version.
    ///
    /// # Parameters
    /// - `plugin_id`: Plugin identifier to load.
    ///
    /// # Returns
    /// - `Ok(Some(InstalledPluginComponents))` when current metadata is valid.
    /// - `Ok(None)` when no current version is available.
    /// - `Err(String)` when manifests or entrypoints are invalid.
    pub fn load_current_components(
        &self,
        plugin_id: &str,
    ) -> Result<Option<InstalledPluginComponents>, String> {
        let Some(version_dir) = self.get_current_dir(plugin_id)? else {
            return Ok(None);
        };
        let manifest_path = version_dir.join(PLUGIN_MANIFEST_NAME);
        let text = fs::read_to_string(&manifest_path)
            .map_err(|e| format!("read {}: {e}", manifest_path.display()))?;
        let manifest: PluginManifest = serde_json::from_str(&text)
            .map_err(|e| format!("parse {}: {e}", manifest_path.display()))?;
        if manifest.functions.is_some() {
            return Err(format!(
                "manifest {} uses unsupported field 'functions'; use module.exec only",
                manifest_path.display()
            ));
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

        let module = manifest.module.and_then(|m| {
            let exec = m.exec?.trim().to_string();
            if exec.is_empty() {
                return None;
            }
            let exec_path = version_dir.join("bin").join(platform_exec_name(&exec));
            Some(ModuleComponent {
                exec,
                exec_path,
                vcs_backends: m
                    .vcs_backends
                    .into_iter()
                    .filter_map(|p| match p {
                        VcsBackendProvide::Id(id) => {
                            let id = id.trim().to_string();
                            (!id.is_empty()).then_some((id, None))
                        }
                        VcsBackendProvide::Named { id, name } => {
                            let id = id.trim().to_string();
                            if id.is_empty() {
                                return None;
                            }
                            let name = name
                                .as_deref()
                                .map(str::trim)
                                .filter(|s| !s.is_empty())
                                .map(str::to_string);
                            Some((id, name))
                        }
                    })
                    .collect(),
            })
        });

        // Validate that declared entrypoints exist (defense-in-depth; installer should have ensured).
        if let Some(m) = &module {
            validate_entrypoint(&version_dir, Some(&m.exec), "module")?;
        }

        Ok(Some(InstalledPluginComponents {
            plugin_id: id,
            name: manifest
                .name
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty()),
            default_enabled: manifest.default_enabled,
            module,
        }))
    }

    /// Lists resolved components for every plugin with a valid current version.
    ///
    /// # Returns
    /// - `Ok(Vec<InstalledPluginComponents>)` sorted by plugin id.
    /// - `Err(String)` when store traversal fails.
    pub fn list_current_components(&self) -> Result<Vec<InstalledPluginComponents>, String> {
        trace!("list_current_components: root='{}'", self.root.display());

        if !self.root.is_dir() {
            debug!("list_current_components: root is not a directory, returning empty");
            return Ok(Vec::new());
        }

        trace!("list_current_components: reading directory");
        let entries =
            fs::read_dir(&self.root).map_err(|e| format!("read {}: {e}", self.root.display()))?;
        let mut out = Vec::new();

        trace!("list_current_components: iterating entries");
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }
            let plugin_id = match path.file_name().and_then(|s| s.to_str()) {
                Some(s) => s.to_string(),
                None => continue,
            };

            debug!("list_current_components: checking plugin '{}'", plugin_id);
            match self.load_current_components(&plugin_id) {
                Ok(Some(c)) => {
                    debug!(
                        "list_current_components: plugin '{}' has components, has_module={}",
                        plugin_id,
                        c.module.is_some()
                    );
                    out.push(c);
                }
                Ok(None) => {
                    debug!(
                        "list_current_components: plugin '{}' has no current components",
                        plugin_id
                    );
                }
                Err(err) => {
                    warn!(
                        "list_current_components: skipping invalid plugin '{}': {}",
                        plugin_id, err
                    );
                }
            }
        }
        out.sort_by(|a, b| a.plugin_id.cmp(&b.plugin_id));
        debug!(
            "list_current_components: returning {} components",
            out.len()
        );
        Ok(out)
    }

    /// Reads plugin index metadata from disk.
    ///
    /// # Parameters
    /// - `plugin_id`: Plugin id.
    ///
    /// # Returns
    /// - `Some(InstalledPluginIndex)` when present and parseable.
    /// - `None` otherwise.
    fn read_index(&self, plugin_id: &str) -> Option<InstalledPluginIndex> {
        trace!("read_index: plugin_id='{}'", plugin_id);
        let p = self.root.join(plugin_id).join("index.json");
        debug!("read_index: path='{}'", p.display());

        let text = match fs::read_to_string(&p) {
            Ok(t) => {
                debug!("read_index: file read successfully");
                t
            }
            Err(e) => {
                debug!("read_index: failed to read file: {}", e);
                return None;
            }
        };

        match serde_json::from_str(&text) {
            Ok(index) => {
                debug!("read_index: parsed index for '{}'", plugin_id);
                Some(index)
            }
            Err(e) => {
                debug!("read_index: failed to parse index: {}", e);
                None
            }
        }
    }

    /// Writes plugin index metadata atomically.
    ///
    /// # Parameters
    /// - `plugin_id`: Plugin id.
    /// - `index`: Index payload.
    ///
    /// # Returns
    /// - `Ok(())` on success.
    /// - `Err(String)` on serialization or IO failure.
    fn write_index(&self, plugin_id: &str, index: &InstalledPluginIndex) -> Result<(), String> {
        let p = self.root.join(plugin_id).join("index.json");
        let tmp = p.with_extension("json.tmp");
        let text =
            serde_json::to_string_pretty(index).map_err(|e| format!("serialize index: {e}"))?;
        fs::write(&tmp, text).map_err(|e| format!("write {}: {e}", tmp.display()))?;
        fs::rename(&tmp, &p).map_err(|e| format!("rename {}: {e}", p.display()))?;
        Ok(())
    }

    /// Writes current-version pointer atomically.
    ///
    /// # Parameters
    /// - `plugin_id`: Plugin id.
    /// - `cur`: Current version payload.
    ///
    /// # Returns
    /// - `Ok(())` on success.
    /// - `Err(String)` on serialization or IO failure.
    fn write_current(&self, plugin_id: &str, cur: &CurrentPointer) -> Result<(), String> {
        let p = self.root.join(plugin_id).join("current.json");
        let tmp = p.with_extension("json.tmp");
        let text =
            serde_json::to_string_pretty(cur).map_err(|e| format!("serialize current: {e}"))?;
        fs::write(&tmp, text).map_err(|e| format!("write {}: {e}", tmp.display()))?;
        fs::rename(&tmp, &p).map_err(|e| format!("rename {}: {e}", p.display()))?;
        Ok(())
    }
}

static BUILT_IN_PLUGIN_IDS: OnceLock<HashSet<String>> = OnceLock::new();

/// Returns the set of built-in plugin identifiers normalized to lowercase.
///
/// # Returns
/// - A process-wide cached set of lowercase built-in plugin ids.
pub fn built_in_plugin_ids() -> &'static HashSet<String> {
    BUILT_IN_PLUGIN_IDS.get_or_init(read_built_in_plugin_ids)
}

/// Reads built-in plugin ids from bundled `.ovcsp` archives.
///
/// # Returns
/// - Lowercased built-in plugin id set.
fn read_built_in_plugin_ids() -> HashSet<String> {
    let mut out: HashSet<String> = HashSet::new();

    for bundle_path in builtin_bundle_paths() {
        let (_manifest_path, manifest) = match locate_manifest_in_bundle(&bundle_path) {
            Ok(v) => v,
            Err(err) => {
                warn!(
                    "plugins: failed to locate manifest in built-in bundle {}: {}",
                    bundle_path.display(),
                    err
                );
                continue;
            }
        };

        let id = manifest.id.trim();
        if id.is_empty() {
            continue;
        }
        out.insert(id.to_ascii_lowercase());
    }

    out
}

/// Lists discovered built-in `.ovcsp` bundle files.
///
/// # Returns
/// - Bundle file paths.
fn builtin_bundle_paths() -> Vec<PathBuf> {
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
            let path = entry.path();
            if !path.is_file() {
                continue;
            }
            if let Some(ext) = path.extension().and_then(|s| s.to_str()) {
                if ext.eq_ignore_ascii_case("ovcsp") {
                    out.push(path);
                }
            }
        }
    }
    out
}

/// Chooses an install version string from manifest version or bundle hash.
///
/// # Parameters
/// - `manifest`: Parsed manifest.
/// - `bundle_sha256`: Bundle digest.
///
/// # Returns
/// - Version string used for installation metadata.
fn derive_install_version(manifest: &PluginManifest, bundle_sha256: &str) -> String {
    manifest
        .version
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| format!("sha256-{}", &bundle_sha256[..12]))
}

/// Finds and parses `openvcs.plugin.json` from a plugin bundle archive.
///
/// # Parameters
/// - `bundle_path`: Bundle file path.
///
/// # Returns
/// - `Ok((PathBuf, PluginManifest))` manifest path inside archive and manifest payload.
/// - `Err(String)` on read/parse/validation failure.
fn locate_manifest_in_bundle(bundle_path: &Path) -> Result<(PathBuf, PluginManifest), String> {
    let mut tar = open_bundle_archive(bundle_path)?;

    let mut manifest_path: Option<PathBuf> = None;
    let mut manifest_json: Option<Vec<u8>> = None;

    for entry in tar.entries().map_err(|e| format!("read tar: {e}"))? {
        let mut entry = entry.map_err(|e| format!("tar entry: {e}"))?;
        if !entry.header().entry_type().is_file() {
            continue;
        }

        let raw_path = entry.path().map_err(|e| format!("tar entry path: {e}"))?;
        let raw_name = raw_path.to_string_lossy().to_string();
        let name = sanitize_tar_name(&raw_name)?;

        if name
            .file_name()
            .and_then(|s| s.to_str())
            .is_some_and(|s| s == PLUGIN_MANIFEST_NAME)
        {
            let comps: Vec<_> = name.components().collect();
            if comps.len() != 2 {
                continue;
            }
            if manifest_path.is_some() {
                return Err(format!(
                    "bundle contains multiple {PLUGIN_MANIFEST_NAME} files"
                ));
            }
            let mut bytes = Vec::new();
            entry
                .read_to_end(&mut bytes)
                .map_err(|e| format!("read manifest: {e}"))?;
            manifest_path = Some(name);
            manifest_json = Some(bytes);
        }
    }

    let manifest_path =
        manifest_path.ok_or_else(|| format!("bundle is missing {PLUGIN_MANIFEST_NAME}"))?;
    let manifest_json = manifest_json.expect("manifest bytes to exist");

    let manifest: PluginManifest = serde_json::from_slice(&manifest_json)
        .map_err(|e| format!("parse {PLUGIN_MANIFEST_NAME}: {e}"))?;
    Ok((manifest_path, manifest))
}

/// Normalizes capability identifiers (trim/sort/dedup).
///
/// # Parameters
/// - `caps`: Raw capability list.
///
/// # Returns
/// - Normalized capability list.
fn normalize_capabilities(mut caps: Vec<String>) -> Vec<String> {
    for c in &mut caps {
        *c = c.trim().to_string();
    }
    caps.retain(|c| !c.is_empty());
    caps.sort();
    caps.dedup();
    caps
}

/// Normalizes optional exec name values.
///
/// # Parameters
/// - `exec`: Optional exec string.
///
/// # Returns
/// - Trimmed non-empty exec name or `None`.
fn normalize_exec(exec: Option<String>) -> Option<String> {
    exec.map(|s| s.trim().to_string()).filter(|s| !s.is_empty())
}

/// Applies platform-specific executable naming.
///
/// # Parameters
/// - `base`: Base executable name.
///
/// # Returns
/// - Platform-adjusted executable name.
fn platform_exec_name(base: &str) -> String {
    base.to_string()
}

/// Validates that a declared entrypoint exists and is a Node module.
///
/// # Parameters
/// - `version_dir`: Installed version directory.
/// - `exec`: Optional exec name.
/// - `label`: Component label for error messages.
///
/// # Returns
/// - `Ok(())` when valid.
/// - `Err(String)` when invalid or missing.
fn validate_entrypoint(version_dir: &Path, exec: Option<&str>, label: &str) -> Result<(), String> {
    let Some(exec) = exec else {
        return Ok(());
    };
    let trimmed = exec.trim();
    if trimmed.is_empty() {
        return Ok(());
    }

    let lower = trimmed.to_ascii_lowercase();
    let is_supported = lower.ends_with(".js") || lower.ends_with(".mjs") || lower.ends_with(".cjs");
    if !is_supported {
        return Err(format!(
            "{} entrypoint must be a .js/.mjs/.cjs Node module, got: {}",
            label, trimmed
        ));
    }

    let exec_name = platform_exec_name(trimmed);
    let path = version_dir.join("bin").join(exec_name);
    if !path.is_file() {
        return Err(format!(
            "{} entrypoint is missing: {}",
            label,
            path.display()
        ));
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use flate2::write::GzEncoder;
    use flate2::Compression;
    use tempfile::tempdir;

    /// Synthetic tar entry kind used by bundle-construction helpers.
    enum TarEntryKind {
        /// Regular file entry.
        File,
        /// Symbolic-link entry targeting `target`.
        Symlink { target: String },
    }

    /// Synthetic tar entry used to build fixture bundles in tests.
    struct TarEntry {
        /// Path written into the tar header.
        name: String,
        /// Raw entry payload bytes.
        data: Vec<u8>,
        /// Optional Unix mode to set in the tar header.
        unix_mode: Option<u32>,
        /// Tar entry type selector.
        kind: TarEntryKind,
    }

    /// Builds a tar.gz bundle from synthetic test entries.
    ///
    /// # Parameters
    /// - `entries`: Tar entries to include.
    ///
    /// # Returns
    /// - Encoded tar.gz bytes.
    fn make_tar_gz_bundle(entries: Vec<TarEntry>) -> Vec<u8> {
        let encoder = GzEncoder::new(Vec::<u8>::new(), Compression::default());
        let mut tar = tar::Builder::new(encoder);

        for e in entries {
            let mut header = tar::Header::new_gnu();
            if let Some(mode) = e.unix_mode {
                header.set_mode(mode);
            }
            header.set_uid(0);
            header.set_gid(0);
            header.set_mtime(0);

            match e.kind {
                TarEntryKind::File => {
                    header.set_entry_type(tar::EntryType::Regular);
                    header.set_size(e.data.len() as u64);
                    header.set_cksum();
                    tar.append_data(&mut header, e.name, e.data.as_slice())
                        .unwrap();
                }
                TarEntryKind::Symlink { target } => {
                    header.set_entry_type(tar::EntryType::Symlink);
                    header.set_size(0);
                    header.set_link_name(target).unwrap();
                    header.set_cksum();
                    tar.append_data(&mut header, e.name, [].as_slice()).unwrap();
                }
            }
        }

        let encoder = tar.into_inner().unwrap();
        encoder.finish().unwrap()
    }

    /// Builds a minimal raw tar.gz bundle from `(path, bytes)` tuples.
    ///
    /// # Parameters
    /// - `entries`: Raw path/data entries.
    ///
    /// # Returns
    /// - Encoded tar.gz bytes.
    fn make_raw_tar_gz_bundle(entries: Vec<(String, Vec<u8>)>) -> Vec<u8> {
        /// Writes an octal tar header field.
        ///
        /// # Parameters
        /// - `field`: Mutable tar field bytes.
        /// - `value`: Numeric value to encode.
        ///
        /// # Returns
        /// - `()`.
        fn write_octal(field: &mut [u8], value: u64) {
            field.fill(0);
            let width = field.len();
            let s = format!("{:0width$o}", value, width = width.saturating_sub(1));
            let bytes = s.as_bytes();
            let n = bytes.len().min(width.saturating_sub(1));
            field[..n].copy_from_slice(&bytes[..n]);
            if width > 0 {
                field[width - 1] = 0;
            }
        }

        /// Creates a POSIX tar header block for a file.
        ///
        /// # Parameters
        /// - `name`: Tar entry name.
        /// - `size`: Entry size in bytes.
        ///
        /// # Returns
        /// - 512-byte tar header.
        fn tar_header(name: &str, size: u64) -> [u8; 512] {
            let mut h = [0u8; 512];
            let name_bytes = name.as_bytes();
            let n = name_bytes.len().min(100);
            h[..n].copy_from_slice(&name_bytes[..n]);

            write_octal(&mut h[100..108], 0o644);
            write_octal(&mut h[108..116], 0);
            write_octal(&mut h[116..124], 0);
            write_octal(&mut h[124..136], size);
            write_octal(&mut h[136..148], 0);

            // chksum (spaces for calculation)
            h[148..156].fill(b' ');
            h[156] = b'0'; // regular file
            h[257..263].copy_from_slice(b"ustar\0");
            h[263..265].copy_from_slice(b"00");

            let sum: u32 = h.iter().map(|b| *b as u32).sum();
            write_octal(&mut h[148..156], sum as u64);
            // tar convention: NUL then space
            h[154] = 0;
            h[155] = b' ';
            h
        }

        let mut tar_bytes = Vec::<u8>::new();
        for (name, data) in entries {
            tar_bytes.extend_from_slice(&tar_header(&name, data.len() as u64));
            tar_bytes.extend_from_slice(&data);
            let pad = (512 - (data.len() % 512)) % 512;
            if pad > 0 {
                let old = tar_bytes.len();
                tar_bytes.resize(old + pad, 0u8);
            }
        }
        tar_bytes.resize(tar_bytes.len() + 1024, 0u8);

        let mut out = Vec::<u8>::new();
        let mut enc = GzEncoder::new(&mut out, Compression::default());
        enc.write_all(&tar_bytes).unwrap();
        enc.finish().unwrap();
        out
    }

    /// Writes bundle bytes to a temporary `.ovcsp` file.
    ///
    /// # Parameters
    /// - `bytes`: Bundle bytes.
    ///
    /// # Returns
    /// - Tempdir handle and bundle path.
    fn write_bundle_to_temp(bytes: &[u8]) -> (tempfile::TempDir, PathBuf) {
        let dir = tempdir().unwrap();
        let path = dir.path().join("bundle.ovcsp");
        fs::write(&path, bytes).unwrap();
        (dir, path)
    }

    /// Builds a minimal manifest JSON payload used by tests.
    ///
    /// # Parameters
    /// - `id`: Plugin id.
    /// - `extra`: Extra JSON fragment appended into the object.
    ///
    /// # Returns
    /// - Manifest JSON bytes.
    fn basic_manifest(id: &str, extra: &str) -> Vec<u8> {
        format!("{{\"id\":\"{id}\",\"name\":\"Test\",\"version\":\"1.0.0\"{extra}}}").into_bytes()
    }

    #[test]
    /// Verifies installer enforces file-count limits.
    ///
    /// # Returns
    /// - `()`.
    fn install_enforces_file_count_and_size_limits() {
        let mut entries = vec![TarEntry {
            name: "test.plugin/openvcs.plugin.json".into(),
            data: basic_manifest("test.plugin", ""),
            unix_mode: None,
            kind: TarEntryKind::File,
        }];
        for i in 0..5 {
            entries.push(TarEntry {
                name: format!("test.plugin/assets/{i}.txt"),
                data: b"1234".to_vec(),
                unix_mode: None,
                kind: TarEntryKind::File,
            });
        }
        let bundle = make_tar_gz_bundle(entries);

        let (_tmp, bundle_path) = write_bundle_to_temp(&bundle);
        let store_root = tempdir().unwrap();
        let store = PluginBundleStore::new_at(store_root.path().to_path_buf());

        let limits = InstallerLimits {
            max_files: 2,
            max_file_bytes: 1024,
            max_total_bytes: 1024,
            max_compression_ratio: 200,
        };
        let err = store.install_ovcsp_with_limits(&bundle_path, limits);
        assert!(err.is_err());
    }

    #[test]
    /// Verifies installer requires manifest at expected path.
    ///
    /// # Returns
    /// - `()`.
    fn install_requires_manifest_at_expected_location() {
        let bundle = make_tar_gz_bundle(vec![TarEntry {
            name: "test.plugin/other.json".into(),
            data: b"{}".to_vec(),
            unix_mode: None,
            kind: TarEntryKind::File,
        }]);

        let (_tmp, bundle_path) = write_bundle_to_temp(&bundle);
        let store_root = tempdir().unwrap();
        let store = PluginBundleStore::new_at(store_root.path().to_path_buf());

        let err = store.install_ovcsp(&bundle_path);
        assert!(err.is_err());
    }

    #[test]
    /// Verifies installer validates declared entrypoints.
    ///
    /// # Returns
    /// - `()`.
    fn install_validates_declared_entrypoints_exist() {
        let bundle = make_tar_gz_bundle(vec![TarEntry {
            name: "test.plugin/openvcs.plugin.json".into(),
            data: basic_manifest(
                "test.plugin",
                ",\"module\":{\"exec\":\"missing.mjs\",\"vcs_backends\":[\"x\"]}",
            ),
            unix_mode: None,
            kind: TarEntryKind::File,
        }]);

        let (_tmp, bundle_path) = write_bundle_to_temp(&bundle);
        let store_root = tempdir().unwrap();
        let store = PluginBundleStore::new_at(store_root.path().to_path_buf());

        let err = store.install_ovcsp(&bundle_path);
        assert!(err.is_err());
    }

    #[test]
    /// Verifies installer rejects deprecated functions component manifests.
    ///
    /// # Returns
    /// - `()`.
    fn install_rejects_functions_component() {
        let bundle = make_tar_gz_bundle(vec![TarEntry {
            name: "test.plugin/openvcs.plugin.json".into(),
            data: basic_manifest("test.plugin", ",\"functions\":{\"exec\":\"legacy.mjs\"}"),
            unix_mode: None,
            kind: TarEntryKind::File,
        }]);

        let (_tmp, bundle_path) = write_bundle_to_temp(&bundle);
        let store_root = tempdir().unwrap();
        let store = PluginBundleStore::new_at(store_root.path().to_path_buf());

        let err = store.install_ovcsp(&bundle_path).unwrap_err();
        assert_eq!(
            err,
            "manifest uses unsupported field 'functions'; use module.exec only"
        );
    }

    #[test]
    /// Verifies installer accepts valid tar.gz bundles.
    ///
    /// # Returns
    /// - `()`.
    fn install_accepts_tar_gz_bundles() {
        let bundle = make_tar_gz_bundle(vec![
            TarEntry {
                name: "test.plugin/openvcs.plugin.json".into(),
                data: basic_manifest(
                    "test.plugin",
                    ",\"module\":{\"exec\":\"mod.mjs\",\"vcs_backends\":[]}",
                ),
                unix_mode: None,
                kind: TarEntryKind::File,
            },
            TarEntry {
                name: "test.plugin/bin/mod.mjs".into(),
                data: b"export {};\n".to_vec(),
                unix_mode: Some(0o100644),
                kind: TarEntryKind::File,
            },
        ]);

        let (_tmp, bundle_path) = write_bundle_to_temp(&bundle);
        let store_root = tempdir().unwrap();
        let store = PluginBundleStore::new_at(store_root.path().to_path_buf());

        let installed = store.install_ovcsp(&bundle_path).unwrap();
        assert_eq!(installed.plugin_id, "test.plugin");
        assert!(installed.install_dir.join(PLUGIN_MANIFEST_NAME).is_file());
    }

    #[test]
    /// Verifies installer rejects zip-slip parent path traversal.
    ///
    /// # Returns
    /// - `()`.
    fn install_rejects_tar_zipslip_parent_dir() {
        let bundle = make_raw_tar_gz_bundle(vec![
            (
                "test.plugin/openvcs.plugin.json".into(),
                basic_manifest("test.plugin", ""),
            ),
            ("test.plugin/../evil.txt".into(), b"nope".to_vec()),
        ]);

        let (_tmp, bundle_path) = write_bundle_to_temp(&bundle);
        let store_root = tempdir().unwrap();
        let store = PluginBundleStore::new_at(store_root.path().to_path_buf());

        let err = store.install_ovcsp_with_limits(&bundle_path, InstallerLimits::default());
        assert!(err.is_err());
    }

    #[test]
    /// Verifies installer rejects symlink entries.
    ///
    /// # Returns
    /// - `()`.
    fn install_rejects_tar_symlink_entries() {
        let bundle = make_tar_gz_bundle(vec![
            TarEntry {
                name: "test.plugin/openvcs.plugin.json".into(),
                data: basic_manifest("test.plugin", ""),
                unix_mode: None,
                kind: TarEntryKind::File,
            },
            TarEntry {
                name: "test.plugin/bin/link".into(),
                data: Vec::new(),
                unix_mode: Some(0o120777),
                kind: TarEntryKind::Symlink {
                    target: "target".into(),
                },
            },
        ]);

        let (_tmp, bundle_path) = write_bundle_to_temp(&bundle);
        let store_root = tempdir().unwrap();
        let store = PluginBundleStore::new_at(store_root.path().to_path_buf());

        let err = store.install_ovcsp_with_limits(&bundle_path, InstallerLimits::default());
        assert!(err.is_err());
    }

    #[test]
    /// Verifies installer rejects suspicious compression ratios.
    ///
    /// # Returns
    /// - `()`.
    fn install_rejects_tar_suspicious_compression_ratio() {
        let big = vec![0u8; 2 * 1024 * 1024];
        let bundle = make_tar_gz_bundle(vec![
            TarEntry {
                name: "test.plugin/openvcs.plugin.json".into(),
                data: basic_manifest("test.plugin", ""),
                unix_mode: None,
                kind: TarEntryKind::File,
            },
            TarEntry {
                name: "test.plugin/assets/big.bin".into(),
                data: big,
                unix_mode: Some(0o100644),
                kind: TarEntryKind::File,
            },
        ]);

        let (_tmp, bundle_path) = write_bundle_to_temp(&bundle);
        let store_root = tempdir().unwrap();
        let store = PluginBundleStore::new_at(store_root.path().to_path_buf());

        let limits = InstallerLimits {
            max_files: 10,
            max_file_bytes: 10 * 1024 * 1024,
            max_total_bytes: 20 * 1024 * 1024,
            max_compression_ratio: 5,
        };

        let err = store.install_ovcsp_with_limits(&bundle_path, limits);
        assert!(err.is_err());
    }

    #[test]
    /// Verifies component listing skips invalid plugins instead of failing globally.
    fn list_current_components_skips_invalid_plugins() {
        let root = tempdir().expect("tempdir");
        let store = PluginBundleStore::new_at(root.path().to_path_buf());

        write_installed_plugin(root.path(), "valid.theme", "1.0.0", None);
        write_installed_plugin(root.path(), "broken.runtime", "1.0.0", Some("plugin.wasm"));

        let components = store
            .list_current_components()
            .expect("list current components");

        assert_eq!(components.len(), 1);
        assert_eq!(components[0].plugin_id, "valid.theme");
        assert!(components[0].module.is_none());
    }

    /// Writes an installed plugin directory with optional module entrypoint.
    fn write_installed_plugin(
        root: &std::path::Path,
        plugin_id: &str,
        version: &str,
        module_exec: Option<&str>,
    ) {
        let plugin_dir = root.join(plugin_id);
        fs::create_dir_all(&plugin_dir).expect("create plugin dir");

        let manifest = if let Some(exec) = module_exec {
            serde_json::json!({
                "id": plugin_id,
                "name": "Test",
                "version": version,
                "default_enabled": false,
                "module": {
                    "exec": exec,
                    "vcs_backends": []
                }
            })
        } else {
            serde_json::json!({
                "id": plugin_id,
                "name": "Test",
                "version": version,
                "default_enabled": false
            })
        };

        fs::write(
            plugin_dir.join(PLUGIN_MANIFEST_NAME),
            serde_json::to_vec_pretty(&manifest).expect("serialize manifest"),
        )
        .expect("write manifest");

        let index = InstalledPluginIndex {
            plugin_id: plugin_id.to_string(),
            current: Some(version.to_string()),
            versions: {
                let mut versions = BTreeMap::new();
                versions.insert(
                    version.to_string(),
                    InstalledPluginVersion {
                        version: version.to_string(),
                        bundle_sha256: "sha".to_string(),
                        installed_at_unix_ms: 0,
                        requested_capabilities: Vec::new(),
                        approval: ApprovalState::Approved {
                            capabilities: Vec::new(),
                            approved_at_unix_ms: 0,
                        },
                    },
                );
                versions
            },
        };

        fs::write(
            plugin_dir.join("index.json"),
            serde_json::to_vec_pretty(&index).expect("serialize index"),
        )
        .expect("write index");

        let current = CurrentPointer {
            version: version.to_string(),
        };
        fs::write(
            plugin_dir.join("current.json"),
            serde_json::to_vec_pretty(&current).expect("serialize current"),
        )
        .expect("write current");
    }
}
