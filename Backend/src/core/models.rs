// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

//! Shared data models for VCS operations.
//!
//! This module provides backend-agnostic types for representing branches,
//! commits, file statuses, and events across different VCS backends.

use serde::{Deserialize, Serialize};
use std::sync::Arc;

/// Classification of a branch's origin or type.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(tag = "type")]
pub enum BranchKind {
    /// A local branch.
    Local,
    /// A remote tracking branch.
    Remote {
        /// Name of the remote (e.g., "origin").
        remote: String,
    },
    /// A branch of unknown type.
    Unknown,
}

/// A single branch in the repository.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct BranchItem {
    /// Short name of the branch (e.g., "main").
    pub name: String,
    /// Full ref (e.g., "refs/heads/main").
    pub full_ref: String,
    /// Classification of the branch type.
    pub kind: BranchKind,
    /// Whether this is the currently checked-out branch.
    pub current: bool,
}

/// A single file's status in the working tree / index.
/// `status` is backend-agnostic (e.g., "A" | "M" | "D" | "R?" etc).
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct FileEntry {
    /// Path to the file relative to the repository root.
    pub path: String,
    /// Original path for renamed files.
    #[serde(default)]
    pub old_path: Option<String>,
    /// Status code (e.g., "A", "M", "D", "R?").
    pub status: String,
    /// Whether the file is staged (in the index).
    #[serde(default)]
    pub staged: bool,
    /// Whether a conflict has been resolved.
    #[serde(default)]
    pub resolved_conflict: bool,
    /// Diff hunks for the file.
    pub hunks: Vec<String>,
    /// Whether the file content should be treated as binary when known.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub binary: Option<bool>,
}

/// Structured diff payload for one file.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq, Default)]
pub struct DiffFileResult {
    /// Line-oriented diff output.
    #[serde(default)]
    pub lines: Vec<String>,
    /// Whether the diff target should be treated as binary when known.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub binary: Option<bool>,
}

/// Details about a merge conflict in a file.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct ConflictDetails {
    /// Path to the conflicted file.
    pub path: String,
    /// Content from "ours" side of the merge.
    pub ours: Option<String>,
    /// Content from "theirs" side of the merge.
    pub theirs: Option<String>,
    /// Common ancestor content.
    pub base: Option<String>,
    /// Whether the file is binary.
    #[serde(default)]
    pub binary: bool,
}

/// Side of a merge conflict.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum ConflictSide {
    /// The "ours" side (the current branch).
    Ours,
    /// The "theirs" side (the branch being merged).
    Theirs,
}

/// Flat status summary plus file list.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq, Default)]
pub struct StatusPayload {
    /// List of files with their status information.
    pub files: Vec<FileEntry>,
    /// Number of commits ahead of the remote.
    pub ahead: u32,
    /// Number of commits behind the remote.
    pub behind: u32,
    /// Whether the current branch has a tracking reference on a remote.
    #[serde(default)]
    pub branch_on_remote: bool,
}

/// Lightweight commit representation for lists.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct CommitItem {
    /// Commit hash or identifier.
    pub id: String,
    /// Commit message (first line).
    pub msg: String,
    /// Commit metadata (author date, etc.).
    pub meta: String,
    /// Author of the commit.
    pub author: String,
}

/// A single stash entry (backend-agnostic).
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct StashItem {
    /// Selector for the stash entry (e.g., "stash@{0}").
    pub selector: String,
    /// Stash message.
    pub msg: String,
    /// Stash metadata.
    pub meta: String,
}

/// Query for commit history.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq, Default)]
pub struct LogQuery {
    /// Revision range or branch to query.
    pub rev: Option<String>,
    /// Path to filter commits by.
    pub path: Option<String>,
    /// Start date (ISO 8601 format).
    pub since_utc: Option<String>,
    /// End date (ISO 8601 format).
    pub until_utc: Option<String>,
    /// Filter by author name/email.
    pub author_contains: Option<String>,
    /// Number of commits to skip.
    pub skip: u32,
    /// Maximum number of commits to return, or `None` for unlimited.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub limit: Option<u32>,
    /// Sort in topological order.
    pub topo_order: bool,
    /// Include merge commits.
    pub include_merges: bool,
}

impl LogQuery {
    /// Creates a query for the HEAD commit with the given limit.
    pub fn head(limit: u32) -> Self {
        Self {
            limit: Some(limit),
            ..Default::default()
        }
    }
}

/// Events emitted by VCS operations.
///
/// These events are used to communicate progress, warnings, and errors
/// from the VCS backend to the client.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum VcsEvent {
    /// Informational message.
    Info {
        /// The message content.
        msg: String,
    },
    /// Message from the remote server.
    RemoteMessage {
        /// The message content.
        msg: String,
    },
    /// Progress update during a long-running operation.
    Progress {
        /// Current phase of the operation.
        phase: String,
        /// Details about the current progress.
        detail: String,
    },
    /// Authentication request.
    Auth {
        /// Authentication method (e.g., "ssh", "basic").
        method: String,
        /// Additional details about the auth request.
        detail: String,
    },
    /// Push status update.
    PushStatus {
        /// The ref being pushed.
        refname: String,
        /// Status message or None if complete.
        status: Option<String>,
    },
    /// Warning message.
    Warning {
        /// The warning message.
        msg: String,
    },
    /// Error message.
    Error {
        /// The error message.
        msg: String,
    },
}

/// Structured selection of hunks/lines for a single file during partial commit.
///
/// This is VCS-agnostic — each plugin interprets the indices against its own
/// diff output rather than requiring the frontend to parse VCS-specific formats
/// (e.g. `diff --git` for Git, `Index:` for SVN).
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct HunkSelection {
    /// Repository-relative file path.
    pub path: String,
    /// Indices of whole hunks to include in the commit.
    pub whole_hunks: Vec<usize>,
    /// Per-hunk line selections: maps hunk index → list of 1-based line offsets
    /// within that hunk (same numbering the UI uses).
    pub partial_hunks: std::collections::HashMap<usize, Vec<usize>>,
}

/// Describes the capabilities advertised by a VCS backend.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[derive(Default)]
pub struct VcsCaps {
    /// Whether the backend supports merge strategy selection (merge/squash/rebase).
    #[serde(default)]
    pub merge_strategies: bool,
}


/// Callback function type for handling VCS events.
pub type OnEvent = Arc<dyn Fn(VcsEvent) + Send + Sync + 'static>;

#[cfg(test)]
mod tests {
    include!("../../tests/core/models.rs");
}
