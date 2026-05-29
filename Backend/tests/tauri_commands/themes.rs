// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

use std::collections::HashSet;

use crate::state::AppState;
use crate::themes::ThemeSource;
use crate::settings;
use tauri::test::{get_ipc_response, mock_builder, mock_context, noop_assets, INVOKE_KEY};
use tauri::webview::InvokeRequest;
use tauri::WebviewWindowBuilder;

use super::{normalize_plugin_id, theme_allowed_for_enabled_plugins};

// ── Pure function tests (existing) ──

#[test]
fn normalizes_plugin_ids_for_theme_filtering() {
    assert_eq!(normalize_plugin_id(Some(" OpenVCS.Git ")), "openvcs.git");
    assert_eq!(normalize_plugin_id(Some("   ")), "");
    assert_eq!(normalize_plugin_id(None), "");
}

#[test]
fn always_allows_non_plugin_themes() {
    let enabled = HashSet::new();
    assert!(theme_allowed_for_enabled_plugins(&ThemeSource::BuiltIn, None, &enabled));
    assert!(theme_allowed_for_enabled_plugins(&ThemeSource::User, None, &enabled));
}

#[test]
fn only_allows_plugin_themes_from_enabled_plugins() {
    let enabled = HashSet::from(["openvcs.git".to_string()]);

    assert!(theme_allowed_for_enabled_plugins(
        &ThemeSource::Plugin,
        Some(" OpenVCS.Git "),
        &enabled,
    ));
    assert!(!theme_allowed_for_enabled_plugins(
        &ThemeSource::Plugin,
        Some("openvcs.hg"),
        &enabled,
    ));
    assert!(!theme_allowed_for_enabled_plugins(
        &ThemeSource::Plugin,
        Some("   "),
        &enabled,
    ));
}

// ── Tauri command integration tests ──

fn build_app() -> tauri::App<tauri::test::MockRuntime> {
    let cfg = settings::AppConfig::default();
    let app_state = AppState::new_with_config(cfg);
    mock_builder()
        .manage(app_state)
        .invoke_handler(tauri::generate_handler![
            super::list_themes,
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
fn list_themes_returns_themes() {
    let app = build_app();
    let webview = test_webview(&app);
    let res = invoke_cmd(&webview, "list_themes", tauri::ipc::InvokeBody::default());
    assert!(res.is_ok(), "list_themes should succeed: {:?}", res);
    let themes: Vec<crate::themes::ThemeSummary> = res.unwrap().deserialize().unwrap();
    // Should return at least built-in themes
    assert!(!themes.is_empty(), "should have at least built-in themes");
    // All returned themes should be non-plugin (built-in or user)
    for theme in &themes {
        assert!(
            !matches!(theme.source, ThemeSource::Plugin),
            "should not include plugin themes by default"
        );
    }
}
