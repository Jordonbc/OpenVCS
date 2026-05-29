// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

use std::path::{Path, PathBuf};
use std::sync::Arc;

use crate::core::{BackendId, Result as VcsResult, Vcs};
use crate::core::models::{BranchItem, CommitItem, LogQuery, OnEvent, StatusPayload};
use crate::output_log::{OutputLevel, OutputLogEntry};
use crate::repo::Repo;
use crate::repo_settings::RepoConfig;
use crate::settings::AppConfig;
use crate::state::AppState;

// ── Dummy Vcs impl for testing ─────────────────────────────────────────────

fn dummy_repo(path: &Path) -> Arc<Repo> {
    // Create a DummyVcs whose workdir matches the provided path
    struct PathDummyVcs(BackendId, PathBuf);
    impl Vcs for PathDummyVcs {
        fn id(&self) -> BackendId { self.0.clone() }
        fn workdir(&self) -> &Path { &self.1 }
        fn current_branch(&self) -> VcsResult<Option<String>> { Ok(Some("main".into())) }
        fn branches(&self) -> VcsResult<Vec<BranchItem>> { Ok(vec![]) }
        fn create_branch(&self, _: &str, _: bool) -> VcsResult<()> { Ok(()) }
        fn checkout_branch(&self, _: &str) -> VcsResult<()> { Ok(()) }
        fn ensure_remote(&self, _: &str, _: &str) -> VcsResult<()> { Ok(()) }
        fn list_remotes(&self) -> VcsResult<Vec<(String, String)>> { Ok(vec![]) }
        fn remove_remote(&self, _: &str) -> VcsResult<()> { Ok(()) }
        fn fetch(&self, _: &str, _: &str, _: Option<OnEvent>) -> VcsResult<()> { Ok(()) }
        fn push(&self, _: &str, _: &str, _: Option<OnEvent>) -> VcsResult<()> { Ok(()) }
        fn pull_ff_only(&self, _: &str, _: &str, _: Option<OnEvent>) -> VcsResult<()> { Ok(()) }
        fn commit(&self, _: &str, _: &str, _: &str, _: &[PathBuf]) -> VcsResult<String> { Ok("abc".into()) }
        fn commit_index(&self, _: &str, _: &str, _: &str) -> VcsResult<String> { Ok("def".into()) }
        fn status_payload(&self) -> VcsResult<StatusPayload> { Ok(StatusPayload::default()) }
        fn log_commits(&self, _: &LogQuery) -> VcsResult<Vec<CommitItem>> { Ok(vec![]) }
        fn diff_file(&self, _: &Path) -> VcsResult<Vec<String>> { Ok(vec![]) }
        fn diff_commit(&self, _: &str) -> VcsResult<Vec<String>> { Ok(vec![]) }
        fn stage_patch(&self, _: &str) -> VcsResult<()> { Ok(()) }
        fn stage_paths(&self, _: &[PathBuf]) -> VcsResult<()> { Ok(()) }
        fn discard_paths(&self, _: &[PathBuf]) -> VcsResult<()> { Ok(()) }
        fn apply_reverse_patch(&self, _: &str) -> VcsResult<()> { Ok(()) }
        fn delete_branch(&self, _: &str, _: bool) -> VcsResult<()> { Ok(()) }
        fn rename_branch(&self, _: &str, _: &str) -> VcsResult<()> { Ok(()) }
        fn merge_into_current(&self, _: &str) -> VcsResult<()> { Ok(()) }
        fn get_identity(&self) -> VcsResult<Option<(String, String)>> { Ok(None) }
        fn set_identity_local(&self, _: &str, _: &str) -> VcsResult<()> { Ok(()) }
    }
    Arc::new(Repo::new(Arc::new(PathDummyVcs(BackendId::from("git"), path.to_path_buf()))))
}

// ── Construction tests ─────────────────────────────────────────────────────

#[test]
fn constructs_state_from_config() {
    let cfg = AppConfig::default();
    let state = AppState::new_with_config(cfg.clone());
    assert_eq!(state.config(), cfg);
    assert!(Arc::strong_count(&state.plugin_runtime()) >= 1);
}

// ── Config mutation tests ──────────────────────────────────────────────────

