// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use super::{
    include_untracked_or_default, stash_message_or_default, stash_paths,
    stash_selector_or_default,
};
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
fn defaults_stash_message_and_include_untracked() {
    assert_eq!(stash_message_or_default(None), "WIP");
    assert_eq!(stash_message_or_default(Some("Save work".into())), "Save work");
    assert!(include_untracked_or_default(None));
    assert!(!include_untracked_or_default(Some(false)));
}

#[test]
fn converts_optional_stash_paths() {
    assert_eq!(stash_paths(None), Vec::<PathBuf>::new());
    assert_eq!(
        stash_paths(Some(vec!["src/lib.rs".into(), "README.md".into()])),
        vec![PathBuf::from("src/lib.rs"), PathBuf::from("README.md")]
    );
}

#[test]
fn defaults_missing_selectors_to_empty_strings() {
    assert_eq!(stash_selector_or_default(None), "");
    assert_eq!(stash_selector_or_default(Some("stash@{1}".into())), "stash@{1}");
}

// ── Vcs-backed IPC command tests ──

struct TestVcs {
    id: BackendId,
    workdir: PathBuf,
    stash_items: Vec<models::StashItem>,
}

impl TestVcs {
    fn new(id: &str, workdir: PathBuf) -> Self {
        Self {
            id: BackendId::from(id),
            workdir,
            stash_items: vec![
                models::StashItem {
                    selector: "stash@{0}".into(),
                    msg: "WIP on main".into(),
                    meta: "2026-01-15".into(),
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

    fn stash_list(&self) -> Result<Vec<models::StashItem>, VcsError> {
        Ok(self.stash_items.clone())
    }
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

fn build_vcs_stash_app() -> (tauri::App<tauri::test::MockRuntime>, Arc<TestVcs>) {
    let vcs = Arc::new(TestVcs::new("test-vcs", tempfile::tempdir().unwrap().keep()));
    let repo = Arc::new(Repo::new(vcs.clone() as Arc<dyn Vcs>));
    let cfg = settings::AppConfig::default();
    let app_state = AppState::new_with_config(cfg);
    app_state.set_current_repo(repo);

    let app = mock_builder()
        .manage(app_state)
        .invoke_handler(tauri::generate_handler![
            super::vcs_stash_list,
            super::vcs_stash_push,
            super::vcs_stash_apply,
            super::vcs_stash_pop,
            super::vcs_stash_drop,
            super::vcs_stash_show,
        ])
        .build(mock_context(noop_assets()))
        .expect("build stash test app");

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
fn vcs_stash_list_returns_entries() {
    register_test_backend("test-vcs");
    let (app, _) = build_vcs_stash_app();
    let wv = test_webview(&app);

    let res = invoke_cmd(&wv, "vcs_stash_list", tauri::ipc::InvokeBody::default());
    assert!(res.is_ok(), "vcs_stash_list should succeed: {:?}", res);
    let items: Vec<serde_json::Value> = res.unwrap().deserialize().unwrap();
    assert!(!items.is_empty(), "should return stash entries");
    assert_eq!(items[0]["selector"], "stash@{0}");
}

#[test]
fn vcs_stash_push_propagates_error() {
    register_test_backend("test-vcs");
    let (app, _) = build_vcs_stash_app();
    let wv = test_webview(&app);

    let body = tauri::ipc::InvokeBody::Json(serde_json::json!({"message": "wip", "include_untracked": true}));
    let res = invoke_cmd(&wv, "vcs_stash_push", body);
    assert!(res.is_err(), "stash push should fail (unsupported)");
}

#[test]
fn vcs_stash_apply_propagates_error() {
    register_test_backend("test-vcs");
    let (app, _) = build_vcs_stash_app();
    let wv = test_webview(&app);

    let body = tauri::ipc::InvokeBody::Json(serde_json::json!({"selector": "stash@{0}"}));
    let res = invoke_cmd(&wv, "vcs_stash_apply", body);
    assert!(res.is_err(), "stash apply should fail (unsupported)");
}

#[test]
fn vcs_stash_pop_propagates_error() {
    register_test_backend("test-vcs");
    let (app, _) = build_vcs_stash_app();
    let wv = test_webview(&app);

    let body = tauri::ipc::InvokeBody::Json(serde_json::json!({"selector": "stash@{0}"}));
    let res = invoke_cmd(&wv, "vcs_stash_pop", body);
    assert!(res.is_err(), "stash pop should fail (unsupported)");
}

#[test]
fn vcs_stash_drop_propagates_error() {
    register_test_backend("test-vcs");
    let (app, _) = build_vcs_stash_app();
    let wv = test_webview(&app);

    let body = tauri::ipc::InvokeBody::Json(serde_json::json!({"selector": "stash@{0}"}));
    let res = invoke_cmd(&wv, "vcs_stash_drop", body);
    assert!(res.is_err(), "stash drop should fail (unsupported)");
}

#[test]
fn vcs_stash_show_propagates_error() {
    register_test_backend("test-vcs");
    let (app, _) = build_vcs_stash_app();
    let wv = test_webview(&app);

    let body = tauri::ipc::InvokeBody::Json(serde_json::json!({"selector": "stash@{0}"}));
    let res = invoke_cmd(&wv, "vcs_stash_show", body);
    assert!(res.is_err(), "stash show should fail (unsupported)");
}
