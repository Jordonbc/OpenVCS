// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later
//! Node.js plugin runtime implementation.
//!
//! This runtime spawns long-lived Node processes and exchanges JSON-RPC 2.0
//! messages over stdio using an LSP-style framing protocol.

use crate::core::models::{
    BranchItem, CommitItem, ConflictDetails, ConflictSide, LogQuery, OnEvent, StashItem,
    StatusPayload, VcsEvent,
};
use crate::core::settings::SettingKv;
use crate::core::ui::Menu;
use crate::plugin_paths;
use crate::plugin_runtime::events;
use crate::plugin_runtime::instance::PluginRuntimeInstance;
use crate::plugin_runtime::protocol::{
    read_framed_message, write_framed_message, Methods, NotificationMethods, RpcError, RpcRequest,
    RpcResponse, PROTOCOL_VERSION,
};
use crate::plugin_runtime::spawn::SpawnConfig;
use base64::Engine;
use log::{debug, info, trace, warn};
use parking_lot::{Mutex, RwLock};
use serde::de::DeserializeOwned;
use serde::Deserialize;
use serde_json::{json, Value};
use std::io::BufReader;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::mpsc::{channel, Receiver};
use std::sync::Arc;
use std::thread;
use std::time::Duration;

const DEFAULT_RPC_TIMEOUT_SECS: u64 = 30;
const VCS_OPERATION_TIMEOUT_SECS: u64 = 60;

/// Live stdio-backed JSON-RPC process handle.
struct NodeRpcProcess {
    /// Child process hosting the plugin runtime.
    child: Child,
    /// Writable stdin stream for requests.
    stdin: ChildStdin,
    /// Channel for receiving decoded RPC messages from the reader thread.
    rx: Receiver<Value>,
    /// Flag to signal the reader thread to stop.
    shutdown_flag: Arc<Mutex<bool>>,
    /// Monotonic request id counter.
    next_request_id: u64,
}

impl NodeRpcProcess {
    /// Sends one JSON-RPC request and waits for a matching response with timeout.
    ///
    /// # Parameters
    /// - `method`: RPC method name.
    /// - `params`: RPC params payload.
    /// - `plugin_id`: Plugin id for diagnostics.
    /// - `on_notification`: Callback for incoming notifications.
    /// - `timeout_secs`: Optional timeout in seconds. Defaults to 30s for lifecycle calls,
    ///   60s for VCS operations.
    ///
    /// # Returns
    /// - `Ok(T)` decoded response result.
    /// - `Err(String)` when transport/protocol/plugin errors or timeout occur.
    fn call<T>(
        &mut self,
        method: &str,
        params: Value,
        plugin_id: &str,
        on_notification: &mut dyn FnMut(&str, &Value) -> Result<(), String>,
        timeout_secs: Option<u64>,
    ) -> Result<T, String>
    where
        T: DeserializeOwned,
    {
        let request_id = self.next_request_id;
        self.next_request_id = self
            .next_request_id
            .checked_add(1)
            .ok_or_else(|| "rpc request id overflow".to_string())?;

        let request = RpcRequest {
            jsonrpc: "2.0".to_string(),
            id: request_id,
            method: method.to_string(),
            params,
        };
        let request_value =
            serde_json::to_value(request).map_err(|e| format!("encode rpc request: {e}"))?;
        write_framed_message(&mut self.stdin, &request_value)?;

        let timeout = Duration::from_secs(timeout_secs.unwrap_or(DEFAULT_RPC_TIMEOUT_SECS));
        let start = std::time::Instant::now();
        let mut remaining = timeout;
        loop {
            let message = self.rx.recv_timeout(remaining).map_err(|_| {
                format!(
                    "plugin '{}' rpc '{}' timed out after {}s",
                    plugin_id,
                    method,
                    timeout.as_secs()
                )
            })?;

            if let Some(method_name) = message.get("method").and_then(Value::as_str) {
                let params = message.get("params").cloned().unwrap_or(Value::Null);
                on_notification(method_name, &params)?;
                let elapsed = start.elapsed();
                if elapsed >= timeout {
                    return Err(format!(
                        "plugin '{}' rpc '{}' timed out after {}s (including notification delays)",
                        plugin_id,
                        method,
                        timeout.as_secs()
                    ));
                }
                remaining = timeout - elapsed;
                continue;
            }

            let response: RpcResponse = serde_json::from_value(message)
                .map_err(|e| format!("decode rpc response for '{method}': {e}"))?;
            if response.id != request_id {
                debug!(
                    "node rpc: ignoring out-of-order response id={} for method='{}' (expected={})",
                    response.id, method, request_id
                );
                continue;
            }

            if let Some(error) = response.error {
                return Err(format_rpc_error(plugin_id, method, &error));
            }

            let result = response.result.unwrap_or(Value::Null);
            return serde_json::from_value(result)
                .map_err(|e| format!("decode rpc result for '{method}': {e}"));
        }
    }
}

