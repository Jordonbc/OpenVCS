// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use super::{build_commit_message, has_commit_selection, trimmed_non_empty};
use crate::core::{BackendId, Vcs, VcsError, models};
use crate::plugin_vcs_backends::{self, PluginBackendDescriptor};
use crate::repo::Repo;
use crate::settings;
use crate::state::AppState;
use tauri::ipc::InvokeResponseBody;
use tauri::test::{get_ipc_response, mock_builder, mock_context, noop_assets, INVOKE_KEY};
use tauri::webview::InvokeRequest;
use tauri::WebviewWindowBuilder;

// ── Pure function tests ──

#[test]
fn builds_commit_messages_with_optional_descriptions() {
    assert_eq!(build_commit_message("Summary", ""), "Summary");
    assert_eq!(build_commit_message("Summary", "   "), "Summary");
    assert_eq!(
        build_commit_message("Summary", "Body text"),
        "Summary\n\nBody text"
    );
}

#[test]
fn detects_when_commit_selection_exists() {
    assert!(!has_commit_selection("", 0, 0));
    assert!(!has_commit_selection("   ", 0, 0));
    assert!(has_commit_selection("patch", 0, 0));
    assert!(has_commit_selection("", 1, 0));
    assert!(has_commit_selection("", 0, 1));
}

#[test]
fn trims_non_empty_inputs_or_reports_errors() {
    assert_eq!(trimmed_non_empty("  git  ", "bad").expect("trimmed"), "git");
    assert_eq!(trimmed_non_empty("git", "bad").expect("trimmed"), "git");
    assert_eq!(trimmed_non_empty("   ", "bad").expect_err("error"), "bad");
}

#[test]
fn preserves_multiline_commit_descriptions() {
    assert_eq!(
        build_commit_message("Summary", "Line one\nLine two"),
        "Summary\n\nLine one\nLine two"
    );
}

#[test]
fn reports_empty_commit_selection_only_when_all_inputs_are_empty() {
    assert!(!has_commit_selection("\n\t", 0, 0));
    assert!(has_commit_selection("", 0, 2));
}

#[test]
fn returns_the_supplied_error_for_blank_inputs() {
    assert_eq!(
        trimmed_non_empty(" \n ", "summary required").expect_err("blank"),
        "summary required"
    );
}

// ── Vcs-backed IPC command tests ──

struct TestVcs {
    id: BackendId,
    workdir: PathBuf,
    identity: Mutex<Option<(String, String)>>,
    commit_result: Mutex<Option<String>>,
}

