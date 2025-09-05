use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub enum BranchKind {
    Local,
    Remote { remote: String },
    Unknown,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct BranchItem {
    pub name: String,         // branch short name ("main", "feature/x")
    pub full_ref: String,     // full ref ("refs/heads/main", "refs/remotes/origin/main")
    pub kind: BranchKind,
    pub current: bool,
}

/// A single file’s status in the working tree / index.
/// `status` is backend-agnostic (e.g., "A" | "M" | "D" | "R?" etc).
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct FileEntry {
    pub path: String,
    pub status: String,
    pub hunks: Vec<String>,
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
    pub id: String,   // revision/hash as string; backend decides encoding
    pub msg: String,
    pub meta: String, // e.g., date or short info
    pub author: String,
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
        Self { limit, ..Default::default() }
    }
}