#[test]
fn set_config_updates_snapshot() {
    let state = AppState::new_with_config(AppConfig::default());
    let mut cfg = AppConfig::default();
    cfg.general.default_backend = "hg".into();
    // set_config may fail if recents persistence fails; we check the config was updated regardless
    let _ = state.set_config(cfg.clone());
    // Config should reflect the update
    assert_eq!(state.config().general.default_backend, "hg");
}

// ── Repo config tests ──────────────────────────────────────────────────────

#[test]
fn stores_repo_config_in_memory() {
    let state = AppState::new_with_config(AppConfig::default());
    let repo_cfg = RepoConfig {
        user_name: Some("Alice".into()),
        user_email: Some("alice@example.com".into()),
        origin_url: None,
        remotes: None,
    };
    assert!(state.set_repo_config(repo_cfg).is_ok());
}

// ── Output log tests ───────────────────────────────────────────────────────

#[test]
fn manages_output_log_entries() {
    let state = AppState::new_with_config(AppConfig::default());
    state.push_output_log(OutputLogEntry::new(1, OutputLevel::Info, "core", "hello"));
    state.push_output_log(OutputLogEntry::new(2, OutputLevel::Warn, "core", "warn"));
    assert_eq!(state.output_log().len(), 2);

    state.clear_output_log();
    assert!(state.output_log().is_empty());
}

#[test]
fn output_log_truncates_at_maximum() {
    let state = AppState::new_with_config(AppConfig::default());
    // Push more than MAX (2000) entries
    for i in 0..2500 {
        state.push_output_log(OutputLogEntry::new(i as i64, OutputLevel::Info, "core", &i.to_string()));
    }
    // Should have trimmed to 2000
    assert_eq!(state.output_log().len(), 2000);
}

// ── Current repo lifecycle tests ───────────────────────────────────────────

#[test]
fn current_repo_starts_empty() {
    let state = AppState::new_with_config(AppConfig::default());
    assert!(state.current_repo().is_none());
}

#[test]
fn set_current_repo_stores_and_retrieves_repo() {
    let state = AppState::new_with_config(AppConfig::default());
    let repo = dummy_repo(Path::new("/tmp/test-repo"));
    state.set_current_repo(repo.clone());
    let retrieved = state.current_repo().expect("repo should be set");
    assert_eq!(retrieved.id().as_ref(), repo.id().as_ref());
}

#[test]
fn clear_current_repo_removes_active_repo() {
    let state = AppState::new_with_config(AppConfig::default());
    let repo = dummy_repo(Path::new("/tmp/test-repo"));
    state.set_current_repo(repo);
    assert!(state.current_repo().is_some());

    state.clear_current_repo();
    assert!(state.current_repo().is_none());
}

#[test]
fn set_current_repo_affects_recents() {
    let state = AppState::new_with_config(AppConfig::default());
    let dir = tempfile::tempdir().expect("temp dir");
    let repo_path = dir.path().join("my-repo");
    std::fs::create_dir(&repo_path).expect("create repo dir");

    let before = state.recents().len();
    state.set_current_repo(dummy_repo(&repo_path));
    let after = state.recents().len();

    // recents should grow by at least 1 (or stay same if repo was already present)
    assert!(after > before || state.recents().iter().any(|p| p.ends_with("my-repo")));
}

#[test]
fn set_current_repo_places_new_path_at_front() {
    let state = AppState::new_with_config(AppConfig::default());
    let dir = tempfile::tempdir().expect("temp dir");
    let repo_path = dir.path().join("front-repo");
    std::fs::create_dir(&repo_path).expect("create repo dir");

    state.set_current_repo(dummy_repo(&repo_path));
    // The most recently set repo should be first
    assert!(state.recents()[0].ends_with("front-repo"));
}

// ── Recents accessor tests ────────────────────────────────────────────────

#[test]
fn recents_contains_paths_after_setting_current_repo() {
    let state = AppState::new_with_config(AppConfig::default());
    let dir = tempfile::tempdir().expect("temp dir");
    let repo_path = dir.path().join("test-repo");
    std::fs::create_dir(&repo_path).expect("create repo dir");

    // recents may be pre-populated from disk, so we check the repo appears
    state.set_current_repo(dummy_repo(&repo_path));
    assert!(
        state.recents().iter().any(|p| p.ends_with("test-repo")),
        "repo path should appear in recents"
    );
}
