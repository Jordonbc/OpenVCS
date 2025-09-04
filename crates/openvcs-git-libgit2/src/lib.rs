//! libgit2 backend for OpenVCS

use std::{path::{Path, PathBuf}, sync::Arc};
use openvcs_core::*;

fn caps_static() -> Capabilities {
    Capabilities { commits: true, branches: true, tags: true, staging: true, push_pull: true, fast_forward: true }
}
fn open_factory(path: &std::path::Path) -> Result<Arc<dyn Vcs>> {
    GitLibGit2::open(path).map(|v| Arc::new(v) as Arc<dyn Vcs>)
}
fn clone_factory(url: &str, dest: &std::path::Path, on: Option<openvcs_core::OnEvent>) -> Result<Arc<dyn Vcs>> {
    GitLibGit2::clone(url, dest, on).map(|v| Arc::new(v) as Arc<dyn Vcs>)
}

#[linkme::distributed_slice(BACKENDS)]
pub static GIT_LG2_DESC: BackendDescriptor = BackendDescriptor {
    id: GIT_LIBGIT2_ID,
    name: "Git (libgit2)",
    caps: caps_static,
    open: open_factory,
    clone_repo: clone_factory,
};

/* =========================================================================================
   Low-level module: your original git.rs, adapted to wrap Repository in Arc<Mutex<…>>.
   ========================================================================================= */
