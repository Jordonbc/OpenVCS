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

// ── install_prepared_plugin_dir: unsupported functions field ──

#[test]
fn install_rejects_functions_field() {
    let dir = tempdir().unwrap();
    let store = PluginBundleStore::new_at(dir.path().join("plugins"));
    let prepared = dir.path().join("prepared");
    fs::create_dir_all(prepared.join("bin")).unwrap();
    fs::write(
        prepared.join("package.json"),
        r#"{"name":"x","openvcs":{"id":"x.plugin","functions":{},"module":{"exec":"x.js"}}}"#,
    )
    .unwrap();
    fs::write(prepared.join("bin").join("x.js"), "export {};").unwrap();

    let err = store
        .install_prepared_plugin_dir(
            &prepared,
            &InstalledPluginSourceMetadata {
                managed_by: "test".into(),
                kind: "path".into(),
                spec: ".".into(),
            },
            true,
        )
        .expect_err("expected functions rejection");
    assert!(err.contains("functions"), "error: {err}");
}

#[test]
fn install_rejects_empty_id() {
    let dir = tempdir().unwrap();
    let store = PluginBundleStore::new_at(dir.path().join("plugins"));
    let prepared = dir.path().join("prepared");
    fs::create_dir_all(prepared.join("bin")).unwrap();
    fs::write(
        prepared.join("package.json"),
        r#"{"name":"x","openvcs":{"id":"  ","module":{"exec":"x.js"}}}"#,
    )
    .unwrap();
    fs::write(prepared.join("bin").join("x.js"), "export {};").unwrap();

    let err = store
        .install_prepared_plugin_dir(
            &prepared,
            &InstalledPluginSourceMetadata {
                managed_by: "test".into(),
                kind: "path".into(),
                spec: ".".into(),
            },
            true,
        )
        .expect_err("expected empty id rejection");
    assert!(err.contains("id is empty"), "error: {err}");
}

#[test]
fn install_returns_existing_when_already_up_to_date() {
    let dir = tempdir().unwrap();
    let store = PluginBundleStore::new_at(dir.path().join("plugins"));
    let prepared = dir.path().join("prepared");
    write_plugin(&prepared, "dup.plugin");

    // First install
    let first = store
        .install_prepared_plugin_dir(
            &prepared,
            &InstalledPluginSourceMetadata {
                managed_by: "test".into(),
                kind: "path".into(),
                spec: "dup".into(),
            },
            true,
        )
        .expect("first install");

    // Second install with same dir (same bundle_sha256 + version)
    let second = store
        .install_prepared_plugin_dir(
            &prepared,
            &InstalledPluginSourceMetadata {
                managed_by: "test".into(),
                kind: "path".into(),
                spec: "dup".into(),
            },
            true,
        )
        .expect("second install");

    assert_eq!(first.plugin_id, second.plugin_id);
    assert_eq!(first.version, second.version);
    assert_eq!(first.bundle_sha256, second.bundle_sha256);
}

#[test]
fn install_without_auto_approve_creates_pending() {
    let dir = tempdir().unwrap();
    let store = PluginBundleStore::new_at(dir.path().join("plugins"));
    let prepared = dir.path().join("prepared");
    write_plugin(&prepared, "pending.plugin");

    let installed = store
        .install_prepared_plugin_dir(
            &prepared,
            &InstalledPluginSourceMetadata {
                managed_by: "test".into(),
                kind: "path".into(),
                spec: "pending".into(),
            },
            false,
        )
        .expect("install without auto-approve");

    assert_eq!(installed.plugin_id, "pending.plugin");
    assert!(matches!(installed.approval, ApprovalState::Pending));
}

// ── uninstall_plugin ──

#[test]
fn uninstall_rejects_empty_id() {
    let dir = tempdir().unwrap();
    let store = PluginBundleStore::new_at(dir.path().join("plugins"));
    let err = store.uninstall_plugin("").expect_err("expected error");
    assert_eq!(err, "plugin id is empty");
}

#[test]
fn uninstall_noop_for_nonexistent_plugin() {
    let dir = tempdir().unwrap();
    let store = PluginBundleStore::new_at(dir.path().join("plugins"));
    store
        .uninstall_plugin("nonexistent.plugin")
        .expect("uninstall missing should be ok");
}

