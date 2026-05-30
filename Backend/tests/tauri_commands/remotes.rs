// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

use super::{
    host_from_remote_url, looks_like_ff_only_divergence, looks_like_ssh_auth_failure,
    looks_like_unknown_host_key,
};

#[test]
fn parses_host_from_remote_urls() {
    assert_eq!(host_from_remote_url("git@github.com:org/repo.git"), Some("github.com".into()));
    assert_eq!(host_from_remote_url("ssh://git@example.com/org/repo"), Some("example.com".into()));
    assert_eq!(host_from_remote_url("https://example.com/org/repo"), Some("example.com".into()));
    assert_eq!(host_from_remote_url("http://insecure.example.com/org/repo"), Some("insecure.example.com".into()));
}

#[test]
fn rejects_unparseable_remote_urls() {
    assert!(host_from_remote_url("").is_none());
    assert!(host_from_remote_url("not a url").is_none());
    assert!(host_from_remote_url("ssh://").is_none());
}

#[test]
fn detects_unknown_host_key_errors() {
    assert!(looks_like_unknown_host_key(
        "The authenticity of host 'github.com (140.82.121.4)' can't be established."
    ));
    assert!(looks_like_unknown_host_key("Strict host key checking failed"));
    assert!(!looks_like_unknown_host_key("permission denied (publickey)"));
}

#[test]
fn detects_ssh_authentication_failures() {
    assert!(looks_like_ssh_auth_failure("Permission denied (publickey)."));
    assert!(looks_like_ssh_auth_failure("Authentication failed for 'git'"));
    assert!(!looks_like_ssh_auth_failure("host key verification failed"));
}

#[test]
fn detects_fast_forward_only_divergence() {
    assert!(looks_like_ff_only_divergence(
        "fatal: Not possible to fast-forward, aborting."
    ));
    assert!(looks_like_ff_only_divergence("Cannot be fast-forwarded because branches diverged"));
    assert!(!looks_like_ff_only_divergence("permission denied (publickey)"));
}

// ── IPC command error path tests ──

use crate::settings;
use crate::state::AppState;
use tauri::ipc::InvokeResponseBody;
use tauri::test::{get_ipc_response, mock_builder, mock_context, noop_assets, INVOKE_KEY};
use tauri::webview::InvokeRequest;
use tauri::WebviewWindowBuilder;

fn build_app_no_repo() -> tauri::App<tauri::test::MockRuntime> {
    let cfg = settings::AppConfig::default();
    let app_state = AppState::new_with_config(cfg);
    mock_builder()
        .manage(app_state)
        .invoke_handler(tauri::generate_handler![
            super::vcs_set_remote_url,
            super::vcs_fetch,
            super::vcs_fetch_all,
            super::vcs_pull,
            super::vcs_push,
            super::vcs_undo_since_push,
            super::vcs_undo_to_commit,
        ])
        .build(mock_context(noop_assets()))
        .expect("build remotes test app")
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
) -> Result<InvokeResponseBody, serde_json::Value> {
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
fn vcs_set_remote_url_fails_without_repo() {
    let app = build_app_no_repo();
    let wv = test_webview(&app);

    let body = tauri::ipc::InvokeBody::Json(serde_json::json!({
        "remote": "origin",
        "url": "https://example.com/repo.git",
    }));
    let res = invoke_cmd(&wv, "vcs_set_remote_url", body);
    assert!(res.is_err(), "vcs_set_remote_url needs a repo: {:?}", res);
}

#[test]
fn vcs_fetch_fails_without_repo() {
    let app = build_app_no_repo();
    let wv = test_webview(&app);

    let body = tauri::ipc::InvokeBody::Json(serde_json::json!({
        "remote": "origin",
        "refspec": "",
    }));
    let res = invoke_cmd(&wv, "vcs_fetch", body);
    assert!(res.is_err(), "vcs_fetch needs a repo: {:?}", res);
}

#[test]
fn vcs_fetch_all_fails_without_repo() {
    let app = build_app_no_repo();
    let wv = test_webview(&app);

    let res = invoke_cmd(&wv, "vcs_fetch_all", tauri::ipc::InvokeBody::default());
    assert!(res.is_err(), "vcs_fetch_all needs a repo: {:?}", res);
}

#[test]
fn vcs_pull_fails_without_repo() {
    let app = build_app_no_repo();
    let wv = test_webview(&app);

    let body = tauri::ipc::InvokeBody::Json(serde_json::json!({
        "remote": "origin",
        "branch": "main",
    }));
    let res = invoke_cmd(&wv, "vcs_pull", body);
    assert!(res.is_err(), "vcs_pull needs a repo: {:?}", res);
}

#[test]
fn vcs_push_fails_without_repo() {
    let app = build_app_no_repo();
    let wv = test_webview(&app);

    let body = tauri::ipc::InvokeBody::Json(serde_json::json!({
        "remote": "origin",
        "refspec": "main",
    }));
    let res = invoke_cmd(&wv, "vcs_push", body);
    assert!(res.is_err(), "vcs_push needs a repo: {:?}", res);
}
