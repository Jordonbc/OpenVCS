// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

#[test]
/// Verifies user-facing `VcsError` formatting remains informative.
fn vcs_error_formats_useful_messages() {
    let error = crate::core::VcsError::Unsupported(crate::core::BackendId::from("git"));
    assert!(error.to_string().contains("unsupported backend"));

    let error = crate::core::VcsError::Backend {
        backend: crate::core::BackendId::from("git"),
        msg: "boom".into(),
    };
    assert_eq!(error.to_string(), "git: boom");
}
