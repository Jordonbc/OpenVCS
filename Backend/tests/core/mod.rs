// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

use std::path::{Path, PathBuf};

use crate::core::models::{
    BranchItem, CommitItem, ConflictSide, DiffFileResult, LogQuery, OnEvent, StatusPayload,
};
use crate::core::{BackendId, Result as VcsResult, Vcs, VcsError};

/// Minimal Vcs implementation used to test trait default methods.
struct DummyVcs {
    id: BackendId,
    workdir: PathBuf,
}

impl DummyVcs {
    fn new(id: &str) -> Self {
        Self {
            id: BackendId::from(id),
            workdir: PathBuf::from("/tmp/test"),
        }
    }
}

impl Vcs for DummyVcs {
    fn id(&self) -> BackendId {
        self.id.clone()
    }

    fn workdir(&self) -> &Path {
        &self.workdir
    }

    fn current_branch(&self) -> VcsResult<Option<String>> {
        Ok(Some("main".into()))
    }

    fn branches(&self) -> VcsResult<Vec<BranchItem>> {
        Ok(vec![])
    }

    fn create_branch(&self, _name: &str, _checkout: bool) -> VcsResult<()> {
        Ok(())
    }

    fn checkout_branch(&self, _name: &str) -> VcsResult<()> {
        Ok(())
    }

    fn ensure_remote(&self, _name: &str, _url: &str) -> VcsResult<()> {
        Ok(())
    }

    fn list_remotes(&self) -> VcsResult<Vec<(String, String)>> {
        Ok(vec![])
    }

    fn remove_remote(&self, _name: &str) -> VcsResult<()> {
        Ok(())
    }

    fn fetch(&self, _remote: &str, _refspec: &str, _on: Option<OnEvent>) -> VcsResult<()> {
        Ok(())
    }

    fn push(&self, _remote: &str, _refspec: &str, _on: Option<OnEvent>) -> VcsResult<()> {
        Ok(())
    }

    fn pull_ff_only(&self, _remote: &str, _branch: &str, _on: Option<OnEvent>) -> VcsResult<()> {
        Ok(())
    }

    fn commit(&self, _message: &str, _name: &str, _email: &str, _paths: &[PathBuf]) -> VcsResult<String> {
        Ok("abc123".into())
    }

    fn commit_index(&self, _message: &str, _name: &str, _email: &str) -> VcsResult<String> {
        Ok("def456".into())
    }

    fn status_payload(&self) -> VcsResult<StatusPayload> {
        Ok(StatusPayload::default())
    }

    fn log_commits(&self, _query: &LogQuery) -> VcsResult<Vec<CommitItem>> {
        Ok(vec![])
    }

    fn diff_file(&self, _path: &Path) -> VcsResult<DiffFileResult> {
        Ok(DiffFileResult::default())
    }

    fn diff_commit(&self, _rev: &str) -> VcsResult<Vec<String>> {
        Ok(vec![])
    }

    fn stage_patch(&self, _patch: &str) -> VcsResult<()> {
        Ok(())
    }

    fn stage_paths(&self, _paths: &[PathBuf]) -> VcsResult<()> {
        Ok(())
    }

    fn discard_paths(&self, _paths: &[PathBuf]) -> VcsResult<()> {
        Ok(())
    }

    fn apply_reverse_patch(&self, _patch: &str) -> VcsResult<()> {
        Ok(())
    }

    fn delete_branch(&self, _name: &str, _force: bool) -> VcsResult<()> {
        Ok(())
    }

    fn rename_branch(&self, _old: &str, _new: &str) -> VcsResult<()> {
        Ok(())
    }

    fn merge_into_current(&self, _name: &str) -> VcsResult<()> {
        Ok(())
    }

    fn get_identity(&self) -> VcsResult<Option<(String, String)>> {
        Ok(None)
    }

    fn set_identity_local(&self, _name: &str, _email: &str) -> VcsResult<()> {
        Ok(())
    }
}

// ── VcsError display tests ─────────────────────────────────────────────────

#[test]
fn vcs_error_no_upstream_displays_helpful_message() {
    let err = VcsError::NoUpstream;
    assert_eq!(err.to_string(), "no upstream configured");
}

#[test]
fn vcs_error_unsupported_backend_displays_helper_message() {
    let err = VcsError::Unsupported(BackendId::from("git"));
    assert_eq!(err.to_string(), "unsupported backend: git");
}

#[test]
fn vcs_error_backend_displays_backend_id_and_message() {
    let err = VcsError::Backend {
        backend: BackendId::from("git"),
        msg: "boom".into(),
    };
    assert_eq!(err.to_string(), "git: boom");
}

