// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

use crate::core::BackendId;

use super::{auto_default_backend_id, backend_display_label};

#[test]
fn picks_backend_display_labels_from_backend_name_plugin_name_or_id() {
    let backend_id = BackendId::from("openvcs.git");

    assert_eq!(
        backend_display_label(Some(" Git "), Some("Plugin"), &backend_id),
        "Git"
    );
    assert_eq!(
        backend_display_label(None, Some(" Plugin Git "), &backend_id),
        "Plugin Git"
    );
    assert_eq!(backend_display_label(None, None, &backend_id), "openvcs.git");
}

#[test]
fn auto_selects_the_only_backend_when_default_differs() {
    let selected = auto_default_backend_id(
        "other",
        &[("openvcs.git".into(), "Git".into())],
    );
    assert_eq!(selected, Some("openvcs.git".into()));
}

#[test]
fn skips_auto_selection_when_backend_is_already_default_or_not_unique() {
    assert_eq!(
        auto_default_backend_id("openvcs.git", &[("openvcs.git".into(), "Git".into())]),
        None
    );
    assert_eq!(
        auto_default_backend_id(
            "",
            &[("git".into(), "Git".into()), ("hg".into(), "Hg".into())],
        ),
        None
    );
}
