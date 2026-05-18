// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

use super::{package_has_runtime_dependencies, resolve_local_plugin_path, sanitize_archive_path};
use std::fs;

#[test]
/// Verifies local plugin paths resolve relative and absolute directories.
fn resolves_local_plugin_paths() {
    let base = tempfile::tempdir().expect("create base dir");
    let rel = base.path().join("plugin");
    fs::create_dir_all(&rel).expect("create plugin dir");

    assert_eq!(resolve_local_plugin_path("plugin", base.path()), Some(rel.clone()));
    assert_eq!(resolve_local_plugin_path(rel.to_str().expect("utf8 path"), base.path()), Some(rel));
    assert!(resolve_local_plugin_path("", base.path()).is_none());
    assert!(resolve_local_plugin_path("missing", base.path()).is_none());
}

#[test]
/// Verifies archive path sanitizer rejects unsafe package entries.
fn sanitizes_archive_entry_paths() {
    assert_eq!(sanitize_archive_path("package/index.js").expect("safe path"), std::path::PathBuf::from("package/index.js"));
    assert_eq!(sanitize_archive_path("package\\index.js").expect("windows path"), std::path::PathBuf::from("package/index.js"));
    assert!(sanitize_archive_path("/package/index.js").is_err());
    assert!(sanitize_archive_path("package/../index.js").is_err());
    assert!(sanitize_archive_path("package\0/index.js").is_err());
}

#[test]
/// Verifies runtime dependency detection reads package.json object fields.
fn detects_runtime_dependencies_in_package_json() {
    let dir = tempfile::tempdir().expect("create temp dir");
    let package_json = dir.path().join("package.json");

    fs::write(&package_json, r#"{"name":"plugin"}"#).expect("write package json");
    assert!(!package_has_runtime_dependencies(&package_json).expect("read manifest"));

    fs::write(&package_json, r#"{"dependencies":{"left-pad":"1.0.0"}}"#).expect("write deps manifest");
    assert!(package_has_runtime_dependencies(&package_json).expect("read deps manifest"));

    fs::write(&package_json, r#"{"optionalDependencies":{"x":"1.0.0"}}"#).expect("write optional deps manifest");
    assert!(package_has_runtime_dependencies(&package_json).expect("read optional deps manifest"));
}
