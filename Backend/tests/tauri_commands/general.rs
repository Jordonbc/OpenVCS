// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

use std::path::Path;

use crate::state::AppState;
use crate::settings;
use tauri::test::{get_ipc_response, mock_builder, mock_context, noop_assets, INVOKE_KEY};
use tauri::webview::InvokeRequest;
use tauri::WebviewWindowBuilder;

use super::{
    browse_directory_title, infer_repo_dir_from_url, recent_repo_name, resolve_default_backend_id,
    validate_add_path, validate_clone_input, validate_vcs_url,
};
use crate::core::BackendId;

// ── Pure function tests ──

#[test]
fn infers_repo_directory_names() {
    assert_eq!(infer_repo_dir_from_url("https://example.com/org/repo.git"), "repo");
    assert_eq!(infer_repo_dir_from_url("git@example.com:org/repo"), "repo");
    assert_eq!(infer_repo_dir_from_url("https://example.com/org/repo/"), "repo");
}

#[test]
fn resolves_browse_directory_titles() {
    assert_eq!(browse_directory_title(Some("clone_dest")), "Choose destination folder");
    assert_eq!(browse_directory_title(Some("add_repo")), "Select an existing repository folder");
    assert_eq!(browse_directory_title(Some("other")), "Select a folder");
    assert_eq!(browse_directory_title(None), "Select a folder");
}

#[test]
fn resolves_default_backend_from_configured_or_sorted_available_values() {
    let available = vec![BackendId::from("zeta"), BackendId::from("alpha")];

    let configured = resolve_default_backend_id("zeta", &available)
        .map(|backend| backend.as_ref().to_string());
    assert_eq!(configured, Some("zeta".into()));

    let fallback = resolve_default_backend_id("missing", &available)
        .map(|backend| backend.as_ref().to_string());
    assert_eq!(fallback, Some("alpha".into()));
}

#[test]
fn derives_recent_repository_display_names() {
    assert_eq!(recent_repo_name(Path::new("/tmp/demo-repo")), Some("demo-repo".into()));
    assert_eq!(recent_repo_name(Path::new("/")), None);
}

// ── Tauri command integration tests ──

fn build_app() -> tauri::App<tauri::test::MockRuntime> {
    let cfg = settings::AppConfig::default();
    let app_state = AppState::new_with_config(cfg);
    mock_builder()
        .manage(app_state)
        .invoke_handler(tauri::generate_handler![
            super::about_info,
            super::show_licenses,
            super::list_recent_repos,
            super::current_repo_path,
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
fn about_info_returns_metadata() {
    let app = build_app();
    let webview = test_webview(&app);
    let res = invoke_cmd(&webview, "about_info", tauri::ipc::InvokeBody::default());
    assert!(res.is_ok(), "about_info should succeed: {:?}", res);
    let info: crate::utilities::inner::AboutInfo = res.unwrap().deserialize().unwrap();
    assert_eq!(info.name, env!("CARGO_PKG_NAME"));
}

#[test]
fn show_licenses_returns_ok() {
    let app = build_app();
    let webview = test_webview(&app);
    let res = invoke_cmd(&webview, "show_licenses", tauri::ipc::InvokeBody::default());
    assert!(res.is_ok(), "show_licenses should succeed: {:?}", res);
}

// ── Pure validation command tests (no Tauri dependencies) ──

#[test]
fn validate_vcs_url_accepts_http_urls() {
    let result = validate_vcs_url("https://github.com/user/repo.git".into());
    assert!(result.ok, "http URL should be valid");
}

#[test]
fn validate_vcs_url_rejects_garbage() {
    let result = validate_vcs_url("not a url".into());
    assert!(!result.ok, "garbage should be invalid");
}

#[test]
fn validate_add_path_rejects_empty() {
    let result = validate_add_path("".into());
    assert!(!result.ok, "empty path should be invalid");
}

#[test]
fn validate_clone_input_rejects_invalid_url() {
    let result = validate_clone_input("bad".into(), "/tmp".into());
    assert!(!result.ok, "bad url + good dest should be invalid");
}

// ── State-only IPC command tests ──

#[test]
fn list_recent_repos_returns_parsable_entries() {
    let app = build_app();
    let webview = test_webview(&app);

    let res = invoke_cmd(&webview, "list_recent_repos", tauri::ipc::InvokeBody::default());
    assert!(res.is_ok(), "list_recent_repos should succeed: {:?}", res);
    let repos: Vec<serde_json::Value> = res.unwrap().deserialize().unwrap();
    for repo in &repos {
        assert!(repo.get("path").and_then(|p| p.as_str()).is_some(), "each repo entry needs a path string");
    }
}

#[test]
fn current_repo_path_returns_none_when_no_repo() {
    let app = build_app();
    let webview = test_webview(&app);

    let res = invoke_cmd(&webview, "current_repo_path", tauri::ipc::InvokeBody::default());
    assert!(res.is_ok(), "current_repo_path should succeed: {:?}", res);
    let path: Option<String> = res.unwrap().deserialize().unwrap();
    assert!(path.is_none(), "repo path should be None when no repo open");
}
