//! OpenVCS Core: VCS-agnostic traits, errors, events, DTOs, and a runtime backend registry.

use std::{path::{Path, PathBuf}, sync::Arc};

/// Backend identifiers are stable, kebab-case strings registered by each backend crate.
pub type BackendId = &'static str;

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
    Progress { phase: &'static str, detail: String },
    Auth { method: &'static str, detail: String },
    PushStatus { refname: String, status: Option<String> },
    Warning(String),
    Error(String),
}
pub type OnEvent = Arc<dyn Fn(VcsEvent) + Send + Sync + 'static>;

#[derive(thiserror::Error, Debug)]
pub enum VcsError {
    #[error("not a repository: {0}")]
    NotARepo(String),
    #[error("branch not found: {0}")]
    NoSuchBranch(String),
    #[error("nothing to commit")]
    NothingToCommit,
    #[error("non-fast-forward; merge or rebase required")]
    NonFastForward,
    #[error("unsupported backend: {0}")]
    Unsupported(BackendId),
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
    #[error("{backend}: {msg}")]
    Backend { backend: BackendId, msg: String },
}
pub type Result<T> = std::result::Result<T, VcsError>;

#[derive(Default, Clone, Copy, Debug)]
pub struct StatusSummary {
    pub untracked: usize,
    pub modified: usize,
    pub staged: usize,
    pub conflicted: usize,
}

/// The single trait every backend implements. This API is intentionally small and VCS-agnostic.
pub trait Vcs: Send + Sync {
    fn id(&self) -> BackendId;
    fn caps(&self) -> Capabilities;

    // lifecycle
    fn open(path: &Path) -> Result<Self> where Self: Sized;
    fn clone(url: &str, dest: &Path, on: Option<OnEvent>) -> Result<Self> where Self: Sized;

    // context
    fn workdir(&self) -> &Path;

    // common ops
    fn current_branch(&self) -> Result<Option<String>>;
    fn local_branches(&self) -> Result<Vec<String>>;
    fn create_branch(&self, name: &str, checkout: bool) -> Result<()>;
    fn checkout_branch(&self, name: &str) -> Result<()>;

    // network
    fn ensure_remote(&self, name: &str, url: &str) -> Result<()>;
    fn fetch(&self, remote: &str, refspec: &str, on: Option<OnEvent>) -> Result<()>;
    fn push(&self, remote: &str, refspec: &str, on: Option<OnEvent>) -> Result<()>;

    // content
    fn commit(&self, message: &str, name: &str, email: &str, paths: &[PathBuf]) -> Result<String>;
    fn status_summary(&self) -> Result<StatusSummary>;

    /// History / log (VCS-agnostic). Returns a single page of commits.
    fn log_commits(&self, query: &models::LogQuery) -> Result<Vec<models::CommitItem>>;

    // recovery
    fn hard_reset_head(&self) -> Result<()>;
}

/// A concrete repository handle that owns a chosen backend instance.
pub struct Repo {
    inner: Arc<dyn Vcs>,
}

impl Repo {
    pub fn new(inner: Arc<dyn Vcs>) -> Self {
        // Log once on construction so we know which backend we wrapped.
        log::debug!("openvcs-core: Repo created with backend {}", inner.id());
        Self { inner }
    }

    #[inline]
    pub fn id(&self) -> BackendId {
        let id = self.inner.id();
        log::trace!("openvcs-core: Repo::id -> {id}");
        id
    }

    #[inline]
    pub fn caps(&self) -> Capabilities {
        let caps = self.inner.caps();
        log::trace!(
            "openvcs-core: Repo::caps -> commits={}, branches={}, tags={}, staging={}, push_pull={}, fast_forward={}",
            caps.commits, caps.branches, caps.tags, caps.staging, caps.push_pull, caps.fast_forward
        );
        caps
    }

    #[inline]
    pub fn inner(&self) -> &dyn Vcs {
        log::trace!("openvcs-core: Repo::inner");
        &*self.inner
    }
}


/* ========================= Runtime backend registry =========================
   Backends contribute a `BackendDescriptor` into the distributed slice below.
   The app can enumerate and pick any registered backend at runtime.
=============================================================================*/

/// Factory & metadata for a backend implementation.
pub struct BackendDescriptor {
    pub id: BackendId,                      // e.g., "git-libgit2"
    pub name: &'static str,                 // human-readable, e.g., "Git (libgit2)"
    pub caps: fn() -> Capabilities,         // capabilities without opening a repo
    pub open: fn(&Path) -> Result<Arc<dyn Vcs>>,
    pub clone_repo: fn(&str, &Path, Option<OnEvent>) -> Result<Arc<dyn Vcs>>,
}

/// The global registry. Each backend crate declares exactly one `BackendDescriptor` here.
#[linkme::distributed_slice]
pub static BACKENDS: [BackendDescriptor] = [..];

/// Enumerate all registered backends (order is link-order; do not rely on it).
pub fn list_backends() -> impl Iterator<Item = &'static BackendDescriptor> {
    use log::{debug, trace};

    // Create the iterator first so we can both inspect and return it.
    let it = BACKENDS.iter();

    // Cheap to ask the length from the slice iterator.
    debug!("openvcs-core: {} backends registered", it.len());

    // Optionally enumerate each backend at trace level.
    for b in it.clone() {
        trace!("openvcs-core: backend loaded: {} ({})", b.id, b.name);
    }

    it
}

/// Lookup a backend descriptor by id.
pub fn get_backend(id: &str) -> Option<&'static BackendDescriptor> {
    use log::{debug, warn};

    match BACKENDS.iter().find(|b| b.id == id) {
        Some(b) => {
            debug!("openvcs-core: backend lookup succeeded → {} ({})", b.id, b.name);
            Some(b)
        }
        None => {
            warn!("openvcs-core: backend lookup failed for id='{id}'");
            None
        }
    }
}


/* ================================ DTOs ===================================== */

pub mod models {
    use serde::{Deserialize, Serialize};

    #[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
    pub struct BranchItem {
        pub name: String,
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
}
