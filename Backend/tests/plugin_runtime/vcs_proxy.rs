// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

use super::{path_to_utf8, PluginVcsProxy};
use crate::core::models::{LogQuery, OnEvent};
use crate::core::{BackendId, Vcs, VcsError};
use crate::plugin_runtime::node_instance::NodePluginRuntimeInstance;
use crate::plugin_runtime::spawn::SpawnConfig;
use serde_json::{json, Value};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

fn test_runtime() -> Arc<NodePluginRuntimeInstance> {
    Arc::new(NodePluginRuntimeInstance::new(SpawnConfig {
        plugin_id: "demo.plugin".into(),
        exec_path: PathBuf::from("bin/plugin.mjs"),
        allowed_workspace_root: None,
        is_vcs_backend: true,
    }))
}

fn mock_proxy() -> (PluginVcsProxy, Arc<NodePluginRuntimeInstance>) {
    let runtime = test_runtime();
    let proxy = PluginVcsProxy {
        backend_id: BackendId::from("git"),
        workdir: PathBuf::from("/tmp/repo"),
        runtime: Arc::clone(&runtime),
    };
    (proxy, runtime)
}

fn set_unit_response(runtime: &NodePluginRuntimeInstance) {
    runtime.set_mock_handler(Box::new(|_, _| Ok(Value::Null)));
}

fn set_response(runtime: &NodePluginRuntimeInstance, value: Value) {
    runtime.set_mock_handler(Box::new(move |_, _| Ok(value.clone())));
}

fn set_error(runtime: &NodePluginRuntimeInstance, msg: &str) {
    let msg = msg.to_string();
    runtime.set_mock_handler(Box::new(move |_, _| Err(msg.clone())));
}

// ── Accessor tests ──

#[test]
fn proxy_id_returns_backend_id() {
    let proxy = mock_proxy().0;
    assert_eq!(proxy.id(), "git");
}

#[test]
fn proxy_workdir_returns_path() {
    let proxy = mock_proxy().0;
    assert_eq!(proxy.workdir(), PathBuf::from("/tmp/repo"));
}

// ── Unit-returning VCS delegation tests ──

#[test]
fn proxy_create_branch_delegates() {
    let (proxy, rt) = mock_proxy();
    rt.set_session_id(Some("s".into()));
    set_unit_response(&rt);
    assert!(proxy.create_branch("feat", true).is_ok());
}

#[test]
fn proxy_create_branch_forwards_error() {
    let (proxy, rt) = mock_proxy();
    rt.set_session_id(Some("s".into()));
    set_error(&rt, "boom");
    assert!(matches!(proxy.create_branch("feat", true), Err(VcsError::Backend { .. })));
}

#[test]
fn proxy_checkout_branch_delegates() {
    let (proxy, rt) = mock_proxy();
    rt.set_session_id(Some("s".into()));
    set_unit_response(&rt);
    assert!(proxy.checkout_branch("main").is_ok());
}

#[test]
fn proxy_ensure_remote_delegates() {
    let (proxy, rt) = mock_proxy();
    rt.set_session_id(Some("s".into()));
    set_unit_response(&rt);
    assert!(proxy.ensure_remote("origin", "https://example.com/repo").is_ok());
}

#[test]
fn proxy_remove_remote_delegates() {
    let (proxy, rt) = mock_proxy();
    rt.set_session_id(Some("s".into()));
    set_unit_response(&rt);
    assert!(proxy.remove_remote("upstream").is_ok());
}

#[test]
fn proxy_fetch_with_events_delegates() {
    let (proxy, rt) = mock_proxy();
    rt.set_session_id(Some("s".into()));
    set_unit_response(&rt);
    let on: OnEvent = Arc::new(|_| {});
    assert!(proxy.fetch("origin", "main", Some(on)).is_ok());
}

#[test]
fn proxy_push_with_events_delegates() {
    let (proxy, rt) = mock_proxy();
    rt.set_session_id(Some("s".into()));
    set_unit_response(&rt);
    let on: OnEvent = Arc::new(|_| {});
    assert!(proxy.push("origin", "main", Some(on)).is_ok());
}

