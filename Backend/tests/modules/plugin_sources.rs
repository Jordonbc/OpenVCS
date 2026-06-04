// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

use super::{
    archive_entry_path_error, command_error_message, ensure_npm_available,
    extract_plugin_archive, has_non_empty_object_field, install_plugin_runtime_dependencies,
    npm_executable, npm_version, package_has_runtime_dependencies, pack_plugin_source,
    resolve_local_plugin_path, sanitize_archive_path, sync_plugin_source, PluginBundleStore,
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

// ── resolve_local_plugin_path edge cases ────────────────────────────────────

#[test]
fn resolves_tilde_plugin_path() {
    let base = tempfile::tempdir().expect("create base dir");
    if let Some(home) = dirs::home_dir() {
        let test_dir = home.join("__openvcs_test_tilde__");
        let _ = fs::create_dir_all(&test_dir);
        let result = resolve_local_plugin_path("~/__openvcs_test_tilde__", base.path());
        assert_eq!(result, Some(test_dir.clone()));
        let _ = fs::remove_dir(&test_dir);
    }
}

#[test]
fn rejects_nonexistent_absolute_path() {
    let base = tempfile::tempdir().expect("create base dir");
    let result = resolve_local_plugin_path("/__openvcs_nonexistent_path_42__", base.path());
    assert!(result.is_none());
}

#[test]
fn resolves_relative_path_with_base_dir() {
    let base = tempfile::tempdir().expect("create base dir");
    let plugin_dir = base.path().join("subdir").join("myplugin");
    fs::create_dir_all(&plugin_dir).expect("create plugin dir");
    let result = resolve_local_plugin_path("subdir/myplugin", base.path());
    assert_eq!(result, Some(plugin_dir));
}

// ── sanitize_archive_path edge cases ────────────────────────────────────────

#[test]
fn accepts_unicode_archive_entry_path() {
    assert_eq!(
        sanitize_archive_path("package/über-cool.mjs").expect("unicode path"),
        std::path::PathBuf::from("package/über-cool.mjs")
    );
}

#[test]
fn accepts_deeply_nested_archive_path() {
    assert_eq!(
        sanitize_archive_path("package/a/b/c/d/e/f/g.mjs").expect("deep path"),
        std::path::PathBuf::from("package/a/b/c/d/e/f/g.mjs")
    );
}

#[test]
fn accepts_top_level_package_dir() {
    assert_eq!(
        sanitize_archive_path("package/").expect("top-level package dir"),
        std::path::PathBuf::from("package/")
    );
}

// ── package_has_runtime_dependencies edge cases ─────────────────────────────

#[test]
fn errors_on_missing_package_json_for_deps() {
    let dir = tempfile::tempdir().expect("create temp dir");
    let missing = dir.path().join("package.json");
    let result = package_has_runtime_dependencies(&missing);
    assert!(result.is_err());
    assert!(
        result.as_ref().unwrap_err().contains("read"),
        "error should mention read failure: {:?}",
        result
    );
}

#[test]
fn errors_on_invalid_json_in_package_json() {
    let dir = tempfile::tempdir().expect("create temp dir");
    let pj = dir.path().join("package.json");
    fs::write(&pj, "{ invalid json }").expect("write invalid json");
    let result = package_has_runtime_dependencies(&pj);
    assert!(result.is_err());
    assert!(
        result.as_ref().unwrap_err().contains("parse"),
        "error should mention parse failure: {:?}",
        result
    );
}

#[test]
fn returns_false_for_null_dependencies() {
    let dir = tempfile::tempdir().expect("create temp dir");
    let pj = dir.path().join("package.json");
    fs::write(&pj, r#"{"dependencies":null}"#).expect("write");
    assert!(!package_has_runtime_dependencies(&pj).expect("read manifest"));
}

#[test]
fn returns_false_for_empty_string_dependencies() {
    let dir = tempfile::tempdir().expect("create temp dir");
    let pj = dir.path().join("package.json");
    fs::write(&pj, r#"{"dependencies":""}"#).expect("write");
    assert!(!package_has_runtime_dependencies(&pj).expect("read manifest"));
}

#[test]
fn returns_false_for_number_dependencies() {
    let dir = tempfile::tempdir().expect("create temp dir");
    let pj = dir.path().join("package.json");
    fs::write(&pj, r#"{"dependencies":42}"#).expect("write");
    assert!(!package_has_runtime_dependencies(&pj).expect("read manifest"));
}

#[test]
fn returns_false_for_empty_package_json() {
    let dir = tempfile::tempdir().expect("create temp dir");
    let pj = dir.path().join("package.json");
    fs::write(&pj, "{}").expect("write");
    assert!(!package_has_runtime_dependencies(&pj).expect("read manifest"));
}

// ── npm_version tests ───────────────────────────────────────────────────────

#[test]
fn npm_version_returns_valid_semver() {
    let version = npm_version().expect("npm --version should succeed");
    assert!(!version.is_empty(), "npm version should not be empty");
    assert!(
        version.starts_with(|c: char| c.is_ascii_digit()),
        "npm version should start with digit: {version}"
    );
}

// ── ensure_npm_available tests ──────────────────────────────────────────────

#[test]
fn ensure_npm_available_returns_version_string() {
    let version = ensure_npm_available().expect("npm should be available");
    assert!(!version.is_empty(), "npm version should not be empty");
}

// ── pack_plugin_source tests ────────────────────────────────────────────────

#[test]
fn packs_minimal_plugin_source_to_tarball() {
    let dir = tempfile::tempdir().expect("create temp dir");
    let plugin_dir = dir.path().join("test-plugin");
    fs::create_dir_all(&plugin_dir).expect("create plugin dir");
    fs::write(
        plugin_dir.join("package.json"),
        r#"{"name":"test-plugin","version":"1.0.0"}"#,
    )
    .expect("write package.json");

    let workdir = dir.path().join("work");
    fs::create_dir_all(&workdir).expect("create work dir");

    let tarball = pack_plugin_source(&plugin_dir, &workdir).expect("npm pack should succeed");
    assert!(tarball.exists(), "tarball file should exist");
    assert!(
        tarball.extension().is_some_and(|ext| ext == "tgz"),
        "tarball should have .tgz extension: {:?}",
        tarball
    );
}

// ── extract_plugin_archive tests ────────────────────────────────────────────

#[test]
fn extracts_packed_plugin_archive_to_out_dir() {
    let dir = tempfile::tempdir().expect("create temp dir");
    let plugin_dir = dir.path().join("test-plugin");
    fs::create_dir_all(&plugin_dir).expect("create plugin dir");
    fs::write(
        plugin_dir.join("package.json"),
        r#"{
            "name": "test-plugin",
            "version": "1.0.0",
            "files": ["*"]
        }"#,
    )
    .expect("write package.json");
    fs::write(plugin_dir.join("plugin.js"), "export {};").expect("write plugin.js");

    let workdir = dir.path().join("work");
    fs::create_dir_all(&workdir).expect("create work dir");
    let tarball = pack_plugin_source(&plugin_dir, &workdir).expect("npm pack should succeed");

    let out_dir = dir.path().join("extracted");
    fs::create_dir_all(&out_dir).expect("create out dir");
    extract_plugin_archive(&tarball, &out_dir).expect("extract should succeed");

    assert!(
        out_dir.join("package.json").exists(),
        "package.json should be extracted"
    );
    assert!(
        out_dir.join("plugin.js").exists(),
        "plugin.js should be extracted"
    );
}

// ── install_plugin_runtime_dependencies tests ───────────────────────────────

#[test]
fn skips_runtime_install_when_no_package_json() {
    let dir = tempfile::tempdir().expect("create temp dir");
    let result = install_plugin_runtime_dependencies(dir.path());
    assert!(result.is_ok(), "should succeed when no package.json");
}

#[test]
fn skips_runtime_install_when_no_runtime_deps() {
    let dir = tempfile::tempdir().expect("create temp dir");
    fs::write(
        dir.path().join("package.json"),
        r#"{"name":"dep-free-plugin","version":"1.0.0"}"#,
    )
    .expect("write package.json");
    let result = install_plugin_runtime_dependencies(dir.path());
    assert!(result.is_ok(), "should succeed when no deps declared");
}

// ── sync_plugin_source integration tests ────────────────────────────────────

#[test]
fn syncs_local_plugin_source() {
    let root = tempfile::tempdir().expect("create root dir");
    let store = PluginBundleStore::new_at(root.path().join("plugins"));

    let plugin_src = root.path().join("my-editor-plugin");
    fs::create_dir_all(&plugin_src).expect("create plugin dir");
    fs::create_dir_all(plugin_src.join("bin")).expect("create bin dir");
    fs::write(
        plugin_src.join("package.json"),
        r#"{
            "name": "my-editor-plugin",
            "version": "0.1.0",
            "files": ["*"],
            "openvcs": {
                "id": "my.editor.plugin",
                "name": "My Editor Plugin",
                "module": { "exec": "plugin.js" }
            }
        }"#,
    )
    .expect("write package.json");
    fs::write(plugin_src.join("bin").join("plugin.js"), "export {};").expect("write plugin.js");

    let installed = sync_plugin_source(
        &store,
        plugin_src.to_str().expect("utf8 path"),
        root.path(),
    )
    .expect("sync should succeed");

    assert_eq!(installed.plugin_id, "my.editor.plugin");
    let current_dir = store
        .get_current_dir("my.editor.plugin")
        .expect("get current dir query")
        .expect("plugin should be installed");
    assert!(current_dir.exists(), "installed plugin dir should exist");
}
