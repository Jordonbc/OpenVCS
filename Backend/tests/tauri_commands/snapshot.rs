// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

use std::collections::{BTreeMap, HashMap};
use std::path::{Path, PathBuf};
use std::sync::Arc;

use crate::core::models::{BranchItem, BranchKind, CommitItem};
use crate::core::{BackendId, Vcs, VcsError, models};
use crate::plugin_vcs_backends::{self, PluginBackendDescriptor};
use crate::repo::Repo;
use crate::settings;
use crate::state::AppState;
use tauri::WebviewWindowBuilder;
use tauri::ipc::InvokeBody;
use tauri::test::{INVOKE_KEY, get_ipc_response, mock_builder, mock_context, noop_assets};
use tauri::webview::InvokeRequest;

// ---------------------------------------------------------------------------
// Existing tests (preserved)
// ---------------------------------------------------------------------------

#[test]
fn revision_bumps_when_stash_count_changes() {
    fn make(stash_count: usize) -> String {
        super::build_repo_snapshot_revision(&super::SnapshotRevisionParts {
            repo_path: "/repo",
            branch_label: "main",
            head_commit: Some("abc123"),
            file_count: 3,
            commit_count: 10,
            ahead: 1,
            behind: 2,
            stash_count,
            merge_in_progress: false,
            branch_on_remote: true,
            branch_count: 5,
            current_upstream: None,
        })
    }

    assert_ne!(make(0), make(2));
}

#[test]
fn revision_bumps_when_merge_state_changes() {
    fn make(merge_in_progress: bool) -> String {
        super::build_repo_snapshot_revision(&super::SnapshotRevisionParts {
            repo_path: "/repo",
            branch_label: "main",
            head_commit: Some("abc123"),
            file_count: 3,
            commit_count: 10,
            ahead: 1,
            behind: 2,
            stash_count: 1,
            merge_in_progress,
            branch_on_remote: true,
            branch_count: 5,
            current_upstream: None,
        })
    }

    assert_ne!(make(false), make(true));
}

#[test]
fn revision_bumps_when_branch_on_remote_changes() {
    fn make(branch_on_remote: bool) -> String {
        super::build_repo_snapshot_revision(&super::SnapshotRevisionParts {
            repo_path: "/repo",
            branch_label: "main",
            head_commit: Some("abc123"),
            file_count: 3,
            commit_count: 10,
            ahead: 1,
            behind: 2,
            stash_count: 1,
            merge_in_progress: false,
            branch_on_remote,
            branch_count: 5,
            current_upstream: None,
        })
    }

    assert_ne!(make(false), make(true));
}

#[test]
fn revision_bumps_when_branch_count_changes() {
    fn make(branch_count: usize) -> String {
        super::build_repo_snapshot_revision(&super::SnapshotRevisionParts {
            repo_path: "/repo",
            branch_label: "main",
            head_commit: Some("abc123"),
            file_count: 3,
            commit_count: 10,
            ahead: 1,
            behind: 2,
            stash_count: 1,
            merge_in_progress: false,
            branch_on_remote: true,
            branch_count,
            current_upstream: None,
        })
    }

    assert_ne!(make(3), make(7));
}

#[test]
fn conflict_status_matches_frontend_rules() {
    assert!(super::is_conflict_status("U"));
    assert!(super::is_conflict_status("UA"));
    assert!(super::is_conflict_status("AU"));
    assert!(super::is_conflict_status("UD"));
    assert!(super::is_conflict_status("DU"));
    assert!(super::is_conflict_status("UU"));
    assert!(super::is_conflict_status("AA"));
    assert!(super::is_conflict_status("DD"));
    assert!(!super::is_conflict_status("M"));
}

#[test]
fn list_conflict_statuses_returns_exact_set() {
    assert_eq!(
        super::list_conflict_statuses(),
        vec!["U", "UU", "UA", "AU", "UD", "DU", "AA", "DD"]
            .into_iter()
            .map(String::from)
            .collect::<Vec<_>>()
    );
}

// ---------------------------------------------------------------------------
// 1. ConflictStatus enum
// ---------------------------------------------------------------------------

