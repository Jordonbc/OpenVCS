// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

use super::{emit_from_plugin, emit_to_plugins, test_subscribe, test_subscribers, unregister_plugin};

#[test]
/// Verifies plugin subscriptions can be registered and removed.
fn unregisters_plugin_subscriptions() {
    let plugin_id = "test.plugin.events.unregister";
    test_subscribe(plugin_id, "branch.changed");
    assert_eq!(test_subscribers(plugin_id), vec!["branch.changed".to_string()]);

    unregister_plugin(plugin_id);
    assert!(test_subscribers(plugin_id).is_empty());
}

#[test]
/// Verifies event emission paths do not mutate registry state.
fn emits_without_mutating_subscriptions() {
    let plugin_id = "test.plugin.events.emit";
    test_subscribe(plugin_id, "repo.changed");

    emit_to_plugins(None, "repo.changed", serde_json::json!({"ok": true}));
    emit_from_plugin(plugin_id, "repo.changed", serde_json::json!({"ok": true}));

    assert_eq!(test_subscribers(plugin_id), vec!["repo.changed".to_string()]);
    unregister_plugin(plugin_id);
}
