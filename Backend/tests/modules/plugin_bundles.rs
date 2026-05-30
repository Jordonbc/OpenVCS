// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

use super::*;
use std::fs;
use std::path::Path;
use tempfile::tempdir;

/// Writes a minimal prepared plugin directory for tests.
fn write_plugin(root: &Path, plugin_id: &str) {
    fs::create_dir_all(root.join("bin")).unwrap();
    fs::write(
        root.join("package.json"),
        format!(
            "{{\n  \"name\": \"{plugin_id}\",\n  \"version\": \"0.1.0\",\n  \"openvcs\": {{\n    \"id\": \"{plugin_id}\",\n    \"name\": \"Test\",\n    \"module\": {{ \"exec\": \"plugin.js\" }}\n  }}\n}}\n"
        ),
    )
    .unwrap();
    fs::write(root.join("bin").join("plugin.js"), "export {};\n").unwrap();
}

/// Writes a prepared plugin directory with backend action labels.
fn write_plugin_with_labels(root: &Path, plugin_id: &str) {
    fs::create_dir_all(root.join("bin")).unwrap();
    fs::write(
        root.join("package.json"),
        format!(
            "{{\n  \"name\": \"{plugin_id}\",\n  \"version\": \"0.1.0\",\n  \"openvcs\": {{\n    \"id\": \"{plugin_id}\",\n    \"name\": \"Test\",\n    \"module\": {{\n      \"exec\": \"plugin.js\",\n      \"vcs_backends\": [{{\n        \"id\": \"git\",\n        \"name\": \"Git\",\n        \"action_labels\": {{\n          \"VCS.Commit\": \"Commit\",\n          \"VCS.Push\": \"Push\"\n        }}\n      }}]\n    }}\n  }}\n}}\n"
        ),
    )
    .unwrap();
    fs::write(root.join("bin").join("plugin.js"), "export {};\n").unwrap();
}

#[test]
fn install_prepared_plugin_dir_writes_index_and_source() {
    let dir = tempdir().unwrap();
    let store = PluginBundleStore::new_at(dir.path().join("plugins"));
    let prepared = dir.path().join("prepared");
    write_plugin(&prepared, "example.plugin");

    let installed = store
        .install_prepared_plugin_dir(
            &prepared,
            &InstalledPluginSourceMetadata {
                managed_by: "user-config".to_string(),
                kind: "path".to_string(),
                spec: "../example".to_string(),
            },
            true,
        )
        .unwrap();

    assert_eq!(installed.plugin_id, "example.plugin");
    assert!(store.get_current_dir("example.plugin").unwrap().is_some());
    assert!(
        read_plugin_source_metadata(&store.root.join("example.plugin"))
            .is_some_and(|metadata| metadata.kind == "path")
    );
}

#[test]
fn load_current_components_reads_backend_action_labels() {
    let dir = tempdir().unwrap();
    let store = PluginBundleStore::new_at(dir.path().join("plugins"));
    let prepared = dir.path().join("prepared");
    write_plugin_with_labels(&prepared, "example.plugin");

    store
        .install_prepared_plugin_dir(
            &prepared,
            &InstalledPluginSourceMetadata {
                managed_by: "user-config".to_string(),
                kind: "path".to_string(),
                spec: "../example".to_string(),
            },
            true,
        )
        .unwrap();

    let components = store.load_current_components("example.plugin").unwrap();
    let module = components.and_then(|c| c.module).expect("module component");
    let backend = module
        .vcs_backends
        .into_iter()
        .find(|backend| backend.id == "git")
        .expect("git backend");
    assert_eq!(backend.name.as_deref(), Some("Git"));
    assert_eq!(
        backend.action_labels.get("VCS.Commit").map(String::as_str),
        Some("Commit")
    );
    assert_eq!(
        backend.action_labels.get("VCS.Push").map(String::as_str),
        Some("Push")
    );
}

#[test]
fn normalizes_plugin_ids_and_capabilities() {
    assert_eq!(normalize_plugin_id("  My.Plugin  ").unwrap(), "my.plugin");
    assert!(normalize_plugin_id("   ").is_err());

    let caps = normalize_capabilities(vec![" One ".into(), "one".into(), "Two".into(), "".into()]);
    assert_eq!(caps, vec!["One".to_string(), "Two".to_string(), "one".to_string()]);
}

#[test]
fn serializes_approval_state_variants() {
    let pending = serde_json::to_value(ApprovalState::Pending).expect("pending");
    assert_eq!(pending, serde_json::json!("pending"));

    let approved = ApprovalState::Approved {
        capabilities: vec!["vcs.status".into()],
        approved_at_unix_ms: 123,
    };
    let approved_json = serde_json::to_value(&approved).expect("approved");
    assert_eq!(approved_json["approved"]["approved_at_unix_ms"], 123);
    assert_eq!(approved_json["approved"]["capabilities"][0], "vcs.status");
}

#[test]
fn derives_install_versions_and_normalizes_exec_values() {
    let manifest = PluginManifest {
        id: "demo".into(),
        name: Some("Demo".into()),
        version: Some(" 1.2.3 ".into()),
        default_enabled: false,
        capabilities: vec![],
        module: None,
        functions: None,
    };
    assert_eq!(derive_install_version(&manifest, "abcdef0123456789"), "1.2.3");

    let versionless = PluginManifest {
        version: Some("  ".into()),
        ..manifest
    };
    assert_eq!(derive_install_version(&versionless, "abcdef0123456789"), "sha256-abcdef012345");
    assert_eq!(normalize_exec(Some(" plugin.mjs ".into())).as_deref(), Some("plugin.mjs"));
    assert_eq!(normalize_exec(Some("   ".into())), None);
    assert_eq!(platform_exec_name("plugin.mjs"), "plugin.mjs");
}

#[test]
fn validates_entrypoints_and_metadata() {
    let dir = tempdir().unwrap();
    let version_dir = dir.path();
    fs::create_dir_all(version_dir.join("bin")).unwrap();
    fs::write(version_dir.join("bin").join("plugin.mjs"), "export {};").unwrap();

    assert!(validate_entrypoint(version_dir, Some("plugin.mjs"), "module").is_ok());
    assert!(validate_entrypoint(version_dir, Some("plugin.txt"), "module").is_err());
    assert!(validate_entrypoint(version_dir, None, "module").is_ok());

    let meta = InstalledPluginSourceMetadata {
        managed_by: "user-config".into(),
        kind: "path".into(),
        spec: "./demo".into(),
    };
    write_plugin_source_metadata(version_dir, &meta).unwrap();
    assert_eq!(read_plugin_source_metadata(version_dir), Some(meta));
}
