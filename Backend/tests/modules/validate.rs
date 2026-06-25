// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

use super::{looks_like_path, validate_add_path,
    validate_clone_input, validate_vcs_url};
use std::fs;

#[test]
/// Verifies any non-empty URL passes validation (plugin validates format).
fn accepts_any_non_empty_url() {
    assert!(validate_vcs_url("https://github.com/openvcs/openvcs".into()).ok);
    assert!(validate_vcs_url("https://github.com/openvcs/openvcs.git".into()).ok);
    assert!(validate_vcs_url("ssh://git@example.com/openvcs/openvcs".into()).ok);
    assert!(validate_vcs_url("git@example.com:openvcs/openvcs".into()).ok);
    assert!(validate_vcs_url("lore://some/path".into()).ok);
    assert!(validate_vcs_url("my-vcs://custom/url".into()).ok);
}

#[test]
/// Verifies empty strings are rejected.
fn rejects_empty_urls() {
    assert!(!validate_vcs_url("".into()).ok);
    assert!(!validate_vcs_url("   ".into()).ok);
}

#[test]
/// Verifies add/open path validation accepts any directory (backend decides validity).
fn validates_add_paths_against_filesystem_state() {
    let dir = tempfile::tempdir().expect("create temp dir");
    let repo_dir = dir.path().join("repo");
    fs::create_dir_all(&repo_dir).expect("create dir");

    // Any directory is a valid add target — the backend plugin determines
    // whether it contains a recognizable repository.
    assert!(validate_add_path(repo_dir.to_string_lossy().into()).ok);

    let err = validate_add_path("relative/path".into());
    assert!(!err.ok);
    assert_eq!(err.reason.as_deref(), Some("Enter an absolute path"));

    let err = validate_add_path(dir.path().join("missing").to_string_lossy().into());
    assert!(!err.ok);
    assert!(err.reason.as_deref().unwrap_or_default().contains("does not exist"));

    let file_path = dir.path().join("file.txt");
    fs::write(&file_path, "x").expect("write file");
    let err = validate_add_path(file_path.to_string_lossy().into());
    assert!(!err.ok);
    assert!(err.reason.as_deref().unwrap_or_default().contains("Not a directory"));
}

#[test]
/// Verifies clone validation handles URL, destination, and backend delegates repo checks.
fn validates_clone_inputs() {
    let dir = tempfile::tempdir().expect("create temp dir");

    let ok = validate_clone_input(
        "https://github.com/openvcs/openvcs".into(),
        dir.path().join("new-repo").to_string_lossy().into(),
    );
    assert!(ok.ok);

    let err = validate_clone_input("".into(), dir.path().join("x").to_string_lossy().into());
    assert!(!err.ok);
    assert_eq!(err.reason.as_deref(), Some("Enter a repository URL"));

    let err = validate_clone_input("https://github.com/openvcs/openvcs".into(), "relative/path".into());
    assert!(!err.ok);
    assert_eq!(err.reason.as_deref(), Some("Destination must be an absolute path"));

    // Destination with an existing .git marker is no longer rejected at the
    // validation layer — the selected VCS backend plugin decides.
    let existing_dir = dir.path().join("existing-dir");
    fs::create_dir_all(existing_dir.join(".git")).expect("create dir");
    let ok = validate_clone_input(
        "https://github.com/openvcs/openvcs".into(),
        existing_dir.to_string_lossy().into(),
    );
    assert!(ok.ok, "clone into existing dir should pass validation (backend decides)");
}

#[test]
fn detects_absolute_path_shapes() {
    assert!(looks_like_path("/tmp/openvcs"));
    assert!(looks_like_path("~/openvcs"));
    assert!(looks_like_path("C:\\OpenVCS"));
    assert!(looks_like_path("c:/OpenVCS"));
    assert!(!looks_like_path("relative/path"));
    assert!(!looks_like_path(""));
}
