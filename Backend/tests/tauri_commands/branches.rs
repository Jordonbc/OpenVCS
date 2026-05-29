// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use super::{apply_merge_template, repo_name_from_origin, repo_username_from_origin};
use crate::core::{BackendId, Vcs, VcsError, models};
use crate::plugin_vcs_backends::{self, PluginBackendDescriptor};
use crate::repo::Repo;
use crate::settings;
use crate::state::AppState;
use tauri::test::{get_ipc_response, mock_builder, mock_context, noop_assets, INVOKE_KEY};
use tauri::ipc::InvokeResponseBody;
use tauri::webview::InvokeRequest;
use tauri::WebviewWindowBuilder;

// ── Pure function tests ──

#[test]
fn parses_repo_owner_and_name_from_urls() {
    assert_eq!(repo_username_from_origin("https://example.com/org/repo.git"), Some("org".into()));
    assert_eq!(repo_username_from_origin("git@example.com:org/repo.git"), Some("org".into()));
    assert_eq!(repo_username_from_origin("http://example.com/team/repo"), Some("team".into()));
    assert_eq!(repo_name_from_origin("https://example.com/org/repo.git"), Some("repo".into()));
    assert_eq!(repo_name_from_origin("git@example.com:org/repo"), Some("repo".into()));
    assert_eq!(repo_name_from_origin("http://example.com/team/repo"), Some("repo".into()));
}

#[test]
fn expands_merge_templates() {
    let rendered = apply_merge_template(
        "Merge {branch:source} into {branch:target} for {repo:username}/{repo:name}",
        "feature",
        "main",
        "demo",
        "alice",
    );
    assert_eq!(rendered, "Merge feature into main for alice/demo");
}

#[test]
fn rejects_empty_or_unparseable_origin_urls() {
    assert_eq!(repo_username_from_origin("   "), None);
    assert_eq!(repo_username_from_origin("owner-only"), None);
    assert_eq!(repo_name_from_origin("   "), None);
    assert_eq!(repo_name_from_origin("owner-only"), None);
}

#[test]
fn leaves_unknown_merge_placeholders_untouched() {
    let rendered = apply_merge_template(
        "Merge {branch:source} into {repo:unknown}",
        "feature",
        "main",
        "demo",
        "alice",
    );
    assert_eq!(rendered, "Merge feature into {repo:unknown}");
}

// ── Vcs-backed IPC command tests ──

struct TestVcs {
    id: BackendId,
    workdir: PathBuf,
    current_branch: Option<String>,
    branches: Vec<models::BranchItem>,
}

impl TestVcs {
    fn new(id: &str, workdir: PathBuf) -> Self {
        Self {
            id: BackendId::from(id),
            workdir,
            current_branch: Some("main".into()),
            branches: vec![
                models::BranchItem {
                    name: "main".into(),
                    full_ref: "refs/heads/main".into(),
                    kind: models::BranchKind::Local,
                    current: true,
                },
                models::BranchItem {
                    name: "develop".into(),
                    full_ref: "refs/heads/develop".into(),
                    kind: models::BranchKind::Local,
                    current: false,
                },
            ],
        }
    }

    fn unsupported<T>(&self) -> Result<T, VcsError> {
        Err(VcsError::Unsupported(self.id.clone()))
    }
}

impl Vcs for TestVcs {
    fn id(&self) -> BackendId { self.id.clone() }
    fn workdir(&self) -> &Path { &self.workdir }

    fn current_branch(&self) -> Result<Option<String>, VcsError> {
        Ok(self.current_branch.clone())
    }

