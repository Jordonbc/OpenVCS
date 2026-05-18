// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

use super::Repo;
use crate::core::{BackendId, Vcs, models};
use std::path::{Path, PathBuf};
use std::sync::Arc;

struct DummyVcs {
    workdir: PathBuf,
}

impl DummyVcs {
    fn new(workdir: PathBuf) -> Self {
        Self { workdir }
    }

    fn unsupported<T>(&self) -> crate::core::Result<T> {
        Err(crate::core::VcsError::Unsupported(self.id()))
    }
}

impl Vcs for DummyVcs {
    fn id(&self) -> BackendId {
        BackendId::from("dummy")
    }

    fn workdir(&self) -> &Path {
        &self.workdir
    }

    fn current_branch(&self) -> crate::core::Result<Option<String>> {
        self.unsupported()
    }

    fn branches(&self) -> crate::core::Result<Vec<models::BranchItem>> {
        self.unsupported()
    }

    fn create_branch(&self, _name: &str, _checkout: bool) -> crate::core::Result<()> { self.unsupported() }
    fn checkout_branch(&self, _name: &str) -> crate::core::Result<()> { self.unsupported() }
    fn ensure_remote(&self, _name: &str, _url: &str) -> crate::core::Result<()> { self.unsupported() }
    fn list_remotes(&self) -> crate::core::Result<Vec<(String, String)>> { self.unsupported() }
    fn remove_remote(&self, _name: &str) -> crate::core::Result<()> { self.unsupported() }
    fn fetch(&self, _remote: &str, _refspec: &str, _on: Option<models::OnEvent>) -> crate::core::Result<()> { self.unsupported() }
    fn push(&self, _remote: &str, _refspec: &str, _on: Option<models::OnEvent>) -> crate::core::Result<()> { self.unsupported() }
    fn pull_ff_only(&self, _remote: &str, _branch: &str, _on: Option<models::OnEvent>) -> crate::core::Result<()> { self.unsupported() }
    fn commit(&self, _message: &str, _name: &str, _email: &str, _paths: &[PathBuf]) -> crate::core::Result<String> { self.unsupported() }
    fn commit_index(&self, _message: &str, _name: &str, _email: &str) -> crate::core::Result<String> { self.unsupported() }
    fn status_payload(&self) -> crate::core::Result<models::StatusPayload> { self.unsupported() }
    fn log_commits(&self, _query: &models::LogQuery) -> crate::core::Result<Vec<models::CommitItem>> { self.unsupported() }
    fn diff_file(&self, _path: &Path) -> crate::core::Result<Vec<String>> { self.unsupported() }
    fn diff_commit(&self, _rev: &str) -> crate::core::Result<Vec<String>> { self.unsupported() }
    fn stage_patch(&self, _patch: &str) -> crate::core::Result<()> { self.unsupported() }
    fn stage_paths(&self, _paths: &[PathBuf]) -> crate::core::Result<()> { self.unsupported() }
    fn discard_paths(&self, _paths: &[PathBuf]) -> crate::core::Result<()> { self.unsupported() }
    fn apply_reverse_patch(&self, _patch: &str) -> crate::core::Result<()> { self.unsupported() }
    fn delete_branch(&self, _name: &str, _force: bool) -> crate::core::Result<()> { self.unsupported() }
    fn rename_branch(&self, _old: &str, _new: &str) -> crate::core::Result<()> { self.unsupported() }
    fn merge_into_current(&self, _name: &str) -> crate::core::Result<()> { self.unsupported() }
    fn get_identity(&self) -> crate::core::Result<Option<(String, String)>> { self.unsupported() }
    fn set_identity_local(&self, _name: &str, _email: &str) -> crate::core::Result<()> { self.unsupported() }
}

#[test]
/// Verifies repo wrapper forwards identity and backend access.
fn wraps_backend_handle() {
    let repo_dir = tempfile::tempdir().expect("create temp dir").keep();
    let repo = Repo::new(Arc::new(DummyVcs::new(repo_dir.clone())));
    assert_eq!(repo.id().to_string(), "dummy");
    assert_eq!(repo.inner().workdir(), repo_dir.as_path());
}
