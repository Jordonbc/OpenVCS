use crate::plugin_paths::{
    built_in_plugin_dirs, ensure_dir, plugins_dir, PLUGIN_MANIFEST_NAME,
};
use log::warn;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, HashSet};
use std::fs;
use std::io::{Read, Seek, Write};
use std::path::{Component, Path, PathBuf};
use std::sync::OnceLock;
use zip::ZipArchive;

#[derive(Debug, Clone, Copy)]
pub struct InstallerLimits {
    pub max_files: u64,
    pub max_file_bytes: u64,
    pub max_total_bytes: u64,
    pub max_compression_ratio: u64,
}

impl Default for InstallerLimits {
    fn default() -> Self {
        Self {
            max_files: 4096,
            max_file_bytes: 64 * 1024 * 1024,
            max_total_bytes: 512 * 1024 * 1024,
            max_compression_ratio: 200,
        }
    }
}

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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InstalledPluginVersion {
    pub version: String,
    pub bundle_sha256: String,
    pub installed_at_unix_ms: u64,
    #[serde(default)]
    pub requested_capabilities: Vec<String>,
    pub approval: ApprovalState,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InstalledPluginIndex {
    pub plugin_id: String,
    #[serde(default)]
    pub current: Option<String>,
    #[serde(default)]
    pub versions: BTreeMap<String, InstalledPluginVersion>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CurrentPointer {
    pub version: String,
}

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

#[derive(Debug, Deserialize)]
#[serde(untagged)]
pub enum BackendProvide {
    Id(String),
    Named {
        id: String,
        #[serde(default)]
        name: Option<String>,
    },
}

#[derive(Debug, Deserialize)]
pub struct PluginManifestBackend {
    #[serde(default)]
    pub exec: Option<String>,
    #[serde(default)]
    pub provides: Vec<BackendProvide>,
}

#[derive(Debug, Deserialize)]
pub struct PluginManifestFunctions {
    #[serde(default)]
    pub exec: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct PluginManifest {
    pub id: String,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub version: Option<String>,
    #[serde(default)]
    pub capabilities: Vec<String>,
    #[serde(default)]
    pub backend: Option<PluginManifestBackend>,
    #[serde(default)]
    pub functions: Option<PluginManifestFunctions>,
}

fn now_unix_ms() -> u64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

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

fn sanitize_zip_name(name: &str) -> Result<PathBuf, String> {
    if name.contains('\0') {
        return Err("zip entry contains NUL".to_string());
    }
    let normalized = name.replace('\\', "/");
    if normalized.starts_with('/') {
        return Err(format!("zip entry has an absolute path: {name}"));
    }
    // Reject Windows-style drive prefixes even on Unix hosts (e.g. "C:/...").
    if normalized.len() >= 2 && normalized.as_bytes()[1] == b':' {
        return Err(format!("zip entry has a drive prefix: {name}"));
    }
    let p = Path::new(&normalized);

    for c in p.components() {
        match c {
            Component::Prefix(_) | Component::RootDir => {
                return Err(format!("zip entry has an absolute path: {name}"));
            }
            Component::ParentDir => {
                return Err(format!("zip entry contains '..': {name}"));
            }
            _ => {}
        }
    }

    Ok(p.to_path_buf())
}

fn is_zip_symlink<R: Read>(file: &zip::read::ZipFile<'_, R>) -> bool {
    // Unix symlink bit: 0120000 (S_IFLNK)
    file.unix_mode().is_some_and(|m| (m & 0o170000) == 0o120000)
}

pub struct PluginBundleStore {
    root: PathBuf,
}

#[derive(Debug, Clone)]
pub struct BackendComponent {
    pub exec: String,
    pub exec_path: PathBuf,
    pub provides: Vec<(String, Option<String>)>,
}

#[derive(Debug, Clone)]
pub struct FunctionsComponent {
    pub exec: String,
    pub exec_path: PathBuf,
}

#[derive(Debug, Clone)]
pub struct InstalledPluginComponents {
    pub plugin_id: String,
    pub name: Option<String>,
    pub version: String,
    pub install_dir: PathBuf,
    pub requested_capabilities: Vec<String>,
    pub backend: Option<BackendComponent>,
    pub functions: Option<FunctionsComponent>,
}

impl PluginBundleStore {
    pub fn new_default() -> Self {
        let root = plugins_dir();
        ensure_dir(&root);
        Self { root }
    }

    pub fn plugin_root_dir(&self, plugin_id: &str) -> PathBuf {
        self.root.join(plugin_id.trim())
    }

    #[cfg(test)]
    fn new_at(root: PathBuf) -> Self {
        Self { root }
    }

    pub fn install_ovcsp(&self, bundle_path: &Path) -> Result<InstalledPlugin, String> {
        self.install_ovcsp_with_limits(bundle_path, InstallerLimits::default())
    }

    pub fn install_ovcsp_with_limits(
        &self,
        bundle_path: &Path,
        limits: InstallerLimits,
    ) -> Result<InstalledPlugin, String> {
        if !bundle_path.is_file() {
            return Err(format!("bundle is not a file: {}", bundle_path.display()));
        }

        fs::create_dir_all(&self.root)
            .map_err(|e| format!("create {}: {e}", self.root.display()))?;

        let bundle_sha256 = sha256_hex_file(bundle_path)?;
        let f = fs::File::open(bundle_path)
            .map_err(|e| format!("open {}: {e}", bundle_path.display()))?;
        let mut zip = ZipArchive::new(f).map_err(|e| format!("read zip: {e}"))?;
        let (manifest_zip_path, manifest) = locate_manifest(&mut zip)?;
        let plugin_id = manifest.id.trim().to_string();
        if plugin_id.is_empty() {
            return Err("manifest id is empty".to_string());
        }

        // Enforce that the top-level directory name matches the manifest id.
        let zip_root = manifest_zip_path
            .parent()
            .and_then(|p| p.file_name())
            .and_then(|s| s.to_str())
            .unwrap_or_default()
            .to_string();
        if zip_root != plugin_id {
            return Err(format!(
                "bundle root folder '{}' does not match manifest id '{}'",
                zip_root, plugin_id
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
        fs::create_dir_all(&staging_version_dir)
            .map_err(|e| format!("create {}: {e}", staging_version_dir.display()))?;

        let mut total_files = 0u64;
        let mut total_uncompressed = 0u64;
        let root_canon = fs::canonicalize(&staging_version_dir)
            .map_err(|e| format!("canonicalize {}: {e}", staging_version_dir.display()))?;

        // Extract all entries under `<pluginId>/...` into the staging version directory.
        for i in 0..zip.len() {
            let mut entry = zip.by_index(i).map_err(|e| format!("zip entry {i}: {e}"))?;
            let raw_name = entry.name().to_string();
            let name = sanitize_zip_name(&raw_name)?;

            // Reject symlinks outright.
            if is_zip_symlink(&entry) {
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

            if entry.is_dir() {
                let dir_path = staging_version_dir.join(&stripped);
                fs::create_dir_all(&dir_path)
                    .map_err(|e| format!("create {}: {e}", dir_path.display()))?;
                let dir_canon = fs::canonicalize(&dir_path)
                    .map_err(|e| format!("canonicalize {}: {e}", dir_path.display()))?;
                if !dir_canon.starts_with(&root_canon) {
                    return Err("zip extraction escaped install directory".to_string());
                }
                continue;
            }

            total_files += 1;
            if total_files > limits.max_files {
                return Err(format!(
                    "bundle exceeds max file count ({})",
                    limits.max_files
                ));
            }

            let declared_size = entry.size();
            if declared_size > limits.max_file_bytes {
                return Err(format!(
                    "bundle contains an oversized file ({} bytes, max {})",
                    declared_size, limits.max_file_bytes
                ));
            }

            let compressed = entry.compressed_size();
            let ratio = if compressed == 0 {
                if declared_size == 0 {
                    1
                } else {
                    u64::MAX
                }
            } else {
                (declared_size / compressed).max(1)
            };
            if ratio > limits.max_compression_ratio && declared_size > 1024 * 1024 {
                return Err("bundle rejected due to suspicious compression ratio".to_string());
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

            let out_path = staging_version_dir.join(&stripped);
            if let Some(parent) = out_path.parent() {
                fs::create_dir_all(parent)
                    .map_err(|e| format!("create {}: {e}", parent.display()))?;
                let parent_canon = fs::canonicalize(parent)
                    .map_err(|e| format!("canonicalize {}: {e}", parent.display()))?;
                if !parent_canon.starts_with(&root_canon) {
                    return Err("zip extraction escaped install directory".to_string());
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
                let n = entry.read(&mut buf).map_err(|e| format!("read zip: {e}"))?;
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
                let mut mode = entry.unix_mode().unwrap_or(0o644) & 0o777;
                // For files under bin/, ensure executable.
                if stripped
                    .components()
                    .next()
                    .is_some_and(|c| c.as_os_str() == "bin")
                    && (mode & 0o111) == 0
                {
                    mode |= 0o111;
                }
                let _ = fs::set_permissions(&out_path, fs::Permissions::from_mode(mode));
            }

            // Canonicalize the written file and ensure it still lives under the version dir.
            let out_canon = fs::canonicalize(&out_path)
                .map_err(|e| format!("canonicalize {}: {e}", out_path.display()))?;
            if !out_canon.starts_with(&root_canon) {
                return Err("zip extraction escaped install directory".to_string());
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
            return Err(format!(
                "installed bundle is missing {}",
                extracted_manifest.display()
            ));
        }

        let (backend_exec, functions_exec) = (
            manifest
                .backend
                .and_then(|b| b.exec)
                .map(|s| s.trim().to_string()),
            manifest
                .functions
                .and_then(|f| f.exec)
                .map(|s| s.trim().to_string()),
        );

        validate_entrypoint(&staging_version_dir, backend_exec.as_deref(), "backend")?;
        validate_entrypoint(&staging_version_dir, functions_exec.as_deref(), "functions")?;

        // Promote staged version into place (flat layout, drop old version directory).
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

        Ok(InstalledPlugin {
            plugin_id,
            version,
            bundle_sha256,
            requested_capabilities,
            approval,
            install_dir: plugin_dir,
        })
    }

    pub fn sync_built_in_plugins(&self) -> Result<(), String> {
        let mut errors = Vec::new();
        for bundle in builtin_bundle_paths() {
            if let Err(err) = self.ensure_built_in_bundle(&bundle) {
                let msg = format!("{}: {}", bundle.display(), err);
                warn!("plugins: failed to sync built-in bundle: {}", msg);
                errors.push(msg);
            }
        }
        if errors.is_empty() {
            Ok(())
        } else {
            Err(errors.join("; "))
        }
    }

    fn ensure_built_in_bundle(&self, bundle_path: &Path) -> Result<(), String> {
        let bundle_sha256 = sha256_hex_file(bundle_path)?;
        let file = fs::File::open(bundle_path)
            .map_err(|e| format!("open {}: {e}", bundle_path.display()))?;
        let mut zip = ZipArchive::new(file)
            .map_err(|e| format!("read {}: {e}", bundle_path.display()))?;
        let (_manifest_path, manifest) = locate_manifest(&mut zip)?;
        let plugin_id = manifest.id.trim();
        if plugin_id.is_empty() {
            return Err("bundle manifest id is empty".to_string());
        }
        let plugin_id = plugin_id.to_string();
        let version = derive_install_version(&manifest, &bundle_sha256);
        if let Some(installed) = self.get_current_installed(&plugin_id)? {
            if installed.bundle_sha256 == bundle_sha256 && installed.version == version {
                return Ok(());
            }
        }
        self.install_ovcsp_with_limits(bundle_path, InstallerLimits::default())?;
        if let Err(err) = self.approve_capabilities(&plugin_id, &version, true) {
            warn!(
                "plugins: failed to auto-approve built-in {} ({}): {}",
                plugin_id, version, err
            );
        }
        Ok(())
    }

    pub fn uninstall_plugin(&self, plugin_id: &str) -> Result<(), String> {
        let id = plugin_id.trim();
        if id.is_empty() {
            return Err("plugin id is empty".to_string());
        }
        let lower = id.to_ascii_lowercase();
        if built_in_plugin_ids().contains(&lower) {
            return Err("built-in plugins cannot be removed".to_string());
        }
        let dir = self.root.join(id);
        if !dir.exists() {
            return Ok(());
        }
        fs::remove_dir_all(&dir).map_err(|e| format!("remove {}: {e}", dir.display()))
    }

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
                if let Ok(idx) = serde_json::from_str::<InstalledPluginIndex>(&text) {
                    out.push(idx);
                }
            }
        }
        out.sort_by(|a, b| a.plugin_id.cmp(&b.plugin_id));
        Ok(out)
    }

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

    pub fn get_current_installed(
        &self,
        plugin_id: &str,
    ) -> Result<Option<InstalledPluginVersion>, String> {
        let id = plugin_id.trim();
        if id.is_empty() {
            return Err("plugin id is empty".to_string());
        }
        let Some(index) = self.read_index(id) else {
            return Ok(None);
        };
        let Some(ver) = index.current.as_deref() else {
            return Ok(None);
        };
        Ok(index.versions.get(ver).cloned())
    }

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

        let version = manifest
            .version
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_string)
            .unwrap_or_else(|| {
                version_dir
                    .file_name()
                    .unwrap_or_default()
                    .to_string_lossy()
                    .to_string()
            });

        let requested_capabilities = normalize_capabilities(manifest.capabilities.clone());

        let backend = manifest.backend.and_then(|b| {
            let exec = b.exec?.trim().to_string();
            if exec.is_empty() {
                return None;
            }
            let exec_path = version_dir.join("bin").join(platform_exec_name(&exec));
            Some(BackendComponent {
                exec,
                exec_path,
                provides: b
                    .provides
                    .into_iter()
                    .filter_map(|p| match p {
                        BackendProvide::Id(id) => {
                            let id = id.trim().to_string();
                            (!id.is_empty()).then_some((id, None))
                        }
                        BackendProvide::Named { id, name } => {
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

        let functions = manifest.functions.and_then(|f| {
            let exec = f.exec?.trim().to_string();
            if exec.is_empty() {
                return None;
            }
            let exec_path = version_dir.join("bin").join(platform_exec_name(&exec));
            Some(FunctionsComponent { exec, exec_path })
        });

        // Validate that declared entrypoints exist (defense-in-depth; installer should have ensured).
        if let Some(b) = &backend {
            validate_entrypoint(&version_dir, Some(&b.exec), "backend")?;
        }
        if let Some(f) = &functions {
            validate_entrypoint(&version_dir, Some(&f.exec), "functions")?;
        }

        Ok(Some(InstalledPluginComponents {
            plugin_id: id,
            name: manifest
                .name
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty()),
            version,
            install_dir: version_dir,
            requested_capabilities,
            backend,
            functions,
        }))
    }

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
            let plugin_id = match path.file_name().and_then(|s| s.to_str()) {
                Some(s) => s.to_string(),
                None => continue,
            };
            if let Some(c) = self.load_current_components(&plugin_id)? {
                out.push(c);
            }
        }
        out.sort_by(|a, b| a.plugin_id.cmp(&b.plugin_id));
        Ok(out)
    }

    fn read_index(&self, plugin_id: &str) -> Option<InstalledPluginIndex> {
        let p = self.root.join(plugin_id).join("index.json");
        let text = fs::read_to_string(p).ok()?;
        serde_json::from_str(&text).ok()
    }

    fn write_index(&self, plugin_id: &str, index: &InstalledPluginIndex) -> Result<(), String> {
        let p = self.root.join(plugin_id).join("index.json");
        let tmp = p.with_extension("json.tmp");
        let text =
            serde_json::to_string_pretty(index).map_err(|e| format!("serialize index: {e}"))?;
        fs::write(&tmp, text).map_err(|e| format!("write {}: {e}", tmp.display()))?;
        fs::rename(&tmp, &p).map_err(|e| format!("rename {}: {e}", p.display()))?;
        Ok(())
    }

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

pub fn built_in_plugin_ids() -> &'static HashSet<String> {
    BUILT_IN_PLUGIN_IDS.get_or_init(read_built_in_plugin_ids)
}

fn read_built_in_plugin_ids() -> HashSet<String> {
    let mut out: HashSet<String> = HashSet::new();

    for bundle_path in builtin_bundle_paths() {
        let file = match fs::File::open(&bundle_path) {
            Ok(file) => file,
            Err(err) => {
                warn!(
                    "plugins: failed to open built-in bundle {}: {}",
                    bundle_path.display(),
                    err
                );
                continue;
            }
        };

        let mut zip = match ZipArchive::new(file) {
            Ok(zip) => zip,
            Err(err) => {
                warn!(
                    "plugins: failed to read built-in bundle {}: {}",
                    bundle_path.display(),
                    err
                );
                continue;
            }
        };

        let (_manifest_path, manifest) = match locate_manifest(&mut zip) {
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

fn derive_install_version(manifest: &PluginManifest, bundle_sha256: &str) -> String {
    manifest
        .version
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| format!("sha256-{}", &bundle_sha256[..12]))
}

fn locate_manifest<R: Read + Seek>(
    zip: &mut ZipArchive<R>,
) -> Result<(PathBuf, PluginManifest), String> {
    let mut manifest_zip_path: Option<PathBuf> = None;
    let mut manifest_json: Option<Vec<u8>> = None;

    for i in 0..zip.len() {
        let mut entry = zip
            .by_index(i)
            .map_err(|e| format!("zip entry {i}: {e}"))?;
        let raw_name = entry.name().to_string();
        let name = sanitize_zip_name(&raw_name)?;

        if name
            .file_name()
            .and_then(|s| s.to_str())
            .is_some_and(|s| s == PLUGIN_MANIFEST_NAME)
        {
            let comps: Vec<_> = name.components().collect();
            if comps.len() != 2 {
                continue;
            }
            if manifest_zip_path.is_some() {
                return Err(format!(
                    "bundle contains multiple {PLUGIN_MANIFEST_NAME} files"
                ));
            }
            let mut bytes = Vec::new();
            entry
                .read_to_end(&mut bytes)
                .map_err(|e| format!("read manifest: {e}"))?;
            manifest_zip_path = Some(name);
            manifest_json = Some(bytes);
        }
    }

    let manifest_zip_path = manifest_zip_path
        .ok_or_else(|| format!("bundle is missing {PLUGIN_MANIFEST_NAME}"))?;
    let manifest_json = manifest_json.expect("manifest bytes to exist");

    let manifest: PluginManifest = serde_json::from_slice(&manifest_json)
        .map_err(|e| format!("parse {PLUGIN_MANIFEST_NAME}: {e}"))?;
    Ok((manifest_zip_path, manifest))
}

fn normalize_capabilities(mut caps: Vec<String>) -> Vec<String> {
    for c in &mut caps {
        *c = c.trim().to_string();
    }
    caps.retain(|c| !c.is_empty());
    caps.sort();
    caps.dedup();
    caps
}

fn platform_exec_name(base: &str) -> String {
    base.to_string()
}

fn validate_entrypoint(version_dir: &Path, exec: Option<&str>, label: &str) -> Result<(), String> {
    let Some(exec) = exec else {
        return Ok(());
    };
    let trimmed = exec.trim();
    if trimmed.is_empty() {
        return Ok(());
    }

    if !trimmed.ends_with(".wasm") {
        return Err(format!(
            "{} entrypoint must be a .wasm module, got: {}",
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
    use std::io::Cursor;
    use tempfile::tempdir;
    use zip::write::FileOptions;
    use zip::CompressionMethod;
    use zip::ZipWriter;

    struct Entry {
        name: String,
        data: Vec<u8>,
        unix_mode: Option<u32>,
        method: CompressionMethod,
    }

    fn make_bundle(entries: Vec<Entry>) -> Vec<u8> {
        let mut out = Vec::new();
        let mut zip = ZipWriter::new(Cursor::new(&mut out));
        let mut unix_modes: Vec<(String, u32)> = Vec::new();
        for e in entries {
            let mut opts: FileOptions<'_, ()> = FileOptions::default().compression_method(e.method);
            if let Some(mode) = e.unix_mode {
                opts = opts.unix_permissions(mode);
                unix_modes.push((e.name.clone(), mode));
            }
            zip.start_file(e.name, opts).unwrap();
            zip.write_all(&e.data).unwrap();
        }
        zip.finish().unwrap();

        for (name, mode) in unix_modes {
            force_unix_mode(&mut out, &name, mode);
        }
        out
    }

    fn force_unix_mode(zip_bytes: &mut [u8], name: &str, mode: u32) {
        // Patch the central directory "external file attributes" to include the full unix mode
        // (including file type bits) so `ZipFile::unix_mode()` can detect symlinks.
        //
        // Central directory file header signature: 0x02014b50 (little-endian).
        // Filename length is at offset 28, extra length at 30, comment length at 32.
        // External attrs are at offset 38 (4 bytes).
        // Version made by is at offset 4 (2 bytes): upper byte is OS (3 = Unix).
        const SIG: [u8; 4] = [0x50, 0x4b, 0x01, 0x02];
        let name_bytes = name.as_bytes();
        let mut i = 0usize;
        while i + 46 <= zip_bytes.len() {
            if zip_bytes[i..i + 4] != SIG {
                i += 1;
                continue;
            }
            let file_name_len = u16::from_le_bytes([zip_bytes[i + 28], zip_bytes[i + 29]]) as usize;
            let extra_len = u16::from_le_bytes([zip_bytes[i + 30], zip_bytes[i + 31]]) as usize;
            let comment_len = u16::from_le_bytes([zip_bytes[i + 32], zip_bytes[i + 33]]) as usize;
            let name_start = i + 46;
            let name_end = name_start.saturating_add(file_name_len);
            if name_end > zip_bytes.len() {
                break;
            }
            if zip_bytes[name_start..name_end] == *name_bytes {
                // Set "version made by" OS to Unix (3) so unix_mode is respected.
                let v = u16::from_le_bytes([zip_bytes[i + 4], zip_bytes[i + 5]]);
                let v = (v & 0x00ff) | (3u16 << 8);
                zip_bytes[i + 4..i + 6].copy_from_slice(&v.to_le_bytes());

                let attrs = (mode as u32) << 16;
                zip_bytes[i + 38..i + 42].copy_from_slice(&attrs.to_le_bytes());
                return;
            }
            i = name_end + extra_len + comment_len;
        }
    }

    fn write_bundle_to_temp(bytes: &[u8]) -> (tempfile::TempDir, PathBuf) {
        let dir = tempdir().unwrap();
        let path = dir.path().join("bundle.ovcsp");
        fs::write(&path, bytes).unwrap();
        (dir, path)
    }

    fn basic_manifest(id: &str, extra: &str) -> Vec<u8> {
        format!("{{\"id\":\"{id}\",\"name\":\"Test\",\"version\":\"1.0.0\"{extra}}}").into_bytes()
    }

    #[test]
    fn install_rejects_zipslip_parent_dir() {
        let bundle = make_bundle(vec![
            Entry {
                name: "test.plugin/openvcs.plugin.json".into(),
                data: basic_manifest("test.plugin", ",\"functions\":{\"exec\":\"fn\"}"),
                unix_mode: None,
                method: CompressionMethod::Stored,
            },
            Entry {
                name: "test.plugin/bin/fn".into(),
                data: b"#!/bin/sh\necho hi\n".to_vec(),
                unix_mode: Some(0o100755),
                method: CompressionMethod::Stored,
            },
            Entry {
                name: "test.plugin/../evil.txt".into(),
                data: b"nope".to_vec(),
                unix_mode: None,
                method: CompressionMethod::Stored,
            },
        ]);

        let (_tmp, bundle_path) = write_bundle_to_temp(&bundle);
        let store_root = tempdir().unwrap();
        let store = PluginBundleStore::new_at(store_root.path().to_path_buf());

        let err = store.install_ovcsp_with_limits(&bundle_path, InstallerLimits::default());
        assert!(err.is_err());
    }

    #[test]
    fn install_rejects_symlink_entries() {
        let bundle = make_bundle(vec![
            Entry {
                name: "test.plugin/openvcs.plugin.json".into(),
                data: basic_manifest("test.plugin", ""),
                unix_mode: None,
                method: CompressionMethod::Stored,
            },
            Entry {
                name: "test.plugin/bin/link".into(),
                data: b"target".to_vec(),
                unix_mode: Some(0o120777),
                method: CompressionMethod::Stored,
            },
        ]);

        let (_tmp, bundle_path) = write_bundle_to_temp(&bundle);
        let store_root = tempdir().unwrap();
        let store = PluginBundleStore::new_at(store_root.path().to_path_buf());

        let err = store.install_ovcsp_with_limits(&bundle_path, InstallerLimits::default());
        assert!(err.is_err());
    }

    #[test]
    fn install_enforces_file_count_and_size_limits() {
        let mut entries = vec![Entry {
            name: "test.plugin/openvcs.plugin.json".into(),
            data: basic_manifest("test.plugin", ""),
            unix_mode: None,
            method: CompressionMethod::Stored,
        }];
        for i in 0..5 {
            entries.push(Entry {
                name: format!("test.plugin/assets/{i}.txt"),
                data: b"1234".to_vec(),
                unix_mode: None,
                method: CompressionMethod::Stored,
            });
        }
        let bundle = make_bundle(entries);

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
    fn install_rejects_suspicious_compression_ratio() {
        let big = vec![0u8; 2 * 1024 * 1024];
        let bundle = make_bundle(vec![
            Entry {
                name: "test.plugin/openvcs.plugin.json".into(),
                data: basic_manifest("test.plugin", ""),
                unix_mode: None,
                method: CompressionMethod::Stored,
            },
            Entry {
                name: "test.plugin/assets/big.bin".into(),
                data: big,
                unix_mode: Some(0o100644),
                method: CompressionMethod::Deflated,
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
    fn install_requires_manifest_at_expected_location() {
        let bundle = make_bundle(vec![Entry {
            name: "test.plugin/other.json".into(),
            data: b"{}".to_vec(),
            unix_mode: None,
            method: CompressionMethod::Stored,
        }]);

        let (_tmp, bundle_path) = write_bundle_to_temp(&bundle);
        let store_root = tempdir().unwrap();
        let store = PluginBundleStore::new_at(store_root.path().to_path_buf());

        let err = store.install_ovcsp(&bundle_path);
        assert!(err.is_err());
    }

    #[test]
    fn install_validates_declared_entrypoints_exist() {
        let bundle = make_bundle(vec![Entry {
            name: "test.plugin/openvcs.plugin.json".into(),
            data: basic_manifest(
                "test.plugin",
                ",\"backend\":{\"exec\":\"missing\",\"provides\":[\"x\"]}",
            ),
            unix_mode: None,
            method: CompressionMethod::Stored,
        }]);

        let (_tmp, bundle_path) = write_bundle_to_temp(&bundle);
        let store_root = tempdir().unwrap();
        let store = PluginBundleStore::new_at(store_root.path().to_path_buf());

        let err = store.install_ovcsp(&bundle_path);
        assert!(err.is_err());
    }
}
