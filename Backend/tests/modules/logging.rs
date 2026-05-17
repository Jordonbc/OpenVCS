// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

use super::{clear_active_log_file, set_sentry_log_forwarding_enabled, LogTimer, ACTIVE_LOG_FILE, SENTRY_LOG_FORWARDING_ENABLED};
use std::fs::OpenOptions;
use std::io::Write;
use std::sync::{Arc, Mutex};

#[test]
/// Verifies log timer reports elapsed milliseconds.
fn measures_elapsed_time() {
    let timer = LogTimer::new("module", "operation");
    assert!(timer.elapsed_ms() <= 1_000);
}

#[test]
/// Verifies active log file truncation clears existing bytes.
fn clears_active_log_file_contents() {
    let dir = tempfile::tempdir().expect("create temp dir");
    let path = dir.path().join("openvcs.log");
    let mut file = OpenOptions::new().create(true).read(true).write(true).open(&path).expect("open log file");
    writeln!(file, "hello").expect("seed log file");
    let shared = Arc::new(Mutex::new(file));
    let _ = ACTIVE_LOG_FILE.set(shared);

    clear_active_log_file().expect("clear log file");
    let metadata = std::fs::metadata(&path).expect("stat log file");
    assert_eq!(metadata.len(), 0);
}

#[test]
/// Verifies sentry forwarding flag can be toggled.
fn toggles_sentry_forwarding_flag() {
    set_sentry_log_forwarding_enabled(true);
    assert!(SENTRY_LOG_FORWARDING_ENABLED.load(std::sync::atomic::Ordering::Relaxed));
    set_sentry_log_forwarding_enabled(false);
    assert!(!SENTRY_LOG_FORWARDING_ENABLED.load(std::sync::atomic::Ordering::Relaxed));
}
