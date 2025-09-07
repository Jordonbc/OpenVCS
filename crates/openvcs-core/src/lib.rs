//! OpenVCS Core: VCS-agnostic traits, errors, events, DTOs, and a runtime backend registry.

pub mod models;
pub mod backend_id;
pub mod backend_descriptor;

use std::{path::{Path, PathBuf}, sync::Arc};
pub use crate::backend_id::BackendId;
pub use crate::models::{Capabilities, OnEvent};

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
    /// List configured remotes as (name, url) pairs (fetch URL if multiple).
    fn list_remotes(&self) -> Result<Vec<(String, String)>>;
    /// Remove a configured remote by name (no-op if missing).
    fn remove_remote(&self, name: &str) -> Result<()>;
    fn fetch(&self, remote: &str, refspec: &str, on: Option<OnEvent>) -> Result<()>;
    fn push(&self, remote: &str, refspec: &str, on: Option<OnEvent>) -> Result<()>;

    /// Fast-forward only pull of the current branch from the specified remote/branch.
    /// Implementations should fetch as needed and then update the current branch if a fast-forward is possible.
    fn pull_ff_only(&self, remote: &str, branch: &str, on: Option<OnEvent>) -> Result<()>;

    // content
    fn commit(&self, message: &str, name: &str, email: &str, paths: &[PathBuf]) -> Result<String>;
    /// Commit the current index as-is without staging additional paths.
    /// Implementations should not modify the index before committing.
    fn commit_index(&self, message: &str, name: &str, email: &str) -> Result<String>;
    fn status_summary(&self) -> Result<models::StatusSummary>;

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

    /// Stage a unified-diff patch directly into the index (partial commit support).
    /// Backends may return `VcsError::Unsupported` if not implemented.
    fn stage_patch(&self, patch: &str) -> Result<()>;

    // recovery
    fn hard_reset_head(&self) -> Result<()>;

    // config
    /// Read repository-local identity (user.name, user.email). Returns None if missing.
    fn get_identity(&self) -> Result<Option<(String, String)>>;
    /// Set repository-local identity (user.name, user.email).
    fn set_identity_local(&self, name: &str, email: &str) -> Result<()>;
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
