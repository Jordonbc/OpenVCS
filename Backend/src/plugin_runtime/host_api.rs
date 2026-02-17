// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later
use crate::logging::LogTimer;
use crate::plugin_runtime::spawn::SpawnConfig;
use log::{debug, error, info, trace, warn};
use openvcs_core::app_api::PluginError;
use serde_json::Value;
use std::collections::HashSet;
use std::ffi::OsString;
use std::fs;
use std::io::Write;
use std::path::{Component, Path, PathBuf};
use std::process::{Command, Stdio};

const MODULE: &str = "host_api";

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

/// Detects the runtime container kind for diagnostics.
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

/// Extracts approved capabilities and optional workspace root from spawn config.
fn approved_caps_and_workspace(spawn: &SpawnConfig) -> (HashSet<String>, Option<PathBuf>) {
    let approved_caps = match &spawn.approval {
        crate::plugin_bundles::ApprovalState::Approved { capabilities, .. } => {
            capabilities.iter().cloned().collect::<HashSet<_>>()
        }
        _ => HashSet::new(),
    };
    (approved_caps, spawn.allowed_workspace_root.clone())
}

/// Host API result type alias for plugin-facing operations.
pub(crate) type HostResult<T> = Result<T, PluginError>;

/// Host-side result for `process-exec-git` mapped into WIT bindings by runtime glue.
pub(crate) struct HostProcessExecOutput {
    /// Whether the process exited successfully.
    pub success: bool,
    /// Numeric process exit status code.
    pub status: i32,
    /// Captured standard output text.
    pub stdout: String,
    /// Captured standard error text.
    pub stderr: String,
}

/// Creates a structured plugin host error.
fn host_error(code: &str, message: impl Into<String>) -> PluginError {
    PluginError {
        code: code.to_string(),
        message: message.into(),
    }
}

/// Resolves a plugin-supplied path under an allowed workspace root.
fn resolve_under_root(root: &Path, path: &str) -> Result<PathBuf, String> {
    trace!(
        "[{}] resolve_under_root: root={}, path={}",
        MODULE,
        root.display(),
        path
    );
    if path.contains('\0') {
        warn!("[{}] resolve_under_root: path contains NUL", MODULE);
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
            trace!(
                "[{}] resolve_under_root: resolved absolute path within root",
                MODULE
            );
            return Ok(p);
        }
        warn!(
            "[{}] resolve_under_root: path escapes workspace root",
            MODULE
        );
        return Err("path escapes workspace root".to_string());
    }

    let mut clean = PathBuf::new();
    for comp in p.components() {
        match comp {
            Component::Normal(c) => clean.push(c),
            Component::CurDir => {}
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => {
                warn!(
                    "[{}] resolve_under_root: invalid path component in '{}'",
                    MODULE, path
                );
                return Err("path must be relative and not contain '..'".to_string());
            }
        }
    }
    let resolved = root.join(clean);
    trace!(
        "[{}] resolve_under_root: resolved to {}",
        MODULE,
        resolved.display()
    );
    Ok(resolved)
}

/// Writes bytes to a relative path constrained to the workspace root.
fn write_file_under_root(root: &Path, rel: &str, bytes: &[u8]) -> Result<(), String> {
    trace!(
        "[{}] write_file_under_root: root={}, rel={}, len={}",
        MODULE,
        root.display(),
        rel,
        bytes.len()
    );
    let path = resolve_under_root(root, rel)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("create {}: {e}", parent.display()))?;
    }
    fs::write(&path, bytes).map_err(|e| {
        error!(
            "[{}] write_file_under_root: failed to write {}: {}",
            MODULE,
            path.display(),
            e
        );
        format!("write {}: {e}", path.display())
    })
}

/// Reads bytes from a relative path constrained to the workspace root.
fn read_file_under_root(root: &Path, rel: &str) -> Result<Vec<u8>, String> {
    trace!(
        "[{}] read_file_under_root: root={}, rel={}",
        MODULE,
        root.display(),
        rel
    );
    let path = resolve_under_root(root, rel)?;
    let result = fs::read(&path).map_err(|e| {
        error!(
            "[{}] read_file_under_root: failed to read {}: {}",
            MODULE,
            path.display(),
            e
        );
        format!("read {}: {e}", path.display())
    })?;
    debug!(
        "[{}] read_file_under_root: read {} bytes from {}",
        MODULE,
        result.len(),
        rel
    );
    Ok(result)
}

/// Builds a sanitized child-process environment for Git execution.
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

/// Returns runtime metadata exposed to plugins.
pub fn host_runtime_info() -> openvcs_core::RuntimeInfo {
    trace!("[{}] host_runtime_info: gathering runtime info", MODULE);
    let kind = runtime_container_kind();
    let info = openvcs_core::RuntimeInfo {
        os: Some(std::env::consts::OS.to_string()),
        arch: Some(std::env::consts::ARCH.to_string()),
        container: Some(kind.to_string()),
    };
    debug!(
        "[{}] host_runtime_info: os={}, arch={}, container={}",
        MODULE,
        info.os.as_deref().unwrap_or("unknown"),
        info.arch.as_deref().unwrap_or("unknown"),
        kind
    );
    info
}

