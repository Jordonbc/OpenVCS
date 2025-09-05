/* =========================================================================================
   Low-level module: your original git.rs, adapted to wrap Repository in Arc<Mutex<…>>.
   ========================================================================================= */
use std::{
    path::{Path, PathBuf},
    sync::{Arc, Mutex, atomic::{AtomicUsize, Ordering}},
};
use git2::{
    self as g,
    AutotagOption, BranchType, FetchOptions, Oid, PushOptions,
    Repository, ResetType, Signature, Status, StatusOptions,
};
use log::{debug, error, info, trace, warn};
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
        let path = path.as_ref();
        debug!("git-libgit2: opening repository at {}", path.display());

        let repo = match Repository::discover(path) {
            Ok(r) => r,
            Err(e) => {
                error!("git-libgit2: discover failed at {} → {e}", path.display());
                return Err(e.into());
            }
        };

        let workdir: PathBuf = match repo.workdir() {
            Some(p) => {
                let wd = p.to_path_buf();
                debug!("git-libgit2: resolved workdir {}", wd.display());
                wd
            }
            None => {
                // Bare repos aren’t supported by this backend wrapper.
                warn!("git-libgit2: bare repository at {} (unsupported)", path.display());
                return Err(GitError::NotARepo("bare repository is not supported".into()));
            }
        };

        info!("git-libgit2: repository opened at {}", workdir.display());
        Ok(Self { repo: Arc::new(Mutex::new(repo)), workdir })
    }

    pub fn clone(url: &str, dest: impl AsRef<Path>) -> Result<Self> {
        let dest = dest.as_ref();
        info!("git-libgit2: cloning {url} → {}", dest.display());

        let cb = make_remote_callbacks();
        let mut fo = FetchOptions::new();
        fo.remote_callbacks(cb);
        fo.download_tags(AutotagOption::All);

        let mut builder = g::build::RepoBuilder::new();
        builder.fetch_options(fo);

        let repo = match builder.clone(url, dest) {
            Ok(r) => {
                info!("git-libgit2: clone completed into {}", dest.display());
                r
            }
            Err(e) => {
                error!("git-libgit2: clone failed {url} → {}: {e}", dest.display());
                return Err(e.into());
            }
        };

        let workdir = match repo.workdir() {
            Some(p) => {
                debug!("git-libgit2: workdir resolved to {}", p.display());
                p.to_path_buf()
            }
            None => {
                warn!("git-libgit2: cloned repo has no workdir (bare?), unsupported");
                return Err(GitError::NotARepo("bare repository is not supported".into()));
            }
        };

        Ok(Self {
            workdir,
            repo: Arc::new(Mutex::new(repo)),
        })
    }

    #[inline]
    pub fn workdir(&self) -> &Path { &self.workdir }

    #[inline]
    pub fn with_repo<T>(&self, f: impl FnOnce(&Repository) -> T) -> T {
        log::trace!("git-libgit2: acquiring repo lock");
        let repo = self.repo.lock().expect("libgit2 repo poisoned");
        log::trace!("git-libgit2: repo lock acquired");
        let result = f(&*repo);
        log::trace!("git-libgit2: repo lock released");
        result
    }

    pub fn current_branch(&self) -> Result<Option<String>> {
        debug!("git-libgit2: resolving current branch…");

        self.with_repo(|repo| {
            // Try to read HEAD and classify common cases explicitly.
            let head = match repo.head() {
                Ok(h) => h,
                Err(e) if e.code() == g::ErrorCode::UnbornBranch => {
                    debug!("git-libgit2: HEAD is unborn (no commits yet)");
                    return Ok(None);
                }
                Err(e) if e.code() == g::ErrorCode::NotFound => {
                    debug!("git-libgit2: HEAD not found");
                    return Ok(None);
                }
                Err(e) => {
                    error!("git-libgit2: repo.head() failed: {e}");
                    return Err(GitError::LibGit2(e));
                }
            };

            if head.is_branch() {
                let name = head.shorthand().map(|s| s.to_string());
                match &name {
                    Some(n) => debug!("git-libgit2: on branch '{n}'"),
                    None => warn!("git-libgit2: HEAD reports branch but shorthand is None"),
                }
                Ok(name)
            } else {
                debug!("git-libgit2: detached HEAD");
                Ok(None)
            }
        })
    }

    pub fn local_branches(&self) -> Result<Vec<String>> {
        debug!("git-libgit2: listing local branches…");

        self.with_repo(|repo| {
            let mut out = Vec::new();

            for branch_result in repo.branches(Some(BranchType::Local))? {
                match branch_result {
                    Ok((branch, _)) => {
                        match branch.name() {
                            Ok(Some(name)) => {
                                trace!("git-libgit2: found branch '{}'", name);
                                out.push(name.to_string());
                            }
                            Ok(None) => {
                                debug!("git-libgit2: branch has no valid UTF-8 name, skipping");
                            }
                            Err(e) => {
                                error!("git-libgit2: failed to read branch name: {e}");
                                return Err(GitError::LibGit2(e));
                            }
                        }
                    }
                    Err(e) => {
                        error!("git-libgit2: branch iteration failed: {e}");
                        return Err(GitError::LibGit2(e));
                    }
                }
            }

            debug!("git-libgit2: found {} local branches", out.len());
            Ok(out)
        })
    }

    pub fn create_branch(&self, name: &str, checkout: bool) -> Result<()> {
        info!("git-libgit2: creating branch '{}'", name);

        self.with_repo(|repo| -> Result<()> {
            let head = repo.head()
                .map_err(|e| {
                    error!("git-libgit2: failed to resolve HEAD for branch '{name}': {e}");
                    e
                })?
                .peel_to_commit()
                .map_err(|e| {
                    error!("git-libgit2: failed to peel HEAD to commit for branch '{name}': {e}");
                    e
                })?;

            repo.branch(name, &head, false)
                .map_err(|e| {
                    error!("git-libgit2: failed to create branch '{name}': {e}");
                    e
                })?;

            debug!("git-libgit2: branch '{name}' created");
            Ok(())
        })?;

        if checkout {
            info!("git-libgit2: checking out newly created branch '{name}'");
            self.checkout_branch(name)
        } else {
            Ok(())
        }
    }

    pub fn checkout_branch(&self, name: &str) -> Result<()> {
        info!("git-libgit2: checking out branch '{name}'");

        self.with_repo(|repo| {
            let (obj, reference) = repo
                .revparse_ext(&format!("refs/heads/{name}"))
                .map_err(|_| {
                    error!("git-libgit2: branch '{name}' not found");
                    GitError::NoSuchBranch(name.into())
                })?;

            repo.checkout_tree(&obj, None).map_err(|e| {
                error!("git-libgit2: failed to checkout tree for branch '{name}': {e}");
                e
            })?;

            if let Some(r) = reference {
                repo.set_head(r.name().unwrap()).map_err(|e| {
                    error!("git-libgit2: failed to set HEAD for branch '{name}': {e}");
                    e
                })?;
            } else {
                repo.set_head_detached(obj.id()).map_err(|e| {
                    error!("git-libgit2: failed to set detached HEAD for branch '{name}': {e}");
                    e
                })?;
            }

            info!("git-libgit2: successfully checked out branch '{name}'");
            Ok(())
        })
    }


    pub fn ensure_remote(&self, name: &str, url: &str) -> Result<()> {
        info!("git-libgit2: ensuring remote '{name}' points to '{url}'");

        self.with_repo(|repo| {
            match repo.find_remote(name) {
                Ok(r) => {
                    if r.url() != Some(url) {
                        warn!(
                            "git-libgit2: remote '{name}' URL mismatch (current: {:?}, expected: {url}) → updating",
                            r.url()
                        );
                        repo.remote_set_url(name, url).map_err(|e| {
                            error!("git-libgit2: failed to update remote '{name}' URL: {e}");
                            e
                        })?;
                    } else {
                        info!("git-libgit2: remote '{name}' already matches '{url}'");
                    }
                }
                Err(_) => {
                    info!("git-libgit2: remote '{name}' not found → creating with '{url}'");
                    repo.remote(name, url).map_err(|e| {
                        error!("git-libgit2: failed to create remote '{name}' at '{url}': {e}");
                        e
                    })?;
                }
            }
            Ok(())
        })
    }

    pub fn fetch_with_progress<F>(&self, remote: &str, refspec: &str, on: F) -> Result<Option<Oid>>
    where
        F: Fn(String) + Send + Sync + 'static,
    {
        info!("git-libgit2: fetching from remote '{remote}' with refspec '{refspec}'");

        let cb = make_remote_callbacks_with_progress(on);
        let mut fo = FetchOptions::new();
        fo.remote_callbacks(cb);
        fo.download_tags(AutotagOption::All);
        debug!("git-libgit2: fetch options prepared (download_tags=All)");

        self.with_repo(|repo| {
            let mut r = repo.find_remote(remote).map_err(|e| {
                error!("git-libgit2: failed to find remote '{remote}': {e}");
                e
            })?;

            debug!("git-libgit2: starting fetch '{remote}': '{refspec}'");
            r.fetch(&[refspec], Some(&mut fo), None).map_err(|e| {
                error!("git-libgit2: fetch failed from '{remote}' with '{refspec}': {e}");
                e
            })?;

            // FETCH_HEAD is optional depending on server/refspec; log what we see.
            let fetch_head = repo.find_reference("FETCH_HEAD").map(|r| r.target()).map_err(|e| {
                // Not all fetches create FETCH_HEAD (e.g., if nothing fetched); treat as a soft signal.
                // We still bubble the libgit2 error since callers expect the original behavior.
                warn!("git-libgit2: FETCH_HEAD not available after fetch: {e}");
                e
            })?;

            match fetch_head {
                Some(oid) => debug!("git-libgit2: fetch completed; FETCH_HEAD -> {}", oid),
                None => debug!("git-libgit2: fetch completed; FETCH_HEAD has no target"),
            }

            info!("git-libgit2: fetch from '{remote}' finished");
            Ok(fetch_head)
        })
    }

    pub fn fetch(&self, remote: &str, refspec: &str) -> Result<Option<Oid>> {
        self.fetch_with_progress(remote, refspec, |_| {})
    }

    pub fn fast_forward(&self, upstream: &str) -> Result<()> {
        info!("git-libgit2: fetch + fast-forward to '{upstream}'");

        self.with_repo(|repo| -> Result<()> {
            // Parse "remote/branch"
            let (remote_name, remote_ref) = upstream
                .split_once('/')
                .ok_or_else(|| {
                    error!("git-libgit2: invalid upstream '{upstream}' (expected remote/branch)");
                    GitError::LibGit2(g::Error::from_str("expected remote/branch"))
                })?;
            debug!("git-libgit2: remote='{remote_name}', ref='{remote_ref}'");

            // Fetch latest from remote
            let cb = make_remote_callbacks();
            let mut fo = git2::FetchOptions::new();
            fo.remote_callbacks(cb);

            let mut r = repo.find_remote(remote_name).map_err(|e| {
                error!("git-libgit2: find_remote('{remote_name}') failed: {e}");
                e
            })?;

            info!("git-libgit2: fetching '{remote_name}/{remote_ref}'");
            r.fetch(&[remote_ref], Some(&mut fo), None).map_err(|e| {
                error!("git-libgit2: fetch '{remote_name}/{remote_ref}' failed: {e}");
                e
            })?;

            // Resolve remote tracking ref, build annotated commit
            let full = format!("refs/remotes/{upstream}");
            let up_ref = repo.find_reference(&full).map_err(|e| {
                error!("git-libgit2: failed to find tracking ref '{full}': {e}");
                e
            })?;

            let annotated = repo.reference_to_annotated_commit(&up_ref).map_err(|e| {
                error!("git-libgit2: reference_to_annotated_commit('{full}') failed: {e}");
                e
            })?;

            // Analyze merge possibility
            let (analysis, _pref) = repo.merge_analysis(&[&annotated]).map_err(|e| {
                error!("git-libgit2: merge_analysis failed: {e}");
                e
            })?;

            if analysis.is_up_to_date() {
                info!("git-libgit2: already up-to-date with '{upstream}'");
                return Ok(());
            }

            if analysis.is_fast_forward() {
                debug!("git-libgit2: fast-forward possible to '{upstream}'");

                let head_name = repo.head()
                    .and_then(|h| {
                        h.name()
                            .ok_or_else(|| g::Error::from_str("HEAD name missing"))
                            .map(|s| s.to_string())
                    })
                    .map_err(|e| {
                        error!("git-libgit2: failed to resolve HEAD name: {e}");
                        e
                    })?;

                let target = up_ref.target().ok_or_else(|| {
                    error!("git-libgit2: tracking ref '{full}' has no target");
                    g::Error::from_str("no target")
                })?;

                let mut reference = repo.find_reference(&head_name).map_err(|e| {
                    error!("git-libgit2: find_reference('{head_name}') failed: {e}");
                    e
                })?;

                // Perform FF: move ref, set HEAD, update worktree
                reference.set_target(target, "fast-forward").map_err(|e| {
                    error!("git-libgit2: set_target('{head_name}', {target}) failed: {e}");
                    e
                })?;

                repo.set_head(&head_name).map_err(|e| {
                    error!("git-libgit2: set_head('{head_name}') failed: {e}");
                    e
                })?;

                repo.checkout_head(None).map_err(|e| {
                    error!("git-libgit2: checkout_head after FF failed: {e}");
                    e
                })?;

                info!("git-libgit2: fast-forward to '{upstream}' completed");
                Ok(())
            } else {
                warn!("git-libgit2: non fast-forward required for '{upstream}'");
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
        let msg_first = message.lines().next().unwrap_or("");
        info!("git-libgit2: committing (author='{} <{}>', summary='{}')", name, email, msg_first);

        self.with_repo(|repo| {
            let mut idx = repo.index().map_err(|e| {
                error!("git-libgit2: repo.index() failed: {e}");
                e
            })?;

            if paths.is_empty() {
                debug!("git-libgit2: staging all changes (add_all \"*\")");
                idx.add_all(["*"].iter(), g::IndexAddOption::DEFAULT, None).map_err(|e| {
                    error!("git-libgit2: add_all(\"*\") failed: {e}");
                    e
                })?;
            } else {
                debug!("git-libgit2: staging {} path(s)", paths.len());
                for p in paths {
                    if p.is_dir() {
                        trace!("git-libgit2: add_all(dir='{}')", p.display());
                        idx.add_all([p.as_path()].iter(), g::IndexAddOption::DEFAULT, None).map_err(|e| {
                            error!("git-libgit2: add_all('{}') failed: {e}", p.display());
                            e
                        })?;
                    } else {
                        let rel = rel_to_workdir(&self.workdir, p).map_err(|e| {
                            error!("git-libgit2: rel_to_workdir('{}') failed: {e}", p.display());
                            e
                        })?;
                        trace!("git-libgit2: add_path('{}')", rel.display());
                        idx.add_path(&rel).map_err(|e| {
                            error!("git-libgit2: add_path('{}') failed: {e}", rel.display());
                            e
                        })?;
                    }
                }
            }

            if idx.is_empty() {
                warn!("git-libgit2: index is empty after staging — nothing to commit");
                return Err(GitError::NothingToCommit);
            }

            let tree_oid = idx.write_tree().map_err(|e| {
                error!("git-libgit2: write_tree() failed: {e}");
                e
            })?;
            idx.write().map_err(|e| {
                error!("git-libgit2: index.write() failed: {e}");
                e
            })?;
            let tree = repo.find_tree(tree_oid).map_err(|e| {
                error!("git-libgit2: find_tree({tree_oid}) failed: {e}");
                e
            })?;

            let sig = g::Signature::now(name, email).map_err(|e| {
                error!("git-libgit2: Signature::now() failed for '{} <{}>': {e}", name, email);
                e
            })?;

            // Parents: if HEAD is a branch, use its tip; otherwise initial commit.
            let parents = match repo.head() {
                Ok(h) if h.is_branch() => {
                    let c = repo.head()
                        .and_then(|h| h.peel_to_commit())
                        .map_err(|e| {
                            error!("git-libgit2: peel_to_commit() for HEAD failed: {e}");
                            e
                        })?;
                    vec![c]
                }
                _ => Vec::new(),
            };
            let parent_refs: Vec<&g::Commit> = parents.iter().collect();

            // Target ref when not an initial commit.
            let head_ref = if parent_refs.is_empty() {
                debug!("git-libgit2: initial commit (no parents)");
                None
            } else {
                repo.head()
                    .ok()
                    .and_then(|h| h.name().map(|s| s.to_string()))
            };

            let oid = repo.commit(
                head_ref.as_deref(),
                &sig, &sig,
                message,
                &tree,
                &parent_refs,
            ).map_err(|e| {
                error!("git-libgit2: commit(write) failed: {e}");
                e
            })?;

            info!("git-libgit2: commit created {}", oid);
            Ok(oid)
        })
    }

    pub fn push_refspec_with_progress<F>(&self, remote: &str, refspec: &str, on: F) -> Result<()>
    where
        F: Fn(String) + Send + Sync + 'static,
    {
        info!("git-libgit2: pushing '{refspec}' to remote '{remote}'");

        let cb = make_remote_callbacks_with_progress(on);
        let mut opts = PushOptions::new();
        opts.remote_callbacks(cb);
        debug!("git-libgit2: push options prepared (callbacks attached)");

        self.with_repo(|repo| {
            let mut r = repo.find_remote(remote).map_err(|e| {
                error!("git-libgit2: find_remote('{remote}') failed: {e}");
                e
            })?;

            info!("git-libgit2: starting push to '{remote}' with refspec '{refspec}'");
            r.push(&[refspec], Some(&mut opts)).map_err(|e| {
                error!("git-libgit2: push to '{remote}' with '{refspec}' failed: {e}");
                e
            })?;

            info!("git-libgit2: push to '{remote}' completed");
            Ok(())
        })
    }

    pub fn status_summary(&self) -> Result<StatusSummary> {
        self.with_repo(|repo| {
            debug!("git-libgit2: computing status summary");

            let mut sopts = StatusOptions::new();
            sopts.include_untracked(true).recurse_untracked_dirs(true);

            let statuses = repo.statuses(Some(&mut sopts))?;
            debug!("git-libgit2: {} status entries retrieved", statuses.len());

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

            info!(
                "git-libgit2: status summary → untracked={}, modified={}, staged={}, conflicted={}",
                summary.untracked, summary.modified, summary.staged, summary.conflicted
            );

            Ok(summary)
        })
    }

    pub fn hard_reset_head(&self) -> Result<()> {
        info!("git-libgit2: resetting working tree to HEAD…");

        self.with_repo(|repo| {
            let head = repo.head()?.peel_to_commit()?;
            debug!("git-libgit2: HEAD commit = {}", head.id());
            repo.reset(head.as_object(), ResetType::Hard, None)?;
            info!("git-libgit2: reset completed");
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

            debug!("auth: attempt #{n}, allowed={allowed:?}, user_hint={username_from_url:?}");
            (on)(format!(
                "auth: attempt #{n}, allowed={allowed:?}, user_hint={username_from_url:?}"
            ));

            if allowed.contains(git2::CredentialType::SSH_KEY) {
                if n == 1 {
                    info!("auth: trying SSH agent for user `{user}`");
                    (on)(format!("auth: trying SSH agent for user `{user}`"));
                    return git2::Cred::ssh_key_from_agent(user);
                } else {
                    warn!("auth: agent key rejected; aborting");
                    return Err(git2::Error::new(
                        git2::ErrorCode::Auth,
                        git2::ErrorClass::Ssh,
                        "auth: agent key rejected; aborting",
                    ));
                }
            }

            warn!("auth: no usable SSH credential");
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
                let msg = format!("remote: {}", s.trim_end());
                debug!("{msg}");
                (on)(msg);
            }
            true
        });
    }

    // transfer/push progress
    {
        let on = Arc::clone(&on);
        cb.transfer_progress(move |p| {
            let msg = format!(
                "pushing… {}/{} deltas, {}/{} objects",
                p.indexed_deltas(),
                p.total_deltas(),
                p.indexed_objects(),
                p.total_objects()
            );
            debug!("{msg}");
            (on)(msg);
            true
        });
    }

    // per-ref push status
    {
        let on = Arc::clone(&on);
        cb.push_update_reference(move |refname, status| {
            let msg = if let Some(s) = status {
                format!("push status: {refname} → {s}")
            } else {
                format!("push status: {refname} ok")
            };
            info!("{msg}");
            (on)(msg);
            Ok(())
        });
    }

    cb
}

/// Turn absolute path into repo-relative for index operations.
pub fn rel_to_workdir(workdir: &Path, p: &Path) -> Result<PathBuf> {
    if p.is_absolute() {
        match p.strip_prefix(workdir) {
            Ok(rel) => {
                debug!(
                    "rel_to_workdir: converted absolute path '{}' → relative '{}'",
                    p.display(),
                    rel.display()
                );
                Ok(rel.to_path_buf())
            }
            Err(_) => {
                warn!(
                    "rel_to_workdir: path '{}' is outside workdir '{}'",
                    p.display(),
                    workdir.display()
                );
                Err(GitError::Io(std::io::Error::new(
                    std::io::ErrorKind::InvalidInput,
                    "path is outside workdir",
                )))
            }
        }
    } else {
        debug!(
            "rel_to_workdir: keeping relative path '{}'",
            p.display()
        );
        Ok(p.to_path_buf())
    }
}

pub fn git_identity(git: &Git) -> Option<(String, String)> {
    debug!("Reading Git identity from config...");
    git.with_repo(|repo| {
        let cfg = match repo.config() {
            Ok(c) => c,
            Err(e) => {
                warn!("Could not open Git config: {e}");
                return None;
            }
        };

        let name  = match cfg.get_string("user.name") {
            Ok(n) => n,
            Err(e) => {
                warn!("Missing or invalid user.name in Git config: {e}");
                return None;
            }
        };
        let email = match cfg.get_string("user.email") {
            Ok(e) => e,
            Err(e) => {
                warn!("Missing or invalid user.email in Git config: {e}");
                return None;
            }
        };

        if name.trim().is_empty() || email.trim().is_empty() {
            warn!("Git identity is empty: name='{name}', email='{email}'");
            return None;
        }

        debug!("Git identity resolved: {name} <{email}>");
        Some((name, email))
    })
}