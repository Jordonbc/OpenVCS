// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

use super::{
    host_from_remote_url, looks_like_ff_only_divergence, looks_like_ssh_auth_failure,
    looks_like_unknown_host_key, remote_url_for, PullResult,
};

// ── host_from_remote_url ──

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
fn host_from_remote_url_ssh_empty_host_after_at() {
    // git@ with colon before host — empty host between @ and :
    assert_eq!(host_from_remote_url("git@:org/repo"), None);
}

#[test]
fn host_from_remote_url_ssh_protocol_no_host() {
    // ssh:///path: rest="/path", trimmed→"path", no @→after_user="path", split('/')→"path"
    // The function treats the first path segment as the host when there's no user@host
    assert_eq!(host_from_remote_url("ssh:///path"), Some("path".into()));
    // ssh:/// with trailing slash: rest="/", trimmed→"", empty host → None
    assert_eq!(host_from_remote_url("ssh:///"), None);
}

#[test]
fn host_from_remote_url_ssh_protocol_user_no_host() {
    // ssh://user@ with nothing after @
    assert_eq!(host_from_remote_url("ssh://user@"), None);
    assert_eq!(host_from_remote_url("ssh://user@/"), None);
}

#[test]
fn host_from_remote_url_http_trailing_slash() {
    assert_eq!(host_from_remote_url("http://example.com/"), Some("example.com".into()));
    assert_eq!(host_from_remote_url("https://example.com/"), Some("example.com".into()));
}

#[test]
fn host_from_remote_url_with_port() {
    assert_eq!(host_from_remote_url("https://example.com:8080/org/repo"), Some("example.com:8080".into()));
    assert_eq!(host_from_remote_url("http://localhost:3000/repo"), Some("localhost:3000".into()));
}

#[test]
fn host_from_remote_url_git_colon_no_path() {
    assert_eq!(host_from_remote_url("git@github.com:"), Some("github.com".into()));
}

#[test]
fn host_from_remote_url_ssh_user_at() {
    assert_eq!(host_from_remote_url("ssh://git@github.com/org/repo"), Some("github.com".into()));
    assert_eq!(host_from_remote_url("ssh://user@host.example.com/path"), Some("host.example.com".into()));
}

#[test]
fn host_from_remote_url_empty_after_at() {
    // Only the @ sign, nothing after
    assert_eq!(host_from_remote_url("git@"), None);
}

#[test]
fn host_from_remote_url_with_whitespace() {
    assert_eq!(host_from_remote_url("  git@github.com:org/repo  "), Some("github.com".into()));
    assert_eq!(host_from_remote_url("\t https://example.com/org/repo \t"), Some("example.com".into()));
}

#[test]
fn host_from_remote_url_http_no_host() {
    assert_eq!(host_from_remote_url("https://"), None);
    assert_eq!(host_from_remote_url("http://"), None);
}

#[test]
fn host_from_remote_url_just_at_sign() {
    // "@" alone: find('@') at pos 0, rest is "", no colon → hits ssh:///https checks, both fail
    assert_eq!(host_from_remote_url("@"), None);
}

#[test]
fn host_from_remote_url_git_at_no_colon_but_slash() {
    // "git@github.com/org/repo" — no colon, but has slash after @
    // find('@') gives rest="github.com/org/repo", no colon → goes to ssh/https checks
    // It won't match ssh:// or https:// prefix, returns None
    assert_eq!(host_from_remote_url("git@github.com/org/repo"), None);
}

// ── looks_like_unknown_host_key ──

#[test]
fn detects_unknown_host_key_errors() {
    assert!(looks_like_unknown_host_key(
        "The authenticity of host 'github.com (140.82.121.4)' can't be established."
    ));
    assert!(looks_like_unknown_host_key("Strict host key checking failed"));
    assert!(!looks_like_unknown_host_key("permission denied (publickey)"));
}

#[test]
fn looks_like_unknown_host_key_all_phrases() {
    assert!(looks_like_unknown_host_key("the authenticity of host 'server' is unknown"));
    assert!(looks_like_unknown_host_key("THE AUTHENTICITY OF HOST can't be established"));
    assert!(looks_like_unknown_host_key("Host key verification failed"));
    assert!(looks_like_unknown_host_key("HOST KEY VERIFICATION FAILED"));
    assert!(looks_like_unknown_host_key("no hostkey alg"));
    assert!(looks_like_unknown_host_key("No Hostkey Alg available"));
    assert!(looks_like_unknown_host_key("could not resolve hostname"));
    assert!(looks_like_unknown_host_key("Could Not Resolve Hostname for server"));
    assert!(looks_like_unknown_host_key("warning: known_hosts file is missing"));
    assert!(looks_like_unknown_host_key("KNOWN_HOSTS verification"));
    assert!(looks_like_unknown_host_key("strict host key checking is enabled"));
}

#[test]
fn looks_like_unknown_host_key_non_matches() {
    assert!(!looks_like_unknown_host_key(""));
    assert!(!looks_like_unknown_host_key("host"));
    assert!(!looks_like_unknown_host_key("key"));
    assert!(!looks_like_unknown_host_key("verification"));
    assert!(!looks_like_unknown_host_key("authenticity"));
    assert!(!looks_like_unknown_host_key("hostname"));
    assert!(!looks_like_unknown_host_key("could not resolve"));
}

