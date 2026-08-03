// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

use super::*;

#[test]
fn validate_normalizes_invalid_values() {
    let mut cfg = AppConfig::default();
    cfg.general.theme_pack = "  ".into();
    cfg.general.default_backend = "   ".into();
    cfg.vcs.backend = "  git  ".into();
    cfg.vcs.default_branch = "   ".into();
    cfg.vcs.ssh_binary = SshBinary::Custom;
    cfg.vcs.ssh_path = "   ".into();
    cfg.diff.tab_width = 0;
    cfg.diff.max_file_size_mb = 9_999;
    cfg.plugin = vec![" openvcs.git ".into(), "".into(), "openvcs.git".into()];
    cfg.plugins.disabled = vec![" OpenVCS.Git ".into(), "".into(), "openvcs.git".into()];
    cfg.plugins.enabled = vec![
        " openvcs.git ".into(),
        "other.plugin".into(),
        "other.plugin".into(),
    ];
    cfg.ux.recents_limit = 0;
    cfg.logging.retain_archives = 0;

    cfg.validate();

    assert_eq!(cfg.general.theme_pack, "default");
    assert_eq!(cfg.general.default_backend, DEFAULT_BACKEND_ID);
    assert_eq!(cfg.vcs.backend, "git");
    assert_eq!(cfg.vcs.default_branch, "main");
    assert_eq!(cfg.vcs.ssh_binary, SshBinary::Auto);
    assert_eq!(cfg.diff.tab_width, 1);
    assert_eq!(cfg.diff.max_file_size_mb, 1_024);
    assert_eq!(cfg.plugin, vec!["openvcs.git"]);
    assert_eq!(cfg.plugins.disabled, vec!["openvcs.git"]);
    assert_eq!(cfg.plugins.enabled, vec!["other.plugin"]);
    assert_eq!(cfg.ux.recents_limit, 1);
    assert_eq!(cfg.logging.retain_archives, 1);
}

#[test]
fn evaluates_plugin_enablement_consistently() {
    let mut cfg = AppConfig::default();
    cfg.plugins.disabled = vec!["OpenVCS.Git".into()];
    cfg.plugins.enabled = vec!["other.plugin".into(), "OPENVCS.GIT".into()];

    assert!(!cfg.is_plugin_enabled("openvcs.git", false));
    assert!(!cfg.is_plugin_enabled("   ", true));

    cfg.plugins.disabled.clear();
    assert!(cfg.is_plugin_enabled("openvcs.git", false));
    assert!(cfg.is_plugin_enabled("openvcs.git", true));
    assert!(cfg.is_plugin_enabled("other.plugin", false));
}
