// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

use super::format_rpc_error;
use crate::plugin_runtime::protocol::RpcError;
use serde_json::json;

#[test]
fn formats_rpc_errors_with_nested_message() {
    let error = RpcError {
        code: 42,
        message: "outer".into(),
        data: Some(json!({"message": "inner"})),
    };
    assert_eq!(
        format_rpc_error("demo.plugin", "vcs.open", &error),
        "plugin 'demo.plugin' rpc 'vcs.open' failed (code 42): inner"
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
        "plugin 'demo.plugin' rpc 'vcs.open' failed (code 7): fallback"
    );
}
