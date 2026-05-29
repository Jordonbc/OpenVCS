// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

use super::{
    merge_settings_with_defaults, menu_to_payload, setting_from_json, setting_kind_name,
    setting_value_to_json, settings_to_json_map, PluginMenuPayload, PluginSettingEntry,
};
use crate::core::settings::{SettingKv, SettingValue};
use crate::core::ui::{Menu, MenuSurface, UiButton, UiElement, UiText};

#[test]
fn maps_setting_values_to_kind_names() {
    assert_eq!(setting_kind_name(&SettingValue::Bool(true)), "bool");
    assert_eq!(setting_kind_name(&SettingValue::S32(-1)), "s32");
    assert_eq!(setting_kind_name(&SettingValue::U32(1)), "u32");
    assert_eq!(setting_kind_name(&SettingValue::F64(1.5)), "f64");
    assert_eq!(setting_kind_name(&SettingValue::String("x".into())), "text");
}

#[test]
fn converts_setting_values_to_json() {
    assert_eq!(setting_value_to_json(&SettingValue::Bool(true)), serde_json::json!(true));
    assert_eq!(setting_value_to_json(&SettingValue::S32(-3)), serde_json::json!(-3));
    assert_eq!(setting_value_to_json(&SettingValue::U32(3)), serde_json::json!(3));
    assert_eq!(setting_value_to_json(&SettingValue::F64(1.25)), serde_json::json!(1.25));
    assert_eq!(
        setting_value_to_json(&SettingValue::String("hello".into())),
        serde_json::json!("hello")
    );
}

#[test]
fn converts_json_to_typed_settings() {
    assert_eq!(
        setting_value_to_json(
            &setting_from_json("flag", &serde_json::json!(true), &SettingValue::Bool(false))
                .unwrap(),
        ),
        serde_json::json!(true)
    );
    assert_eq!(
        setting_value_to_json(
            &setting_from_json("count", &serde_json::json!(7), &SettingValue::U32(0)).unwrap(),
        ),
        serde_json::json!(7)
    );
    assert!(setting_from_json("flag", &serde_json::json!("yes"), &SettingValue::Bool(false)).is_err());
}

#[test]
fn merges_settings_into_defaults_and_serializes() {
    let defaults = vec![
        SettingKv { id: "flag".into(), label: None, value: SettingValue::Bool(false) },
        SettingKv { id: "name".into(), label: None, value: SettingValue::String("old".into()) },
    ];
    let incoming = vec![
        PluginSettingEntry { id: "flag".into(), value: serde_json::json!(true) },
        PluginSettingEntry { id: "name".into(), value: serde_json::json!("new") },
    ];

    let merged = merge_settings_with_defaults(defaults, incoming).expect("merge settings");
    assert_eq!(setting_value_to_json(&merged[0].value), serde_json::json!(true));
    assert_eq!(setting_value_to_json(&merged[1].value), serde_json::json!("new"));

    let json_map = settings_to_json_map(&merged);
    assert_eq!(json_map.get("flag"), Some(&serde_json::json!(true)));
    assert_eq!(json_map.get("name"), Some(&serde_json::json!("new")));
}

#[test]
fn converts_menu_payload() {
    let menu = Menu {
        id: "menu-1".into(),
        label: "Menu".into(),
        order: Some(2),
        surface: MenuSurface::Menubar,
        elements: vec![
            UiElement::Text(UiText { id: "txt".into(), content: "hello".into() }),
            UiElement::Button(UiButton { id: "btn".into(), label: "Click".into() }),
        ],
    };

    let payload: PluginMenuPayload = menu_to_payload("plugin.id", menu);
    assert_eq!(payload.plugin_id, "plugin.id");
    assert_eq!(payload.label, "Menu");
    assert_eq!(payload.elements[0]["type"], serde_json::json!("text"));
    assert_eq!(payload.elements[1]["type"], serde_json::json!("button"));
}
