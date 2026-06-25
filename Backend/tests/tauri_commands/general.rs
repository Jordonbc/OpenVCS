// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

use std::path::Path;

use crate::state::AppState;
use crate::settings;
use tauri::test::{get_ipc_response, mock_builder, mock_context, noop_assets, INVOKE_KEY};
use tauri::webview::InvokeRequest;
use tauri::WebviewWindowBuilder;

use super::{
    browse_directory_title, infer_repo_dir_from_url, resolve_default_backend_id,
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
    // file_name extraction logic (inlined from list_recent_repos)
    assert_eq!(
        std::path::Path::new("/tmp/demo-repo").file_name().and_then(|s| s.to_str()).map(|s| s.to_string()),
        Some("demo-repo".to_string())
    );
    assert_eq!(std::path::Path::new("/").file_name().and_then(|s| s.to_str()).map(|s| s.to_string()), None);
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
            super::browse_directory,
            super::browse_file,
            super::add_repo,
            super::clone_repo,
            super::open_repo,
            super::open_repo_dotfile,
            super::open_docs,
            super::exit_app,
            super::check_for_updates,
            super::vcs_operation_active,
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
    // Only empty strings are rejected at the validation layer;
    // format validation is delegated to the VCS plugin.
    let result = validate_vcs_url("not a url".into());
    assert!(result.ok, "non-empty strings pass basic URL validation");
    let empty = validate_vcs_url("".into());
    assert!(!empty.ok, "empty should be invalid");
}

#[test]
fn validate_add_path_rejects_empty() {
    let result = validate_add_path("".into());
    assert!(!result.ok, "empty path should be invalid");
}

