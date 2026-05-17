// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

use super::PluginRuntimeInstance;
use crate::core::settings::SettingKv;
use serde_json::json;

struct DummyRuntime;

impl PluginRuntimeInstance for DummyRuntime {
    fn ensure_running(&self) -> Result<(), String> {
        Ok(())
    }

    fn stop(&self) {}
}

#[test]
/// Verifies default runtime callbacks return empty or identity values.
fn default_callbacks_return_safe_values() {
    let runtime = DummyRuntime;
    assert!(runtime.get_menus().expect("menus").is_empty());
    assert_eq!(runtime.handle_action("id", json!({})).expect("action"), serde_json::Value::Null);
    assert!(runtime.settings_defaults().expect("defaults").is_empty());
    let values = vec![SettingKv { id: "x".into(), label: None, value: crate::core::settings::SettingValue::Bool(true) }];
    assert_eq!(runtime.settings_on_load(values.clone()).expect("load").len(), 1);
    assert_eq!(runtime.settings_on_save(values.clone()).expect("save").len(), 1);
    runtime.settings_on_apply(values).expect("apply");
    runtime.settings_on_reset().expect("reset");
    runtime.set_event_sink(None);
    runtime.stop();
}
