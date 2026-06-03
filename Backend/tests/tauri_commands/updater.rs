// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

use tauri::test::{mock_builder, mock_context, noop_assets};

use super::{
    available_update_status, download_progress_percent, no_update_status, progress_payload,
    UpdateStatus,
};

// ── Existing tests (unchanged) ──

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

// ── download_progress_percent edge cases ──

#[test]
fn download_progress_percent_edge_cases() {
    // Zero received, positive total → 0%
    assert_eq!(download_progress_percent(0, 100), 0);
    // Zero over zero → zero guard
    assert_eq!(download_progress_percent(0, 0), 0);
    // Full download → 100%
    assert_eq!(download_progress_percent(100, 100), 100);
    // Partial fraction → integer truncation
    assert_eq!(download_progress_percent(50, 200), 25);
    // Received exceeds total → overflow allowed
    assert_eq!(download_progress_percent(150, 100), 150);
    // Large numbers still compute cleanly
    assert_eq!(download_progress_percent(1_000_000, 2_000_000), 50);
    assert_eq!(download_progress_percent(500_000, 1_000_000), 50);
    // Single byte received
    assert_eq!(download_progress_percent(1, 1_000_000), 0);
}

// ── progress_payload edge cases ──

#[test]
fn progress_payload_edge_cases() {
    // Zero/zero payload
    let payload = progress_payload(0, 0);
    assert_eq!(payload["kind"], "progress");
    assert_eq!(payload["received"], 0);
    assert_eq!(payload["total"], 0);

    // Large values
    let payload = progress_payload(1_000_000_000, 2_000_000_000);
    assert_eq!(payload["kind"], "progress");
    assert_eq!(payload["received"], 1_000_000_000u64);
    assert_eq!(payload["total"], 2_000_000_000u64);

    // Max single-field, zero total
    let payload = progress_payload(42, 0);
    assert_eq!(payload["kind"], "progress");
    assert_eq!(payload["received"], 42);
    assert_eq!(payload["total"], 0);
}

// ── available_update_status edge cases ──

#[test]
fn available_update_status_with_none_fields() {
    let status = available_update_status("2.0.0".into(), "1.0.0".into(), None, None);
    assert!(status.available);
    assert_eq!(status.version.as_deref(), Some("2.0.0"));
    assert_eq!(status.current_version.as_deref(), Some("1.0.0"));
    assert_eq!(status.body, None);
    assert_eq!(status.date, None);
}

#[test]
fn available_update_status_with_empty_version() {
    let status = available_update_status("".into(), "".into(), None, None);
    assert!(status.available);
    assert_eq!(status.version.as_deref(), Some(""));
    assert_eq!(status.current_version.as_deref(), Some(""));
}

// ── UpdateStatus serialization tests ──

#[test]
fn update_status_serialization_all_none() {
    let status = UpdateStatus {
        available: false,
        version: None,
        current_version: None,
        body: None,
        date: None,
    };
    let json = serde_json::to_value(&status).expect("serialize UpdateStatus");
    assert_eq!(json["available"], false);
    assert!(json["version"].is_null());
    assert!(json["current_version"].is_null());
    assert!(json["body"].is_null());
    assert!(json["date"].is_null());
}

#[test]
fn update_status_serialization_all_some() {
    let status = UpdateStatus {
        available: true,
        version: Some("2.0.0".into()),
        current_version: Some("1.0.0".into()),
        body: Some("Release notes here".into()),
        date: Some("2026-06-03".into()),
    };
    let json = serde_json::to_value(&status).expect("serialize UpdateStatus");
    assert_eq!(json["available"], true);
    assert_eq!(json["version"], "2.0.0");
    assert_eq!(json["current_version"], "1.0.0");
    assert_eq!(json["body"], "Release notes here");
    assert_eq!(json["date"], "2026-06-03");
}

#[test]
fn no_update_status_serialization_matches_expected_json() {
    let status = no_update_status();
    let json = serde_json::to_value(&status).expect("serialize");
    assert_eq!(json["available"], false);
    assert!(json["version"].is_null());
    assert!(json["current_version"].is_null());
    assert!(json["body"].is_null());
    assert!(json["date"].is_null());
}

#[test]
fn available_update_status_serialization_matches_expected_json() {
    let status = available_update_status(
        "3.0.0".into(),
        "2.9.9".into(),
        Some("Bug fixes".into()),
        Some("2026-06-01".into()),
    );
    let json = serde_json::to_value(&status).expect("serialize");
    assert_eq!(json["available"], true);
    assert_eq!(json["version"], "3.0.0");
    assert_eq!(json["current_version"], "2.9.9");
    assert_eq!(json["body"], "Bug fixes");
    assert_eq!(json["date"], "2026-06-01");
}

// ── Handler registration smoke test ──

#[test]
fn updater_command_handlers_register() {
    // Verifies that the IPC command handlers compile and can be registered
    // with a mock Tauri runtime. The updater plugin is not loaded here, so
    // actual invocation would fail — this is a compile-time guard.
    let _app = mock_builder()
        .invoke_handler(tauri::generate_handler![
            super::get_update_status,
            super::updater_install_now,
        ])
        .build(mock_context(noop_assets()))
        .expect("build test app with updater handlers");
}
