// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

use super::{read_framed_message, write_framed_message, Methods, NotificationMethods, RpcError, RpcRequest, RpcResponse, PROTOCOL_VERSION};
use serde_json::json;
use std::io::{BufReader, Cursor};

#[test]
/// Verifies protocol constants stay stable.
fn exposes_stable_protocol_constants() {
    assert_eq!(PROTOCOL_VERSION, 1);
    assert_eq!(Methods::PLUGIN_INITIALIZE, "plugin.initialize");
    assert_eq!(Methods::VCS_GET_STATUS_SUMMARY, "vcs.get_status_summary");
    assert_eq!(NotificationMethods::HOST_LOG, "host.log");
    assert_eq!(NotificationMethods::VCS_EVENT, "vcs.event");
}

#[test]
/// Verifies framed write/read round-trip.
fn round_trips_framed_json_messages() {
    let value = json!({"jsonrpc":"2.0","id":7,"method":"ping","params":{"ok":true}});
    let mut buf = Vec::new();
    write_framed_message(&mut buf, &value).expect("write framed message");

    let text = String::from_utf8(buf).expect("utf8 frame");
    assert!(text.starts_with("Content-Length: "));
    assert!(text.contains("\r\n\r\n"));

    let mut reader = BufReader::new(Cursor::new(text.into_bytes()));
    let decoded = read_framed_message(&mut reader).expect("read framed message");
    assert_eq!(decoded, value);
}

#[test]
/// Verifies framed reader rejects invalid or incomplete headers.
fn rejects_bad_rpc_frames() {
    let mut missing_header = BufReader::new(Cursor::new(b"\r\n{}".to_vec()));
    let err = read_framed_message(&mut missing_header).expect_err("missing header should fail");
    assert!(err.contains("missing Content-Length"));

    let mut invalid_header = BufReader::new(Cursor::new(b"Foo: bar\r\n\r\n{}".to_vec()));
    let err = read_framed_message(&mut invalid_header).expect_err("invalid header should fail");
    assert!(err.contains("missing Content-Length"));
}

#[test]
/// Verifies JSON-RPC structs serialize as expected.
fn serializes_rpc_structs() {
    let request = RpcRequest {
        jsonrpc: "2.0".into(),
        id: 1,
        method: "ping".into(),
        params: json!({"value": 1}),
    };
    let response = RpcResponse {
        jsonrpc: "2.0".into(),
        id: 1,
        result: Some(json!({"ok": true})),
        error: None,
    };
    let error = RpcError {
        code: -32600,
        message: "bad request".into(),
        data: Some(json!({"reason": "oops"})),
    };

    assert_eq!(serde_json::to_value(&request).expect("serialize request")["method"], "ping");
    assert_eq!(serde_json::to_value(&response).expect("serialize response")["result"]["ok"], true);
    assert_eq!(serde_json::to_value(&error).expect("serialize error")["code"], -32600);
}
