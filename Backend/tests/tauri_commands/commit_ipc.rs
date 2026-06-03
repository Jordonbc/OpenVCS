// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later
//
// This file is included by commit.rs via `include!("commit_ipc.rs")` and
// shares the same mod tests namespace. All imports, the TestVcs struct,
// and helper functions from commit.rs are available here.

// ── commit_changes IPC tests ──

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

// ── commit_selected IPC tests ──

#[test]
fn commit_selected_fails_without_identity() {
    register_test_backend("test-vcs");
    let (app, _vcs) = build_app_with_repo();
    let wv = test_webview(&app);

    let body = tauri::ipc::InvokeBody::Json(serde_json::json!({
        "summary": "test",
        "description": null,
        "files": ["src/lib.rs"],
    }));
    let res = invoke_cmd(&wv, "commit_selected", body);
    assert!(res.is_err(), "no identity should fail: {:?}", res);
}

#[test]
fn commit_selected_fails_with_unsupported_commit_index() {
    register_test_backend("test-vcs");
    let (app, vcs) = build_app_with_repo();
    *vcs.identity.lock().unwrap() = Some(("User".into(), "u@t.com".into()));
    let wv = test_webview(&app);

    let body = tauri::ipc::InvokeBody::Json(serde_json::json!({
        "summary": "test",
        "description": null,
        "files": ["src/lib.rs"],
    }));
    let res = invoke_cmd(&wv, "commit_selected", body);
    assert!(res.is_err(), "unsupported commit_index should fail: {:?}", res);
}

#[test]
fn commit_selected_succeeds_with_valid_files() {
    register_test_backend("test-vcs");
    let (app, vcs) = build_app_with_repo();
    *vcs.identity.lock().unwrap() = Some(("User".into(), "u@t.com".into()));
    *vcs.commit_result.lock().unwrap() = Some("sel-oid-1".into());
    let wv = test_webview(&app);

    let body = tauri::ipc::InvokeBody::Json(serde_json::json!({
        "summary": "selective commit",
        "description": "only some files",
        "files": ["a.rs", "b.rs"],
    }));
    let res = invoke_cmd(&wv, "commit_selected", body);
    assert!(res.is_ok(), "commit_selected should succeed: {:?}", res);
    let commit_id: String = res.unwrap().deserialize().unwrap();
    assert_eq!(commit_id, "sel-oid-1");
}

// ── commit_patch IPC tests ──

#[test]
fn commit_patch_fails_without_identity() {
    register_test_backend("test-vcs");
    let (app, _vcs) = build_app_with_repo();
    let wv = test_webview(&app);

    let body = tauri::ipc::InvokeBody::Json(serde_json::json!({
        "summary": "patch commit",
        "description": null,
        "patch": "@@ -1 +1 @@\n-old\n+new\n",
    }));
    let res = invoke_cmd(&wv, "commit_patch", body);
    assert!(res.is_err(), "no identity should fail: {:?}", res);
}

#[test]
fn commit_patch_fails_when_stage_patch_fails() {
    register_test_backend("test-vcs");
    let (app, vcs) = build_app_with_repo();
    *vcs.identity.lock().unwrap() = Some(("User".into(), "u@t.com".into()));
    *vcs.stage_patch_fail.lock().unwrap() = true;
    let wv = test_webview(&app);

    let body = tauri::ipc::InvokeBody::Json(serde_json::json!({
        "summary": "patch commit",
        "description": null,
        "patch": "@@ -1 +1 @@\n-old\n+new\n",
    }));
    let res = invoke_cmd(&wv, "commit_patch", body);
    assert!(res.is_err(), "stage_patch failure should propagate: {:?}", res);
}

#[test]
fn commit_patch_fails_with_unsupported_commit_index() {
    register_test_backend("test-vcs");
    let (app, vcs) = build_app_with_repo();
    *vcs.identity.lock().unwrap() = Some(("User".into(), "u@t.com".into()));
    let wv = test_webview(&app);

    let body = tauri::ipc::InvokeBody::Json(serde_json::json!({
        "summary": "patch commit",
        "description": null,
        "patch": "@@ -1 +1 @@\n-old\n+new\n",
    }));
    let res = invoke_cmd(&wv, "commit_patch", body);
    assert!(
        res.is_err(),
        "unsupported commit_index should fail: {:?}",
        res
    );
}