#[test]
fn conflict_status_all_returns_8_variants() {
    assert_eq!(super::ConflictStatus::all().len(), 8);
}

#[test]
fn conflict_status_code_each_variant() {
    use super::ConflictStatus;
    assert_eq!(ConflictStatus::Unmerged.code(), "U");
    assert_eq!(ConflictStatus::BothAdded.code(), "AA");
    assert_eq!(ConflictStatus::BothDeleted.code(), "DD");
    assert_eq!(ConflictStatus::AddedByUs.code(), "UA");
    assert_eq!(ConflictStatus::AddedByThem.code(), "AU");
    assert_eq!(ConflictStatus::DeletedByUs.code(), "UD");
    assert_eq!(ConflictStatus::DeletedByThem.code(), "DU");
    assert_eq!(ConflictStatus::BothModified.code(), "UU");
}

#[test]
fn conflict_status_parse_all_codes() {
    use super::ConflictStatus;
    assert_eq!(ConflictStatus::parse("U"), Some(ConflictStatus::Unmerged));
    assert_eq!(ConflictStatus::parse("AA"), Some(ConflictStatus::BothAdded));
    assert_eq!(
        ConflictStatus::parse("DD"),
        Some(ConflictStatus::BothDeleted)
    );
    assert_eq!(ConflictStatus::parse("UA"), Some(ConflictStatus::AddedByUs));
    assert_eq!(
        ConflictStatus::parse("AU"),
        Some(ConflictStatus::AddedByThem)
    );
    assert_eq!(
        ConflictStatus::parse("UD"),
        Some(ConflictStatus::DeletedByUs)
    );
    assert_eq!(
        ConflictStatus::parse("DU"),
        Some(ConflictStatus::DeletedByThem)
    );
    assert_eq!(
        ConflictStatus::parse("UU"),
        Some(ConflictStatus::BothModified)
    );
}

#[test]
fn conflict_status_parse_invalid_returns_none() {
    assert_eq!(super::ConflictStatus::parse("M"), None);
    assert_eq!(super::ConflictStatus::parse("A"), None);
    assert_eq!(super::ConflictStatus::parse("D"), None);
    assert_eq!(super::ConflictStatus::parse(""), None);
    assert_eq!(super::ConflictStatus::parse("XYZ"), None);
}

#[test]
fn conflict_status_parse_lowercase_works() {
    assert_eq!(
        super::ConflictStatus::parse("u"),
        Some(super::ConflictStatus::Unmerged)
    );
    assert_eq!(
        super::ConflictStatus::parse("aa"),
        Some(super::ConflictStatus::BothAdded)
    );
    assert_eq!(
        super::ConflictStatus::parse("uu"),
        Some(super::ConflictStatus::BothModified)
    );
}

#[test]
fn conflict_status_parse_whitespace_trimmed() {
    assert_eq!(
        super::ConflictStatus::parse(" U "),
        Some(super::ConflictStatus::Unmerged)
    );
    assert_eq!(
        super::ConflictStatus::parse(" UU "),
        Some(super::ConflictStatus::BothModified)
    );
}

#[test]
fn conflict_status_code_parse_bijection() {
    use super::ConflictStatus;
    for variant in ConflictStatus::all() {
        let code = variant.code();
        let parsed = ConflictStatus::parse(code);
        assert_eq!(
            parsed,
            Some(variant),
            "Round-trip failed for {:?}: code()={}, parse()={:?}",
            variant,
            code,
            parsed
        );
    }
}

// ---------------------------------------------------------------------------
// 2. build_repo_snapshot_revision (additional format checks)
// ---------------------------------------------------------------------------

