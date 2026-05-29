// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

use super::{path_to_utf8, PluginVcsProxy};
use crate::core::{BackendId, VcsError};
use crate::plugin_runtime::node_instance::NodePluginRuntimeInstance;
use crate::plugin_runtime::spawn::SpawnConfig;
use std::path::PathBuf;
use std::sync::Arc;

fn test_proxy() -> PluginVcsProxy {
    let spawn = SpawnConfig {
        plugin_id: "demo.plugin".into(),
        exec_path: PathBuf::from("bin/plugin.mjs"),
        allowed_workspace_root: None,
        is_vcs_backend: true,
    };
    PluginVcsProxy {
        backend_id: BackendId::from("git"),
        workdir: PathBuf::from("/tmp/repo"),
        runtime: Arc::new(NodePluginRuntimeInstance::new(spawn)),
    }
}

#[test]
fn maps_runtime_errors() {
    let proxy = test_proxy();
    assert!(matches!(proxy.map_runtime_error("no upstream configured".into()), VcsError::NoUpstream));
    assert!(matches!(proxy.map_runtime_error("boom".into()), VcsError::Backend { .. }));
}

#[test]
fn converts_utf8_paths() {
    assert_eq!(path_to_utf8(std::path::Path::new("/tmp/repo")).unwrap(), "/tmp/repo");
}

#[cfg(unix)]
#[test]
fn rejects_non_utf8_paths() {
    use std::ffi::OsString;
    use std::os::unix::ffi::OsStringExt;

    let path = std::path::PathBuf::from(OsString::from_vec(vec![0xff, 0xfe]));
    assert!(path_to_utf8(&path).is_err());
}
