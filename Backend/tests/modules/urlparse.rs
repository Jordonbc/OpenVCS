// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

use super::{
    host_from_remote_url, infer_repo_dir_from_url, parse_remote_url, repo_name_from_origin,
    repo_username_from_origin,
};

#[test]
/// Confirms scp-like remote URLs parse into host/owner/name components.
fn parses_scp_like_remote_urls() {
    let parts = parse_remote_url("git@github.com:org/repo.git");
    assert_eq!(parts.host, Some("github.com"));
    assert_eq!(parts.owner, Some("org"));
    assert_eq!(parts.name, Some("repo"));
    assert_eq!(
        host_from_remote_url("git@github.com:org/repo.git"),
        Some("github.com".into())
    );
    assert_eq!(
        repo_username_from_origin("git@github.com:org/repo.git"),
        Some("org".into())
    );
    assert_eq!(
        repo_name_from_origin("git@github.com:org/repo.git"),
        Some("repo".into())
    );
}

#[test]
/// Confirms https/http remote URLs parse into host/owner/name components.
fn parses_https_and_http_remote_urls() {
    let parts = parse_remote_url("https://example.com/org/repo.git");
    assert_eq!(parts.host, Some("example.com"));
    assert_eq!(parts.owner, Some("org"));
    assert_eq!(parts.name, Some("repo"));
    assert_eq!(
        host_from_remote_url("http://insecure.example.com/team/repo"),
        Some("insecure.example.com".into())
    );
    assert_eq!(
        repo_username_from_origin("http://example.com/team/repo"),
        Some("team".into())
    );
    assert_eq!(
        repo_name_from_origin("https://example.com/org/repo.git"),
        Some("repo".into())
    );
}

#[test]
/// Confirms ssh:// remote URLs parse into host/owner/name components.
fn parses_ssh_protocol_remote_urls() {
    let parts = parse_remote_url("ssh://git@example.com/org/repo");
    assert_eq!(parts.host, Some("example.com"));
    assert_eq!(parts.owner, Some("git@example.com"));
    assert_eq!(parts.name, Some("repo"));
    assert_eq!(
        host_from_remote_url("ssh://user@host.example.com/path"),
        Some("host.example.com".into())
    );
}

#[test]
/// Confirms unparseable URLs yield empty components.
fn rejects_unparseable_remote_urls() {
    let parts = parse_remote_url("   ");
    assert_eq!(parts.host, None);
    assert_eq!(parts.owner, None);
    assert_eq!(parts.name, None);
    assert!(host_from_remote_url("not a url").is_none());
    assert!(repo_username_from_origin("owner-only").is_none());
    assert!(repo_name_from_origin("owner-only").is_none());
}

#[test]
/// Confirms the clone target folder name is inferred from any URL form.
fn infers_repo_dir_from_any_remote_url_form() {
    assert_eq!(infer_repo_dir_from_url("https://example.com/org/repo.git"), "repo");
    assert_eq!(infer_repo_dir_from_url("git@example.com:org/repo"), "repo");
    assert_eq!(infer_repo_dir_from_url("ssh://git@example.com/org/repo/"), "repo");
    assert_eq!(infer_repo_dir_from_url("https://example.com/a/b/repo"), "repo");
}
