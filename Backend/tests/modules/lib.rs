// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

use std::path::PathBuf;

use super::{first_existing_recent_repo, local_dotenv_path, resolve_preferred_backend_id};
use crate::core::BackendId;

#[test]
fn builds_local_dotenv_path_relative_to_workspace_root() {
    let path = local_dotenv_path();
    assert!(path.ends_with(PathBuf::from("../.env")));
}

#[test]
fn prefers_configured_backend_when_available() {
    let available = vec![BackendId::from("openvcs.git"), BackendId::from("zeta")];
    let resolved = resolve_preferred_backend_id("openvcs.git", &available);
    assert_eq!(resolved.map(|backend| backend.as_ref().to_string()), Some("openvcs.git".into()));
}

#[test]
fn falls_back_to_sorted_backend_when_default_missing() {
    let available = vec![BackendId::from("zeta"), BackendId::from("alpha")];
    let resolved = resolve_preferred_backend_id("missing", &available);
    assert_eq!(resolved.map(|backend| backend.as_ref().to_string()), Some("alpha".into()));
}

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
