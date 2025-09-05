use openvcs_core::*;
use std::{
    io::{BufRead, BufReader},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::Arc,
};
use openvcs_core::models::{CommitItem, LogQuery};
/* ============================ registry wiring ============================ */

pub const GIT_SYSTEM_ID: BackendId  = "git-system";

fn caps_static() -> Capabilities {
    Capabilities { commits: true, branches: true, tags: true, staging: true, push_pull: true, fast_forward: true }
}

fn open_factory(path: &Path) -> Result<Arc<dyn Vcs>> {
    GitSystem::open(path).map(|v| Arc::new(v) as Arc<dyn Vcs>)
}

fn clone_factory(url: &str, dest: &Path, on: Option<OnEvent>) -> Result<Arc<dyn Vcs>> {
    GitSystem::clone(url, dest, on).map(|v| Arc::new(v) as Arc<dyn Vcs>)
}

#[linkme::distributed_slice(BACKENDS)]
pub static GIT_SYS_DESC: BackendDescriptor = BackendDescriptor {
    id: GIT_SYSTEM_ID,
    name: "Git (system)",
    caps: caps_static,
    open: open_factory,
    clone_repo: clone_factory,
};

/* ============================== implementation ============================== */

pub struct GitSystem {
    workdir: PathBuf,
}

impl GitSystem {
    fn path_str(p: &Path) -> Result<&str> {
        p.to_str().ok_or_else(|| VcsError::Io(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "non-utf8 path",
        )))
    }

    fn run_git<I, S>(cwd: Option<&Path>, args: I) -> Result<()>
    where
        I: IntoIterator<Item = S>,
        S: AsRef<str>,
    {
        let mut cmd = Command::new("git");
        if let Some(c) = cwd { cmd.current_dir(c); }
        let status = cmd
            .args(args.into_iter().map(|s| s.as_ref().to_string()))
            .env("GIT_SSH_COMMAND", "ssh")
            .status()
            .map_err(VcsError::Io)?;
        if status.success() {
            Ok(())
        } else {
            Err(VcsError::Backend { backend: GIT_SYSTEM_ID, msg: format!("git exited with {status}") })
        }
    }

    fn run_git_capture<I, S>(cwd: Option<&Path>, args: I) -> Result<String>
    where
        I: IntoIterator<Item = S>,
        S: AsRef<str>,
    {
        let mut cmd = Command::new("git");
        if let Some(c) = cwd { cmd.current_dir(c); }
        let out = cmd
            .args(args.into_iter().map(|s| s.as_ref().to_string()))
            .env("GIT_SSH_COMMAND", "ssh")
            .output()
            .map_err(VcsError::Io)?;
        if out.status.success() {
            Ok(String::from_utf8_lossy(&out.stdout).into_owned())
        } else {
            Err(VcsError::Backend {
                backend: GIT_SYSTEM_ID,
                msg: String::from_utf8_lossy(&out.stderr).into_owned(),
            })
        }
    }

    fn run_git_streaming<const N: usize>(cwd: &Path, args: [&str; N], on: Option<OnEvent>) -> Result<()> {
        let mut cmd = Command::new("git");
        cmd.current_dir(cwd)
            .args(args)
            .env("GIT_SSH_COMMAND", "ssh")
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        let mut child = cmd.spawn().map_err(VcsError::Io)?;

        if let Some(stderr) = child.stderr.take() {
            let on_clone = on.clone();
            std::thread::spawn(move || {
                for line in BufReader::new(stderr).lines().flatten() {
                    if let Some(cb) = &on_clone {
                        cb(VcsEvent::Progress { phase: "git", detail: line });
                    }
                }
            });
        }
        if let Some(stdout) = child.stdout.take() {
            for line in BufReader::new(stdout).lines().flatten() {
                if let Some(cb) = &on {
                    cb(VcsEvent::Progress { phase: "git", detail: line });
                }
            }
        }

        let status = child.wait().map_err(VcsError::Io)?;
        if status.success() {
            Ok(())
        } else {
            Err(VcsError::Backend { backend: GIT_SYSTEM_ID, msg: format!("git exited with {status}") })
        }
    }
}

impl Vcs for GitSystem {
    fn id(&self) -> BackendId { GIT_SYSTEM_ID }

    fn caps(&self) -> Capabilities {
        Capabilities { commits: true, branches: true, tags: true, staging: true, push_pull: true, fast_forward: true }
    }

    fn open(path: &Path) -> Result<Self> {
        let top = Self::run_git_capture(None, ["-C", Self::path_str(path)?, "rev-parse", "--show-toplevel"])?;
        Ok(Self { workdir: PathBuf::from(top.trim()) })
    }

    fn clone(url: &str, dest: &Path, on: Option<OnEvent>) -> Result<Self> {
        // Use current process CWD for clone; git will create `dest`.
        Self::run_git_streaming(Path::new("."), ["clone", "--progress", url, Self::path_str(dest)?], on)?;
        Self::open(dest)
    }

    fn workdir(&self) -> &Path { &self.workdir }

    fn current_branch(&self) -> Result<Option<String>> {
        let out = Self::run_git_capture(Some(&self.workdir), ["rev-parse", "--abbrev-ref", "HEAD"])?;
        let s = out.trim();
        Ok(if s == "HEAD" { None } else { Some(s.to_string()) })
    }