/// Registers a plugin subscription for a named host event.
pub fn host_subscribe_event(spawn: &SpawnConfig, event_name: &str) -> HostResult<()> {
    let _timer = LogTimer::new(MODULE, "host_subscribe_event");
    let name = event_name.trim();
    trace!(
        "[{}] host_subscribe_event: plugin={}, event='{}'",
        MODULE,
        spawn.plugin_id,
        name
    );

    if name.is_empty() {
        warn!(
            "[{}] host_subscribe_event: empty event name from plugin {}",
            MODULE, spawn.plugin_id
        );
        return Err(host_error("host.invalid_event_name", "event name is empty"));
    }

    crate::plugin_runtime::events::subscribe(&spawn.plugin_id, name);
    debug!(
        "[{}] host_subscribe_event: plugin {} subscribed to '{}'",
        MODULE, spawn.plugin_id, name
    );
    Ok(())
}

/// Emits a plugin-originated event with JSON payload validation.
pub fn host_emit_event(spawn: &SpawnConfig, event_name: &str, payload: &[u8]) -> HostResult<()> {
    let _timer = LogTimer::new(MODULE, "host_emit_event");
    let name = event_name.trim();
    trace!(
        "[{}] host_emit_event: plugin={}, event='{}', payload_len={}",
        MODULE,
        spawn.plugin_id,
        name,
        payload.len()
    );

    if name.is_empty() {
        warn!(
            "[{}] host_emit_event: empty event name from plugin {}",
            MODULE, spawn.plugin_id
        );
        return Err(host_error("host.invalid_event_name", "event name is empty"));
    }

    let payload_json = if payload.is_empty() {
        Value::Null
    } else {
        serde_json::from_slice(payload).map_err(|err| {
            error!(
                "[{}] host_emit_event: invalid JSON payload from plugin {}: {}",
                MODULE, spawn.plugin_id, err
            );
            host_error(
                "host.invalid_payload",
                format!("payload is not valid JSON: {err}"),
            )
        })?
    };

    crate::plugin_runtime::events::emit_from_plugin(&spawn.plugin_id, name, payload_json);
    debug!(
        "[{}] host_emit_event: plugin {} emitted '{}'",
        MODULE, spawn.plugin_id, name
    );
    Ok(())
}

/// Handles plugin notification requests gated by `ui.notifications` capability.
pub fn host_ui_notify(spawn: &SpawnConfig, message: &str) -> HostResult<()> {
    let (caps, _) = approved_caps_and_workspace(spawn);
    trace!(
        "[{}] host_ui_notify: plugin={}, message_len={}",
        MODULE,
        spawn.plugin_id,
        message.len()
    );

    if !caps.contains("ui.notifications") {
        warn!(
            "[{}] host_ui_notify: capability denied for plugin {} (missing ui.notifications)",
            MODULE, spawn.plugin_id
        );
        return Err(host_error(
            "capability.denied",
            "missing capability: ui.notifications",
        ));
    }

    let message = message.trim();
    if !message.is_empty() {
        info!(
            "[{}] host_ui_notify: plugin[{}] notify: {}",
            MODULE, spawn.plugin_id, message
        );
    }
    Ok(())
}

/// Reads a workspace file when the plugin has workspace read access.
pub fn host_workspace_read_file(spawn: &SpawnConfig, path: &str) -> HostResult<Vec<u8>> {
    let _timer = LogTimer::new(MODULE, "host_workspace_read_file");
    trace!(
        "[{}] host_workspace_read_file: plugin={}, path='{}'",
        MODULE,
        spawn.plugin_id,
        path
    );

    let (caps, workspace_root) = approved_caps_and_workspace(spawn);

    if !caps.contains("workspace.read") && !caps.contains("workspace.write") {
        warn!(
            "[{}] host_workspace_read_file: capability denied for plugin {} (missing workspace.read)",
            MODULE, spawn.plugin_id
        );
        return Err(host_error(
            "capability.denied",
            "missing capability: workspace.read (or workspace.write)",
        ));
    }

    let Some(root) = workspace_root.as_ref() else {
        warn!(
            "[{}] host_workspace_read_file: no workspace context for plugin {}",
            MODULE, spawn.plugin_id
        );
        return Err(host_error("workspace.denied", "no workspace context"));
    };

    let result = read_file_under_root(root, path).map_err(|err| {
        error!(
            "[{}] host_workspace_read_file: failed for plugin {}: {}",
            MODULE, spawn.plugin_id, err
        );
        host_error("workspace.error", err)
    })?;

    debug!(
        "[{}] host_workspace_read_file: plugin {} read {} bytes from '{}'",
        MODULE,
        spawn.plugin_id,
        result.len(),
        path
    );
    Ok(result)
}

