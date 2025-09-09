mod lowlevel;

use std::{path::{Path, PathBuf}, sync::Arc};
use log::{debug, error, info, trace, warn};
use openvcs_core::*;
use openvcs_core::backend_descriptor::{BackendDescriptor, BACKENDS};
use openvcs_core::backend_id::BackendId;
use openvcs_core::models::{Capabilities, OnEvent, StatusSummary, VcsEvent};

pub const GIT_LIBGIT2_ID: BackendId = backend_id!("git-libgit2");

fn caps_static() -> Capabilities {
    Capabilities { commits: true, branches: true, tags: true, staging: true, push_pull: true, fast_forward: true }
}
fn open_factory(path: &Path) -> Result<Arc<dyn Vcs>> {
    GitLibGit2::open(path).map(|v| Arc::new(v) as Arc<dyn Vcs>)
}
fn clone_factory(url: &str, dest: &Path, on: Option<OnEvent>) -> Result<Arc<dyn Vcs>> {
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
   Public wrapper: implement the openvcs-core::Vcs trait using the low-level libgit2 code.
   ========================================================================================= */

/// Libgit2-backed VCS implementation.
pub struct GitLibGit2 {
    inner: lowlevel::Git,
}

impl GitLibGit2 {
    fn map_err<E: std::fmt::Display>(e: E) -> VcsError {
        let msg = e.to_string();
        // Loud, because this bubbles up as a user-visible failure.
        error!("backend error: {msg}");
        VcsError::Backend { backend: GIT_LIBGIT2_ID, msg }
}


    fn adapt_progress(on: Option<OnEvent>) -> impl Fn(String) + Send + Sync + 'static {
        move |s: String| {
            // Always log locally; *also* forward to UI if a callback is present.
            if let Some(rest) = s.strip_prefix("remote: ") {
                debug!("[remote]: {rest}");
                if let Some(cb) = &on {
                    cb(VcsEvent::RemoteMessage(s));
                }
                return;
            }

            if s.starts_with("auth:") {
                // Auth noise is critical when debugging; warn-level is intentional.
                warn!("[auth]: {s}");
                if let Some(cb) = &on {
                    cb(VcsEvent::Auth { method: "ssh", detail: s });
                }
                return;
            }

            if let Some(rest) = s.strip_prefix("push status: ") {
                // Status lines are useful at info; they summarize server acceptance/rejection.
                info!("[push-status]: {rest}");
                let (refname, status) = if let Some((l, r)) = rest.split_once(" → ") {
                    (l.to_string(), Some(r.to_string()))
                } else if rest.ends_with(" ok") {
                    (rest.trim_end_matches(" ok").to_string(), None)
                } else {
                    (rest.to_string(), None)
                };
                if let Some(cb) = &on {
                    cb(VcsEvent::PushStatus { refname, status });
                }
                return;
            }

            // Generic progress falls back to trace to avoid spamming normal logs.
            trace!("{s}");
            if let Some(cb) = &on {
                cb(VcsEvent::Progress { phase: "libgit2", detail: s });
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
        lowlevel::Git::open(path).map(|inner| Self { inner }).map_err(Self::map_err)
    }

    fn clone(url: &str, dest: &Path, _on: Option<OnEvent>) -> Result<Self> {
        lowlevel::Git::clone(url, dest).map(|inner| Self { inner }).map_err(Self::map_err)
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

    fn list_remotes(&self) -> Result<Vec<(String, String)>> {
        // Prefer reading from the repository config: remote.<name>.url
        let mut out: Vec<(String, String)> = Vec::new();
        let res = self.inner.with_repo(|repo| {
            let cfg = repo.config().map_err(|e| Self::map_err(e))?;
            // Iterate over entries matching remote.*.url
            let mut iter = cfg.entries(Some("remote.*.url")).map_err(|e| Self::map_err(e))?;
            while let Some(Ok(entry)) = iter.next() {
                if let (Some(name), Some(val)) = (entry.name(), entry.value()) {
                    // name like "remote.origin.url" → extract "origin"
                    let remote_name = name.trim_start_matches("remote.").trim_end_matches(".url").to_string();
                    out.push((remote_name, val.to_string()));
                }
            }
            Ok::<(), VcsError>(())
        });
        match res { Ok(()) => Ok(out), Err(e) => Err(e) }
    }

    fn remove_remote(&self, name: &str) -> Result<()> {
        self.inner.with_repo(|repo| repo.remote_delete(name)).map_err(Self::map_err)
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

    fn pull_ff_only(&self, remote: &str, branch: &str, _on: Option<OnEvent>) -> Result<()> {
        // Use libgit2 path that fetches and performs a fast-forward when possible.
        // Progress is logged; we currently do not bridge per-line progress for this path.
        let upstream = format!("{}/{}", remote, branch);
        self.inner.fast_forward(&upstream).map_err(Self::map_err)
    }

    fn commit(&self, message: &str, name: &str, email: &str, paths: &[PathBuf]) -> Result<String> {
        self.inner.commit(message, name, email, paths)
            .map(|oid| oid.to_string())
            .map_err(Self::map_err)
    }

    fn commit_index(&self, message: &str, name: &str, email: &str) -> Result<String> {
        self.inner.commit_index(message, name, email)
            .map(|oid| oid.to_string())
            .map_err(Self::map_err)
    }

    fn status_summary(&self) -> Result<StatusSummary> {
        let s = self.inner.status_summary().map_err(Self::map_err)?;
        Ok(StatusSummary {
            untracked: s.untracked,
            modified: s.modified,
            staged: s.staged,
            conflicted: s.conflicted,
        })
    }

    fn hard_reset_head(&self) -> Result<()> {
        self.inner.hard_reset_head().map_err(Self::map_err)
    }

    fn log_commits(&self, q: &models::LogQuery) -> Result<Vec<models::CommitItem>> {
        self.inner.log_commits(q).map_err(Self::map_err)
    }

    fn status_payload(&self) -> Result<models::StatusPayload> {
        self.inner.status_payload().map_err(Self::map_err)
    }

    fn diff_file(&self, path: &Path) -> Result<Vec<String>> {
        self.inner.diff_file(path).map_err(Self::map_err)
    }

    fn diff_commit(&self, rev: &str) -> Result<Vec<String>> {
        self.inner.diff_commit(rev).map_err(Self::map_err)
    }

    fn stage_patch(&self, _patch: &str) -> Result<()> {
        // Not implemented yet for libgit2 backend.
        Err(VcsError::Unsupported(GIT_LIBGIT2_ID))
    }

    fn discard_paths(&self, _paths: &[PathBuf]) -> Result<()> {
        Err(VcsError::Unsupported(GIT_LIBGIT2_ID))
    }

    fn apply_reverse_patch(&self, _patch: &str) -> Result<()> {
        Err(VcsError::Unsupported(GIT_LIBGIT2_ID))
    }

    fn branches(&self) -> Result<Vec<models::BranchItem>> {
        self.inner.branches().map_err(Self::map_err)
    }

    fn get_identity(&self) -> Result<Option<(String, String)>> {
        Ok(lowlevel::git_identity(&self.inner))
    }

    fn set_identity_local(&self, name: &str, email: &str) -> Result<()> {
        self.inner.with_repo(|repo| {
            let mut cfg = repo.config()?;
            cfg.set_str("user.name", name)?;
            cfg.set_str("user.email", email)?;
            Ok(())
        }).map_err(Self::map_err::<git2::Error>)
    }
}
