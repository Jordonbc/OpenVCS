// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

use std::path::PathBuf;

use super::{first_existing_recent_repo, load_local_dotenv, local_dotenv_path};
use crate::state::RecentEntry;

// ── local_dotenv_path tests ────────────────────────────────────────────────

#[test]
fn dotenv_path_resolves_to_backend_parent() {
    let path = local_dotenv_path();
    assert!(path.ends_with(PathBuf::from("../.env")));
}

// ── first_existing_recent_repo tests ───────────────────────────────────────

fn entry(path: std::path::PathBuf) -> RecentEntry {
    RecentEntry { path, backend_id: "git".into() }
}

#[test]
fn finds_first_existing_recent_repo() {
    let temp = tempfile::tempdir().expect("temp dir");
    let existing = temp.path().join("repo");
    std::fs::create_dir(&existing).expect("create repo dir");

    let selected = first_existing_recent_repo(&[
        entry(temp.path().join("missing")),
        entry(existing.clone()),
        entry(temp.path().join("later")),
    ]);

    assert_eq!(selected, Some(entry(existing)));
}

#[test]
fn returns_none_for_empty_repo_list() {
    let selected = first_existing_recent_repo(&[]);
    assert!(selected.is_none());
}

#[test]
fn returns_none_when_no_repos_exist() {
    let temp = tempfile::tempdir().expect("temp dir");
    let selected = first_existing_recent_repo(&[
        entry(temp.path().join("missing1")),
        entry(temp.path().join("missing2")),
    ]);
    assert!(selected.is_none());
}

#[test]
fn first_existing_repo_skips_nonexistent_then_finds_match() {
    let temp = tempfile::tempdir().expect("temp dir");
    let existing = temp.path().join("real_repo");
    std::fs::create_dir(&existing).expect("create repo dir");

    let selected = first_existing_recent_repo(&[
        entry(temp.path().join("ghost")),
        entry(temp.path().join("phantom")),
        entry(existing.clone()),
    ]);

    assert_eq!(selected, Some(entry(existing)));
}

// ── load_local_dotenv tests ─────────────────────────────────────────────────

#[test]
fn load_local_dotenv_silently_ignores_missing_file() {
    // The function should not panic when there is no .env file.
    // This tests the `NotFound` error handling path.
    load_local_dotenv();
}