#[test]
fn proxy_pull_ff_only_with_events_delegates() {
    let (proxy, rt) = mock_proxy();
    rt.set_session_id(Some("s".into()));
    set_unit_response(&rt);
    let on: OnEvent = Arc::new(|_| {});
    assert!(proxy.pull_ff_only("origin", "main", Some(on)).is_ok());
}

#[test]
fn proxy_fetch_without_events_delegates() {
    let (proxy, rt) = mock_proxy();
    rt.set_session_id(Some("s".into()));
    set_unit_response(&rt);
    assert!(proxy.fetch("origin", "main", None).is_ok());
}

#[test]
fn proxy_stage_patch_delegates() {
    let (proxy, rt) = mock_proxy();
    rt.set_session_id(Some("s".into()));
    set_unit_response(&rt);
    assert!(proxy.stage_patch("diff ...").is_ok());
}

#[test]
fn proxy_stage_selections_delegates() {
    let (proxy, rt) = mock_proxy();
    rt.set_session_id(Some("s".into()));
    set_unit_response(&rt);

    use std::collections::HashMap;
    let mut partial = HashMap::new();
    partial.insert(0usize, vec![2usize, 4usize]);
    let sel = crate::core::models::HunkSelection {
        path: "src/main.rs".into(),
        whole_hunks: vec![1],
        partial_hunks: partial,
    };

    assert!(proxy.stage_selections(&[sel]).is_ok());
}

#[test]
fn proxy_stage_paths_delegates() {
    let (proxy, rt) = mock_proxy();
    rt.set_session_id(Some("s".into()));
    set_unit_response(&rt);
    assert!(proxy.stage_paths(&[PathBuf::from("file.rs")]).is_ok());
}

#[test]
fn proxy_discard_paths_delegates() {
    let (proxy, rt) = mock_proxy();
    rt.set_session_id(Some("s".into()));
    set_unit_response(&rt);
    assert!(proxy.discard_paths(&[PathBuf::from("file.rs")]).is_ok());
}

#[test]
fn proxy_apply_reverse_patch_delegates() {
    let (proxy, rt) = mock_proxy();
    rt.set_session_id(Some("s".into()));
    set_unit_response(&rt);
    assert!(proxy.apply_reverse_patch("diff ...").is_ok());
}

#[test]
fn proxy_delete_branch_delegates() {
    let (proxy, rt) = mock_proxy();
    rt.set_session_id(Some("s".into()));
    set_unit_response(&rt);
    assert!(proxy.delete_branch("old", false).is_ok());
}

#[test]
fn proxy_rename_branch_delegates() {
    let (proxy, rt) = mock_proxy();
    rt.set_session_id(Some("s".into()));
    set_unit_response(&rt);
    assert!(proxy.rename_branch("a", "b").is_ok());
}

#[test]
fn proxy_merge_into_current_delegates() {
    let (proxy, rt) = mock_proxy();
    rt.set_session_id(Some("s".into()));
    set_unit_response(&rt);
    assert!(proxy.merge_into_current("feature").is_ok());
}

#[test]
fn proxy_merge_into_current_with_message_delegates() {
    let (proxy, rt) = mock_proxy();
    rt.set_session_id(Some("s".into()));
    set_unit_response(&rt);
    assert!(proxy.merge_into_current_with_message("feature", Some("msg"), None).is_ok());
}

#[test]
fn proxy_merge_abort_delegates() {
    let (proxy, rt) = mock_proxy();
    rt.set_session_id(Some("s".into()));
    set_unit_response(&rt);
    assert!(proxy.merge_abort().is_ok());
}

#[test]
fn proxy_merge_continue_delegates() {
    let (proxy, rt) = mock_proxy();
    rt.set_session_id(Some("s".into()));
    set_unit_response(&rt);
    assert!(proxy.merge_continue().is_ok());
}

