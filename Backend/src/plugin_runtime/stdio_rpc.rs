use crate::plugin_bundles::ApprovalState;
use crate::plugin_runtime::events::{register_plugin_io, PluginIoHandle, PluginStdin};
use openvcs_core::models::VcsEvent;
use openvcs_core::plugin_protocol::{PluginMessage, RpcRequest, RpcResponse};
use serde_json::Value;
use std::collections::HashMap;
use std::ffi::OsString;
use std::fs;
use std::io::{self, BufRead, BufReader, LineWriter, Read, Write};
#[cfg(unix)]
use std::os::fd::{FromRawFd, IntoRawFd};
#[cfg(windows)]
use std::os::windows::io::{FromRawHandle, IntoRawHandle};
use std::path::{Component, Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

type EventSink = Arc<Mutex<Option<Arc<dyn Fn(VcsEvent) + Send + Sync + 'static>>>>;

const DEFAULT_TIMEOUT: Duration = Duration::from_secs(60);
const BACKOFF_MS: u64 = 250;
const MAX_BACKOFF_MS: u64 = 30_000;
// Whitelisted environment variables that are forwarded to plugin processes.
// Centralized here to make adding/removing entries easier.
const SANITIZED_ENV_KEYS: &[&str] = &[
    "HOME",
    "USER",
    "USERPROFILE",
    "TMPDIR",
    "TEMP",
    "TMP",
    "LANG",
    "LC_ALL",
    // SSH / Git authentication
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
const STDERR_LOG_MAX_BYTES: u64 = 10 * 1024 * 1024;
const STDERR_LOG_MAX_FILES: usize = 5;
const MAX_PENDING: usize = 1024;
const MAX_CRASHES: u32 = 5;

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

#[derive(Debug, Clone)]
pub struct SpawnConfig {
    pub plugin_id: String,
    pub component_label: String,
    pub exec_path: PathBuf,
    pub args: Vec<String>,
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
    child: Mutex<Option<ProcessHandle>>,
    stdin: PluginStdin,
    pending: Arc<Mutex<PendingMap>>,
    on_event: EventSink,
    crash_count: Mutex<u32>,
    backoff_ms: Mutex<u64>,
    disabled: Mutex<bool>,
}

struct ProcessHandle {
    #[allow(dead_code)]
    join: std::thread::JoinHandle<()>,
    #[allow(dead_code)]
    stdin_writer: os_pipe::PipeWriter,
}

impl StdioRpcProcess {
    /// Creates a new lazily-started stdio RPC process wrapper.
    ///
    /// # Parameters
    /// - `spawn`: Process spawn configuration and capability policy.
    /// - `cfg`: RPC behavior configuration (timeouts, etc.).
    ///
    /// # Returns
    /// - A new [`StdioRpcProcess`] instance.
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
            backoff_ms: Mutex::new(BACKOFF_MS),
            disabled: Mutex::new(false),
        }
    }

    /// Sets or clears the event sink used for plugin-emitted `VcsEvent` values.
    ///
    /// # Parameters
    /// - `sink`: Optional callback invoked for plugin events.
    ///
    /// # Returns
    /// - `()`.
    pub fn set_event_sink(&self, sink: Option<Arc<dyn Fn(VcsEvent) + Send + Sync + 'static>>) {
        if let Ok(mut lock) = self.on_event.lock() {
            *lock = sink;
        }
    }

    /// Ensures the backing plugin process is running and ready for RPC calls.
    ///
    /// # Returns
    /// - `Ok(())` when the process is running.
    /// - `Err(String)` if startup/validation fails or the plugin is disabled.
    pub fn ensure_running(&self) -> Result<(), String> {
        if *self.disabled.lock().unwrap() {
            return Err(format!(
                "plugin {} is disabled after repeated crashes",
                self.spawn.plugin_id
            ));
        }

        if self.child.lock().ok().map(|c| c.is_some()).unwrap_or(false) {
            return Ok(());
        }

        if !self.spawn.exec_path.is_file() {
            return Err(format!(
                "plugin executable not found: {}",
                self.spawn.exec_path.display()
            ));
        }

        if !is_wasm_module(&self.spawn.exec_path) {
            return Err(format!(
                "invalid plugin entrypoint (expected .wasm module): {}",
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

        self.spawn_wasm()
    }

    /// Sends a JSON-RPC style request to the plugin and waits for a response.
    ///
    /// # Parameters
    /// - `method`: RPC method name.
    /// - `params`: JSON parameters payload.
    ///
    /// # Returns
    /// - `Ok(Value)` with the response result payload.
    /// - `Err(RpcError)` when the plugin is unavailable, times out, or returns an error.
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

        self.write_message(&PluginMessage::Request(req))
            .map_err(|e| RpcError {
                code: "plugin.io".into(),
                message: e,
            })?;

        let resp = rx.recv_timeout(self.cfg.timeout).map_err(|_| {
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
        let stdin: &mut LineWriter<Box<dyn Write + Send>> = stdin;
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
            *backoff = (*backoff).saturating_mul(2).min(MAX_BACKOFF_MS);
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
        if let Some(ProcessHandle {
            join,
            mut stdin_writer,
        }) = child_lock.take()
        {
            // Try to flush any buffered data (ignore errors) and drop the
            // write end so the plugin's stdin reader sees EOF.
            let _ = stdin_writer.flush();
            drop(stdin_writer);

            // If the thread has already finished, join synchronously (cheap).
            // Otherwise detach a background joiner so shutdown remains
            // non-blocking while ensuring the thread is eventually reaped.
            if join.is_finished() {
                let _ = join.join();
            } else {
                std::thread::spawn(move || {
                    let _ = join.join();
                });
            }
        }
    }

    fn spawn_wasm(&self) -> Result<(), String> {
        let (stdin_reader, stdin_writer) =
            os_pipe::pipe().map_err(|e| format!("create stdin pipe: {e}"))?;
        let (stdout_reader, stdout_writer) =
            os_pipe::pipe().map_err(|e| format!("create stdout pipe: {e}"))?;
        let (stderr_reader, stderr_writer) =
            os_pipe::pipe().map_err(|e| format!("create stderr pipe: {e}"))?;

        let wasm_path = self.spawn.exec_path.clone();
        let plugin_id = self.spawn.plugin_id.clone();
        let args = self.spawn.args.clone();
        let host_timeout = self.cfg.timeout;
        let (approved_caps, allowed_workspace_root) = approved_caps_and_workspace(&self.spawn);

        let join = std::thread::spawn(move || {
            let cfg = RunWasiConfig {
                wasm_path,
                plugin_id,
                args,
                host_timeout,
                approved_caps,
                allowed_workspace_root,
                stdin: stdin_reader,
                stdout: stdout_writer,
                stderr: stderr_writer,
            };
            if let Err(e) = run_wasi_module(cfg) {
                log::error!("wasi plugin crashed: {}", e);
            }
        });

        let stdin: Box<dyn Write + Send> = Box::new(
            stdin_writer
                .try_clone()
                .map_err(|e| format!("clone stdin pipe: {e}"))?,
        );
        let stdin = LineWriter::new(stdin);
        *self.stdin.lock().unwrap() = Some(stdin);

        register_plugin_io(
            &self.spawn.plugin_id,
            PluginIoHandle {
                stdin: Arc::clone(&self.stdin),
            },
        );

        let pending = Arc::clone(&self.pending);
        let spawn = self.spawn.clone();
        let stdin_for_responses = Arc::clone(&self.stdin);
        let on_event = Arc::clone(&self.on_event);
        let stdout_log_path =
            plugin_stdout_log_path(&self.spawn.plugin_id, &self.spawn.component_label);

        std::thread::spawn(move || {
            read_stdout_loop(
                stdout_reader,
                spawn,
                pending,
                stdin_for_responses,
                on_event,
                stdout_log_path,
            )
        });

        let stderr_path =
            plugin_stderr_log_path(&self.spawn.plugin_id, &self.spawn.component_label);
        let stderr_plugin_id = self.spawn.plugin_id.clone();
        let stderr_component = self.spawn.component_label.clone();
        std::thread::spawn(move || {
            read_stderr_loop(
                stderr_reader,
                stderr_path,
                stderr_plugin_id,
                stderr_component,
            )
        });

        *self.child.lock().unwrap() = Some(ProcessHandle { join, stdin_writer });
        Ok(())
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
    stdin_for_responses: PluginStdin,
    on_event: EventSink,
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
                let tx = pending
                    .lock()
                    .ok()
                    .and_then(|mut p| p.pending.remove(&resp.id));
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
                        let stdin: &mut LineWriter<Box<dyn Write + Send>> = stdin;
                        if let Ok(line) = serde_json::to_string(&PluginMessage::Response(resp)) {
                            let _ = writeln!(stdin, "{line}");
                            let _ = stdin.flush();
                        }
                    }
                }
            }
        }
    }
}