#[test]
fn commit_patch_succeeds_with_valid_patch() {
    register_test_backend("test-vcs");
    let (app, vcs) = build_app_with_repo();
    *vcs.identity.lock().unwrap() = Some(("User".into(), "u@t.com".into()));
    *vcs.commit_result.lock().unwrap() = Some("patch-oid".into());
    let wv = test_webview(&app);

    let body = tauri::ipc::InvokeBody::Json(serde_json::json!({
        "summary": "patch commit",
        "description": "applied via patch",
        "patch": "@@ -1 +1 @@\n-old\n+new\n",
    }));
    let res = invoke_cmd(&wv, "commit_patch", body);
    assert!(res.is_ok(), "commit_patch should succeed: {:?}", res);
    let commit_id: String = res.unwrap().deserialize().unwrap();
    assert_eq!(commit_id, "patch-oid");
}

// ── commit_patch_and_files IPC tests ──

#[test]
fn commit_patch_and_files_fails_without_identity() {
    register_test_backend("test-vcs");
    let (app, _vcs) = build_app_with_repo();
    let wv = test_webview(&app);

    let body = tauri::ipc::InvokeBody::Json(serde_json::json!({
        "summary": "combo",
        "description": null,
        "patch": "",
        "files": ["a.rs"],
        "stagePaths": [],
    }));
    let res = invoke_cmd(&wv, "commit_patch_and_files", body);
    assert!(res.is_err(), "no identity should fail: {:?}", res);
}

#[test]
fn commit_patch_and_files_fails_with_no_commit_paths() {
    register_test_backend("test-vcs");
    let (app, vcs) = build_app_with_repo();
    *vcs.identity.lock().unwrap() = Some(("User".into(), "u@t.com".into()));
    let wv = test_webview(&app);

    let body = tauri::ipc::InvokeBody::Json(serde_json::json!({
        "summary": "combo",
        "description": null,
        "patch": "",
        "files": [],
        "stagePaths": [],
    }));
    let res = invoke_cmd(&wv, "commit_patch_and_files", body);
    assert!(res.is_err(), "empty selection should fail: {:?}", res);
}

#[test]
fn commit_patch_and_files_fails_when_stage_patch_fails() {
    register_test_backend("test-vcs");
    let (app, vcs) = build_app_with_repo();
    *vcs.identity.lock().unwrap() = Some(("User".into(), "u@t.com".into()));
    *vcs.stage_patch_fail.lock().unwrap() = true;
    let wv = test_webview(&app);

    let body = tauri::ipc::InvokeBody::Json(serde_json::json!({
        "summary": "combo",
        "description": null,
        "patch": "@@ diff",
        "files": [],
        "stagePaths": [],
    }));
    let res = invoke_cmd(&wv, "commit_patch_and_files", body);
    assert!(res.is_err(), "stage_patch failure should propagate: {:?}", res);
}

#[test]
fn commit_patch_and_files_succeeds_with_stage_paths_only() {
    register_test_backend("test-vcs");
    let (app, vcs) = build_app_with_repo();
    *vcs.identity.lock().unwrap() = Some(("User".into(), "u@t.com".into()));
    *vcs.commit_result.lock().unwrap() = Some("combo-oid".into());
    let wv = test_webview(&app);

    let body = tauri::ipc::InvokeBody::Json(serde_json::json!({
        "summary": "combo",
        "description": "",
        "patch": "",
        "files": [],
        "stagePaths": ["src/a.rs", "src/b.rs"],
    }));
    let res = invoke_cmd(&wv, "commit_patch_and_files", body);
    assert!(
        res.is_ok(),
        "commit_patch_and_files with stage_paths should succeed: {:?}",
        res
    );
    let commit_id: String = res.unwrap().deserialize().unwrap();
    assert_eq!(commit_id, "combo-oid");
}

#[test]
fn commit_patch_and_files_succeeds_with_patch_only() {
    register_test_backend("test-vcs");
    let (app, vcs) = build_app_with_repo();
    *vcs.identity.lock().unwrap() = Some(("User".into(), "u@t.com".into()));
    *vcs.commit_result.lock().unwrap() = Some("patch-only-oid".into());
    let wv = test_webview(&app);

    let body = tauri::ipc::InvokeBody::Json(serde_json::json!({
        "summary": "combo",
        "description": "",
        "patch": "@@ diff",
        "files": [],
        "stagePaths": [],
    }));
    let res = invoke_cmd(&wv, "commit_patch_and_files", body);
    assert!(
        res.is_ok(),
        "commit_patch_and_files with patch should succeed: {:?}",
        res
    );
    let commit_id: String = res.unwrap().deserialize().unwrap();
    assert_eq!(commit_id, "patch-only-oid");
}

// ── commit_selection IPC tests ──

#[test]
fn commit_selection_fails_without_repo() {
    let app = build_app_no_repo();
    let wv = test_webview(&app);

    let body = tauri::ipc::InvokeBody::Json(serde_json::json!({
        "summary": "test",
        "description": null,
        "selections": [],
        "stagePaths": [],
    }));
    let res = invoke_cmd(&wv, "commit_selection", body);
    assert!(res.is_err(), "commit_selection needs a repo: {:?}", res);
}

