// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later
//! Shared package.json manifest readers for OpenVCS plugins.

use crate::plugin_paths::PLUGIN_PACKAGE_NAME;
use serde::Deserialize;
use serde::de::DeserializeOwned;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

/// Fields from the top level of package.json that can serve as fallbacks
/// when the `openvcs` block omits them.
#[derive(Debug, Deserialize)]
pub struct PackageJsonTop {
    #[serde(default)]
    pub version: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub author: Option<String>,
}

#[cfg(test)]
mod tests {
    include!("../tests/modules/plugin_manifest.rs");
}

/// Wrapper for the `openvcs` section inside `package.json`.
#[derive(Debug, Deserialize)]
struct OpenvcsPackageManifest<T> {
    openvcs: T,
}

/// Returns the package manifest path for a plugin directory.
///
/// # Parameters
/// - `plugin_dir`: Plugin directory path.
///
/// # Returns
/// - `PathBuf` pointing to `package.json`.
pub fn package_manifest_path(plugin_dir: &Path) -> PathBuf {
    plugin_dir.join(PLUGIN_PACKAGE_NAME)
}

/// Reads only the top-level fallback fields from package.json without requiring an `openvcs` block.
///
/// # Parameters
/// - `plugin_dir`: Plugin directory path.
///
/// # Returns
/// - `Ok(PackageJsonTop)` when the file exists and parses.
/// - `Err(String)` when the file is missing or invalid.
pub fn read_package_json_top(plugin_dir: &Path) -> Result<PackageJsonTop, String> {
    let manifest_path = package_manifest_path(plugin_dir);
    let text = fs::read_to_string(&manifest_path)
        .map_err(|e| format!("read {}: {e}", manifest_path.display()))?;
    serde_json::from_str(&text).map_err(|e| format!("parse {}: {e}", manifest_path.display()))
}

/// Returns whether a plugin directory contains a package manifest.
///
/// # Parameters
/// - `plugin_dir`: Plugin directory path.
///
/// # Returns
/// - `true` when `package.json` exists.
/// - `false` otherwise.
pub fn has_package_manifest(plugin_dir: &Path) -> bool {
    package_manifest_path(plugin_dir).is_file()
}

/// Reads `package.json` from a plugin directory and returns its `openvcs` section.
///
/// # Parameters
/// - `plugin_dir`: Plugin directory path.
///
/// # Returns
/// - `Ok(T)` when the manifest exists and parses.
/// - `Err(String)` when the package file or `openvcs` section is missing/invalid.
pub fn read_openvcs_manifest<T: DeserializeOwned>(plugin_dir: &Path) -> Result<T, String> {
    let manifest_path = package_manifest_path(plugin_dir);
    let text = fs::read_to_string(&manifest_path)
        .map_err(|e| format!("read {}: {e}", manifest_path.display()))?;
    let package: OpenvcsPackageManifest<T> = serde_json::from_str(&text)
        .map_err(|e| format!("parse {}: {e}", manifest_path.display()))?;
    Ok(package.openvcs)
}

/// Manifest types that expose identity fields for shared validation.
pub(crate) trait ManifestIdentity {
    /// Returns the manifest id field.
    fn manifest_id(&self) -> &str;
    /// Returns the manifest name field.
    fn manifest_name(&self) -> &str;
    /// Applies package.json top-level fallbacks to fields the `openvcs` block omits.
    fn apply_package_json_fallbacks(&mut self, _top: &PackageJsonTop) {}
}

/// Validates that a manifest carries non-empty `id` and `name` fields.
///
/// # Parameters
/// - `manifest`: Parsed manifest to validate.
/// - `dir`: Directory the manifest was read from (used in error messages).
/// - `kind`: Human-readable manifest kind (`plugin` or `theme`).
///
/// # Returns
/// - `Ok(())` when both identity fields are non-empty.
/// - `Err(String)` naming the offending field.
pub(crate) fn validate_manifest_identity<T: ManifestIdentity>(
    manifest: &T,
    dir: &Path,
    kind: &str,
) -> Result<(), String> {
    if manifest.manifest_id().trim().is_empty() {
        return Err(format!("{kind} {} has an empty id", dir.display()));
    }
    if manifest.manifest_name().trim().is_empty() {
        return Err(format!("{kind} {} has an empty name", dir.display()));
    }
    Ok(())
}

/// Reads a plugin manifest from `package.json`'s `openvcs` block, applying
/// top-level package.json fallbacks for fields the block omits.
///
/// # Parameters
/// - `plugin_dir`: Plugin directory containing `package.json`.
///
/// # Returns
/// - `Ok(T)` parsed manifest with fallbacks applied.
/// - `Err(String)` when the package file is missing or invalid.
pub(crate) fn read_openvcs_manifest_from_dir<T>(plugin_dir: &Path) -> Result<T, String>
where
    T: DeserializeOwned + ManifestIdentity,
{
    let mut manifest: T = read_openvcs_manifest(plugin_dir)?;
    if let Ok(top) = read_package_json_top(plugin_dir) {
        manifest.apply_package_json_fallbacks(&top);
    }
    Ok(manifest)
}

/// Reads and validates a typed manifest from a JSON manifest file.
///
/// Reads `dir/{manifest_file}`, decodes it with `extract`, and validates the
/// manifest's identity fields.
///
/// # Parameters
/// - `dir`: Directory containing the manifest file.
/// - `manifest_file`: Manifest file name (e.g. `theme.json`).
/// - `kind`: Human-readable manifest kind for error messages.
/// - `extract`: Decoder producing the typed manifest from the file text.
///
/// # Returns
/// - `Ok(T)` when the file parses and identity fields are valid.
/// - `Err(String)` when the file is missing/invalid or identity is missing.
pub(crate) fn read_manifest_file<T, E>(
    dir: &Path,
    manifest_file: &str,
    kind: &str,
    extract: E,
) -> Result<T, String>
where
    T: ManifestIdentity,
    E: FnOnce(&str) -> Result<T, String>,
{
    let manifest_path = dir.join(manifest_file);
    let text = match fs::read_to_string(&manifest_path) {
        Ok(text) => text,
        Err(err) if err.kind() == io::ErrorKind::NotFound => {
            return Err(format!(
                "{kind} {} is missing {manifest_file}",
                dir.display()
            ));
        }
        Err(err) => return Err(format!("read {}: {err}", manifest_path.display())),
    };
    let manifest = extract(&text)?;
    validate_manifest_identity(&manifest, dir, kind)?;
    Ok(manifest)
}
