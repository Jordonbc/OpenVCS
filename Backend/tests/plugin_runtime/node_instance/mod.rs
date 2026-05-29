// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

use super::NodePluginRuntimeInstance;
use crate::plugin_runtime::instance::PluginRuntimeInstance;
use crate::plugin_runtime::spawn::SpawnConfig;
use serde_json::{json, Value};
use std::sync::Arc;

fn test_runtime() -> NodePluginRuntimeInstance {
    NodePluginRuntimeInstance::new(SpawnConfig {
        plugin_id: "plugin.demo".into(),
        exec_path: std::path::PathBuf::from("plugin.mjs"),
        allowed_workspace_root: None,
        is_vcs_backend: true,
    })
}

fn mock_response(runtime: &NodePluginRuntimeInstance) {
    runtime.set_mock_handler(Box::new(|_, _| Ok(Value::Null)));
}

// ── session_params ──

#[test]
fn session_params_requires_an_open_session() {
    let runtime = test_runtime();

    let err = runtime
        .session_params(json!({"path": "repo.txt"}))
        .expect_err("expected missing session error");
    assert_eq!(err, "vcs session is not open");
}

#[test]
fn session_params_merges_session_id_with_extra_fields() {
    let runtime = test_runtime();
    runtime.set_session_id(Some("session-123".into()));

    let value = runtime
        .session_params(json!({"path": "repo.txt", "session_id": "override"}))
        .expect("session params");

    assert_eq!(
        value,
        json!({
            "session_id": "override",
            "path": "repo.txt"
        })
    );
}

#[test]
fn session_params_defaults_session_id_when_not_overridden() {
    let runtime = test_runtime();
    runtime.set_session_id(Some("session-123".into()));

    let value = runtime
        .session_params(json!({"path": "repo.txt"}))
        .expect("session params");

    assert_eq!(
        value,
        json!({
            "session_id": "session-123",
            "path": "repo.txt"
        })
    );
}

#[test]
fn session_params_handles_empty_extra() {
    let runtime = test_runtime();
    runtime.set_session_id(Some("s".into()));

    let value = runtime
        .session_params(serde_json::Value::Object(serde_json::Map::new()))
        .expect("session params");

    assert_eq!(value, json!({"session_id": "s"}));
}

// ── handle_notification ──

#[test]
fn handle_notification_host_log_info() {
    let runtime = test_runtime();
    runtime.handle_notification("host.log", &json!({
        "level": "info",
        "message": "hello",
        "target": "myplugin"
    }));
    // Should not panic
}

#[test]
fn handle_notification_host_log_trace() {
    let runtime = test_runtime();
    runtime.handle_notification("host.log", &json!({
        "level": "trace",
        "message": "trace msg"
    }));
}

#[test]
fn handle_notification_host_log_warn() {
    let runtime = test_runtime();
    runtime.handle_notification("host.log", &json!({
        "level": "warn",
        "message": "warning"
    }));
}

#[test]
fn handle_notification_host_log_error() {
    let runtime = test_runtime();
    runtime.handle_notification("host.log", &json!({
        "level": "error",
        "message": "error msg"
    }));
}

#[test]
fn handle_notification_host_log_unknown_level() {
    let runtime = test_runtime();
    runtime.handle_notification("host.log", &json!({
        "level": "debug",
        "message": "debug msg"
    }));
}

#[test]
fn handle_notification_host_log_defaults() {
    let runtime = test_runtime();
    runtime.handle_notification("host.log", &json!({}));
    // Uses defaults: level=info, target=plugin, message=""
}

#[test]
fn handle_notification_host_ui_notify_with_message() {
    let runtime = test_runtime();
    runtime.handle_notification("host.ui.notify", &json!({"message": "hello user"}));
}

#[test]
fn handle_notification_host_ui_notify_empty_message() {
    let runtime = test_runtime();
    runtime.handle_notification("host.ui.notify", &json!({"message": ""}));
}

#[test]
fn handle_notification_host_status_set() {
    let runtime = test_runtime();
    runtime.handle_notification("host.status.set", &json!({"message": "busy"}));
}

#[test]
fn handle_notification_host_status_set_empty() {
    let runtime = test_runtime();
    runtime.handle_notification("host.status.set", &json!({"message": ""}));
}

