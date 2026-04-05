// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later
//! Shared package.json manifest readers for OpenVCS plugins.

use crate::plugin_paths::PLUGIN_PACKAGE_NAME;
use serde::de::DeserializeOwned;
use serde::Deserialize;
use std::fs;
use std::path::{Path, PathBuf};

/// Wrapper for the `package.json.openvcs` manifest section.
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

/// Reads the `package.json.openvcs` manifest section from a plugin directory.
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
