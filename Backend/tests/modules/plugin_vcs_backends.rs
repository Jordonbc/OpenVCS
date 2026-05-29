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
