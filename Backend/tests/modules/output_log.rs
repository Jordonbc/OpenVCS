// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

use super::{OutputLevel, OutputLogEntry};

#[test]
/// Verifies output log entries build and serialize predictably.
fn builds_output_log_entries() {
    let entry = OutputLogEntry::new(123, OutputLevel::Warn, "git", "oops");
    assert_eq!(entry.ts_ms, 123);
    assert_eq!(entry.source, "git");
    assert_eq!(entry.message, "oops");
    assert_eq!(serde_json::to_value(&entry).expect("serialize entry")["level"], "warn");
}