/// Parsed plugin initialize response payload.
#[derive(Debug, Deserialize)]
struct InitializeResponse {
    /// Protocol version accepted by plugin.
    protocol_version: u32,
}

/// Parsed session-open response payload.
#[derive(Debug, Deserialize)]
struct OpenSessionResponse {
    /// Stable plugin-owned session id.
    session_id: String,
}

/// Parsed identity response payload.
#[derive(Debug, Deserialize)]
struct IdentityResponse {
    /// User name.
    name: String,
    /// User email.
    email: String,
}

/// Parsed remote descriptor response payload.
#[derive(Debug, Deserialize)]
struct RemoteEntry {
    /// Remote name.
    name: String,
    /// Remote URL.
    url: String,
}

/// Node runtime implementation backing plugin RPC calls.
pub struct NodePluginRuntimeInstance {
    /// Spawn configuration for this runtime instance.
    spawn: SpawnConfig,
    /// Lazily started plugin process.
    process: Mutex<Option<NodeRpcProcess>>,
    /// Active VCS session id for backend plugins.
    vcs_session_id: Mutex<Option<String>>,
    /// Optional sink for VCS progress events.
    event_sink: RwLock<Option<OnEvent>>,
}

impl NodePluginRuntimeInstance {
    /// Creates a node runtime instance for the given spawn config.
    ///
    /// # Parameters
    /// - `spawn`: Runtime spawn details.
    ///
    /// # Returns
    /// - New runtime instance.
    pub fn new(spawn: SpawnConfig) -> Self {
        Self {
            spawn,
            process: Mutex::new(None),
            vcs_session_id: Mutex::new(None),
            event_sink: RwLock::new(None),
        }
    }

    /// Resolves the bundled Node executable path used to launch plugins.
    ///
    /// # Returns
    /// - `Ok(String)` with absolute path to bundled node runtime.
    /// - `Err(String)` when bundled runtime path is unavailable.
    fn node_executable() -> Result<String, String> {
        let Some(path) = plugin_paths::node_executable_path() else {
            return Err(
                "bundled node runtime is unavailable; plugin execution requires app-bundled node"
                    .to_string(),
            );
        };
        Ok(path.display().to_string())
    }

