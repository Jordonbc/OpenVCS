// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

use super::{
    has_url_path_segment, is_probably_vcs_url, looks_like_path, validate_add_path,
    validate_clone_input, validate_vcs_url,
};
use std::fs;

#[test]
/// Verifies common hosted HTTP clone URLs do not require `.git` suffixes.
fn accepts_http_clone_urls_without_git_suffix() {
    assert!(validate_vcs_url("https://github.com/openvcs/openvcs".into()).ok);
    assert!(validate_vcs_url("https://github.com/openvcs/openvcs.git".into()).ok);
}

#[test]
/// Verifies SSH clone URL forms do not require `.git` suffixes.
fn accepts_ssh_clone_urls_without_git_suffix() {
    assert!(validate_vcs_url("ssh://git@example.com/openvcs/openvcs".into()).ok);
    assert!(validate_vcs_url("git@example.com:openvcs/openvcs".into()).ok);
}

#[test]
/// Verifies host-only HTTP URLs are still rejected.
fn rejects_urls_without_repository_path() {
    assert!(!validate_vcs_url("https://github.com".into()).ok);
}

#[test]
/// Verifies add/open path validation accepts repositories and rejects bad paths.
fn validates_add_paths_against_filesystem_state() {
    let dir = tempfile::tempdir().expect("create temp dir");
    let repo_dir = dir.path().join("repo");
    fs::create_dir_all(repo_dir.join(".git")).expect("create git dir");

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
/// Verifies clone validation handles URL, destination, and repo collisions.
fn validates_clone_inputs() {
    let dir = tempfile::tempdir().expect("create temp dir");
    let repo_dir = dir.path().join("existing");
    fs::create_dir_all(repo_dir.join(".git")).expect("create repo dir");

    let ok = validate_clone_input(
        "https://github.com/openvcs/openvcs".into(),
        dir.path().join("new-repo").to_string_lossy().into(),
    );
    assert!(ok.ok);

    let err = validate_clone_input("not-a-url".into(), dir.path().join("x").to_string_lossy().into());
    assert!(!err.ok);
    assert_eq!(err.reason.as_deref(), Some("Invalid VCS URL"));

    let err = validate_clone_input("https://github.com/openvcs/openvcs".into(), "relative/path".into());
    assert!(!err.ok);
    assert_eq!(err.reason.as_deref(), Some("Destination must be an absolute path"));

    let err = validate_clone_input(
        "https://github.com/openvcs/openvcs".into(),
        repo_dir.to_string_lossy().into(),
    );
    assert!(!err.ok);
    assert_eq!(err.reason.as_deref(), Some("Destination already contains a repository"));
}

#[test]
fn detects_supported_vcs_url_shapes() {
    assert!(is_probably_vcs_url("https://github.com/openvcs/openvcs"));
    assert!(is_probably_vcs_url("https://github.com/openvcs/openvcs.git"));
    assert!(is_probably_vcs_url("ssh://git@example.com/openvcs/openvcs"));
    assert!(is_probably_vcs_url("git@example.com:openvcs/openvcs"));
    assert!(!is_probably_vcs_url("https://github.com"));
    assert!(!is_probably_vcs_url(""));
    assert!(!is_probably_vcs_url("not a url"));
}

#[test]
fn detects_url_path_segments_after_scheme_stripping() {
    assert!(has_url_path_segment("https://github.com/openvcs/openvcs", "https://"));
    assert!(has_url_path_segment("ssh://git@example.com/openvcs/openvcs", "ssh://"));
    assert!(!has_url_path_segment("https://github.com", "https://"));
    assert!(!has_url_path_segment("ssh://git@example.com/", "ssh://"));
    assert!(!has_url_path_segment("github.com/openvcs/openvcs", "https://"));
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
