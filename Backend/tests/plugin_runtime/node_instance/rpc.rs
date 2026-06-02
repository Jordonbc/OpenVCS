// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

use super::format_rpc_error;
use crate::plugin_runtime::protocol::RpcError;
use serde_json::json;

#[cfg(unix)]
use super::NodeRpcProcess;
#[cfg(unix)]
use crate::plugin_runtime::node_instance::NodePluginRuntimeInstance;
#[cfg(unix)]
use crate::plugin_runtime::spawn::SpawnConfig;
#[cfg(unix)]
use parking_lot::Mutex;
#[cfg(unix)]
use std::path::PathBuf;
#[cfg(unix)]
use std::process::{Command, Stdio};
#[cfg(unix)]
use std::sync::Arc;
#[cfg(unix)]
use std::sync::mpsc;
#[cfg(unix)]
use serde_json::Value;

#[test]
fn formats_rpc_errors_with_nested_message() {
    let error = RpcError {
        code: 42,
        message: "outer".into(),
        data: Some(json!({"message": "inner"})),
    };
    assert_eq!(
        format_rpc_error("demo.plugin", "vcs.open", &error),
        "inner"
    );
}

#[test]
fn formats_rpc_errors_with_fallback_message() {
    let error = RpcError {
        code: 7,
        message: "  fallback  ".into(),
        data: None,
    };
    assert_eq!(
        format_rpc_error("demo.plugin", "vcs.open", &error),
        "fallback"
    );
}

/// Integration tests using a real (but harmless) sh process for RPC I/O.
#[cfg(unix)]
mod call_integration {
    use super::*;

    /// Spawns a background process that stays alive so `call()` can write
    /// framed messages to its stdin pipe without error.
    fn mock_process() -> (NodeRpcProcess, mpsc::Sender<Value>) {
        let mut child = Command::new("sh")
            .arg("-c")
            .arg("while true; do :; done")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .expect("spawn mock rpc child");
        let stdin = child.stdin.take().expect("mock process stdin");
        let (tx, rx) = mpsc::channel();
        let process = NodeRpcProcess {
            child,
            stdin,
            rx,
            shutdown_flag: Arc::new(Mutex::new(false)),
            reader_error: Arc::new(Mutex::new(None)),
            next_request_id: 1,
        };
        (process, tx)
    }

    fn test_runtime() -> NodePluginRuntimeInstance {
        NodePluginRuntimeInstance::new(SpawnConfig {
            plugin_id: "test.plugin".into(),
            exec_path: PathBuf::from("test.mjs"),
            allowed_workspace_root: None,
            is_vcs_backend: true,
        })
    }

    #[test]
    fn call_method_returns_response() {
        let (process, tx) = mock_process();
        let rt = test_runtime();
        rt.set_session_id(Some("s".into()));
        rt.set_process(process);

        tx.send(json!({
            "jsonrpc": "2.0",
            "id": 1,
            "result": "test-result"
        }))
        .unwrap();

        let result: String = rt.vcs_stash_show("stash@{0}").unwrap();
        assert_eq!(result, "test-result");
    }

    #[test]
    fn call_method_returns_deserialized_struct() {
        let (process, tx) = mock_process();
        let rt = test_runtime();
        rt.set_session_id(Some("s".into()));
        rt.set_process(process);

        tx.send(json!({
            "jsonrpc": "2.0",
            "id": 1,
            "result": "main"
        }))
        .unwrap();

        let branch = rt.vcs_get_current_branch().unwrap();
        assert_eq!(branch, Some("main".into()));
    }

    #[test]
    fn call_method_propagates_rpc_error() {
        let (process, tx) = mock_process();
        let rt = test_runtime();
        rt.set_session_id(Some("s".into()));
        rt.set_process(process);

        tx.send(json!({
            "jsonrpc": "2.0",
            "id": 1,
            "error": {"code": -1, "message": "operation rejected"}
        }))
        .unwrap();

        let err = rt.vcs_list_branches().unwrap_err();
        assert!(err.contains("operation rejected") || err.contains("rpc"));
    }

    #[test]
    fn call_method_handles_notification_before_response() {
        let (process, tx) = mock_process();
        let rt = test_runtime();
        rt.set_session_id(Some("s".into()));
        rt.set_process(process);

        tx.send(json!({
            "jsonrpc": "2.0",
            "method": "host.log",
            "params": {"level": "info", "message": "test notification"}
        }))
        .unwrap();
        tx.send(json!({
            "jsonrpc": "2.0",
            "id": 1,
            "result": "done"
        }))
        .unwrap();

        let result: String = rt.vcs_stash_show("stash@{0}").unwrap();
        assert_eq!(result, "done");
    }

    #[test]
    fn call_method_rejects_mismatched_response_id() {
        let (process, tx) = mock_process();
        let rt = test_runtime();
        rt.set_session_id(Some("s".into()));
        rt.set_process(process);

        tx.send(json!({
            "jsonrpc": "2.0",
            "id": 999,
            "result": "wrong-id"
        }))
        .unwrap();
        tx.send(json!({
            "jsonrpc": "2.0",
            "id": 1,
            "result": "correct-id"
        }))
        .unwrap();

        let result: String = rt.vcs_stash_show("stash@{0}").unwrap();
        assert_eq!(result, "correct-id");
    }

    #[test]
    fn call_method_errors_via_mock_handler() {
        use serde_json::Value;

        let rt = test_runtime();
        rt.set_session_id(Some("s".into()));
        rt.set_mock_handler(Box::new(|method: &str, _params: Value| -> Result<Value, String> {
            Err(format!("{method} mock error"))
        }));

        let err = rt.vcs_list_stashes().unwrap_err();
        assert!(err.contains("mock error"), "should propagate mock handler error: {err:?}");
    }
}