// ── looks_like_ssh_auth_failure ──

#[test]
fn detects_ssh_authentication_failures() {
    assert!(looks_like_ssh_auth_failure("Permission denied (publickey)."));
    assert!(looks_like_ssh_auth_failure("Authentication failed for 'git'"));
    assert!(!looks_like_ssh_auth_failure("host key verification failed"));
}

#[test]
fn looks_like_ssh_auth_failure_all_phrases() {
    assert!(looks_like_ssh_auth_failure("permission denied"));
    assert!(looks_like_ssh_auth_failure("PERMISSION DENIED (publickey)"));
    assert!(looks_like_ssh_auth_failure("publickey authentication error"));
    assert!(looks_like_ssh_auth_failure("PUBLICKEY"));
    assert!(looks_like_ssh_auth_failure("could not read from remote repository"));
    assert!(looks_like_ssh_auth_failure("Could Not Read From Remote Repository"));
    assert!(looks_like_ssh_auth_failure("authentication failed"));
    assert!(looks_like_ssh_auth_failure("Authentication Failed for user"));
}

#[test]
fn looks_like_ssh_auth_failure_non_matches() {
    assert!(!looks_like_ssh_auth_failure(""));
    assert!(!looks_like_ssh_auth_failure("permission"));
    assert!(!looks_like_ssh_auth_failure("denied"));
    assert!(!looks_like_ssh_auth_failure("public"));
    assert!(!looks_like_ssh_auth_failure("key"));
    assert!(!looks_like_ssh_auth_failure("authentication"));
    assert!(!looks_like_ssh_auth_failure("could not read from"));
    assert!(!looks_like_ssh_auth_failure("read from remote repository"));
}

// ── looks_like_ff_only_divergence ──

#[test]
fn detects_fast_forward_only_divergence() {
    assert!(looks_like_ff_only_divergence(
        "fatal: Not possible to fast-forward, aborting."
    ));
    assert!(looks_like_ff_only_divergence("Cannot be fast-forwarded because branches diverged"));
    assert!(!looks_like_ff_only_divergence("permission denied (publickey)"));
}

#[test]
fn looks_like_ff_only_divergence_all_phrases() {
    assert!(looks_like_ff_only_divergence("not possible to fast-forward"));
    assert!(looks_like_ff_only_divergence("NOT POSSIBLE TO FAST-FORWARD"));
    assert!(looks_like_ff_only_divergence("can't be fast-forwarded"));
    assert!(looks_like_ff_only_divergence("Can't Be Fast-Forwarded"));
    assert!(looks_like_ff_only_divergence("cannot be fast-forwarded"));
    assert!(looks_like_ff_only_divergence("Cannot Be Fast-Forwarded"));
    // Combined condition: both "fast-forward" and "diverg"
    assert!(looks_like_ff_only_divergence("fast-forward failed: branches have diverged"));
    assert!(looks_like_ff_only_divergence("diverged; cannot fast-forward"));
}

#[test]
fn looks_like_ff_only_divergence_needs_both_keywords() {
    // "fast-forward" alone without "diverg" should NOT match (the first 3 phrases
    // already cover standalone patterns, but the 4th requires both)
    assert!(!looks_like_ff_only_divergence("fast-forward only"));
    // "diverg" alone without "fast-forward" should NOT match
    assert!(!looks_like_ff_only_divergence("branches have diverged"));
    // Neither keyword
    assert!(!looks_like_ff_only_divergence(""));
    assert!(!looks_like_ff_only_divergence("permission denied"));
}

#[test]
fn looks_like_ff_only_divergence_boundary_cases() {
    // "diverging" contains "diverg" → should match when combined with "fast-forward"
    assert!(looks_like_ff_only_divergence("fast-forward failed: diverging branches"));
    // "divergent" contains "diverg" → should match
    assert!(looks_like_ff_only_divergence("divergent branches; cannot fast-forward"));
}

// ── remote_url_for ──

use std::path::{Path, PathBuf};
use crate::core::{BackendId, Vcs, VcsError, models};

/// Minimal Vcs implementation used by `remote_url_for` tests.
struct RemoteUrlTestVcs {
    id: BackendId,
    workdir: PathBuf,
    remotes: Vec<(String, String)>,
}

impl RemoteUrlTestVcs {
    fn new(remotes: Vec<(String, String)>) -> Self {
        Self {
            id: BackendId::from("test-remote-url"),
            workdir: PathBuf::from("/tmp"),
            remotes,
        }
    }
}