#[test]
fn proxy_set_branch_upstream_delegates() {
    let (proxy, rt) = mock_proxy();
    rt.set_session_id(Some("s".into()));
    set_unit_response(&rt);
    assert!(proxy.set_branch_upstream("main", "origin/main").is_ok());
}

#[test]
fn proxy_reset_soft_to_delegates() {
    let (proxy, rt) = mock_proxy();
    rt.set_session_id(Some("s".into()));
    set_unit_response(&rt);
    assert!(proxy.reset_soft_to("abc123").is_ok());
}

#[test]
fn proxy_set_identity_local_delegates() {
    let (proxy, rt) = mock_proxy();
    rt.set_session_id(Some("s".into()));
    set_unit_response(&rt);
    assert!(proxy.set_identity_local("Alice", "alice@example.com").is_ok());
}

#[test]
fn proxy_stash_apply_delegates() {
    let (proxy, rt) = mock_proxy();
    rt.set_session_id(Some("s".into()));
    set_unit_response(&rt);
    assert!(proxy.stash_apply("stash@{0}").is_ok());
}

#[test]
fn proxy_stash_pop_delegates() {
    let (proxy, rt) = mock_proxy();
    rt.set_session_id(Some("s".into()));
    set_unit_response(&rt);
    assert!(proxy.stash_pop("stash@{0}").is_ok());
}

#[test]
fn proxy_stash_drop_delegates() {
    let (proxy, rt) = mock_proxy();
    rt.set_session_id(Some("s".into()));
    set_unit_response(&rt);
    assert!(proxy.stash_drop("stash@{0}").is_ok());
}

#[test]
fn proxy_cherry_pick_delegates() {
    let (proxy, rt) = mock_proxy();
    rt.set_session_id(Some("s".into()));
    set_unit_response(&rt);
    assert!(proxy.cherry_pick("abc123").is_ok());
}

#[test]
fn proxy_revert_commit_delegates() {
    let (proxy, rt) = mock_proxy();
    rt.set_session_id(Some("s".into()));
    set_unit_response(&rt);
    assert!(proxy.revert_commit("abc123", true).is_ok());
}

#[test]
fn proxy_checkout_conflict_side_delegates() {
    let (proxy, rt) = mock_proxy();
    rt.set_session_id(Some("s".into()));
    set_unit_response(&rt);
    assert!(proxy.checkout_conflict_side(
        PathBuf::from("file.txt").as_path(),
        crate::core::models::ConflictSide::Ours,
    ).is_ok());
}

#[test]
fn proxy_write_merge_result_delegates() {
    let (proxy, rt) = mock_proxy();
    rt.set_session_id(Some("s".into()));
    set_unit_response(&rt);
    assert!(proxy.write_merge_result(PathBuf::from("file.txt").as_path(), b"content").is_ok());
}

// ── Typed-return VCS delegation tests ──

#[test]
fn proxy_current_branch_returns_name() {
    let (proxy, rt) = mock_proxy();
    rt.set_session_id(Some("s".into()));
    set_response(&rt, json!("main"));
    assert_eq!(proxy.current_branch().unwrap(), Some("main".into()));
}

#[test]
fn proxy_current_branch_returns_none() {
    let (proxy, rt) = mock_proxy();
    rt.set_session_id(Some("s".into()));
    set_response(&rt, Value::Null);
    assert_eq!(proxy.current_branch().unwrap(), None);
}

#[test]
fn proxy_branches_returns_list() {
    let (proxy, rt) = mock_proxy();
    rt.set_session_id(Some("s".into()));
    set_response(&rt, json!([
        {"name": "main", "full_ref": "refs/heads/main", "kind": {"type": "Local"}, "current": true}
    ]));
    let branches = proxy.branches().unwrap();
    assert_eq!(branches.len(), 1);
    assert_eq!(branches[0].name, "main");
}

