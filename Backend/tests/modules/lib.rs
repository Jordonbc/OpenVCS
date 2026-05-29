// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

use std::path::PathBuf;

use super::{first_existing_recent_repo, load_local_dotenv, local_dotenv_path, resolve_preferred_backend_id};
use crate::core::BackendId;

// ── local_dotenv_path tests ────────────────────────────────────────────────

#[test]
fn dotenv_path_resolves_to_backend_parent() {
    let path = local_dotenv_path();
    assert!(path.ends_with(PathBuf::from("../.env")));
}

// ── resolve_preferred_backend_id tests ──────────────────────────────────────

#[test]
fn prefers_configured_backend_when_available() {
    let available = vec![BackendId::from("openvcs.git"), BackendId::from("zeta")];
    let resolved = resolve_preferred_backend_id("openvcs.git", &available);
    assert_eq!(
        resolved.map(|backend| backend.as_ref().to_string()),
        Some("openvcs.git".into())
    );
}

#[test]
fn falls_back_to_sorted_backend_when_default_missing() {
    let available = vec![BackendId::from("zeta"), BackendId::from("alpha")];
    let resolved = resolve_preferred_backend_id("missing", &available);
    assert_eq!(
        resolved.map(|backend| backend.as_ref().to_string()),
        Some("alpha".into())
    );
}

#[test]
fn returns_none_when_no_backends_available() {
    let available: Vec<BackendId> = vec![];
    let resolved = resolve_preferred_backend_id("git", &available);
    assert!(resolved.is_none());
}

#[test]
fn returns_first_sorted_when_configured_default_is_empty() {
    let available = vec![BackendId::from("zeta"), BackendId::from("alpha")];
    let resolved = resolve_preferred_backend_id("", &available);
    assert_eq!(
        resolved.map(|backend| backend.as_ref().to_string()),
        Some("alpha".into())
    );
}

#[test]
fn returns_none_when_configured_default_is_empty_and_no_backends() {
    let available: Vec<BackendId> = vec![];
    let resolved = resolve_preferred_backend_id("", &available);
    assert!(resolved.is_none());
}

// ── first_existing_recent_repo tests ───────────────────────────────────────

#[test]
fn finds_first_existing_recent_repo() {
    let temp = tempfile::tempdir().expect("temp dir");
    let existing = temp.path().join("repo");
    std::fs::create_dir(&existing).expect("create repo dir");

    let selected = first_existing_recent_repo(&[
        temp.path().join("missing"),
        existing.clone(),
        temp.path().join("later"),
    ]);

    assert_eq!(selected, Some(existing));
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
        temp.path().join("missing1"),
        temp.path().join("missing2"),
    ]);
    assert!(selected.is_none());
}

// ── load_local_dotenv tests ─────────────────────────────────────────────────

#[test]
fn load_local_dotenv_silently_ignores_missing_file() {
    // The function should not panic when there is no .env file.
    // This tests the `NotFound` error handling path.
    load_local_dotenv();
}