mod ll {
    use std::{
        path::{Path, PathBuf},
        sync::{Arc, Mutex, atomic::{AtomicUsize, Ordering}},
    };
    use git2::{
        self as g,
        AutotagOption, BranchType, FetchOptions, Oid, PushOptions,
        Repository, ResetType, Signature, Status, StatusOptions,
    };
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
        repo: Arc<Mutex<Repository>>,
        workdir: PathBuf,
    }

    impl Git {
        pub fn open(path: impl AsRef<Path>) -> Result<Self> {
            println!("Opening repository at {}...", path.as_ref().display());
            let repo = Repository::discover(path)?;
            let workdir = repo
                .workdir()
                .map(|p| p.to_path_buf())
                .ok_or_else(|| GitError::NotARepo("bare repository is not supported".into()))?;
            Ok(Self { repo: Arc::new(Mutex::new(repo)), workdir })
        }

        pub fn clone(url: &str, dest: impl AsRef<Path>) -> Result<Self> {
            println!("Cloning {url} to {}...", dest.as_ref().display());
            let cb = make_remote_callbacks();
            let mut fo = FetchOptions::new();
            fo.remote_callbacks(cb);
            fo.download_tags(AutotagOption::All);

            let mut builder = g::build::RepoBuilder::new();
            builder.fetch_options(fo);

            let repo = builder.clone(url, dest.as_ref())?;
            println!("Clone completed.");

            Ok(Self {
                workdir: repo.workdir().unwrap().to_path_buf(),
                repo: Arc::new(Mutex::new(repo)),
            })
        }

        #[inline]
        pub fn workdir(&self) -> &Path { &self.workdir }

        #[inline]
        pub fn with_repo<T>(&self, f: impl FnOnce(&Repository) -> T) -> T {
            let repo = self.repo.lock().expect("libgit2 repo poisoned");
            f(&*repo)
        }

        pub fn current_branch(&self) -> Result<Option<String>> {
            println!("Getting current branch...");
            self.with_repo(|repo| {
                let head = match repo.head() {
                    Ok(h) => h,
                    Err(e) if e.code() == g::ErrorCode::UnbornBranch => return Ok(None),
                    Err(e) if e.code() == g::ErrorCode::NotFound => return Ok(None),
                    Err(e) => return Err(GitError::LibGit2(e)),
                };
                if head.is_branch() {
                    Ok(head.shorthand().map(|s| s.to_string()))
                } else {
                    Ok(None)
                }
            })
        }

        pub fn local_branches(&self) -> Result<Vec<String>> {
            println!("Listing local branches...");
            self.with_repo(|repo| {
                let mut out = Vec::new();
                for b in repo.branches(Some(BranchType::Local))? {
                    let (b, _) = b?;
                    if let Some(name) = b.name()? {
                        out.push(name.to_string());
                    }
                }
                println!("Found {} local branches.", out.len());
                Ok(out)
            })
        }

        pub fn create_branch(&self, name: &str, checkout: bool) -> Result<()> {
            println!("Creating branch {name}...");
            self.with_repo(|repo| -> Result<()> {
                let head = repo.head()?.peel_to_commit()?;
                repo.branch(name, &head, false)?;
                Ok(())
            })?;
            if checkout {
                self.checkout_branch(name)
            } else {
                Ok(())
            }
        }

        pub fn checkout_branch(&self, name: &str) -> Result<()> {
            println!("Checking out branch {name}...");
            self.with_repo(|repo| {
                let (obj, reference) = repo
                    .revparse_ext(&format!("refs/heads/{name}"))
                    .map_err(|_| GitError::NoSuchBranch(name.into()))?;
                repo.checkout_tree(&obj, None)?;
                if let Some(r) = reference {
                    repo.set_head(r.name().unwrap())?;
                } else {
                    repo.set_head_detached(obj.id())?;
                }
                println!("Checked out branch {name}.");
                Ok(())
            })
        }

        pub fn ensure_remote(&self, name: &str, url: &str) -> Result<()> {
            println!("Ensuring remote {name} at {url}...");
            self.with_repo(|repo| {
                match repo.find_remote(name) {
                    Ok(r) => {
                        if r.url() != Some(url) {
                            repo.remote_set_url(name, url)?;
                        }
                    }
                    Err(_) => {
                        repo.remote(name, url)?;
                    }
                }
                Ok(())
            })
        }

        pub fn fetch_with_progress<F>(&self, remote: &str, refspec: &str, on: F) -> Result<Option<Oid>>
        where
            F: Fn(String) + Send + Sync + 'static,
        {
            let cb = make_remote_callbacks_with_progress(on);
            let mut fo = FetchOptions::new();
            fo.remote_callbacks(cb);
            fo.download_tags(AutotagOption::All);

            self.with_repo(|repo| {
                let mut r = repo.find_remote(remote)?;
                r.fetch(&[refspec], Some(&mut fo), None)?;
                let fetch_head = repo.find_reference("FETCH_HEAD")?;
                Ok(fetch_head.target())
            })
        }

        pub fn fetch(&self, remote: &str, refspec: &str) -> Result<Option<Oid>> {
            self.fetch_with_progress(remote, refspec, |_| {})
        }

        pub fn fast_forward(&self, upstream: &str) -> Result<()> {
            println!("Fetching and fast-forwarding to {upstream}...");
            self.with_repo(|repo| -> Result<()> {
                let (remote_name, remote_ref) = upstream
                    .split_once('/')
                    .ok_or_else(|| GitError::LibGit2(g::Error::from_str("expected remote/branch")))?;

                let cb = make_remote_callbacks();
                let mut fo = git2::FetchOptions::new();
                fo.remote_callbacks(cb);
                let mut r = repo.find_remote(remote_name)?;
                r.fetch(&[remote_ref], Some(&mut fo), None)?;

                let full = format!("refs/remotes/{upstream}");
                let up_ref = repo.find_reference(&full)?;
                let annotated = repo.reference_to_annotated_commit(&up_ref)?;

                let (analysis, _pref) = repo.merge_analysis(&[&annotated])?;
                if analysis.is_up_to_date() {
                    return Ok(());
                }
                if analysis.is_fast_forward() {
                    let head_name = repo
                        .head()?
                        .name()
                        .ok_or_else(|| g::Error::from_str("HEAD name missing"))?
                        .to_string();
                    let target = up_ref.target().ok_or_else(|| g::Error::from_str("no target"))?;
                    let mut reference = repo.find_reference(&head_name)?;
                    reference.set_target(target, "fast-forward")?;
                    repo.set_head(&head_name)?;
                    repo.checkout_head(None)?;
                    Ok(())
                } else {
                    Err(GitError::NonFastForward)
                }
            })
        }

        pub fn commit(
            &self,
            message: &str,
            name: &str,
            email: &str,
            paths: &[PathBuf],
        ) -> Result<g::Oid> {
            println!("Committing changes...");
            self.with_repo(|repo| {
                let mut idx = repo.index()?;
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
                let tree = repo.find_tree(tree_oid)?;

                let sig = Signature::now(name, email)?;
                let parents = match repo.head() {
                    Ok(h) if h.is_branch() => vec![repo.head()?.peel_to_commit()?],
                    _ => vec![],
                };
                let parent_refs: Vec<&g::Commit> = parents.iter().collect();
                let head_ref = if parent_refs.is_empty() {
                    None
                } else {
                    repo.head().ok().and_then(|h| h.name().map(|s| s.to_string()))
                };

                let oid = repo
                    .commit(head_ref.as_deref(), &sig, &sig, message, &tree, &parent_refs)?;
                println!("Commit {} created.", oid);
                Ok(oid)
            })
        }

        pub fn push_refspec_with_progress<F>(&self, remote: &str, refspec: &str, on: F) -> Result<()>
        where
            F: Fn(String) + Send + Sync + 'static,
        {
            println!("Attempting to push {refspec} to {remote}...");
            let cb = make_remote_callbacks_with_progress(on);
            let mut opts = PushOptions::new();
            opts.remote_callbacks(cb);

            self.with_repo(|repo| {
                println!("Finding remote {remote}...");
                let mut r = repo.find_remote(remote)?;
                println!("Remote found, starting push...");
                r.push(&[refspec], Some(&mut opts))?;
                println!("Push completed.");
                Ok(())
            })
        }

        pub fn status_summary(&self) -> Result<StatusSummary> {
            self.with_repo(|repo| {
                let mut sopts = StatusOptions::new();
                sopts.include_untracked(true).recurse_untracked_dirs(true);
                let statuses = repo.statuses(Some(&mut sopts))?;

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
            })
        }

        pub fn hard_reset_head(&self) -> Result<()> {
            println!("Resetting working tree to HEAD...");
            self.with_repo(|repo| {
                let head = repo.head()?.peel_to_commit()?;
                repo.reset(head.as_object(), ResetType::Hard, None)?;
                println!("Reset completed.");
                Ok(())
            })
        }
    }

    #[derive(Default, Clone, Copy, Debug)]
    pub struct StatusSummary {
        pub untracked: usize,
        pub modified: usize,
        pub staged: usize,
        pub conflicted: usize,
    }

    fn make_remote_callbacks() -> git2::RemoteCallbacks<'static> {
        make_remote_callbacks_with_progress(|_| {})
    }

    pub fn make_remote_callbacks_with_progress<F>(on: F) -> git2::RemoteCallbacks<'static>
    where
        F: Fn(String) + Send + Sync + 'static,
    {
        use std::sync::Arc;
        let on = Arc::new(on);
        let mut cb = git2::RemoteCallbacks::new();

        // ---- credentials: single attempt, then abort with Auth error ----
        let attempts = Arc::new(AtomicUsize::new(0));
        {
            let on = Arc::clone(&on);
            let attempts = Arc::clone(&attempts);

            cb.credentials(move |_url, username_from_url, allowed| {
                let n = attempts.fetch_add(1, Ordering::SeqCst) + 1;
                let user = username_from_url.unwrap_or("git");

                (on)(format!(
                    "auth: attempt #{n}, allowed={:?}, user_hint={:?}",
                    allowed, username_from_url
                ));

                if allowed.contains(git2::CredentialType::SSH_KEY) {
                    if n == 1 {
                        (on)(format!("auth: trying SSH agent for user `{user}`"));
                        return git2::Cred::ssh_key_from_agent(user);
                    } else {
                        return Err(git2::Error::new(
                            git2::ErrorCode::Auth,
                            git2::ErrorClass::Ssh,
                            "auth: agent key rejected; aborting",
                        ));
                    }
                }

                Err(git2::Error::new(
                    git2::ErrorCode::Auth,
                    git2::ErrorClass::Ssh,
                    "auth: no usable SSH credential",
                ))
            });
        }

        // sideband
        {
            let on = Arc::clone(&on);
            cb.sideband_progress(move |data| {
                if let Ok(s) = std::str::from_utf8(data) {
                    (on)(format!("remote: {}", s.trim_end()));
                }
                true
            });
        }

        // transfer/push progress
        {
            let on = Arc::clone(&on);
            cb.transfer_progress(move |p| {
                (on)(format!(
                    "pushing… {}/{} deltas, {}/{} objects",
                    p.indexed_deltas(),
                    p.total_deltas(),
                    p.indexed_objects(),
                    p.total_objects()
                ));
                true
            });
        }

        // per-ref push status
        {
            let on = Arc::clone(&on);
            cb.push_update_reference(move |refname, status| {
                if let Some(s) = status {
                    (on)(format!("push status: {refname} → {s}"));
                } else {
                    (on)(format!("push status: {refname} ok"));
                }
                Ok(())
            });
        }

        cb
    }

    /// Turn absolute path into repo-relative for index operations.
    pub fn rel_to_workdir(workdir: &Path, p: &Path) -> Result<PathBuf> {
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

    pub fn git_identity(git: &Git) -> Option<(String, String)> {
        println!("Reading Git identity from config...");
        git.with_repo(|repo| {
            let cfg = repo.config().ok()?;
            let name  = cfg.get_string("user.name").ok()?;
            let email = cfg.get_string("user.email").ok()?;
            if name.trim().is_empty() || email.trim().is_empty() { return None; }
            println!("Git identity: {name} <{email}>");
            Some((name, email))
        })
    }
}
/* ========================== end low-level module ========================================== */

