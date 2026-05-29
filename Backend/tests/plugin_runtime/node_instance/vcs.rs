// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

use crate::plugin_runtime::node_instance::NodePluginRuntimeInstance;
use crate::plugin_runtime::spawn::SpawnConfig;
use serde_json::{json, Value};
use std::path::PathBuf;

fn test_runtime() -> NodePluginRuntimeInstance {
    NodePluginRuntimeInstance::new(SpawnConfig {
        plugin_id: "test.plugin".into(),
        exec_path: PathBuf::from("test.mjs"),
        allowed_workspace_root: None,
        is_vcs_backend: true,
    })
}

fn mock_response(runtime: &NodePluginRuntimeInstance, response: Value) {
    runtime.set_mock_handler(Box::new(move |_, _| Ok(response.clone())));
}

fn mock_error(runtime: &NodePluginRuntimeInstance, msg: &str) {
    let msg = msg.to_string();
    runtime.set_mock_handler(Box::new(move |_, _| Err(msg.clone())));
}

// --- Methods without session_params ---

#[test]
fn vcs_open_parses_empty_config_and_stores_session_id() {
    let rt = test_runtime();
    mock_response(&rt, json!({"session_id": "opened-123"}));
    rt.vcs_open("/repo", b"").unwrap();
    assert_eq!(&*rt.vcs_session_id.lock(), &Some("opened-123".to_string()));
}

