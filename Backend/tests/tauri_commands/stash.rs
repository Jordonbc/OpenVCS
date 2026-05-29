// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

use std::path::PathBuf;

use super::{
    include_untracked_or_default, stash_message_or_default, stash_paths,
    stash_selector_or_default,
};

#[test]
fn defaults_stash_message_and_include_untracked() {
    assert_eq!(stash_message_or_default(None), "WIP");
    assert_eq!(stash_message_or_default(Some("Save work".into())), "Save work");
    assert!(include_untracked_or_default(None));
    assert!(!include_untracked_or_default(Some(false)));
}

#[test]
fn converts_optional_stash_paths() {
    assert_eq!(stash_paths(None), Vec::<PathBuf>::new());
    assert_eq!(
        stash_paths(Some(vec!["src/lib.rs".into(), "README.md".into()])),
        vec![PathBuf::from("src/lib.rs"), PathBuf::from("README.md")]
    );
}

#[test]
fn defaults_missing_selectors_to_empty_strings() {
    assert_eq!(stash_selector_or_default(None), "");
    assert_eq!(stash_selector_or_default(Some("stash@{1}".into())), "stash@{1}");
}
