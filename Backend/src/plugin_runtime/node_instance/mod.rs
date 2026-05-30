// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later
//! Node.js plugin runtime implementation.
//!
//! This runtime spawns long-lived Node processes and exchanges JSON-RPC 2.0
//! messages over stdio using an LSP-style framing protocol.

mod rpc;
mod vcs;

use crate::core::models::{OnEvent, VcsEvent};
use crate::core::settings::SettingKv;
use crate::core::ui::Menu;
use crate::plugin_paths;
use crate::plugin_runtime::events;
use crate::plugin_runtime::instance::PluginRuntimeInstance;
use crate::plugin_runtime::protocol::{Methods, NotificationMethods, PROTOCOL_VERSION};
use crate::plugin_runtime::spawn::SpawnConfig;
use log::{debug, info, trace, warn};
use parking_lot::{Mutex, RwLock};
use serde::Deserialize;
use serde::de::DeserializeOwned;
use serde_json::{Value, json};
use std::io::{BufRead, BufReader};
use std::process::{Command, Stdio};
use std::sync::Arc;
use std::sync::mpsc::channel;
use std::thread;

use self::rpc::NodeRpcProcess;

const DEFAULT_RPC_TIMEOUT_SECS: u64 = 30;
const VCS_OPERATION_TIMEOUT_SECS: u64 = 60;

/// Test-only mock RPC handler type.
#[cfg(test)]
type MockRpcHandler = Box<dyn Fn(&str, Value) -> Result<Value, String> + Send>;

/// Parsed plugin initialize response payload.
#[derive(Debug, Deserialize)]
struct InitializeResponse {
    /// Protocol version accepted by plugin.
    protocol_version: u32,
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
    /// Test-only RPC mock handler injected instead of a real process.
    #[cfg(test)]
    mock_rpc_handler: Mutex<Option<MockRpcHandler>>,
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
            #[cfg(test)]
            mock_rpc_handler: Mutex::new(None),
        }
    }

    /// Sets the VCS session id for testing without a real plugin process.
    #[cfg(test)]
    pub(crate) fn set_session_id(&self, id: Option<String>) {
        *self.vcs_session_id.lock() = id;
    }

    /// Injects a pre-built process for testing the real RPC call path.
    #[cfg(test)]
    pub(crate) fn set_process(&self, process: NodeRpcProcess) {
        *self.process.lock() = Some(process);
    }

    /// Installs a mock RPC handler for testing, bypassing the real process.
    #[cfg(test)]
    pub(crate) fn set_mock_handler(&self, handler: MockRpcHandler) {
        *self.mock_rpc_handler.lock() = Some(handler);
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
            .stderr(Stdio::piped())
            .env("OPENVCS_PLUGIN_ID", self.spawn.plugin_id.trim());

        #[cfg(windows)]
        {
            crate::process_utils::hide_window(&mut cmd);
        }

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
        let reader_error = Arc::new(Mutex::new(None));
        let stdout_for_thread = BufReader::new(stdout);
        let shutdown_for_thread = Arc::clone(&shutdown_flag);
        let reader_error_for_thread = Arc::clone(&reader_error);

        thread::spawn(move || {
            let mut stdout = stdout_for_thread;
            loop {
                if *shutdown_for_thread.lock() {
                    break;
                }
                match crate::plugin_runtime::protocol::read_framed_message(&mut stdout) {
                    Ok(msg) => {
                        if tx.send(msg).is_err() {
                            break;
                        }
                    }
                    Err(e) => {
                        *reader_error_for_thread.lock() = Some(e.to_string());
                        debug!("node rpc reader thread: read error: {}", e);
                        break;
                    }
                }
            }
        });

        if let Some(stderr) = child.stderr.take() {
            let plugin_id = self.spawn.plugin_id.clone();
            thread::spawn(move || {
                let reader = BufReader::new(stderr);
                for line in reader.lines() {
                    match line {
                        Ok(l) => warn!("plugin '{}' stderr: {}", plugin_id, l),
                        Err(_) => break,
                    }
                }
            });
        }

        let mut process = NodeRpcProcess {
            child,
            stdin,
            rx,
            shutdown_flag,
            reader_error,
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
        let result = f(process);
        if let Err(err) = &result
            && err.contains("disconnected")
        {
            lock.take();
        }
        result
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
        #[cfg(test)]
        if let Some(handler) = self.mock_rpc_handler.lock().as_ref() {
            let result = handler(method, params)?;
            return serde_json::from_value(result).map_err(|e| format!("mock rpc decode: {e}"));
        }

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
                    self.spawn.plugin_id, other
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
    /// - `graceful`: When `true`, request plugin deinitialization before killing
    ///   the child.
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

#[cfg(test)]
mod tests {
    include!("../../../tests/plugin_runtime/node_instance/mod.rs");
}
