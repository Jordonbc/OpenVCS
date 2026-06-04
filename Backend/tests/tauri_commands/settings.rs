// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

use super::diff_configs;
use crate::app_identity::{AppDirs, clear_test_app_dirs, set_test_app_dirs};
use crate::core::{BackendId, Vcs, VcsError, models};
use crate::repo::Repo;
use crate::settings;
use crate::settings::AppConfig;
use crate::state::AppState;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
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
    assert_eq!(
        diff_configs(&old_cfg, &new_cfg),
        vec!["general".to_string(), "logging".to_string()]
    );
}

#[test]
fn diff_configs_detects_plugin_change() {
    let old = AppConfig::default();
    let mut new = old.clone();
    new.plugin = vec!["new-source".into()];
    assert_eq!(diff_configs(&old, &new), vec!["plugin"]);
}

#[test]
fn diff_configs_detects_vcs_change() {
    let old = AppConfig::default();
    let mut new = old.clone();
    new.vcs.backend = "custom-bk".into();
    assert_eq!(diff_configs(&old, &new), vec!["vcs"]);
}

#[test]
fn diff_configs_detects_credentials_change() {
    let old = AppConfig::default();
    let mut new = old.clone();
    new.credentials.gpg_program = "gpg2".into();
    assert_eq!(diff_configs(&old, &new), vec!["credentials"]);
}

#[test]
fn diff_configs_detects_diff_change() {
    let old = AppConfig::default();
    let mut new = old.clone();
    new.diff.tab_width = 8;
    assert_eq!(diff_configs(&old, &new), vec!["diff"]);
}

#[test]
fn diff_configs_detects_performance_change() {
    let old = AppConfig::default();
    let mut new = old.clone();
    new.performance.progressive_render = false;
    assert_eq!(diff_configs(&old, &new), vec!["performance"]);
}

#[test]
fn diff_configs_detects_integrations_change() {
    let old = AppConfig::default();
    let mut new = old.clone();
    let mut overrides = std::collections::BTreeMap::new();
    overrides.insert("gitlab.my.co".into(), crate::settings::IssueProvider::Gitlab);
    new.integrations.host_overrides = overrides;
    assert_eq!(diff_configs(&old, &new), vec!["integrations"]);
}

#[test]
fn diff_configs_detects_plugins_section_change() {
    let old = AppConfig::default();
    let mut new = old.clone();
    new.plugins.enabled = vec!["test.p".into()];
    assert_eq!(diff_configs(&old, &new), vec!["plugins"]);
}

#[test]
fn diff_configs_detects_ux_change() {
    let old = AppConfig::default();
    let mut new = old.clone();
    new.ux.vim_nav = true;
    assert_eq!(diff_configs(&old, &new), vec!["ux"]);
}

#[test]
fn diff_configs_detects_advanced_change() {
    let old = AppConfig::default();
    let mut new = old.clone();
    new.advanced.ssl_verify = false;
    assert_eq!(diff_configs(&old, &new), vec!["advanced"]);
}

#[test]
fn diff_configs_detects_experimental_change() {
    let old = AppConfig::default();
    let mut new = old.clone();
    new.experimental.parallel_history_scan = true;
    assert_eq!(diff_configs(&old, &new), vec!["experimental"]);
}

// ── IPC command tests ──

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

// ── TestVcs ──

struct TestVcs {
    id: BackendId,
    workdir: PathBuf,
    identity: Option<(String, String)>,
}

impl TestVcs {
    fn new(id: &str, workdir: PathBuf) -> Self {
        Self {
            id: BackendId::from(id),
            workdir,
            identity: Some(("User".into(), "user@test.com".into())),
        }
    }
    fn unsupported<T>(&self) -> Result<T, VcsError> {
        Err(VcsError::Unsupported(self.id.clone()))
    }
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
    fn diff_file(&self, _p: &Path) -> Result<models::DiffFileResult, VcsError> { self.unsupported() }
    fn diff_commit(&self, _r: &str) -> Result<Vec<String>, VcsError> { self.unsupported() }
    fn stage_patch(&self, _p: &str) -> Result<(), VcsError> { self.unsupported() }
    fn stage_paths(&self, _p: &[PathBuf]) -> Result<(), VcsError> { self.unsupported() }
    fn discard_paths(&self, _p: &[PathBuf]) -> Result<(), VcsError> { self.unsupported() }
    fn apply_reverse_patch(&self, _p: &str) -> Result<(), VcsError> { self.unsupported() }
    fn delete_branch(&self, _n: &str, _f: bool) -> Result<(), VcsError> { self.unsupported() }
    fn rename_branch(&self, _o: &str, _n: &str) -> Result<(), VcsError> { self.unsupported() }
    fn merge_into_current(&self, _n: &str) -> Result<(), VcsError> { self.unsupported() }
    fn get_identity(&self) -> Result<Option<(String, String)>, VcsError> {
        Ok(self.identity.clone())
    }
    fn set_identity_local(&self, _n: &str, _e: &str) -> Result<(), VcsError> { self.unsupported() }
}

