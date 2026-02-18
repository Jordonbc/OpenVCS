// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later
use std::{fs, path::PathBuf, process::Command};

use log::{debug, error, info, trace, warn};
use serde::Serialize;
use tauri::command;


/// Returns `~/.ssh/known_hosts` path.
///
/// # Returns
/// - `Ok(PathBuf)` known-hosts path.
/// - `Err(String)` when home directory cannot be resolved.
fn known_hosts_path() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or_else(|| {
        error!(
            "known_hosts_path: could not determine home directory",
        );
        "Could not determine home directory".to_string()
    })?;
    let path = home.join(".ssh").join("known_hosts");
    trace!("known_hosts_path: {}", path.display());
    Ok(path)
}

/// Returns `~/.ssh` directory path.
///
/// # Returns
/// - `Ok(PathBuf)` ssh directory path.
/// - `Err(String)` when home directory cannot be resolved.
fn ssh_dir_path() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or_else(|| {
        error!(
            "ssh_dir_path: could not determine home directory",
        );
        "Could not determine home directory".to_string()
    })?;
    let path = home.join(".ssh");
    trace!("ssh_dir_path: {}", path.display());
    Ok(path)
}

/// Ensures `~/.ssh` directory exists.
///
/// # Returns
/// - `Ok(PathBuf)` created/existing ssh directory path.
/// - `Err(String)` on resolution or create failure.
fn ensure_ssh_dir() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or_else(|| {
        error!(
            "ensure_ssh_dir: could not determine home directory",
        );
        "Could not determine home directory".to_string()
    })?;
    let dir = home.join(".ssh");
    fs::create_dir_all(&dir).map_err(|e| {
        error!(
            "ensure_ssh_dir: failed to create {}: {}",
            dir.display(),
            e
        );
        format!("Failed to create ~/.ssh: {e}")
    })?;
    debug!(
        "ensure_ssh_dir: ssh directory ready at {}",
        dir.display()
    );
    Ok(dir)
}

#[derive(Clone, Serialize)]
/// Process output captured from SSH-related shell commands.
pub struct SshCommandOutput {
    /// Process exit code, or `-1` when unavailable.
    pub code: i32,
    /// UTF-8-decoded standard output.
    pub stdout: String,
    /// UTF-8-decoded standard error.
    pub stderr: String,
}

/// Runs a command and captures exit code/stdout/stderr.
///
/// # Parameters
/// - `cmd`: Executable name.
/// - `args`: Argument list.
///
/// # Returns
/// - `Ok(SshCommandOutput)` command output.
/// - `Err(String)` on spawn failure.
fn run_command(cmd: &str, args: &[&str]) -> Result<SshCommandOutput, String> {
    trace!("run_command: {} {:?}", cmd, args);
    let start = std::time::Instant::now();

    let out = Command::new(cmd).args(args).output().map_err(|e| {
        error!("run_command: failed to spawn {}: {}", cmd, e);
        format!("Failed to run {cmd}: {e}")
    })?;

    let elapsed = start.elapsed();
    let result = SshCommandOutput {
        code: out.status.code().unwrap_or(-1),
        stdout: String::from_utf8_lossy(&out.stdout).trim().to_string(),
        stderr: String::from_utf8_lossy(&out.stderr).trim().to_string(),
    };

    if out.status.success() {
        debug!(
            "run_command: {} succeeded in {:?} (code={})", cmd, elapsed, result.code
        );
        trace!("run_command: stdout='{}'", result.stdout);
    } else {
        warn!(
            "run_command: {} failed in {:?} (code={}): {}", cmd, elapsed, result.code, result.stderr
        );
    }

    Ok(result)
}

#[cfg(not(target_os = "windows"))]
/// Scans SSH host keys using `ssh-keyscan`.
///
/// # Parameters
/// - `host`: Hostname to scan.
///
/// # Returns
/// - `Ok(String)` scanned key lines.
/// - `Err(String)` on command failure.
fn keyscan(host: &str) -> Result<String, String> {
    trace!("keyscan: scanning host '{}'", host);
    let start = std::time::Instant::now();

    let out = Command::new("ssh-keyscan")
        .arg("-H")
        .arg(host)
        .output()
        .map_err(|e| {
            error!("keyscan: failed to run ssh-keyscan: {}", e);
            format!("Failed to run ssh-keyscan: {e}")
        })?;

    let elapsed = start.elapsed();

    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr).trim().to_string();
        error!(
            "keyscan: failed for '{}' in {:?}: {}", host, elapsed, err
        );
        return Err(if err.is_empty() {
            format!("ssh-keyscan exited with {}", out.status)
        } else {
            err
        });
    }

    let s = String::from_utf8_lossy(&out.stdout).to_string();
    let s = s.trim().to_string();
    if s.is_empty() {
        warn!("keyscan: no host keys returned for '{}'", host);
        return Err("ssh-keyscan returned no host keys".to_string());
    }

    debug!(
        "keyscan: got keys for '{}' in {:?}", host, elapsed
    );
    trace!(
        "keyscan: keys='{}'",
        s.lines().take(3).collect::<Vec<_>>().join("\\n")
    );
    Ok(s)
}

#[cfg(target_os = "windows")]
/// Windows placeholder for host-key scan support.
///
/// # Parameters
/// - `_host`: Ignored hostname.
///
/// # Returns
/// - Always `Err(String)` until implemented.
fn keyscan(_host: &str) -> Result<String, String> {
    warn!("keyscan: not implemented for Windows");
    Err("SSH host key scanning is not implemented for Windows yet".to_string())
}