    /// Starts the plugin process and performs initialization handshake.
    ///
    /// # Returns
    /// - `Ok(NodeRpcProcess)` when startup succeeds.
    /// - `Err(String)` when process startup or init RPC fails.
    fn spawn_process(&self) -> Result<NodeRpcProcess, String> {
        let node_exec = Self::node_executable()?;
        info!(
            "plugin runtime: starting node plugin '{}' via '{}'",
            self.spawn.plugin_id, node_exec
        );

        let mut cmd = Command::new(&node_exec);
        cmd.arg(&self.spawn.exec_path)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .env("OPENVCS_PLUGIN_ID", self.spawn.plugin_id.trim());

        let mut child = cmd.spawn().map_err(|e| {
            format!(
                "spawn node runtime '{}': {e}",
                self.spawn.exec_path.display()
            )
        })?;

        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| "node runtime missing stdin pipe".to_string())?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| "node runtime missing stdout pipe".to_string())?;

        let (tx, rx) = channel::<Value>();
        let shutdown_flag = Arc::new(Mutex::new(false));
        let stdout_for_thread = BufReader::new(stdout);
        let shutdown_for_thread = Arc::clone(&shutdown_flag);

        thread::spawn(move || {
            let mut stdout = stdout_for_thread;
            loop {
                if *shutdown_for_thread.lock() {
                    break;
                }
                match read_framed_message(&mut stdout) {
                    Ok(msg) => {
                        if tx.send(msg).is_err() {
                            break;
                        }
                    }
                    Err(e) => {
                        debug!("node rpc reader thread: read error: {}", e);
                        break;
                    }
                }
            }
        });

        let mut process = NodeRpcProcess {
            child,
            stdin,
            rx,
            shutdown_flag,
            next_request_id: 1,
        };

        let initialize: InitializeResponse = process.call(
            Methods::PLUGIN_INITIALIZE,
            json!({
                "plugin_id": self.spawn.plugin_id,
                "protocol_version": PROTOCOL_VERSION,
            }),
            self.spawn.plugin_id.as_str(),
            &mut |method, params| {
                self.handle_notification(method, params);
                Ok(())
            },
            Some(DEFAULT_RPC_TIMEOUT_SECS),
        )?;
        if initialize.protocol_version != PROTOCOL_VERSION {
            return Err(format!(
                "plugin '{}' protocol mismatch: expected {}, got {}",
                self.spawn.plugin_id, PROTOCOL_VERSION, initialize.protocol_version
            ));
        }

        let _: Value = process.call(
            Methods::PLUGIN_INIT,
            Value::Object(serde_json::Map::new()),
            self.spawn.plugin_id.as_str(),
            &mut |method, params| {
                self.handle_notification(method, params);
                Ok(())
            },
            Some(DEFAULT_RPC_TIMEOUT_SECS),
        )?;

        Ok(process)
    }

    /// Ensures a process exists and runs a closure against it.
    ///
    /// # Parameters
    /// - `f`: Closure to execute with mutable process access.
    ///
    /// # Returns
    /// - Closure return value.
    fn with_process<T>(
        &self,
        f: impl FnOnce(&mut NodeRpcProcess) -> Result<T, String>,
    ) -> Result<T, String> {
        let mut lock = self.process.lock();
        if lock.is_none() {
            *lock = Some(self.spawn_process()?);
        }
        let process = lock
            .as_mut()
            .ok_or_else(|| "node runtime did not initialize".to_string())?;
        f(process)
    }

    /// Sends one RPC request to the plugin process.
    ///
    /// # Parameters
    /// - `method`: Method name.
    /// - `params`: Params object.
    ///
    /// # Returns
    /// - Decoded result value.
    fn rpc_call<T>(&self, method: &str, params: Value) -> Result<T, String>
    where
        T: DeserializeOwned,
    {
        self.rpc_call_with_timeout(method, params, None)
    }

    /// Sends one RPC request to the plugin process with a specific timeout.
    ///
    /// # Parameters
    /// - `method`: Method name.
    /// - `params`: Params object.
    /// - `timeout_secs`: Optional timeout in seconds.
    ///
    /// # Returns
    /// - Decoded result value.
    fn rpc_call_with_timeout<T>(
        &self,
        method: &str,
        params: Value,
        timeout_secs: Option<u64>,
    ) -> Result<T, String>
    where
        T: DeserializeOwned,
    {
        let timeout = timeout_secs.or_else(|| {
            if method.starts_with("vcs.") {
                Some(VCS_OPERATION_TIMEOUT_SECS)
            } else {
                Some(DEFAULT_RPC_TIMEOUT_SECS)
            }
        });
        self.with_process(|process| {
            process.call(
                method,
                params,
                self.spawn.plugin_id.as_str(),
                &mut |notif_method, notif_params| {
                    self.handle_notification(notif_method, notif_params);
                    Ok(())
                },
                timeout,
            )
        })
    }

    /// Sends one RPC request to the plugin process where result is ignored.
    ///
    /// # Parameters
    /// - `method`: Method name.
    /// - `params`: Params object.
    ///
    /// # Returns
    /// - `Ok(())` when request succeeds.
    fn rpc_call_unit(&self, method: &str, params: Value) -> Result<(), String> {
        let _: Value = self.rpc_call(method, params)?;
        Ok(())
    }

    /// Builds a session-scoped RPC params object.
    ///
    /// # Parameters
    /// - `extra`: Additional method parameters.
    ///
    /// # Returns
    /// - Session-scoped params object.
    fn session_params(&self, extra: Value) -> Result<Value, String> {
        let session_id = self
            .vcs_session_id
            .lock()
            .clone()
            .ok_or_else(|| "vcs session is not open".to_string())?;

        let mut map = serde_json::Map::new();
        map.insert("session_id".to_string(), Value::String(session_id));
        if let Value::Object(extra_map) = extra {
            for (key, value) in extra_map {
                map.insert(key, value);
            }
        }
        Ok(Value::Object(map))
    }

    /// Handles one plugin-originated notification.
    ///
    /// # Parameters
    /// - `method`: Notification method.
    /// - `params`: Notification payload.
    fn handle_notification(&self, method: &str, params: &Value) {
        match method {
            NotificationMethods::HOST_LOG => {
                let level = params
                    .get("level")
                    .and_then(Value::as_str)
                    .unwrap_or("info")
                    .to_ascii_lowercase();
                let target = params
                    .get("target")
                    .and_then(Value::as_str)
                    .unwrap_or("plugin")
                    .trim();
                let message = params
                    .get("message")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .trim();
                match level.as_str() {
                    "trace" => log::trace!(target: target, "{}", message),
                    "debug" => log::debug!(target: target, "{}", message),
                    "warn" => log::warn!(target: target, "{}", message),
                    "error" => log::error!(target: target, "{}", message),
                    _ => log::info!(target: target, "{}", message),
                }
            }
            NotificationMethods::HOST_UI_NOTIFY => {
                let message = params
                    .get("message")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .trim();
                if !message.is_empty() {
                    info!("plugin ui notify ({}): {}", self.spawn.plugin_id, message);
                }
            }
            NotificationMethods::HOST_STATUS_SET => {
                let message = params
                    .get("message")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .trim();
                crate::plugin_runtime::host_api::set_status_text_unchecked(message);
            }
            NotificationMethods::HOST_EVENT_EMIT => {
                let event_name = params
                    .get("event_name")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .trim();
                if event_name.is_empty() {
                    return;
                }
                let payload = params.get("payload").cloned().unwrap_or(Value::Null);
                events::emit_from_plugin(self.spawn.plugin_id.as_str(), event_name, payload);
            }
            NotificationMethods::VCS_EVENT => {
                let Some(raw_event) = params.get("event") else {
                    return;
                };
                let event: VcsEvent = match serde_json::from_value(raw_event.clone()) {
                    Ok(value) => value,
                    Err(err) => {
                        warn!(
                            "plugin '{}' emitted invalid vcs.event payload: {}",
                            self.spawn.plugin_id, err
                        );
                        return;
                    }
                };
                if let Some(sink) = self.event_sink.read().clone() {
                    sink(event);
                }
            }
            other => {
                trace!(
                    "plugin '{}' emitted unknown notification '{}'",
                    self.spawn.plugin_id,
                    other
                );
            }
        }
    }

    /// Closes an active VCS session when present.
    fn close_vcs_session(&self) {
        let session_id = self.vcs_session_id.lock().take();
        if let Some(session_id) = session_id {
            let _ = self.rpc_call_unit(Methods::VCS_CLOSE, json!({ "session_id": session_id }));
        }
    }

    /// Stops the child process with optional graceful deinitialization.
    ///
    /// # Parameters
    /// - `graceful`: When `true`, request plugin deinitialization before killing the child.
    fn stop_process(&self, graceful: bool) {
        if graceful {
            self.close_vcs_session();
        } else {
            *self.vcs_session_id.lock() = None;
        }

        let process = self.process.lock().take();
        if let Some(mut process) = process {
            *process.shutdown_flag.lock() = true;

            if graceful {
                let _ = process.call::<Value>(
                    Methods::PLUGIN_DEINIT,
                    Value::Object(serde_json::Map::new()),
                    self.spawn.plugin_id.as_str(),
                    &mut |method, params| {
                        self.handle_notification(method, params);
                        Ok(())
                    },
                    Some(DEFAULT_RPC_TIMEOUT_SECS),
                );
            }

            let _ = process.child.kill();
            let _ = process.child.wait();
        }

        *self.vcs_session_id.lock() = None;
    }

    /// Calls `vcs.open` and stores active session id.
    ///
    /// # Parameters
    /// - `path`: Repository workdir path.
    /// - `config`: Serialized open config JSON bytes.
    pub fn vcs_open(&self, path: &str, config: &[u8]) -> Result<(), String> {
        let config_value = if config.is_empty() {
            Value::Object(serde_json::Map::new())
        } else {
            serde_json::from_slice(config).unwrap_or_else(|_| Value::Object(serde_json::Map::new()))
        };
        let result: OpenSessionResponse = self.rpc_call(
            Methods::VCS_OPEN,
            json!({
                "path": path,
                "config": config_value,
            }),
        )?;
        *self.vcs_session_id.lock() = Some(result.session_id);
        Ok(())
    }

    /// Calls `vcs.get-current-branch`.
    pub fn vcs_get_current_branch(&self) -> Result<Option<String>, String> {
        let params = self.session_params(Value::Object(serde_json::Map::new()))?;
        self.rpc_call(Methods::VCS_GET_CURRENT_BRANCH, params)
    }

    /// Calls `vcs.list-branches`.
    pub fn vcs_list_branches(&self) -> Result<Vec<BranchItem>, String> {
        let params = self.session_params(Value::Object(serde_json::Map::new()))?;
        self.rpc_call(Methods::VCS_LIST_BRANCHES, params)
    }

    /// Calls `vcs.create-branch`.
    pub fn vcs_create_branch(&self, name: &str, checkout: bool) -> Result<(), String> {
        let params = self.session_params(json!({ "name": name, "checkout": checkout }))?;
        self.rpc_call_unit(Methods::VCS_CREATE_BRANCH, params)
    }

    /// Calls `vcs.checkout-branch`.
    pub fn vcs_checkout_branch(&self, name: &str) -> Result<(), String> {
        let params = self.session_params(json!({ "name": name }))?;
        self.rpc_call_unit(Methods::VCS_CHECKOUT_BRANCH, params)
    }

    /// Calls `vcs.ensure-remote`.
    pub fn vcs_ensure_remote(&self, name: &str, url: &str) -> Result<(), String> {
        let params = self.session_params(json!({ "name": name, "url": url }))?;
        self.rpc_call_unit(Methods::VCS_ENSURE_REMOTE, params)
    }

    /// Calls `vcs.list-remotes`.
    pub fn vcs_list_remotes(&self) -> Result<Vec<(String, String)>, String> {
        let params = self.session_params(Value::Object(serde_json::Map::new()))?;
        let entries: Vec<RemoteEntry> = self.rpc_call(Methods::VCS_LIST_REMOTES, params)?;
        Ok(entries
            .into_iter()
            .map(|entry| (entry.name, entry.url))
            .collect())
    }

    /// Calls `vcs.remove-remote`.
    pub fn vcs_remove_remote(&self, name: &str) -> Result<(), String> {
        let params = self.session_params(json!({ "name": name }))?;
        self.rpc_call_unit(Methods::VCS_REMOVE_REMOTE, params)
    }

    /// Calls `vcs.fetch`.
    pub fn vcs_fetch(&self, remote: &str, refspec: &str) -> Result<(), String> {
        let params = self.session_params(json!({ "remote": remote, "refspec": refspec }))?;
        self.rpc_call_unit(Methods::VCS_FETCH, params)
    }

    /// Calls `vcs.push`.
    pub fn vcs_push(&self, remote: &str, refspec: &str) -> Result<(), String> {
        let params = self.session_params(json!({ "remote": remote, "refspec": refspec }))?;
        self.rpc_call_unit(Methods::VCS_PUSH, params)
    }

    /// Calls `vcs.pull-ff-only`.
    pub fn vcs_pull_ff_only(&self, remote: &str, branch: &str) -> Result<(), String> {
        let params = self.session_params(json!({ "remote": remote, "branch": branch }))?;
        self.rpc_call_unit(Methods::VCS_PULL_FF_ONLY, params)
    }

    /// Calls `vcs.commit`.
    pub fn vcs_commit(
        &self,
        message: &str,
        name: &str,
        email: &str,
        paths: &[String],
    ) -> Result<String, String> {
        let params = self.session_params(json!({
            "message": message,
            "name": name,
            "email": email,
            "paths": paths,
        }))?;
        self.rpc_call(Methods::VCS_COMMIT, params)
    }

    /// Calls `vcs.commit-index`.
    pub fn vcs_commit_index(
        &self,
        message: &str,
        name: &str,
        email: &str,
    ) -> Result<String, String> {
        let params = self.session_params(json!({
            "message": message,
            "name": name,
            "email": email,
        }))?;
        self.rpc_call(Methods::VCS_COMMIT_INDEX, params)
    }

    /// Calls `vcs.get-status-payload`.
    pub fn vcs_get_status_payload(&self) -> Result<StatusPayload, String> {
        let params = self.session_params(Value::Object(serde_json::Map::new()))?;
        self.rpc_call(Methods::VCS_GET_STATUS_PAYLOAD, params)
    }

    /// Calls `vcs.list-commits`.
    pub fn vcs_list_commits(&self, query: &LogQuery) -> Result<Vec<CommitItem>, String> {
        let params = self.session_params(json!({ "query": query }))?;
        self.rpc_call(Methods::VCS_LIST_COMMITS, params)
    }

    /// Calls `vcs.diff-file`.
    pub fn vcs_diff_file(&self, path: &str) -> Result<Vec<String>, String> {
        let params = self.session_params(json!({ "path": path }))?;
        self.rpc_call(Methods::VCS_DIFF_FILE, params)
    }

    /// Calls `vcs.diff-commit`.
    pub fn vcs_diff_commit(&self, rev: &str) -> Result<Vec<String>, String> {
        let params = self.session_params(json!({ "rev": rev }))?;
        self.rpc_call(Methods::VCS_DIFF_COMMIT, params)
    }

    /// Calls `vcs.get-conflict-details`.
    pub fn vcs_get_conflict_details(&self, path: &str) -> Result<ConflictDetails, String> {
        let params = self.session_params(json!({ "path": path }))?;
        self.rpc_call(Methods::VCS_GET_CONFLICT_DETAILS, params)
    }

    /// Calls `vcs.checkout-conflict-side`.
    pub fn vcs_checkout_conflict_side(&self, path: &str, side: ConflictSide) -> Result<(), String> {
        let params = self.session_params(json!({ "path": path, "side": side }))?;
        self.rpc_call_unit(Methods::VCS_CHECKOUT_CONFLICT_SIDE, params)
    }

    /// Calls `vcs.write-merge-result`.
    pub fn vcs_write_merge_result(&self, path: &str, content: &[u8]) -> Result<(), String> {
        let content_b64 = base64::engine::general_purpose::STANDARD.encode(content);
        let params = self.session_params(json!({
            "path": path,
            "content_b64": content_b64,
        }))?;
        self.rpc_call_unit(Methods::VCS_WRITE_MERGE_RESULT, params)
    }

    /// Calls `vcs.stage-patch`.
    pub fn vcs_stage_patch(&self, patch: &str) -> Result<(), String> {
        let params = self.session_params(json!({ "patch": patch }))?;
        self.rpc_call_unit(Methods::VCS_STAGE_PATCH, params)
    }

    /// Calls `vcs.stage-paths`.
    pub fn vcs_stage_paths(&self, paths: &[String]) -> Result<(), String> {
        let params = self.session_params(json!({ "paths": paths }))?;
        self.rpc_call_unit(Methods::VCS_STAGE_PATHS, params)
    }

    /// Calls `vcs.discard-paths`.
    pub fn vcs_discard_paths(&self, paths: &[String]) -> Result<(), String> {
        let params = self.session_params(json!({ "paths": paths }))?;
        self.rpc_call_unit(Methods::VCS_DISCARD_PATHS, params)
    }

    /// Calls `vcs.apply-reverse-patch`.
    pub fn vcs_apply_reverse_patch(&self, patch: &str) -> Result<(), String> {
        let params = self.session_params(json!({ "patch": patch }))?;
        self.rpc_call_unit(Methods::VCS_APPLY_REVERSE_PATCH, params)
    }

    /// Calls `vcs.delete-branch`.
    pub fn vcs_delete_branch(&self, name: &str, force: bool) -> Result<(), String> {
        let params = self.session_params(json!({ "name": name, "force": force }))?;
        self.rpc_call_unit(Methods::VCS_DELETE_BRANCH, params)
    }

    /// Calls `vcs.rename-branch`.
    pub fn vcs_rename_branch(&self, old: &str, new: &str) -> Result<(), String> {
        let params = self.session_params(json!({ "old": old, "new": new }))?;
        self.rpc_call_unit(Methods::VCS_RENAME_BRANCH, params)
    }

    /// Calls `vcs.merge-into-current`.
    pub fn vcs_merge_into_current(&self, name: &str, message: Option<&str>) -> Result<(), String> {
        let params = self.session_params(json!({ "name": name, "message": message }))?;
        self.rpc_call_unit(Methods::VCS_MERGE_INTO_CURRENT, params)
    }

    /// Calls `vcs.merge-abort`.
    pub fn vcs_merge_abort(&self) -> Result<(), String> {
        let params = self.session_params(Value::Object(serde_json::Map::new()))?;
        self.rpc_call_unit(Methods::VCS_MERGE_ABORT, params)
    }

    /// Calls `vcs.merge-continue`.
    pub fn vcs_merge_continue(&self) -> Result<(), String> {
        let params = self.session_params(Value::Object(serde_json::Map::new()))?;
        self.rpc_call_unit(Methods::VCS_MERGE_CONTINUE, params)
    }

    /// Calls `vcs.is-merge-in-progress`.
    pub fn vcs_is_merge_in_progress(&self) -> Result<bool, String> {
        let params = self.session_params(Value::Object(serde_json::Map::new()))?;
        self.rpc_call(Methods::VCS_IS_MERGE_IN_PROGRESS, params)
    }

    /// Calls `vcs.set-branch-upstream`.
    pub fn vcs_set_branch_upstream(&self, branch: &str, upstream: &str) -> Result<(), String> {
        let params = self.session_params(json!({ "branch": branch, "upstream": upstream }))?;
        self.rpc_call_unit(Methods::VCS_SET_BRANCH_UPSTREAM, params)
    }

    /// Calls `vcs.get-branch-upstream`.
    pub fn vcs_get_branch_upstream(&self, branch: &str) -> Result<Option<String>, String> {
        let params = self.session_params(json!({ "branch": branch }))?;
        self.rpc_call(Methods::VCS_GET_BRANCH_UPSTREAM, params)
    }

    /// Calls `vcs.reset-soft-to`.
    pub fn vcs_reset_soft_to(&self, rev: &str) -> Result<(), String> {
        let params = self.session_params(json!({ "rev": rev }))?;
        self.rpc_call_unit(Methods::VCS_RESET_SOFT_TO, params)
    }

    /// Calls `vcs.get-identity`.
    pub fn vcs_get_identity(&self) -> Result<Option<(String, String)>, String> {
        let params = self.session_params(Value::Object(serde_json::Map::new()))?;
        let identity: Option<IdentityResponse> =
            self.rpc_call(Methods::VCS_GET_IDENTITY, params)?;
        Ok(identity.map(|value| (value.name, value.email)))
    }

    /// Calls `vcs.set-identity-local`.
    pub fn vcs_set_identity_local(&self, name: &str, email: &str) -> Result<(), String> {
        let params = self.session_params(json!({ "name": name, "email": email }))?;
        self.rpc_call_unit(Methods::VCS_SET_IDENTITY_LOCAL, params)
    }

    /// Calls `vcs.list-stashes`.
    pub fn vcs_list_stashes(&self) -> Result<Vec<StashItem>, String> {
        let params = self.session_params(Value::Object(serde_json::Map::new()))?;
        self.rpc_call(Methods::VCS_LIST_STASHES, params)
    }

    /// Calls `vcs.stash-push`.
    pub fn vcs_stash_push(
        &self,
        message: Option<&str>,
        include_untracked: bool,
    ) -> Result<String, String> {
        let params = self.session_params(json!({
            "message": message,
            "include_untracked": include_untracked,
        }))?;
        self.rpc_call(Methods::VCS_STASH_PUSH, params)
    }

    /// Calls `vcs.stash-apply`.
    pub fn vcs_stash_apply(&self, selector: &str) -> Result<(), String> {
        let params = self.session_params(json!({ "selector": selector }))?;
        self.rpc_call_unit(Methods::VCS_STASH_APPLY, params)
    }

    /// Calls `vcs.stash-pop`.
    pub fn vcs_stash_pop(&self, selector: &str) -> Result<(), String> {
        let params = self.session_params(json!({ "selector": selector }))?;
        self.rpc_call_unit(Methods::VCS_STASH_POP, params)
    }

    /// Calls `vcs.stash-drop`.
    pub fn vcs_stash_drop(&self, selector: &str) -> Result<(), String> {
        let params = self.session_params(json!({ "selector": selector }))?;
        self.rpc_call_unit(Methods::VCS_STASH_DROP, params)
    }

    /// Calls `vcs.stash-show`.
    pub fn vcs_stash_show(&self, selector: &str) -> Result<String, String> {
        let params = self.session_params(json!({ "selector": selector }))?;
        self.rpc_call(Methods::VCS_STASH_SHOW, params)
    }

    /// Calls `vcs.cherry-pick`.
    pub fn vcs_cherry_pick(&self, commit: &str) -> Result<(), String> {
        let params = self.session_params(json!({ "commit": commit }))?;
        self.rpc_call_unit(Methods::VCS_CHERRY_PICK, params)
    }

    /// Calls `vcs.revert-commit`.
    pub fn vcs_revert_commit(&self, commit: &str, no_edit: bool) -> Result<(), String> {
        let params = self.session_params(json!({ "commit": commit, "no_edit": no_edit }))?;
        self.rpc_call_unit(Methods::VCS_REVERT_COMMIT, params)
    }
}

