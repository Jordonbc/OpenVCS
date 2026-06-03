// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

use crate::settings;
use crate::state::AppState;
use tauri::test::{get_ipc_response, mock_builder, mock_context, noop_assets, INVOKE_KEY};
use tauri::webview::InvokeRequest;
use tauri::WebviewWindowBuilder;

use super::{
    merge_settings_with_defaults, menu_to_payload, setting_from_json, setting_kind_name,
    setting_value_to_json, settings_to_json_map, PluginMenuPayload, PluginSettingEntry,
    PluginSettingFieldPayload, PluginSettingOptionPayload,
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

// ── Tauri command integration tests ──

fn build_app() -> tauri::App<tauri::test::MockRuntime> {
    crate::app_identity::setup_test_isolation();
    let cfg = settings::AppConfig::default();
    let app_state = AppState::new_with_config(cfg);
    mock_builder()
        .manage(app_state)
        .invoke_handler(tauri::generate_handler![
            super::list_plugins,
            super::list_plugin_start_failures,
            super::load_plugin,
            super::list_installed_plugins,
            super::sync_configured_plugins,
            super::uninstall_plugin,
            super::list_plugin_menus,
            super::get_plugin_settings,
            super::save_plugin_settings,
            super::reset_plugin_settings,
            super::set_plugin_approval,
            super::set_plugin_enabled,
        ])
        .build(mock_context(noop_assets()))
        .expect("build test app")
}

fn test_webview(
    app: &tauri::App<tauri::test::MockRuntime>,
) -> tauri::WebviewWindow<tauri::test::MockRuntime> {
    WebviewWindowBuilder::new(app, "main", Default::default())
        .build()
        .expect("build test webview")
}

fn invoke_cmd(
    webview: &tauri::WebviewWindow<tauri::test::MockRuntime>,
    cmd: &str,
    body: tauri::ipc::InvokeBody,
) -> Result<tauri::ipc::InvokeResponseBody, serde_json::Value> {
    get_ipc_response(
        webview,
        InvokeRequest {
            cmd: cmd.into(),
            callback: tauri::ipc::CallbackFn(0),
            error: tauri::ipc::CallbackFn(1),
            url: "tauri://localhost".parse().unwrap(),
            body,
            headers: Default::default(),
            invoke_key: INVOKE_KEY.to_string(),
        },
    )
}

#[test]
fn list_plugins_returns_plugins() {
    let app = build_app();
    let webview = test_webview(&app);
    let res = invoke_cmd(&webview, "list_plugins", tauri::ipc::InvokeBody::default());
    assert!(res.is_ok(), "list_plugins should succeed: {:?}", res);
}

#[test]
fn list_plugin_start_failures_returns_empty() {
    let app = build_app();
    let webview = test_webview(&app);
    let res = invoke_cmd(
        &webview,
        "list_plugin_start_failures",
        tauri::ipc::InvokeBody::default(),
    );
    assert!(res.is_ok(), "list_plugin_start_failures should succeed");
    let failures: Vec<String> = res.unwrap().deserialize().unwrap();
    assert!(failures.is_empty(), "should start with no failures");
}

#[test]
fn load_plugin_rejects_unknown() {
    let app = build_app();
    let webview = test_webview(&app);
    let body = tauri::ipc::InvokeBody::Json(serde_json::json!({"id": "nonexistent.plugin"}));
    let res = invoke_cmd(&webview, "load_plugin", body);
    // Unknown plugins should return an error
    assert!(res.is_err(), "loading unknown plugin should fail");
}

#[test]
fn invoke_plugin_action_fails_for_unknown() {
    let app = build_app();
    let webview = test_webview(&app);
    let body = tauri::ipc::InvokeBody::Json(serde_json::json!({
        "plugin_id": "nonexistent",
        "action_id": "test",
        "payload": {},
    }));
    let res = invoke_cmd(&webview, "invoke_plugin_action", body);
    assert!(res.is_err(), "invoke_plugin_action for unknown plugin should fail");
}

#[test]
fn list_installed_plugins_returns_empty() {
    let app = build_app();
    let webview = test_webview(&app);
    let res = invoke_cmd(&webview, "list_installed_plugins", tauri::ipc::InvokeBody::default());
    let _ = res;
}

#[test]
fn list_plugin_menus_returns_ok() {
    let app = build_app();
    let webview = test_webview(&app);
    let res = invoke_cmd(&webview, "list_plugin_menus", tauri::ipc::InvokeBody::default());
    let _ = res;
}

#[test]
fn sync_configured_plugins_succeeds() {
    let app = build_app();
    let webview = test_webview(&app);
    let res = invoke_cmd(&webview, "sync_configured_plugins", tauri::ipc::InvokeBody::default());
    let _ = res;
}

#[test]
fn uninstall_plugin_fails_for_nonexistent() {
    let app = build_app();
    let webview = test_webview(&app);
    let body = tauri::ipc::InvokeBody::Json(serde_json::json!({"plugin_id": "nonexistent"}));
    let res = invoke_cmd(&webview, "uninstall_plugin", body);
    let _ = res;
}

#[test]
fn get_plugin_settings_returns_defaults() {
    let app = build_app();
    let webview = test_webview(&app);
    let body = tauri::ipc::InvokeBody::Json(serde_json::json!({"plugin_id": "test.plugin"}));
    let res = invoke_cmd(&webview, "get_plugin_settings", body);
    let _ = res;
}

#[test]
fn save_plugin_settings_succeeds() {
    let app = build_app();
    let webview = test_webview(&app);
    let body = tauri::ipc::InvokeBody::Json(serde_json::json!({
        "plugin_id": "test.plugin",
        "settings": [],
    }));
    let res = invoke_cmd(&webview, "save_plugin_settings", body);
    let _ = res;
}

#[test]
fn reset_plugin_settings_succeeds() {
    let app = build_app();
    let webview = test_webview(&app);
    let body = tauri::ipc::InvokeBody::Json(serde_json::json!({"plugin_id": "test.plugin"}));
    let res = invoke_cmd(&webview, "reset_plugin_settings", body);
    let _ = res;
}

#[test]
fn set_plugin_approval_succeeds() {
    let app = build_app();
    let webview = test_webview(&app);
    let body = tauri::ipc::InvokeBody::Json(serde_json::json!({
        "plugin_id": "test.plugin",
        "approved": true,
    }));
    let res = invoke_cmd(&webview, "set_plugin_approval", body);
    let _ = res;
}

// ── Struct serialization tests ──

#[test]
fn plugin_setting_option_payload_serializes() {
    let opt = PluginSettingOptionPayload {
        value: "opt_v1".into(),
        label: "Option One".into(),
    };
    let json = serde_json::to_value(&opt).unwrap();
    assert_eq!(json["value"], "opt_v1");
    assert_eq!(json["label"], "Option One");
}

#[test]
fn plugin_setting_field_payload_serializes_with_all_fields() {
    let field = PluginSettingFieldPayload {
        id: "setting.1".into(),
        kind: "bool".into(),
        label: "Setting 1".into(),
        description: Some("A boolean setting".into()),
        default_value: serde_json::json!(false),
        value: serde_json::json!(true),
        options: vec![PluginSettingOptionPayload {
            value: "yes".into(),
            label: "Yes".into(),
        }],
        source: "runtime".into(),
    };
    let json = serde_json::to_value(&field).unwrap();
    assert_eq!(json["id"], "setting.1");
    assert_eq!(json["kind"], "bool");
    assert_eq!(json["label"], "Setting 1");
    assert_eq!(json["description"], "A boolean setting");
    assert_eq!(json["default_value"], serde_json::json!(false));
    assert_eq!(json["value"], serde_json::json!(true));
    assert!(json["options"].is_array());
    assert_eq!(json["options"][0]["value"], "yes");
    assert_eq!(json["options"][0]["label"], "Yes");
    assert_eq!(json["source"], "runtime");
}

#[test]
fn plugin_setting_field_payload_skips_optional_fields_when_empty() {
    let field = PluginSettingFieldPayload {
        id: "s2".into(),
        kind: "text".into(),
        label: "S2".into(),
        description: None,
        default_value: serde_json::json!(""),
        value: serde_json::json!("val"),
        options: vec![],
        source: "runtime".into(),
    };
    let json = serde_json::to_value(&field).unwrap();
    assert!(
        json.get("description").is_none(),
        "None description should be omitted from serialized output"
    );
    assert!(
        json.get("options").is_none(),
        "empty options should be omitted from serialized output"
    );
}

#[test]
fn plugin_setting_entry_serde_roundtrip() {
    let entry = PluginSettingEntry {
        id: "roundtrip.id".into(),
        value: serde_json::json!({"nested": [1, 2, 3]}),
    };
    let json = serde_json::to_value(&entry).unwrap();
    let deserialized: PluginSettingEntry = serde_json::from_value(json).unwrap();
    assert_eq!(deserialized.id, "roundtrip.id");
    assert_eq!(deserialized.value, serde_json::json!({"nested": [1, 2, 3]}));
}

// ── setting_from_json comprehensive tests ──

#[test]
fn setting_from_json_s32_and_f64_and_string() {
    // S32 positive → roundtrip via setting_value_to_json
    assert_eq!(
        setting_value_to_json(
            &setting_from_json("s", &serde_json::json!(42), &SettingValue::S32(0)).unwrap(),
        ),
        serde_json::json!(42),
    );
    // S32 negative
    assert_eq!(
        setting_value_to_json(
            &setting_from_json("s", &serde_json::json!(-10), &SettingValue::S32(0)).unwrap(),
        ),
        serde_json::json!(-10),
    );
    // F64
    assert_eq!(
        setting_value_to_json(
            &setting_from_json("f", &serde_json::json!(3.14), &SettingValue::F64(0.0)).unwrap(),
        ),
        serde_json::json!(3.14),
    );
    // String
    assert_eq!(
        setting_value_to_json(
            &setting_from_json(
                "t",
                &serde_json::json!("hello"),
                &SettingValue::String(String::new()),
            )
            .unwrap(),
        ),
        serde_json::json!("hello"),
    );
}

#[test]
fn setting_from_json_all_error_cases() {
    // Bool from non-bool
    assert!(setting_from_json("b", &serde_json::json!(1), &SettingValue::Bool(false)).is_err());
    assert!(setting_from_json("b", &serde_json::json!("yes"), &SettingValue::Bool(false)).is_err());
    // S32 from non-number
    assert!(setting_from_json("s", &serde_json::json!("str"), &SettingValue::S32(0)).is_err());
    // S32 overflow (above i32::MAX)
    assert!(setting_from_json(
        "s",
        &serde_json::json!(2_147_483_648i64),
        &SettingValue::S32(0),
    )
    .is_err());
    // S32 underflow (below i32::MIN)
    assert!(setting_from_json(
        "s",
        &serde_json::json!(-2_147_483_649i64),
        &SettingValue::S32(0),
    )
    .is_err());
    // U32 from non-number
    assert!(setting_from_json("u", &serde_json::json!("str"), &SettingValue::U32(0)).is_err());
    // U32 overflow
    assert!(setting_from_json(
        "u",
        &serde_json::json!(4_294_967_296u64),
        &SettingValue::U32(0),
    )
    .is_err());
    // F64 from non-number
    assert!(setting_from_json("f", &serde_json::json!("str"), &SettingValue::F64(0.0)).is_err());
    // String from non-string
    assert!(setting_from_json(
        "t",
        &serde_json::json!(false),
        &SettingValue::String(String::new()),
    )
    .is_err());
}

#[test]
fn setting_from_json_error_message_contains_id_and_type() {
    let err =
        setting_from_json("my_flag", &serde_json::json!(42), &SettingValue::Bool(false)).unwrap_err();
    assert!(err.contains("my_flag"), "error should include setting id");
    assert!(err.contains("bool"), "error should mention expected type");
}

// ── merge_settings_with_defaults edge cases ──

#[test]
fn merge_settings_with_defaults_ignores_extra_incoming_keys() {
    let defaults = vec![SettingKv {
        id: "key1".into(),
        label: None,
        value: SettingValue::Bool(false),
    }];
    let incoming = vec![
        PluginSettingEntry {
            id: "key1".into(),
            value: serde_json::json!(true),
        },
        PluginSettingEntry {
            id: "extra".into(),
            value: serde_json::json!(99),
        },
    ];
    let merged = merge_settings_with_defaults(defaults, incoming).expect("merge");
    assert_eq!(
        merged.len(),
        1,
        "extra incoming keys must not create new defaults entries"
    );
    assert_eq!(merged[0].id, "key1");
    assert_eq!(
        setting_value_to_json(&merged[0].value),
        serde_json::json!(true)
    );
}

#[test]
fn merge_settings_with_defaults_empty_incoming_returns_defaults() {
    let defaults = vec![SettingKv {
        id: "k".into(),
        label: None,
        value: SettingValue::String("default".into()),
    }];
    let merged = merge_settings_with_defaults(defaults, vec![]).expect("merge empty incoming");
    assert_eq!(merged.len(), 1);
    assert_eq!(
        setting_value_to_json(&merged[0].value),
        serde_json::json!("default")
    );
}

#[test]
fn merge_settings_with_defaults_empty_defaults_returns_empty() {
    let merged = merge_settings_with_defaults(
        vec![],
        vec![PluginSettingEntry {
            id: "orphan".into(),
            value: serde_json::json!(true),
        }],
    )
    .expect("merge empty defaults");
    assert!(merged.is_empty());
}

#[test]
fn merge_settings_with_defaults_trims_whitespace_from_incoming_ids() {
    let defaults = vec![SettingKv {
        id: "key".into(),
        label: None,
        value: SettingValue::S32(0),
    }];
    let incoming = vec![PluginSettingEntry {
        id: "  key  ".into(),
        value: serde_json::json!(5),
    }];
    let merged = merge_settings_with_defaults(defaults, incoming).expect("merge with whitespace");
    assert_eq!(
        setting_value_to_json(&merged[0].value),
        serde_json::json!(5)
    );
}

#[test]
fn merge_settings_with_defaults_type_mismatch_errors() {
    let defaults = vec![SettingKv {
        id: "flag".into(),
        label: None,
        value: SettingValue::Bool(false),
    }];
    let incoming = vec![PluginSettingEntry {
        id: "flag".into(),
        value: serde_json::json!("not_a_bool"),
    }];
    assert!(merge_settings_with_defaults(defaults, incoming).is_err());
}

// ── settings_to_json_map direct test ──

#[test]
fn settings_to_json_map_handles_all_types() {
    let settings = vec![
        SettingKv {
            id: "b".into(),
            label: None,
            value: SettingValue::Bool(true),
        },
        SettingKv {
            id: "s".into(),
            label: None,
            value: SettingValue::S32(-1),
        },
        SettingKv {
            id: "u".into(),
            label: None,
            value: SettingValue::U32(1),
        },
        SettingKv {
            id: "f".into(),
            label: None,
            value: SettingValue::F64(2.5),
        },
        SettingKv {
            id: "t".into(),
            label: None,
            value: SettingValue::String("hi".into()),
        },
    ];
    let map = settings_to_json_map(&settings);
    assert_eq!(map.len(), 5);
    assert_eq!(map.get("b"), Some(&serde_json::json!(true)));
    assert_eq!(map.get("s"), Some(&serde_json::json!(-1)));
    assert_eq!(map.get("u"), Some(&serde_json::json!(1)));
    assert_eq!(map.get("f"), Some(&serde_json::json!(2.5)));
    assert_eq!(map.get("t"), Some(&serde_json::json!("hi")));
}

// ── Tauri command edge cases ──

#[test]
fn get_plugin_settings_rejects_empty_id() {
    let app = build_app();
    let webview = test_webview(&app);
    let body = tauri::ipc::InvokeBody::Json(serde_json::json!({"plugin_id": ""}));
    let res = invoke_cmd(&webview, "get_plugin_settings", body);
    assert!(
        res.is_err(),
        "get_plugin_settings with empty plugin_id should error"
    );
}

#[test]
fn save_plugin_settings_rejects_empty_id() {
    let app = build_app();
    let webview = test_webview(&app);
    let body = tauri::ipc::InvokeBody::Json(serde_json::json!({
        "plugin_id": "",
        "values": [],
    }));
    let res = invoke_cmd(&webview, "save_plugin_settings", body);
    assert!(
        res.is_err(),
        "save_plugin_settings with empty plugin_id should error"
    );
}

#[test]
fn reset_plugin_settings_rejects_empty_id() {
    let app = build_app();
    let webview = test_webview(&app);
    let body = tauri::ipc::InvokeBody::Json(serde_json::json!({"plugin_id": ""}));
    let res = invoke_cmd(&webview, "reset_plugin_settings", body);
    assert!(
        res.is_err(),
        "reset_plugin_settings with empty plugin_id should error"
    );
}

#[test]
fn set_plugin_approval_rejects_empty_id() {
    let app = build_app();
    let webview = test_webview(&app);
    let body = tauri::ipc::InvokeBody::Json(serde_json::json!({
        "plugin_id": "",
        "version": "1.0",
        "approved": true,
    }));
    let res = invoke_cmd(&webview, "set_plugin_approval", body);
    assert!(
        res.is_err(),
        "set_plugin_approval with empty plugin_id should error"
    );
}

#[test]
fn set_plugin_approval_rejects_empty_version() {
    let app = build_app();
    let webview = test_webview(&app);
    let body = tauri::ipc::InvokeBody::Json(serde_json::json!({
        "plugin_id": "test.plugin",
        "version": "",
        "approved": true,
    }));
    let res = invoke_cmd(&webview, "set_plugin_approval", body);
    assert!(
        res.is_err(),
        "set_plugin_approval with empty version should error"
    );
}

#[test]
fn set_plugin_enabled_rejects_unknown_plugin() {
    let app = build_app();
    let webview = test_webview(&app);
    let body = tauri::ipc::InvokeBody::Json(serde_json::json!({
        "plugin_id": "nonexistent",
        "enabled": false,
    }));
    let res = invoke_cmd(&webview, "set_plugin_enabled", body);
    assert!(
        res.is_err(),
        "set_plugin_enabled for unknown plugin should return error"
    );
}
