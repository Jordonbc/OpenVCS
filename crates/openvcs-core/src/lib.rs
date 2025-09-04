use std::{path::{Path, PathBuf}, sync::Arc};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum BackendId { GitSystem, GitLibGit2 /*, Mercurial, Fossil */ }

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
    #[error("unsupported by backend {0:?}")]
    Unsupported(BackendId),
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
    #[error("{backend:?}: {msg}")]
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

pub trait Vcs: Send + Sync {
    fn id(&self) -> BackendId;
    fn caps(&self) -> Capabilities;

    fn open(path: &Path) -> Result<Self> where Self: Sized;
    fn clone(url: &str, dest: &Path, on: Option<OnEvent>) -> Result<Self> where Self: Sized;

    fn workdir(&self) -> &Path;

    fn current_branch(&self) -> Result<Option<String>>;
    fn local_branches(&self) -> Result<Vec<String>>;
    fn create_branch(&self, name: &str, checkout: bool) -> Result<()>;
    fn checkout_branch(&self, name: &str) -> Result<()>;

    fn ensure_remote(&self, name: &str, url: &str) -> Result<()>;
    fn fetch(&self, remote: &str, refspec: &str, on: Option<OnEvent>) -> Result<()>;
    fn push(&self, remote: &str, refspec: &str, on: Option<OnEvent>) -> Result<()>;

    fn commit(&self, message: &str, name: &str, email: &str, paths: &[PathBuf]) -> Result<String>;
    fn status_summary(&self) -> Result<StatusSummary>;
    fn hard_reset_head(&self) -> Result<()>;
}

pub struct Repo {
    inner: Arc<dyn Vcs>,
}
impl Repo {
    pub fn new(inner: Arc<dyn Vcs>) -> Self { Self { inner } }
    pub fn id(&self) -> BackendId { self.inner.id() }
    pub fn caps(&self) -> Capabilities { self.inner.caps() }
    pub fn inner(&self) -> &dyn Vcs { &*self.inner }
}
