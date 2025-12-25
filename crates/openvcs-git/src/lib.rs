use openvcs_core::*;
use std::{
    fs,
    io::{Read},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::{Arc, Mutex},
};
use openvcs_core::backend_descriptor::{BackendDescriptor, BACKENDS};
use openvcs_core::backend_id::BackendId;
use openvcs_core::models::{BranchItem, BranchKind, Capabilities, CommitItem, ConflictDetails, ConflictSide, FileEntry, LogQuery, OnEvent, StatusPayload, StatusSummary, VcsEvent, StashItem};
/* ============================ registry wiring ============================ */

pub const GIT_SYSTEM_ID: BackendId = backend_id!("git-system");

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

const GIT_COMMAND_NAME: &'static str = "git";

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
        let argv: Vec<String> = args.into_iter().map(|s| s.as_ref().to_string()).collect();
        log::trace!(
            "git(run): cwd={}, argv=[{}]",
            cwd.map(|p| p.display().to_string()).unwrap_or_else(|| ".".into()),
            argv.join(" ")
        );

        let mut cmd = Command::new(GIT_COMMAND_NAME);
        if let Some(c) = cwd { cmd.current_dir(c); }
        let out = cmd
            .args(&argv)
            // Disable interactive terminal prompts; rely on ssh-agent or fail fast
            .env("GIT_SSH_COMMAND", "ssh -oBatchMode=yes -oStrictHostKeyChecking=yes")
            .env("GIT_TERMINAL_PROMPT", "0")
            .output()
            .map_err(VcsError::Io)?;
        if out.status.success() {
            log::trace!("git(run): exit=0, stdout_bytes={}, stderr_bytes={}", out.stdout.len(), out.stderr.len());
            Ok(())
        } else {
            let stdout = String::from_utf8_lossy(&out.stdout).into_owned();
            let stderr = String::from_utf8_lossy(&out.stderr).into_owned();
            let mut msg = String::new();
            if !stderr.trim().is_empty() {
                msg.push_str(stderr.trim_end());
            }
            if !stdout.trim().is_empty() {
                if !msg.is_empty() { msg.push('\n'); }
                msg.push_str(stdout.trim_end());
            }
            if msg.is_empty() {
                msg = format!("git exited with {}", out.status);
            }
            log::debug!("git(run): exit={}, stdout_bytes={}, stderr_bytes={}", out.status, stdout.len(), stderr.len());
            Err(VcsError::Backend { backend: GIT_SYSTEM_ID, msg })
        }
    }

    fn run_git_capture<I, S>(cwd: Option<&Path>, args: I) -> Result<String>
    where
        I: IntoIterator<Item = S>,
        S: AsRef<str>,
    {
        let argv: Vec<String> = args.into_iter().map(|s| s.as_ref().to_string()).collect();
        log::trace!(
            "git(capture): cwd={}, argv=[{}]",
            cwd.map(|p| p.display().to_string()).unwrap_or_else(|| ".".into()),
            argv.join(" ")
        );

        let mut cmd = Command::new(GIT_COMMAND_NAME);
        if let Some(c) = cwd { cmd.current_dir(c); }
        let out = cmd
            .args(&argv)
            .env("GIT_SSH_COMMAND", "ssh -oBatchMode=yes -oStrictHostKeyChecking=yes")
            .env("GIT_TERMINAL_PROMPT", "0")
            .output()
            .map_err(VcsError::Io)?;
        if out.status.success() {
            let s = String::from_utf8_lossy(&out.stdout).into_owned();
            log::trace!("git(capture): exit=0, stdout_bytes={}", s.len());
            Ok(s)
        } else {
            let err = String::from_utf8_lossy(&out.stderr).into_owned();
            log::debug!("git(capture): exit={}, stderr_bytes={}", out.status, err.len());
            Err(VcsError::Backend {
                backend: GIT_SYSTEM_ID,
                msg: err,
            })
        }
    }

    fn run_git_capture_bytes<I, S>(cwd: Option<&Path>, args: I) -> Result<Vec<u8>>
    where
        I: IntoIterator<Item = S>,
        S: AsRef<str>,
    {
        let argv: Vec<String> = args.into_iter().map(|s| s.as_ref().to_string()).collect();
        log::trace!(
            "git(capture-bytes): cwd={}, argv=[{}]",
            cwd.map(|p| p.display().to_string()).unwrap_or_else(|| ".".into()),
            argv.join(" ")
        );

        let mut cmd = Command::new(GIT_COMMAND_NAME);
        if let Some(c) = cwd { cmd.current_dir(c); }
        let out = cmd
            .args(&argv)
            .env("GIT_SSH_COMMAND", "ssh -oBatchMode=yes -oStrictHostKeyChecking=yes")
            .env("GIT_TERMINAL_PROMPT", "0")
            .output()
            .map_err(VcsError::Io)?;
        if out.status.success() {
            Ok(out.stdout)
        } else {
            let err = String::from_utf8_lossy(&out.stderr).into_owned();
            log::debug!("git(capture-bytes): exit={}, stderr_bytes={}", out.status, err.len());
            Err(VcsError::Backend {
                backend: GIT_SYSTEM_ID,
                msg: err,
            })
        }
    }

    // Capture stdout even if the process exits with a non-zero status.
    // Useful for commands like `git diff --no-index` which may return 1 when differences are found.
    fn run_git_capture_any_exit<I, S>(cwd: Option<&Path>, args: I) -> Result<String>
    where
        I: IntoIterator<Item = S>,
        S: AsRef<str>,
    {
        let argv: Vec<String> = args.into_iter().map(|s| s.as_ref().to_string()).collect();
        log::trace!(
            "git(capture-any): cwd={}, argv=[{}]",
            cwd.map(|p| p.display().to_string()).unwrap_or_else(|| ".".into()),
            argv.join(" ")
        );

        let mut cmd = Command::new(GIT_COMMAND_NAME);
        if let Some(c) = cwd { cmd.current_dir(c); }
        let out = cmd
            .args(&argv)
            .env("GIT_SSH_COMMAND", "ssh -oBatchMode=yes -oStrictHostKeyChecking=yes")
            .env("GIT_TERMINAL_PROMPT", "0")
            .output()
            .map_err(VcsError::Io)?;
        let s = String::from_utf8_lossy(&out.stdout).into_owned();
        log::trace!("git(capture-any): exit={}, stdout_bytes={}", out.status, s.len());
        Ok(s)
    }

    fn run_git_with_input<I, S>(cwd: Option<&Path>, args: I, input: &str) -> Result<()>
    where
        I: IntoIterator<Item = S>,
        S: AsRef<str>,
    {
        let mut cmd = Command::new(GIT_COMMAND_NAME);
        if let Some(c) = cwd { cmd.current_dir(c); }
        let mut child = cmd
            .args(args.into_iter().map(|s| s.as_ref().to_string()))
            .env("GIT_SSH_COMMAND", "ssh -oBatchMode=yes -oStrictHostKeyChecking=yes")
            .env("GIT_TERMINAL_PROMPT", "0")
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(VcsError::Io)?;

        if let Some(mut stdin) = child.stdin.take() {
            use std::io::Write;
            stdin.write_all(input.as_bytes()).map_err(VcsError::Io)?;
        }

        let out = child.wait_with_output().map_err(VcsError::Io)?;
        if out.status.success() { Ok(()) } else {
            Err(VcsError::Backend { backend: GIT_SYSTEM_ID, msg: String::from_utf8_lossy(&out.stderr).into_owned() })
        }
    }

    fn run_git_streaming<const N: usize>(cwd: &Path, args: [&str; N], on: Option<OnEvent>) -> Result<()> {
        log::trace!(
            "git(stream): cwd={}, argv=[{}]",
            cwd.display(),
            args.join(" ")
        );

        if let Some(cb) = &on {
            cb(VcsEvent::RemoteMessage(format!("$ git {}", args.join(" "))));
        }

        let mut cmd = Command::new(GIT_COMMAND_NAME);
        cmd.current_dir(cwd)
            .args(args)
            .env("GIT_SSH_COMMAND", "ssh -oBatchMode=yes -oStrictHostKeyChecking=yes")
            .env("GIT_TERMINAL_PROMPT", "0")
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        let mut child = cmd.spawn().map_err(VcsError::Io)?;

        // IMPORTANT: `git fetch --progress` often uses carriage returns (`\r`) without newlines.
        // Using `BufRead::lines()` can block and stop draining the pipe, which can deadlock the child.
        // Drain both stdout/stderr with chunked reads and split on either '\n' or '\r'.
        let stderr_buf: Arc<Mutex<String>> = Arc::new(Mutex::new(String::new()));

        fn drain_stream<R: Read + Send + 'static>(
            mut reader: R,
            on: Option<OnEvent>,
            buf: Arc<Mutex<String>>,
        ) -> std::thread::JoinHandle<()> {
            std::thread::spawn(move || {
                let mut tmp = [0u8; 8192];
                let mut pending: Vec<u8> = Vec::new();

                let mut flush = |bytes: &[u8]| {
                    let text = String::from_utf8_lossy(bytes).trim().to_string();
                    if text.is_empty() {
                        return;
                    }
                    if let Ok(mut s) = buf.lock() {
                        if !s.is_empty() {
                            s.push('\n');
                        }
                        s.push_str(&text);
                    }
                    if let Some(cb) = &on {
                        cb(VcsEvent::Progress { phase: "git", detail: text });
                    }
                };

                loop {
                    let n = match reader.read(&mut tmp) {
                        Ok(0) => break,
                        Ok(n) => n,
                        Err(_) => break,
                    };
                    pending.extend_from_slice(&tmp[..n]);

                    let mut start = 0usize;
                    for i in 0..pending.len() {
                        let b = pending[i];
                        if b == b'\n' || b == b'\r' {
                            if i > start {
                                flush(&pending[start..i]);
                            }
                            start = i + 1;
                        }
                    }
                    if start > 0 {
                        pending.drain(0..start);
                    }
                }

                if !pending.is_empty() {
                    flush(&pending);
                }
            })
        }

        let stderr_join = child
            .stderr
            .take()
            .map(|stderr| drain_stream(stderr, on.clone(), Arc::clone(&stderr_buf)));

        let stdout_join = child
            .stdout
            .take()
            .map(|stdout| drain_stream(stdout, on.clone(), Arc::clone(&stderr_buf)));

        let status = child.wait().map_err(VcsError::Io)?;
        if let Some(h) = stdout_join { let _ = h.join(); }
        if let Some(h) = stderr_join { let _ = h.join(); }
        if status.success() {
            log::trace!("git(stream): exit=0");
            Ok(())
        } else {
            log::debug!("git(stream): exit={}", status);
            let msg = stderr_buf
                .lock()
                .ok()
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .unwrap_or_else(|| format!("git exited with {status}"));
            Err(VcsError::Backend { backend: GIT_SYSTEM_ID, msg })
        }
    }

    fn try_auto_stage_resolved_conflict(&self, path: &str, in_merge: bool) -> Result<bool> {
        let rel = path.trim();
        if rel.is_empty() {
            return Ok(false);
        }

        let abs = self.workdir.join(rel);
        if !abs.exists() {
            return Ok(false);
        }

        let meta = fs::metadata(&abs).map_err(VcsError::Io)?;
        // Avoid reading huge files for heuristic checks.
        if meta.len() > 8 * 1024 * 1024 {
            return Ok(false);
        }

        let work_bytes = fs::read(&abs).map_err(VcsError::Io)?;

        let repo_root = self.workdir.clone();
        let spec_ours = format!(":2:{rel}");
        let spec_theirs = format!(":3:{rel}");
        let ours = Self::run_git_capture_bytes(Some(&repo_root), ["show", "--no-textconv", &spec_ours]).ok();
        let theirs = Self::run_git_capture_bytes(Some(&repo_root), ["show", "--no-textconv", &spec_theirs]).ok();

        let matches_side = ours.as_deref() == Some(work_bytes.as_slice())
            || theirs.as_deref() == Some(work_bytes.as_slice());

        if matches_side {
            Self::run_git(Some(&self.workdir), ["add", "--", rel])?;
            return Ok(true);
        }

        // Only use the "no conflict markers" heuristic during a real merge.
        // For non-merge index conflicts (e.g. from `git apply --cached --3way`), auto-staging can
        // silently drop the intended patch, so we avoid it.
        if !in_merge {
            return Ok(false);
        }

        let is_binary = work_bytes.iter().any(|&b| b == 0);
        if is_binary {
            return Ok(false);
        }

        let text = match std::str::from_utf8(&work_bytes) {
            Ok(s) => s,
            Err(_) => return Ok(false),
        };

        let has_markers = text.contains("<<<<<<<") || text.contains("=======") || text.contains(">>>>>>>");
        if has_markers {
            return Ok(false);
        }

        Self::run_git(Some(&self.workdir), ["add", "--", rel])?;
        Ok(true)
    }
}

