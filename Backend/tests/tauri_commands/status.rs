// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use super::normalize_log_limit;
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
fn normalize_log_limit_defaults_to_100() {
    assert_eq!(normalize_log_limit(None), Some(100));
}

#[test]
fn normalize_log_limit_treats_zero_as_unlimited() {
    assert_eq!(normalize_log_limit(Some(0)), None);
}

#[test]
fn normalize_log_limit_clamps_large_values() {
    assert_eq!(normalize_log_limit(Some(2_000)), Some(1_000));
}

#[test]
fn normalize_log_limit_preserves_in_range_values() {
    assert_eq!(normalize_log_limit(Some(25)), Some(25));
    assert_eq!(normalize_log_limit(Some(1_000)), Some(1_000));
}

// ── Vcs-backed IPC command tests ──

struct TestVcs {
    id: BackendId,
    workdir: PathBuf,
    log_commits: Vec<models::CommitItem>,
    diff_lines: Vec<String>,
}

impl TestVcs {
    fn new(id: &str, workdir: PathBuf) -> Self {
        Self {
            id: BackendId::from(id),
            workdir,
            log_commits: vec![
                models::CommitItem {
                    id: "abc123".into(),
                    msg: "initial commit".into(),
                    meta: "2026-01-01".into(),
                    author: "test".into(),
                },
            ],
            diff_lines: vec!["@@ -1,3 +1,4 @@".into(), " line".into()],
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
    fn commit(&self, _message: &str, _name: &str, _email: &str, _paths: &[PathBuf]) -> Result<String, VcsError> { self.unsupported() }
    fn commit_index(&self, _message: &str, _name: &str, _email: &str) -> Result<String, VcsError> { self.unsupported() }
    fn status_payload(&self) -> Result<models::StatusPayload, VcsError> { self.unsupported() }

    fn log_commits(&self, _query: &models::LogQuery) -> Result<Vec<models::CommitItem>, VcsError> {
        Ok(self.log_commits.clone())
    }

    fn diff_file(&self, _path: &Path) -> Result<Vec<String>, VcsError> {
        Ok(self.diff_lines.clone())
    }

    fn diff_commit(&self, _rev: &str) -> Result<Vec<String>, VcsError> {
        Ok(self.diff_lines.clone())
    }

    fn stage_patch(&self, _patch: &str) -> Result<(), VcsError> { self.unsupported() }
    fn stage_paths(&self, _paths: &[PathBuf]) -> Result<(), VcsError> { self.unsupported() }
    fn discard_paths(&self, _paths: &[PathBuf]) -> Result<(), VcsError> { self.unsupported() }
    fn apply_reverse_patch(&self, _patch: &str) -> Result<(), VcsError> { self.unsupported() }
    fn delete_branch(&self, _name: &str, _force: bool) -> Result<(), VcsError> { self.unsupported() }
    fn rename_branch(&self, _old: &str, _new: &str) -> Result<(), VcsError> { self.unsupported() }
    fn merge_into_current(&self, _name: &str) -> Result<(), VcsError> { self.unsupported() }
    fn get_identity(&self) -> Result<Option<(String, String)>, VcsError> { self.unsupported() }
    fn set_identity_local(&self, _name: &str, _email: &str) -> Result<(), VcsError> { self.unsupported() }
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

fn build_vcs_status_app() -> (tauri::App<tauri::test::MockRuntime>, Arc<TestVcs>) {
    let vcs = Arc::new(TestVcs::new("test-vcs", tempfile::tempdir().unwrap().keep()));
    let repo = Arc::new(Repo::new(vcs.clone() as Arc<dyn Vcs>));
    let cfg = settings::AppConfig::default();
    let app_state = AppState::new_with_config(cfg);
    app_state.set_current_repo(repo);

    let app = mock_builder()
        .manage(app_state)
        .invoke_handler(tauri::generate_handler![
            super::vcs_log,
            super::vcs_diff_file,
            super::vcs_diff_commit,
            super::vcs_discard_paths,
            super::vcs_discard_patch,
            super::vcs_status,
        ])
        .build(mock_context(noop_assets()))
        .expect("build status test app");

    (app, vcs)
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
fn vcs_status_propagates_error() {
    register_test_backend("test-vcs");
    let (app, _) = build_vcs_status_app();
    let wv = test_webview(&app);

    let res = invoke_cmd(&wv, "vcs_status", tauri::ipc::InvokeBody::default());
    assert!(res.is_err(), "vcs_status should fail: status_payload returns Unsupported");
}

#[test]
fn vcs_log_returns_commits() {
    register_test_backend("test-vcs");
    let (app, _) = build_vcs_status_app();
    let wv = test_webview(&app);

    let body = tauri::ipc::InvokeBody::Json(serde_json::json!({"query": {"rev": "HEAD", "limit": 10}}));
    let res = invoke_cmd(&wv, "vcs_log", body);
    assert!(res.is_ok(), "vcs_log should succeed: {:?}", res);
}

#[test]
fn vcs_diff_file_returns_diff() {
    register_test_backend("test-vcs");
    let (app, _) = build_vcs_status_app();
    let wv = test_webview(&app);

    let body = tauri::ipc::InvokeBody::Json(serde_json::json!({"path": "src/main.rs"}));
    let res = invoke_cmd(&wv, "vcs_diff_file", body);
    assert!(res.is_ok(), "vcs_diff_file should succeed: {:?}", res);
}

#[test]
fn vcs_diff_commit_returns_diff() {
    register_test_backend("test-vcs");
    let (app, _) = build_vcs_status_app();
    let wv = test_webview(&app);

    let body = tauri::ipc::InvokeBody::Json(serde_json::json!({"id": "abc123"}));
    let res = invoke_cmd(&wv, "vcs_diff_commit", body);
    assert!(res.is_ok(), "vcs_diff_commit should succeed: {:?}", res);
}

#[test]
fn vcs_discard_paths_propagates_error() {
    register_test_backend("test-vcs");
    let (app, _) = build_vcs_status_app();
    let wv = test_webview(&app);

    let body = tauri::ipc::InvokeBody::Json(serde_json::json!({"paths": ["src/main.rs"]}));
    let res = invoke_cmd(&wv, "vcs_discard_paths", body);
    assert!(res.is_err(), "discard_paths should fail (unsupported)");
}

#[test]
fn vcs_discard_patch_propagates_error() {
    register_test_backend("test-vcs");
    let (app, _) = build_vcs_status_app();
    let wv = test_webview(&app);

    let body = tauri::ipc::InvokeBody::Json(serde_json::json!({"patch": "@@ -1 +1 @@\n-old\n+new\n"}));
    let res = invoke_cmd(&wv, "vcs_discard_patch", body);
    assert!(res.is_err(), "discard_patch should fail (unsupported)");
}