impl TestVcs {
    fn new(id: &str, workdir: PathBuf) -> Self {
        Self {
            id: BackendId::from(id),
            workdir,
            identity: Mutex::new(None),
            commit_result: Mutex::new(None),
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
    fn create_branch(&self, _name: &str, _checkout: bool) -> Result<(), VcsError> { self.unsupported() }
    fn checkout_branch(&self, _name: &str) -> Result<(), VcsError> { self.unsupported() }
    fn ensure_remote(&self, _name: &str, _url: &str) -> Result<(), VcsError> { self.unsupported() }
    fn list_remotes(&self) -> Result<Vec<(String, String)>, VcsError> { self.unsupported() }
    fn remove_remote(&self, _name: &str) -> Result<(), VcsError> { self.unsupported() }
    fn fetch(&self, _remote: &str, _refspec: &str, _on: Option<models::OnEvent>) -> Result<(), VcsError> { self.unsupported() }
    fn push(&self, _remote: &str, _refspec: &str, _on: Option<models::OnEvent>) -> Result<(), VcsError> { self.unsupported() }
    fn pull_ff_only(&self, _remote: &str, _branch: &str, _on: Option<models::OnEvent>) -> Result<(), VcsError> { self.unsupported() }
    fn commit(&self, _message: &str, _name: &str, _email: &str, _paths: &[PathBuf]) -> Result<String, VcsError> {
        self.commit_result.lock().unwrap().clone().ok_or_else(|| VcsError::Unsupported(self.id.clone()))
    }
    fn commit_index(&self, _message: &str, _name: &str, _email: &str) -> Result<String, VcsError> {
        self.commit_result.lock().unwrap().clone().ok_or_else(|| VcsError::Unsupported(self.id.clone()))
    }
    fn status_payload(&self) -> Result<models::StatusPayload, VcsError> { self.unsupported() }
    fn log_commits(&self, _query: &models::LogQuery) -> Result<Vec<models::CommitItem>, VcsError> { self.unsupported() }
    fn diff_file(&self, _path: &Path) -> Result<models::DiffFileResult, VcsError> { self.unsupported() }
    fn diff_commit(&self, _rev: &str) -> Result<Vec<String>, VcsError> { self.unsupported() }
    fn stage_patch(&self, _patch: &str) -> Result<(), VcsError> { self.unsupported() }
    fn stage_paths(&self, _paths: &[PathBuf]) -> Result<(), VcsError> { self.unsupported() }
    fn discard_paths(&self, _paths: &[PathBuf]) -> Result<(), VcsError> { self.unsupported() }
    fn apply_reverse_patch(&self, _patch: &str) -> Result<(), VcsError> { self.unsupported() }
    fn delete_branch(&self, _name: &str, _force: bool) -> Result<(), VcsError> { self.unsupported() }
    fn rename_branch(&self, _old: &str, _new: &str) -> Result<(), VcsError> { self.unsupported() }
    fn merge_into_current(&self, _name: &str) -> Result<(), VcsError> { self.unsupported() }
    fn get_identity(&self) -> Result<Option<(String, String)>, VcsError> { Ok(self.identity.lock().unwrap().clone()) }
    fn set_identity_local(&self, _name: &str, _email: &str) -> Result<(), VcsError> { self.unsupported() }

    fn cherry_pick(&self, _rev: &str) -> Result<(), VcsError> { self.unsupported() }
    fn revert_commit(&self, _rev: &str, _no_edit: bool) -> Result<(), VcsError> { self.unsupported() }
}

fn register_test_backend(backend_id: &str) {
    let desc = PluginBackendDescriptor {
        backend_id: BackendId::from(backend_id),
        backend_name: Some("Test VCS".into()),
        action_labels: BTreeMap::new(),
        plugin_id: format!("test.{backend_id}"),
        plugin_name: Some("Test Plugin".into()),
    };
    plugin_vcs_backends::store_backends(vec![desc]);
}

fn build_app_with_repo() -> (tauri::App<tauri::test::MockRuntime>, Arc<TestVcs>) {
    crate::app_identity::setup_test_isolation();
    let vcs = Arc::new(TestVcs::new("test-vcs", tempfile::tempdir().unwrap().keep()));
    let repo = Arc::new(Repo::new(vcs.clone() as Arc<dyn Vcs>));
    let mut cfg = settings::AppConfig::default();
    cfg.plugins.enabled = vec!["test.test-vcs".into()];
    let app_state = AppState::new_with_config(cfg);
    app_state.set_current_repo(repo);

    let app = mock_builder()
        .manage(app_state)
        .invoke_handler(tauri::generate_handler![
            super::commit_changes,
            super::commit_selected,
            super::commit_patch,
            super::commit_patch_and_files,
            super::vcs_cherry_pick_to_branch,
            super::vcs_revert_commit,
        ])
        .build(mock_context(noop_assets()))
        .expect("build commit test app");

    (app, vcs)
}

fn build_app_no_repo() -> tauri::App<tauri::test::MockRuntime> {
    crate::app_identity::setup_test_isolation();
    let mut cfg = settings::AppConfig::default();
    cfg.plugins.enabled = vec!["test.test-vcs".into()];
    let app_state = AppState::new_with_config(cfg);
    mock_builder()
        .manage(app_state)
        .invoke_handler(tauri::generate_handler![
            super::commit_changes,
            super::commit_selected,
            super::commit_patch,
            super::commit_patch_and_files,
            super::vcs_cherry_pick_to_branch,
            super::vcs_revert_commit,
        ])
        .build(mock_context(noop_assets()))
        .expect("build commit test app")
}

fn test_webview(app: &tauri::App<tauri::test::MockRuntime>) -> tauri::WebviewWindow<tauri::test::MockRuntime> {
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
fn commit_changes_fails_without_repo() {
    let app = build_app_no_repo();
    let wv = test_webview(&app);

    let body = tauri::ipc::InvokeBody::Json(serde_json::json!({
        "summary": "test commit",
        "description": null,
    }));
    let res = invoke_cmd(&wv, "commit_changes", body);
    assert!(res.is_err(), "commit_changes needs a repo: {:?}", res);
}

#[test]
fn commit_selected_fails_without_repo() {
    let app = build_app_no_repo();
    let wv = test_webview(&app);

    let body = tauri::ipc::InvokeBody::Json(serde_json::json!({
        "summary": "test",
        "description": null,
        "files": [],
        "patch": "",
    }));
    let res = invoke_cmd(&wv, "commit_selected", body);
    assert!(res.is_err(), "commit_selected needs a repo: {:?}", res);
}

#[test]
fn commit_patch_fails_without_repo() {
    let app = build_app_no_repo();
    let wv = test_webview(&app);

    let body = tauri::ipc::InvokeBody::Json(serde_json::json!({
        "summary": "test",
        "description": null,
        "patch": "@@ -1 +1 @@\n-old\n+new\n",
    }));
    let res = invoke_cmd(&wv, "commit_patch", body);
    assert!(res.is_err(), "commit_patch needs a repo: {:?}", res);
}

#[test]
fn commit_patch_and_files_fails_without_repo() {
    let app = build_app_no_repo();
    let wv = test_webview(&app);

    let body = tauri::ipc::InvokeBody::Json(serde_json::json!({
        "summary": "test",
        "description": null,
        "patch": "",
        "files": [],
    }));
    let res = invoke_cmd(&wv, "commit_patch_and_files", body);
    assert!(res.is_err(), "commit_patch_and_files needs a repo: {:?}", res);
}

#[test]
fn vcs_cherry_pick_to_branch_fails_without_repo() {
    let app = build_app_no_repo();
    let wv = test_webview(&app);

    let body = tauri::ipc::InvokeBody::Json(serde_json::json!({
        "revision": "abc123",
        "target_branch": "main",
    }));
    let res = invoke_cmd(&wv, "vcs_cherry_pick_to_branch", body);
    assert!(res.is_err(), "cherry_pick needs a repo: {:?}", res);
}

#[test]
fn vcs_revert_commit_fails_without_repo() {
    let app = build_app_no_repo();
    let wv = test_webview(&app);

    let body = tauri::ipc::InvokeBody::Json(serde_json::json!({
        "revision": "abc123",
    }));
    let res = invoke_cmd(&wv, "vcs_revert_commit", body);
    assert!(res.is_err(), "revert needs a repo: {:?}", res);
}

#[test]
fn commit_changes_fails_with_empty_summary() {
    register_test_backend("test-vcs");
    let (app, _vcs) = build_app_with_repo();
    let wv = test_webview(&app);

    let body = tauri::ipc::InvokeBody::Json(serde_json::json!({
        "summary": "   ",
        "description": null,
    }));
    let res = invoke_cmd(&wv, "commit_changes", body);
    assert!(res.is_err(), "empty summary should fail: {:?}", res);
}

#[test]
fn commit_changes_fails_without_identity() {
    register_test_backend("test-vcs");
    let (app, _vcs) = build_app_with_repo();
    let wv = test_webview(&app);

    let body = tauri::ipc::InvokeBody::Json(serde_json::json!({
        "summary": "test commit",
        "description": null,
    }));
    let res = invoke_cmd(&wv, "commit_changes", body);
    assert!(res.is_err(), "no identity should fail: {:?}", res);
}

#[test]
fn commit_changes_fails_with_unsupported_commit() {
    register_test_backend("test-vcs");
    let (app, vcs) = build_app_with_repo();
    *vcs.identity.lock().unwrap() = Some(("Test User".into(), "test@example.com".into()));
    let wv = test_webview(&app);

    let body = tauri::ipc::InvokeBody::Json(serde_json::json!({
        "summary": "test commit",
        "description": "body text",
    }));
    let res = invoke_cmd(&wv, "commit_changes", body);
    assert!(res.is_err(), "unsupported commit should fail: {:?}", res);
}

#[test]
fn commit_changes_succeeds_with_valid_input() {
    register_test_backend("test-vcs");
    let (app, vcs) = build_app_with_repo();
    *vcs.identity.lock().unwrap() = Some(("Test User".into(), "test@example.com".into()));
    *vcs.commit_result.lock().unwrap() = Some("abc123def".into());
    let wv = test_webview(&app);

    let body = tauri::ipc::InvokeBody::Json(serde_json::json!({
        "summary": "test commit",
        "description": "",
    }));
    let res = invoke_cmd(&wv, "commit_changes", body);
    assert!(res.is_ok(), "commit_changes should succeed: {:?}", res);
    let commit_id: String = res.unwrap().deserialize().unwrap();
    assert_eq!(commit_id, "abc123def");
}
