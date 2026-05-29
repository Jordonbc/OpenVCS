// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

use super::{
    backend_monitoring_allowed, normalize_env_value, parse_frontend_level,
    parse_frontend_location, parse_frontend_stacktrace,
};
use crate::settings::AppConfig;

#[test]
fn parses_frontend_location_suffix() {
    let parsed = parse_frontend_location("app://index.js:12:34");
    assert_eq!(parsed, Some(("app://index.js".into(), Some(12), Some(34))));
}

#[test]
fn parses_frontend_stacktrace_frames() {
    let stacktrace = parse_frontend_stacktrace(Some(
        "Error: boom\n    at alpha (app://index.js:2:3)\n    at beta (app://index.js:4:5)",
    ))
    .expect("stacktrace expected");

    assert_eq!(stacktrace.frames.len(), 2);
    assert_eq!(stacktrace.frames[0].function.as_deref(), Some("beta"));
    assert_eq!(stacktrace.frames[0].lineno, Some(4));
    assert_eq!(stacktrace.frames[1].function.as_deref(), Some("alpha"));
    assert_eq!(stacktrace.frames[1].colno, Some(3));
}

#[test]
fn maps_frontend_levels_to_sentry_levels() {
    assert_eq!(parse_frontend_level("warning"), sentry::Level::Warning);
    assert_eq!(parse_frontend_level("error"), sentry::Level::Error);
    assert_eq!(parse_frontend_level("other"), sentry::Level::Debug);
}

#[test]
fn normalizes_environment_values() {
    assert_eq!(normalize_env_value(Some("  desktop  ".into())), Some("desktop".into()));
    assert_eq!(normalize_env_value(Some("   ".into())), None);
    assert_eq!(normalize_env_value(None), None);
}

#[test]
fn honors_backend_crash_report_consent() {
    let mut cfg = AppConfig::default();
    cfg.general.crash_reports = true;
    assert!(backend_monitoring_allowed(&cfg));

    cfg.general.crash_reports = false;
    assert!(!backend_monitoring_allowed(&cfg));
}

#[test]
fn skips_empty_or_invalid_frontend_stack_data() {
    assert!(parse_frontend_stacktrace(None).is_none());
    assert!(parse_frontend_stacktrace(Some("   ")).is_none());
    assert_eq!(parse_frontend_location("not-a-location"), None);
    assert_eq!(parse_frontend_location(":12:34"), None);
}
