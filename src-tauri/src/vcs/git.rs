use std::path::Path;
use git2::{Repository, BranchType};
use crate::vcs::vcs::{Vcs, VcsError};

pub struct GitVcs;

impl GitVcs {
  #[allow(dead_code)]
  pub fn new() -> Self {
    GitVcs
  }
}

impl Vcs for GitVcs {
  fn init_repo(&self, path: &Path) -> Result<(), VcsError> {
    Repository::init(path)?;
    Ok(())
  }

  fn clone_repo(&self, url: &str, path: &Path) -> Result<(), VcsError> {
    Repository::clone(url, path)?;
    Ok(())
  }

  fn list_branches(&self, path: &Path) -> Result<Vec<String>, VcsError> {
    let repo = Repository::open(path)?;
    let mut names = Vec::new();
    for branch in repo.branches(Some(BranchType::Local))? {
      let (branch, _) = branch?;
      if let Some(name) = branch.name()? {
        names.push(name.to_string());
      }
    }
    Ok(names)
  }

  fn commit_all(&self, path: &Path, message: &str) -> Result<(), VcsError> {
    let repo = Repository::open(path)?;
    let mut index = repo.index()?;
    index.add_all(["*"].iter(), git2::IndexAddOption::DEFAULT, None)?;
    let tree_id = index.write_tree()?;
    let tree = repo.find_tree(tree_id)?;
    let sig = repo.signature()?;
    let parent_commit = repo.head()
      .and_then(|h| h.peel_to_commit())
      .ok();
    let parents = parent_commit.iter().collect::<Vec<_>>();
    repo.commit(
      Some("HEAD"),
      &sig,
      &sig,
      message,
      &tree,
      &parents
    )?;
    Ok(())
  }

  fn push(&self, path: &Path, remote: &str, branch: &str) -> Result<(), VcsError> {
    let repo = Repository::open(path)?;
    let mut r = repo.find_remote(remote)?;
    let refspec = format!("refs/heads/{}:refs/heads/{}", branch, branch);
    r.push(&[&refspec], None)?;
    Ok(())
  }
}
