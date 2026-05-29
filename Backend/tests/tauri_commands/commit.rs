// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

use super::{build_commit_message, has_commit_selection, trimmed_non_empty};

#[test]
fn builds_commit_messages_with_optional_descriptions() {
    assert_eq!(build_commit_message("Summary", ""), "Summary");
    assert_eq!(build_commit_message("Summary", "   "), "Summary");
    assert_eq!(
        build_commit_message("Summary", "Body text"),
        "Summary\n\nBody text"
    );
}

#[test]
fn detects_when_commit_selection_exists() {
    assert!(!has_commit_selection("", 0, 0));
    assert!(!has_commit_selection("   ", 0, 0));
    assert!(has_commit_selection("patch", 0, 0));
    assert!(has_commit_selection("", 1, 0));
    assert!(has_commit_selection("", 0, 1));
}

#[test]
fn trims_non_empty_inputs_or_reports_errors() {
    assert_eq!(trimmed_non_empty("  git  ", "bad").expect("trimmed"), "git");
    assert_eq!(trimmed_non_empty("git", "bad").expect("trimmed"), "git");
    assert_eq!(trimmed_non_empty("   ", "bad").expect_err("error"), "bad");
}