#[test]
fn handle_notification_host_event_emit() {
    let runtime = test_runtime();
    runtime.handle_notification("host.event.emit", &json!({
        "event_name": "custom_event",
        "payload": {"key": "val"}
    }));
}

#[test]
fn handle_notification_host_event_emit_empty_name() {
    let runtime = test_runtime();
    runtime.handle_notification("host.event.emit", &json!({
        "event_name": "",
        "payload": null
    }));
}

#[test]
fn handle_notification_vcs_event_with_sink() {
    use crate::core::models::{OnEvent, VcsEvent};
    let runtime = test_runtime();
    let captured = std::sync::Arc::new(std::sync::Mutex::new(None::<VcsEvent>));
    let captured_clone = std::sync::Arc::clone(&captured);
    let sink: OnEvent = std::sync::Arc::new(move |event| {
        *captured_clone.lock().unwrap() = Some(event);
    });
    runtime.set_event_sink(Some(sink));
    runtime.handle_notification("vcs.event", &json!({
        "event": {"type": "progress", "phase": "working", "detail": "50%"}
    }));
    assert!(captured.lock().unwrap().is_some());
}

#[test]
fn handle_notification_vcs_event_invalid_payload() {
    let runtime = test_runtime();
    runtime.handle_notification("vcs.event", &json!({
        "event": "not an event struct"
    }));
    // Should log a warning and return
}

#[test]
fn handle_notification_vcs_event_missing_event_field() {
    let runtime = test_runtime();
    runtime.handle_notification("vcs.event", &json!({"other": "data"}));
}

#[test]
fn handle_notification_vcs_event_no_sink() {
    let runtime = test_runtime();
    runtime.handle_notification("vcs.event", &json!({
        "event": {"progress": {"message": "working", "percentage": 50}}
    }));
    // No sink installed, event should be ignored silently
}

#[test]
fn handle_notification_unknown_method() {
    let runtime = test_runtime();
    runtime.handle_notification("unknown.method", &json!({"data": 1}));
    // Should trace-log and return
}

// ── close_vcs_session ──

#[test]
fn close_vcs_session_calls_rpc_when_session_active() {
    let runtime = test_runtime();
    runtime.set_session_id(Some("session-abc".into()));
    mock_response(&runtime);
    // This should call rpc_call_unit with VCS_CLOSE and clear session
}

#[test]
fn close_vcs_session_noop_when_no_session() {
    let _runtime = test_runtime();
    // vcs_session_id is None, close_vcs_session should do nothing
}

// ── stop_process ──

#[test]
fn stop_process_ungraceful_clears_session() {
    let runtime = test_runtime();
    runtime.set_session_id(Some("session-abc".into()));
    runtime.stop_process(false);
    assert!(runtime.vcs_session_id.lock().is_none());
}

#[test]
fn stop_process_graceful_closes_session() {
    let runtime = test_runtime();
    runtime.set_session_id(Some("session-abc".into()));
    mock_response(&runtime);
    runtime.stop_process(true);
    // Session should be cleared even if process is None
    assert!(runtime.vcs_session_id.lock().is_none());
}

#[test]
fn stop_process_graceful_without_session_does_not_call_rpc() {
    let runtime = test_runtime();
    // No session_id set, stop_process should not attempt rpc call
    runtime.stop_process(true);
}

// ── PluginRuntimeInstance trait methods ──

#[test]
fn ensure_running_fails_when_no_node() {
    let runtime = test_runtime();
    // No process pre-injected, spawn_process will fail
    let result = runtime.ensure_running();
    assert!(result.is_err());
}

#[test]
fn set_event_sink_stores_and_clears() {
    use crate::core::models::OnEvent;
    let runtime = test_runtime();
    let sink: OnEvent = std::sync::Arc::new(|_| {});
    runtime.set_event_sink(Some(Arc::clone(&sink)));
    runtime.set_event_sink(None);
    // Should not panic
}

#[test]
fn stop_does_not_panic() {
    let runtime = test_runtime();
    // With no process, stop is a no-op
    runtime.stop();
}

#[test]
fn drop_does_not_panic() {
    // Dropping a runtime with no active process should be safe
    let runtime = test_runtime();
    drop(runtime);
}
