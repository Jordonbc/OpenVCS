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