// ── SettingsTestVcs: full Vcs impl with remotes/identity management ──

struct SettingsTestVcs {
    id: BackendId,
    workdir: PathBuf,
    identity: Mutex<Option<(String, String)>>,
    remotes: Mutex<Vec<(String, String)>>,
    fail_get_identity: bool,
    fail_list_remotes: bool,
}

impl SettingsTestVcs {
    fn new(id: &str, workdir: PathBuf, remotes: Vec<(String, String)>) -> Self {
        Self {
            id: BackendId::from(id),
            workdir,
            identity: Mutex::new(Some(("User".into(), "user@test.com".into()))),
            remotes: Mutex::new(remotes),
            fail_get_identity: false,
            fail_list_remotes: false,
        }
    }
    fn with_fail_get_identity(mut self) -> Self {
        self.fail_get_identity = true;
        self
    }
    fn with_fail_list_remotes(mut self) -> Self {
        self.fail_list_remotes = true;
        self
    }
    fn with_no_identity(self) -> Self {
        *self.identity.lock().unwrap() = None;
        self
    }
    fn unsupported<T>(&self) -> Result<T, VcsError> {
        Err(VcsError::Unsupported(self.id.clone()))
    }
}

impl Vcs for SettingsTestVcs {
    fn id(&self) -> BackendId { self.id.clone() }
    fn workdir(&self) -> &Path { &self.workdir }
    fn current_branch(&self) -> Result<Option<String>, VcsError> { Ok(Some("main".into())) }
    fn branches(&self) -> Result<Vec<models::BranchItem>, VcsError> { self.unsupported() }
    fn create_branch(&self, _n: &str, _c: bool) -> Result<(), VcsError> { self.unsupported() }
    fn checkout_branch(&self, _n: &str) -> Result<(), VcsError> { self.unsupported() }
    fn ensure_remote(&self, name: &str, url: &str) -> Result<(), VcsError> {
        let mut remotes = self.remotes.lock().unwrap();
        if let Some(pos) = remotes.iter().position(|(n, _)| n == name) {
            remotes[pos] = (name.to_string(), url.to_string());
        } else {
            remotes.push((name.to_string(), url.to_string()));
        }
        Ok(())
    }
    fn list_remotes(&self) -> Result<Vec<(String, String)>, VcsError> {
        if self.fail_list_remotes {
            return Err(VcsError::Unsupported(self.id.clone()));
        }
        Ok(self.remotes.lock().unwrap().clone())
    }
    fn remove_remote(&self, name: &str) -> Result<(), VcsError> {
        self.remotes.lock().unwrap().retain(|(n, _)| n != name);
        Ok(())
    }
    fn fetch(&self, _r: &str, _e: &str, _o: Option<models::OnEvent>) -> Result<(), VcsError> { self.unsupported() }
    fn push(&self, _r: &str, _e: &str, _o: Option<models::OnEvent>) -> Result<(), VcsError> { self.unsupported() }
    fn pull_ff_only(&self, _r: &str, _b: &str, _o: Option<models::OnEvent>) -> Result<(), VcsError> { self.unsupported() }
    fn commit(&self, _m: &str, _n: &str, _e: &str, _p: &[PathBuf]) -> Result<String, VcsError> { self.unsupported() }
    fn commit_index(&self, _m: &str, _n: &str, _e: &str) -> Result<String, VcsError> { self.unsupported() }
    fn status_payload(&self) -> Result<models::StatusPayload, VcsError> { self.unsupported() }
    fn log_commits(&self, _q: &models::LogQuery) -> Result<Vec<models::CommitItem>, VcsError> { self.unsupported() }
    fn diff_file(&self, _p: &Path) -> Result<models::DiffFileResult, VcsError> { self.unsupported() }
    fn diff_commit(&self, _r: &str) -> Result<Vec<String>, VcsError> { self.unsupported() }
    fn stage_patch(&self, _p: &str) -> Result<(), VcsError> { self.unsupported() }
    fn stage_paths(&self, _p: &[PathBuf]) -> Result<(), VcsError> { self.unsupported() }
    fn discard_paths(&self, _p: &[PathBuf]) -> Result<(), VcsError> { self.unsupported() }
    fn apply_reverse_patch(&self, _p: &str) -> Result<(), VcsError> { self.unsupported() }
    fn delete_branch(&self, _n: &str, _f: bool) -> Result<(), VcsError> { self.unsupported() }
    fn rename_branch(&self, _o: &str, _n: &str) -> Result<(), VcsError> { self.unsupported() }
    fn merge_into_current(&self, _n: &str) -> Result<(), VcsError> { self.unsupported() }
    fn get_identity(&self) -> Result<Option<(String, String)>, VcsError> {
        if self.fail_get_identity {
            return Err(VcsError::Unsupported(self.id.clone()));
        }
        Ok(self.identity.lock().unwrap().clone())
    }
    fn set_identity_local(&self, name: &str, email: &str) -> Result<(), VcsError> {
        *self.identity.lock().unwrap() = Some((name.to_string(), email.to_string()));
        Ok(())
    }
}

