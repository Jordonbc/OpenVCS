use openvcs_core::*;
use std::{io::{BufRead, BufReader}, path::{Path, PathBuf}, process::{Command, Stdio}};

pub struct GitSystem { workdir: PathBuf }

impl GitSystem {
    fn path_str(p: &Path) -> Result<&str> {
        p.to_str().ok_or_else(|| VcsError::Io(std::io::Error::new(std::io::ErrorKind::InvalidInput, "non-utf8 path")))
    }
    fn run_git<I, S>(cwd: Option<&Path>, args: I) -> Result<()>
    where I: IntoIterator<Item=S>, S: AsRef<str> {
        let mut cmd = Command::new("git");
        if let Some(c) = cwd { cmd.current_dir(c); }
        let status = cmd.args(args.into_iter().map(|s| s.as_ref().to_string()))
            .env("GIT_SSH_COMMAND","ssh").status().map_err(VcsError::Io)?;
        if status.success() { Ok(()) } else { Err(VcsError::Backend{ backend: BackendId::GitSystem, msg: format!("git exited with {status}") }) }
    }
    fn run_git_capture<I, S>(cwd: Option<&Path>, args: I) -> Result<String>
    where I: IntoIterator<Item=S>, S: AsRef<str> {
        let mut cmd = Command::new("git");
        if let Some(c) = cwd { cmd.current_dir(c); }
        let out = cmd.args(args.into_iter().map(|s| s.as_ref().to_string()))
            .env("GIT_SSH_COMMAND","ssh").output().map_err(VcsError::Io)?;
        if out.status.success() { Ok(String::from_utf8_lossy(&out.stdout).into_owned()) }
        else { Err(VcsError::Backend{ backend: BackendId::GitSystem, msg: String::from_utf8_lossy(&out.stderr).into_owned() }) }
    }
    fn run_git_streaming<const N: usize>(cwd: &Path, args: [&str; N], on: Option<OnEvent>) -> Result<()> {
        let mut cmd = Command::new("git");
        cmd.current_dir(cwd).args(args).env("GIT_SSH_COMMAND","ssh")
           .stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
        let mut child = cmd.spawn().map_err(VcsError::Io)?;
        if let Some(stderr) = child.stderr.take() {
            for line in BufReader::new(stderr).lines().flatten() {
                if let Some(cb)=&on { cb(VcsEvent::Progress{ phase:"git", detail: line }); }
            }
        }
        if let Some(stdout) = child.stdout.take() {
            for line in BufReader::new(stdout).lines().flatten() {
                if let Some(cb)=&on { cb(VcsEvent::Progress{ phase:"git", detail: line }); }
            }
        }
        let status = child.wait().map_err(VcsError::Io)?;
        if status.success() { Ok(()) } else { Err(VcsError::Backend{ backend: BackendId::GitSystem, msg: format!("git exited with {status}") }) }
    }
}

impl Vcs for GitSystem {
    fn id(&self) -> BackendId { BackendId::GitSystem }
    fn caps(&self) -> Capabilities { Capabilities { commits:true, branches:true, tags:true, staging:true, push_pull:true, fast_forward:true } }

    fn open(path: &Path) -> Result<Self> {
        let top = Self::run_git_capture(None, ["-C", Self::path_str(path)?, "rev-parse", "--show-toplevel"])?;
        Ok(Self { workdir: PathBuf::from(top.trim()) })
    }
    fn clone(url: &str, dest: &Path, on: Option<OnEvent>) -> Result<Self> {
        Self::run_git_streaming(Path::new("."), ["clone", "--progress", url, Self::path_str(dest)?], on)?;
        Self::open(dest)
    }
    fn workdir(&self) -> &Path { &self.workdir }

    fn current_branch(&self) -> Result<Option<String>> {
        let out = Self::run_git_capture(Some(&self.workdir), ["rev-parse", "--abbrev-ref", "HEAD"])?;
        let s = out.trim(); Ok(if s=="HEAD" { None } else { Some(s.to_string()) })
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
        if remotes.lines().any(|r| r.trim()==name) {
            Self::run_git(Some(&self.workdir), ["remote","set-url",name,url])
        } else {
            Self::run_git(Some(&self.workdir), ["remote","add",name,url])
        }
    }
    fn fetch(&self, remote: &str, refspec: &str, on: Option<OnEvent>) -> Result<()> {
        Self::run_git_streaming(&self.workdir, ["fetch", "--progress", remote, refspec], on)
    }
    fn push(&self, remote: &str, refspec: &str, on: Option<OnEvent>) -> Result<()> {
        Self::run_git_streaming(&self.workdir, ["push", "--progress", remote, refspec], on)
    }
    fn commit(&self, message: &str, name: &str, email: &str, paths: &[PathBuf]) -> Result<String> {
        Self::run_git(Some(&self.workdir), ["config","user.name",name])?;
        Self::run_git(Some(&self.workdir), ["config","user.email",email])?;
        if paths.is_empty() { Self::run_git(Some(&self.workdir), ["add","-A"])?; }
        else {
            let mut args = vec!["add".to_string()];
            for p in paths { args.push(Self::path_str(p)?.to_string()); }
            Self::run_git(Some(&self.workdir), args)?;
        }
        Self::run_git(Some(&self.workdir), ["commit","-m",message,"--no-edit"])?;
        let sha = Self::run_git_capture(Some(&self.workdir), ["rev-parse","HEAD"])?;
        Ok(sha.trim().to_string())
    }
    fn status_summary(&self) -> Result<StatusSummary> {
        let out = Self::run_git_capture(Some(&self.workdir), ["status","--porcelain=v2"])?;
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
            } else if line.starts_with("u ") { s.conflicted += 1; }
        }
        Ok(s)
    }
    fn hard_reset_head(&self) -> Result<()> {
        Self::run_git(Some(&self.workdir), ["reset","--hard","HEAD"])
    }
}
