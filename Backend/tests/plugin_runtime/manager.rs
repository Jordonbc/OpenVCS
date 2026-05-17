// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

use super::*;
use crate::plugin_bundles::{ApprovalState, CurrentPointer, InstalledPluginIndex};
use crate::plugin_bundles::{InstalledPluginVersion, PluginBundleStore};
use std::collections::BTreeMap;
use std::fs;
use tempfile::tempdir;

const MINIMAL_NODE_MODULE: &str = "export {};\n";

struct TestRuntime;

impl PluginRuntimeInstance for TestRuntime {
    fn ensure_running(&self) -> Result<(), String> {
        Ok(())
    }

    fn stop(&self) {}
}

#[test]
/// Verifies repeated start/stop calls keep runtime state stable.
fn start_and_stop_are_idempotent() {
    let temp = tempdir().expect("tempdir");
    write_plugin(temp.path(), "test.plugin", true);
    let manager = PluginRuntimeManager::new(PluginBundleStore::new_at(temp.path().into()));

    manager.start_plugin("test.plugin").expect("start");
    manager.start_plugin("TEST.PLUGIN").expect("start twice");
    assert_eq!(manager.processes.lock().len(), 1);

    manager.stop_plugin("test.plugin").expect("stop");
    manager.stop_plugin("test.plugin").expect("stop twice");
    assert!(manager.processes.lock().is_empty());
}

#[test]
/// Verifies sync starts and stops plugins according to config toggles.
fn sync_tracks_enabled_state() {
    let temp = tempdir().expect("tempdir");
    write_plugin(temp.path(), "alpha.plugin", true);
    write_plugin(temp.path(), "beta.plugin", false);
    let manager = PluginRuntimeManager::new(PluginBundleStore::new_at(temp.path().into()));

    let mut cfg = AppConfig::default();
    cfg.plugins.disabled.clear();
    cfg.plugins.enabled.clear();

    manager
        .sync_plugin_runtime_with_config(&cfg)
        .expect("initial sync");
    assert!(manager.processes.lock().contains_key("alpha.plugin"));
    assert!(!manager.processes.lock().contains_key("beta.plugin"));

    cfg.plugins.disabled = vec!["alpha.plugin".into()];
    cfg.plugins.enabled = vec!["beta.plugin".into()];
    cfg.validate();

    manager
        .sync_plugin_runtime_with_config(&cfg)
        .expect("second sync");
    assert!(!manager.processes.lock().contains_key("alpha.plugin"));
    assert!(manager.processes.lock().contains_key("beta.plugin"));
}

#[test]
/// Verifies runtime start rejects plugins without module components.
fn start_plugin_rejects_plugins_without_module_component() {
    let temp = tempdir().expect("tempdir");
    write_non_runtime_plugin(temp.path(), "themes.plugin", true);
    let manager = PluginRuntimeManager::new(PluginBundleStore::new_at(temp.path().into()));

    let err = manager
        .start_plugin("themes.plugin")
        .expect_err("expected missing module error");
    assert!(err.contains("plugin has no module component"));
}

#[test]
/// Verifies sync ignores non-runtime plugins without module components.
fn sync_ignores_plugins_without_module_component() {
    let temp = tempdir().expect("tempdir");
    write_plugin(temp.path(), "runtime.plugin", true);
    write_non_runtime_plugin(temp.path(), "themes.plugin", true);
    let manager = PluginRuntimeManager::new(PluginBundleStore::new_at(temp.path().into()));

    let cfg = AppConfig::default();
    manager
        .sync_plugin_runtime_with_config(&cfg)
        .expect("sync succeeds");

    let running = manager.processes.lock();
    assert!(running.contains_key("runtime.plugin"));
    assert!(!running.contains_key("themes.plugin"));
}

#[test]
/// Verifies startup sync does not eagerly start VCS backend runtimes.
fn sync_does_not_autostart_vcs_backend_plugins() {
    let temp = tempdir().expect("tempdir");
    write_vcs_plugin(temp.path(), "git.plugin", true);
    let manager = PluginRuntimeManager::new(PluginBundleStore::new_at(temp.path().into()));

    let cfg = AppConfig::default();
    manager
        .sync_plugin_runtime_with_config(&cfg)
        .expect("sync succeeds");

    let running = manager.processes.lock();
    assert!(!running.contains_key("git.plugin"));
}