    fn local_branches(&self) -> Result<Vec<String>> {
        let out = Self::run_git_capture(Some(&self.workdir), ["for-each-ref", "--format=%(refname:short)", "refs/heads"])?;
        Ok(out.lines().map(|l| l.trim().to_string()).filter(|s| !s.is_empty()).collect())
    }

    fn create_branch(&self, name: &str, checkout: bool) -> Result<()> {
        Self::run_git(Some(&self.workdir), ["branch", name])?;
        if checkout { self.checkout_branch(name)?; }
        Ok(())
    }

    fn checkout_branch(&self, name: &str) -> Result<()> {
        Self::run_git(Some(&self.workdir), ["checkout", name])
    }

    fn ensure_remote(&self, name: &str, url: &str) -> Result<()> {
        let remotes = Self::run_git_capture(Some(&self.workdir), ["remote"])?;
        if remotes.lines().any(|r| r.trim() == name) {
            Self::run_git(Some(&self.workdir), ["remote", "set-url", name, url])
        } else {
            Self::run_git(Some(&self.workdir), ["remote", "add", name, url])
        }
    }

    fn fetch(&self, remote: &str, refspec: &str, on: Option<OnEvent>) -> Result<()> {
        Self::run_git_streaming(&self.workdir, ["fetch", "--progress", remote, refspec], on)
    }

    fn push(&self, remote: &str, refspec: &str, on: Option<OnEvent>) -> Result<()> {
        Self::run_git_streaming(&self.workdir, ["push", "--progress", remote, refspec], on)
    }

    fn commit(&self, message: &str, name: &str, email: &str, paths: &[PathBuf]) -> Result<String> {
        Self::run_git(Some(&self.workdir), ["config", "user.name", name])?;
        Self::run_git(Some(&self.workdir), ["config", "user.email", email])?;
        if paths.is_empty() {
            Self::run_git(Some(&self.workdir), ["add", "-A"])?;
        } else {
            let mut args = vec!["add".to_string()];
            for p in paths {
                args.push(Self::path_str(p)?.to_string());
            }
            Self::run_git(Some(&self.workdir), args)?;
        }
        Self::run_git(Some(&self.workdir), ["commit", "-m", message, "--no-edit"])?;
        let sha = Self::run_git_capture(Some(&self.workdir), ["rev-parse", "HEAD"])?;
        Ok(sha.trim().to_string())
    }

    fn status_summary(&self) -> Result<StatusSummary> {
        let out = Self::run_git_capture(Some(&self.workdir), ["status", "--porcelain=v2"])?;
        let mut s = StatusSummary::default();
        for line in out.lines() {
            if line.starts_with("1 ") {
                let code = &line[2..4];
                match code {
                    "??" => s.untracked += 1,
                    " M" | " T" | " D" | "MM" | "MT" | "MD" | "AM" | "AT" => s.modified += 1,
                    "M " | "T " | "A " => s.staged += 1,
                    _ => {}
                }
            } else if line.starts_with("u ") {
                s.conflicted += 1;
            }
        }
        Ok(s)
    }

    fn hard_reset_head(&self) -> Result<()> {
        Self::run_git(Some(&self.workdir), ["reset", "--hard", "HEAD"])
    }

    fn log_commits(&self, q: &LogQuery) -> Result<Vec<CommitItem>> {
        // Build: git log [rev?] [--topo-order] [--no-merges] --date=iso-strict
        //        [--since=..] [--until=..] [--author=..] --skip=N --max-count=M
        //        --pretty='...%x00...' [-- path]
        let mut args: Vec<String> = vec!["log".into()];

        if let Some(rev) = &q.rev {
            args.push(rev.clone());
        }

        if q.topo_order {
            args.push("--topo-order".into());
        }
        if !q.include_merges {
            args.push("--no-merges".into());
        }

        args.push("--date=iso-strict".into());
        if let Some(s) = &q.since_utc {
            args.push(format!("--since={s}"));
        }
        if let Some(u) = &q.until_utc {
            args.push(format!("--until={u}"));
        }
        if let Some(a) = &q.author_contains {
            args.push(format!("--author={a}"));
        }

        args.push(format!("--skip={}", q.skip));
        args.push(format!("--max-count={}", q.limit));

        // NUL-separated fields, one commit per line
        args.push("--pretty=format:%H%x00%an <%ae>%x00%ad%x00%s".into());

        if let Some(p) = &q.path {
            args.push("--".into());
            args.push(p.clone());
        }

        let out = Self::run_git_capture(Some(&self.workdir), args)?;
        let mut items = Vec::with_capacity(q.limit as usize);

        for line in out.lines() {
            // Each line → one commit with NUL-separated fields
            let mut parts = line.split('\0');
            let id = parts.next().unwrap_or_default();
            if id.is_empty() {
                continue;
            }
            let author = parts.next().unwrap_or_default().to_string();
            let when   = parts.next().unwrap_or_default().to_string();
            let msg    = parts.next().unwrap_or_default().to_string();

            let short = &id[..id.len().min(7)];
            let meta  = format!("{when} • {short}");

            items.push(CommitItem {
                id: id.to_string(),
                msg,
                meta,
                author,
            });
        }

        Ok(items)
    }
}
