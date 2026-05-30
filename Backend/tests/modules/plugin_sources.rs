// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

use super::{
    archive_entry_path_error, command_error_message, has_non_empty_object_field, npm_executable,
    package_has_runtime_dependencies, resolve_local_plugin_path, sanitize_archive_path,
};
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

// ── has_non_empty_object_field tests ───────────────────────────────────────

#[test]
fn detects_non_empty_object_fields() {
    assert!(has_non_empty_object_field(&serde_json::json!({"deps": {"a": "1"}}), "deps"));
}

#[test]
fn rejects_empty_object_fields() {
    assert!(!has_non_empty_object_field(&serde_json::json!({"deps": {}}), "deps"));
}

#[test]
fn rejects_missing_fields() {
    assert!(!has_non_empty_object_field(&serde_json::json!({"other": {}}), "deps"));
}

#[test]
fn rejects_non_object_field_values() {
    assert!(!has_non_empty_object_field(&serde_json::json!({"deps": "str"}), "deps"));
    assert!(!has_non_empty_object_field(&serde_json::json!({"deps": null}), "deps"));
    assert!(!has_non_empty_object_field(&serde_json::json!({"deps": 42}), "deps"));
}

#[test]
fn returns_false_for_empty_input() {
    assert!(!has_non_empty_object_field(&serde_json::json!({}), "anything"));
}

// ── command_error_message tests ────────────────────────────────────────────

#[test]
fn formats_error_with_stderr_content() {
    let msg = command_error_message("npm pack", b"some error text");
    assert_eq!(msg, "npm pack failed: some error text");
}

#[test]
fn formats_error_without_stderr_when_empty() {
    let msg = command_error_message("npm pack", b"");
    assert_eq!(msg, "npm pack failed");
}

#[test]
fn formats_error_without_stderr_when_whitespace() {
    let msg = command_error_message("npm pack", b"  \n  ");
    assert_eq!(msg, "npm pack failed");
}

#[test]
fn formats_error_with_lossy_utf8() {
    let invalid_utf8 = b"error: \xff\xfe";
    let msg = command_error_message("install", invalid_utf8);
    assert!(msg.contains("install failed"));
}

// ── npm_executable tests ───────────────────────────────────────────────────

#[test]
fn npm_executable_returns_npm_on_linux() {
    if cfg!(windows) {
        assert_eq!(npm_executable(), "npm.cmd");
    } else {
        assert_eq!(npm_executable(), "npm");
    }
}

// ── archive_entry_path_error tests ─────────────────────────────────────────

#[test]
fn formats_archive_entry_path_error() {
    let msg = archive_entry_path_error("traversal", "package/../../foo");
    assert_eq!(msg, "invalid archive entry path (traversal): package/../../foo");
}

#[test]
fn formats_archive_entry_path_error_with_empty_strings() {
    let msg = archive_entry_path_error("", "");
    assert_eq!(msg, "invalid archive entry path (): ");
}