#[test]
fn commit_selection_fails_without_identity() {
    register_test_backend("test-vcs");
    let (app, _vcs) = build_app_with_repo();
    let wv = test_webview(&app);

    let body = tauri::ipc::InvokeBody::Json(serde_json::json!({
        "summary": "test",
        "description": null,
        "selections": [{
            "path": "file.rs",
            "whole_hunks": [0],
            "partial_hunks": {}
        }],
        "stagePaths": [],
    }));
    let res = invoke_cmd(&wv, "commit_selection", body);
    assert!(res.is_err(), "no identity should fail: {:?}", res);
}

#[test]
fn commit_selection_fails_with_no_paths() {
    register_test_backend("test-vcs");
    let (app, vcs) = build_app_with_repo();
    *vcs.identity.lock().unwrap() = Some(("Test User".into(), "test@example.com".into()));
    let wv = test_webview(&app);

    let body = tauri::ipc::InvokeBody::Json(serde_json::json!({
        "summary": "test",
        "description": null,
        "selections": [],
        "stagePaths": [],
    }));
    let res = invoke_cmd(&wv, "commit_selection", body);
    assert!(
        res.is_err(),
        "empty selections+stage_paths should fail: {:?}",
        res
    );
}

#[test]
fn commit_selection_succeeds_with_hunk_selections() {
    register_test_backend("test-vcs");
    let (app, vcs) = build_app_with_repo();
    *vcs.identity.lock().unwrap() = Some(("Test User".into(), "test@example.com".into()));
    *vcs.commit_result.lock().unwrap() = Some("oid-456".into());
    let wv = test_webview(&app);

    let body = tauri::ipc::InvokeBody::Json(serde_json::json!({
        "summary": "partial commit",
        "description": "via selections",
        "selections": [{
            "path": "src/lib.rs",
            "whole_hunks": [0, 1],
            "partial_hunks": { "2": [1, 3] }
        }],
        "stagePaths": [],
    }));
    let res = invoke_cmd(&wv, "commit_selection", body);
    assert!(
        res.is_ok(),
        "commit_selection with hunks should succeed: {:?}",
        res
    );
    let commit_id: String = res.unwrap().deserialize().unwrap();
    assert_eq!(commit_id, "oid-456");
}

#[test]
fn commit_selection_succeeds_with_stage_paths() {
    register_test_backend("test-vcs");
    let (app, vcs) = build_app_with_repo();
    *vcs.identity.lock().unwrap() = Some(("Test User".into(), "test@example.com".into()));
    *vcs.commit_result.lock().unwrap() = Some("oid-789".into());
    let wv = test_webview(&app);

    let body = tauri::ipc::InvokeBody::Json(serde_json::json!({
        "summary": "full file commit",
        "description": "",
        "selections": [],
        "stagePaths": ["src/main.rs", "src/utils.rs"],
    }));
    let res = invoke_cmd(&wv, "commit_selection", body);
    assert!(
        res.is_ok(),
        "commit_selection with stage_paths should succeed: {:?}",
        res
    );
    let commit_id: String = res.unwrap().deserialize().unwrap();
    assert_eq!(commit_id, "oid-789");
}

#[test]
fn commit_selection_succeeds_with_combined_selections_and_stage_paths() {
    register_test_backend("test-vcs");
    let (app, vcs) = build_app_with_repo();
    *vcs.identity.lock().unwrap() = Some(("Test User".into(), "test@example.com".into()));
    *vcs.commit_result.lock().unwrap() = Some("combined-oid".into());
    let wv = test_webview(&app);

    let body = tauri::ipc::InvokeBody::Json(serde_json::json!({
        "summary": "combined commit",
        "description": "",
        "selections": [{
            "path": "partial.rs",
            "whole_hunks": [0],
            "partial_hunks": {}
        }],
        "stagePaths": ["full.rs"],
    }));
    let res = invoke_cmd(&wv, "commit_selection", body);
    assert!(
        res.is_ok(),
        "commit_selection combined should succeed: {:?}",
        res
    );
    let commit_id: String = res.unwrap().deserialize().unwrap();
    assert_eq!(commit_id, "combined-oid");
}

#[test]
fn commit_selection_fails_when_stage_selections_fails() {
    register_test_backend("test-vcs");
    let (app, vcs) = build_app_with_repo();
    *vcs.identity.lock().unwrap() = Some(("Test User".into(), "test@example.com".into()));
    *vcs.stage_sel_fail.lock().unwrap() = true;
    let wv = test_webview(&app);

    let body = tauri::ipc::InvokeBody::Json(serde_json::json!({
        "summary": "failing selection",
        "description": null,
        "selections": [{
            "path": "broken.rs",
            "whole_hunks": [0],
            "partial_hunks": {}
        }],
        "stagePaths": [],
    }));
    let res = invoke_cmd(&wv, "commit_selection", body);
    assert!(
        res.is_err(),
        "stage_selections error should propagate: {:?}",
        res
    );
}

