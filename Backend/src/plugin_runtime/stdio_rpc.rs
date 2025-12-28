use crate::plugin_bundles::ApprovalState;
use openvcs_core::models::VcsEvent;
use openvcs_core::plugin_protocol::{PluginMessage, RpcRequest, RpcResponse};
use serde_json::Value;
use std::collections::HashMap;
use std::ffi::OsString;
use std::fs;
use std::io::{self, BufRead, BufReader, LineWriter, Write};
use std::path::{Component, Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

const DEFAULT_TIMEOUT: Duration = Duration::from_secs(60);
const STDERR_LOG_MAX_BYTES: u64 = 10 * 1024 * 1024;
const STDERR_LOG_MAX_FILES: usize = 5;
const MAX_PENDING: usize = 1024;
const MAX_CRASHES: u32 = 5;

#[derive(Debug, Clone)]
pub struct SpawnConfig {
    pub plugin_id: String,
    pub component_label: String,
    pub exec_path: PathBuf,
    pub args: Vec<String>,
    pub workdir: PathBuf,
    pub requested_capabilities: Vec<String>,
    pub approval: ApprovalState,
    pub allowed_workspace_root: Option<PathBuf>,
}

#[derive(Debug, Clone)]
pub struct RpcConfig {
    pub timeout: Duration,
}

impl Default for RpcConfig {
    fn default() -> Self {
        Self {
            timeout: DEFAULT_TIMEOUT,
        }
    }
}

#[derive(Debug)]
pub struct RpcError {
    pub code: String,
    pub message: String,
}

struct PendingMap {
    next_id: u64,
    pending: HashMap<u64, std::sync::mpsc::Sender<RpcResponse>>,
}

pub struct StdioRpcProcess {
    spawn: SpawnConfig,
    cfg: RpcConfig,
    child: Mutex<Option<Child>>,
    stdin: Arc<Mutex<Option<LineWriter<ChildStdin>>>>,
    pending: Arc<Mutex<PendingMap>>,
    on_event: Arc<Mutex<Option<Arc<dyn Fn(VcsEvent) + Send + Sync + 'static>>>>,
    crash_count: Mutex<u32>,
    backoff_ms: Mutex<u64>,
    disabled: Mutex<bool>,
}

impl StdioRpcProcess {
    pub fn new(spawn: SpawnConfig, cfg: RpcConfig) -> Self {
        Self {
            spawn,
            cfg,
            child: Mutex::new(None),
            stdin: Arc::new(Mutex::new(None)),
            pending: Arc::new(Mutex::new(PendingMap {
                next_id: 1,
                pending: HashMap::new(),
            })),
            on_event: Arc::new(Mutex::new(None)),
            crash_count: Mutex::new(0),
            backoff_ms: Mutex::new(250),
            disabled: Mutex::new(false),
        }
    }

    pub fn set_event_sink(&self, sink: Option<Arc<dyn Fn(VcsEvent) + Send + Sync + 'static>>) {
        if let Ok(mut lock) = self.on_event.lock() {
            *lock = sink;
        }
    }

    pub fn ensure_running(&self) -> Result<(), String> {
        if *self.disabled.lock().unwrap() {
            return Err(format!(
                "plugin {} is disabled after repeated crashes",
                self.spawn.plugin_id
            ));
        }

        if self
            .child
            .lock()
            .ok()
            .map(|c| c.is_some())
            .unwrap_or(false)
        {
            return Ok(());
        }

        if !self.spawn.exec_path.is_file() {
            return Err(format!(
                "plugin executable not found: {}",
                self.spawn.exec_path.display()
            ));
        }

        // Exponential backoff between respawns after failures.
        let delay = *self.backoff_ms.lock().unwrap();
        let crashes = *self.crash_count.lock().unwrap();
        if crashes > 0 && delay > 0 {
            std::thread::sleep(Duration::from_millis(delay));
        }

        if !matches!(self.spawn.approval, ApprovalState::Approved { .. })
            && !self.spawn.requested_capabilities.is_empty()
        {
            return Err(format!(
                "plugin {} requires user approval for capabilities before execution",
                self.spawn.plugin_id
            ));
        }

        let mut cmd = Command::new(&self.spawn.exec_path);
        cmd.args(&self.spawn.args)
            .current_dir(&self.spawn.workdir)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        cmd.env_clear();
        for (k, v) in sanitized_env() {
            cmd.env(k, v);
        }
        cmd.env("OPENVCS_PLUGIN_ID", &self.spawn.plugin_id);

        let mut child = cmd
            .spawn()
            .map_err(|e| format!("spawn {}: {e}", self.spawn.exec_path.display()))?;
        let stdin = child.stdin.take().ok_or_else(|| "no stdin".to_string())?;
        let stdout = child.stdout.take().ok_or_else(|| "no stdout".to_string())?;
        let stderr = child.stderr.take().ok_or_else(|| "no stderr".to_string())?;

        let stdin = LineWriter::new(stdin);
        *self.stdin.lock().unwrap() = Some(stdin);

        let pending = Arc::clone(&self.pending);
        let spawn = self.spawn.clone();
        let stdin_for_responses = Arc::clone(&self.stdin);
        let on_event = Arc::clone(&self.on_event);
        let stdout_log_path =
            plugin_stdout_log_path(&self.spawn.plugin_id, &self.spawn.component_label);

        std::thread::spawn(move || {
            read_stdout_loop(
                stdout,
                spawn,
                pending,
                stdin_for_responses,
                on_event,
                stdout_log_path,
            )
        });

        let stderr_path = plugin_stderr_log_path(&self.spawn.plugin_id, &self.spawn.component_label);
        std::thread::spawn(move || read_stderr_loop(stderr, stderr_path));

        *self.child.lock().unwrap() = Some(child);
        Ok(())
    }

    pub fn call(&self, method: &str, params: Value) -> Result<Value, RpcError> {
        if let Err(e) = self.ensure_running() {
            return Err(RpcError {
                code: "plugin.not_ready".into(),
                message: e,
            });
        }

        let (id, rx) = {
            let (tx, rx) = std::sync::mpsc::channel::<RpcResponse>();
            let mut lock = self.pending.lock().unwrap();
            if lock.pending.len() >= MAX_PENDING {
                return Err(RpcError {
                    code: "plugin.busy".into(),
                    message: "too many pending plugin requests".into(),
                });
            }
            let id = lock.next_id;
            lock.next_id = lock.next_id.saturating_add(1);
            lock.pending.insert(id, tx);
            (id, rx)
        };

        let req = RpcRequest {
            id,
            method: method.to_string(),
            params,
        };

        self.write_message(&PluginMessage::Request(req)).map_err(|e| RpcError {
            code: "plugin.io".into(),
            message: e,
        })?;

        let resp = rx
            .recv_timeout(self.cfg.timeout)
            .map_err(|_| {
                self.record_crash();
                self.kill_process();
                RpcError {
                    code: "plugin.timeout".into(),
                    message: "plugin request timed out".into(),
                }
            })?;

        if resp.ok {
            Ok(resp.result)
        } else {
            Err(RpcError {
                code: resp.error_code.unwrap_or_else(|| "plugin.error".into()),
                message: resp.error.unwrap_or_else(|| "error".into()),
            })
        }
    }

    fn write_message(&self, msg: &PluginMessage) -> Result<(), String> {
        let line = serde_json::to_string(msg).map_err(|e| format!("serialize: {e}"))?;
        let mut lock = self.stdin.lock().unwrap();
        let Some(stdin) = lock.as_mut() else {
            return Err("plugin stdin not available".to_string());
        };
        if let Err(e) = writeln!(stdin, "{line}") {
            drop(lock);
            self.record_crash();
            self.kill_process();
            return Err(format!("write stdin: {e}"));
        }
        if let Err(e) = stdin.flush() {
            drop(lock);
            self.record_crash();
            self.kill_process();
            return Err(format!("flush stdin: {e}"));
        }
        Ok(())
    }

    fn record_crash(&self) {
        let mut crashes = self.crash_count.lock().unwrap();
        *crashes = crashes.saturating_add(1);
        if *crashes >= MAX_CRASHES {
            *self.disabled.lock().unwrap() = true;
        } else {
            let mut backoff = self.backoff_ms.lock().unwrap();
            *backoff = (*backoff).saturating_mul(2).min(30_000);
        }
    }

    fn kill_process(&self) {
        // Drop stdin so the child sees EOF.
        *self.stdin.lock().unwrap() = None;

        // Clear pending so callers don't leak memory (timeouts still handle the callsite).
        if let Ok(mut lock) = self.pending.lock() {
            lock.pending.clear();
        }

        let mut child_lock = self.child.lock().unwrap();
        if let Some(mut child) = child_lock.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

impl Drop for StdioRpcProcess {
    fn drop(&mut self) {
        // Best-effort cleanup; ignore errors.
        self.kill_process();
    }
}

fn read_stdout_loop(
    stdout: impl io::Read,
    spawn: SpawnConfig,
    pending: Arc<Mutex<PendingMap>>,
    stdin_for_responses: Arc<Mutex<Option<LineWriter<ChildStdin>>>>,
    on_event: Arc<Mutex<Option<Arc<dyn Fn(VcsEvent) + Send + Sync + 'static>>>>,
    stdout_log_path: PathBuf,
) {
    let reader = BufReader::new(stdout);
    for line in reader.lines().map_while(Result::ok) {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let msg: PluginMessage = match serde_json::from_str(trimmed) {
            Ok(m) => m,
            Err(_) => {
                let _ = append_log_line(&stdout_log_path, trimmed);
                continue;
            }
        };
        match msg {
            PluginMessage::Response(resp) => {
                let tx = pending.lock().ok().and_then(|mut p| p.pending.remove(&resp.id));
                if let Some(tx) = tx {
                    let _ = tx.send(resp);
                }
            }
            PluginMessage::Event { event } => {
                if let Ok(lock) = on_event.lock() {
                    if let Some(cb) = lock.as_ref() {
                        cb(event);
                    }
                }
            }
            PluginMessage::Request(req) => {
                let resp = handle_host_request(&spawn, req);
                if let Ok(mut lock) = stdin_for_responses.lock() {
                    if let Some(stdin) = lock.as_mut() {
                        if let Ok(line) =
                            serde_json::to_string(&PluginMessage::Response(resp))
                        {
                            let _ = writeln!(stdin, "{line}");
                            let _ = stdin.flush();
                        }
                    }
                }
            }
        }
    }
}

fn read_stderr_loop(stderr: impl io::Read, path: PathBuf) {
    let reader = BufReader::new(stderr);
    for line in reader.lines().map_while(Result::ok) {
        let _ = append_log_line(&path, &line);
    }
}

fn handle_host_request(spawn: &SpawnConfig, req: RpcRequest) -> RpcResponse {
    let deny = |code: &str, msg: &str| RpcResponse {
        id: req.id,
        ok: false,
        result: Value::Null,
        error: Some(msg.to_string()),
        error_code: Some(code.to_string()),
        error_data: None,
    };

    let approved_caps = match &spawn.approval {
        ApprovalState::Approved { capabilities, .. } => capabilities.clone(),
        _ => Vec::new(),
    };
    let caps = approved_caps
        .into_iter()
        .collect::<std::collections::HashSet<_>>();

    match req.method.as_str() {
        "ui.notify" => {
            if !caps.contains("ui.notifications") {
                return deny(
                    "capability.denied",
                    "missing capability: ui.notifications",
                );
            }
            let msg = req
                .params
                .get("message")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .trim()
                .to_string();
            if !msg.is_empty() {
                log::info!("plugin[{}] notify: {}", spawn.plugin_id, msg);
            }
            RpcResponse {
                id: req.id,
                ok: true,
                result: Value::Null,
                error: None,
                error_code: None,
                error_data: None,
            }
        }
        "workspace.readFile" => {
            if !caps.contains("workspace.read") {
                return deny("capability.denied", "missing capability: workspace.read");
            }
            let Some(root) = spawn.allowed_workspace_root.as_ref() else {
                return deny("workspace.denied", "no workspace context");
            };
            let rel = req
                .params
                .get("path")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            match read_file_under_root(root, &rel) {
                Ok(bytes) => RpcResponse {
                    id: req.id,
                    ok: true,
                    result: Value::String(String::from_utf8_lossy(&bytes).to_string()),
                    error: None,
                    error_code: None,
                    error_data: None,
                },
                Err(e) => deny("workspace.error", &e),
            }
        }
        _ => deny("method.not_found", "unknown host method"),
    }
}

fn read_file_under_root(root: &Path, rel: &str) -> Result<Vec<u8>, String> {
    let rel = rel.replace('\\', "/");
    let p = Path::new(&rel);
    for c in p.components() {
        if matches!(c, Component::ParentDir | Component::RootDir | Component::Prefix(_)) {
            return Err("invalid path".to_string());
        }
    }
    let joined = root.join(p);
    let root_canon = fs::canonicalize(root).map_err(|e| format!("canonicalize root: {e}"))?;
    let parent = joined.parent().ok_or_else(|| "invalid path".to_string())?;
    let parent_canon =
        fs::canonicalize(parent).map_err(|e| format!("canonicalize parent: {e}"))?;
    if !parent_canon.starts_with(&root_canon) {
        return Err("path escapes workspace".to_string());
    }
    fs::read(&joined).map_err(|e| format!("read {}: {e}", joined.display()))
}

fn sanitized_env() -> Vec<(OsString, OsString)> {
    let mut out: Vec<(OsString, OsString)> = Vec::new();

    for k in [
        "HOME",
        "USER",
        "USERPROFILE",
        "TMPDIR",
        "TEMP",
        "TMP",
        "LANG",
        "LC_ALL",
        // SSH / Git authentication:
        // allow the plugin process to talk to the user’s SSH agent and respect host config.
        "SSH_AUTH_SOCK",
        "SSH_AGENT_PID",
        "GIT_SSH_COMMAND",
        "OPENVCS_SSH_MODE",
        "OPENVCS_SSH",
    ] {
        if let Ok(v) = std::env::var(k) {
            out.push((k.into(), v.into()));
        }
    }

    #[cfg(unix)]
    {
        out.push(("PATH".into(), "/usr/bin:/bin".into()));
    }
    #[cfg(windows)]
    {
        if let Ok(sysroot) = std::env::var("SystemRoot") {
            out.push(("PATH".into(), format!("{sysroot}\\System32").into()));
        }
    }

    out
}

fn plugin_stderr_log_path(plugin_id: &str, component: &str) -> PathBuf {
    crate::plugin_bundles::PluginBundleStore::new_default()
        .plugin_root_dir(plugin_id)
        .join("logs")
        .join(format!("{component}.stderr.log"))
}

fn plugin_stdout_log_path(plugin_id: &str, component: &str) -> PathBuf {
    crate::plugin_bundles::PluginBundleStore::new_default()
        .plugin_root_dir(plugin_id)
        .join("logs")
        .join(format!("{component}.stdout.log"))
}

fn append_log_line(path: &Path, line: &str) -> io::Result<()> {
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    rotate_if_needed(path)?;
    let mut f = fs::OpenOptions::new().create(true).append(true).open(path)?;
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    writeln!(f, "[{ts}] {line}")?;
    Ok(())
}

fn rotate_if_needed(path: &Path) -> io::Result<()> {
    let meta = match fs::metadata(path) {
        Ok(m) => m,
        Err(_) => return Ok(()),
    };
    if meta.len() < STDERR_LOG_MAX_BYTES {
        return Ok(());
    }

    let dir = path.parent().unwrap_or_else(|| Path::new("."));
    let stem = path
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("plugin.stderr.log");
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let rotated = dir.join(format!("{stem}.{ts}.log"));
    let _ = fs::rename(path, rotated);

    // Best-effort prune old logs.
    let mut logs: Vec<PathBuf> = fs::read_dir(dir)
        .map(|rd| rd.flatten().map(|e| e.path()).collect())
        .unwrap_or_default();
    logs.sort();
    if logs.len() > STDERR_LOG_MAX_FILES {
        let excess = logs.len() - STDERR_LOG_MAX_FILES;
        for p in logs.into_iter().take(excess) {
            let _ = fs::remove_file(p);
        }
    }
    Ok(())
}
