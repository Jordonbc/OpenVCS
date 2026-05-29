// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

use super::{apply_merge_template, repo_name_from_origin, repo_username_from_origin};

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
