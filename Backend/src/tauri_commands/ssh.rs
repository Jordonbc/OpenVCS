// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later
use std::{fs, path::PathBuf, process::Command};

use serde::Serialize;
use tauri::command;

/// Returns `~/.ssh/known_hosts` path.
///
/// # Returns
/// - `Ok(PathBuf)` known-hosts path.
/// - `Err(String)` when home directory cannot be resolved.
fn known_hosts_path() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or_else(|| "Could not determine home directory".to_string())?;
    Ok(home.join(".ssh").join("known_hosts"))
}

/// Returns `~/.ssh` directory path.
///
/// # Returns
/// - `Ok(PathBuf)` ssh directory path.
/// - `Err(String)` when home directory cannot be resolved.
fn ssh_dir_path() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or_else(|| "Could not determine home directory".to_string())?;
    Ok(home.join(".ssh"))
}

/// Ensures `~/.ssh` directory exists.
///
/// # Returns
/// - `Ok(PathBuf)` created/existing ssh directory path.
/// - `Err(String)` on resolution or create failure.
fn ensure_ssh_dir() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or_else(|| "Could not determine home directory".to_string())?;
    let dir = home.join(".ssh");
    fs::create_dir_all(&dir).map_err(|e| format!("Failed to create ~/.ssh: {e}"))?;
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
    let out = Command::new(cmd)
        .args(args)
        .output()
        .map_err(|e| format!("Failed to run {cmd}: {e}"))?;

    Ok(SshCommandOutput {
        code: out.status.code().unwrap_or(-1),
        stdout: String::from_utf8_lossy(&out.stdout).trim().to_string(),
        stderr: String::from_utf8_lossy(&out.stderr).trim().to_string(),
    })
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
    let out = Command::new("ssh-keyscan")
        .arg("-H")
        .arg(host)
        .output()
        .map_err(|e| format!("Failed to run ssh-keyscan: {e}"))?;
    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr).trim().to_string();
        return Err(if err.is_empty() {
            format!("ssh-keyscan exited with {}", out.status)
        } else {
            err
        });
    }
    let s = String::from_utf8_lossy(&out.stdout).to_string();
    let s = s.trim().to_string();
    if s.is_empty() {
        return Err("ssh-keyscan returned no host keys".to_string());
    }
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
    if host.is_empty() {
        return Err("Host cannot be empty".to_string());
    }

    ensure_ssh_dir()?;
    let known_hosts = known_hosts_path()?;

    // Avoid duplicating entries if the host is already present.
    if let Ok(existing) = fs::read_to_string(&known_hosts) {
        if existing.lines().any(|l| l.contains(host)) {
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
        .map_err(|e| format!("Failed to update {}: {e}", known_hosts.display()))?;

    Ok(())
}

#[command]
/// Lists identities currently loaded in the active SSH agent.
///
/// # Returns
/// - `Ok(SshCommandOutput)` with command exit/status output.
/// - `Err(String)` when command execution fails.
pub fn ssh_agent_list_keys() -> Result<SshCommandOutput, String> {
    // Exit codes:
    // 0 = keys listed, 1 = agent has no keys, 2 = agent not running/unreachable (platform dependent).
    run_command("ssh-add", &["-l"])
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
    let dir = ssh_dir_path()?;
    let Ok(read_dir) = fs::read_dir(&dir) else {
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

        keys.push(SshKeyCandidate {
            path: path.display().to_string(),
            name: name.to_string(),
        });
    }

    keys.sort_by(|a, b| a.name.cmp(&b.name));
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
    if p.is_empty() {
        return Err("Path cannot be empty".to_string());
    }
    run_command("ssh-add", &[p])
}
