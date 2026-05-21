// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later
//! Config-driven plugin source resolution and synchronization.

use crate::plugin_bundles::{
    InstalledPluginSourceMetadata, PluginBundleStore, normalize_plugin_id,
};
use crate::settings::AppConfig;
use flate2::read::GzDecoder;
use log::{debug, info, warn};
use serde::Deserialize;
use std::collections::HashSet;
use std::fs;
use std::path::{Component, Path, PathBuf};

const MODULE: &str = "plugin_sources";
const USER_CONFIG_MANAGED_BY: &str = "user-config";

/// Minimal JSON payload returned by `npm pack --json`.
#[derive(Debug, Deserialize)]
struct NpmPackResult {
    /// Generated tarball file name.
    filename: String,
}

/// Synchronizes config-declared user plugins into the installed plugin store.
///
/// # Parameters
/// - `cfg`: Application config snapshot.
///
/// # Returns
/// - `Ok(())` when all configured plugins are synchronized.
/// - `Err(String)` when one or more plugin sources fail.
pub fn sync_configured_plugins(cfg: &AppConfig) -> Result<(), String> {
    let npm_version = ensure_npm_available()?;
    debug!("{}: using npm {}", MODULE, npm_version);
    let store = PluginBundleStore::new_default();
    let base_dir = AppConfig::path()
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or_else(|| PathBuf::from("."));
    let mut desired_ids = HashSet::new();
    let mut errors = Vec::new();

    info!(
        "{}: syncing {} configured plugin sources",
        MODULE,
        cfg.plugin.len()
    );

    for spec in &cfg.plugin {
        let trimmed = spec.trim();
        if trimmed.is_empty() {
            continue;
        }

        match sync_plugin_source(&store, trimmed, &base_dir) {
            Ok(installed) => {
                desired_ids.insert(normalize_plugin_id(&installed.plugin_id)?);
            }
            Err(err) => {
                let message = format!("{}: {}", trimmed, err);
                warn!("{}: failed to sync configured plugin: {}", MODULE, message);
                errors.push(message);
            }
        }
    }

    if errors.is_empty() {
        store.prune_managed_plugins(USER_CONFIG_MANAGED_BY, &desired_ids)?;
        Ok(())
    } else {
        Err(errors.join("; "))
    }
}

/// Resolves and installs one configured plugin source.
///
/// # Parameters
/// - `store`: Installed plugin store.
/// - `spec`: Raw config entry.
/// - `base_dir`: Base directory for relative path resolution.
///
/// # Returns
/// - `Ok(InstalledPlugin)` when synchronization succeeds.
/// - `Err(String)` when resolution or installation fails.
fn sync_plugin_source(
    store: &PluginBundleStore,
    spec: &str,
    base_dir: &Path,
) -> Result<crate::plugin_bundles::InstalledPlugin, String> {
    let temp_dir = tempfile::tempdir().map_err(|e| format!("create temp dir: {e}"))?;
    let prepared_dir = temp_dir.path().join("prepared");
    fs::create_dir_all(&prepared_dir)
        .map_err(|e| format!("create {}: {e}", prepared_dir.display()))?;

    let source_kind = if let Some(local_path) = resolve_local_plugin_path(spec, base_dir) {
        debug!(
            "{}: packing local plugin source {} -> {}",
            MODULE,
            spec,
            local_path.display()
        );
        let tarball = pack_plugin_source(&local_path, temp_dir.path())?;
        extract_plugin_archive(&tarball, &prepared_dir)?;
        "path"
    } else {
        debug!("{}: packing npm plugin source {}", MODULE, spec);
        let tarball = pack_plugin_source(Path::new(spec), temp_dir.path())?;
        extract_plugin_archive(&tarball, &prepared_dir)?;
        "npm"
    };

    install_plugin_runtime_dependencies(&prepared_dir)?;

    let metadata = InstalledPluginSourceMetadata {
        managed_by: USER_CONFIG_MANAGED_BY.to_string(),
        kind: source_kind.to_string(),
        spec: spec.to_string(),
    };

    store.install_prepared_plugin_dir(&prepared_dir, &metadata, true)
}

/// Resolves a config entry as a local plugin directory when possible.
///
/// # Parameters
/// - `spec`: Raw config entry.
/// - `base_dir`: Base directory for relative paths.
///
/// # Returns
/// - `Some(PathBuf)` when the spec resolves to an existing local directory.
/// - `None` otherwise.
fn resolve_local_plugin_path(spec: &str, base_dir: &Path) -> Option<PathBuf> {
    let trimmed = spec.trim();
    if trimmed.is_empty() {
        return None;
    }

    let expanded = if let Some(rest) = trimmed.strip_prefix("~/") {
        dirs::home_dir().map(|home| home.join(rest))
    } else {
        None
    };
    let candidate = expanded.unwrap_or_else(|| PathBuf::from(trimmed));

    let absolute = if candidate.is_absolute() {
        candidate
    } else {
        base_dir.join(candidate)
    };

    absolute.is_dir().then_some(absolute)
}