#[test]
fn revision_has_expected_format_structure() {
    let revision = super::build_repo_snapshot_revision(&super::SnapshotRevisionParts {
        repo_path: "/repo",
        branch_label: "main",
        head_commit: Some("abc123"),
        file_count: 5,
        commit_count: 10,
        ahead: 2,
        behind: 3,
        stash_count: 1,
        merge_in_progress: true,
        branch_on_remote: false,
        branch_count: 4,
        current_upstream: None,
    });
    let parts: Vec<&str> = revision.splitn(12, ':').collect();
    assert_eq!(parts.len(), 12, "Expected 12 colon-separated fields");
    assert_eq!(parts[0], "/repo");
    assert_eq!(parts[1], "main");
    assert_eq!(parts[2], "abc123");
    assert_eq!(parts[3], "5");
    assert_eq!(parts[4], "10");
    assert_eq!(parts[5], "2");
    assert_eq!(parts[6], "3");
    assert_eq!(parts[7], "1");
    assert_eq!(parts[8], "true");
    assert_eq!(parts[9], "false");
    assert_eq!(parts[10], "4");
    assert_eq!(parts[11], "");
}
#[test]
fn revision_none_head_commit_uses_empty_string() {
    let revision = super::build_repo_snapshot_revision(&super::SnapshotRevisionParts {
        repo_path: "/repo",
        branch_label: "main",
        head_commit: None,
        file_count: 0,
        commit_count: 0,
        ahead: 0,
        behind: 0,
        stash_count: 0,
        merge_in_progress: false,
        branch_on_remote: false,
        branch_count: 0,
        current_upstream: None,
    });
    let parts: Vec<&str> = revision.splitn(12, ':').collect();
    assert_eq!(parts[2], "");
}

// ---------------------------------------------------------------------------
// 3. infer_kind
// ---------------------------------------------------------------------------

#[test]
fn infer_kind_heads_prefix_is_local() {
    assert_eq!(super::infer_kind("refs/heads/main"), BranchKind::Local);
}

#[test]
fn infer_kind_heads_feature_branch_is_local() {
    assert_eq!(
        super::infer_kind("refs/heads/feature/foo"),
        BranchKind::Local
    );
}

#[test]
fn infer_kind_remotes_produces_remote_kind() {
    assert_eq!(
        super::infer_kind("refs/remotes/origin/main"),
        BranchKind::Remote {
            remote: "origin".to_string()
        }
    );
}

#[test]
fn infer_kind_remotes_no_slash_uses_unknown_remote() {
    assert_eq!(
        super::infer_kind("refs/remotes/origin"),
        BranchKind::Remote {
            remote: "unknown".to_string()
        }
    );
}

#[test]
fn infer_kind_tags_prefix_is_unknown() {
    assert_eq!(super::infer_kind("refs/tags/v1.0"), BranchKind::Unknown);
}

#[test]
fn infer_kind_arbitrary_ref_is_unknown() {
    assert_eq!(super::infer_kind("main"), BranchKind::Unknown);
    assert_eq!(super::infer_kind("refs/stash"), BranchKind::Unknown);
}

// ---------------------------------------------------------------------------
// 4. normalize_branches
// ---------------------------------------------------------------------------

fn make_branch(name: &str, full_ref: &str, kind: BranchKind) -> BranchItem {
    BranchItem {
        name: name.to_string(),
        full_ref: full_ref.to_string(),
        kind,
        current: false,
    }
}

#[test]
fn normalize_branches_trims_name_and_full_ref() {
    let items = vec![BranchItem {
        name: "  main  ".to_string(),
        full_ref: "  refs/heads/main  ".to_string(),
        kind: BranchKind::Local,
        current: false,
    }];
    let result = super::normalize_branches(items, None);
    assert_eq!(result.len(), 1);
    assert_eq!(result[0].name, "main");
    assert_eq!(result[0].full_ref, "refs/heads/main");
}

#[test]
fn normalize_branches_skips_empty_name() {
    let items = vec![BranchItem {
        name: "  ".to_string(),
        full_ref: "refs/heads/main".to_string(),
        kind: BranchKind::Local,
        current: false,
    }];
    let result = super::normalize_branches(items, None);
    assert!(result.is_empty());
}

#[test]
fn normalize_branches_skips_empty_full_ref() {
    let items = vec![BranchItem {
        name: "main".to_string(),
        full_ref: "  ".to_string(),
        kind: BranchKind::Local,
        current: false,
    }];
    let result = super::normalize_branches(items, None);
    assert!(result.is_empty());
}

