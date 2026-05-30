// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later
//! Shared package.json manifest readers for OpenVCS plugins.

use crate::plugin_paths::PLUGIN_PACKAGE_NAME;
use serde::Deserialize;
use serde::de::DeserializeOwned;
use std::fs;
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
    serde_json::from_str(&text)
        .map_err(|e| format!("parse {}: {e}", manifest_path.display()))
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
