// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

use super::{
    host_from_remote_url, looks_like_ff_only_divergence, looks_like_ssh_auth_failure,
    looks_like_unknown_host_key,
};

#[test]
fn parses_host_from_remote_urls() {
    assert_eq!(host_from_remote_url("git@github.com:org/repo.git"), Some("github.com".into()));
    assert_eq!(host_from_remote_url("ssh://git@example.com/org/repo"), Some("example.com".into()));
    assert_eq!(host_from_remote_url("https://example.com/org/repo"), Some("example.com".into()));
    assert_eq!(host_from_remote_url("http://insecure.example.com/org/repo"), Some("insecure.example.com".into()));
}

#[test]
fn rejects_unparseable_remote_urls() {
    assert!(host_from_remote_url("").is_none());
    assert!(host_from_remote_url("not a url").is_none());
    assert!(host_from_remote_url("ssh://").is_none());
}

#[test]
fn detects_unknown_host_key_errors() {
    assert!(looks_like_unknown_host_key(
        "The authenticity of host 'github.com (140.82.121.4)' can't be established."
    ));
    assert!(looks_like_unknown_host_key("Strict host key checking failed"));
    assert!(!looks_like_unknown_host_key("permission denied (publickey)"));
}

#[test]
fn detects_ssh_authentication_failures() {
    assert!(looks_like_ssh_auth_failure("Permission denied (publickey)."));
    assert!(looks_like_ssh_auth_failure("Authentication failed for 'git'"));
    assert!(!looks_like_ssh_auth_failure("host key verification failed"));
}

#[test]
fn detects_fast_forward_only_divergence() {
    assert!(looks_like_ff_only_divergence(
        "fatal: Not possible to fast-forward, aborting."
    ));
    assert!(looks_like_ff_only_divergence("Cannot be fast-forwarded because branches diverged"));
    assert!(!looks_like_ff_only_divergence("permission denied (publickey)"));
}