#[test]
fn normalize_branches_infers_kind_for_unknown() {
    let items = vec![make_branch("main", "refs/heads/main", BranchKind::Unknown)];
    let result = super::normalize_branches(items, None);
    assert_eq!(result.len(), 1);
    assert_eq!(result[0].kind, BranchKind::Local);
}

#[test]
fn normalize_branches_sets_current_for_matching_local() {
    let items = vec![make_branch("main", "refs/heads/main", BranchKind::Local)];
    let result = super::normalize_branches(items, Some("main"));
    assert_eq!(result.len(), 1);
    assert!(result[0].current);
}

#[test]
fn normalize_branches_does_not_set_current_for_remote() {
    let items = vec![make_branch(
        "main",
        "refs/remotes/origin/main",
        BranchKind::Remote {
            remote: "origin".to_string(),
        },
    )];
    let result = super::normalize_branches(items, Some("main"));
    assert_eq!(result.len(), 1);
    assert!(!result[0].current);
}

#[test]
fn normalize_branches_deduplicates_by_full_ref() {
    let items = vec![
        make_branch("main", "refs/heads/main", BranchKind::Local),
        make_branch("main-alt", "refs/heads/main", BranchKind::Local),
    ];
    let result = super::normalize_branches(items, None);
    assert_eq!(result.len(), 1);
    assert_eq!(result[0].name, "main");
}

#[test]
fn normalize_branches_sorts_current_first_locals_remotes_unknown() {
    let items = vec![
        make_branch("z-unknown", "refs/z-unknown", BranchKind::Unknown),
        make_branch(
            "z-remote",
            "refs/remotes/origin/z-remote",
            BranchKind::Unknown,
        ),
        make_branch("b-local", "refs/heads/b-local", BranchKind::Local),
        make_branch("a-local", "refs/heads/a-local", BranchKind::Local),
        make_branch("current", "refs/heads/current", BranchKind::Local),
    ];
    let result = super::normalize_branches(items, Some("current"));
    assert_eq!(result.len(), 5);
    // current first
    assert!(result[0].current);
    assert_eq!(result[0].name, "current");
    // locals sorted by name
    assert_eq!(result[1].name, "a-local");
    assert!(matches!(result[1].kind, BranchKind::Local));
    assert_eq!(result[2].name, "b-local");
    assert!(matches!(result[2].kind, BranchKind::Local));
    // remotes sorted by name
    assert_eq!(result[3].name, "z-remote");
    assert!(matches!(result[3].kind, BranchKind::Remote { .. }));
    // unknown last
    assert_eq!(result[4].name, "z-unknown");
    assert!(matches!(result[4].kind, BranchKind::Unknown));
}

#[test]
fn normalize_branches_empty_input_empty_output() {
    let result = super::normalize_branches(vec![], None);
    assert!(result.is_empty());
}

// ---------------------------------------------------------------------------
// 5. short_commit_label
// ---------------------------------------------------------------------------

#[test]
fn short_commit_label_none_is_empty() {
    assert_eq!(super::short_commit_label(None), "");
}

#[test]
fn short_commit_label_empty_string_is_empty() {
    assert_eq!(super::short_commit_label(Some("")), "");
}

#[test]
fn short_commit_label_long_truncated_to_7() {
    assert_eq!(super::short_commit_label(Some("abc1234def")), "abc1234");
}

#[test]
fn short_commit_label_short_returns_as_is() {
    assert_eq!(super::short_commit_label(Some("abc12")), "abc12");
}

#[test]
fn short_commit_label_exactly_7_unchanged() {
    assert_eq!(super::short_commit_label(Some("abc1234")), "abc1234");
}

#[test]
fn short_commit_label_whitespace_trimmed() {
    assert_eq!(super::short_commit_label(Some("  abc1234def  ")), "abc1234");
}

// ---------------------------------------------------------------------------
// 6. branch_label
// ---------------------------------------------------------------------------

#[test]
fn branch_label_with_both_returns_name_twice() {
    assert_eq!(
        super::branch_label(Some("main"), Some("abc1234def")),
        ("main".to_string(), "main".to_string())
    );
}