/// Packs a plugin source into an npm tarball using `npm pack --json`.
///
/// # Parameters
/// - `source`: npm package specifier or local package directory.
/// - `workdir`: Temporary working directory where the tarball is written.
///
/// # Returns
/// - `Ok(PathBuf)` absolute tarball path.
/// - `Err(String)` when `npm pack` fails.
fn pack_plugin_source(source: &Path, workdir: &Path) -> Result<PathBuf, String> {
    let source_arg = source.to_string_lossy().to_string();
    let mut command = crate::process_utils::hidden_command(npm_executable());
    let output = command
        .args(["pack", "--json", &source_arg])
        .current_dir(workdir)
        .output()
        .map_err(|e| format!("run npm pack: {e}"))?;

    if !output.status.success() {
        return Err(command_error_message("npm pack", &output.stderr));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let json_start = stdout
        .find('[')
        .ok_or_else(|| "npm pack did not emit JSON output".to_string())?;
    let json_line = &stdout[json_start..];
    let packs: Vec<NpmPackResult> =
        serde_json::from_str(json_line).map_err(|e| format!("parse npm pack output: {e}"))?;
    let filename = packs
        .last()
        .map(|entry| entry.filename.trim().to_string())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "npm pack did not report an output file".to_string())?;
    Ok(workdir.join(filename))
}

/// Extracts a packed npm tarball into a prepared plugin directory.
///
/// # Parameters
/// - `archive_path`: Tarball path produced by `npm pack`.
/// - `out_dir`: Empty destination directory.
///
/// # Returns
/// - `Ok(())` when extraction succeeds.
/// - `Err(String)` when archive contents are invalid.
fn extract_plugin_archive(archive_path: &Path, out_dir: &Path) -> Result<(), String> {
    let file = fs::File::open(archive_path)
        .map_err(|e| format!("open {}: {e}", archive_path.display()))?;
    let reader = GzDecoder::new(file);
    let mut archive = tar::Archive::new(reader);

    for entry in archive.entries().map_err(|e| format!("read tar: {e}"))? {
        let mut entry = entry.map_err(|e| format!("tar entry: {e}"))?;
        let raw_path = entry.path().map_err(|e| format!("tar entry path: {e}"))?;
        let safe_path = sanitize_archive_path(&raw_path.to_string_lossy())?;
        let mut components = safe_path.components();
        let Some(Component::Normal(prefix)) = components.next() else {
            return Err("npm pack archive must contain a top-level package/ directory".to_string());
        };
        if prefix != "package" {
            return Err("npm pack archive must contain a top-level package/ directory".to_string());
        }
        let stripped: PathBuf = components.collect();
        if stripped.as_os_str().is_empty() {
            continue;
        }

        let target = out_dir.join(&stripped);
        let entry_type = entry.header().entry_type();
        if entry_type.is_dir() {
            fs::create_dir_all(&target).map_err(|e| format!("create {}: {e}", target.display()))?;
            continue;
        }
        if !entry_type.is_file() {
            return Err(format!(
                "npm pack archive contains unsupported entry type at {}",
                stripped.display()
            ));
        }

        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent).map_err(|e| format!("create {}: {e}", parent.display()))?;
        }
        let mut out =
            fs::File::create(&target).map_err(|e| format!("create {}: {e}", target.display()))?;
        std::io::copy(&mut entry, &mut out)
            .map_err(|e| format!("write {}: {e}", target.display()))?;
    }

    Ok(())
}

/// Validates and normalizes an extracted archive path.
///
/// # Parameters
/// - `raw`: Raw archive entry path.
///
/// # Returns
/// - `Ok(PathBuf)` sanitized relative path.
/// - `Err(String)` when the path is unsafe.
fn sanitize_archive_path(raw: &str) -> Result<PathBuf, String> {
    if raw.contains('\0') {
        return Err(archive_entry_path_error("contains NUL byte", raw));
    }
    let normalized = raw.replace('\\', "/");
    if normalized.starts_with('/') {
        return Err(archive_entry_path_error("is absolute", raw));
    }
    let path = Path::new(&normalized);
    for component in path.components() {
        match component {
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => {
                return Err(archive_entry_path_error("escapes package root", raw));
            }
            _ => {}
        }
    }
    Ok(path.to_path_buf())
}

