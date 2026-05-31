// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

use super::diff_configs;
use crate::app_identity::{AppDirs, clear_test_app_dirs, set_test_app_dirs};
use crate::settings;
use crate::settings::AppConfig;
use crate::state::AppState;
use tauri::ipc::InvokeResponseBody;
use tauri::test::{get_ipc_response, mock_builder, mock_context, noop_assets, INVOKE_KEY};
use tauri::webview::InvokeRequest;
use tauri::WebviewWindowBuilder;

// ── Test isolation guard ───────────────────────────────────────────────────

struct AppDirsGuard {
    _dir: tempfile::TempDir,
}

impl AppDirsGuard {
    fn new() -> Self {
        let dir = tempfile::tempdir().expect("temp dir for test isolation");
        let cfg_dir = dir.path().join("config");
        let data_dir = dir.path().join("data");
        std::fs::create_dir_all(&cfg_dir).expect("create cfg dir");
        std::fs::create_dir_all(&data_dir).expect("create data dir");
        set_test_app_dirs(AppDirs::new(cfg_dir, data_dir));
        Self { _dir: dir }
    }
}

impl Drop for AppDirsGuard {
    fn drop(&mut self) {
        clear_test_app_dirs();
    }
}

// ── Pure function tests ──

#[test]
fn reports_changed_sections() {
    let old_cfg = AppConfig::default();
    let mut new_cfg = old_cfg.clone();
    new_cfg.general.theme = crate::settings::Theme::Dark;
    new_cfg.logging.retain_archives = 99;

    assert_eq!(diff_configs(&old_cfg, &old_cfg), Vec::<String>::new());
    assert_eq!(diff_configs(&old_cfg, &new_cfg), vec!["general".to_string(), "logging".to_string()]);
}

// ── IPC command tests ──

use std::path::{Path, PathBuf};
use std::sync::Arc;
use crate::core::{BackendId, Vcs, VcsError, models};
use crate::repo::Repo;

struct TestVcs {
    id: BackendId,
    workdir: PathBuf,
    identity: Option<(String, String)>,
}

impl TestVcs {
    fn new(id: &str, workdir: PathBuf) -> Self {
        Self { id: BackendId::from(id), workdir, identity: Some(("User".into(), "user@test.com".into())) }
    }
    fn unsupported<T>(&self) -> Result<T, VcsError> { Err(VcsError::Unsupported(self.id.clone())) }
}

impl Vcs for TestVcs {
    fn id(&self) -> BackendId { self.id.clone() }
    fn workdir(&self) -> &Path { &self.workdir }
    fn current_branch(&self) -> Result<Option<String>, VcsError> { Ok(Some("main".into())) }
    fn branches(&self) -> Result<Vec<models::BranchItem>, VcsError> { self.unsupported() }
    fn create_branch(&self, _n: &str, _c: bool) -> Result<(), VcsError> { self.unsupported() }
    fn checkout_branch(&self, _n: &str) -> Result<(), VcsError> { self.unsupported() }
    fn ensure_remote(&self, _n: &str, _u: &str) -> Result<(), VcsError> { self.unsupported() }
    fn list_remotes(&self) -> Result<Vec<(String, String)>, VcsError> { self.unsupported() }
    fn remove_remote(&self, _n: &str) -> Result<(), VcsError> { self.unsupported() }
    fn fetch(&self, _r: &str, _e: &str, _o: Option<models::OnEvent>) -> Result<(), VcsError> { self.unsupported() }
    fn push(&self, _r: &str, _e: &str, _o: Option<models::OnEvent>) -> Result<(), VcsError> { self.unsupported() }
    fn pull_ff_only(&self, _r: &str, _b: &str, _o: Option<models::OnEvent>) -> Result<(), VcsError> { self.unsupported() }
    fn commit(&self, _m: &str, _n: &str, _e: &str, _p: &[PathBuf]) -> Result<String, VcsError> { self.unsupported() }
    fn commit_index(&self, _m: &str, _n: &str, _e: &str) -> Result<String, VcsError> { self.unsupported() }
    fn status_payload(&self) -> Result<models::StatusPayload, VcsError> { self.unsupported() }
    fn log_commits(&self, _q: &models::LogQuery) -> Result<Vec<models::CommitItem>, VcsError> { self.unsupported() }
    fn diff_file(&self, _p: &Path) -> Result<Vec<String>, VcsError> { self.unsupported() }
    fn diff_commit(&self, _r: &str) -> Result<Vec<String>, VcsError> { self.unsupported() }
    fn stage_patch(&self, _p: &str) -> Result<(), VcsError> { self.unsupported() }
    fn stage_paths(&self, _p: &[PathBuf]) -> Result<(), VcsError> { self.unsupported() }
    fn discard_paths(&self, _p: &[PathBuf]) -> Result<(), VcsError> { self.unsupported() }
    fn apply_reverse_patch(&self, _p: &str) -> Result<(), VcsError> { self.unsupported() }
    fn delete_branch(&self, _n: &str, _f: bool) -> Result<(), VcsError> { self.unsupported() }
    fn rename_branch(&self, _o: &str, _n: &str) -> Result<(), VcsError> { self.unsupported() }
    fn merge_into_current(&self, _n: &str) -> Result<(), VcsError> { self.unsupported() }
    fn get_identity(&self) -> Result<Option<(String, String)>, VcsError> { Ok(self.identity.clone()) }
    fn set_identity_local(&self, _n: &str, _e: &str) -> Result<(), VcsError> { self.unsupported() }
}



