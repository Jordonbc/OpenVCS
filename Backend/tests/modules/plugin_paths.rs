// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

use super::{
    built_in_plugin_dirs, bundled_node_candidate_paths, ensure_dir, node_executable_path,
    set_node_executable_path, set_resource_dir, set_node_runtime_resource_dir,
};
use std::fs;

#[test]
/// Verifies directory creation helper creates nested paths.
fn creates_missing_directories() {
    let dir = tempfile::tempdir().expect("create temp dir");
    let nested = dir.path().join("nested/child");
    ensure_dir(&nested);
    assert!(nested.is_dir());
}

#[test]
/// Verifies bundled node candidate lookup honors configured runtime dir.
fn includes_configured_node_runtime_dir() {
    let dir = tempfile::tempdir().expect("create temp dir");
    set_node_runtime_resource_dir(dir.path().to_path_buf());
    let node_name = if cfg!(windows) { "node.exe" } else { "node" };
    let candidates = bundled_node_candidate_paths();
    assert!(candidates.iter().any(|path| path == &dir.path().join(node_name)));
}

#[test]
/// Verifies node executable setter stores the configured path.
fn stores_node_executable_path() {
    let path = tempfile::tempdir().expect("create temp dir").path().join("node");
    set_node_executable_path(path.clone());
    assert_eq!(node_executable_path(), Some(path));
}

#[test]
fn lists_only_built_in_plugin_dirs_with_package_manifests() {
    let dir = tempfile::tempdir().expect("create temp dir");
    let built_in_root = dir.path().join("built-in-plugins");
    let valid_plugin = built_in_root.join("plugin-a");
    let invalid_plugin = built_in_root.join("plugin-b");

    fs::create_dir_all(&valid_plugin).expect("create valid plugin dir");
    fs::create_dir_all(&invalid_plugin).expect("create invalid plugin dir");
    fs::write(valid_plugin.join("package.json"), "{}\n").expect("write package manifest");

    set_resource_dir(dir.path().to_path_buf());
    let plugin_dirs = built_in_plugin_dirs();

    assert!(plugin_dirs.iter().any(|path| path == &valid_plugin));
    assert!(!plugin_dirs.iter().any(|path| path == &invalid_plugin));
}
