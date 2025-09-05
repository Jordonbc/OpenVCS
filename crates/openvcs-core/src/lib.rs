//! OpenVCS Core: VCS-agnostic traits, errors, events, DTOs, and a runtime backend registry.

pub mod models;

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

    fn branches(&self) -> Result<Vec<models::BranchItem>>;

    #[deprecated(since = "0.1", note = "This function is being replaced by `branches`.")]

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

    /// Full working tree status for the UI (files + ahead/behind).
    fn status_payload(&self) -> Result<models::StatusPayload>;

    /// History / log (VCS-agnostic). Returns a single page of commits.
    fn log_commits(&self, query: &models::LogQuery) -> Result<Vec<models::CommitItem>>;

    // Unified diff for a single file, returned as lines (with diff prefixes).
    /// Backends should:
    /// 1) Prefer workdir vs index (unstaged)
    /// 2) Fallback to index vs HEAD (staged)
    /// 3) Include untracked as additions
    fn diff_file(&self, path: &Path) -> Result<Vec<String>>;

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
