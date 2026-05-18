// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

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