impl Vcs for GitSystem {
    fn id(&self) -> BackendId { GIT_SYSTEM_ID }

    fn caps(&self) -> Capabilities {
        Capabilities { commits: true, branches: true, tags: true, staging: true, push_pull: true, fast_forward: true }
    }

    fn open(path: &Path) -> Result<Self> {
        log::debug!("git-system: open {}", path.display());
        let top = Self::run_git_capture(None, ["-C", Self::path_str(path)?, "rev-parse", "--show-toplevel"])?;
        Ok(Self { workdir: PathBuf::from(top.trim()) })
    }

    fn clone(url: &str, dest: &Path, on: Option<OnEvent>) -> Result<Self> {
        // Use current process CWD for clone; git will create `dest`.
        log::info!("git-system: clone url={} dest={}", url, dest.display());
        Self::run_git_streaming(Path::new("."), ["clone", "--progress", url, Self::path_str(dest)?], on)?;
        Self::open(dest)
    }

    fn workdir(&self) -> &Path { &self.workdir }

    fn current_branch(&self) -> Result<Option<String>> {
        log::trace!("git-system: current_branch in {}", self.workdir.display());
        let out = Self::run_git_capture(Some(&self.workdir), ["rev-parse", "--abbrev-ref", "HEAD"])?;
        let s = out.trim();
        Ok(if s == "HEAD" { None } else { Some(s.to_string()) })
    }