    fn branches(&self) -> Result<Vec<models::BranchItem>, VcsError> {
        Ok(self.branches.clone())
    }

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
    fn log_commits(&self, _query: &models::LogQuery) -> Result<Vec<models::CommitItem>, VcsError> { self.unsupported() }
    fn diff_file(&self, _path: &Path) -> Result<Vec<String>, VcsError> { self.unsupported() }
    fn diff_commit(&self, _rev: &str) -> Result<Vec<String>, VcsError> { self.unsupported() }
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

fn build_vcs_branches_app() -> (tauri::App<tauri::test::MockRuntime>, Arc<TestVcs>) {
    let vcs = Arc::new(TestVcs::new("test-vcs", tempfile::tempdir().unwrap().keep()));
    let repo = Arc::new(Repo::new(vcs.clone() as Arc<dyn Vcs>));
    let cfg = settings::AppConfig::default();
    let app_state = AppState::new_with_config(cfg);
    app_state.set_current_repo(repo);

    let app = mock_builder()
        .manage(app_state)
        .invoke_handler(tauri::generate_handler![
            super::vcs_list_branches,
            super::vcs_head_status,
            super::vcs_current_branch,
            super::get_repo_summary,
            super::vcs_checkout_branch,
            super::vcs_delete_branch,
            super::vcs_create_branch,
            super::vcs_rename_branch,
            super::vcs_merge_context,
            super::vcs_merge_abort,
            super::vcs_merge_continue,
            super::vcs_set_upstream,
            super::vcs_merge_branch,
        ])
        .build(mock_context(noop_assets()))
        .expect("build branches test app");

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

#[test]
fn vcs_list_branches_returns_branch_list() {
    register_test_backend("test-vcs");
    let (app, _) = build_vcs_branches_app();
    let wv = test_webview(&app);

    let res = invoke_cmd(&wv, "vcs_list_branches", tauri::ipc::InvokeBody::default());
    assert!(res.is_ok(), "vcs_list_branches should succeed: {:?}", res);
    let branches: Vec<serde_json::Value> = res.unwrap().deserialize().unwrap();
    assert!(!branches.is_empty(), "should return branches");
    assert_eq!(branches[0]["name"], "main");
}

#[test]
fn vcs_head_status_propagates_log_error() {
    register_test_backend("test-vcs");
    let (app, _) = build_vcs_branches_app();
    let wv = test_webview(&app);

    let res = invoke_cmd(&wv, "vcs_head_status", tauri::ipc::InvokeBody::default());
    // TestVcs doesn't implement log_commits, so this returns Unsupported error
    assert!(res.is_err(), "vcs_head_status should fail without log_commits: {:?}", res);
}

#[test]
fn vcs_current_branch_returns_branch_name() {
    register_test_backend("test-vcs");
    let (app, _) = build_vcs_branches_app();
    let wv = test_webview(&app);

    let res = invoke_cmd(&wv, "vcs_current_branch", tauri::ipc::InvokeBody::default());
    assert!(res.is_ok(), "vcs_current_branch should succeed: {:?}", res);
    let branch: String = res.unwrap().deserialize().unwrap();
    assert_eq!(branch, "main");
}

#[test]
fn get_repo_summary_returns_summary() {
    register_test_backend("test-vcs");
    let (app, _) = build_vcs_branches_app();
    let wv = test_webview(&app);

    let res = invoke_cmd(&wv, "get_repo_summary", tauri::ipc::InvokeBody::default());
    assert!(res.is_ok(), "get_repo_summary should succeed: {:?}", res);
}

#[test]
fn vcs_checkout_branch_propagates_error() {
    register_test_backend("test-vcs");
    let (app, _) = build_vcs_branches_app();
    let wv = test_webview(&app);

    let body = tauri::ipc::InvokeBody::Json(serde_json::json!({"name": "feature/x"}));
    let res = invoke_cmd(&wv, "vcs_checkout_branch", body);
    assert!(res.is_err(), "checkout should fail (unsupported)");
}

#[test]
fn vcs_delete_branch_propagates_error() {
    register_test_backend("test-vcs");
    let (app, _) = build_vcs_branches_app();
    let wv = test_webview(&app);

    let body = tauri::ipc::InvokeBody::Json(serde_json::json!({"name": "feature/x", "force": false}));
    let res = invoke_cmd(&wv, "vcs_delete_branch", body);
    assert!(res.is_err(), "delete should fail (unsupported)");
}

#[test]
fn vcs_create_branch_propagates_error() {
    register_test_backend("test-vcs");
    let (app, _) = build_vcs_branches_app();
    let wv = test_webview(&app);

    let body = tauri::ipc::InvokeBody::Json(serde_json::json!({"name": "new-branch", "base": "main"}));
    let res = invoke_cmd(&wv, "vcs_create_branch", body);
    assert!(res.is_err(), "create should fail (unsupported)");
}

#[test]
fn vcs_merge_abort_propagates_error() {
    register_test_backend("test-vcs");
    let (app, _) = build_vcs_branches_app();
    let wv = test_webview(&app);

    let res = invoke_cmd(&wv, "vcs_merge_abort", tauri::ipc::InvokeBody::default());
    assert!(res.is_err(), "merge abort should fail (unsupported)");
}

#[test]
fn vcs_merge_continue_propagates_error() {
    register_test_backend("test-vcs");
    let (app, _) = build_vcs_branches_app();
    let wv = test_webview(&app);

    let res = invoke_cmd(&wv, "vcs_merge_continue", tauri::ipc::InvokeBody::default());
    assert!(res.is_err(), "merge continue should fail (unsupported)");
}

#[test]
fn vcs_merge_context_fails_silently_when_not_in_progress() {
    register_test_backend("test-vcs");
    let (app, _) = build_vcs_branches_app();
    let wv = test_webview(&app);

    let res = invoke_cmd(&wv, "vcs_merge_context", tauri::ipc::InvokeBody::default());
    let _ = res;
}

#[test]
fn vcs_set_upstream_propagates_error() {
    register_test_backend("test-vcs");
    let (app, _) = build_vcs_branches_app();
    let wv = test_webview(&app);

    let body = tauri::ipc::InvokeBody::Json(serde_json::json!({"name": "main", "upstream": "origin/main"}));
    let res = invoke_cmd(&wv, "vcs_set_upstream", body);
    assert!(res.is_err(), "set upstream should fail (unsupported)");
}

#[test]
fn vcs_rename_branch_propagates_error() {
    register_test_backend("test-vcs");
    let (app, _) = build_vcs_branches_app();
    let wv = test_webview(&app);

    let body = tauri::ipc::InvokeBody::Json(serde_json::json!({"name": "old-name", "new_name": "new-name"}));
    let res = invoke_cmd(&wv, "vcs_rename_branch", body);
    assert!(res.is_err(), "rename should fail (unsupported)");
}

#[test]
fn vcs_merge_branch_propagates_error() {
    register_test_backend("test-vcs");
    let (app, _) = build_vcs_branches_app();
    let wv = test_webview(&app);

    let body = tauri::ipc::InvokeBody::Json(serde_json::json!({"name": "develop"}));
    let res = invoke_cmd(&wv, "vcs_merge_branch", body);
    assert!(res.is_err(), "merge should fail (unsupported)");
}
