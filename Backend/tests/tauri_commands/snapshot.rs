// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

#[test]
fn revision_bumps_when_stash_count_changes() {
    let base = super::build_repo_snapshot_revision(
        "/repo",
        "main",
        Some("abc123"),
        3,
        10,
        1,
        2,
        0,
    );
    let with_stash = super::build_repo_snapshot_revision(
        "/repo",
        "main",
        Some("abc123"),
        3,
        10,
        1,
        2,
        2,
    );

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