#[test]
fn branch_label_detached_with_commit_shows_short_hash() {
    assert_eq!(
        super::branch_label(None, Some("abc1234def")),
        ("".to_string(), "Detached HEAD (abc1234)".to_string())
    );
}

#[test]
fn branch_label_detached_no_commit() {
    assert_eq!(
        super::branch_label(None, None),
        ("".to_string(), "Detached HEAD".to_string())
    );
}

#[test]
fn branch_label_empty_branch_with_commit() {
    assert_eq!(
        super::branch_label(Some(""), Some("abc1234def")),
        ("".to_string(), "Detached HEAD (abc1234)".to_string())
    );
}

#[test]
fn branch_label_with_branch_no_commit() {
    assert_eq!(
        super::branch_label(Some("main"), None),
        ("main".to_string(), "main".to_string())
    );
}

#[test]
fn branch_label_whitespace_only_branch_treated_empty() {
    assert_eq!(
        super::branch_label(Some("   "), Some("abc1234def")),
        ("".to_string(), "Detached HEAD (abc1234)".to_string())
    );
}

// ---------------------------------------------------------------------------
// 7. commit_items
// ---------------------------------------------------------------------------

#[test]
fn commit_items_converts_with_defaults() {
    let items = vec![CommitItem {
        id: "abc123".to_string(),
        msg: "fix bug".to_string(),
        meta: "2024-01-01".to_string(),
        author: "dev".to_string(),
    }];
    let result = super::commit_items(items);
    assert_eq!(result.len(), 1);
    assert_eq!(result[0].id, "abc123");
    assert_eq!(result[0].msg, "fix bug");
    assert_eq!(result[0].meta, "2024-01-01");
    assert_eq!(result[0].author, "dev");
    assert!(!result[0].incoming);
    assert!(result[0].remote_ref.is_none());
}

#[test]
fn commit_items_empty_returns_empty() {
    let result = super::commit_items(vec![]);
    assert!(result.is_empty());
}

#[test]
fn commit_items_multiple_all_set() {
    let items: Vec<CommitItem> = (0..3)
        .map(|i| CommitItem {
            id: format!("id{i}"),
            msg: format!("msg{i}"),
            meta: format!("meta{i}"),
            author: format!("author{i}"),
        })
        .collect();
    let result = super::commit_items(items);
    assert_eq!(result.len(), 3);
    for (i, item) in result.iter().enumerate() {
        assert_eq!(item.id, format!("id{i}"));
        assert!(!item.incoming);
        assert!(item.remote_ref.is_none());
    }
}

// ---------------------------------------------------------------------------
// 8. dedupe_commits
// ---------------------------------------------------------------------------

fn sc(id: &str, msg: &str) -> super::SnapshotCommitItem {
    super::SnapshotCommitItem {
        id: id.to_string(),
        msg: msg.to_string(),
        meta: "".to_string(),
        author: "".to_string(),
        incoming: false,
        remote_ref: None,
    }
}

#[test]
fn dedupe_commits_removes_duplicates_by_id() {
    let items = vec![sc("abc", "first"), sc("abc", "second"), sc("def", "third")];
    let result = super::dedupe_commits(items);
    assert_eq!(result.len(), 2);
    assert_eq!(result[0].id, "abc");
    assert_eq!(result[0].msg, "first");
    assert_eq!(result[1].id, "def");
}

#[test]
fn dedupe_commits_skips_empty_ids() {
    let items = vec![sc("", "empty"), sc("abc", "valid")];
    let result = super::dedupe_commits(items);
    assert_eq!(result.len(), 1);
    assert_eq!(result[0].id, "abc");
}

#[test]
fn dedupe_commits_preserves_order_of_first_occurrence() {
    let items = vec![sc("b", ""), sc("a", ""), sc("b", ""), sc("c", "")];
    let result = super::dedupe_commits(items);
    assert_eq!(result.len(), 3);
    assert_eq!(result[0].id, "b");
    assert_eq!(result[1].id, "a");
    assert_eq!(result[2].id, "c");
}

