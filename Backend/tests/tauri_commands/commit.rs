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

#[test]
fn preserves_multiline_commit_descriptions() {
    assert_eq!(
        build_commit_message("Summary", "Line one\nLine two"),
        "Summary\n\nLine one\nLine two"
    );
}

#[test]
fn reports_empty_commit_selection_only_when_all_inputs_are_empty() {
    assert!(!has_commit_selection("\n\t", 0, 0));
    assert!(has_commit_selection("", 0, 2));
}

#[test]
fn returns_the_supplied_error_for_blank_inputs() {
    assert_eq!(
        trimmed_non_empty(" \n ", "summary required").expect_err("blank"),
        "summary required"
    );
}
