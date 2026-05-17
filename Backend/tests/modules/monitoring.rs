// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

use super::{parse_frontend_level, parse_frontend_location, parse_frontend_stacktrace};

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
