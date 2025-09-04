use std::path::{Path, PathBuf};

use git2::{
    self as g,
    AutotagOption, BranchType, Direction, FetchOptions, Oid, PushOptions,
    Repository, ResetType, Signature, Status, StatusOptions,
};
use serde::Serialize;
use thiserror::Error;

pub type Result<T> = std::result::Result<T, GitError>;

#[derive(Debug, Error)]
pub enum GitError {
    #[error("not a git repository: {0}")]
    NotARepo(String),
    #[error("branch not found: {0}")]
    NoSuchBranch(String),
    #[error("nothing to commit")]
    NothingToCommit,
    #[error("non-fast-forward; merge or rebase required")]
    NonFastForward,
    #[error(transparent)]
    LibGit2(#[from] g::Error),
    #[error(transparent)]
    Io(#[from] std::io::Error),
}

pub struct Git {
    repo: Repository,
    workdir: PathBuf,
}

impl Git {
    /// Open the repo at `path` (or its nearest ancestor containing `.git`).
    pub fn open(path: impl AsRef<Path>) -> Result<Self> {
        let repo = Repository::discover(path)?;
        let workdir = repo
            .workdir()
            .map(|p| p.to_path_buf())
            .ok_or_else(|| GitError::NotARepo("bare repository is not supported".into()))?;
        Ok(Self { repo, workdir })
    }

    /// Clone a repository to `dest`. Honors SSH agent and common HTTPS tokens.
    pub fn clone(url: &str, dest: impl AsRef<Path>) -> Result<Self> {
        let cb = make_remote_callbacks();
        let mut fo = FetchOptions::new();
        fo.remote_callbacks(cb);
        fo.download_tags(AutotagOption::All);

        let mut builder = g::build::RepoBuilder::new();
        builder.fetch_options(fo);

        let repo = builder.clone(url, dest.as_ref())?;
        Ok(Self {
            workdir: repo.workdir().unwrap().to_path_buf(),
            repo,
        })
    }

    /// Current branch name (if HEAD is a branch).
    pub fn current_branch(&self) -> Result<Option<String>> {
        let head = match self.repo.head() {
            Ok(h) => h,
            Err(e) if e.code() == g::ErrorCode::UnbornBranch => return Ok(None),
            Err(e) if e.code() == g::ErrorCode::NotFound => return Ok(None),
            Err(e) => return Err(e.into()),
        };
        if head.is_branch() {
            Ok(head.shorthand().map(|s| s.to_string()))
        } else {
            Ok(None)
        }
    }

    /// List local branch names.
    pub fn local_branches(&self) -> Result<Vec<String>> {
        let mut out = Vec::new();
        for b in self.repo.branches(Some(BranchType::Local))? {
            let (b, _) = b?;
            if let Some(name) = b.name()? {
                out.push(name.to_string());
            }
        }
        Ok(out)
    }

    /// Create a branch at the current HEAD and optionally checkout.
    pub fn create_branch(&self, name: &str, checkout: bool) -> Result<()> {
        let head = self.repo.head()?.peel_to_commit()?;
        self.repo.branch(name, &head, false)?;
        if checkout {
            self.checkout_branch(name)
        } else {
            Ok(())
        }
    }

    /// Checkout an existing local branch.
    pub fn checkout_branch(&self, name: &str) -> Result<()> {
        let (obj, reference) = self
            .repo
            .revparse_ext(&format!("refs/heads/{name}"))
            .map_err(|_| GitError::NoSuchBranch(name.into()))?;
        self.repo.checkout_tree(&obj, None)?;
        if let Some(r) = reference {
            self.repo.set_head(r.name().unwrap())?;
        } else {
            // Fallback: detached
            self.repo.set_head_detached(obj.id())?;
        }
        Ok(())
    }

    /// Add a remote if missing, or return the existing one.
    pub fn ensure_remote(&self, name: &str, url: &str) -> Result<()> {
        match self.repo.find_remote(name) {
            Ok(r) => {
                if r.url() != Some(url) {
                    // align URL if drifted
                    self.repo.remote_set_url(name, url)?;
                }
            }
            Err(_) => {
                self.repo.remote(name, url)?;
            }
        }
        Ok(())
    }

    /// Fetch from a remote (default "origin"). Returns fetched tip OID of `refspec` if present.
    pub fn fetch(&self, remote: &str, refspec: &str) -> Result<Option<Oid>> {
        let cb = make_remote_callbacks();
        let mut fo = FetchOptions::new();
        fo.remote_callbacks(cb);
        fo.download_tags(AutotagOption::All);

        let mut r = self.repo.find_remote(remote)?;
        r.fetch(&[refspec], Some(&mut fo), None)?;

        let fetch_head = self.repo.find_reference("FETCH_HEAD")?;
        let target = fetch_head.target();
        Ok(target)
    }

    /// Fast-forward the current branch to `upstream` (e.g., "origin/main") if possible.
    pub fn fast_forward(&self, upstream: &str) -> Result<()> {
      // split "origin/main"
      let (remote_name, remote_ref) = upstream
          .split_once('/')
          .ok_or_else(|| GitError::LibGit2(g::Error::from_str("expected remote/branch")))?;

      // fetch
      let cb = make_remote_callbacks();
      let mut fo = git2::FetchOptions::new();
      fo.remote_callbacks(cb);
      let mut r = self.repo.find_remote(remote_name)?;
      r.fetch(&[remote_ref], Some(&mut fo), None)?;

      // build annotated commit for refs/remotes/origin/main
      let full = format!("refs/remotes/{upstream}");
      let up_ref = self.repo.find_reference(&full)?;
      let annotated = self.repo.reference_to_annotated_commit(&up_ref)?;

      // analyze
      let (analysis, _pref) = self.repo.merge_analysis(&[&annotated])?;
      if analysis.is_up_to_date() {
          return Ok(());
      }
      if analysis.is_fast_forward() {
          let head_name = self
              .repo
              .head()?
              .name()
              .ok_or_else(|| g::Error::from_str("HEAD name missing"))?
              .to_string();
          let target = up_ref.target().ok_or_else(|| g::Error::from_str("no target"))?;
          let mut reference = self.repo.find_reference(&head_name)?;
          reference.set_target(target, "fast-forward")?;
          self.repo.set_head(&head_name)?;
          self.repo.checkout_head(None)?;
          Ok(())
      } else {
          Err(GitError::NonFastForward)
      }
  }

    /// Stage paths (globs allowed if you pass them expanded) and commit with author/committer.
    pub fn commit(
        &self,
        message: &str,
        name: &str,
        email: &str,
        paths: &[PathBuf],
    ) -> Result<Oid> {
        let mut idx = self.repo.index()?;
        if paths.is_empty() {
            idx.add_all(["*"].iter(), g::IndexAddOption::DEFAULT, None)?;
        } else {
            for p in paths {
                if p.is_dir() {
                    idx.add_all([p.as_path()].iter(), g::IndexAddOption::DEFAULT, None)?;
                } else {
                    let rel = rel_to_workdir(&self.workdir, p)?;
                    idx.add_path(&rel)?;
                }
            }
        }
        if idx.is_empty() {
            return Err(GitError::NothingToCommit);
        }
        let tree_oid = idx.write_tree()?;
        idx.write()?;
        let tree = self.repo.find_tree(tree_oid)?;

        let sig = Signature::now(name, email)?;
        let parents = match self.repo.head() {
            Ok(h) if h.is_branch() => vec![self.repo.head()?.peel_to_commit()?],
            _ => vec![], // initial commit
        };
        let parent_refs: Vec<&g::Commit> = parents.iter().collect();
        let head_ref = if parent_refs.is_empty() {
            None
        } else {
            self.repo.head().ok().and_then(|h| h.name().map(|s| s.to_string()))
        };

        let oid = self
            .repo
            .commit(head_ref.as_deref(), &sig, &sig, message, &tree, &parent_refs)?;

        Ok(oid)
    }

    /// Push the current branch to `remote` (default "origin") with upstream set.
    pub fn push_current(&self, remote: &str) -> Result<()> {
        let current = self
            .current_branch()?
            .ok_or_else(|| GitError::LibGit2(g::Error::from_str("detached HEAD")))?;
        self.push_refspec(remote, &format!("refs/heads/{0}:refs/heads/{0}", current))
    }

    pub fn push_refspec(&self, remote: &str, refspec: &str) -> Result<()> {
        let cb = make_remote_callbacks();
        let mut opts = PushOptions::new();
        opts.remote_callbacks(cb);

        let mut r = self.repo.find_remote(remote)?;
        r.connect(Direction::Push)?;
        r.push(&[refspec], Some(&mut opts))?;
        Ok(())
    }

    /// Quick status summary (counts only).
    pub fn status_summary(&self) -> Result<StatusSummary> {
        let mut sopts = StatusOptions::new();
        sopts.include_untracked(true).recurse_untracked_dirs(true);
        let statuses = self.repo.statuses(Some(&mut sopts))?;

        let mut summary = StatusSummary::default();
        for e in statuses.iter() {
            let s = e.status();
            if s.contains(Status::WT_NEW) {
                summary.untracked += 1;
            } else if s.contains(Status::WT_MODIFIED) || s.contains(Status::WT_TYPECHANGE) {
                summary.modified += 1;
            }
            if s.contains(Status::INDEX_NEW)
                || s.contains(Status::INDEX_MODIFIED)
                || s.contains(Status::INDEX_TYPECHANGE)
            {
                summary.staged += 1;
            }
            if s.contains(Status::CONFLICTED) {
                summary.conflicted += 1;
            }
        }
        Ok(summary)
    }

    /// Reset working tree to HEAD (discard local changes).
    pub fn hard_reset_head(&self) -> Result<()> {
        let head = self.repo.head()?.peel_to_commit()?;
        self.repo.reset(head.as_object(), ResetType::Hard, None)?;
        Ok(())
    }

    /// Expose the underlying `Repository` if you need lower-level ops.
    pub fn inner(&self) -> &Repository {
        &self.repo
    }
}

#[derive(Default, Clone, Copy, Debug)]
pub struct StatusSummary {
    pub untracked: usize,
    pub modified: usize,
    pub staged: usize,
    pub conflicted: usize,
}

/* -------------------------- helpers -------------------------- */

fn make_remote_callbacks() -> git2::RemoteCallbacks<'static> {
    let mut cb = git2::RemoteCallbacks::new();

    cb.credentials(|_url, username_from_url, allowed| {
        // 1) SSH agent
        if allowed.contains(git2::CredentialType::SSH_KEY) {
            let user = username_from_url.unwrap_or("git");
            return git2::Cred::ssh_key_from_agent(user);
        }

        // 2) HTTPS token via env (PAT)
        if allowed.contains(git2::CredentialType::USER_PASS_PLAINTEXT) {
            if let Ok(token) = std::env::var("GIT_TOKEN")
                .or_else(|_| std::env::var("GITHUB_TOKEN"))
            {
                let user = username_from_url.unwrap_or("git");
                return git2::Cred::userpass_plaintext(user, &token);
            }
        }

        // 3) Default (Keychain/manager on some platforms; otherwise anonymous)
        git2::Cred::default()
    });

    cb
}


/// Turn absolute path into repo-relative for index operations.
fn rel_to_workdir(workdir: &Path, p: &Path) -> Result<PathBuf> {
    if p.is_absolute() {
        let rel = p.strip_prefix(workdir).map_err(|_| {
            GitError::Io(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "path is outside workdir",
            ))
        })?;
        Ok(rel.to_path_buf())
    } else {
        Ok(p.to_path_buf())
    }
}

#[derive(Serialize)]
pub struct BranchItem {
    pub name: String,
    pub current: bool,
}

#[derive(Serialize)]
pub struct FileEntry {
    pub path: String,
    pub status: String,        // "A" | "M" | "D" | etc.
    pub hunks: Vec<String>,    // your UI accepts an array; keep empty for now
}

#[derive(Serialize)]
pub struct StatusPayload {
    pub files: Vec<FileEntry>,
    pub ahead: u32,
    pub behind: u32,
}

#[derive(Serialize)]
pub struct CommitItem {
    pub id: String,       // full sha; UI slices to 7 chars
    pub msg: String,
    pub meta: String,     // commit date or short info
    pub author: String,
}

/* Helper: read identity via your Git::inner() */
pub fn git_identity(git: &Git) -> Option<(String, String)> {
    let cfg = git.inner().config().ok()?;
    let name  = cfg.get_string("user.name").ok()?;
    let email = cfg.get_string("user.email").ok()?;
    if name.trim().is_empty() || email.trim().is_empty() { return None; }
    Some((name, email))
}
