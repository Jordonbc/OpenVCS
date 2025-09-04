mod lowlevel;

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
   Public wrapper: implement the openvcs-core::Vcs trait using the low-level libgit2 code.
   ========================================================================================= */

/// Libgit2-backed VCS implementation.
pub struct GitLibGit2 {
    inner: lowlevel::Git,
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