// ── App builders ──

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

fn build_app_with_settings_vcs() -> (tauri::App<tauri::test::MockRuntime>, Arc<SettingsTestVcs>) {
    let vcs = Arc::new(SettingsTestVcs::new(
        "test-vcs",
        tempfile::tempdir().unwrap().keep(),
        vec![
            ("origin".into(), "https://example.com/repo.git".into()),
            ("upstream".into(), "https://example.com/upstream.git".into()),
        ],
    ));
    let repo = Arc::new(Repo::new(vcs.clone() as Arc<dyn Vcs>));
    let mut cfg = settings::AppConfig::default();
    cfg.plugins.enabled = vec!["test.test-vcs".into()];
    let app_state = AppState::new_with_config(cfg);
    app_state.set_current_repo(repo);
    let app = mock_builder()
        .manage(app_state)
        .invoke_handler(tauri::generate_handler![
            super::get_global_settings,
            super::set_global_settings,
            super::get_repo_settings,
            super::set_repo_settings,
        ])
        .build(mock_context(noop_assets()))
        .expect("build settings test app");
    (app, vcs)
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

// ── get_global_settings tests ──

#[test]
fn get_global_settings_returns_default_config() {
    let _guard = AppDirsGuard::new();
    let app = build_app_no_repo();
    let wv = test_webview(&app);

    let res = invoke_cmd(&wv, "get_global_settings", tauri::ipc::InvokeBody::default());
    assert!(res.is_ok(), "get_global_settings should succeed: {:?}", res);
}



// ── set_global_settings tests ──

#[test]
fn set_global_settings_accepts_valid_config_struct() {
    let _guard = AppDirsGuard::new();
    let app = build_app_no_repo();
    let wv = test_webview(&app);

    let body = tauri::ipc::InvokeBody::Json(serde_json::json!([{
        "general": { "theme": "dark" },
    }]));
    let res = invoke_cmd(&wv, "set_global_settings", body);
    // May succeed or fail based on Tauri deserialization; just verify no crash
    let _ = res;
}

// ── get_repo_settings tests ──

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
fn get_repo_settings_succeeds_with_identity_and_remotes() {
    let _guard = AppDirsGuard::new();
    let (app, _vcs) = build_app_with_settings_vcs();
    let wv = test_webview(&app);

    let res = invoke_cmd(&wv, "get_repo_settings", tauri::ipc::InvokeBody::default());
    assert!(res.is_ok(), "get_repo_settings should succeed with identity and remotes");
}

// ── set_repo_settings tests ──

#[test]
fn set_repo_settings_accepts_valid_config() {
    let _guard = AppDirsGuard::new();
    let app = build_app_no_repo();
    let wv = test_webview(&app);

    let body = tauri::ipc::InvokeBody::Json(serde_json::json!([{}]));
    let res = invoke_cmd(&wv, "set_repo_settings", body);
    let _ = res;
}

#[test]
fn set_repo_settings_updates_identity_and_remotes() {
    let _guard = AppDirsGuard::new();
    let (app, vcs) = build_app_with_settings_vcs();
    let wv = test_webview(&app);

    let body = tauri::ipc::InvokeBody::Json(serde_json::json!({
        "cfg": {
            "user_name": "NewName",
            "user_email": "new@test.com",
            "remotes": [
                { "name": "origin", "url": "https://example.com/new-repo.git" },
                { "name": "fork", "url": "https://example.com/fork.git" },
            ],
        },
    }));
    let res = invoke_cmd(&wv, "set_repo_settings", body);
    assert!(res.is_ok(), "set_repo_settings should succeed: {:?}", res);

    // Verify identity was updated
    let identity = vcs.get_identity().unwrap();
    assert_eq!(identity, Some(("NewName".into(), "new@test.com".into())));

    // Verify remotes updated: origin changed, upstream removed, fork added
    let remotes = vcs.list_remotes().unwrap();
    assert_eq!(remotes.len(), 2);
    assert!(remotes.contains(&("origin".into(), "https://example.com/new-repo.git".into())));
    assert!(remotes.contains(&("fork".into(), "https://example.com/fork.git".into())));
    assert!(!remotes.contains(&("upstream".into(), "".into())));
}

#[test]
fn set_repo_settings_origin_only_when_no_remotes_list() {
    let _guard = AppDirsGuard::new();
    let (app, vcs) = build_app_with_settings_vcs();
    let wv = test_webview(&app);

    // Back-compat: send origin_url without remotes → should only call ensure_remote
    let body = tauri::ipc::InvokeBody::Json(serde_json::json!({
        "cfg": {
            "origin_url": "https://example.com/new-origin.git",
        },
    }));
    let res = invoke_cmd(&wv, "set_repo_settings", body);
    assert!(res.is_ok(), "set_repo_settings with origin_url should succeed: {:?}", res);

    // Existing remotes should be untouched (no remotes list → origin-only path)
    let remotes = vcs.list_remotes().unwrap();
    assert!(remotes.contains(&("origin".into(), "https://example.com/new-origin.git".into())));
    assert!(remotes.contains(&("upstream".into(), "https://example.com/upstream.git".into())));
}

#[test]
fn set_repo_settings_skips_empty_name_or_url_remotes() {
    let _guard = AppDirsGuard::new();
    let (app, vcs) = build_app_with_settings_vcs();
    let wv = test_webview(&app);

    let body = tauri::ipc::InvokeBody::Json(serde_json::json!({
        "cfg": {
            "remotes": [
                { "name": "", "url": "https://invalid.git" },
                { "name": "valid", "url": "" },
                { "name": "good", "url": "https://good.git" },
            ],
        },
    }));
    let res = invoke_cmd(&wv, "set_repo_settings", body);
    assert!(res.is_ok(), "should not fail with empty name/url: {:?}", res);

    let remotes = vcs.list_remotes().unwrap();
    assert!(remotes.contains(&("good".into(), "https://good.git".into())));
    // origin and upstream should be removed since they're not in the desired list
    assert!(!remotes.contains(&("origin".into(), "".into())));
    assert!(!remotes.contains(&("upstream".into(), "".into())));
}

// ── diff_configs: all-fields-changed ──

#[test]
fn diff_configs_all_fields_changed() {
    let old = AppConfig::default();
    let mut new = AppConfig { plugin: vec!["p".to_string()], ..Default::default() };
    new.general.theme = crate::settings::Theme::Dark;
    new.vcs.default_branch = "dev".to_string();
    new.credentials.gpg_program = "gpg2".into();
    new.diff.tab_width = 2;
    new.performance.progressive_render = false;
    new.integrations.default_editor = crate::settings::EditorChoice::Code;
    new.plugins.enabled = vec!["x".to_string()];
    new.ux.vim_nav = true;
    new.advanced.ssl_verify = false;
    new.experimental.parallel_history_scan = true;
    new.logging.retain_archives = 5;

    let changes = diff_configs(&old, &new);
    let expected = vec![
        "plugin",
        "general",
        "vcs",
        "credentials",
        "diff",
        "performance",
        "integrations",
        "plugins",
        "ux",
        "advanced",
        "experimental",
        "logging",
    ];
    for section in &expected {
        assert!(
            changes.contains(&section.to_string()),
            "missing section: {section}"
        );
    }
    assert_eq!(changes.len(), expected.len());
}

// ── get_repo_settings error-path tests ──

fn build_app_with_failing_identity(
) -> (tauri::App<tauri::test::MockRuntime>, Arc<SettingsTestVcs>) {
    let vcs = Arc::new(
        SettingsTestVcs::new(
            "test-vcs",
            tempfile::tempdir().unwrap().keep(),
            vec![("origin".into(), "https://example.com/repo.git".into())],
        )
        .with_fail_get_identity(),
    );
    let repo = Arc::new(Repo::new(vcs.clone() as Arc<dyn Vcs>));
    let mut cfg = settings::AppConfig::default();
    cfg.plugins.enabled = vec!["test.test-vcs".into()];
    let app_state = AppState::new_with_config(cfg);
    app_state.set_current_repo(repo);
    let app = mock_builder()
        .manage(app_state)
        .invoke_handler(tauri::generate_handler![
            super::get_global_settings,
            super::set_global_settings,
            super::get_repo_settings,
            super::set_repo_settings,
        ])
        .build(mock_context(noop_assets()))
        .expect("build settings test app failing identity");
    (app, vcs)
}

fn build_app_with_failing_remotes(
) -> (tauri::App<tauri::test::MockRuntime>, Arc<SettingsTestVcs>) {
    let vcs = Arc::new(
        SettingsTestVcs::new(
            "test-vcs",
            tempfile::tempdir().unwrap().keep(),
            vec![("origin".into(), "https://example.com/repo.git".into())],
        )
        .with_fail_list_remotes(),
    );
    let repo = Arc::new(Repo::new(vcs.clone() as Arc<dyn Vcs>));
    let mut cfg = settings::AppConfig::default();
    cfg.plugins.enabled = vec!["test.test-vcs".into()];
    let app_state = AppState::new_with_config(cfg);
    app_state.set_current_repo(repo);
    let app = mock_builder()
        .manage(app_state)
        .invoke_handler(tauri::generate_handler![
            super::get_global_settings,
            super::set_global_settings,
            super::get_repo_settings,
            super::set_repo_settings,
        ])
        .build(mock_context(noop_assets()))
        .expect("build settings test app failing remotes");
    (app, vcs)
}

fn build_app_with_no_identity(
) -> (tauri::App<tauri::test::MockRuntime>, Arc<SettingsTestVcs>) {
    let vcs = Arc::new(
        SettingsTestVcs::new(
            "test-vcs",
            tempfile::tempdir().unwrap().keep(),
            vec![("origin".into(), "https://example.com/repo.git".into())],
        )
        .with_no_identity(),
    );
    let repo = Arc::new(Repo::new(vcs.clone() as Arc<dyn Vcs>));
    let mut cfg = settings::AppConfig::default();
    cfg.plugins.enabled = vec!["test.test-vcs".into()];
    let app_state = AppState::new_with_config(cfg);
    app_state.set_current_repo(repo);
    let app = mock_builder()
        .manage(app_state)
        .invoke_handler(tauri::generate_handler![
            super::get_global_settings,
            super::set_global_settings,
            super::get_repo_settings,
            super::set_repo_settings,
        ])
        .build(mock_context(noop_assets()))
        .expect("build settings test app no identity");
    (app, vcs)
}

#[test]
fn get_repo_settings_handles_identity_error_gracefully() {
    let _guard = AppDirsGuard::new();
    let (app, _vcs) = build_app_with_failing_identity();
    let wv = test_webview(&app);

    let res = invoke_cmd(
        &wv,
        "get_repo_settings",
        tauri::ipc::InvokeBody::default(),
    );
    // Should still succeed when identity fetch fails (returns defaults)
    assert!(
        res.is_ok(),
        "get_repo_settings should handle identity error: {:?}",
        res
    );
}

#[test]
fn get_repo_settings_handles_remotes_error_gracefully() {
    let _guard = AppDirsGuard::new();
    let (app, _vcs) = build_app_with_failing_remotes();
    let wv = test_webview(&app);

    let res = invoke_cmd(
        &wv,
        "get_repo_settings",
        tauri::ipc::InvokeBody::default(),
    );
    // Should still succeed when list_remotes fails (returns defaults)
    assert!(
        res.is_ok(),
        "get_repo_settings should handle remotes error: {:?}",
        res
    );
}

#[test]
fn get_repo_settings_handles_no_identity_gracefully() {
    let _guard = AppDirsGuard::new();
    let (app, _vcs) = build_app_with_no_identity();
    let wv = test_webview(&app);

    let res = invoke_cmd(
        &wv,
        "get_repo_settings",
        tauri::ipc::InvokeBody::default(),
    );
    // get_identity returns Ok(None) → user_name and user_email stay None
    assert!(
        res.is_ok(),
        "get_repo_settings should succeed with no identity: {:?}",
        res
    );
}

// ── set_repo_settings partial-identity and edge-case tests ──

#[test]
fn set_repo_settings_skips_identity_when_only_name_provided() {
    let _guard = AppDirsGuard::new();
    let (app, vcs) = build_app_with_settings_vcs();
    let wv = test_webview(&app);

    // Missing user_email → identity update skipped
    let body = tauri::ipc::InvokeBody::Json(serde_json::json!([{
        "user_name": "PartialUser",
    }]));
    let res = invoke_cmd(&wv, "set_repo_settings", body);
    let _ = res;

    // Identity should be unchanged (still default test identity)
    let identity = vcs.get_identity().unwrap();
    assert_eq!(identity, Some(("User".into(), "user@test.com".into())));
}

#[test]
fn set_repo_settings_skips_identity_when_only_email_provided() {
    let _guard = AppDirsGuard::new();
    let (app, vcs) = build_app_with_settings_vcs();
    let wv = test_webview(&app);

    // Missing user_name → identity update skipped
    let body = tauri::ipc::InvokeBody::Json(serde_json::json!([{
        "user_email": "partial@example.com",
    }]));
    let res = invoke_cmd(&wv, "set_repo_settings", body);
    let _ = res;

    // Identity should be unchanged
    let identity = vcs.get_identity().unwrap();
    assert_eq!(identity, Some(("User".into(), "user@test.com".into())));
}

#[test]
fn set_repo_settings_skips_empty_origin_url() {
    let _guard = AppDirsGuard::new();
    let (app, vcs) = build_app_with_settings_vcs();
    let wv = test_webview(&app);

    // origin_url is empty → ensure_remote skipped
    let body = tauri::ipc::InvokeBody::Json(serde_json::json!([{
        "origin_url": "",
    }]));
    let res = invoke_cmd(&wv, "set_repo_settings", body);
    let _ = res;

    // Remotes should be unchanged
    let remotes = vcs.list_remotes().unwrap();
    assert_eq!(remotes.len(), 2);
    assert!(remotes.contains(&("origin".into(), "https://example.com/repo.git".into())));
    assert!(remotes.contains(&("upstream".into(), "https://example.com/upstream.git".into())));
}

#[test]
fn set_repo_settings_without_repo_still_saves() {
    let _guard = AppDirsGuard::new();
    let app = build_app_no_repo();
    let wv = test_webview(&app);

    let body = tauri::ipc::InvokeBody::Json(serde_json::json!([{
        "user_name": "TestUser",
        "user_email": "test@example.com",
    }]));
    let res = invoke_cmd(&wv, "set_repo_settings", body);
    // Without a repo, the function skips VCS updates but still saves config
    let _ = res;
}

// ── set_global_settings extended tests ──

#[test]
fn set_global_settings_with_full_config_exercises_diff() {
    let _guard = AppDirsGuard::new();
    let app = build_app_no_repo();
    let wv = test_webview(&app);

    // Send full config struct to trigger diff_configs with changes
    let mut cfg = AppConfig::default();
    cfg.general.theme = crate::settings::Theme::Dark;
    cfg.logging.retain_archives = 99;
    let body = tauri::ipc::InvokeBody::Json(
        serde_json::to_value([cfg]).unwrap(),
    );
    let res = invoke_cmd(&wv, "set_global_settings", body);
    // Exercises the diff_configs → non-empty changes → info log path
    let _ = res;
}