/* =========================================================================================
   Public wrapper: implement the openvcs-core::Vcs trait using the low-level libgit2 code.
   ========================================================================================= */

/// Libgit2-backed VCS implementation.
pub struct GitLibGit2 {
    inner: ll::Git,
}

impl GitLibGit2 {
    fn map_err<E: std::fmt::Display>(e: E) -> VcsError {
        VcsError::Backend { backend: GIT_LIBGIT2_ID, msg: e.to_string() }
    }

    fn adapt_progress(on: Option<OnEvent>) -> impl Fn(String) + Send + Sync + 'static {
        move |s: String| {
            if let Some(cb) = &on {
                if s.starts_with("remote: ") {
                    cb(VcsEvent::RemoteMessage(s));
                } else if s.starts_with("auth:") {
                    cb(VcsEvent::Auth { method: "ssh", detail: s });
                } else if let Some(rest) = s.strip_prefix("push status: ") {
                    let (refname, status) = if let Some((l, r)) = rest.split_once(" → ") {
                        (l.to_string(), Some(r.to_string()))
                    } else if let Some((l, _)) = rest.split_once(" ok") {
                        (l.to_string(), None)
                    } else {
                        (rest.to_string(), None)
                    };
                    cb(VcsEvent::PushStatus { refname, status });
                } else {
                    cb(VcsEvent::Progress { phase: "libgit2", detail: s });
                }
            }
        }
    }
}

