// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

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
        })
    }

    assert_ne!(make(false), make(true));
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
