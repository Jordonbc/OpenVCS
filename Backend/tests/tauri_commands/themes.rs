// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

use std::collections::HashSet;

use crate::themes::ThemeSource;

use super::{normalize_plugin_id, theme_allowed_for_enabled_plugins};

#[test]
fn normalizes_plugin_ids_for_theme_filtering() {
    assert_eq!(normalize_plugin_id(Some(" OpenVCS.Git ")), "openvcs.git");
    assert_eq!(normalize_plugin_id(Some("   ")), "");
    assert_eq!(normalize_plugin_id(None), "");
}

#[test]
fn always_allows_non_plugin_themes() {
    let enabled = HashSet::new();
    assert!(theme_allowed_for_enabled_plugins(&ThemeSource::BuiltIn, None, &enabled));
    assert!(theme_allowed_for_enabled_plugins(&ThemeSource::User, None, &enabled));
}

#[test]
fn only_allows_plugin_themes_from_enabled_plugins() {
    let enabled = HashSet::from(["openvcs.git".to_string()]);

    assert!(theme_allowed_for_enabled_plugins(
        &ThemeSource::Plugin,
        Some(" OpenVCS.Git "),
        &enabled,
    ));
    assert!(!theme_allowed_for_enabled_plugins(
        &ThemeSource::Plugin,
        Some("openvcs.hg"),
        &enabled,
    ));
    assert!(!theme_allowed_for_enabled_plugins(
        &ThemeSource::Plugin,
        Some("   "),
        &enabled,
    ));
}
