use std::{fs, path::PathBuf, process::Command};

use tauri::command;

fn known_hosts_path() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or_else(|| "Could not determine home directory".to_string())?;
    Ok(home.join(".ssh").join("known_hosts"))
}

fn ensure_ssh_dir() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or_else(|| "Could not determine home directory".to_string())?;
    let dir = home.join(".ssh");
    fs::create_dir_all(&dir).map_err(|e| format!("Failed to create ~/.ssh: {e}"))?;
    Ok(dir)
}

#[cfg(not(target_os = "windows"))]
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
fn keyscan(_host: &str) -> Result<String, String> {
    Err("SSH host key scanning is not implemented for Windows yet".to_string())
}

#[command]
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