    fn branches(&self) -> Result<Vec<BranchItem>> {
        log::trace!("git-system: branches in {}", self.workdir.display());
        // name, short, head flag
        let out = Self::run_git_capture(
            Some(&self.workdir),
            ["for-each-ref",
                "--format=%(refname) %(refname:short) %(HEAD)",
                "refs/heads", "refs/remotes"]
        )?;

        let mut items = Vec::new();
        for line in out.lines() {
            let mut parts = line.split_whitespace();
            let full = parts.next().unwrap_or("");
            let short = parts.next().unwrap_or("").to_string();
            let head_flag = parts.next().unwrap_or("");

            if full.is_empty() || short.is_empty() { continue; }

            if full.starts_with("refs/heads/") {
                let current = head_flag == "*";
                items.push(BranchItem {
                    name: short,
                    full_ref: full.to_string(),
                    kind: BranchKind::Local,
                    current,
                });
            } else if full.starts_with("refs/remotes/") {
                // refs/remotes/<remote>/<branch>
                // filter origin/HEAD
                if full.ends_with("/HEAD") { continue; }
                let after = &full["refs/remotes/".len()..];
                let remote = after.split('/').next().unwrap_or("").to_string();

                items.push(BranchItem {
                    name: short,                     // e.g., "origin/feature"
                    full_ref: full.to_string(),      // full ref
                    kind: BranchKind::Remote { remote },
                    current: false,
                });
            }
        }
        Ok(items)
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
        // 1) If local branch exists, just checkout
        if Self::run_git_capture(
            Some(&self.workdir),
            ["rev-parse", "--verify", "--quiet", &format!("refs/heads/{name}")],
        ).is_ok() {
            return Self::run_git(Some(&self.workdir), ["checkout", name]);
        }

        // 2) If a matching remote branch exists, create a local tracking branch and checkout
        let try_remote = |remote_ref: &str, local_name: &str| -> Result<bool> {
            if Self::run_git_capture(
                Some(&self.workdir),
                ["rev-parse", "--verify", "--quiet", remote_ref],
            ).is_ok() {
                // If local already exists under the derived name, just checkout it.
                if Self::run_git_capture(
                    Some(&self.workdir),
                    ["rev-parse", "--verify", "--quiet", &format!("refs/heads/{local_name}")],
                ).is_ok() {
                    Self::run_git(Some(&self.workdir), ["checkout", local_name])?;
                } else {
                    // Create a local tracking branch from the remote
                    // Equivalent to: git checkout -b <local_name> --track <remote_ref_short>
                    let short = if let Some((_, s)) = remote_ref.split_once("refs/remotes/") { s } else { remote_ref };
                    Self::run_git(Some(&self.workdir), ["checkout", "-b", local_name, "--track", short])?;
                }
                return Ok(true);
            }
            Ok(false)
        };

        // name may be like "origin/feature" (remote) or just "feature"
        if let Some((_remote, rest)) = name.split_once('/') {
            // refs/remotes/<name>
            let remote_ref = format!("refs/remotes/{name}");
            if try_remote(&remote_ref, rest)? { return Ok(()); }
        } else {
            // Try origin/<name> by default
            let remote_ref = format!("refs/remotes/origin/{name}");
            if try_remote(&remote_ref, name)? { return Ok(()); }
        }

        // 3) Fallback to a direct checkout (may detach if it's a commit)
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

    fn list_remotes(&self) -> Result<Vec<(String, String)>> {
        log::trace!("git-system: list_remotes");
        // List names first, then resolve fetch URL for each
        let out = Self::run_git_capture(Some(&self.workdir), ["remote"])?;
        let mut items = Vec::new();
        for name in out.lines().map(|l| l.trim()).filter(|s| !s.is_empty()) {
            // Prefer fetch URL; if multiple, git remote get-url returns one (the default)
            if let Ok(url) = Self::run_git_capture(Some(&self.workdir), ["remote", "get-url", name]) {
                let u = url.trim();
                if !u.is_empty() { items.push((name.to_string(), u.to_string())); }
            }
        }
        Ok(items)
    }

    fn remove_remote(&self, name: &str) -> Result<()> {
        log::info!("git-system: remove_remote '{}'", name);
        // git remote remove exits nonzero if missing; treat that as Backend error
        Self::run_git(Some(&self.workdir), ["remote", "remove", name])
    }

    fn fetch(&self, remote: &str, refspec: &str, on: Option<OnEvent>) -> Result<()> {
        log::info!("git-system: fetch {} {}", remote, refspec);
        Self::run_git_streaming(&self.workdir, ["fetch", "--progress", remote, refspec], on)
    }

    fn fetch_with_options(
        &self,
        remote: &str,
        refspec: &str,
        opts: FetchOptions,
        on: Option<OnEvent>,
    ) -> Result<()> {
        log::info!("git-system: fetch {} {} (prune={})", remote, refspec, opts.prune);
        if opts.prune {
            Self::run_git_streaming(
                &self.workdir,
                ["fetch", "--progress", "--prune", remote, refspec],
                on,
            )
        } else {
            Self::run_git_streaming(&self.workdir, ["fetch", "--progress", remote, refspec], on)
        }
    }

    fn push(&self, remote: &str, refspec: &str, on: Option<OnEvent>) -> Result<()> {
        log::info!("git-system: push {} {}", remote, refspec);
        Self::run_git_streaming(&self.workdir, ["push", "--progress", remote, refspec], on)
    }

    fn pull_ff_only(&self, remote: &str, branch: &str, on: Option<OnEvent>) -> Result<()> {
        // Pull should only run when this local branch is tracking an upstream.
        // New local branches (no upstream yet) must not attempt to pull a non-existent remote branch.
        let upstream = Self::run_git_capture(Some(&self.workdir), [
            "rev-parse",
            "--abbrev-ref",
            "--symbolic-full-name",
            "@{upstream}",
        ])
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());

        let Some(upstream) = upstream else {
            log::info!("git-system: pull skipped (no upstream) remote={} branch={}", remote, branch);
            return Err(VcsError::NoUpstream);
        };

        // Prefer pull without explicit remote/branch so git uses the configured upstream.
        log::info!("git-system: pull --ff-only (upstream={})", upstream);
        Self::run_git_streaming(&self.workdir, ["pull", "--ff-only", "--no-rebase"], on)
    }