impl Vcs for RemoteUrlTestVcs {
    fn id(&self) -> BackendId { self.id.clone() }
    fn workdir(&self) -> &Path { &self.workdir }
    fn current_branch(&self) -> crate::core::Result<Option<String>> { Ok(Some("main".into())) }
    fn branches(&self) -> crate::core::Result<Vec<models::BranchItem>> { Ok(vec![]) }
    fn create_branch(&self, _name: &str, _checkout: bool) -> crate::core::Result<()> { Ok(()) }
    fn checkout_branch(&self, _name: &str) -> crate::core::Result<()> { Ok(()) }
    fn ensure_remote(&self, _name: &str, _url: &str) -> crate::core::Result<()> { Ok(()) }
    fn list_remotes(&self) -> crate::core::Result<Vec<(String, String)>> { Ok(self.remotes.clone()) }
    fn remove_remote(&self, _name: &str) -> crate::core::Result<()> { Ok(()) }
    fn fetch(&self, _remote: &str, _refspec: &str, _on: Option<models::OnEvent>) -> crate::core::Result<()> { Ok(()) }
    fn push(&self, _remote: &str, _refspec: &str, _on: Option<models::OnEvent>) -> crate::core::Result<()> { Ok(()) }
    fn pull_ff_only(&self, _remote: &str, _branch: &str, _on: Option<models::OnEvent>) -> crate::core::Result<()> { Ok(()) }
    fn commit(&self, _message: &str, _name: &str, _email: &str, _paths: &[PathBuf]) -> crate::core::Result<String> { Ok("abc".into()) }
    fn commit_index(&self, _message: &str, _name: &str, _email: &str) -> crate::core::Result<String> { Ok("abc".into()) }
    fn status_payload(&self) -> crate::core::Result<models::StatusPayload> { Ok(models::StatusPayload::default()) }
    fn log_commits(&self, _query: &models::LogQuery) -> crate::core::Result<Vec<models::CommitItem>> { Ok(vec![]) }
    fn diff_file(&self, _path: &Path) -> crate::core::Result<models::DiffFileResult> { Ok(models::DiffFileResult::default()) }
    fn diff_commit(&self, _rev: &str) -> crate::core::Result<Vec<String>> { Ok(vec![]) }
    fn stage_patch(&self, _patch: &str) -> crate::core::Result<()> { Ok(()) }
    fn stage_paths(&self, _paths: &[PathBuf]) -> crate::core::Result<()> { Ok(()) }
    fn discard_paths(&self, _paths: &[PathBuf]) -> crate::core::Result<()> { Ok(()) }
    fn apply_reverse_patch(&self, _patch: &str) -> crate::core::Result<()> { Ok(()) }
    fn delete_branch(&self, _name: &str, _force: bool) -> crate::core::Result<()> { Ok(()) }
    fn rename_branch(&self, _old: &str, _new: &str) -> crate::core::Result<()> { Ok(()) }
    fn merge_into_current(&self, _name: &str) -> crate::core::Result<()> { Ok(()) }
    fn get_identity(&self) -> crate::core::Result<Option<(String, String)>> { Ok(None) }
    fn set_identity_local(&self, _name: &str, _email: &str) -> crate::core::Result<()> { Ok(()) }
}

#[test]
fn remote_url_for_empty_remote() {
    let vcs = RemoteUrlTestVcs::new(vec![("origin".into(), "https://example.com".into())]);
    assert_eq!(remote_url_for(&vcs, ""), None);
    assert_eq!(remote_url_for(&vcs, "  "), None);
}

#[test]
fn remote_url_for_found() {
    let vcs = RemoteUrlTestVcs::new(vec![
        ("origin".into(), "https://example.com/repo.git".into()),
        ("upstream".into(), "git@github.com:org/repo.git".into()),
    ]);
    assert_eq!(remote_url_for(&vcs, "origin"), Some("https://example.com/repo.git".into()));
    assert_eq!(remote_url_for(&vcs, "upstream"), Some("git@github.com:org/repo.git".into()));
}

#[test]
fn remote_url_for_not_found() {
    let vcs = RemoteUrlTestVcs::new(vec![("origin".into(), "https://example.com".into())]);
    assert_eq!(remote_url_for(&vcs, "nonexistent"), None);
    assert_eq!(remote_url_for(&vcs, "origin2"), None);
}

#[test]
fn remote_url_for_empty_list() {
    let vcs = RemoteUrlTestVcs::new(vec![]);
    assert_eq!(remote_url_for(&vcs, "origin"), None);
}

// ── PullResult struct ──

#[test]
fn pull_result_construction_pulled() {
    let result = PullResult {
        pulled: true,
        branch: "main".into(),
        reason: None,
    };
    assert!(result.pulled);
    assert_eq!(result.branch, "main");
    assert!(result.reason.is_none());
}

#[test]
fn pull_result_construction_skipped() {
    let result = PullResult {
        pulled: false,
        branch: "feature".into(),
        reason: Some("no upstream".into()),
    };
    assert!(!result.pulled);
    assert_eq!(result.branch, "feature");
    assert_eq!(result.reason, Some("no upstream".into()));
}

#[test]
fn pull_result_with_reason() {
    let result = PullResult {
        pulled: false,
        branch: "dev".into(),
        reason: Some("Branch diverged; fast-forward pull skipped".into()),
    };
    assert!(!result.pulled);
    assert_eq!(result.reason.as_deref().unwrap(), "Branch diverged; fast-forward pull skipped");
}

// ── looks_like_unknown_host_key vs looks_like_ssh_auth_failure distinction ──

#[test]
fn host_key_vs_auth_failure_distinction() {
    // A host-key message should NOT trigger auth failure
    assert!(looks_like_unknown_host_key("host key verification failed"));
    assert!(!looks_like_ssh_auth_failure("host key verification failed"));

    // An auth failure should NOT trigger host-key detection
    assert!(looks_like_ssh_auth_failure("permission denied (publickey)"));
    assert!(!looks_like_unknown_host_key("permission denied (publickey)"));
}

