// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later
use crate::plugin_runtime::spawn::SpawnConfig;
use openvcs_core::app_api::PluginError;
use serde_json::Value;
use std::collections::HashSet;
use std::ffi::OsString;
use std::fs;
use std::io::Write;
use std::path::{Component, Path, PathBuf};
use std::process::{Command, Stdio};

// Whitelisted environment variables that are forwarded to child Git processes.
const SANITIZED_ENV_KEYS: &[&str] = &[
    "HOME",
    "USER",
    "USERPROFILE",
    "TMPDIR",
    "TEMP",
    "TMP",
    "LANG",
    "LC_ALL",
    "SSH_AUTH_SOCK",
    "SSH_AGENT_PID",
    "GIT_SSH_COMMAND",
    "OPENVCS_SSH_MODE",
    "OPENVCS_SSH",
];

#[cfg(unix)]
const DEFAULT_PATH_UNIX: &str = "/usr/bin:/bin";
#[cfg(windows)]
const DEFAULT_PATH_WINDOWS_SUFFIX: &str = "\\System32";

fn runtime_container_kind() -> &'static str {
    if matches!(
        std::env::var("OPENVCS_FLATPAK").as_deref(),
        Ok("1") | Ok("true") | Ok("yes") | Ok("on")
    ) {
        "flatpak"
    } else if std::env::var_os("APPIMAGE").is_some() || std::env::var_os("APPDIR").is_some() {
        "appimage"
    } else {
        "native"
    }
}

fn approved_caps_and_workspace(spawn: &SpawnConfig) -> (HashSet<String>, Option<PathBuf>) {
    let approved_caps = match &spawn.approval {
        crate::plugin_bundles::ApprovalState::Approved { capabilities, .. } => {
            capabilities.iter().cloned().collect::<HashSet<_>>()
        }
        _ => HashSet::new(),
    };
    (approved_caps, spawn.allowed_workspace_root.clone())
}

pub(crate) type HostResult<T> = Result<T, PluginError>;

/// Host-side result for `process-exec-git` mapped into WIT bindings by runtime glue.
pub(crate) struct HostProcessExecOutput {
    pub success: bool,
    pub status: i32,
    pub stdout: String,
    pub stderr: String,
}

fn host_error(code: &str, message: impl Into<String>) -> PluginError {
    PluginError {
        code: code.to_string(),
        message: message.into(),
    }
}

fn resolve_under_root(root: &Path, path: &str) -> Result<PathBuf, String> {
    if path.contains('\0') {
        return Err("path contains NUL".to_string());
    }

    let p = Path::new(path);
    if p.is_absolute() {
        let root = root
            .canonicalize()
            .map_err(|e| format!("canonicalize root {}: {e}", root.display()))?;
        let p = p
            .canonicalize()
            .map_err(|e| format!("canonicalize path {}: {e}", p.display()))?;
        if p.starts_with(&root) {
            return Ok(p);
        }
        return Err("path escapes workspace root".to_string());
    }

    let mut clean = PathBuf::new();
    for comp in p.components() {
        match comp {
            Component::Normal(c) => clean.push(c),
            Component::CurDir => {}
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => {
                return Err("path must be relative and not contain '..'".to_string())
            }
        }
    }
    Ok(root.join(clean))
}

fn write_file_under_root(root: &Path, rel: &str, bytes: &[u8]) -> Result<(), String> {
    let path = resolve_under_root(root, rel)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("create {}: {e}", parent.display()))?;
    }
    fs::write(&path, bytes).map_err(|e| format!("write {}: {e}", path.display()))
}

fn read_file_under_root(root: &Path, rel: &str) -> Result<Vec<u8>, String> {
    let path = resolve_under_root(root, rel)?;
    fs::read(&path).map_err(|e| format!("read {}: {e}", path.display()))
}

fn sanitized_env() -> Vec<(OsString, OsString)> {
    let mut out: Vec<(OsString, OsString)> = Vec::new();

    for &k in SANITIZED_ENV_KEYS {
        if let Ok(v) = std::env::var(k) {
            out.push((k.into(), v.into()));
        }
    }

    #[cfg(unix)]
    {
        out.push(("PATH".into(), DEFAULT_PATH_UNIX.into()));
    }
    #[cfg(windows)]
    {
        if let Ok(sysroot) = std::env::var("SystemRoot") {
            out.push((
                "PATH".into(),
                format!("{sysroot}{}", DEFAULT_PATH_WINDOWS_SUFFIX).into(),
            ));
        }
    }

    out
}

pub fn host_runtime_info() -> openvcs_core::RuntimeInfo {
    openvcs_core::RuntimeInfo {
        os: Some(std::env::consts::OS.to_string()),
        arch: Some(std::env::consts::ARCH.to_string()),
        container: Some(runtime_container_kind().to_string()),
    }
}