#[test]
fn uninstall_removes_installed_plugin_directory() {
    let dir = tempdir().unwrap();
    let store = PluginBundleStore::new_at(dir.path().join("plugins"));
    let prepared = dir.path().join("prepared");
    write_plugin(&prepared, "remove.me");

    store
        .install_prepared_plugin_dir(
            &prepared,
            &InstalledPluginSourceMetadata {
                managed_by: "test".into(),
                kind: "path".into(),
                spec: "remove.me".into(),
            },
            true,
        )
        .expect("install");

    let plugin_dir = store.root.join("remove.me");
    assert!(plugin_dir.is_dir());

    store
        .uninstall_plugin("remove.me")
        .expect("uninstall succeeded");
    assert!(!plugin_dir.exists());
}

// ── get_current_dir ──

#[test]
fn get_current_dir_rejects_empty_id() {
    let dir = tempdir().unwrap();
    let store = PluginBundleStore::new_at(dir.path().join("plugins"));
    let err = store.get_current_dir("").expect_err("expected error");
    assert_eq!(err, "plugin id is empty");
}

#[test]
fn get_current_dir_returns_none_when_no_current_json() {
    let dir = tempdir().unwrap();
    let store = PluginBundleStore::new_at(dir.path().join("plugins"));
    let result = store.get_current_dir("missing").expect("get_current_dir");
    assert!(result.is_none());
}

#[test]
fn get_current_dir_returns_version_dir_when_present() {
    let dir = tempdir().unwrap();
    let store = PluginBundleStore::new_at(dir.path().join("plugins"));
    let prepared = dir.path().join("prepared");
    write_plugin(&prepared, "dir.test");
    store
        .install_prepared_plugin_dir(
            &prepared,
            &InstalledPluginSourceMetadata {
                managed_by: "test".into(),
                kind: "path".into(),
                spec: "dir.test".into(),
            },
            true,
        )
        .expect("install");

    let found = store
        .get_current_dir("dir.test")
        .expect("get_current_dir")
        .expect("should have a current dir");
    assert!(found.is_dir());
    assert!(found.join("bin").join("plugin.js").is_file());
}

// ── list_installed ──

#[test]
fn list_installed_returns_empty_when_root_missing() {
    let dir = tempdir().unwrap();
    let store = PluginBundleStore::new_at(dir.path().join("nonexistent"));
    let list = store.list_installed().expect("list_installed");
    assert!(list.is_empty());
}

#[test]
fn list_installed_returns_sorted_indexes() {
    let dir = tempdir().unwrap();
    let store = PluginBundleStore::new_at(dir.path().join("plugins"));
    let prepared_a = dir.path().join("prepared_a");
    let prepared_b = dir.path().join("prepared_b");
    write_plugin(&prepared_a, "z.plugin");
    write_plugin(&prepared_b, "a.plugin");

    store
        .install_prepared_plugin_dir(
            &prepared_b,
            &InstalledPluginSourceMetadata {
                managed_by: "test".into(),
                kind: "path".into(),
                spec: "b".into(),
            },
            true,
        )
        .expect("install a.plugin");
    store
        .install_prepared_plugin_dir(
            &prepared_a,
            &InstalledPluginSourceMetadata {
                managed_by: "test".into(),
                kind: "path".into(),
                spec: "a".into(),
            },
            true,
        )
        .expect("install z.plugin");

    let list = store.list_installed().expect("list_installed");
    assert_eq!(list.len(), 2);
    // Sorted alphabetically
    assert_eq!(list[0].plugin_id, "a.plugin");
    assert_eq!(list[1].plugin_id, "z.plugin");
}

// ── approve_capabilities ──

#[test]
fn approve_capabilities_errors_when_plugin_not_installed() {
    let dir = tempdir().unwrap();
    let store = PluginBundleStore::new_at(dir.path().join("plugins"));
    let err = store
        .approve_capabilities("missing.plugin", "1.0.0", true)
        .expect_err("expected error");
    assert_eq!(err, "plugin is not installed");
}

#[test]
fn approve_capabilities_errors_when_version_not_found() {
    let dir = tempdir().unwrap();
    let store = PluginBundleStore::new_at(dir.path().join("plugins"));
    let prepared = dir.path().join("prepared");
    write_plugin(&prepared, "ver.test");
    store
        .install_prepared_plugin_dir(
            &prepared,
            &InstalledPluginSourceMetadata {
                managed_by: "test".into(),
                kind: "path".into(),
                spec: "ver".into(),
            },
            true,
        )
        .expect("install");

    let err = store
        .approve_capabilities("ver.test", "99.99.99", true)
        .expect_err("expected error");
    assert_eq!(err, "version is not installed");
}