#[test]
fn dedupe_commits_empty_returns_empty() {
    let result = super::dedupe_commits(vec![]);
    assert!(result.is_empty());
}

// ---------------------------------------------------------------------------
// 9. is_conflict_status (additional edge cases)
// ---------------------------------------------------------------------------

#[test]
fn is_conflict_status_non_conflict_porcelain_codes() {
    assert!(!super::is_conflict_status("M"));
    assert!(!super::is_conflict_status("A"));
    assert!(!super::is_conflict_status("D"));
    assert!(!super::is_conflict_status("R"));
    assert!(!super::is_conflict_status("C"));
    assert!(!super::is_conflict_status("?"));
    assert!(!super::is_conflict_status("!"));
}

#[test]
fn is_conflict_status_empty_string_is_false() {
    assert!(!super::is_conflict_status(""));
}

// ---------------------------------------------------------------------------
// 10. RepoSnapshot struct
// ---------------------------------------------------------------------------

#[test]
fn repo_snapshot_all_fields_accessible() {
    let snapshot = super::RepoSnapshot {
        has_repo: true,
        repo_path: "/test/repo".to_string(),
        branch: "main".to_string(),
        branch_label: "main".to_string(),
        branches: vec![],
        files: vec![],
        commits: vec![],
        stash: vec![],
        ahead: 5,
        behind: 3,
        branch_on_remote: true,
        current_upstream: None,
        merge_in_progress: false,
        seen_conflicts: vec![],
        conflict_statuses: vec![],
        vcs_action_labels: HashMap::new(),
        ahead_ids: vec!["abc123".to_string()],
        revision: "rev1".to_string(),
    };
    assert!(snapshot.has_repo);
    assert_eq!(snapshot.repo_path, "/test/repo");
    assert_eq!(snapshot.branch, "main");
    assert_eq!(snapshot.ahead, 5);
    assert_eq!(snapshot.behind, 3);
    assert!(snapshot.branch_on_remote);
    assert!(!snapshot.merge_in_progress);
    assert_eq!(snapshot.ahead_ids, vec!["abc123"]);
    assert_eq!(snapshot.revision, "rev1");
}

// ---------------------------------------------------------------------------
// 11. SnapshotCommitItem struct
// ---------------------------------------------------------------------------

#[test]
fn snapshot_commit_item_serialization_with_remote_ref() {
    let item = super::SnapshotCommitItem {
        id: "abc123".to_string(),
        msg: "fix bug".to_string(),
        meta: "2024".to_string(),
        author: "dev".to_string(),
        incoming: true,
        remote_ref: Some("origin/main".to_string()),
    };
    let json = serde_json::to_value(&item).unwrap();
    assert_eq!(json["id"], "abc123");
    assert_eq!(json["msg"], "fix bug");
    assert_eq!(json["meta"], "2024");
    assert_eq!(json["author"], "dev");
    assert_eq!(json["incoming"], true);
    assert_eq!(json["remoteRef"], "origin/main");
}

#[test]
fn snapshot_commit_item_serialization_skips_none_remote_ref() {
    let item = super::SnapshotCommitItem {
        id: "abc".to_string(),
        msg: "msg".to_string(),
        meta: "meta".to_string(),
        author: "author".to_string(),
        incoming: false,
        remote_ref: None,
    };
    let json = serde_json::to_value(&item).unwrap();
    assert_eq!(json["incoming"], false);
    // remoteRef should be absent when None (skip_serializing_if)
    assert!(json.get("remoteRef").is_none());
}

// ---------------------------------------------------------------------------
// 12. SnapshotRevisionParts struct
// ---------------------------------------------------------------------------

#[test]
fn snapshot_revision_parts_construction() {
    let parts = super::SnapshotRevisionParts {
        repo_path: "/repo",
        branch_label: "main",
        head_commit: Some("abc"),
        file_count: 10,
        commit_count: 20,
        ahead: 1,
        behind: 2,
        stash_count: 3,
        merge_in_progress: true,
        branch_on_remote: false,
        branch_count: 5,
        current_upstream: None,
    };
    assert_eq!(parts.repo_path, "/repo");
    assert_eq!(parts.head_commit, Some("abc"));
    assert_eq!(parts.file_count, 10);
    assert_eq!(parts.commit_count, 20);
    assert_eq!(parts.ahead, 1);
    assert_eq!(parts.behind, 2);
    assert_eq!(parts.stash_count, 3);
    assert!(parts.merge_in_progress);
    assert!(!parts.branch_on_remote);
    assert_eq!(parts.branch_count, 5);
    assert_eq!(parts.current_upstream, None);
}