impl PluginRuntimeInstance for NodePluginRuntimeInstance {
    /// Ensures the underlying Node process is running.
    fn ensure_running(&self) -> Result<(), String> {
        self.with_process(|_| Ok(()))
    }

    /// Calls `plugin.get-menus`.
    fn get_menus(&self) -> Result<Vec<Menu>, String> {
        self.rpc_call(
            Methods::PLUGIN_GET_MENUS,
            Value::Object(serde_json::Map::new()),
        )
    }

    /// Calls `plugin.handle-action`.
    fn handle_action(&self, id: &str, payload: Value) -> Result<Value, String> {
        self.rpc_call(
            Methods::PLUGIN_HANDLE_ACTION,
            json!({ "action_id": id, "payload": payload }),
        )
    }

    /// Calls `plugin.settings-defaults`.
    fn settings_defaults(&self) -> Result<Vec<SettingKv>, String> {
        self.rpc_call(
            Methods::PLUGIN_SETTINGS_DEFAULTS,
            Value::Object(serde_json::Map::new()),
        )
    }

    /// Calls `plugin.settings-on-load`.
    fn settings_on_load(&self, values: Vec<SettingKv>) -> Result<Vec<SettingKv>, String> {
        self.rpc_call(
            Methods::PLUGIN_SETTINGS_ON_LOAD,
            json!({ "values": values }),
        )
    }