fn read_stderr_loop(stderr: impl io::Read, path: PathBuf, plugin_id: String, component: String) {
    let reader = BufReader::new(stderr);
    for line in reader.lines().map_while(Result::ok) {
        let _ = append_log_line(&path, &line);

        // Also forward plugin stderr into the main OpenVCS-Client logs.
        //
        // openvcs-core's plugin logger prints:
        //   [INFO] some::target: message
        // Parse the level prefix when present; otherwise treat it as INFO.
        let prefix = format!("[plugin:{plugin_id}:{component}] ");
        if let Some((lvl, rest)) = parse_plugin_stderr_level(&line) {
            log::log!(lvl, "{}{}", prefix, rest);
        } else {
            log::info!("{}{}", prefix, line);
        }
    }
}

fn is_wasm_module(path: &Path) -> bool {
    if path.extension().and_then(|s| s.to_str()) != Some("wasm") {
        return false;
    }
    let mut f = match fs::File::open(path) {
        Ok(f) => f,
        Err(_) => return false,
    };
    let mut magic = [0u8; 4];
    matches!(
        f.read(&mut magic),
        Ok(n) if n == magic.len() && magic == [0x00, 0x61, 0x73, 0x6d]
    )
}

fn parse_plugin_stderr_level(line: &str) -> Option<(log::Level, &str)> {
    let line = line.trim();
    if !line.starts_with('[') {
        return None;
    }
    let end = line.find(']')?;
    let level = &line[1..end];
    let level = match level {
        "ERROR" => log::Level::Error,
        "WARN" | "WARNING" => log::Level::Warn,
        "INFO" => log::Level::Info,
        "DEBUG" => log::Level::Debug,
        "TRACE" => log::Level::Trace,
        _ => return None,
    };

    let rest = line[end + 1..].trim_start();
    Some((level, rest))
}