#[test]
fn proxy_list_remotes_returns_pairs() {
    let (proxy, rt) = mock_proxy();
    rt.set_session_id(Some("s".into()));
    set_response(&rt, json!([
        {"name": "origin", "url": "https://example.com/repo"}
    ]));
    let remotes = proxy.list_remotes().unwrap();
    assert_eq!(remotes, vec![("origin".into(), "https://example.com/repo".into())]);
}

#[test]
fn proxy_commit_returns_oid() {
    let (proxy, rt) = mock_proxy();
    rt.set_session_id(Some("s".into()));
    set_response(&rt, json!("abc123"));
    let oid = proxy
        .commit("msg", "Alice", "alice@example.com", &[PathBuf::from("f.rs")])
        .unwrap();
    assert_eq!(oid, "abc123");
}

#[test]
fn proxy_commit_index_returns_oid() {
    let (proxy, rt) = mock_proxy();
    rt.set_session_id(Some("s".into()));
    set_response(&rt, json!("def456"));
    assert_eq!(
        proxy.commit_index("msg", "Alice", "alice@example.com").unwrap(),
        "def456"
    );
}

#[test]
fn proxy_status_payload_returns_status() {
    let (proxy, rt) = mock_proxy();
    rt.set_session_id(Some("s".into()));
    set_response(&rt, json!({
        "files": [{
            "path": "img.png",
            "old_path": null,
            "status": "M",
            "staged": false,
            "resolved_conflict": false,
            "hunks": [],
            "binary": true
        }],
        "ahead": 0,
        "behind": 0,
        "branch_on_remote": true
    }));
    let status = proxy.status_payload().unwrap();
    assert_eq!(status.files.len(), 1);
    assert_eq!(status.files[0].binary, Some(true));
    assert!(status.branch_on_remote);
}

#[test]
fn proxy_log_commits_returns_list() {
    let (proxy, rt) = mock_proxy();
    rt.set_session_id(Some("s".into()));
    set_response(&rt, json!([
        {"id": "abc", "msg": "first", "meta": "2024-01-01", "author": "Alice"}
    ]));
    let commits = proxy.log_commits(&LogQuery::default()).unwrap();
    assert_eq!(commits.len(), 1);
}

#[test]
fn proxy_diff_file_returns_lines() {
    let (proxy, rt) = mock_proxy();
    rt.set_session_id(Some("s".into()));
    set_response(&rt, json!({"lines": ["-old", "+new"], "binary": false}));
    let diff = proxy.diff_file(PathBuf::from("file.rs").as_path()).unwrap();
    assert_eq!(diff.lines, vec!["-old", "+new"]);
    assert_eq!(diff.binary, Some(false));
}


#[test]
fn proxy_diff_commit_returns_lines() {
    let (proxy, rt) = mock_proxy();
    rt.set_session_id(Some("s".into()));
    set_response(&rt, json!(["diff ..."]));
    let lines = proxy.diff_commit("abc123").unwrap();
    assert_eq!(lines, vec!["diff ..."]);
}

#[test]
fn proxy_conflict_details_returns_details() {
    let (proxy, rt) = mock_proxy();
    rt.set_session_id(Some("s".into()));
    set_response(&rt, json!({
        "path": "file.txt", "ours": "our", "theirs": "their",
        "base": "base", "binary": false
    }));
    let details = proxy.conflict_details(PathBuf::from("file.txt").as_path()).unwrap();
    assert_eq!(details.path, "file.txt");
    assert_eq!(details.ours.unwrap(), "our");
}

#[test]
fn proxy_merge_in_progress_returns_bool() {
    let (proxy, rt) = mock_proxy();
    rt.set_session_id(Some("s".into()));
    set_response(&rt, json!(true));
    assert!(proxy.merge_in_progress().unwrap());
}

#[test]
fn proxy_branch_upstream_returns_name() {
    let (proxy, rt) = mock_proxy();
    rt.set_session_id(Some("s".into()));
    set_response(&rt, json!("origin/main"));
    assert_eq!(proxy.branch_upstream("main").unwrap(), Some("origin/main".into()));
}