// ---------------------------------------------------------------------------
// 13. current_upstream snapshot plumbing
// ---------------------------------------------------------------------------

/// Minimal VCS backend whose `branch_upstream` override drives snapshot fields.
struct UpstreamMockVcs {
    current_branch: Option<String>,
    upstream: Option<String>,
}

impl UpstreamMockVcs {
    fn new(current_branch: Option<String>, upstream: Option<String>) -> Self {
        Self {
            current_branch,
            upstream,
        }
    }

    fn unsupported<T>(&self) -> Result<T, VcsError> {
        Err(VcsError::Unsupported(self.id()))
    }
}

impl Vcs for UpstreamMockVcs {
    fn id(&self) -> BackendId {
        BackendId::from("snapshot-test")
    }

    fn workdir(&self) -> &Path {
        Path::new("/repo")
    }

    fn current_branch(&self) -> Result<Option<String>, VcsError> {
        Ok(self.current_branch.clone())
    }

    fn branches(&self) -> Result<Vec<models::BranchItem>, VcsError> {
        Ok(vec![])
    }

    fn create_branch(&self, _: &str, _: bool) -> Result<(), VcsError> {
        self.unsupported()
    }
    fn checkout_branch(&self, _: &str) -> Result<(), VcsError> {
        self.unsupported()
    }
    fn ensure_remote(&self, _: &str, _: &str) -> Result<(), VcsError> {
        self.unsupported()
    }
    fn list_remotes(&self) -> Result<Vec<(String, String)>, VcsError> {
        self.unsupported()
    }
    fn remove_remote(&self, _: &str) -> Result<(), VcsError> {
        self.unsupported()
    }
    fn fetch(&self, _: &str, _: &str, _: Option<models::OnEvent>) -> Result<(), VcsError> {
        self.unsupported()
    }
    fn push(&self, _: &str, _: &str, _: Option<models::OnEvent>) -> Result<(), VcsError> {
        self.unsupported()
    }
    fn pull_ff_only(&self, _: &str, _: &str, _: Option<models::OnEvent>) -> Result<(), VcsError> {
        self.unsupported()
    }
    fn commit(&self, _: &str, _: &str, _: &str, _: &[PathBuf]) -> Result<String, VcsError> {
        self.unsupported()
    }
    fn commit_index(&self, _: &str, _: &str, _: &str) -> Result<String, VcsError> {
        self.unsupported()
    }
    fn status_payload(&self) -> Result<models::StatusPayload, VcsError> {
        Ok(models::StatusPayload {
            ahead: 0,
            behind: 0,
            files: vec![],
            branch_on_remote: self.upstream.is_some(),
        })
    }
    fn log_commits(&self, _: &models::LogQuery) -> Result<Vec<models::CommitItem>, VcsError> {
        Ok(vec![])
    }
    fn diff_file(&self, _: &Path) -> Result<models::DiffFileResult, VcsError> {
        self.unsupported()
    }
    fn diff_commit(&self, _: &str) -> Result<Vec<String>, VcsError> {
        self.unsupported()
    }
    fn stage_patch(&self, _: &str) -> Result<(), VcsError> {
        self.unsupported()
    }
    fn stage_paths(&self, _: &[PathBuf]) -> Result<(), VcsError> {
        self.unsupported()
    }
    fn discard_paths(&self, _: &[PathBuf]) -> Result<(), VcsError> {
        self.unsupported()
    }
    fn apply_reverse_patch(&self, _: &str) -> Result<(), VcsError> {
        self.unsupported()
    }
    fn delete_branch(&self, _: &str, _: bool) -> Result<(), VcsError> {
        self.unsupported()
    }
    fn rename_branch(&self, _: &str, _: &str) -> Result<(), VcsError> {
        self.unsupported()
    }
    fn merge_into_current(&self, _: &str) -> Result<(), VcsError> {
        self.unsupported()
    }
    fn get_identity(&self) -> Result<Option<(String, String)>, VcsError> {
        self.unsupported()
    }
    fn set_identity_local(&self, _: &str, _: &str) -> Result<(), VcsError> {
        self.unsupported()
    }