fn approved_caps_and_workspace(spawn: &SpawnConfig) -> (Vec<String>, Option<PathBuf>) {
    let approved_caps = match &spawn.approval {
        ApprovalState::Approved { capabilities, .. } => capabilities.clone(),
        _ => Vec::new(),
    };
    (approved_caps, spawn.allowed_workspace_root.clone())
}

pub struct RunWasiConfig {
    pub wasm_path: PathBuf,
    pub plugin_id: String,
    pub args: Vec<String>,
    pub host_timeout: Duration,
    pub approved_caps: Vec<String>,
    pub allowed_workspace_root: Option<PathBuf>,
    pub stdin: os_pipe::PipeReader,
    pub stdout: os_pipe::PipeWriter,
    pub stderr: os_pipe::PipeWriter,
}

fn run_wasi_module(cfg: RunWasiConfig) -> Result<(), String> {
    let RunWasiConfig {
        wasm_path,
        plugin_id,
        args,
        host_timeout,
        approved_caps,
        allowed_workspace_root,
        stdin,
        stdout,
        stderr,
    } = cfg;
    let allowed_workspace_root = allowed_workspace_root.as_deref();
    use wasmtime::{Engine, Module, Store};
    use wasmtime_wasi::cli::{AsyncStdinStream, OutputFile};
    use wasmtime_wasi::WasiCtxBuilder;

    // Convert os_pipe readers/writers into std::fs::File using
    // the platform-specific helpers defined below.
    let stdin_file = into_file_from_reader(stdin);
    let stdout_file = into_file_from_writer(stdout);
    let stderr_file = into_file_from_writer(stderr);

    let engine = Engine::default();
    let module = Module::from_file(&engine, &wasm_path).map_err(|e| format!("load module: {e}"))?;

    let mut linker = wasmtime::Linker::new(&engine);
    wasmtime_wasi::p1::add_to_linker_sync(&mut linker, |cx| cx).map_err(|e| format!("{e}"))?;

    let stdin_tokio = tokio::fs::File::from_std(stdin_file);
    let stdin_stream = AsyncStdinStream::new(stdin_tokio);
    let stdout_stream = OutputFile::new(stdout_file);
    let stderr_stream = OutputFile::new(stderr_file);

    // Override args: keep deterministic while still allowing component args.
    let mut argv = Vec::with_capacity(1 + args.len());
    argv.push(
        wasm_path
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("plugin.wasm")
            .to_string(),
    );
    argv.extend(args.iter().cloned());

    let mut builder = WasiCtxBuilder::new();
    builder.stdin(stdin_stream);
    builder.stdout(stdout_stream);
    builder.stderr(stderr_stream);
    builder.env("OPENVCS_PLUGIN_ID", plugin_id.as_str());
    builder.env(
        "OPENVCS_PLUGIN_HOST_TIMEOUT_MS",
        host_timeout.as_millis().to_string(),
    );
    builder.args(&argv);

    // Do not preopen the host filesystem into WASI. All file I/O must go through
    // host RPCs which are scoped to `allowed_workspace_root` and capability-gated.
    let _ = (approved_caps.as_slice(), allowed_workspace_root);

    let mut store = Store::new(&engine, builder.build_p1());

    let instance = linker
        .instantiate(&mut store, &module)
        .map_err(|e| format!("instantiate: {e}"))?;
    let start = instance
        .get_typed_func::<(), ()>(&mut store, "_start")
        .map_err(|e| format!("missing _start: {e}"))?;
    start
        .call(&mut store, ())
        .map_err(|e| format!("wasi trap: {e}"))?;

    Ok(())
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

    let (approved_caps, _) = approved_caps_and_workspace(spawn);
    let caps = approved_caps
        .into_iter()
        .collect::<std::collections::HashSet<_>>();

    match req.method.as_str() {
        "runtime.info" => RpcResponse {
            id: req.id,
            ok: true,
            result: serde_json::json!({
                "os": std::env::consts::OS,
                "arch": std::env::consts::ARCH,
                "container": runtime_container_kind(),
            }),
            error: None,
            error_code: None,
            error_data: None,
        },
        "events.subscribe" => {
            let name = req
                .params
                .get("name")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .trim()
                .to_string();
            if name.is_empty() {
                return deny("invalid.params", "missing params.name");
            }
            crate::plugin_runtime::events::subscribe(&spawn.plugin_id, &name);
            RpcResponse {
                id: req.id,
                ok: true,
                result: Value::Null,
                error: None,
                error_code: None,
                error_data: None,
            }
        }
        "events.emit" => {
            let name = req
                .params
                .get("name")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .trim()
                .to_string();
            if name.is_empty() {
                return deny("invalid.params", "missing params.name");
            }
            let payload = req.params.get("payload").cloned().unwrap_or(Value::Null);
            crate::plugin_runtime::events::emit_from_plugin(&spawn.plugin_id, &name, payload);
            RpcResponse {
                id: req.id,
                ok: true,
                result: Value::Null,
                error: None,
                error_code: None,
                error_data: None,
            }
        }
        "ui.notify" => {
            if !caps.contains("ui.notifications") {
                return deny("capability.denied", "missing capability: ui.notifications");
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
            if !caps.contains("workspace.read") && !caps.contains("workspace.write") {
                return deny(
                    "capability.denied",
                    "missing capability: workspace.read (or workspace.write)",
                );
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
        "workspace.writeFile" => {
            if !caps.contains("workspace.write") {
                return deny("capability.denied", "missing capability: workspace.write");
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
            let data = req
                .params
                .get("content")
                .and_then(|v| v.as_str())
                .unwrap_or("");

            match write_file_under_root(root, &rel, data.as_bytes()) {
                Ok(()) => RpcResponse {
                    id: req.id,
                    ok: true,
                    result: Value::Null,
                    error: None,
                    error_code: None,
                    error_data: None,
                },
                Err(e) => deny("workspace.error", &e),
            }
        }
        "process.exec" => {
            if !caps.contains("process.exec") {
                return deny("capability.denied", "missing capability: process.exec");
            }
            let program = req
                .params
                .get("program")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .trim()
                .to_string();
            if program != "git" {
                return deny("process.denied", "only 'git' is allowed");
            }
            let argv = req
                .params
                .get("args")
                .and_then(|v| v.as_array())
                .cloned()
                .unwrap_or_default()
                .into_iter()
                .filter_map(|v| v.as_str().map(|s| s.to_string()))
                .collect::<Vec<_>>();

            let cwd_param = req.params.get("cwd").and_then(|v| v.as_str()).unwrap_or("");
            let cwd = if cwd_param.trim().is_empty() {
                spawn.allowed_workspace_root.clone()
            } else {
                let Some(root) = spawn.allowed_workspace_root.as_ref() else {
                    return deny("workspace.denied", "no workspace context");
                };
                match resolve_under_root(root, cwd_param) {
                    Ok(p) => Some(p),
                    Err(e) => return deny("workspace.denied", &e),
                }
            };

            let mut cmd = Command::new("git");
            if let Some(cwd) = cwd.as_ref() {
                cmd.current_dir(cwd);
            }
            cmd.args(argv);
            cmd.env_clear();
            for (k, v) in sanitized_env() {
                cmd.env(k, v);
            }
            if let Some(env) = req.params.get("env").and_then(|v| v.as_object()) {
                for (k, v) in env {
                    let Some(val) = v.as_str() else { continue };
                    if matches!(k.as_str(), "GIT_SSH_COMMAND" | "GIT_TERMINAL_PROMPT") {
                        cmd.env(k, val);
                    }
                }
            }

            let stdin_text = req
                .params
                .get("stdin")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let out = if stdin_text.is_empty() {
                match cmd.output() {
                    Ok(o) => o,
                    Err(e) => return deny("process.error", &format!("spawn git: {e}")),
                }
            } else {
                cmd.stdin(Stdio::piped());
                let mut child = match cmd.spawn() {
                    Ok(c) => c,
                    Err(e) => return deny("process.error", &format!("spawn git: {e}")),
                };
                if let Some(mut stdin) = child.stdin.take() {
                    if let Err(e) = stdin.write_all(stdin_text.as_bytes()) {
                        let _ = child.kill();
                        return deny("process.error", &format!("write stdin: {e}"));
                    }
                }
                match child.wait_with_output() {
                    Ok(o) => o,
                    Err(e) => return deny("process.error", &format!("wait: {e}")),
                }
            };

            RpcResponse {
                id: req.id,
                ok: true,
                result: serde_json::json!({
                    "status": out.status.code().unwrap_or(-1),
                    "success": out.status.success(),
                    "stdout": String::from_utf8_lossy(&out.stdout),
                    "stderr": String::from_utf8_lossy(&out.stderr),
                }),
                error: None,
                error_code: None,
                error_data: None,
            }
        }
        _ => deny("method.not_found", "unknown host method"),
    }
}

fn resolve_under_root(root: &Path, path: &str) -> Result<PathBuf, String> {
    if path.contains('\0') {
        return Err("path contains NUL".to_string());
    }

    let p = Path::new(path);

    // Allow absolute paths if they are within the allowed workspace root.
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

    // Otherwise require a clean, relative path with no `..`.
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

// Move helper functions above the test module to avoid `items_after_test_module` warnings.
fn read_file_under_root(root: &Path, rel: &str) -> Result<Vec<u8>, String> {
    let joined = resolve_under_root(root, rel)?;
    fs::read(&joined).map_err(|e| format!("read {}: {e}", joined.display()))
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

// Platform-specific conversions from os_pipe types into `std::fs::File`.
// Implemented as separate functions per-platform to keep unsafe blocks small
// and clearly documented.
#[cfg(unix)]
fn into_file_from_reader(r: os_pipe::PipeReader) -> std::fs::File {
    // Safety: we consume the PipeReader and immediately create a File which
    // becomes the sole owner of the underlying fd.
    unsafe { std::fs::File::from_raw_fd(r.into_raw_fd()) }
}

#[cfg(unix)]
fn into_file_from_writer(w: os_pipe::PipeWriter) -> std::fs::File {
    // Safety: we consume the PipeWriter and immediately create a File which
    // becomes the sole owner of the underlying fd.
    unsafe { std::fs::File::from_raw_fd(w.into_raw_fd()) }
}

#[cfg(windows)]
fn into_file_from_reader(r: os_pipe::PipeReader) -> std::fs::File {
    // Safety: we consume the PipeReader and immediately create a File which
    // becomes the sole owner of the underlying handle.
    unsafe { std::fs::File::from_raw_handle(r.into_raw_handle()) }
}

#[cfg(windows)]
fn into_file_from_writer(w: os_pipe::PipeWriter) -> std::fs::File {
    // Safety: we consume the PipeWriter and immediately create a File which
    // becomes the sole owner of the underlying handle.
    unsafe { std::fs::File::from_raw_handle(w.into_raw_handle()) }
}

fn append_log_line(path: &Path, line: &str) -> io::Result<()> {
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    rotate_if_needed(path)?;
    let mut f = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)?;
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn runs_minimal_wasm_module() {
        // Minimal wasm module exporting an empty `_start`.
        // (module (func (export "_start")))
        let wasm: &[u8] = &[
            0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, // header
            0x01, 0x04, 0x01, 0x60, 0x00, 0x00, // type section
            0x03, 0x02, 0x01, 0x00, // func section
            0x07, 0x0b, 0x01, 0x06, 0x5f, 0x73, 0x74, 0x61, 0x72, 0x74, 0x00, 0x00, // export
            0x0a, 0x04, 0x01, 0x02, 0x00, 0x0b, // code
        ];

        let dir = tempfile::tempdir().expect("tempdir");
        let wasm_path = dir.path().join("plugin.wasm");
        std::fs::write(&wasm_path, wasm).expect("write wasm");

        let rpc = StdioRpcProcess::new(
            SpawnConfig {
                plugin_id: "test".into(),
                component_label: "functions".into(),
                exec_path: wasm_path,
                args: Vec::new(),
                requested_capabilities: Vec::new(),
                approval: ApprovalState::Approved {
                    capabilities: Vec::new(),
                    approved_at_unix_ms: 0,
                },
                allowed_workspace_root: None,
            },
            RpcConfig::default(),
        );

        rpc.ensure_running().expect("ensure_running");
    }

    #[test]
    fn resolve_under_root_allows_absolute_under_root() {
        let dir = tempfile::tempdir().expect("tempdir");
        let root = dir.path().join("root");
        std::fs::create_dir_all(&root).expect("mkdir root");
        let child = root.join("child");
        std::fs::create_dir_all(&child).expect("mkdir child");

        let resolved =
            resolve_under_root(&root, child.to_string_lossy().as_ref()).expect("resolve");
        assert!(resolved.starts_with(&root));
    }

    #[test]
    fn write_file_under_root_rejects_parent_dir_escape() {
        let dir = tempfile::tempdir().expect("tempdir");
        let root = dir.path().join("root");
        std::fs::create_dir_all(&root).expect("mkdir root");

        let err = write_file_under_root(&root, "../escape.txt", b"nope").unwrap_err();
        assert!(err.contains("relative") || err.contains("escape") || err.contains(".."));
    }
}

// Duplicate helper definitions removed (handled earlier in the file).
