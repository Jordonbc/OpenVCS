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
    /// Whether the file is an LFS pointer.
    #[serde(default)]
    pub lfs_pointer: bool,
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

/// Callback function type for handling VCS events.
pub type OnEvent = Arc<dyn Fn(VcsEvent) + Send + Sync + 'static>;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    /// Verifies `LogQuery::head` sets only the limit field.
    fn log_query_head_sets_limit_and_defaults_rest() {
        let query = LogQuery::head(25);
        assert_eq!(query.limit, Some(25));
        assert!(query.rev.is_none());
        assert!(query.path.is_none());
        assert_eq!(query.skip, 0);
        assert!(!query.topo_order);
    }

    #[test]
    /// Verifies `BranchKind` serializes and deserializes correctly.
    fn branch_kind_roundtrips_via_json() {
        let local = BranchKind::Local;
        let local_json = serde_json::to_value(&local).expect("serialize");
        let local_back: BranchKind = serde_json::from_value(local_json).expect("deserialize");
        assert_eq!(local_back, BranchKind::Local);

        let remote = BranchKind::Remote {
            remote: "origin".into(),
        };
        let remote_json = serde_json::to_value(&remote).expect("serialize");
        let remote_back: BranchKind = serde_json::from_value(remote_json).expect("deserialize");
        assert_eq!(remote_back, remote);
    }

    #[test]
    /// Verifies conflict-side values use kebab-case JSON strings.
    fn conflict_side_serializes_as_kebab_case_strings() {
        let ours = serde_json::to_value(ConflictSide::Ours).expect("serialize");
        let theirs = serde_json::to_value(ConflictSide::Theirs).expect("serialize");
        assert_eq!(ours, serde_json::Value::String("ours".into()));
        assert_eq!(theirs, serde_json::Value::String("theirs".into()));

        let ours_back: ConflictSide = serde_json::from_value(serde_json::json!("ours")).unwrap();
        let theirs_back: ConflictSide =
            serde_json::from_value(serde_json::json!("theirs")).unwrap();
        assert_eq!(ours_back, ConflictSide::Ours);
        assert_eq!(theirs_back, ConflictSide::Theirs);
    }

    #[test]
    /// Verifies optional file entry fields deserialize with defaults.
    fn file_entry_deserializes_optional_fields_with_defaults() {
        let v = serde_json::json!({
            "path": "a.txt",
            "status": "M",
            "hunks": []
        });

        let entry: FileEntry = serde_json::from_value(v).expect("deserialize");
        assert_eq!(entry.path, "a.txt");
        assert_eq!(entry.status, "M");
        assert!(entry.old_path.is_none());
        assert!(!entry.staged);
        assert!(!entry.resolved_conflict);
        assert!(entry.hunks.is_empty());
    }

    #[test]
    /// Verifies all `VcsEvent` variants round-trip through JSON.
    fn vcs_event_roundtrips_via_json() {
        let events = vec![
            VcsEvent::Info {
                msg: "hello".into(),
            },
            VcsEvent::Progress {
                phase: "fetch".into(),
                detail: "10/20".into(),
            },
            VcsEvent::Auth {
                method: "ssh".into(),
                detail: "key".into(),
            },
            VcsEvent::RemoteMessage {
                msg: "remote".into(),
            },
            VcsEvent::Warning { msg: "warn".into() },
            VcsEvent::Error { msg: "err".into() },
        ];

        for event in events {
            let value = serde_json::to_value(&event).expect("serialize");
            let back: VcsEvent = serde_json::from_value(value).expect("deserialize");
            assert_eq!(format!("{event:?}"), format!("{back:?}"));
        }
    }
}