// ── IPC command error path tests ──

use crate::settings;
use crate::state::AppState;
use tauri::ipc::InvokeResponseBody;
use tauri::test::{get_ipc_response, mock_builder, mock_context, noop_assets, INVOKE_KEY};
use tauri::webview::InvokeRequest;
use tauri::WebviewWindowBuilder;

fn build_app_no_repo() -> tauri::App<tauri::test::MockRuntime> {
    let cfg = settings::AppConfig::default();
    let app_state = AppState::new_with_config(cfg);
    mock_builder()
        .manage(app_state)
        .invoke_handler(tauri::generate_handler![
            super::vcs_set_remote_url,
            super::vcs_fetch,
            super::vcs_fetch_all,
            super::vcs_pull,
            super::vcs_push,
            super::vcs_undo_since_push,
            super::vcs_undo_to_commit,
        ])
        .build(mock_context(noop_assets()))
        .expect("build remotes test app")
}

fn test_webview(
    app: &tauri::App<tauri::test::MockRuntime>,
) -> tauri::WebviewWindow<tauri::test::MockRuntime> {
    WebviewWindowBuilder::new(app, "main", Default::default())
        .build()
        .expect("build test webview")
}

fn invoke_cmd(
    webview: &tauri::WebviewWindow<tauri::test::MockRuntime>,
    cmd: &str,
    body: tauri::ipc::InvokeBody,
) -> Result<InvokeResponseBody, serde_json::Value> {
    get_ipc_response(
        webview,
        InvokeRequest {
            cmd: cmd.into(),
            callback: tauri::ipc::CallbackFn(0),
            error: tauri::ipc::CallbackFn(1),
            url: "tauri://localhost".parse().unwrap(),
            body,
            headers: Default::default(),
            invoke_key: INVOKE_KEY.to_string(),
        },
    )
}

#[test]
fn vcs_set_remote_url_fails_without_repo() {
    let app = build_app_no_repo();
    let wv = test_webview(&app);

    let body = tauri::ipc::InvokeBody::Json(serde_json::json!({
        "remote": "origin",
        "url": "https://example.com/repo.git",
    }));
    let res = invoke_cmd(&wv, "vcs_set_remote_url", body);
    assert!(res.is_err(), "vcs_set_remote_url needs a repo: {:?}", res);
}

#[test]
fn vcs_fetch_fails_without_repo() {
    let app = build_app_no_repo();
    let wv = test_webview(&app);

    let body = tauri::ipc::InvokeBody::Json(serde_json::json!({
        "remote": "origin",
        "refspec": "",
    }));
    let res = invoke_cmd(&wv, "vcs_fetch", body);
    assert!(res.is_err(), "vcs_fetch needs a repo: {:?}", res);
}

#[test]
fn vcs_fetch_all_fails_without_repo() {
    let app = build_app_no_repo();
    let wv = test_webview(&app);

    let res = invoke_cmd(&wv, "vcs_fetch_all", tauri::ipc::InvokeBody::default());
    assert!(res.is_err(), "vcs_fetch_all needs a repo: {:?}", res);
}

#[test]
fn vcs_pull_fails_without_repo() {
    let app = build_app_no_repo();
    let wv = test_webview(&app);

    let body = tauri::ipc::InvokeBody::Json(serde_json::json!({
        "remote": "origin",
        "branch": "main",
    }));
    let res = invoke_cmd(&wv, "vcs_pull", body);
    assert!(res.is_err(), "vcs_pull needs a repo: {:?}", res);
}

#[test]
fn vcs_push_fails_without_repo() {
    let app = build_app_no_repo();
    let wv = test_webview(&app);

    let body = tauri::ipc::InvokeBody::Json(serde_json::json!({
        "remote": "origin",
        "refspec": "main",
    }));
    let res = invoke_cmd(&wv, "vcs_push", body);
    assert!(res.is_err(), "vcs_push needs a repo: {:?}", res);
}

#[test]
fn vcs_undo_since_push_fails_without_repo() {
    let app = build_app_no_repo();
    let wv = test_webview(&app);

    let body = tauri::ipc::InvokeBody::Json(serde_json::json!({
        "remote": "origin",
    }));
    let res = invoke_cmd(&wv, "vcs_undo_since_push", body);
    assert!(res.is_err(), "vcs_undo_since_push needs a repo: {:?}", res);
}

#[test]
fn vcs_undo_to_commit_fails_without_repo() {
    let app = build_app_no_repo();
    let wv = test_webview(&app);

    let body = tauri::ipc::InvokeBody::Json(serde_json::json!({
        "id": "abc123",
    }));
    let res = invoke_cmd(&wv, "vcs_undo_to_commit", body);
    assert!(res.is_err(), "vcs_undo_to_commit needs a repo: {:?}", res);
}

// ── IPC command tests with DummyVcs ──

use std::collections::BTreeMap;
use std::sync::{Arc, Mutex};
use crate::plugin_vcs_backends::{self, PluginBackendDescriptor};
use crate::repo::Repo;

