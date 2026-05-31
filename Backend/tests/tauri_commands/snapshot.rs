// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

#[test]
fn revision_bumps_when_stash_count_changes() {
    let base = super::build_repo_snapshot_revision(&super::SnapshotRevisionParts {
        repo_path: "/repo",
        branch_label: "main",
        head_commit: Some("abc123"),
        file_count: 3,
        commit_count: 10,
        ahead: 1,
        behind: 2,
        stash_count: 0,
    });
    let with_stash = super::build_repo_snapshot_revision(&super::SnapshotRevisionParts {
        repo_path: "/repo",
        branch_label: "main",
        head_commit: Some("abc123"),
        file_count: 3,
        commit_count: 10,
        ahead: 1,
        behind: 2,
        stash_count: 2,
    });

    assert_ne!(base, with_stash);
}

#[test]
fn conflict_status_matches_frontend_rules() {
    assert!(super::is_conflict_status("U"));
    assert!(super::is_conflict_status("UU"));
    assert!(super::is_conflict_status("AA"));
    assert!(super::is_conflict_status("DD"));
    assert!(!super::is_conflict_status("M"));
}
