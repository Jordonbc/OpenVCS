// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

use super::{create_node_runtime_instance, create_runtime_instance, is_node_module};
use crate::plugin_runtime::spawn::SpawnConfig;
use std::fs;
use std::path::PathBuf;
use tempfile::tempdir;

#[test]
/// Verifies non-script files are rejected by node runtime detection.
fn non_script_path_is_not_detected_as_node_module() {
    let temp = tempdir().expect("tempdir");
    let file_path = temp.path().join("plugin.bin");
    fs::write(&file_path, b"binary").expect("write file");

    assert!(!is_node_module(&file_path));
}

#[test]
/// Verifies `.mjs` files are accepted as runtime modules.
fn mjs_path_is_detected_as_node_module() {
    let temp = tempdir().expect("tempdir");
    let script_path = temp.path().join("plugin.mjs");
    fs::write(&script_path, b"export {}\n").expect("write script");

    assert!(is_node_module(&script_path));
}

#[test]
fn js_and_cjs_paths_are_detected_as_node_modules() {
    let temp = tempdir().expect("tempdir");

    let js_path = temp.path().join("plugin.js");
    fs::write(&js_path, b"export {}\n").expect("write js script");
    assert!(is_node_module(&js_path));

    let cjs_path = temp.path().join("plugin.cjs");
    fs::write(&cjs_path, b"module.exports = {}\n").expect("write cjs script");
    assert!(is_node_module(&cjs_path));
}

#[test]
fn uppercase_extensions_and_non_files_are_handled_consistently() {
    let temp = tempdir().expect("tempdir");

    let upper_js = temp.path().join("PLUGIN.JS");
    fs::write(&upper_js, b"export {}\n").expect("write upper js script");
    assert!(is_node_module(&upper_js));

    let dir_path = temp.path().join("plugin_dir");
    fs::create_dir_all(&dir_path).expect("create dir");
    assert!(!is_node_module(&dir_path));

    assert!(!is_node_module(&temp.path().join("missing.js")));
}

#[test]
fn create_node_runtime_instance_accepts_js_file() {
    let temp = tempfile::tempdir().expect("tempdir");
    let js_path = temp.path().join("plugin.mjs");
    std::fs::write(&js_path, b"export {}").expect("write");

    let result = create_node_runtime_instance(SpawnConfig {
        plugin_id: "test".into(),
        exec_path: js_path,
        allowed_workspace_root: None,
        is_vcs_backend: false,
    });
    assert!(result.is_ok());
}

#[test]
fn create_node_runtime_instance_rejects_non_js_file() {
    let result = create_node_runtime_instance(SpawnConfig {
        plugin_id: "test".into(),
        exec_path: PathBuf::from("plugin.bin"),
        allowed_workspace_root: None,
        is_vcs_backend: false,
    });
    match result {
        Err(msg) => assert!(msg.contains("must be a .js/.mjs/.cjs")),
        Ok(_) => panic!("expected error"),
    }
}

#[test]
fn create_runtime_instance_accepts_valid_path() {
    let temp = tempfile::tempdir().expect("tempdir");
    let js_path = temp.path().join("plugin.mjs");
    std::fs::write(&js_path, b"export {}").expect("write");

    let result = create_runtime_instance(SpawnConfig {
        plugin_id: "test".into(),
        exec_path: js_path,
        allowed_workspace_root: None,
        is_vcs_backend: false,
    });
    assert!(result.is_ok());
}

#[test]
fn create_runtime_instance_rejects_invalid_path() {
    let result = create_runtime_instance(SpawnConfig {
        plugin_id: "test".into(),
        exec_path: PathBuf::from("plugin.bin"),
        allowed_workspace_root: None,
        is_vcs_backend: false,
    });
    match result {
        Err(msg) => assert!(msg.contains("must be a .js/.mjs/.cjs")),
        Ok(_) => panic!("expected error"),
    }
}
