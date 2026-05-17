// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

use super::{SettingKv, SettingValue};

#[test]
/// Verifies setting values round-trip through tagged JSON.
fn serializes_and_deserializes_setting_values() {
    let original = SettingValue::String("hello".into());
    let json = serde_json::to_value(&original).expect("serialize setting value");
    assert_eq!(json, serde_json::json!({"type":"string","value":"hello"}));

    let decoded: SettingValue = serde_json::from_value(json).expect("deserialize setting value");
    assert!(matches!(decoded, SettingValue::String(value) if value == "hello"));
}

#[test]
/// Verifies optional labels are omitted when absent and preserved when present.
fn serializes_setting_kv_label_field_correctly() {
    let unlabeled = SettingKv {
        id: "flag".into(),
        label: None,
        value: SettingValue::Bool(true),
    };
    let unlabeled_json = serde_json::to_value(&unlabeled).expect("serialize unlabeled setting");
    assert_eq!(unlabeled_json, serde_json::json!({"id":"flag","value":{"type":"bool","value":true}}));

    let labeled = SettingKv {
        id: "count".into(),
        label: Some("Counter".into()),
        value: SettingValue::U32(7),
    };
    let labeled_json = serde_json::to_value(&labeled).expect("serialize labeled setting");
    assert_eq!(labeled_json, serde_json::json!({"id":"count","label":"Counter","value":{"type":"u32","value":7}}));
}
