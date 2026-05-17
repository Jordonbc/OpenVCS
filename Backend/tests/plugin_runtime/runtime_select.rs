// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

use super::is_node_module;
use std::fs;
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