pub fn host_subscribe_event(spawn: &SpawnConfig, event_name: &str) -> HostResult<()> {
    let name = event_name.trim();
    if name.is_empty() {
        return Err(host_error("host.invalid_event_name", "event name is empty"));
    }
    crate::plugin_runtime::events::subscribe(&spawn.plugin_id, name);
    Ok(())
}

pub fn host_emit_event(spawn: &SpawnConfig, event_name: &str, payload: &[u8]) -> HostResult<()> {
    let name = event_name.trim();
    if name.is_empty() {
        return Err(host_error("host.invalid_event_name", "event name is empty"));
    }
    let payload_json = if payload.is_empty() {
        Value::Null
    } else {
        serde_json::from_slice(payload).map_err(|err| {
            host_error(
                "host.invalid_payload",
                format!("payload is not valid JSON: {err}"),
            )
        })?
    };
    crate::plugin_runtime::events::emit_from_plugin(&spawn.plugin_id, name, payload_json);
    Ok(())
}

pub fn host_ui_notify(spawn: &SpawnConfig, message: &str) -> HostResult<()> {
    let (caps, _) = approved_caps_and_workspace(spawn);
    if !caps.contains("ui.notifications") {
        return Err(host_error(
            "capability.denied",
            "missing capability: ui.notifications",
        ));
    }
    let message = message.trim();
    if !message.is_empty() {
        log::info!("plugin[{}] notify: {}", spawn.plugin_id, message);
    }
    Ok(())
}

pub fn host_workspace_read_file(spawn: &SpawnConfig, path: &str) -> HostResult<Vec<u8>> {
    let (caps, workspace_root) = approved_caps_and_workspace(spawn);
    if !caps.contains("workspace.read") && !caps.contains("workspace.write") {
        return Err(host_error(
            "capability.denied",
            "missing capability: workspace.read (or workspace.write)",
        ));
    }
    let Some(root) = workspace_root.as_ref() else {
        return Err(host_error("workspace.denied", "no workspace context"));
    };
    read_file_under_root(root, path).map_err(|err| host_error("workspace.error", err))
}

pub fn host_workspace_write_file(
    spawn: &SpawnConfig,
    path: &str,
    content: &[u8],
) -> HostResult<()> {
    let (caps, workspace_root) = approved_caps_and_workspace(spawn);
    if !caps.contains("workspace.write") {
        return Err(host_error(
            "capability.denied",
            "missing capability: workspace.write",
        ));
    }
    let Some(root) = workspace_root.as_ref() else {
        return Err(host_error("workspace.denied", "no workspace context"));
    };
    write_file_under_root(root, path, content).map_err(|err| host_error("workspace.error", err))
}

pub fn host_process_exec_git(
    spawn: &SpawnConfig,
    cwd: Option<&str>,
    args: &[String],
    env: &[(String, String)],
    stdin: Option<&str>,
) -> HostResult<HostProcessExecOutput> {
    let (caps, workspace_root) = approved_caps_and_workspace(spawn);
    if !caps.contains("process.exec") {
        return Err(host_error(
            "capability.denied",
            "missing capability: process.exec",
        ));
    }

    let cwd = match cwd {
        None => workspace_root,
        Some(raw) if raw.trim().is_empty() => workspace_root,
        Some(raw) => {
            let Some(root) = spawn.allowed_workspace_root.as_ref() else {
                return Err(host_error("workspace.denied", "no workspace context"));
            };
            Some(resolve_under_root(root, raw).map_err(|e| host_error("workspace.denied", e))?)
        }
    };

    let mut cmd = Command::new("git");
    if let Some(cwd) = cwd.as_ref() {
        cmd.current_dir(cwd);
    }
    cmd.args(args);
    cmd.env_clear();
    for (k, v) in sanitized_env() {
        cmd.env(k, v);
    }
    for (k, v) in env {
        if matches!(k.as_str(), "GIT_SSH_COMMAND" | "GIT_TERMINAL_PROMPT") {
            cmd.env(k, v);
        }
    }

    let stdin_text = stdin.unwrap_or_default();
    let out = if stdin_text.is_empty() {
        cmd.output()
            .map_err(|e| host_error("process.error", format!("spawn git: {e}")))?
    } else {
        cmd.stdin(Stdio::piped());
        let mut child = cmd
            .spawn()
            .map_err(|e| host_error("process.error", format!("spawn git: {e}")))?;
        if let Some(mut child_stdin) = child.stdin.take() {
            if let Err(e) = child_stdin.write_all(stdin_text.as_bytes()) {
                let _ = child.kill();
                return Err(host_error("process.error", format!("write stdin: {e}")));
            }
        }
        child
            .wait_with_output()
            .map_err(|e| host_error("process.error", format!("wait: {e}")))?
    };

    Ok(HostProcessExecOutput {
        success: out.status.success(),
        status: out.status.code().unwrap_or(-1),
        stdout: String::from_utf8_lossy(&out.stdout).to_string(),
        stderr: String::from_utf8_lossy(&out.stderr).to_string(),
    })
}