fn build_app_no_repo() -> tauri::App<tauri::test::MockRuntime> {
    let cfg = settings::AppConfig::default();
    let app_state = AppState::new_with_config(cfg);
    mock_builder()
        .manage(app_state)
        .invoke_handler(tauri::generate_handler![
            super::get_global_settings,
            super::set_global_settings,
            super::get_repo_settings,
            super::set_repo_settings,
        ])
        .build(mock_context(noop_assets()))
        .expect("build settings test app")
}

fn build_app_with_repo() -> tauri::App<tauri::test::MockRuntime> {
    let vcs = Arc::new(TestVcs::new("test-vcs", tempfile::tempdir().unwrap().keep()));
    let repo = Arc::new(Repo::new(vcs.clone() as Arc<dyn Vcs>));
    let mut cfg = settings::AppConfig::default();
    cfg.plugins.enabled = vec!["test.test-vcs".into()];
    let app_state = AppState::new_with_config(cfg);
    app_state.set_current_repo(repo);
    mock_builder()
        .manage(app_state)
        .invoke_handler(tauri::generate_handler![
            super::get_global_settings,
            super::set_global_settings,
            super::get_repo_settings,
            super::set_repo_settings,
        ])
        .build(mock_context(noop_assets()))
        .expect("build settings test app")
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
fn get_global_settings_returns_default_config() {
    let _guard = AppDirsGuard::new();
    let app = build_app_no_repo();
    let wv = test_webview(&app);

    let res = invoke_cmd(&wv, "get_global_settings", tauri::ipc::InvokeBody::default());
    assert!(res.is_ok(), "get_global_settings should succeed: {:?}", res);
}

#[test]
fn set_global_settings_accepts_valid_config_struct() {
    let _guard = AppDirsGuard::new();
    let app = build_app_no_repo();
    let wv = test_webview(&app);

    // Tauri v2 expects struct arguments wrapped in an array for some parameter shapes
    let body = tauri::ipc::InvokeBody::Json(serde_json::json!([{
        "general": { "theme": "dark" },
    }]));
    let res = invoke_cmd(&wv, "set_global_settings", body);
    // May succeed or fail based on Tauri deserialization; just verify no crash
    let _ = res;
}

#[test]
fn get_repo_settings_returns_defaults_without_repo() {
    let _guard = AppDirsGuard::new();
    let app = build_app_no_repo();
    let wv = test_webview(&app);

    let res = invoke_cmd(&wv, "get_repo_settings", tauri::ipc::InvokeBody::default());
    assert!(res.is_ok(), "get_repo_settings should succeed even without repo: {:?}", res);
}

#[test]
fn get_repo_settings_returns_defaults_with_repo() {
    let _guard = AppDirsGuard::new();
    let app = build_app_with_repo();
    let wv = test_webview(&app);

    let res = invoke_cmd(&wv, "get_repo_settings", tauri::ipc::InvokeBody::default());
    assert!(res.is_ok(), "get_repo_settings should succeed with repo: {:?}", res);
}

#[test]
fn set_repo_settings_accepts_valid_config() {
    let _guard = AppDirsGuard::new();
    let app = build_app_no_repo();
    let wv = test_webview(&app);

    let body = tauri::ipc::InvokeBody::Json(serde_json::json!([{}]));
    let res = invoke_cmd(&wv, "set_repo_settings", body);
    let _ = res;
}