#[test]
/// Verifies settings sync keeps an already-open VCS backend runtime alive.
fn sync_preserves_running_vcs_backend_plugins() {
    let temp = tempdir().expect("tempdir");
    write_vcs_plugin(temp.path(), "git.plugin", true);
    let manager = PluginRuntimeManager::new(PluginBundleStore::new_at(temp.path().into()));
    manager.processes.lock().insert(
        "git.plugin".into(),
        RunningPlugin {
            runtime: Arc::new(TestRuntime),
            workspace_root: Some(temp.path().join("repo")),
        },
    );

    let cfg = AppConfig::default();
    manager
        .sync_plugin_runtime_with_config(&cfg)
        .expect("sync succeeds");

    assert!(manager.processes.lock().contains_key("git.plugin"));
}

#[test]
/// Verifies VCS spawn resolution includes workspace confinement.
fn vcs_spawn_resolution_sets_workspace_root() {
    let temp = tempdir().expect("tempdir");
    write_vcs_plugin(temp.path(), "git.plugin", true);
    let manager = PluginRuntimeManager::new(PluginBundleStore::new_at(temp.path().into()));

    let cfg = AppConfig::default();
    let workspace_root = temp.path().join("repo");
    std::fs::create_dir_all(&workspace_root).expect("create repo root");

    let spawn = manager
        .vcs_spawn_for_workspace_with_config(&cfg, "git.plugin", workspace_root.clone())
        .expect("resolve vcs spawn");

    assert!(spawn.is_vcs_backend);
    assert_eq!(
        spawn.allowed_workspace_root.as_deref(),
        Some(workspace_root.as_path())
    );
}

#[test]
/// Verifies spawn config marks VCS backend plugins using manifest data.
fn resolve_spec_sets_vcs_backend_flag_from_manifest() {
    let temp = tempdir().expect("tempdir");
    write_plugin(temp.path(), "utility.plugin", true);
    write_vcs_plugin(temp.path(), "git.plugin", true);

    let manager = PluginRuntimeManager::new(PluginBundleStore::new_at(temp.path().into()));

    let utility = manager
        .resolve_module_runtime_spec("utility.plugin", None)
        .expect("resolve utility plugin");
    assert!(!utility.spawn.is_vcs_backend);

    let vcs = manager
        .resolve_module_runtime_spec("git.plugin", None)
        .expect("resolve vcs plugin");
    assert!(vcs.spawn.is_vcs_backend);
}

#[test]
/// Verifies enabling a non-runtime plugin does not depend on other plugins.
fn enabling_non_runtime_plugin_ignores_unrelated_invalid_plugin() {
    let temp = tempdir().expect("tempdir");
    write_non_runtime_plugin(temp.path(), "themes.plugin", false);
    write_invalid_runtime_plugin(temp.path(), "broken.plugin");
    let manager = PluginRuntimeManager::new(PluginBundleStore::new_at(temp.path().into()));

    manager
        .set_plugin_enabled("themes.plugin", true)
        .expect("enable themes plugin");
}

/// Writes a minimal module-capable plugin layout into a temp store.
fn write_plugin(root: &std::path::Path, plugin_id: &str, default_enabled: bool) {
    write_plugin_with_backends(root, plugin_id, default_enabled, false);
}

/// Writes a minimal VCS-backend plugin layout into a temp store.
fn write_vcs_plugin(root: &std::path::Path, plugin_id: &str, default_enabled: bool) {
    write_plugin_with_backends(root, plugin_id, default_enabled, true);
}

/// Writes a minimal module-capable plugin layout with optional VCS backends.
fn write_plugin_with_backends(
    root: &std::path::Path,
    plugin_id: &str,
    default_enabled: bool,
    include_vcs_backends: bool,
) {
    let plugin_dir = root.join(plugin_id);
    fs::create_dir_all(plugin_dir.join("bin")).expect("create plugin dir");
    fs::write(
        plugin_dir.join("bin").join("plugin.mjs"),
        MINIMAL_NODE_MODULE,
    )
    .expect("write node module");

    let vcs_backends = if include_vcs_backends {
        vec![serde_json::json!({ "id": "git", "name": "Git" })]
    } else {
        Vec::new()
    };

    let manifest = serde_json::json!({
        "id": plugin_id,
        "name": "Test Plugin",
        "version": "1.0.0",
        "default_enabled": default_enabled,
        "module": {
            "exec": "plugin.mjs",
            "vcs_backends": vcs_backends
        }
    });
    fs::write(
        plugin_dir.join("package.json"),
        serde_json::to_vec_pretty(&serde_json::json!({
            "name": plugin_id,
            "version": "1.0.0",
            "openvcs": manifest,
        }))
        .expect("serialize manifest"),
    )
    .expect("write manifest");

    let mut versions = BTreeMap::new();
    versions.insert(
        "1.0.0".to_string(),
        InstalledPluginVersion {
            version: "1.0.0".to_string(),
            bundle_sha256: "sha".to_string(),
            installed_at_unix_ms: 0,
            requested_capabilities: Vec::new(),
            approval: ApprovalState::Approved {
                capabilities: Vec::new(),
                approved_at_unix_ms: 0,
            },
        },
    );
    let index = InstalledPluginIndex {
        plugin_id: plugin_id.to_string(),
        current: Some("1.0.0".to_string()),
        versions,
    };
    fs::write(
        plugin_dir.join("index.json"),
        serde_json::to_vec_pretty(&index).expect("serialize index"),
    )
    .expect("write index");

    let current = CurrentPointer {
        version: "1.0.0".to_string(),
    };
    fs::write(
        plugin_dir.join("current.json"),
        serde_json::to_vec_pretty(&current).expect("serialize current"),
    )
    .expect("write current");
}

