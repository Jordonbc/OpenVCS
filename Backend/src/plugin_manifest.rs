// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later
//! Shared package.json manifest readers for OpenVCS plugins.

use crate::plugin_paths::PLUGIN_PACKAGE_NAME;
use serde::Deserialize;
use serde::de::DeserializeOwned;
use std::fs;
use std::path::{Path, PathBuf};

#[cfg(test)]
mod tests {
    use super::{has_package_manifest, package_manifest_path, read_openvcs_manifest};
    use serde::Deserialize;
    use std::fs;

    #[derive(Debug, Deserialize, PartialEq)]
    struct TestManifest {
        name: String,
        version: String,
    }

    #[test]
    /// Verifies manifest path helper targets package.json.
    fn builds_package_manifest_path() {
        let path = package_manifest_path(std::path::Path::new("/tmp/plugin"));
        assert_eq!(path, std::path::Path::new("/tmp/plugin/package.json"));
    }

    #[test]
    /// Verifies manifest existence checks follow filesystem state.
    fn detects_presence_of_package_manifest() {
        let dir = tempfile::tempdir().expect("create temp dir");
        assert!(!has_package_manifest(dir.path()));

        fs::write(dir.path().join("package.json"), "{}").expect("write package manifest");
        assert!(has_package_manifest(dir.path()));
    }

    #[test]
    /// Verifies openvcs manifest section parses from package.json.
    fn reads_openvcs_manifest_section() {
        let dir = tempfile::tempdir().expect("create temp dir");
        fs::write(
            dir.path().join("package.json"),
            r#"{
                "name": "plugin",
                "version": "1.0.0",
                "openvcs": { "name": "demo", "version": "2.0.0" }
            }"#,
        )
        .expect("write package manifest");

        let manifest: TestManifest = read_openvcs_manifest(dir.path()).expect("read openvcs manifest");
        assert_eq!(manifest, TestManifest { name: "demo".into(), version: "2.0.0".into() });
    }

    #[test]
    /// Verifies errors mention missing or malformed manifests.
    fn reports_manifest_errors() {
        let dir = tempfile::tempdir().expect("create temp dir");
        let err = read_openvcs_manifest::<TestManifest>(dir.path()).expect_err("missing manifest should fail");
        assert!(err.contains("package.json"));

        fs::write(dir.path().join("package.json"), "not json").expect("write invalid manifest");
        let err = read_openvcs_manifest::<TestManifest>(dir.path()).expect_err("invalid manifest should fail");
        assert!(err.contains("parse"));
    }
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