#[test]
fn proxy_get_identity_returns_info() {
    let (proxy, rt) = mock_proxy();
    rt.set_session_id(Some("s".into()));
    set_response(&rt, json!({"name": "Alice", "email": "alice@example.com"}));
    assert_eq!(
        proxy.get_identity().unwrap(),
        Some(("Alice".into(), "alice@example.com".into()))
    );
}

#[test]
fn proxy_stash_list_returns_list() {
    let (proxy, rt) = mock_proxy();
    rt.set_session_id(Some("s".into()));
    set_response(&rt, json!([
        {"selector": "stash@{0}", "msg": "WIP", "meta": "2024-01-01"}
    ]));
    let stashes = proxy.stash_list().unwrap();
    assert_eq!(stashes.len(), 1);
    assert_eq!(stashes[0].selector, "stash@{0}");
}

#[test]
fn proxy_stash_push_returns_selector() {
    let (proxy, rt) = mock_proxy();
    rt.set_session_id(Some("s".into()));
    set_response(&rt, json!("stash@{0}"));
    assert_eq!(proxy.stash_push("WIP", true, &[]).unwrap(), ());
}

#[test]
fn proxy_stash_push_forwards_paths() {
    let (proxy, rt) = mock_proxy();
    rt.set_session_id(Some("s".into()));

    let captured = Arc::new(Mutex::new(None::<Value>));
    let captured_params = Arc::clone(&captured);
    rt.set_mock_handler(Box::new(move |method, params| {
        assert_eq!(method, "vcs.stash_push");
        *captured_params.lock().expect("lock params") = Some(params.clone());
        Ok(json!("stash@{1}"))
    }));

    proxy
        .stash_push(
            "WIP",
            true,
            &[PathBuf::from("src/lib.rs"), PathBuf::from("README.md")],
        )
        .unwrap();

    assert_eq!(
        captured.lock().expect("lock params").as_ref(),
        Some(&json!({
            "session_id": "s",
            "message": "WIP",
            "include_untracked": true,
            "paths": ["src/lib.rs", "README.md"]
        }))
    );

    rt.set_session_id(None);
}

#[test]
fn proxy_stash_push_empty_message_uses_none() {
    let (proxy, rt) = mock_proxy();
    rt.set_session_id(Some("s".into()));
    set_response(&rt, json!("stash@{0}"));
    assert!(proxy.stash_push("  ", true, &[]).is_ok());
}

#[test]
fn proxy_stash_show_returns_lines() {
    let (proxy, rt) = mock_proxy();
    rt.set_session_id(Some("s".into()));
    set_response(&rt, json!("line1\nline2"));
    let lines = proxy.stash_show("stash@{0}").unwrap();
    assert_eq!(lines, vec!["line1", "line2"]);
}

// ── Existing tests ──

#[test]
fn maps_runtime_errors() {
    let proxy = mock_proxy().0;
    assert!(matches!(proxy.map_runtime_error("no upstream configured".into()), VcsError::NoUpstream));
    assert!(matches!(proxy.map_runtime_error("boom".into()), VcsError::Backend { .. }));
}

#[test]
/// Verifies dropping one proxy does not tear down a shared runtime session.
fn dropping_proxy_does_not_stop_shared_runtime() {
    let (proxy, rt) = mock_proxy();
    rt.set_session_id(Some("s".into()));
    set_response(&rt, json!("main"));

    drop(proxy);

    assert_eq!(rt.vcs_get_current_branch().unwrap(), Some("main".into()));
}

#[test]
fn converts_utf8_paths() {
    assert_eq!(path_to_utf8(std::path::Path::new("/tmp/repo")).unwrap(), "/tmp/repo");
}

#[cfg(unix)]
#[test]
fn rejects_non_utf8_paths() {
    use std::ffi::OsString;
    use std::os::unix::ffi::OsStringExt;

    let path = std::path::PathBuf::from(OsString::from_vec(vec![0xff, 0xfe]));
    assert!(path_to_utf8(&path).is_err());
}