#[test]
fn approve_capabilities_approves_and_denies() {
    let dir = tempdir().unwrap();
    let store = PluginBundleStore::new_at(dir.path().join("plugins"));
    let prepared = dir.path().join("prepared");
    write_plugin(&prepared, "cap.test");
    store
        .install_prepared_plugin_dir(
            &prepared,
            &InstalledPluginSourceMetadata {
                managed_by: "test".into(),
                kind: "path".into(),
                spec: "cap".into(),
            },
            false,
        )
        .expect("install");

    // Initially Pending
    let initial = store
        .get_current_installed("cap.test")
        .expect("get_current_installed")
        .expect("should be installed");
    assert!(matches!(initial.approval, ApprovalState::Pending));

    // Approve
    store
        .approve_capabilities("cap.test", &initial.version, true)
        .expect("approve");
    let approved = store
        .get_current_installed("cap.test")
        .expect("get_current_installed")
        .expect("should be installed");
    assert!(
        matches!(&approved.approval, ApprovalState::Approved { .. }),
        "expected Approved, got {:?}",
        approved.approval
    );

    // Deny
    store
        .approve_capabilities("cap.test", &approved.version, false)
        .expect("deny");
    let denied = store
        .get_current_installed("cap.test")
        .expect("get_current_installed")
        .expect("should be installed");
    assert!(
        matches!(&denied.approval, ApprovalState::Denied { .. }),
        "expected Denied, got {:?}",
        denied.approval
    );
}

// ── prune_managed_plugins ──

#[test]
fn prune_managed_plugins_removes_unwanted() {
    let dir = tempdir().unwrap();
    let store = PluginBundleStore::new_at(dir.path().join("plugins"));
    let prepared = dir.path().join("prepared");
    write_plugin(&prepared, "prune.test");
    store
        .install_prepared_plugin_dir(
            &prepared,
            &InstalledPluginSourceMetadata {
                managed_by: "manager-a".into(),
                kind: "path".into(),
                spec: "prune".into(),
            },
            true,
        )
        .expect("install");

    assert!(store.root.join("prune.test").is_dir());

    let empty_set = std::collections::HashSet::new();
    store
        .prune_managed_plugins("manager-a", &empty_set)
        .expect("prune");
    assert!(!store.root.join("prune.test").exists());
}

#[test]
fn prune_managed_plugins_keeps_wanted() {
    let dir = tempdir().unwrap();
    let store = PluginBundleStore::new_at(dir.path().join("plugins"));
    let prepared = dir.path().join("prepared");
    write_plugin(&prepared, "keep.test");
    store
        .install_prepared_plugin_dir(
            &prepared,
            &InstalledPluginSourceMetadata {
                managed_by: "manager-b".into(),
                kind: "path".into(),
                spec: "keep".into(),
            },
            true,
        )
        .expect("install");

    let mut keep = std::collections::HashSet::new();
    keep.insert("keep.test".to_string());
    store
        .prune_managed_plugins("manager-b", &keep)
        .expect("prune");
    assert!(store.root.join("keep.test").is_dir());
}

#[test]
fn prune_managed_plugins_skips_other_managers() {
    let dir = tempdir().unwrap();
    let store = PluginBundleStore::new_at(dir.path().join("plugins"));
    let prepared = dir.path().join("prepared");
    write_plugin(&prepared, "other.manager");
    store
        .install_prepared_plugin_dir(
            &prepared,
            &InstalledPluginSourceMetadata {
                managed_by: "manager-x".into(),
                kind: "path".into(),
                spec: "other".into(),
            },
            true,
        )
        .expect("install");

    let empty_set = std::collections::HashSet::new();
    // prune with different manager — should not remove
    store
        .prune_managed_plugins("manager-y", &empty_set)
        .expect("prune");
    assert!(store.root.join("other.manager").is_dir());
}

