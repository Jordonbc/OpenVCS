// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

use std::path::Path;

use super::{
    browse_directory_title, infer_repo_dir_from_url, recent_repo_name, resolve_default_backend_id,
};
use crate::core::BackendId;

#[test]
fn infers_repo_directory_names() {
    assert_eq!(infer_repo_dir_from_url("https://example.com/org/repo.git"), "repo");
    assert_eq!(infer_repo_dir_from_url("git@example.com:org/repo"), "repo");
    assert_eq!(infer_repo_dir_from_url("https://example.com/org/repo/"), "repo");
}

#[test]
fn resolves_browse_directory_titles() {
    assert_eq!(browse_directory_title(Some("clone_dest")), "Choose destination folder");
    assert_eq!(browse_directory_title(Some("add_repo")), "Select an existing repository folder");
    assert_eq!(browse_directory_title(Some("other")), "Select a folder");
    assert_eq!(browse_directory_title(None), "Select a folder");
}

#[test]
fn resolves_default_backend_from_configured_or_sorted_available_values() {
    let available = vec![BackendId::from("zeta"), BackendId::from("alpha")];

    let configured = resolve_default_backend_id("zeta", &available)
        .map(|backend| backend.as_ref().to_string());
    assert_eq!(configured, Some("zeta".into()));

    let fallback = resolve_default_backend_id("missing", &available)
        .map(|backend| backend.as_ref().to_string());
    assert_eq!(fallback, Some("alpha".into()));
}

#[test]
fn derives_recent_repository_display_names() {
    assert_eq!(recent_repo_name(Path::new("/tmp/demo-repo")), Some("demo-repo".into()));
    assert_eq!(recent_repo_name(Path::new("/")), None);
}