/// Full-featured VCS mock for remote command tests.
struct RemotesTestVcs {
    id: BackendId,
    workdir: PathBuf,
    remotes: Vec<(String, String)>,
    ahead: u32,
    log_commits: Vec<models::CommitItem>,
    current_branch: Option<String>,
    /// Resolved upstream returned by `branch_upstream` (None = no upstream).
    upstream: Option<String>,
    /// When true, `reset_soft_to` succeeds and records its target.
    reset_ok: bool,
    /// Last revision passed to `reset_soft_to` (recorded when `reset_ok`).
    reset_target: Mutex<Option<String>>,
    /// Must be true when ensure_remote should succeed. Stored as bool since
    /// VcsError does not implement Clone.
    ensure_remote_ok: bool,
    /// When true, `fetch` succeeds; it still records its `(remote, refspec)`.
    fetch_ok: bool,
    /// When true, `push` succeeds; it still records its `(remote, refspec)`.
    push_ok: bool,
    /// Recorded `(remote, refspec)` arguments of `fetch` calls.
    fetch_calls: Mutex<Vec<(String, String)>>,
    /// Recorded `(remote, refspec)` arguments of `push` calls.
    push_calls: Mutex<Vec<(String, String)>>,
    /// Recorded `(branch, upstream)` arguments of `set_branch_upstream` calls.
    upstream_calls: Mutex<Vec<(String, String)>>,
}

impl RemotesTestVcs {
    fn new(id: &str, workdir: PathBuf) -> Self {
        Self {
            id: BackendId::from(id),
            workdir,
            remotes: vec![("primary".into(), "https://example.com/repo.git".into())],
            ahead: 0,
            log_commits: vec![],
            current_branch: Some("main".into()),
            upstream: None,
            reset_ok: false,
            reset_target: Mutex::new(None),
            ensure_remote_ok: true,
            fetch_ok: false,
            push_ok: false,
            fetch_calls: Mutex::new(vec![]),
            push_calls: Mutex::new(vec![]),
            upstream_calls: Mutex::new(vec![]),
        }
    }

    fn unsupported<T>(&self) -> std::result::Result<T, VcsError> {
        Err(VcsError::Unsupported(self.id.clone()))
    }
}

impl Vcs for RemotesTestVcs {
    fn id(&self) -> BackendId { self.id.clone() }
    fn workdir(&self) -> &Path { &self.workdir }

    fn current_branch(&self) -> crate::core::Result<Option<String>> {
        Ok(self.current_branch.clone())
    }
    fn branches(&self) -> crate::core::Result<Vec<models::BranchItem>> { self.unsupported() }
    fn create_branch(&self, _: &str, _: bool) -> crate::core::Result<()> { self.unsupported() }
    fn checkout_branch(&self, _: &str) -> crate::core::Result<()> { self.unsupported() }
    fn ensure_remote(&self, _: &str, _: &str) -> crate::core::Result<()> {
        if self.ensure_remote_ok { Ok(()) } else { Err(VcsError::Unsupported(self.id.clone())) }
    }
    fn list_remotes(&self) -> crate::core::Result<Vec<(String, String)>> { Ok(self.remotes.clone()) }
    fn remove_remote(&self, _: &str) -> crate::core::Result<()> { self.unsupported() }
    fn fetch(&self, remote: &str, refspec: &str, _: Option<models::OnEvent>) -> crate::core::Result<()> {
        self.fetch_calls
            .lock()
            .unwrap()
            .push((remote.to_string(), refspec.to_string()));
        if self.fetch_ok {
            Ok(())
        } else {
            self.unsupported()
        }
    }
    fn push(&self, remote: &str, refspec: &str, _: Option<models::OnEvent>) -> crate::core::Result<()> {
        self.push_calls
            .lock()
            .unwrap()
            .push((remote.to_string(), refspec.to_string()));
        if self.push_ok {
            Ok(())
        } else {
            self.unsupported()
        }
    }
    fn pull_ff_only(&self, _: &str, _: &str, _: Option<models::OnEvent>) -> crate::core::Result<()> { self.unsupported() }
    fn commit(&self, _: &str, _: &str, _: &str, _: &[PathBuf]) -> crate::core::Result<String> { self.unsupported() }
    fn commit_index(&self, _: &str, _: &str, _: &str) -> crate::core::Result<String> { self.unsupported() }

    fn status_payload(&self) -> crate::core::Result<models::StatusPayload> {
        Ok(models::StatusPayload {
            ahead: self.ahead,
            behind: 0,
            files: vec![],
            branch_on_remote: false,
        })
    }

    fn log_commits(&self, _: &models::LogQuery) -> crate::core::Result<Vec<models::CommitItem>> {
        Ok(self.log_commits.clone())
    }

    fn diff_file(&self, _: &Path) -> crate::core::Result<models::DiffFileResult> { self.unsupported() }
    fn diff_commit(&self, _: &str) -> crate::core::Result<Vec<String>> { self.unsupported() }
    fn stage_patch(&self, _: &str) -> crate::core::Result<()> { self.unsupported() }
    fn stage_paths(&self, _: &[PathBuf]) -> crate::core::Result<()> { self.unsupported() }
    fn discard_paths(&self, _: &[PathBuf]) -> crate::core::Result<()> { self.unsupported() }
    fn apply_reverse_patch(&self, _: &str) -> crate::core::Result<()> { self.unsupported() }
    fn delete_branch(&self, _: &str, _: bool) -> crate::core::Result<()> { self.unsupported() }
    fn rename_branch(&self, _: &str, _: &str) -> crate::core::Result<()> { self.unsupported() }
    fn merge_into_current(&self, _: &str) -> crate::core::Result<()> { self.unsupported() }
    fn get_identity(&self) -> crate::core::Result<Option<(String, String)>> { Ok(None) }
    fn set_identity_local(&self, _: &str, _: &str) -> crate::core::Result<()> { Ok(()) }

