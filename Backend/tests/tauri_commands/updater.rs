// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

use super::{
    available_update_status, download_progress_percent, no_update_status, progress_payload,
};

#[test]
fn builds_empty_update_status() {
    let status = no_update_status();
    assert!(!status.available);
    assert_eq!(status.version, None);
    assert_eq!(status.current_version, None);
    assert_eq!(status.body, None);
    assert_eq!(status.date, None);
}

#[test]
fn builds_available_update_status() {
    let status = available_update_status(
        "2.0.0".into(),
        "1.0.0".into(),
        Some("notes".into()),
        Some("2026-05-29".into()),
    );
    assert!(status.available);
    assert_eq!(status.version.as_deref(), Some("2.0.0"));
    assert_eq!(status.current_version.as_deref(), Some("1.0.0"));
    assert_eq!(status.body.as_deref(), Some("notes"));
    assert_eq!(status.date.as_deref(), Some("2026-05-29"));
}

#[test]
fn calculates_download_progress_percentages() {
    assert_eq!(download_progress_percent(25, 100), 25);
    assert_eq!(download_progress_percent(1, 0), 0);
}

#[test]
fn builds_progress_payloads() {
    let payload = progress_payload(12, 40);
    assert_eq!(payload["kind"], "progress");
    assert_eq!(payload["received"], 12);
    assert_eq!(payload["total"], 40);
}