    fn set_branch_upstream(&self, branch: &str, upstream: &str) -> Result<()> {
        let branch = branch.trim();
        let upstream = upstream.trim();
        if branch.is_empty() || upstream.is_empty() {
            return Err(VcsError::Backend {
                backend: self.id(),
                msg: "branch/upstream cannot be empty".into(),
            });
        }
        log::info!("git-system: set_branch_upstream {} -> {}", branch, upstream);
        Self::run_git(
            Some(&self.workdir),
            ["branch", &format!("--set-upstream-to={upstream}"), branch],
        )
    }

    fn branch_upstream(&self, branch: &str) -> Result<Option<String>> {
        let branch = branch.trim();
        if branch.is_empty() {
            return Ok(None);
        }
        let out = Self::run_git_capture(
            Some(&self.workdir),
            [
                "for-each-ref",
                "--format=%(upstream:short)",
                &format!("refs/heads/{branch}"),
            ],
        )?;
        let up = out.trim();
        if up.is_empty() { Ok(None) } else { Ok(Some(up.to_string())) }
    }

    fn commit(&self, message: &str, name: &str, email: &str, paths: &[PathBuf]) -> Result<String> {
        log::info!(
            "git-system: commit message_len={} author='{} <{}>' paths={}",
            message.len(), name, email, paths.len()
        );
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

    fn commit_index(&self, message: &str, name: &str, email: &str) -> Result<String> {
        // Set identity and commit whatever is currently staged in the index.
        log::info!(
            "git-system: commit_index message_len={} author='{} <{}>'",
            message.len(), name, email
        );
        Self::run_git(Some(&self.workdir), ["config", "user.name", name])?;
        Self::run_git(Some(&self.workdir), ["config", "user.email", email])?;
        Self::run_git(Some(&self.workdir), ["commit", "-m", message, "--no-edit"])?;
        let sha = Self::run_git_capture(Some(&self.workdir), ["rev-parse", "HEAD"])?;
        Ok(sha.trim().to_string())
    }

    fn status_summary(&self) -> Result<StatusSummary> {
        let out = Self::run_git_capture(Some(&self.workdir), ["status", "--porcelain=v2"])?;
        let mut s = StatusSummary::default();
        for line in out.lines() {
            if line.starts_with("? ") {
                // Untracked file (porcelain v2)
                s.untracked += 1;
            } else if line.starts_with("1 ") {
                // Ordinary changed entry: "1 XY ... <path>"
                let code = &line[2..4];
                match code {
                    " M" | " T" | " D" | "MM" | "MT" | "MD" | "AM" | "AT" => s.modified += 1,
                    "M " | "T " | "A " => s.staged += 1,
                    _ => {}
                }
            } else if line.starts_with("u ") {
                // Unmerged/conflicted entry
                s.conflicted += 1;
            }
        }
        Ok(s)
    }

    fn status_payload(&self) -> Result<StatusPayload> {
        fn parse(workdir: &Path, out: &str) -> (Vec<FileEntry>, Vec<String>) {
            let mut files = Vec::<FileEntry>::new();
            let mut conflicted_paths: Vec<String> = Vec::new();

            for line in out.lines() {
                if line.starts_with("? ") {
                    // Untracked; token after "?" is the path
                    if let Some(path) = line.split_whitespace().last() {
                        files.push(FileEntry {
                            path: path.to_string(),
                            old_path: None,
                            status: "?".into(),
                            staged: false,
                            resolved_conflict: false,
                            hunks: Vec::new(),
                        });
                    }
                } else if line.starts_with("1 ") || line.starts_with("2 ") {
                    // Ordinary changed entry: "1 XY ... <path>" or rename/copy record "2 XY ... <path>"
                    let parts: Vec<&str> = line.split_whitespace().collect();
                    if parts.len() < 2 {
                        continue;
                    }
                    let xy = parts.get(1).copied().unwrap_or("");
                    let x = xy.chars().nth(0).unwrap_or(' ');
                    let y = xy.chars().nth(1).unwrap_or(' ');
                    let staged = x != ' ';

                    if line.starts_with("2 ") {
                        // Rename/copy record includes two paths at the end.
                        // Determine which one is the "new" path by checking for existence when possible.
                        if parts.len() >= 2 + 1 + 1 + 1 {
                            let sub = parts.get(2).copied().unwrap_or("");
                            let status = if sub.to_ascii_uppercase().starts_with('C') { "C" } else { "R" }.to_string();
                            if parts.len() >= 2 {
                                let a = parts.get(parts.len().saturating_sub(2)).copied().unwrap_or("");
                                let b = parts.get(parts.len().saturating_sub(1)).copied().unwrap_or("");
                                let a_exists = workdir.join(a).exists();
                                let b_exists = workdir.join(b).exists();
                                let (new_path, old_path) = if a_exists && !b_exists {
                                    (a.to_string(), Some(b.to_string()))
                                } else if b_exists && !a_exists {
                                    (b.to_string(), Some(a.to_string()))
                                } else {
                                    // Fallback to porcelain v2 convention: last token is the source/orig path.
                                    (a.to_string(), Some(b.to_string()))
                                };
                                files.push(FileEntry {
                                    path: new_path,
                                    old_path,
                                    status,
                                    staged,
                                    resolved_conflict: false,
                                    hunks: Vec::new(),
                                });
                            }
                        }
                    } else {
                        // Ordinary changed entry: choose a stable UI status bucket.
                        let status = if x == 'D' || y == 'D' {
                            "D"
                        } else if x == 'A' || y == 'A' {
                            "A"
                        } else if x == 'R' || y == 'R' {
                            "R"
                        } else if x == 'C' || y == 'C' {
                            "C"
                        } else if x == 'T' || y == 'T' {
                            "T"
                        } else if x == 'M' || y == 'M' {
                            "M"
                        } else {
                            "M"
                        }
                        .to_string();

                        if let Some(path) = parts.last() {
                            files.push(FileEntry {
                                path: (*path).to_string(),
                                old_path: None,
                                status,
                                staged,
                                resolved_conflict: false,
                                hunks: Vec::new(),
                            });
                        }
                    }
                } else if line.starts_with("u ") {
                    // conflicted; last token is path
                    if let Some(path) = line.split_whitespace().last() {
                        let path = path.to_string();
                        conflicted_paths.push(path.clone());
                        files.push(FileEntry {
                            path,
                            old_path: None,
                            status: "U".into(),
                            staged: false,
                            resolved_conflict: false,
                            hunks: Vec::new(),
                        });
                    }
                }
            }

            (files, conflicted_paths)
        }

        // Per-file changes via porcelain v2
        let out = Self::run_git_capture(Some(&self.workdir), ["status", "--porcelain=v2"])?;
        let (mut files, conflicted_paths) = parse(&self.workdir, &out);

        // If Git has already resolved the working tree for a conflict (e.g. external tool / other client),
        // stage it automatically so it no longer blocks commits.
        if !conflicted_paths.is_empty() {
            let mut did_stage_any = false;
            let mut auto_resolved: std::collections::HashSet<String> = std::collections::HashSet::new();
            let in_merge = self.merge_in_progress().unwrap_or(false);
            for path in &conflicted_paths {
                if self.try_auto_stage_resolved_conflict(path, in_merge).unwrap_or(false) {
                    did_stage_any = true;
                    auto_resolved.insert(path.to_string());
                }
            }
            if did_stage_any {
                let out2 = Self::run_git_capture(Some(&self.workdir), ["status", "--porcelain=v2"])?;
                (files, _) = parse(&self.workdir, &out2);
                if !auto_resolved.is_empty() {
                    for f in &mut files {
                        if auto_resolved.contains(&f.path) {
                            f.resolved_conflict = true;
                        }
                    }
                }
            }
        }

        // ahead/behind: prefer @{upstream}...HEAD; fall back to discovered upstream short, then origin/<branch>
        let (mut behind, mut ahead) = (0u32, 0u32);
        if let Ok(ab) = Self::run_git_capture(Some(&self.workdir), ["rev-list", "--left-right", "--count", "@{upstream}...HEAD"]) {
            let mut parts = ab.split_whitespace();
            if let (Some(b), Some(a)) = (parts.next(), parts.next()) {
                behind = b.parse().unwrap_or(0);
                ahead  = a.parse().unwrap_or(0);
            }
        } else if let Ok(Some(cur)) = self.current_branch() {
            // Try to resolve a generic upstream short name for this branch (e.g., "origin/main")
            if let Ok(up_short) = Self::run_git_capture(Some(&self.workdir), [
                "for-each-ref", "--format=%(upstream:short)", &format!("refs/heads/{cur}")
            ]) {
                let up = up_short.trim();
                if !up.is_empty() {
                    if let Ok(ab) = Self::run_git_capture(Some(&self.workdir), ["rev-list", "--left-right", "--count", &format!("{up}...HEAD")]) {
                        let mut parts = ab.split_whitespace();
                        if let (Some(b), Some(a)) = (parts.next(), parts.next()) {
                            behind = b.parse().unwrap_or(0);
                            ahead  = a.parse().unwrap_or(0);
                        }
                    }
                }
            }
            // Final fallback: origin/<branch>
            if ahead == 0 && behind == 0 {
                let remote_short = format!("origin/{cur}");
                if Self::run_git_capture(Some(&self.workdir), ["rev-parse", "--verify", "--quiet", &remote_short]).is_ok() ||
                   Self::run_git_capture(Some(&self.workdir), ["rev-parse", "--verify", "--quiet", &format!("refs/remotes/{remote_short}")]).is_ok()
                {
                    if let Ok(ab) = Self::run_git_capture(Some(&self.workdir), ["rev-list", "--left-right", "--count", &format!("{remote_short}...HEAD")]) {
                        let mut parts = ab.split_whitespace();
                        if let (Some(b), Some(a)) = (parts.next(), parts.next()) {
                            behind = b.parse().unwrap_or(0);
                            ahead  = a.parse().unwrap_or(0);
                        }
                    }
                }
            }
        }

        Ok(StatusPayload { files, ahead, behind })
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

    fn diff_file(&self, path: &Path) -> Result<Vec<String>> {
        log::trace!("git-system: diff_file {}", path.display());
        let p = Self::path_str(path)?;
        // Prefer *unstaged* first
        let out = Self::run_git_capture(Some(&self.workdir), [
            "diff", "--no-color", "--unified=3", "--", p
        ])?;
        let s = out.trim_end();
        if !s.is_empty() {
            return Ok(s.lines().map(|l| l.to_string()).collect());
        }

        // Then *staged*
        let out_cached = Self::run_git_capture(Some(&self.workdir), [
            "diff", "--no-color", "--unified=3", "--cached", "--", p
        ])?;
        let sc = out_cached.trim_end();
        if !sc.is_empty() {
            return Ok(sc.lines().map(|l| l.to_string()).collect());
        }

        // Fallback: untracked file → show as additions via no-index
        // Only if the file exists, otherwise return empty
        let abs = if path.is_absolute() { path.to_path_buf() } else { self.workdir.join(path) };
        if abs.exists() {
            let out_noindex = Self::run_git_capture_any_exit(Some(&self.workdir), [
                "diff", "--no-color", "--unified=3", "--no-index", "--",
                "/dev/null", Self::path_str(&abs)?
            ])?;
            let sn = out_noindex.trim_end();
            if !sn.is_empty() {
                return Ok(sn.lines().map(|l| l.to_string()).collect());
            }
        }

        Ok(Vec::new())
    }

    fn diff_commit(&self, rev: &str) -> Result<Vec<String>> {
        log::trace!("git-system: diff_commit {}", rev);
        // Show patch only; no commit header/body
        let out = Self::run_git_capture(Some(&self.workdir), [
            "show", "--no-color", "--unified=3", "--format=", rev
        ])?;
        Ok(out.trim_end().lines().map(|l| l.to_string()).collect())
    }

    fn conflict_details(&self, path: &Path) -> Result<ConflictDetails> {
        log::trace!("git-system: conflict_details {}", path.display());
        let p = Self::path_str(path)?;
        let ls = Self::run_git_capture(Some(&self.workdir), ["ls-files", "-u", "--", p])?;
        if ls.trim().is_empty() {
            return Err(VcsError::Backend {
                backend: GIT_SYSTEM_ID,
                msg: format!("no conflict recorded for {p}"),
            });
        }

        let repo_root = self.workdir.clone();
        let read_stage = |stage: u8| -> Result<Option<Vec<u8>>> {
            let spec = format!(":{}:{}", stage, p);
            match Self::run_git_capture_bytes(Some(&repo_root), ["show", "--no-textconv", &spec]) {
                Ok(bytes) => Ok(Some(bytes)),
                Err(VcsError::Backend { .. }) => Ok(None),
                Err(e) => Err(e),
            }
        };

        fn decode_blob(data: Option<Vec<u8>>, binary: &mut bool, lfs_ptr: &mut bool) -> Option<String> {
            let bytes = data?;
            if bytes.iter().any(|&b| b == 0) {
                *binary = true;
                return None;
            }
            match String::from_utf8(bytes) {
                Ok(text) => {
                    if text.starts_with("version https://git-lfs.github.com/spec/v1") {
                        *lfs_ptr = true;
                    }
                    Some(text)
                }
                Err(_) => {
                    *binary = true;
                    None
                }
            }
        }

        let ours_raw = read_stage(2)?;
        let theirs_raw = read_stage(3)?;
        let base_raw = read_stage(1)?;

        let mut binary = false;
        let mut lfs_pointer = false;
        let ours_text = decode_blob(ours_raw, &mut binary, &mut lfs_pointer);
        let theirs_text = decode_blob(theirs_raw, &mut binary, &mut lfs_pointer);
        let base_text = decode_blob(base_raw, &mut binary, &mut lfs_pointer);

        Ok(ConflictDetails {
            path: p.to_string(),
            ours: if binary { None } else { ours_text },
            theirs: if binary { None } else { theirs_text },
            base: if binary { None } else { base_text },
            binary,
            lfs_pointer,
        })
    }

    fn checkout_conflict_side(&self, path: &Path, side: ConflictSide) -> Result<()> {
        log::debug!("git-system: checkout_conflict_side {:?} {}", side, path.display());
        let p = Self::path_str(path)?;
        let flag = match side {
            ConflictSide::Ours => "--ours",
            ConflictSide::Theirs => "--theirs",
        };
        Self::run_git(Some(&self.workdir), ["checkout", flag, "--", p])?;
        Self::run_git(Some(&self.workdir), ["add", "--", p])?;
        Ok(())
    }

    fn write_merge_result(&self, path: &Path, content: &[u8]) -> Result<()> {
        log::debug!("git-system: write_merge_result {} bytes={}", path.display(), content.len());
        let abs = if path.is_absolute() { path.to_path_buf() } else { self.workdir.join(path) };
        if let Some(parent) = abs.parent() {
            if !parent.exists() {
                fs::create_dir_all(parent).map_err(VcsError::Io)?;
            }
        }
        fs::write(&abs, content).map_err(VcsError::Io)?;
        let rel = Self::path_str(path)?;
        Self::run_git(Some(&self.workdir), ["add", "--", rel])?;
        Ok(())
    }

    fn stage_patch(&self, patch: &str) -> Result<()> {
        log::debug!("git-system: stage_patch bytes={}", patch.len());
        // Apply patch to the index only; do not touch working tree.
        // Be tolerant to minor context shifts and try a three-way merge when needed.
        // - `--cached`: stage changes to the index only
        // - `--3way`: attempt a 3-way merge if the patch does not apply cleanly
        // - `-p1`: strip leading a/ and b/ introduced by unified diffs
        // - `--whitespace=nowarn`: do not reject because of whitespace-only issues
        if let Err(_) = Self::run_git_with_input(
            Some(&self.workdir),
            ["apply", "--cached", "--3way", "--unidiff-zero", "--whitespace=nowarn", "-p1", "-"],
            patch,
        ) {
            // Some patches may not include a/ b/ prefixes; retry without stripping
            Self::run_git_with_input(
                Some(&self.workdir),
                ["apply", "--cached", "--3way", "--unidiff-zero", "--whitespace=nowarn", "-p0", "-"],
                patch,
            )?
        }
        Ok(())
    }

    fn discard_paths(&self, paths: &[PathBuf]) -> Result<()> {
        log::debug!("git-system: discard_paths count={}", paths.len());
        if paths.is_empty() { return Ok(()); }
        let mut args: Vec<String> = vec!["restore".into(), "--staged".into(), "--worktree".into(), "--source=HEAD".into(), "--".into()];
        for p in paths {
            args.push(Self::path_str(p)?.to_string());
        }
        if let Err(_) = Self::run_git(Some(&self.workdir), args.clone()) {
            for p in paths {
                let single = vec!["restore".to_string(), "--staged".into(), "--worktree".into(), "--source=HEAD".into(), "--".into(), Self::path_str(p)?.to_string()];
                let _ = Self::run_git(Some(&self.workdir), single);
            }
        }
        Ok(())
    }

    fn apply_reverse_patch(&self, patch: &str) -> Result<()> {
        log::debug!("git-system: apply_reverse_patch bytes={}", patch.len());
        Self::run_git_with_input(
            Some(&self.workdir),
            ["apply", "--reverse", "--index", "--unidiff-zero", "-p1", "-"],
            patch,
        )
    }

    fn hard_reset_head(&self) -> Result<()> {
        log::warn!("git-system: hard_reset_head on {}", self.workdir.display());
        Self::run_git(Some(&self.workdir), ["reset", "--hard", "HEAD"])
    }

    fn reset_soft_to(&self, rev: &str) -> Result<()> {
        log::info!("git-system: reset_soft_to {}", rev);
        Self::run_git(Some(&self.workdir), ["reset", "--soft", rev])
    }

    fn get_identity(&self) -> Result<Option<(String, String)>> {
        log::trace!("git-system: get_identity");
        // Prefer repo context, but allow Git's normal precedence (local → global → system)
        let name = match Self::run_git_capture(Some(&self.workdir), ["config", "--get", "user.name"]) {
            Ok(s) => s.trim().to_string(),
            Err(_) => return Ok(None),
        };
        let email = match Self::run_git_capture(Some(&self.workdir), ["config", "--get", "user.email"]) {
            Ok(s) => s.trim().to_string(),
            Err(_) => return Ok(None),
        };
        if name.is_empty() || email.is_empty() { return Ok(None); }
        Ok(Some((name, email)))
    }

    fn set_identity_local(&self, name: &str, email: &str) -> Result<()> {
        log::debug!("git-system: set_identity_local name='{}' email='{}'", name, email);
        Self::run_git(Some(&self.workdir), ["config", "--local", "user.name", name])?;
        Self::run_git(Some(&self.workdir), ["config", "--local", "user.email", email])
    }

    fn delete_branch(&self, name: &str, force: bool) -> Result<()> {
        log::info!("git-system: delete_branch '{}' force={}", name, force);
        // Guard: do not delete current branch
        if let Ok(cur) = self.current_branch() {
            if let Some(c) = cur { if c == name { return Err(VcsError::Backend { backend: GIT_SYSTEM_ID, msg: "cannot delete current branch".into() }); }}
        }
        if force {
            Self::run_git(Some(&self.workdir), ["branch", "-D", name])
        } else {
            Self::run_git(Some(&self.workdir), ["branch", "-d", name])
        }
    }

    fn rename_branch(&self, old: &str, new: &str) -> Result<()> {
        log::info!("git-system: rename_branch '{}' -> '{}'", old, new);
        let old = old.trim();
        let new = new.trim();
        if old.is_empty() || new.is_empty() {
            return Err(VcsError::Backend { backend: GIT_SYSTEM_ID, msg: "branch names cannot be empty".into() });
        }
        // Use git's builtin rename which preserves upstream/tracking when possible
        Self::run_git(Some(&self.workdir), ["branch", "-m", old, new])
    }

    fn merge_into_current(&self, name: &str) -> Result<()> {
        self.merge_into_current_with_message(name, None)
    }

    fn merge_into_current_with_message(&self, name: &str, message: Option<&str>) -> Result<()> {
        // Perform a merge into the current branch. Let git merge without prompting and
        // return any conflicts as error output.
        log::info!("git-system: merge_into_current '{}'", name);
        let mut args: Vec<String> = vec![
            "merge".into(),
            "--no-ff".into(),
            "--no-edit".into(),
            "--commit".into(),
        ];
        if let Some(msg) = message {
            let msg = msg.trim();
            if !msg.is_empty() {
                args.push("-m".into());
                args.push(msg.into());
            }
        }
        args.push(name.into());
        Self::run_git(Some(&self.workdir), args)
    }

    fn merge_abort(&self) -> Result<()> {
        log::info!("git-system: merge_abort");
        Self::run_git(Some(&self.workdir), ["merge", "--abort"])
    }

    fn merge_continue(&self) -> Result<()> {
        log::info!("git-system: merge_continue");
        // Continue the merge by committing the current index using the pre-populated MERGE_MSG.
        Self::run_git(Some(&self.workdir), ["commit", "--no-edit"])
    }

    fn merge_in_progress(&self) -> Result<bool> {
        let s = Self::run_git_capture_any_exit(Some(&self.workdir), ["rev-parse", "--verify", "-q", "MERGE_HEAD"])?;
        Ok(!s.trim().is_empty())
    }

    // ---------------- stash ----------------
    fn stash_list(&self) -> Result<Vec<StashItem>> {
        // Format: %gd (stash@{0}) %cs (date) %s (subject)
        // %gd gives stash@{N}; %cI is the committer date in strict ISO format.
        let out = Self::run_git_capture(Some(&self.workdir), [
            "stash", "list",
            "--pretty=format:%gd%x00%cI%x00%s",
        ])?;
        let mut items = Vec::new();
        for line in out.lines() {
            if line.trim().is_empty() { continue; }
            let mut parts = line.split('\0');
            let sel = parts.next().unwrap_or("").trim().to_string();
            let date = parts.next().unwrap_or("").trim().to_string();
            let msg  = parts.next().unwrap_or("").trim().to_string();
            if sel.is_empty() { continue; }
            items.push(StashItem { selector: sel, msg, meta: date });
        }
        Ok(items)
    }

    fn stash_push(&self, message: &str, include_untracked: bool, paths: &[PathBuf]) -> Result<()> {
        let mut args: Vec<String> = vec!["stash".into(), "push".into(), "-m".into(), message.into()];
        if include_untracked { args.push("-u".into()); }
        if !paths.is_empty() {
            args.push("--".into());
            for p in paths { args.push(Self::path_str(p)?.to_string()); }
        }
        Self::run_git(Some(&self.workdir), args)
    }

    fn stash_apply(&self, selector: &str) -> Result<()> {
        let sel = if selector.trim().is_empty() { "stash@{0}" } else { selector };
        Self::run_git(Some(&self.workdir), ["stash", "apply", sel])
    }

    fn stash_pop(&self, selector: &str) -> Result<()> {
        let sel = if selector.trim().is_empty() { "stash@{0}" } else { selector };
        Self::run_git(Some(&self.workdir), ["stash", "pop", sel])
    }

    fn stash_drop(&self, selector: &str) -> Result<()> {
        let sel = if selector.trim().is_empty() { "stash@{0}" } else { selector };
        Self::run_git(Some(&self.workdir), ["stash", "drop", sel])
    }

    fn stash_show(&self, selector: &str) -> Result<Vec<String>> {
        let sel = if selector.trim().is_empty() { "stash@{0}" } else { selector };
        let s = Self::run_git_capture_any_exit(Some(&self.workdir), ["stash", "show", "-p", sel])?;
        Ok(s.lines().map(|l| l.to_string()).collect())
    }

    fn lfs_fetch(&self) -> Result<()> {
        log::info!(
            "git-system: lfs_fetch in {}",
            self.workdir.display()
        );
        Self::run_git(Some(&self.workdir), ["lfs", "fetch", "--all"])
    }

    fn lfs_pull(&self) -> Result<()> {
        log::info!(
            "git-system: lfs_pull in {}",
            self.workdir.display()
        );
        Self::run_git(Some(&self.workdir), ["lfs", "pull"])
    }

    fn lfs_prune(&self) -> Result<()> {
        log::info!(
            "git-system: lfs_prune in {}",
            self.workdir.display()
        );
        Self::run_git(Some(&self.workdir), ["lfs", "prune"])
    }

    fn lfs_track(&self, paths: &[PathBuf]) -> Result<()> {
        if paths.is_empty() {
            return Ok(());
        }
        log::info!(
            "git-system: lfs_track count={} in {}",
            paths.len(),
            self.workdir.display()
        );
        let mut args: Vec<String> = vec!["lfs".into(), "track".into(), "--".into()];
        for p in paths {
            args.push(Self::path_str(p)?.to_string());
        }
        Self::run_git(Some(&self.workdir), args)
    }

    fn lfs_is_tracked(&self, path: &Path) -> Result<bool> {
        let p = Self::path_str(path)?;
        // `git check-attr` does not require git-lfs to be installed; it reads `.gitattributes`.
        // Output example: `path/to/file: filter: lfs`
        let out = Self::run_git_capture(Some(&self.workdir), ["check-attr", "filter", "--", p])?;
        Ok(out.lines().any(|l| l.contains("filter: lfs")))
    }
}