impl Vcs for GitLibGit2 {
    fn id(&self) -> BackendId { GIT_LIBGIT2_ID }
    
    fn caps(&self) -> Capabilities {
        Capabilities { commits: true, branches: true, tags: true, staging: true, push_pull: true, fast_forward: true }
    }

    fn open(path: &Path) -> Result<Self> {
        ll::Git::open(path).map(|inner| Self { inner }).map_err(Self::map_err)
    }

    fn clone(url: &str, dest: &Path, _on: Option<OnEvent>) -> Result<Self> {
        ll::Git::clone(url, dest).map(|inner| Self { inner }).map_err(Self::map_err)
    }

    fn workdir(&self) -> &Path { self.inner.workdir() }

    fn current_branch(&self) -> Result<Option<String>> {
        self.inner.current_branch().map_err(Self::map_err)
    }

    fn local_branches(&self) -> Result<Vec<String>> {
        self.inner.local_branches().map_err(Self::map_err)
    }

    fn create_branch(&self, name: &str, checkout: bool) -> Result<()> {
        self.inner.create_branch(name, checkout).map_err(Self::map_err)
    }

    fn checkout_branch(&self, name: &str) -> Result<()> {
        self.inner.checkout_branch(name).map_err(Self::map_err)
    }

    fn ensure_remote(&self, name: &str, url: &str) -> Result<()> {
        self.inner.ensure_remote(name, url).map_err(Self::map_err)
    }

    fn fetch(&self, remote: &str, refspec: &str, on: Option<OnEvent>) -> Result<()> {
        self.inner.fetch_with_progress(remote, refspec, Self::adapt_progress(on))
            .map(|_| ())
            .map_err(Self::map_err)
    }

    fn push(&self, remote: &str, refspec: &str, on: Option<OnEvent>) -> Result<()> {
        self.inner.push_refspec_with_progress(remote, refspec, Self::adapt_progress(on))
            .map_err(Self::map_err)
    }

    fn commit(&self, message: &str, name: &str, email: &str, paths: &[PathBuf]) -> Result<String> {
        self.inner.commit(message, name, email, paths)
            .map(|oid| oid.to_string())
            .map_err(Self::map_err)
    }

    fn status_summary(&self) -> Result<openvcs_core::StatusSummary> {
        let s = self.inner.status_summary().map_err(Self::map_err)?;
        Ok(openvcs_core::StatusSummary {
            untracked: s.untracked,
            modified: s.modified,
            staged: s.staged,
            conflicted: s.conflicted,
        })
    }

    fn hard_reset_head(&self) -> Result<()> {
        self.inner.hard_reset_head().map_err(Self::map_err)
    }
}