#[test]
fn vcs_open_parses_config_bytes_and_stores_session_id() {
    let rt = test_runtime();
    mock_response(&rt, json!({"session_id": "opened-456"}));
    rt.vcs_open("/repo", br#"{"key":"val"}"#).unwrap();
    assert_eq!(&*rt.vcs_session_id.lock(), &Some("opened-456".to_string()));
}

#[test]
fn vcs_open_forwards_rpc_error() {
    let rt = test_runtime();
    mock_error(&rt, "failed to open");
    let err = rt.vcs_open("/repo", b"").unwrap_err();
    assert_eq!(err, "failed to open");
}

#[test]
fn vcs_clone_repo_works() {
    let rt = test_runtime();
    mock_response(&rt, Value::Null);
    rt.vcs_clone_repo("https://example.com/repo", "/dest").unwrap();
}

#[test]
fn vcs_clone_repo_forwards_error() {
    let rt = test_runtime();
    mock_error(&rt, "clone failed");
    assert!(rt.vcs_clone_repo("https://example.com/repo", "/dest").is_err());
}

// --- Methods using session_params with unit return ---

#[test]
fn vcs_create_branch_works() {
    let rt = test_runtime();
    *rt.vcs_session_id.lock() = Some("s".into());
    mock_response(&rt, Value::Null);
    rt.vcs_create_branch("feature", true).unwrap();
}

#[test]
fn vcs_checkout_branch_works() {
    let rt = test_runtime();
    *rt.vcs_session_id.lock() = Some("s".into());
    mock_response(&rt, Value::Null);
    rt.vcs_checkout_branch("main").unwrap();
}

#[test]
fn vcs_ensure_remote_works() {
    let rt = test_runtime();
    *rt.vcs_session_id.lock() = Some("s".into());
    mock_response(&rt, Value::Null);
    rt.vcs_ensure_remote("origin", "https://example.com/repo").unwrap();
}

#[test]
fn vcs_remove_remote_works() {
    let rt = test_runtime();
    *rt.vcs_session_id.lock() = Some("s".into());
    mock_response(&rt, Value::Null);
    rt.vcs_remove_remote("origin").unwrap();
}

#[test]
fn vcs_fetch_works() {
    let rt = test_runtime();
    *rt.vcs_session_id.lock() = Some("s".into());
    mock_response(&rt, Value::Null);
    rt.vcs_fetch("origin", "main").unwrap();
}

#[test]
fn vcs_push_works() {
    let rt = test_runtime();
    *rt.vcs_session_id.lock() = Some("s".into());
    mock_response(&rt, Value::Null);
    rt.vcs_push("origin", "main").unwrap();
}

#[test]
fn vcs_pull_ff_only_works() {
    let rt = test_runtime();
    *rt.vcs_session_id.lock() = Some("s".into());
    mock_response(&rt, Value::Null);
    rt.vcs_pull_ff_only("origin", "main").unwrap();
}

#[test]
fn vcs_stage_patch_works() {
    let rt = test_runtime();
    *rt.vcs_session_id.lock() = Some("s".into());
    mock_response(&rt, Value::Null);
    rt.vcs_stage_patch("diff --git a/file b/file").unwrap();
}

#[test]
fn vcs_stage_paths_works() {
    let rt = test_runtime();
    *rt.vcs_session_id.lock() = Some("s".into());
    mock_response(&rt, Value::Null);
    rt.vcs_stage_paths(&["src/main.rs".into(), "src/lib.rs".into()]).unwrap();
}

#[test]
fn vcs_discard_paths_works() {
    let rt = test_runtime();
    *rt.vcs_session_id.lock() = Some("s".into());
    mock_response(&rt, Value::Null);
    rt.vcs_discard_paths(&["src/main.rs".into()]).unwrap();
}

#[test]
fn vcs_apply_reverse_patch_works() {
    let rt = test_runtime();
    *rt.vcs_session_id.lock() = Some("s".into());
    mock_response(&rt, Value::Null);
    rt.vcs_apply_reverse_patch("diff --git a/file b/file").unwrap();
}

#[test]
fn vcs_delete_branch_works() {
    let rt = test_runtime();
    *rt.vcs_session_id.lock() = Some("s".into());
    mock_response(&rt, Value::Null);
    rt.vcs_delete_branch("old-feature", false).unwrap();
}

#[test]
fn vcs_rename_branch_works() {
    let rt = test_runtime();
    *rt.vcs_session_id.lock() = Some("s".into());
    mock_response(&rt, Value::Null);
    rt.vcs_rename_branch("old-name", "new-name").unwrap();
}

#[test]
fn vcs_merge_into_current_works() {
    let rt = test_runtime();
    *rt.vcs_session_id.lock() = Some("s".into());
    mock_response(&rt, Value::Null);
    rt.vcs_merge_into_current("feature", Some("merge msg")).unwrap();
}

#[test]
fn vcs_merge_into_current_without_message_works() {
    let rt = test_runtime();
    *rt.vcs_session_id.lock() = Some("s".into());
    mock_response(&rt, Value::Null);
    rt.vcs_merge_into_current("feature", None::<&str>).unwrap();
}

#[test]
fn vcs_merge_abort_works() {
    let rt = test_runtime();
    *rt.vcs_session_id.lock() = Some("s".into());
    mock_response(&rt, Value::Null);
    rt.vcs_merge_abort().unwrap();
}

#[test]
fn vcs_merge_continue_works() {
    let rt = test_runtime();
    *rt.vcs_session_id.lock() = Some("s".into());
    mock_response(&rt, Value::Null);
    rt.vcs_merge_continue().unwrap();
}

#[test]
fn vcs_set_branch_upstream_works() {
    let rt = test_runtime();
    *rt.vcs_session_id.lock() = Some("s".into());
    mock_response(&rt, Value::Null);
    rt.vcs_set_branch_upstream("main", "origin/main").unwrap();
}

#[test]
fn vcs_reset_soft_to_works() {
    let rt = test_runtime();
    *rt.vcs_session_id.lock() = Some("s".into());
    mock_response(&rt, Value::Null);
    rt.vcs_reset_soft_to("abc123").unwrap();
}

#[test]
fn vcs_set_identity_local_works() {
    let rt = test_runtime();
    *rt.vcs_session_id.lock() = Some("s".into());
    mock_response(&rt, Value::Null);
    rt.vcs_set_identity_local("User", "user@example.com").unwrap();
}

#[test]
fn vcs_stash_apply_works() {
    let rt = test_runtime();
    *rt.vcs_session_id.lock() = Some("s".into());
    mock_response(&rt, Value::Null);
    rt.vcs_stash_apply("stash@{0}").unwrap();
}

#[test]
fn vcs_stash_pop_works() {
    let rt = test_runtime();
    *rt.vcs_session_id.lock() = Some("s".into());
    mock_response(&rt, Value::Null);
    rt.vcs_stash_pop("stash@{0}").unwrap();
}

#[test]
fn vcs_stash_drop_works() {
    let rt = test_runtime();
    *rt.vcs_session_id.lock() = Some("s".into());
    mock_response(&rt, Value::Null);
    rt.vcs_stash_drop("stash@{0}").unwrap();
}

#[test]
fn vcs_cherry_pick_works() {
    let rt = test_runtime();
    *rt.vcs_session_id.lock() = Some("s".into());
    mock_response(&rt, Value::Null);
    rt.vcs_cherry_pick("abc123").unwrap();
}

#[test]
fn vcs_revert_commit_works() {
    let rt = test_runtime();
    *rt.vcs_session_id.lock() = Some("s".into());
    mock_response(&rt, Value::Null);
    rt.vcs_revert_commit("abc123", true).unwrap();
}

#[test]
fn vcs_checkout_conflict_side_works() {
    let rt = test_runtime();
    *rt.vcs_session_id.lock() = Some("s".into());
    mock_response(&rt, Value::Null);
    rt.vcs_checkout_conflict_side("file.txt", crate::core::models::ConflictSide::Ours)
        .unwrap();
}

#[test]
fn vcs_write_merge_result_works() {
    let rt = test_runtime();
    *rt.vcs_session_id.lock() = Some("s".into());
    mock_response(&rt, Value::Null);
    rt.vcs_write_merge_result("file.txt", b"merged content").unwrap();
}

// --- Methods with typed return values ---

#[test]
fn vcs_get_current_branch_returns_some() {
    let rt = test_runtime();
    *rt.vcs_session_id.lock() = Some("s".into());
    mock_response(&rt, json!("main"));
    assert_eq!(rt.vcs_get_current_branch().unwrap(), Some("main".to_string()));
}

#[test]
fn vcs_get_current_branch_returns_none() {
    let rt = test_runtime();
    *rt.vcs_session_id.lock() = Some("s".into());
    mock_response(&rt, Value::Null);
    assert_eq!(rt.vcs_get_current_branch().unwrap(), None);
}

#[test]
fn vcs_list_branches_returns_branches() {
    let rt = test_runtime();
    *rt.vcs_session_id.lock() = Some("s".into());
    mock_response(&rt, json!([
        {"name": "main", "full_ref": "refs/heads/main", "kind": {"type": "Local"}, "current": true},
        {"name": "feature", "full_ref": "refs/heads/feature", "kind": {"type": "Local"}, "current": false}
    ]));
    let branches = rt.vcs_list_branches().unwrap();
    assert_eq!(branches.len(), 2);
    assert_eq!(branches[0].name, "main");
    assert!(branches[0].current);
}

#[test]
fn vcs_list_remotes_returns_remotes() {
    let rt = test_runtime();
    *rt.vcs_session_id.lock() = Some("s".into());
    mock_response(&rt, json!([
        {"name": "origin", "url": "https://example.com/repo"}
    ]));
    let remotes = rt.vcs_list_remotes().unwrap();
    assert_eq!(remotes, vec![("origin".into(), "https://example.com/repo".into())]);
}

#[test]
fn vcs_list_commits_returns_commits() {
    let rt = test_runtime();
    *rt.vcs_session_id.lock() = Some("s".into());
    mock_response(&rt, json!([
        {"id": "abc", "msg": "first", "meta": "2024-01-01", "author": "Alice"}
    ]));
    let query = crate::core::models::LogQuery::default();
    let commits = rt.vcs_list_commits(&query).unwrap();
    assert_eq!(commits.len(), 1);
    assert_eq!(commits[0].id, "abc");
}

#[test]
fn vcs_diff_file_returns_diff_lines() {
    let rt = test_runtime();
    *rt.vcs_session_id.lock() = Some("s".into());
    mock_response(&rt, json!(["+new line", "-old line"]));
    let lines = rt.vcs_diff_file("file.rs").unwrap();
    assert_eq!(lines, vec!["+new line", "-old line"]);
}

#[test]
fn vcs_diff_commit_returns_diff_lines() {
    let rt = test_runtime();
    *rt.vcs_session_id.lock() = Some("s".into());
    mock_response(&rt, json!(["diff --git a/file b/file"]));
    let lines = rt.vcs_diff_commit("abc123").unwrap();
    assert_eq!(lines, vec!["diff --git a/file b/file"]);
}

#[test]
fn vcs_get_conflict_details_returns_details() {
    let rt = test_runtime();
    *rt.vcs_session_id.lock() = Some("s".into());
    mock_response(&rt, json!({
        "path": "file.txt",
        "ours": "our content",
        "theirs": "their content",
        "base": "base content",
        "binary": false,
        "lfs_pointer": false
    }));
    let details = rt.vcs_get_conflict_details("file.txt").unwrap();
    assert_eq!(details.path, "file.txt");
    assert_eq!(details.ours.unwrap(), "our content");
}

#[test]
fn vcs_is_merge_in_progress_returns_true() {
    let rt = test_runtime();
    *rt.vcs_session_id.lock() = Some("s".into());
    mock_response(&rt, json!(true));
    assert!(rt.vcs_is_merge_in_progress().unwrap());
}

#[test]
fn vcs_is_merge_in_progress_returns_false() {
    let rt = test_runtime();
    *rt.vcs_session_id.lock() = Some("s".into());
    mock_response(&rt, json!(false));
    assert!(!rt.vcs_is_merge_in_progress().unwrap());
}

#[test]
fn vcs_get_branch_upstream_returns_some() {
    let rt = test_runtime();
    *rt.vcs_session_id.lock() = Some("s".into());
    mock_response(&rt, json!("origin/main"));
    assert_eq!(rt.vcs_get_branch_upstream("main").unwrap(), Some("origin/main".into()));
}

#[test]
fn vcs_get_branch_upstream_returns_none() {
    let rt = test_runtime();
    *rt.vcs_session_id.lock() = Some("s".into());
    mock_response(&rt, Value::Null);
    assert_eq!(rt.vcs_get_branch_upstream("main").unwrap(), None);
}

#[test]
fn vcs_get_identity_returns_some() {
    let rt = test_runtime();
    *rt.vcs_session_id.lock() = Some("s".into());
    mock_response(&rt, json!({"name": "Alice", "email": "alice@example.com"}));
    let identity = rt.vcs_get_identity().unwrap();
    assert_eq!(identity, Some(("Alice".into(), "alice@example.com".into())));
}

#[test]
fn vcs_get_identity_returns_none() {
    let rt = test_runtime();
    *rt.vcs_session_id.lock() = Some("s".into());
    mock_response(&rt, Value::Null);
    assert_eq!(rt.vcs_get_identity().unwrap(), None);
}

#[test]
fn vcs_list_stashes_returns_stashes() {
    let rt = test_runtime();
    *rt.vcs_session_id.lock() = Some("s".into());
    mock_response(&rt, json!([
        {"selector": "stash@{0}", "msg": "WIP", "meta": "2024-01-01"}
    ]));
    let stashes = rt.vcs_list_stashes().unwrap();
    assert_eq!(stashes.len(), 1);
    assert_eq!(stashes[0].selector, "stash@{0}");
}

#[test]
fn vcs_stash_push_with_message_returns_selector() {
    let rt = test_runtime();
    *rt.vcs_session_id.lock() = Some("s".into());
    mock_response(&rt, json!("stash@{0}"));
    let result = rt.vcs_stash_push(Some("WIP"), false).unwrap();
    assert_eq!(result, "stash@{0}");
}

#[test]
fn vcs_stash_push_without_message_returns_selector() {
    let rt = test_runtime();
    *rt.vcs_session_id.lock() = Some("s".into());
    mock_response(&rt, json!("stash@{1}"));
    let result = rt.vcs_stash_push(None::<&str>, true).unwrap();
    assert_eq!(result, "stash@{1}");
}

#[test]
fn vcs_stash_show_returns_output() {
    let rt = test_runtime();
    *rt.vcs_session_id.lock() = Some("s".into());
    mock_response(&rt, json!("stash content"));
    let result = rt.vcs_stash_show("stash@{0}").unwrap();
    assert_eq!(result, "stash content");
}

#[test]
fn vcs_commit_returns_oid() {
    let rt = test_runtime();
    *rt.vcs_session_id.lock() = Some("s".into());
    mock_response(&rt, json!("abc123def"));
    let oid = rt
        .vcs_commit("msg", "Alice", "alice@example.com", &["file.rs".into()])
        .unwrap();
    assert_eq!(oid, "abc123def");
}

#[test]
fn vcs_commit_index_returns_oid() {
    let rt = test_runtime();
    *rt.vcs_session_id.lock() = Some("s".into());
    mock_response(&rt, json!("def456ghi"));
    let oid = rt.vcs_commit_index("msg", "Alice", "alice@example.com").unwrap();
    assert_eq!(oid, "def456ghi");
}

#[test]
fn vcs_get_status_payload_returns_status() {
    let rt = test_runtime();
    *rt.vcs_session_id.lock() = Some("s".into());
    mock_response(&rt, json!({
        "files": [],
        "ahead": 0,
        "behind": 0,
        "branch_on_remote": true
    }));
    let payload = rt.vcs_get_status_payload().unwrap();
    assert!(payload.files.is_empty());
    assert!(payload.branch_on_remote);
}

// --- Error paths ---

#[test]
fn session_params_fails_when_no_session() {
    let rt = test_runtime();
    mock_response(&rt, Value::Null);
    let err = rt.vcs_list_branches().unwrap_err();
    assert_eq!(err, "vcs session is not open");
}

#[test]
fn vcs_commit_forwards_rpc_error() {
    let rt = test_runtime();
    *rt.vcs_session_id.lock() = Some("s".into());
    mock_error(&rt, "commit rejected");
    let err = rt
        .vcs_commit("msg", "Alice", "alice@example.com", &["file.rs".into()])
        .unwrap_err();
    assert_eq!(err, "commit rejected");
}

#[test]
fn vcs_open_forwards_rpc_decode_error_as_runtime_error() {
    let rt = test_runtime();
    // Return non-matching shape for OpenSessionResponse
    mock_response(&rt, json!({"wrong_field": "value"}));
    let err = rt.vcs_open("/repo", b"").unwrap_err();
    assert!(err.contains("decode"));
}