    fn set_branch_upstream(&self, branch: &str, upstream: &str) -> crate::core::Result<()> {
        self.upstream_calls
            .lock()
            .unwrap()
            .push((branch.to_string(), upstream.to_string()));
        Ok(())
    }

    fn branch_upstream(&self, _branch: &str) -> crate::core::Result<Option<String>> {
        Ok(self.upstream.clone())
    }

    fn reset_soft_to(&self, rev: &str) -> crate::core::Result<()> {
        if self.reset_ok {
            *self.reset_target.lock().unwrap() = Some(rev.to_string());
            Ok(())
        } else {
            self.unsupported()
        }
    }
}

fn register_remotes_test_backend(backend_id: &str) {
    let desc = PluginBackendDescriptor {
        backend_id: BackendId::from(backend_id),
        backend_name: Some("Remotes Test VCS".into()),
        action_labels: BTreeMap::new(),
        plugin_id: format!("test.{backend_id}"),
        plugin_name: Some("Remotes Test Plugin".into()),
    };
    plugin_vcs_backends::store_backends(vec![desc]);
}

fn build_remotes_app(
    vcs: std::sync::Arc<RemotesTestVcs>,
) -> (tauri::App<tauri::test::MockRuntime>, std::sync::Arc<RemotesTestVcs>) {
    crate::app_identity::setup_test_isolation();
    let repo = Arc::new(Repo::new(vcs.clone() as Arc<dyn Vcs>));
    let mut cfg = settings::AppConfig::default();
    cfg.plugins.enabled = vec![format!("test.{}", vcs.id.as_ref())];
    let app_state = AppState::new_with_config(cfg);
    app_state.set_current_repo(repo);

    let app = mock_builder()
        .manage(app_state)
        .invoke_handler(tauri::generate_handler![
            super::vcs_set_remote_url,
            super::vcs_fetch,
            super::vcs_fetch_all,
            super::vcs_pull,
            super::vcs_push,
            super::vcs_undo_since_push,
            super::vcs_undo_to_commit,
        ])
        .build(mock_context(noop_assets()))
        .expect("build remotes test app");

    (app, vcs)
}

#[test]
fn vcs_set_remote_url_empty_name() {
    register_remotes_test_backend("remotes-test");
    let vcs = Arc::new(RemotesTestVcs::new(
        "remotes-test",
        tempfile::tempdir().unwrap().keep(),
    ));
    let (app, _) = build_remotes_app(vcs);
    let wv = test_webview(&app);

    let body = tauri::ipc::InvokeBody::Json(serde_json::json!({
        "name": "  ",
        "url": "https://example.com/repo.git",
    }));
    let res = invoke_cmd(&wv, "vcs_set_remote_url", body);
    assert!(res.is_err(), "empty name should fail: {:?}", res);
}

#[test]
fn vcs_set_remote_url_empty_url() {
    register_remotes_test_backend("remotes-test");
    let vcs = Arc::new(RemotesTestVcs::new(
        "remotes-test",
        tempfile::tempdir().unwrap().keep(),
    ));
    let (app, _) = build_remotes_app(vcs);
    let wv = test_webview(&app);

    let body = tauri::ipc::InvokeBody::Json(serde_json::json!({
        "name": "origin",
        "url": "",
    }));
    let res = invoke_cmd(&wv, "vcs_set_remote_url", body);
    assert!(res.is_err(), "empty url should fail: {:?}", res);
}

#[test]
fn vcs_set_remote_url_valid() {
    register_remotes_test_backend("remotes-test");
    let vcs = Arc::new(RemotesTestVcs::new(
        "remotes-test",
        tempfile::tempdir().unwrap().keep(),
    ));
    let (app, _) = build_remotes_app(vcs);
    let wv = test_webview(&app);

    let body = tauri::ipc::InvokeBody::Json(serde_json::json!({
        "name": "origin",
        "url": "https://example.com/repo.git",
    }));
    let res = invoke_cmd(&wv, "vcs_set_remote_url", body);
    assert!(res.is_ok(), "valid set_remote_url should succeed: {:?}", res);
}

#[test]
fn vcs_undo_since_push_nothing_to_undo() {
    register_remotes_test_backend("remotes-test");
    let vcs = Arc::new(RemotesTestVcs::new(
        "remotes-test",
        tempfile::tempdir().unwrap().keep(),
    ));
    // ahead = 0 means "Nothing to undo"
    let (app, _) = build_remotes_app(vcs);
    let wv = test_webview(&app);

    let body = tauri::ipc::InvokeBody::Json(serde_json::json!({}));
    let res = invoke_cmd(&wv, "vcs_undo_since_push", body);
    assert!(res.is_err(), "undo with ahead=0 should fail: {:?}", res);
}