/// Formats a consistent archive path validation error.
///
/// # Parameters
/// - `reason`: Short reason for rejection.
/// - `raw`: Raw entry path.
///
/// # Returns
/// - Human-readable error string.
fn archive_entry_path_error(reason: &str, raw: &str) -> String {
    format!("invalid archive entry path ({reason}): {raw}")
}

/// Installs runtime npm dependencies into a prepared plugin directory.
///
/// # Parameters
/// - `prepared_dir`: Prepared plugin directory containing `package.json`.
///
/// # Returns
/// - `Ok(())` when dependency installation succeeds or is not needed.
/// - `Err(String)` when npm fails.
fn install_plugin_runtime_dependencies(prepared_dir: &Path) -> Result<(), String> {
    let package_json = prepared_dir.join("package.json");
    if !package_json.is_file() || !package_has_runtime_dependencies(&package_json)? {
        return Ok(());
    }

    let mut command = crate::process_utils::hidden_command(npm_executable());
    let output = command
        .args([
            "install",
            "--omit=dev",
            "--ignore-scripts",
            "--no-package-lock",
            "--no-bin-links",
            "--no-audit",
            "--no-fund",
        ])
        .current_dir(prepared_dir)
        .output()
        .map_err(|e| format!("run npm install: {e}"))?;

    if !output.status.success() {
        return Err(command_error_message("npm install", &output.stderr));
    }

    Ok(())
}

/// Returns whether a package declares runtime dependencies.
///
/// # Parameters
/// - `package_json`: Package manifest path.
///
/// # Returns
/// - `Ok(true)` when runtime dependencies are declared.
/// - `Ok(false)` when no runtime dependencies are declared.
/// - `Err(String)` when the manifest cannot be parsed.
fn package_has_runtime_dependencies(package_json: &Path) -> Result<bool, String> {
    let text = fs::read_to_string(package_json)
        .map_err(|e| format!("read {}: {e}", package_json.display()))?;
    let value: serde_json::Value = serde_json::from_str(&text)
        .map_err(|e| format!("parse {}: {e}", package_json.display()))?;
    Ok(has_non_empty_object_field(&value, "dependencies")
        || has_non_empty_object_field(&value, "optionalDependencies"))
}

/// Returns whether a JSON object field exists and contains at least one key.
///
/// # Parameters
/// - `value`: Package JSON payload.
/// - `field`: Object field name.
///
/// # Returns
/// - `true` when the field is a non-empty object.
/// - `false` otherwise.
fn has_non_empty_object_field(value: &serde_json::Value, field: &str) -> bool {
    value
        .get(field)
        .and_then(serde_json::Value::as_object)
        .is_some_and(|object| !object.is_empty())
}

/// Returns the npm executable name for the current platform.
///
/// # Returns
/// - `npm` on Unix-like systems.
/// - `npm.cmd` on Windows.
fn npm_executable() -> &'static str {
    if cfg!(windows) { "npm.cmd" } else { "npm" }
}

/// Ensures npm is available before plugin source sync begins.
///
/// # Returns
/// - `Ok(())` when npm is available.
/// - `Err(String)` when npm is missing or not executable.
fn ensure_npm_available() -> Result<String, String> {
    let version = npm_version()?;
    if version.trim().is_empty() {
        Err(format!(
            "npm is required to sync configured plugins, but '{}' did not report a version",
            npm_executable()
        ))
    } else {
        Ok(version)
    }
}

/// Returns the installed npm version string.
///
/// # Returns
/// - `Ok(String)` npm version reported by `npm --version`.
/// - `Err(String)` when npm is unavailable or the output cannot be read.
fn npm_version() -> Result<String, String> {
    let mut command = crate::process_utils::hidden_command(npm_executable());
    let output = command
        .arg("--version")
        .output()
        .map_err(|e| format!("run {} --version: {e}", npm_executable()))?;
    if !output.status.success() {
        return Err(command_error_message("npm --version", &output.stderr));
    }
    let version = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if version.is_empty() {
        return Err(format!("{} did not report a version", npm_executable()));
    }
    Ok(version)
}

/// Formats stderr output from a failed child process.
///
/// # Parameters
/// - `label`: Command label.
/// - `stderr`: Raw stderr bytes.
///
/// # Returns
/// - Readable error string.
fn command_error_message(label: &str, stderr: &[u8]) -> String {
    let text = String::from_utf8_lossy(stderr).trim().to_string();
    if text.is_empty() {
        format!("{label} failed")
    } else {
        format!("{label} failed: {text}")
    }
}

#[cfg(test)]
mod tests {
    include!("../tests/modules/plugin_sources.rs");
}