    /// Calls `plugin.settings-on-apply`.
    fn settings_on_apply(&self, values: Vec<SettingKv>) -> Result<(), String> {
        self.rpc_call_unit(
            Methods::PLUGIN_SETTINGS_ON_APPLY,
            json!({ "values": values }),
        )
    }

    /// Calls `plugin.settings-on-save`.
    fn settings_on_save(&self, values: Vec<SettingKv>) -> Result<Vec<SettingKv>, String> {
        self.rpc_call(
            Methods::PLUGIN_SETTINGS_ON_SAVE,
            json!({ "values": values }),
        )
    }

    /// Calls `plugin.settings-on-reset`.
    fn settings_on_reset(&self) -> Result<(), String> {
        self.rpc_call_unit(
            Methods::PLUGIN_SETTINGS_ON_RESET,
            Value::Object(serde_json::Map::new()),
        )
    }

    /// Updates the optional VCS event sink.
    fn set_event_sink(&self, sink: Option<OnEvent>) {
        *self.event_sink.write() = sink;
    }

    /// Stops the runtime and clears local session state.
    fn stop(&self) {
        self.stop_process(true);
    }
}

impl Drop for NodePluginRuntimeInstance {
    /// Ensures child process cleanup on drop.
    fn drop(&mut self) {
        if let Some(mut process) = self.process.get_mut().take() {
            *process.shutdown_flag.lock() = true;
            let _ = process.child.kill();
            let _ = process.child.wait();
        }
    }
}

/// Formats an RPC error payload into a user-facing message.
fn format_rpc_error(plugin_id: &str, method: &str, error: &RpcError) -> String {
    let detail = error
        .data
        .as_ref()
        .and_then(|value| value.get("message"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| error.message.trim());
    format!(
        "plugin '{}' rpc '{}' failed (code {}): {}",
        plugin_id, method, error.code, detail
    )
}
