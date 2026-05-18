// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later
//! Low-level JSON-RPC process wrapper for Node.js plugins.
//!
//! Provides the raw `NodeRpcProcess` handle that manages a child Node.js
//! process, frames JSON-RPC 2.0 messages over stdio using an LSP-style
//! `Content-Length` header, and dispatches responses with timeout tracking.

use crate::plugin_runtime::protocol::{RpcError, RpcRequest, RpcResponse, write_framed_message};
use log::debug;
use parking_lot::Mutex;
use serde::de::DeserializeOwned;
use serde_json::Value;
use std::process::{Child, ChildStdin};
use std::sync::Arc;
use std::sync::mpsc::{Receiver, RecvTimeoutError};
use std::time::Duration;

/// Live stdio-backed JSON-RPC process handle.
pub(super) struct NodeRpcProcess {
    /// Child process hosting the plugin runtime.
    pub(super) child: Child,
    /// Writable stdin stream for requests.
    pub(super) stdin: ChildStdin,
    /// Channel for receiving decoded RPC messages from the reader thread.
    pub(super) rx: Receiver<Value>,
    /// Flag to signal the reader thread to stop.
    pub(super) shutdown_flag: Arc<Mutex<bool>>,
    /// Last reader-thread error observed while consuming framed messages.
    pub(super) reader_error: Arc<Mutex<Option<String>>>,
    /// Monotonic request id counter.
    pub(super) next_request_id: u64,
}

impl NodeRpcProcess {
    /// Sends one JSON-RPC request and waits for a matching response with timeout.
    ///
    /// # Parameters
    /// - `method`: RPC method name.
    /// - `params`: RPC params payload.
    /// - `plugin_id`: Plugin id for diagnostics.
    /// - `on_notification`: Callback for incoming notifications.
    /// - `timeout_secs`: Optional timeout in seconds. Defaults to 30s for lifecycle
    ///   calls, 60s for VCS operations.
    ///
    /// # Returns
    /// - `Ok(T)` decoded response result.
    /// - `Err(String)` when transport/protocol/plugin errors, disconnects, or
    ///   timeout occur.
    pub(super) fn call<T>(
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

        let timeout = Duration::from_secs(timeout_secs.unwrap_or(super::DEFAULT_RPC_TIMEOUT_SECS));
        let start = std::time::Instant::now();
        let mut remaining = timeout;
        loop {
            let message = match self.rx.recv_timeout(remaining) {
                Ok(message) => message,
                Err(RecvTimeoutError::Timeout) => {
                    return Err(format!(
                        "plugin '{}' rpc '{}' timed out after {}s",
                        plugin_id,
                        method,
                        timeout.as_secs()
                    ));
                }
                Err(RecvTimeoutError::Disconnected) => {
                    let exit_status = self.child.try_wait().map_err(|e| {
                        format!("check plugin process status for '{plugin_id}': {e}")
                    })?;
                    let reader_error = self.reader_error.lock().clone();
                    return match (exit_status, reader_error) {
                        (Some(status), Some(error)) => Err(format!(
                            "plugin '{}' rpc '{}' disconnected because the process exited with {} (reader error: {})",
                            plugin_id, method, status, error
                        )),
                        (Some(status), None) => Err(format!(
                            "plugin '{}' rpc '{}' disconnected because the process exited with {}",
                            plugin_id, method, status
                        )),
                        (None, Some(error)) => Err(format!(
                            "plugin '{}' rpc '{}' disconnected while waiting for a response (reader error: {})",
                            plugin_id, method, error
                        )),
                        (None, None) => Err(format!(
                            "plugin '{}' rpc '{}' disconnected while waiting for a response",
                            plugin_id, method
                        )),
                    };
                }
            };

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