// ── vcs_cherry_pick_to_branch IPC tests ──

#[test]
fn vcs_cherry_pick_to_branch_fails_with_empty_id() {
    register_test_backend("test-vcs");
    let (app, _vcs) = build_app_with_repo();
    let wv = test_webview(&app);

    let body = tauri::ipc::InvokeBody::Json(serde_json::json!({
        "id": "   ",
        "branch": "main",
    }));
    let res = invoke_cmd(&wv, "vcs_cherry_pick_to_branch", body);
    assert!(res.is_err(), "empty id should fail: {:?}", res);
}

#[test]
fn vcs_cherry_pick_to_branch_fails_with_empty_branch() {
    register_test_backend("test-vcs");
    let (app, _vcs) = build_app_with_repo();
    let wv = test_webview(&app);

    let body = tauri::ipc::InvokeBody::Json(serde_json::json!({
        "id": "abc123",
        "branch": "",
    }));
    let res = invoke_cmd(&wv, "vcs_cherry_pick_to_branch", body);
    assert!(res.is_err(), "empty branch should fail: {:?}", res);
}

#[test]
fn vcs_cherry_pick_to_branch_fails_when_checkout_branch_fails() {
    register_test_backend("test-vcs");
    let (app, vcs) = build_app_with_repo();
    *vcs.checkout_branch_fail.lock().unwrap() = true;
    let wv = test_webview(&app);

    let body = tauri::ipc::InvokeBody::Json(serde_json::json!({
        "id": "abc123",
        "branch": "main",
    }));
    let res = invoke_cmd(&wv, "vcs_cherry_pick_to_branch", body);
    assert!(
        res.is_err(),
        "checkout_branch failure should propagate: {:?}",
        res
    );
}

#[test]
fn vcs_cherry_pick_to_branch_fails_when_cherry_pick_fails() {
    register_test_backend("test-vcs");
    let (app, vcs) = build_app_with_repo();
    *vcs.cherry_pick_fail.lock().unwrap() = true;
    let wv = test_webview(&app);

    let body = tauri::ipc::InvokeBody::Json(serde_json::json!({
        "id": "abc123",
        "branch": "main",
    }));
    let res = invoke_cmd(&wv, "vcs_cherry_pick_to_branch", body);
    assert!(
        res.is_err(),
        "cherry_pick failure should propagate: {:?}",
        res
    );
}

#[test]
fn vcs_cherry_pick_to_branch_succeeds_with_valid_input() {
    register_test_backend("test-vcs");
    let (app, _vcs) = build_app_with_repo();
    let wv = test_webview(&app);

    let body = tauri::ipc::InvokeBody::Json(serde_json::json!({
        "id": "abc123",
        "branch": "main",
    }));
    let res = invoke_cmd(&wv, "vcs_cherry_pick_to_branch", body);
    assert!(res.is_ok(), "cherry_pick should succeed: {:?}", res);
}

// ── vcs_revert_commit IPC tests ──

#[test]
fn vcs_revert_commit_fails_with_empty_id() {
    register_test_backend("test-vcs");
    let (app, _vcs) = build_app_with_repo();
    let wv = test_webview(&app);

    let body = tauri::ipc::InvokeBody::Json(serde_json::json!({
        "id": "",
    }));
    let res = invoke_cmd(&wv, "vcs_revert_commit", body);
    assert!(res.is_err(), "empty id should fail: {:?}", res);
}

#[test]
fn vcs_revert_commit_fails_when_revert_fails() {
    register_test_backend("test-vcs");
    let (app, vcs) = build_app_with_repo();
    *vcs.revert_commit_fail.lock().unwrap() = true;
    let wv = test_webview(&app);

    let body = tauri::ipc::InvokeBody::Json(serde_json::json!({
        "id": "abc123",
    }));
    let res = invoke_cmd(&wv, "vcs_revert_commit", body);
    assert!(
        res.is_err(),
        "revert_commit failure should propagate: {:?}",
        res
    );
}

#[test]
fn vcs_revert_commit_succeeds_with_valid_input() {
    register_test_backend("test-vcs");
    let (app, _vcs) = build_app_with_repo();
    let wv = test_webview(&app);

    let body = tauri::ipc::InvokeBody::Json(serde_json::json!({
        "id": "abc123",
    }));
    let res = invoke_cmd(&wv, "vcs_revert_commit", body);
    assert!(res.is_ok(), "revert should succeed: {:?}", res);
}