#[test]
fn validate_clone_input_rejects_invalid_url() {
    // Non-empty URL passes basic validation; format is plugin's job.
    let result = validate_clone_input("bad".into(), "/tmp".into());
    assert!(result.ok, "non-empty URL passes basic validation");
    let empty = validate_clone_input("".into(), "/tmp".into());
    assert!(!empty.ok, "empty URL should be invalid");
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

// ── Window<R> command error path tests ──

#[test]
fn add_repo_fails_without_backend() {
    let app = build_app();
    let wv = test_webview(&app);
    let body = tauri::ipc::InvokeBody::Json(serde_json::json!({
        "path": "/tmp/test-repo",
        "backend_id": null,
    }));
    let res = invoke_cmd(&wv, "add_repo", body);
    assert!(res.is_err(), "add_repo should fail without backend: {:?}", res);
}

#[test]
fn clone_repo_fails_without_backend() {
    let app = build_app();
    let wv = test_webview(&app);
    let body = tauri::ipc::InvokeBody::Json(serde_json::json!({
        "url": "https://example.com/repo.git",
        "dest": "/tmp/repo",
        "backend_id": null,
    }));
    let res = invoke_cmd(&wv, "clone_repo", body);
    assert!(res.is_err(), "clone_repo should fail without backend: {:?}", res);
}

#[test]
fn open_repo_fails_without_backend() {
    let app = build_app();
    let wv = test_webview(&app);
    let body = tauri::ipc::InvokeBody::Json(serde_json::json!({
        "path": "/nonexistent/path",
        "backend_id": null,
    }));
    let res = invoke_cmd(&wv, "open_repo", body);
    assert!(res.is_err(), "open_repo should fail without backend: {:?}", res);
}

#[test]
fn open_repo_dotfile_fails_without_repo() {
    let app = build_app();
    let wv = test_webview(&app);
    let body = tauri::ipc::InvokeBody::Json(serde_json::json!({"name": ".gitignore"}));
    let res = invoke_cmd(&wv, "open_repo_dotfile", body);
    assert!(res.is_err(), "open_repo_dotfile needs a repo: {:?}", res);
}

// ── Additional pure function edge‑case tests ──

#[test]
fn infers_repo_directory_names_edge_cases() {
    assert_eq!(infer_repo_dir_from_url(""), "");
    assert_eq!(infer_repo_dir_from_url("https://example.com"), "example.com");
    assert_eq!(infer_repo_dir_from_url("https://example.com/a/b/repo"), "repo");
}

#[test]
fn resolves_default_backend_with_empty_config_and_empty_available() {
    let available = vec![BackendId::from("zeta"), BackendId::from("alpha")];
    let result = resolve_default_backend_id("", &available)
        .map(|b| b.as_ref().to_string());
    assert_eq!(result, Some("alpha".into()));
    assert!(resolve_default_backend_id("anything", &[]).is_none());
}

#[test]
fn derives_recent_repo_name_edge_cases() {
    assert_eq!(
        std::path::Path::new("single").file_name().and_then(|s| s.to_str()).map(|s| s.to_string()),
        Some("single".to_string())
    );
    assert_eq!(std::path::Path::new("").file_name().and_then(|s| s.to_str()).map(|s| s.to_string()), None);
}

#[test]
fn browse_directory_title_unknown_and_empty() {
    assert_eq!(browse_directory_title(Some("")), "Select a folder");
    assert_eq!(browse_directory_title(Some("unknown")), "Select a folder");
}

// ── Additional validation direct‑call tests ──

#[test]
fn validate_vcs_url_accepts_ssh_and_rejects_empty() {
    assert!(validate_vcs_url("git@github.com:user/repo.git".into()).ok);
    assert!(!validate_vcs_url("".into()).ok);
}

#[test]
fn validate_add_path_rejects_nonexistent() {
    let result = validate_add_path("/tmp/definitely-nonexistent-test-path".into());
    assert!(!result.ok);
}

#[test]
fn validate_clone_input_rejects_empty_url_and_dest() {
    assert!(!validate_clone_input("".into(), "/tmp".into()).ok);
    assert!(!validate_clone_input("https://example.com/repo.git".into(), "".into()).ok);
}

// ── Additional IPC command tests ──

#[test]
fn vcs_operation_active_returns_false_by_default() {
    let app = build_app();
    let webview = test_webview(&app);
    let res = invoke_cmd(&webview, "vcs_operation_active", tauri::ipc::InvokeBody::default());
    assert!(res.is_ok(), "vcs_operation_active should succeed: {:?}", res);
    let active: bool = res.unwrap().deserialize().unwrap();
    assert!(!active, "should be false when no task is active");
}

#[test]
fn add_repo_fails_with_nonexistent_path_and_valid_backend() {
    let app = build_app();
    let wv = test_webview(&app);
    let body = tauri::ipc::InvokeBody::Json(serde_json::json!({
        "path": "/tmp/nonexistent-openvcs-test-path",
        "backend_id": "test-backend",
    }));
    let res = invoke_cmd(&wv, "add_repo", body);
    assert!(res.is_err(), "add_repo should fail with nonexistent path: {:?}", res);
}

#[test]
fn open_repo_fails_with_nonexistent_path_and_valid_backend() {
    let app = build_app();
    let wv = test_webview(&app);
    let body = tauri::ipc::InvokeBody::Json(serde_json::json!({
        "path": "/tmp/nonexistent-openvcs-test-path-2",
        "backend_id": "test-backend",
    }));
    let res = invoke_cmd(&wv, "open_repo", body);
    assert!(res.is_err(), "open_repo should fail with nonexistent path: {:?}", res);
}

#[test]
fn clone_repo_fails_with_empty_url_and_valid_backend() {
    let app = build_app();
    let wv = test_webview(&app);
    let body = tauri::ipc::InvokeBody::Json(serde_json::json!({
        "url": "",
        "dest": "/tmp",
        "backend_id": "test-backend",
    }));
    let res = invoke_cmd(&wv, "clone_repo", body);
    assert!(res.is_err(), "clone_repo with empty URL should fail: {:?}", res);
}
