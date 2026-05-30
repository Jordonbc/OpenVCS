// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

use super::{decode_repo_text, inspect_repo_file_meta, normalize_gitignore_entry, safe_relative_path};

#[test]
fn validates_repo_relative_paths() {
    assert_eq!(safe_relative_path("src/lib.rs").unwrap(), std::path::PathBuf::from("src/lib.rs"));
    assert!(safe_relative_path("").is_err());
    assert!(safe_relative_path("../secret").is_err());
    assert!(safe_relative_path("/absolute").is_err());
}

#[test]
fn normalizes_gitignore_entries() {
    assert_eq!(normalize_gitignore_entry("foo\\bar").unwrap(), "/foo/bar");
    assert_eq!(normalize_gitignore_entry("./baz").unwrap(), "/baz");
    assert!(normalize_gitignore_entry("bad\npath").is_err());
}

#[test]
fn decodes_text_bytes() {
    assert_eq!(decode_repo_text(b"hello"), "hello");

    let utf16le: Vec<u8> = vec![0xFF, 0xFE, b'h', 0, b'i', 0];
    assert_eq!(decode_repo_text(&utf16le), "hi");

    let utf16be: Vec<u8> = vec![0xFE, 0xFF, 0, b'h', 0, b'i'];
    assert_eq!(decode_repo_text(&utf16be), "hi");
}

#[test]
fn safe_relative_path_rejects_invalid_inputs() {
    assert!(safe_relative_path(".").is_ok());
    assert!(safe_relative_path("./src/lib.rs").is_ok());
    assert!(safe_relative_path("..").is_err());
    assert!(safe_relative_path("a/../../b").is_err());
}

#[test]
fn normalize_gitignore_entry_prepends_slash() {
    assert_eq!(normalize_gitignore_entry("foo").unwrap(), "/foo");
    assert_eq!(normalize_gitignore_entry("foo/bar").unwrap(), "/foo/bar");
}

#[test]
fn normalize_gitignore_entry_handles_backslash_and_crlf() {
    assert_eq!(normalize_gitignore_entry("a\\b\\c").unwrap(), "/a/b/c");
    assert!(normalize_gitignore_entry("bad\rpath").is_err());
}

#[test]
fn normalize_gitignore_entry_strips_dot_slash_prefix() {
    assert_eq!(normalize_gitignore_entry("./dir/file").unwrap(), "/dir/file");
    assert_eq!(normalize_gitignore_entry("./").unwrap(), "/");
}

#[test]
fn decodes_empty_and_bom_only_bytes() {
    assert_eq!(decode_repo_text(b""), "");
    let utf8_bom: Vec<u8> = vec![0xEF, 0xBB, 0xBF];
    assert_eq!(decode_repo_text(&utf8_bom), "\u{feff}");
}

#[test]
fn decodes_lossy_text_bytes() {
    let invalid: Vec<u8> = vec![0xFF, 0xFE, 0xFF, 0xFE, 0x00];
    let decoded = decode_repo_text(&invalid);
    assert!(!decoded.is_empty(), "should not panic on invalid encoding");
}

#[test]
fn inspects_text_metadata() {
    let meta = inspect_repo_file_meta(b"hello\r\nworld\r\n");
    assert_eq!(meta.encoding, "ASCII");
    assert_eq!(meta.line_ending, "CRLF");
    assert!(!meta.binary);
    assert!(!meta.bom);
}

#[test]
fn inspects_utf16_metadata() {
    let utf16le: Vec<u8> = vec![0xFF, 0xFE, b'h', 0, b'i', 0];
    let meta = inspect_repo_file_meta(&utf16le);
    assert_eq!(meta.encoding, "UTF-16LE");
    assert_eq!(meta.line_ending, "None");
    assert!(meta.bom);
    assert!(!meta.binary);
}

#[test]
fn inspects_binary_metadata() {
    let meta = inspect_repo_file_meta(&[0xFF, 0xFD, 0xFC]);
    assert_eq!(meta.encoding, "Binary");
    assert_eq!(meta.line_ending, "Binary");
    assert!(meta.binary);
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
            super::read_repo_file_text,
            super::read_repo_file_meta,
            super::open_repo_file,
        ])
        .build(mock_context(noop_assets()))
        .expect("build repo_files test app")
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
fn read_repo_file_text_fails_without_repo() {
    let app = build_app_no_repo();
    let wv = test_webview(&app);

    let body = tauri::ipc::InvokeBody::Json(serde_json::json!({"path": "README.md"}));
    let res = invoke_cmd(&wv, "read_repo_file_text", body);
    assert!(res.is_err(), "read_repo_file_text needs a repo: {:?}", res);
}

#[test]
fn read_repo_file_meta_fails_without_repo() {
    let app = build_app_no_repo();
    let wv = test_webview(&app);

    let body = tauri::ipc::InvokeBody::Json(serde_json::json!({"path": "README.md"}));
    let res = invoke_cmd(&wv, "read_repo_file_meta", body);
    assert!(res.is_err(), "read_repo_file_meta needs a repo: {:?}", res);
}

#[test]
fn open_repo_file_fails_without_repo() {
    let app = build_app_no_repo();
    let wv = test_webview(&app);

    let body = tauri::ipc::InvokeBody::Json(serde_json::json!({"path": "README.md"}));
    let res = invoke_cmd(&wv, "open_repo_file", body);
    assert!(res.is_err(), "open_repo_file needs a repo: {:?}", res);
}

#[test]
fn read_repo_file_text_fails_with_empty_path() {
    let app = build_app_no_repo();
    let wv = test_webview(&app);

    let body = tauri::ipc::InvokeBody::Json(serde_json::json!({"path": ""}));
    let res = invoke_cmd(&wv, "read_repo_file_text", body);
    assert!(res.is_err(), "empty path should fail: {:?}", res);
}

#[test]
fn read_repo_file_meta_fails_with_empty_path() {
    let app = build_app_no_repo();
    let wv = test_webview(&app);

    let body = tauri::ipc::InvokeBody::Json(serde_json::json!({"path": ""}));
    let res = invoke_cmd(&wv, "read_repo_file_meta", body);
    assert!(res.is_err(), "empty path should fail: {:?}", res);
}

#[test]
fn open_repo_file_fails_with_empty_path() {
    let app = build_app_no_repo();
    let wv = test_webview(&app);

    let body = tauri::ipc::InvokeBody::Json(serde_json::json!({"path": ""}));
    let res = invoke_cmd(&wv, "open_repo_file", body);
    assert!(res.is_err(), "empty path should fail: {:?}", res);
}
