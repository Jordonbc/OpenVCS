use std::path::Path;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum VcsError {
  #[error("IO error: {0}")]
  Io(#[from] std::io::Error),
  #[error("Git error: {0}")]
  Git(#[from] git2::Error),
}

pub trait Vcs: Send + Sync + 'static {
  fn init_repo(&self, path: &Path) -> Result<(), VcsError>;
  fn clone_repo(&self, url: &str, path: &Path) -> Result<(), VcsError>;
  fn list_branches(&self, path: &Path) -> Result<Vec<String>, VcsError>;
  fn commit_all(&self, path: &Path, message: &str) -> Result<(), VcsError>;
  fn push(&self, path: &Path, remote: &str, branch: &str) -> Result<(), VcsError>;
}