#[test]
fn prune_managed_plugins_noop_when_root_missing() {
    let dir = tempdir().unwrap();
    let store = PluginBundleStore::new_at(dir.path().join("nonexistent"));
    let empty_set = std::collections::HashSet::new();
    store
        .prune_managed_plugins("any", &empty_set)
        .expect("prune on missing root should be ok");
}

// ── load_current_components edge cases ──

#[test]
fn load_current_components_returns_none_when_not_installed() {
    let dir = tempdir().unwrap();
    let store = PluginBundleStore::new_at(dir.path().join("plugins"));
    let result = store
        .load_current_components("missing.test")
        .expect("load_current_components");
    assert!(result.is_none());
}

#[test]
fn load_current_components_rejects_functions_field() {
    let dir = tempdir().unwrap();
    let store = PluginBundleStore::new_at(dir.path().join("plugins"));
    let plugin_dir = store.root.join("func.reject");
    let version_dir = plugin_dir.join("1.0.0");
    fs::create_dir_all(version_dir.join("bin")).unwrap();
    fs::write(
        version_dir.join("package.json"),
        r#"{"name":"x","openvcs":{"id":"func.reject","functions":{},"module":{"exec":"nope.js"}}}"#,
    )
    .unwrap();
    fs::write(version_dir.join("bin").join("nope.js"), "export {};").unwrap();
    let cur = CurrentPointer {
        version: "1.0.0".into(),
    };
    let index = InstalledPluginIndex {
        plugin_id: "func.reject".into(),
        current: Some("1.0.0".into()),
        versions: std::collections::BTreeMap::new(),
    };
    fs::create_dir_all(plugin_dir).unwrap();
    // Write index.json and current.json manually
    fs::write(
        store.root.join("func.reject").join("index.json"),
        serde_json::to_string_pretty(&index).unwrap(),
    )
    .unwrap();
    fs::write(
        store.root.join("func.reject").join("current.json"),
        serde_json::to_string_pretty(&cur).unwrap(),
    )
    .unwrap();

    let err = store
        .load_current_components("func.reject")
        .expect_err("expected functions error");
    assert!(err.contains("functions"), "error: {err}");
}

// ── list_current_components ──

#[test]
fn list_current_components_returns_empty_when_root_missing() {
    let dir = tempdir().unwrap();
    let store = PluginBundleStore::new_at(dir.path().join("nonexistent"));
    let list = store
        .list_current_components()
        .expect("list_current_components");
    assert!(list.is_empty());
}

// ── get_current_installed edge cases ──

#[test]
fn get_current_installed_returns_none_when_no_index() {
    let dir = tempdir().unwrap();
    let store = PluginBundleStore::new_at(dir.path().join("plugins"));
    let result = store
        .get_current_installed("no.such.plugin")
        .expect("get_current_installed");
    assert!(result.is_none());
}

#[test]
fn get_current_installed_returns_none_when_no_current_version() {
    let dir = tempdir().unwrap();
    let store = PluginBundleStore::new_at(dir.path().join("plugins"));
    let plugin_dir = store.root.join("no.current");
    fs::create_dir_all(plugin_dir).unwrap();
    let index = InstalledPluginIndex {
        plugin_id: "no.current".into(),
        current: None,
        versions: std::collections::BTreeMap::new(),
    };
    fs::write(
        store.root.join("no.current").join("index.json"),
        serde_json::to_string_pretty(&index).unwrap(),
    )
    .unwrap();

    let result = store
        .get_current_installed("no.current")
        .expect("get_current_installed");
    assert!(result.is_none());
}

// ── get_current_dir fallback paths ──

#[test]
fn get_current_dir_returns_none_when_version_dir_missing() {
    let dir = tempdir().unwrap();
    let store = PluginBundleStore::new_at(dir.path().join("plugins"));
    let plugin_dir = store.root.join("missing.version");
    fs::create_dir_all(plugin_dir).unwrap();
    // Write current.json pointing to nonexistent version dir
    let cur = CurrentPointer {
        version: "9.9.9".into(),
    };
    fs::write(
        store.root.join("missing.version").join("current.json"),
        serde_json::to_string_pretty(&cur).unwrap(),
    )
    .unwrap();

    // No package.json in root either, so returns None
    let result = store
        .get_current_dir("missing.version")
        .expect("get_current_dir");
    assert!(result.is_none());
}

// ── sync_built_in_plugins is exercised indirectly through install paths ──

// ── install reuses manifest reader ──