    fn branch_upstream(&self, _branch: &str) -> Result<Option<String>, VcsError> {
        Ok(self.upstream.clone())
    }
}

fn register_snapshot_test_backend() {
    let desc = PluginBackendDescriptor {
        backend_id: BackendId::from("snapshot-test"),
        backend_name: Some("Snapshot Test VCS".into()),
        action_labels: BTreeMap::new(),
        plugin_id: "test.snapshot-test".into(),
        plugin_name: Some("Snapshot Test Plugin".into()),
    };
    plugin_vcs_backends::store_backends(vec![desc]);
}

fn build_snapshot_app(vcs: Arc<UpstreamMockVcs>) -> tauri::App<tauri::test::MockRuntime> {
    crate::app_identity::setup_test_isolation();
    let repo = Arc::new(Repo::new(vcs.clone() as Arc<dyn Vcs>));
    let mut cfg = settings::AppConfig::default();
    cfg.plugins.enabled = vec!["test.snapshot-test".into()];
    let app_state = AppState::new_with_config(cfg);
    app_state.set_current_repo(repo);

    mock_builder()
        .manage(app_state)
        .invoke_handler(tauri::generate_handler![super::get_repo_snapshot])
        .build(mock_context(noop_assets()))
        .expect("build snapshot test app")
}

fn fetch_snapshot(vcs: Arc<UpstreamMockVcs>) -> serde_json::Value {
    register_snapshot_test_backend();
    let app = build_snapshot_app(vcs);
    let webview = WebviewWindowBuilder::new(&app, "main", Default::default())
        .build()
        .expect("build snapshot test webview");
    let res = get_ipc_response(
        &webview,
        InvokeRequest {
            cmd: "get_repo_snapshot".into(),
            callback: tauri::ipc::CallbackFn(0),
            error: tauri::ipc::CallbackFn(1),
            url: "tauri://localhost".parse().unwrap(),
            body: InvokeBody::default(),
            headers: Default::default(),
            invoke_key: INVOKE_KEY.to_string(),
        },
    )
    .expect("get_repo_snapshot should succeed");
    res.deserialize().expect("deserialize snapshot")
}

#[test]
fn current_upstream_present() {
    let snapshot = fetch_snapshot(Arc::new(UpstreamMockVcs::new(
        Some("main".into()),
        Some("origin/main".into()),
    )));
    assert_eq!(snapshot["branch"], "main");
    assert_eq!(snapshot["current_upstream"], "origin/main");
}

#[test]
fn current_upstream_none_detached() {
    let detached = fetch_snapshot(Arc::new(UpstreamMockVcs::new(
        None,
        Some("origin/main".into()),
    )));
    assert_eq!(detached["branch"], "");
    assert!(detached["current_upstream"].is_null());

    let untracked = fetch_snapshot(Arc::new(UpstreamMockVcs::new(Some("main".into()), None)));
    assert!(untracked["current_upstream"].is_null());
}

#[test]
fn revision_changes_when_upstream_changes() {
    fn make(current_upstream: Option<&str>) -> String {
        super::build_repo_snapshot_revision(&super::SnapshotRevisionParts {
            repo_path: "/repo",
            branch_label: "main",
            head_commit: Some("abc123"),
            file_count: 3,
            commit_count: 10,
            ahead: 1,
            behind: 2,
            stash_count: 1,
            merge_in_progress: false,
            branch_on_remote: true,
            branch_count: 5,
            current_upstream,
        })
    }
    assert_ne!(make(Some("origin/main")), make(None));
    assert_ne!(make(Some("origin/main")), make(Some("upstream/main")));
}