/// Writes a workspace file when the plugin has workspace write access.
pub fn host_workspace_write_file(
    spawn: &SpawnConfig,
    path: &str,
    content: &[u8],
) -> HostResult<()> {
    let _timer = LogTimer::new(MODULE, "host_workspace_write_file");
    trace!(
        "[{}] host_workspace_write_file: plugin={}, path='{}', len={}",
        MODULE,
        spawn.plugin_id,
        path,
        content.len()
    );

    let (caps, workspace_root) = approved_caps_and_workspace(spawn);

    if !caps.contains("workspace.write") {
        warn!(
            "[{}] host_workspace_write_file: capability denied for plugin {} (missing workspace.write)",
            MODULE, spawn.plugin_id
        );
        return Err(host_error(
            "capability.denied",
            "missing capability: workspace.write",
        ));
    }

    let Some(root) = workspace_root.as_ref() else {
        warn!(
            "[{}] host_workspace_write_file: no workspace context for plugin {}",
            MODULE, spawn.plugin_id
        );
        return Err(host_error("workspace.denied", "no workspace context"));
    };

    write_file_under_root(root, path, content).map_err(|err| {
        error!(
            "[{}] host_workspace_write_file: failed for plugin {}: {}",
            MODULE, spawn.plugin_id, err
        );
        host_error("workspace.error", err)
    })?;

    debug!(
        "[{}] host_workspace_write_file: plugin {} wrote {} bytes to '{}'",
        MODULE,
        spawn.plugin_id,
        content.len(),
        path
    );
    Ok(())
}

/// Executes `git` with sanitized environment and capability checks.
pub fn host_process_exec_git(
    spawn: &SpawnConfig,
    cwd: Option<&str>,
    args: &[String],
    env: &[(String, String)],
    stdin: Option<&str>,
) -> HostResult<HostProcessExecOutput> {
    let _timer = LogTimer::new(MODULE, "host_process_exec_git");
    info!(
        "[{}] host_process_exec_git: plugin={}, args={:?}",
        MODULE, spawn.plugin_id, args
    );
    debug!(
        "[{}] host_process_exec_git: cwd={:?}, env_count={}, has_stdin={}",
        MODULE,
        cwd,
        env.len(),
        stdin.is_some()
    );
    trace!(
        "[{}] host_process_exec_git: env={:?}, stdin_len={}",
        MODULE,
        env,
        stdin.map(|s| s.len()).unwrap_or(0)
    );

    let (caps, workspace_root) = approved_caps_and_workspace(spawn);

    if !caps.contains("process.exec") {
        warn!(
            "[{}] host_process_exec_git: capability denied for plugin {} (missing process.exec)",
            MODULE, spawn.plugin_id
        );
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
                warn!(
                    "[{}] host_process_exec_git: no workspace context for plugin {}",
                    MODULE, spawn.plugin_id
                );
                return Err(host_error("workspace.denied", "no workspace context"));
            };
            Some(resolve_under_root(root, raw).map_err(|e| {
                warn!(
                    "[{}] host_process_exec_git: invalid cwd for plugin {}: {}",
                    MODULE, spawn.plugin_id, e
                );
                host_error("workspace.denied", e)
            })?)
        }
    };

    debug!(
        "[{}] host_process_exec_git: executing git with cwd={:?}",
        MODULE,
        cwd.as_ref().map(|p| p.display())
    );

    let start = std::time::Instant::now();

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
        cmd.output().map_err(|e| {
            error!(
                "[{}] host_process_exec_git: failed to spawn git: {}",
                MODULE, e
            );
            host_error("process.error", format!("spawn git: {e}"))
        })?
    } else {
        cmd.stdin(Stdio::piped());
        let mut child = cmd.spawn().map_err(|e| {
            error!(
                "[{}] host_process_exec_git: failed to spawn git: {}",
                MODULE, e
            );
            host_error("process.error", format!("spawn git: {e}"))
        })?;
        if let Some(mut child_stdin) = child.stdin.take() {
            if let Err(e) = child_stdin.write_all(stdin_text.as_bytes()) {
                let _ = child.kill();
                error!(
                    "[{}] host_process_exec_git: failed to write stdin: {}",
                    MODULE, e
                );
                return Err(host_error("process.error", format!("write stdin: {e}")));
            }
        }
        child.wait_with_output().map_err(|e| {
            error!(
                "[{}] host_process_exec_git: failed to wait for process: {}",
                MODULE, e
            );
            host_error("process.error", format!("wait: {e}"))
        })?
    };

    let elapsed = start.elapsed();
    let result = HostProcessExecOutput {
        success: out.status.success(),
        status: out.status.code().unwrap_or(-1),
        stdout: String::from_utf8_lossy(&out.stdout).to_string(),
        stderr: String::from_utf8_lossy(&out.stderr).to_string(),
    };

    if result.success {
        debug!(
            "[{}] host_process_exec_git: git {:?} succeeded in {:?} (code={})",
            MODULE,
            args.first(),
            elapsed,
            result.status
        );
        trace!(
            "[{}] host_process_exec_git: stdout_len={}, stderr_len={}",
            MODULE,
            result.stdout.len(),
            result.stderr.len()
        );
    } else {
        warn!(
            "[{}] host_process_exec_git: git {:?} failed in {:?} (code={}): {}",
            MODULE,
            args.first(),
            elapsed,
            result.status,
            result.stderr.lines().next().unwrap_or("")
        );
    }

    Ok(result)
}
