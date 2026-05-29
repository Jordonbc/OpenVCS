// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

use super::NodePluginRuntimeInstance;
use crate::plugin_runtime::spawn::SpawnConfig;
use serde_json::json;

fn test_runtime() -> NodePluginRuntimeInstance {
    NodePluginRuntimeInstance::new(SpawnConfig {
        plugin_id: "plugin.demo".into(),
        exec_path: std::path::PathBuf::from("plugin.mjs"),
        allowed_workspace_root: None,
        is_vcs_backend: true,
    })
}

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
    *runtime.vcs_session_id.lock() = Some("session-123".into());

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
