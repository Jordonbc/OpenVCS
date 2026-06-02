// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

//! Backend-local shared contracts for VCS backends and plugin runtime data.

pub mod backend_id;
pub mod models;
pub mod settings;
pub mod ui;

pub use self::backend_id::BackendId;
pub use self::models::OnEvent;

use std::path::{Path, PathBuf};

/// Error type returned by VCS backend operations.
#[derive(thiserror::Error, Debug)]
pub enum VcsError {
    /// No upstream is configured for the current branch.
    #[error("no upstream configured")]
    NoUpstream,
    /// The selected backend does not support the requested operation.
    #[error("unsupported backend: {0}")]
    Unsupported(BackendId),
    /// I/O failure raised by filesystem or process operations.
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
    /// Backend-specific error surfaced with backend context.
    #[error("{backend}: {msg}")]
    Backend {
        /// Backend identifier that produced the error.
        backend: BackendId,
        /// Backend-provided error message.
        msg: String,
    },
}

impl VcsError {
    /// Returns a user-facing message suitable for display in the UI.
    ///
    /// Unlike the `Display` impl (which includes the backend identifier — e.g.
    /// `"git: …"`), this returns just the meaningful error content without any
    /// internal routing prefixes.
    pub fn user_message(&self) -> String {
        match self {
            VcsError::NoUpstream => "no upstream configured".to_string(),
            VcsError::Unsupported(backend) => format!("unsupported backend: {backend}"),
            VcsError::Io(e) => e.to_string(),
            VcsError::Backend { msg, .. } => msg.clone(),
        }
    }
}

/// Convenience result type used by the `Vcs` trait.
pub type Result<T> = std::result::Result<T, VcsError>;

/// The single trait every VCS backend implements.
pub trait Vcs: Send + Sync {
    /// Returns the stable identifier for this backend.
    fn id(&self) -> BackendId;

    /// Returns the backend working directory.
    fn workdir(&self) -> &Path;

    /// Returns the current branch name when available.
    fn current_branch(&self) -> Result<Option<String>>;
    /// Returns all branches known by the backend.
    fn branches(&self) -> Result<Vec<models::BranchItem>>;

    /// Creates a new branch and optionally checks it out.
    fn create_branch(&self, name: &str, checkout: bool) -> Result<()>;
    /// Checks out an existing branch by name.
    fn checkout_branch(&self, name: &str) -> Result<()>;

    /// Creates or updates a remote definition.
    fn ensure_remote(&self, name: &str, url: &str) -> Result<()>;
    /// Lists configured remotes as `(name, url)` pairs.
    fn list_remotes(&self) -> Result<Vec<(String, String)>>;
    /// Removes a configured remote.
    fn remove_remote(&self, name: &str) -> Result<()>;
    /// Fetches updates using a remote and refspec.
    fn fetch(&self, remote: &str, refspec: &str, on: Option<models::OnEvent>) -> Result<()>;
    /// Pushes updates using a remote and refspec.
    fn push(&self, remote: &str, refspec: &str, on: Option<models::OnEvent>) -> Result<()>;
    /// Pulls updates in fast-forward-only mode.
    fn pull_ff_only(&self, remote: &str, branch: &str, on: Option<models::OnEvent>) -> Result<()>;

    /// Creates a commit from the provided paths and returns its id.
    fn commit(&self, message: &str, name: &str, email: &str, paths: &[PathBuf]) -> Result<String>;
    /// Creates a commit from the current index and returns its id.
    fn commit_index(&self, message: &str, name: &str, email: &str) -> Result<String>;
    /// Returns status details for files and ahead/behind counts.
    fn status_payload(&self) -> Result<models::StatusPayload>;
    /// Returns commits matching the provided query.
    fn log_commits(&self, query: &models::LogQuery) -> Result<Vec<models::CommitItem>>;
    /// Returns structured diff output for a single file.
    fn diff_file(&self, path: &Path) -> Result<models::DiffFileResult>;
    /// Returns line-oriented diff output for a commit.
    fn diff_commit(&self, rev: &str) -> Result<Vec<String>>;

