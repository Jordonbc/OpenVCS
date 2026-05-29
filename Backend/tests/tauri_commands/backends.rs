// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

use crate::core::BackendId;
use crate::settings;
use crate::state::AppState;
use tauri::test::{get_ipc_response, mock_builder, mock_context, noop_assets, INVOKE_KEY};
use tauri::webview::InvokeRequest;
use tauri::WebviewWindowBuilder;

use super::{auto_default_backend_id, backend_display_label};

#[test]
fn picks_backend_display_labels_from_backend_name_plugin_name_or_id() {
    let backend_id = BackendId::from("openvcs.git");

    assert_eq!(
        backend_display_label(Some(" Git "), Some("Plugin"), &backend_id),
        "Git"
    );
    assert_eq!(
        backend_display_label(None, Some(" Plugin Git "), &backend_id),
        "Plugin Git"
    );
    assert_eq!(backend_display_label(None, None, &backend_id), "openvcs.git");
}

#[test]
fn auto_selects_the_only_backend_when_default_differs() {
    let selected = auto_default_backend_id(
        "other",
        &[("openvcs.git".into(), "Git".into())],
    );
    assert_eq!(selected, Some("openvcs.git".into()));
}

#[test]
fn skips_auto_selection_when_backend_is_already_default_or_not_unique() {
    assert_eq!(
        auto_default_backend_id("openvcs.git", &[("openvcs.git".into(), "Git".into())]),
        None
    );
    assert_eq!(
        auto_default_backend_id(
            "",
            &[("git".into(), "Git".into()), ("hg".into(), "Hg".into())],
        ),
        None
    );
}

// ── Tauri IPC integration tests ──

fn build_app() -> tauri::App<tauri::test::MockRuntime> {
    let cfg = settings::AppConfig::default();
    let app_state = AppState::new_with_config(cfg);
    mock_builder()
        .manage(app_state)
        .invoke_handler(tauri::generate_handler![
            super::list_vcs_backends_cmd,
            super::current_vcs_action_labels,
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
fn list_vcs_backends_returns_backend_entries() {
    let app = build_app();
    let webview = test_webview(&app);

    let res = invoke_cmd(&webview, "list_vcs_backends_cmd", tauri::ipc::InvokeBody::default());
    assert!(res.is_ok(), "list_vcs_backends_cmd should succeed: {:?}", res);
    let backends: Vec<(String, String)> = res.unwrap().deserialize().unwrap();
    for (id, label) in &backends {
        assert!(!id.is_empty(), "each backend should have a non-empty id");
        assert!(!label.is_empty(), "each backend should have a non-empty label");
    }
}

#[test]
fn current_vcs_action_labels_fails_when_no_repo() {
    let app = build_app();
    let webview = test_webview(&app);

    let res = invoke_cmd(&webview, "current_vcs_action_labels", tauri::ipc::InvokeBody::default());
    assert!(res.is_err(), "current_vcs_action_labels should fail without repo");
}
