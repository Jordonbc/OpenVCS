use openvcs_core::*;
use std::{
    io::{BufRead, BufReader},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::Arc,
};
use openvcs_core::backend_descriptor::{BackendDescriptor, BACKENDS};
use openvcs_core::backend_id::BackendId;
use openvcs_core::models::{BranchItem, BranchKind, Capabilities, CommitItem, FileEntry, LogQuery, OnEvent, StatusPayload, StatusSummary, VcsEvent};
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
        let mut cmd = Command::new(GIT_COMMAND_NAME);
        if let Some(c) = cwd { cmd.current_dir(c); }
        let status = cmd
            .args(args.into_iter().map(|s| s.as_ref().to_string()))
            // Disable interactive terminal prompts; rely on ssh-agent or fail fast
            .env("GIT_SSH_COMMAND", "ssh -oBatchMode=yes")
            .env("GIT_TERMINAL_PROMPT", "0")
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
        let mut cmd = Command::new(GIT_COMMAND_NAME);
        if let Some(c) = cwd { cmd.current_dir(c); }
        let out = cmd
            .args(args.into_iter().map(|s| s.as_ref().to_string()))
            .env("GIT_SSH_COMMAND", "ssh -oBatchMode=yes")
            .env("GIT_TERMINAL_PROMPT", "0")
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

    // Capture stdout even if the process exits with a non-zero status.
    // Useful for commands like `git diff --no-index` which may return 1 when differences are found.
    fn run_git_capture_any_exit<I, S>(cwd: Option<&Path>, args: I) -> Result<String>
    where
        I: IntoIterator<Item = S>,
        S: AsRef<str>,
    {
        let mut cmd = Command::new(GIT_COMMAND_NAME);
        if let Some(c) = cwd { cmd.current_dir(c); }
        let out = cmd
            .args(args.into_iter().map(|s| s.as_ref().to_string()))
            .env("GIT_SSH_COMMAND", "ssh -oBatchMode=yes")
            .env("GIT_TERMINAL_PROMPT", "0")
            .output()
            .map_err(VcsError::Io)?;
        Ok(String::from_utf8_lossy(&out.stdout).into_owned())
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
            .env("GIT_SSH_COMMAND", "ssh -oBatchMode=yes")
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
        let mut cmd = Command::new(GIT_COMMAND_NAME);
        cmd.current_dir(cwd)
            .args(args)
            .env("GIT_SSH_COMMAND", "ssh -oBatchMode=yes")
            .env("GIT_TERMINAL_PROMPT", "0")
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

    fn branches(&self) -> Result<Vec<BranchItem>> {
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
        // git remote remove exits nonzero if missing; treat that as Backend error
        Self::run_git(Some(&self.workdir), ["remote", "remove", name])
    }

    fn fetch(&self, remote: &str, refspec: &str, on: Option<OnEvent>) -> Result<()> {
        Self::run_git_streaming(&self.workdir, ["fetch", "--progress", remote, refspec], on)
    }

    fn push(&self, remote: &str, refspec: &str, on: Option<OnEvent>) -> Result<()> {
        Self::run_git_streaming(&self.workdir, ["push", "--progress", remote, refspec], on)
    }

    fn pull_ff_only(&self, remote: &str, branch: &str, on: Option<OnEvent>) -> Result<()> {
        // Prefer a single pull with ff-only for simplicity and to surface server messages
        // Equivalent to: git fetch <remote> <branch>; git merge --ff-only <remote>/<branch>
        // Using streaming to forward progress to the UI when available.
        Self::run_git_streaming(
            &self.workdir,
            ["pull", "--ff-only", "--no-rebase", remote, branch],
            on,
        )
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

    fn commit_index(&self, message: &str, name: &str, email: &str) -> Result<String> {
        // Set identity and commit whatever is currently staged in the index.
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
        // Per-file changes via porcelain v2
        let out = Self::run_git_capture(Some(&self.workdir), ["status", "--porcelain=v2"])?;
        let mut files = Vec::<FileEntry>::new();

        for line in out.lines() {
            if line.starts_with("? ") {
                // Untracked; token after "?" is the path
                if let Some(path) = line.split_whitespace().last() {
                    files.push(FileEntry { path: path.to_string(), status: "A".into(), hunks: Vec::new() });
                }
            } else if line.starts_with("1 ") {
                // Ordinary changed entry: "1 XY ... <path>"
                let xy = &line[2..4];
                let x = xy.chars().nth(0).unwrap_or(' ');
                let y = xy.chars().nth(1).unwrap_or(' ');
                let is_mod = |c: char| c == 'M' || c == 'T';
                let status = if x == 'A' || y == 'A' {
                    "A"
                } else if x == 'D' || y == 'D' {
                    "D"
                } else if is_mod(x) || is_mod(y) {
                    "M"
                } else {
                    // Default to Modified for any other ordinary change combo
                    "M"
                }.to_string();

                if let Some(path) = line.split_whitespace().last() {
                    files.push(FileEntry { path: path.to_string(), status, hunks: Vec::new() });
                }
            } else if line.starts_with("2 ") {
                // Rename/copy record; mark as rename and use new path
                if let Some(path) = line.split_whitespace().last() {
                    files.push(FileEntry { path: path.to_string(), status: "R".into(), hunks: Vec::new() });
                }
            } else if line.starts_with("u ") {
                // conflicted; last token is path
                if let Some(path) = line.split_whitespace().last() {
                    files.push(FileEntry { path: path.to_string(), status: "U".into(), hunks: Vec::new() });
                }
            }
        }

        // ahead/behind: @{upstream}...HEAD
        let (mut behind, mut ahead) = (0u32, 0u32);
        if let Ok(ab) = Self::run_git_capture(Some(&self.workdir), ["rev-list", "--left-right", "--count", "@{upstream}...HEAD"]) {
            let mut parts = ab.split_whitespace();
            if let (Some(b), Some(a)) = (parts.next(), parts.next()) {
                behind = b.parse().unwrap_or(0);
                ahead  = a.parse().unwrap_or(0);
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

    fn stage_patch(&self, patch: &str) -> Result<()> {
        // Apply patch to the index only; do not touch working tree
        // We rely on Git to validate and reject invalid hunks.
        // Use --cached to stage and --allow-empty for files that might not exist yet in index.
        // Use -p1 to strip the leading "a/" and "b/" path components present in unified diffs
        // generated by `git diff`. Keep --cached so we only stage to the index.
        Self::run_git_with_input(
            Some(&self.workdir),
            ["apply", "--cached", "--unidiff-zero", "-p1", "-"],
            patch,
        )
    }

    fn discard_paths(&self, paths: &[PathBuf]) -> Result<()> {
        if paths.is_empty() { return Ok(()); }
        let mut args: Vec<String> = vec!["restore".into(), "--staged".into(), "--worktree".into(), "--source=HEAD".into(), "--".into()];
        for p in paths {
            args.push(Self::path_str(p)?.to_string());
        }
        if let Err(_) = Self::run_git(Some(&self.workdir), args.clone()) {
            for p in paths {
                let mut single = vec!["restore".to_string(), "--staged".into(), "--worktree".into(), "--source=HEAD".into(), "--".into(), Self::path_str(p)?.to_string()];
                let _ = Self::run_git(Some(&self.workdir), single);
            }
        }
        Ok(())
    }

    fn apply_reverse_patch(&self, patch: &str) -> Result<()> {
        Self::run_git_with_input(
            Some(&self.workdir),
            ["apply", "--reverse", "--index", "--unidiff-zero", "-p1", "-"],
            patch,
        )
    }

    fn hard_reset_head(&self) -> Result<()> {
        Self::run_git(Some(&self.workdir), ["reset", "--hard", "HEAD"])
    }

    fn get_identity(&self) -> Result<Option<(String, String)>> {
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
        Self::run_git(Some(&self.workdir), ["config", "--local", "user.name", name])?;
        Self::run_git(Some(&self.workdir), ["config", "--local", "user.email", email])
    }
}
