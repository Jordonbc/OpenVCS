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
    Repository, ResetType, Status, StatusOptions,
};
use log::{debug, error, info, trace, warn};
use thiserror::Error;
use time::{OffsetDateTime, UtcOffset};
use time::format_description::well_known::Rfc3339;
use openvcs_core::models::{BranchItem, BranchKind, CommitItem, FileEntry, LogQuery, StatusPayload};

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
        debug!("opening repository at {}", path.display());

        let repo = match Repository::discover(path) {
            Ok(r) => r,
            Err(e) => {
                error!("discover failed at {} → {e}", path.display());
                return Err(e.into());
            }
        };

        let workdir: PathBuf = match repo.workdir() {
            Some(p) => {
                let wd = p.to_path_buf();
                debug!("resolved workdir {}", wd.display());
                wd
            }
            None => {
                // Bare repos aren’t supported by this backend wrapper.
                warn!("bare repository at {} (unsupported)", path.display());
                return Err(GitError::NotARepo("bare repository is not supported".into()));
            }
        };

        info!("repository opened at {}", workdir.display());
        Ok(Self { repo: Arc::new(Mutex::new(repo)), workdir })
    }

    pub fn clone(url: &str, dest: impl AsRef<Path>) -> Result<Self> {
        let dest = dest.as_ref();
        info!("cloning {url} → {}", dest.display());

        let cb = make_remote_callbacks();
        let mut fo = FetchOptions::new();
        fo.remote_callbacks(cb);
        fo.download_tags(AutotagOption::All);

        let mut builder = g::build::RepoBuilder::new();
        builder.fetch_options(fo);

        let repo = match builder.clone(url, dest) {
            Ok(r) => {
                info!("clone completed into {}", dest.display());
                r
            }
            Err(e) => {
                error!("clone failed {url} → {}: {e}", dest.display());
                return Err(e.into());
            }
        };

        let workdir = match repo.workdir() {
            Some(p) => {
                debug!("workdir resolved to {}", p.display());
                p.to_path_buf()
            }
            None => {
                warn!("cloned repo has no workdir (bare?), unsupported");
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
        log::trace!("acquiring repo lock");
        let repo = self.repo.lock().expect("libgit2 repo poisoned");
        log::trace!("repo lock acquired");
        let result = f(&*repo);
        log::trace!("repo lock released");
        result
    }

    pub fn current_branch(&self) -> Result<Option<String>> {
        debug!("resolving current branch…");

        self.with_repo(|repo| {
            // Try to read HEAD and classify common cases explicitly.
            let head = match repo.head() {
                Ok(h) => h,
                Err(e) if e.code() == g::ErrorCode::UnbornBranch => {
                    debug!("HEAD is unborn (no commits yet)");
                    return Ok(None);
                }
                Err(e) if e.code() == g::ErrorCode::NotFound => {
                    debug!("HEAD not found");
                    return Ok(None);
                }
                Err(e) => {
                    error!("repo.head() failed: {e}");
                    return Err(GitError::LibGit2(e));
                }
            };

            if head.is_branch() {
                let name = head.shorthand().map(|s| s.to_string());
                match &name {
                    Some(n) => debug!("on branch '{n}'"),
                    None => warn!("HEAD reports branch but shorthand is None"),
                }
                Ok(name)
            } else {
                debug!("detached HEAD");
                Ok(None)
            }
        })
    }

    pub fn local_branches(&self) -> Result<Vec<String>> {
        debug!("listing local branches…");

        self.with_repo(|repo| {
            let mut out = Vec::new();

            for branch_result in repo.branches(Some(BranchType::Local))? {
                match branch_result {
                    Ok((branch, _)) => {
                        match branch.name() {
                            Ok(Some(name)) => {
                                trace!("found branch '{}'", name);
                                out.push(name.to_string());
                            }
                            Ok(None) => {
                                debug!("branch has no valid UTF-8 name, skipping");
                            }
                            Err(e) => {
                                error!("failed to read branch name: {e}");
                                return Err(GitError::LibGit2(e));
                            }
                        }
                    }
                    Err(e) => {
                        error!("branch iteration failed: {e}");
                        return Err(GitError::LibGit2(e));
                    }
                }
            }

            debug!("found {} local branches", out.len());
            Ok(out)
        })
    }

    pub fn create_branch(&self, name: &str, checkout: bool) -> Result<()> {
        info!("creating branch '{}'", name);

        self.with_repo(|repo| -> Result<()> {
            let head = repo.head()
                .map_err(|e| {
                    error!("failed to resolve HEAD for branch '{name}': {e}");
                    e
                })?
                .peel_to_commit()
                .map_err(|e| {
                    error!("failed to peel HEAD to commit for branch '{name}': {e}");
                    e
                })?;

            repo.branch(name, &head, false)
                .map_err(|e| {
                    error!("failed to create branch '{name}': {e}");
                    e
                })?;

            debug!("branch '{name}' created");
            Ok(())
        })?;

        if checkout {
            info!("checking out newly created branch '{name}'");
            self.checkout_branch(name)
        } else {
            Ok(())
        }
    }

    pub fn checkout_branch(&self, name: &str) -> Result<()> {
        info!("checking out branch '{name}'");

        self.with_repo(|repo| {
            let (obj, reference) = repo
                .revparse_ext(&format!("refs/heads/{name}"))
                .map_err(|_| {
                    error!("branch '{name}' not found");
                    GitError::NoSuchBranch(name.into())
                })?;

            repo.checkout_tree(&obj, None).map_err(|e| {
                error!("failed to checkout tree for branch '{name}': {e}");
                e
            })?;

            if let Some(r) = reference {
                repo.set_head(r.name().unwrap()).map_err(|e| {
                    error!("failed to set HEAD for branch '{name}': {e}");
                    e
                })?;
            } else {
                repo.set_head_detached(obj.id()).map_err(|e| {
                    error!("failed to set detached HEAD for branch '{name}': {e}");
                    e
                })?;
            }

            info!("successfully checked out branch '{name}'");
            Ok(())
        })
    }


    pub fn ensure_remote(&self, name: &str, url: &str) -> Result<()> {
        info!("ensuring remote '{name}' points to '{url}'");

        self.with_repo(|repo| {
            match repo.find_remote(name) {
                Ok(r) => {
                    if r.url() != Some(url) {
                        warn!(
                            "remote '{name}' URL mismatch (current: {:?}, expected: {url}) → updating",
                            r.url()
                        );
                        repo.remote_set_url(name, url).map_err(|e| {
                            error!("failed to update remote '{name}' URL: {e}");
                            e
                        })?;
                    } else {
                        info!("remote '{name}' already matches '{url}'");
                    }
                }
                Err(_) => {
                    info!("remote '{name}' not found → creating with '{url}'");
                    repo.remote(name, url).map_err(|e| {
                        error!("failed to create remote '{name}' at '{url}': {e}");
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
        info!("fetching from remote '{remote}' with refspec '{refspec}'");

        let cb = make_remote_callbacks_with_progress(on);
        let mut fo = FetchOptions::new();
        fo.remote_callbacks(cb);
        fo.download_tags(AutotagOption::All);
        debug!("fetch options prepared (download_tags=All)");

        self.with_repo(|repo| {
            let mut r = repo.find_remote(remote).map_err(|e| {
                error!("failed to find remote '{remote}': {e}");
                e
            })?;

            debug!("starting fetch '{remote}': '{refspec}'");
            r.fetch(&[refspec], Some(&mut fo), None).map_err(|e| {
                error!("fetch failed from '{remote}' with '{refspec}': {e}");
                e
            })?;

            // FETCH_HEAD is optional depending on server/refspec; log what we see.
            let fetch_head = repo.find_reference("FETCH_HEAD").map(|r| r.target()).map_err(|e| {
                // Not all fetches create FETCH_HEAD (e.g., if nothing fetched); treat as a soft signal.
                // We still bubble the libgit2 error since callers expect the original behavior.
                warn!("FETCH_HEAD not available after fetch: {e}");
                e
            })?;

            match fetch_head {
                Some(oid) => debug!("fetch completed; FETCH_HEAD -> {}", oid),
                None => debug!("fetch completed; FETCH_HEAD has no target"),
            }

            info!("fetch from '{remote}' finished");
            Ok(fetch_head)
        })
    }

    pub fn fetch(&self, remote: &str, refspec: &str) -> Result<Option<Oid>> {
        self.fetch_with_progress(remote, refspec, |_| {})
    }

    pub fn fast_forward(&self, upstream: &str) -> Result<()> {
        info!("fetch + fast-forward to '{upstream}'");

        self.with_repo(|repo| -> Result<()> {
            // Parse "remote/branch"
            let (remote_name, remote_ref) = upstream
                .split_once('/')
                .ok_or_else(|| {
                    error!("invalid upstream '{upstream}' (expected remote/branch)");
                    GitError::LibGit2(g::Error::from_str("expected remote/branch"))
                })?;
            debug!("remote='{remote_name}', ref='{remote_ref}'");

            // Fetch latest from remote
            let cb = make_remote_callbacks();
            let mut fo = git2::FetchOptions::new();
            fo.remote_callbacks(cb);

            let mut r = repo.find_remote(remote_name).map_err(|e| {
                error!("find_remote('{remote_name}') failed: {e}");
                e
            })?;

            info!("fetching '{remote_name}/{remote_ref}'");
            r.fetch(&[remote_ref], Some(&mut fo), None).map_err(|e| {
                error!("fetch '{remote_name}/{remote_ref}' failed: {e}");
                e
            })?;

            // Resolve remote tracking ref, build annotated commit
            let full = format!("refs/remotes/{upstream}");
            let up_ref = repo.find_reference(&full).map_err(|e| {
                error!("failed to find tracking ref '{full}': {e}");
                e
            })?;

            let annotated = repo.reference_to_annotated_commit(&up_ref).map_err(|e| {
                error!("reference_to_annotated_commit('{full}') failed: {e}");
                e
            })?;

            // Analyze merge possibility
            let (analysis, _pref) = repo.merge_analysis(&[&annotated]).map_err(|e| {
                error!("merge_analysis failed: {e}");
                e
            })?;

            if analysis.is_up_to_date() {
                info!("already up-to-date with '{upstream}'");
                return Ok(());
            }

            if analysis.is_fast_forward() {
                debug!("fast-forward possible to '{upstream}'");

                let head_name = repo.head()
                    .and_then(|h| {
                        h.name()
                            .ok_or_else(|| g::Error::from_str("HEAD name missing"))
                            .map(|s| s.to_string())
                    })
                    .map_err(|e| {
                        error!("failed to resolve HEAD name: {e}");
                        e
                    })?;

                let target = up_ref.target().ok_or_else(|| {
                    error!("tracking ref '{full}' has no target");
                    g::Error::from_str("no target")
                })?;

                let mut reference = repo.find_reference(&head_name).map_err(|e| {
                    error!("find_reference('{head_name}') failed: {e}");
                    e
                })?;

                // Perform FF: move ref, set HEAD, update worktree
                reference.set_target(target, "fast-forward").map_err(|e| {
                    error!("set_target('{head_name}', {target}) failed: {e}");
                    e
                })?;

                repo.set_head(&head_name).map_err(|e| {
                    error!("set_head('{head_name}') failed: {e}");
                    e
                })?;

                repo.checkout_head(None).map_err(|e| {
                    error!("checkout_head after FF failed: {e}");
                    e
                })?;

                info!("fast-forward to '{upstream}' completed");
                Ok(())
            } else {
                warn!("non fast-forward required for '{upstream}'");
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
        info!("committing (author='{} <{}>', summary='{}')", name, email, msg_first);

        self.with_repo(|repo| {
            let mut idx = repo.index().map_err(|e| {
                error!("repo.index() failed: {e}");
                e
            })?;

            if paths.is_empty() {
                debug!("staging all changes (add_all \"*\")");
                idx.add_all(["*"].iter(), g::IndexAddOption::DEFAULT, None).map_err(|e| {
                    error!("add_all(\"*\") failed: {e}");
                    e
                })?;
            } else {
                debug!("staging {} path(s)", paths.len());
                for p in paths {
                    if p.is_dir() {
                        trace!("add_all(dir='{}')", p.display());
                        idx.add_all([p.as_path()].iter(), g::IndexAddOption::DEFAULT, None).map_err(|e| {
                            error!("add_all('{}') failed: {e}", p.display());
                            e
                        })?;
                    } else {
                        let rel = rel_to_workdir(&self.workdir, p).map_err(|e| {
                            error!("rel_to_workdir('{}') failed: {e}", p.display());
                            e
                        })?;
                        trace!("add_path('{}')", rel.display());
                        idx.add_path(&rel).map_err(|e| {
                            error!("add_path('{}') failed: {e}", rel.display());
                            e
                        })?;
                    }
                }
            }

            if idx.is_empty() {
                warn!("index is empty after staging — nothing to commit");
                return Err(GitError::NothingToCommit);
            }

            let tree_oid = idx.write_tree().map_err(|e| {
                error!("write_tree() failed: {e}");
                e
            })?;
            idx.write().map_err(|e| {
                error!("index.write() failed: {e}");
                e
            })?;
            let tree = repo.find_tree(tree_oid).map_err(|e| {
                error!("find_tree({tree_oid}) failed: {e}");
                e
            })?;

            let sig = g::Signature::now(name, email).map_err(|e| {
                error!("Signature::now() failed for '{} <{}>': {e}", name, email);
                e
            })?;

            // Parents: if HEAD is a branch, use its tip; otherwise initial commit.
            let parents = match repo.head() {
                Ok(h) if h.is_branch() => {
                    let c = repo.head()
                        .and_then(|h| h.peel_to_commit())
                        .map_err(|e| {
                            error!("peel_to_commit() for HEAD failed: {e}");
                            e
                        })?;
                    vec![c]
                }
                _ => Vec::new(),
            };
            let parent_refs: Vec<&g::Commit> = parents.iter().collect();

            // Target ref when not an initial commit.
            let head_ref = if parent_refs.is_empty() {
                debug!("initial commit (no parents)");
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
                error!("commit(write) failed: {e}");
                e
            })?;

            info!("commit created {}", oid);
            Ok(oid)
        })
    }

    pub fn push_refspec_with_progress<F>(&self, remote: &str, refspec: &str, on: F) -> Result<()>
    where
        F: Fn(String) + Send + Sync + 'static,
    {
        info!("pushing '{refspec}' to remote '{remote}'");

        let cb = make_remote_callbacks_with_progress(on);
        let mut opts = PushOptions::new();
        opts.remote_callbacks(cb);
        debug!("push options prepared (callbacks attached)");

        self.with_repo(|repo| {
            let mut r = repo.find_remote(remote).map_err(|e| {
                error!("find_remote('{remote}') failed: {e}");
                e
            })?;

            info!("starting push to '{remote}' with refspec '{refspec}'");
            r.push(&[refspec], Some(&mut opts)).map_err(|e| {
                error!("push to '{remote}' with '{refspec}' failed: {e}");
                e
            })?;

            info!("push to '{remote}' completed");
            Ok(())
        })
    }

    pub fn status_summary(&self) -> Result<StatusSummary> {
        self.with_repo(|repo| {
            debug!("computing status summary");

            let mut sopts = StatusOptions::new();
            sopts.include_untracked(true).recurse_untracked_dirs(true);

            let statuses = repo.statuses(Some(&mut sopts))?;
            debug!("{} status entries retrieved", statuses.len());

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
                "status summary → untracked={}, modified={}, staged={}, conflicted={}",
                summary.untracked, summary.modified, summary.staged, summary.conflicted
            );

            Ok(summary)
        })
    }

    pub fn hard_reset_head(&self) -> Result<()> {
        info!("resetting working tree to HEAD…");

        self.with_repo(|repo| {
            let head = repo.head()?.peel_to_commit()?;
            debug!("HEAD commit = {}", head.id());
            repo.reset(head.as_object(), ResetType::Hard, None)?;
            info!("reset completed");
            Ok(())
        })
    }

    /// Return a single page of commits based on the provided query.
    pub fn log_commits(&self, q: &LogQuery) -> Result<Vec<CommitItem>> {
        debug!(
            "log_commits: rev={:?} path={:?} author~={:?} since={:?} until={:?} skip={} limit={} topo={} merges={}",
            q.rev, q.path, q.author_contains, q.since_utc, q.until_utc, q.skip, q.limit, q.topo_order, q.include_merges
        );

        self.with_repo(|repo| -> Result<Vec<CommitItem>> {
            let mut walk = repo.revwalk()?;
            let sort = if q.topo_order { g::Sort::TOPOLOGICAL | g::Sort::TIME } else { g::Sort::TIME };
            let _ = walk.set_sorting(sort);

            let rev = q.rev.as_deref().unwrap_or("HEAD");
            walk.push_ref(rev)?;

            // Pre-parse filters once
            let path_filter = q.path.as_deref();
            let auth_sub = q.author_contains.as_ref().map(|s| s.to_lowercase());
            let since = q.since_utc.as_deref().and_then(parse_iso_to_epoch_secs);
            let until = q.until_utc.as_deref().and_then(parse_iso_to_epoch_secs);

            let mut out = Vec::with_capacity(q.limit as usize);
            let mut matched = 0u32;

            for oid_res in walk {
                let oid = oid_res?;
                let commit = repo.find_commit(oid)?;

                // merges?
                if !q.include_merges && commit.parent_count() > 1 {
                    continue;
                }

                // date filters (git time is seconds + offset)
                let t = commit.time();
                let secs = t.seconds();
                if let Some(s) = since {
                    if secs < s { continue; }
                }
                if let Some(u) = until {
                    if secs > u { continue; }
                }

                // author filter (substring on "Name <email>")
                if let Some(sub) = &auth_sub {
                    let who = {
                        let a = commit.author();
                        format!("{} <{}>", a.name().unwrap_or(""), a.email().unwrap_or(""))
                    };
                    if !who.to_lowercase().contains(sub) {
                        continue;
                    }
                }

                // path filter (touches prefix)
                if let Some(prefix) = path_filter {
                    if !commit_touches_path(repo, oid, prefix)? {
                        continue;
                    }
                }

                // pagination (skip first N matches after filters)
                if matched < q.skip {
                    matched += 1;
                    continue;
                }

                // DTO
                let id_full = oid.to_string();
                let short = &id_full[..id_full.len().min(7)];
                let when = git_time_to_rfc3339(t);
                let author = {
                    let a = commit.author();
                    format!("{} <{}>", a.name().unwrap_or(""), a.email().unwrap_or(""))
                };
                let msg = commit.summary().unwrap_or("").to_string();
                let meta = format!("{when} • {short}");

                out.push(CommitItem { id: id_full, msg, meta, author });

                if out.len() as u32 >= q.limit {
                    break;
                }
            }

            debug!("log_commits: returned {} item(s)", out.len());
            Ok(out)
        })
    }

    pub fn status_payload(&self) -> Result<StatusPayload> {
        self.with_repo(|repo| -> Result<StatusPayload> {
            // Gather statuses
            let mut sopts = g::StatusOptions::new();
            sopts.include_untracked(true)
                .recurse_untracked_dirs(true)
                .renames_head_to_index(true)
                .renames_index_to_workdir(true);

            let statuses = repo.statuses(Some(&mut sopts))?;

            let mut files = Vec::<FileEntry>::with_capacity(statuses.len());
            let mut summary = StatusSummary::default();

            for e in statuses.iter() {
                let s = e.status();

                if s.contains(g::Status::WT_NEW)                        { summary.untracked += 1; }
                if s.intersects(g::Status::WT_MODIFIED | g::Status::WT_TYPECHANGE) { summary.modified  += 1; }
                if s.intersects(g::Status::INDEX_NEW | g::Status::INDEX_MODIFIED | g::Status::INDEX_TYPECHANGE) {
                    summary.staged += 1;
                }
                if s.contains(g::Status::CONFLICTED)                    { summary.conflicted += 1; }

                let code = if s.contains(g::Status::CONFLICTED) {
                    "U"
                } else if s.contains(g::Status::INDEX_DELETED) || s.contains(g::Status::WT_DELETED) {
                    "D"
                } else if s.contains(g::Status::INDEX_NEW) || s.contains(g::Status::WT_NEW) {
                    "A"
                } else if s.intersects(g::Status::INDEX_MODIFIED | g::Status::WT_MODIFIED | g::Status::INDEX_TYPECHANGE | g::Status::WT_TYPECHANGE) {
                    "M"
                } else {
                    "R?"
                }.to_string();

                let path = e.head_to_index()
                    .and_then(|d| d.new_file().path())
                    .or_else(|| e.index_to_workdir().and_then(|d| d.new_file().path()))
                    .or_else(|| e.head_to_index().and_then(|d| d.old_file().path()))
                    .or_else(|| e.index_to_workdir().and_then(|d| d.old_file().path()))
                    .map(|p| p.to_string_lossy().to_string())
                    .unwrap_or_default();

                files.push(FileEntry { path, status: code, hunks: Vec::new() });
            }

            // ahead/behind (best effort)
            let (ahead, behind) = {
                let branch_name = repo.head()
                    .ok()
                    .and_then(|h| if h.is_branch() { h.shorthand().map(|s| s.to_string()) } else { None });
                if let Some(name) = branch_name {
                    if let Ok(branch) = repo.find_branch(&name, g::BranchType::Local) {
                        if let Ok(up) = branch.upstream() {
                            if let (Some(h), Some(u)) = (branch.get().target(), up.get().target()) {
                                if let Ok((a, b)) = repo.graph_ahead_behind(h, u) {
                                    (a as u32, b as u32)
                                } else { (0, 0) }
                            } else { (0, 0) }
                        } else { (0, 0) }
                    } else { (0, 0) }
                } else { (0, 0) }
            };

            Ok(StatusPayload { files, ahead, behind })
        })
    }

    pub fn diff_file(&self, any_path: &Path) -> Result<Vec<String>> {
        self.with_repo(|repo| -> Result<Vec<String>> {
            // Repo-relative path
            let rel = if any_path.is_absolute() {
                any_path.strip_prefix(&self.workdir).unwrap_or(any_path)
            } else {
                any_path
            };
            let rel_str = rel.to_string_lossy();

            // Common diff opts
            let mut opts = g::DiffOptions::new();
            opts.pathspec(rel_str.as_ref());
            opts.context_lines(3);
            opts.include_untracked(true)
                .recurse_untracked_dirs(true);

            // 1) Unstaged: index → workdir
            let diff_unstaged = repo.diff_index_to_workdir(None, Some(&mut opts))?;
            let mut lines = collect_patch_lines(&diff_unstaged)?;
            if !lines.is_empty() {
                return Ok(lines);
            }

            // 2) Staged: HEAD → index
            let head_tree = match repo.head().ok().and_then(|h| h.peel_to_tree().ok()) {
                Some(t) => t,
                None => {
                    // No HEAD (initial commit). Treat staged as additions vs empty tree.
                    // libgit2 empty tree via Treebuilder
                    let tb = repo.treebuilder(None)?;
                    let empty = tb.write()?;
                    repo.find_tree(empty)?
                }
            };

            let mut opts2 = g::DiffOptions::new();
            opts2.pathspec(rel_str.as_ref());
            opts2.context_lines(3);

            let index = repo.index()?;
            let diff_staged = repo.diff_tree_to_index(Some(&head_tree), Some(&index), Some(&mut opts2))?;
            lines = collect_patch_lines(&diff_staged)?;
            Ok(lines)
        })
    }

    pub fn branches(&self) -> Result<Vec<BranchItem>> {
        self.with_repo(|repo| -> Result<Vec<BranchItem>> {
            let mut items = Vec::new();

            for br in repo.branches(None)? { // None => Local + Remote
                let (branch, bty) = br?;
                // short name: "main" or "origin/feature"
                let name = branch.name()?.unwrap_or("").to_string();
                // full ref: "refs/heads/main" or "refs/remotes/origin/feature"
                let full_ref = branch.get().name().unwrap_or("").to_string();

                // Skip remote HEAD alias like "refs/remotes/origin/HEAD" (noise)
                if full_ref.ends_with("/HEAD") && matches!(bty, git2::BranchType::Remote) {
                    continue;
                }

                let kind = match bty {
                    git2::BranchType::Local => BranchKind::Local,
                    git2::BranchType::Remote => {
                        // "origin/feature" → "origin"
                        let remote = name.split('/').next().unwrap_or("").to_string();
                        BranchKind::Remote { remote }
                    }
                };

                // Only local branches can be “current”
                let current = matches!(bty, git2::BranchType::Local) && branch.is_head();

                items.push(BranchItem { name, full_ref, kind, current });
            }

            Ok(items)
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

/// Parse RFC3339/ISO8601 into epoch seconds; on failure return None (ignore filter).
fn parse_iso_to_epoch_secs(s: &str) -> Option<i64> {
    OffsetDateTime::parse(s, &Rfc3339).ok().map(|dt| dt.unix_timestamp())
}

/// Convert git2::Time to RFC3339 string, honoring the embedded offset minutes.
fn git_time_to_rfc3339(t: g::Time) -> String {
    let offset = UtcOffset::from_whole_seconds((t.offset_minutes() * 60) as i32)
        .unwrap_or(UtcOffset::UTC);
    OffsetDateTime::from_unix_timestamp(t.seconds())
        .unwrap_or(OffsetDateTime::UNIX_EPOCH)
        .to_offset(offset)
        .format(&Rfc3339)
        .unwrap_or_else(|_| "1970-01-01T00:00:00Z".into())
}

/// Fast check whether a commit touches a given path prefix.
fn commit_touches_path(repo: &Repository, oid: Oid, path_prefix: &str) -> Result<bool> {
    let commit = repo.find_commit(oid)?;
    let tree = commit.tree()?;

    // Parent tree or truly empty tree (works for SHA-1 and SHA-256 repos)
    let parent_tree = if commit.parent_count() > 0 {
        commit.parent(0)?.tree()?
    } else {
        // Create an empty tree with a Treebuilder (do NOT use the index here).
        let tb = repo.treebuilder(None)?;
        let empty_oid = tb.write()?;
        repo.find_tree(empty_oid)?
    };

    // If you want a quick win, apply the pathspec here to let libgit2 filter for us.
    let mut opts = g::DiffOptions::new();
    opts.pathspec(path_prefix);

    let mut touched = false;
    repo.diff_tree_to_tree(Some(&parent_tree), Some(&tree), Some(&mut opts))?
        .foreach(
            &mut |delta, _| {
                // If a delta exists at all with our pathspec, we can bail out early.
                if delta.status() != g::Delta::Unmodified {
                    touched = true;
                    return false; // stop
                }
                true
            },
            None, None, None,
        )?;
    Ok(touched)
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

fn collect_patch_lines(diff: &g::Diff) -> Result<Vec<String>> {
    let mut out = Vec::<String>::new();
    diff.print(g::DiffFormat::Patch, |_d, _h, l| {
        let s = std::str::from_utf8(l.content()).unwrap_or_default();
        out.push(format!("{}{}", l.origin(), s.trim_end_matches('\n')));
        true
    })?;
    Ok(out)
}
