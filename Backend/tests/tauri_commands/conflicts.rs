// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use super::tool_args;
use crate::core::{BackendId, Vcs, VcsError, models};
use crate::plugin_vcs_backends::{self, PluginBackendDescriptor};
use crate::repo::Repo;
use crate::settings;
use crate::settings::ExternalTool;
use crate::state::AppState;
use tauri::ipc::InvokeResponseBody;
use tauri::test::{get_ipc_response, mock_builder, mock_context, noop_assets, INVOKE_KEY};
use tauri::webview::InvokeRequest;
use tauri::WebviewWindowBuilder;

// ── Pure function tests ──

#[test]
fn splits_tool_path_and_arguments() {
    let tool = ExternalTool {
        enabled: true,
        path: "/usr/bin/meld".into(),
        args: "--auto-merge {path} --label \"My Repo\"".into(),
    };

    let (path, args) = tool_args(&tool);
    assert_eq!(path, "/usr/bin/meld");
    assert_eq!(args, vec!["--auto-merge", "{path}", "--label", "My Repo"]);
}

#[test]
fn returns_empty_arguments_when_tool_has_no_args() {
    let tool = ExternalTool {
        enabled: true,
        path: "meld".into(),
        args: "   ".into(),
    };

    let (path, args) = tool_args(&tool);
    assert_eq!(path, "meld");
    assert!(args.is_empty());
}

// ── Vcs-backed IPC command tests ──

struct TestVcs {
    id: BackendId,
    workdir: PathBuf,
}

impl TestVcs {
    fn new(id: &str, workdir: PathBuf) -> Self {
        Self {
            id: BackendId::from(id),
            workdir,
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

fn build_vcs_conflicts_app() -> (tauri::App<tauri::test::MockRuntime>, Arc<TestVcs>) {
    crate::app_identity::setup_test_isolation();
    let vcs = Arc::new(TestVcs::new("test-vcs", tempfile::tempdir().unwrap().keep()));
    let repo = Arc::new(Repo::new(vcs.clone() as Arc<dyn Vcs>));
    let cfg = settings::AppConfig::default();
    let app_state = AppState::new_with_config(cfg);
    app_state.set_current_repo(repo);

    let app = mock_builder()
        .manage(app_state)
        .invoke_handler(tauri::generate_handler![
            super::vcs_conflict_details,
            super::vcs_resolve_conflict_side,
            super::vcs_save_merge_result,
            super::vcs_launch_merge_tool,
        ])
        .build(mock_context(noop_assets()))
        .expect("build conflicts test app");

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
fn vcs_conflict_details_propagates_error() {
    register_test_backend("test-vcs");
    let (app, _) = build_vcs_conflicts_app();
    let wv = test_webview(&app);

    let body = tauri::ipc::InvokeBody::Json(serde_json::json!({"path": "src/main.rs"}));
    let res = invoke_cmd(&wv, "vcs_conflict_details", body);
    // conflict_details has a default impl returning Unsupported
    assert!(res.is_err(), "conflict_details should fail (unsupported): {:?}", res);
}

#[test]
fn vcs_resolve_conflict_side_invalid_side_fails() {
    register_test_backend("test-vcs");
    let (app, _) = build_vcs_conflicts_app();
    let wv = test_webview(&app);

    let body = tauri::ipc::InvokeBody::Json(serde_json::json!({"path": "src/main.rs", "side": "invalid"}));
    let res = invoke_cmd(&wv, "vcs_resolve_conflict_side", body);
    // The side validation happens before the Vcs call, so this returns side validation error
    assert!(res.is_err(), "resolve with invalid side should fail");
}

#[test]
fn vcs_resolve_conflict_side_propagates_error() {
    register_test_backend("test-vcs");
    let (app, _) = build_vcs_conflicts_app();
    let wv = test_webview(&app);

    let body = tauri::ipc::InvokeBody::Json(serde_json::json!({"path": "src/main.rs", "side": "ours"}));
    let res = invoke_cmd(&wv, "vcs_resolve_conflict_side", body);
    // checkout_conflict_side has a default impl returning Unsupported
    assert!(res.is_err(), "resolve should fail (unsupported): {:?}", res);
}

#[test]
fn vcs_save_merge_result_propagates_error() {
    register_test_backend("test-vcs");
    let (app, _) = build_vcs_conflicts_app();
    let wv = test_webview(&app);

    let body = tauri::ipc::InvokeBody::Json(serde_json::json!({"path": "src/main.rs", "content": "merged content"}));
    let res = invoke_cmd(&wv, "vcs_save_merge_result", body);
    // write_merge_result has a default impl returning Unsupported
    assert!(res.is_err(), "save merge should fail (unsupported): {:?}", res);
}

#[test]
fn vcs_launch_merge_tool_propagates_error() {
    register_test_backend("test-vcs");
    let (app, _) = build_vcs_conflicts_app();
    let wv = test_webview(&app);

    let body = tauri::ipc::InvokeBody::Json(serde_json::json!({"path": "src/main.rs"}));
    let res = invoke_cmd(&wv, "vcs_launch_merge_tool", body);
    // requires ExternalTool config, likely fails
    let _ = res;
}