#[test]
fn vcs_error_io_displays_underlying_error() {
    let io_err = std::io::Error::new(std::io::ErrorKind::NotFound, "file not found");
    let err = VcsError::Io(io_err);
    assert!(err.to_string().contains("file not found"));
    assert!(err.to_string().contains("io:"));
}

#[test]
fn vcs_error_from_io_converts_io_errors() {
    let io_err = std::io::Error::new(std::io::ErrorKind::PermissionDenied, "permission denied");
    let vcs_err: VcsError = io_err.into();
    assert!(vcs_err.to_string().contains("permission denied"));
}

// ── Vcs trait default method tests ─────────────────────────────────────────

#[test]
fn vcs_conflict_details_returns_unsupported_by_default() {
    let vcs = DummyVcs::new("test");
    let result = vcs.conflict_details(Path::new("foo.txt"));
    assert!(result.is_err());
    assert!(result.unwrap_err().to_string().contains("unsupported backend"));
}

#[test]
fn vcs_checkout_conflict_side_returns_unsupported_by_default() {
    let vcs = DummyVcs::new("test");
    let result = vcs.checkout_conflict_side(Path::new("foo.txt"), ConflictSide::Ours);
    assert!(result.is_err());
}

#[test]
fn vcs_write_merge_result_returns_unsupported_by_default() {
    let vcs = DummyVcs::new("test");
    let result = vcs.write_merge_result(Path::new("foo.txt"), b"content");
    assert!(result.is_err());
}

#[test]
fn vcs_merge_abort_returns_unsupported_by_default() {
    let vcs = DummyVcs::new("test");
    let result = vcs.merge_abort();
    assert!(result.is_err());
}

#[test]
fn vcs_merge_continue_returns_unsupported_by_default() {
    let vcs = DummyVcs::new("test");
    let result = vcs.merge_continue();
    assert!(result.is_err());
}

#[test]
fn vcs_merge_in_progress_returns_false_by_default() {
    let vcs = DummyVcs::new("test");
    let result = vcs.merge_in_progress();
    assert!(result.is_ok());
    assert!(!result.unwrap());
}

#[test]
fn vcs_set_branch_upstream_returns_unsupported_by_default() {
    let vcs = DummyVcs::new("test");
    let result = vcs.set_branch_upstream("main", "origin/main");
    assert!(result.is_err());
}

#[test]
fn vcs_branch_upstream_returns_unsupported_by_default() {
    let vcs = DummyVcs::new("test");
    let result = vcs.branch_upstream("main");
    assert!(result.is_err());
}

#[test]
fn vcs_reset_soft_to_returns_unsupported_by_default() {
    let vcs = DummyVcs::new("test");
    let result = vcs.reset_soft_to("abc123");
    assert!(result.is_err());
}

#[test]
fn vcs_stash_list_returns_unsupported_by_default() {
    let vcs = DummyVcs::new("test");
    let result = vcs.stash_list();
    assert!(result.is_err());
}

#[test]
fn vcs_stash_push_returns_unsupported_by_default() {
    let vcs = DummyVcs::new("test");
    let result = vcs.stash_push("msg", false, &[]);
    assert!(result.is_err());
}

#[test]
fn vcs_stash_apply_returns_unsupported_by_default() {
    let vcs = DummyVcs::new("test");
    let result = vcs.stash_apply("stash@{0}");
    assert!(result.is_err());
}

#[test]
fn vcs_stash_pop_returns_unsupported_by_default() {
    let vcs = DummyVcs::new("test");
    let result = vcs.stash_pop("stash@{0}");
    assert!(result.is_err());
}

#[test]
fn vcs_stash_drop_returns_unsupported_by_default() {
    let vcs = DummyVcs::new("test");
    let result = vcs.stash_drop("stash@{0}");
    assert!(result.is_err());
}

#[test]
fn vcs_stash_show_returns_unsupported_by_default() {
    let vcs = DummyVcs::new("test");
    let result = vcs.stash_show("stash@{0}");
    assert!(result.is_err());
}

#[test]
fn vcs_cherry_pick_returns_unsupported_by_default() {
    let vcs = DummyVcs::new("test");
    let result = vcs.cherry_pick("abc123");
    assert!(result.is_err());
}

#[test]
fn vcs_revert_commit_returns_unsupported_by_default() {
    let vcs = DummyVcs::new("test");
    let result = vcs.revert_commit("abc123", false);
    assert!(result.is_err());
}

#[test]
fn vcs_merge_into_current_with_message_delegates_to_merge_into_current() {
    let vcs = DummyVcs::new("test");
    // Should not error even with a message
    assert!(vcs.merge_into_current_with_message("feature", Some("auto-merge")).is_ok());
    // Should work with None message too
    assert!(vcs.merge_into_current_with_message("feature", None).is_ok());
}