    /// Returns detailed merge conflict information for a file.
    fn conflict_details(&self, _path: &Path) -> Result<models::ConflictDetails> {
        Err(VcsError::Unsupported(self.id()))
    }
    /// Resolves a conflict by checking out one side for a file.
    fn checkout_conflict_side(&self, _path: &Path, _side: models::ConflictSide) -> Result<()> {
        Err(VcsError::Unsupported(self.id()))
    }
    /// Writes merged content for a conflicted file.
    fn write_merge_result(&self, _path: &Path, _content: &[u8]) -> Result<()> {
        Err(VcsError::Unsupported(self.id()))
    }

    /// Stages changes represented by a textual patch.
    fn stage_patch(&self, patch: &str) -> Result<()>;
    /// Stages explicit paths to the index.
    fn stage_paths(&self, paths: &[PathBuf]) -> Result<()>;
    /// Discards changes for the provided repository-relative paths.
    fn discard_paths(&self, paths: &[PathBuf]) -> Result<()>;
    /// Applies a patch in reverse to revert its changes.
    fn apply_reverse_patch(&self, patch: &str) -> Result<()>;

    /// Deletes a branch by name, optionally forcing deletion.
    fn delete_branch(&self, name: &str, force: bool) -> Result<()>;
    /// Renames an existing branch.
    fn rename_branch(&self, old: &str, new: &str) -> Result<()>;
    /// Merges a branch into the current branch.
    fn merge_into_current(&self, name: &str) -> Result<()>;
    /// Merges a branch into the current branch with an optional message.
    fn merge_into_current_with_message(&self, name: &str, message: Option<&str>) -> Result<()> {
        let _ = message;
        self.merge_into_current(name)
    }
    /// Aborts an in-progress merge operation.
    fn merge_abort(&self) -> Result<()> {
        Err(VcsError::Unsupported(self.id()))
    }
    /// Continues an in-progress merge operation.
    fn merge_continue(&self) -> Result<()> {
        Err(VcsError::Unsupported(self.id()))
    }
    /// Returns whether a merge operation is currently in progress.
    fn merge_in_progress(&self) -> Result<bool> {
        Ok(false)
    }
    /// Sets upstream tracking configuration for a branch.
    fn set_branch_upstream(&self, _branch: &str, _upstream: &str) -> Result<()> {
        Err(VcsError::Unsupported(self.id()))
    }
    /// Returns upstream tracking reference for a branch.
    fn branch_upstream(&self, _branch: &str) -> Result<Option<String>> {
        Err(VcsError::Unsupported(self.id()))
    }

    /// Moves `HEAD` soft-reset style to the given revision.
    fn reset_soft_to(&self, _rev: &str) -> Result<()> {
        Err(VcsError::Unsupported(self.id()))
    }

    /// Returns the configured commit identity, if present.
    fn get_identity(&self) -> Result<Option<(String, String)>>;
    /// Sets repository-local commit identity.
    fn set_identity_local(&self, name: &str, email: &str) -> Result<()>;

    /// Returns all stash entries.
    fn stash_list(&self) -> Result<Vec<models::StashItem>> {
        Err(VcsError::Unsupported(self.id()))
    }
    /// Creates a stash entry from working tree changes.
    fn stash_push(
        &self,
        _message: &str,
        _include_untracked: bool,
        _paths: &[PathBuf],
    ) -> Result<()> {
        Err(VcsError::Unsupported(self.id()))
    }
    /// Applies a stash entry by selector.
    fn stash_apply(&self, _selector: &str) -> Result<()> {
        Err(VcsError::Unsupported(self.id()))
    }
    /// Applies and drops a stash entry by selector.
    fn stash_pop(&self, _selector: &str) -> Result<()> {
        Err(VcsError::Unsupported(self.id()))
    }
    /// Drops a stash entry by selector.
    fn stash_drop(&self, _selector: &str) -> Result<()> {
        Err(VcsError::Unsupported(self.id()))
    }
    /// Shows diff output for a stash entry.
    fn stash_show(&self, _selector: &str) -> Result<Vec<String>> {
        Err(VcsError::Unsupported(self.id()))
    }

    /// Cherry-picks a commit revision.
    fn cherry_pick(&self, _rev: &str) -> Result<()> {
        Err(VcsError::Unsupported(self.id()))
    }
    /// Reverts a commit revision.
    fn revert_commit(&self, _rev: &str, _no_edit: bool) -> Result<()> {
        Err(VcsError::Unsupported(self.id()))
    }
}

#[cfg(test)]
mod tests {
    include!("../../tests/core/mod.rs");
}