#[command]
/// Scans and appends a host key entry to `~/.ssh/known_hosts`.
///
/// # Parameters
/// - `host`: Hostname to trust.
///
/// # Returns
/// - `Ok(())` when the host key is already present or appended successfully.
/// - `Err(String)` when validation, scanning, or file write fails.
pub fn ssh_trust_host(host: String) -> Result<(), String> {
    let host = host.trim();
    let start = std::time::Instant::now();
    info!("ssh_trust_host: host='{}'", host);

    if host.is_empty() {
        warn!("ssh_trust_host: empty host provided");
        return Err("Host cannot be empty".to_string());
    }

    ensure_ssh_dir()?;
    let known_hosts = known_hosts_path()?;
    debug!(
        "ssh_trust_host: known_hosts path={}",
        known_hosts.display()
    );

    // Avoid duplicating entries if the host is already present.
    if let Ok(existing) = fs::read_to_string(&known_hosts) {
        if existing.lines().any(|l| l.contains(host)) {
            debug!(
                "ssh_trust_host: host '{}' already in known_hosts", host
            );
            return Ok(());
        }
    }

    let scanned = keyscan(host)?;
    let mut to_append = String::new();
    to_append.push_str(&scanned);
    to_append.push('\n');

    fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&known_hosts)
        .and_then(|mut f| std::io::Write::write_all(&mut f, to_append.as_bytes()))
        .map_err(|e| {
            error!(
                "ssh_trust_host: failed to update {}: {}",
                known_hosts.display(),
                e
            );
            format!("Failed to update {}: {e}", known_hosts.display())
        })?;

    let elapsed = start.elapsed();
    info!(
        "ssh_trust_host: host '{}' trusted in {:?}", host, elapsed
    );
    Ok(())
}

#[command]
/// Lists identities currently loaded in the active SSH agent.
///
/// # Returns
/// - `Ok(SshCommandOutput)` with command exit/status output.
/// - `Err(String)` when command execution fails.
pub fn ssh_agent_list_keys() -> Result<SshCommandOutput, String> {
    info!("ssh_agent_list_keys: listing SSH agent keys");
    let result = run_command("ssh-add", &["-l"])?;

    match result.code {
        0 => {
            debug!(
                "ssh_agent_list_keys: agent has {} keys",
                result.stdout.lines().count()
            );
        }
        1 => {
            warn!("ssh_agent_list_keys: agent has no identities");
        }
        code => {
            warn!(
                "ssh_agent_list_keys: agent returned code {}", code
            );
        }
    }

    Ok(result)
}

#[derive(Clone, Serialize)]
/// Candidate private-key file discovered in `~/.ssh`.
pub struct SshKeyCandidate {
    /// Absolute path to the candidate key file.
    pub path: String,
    /// File name shown in the UI.
    pub name: String,
}

#[command]
/// Lists candidate private key files from `~/.ssh`.
///
/// # Returns
/// - `Ok(Vec<SshKeyCandidate>)` sorted candidate list.
/// - `Err(String)` when home/ssh directory resolution fails.
pub fn ssh_key_candidates() -> Result<Vec<SshKeyCandidate>, String> {
    info!(
        "ssh_key_candidates: scanning for SSH key candidates",
    );
    let dir = ssh_dir_path()?;

    let Ok(read_dir) = fs::read_dir(&dir) else {
        debug!(
            "ssh_key_candidates: ssh directory does not exist or is not readable",
        );
        return Ok(vec![]);
    };

    let mut keys = vec![];
    for entry in read_dir.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let Some(name) = path.file_name().and_then(|s| s.to_str()) else {
            continue;
        };

        // Heuristic: include common private key names and exclude obvious non-keys.
        if name.ends_with(".pub")
            || name == "known_hosts"
            || name == "config"
            || name.ends_with(".log")
            || name.ends_with(".old")
        {
            trace!(
                "ssh_key_candidates: skipping non-key file: {}",
                name
            );
            continue;
        }

        let looks_like_private_key = name == "id_ed25519"
            || name == "id_rsa"
            || name == "id_ecdsa"
            || name == "id_dsa"
            || name.ends_with(".pem")
            || name.ends_with(".key");

        if !looks_like_private_key {
            continue;
        }

        trace!("ssh_key_candidates: found candidate: {}", name);
        keys.push(SshKeyCandidate {
            path: path.display().to_string(),
            name: name.to_string(),
        });
    }

    keys.sort_by(|a, b| a.name.cmp(&b.name));
    debug!(
        "ssh_key_candidates: found {} candidate keys",
        keys.len()
    );
    Ok(keys)
}

#[command]
/// Adds a private key file to the active SSH agent via `ssh-add`.
///
/// # Parameters
/// - `path`: Key file path.
///
/// # Returns
/// - `Ok(SshCommandOutput)` with command result output.
/// - `Err(String)` when validation or command execution fails.
pub fn ssh_add_key(path: String) -> Result<SshCommandOutput, String> {
    let p = path.trim();
    info!("ssh_add_key: path='{}'", p);

    if p.is_empty() {
        warn!("ssh_add_key: empty path provided");
        return Err("Path cannot be empty".to_string());
    }

    let result = run_command("ssh-add", &[p])?;

    if result.code == 0 {
        debug!("ssh_add_key: key added successfully");
    } else {
        warn!(
            "ssh_add_key: failed to add key: {}", result.stderr
        );
    }

    Ok(result)
}
