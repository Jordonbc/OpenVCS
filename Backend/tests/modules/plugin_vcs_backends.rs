// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

use super::*;
use crate::settings::AppConfig;
use std::collections::BTreeMap;

fn backend_descriptor(backend_id: &str, plugin_id: &str) -> PluginBackendDescriptor {
    PluginBackendDescriptor {
        backend_id: BackendId::from(backend_id),
        backend_name: Some("Git".into()),
        action_labels: BTreeMap::new(),
        plugin_id: plugin_id.into(),
        plugin_name: Some("Plugin".into()),
    }
}

#[test]
fn returns_cached_backend_descriptors() {
    invalidate_plugin_vcs_backend_cache();
    let desc = backend_descriptor("git", "openvcs.git");
    store_backends(vec![desc.clone()]);

    let cached = cached_backends().expect("cached backends");
    assert_eq!(cached.len(), 1);
    assert_eq!(cached[0].backend_id.as_ref(), desc.backend_id.as_ref());
    assert_eq!(cached[0].plugin_id, desc.plugin_id);

    let listed = list_plugin_vcs_backends().expect("cache result");
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].backend_id.as_ref(), desc.backend_id.as_ref());
    assert_eq!(listed[0].plugin_id, desc.plugin_id);
    assert!(has_plugin_vcs_backend(&BackendId::from("git")));

    let resolved = plugin_vcs_backend_descriptor(&BackendId::from("git")).expect("descriptor");
    assert_eq!(resolved.plugin_id, "openvcs.git");

    invalidate_plugin_vcs_backend_cache();
    assert!(cached_backends().is_none());
}

#[test]
fn list_uses_cached_backend_snapshot() {
    invalidate_plugin_vcs_backend_cache();

    let first = backend_descriptor("git", "openvcs.git");
    store_backends(vec![first.clone()]);

    let listed = list_plugin_vcs_backends().expect("first cache result");
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].plugin_id, first.plugin_id);

    let replacement = backend_descriptor("hg", "openvcs.hg");
    store_backends(vec![replacement.clone()]);

    let relisted = list_plugin_vcs_backends().expect("replacement cache result");
    assert_eq!(relisted.len(), 1);
    assert_eq!(relisted[0].backend_id.as_ref(), replacement.backend_id.as_ref());
    assert_eq!(relisted[0].plugin_id, replacement.plugin_id);

    invalidate_plugin_vcs_backend_cache();
}

#[test]
fn honors_disabled_overrides_when_resolving_enablement() {
    let mut cfg = AppConfig::default();
    cfg.plugins.disabled = vec!["OPENVCS.GIT".into()];
    cfg.plugins.enabled = vec!["openvcs.git".into()];

    assert!(!is_plugin_enabled_in_settings(&cfg, "openvcs.git", false));
    assert!(!is_plugin_enabled_in_settings(&cfg, "   ", true));

    cfg.plugins.disabled.clear();
    assert!(is_plugin_enabled_in_settings(&cfg, "openvcs.git", false));
    assert!(is_plugin_enabled_in_settings(&cfg, "openvcs.git", true));
}

#[test]
fn reports_unknown_backend_descriptors() {
    invalidate_plugin_vcs_backend_cache();
    store_backends(vec![backend_descriptor("hg", "openvcs.hg")]);

    // Use a backend id that is not present in the cache AND not discoverable
    // from real installed plugins, so the error path is exercised.
    let err = plugin_vcs_backend_descriptor(&BackendId::from("nonexistent-be"))
        .expect_err("missing backend should fail");
    assert!(err.contains("Unknown VCS backend: nonexistent-be"));
}

#[test]
fn plugin_open_config_returns_empty_object_for_unknown_plugin() {
    // plugin_open_config must return {} when no settings file exists for the plugin.
    // The function calls settings_store::load_settings which returns Ok(empty map)
    // when the settings file is absent.
    let result = plugin_open_config("nonexistent.test.plugin");
    assert_eq!(result, serde_json::json!({}));
}

#[test]
fn plugin_open_config_returns_stored_settings() {
    // plugin_open_config must return the JSON object previously persisted by
    // the settings store for the given plugin_id.
    use crate::plugin_runtime::settings_store;

    let dir = tempfile::tempdir().expect("tempdir");
    // Redirect the settings store file lookup to our temp directory.
    settings_store::set_test_plugin_data_root(dir.path().to_path_buf());

    let plugin_id = "test.settings-plugin";
    let settings_path = dir.path().join(plugin_id).join("settings.json");
    std::fs::create_dir_all(settings_path.parent().unwrap()).expect("create dir");

    let settings = serde_json::json!({"key1": "value1", "number": 42});
    std::fs::write(&settings_path, settings.to_string()).expect("write settings");

    let result = plugin_open_config(plugin_id);
    assert_eq!(result, settings);

    settings_store::clear_test_plugin_data_root();
}
