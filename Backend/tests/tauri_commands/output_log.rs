// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

use super::read_last_lines;
use crate::settings;
use crate::state::AppState;
use std::fs;
use tauri::test::{get_ipc_response, mock_builder, mock_context, noop_assets, INVOKE_KEY};
use tauri::webview::InvokeRequest;
use tauri::{Manager, WebviewWindowBuilder};

// ── read_last_lines tests ──

#[test]
fn reads_last_lines_from_file() {
    let dir = tempfile::tempdir().expect("tempdir");
    let path = dir.path().join("log.txt");
    fs::write(&path, "one\ntwo\nthree\n").expect("write log");

    assert_eq!(
        read_last_lines(&path, 2).expect("read lines"),
        vec!["one".to_string(), "two".to_string(), "three".to_string()]
    );
}

#[test]
fn reads_empty_files_as_empty_lists() {
    let dir = tempfile::tempdir().expect("tempdir");
    let path = dir.path().join("empty.log");
    fs::write(&path, "").expect("write empty log");

    assert!(read_last_lines(&path, 10).expect("read empty").is_empty());
}

// ── Tauri command integration tests via MockRuntime ──

fn build_app() -> tauri::App<tauri::test::MockRuntime> {
    let cfg = settings::AppConfig::default();
    let app_state = AppState::new_with_config(cfg);
    mock_builder()
        .manage(app_state)
        .invoke_handler(tauri::generate_handler![
            super::get_output_log,
            super::clear_output_log,
            super::log_frontend_message,
            super::tail_app_log,
            super::clear_app_log,
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
fn get_output_log_starts_empty() {
    let app = build_app();
    let webview = test_webview(&app);

    let res = invoke_cmd(&webview, "get_output_log", tauri::ipc::InvokeBody::default());
    assert!(res.is_ok(), "get_output_log should succeed: {:?}", res);
    let entries: Vec<crate::output_log::OutputLogEntry> = res.unwrap().deserialize().unwrap();
    assert!(entries.is_empty(), "output log should start empty");
}

#[test]
fn get_output_log_reflects_pushed_entries() {
    let app = build_app();
    let state = app.state::<AppState>();
    state.push_output_log(crate::output_log::OutputLogEntry::new(
        1000,
        crate::output_log::OutputLevel::Info,
        "test",
        "hello world",
    ));

    let webview = test_webview(&app);
    let res = invoke_cmd(&webview, "get_output_log", tauri::ipc::InvokeBody::default());
    assert!(res.is_ok());
    let entries: Vec<crate::output_log::OutputLogEntry> = res.unwrap().deserialize().unwrap();
    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0].message, "hello world");
}

#[test]
fn clear_output_log_empties_log() {
    let app = build_app();
    let state = app.state::<AppState>();
    state.push_output_log(crate::output_log::OutputLogEntry::new(
        1000,
        crate::output_log::OutputLevel::Info,
        "test",
        "to-clear",
    ));

    let webview = test_webview(&app);
    let res = invoke_cmd(&webview, "clear_output_log", tauri::ipc::InvokeBody::default());
    assert!(res.is_ok(), "clear_output_log should succeed");
    assert!(state.output_log().is_empty(), "log should be empty after clear");
}

#[test]
fn log_frontend_message_pushes_entry() {
    let app = build_app();
    let webview = test_webview(&app);

    let body = tauri::ipc::InvokeBody::Json(
        serde_json::json!({
            "level": "info",
            "message": "frontend test message"
        })
    );
    let res = invoke_cmd(&webview, "log_frontend_message", body);
    assert!(res.is_ok());

    let entries = app.state::<AppState>().output_log();
    assert!(!entries.is_empty(), "log_frontend_message should push an entry");
    assert!(entries.iter().any(|e| e.message == "frontend test message"));
}

#[test]
fn log_frontend_message_maps_levels() {
    let app = build_app();
    let webview = test_webview(&app);

    for (level, expected) in [
        ("trace", crate::output_log::OutputLevel::Info),
        ("debug", crate::output_log::OutputLevel::Info),
        ("info", crate::output_log::OutputLevel::Info),
        ("warn", crate::output_log::OutputLevel::Warn),
        ("warning", crate::output_log::OutputLevel::Warn),
        ("error", crate::output_log::OutputLevel::Error),
        ("err", crate::output_log::OutputLevel::Error),
        ("unknown", crate::output_log::OutputLevel::Info),
    ] {
        let state = app.state::<AppState>();
        let body = tauri::ipc::InvokeBody::Json(
            serde_json::json!({
                "level": level,
                "message": format!("test-{}", level)
            })
        );
        let _ = invoke_cmd(&webview, "log_frontend_message", body);

        let entries = state.output_log();
        let entry = entries.iter().find(|e| e.message == format!("test-{}", level));
        assert!(entry.is_some(), "entry for level '{}' not found", level);
        assert_eq!(entry.unwrap().level, expected, "wrong level mapping for '{}'", level);
    }
}

#[test]
fn tail_app_log_returns_entries_without_panicking() {
    let app = build_app();
    let webview = test_webview(&app);

    let res = invoke_cmd(&webview, "tail_app_log", tauri::ipc::InvokeBody::default());
    assert!(res.is_ok(), "tail_app_log should succeed: {:?}", res);
    let entries: Vec<crate::output_log::OutputLogEntry> = res.unwrap().deserialize().unwrap();
    // Entries may exist or be empty depending on the test environment; just verify it doesn't error
    for e in &entries {
        assert!(!e.message.is_empty(), "each log entry should have a message");
    }
}

#[test]
fn clear_app_log_succeeds_when_not_initialized() {
    let app = build_app();
    let webview = test_webview(&app);

    let res = invoke_cmd(&webview, "clear_app_log", tauri::ipc::InvokeBody::default());
    assert!(res.is_ok(), "clear_app_log should succeed: {:?}", res);
}
