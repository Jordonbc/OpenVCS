use serde::{Deserialize, Serialize};
use std::sync::Arc;

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(tag = "type")]
pub enum BranchKind {
    Local,
    Remote { remote: String },
    Unknown,
}

#[derive(Default, Clone, Copy, Debug)]
pub struct StatusSummary {
    pub untracked: usize,
    pub modified: usize,
    pub staged: usize,
    pub conflicted: usize,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct BranchItem {
    pub name: String,     // branch short name ("main", "feature/x")
    pub full_ref: String, // full ref ("refs/heads/main", "refs/remotes/origin/main")
    pub kind: BranchKind,
    pub current: bool,
}

/// A single file’s status in the working tree / index.
/// `status` is backend-agnostic (e.g., "A" | "M" | "D" | "R?" etc).
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct FileEntry {
    pub path: String,
    #[serde(default)]
    pub old_path: Option<String>,
    pub status: String,
    #[serde(default)]
    pub staged: bool,
    #[serde(default)]
    pub resolved_conflict: bool,
    pub hunks: Vec<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct ConflictDetails {
    pub path: String,
    pub ours: Option<String>,
    pub theirs: Option<String>,
    pub base: Option<String>,
    #[serde(default)]
    pub binary: bool,
    #[serde(default)]
    pub lfs_pointer: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum ConflictSide {
    Ours,
    Theirs,
}

/// Flat status summary plus file list, suitable for your UI.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq, Default)]
pub struct StatusPayload {
    pub files: Vec<FileEntry>,
    pub ahead: u32,
    pub behind: u32,
}

/// Lightweight commit representation for lists.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct CommitItem {
    pub id: String, // revision/hash as string; backend decides encoding
    pub msg: String,
    pub meta: String, // e.g., date or short info
    pub author: String,
}

/// Options controlling fetch behavior.
#[derive(Default, Clone, Copy, Debug)]
pub struct FetchOptions {
    /// When true, remove any remote-tracking refs that no longer exist on the remote.
    pub prune: bool,
}

/// A single stash entry (backend-agnostic)
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct StashItem {
    /// Selector like `stash@{0}` that can be used in commands.
    pub selector: String,
    /// Short message/subject.
    pub msg: String,
    /// Free-form metadata (date, branch, etc.).
    pub meta: String,
}

/// Query for commit history. Keep this VCS-agnostic and stable.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq, Default)]
pub struct LogQuery {
    /// Show commits reachable from this ref. `None` = HEAD.
    pub rev: Option<String>,
    /// Optional path filter (single path for now; extendable to Vec later).
    pub path: Option<String>,
    /// ISO 8601 `since` (UTC) e.g. "2025-09-01T00:00:00Z".
    pub since_utc: Option<String>,
    /// ISO 8601 `until` (UTC).
    pub until_utc: Option<String>,
    /// Author substring match ("name" or "name <email>").
    pub author_contains: Option<String>,
    /// Pagination
    pub skip: u32,
    pub limit: u32, // required by most UIs
    /// Prefer topological order when true, otherwise chronological.
    pub topo_order: bool,
    /// Include merge commits when true (backends may ignore if unsupported).
    pub include_merges: bool,
}

impl LogQuery {
    pub fn head(limit: u32) -> Self {
        Self {
            limit,
            ..Default::default()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn log_query_head_sets_limit_and_defaults_rest() {
        let query = LogQuery::head(25);
        assert_eq!(query.limit, 25);
        assert!(query.rev.is_none());
        assert!(query.path.is_none());
        assert_eq!(query.skip, 0);
        assert!(!query.topo_order);
    }

    #[test]
    fn status_summary_default_is_zeroed() {
        let summary = StatusSummary::default();
        assert_eq!(summary.untracked, 0);
        assert_eq!(summary.modified, 0);
        assert_eq!(summary.staged, 0);
        assert_eq!(summary.conflicted, 0);
    }
}

#[derive(Clone, Debug, Default)]
pub struct Capabilities {
    pub commits: bool,
    pub branches: bool,
    pub tags: bool,
    pub staging: bool,
    pub push_pull: bool,
    pub fast_forward: bool,
}

#[derive(Clone, Debug)]
pub enum VcsEvent {
    Info(&'static str),
    RemoteMessage(String),
    Progress {
        phase: &'static str,
        detail: String,
    },
    Auth {
        method: &'static str,
        detail: String,
    },
    PushStatus {
        refname: String,
        status: Option<String>,
    },
    Warning(String),
    Error(String),
}
pub type OnEvent = Arc<dyn Fn(VcsEvent) + Send + Sync + 'static>;