#[test]
fn vcs_undo_since_push_uses_resolved_upstream() {
    register_remotes_test_backend("remotes-test");
    let mut vcs = RemotesTestVcs::new(
        "remotes-test",
        tempfile::tempdir().unwrap().keep(),
    );
    vcs.ahead = 3;
    vcs.upstream = Some("refs/remotes/origin/main".into());
    vcs.reset_ok = true;
    let vcs = Arc::new(vcs);
    let (app, ref_vcs) = build_remotes_app(vcs.clone());
    let wv = test_webview(&app);

    let body = tauri::ipc::InvokeBody::Json(serde_json::json!({}));
    let res = invoke_cmd(&wv, "vcs_undo_since_push", body);
    assert!(res.is_ok(), "undo with upstream should succeed: {:?}", res);
    // Reset must target the resolved upstream name, not a VCS-specific literal.
    let target = ref_vcs.reset_target.lock().unwrap().clone();
    assert_eq!(target.as_deref(), Some("refs/remotes/origin/main"));
    let _ = ref_vcs; // keep alive
}

#[test]
fn vcs_undo_since_push_no_upstream_errors() {
    register_remotes_test_backend("remotes-test");
    let mut vcs = RemotesTestVcs::new(
        "remotes-test",
        tempfile::tempdir().unwrap().keep(),
    );
    vcs.ahead = 3;
    // upstream = None → NoUpstream error
    let vcs = Arc::new(vcs);
    let (app, _) = build_remotes_app(vcs);
    let wv = test_webview(&app);

    let body = tauri::ipc::InvokeBody::Json(serde_json::json!({}));
    let res = invoke_cmd(&wv, "vcs_undo_since_push", body);
    assert!(res.is_err(), "undo without upstream should fail: {:?}", res);
}

#[test]
fn vcs_undo_to_commit_commit_not_in_ahead() {
    register_remotes_test_backend("remotes-test");
    let vcs = Arc::new(RemotesTestVcs::new(
        "remotes-test",
        tempfile::tempdir().unwrap().keep(),
    ));
    let (app, ref_vcs) = build_remotes_app(vcs.clone());
    let wv = test_webview(&app);

    // log_commits returns empty, so any commit id won't be found
    let body = tauri::ipc::InvokeBody::Json(serde_json::json!({
        "id": "abc123",
    }));
    let res = invoke_cmd(&wv, "vcs_undo_to_commit", body);
    // With empty ahead_list, the check is skipped. But the fallback query
    // also returns empty, so the commit check is skipped too.
    // The command then calls reset_soft_to which returns Unsupported.
    assert!(res.is_err(), "undo_to_commit with unsupported reset should fail: {:?}", res);
    let _ = ref_vcs; // keep alive
}

#[test]
fn vcs_undo_to_commit_invalid_commit_in_ahead() {
    register_remotes_test_backend("remotes-test");
    let mut vcs = RemotesTestVcs::new(
        "remotes-test",
        tempfile::tempdir().unwrap().keep(),
    );
    vcs.ahead = 3; // has ahead commits
    vcs.log_commits = vec![
        models::CommitItem {
            id: "def456".into(),
            msg: "commit 3".into(),
            meta: "".into(),
            author: "test".into(),
        },
        models::CommitItem {
            id: "ghi789".into(),
            msg: "commit 4".into(),
            meta: "".into(),
            author: "test".into(),
        },
    ];
    let vcs = Arc::new(vcs);
    let (app, _) = build_remotes_app(vcs);
    let wv = test_webview(&app);

    // "xyz999" doesn't start any of the commit ids
    let body = tauri::ipc::InvokeBody::Json(serde_json::json!({
        "id": "xyz999",
    }));
    let res = invoke_cmd(&wv, "vcs_undo_to_commit", body);
    assert!(res.is_err(), "invalid commit in ahead should fail: {:?}", res);
}

#[test]
fn vcs_fetch_fails_no_backend_support() {
    register_remotes_test_backend("remotes-test");
    let vcs = Arc::new(RemotesTestVcs::new(
        "remotes-test",
        tempfile::tempdir().unwrap().keep(),
    ));
    let (app, _) = build_remotes_app(vcs);
    let wv = test_webview(&app);

    // fetch() returns Unsupported → should fail
    let body = tauri::ipc::InvokeBody::Json(serde_json::json!({}));
    let res = invoke_cmd(&wv, "vcs_fetch", body);
    assert!(res.is_err(), "fetch without implementation should fail: {:?}", res);
}

#[test]
fn vcs_push_fails_no_backend_support() {
    register_remotes_test_backend("remotes-test");
    let vcs = Arc::new(RemotesTestVcs::new(
        "remotes-test",
        tempfile::tempdir().unwrap().keep(),
    ));
    let (app, _) = build_remotes_app(vcs);
    let wv = test_webview(&app);

    // push() returns Unsupported → should fail
    let body = tauri::ipc::InvokeBody::Json(serde_json::json!({}));
    let res = invoke_cmd(&wv, "vcs_push", body);
    assert!(res.is_err(), "push without implementation should fail: {:?}", res);
}