/// Writes a plugin layout with manifest/index but no runtime module.
fn write_non_runtime_plugin(root: &std::path::Path, plugin_id: &str, default_enabled: bool) {
    let plugin_dir = root.join(plugin_id);
    fs::create_dir_all(&plugin_dir).expect("create plugin dir");

    let manifest = serde_json::json!({
        "id": plugin_id,
        "name": "Theme Plugin",
        "version": "1.0.0",
        "default_enabled": default_enabled
    });
    fs::write(
        plugin_dir.join("package.json"),
        serde_json::to_vec_pretty(&serde_json::json!({
            "name": plugin_id,
            "version": "1.0.0",
            "openvcs": manifest,
        }))
        .expect("serialize manifest"),
    )
    .expect("write manifest");

    let mut versions = BTreeMap::new();
    versions.insert(
        "1.0.0".to_string(),
        InstalledPluginVersion {
            version: "1.0.0".to_string(),
            bundle_sha256: "sha".to_string(),
            installed_at_unix_ms: 0,
            requested_capabilities: Vec::new(),
            approval: ApprovalState::Approved {
                capabilities: Vec::new(),
                approved_at_unix_ms: 0,
            },
        },
    );
    let index = InstalledPluginIndex {
        plugin_id: plugin_id.to_string(),
        current: Some("1.0.0".to_string()),
        versions,
    };
    fs::write(
        plugin_dir.join("index.json"),
        serde_json::to_vec_pretty(&index).expect("serialize index"),
    )
    .expect("write index");

    let current = CurrentPointer {
        version: "1.0.0".to_string(),
    };
    fs::write(
        plugin_dir.join("current.json"),
        serde_json::to_vec_pretty(&current).expect("serialize current"),
    )
    .expect("write current");
}

/// Writes a plugin with an invalid runtime module entrypoint extension.
fn write_invalid_runtime_plugin(root: &std::path::Path, plugin_id: &str) {
    let plugin_dir = root.join(plugin_id);
    fs::create_dir_all(&plugin_dir).expect("create plugin dir");

    let manifest = serde_json::json!({
        "id": plugin_id,
        "name": "Broken Plugin",
        "version": "1.0.0",
        "default_enabled": false,
        "module": {
            "exec": "broken.wasm",
            "vcs_backends": []
        }
    });
    fs::write(
        plugin_dir.join("package.json"),
        serde_json::to_vec_pretty(&serde_json::json!({
            "name": plugin_id,
            "version": "1.0.0",
            "openvcs": manifest,
        }))
        .expect("serialize manifest"),
    )
    .expect("write manifest");

    let mut versions = BTreeMap::new();
    versions.insert(
        "1.0.0".to_string(),
        InstalledPluginVersion {
            version: "1.0.0".to_string(),
            bundle_sha256: "sha".to_string(),
            installed_at_unix_ms: 0,
            requested_capabilities: Vec::new(),
            approval: ApprovalState::Approved {
                capabilities: Vec::new(),
                approved_at_unix_ms: 0,
            },
        },
    );
    let index = InstalledPluginIndex {
        plugin_id: plugin_id.to_string(),
        current: Some("1.0.0".to_string()),
        versions,
    };
    fs::write(
        plugin_dir.join("index.json"),
        serde_json::to_vec_pretty(&index).expect("serialize index"),
    )
    .expect("write index");

    let current = CurrentPointer {
        version: "1.0.0".to_string(),
    };
    fs::write(
        plugin_dir.join("current.json"),
        serde_json::to_vec_pretty(&current).expect("serialize current"),
    )
    .expect("write current");
}