#[test]
fn vcs_fetch_all_fails_no_backend_support() {
    register_remotes_test_backend("remotes-test");
    let vcs = Arc::new(RemotesTestVcs::new(
        "remotes-test",
        tempfile::tempdir().unwrap().keep(),
    ));
    let (app, _) = build_remotes_app(vcs);
    let wv = test_webview(&app);

    // fetch(): list_remotes returns remotes, but fetch() returns Unsupported
    // The fallback from force-refspec to non-force also fails → failures collected
    let body = tauri::ipc::InvokeBody::Json(serde_json::json!({}));
    let res = invoke_cmd(&wv, "vcs_fetch_all", body);
    assert!(res.is_err(), "fetch_all with unsupported fetch should fail: {:?}", res);
}

// ── Default-remote selection (VCS-19) ──

#[test]
fn fetch_prefers_resolved_upstream_remote() {
    register_remotes_test_backend("remotes-test");
    let mut vcs = RemotesTestVcs::new(
        "remotes-test",
        tempfile::tempdir().unwrap().keep(),
    );
    vcs.remotes = vec![
        ("primary".into(), "https://example.com/repo.git".into()),
        ("upstream".into(), "https://other.example.com/repo.git".into()),
    ];
    vcs.upstream = Some("refs/remotes/upstream/main".into());
    vcs.fetch_ok = true;
    let vcs = Arc::new(vcs);
    let (app, ref_vcs) = build_remotes_app(vcs.clone());
    let wv = test_webview(&app);

    let body = tauri::ipc::InvokeBody::Json(serde_json::json!({}));
    let res = invoke_cmd(&wv, "vcs_fetch", body);
    assert!(res.is_ok(), "fetch should succeed: {:?}", res);
    // The resolved upstream remote wins over the first configured remote.
    let calls = ref_vcs.fetch_calls.lock().unwrap().clone();
    assert_eq!(calls, vec![("upstream".to_string(), "main".to_string())]);
    let _ = ref_vcs; // keep alive
}

#[test]
fn fetch_falls_back_to_first_remote() {
    register_remotes_test_backend("remotes-test");
    let mut vcs = RemotesTestVcs::new(
        "remotes-test",
        tempfile::tempdir().unwrap().keep(),
    );
    vcs.remotes = vec![
        ("alpha".into(), "https://alpha.example/repo.git".into()),
        ("beta".into(), "https://beta.example/repo.git".into()),
    ];
    // No upstream → first configured remote is used.
    vcs.fetch_ok = true;
    let vcs = Arc::new(vcs);
    let (app, ref_vcs) = build_remotes_app(vcs.clone());
    let wv = test_webview(&app);

    let body = tauri::ipc::InvokeBody::Json(serde_json::json!({}));
    let res = invoke_cmd(&wv, "vcs_fetch", body);
    assert!(res.is_ok(), "fetch should succeed: {:?}", res);
    let calls = ref_vcs.fetch_calls.lock().unwrap().clone();
    assert_eq!(calls, vec![("alpha".to_string(), "main".to_string())]);
    let _ = ref_vcs; // keep alive
}

#[test]
fn fetch_no_remotes_errors() {
    register_remotes_test_backend("remotes-test");
    let mut vcs = RemotesTestVcs::new(
        "remotes-test",
        tempfile::tempdir().unwrap().keep(),
    );
    vcs.remotes = vec![];
    vcs.fetch_ok = true;
    let vcs = Arc::new(vcs);
    let (app, _) = build_remotes_app(vcs);
    let wv = test_webview(&app);

    let body = tauri::ipc::InvokeBody::Json(serde_json::json!({}));
    let res = invoke_cmd(&wv, "vcs_fetch", body);
    assert!(res.is_err(), "fetch without remotes should fail: {:?}", res);
    let err_str = format!("{:?}", res);
    assert!(err_str.contains("no remotes configured"), "unexpected error: {err_str}");
}

#[test]
fn push_sets_upstream_after_success() {
    register_remotes_test_backend("remotes-test");
    let mut vcs = RemotesTestVcs::new(
        "remotes-test",
        tempfile::tempdir().unwrap().keep(),
    );
    // Default remotes = [("primary", ...)], no upstream → push to first remote.
    vcs.push_ok = true;
    vcs.fetch_ok = true;
    let vcs = Arc::new(vcs);
    let (app, ref_vcs) = build_remotes_app(vcs.clone());
    let wv = test_webview(&app);

    let body = tauri::ipc::InvokeBody::Json(serde_json::json!({}));
    let res = invoke_cmd(&wv, "vcs_push", body);
    assert!(res.is_ok(), "push should succeed: {:?}", res);
    let push_calls = ref_vcs.push_calls.lock().unwrap().clone();
    assert_eq!(
        push_calls,
        vec![("primary".to_string(), "refs/heads/main:refs/heads/main".to_string())]
    );
    // Post-push fetch refreshes tracking refs from the same remote.
    let fetch_calls = ref_vcs.fetch_calls.lock().unwrap().clone();
    assert_eq!(fetch_calls, vec![("primary".to_string(), "main".to_string())]);
    // No upstream → the branch tracks the push remote.
    let upstream_calls = ref_vcs.upstream_calls.lock().unwrap().clone();
    assert_eq!(
        upstream_calls,
        vec![("main".to_string(), "primary/main".to_string())]
    );
    let _ = ref_vcs; // keep alive
}
