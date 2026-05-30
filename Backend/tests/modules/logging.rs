// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

use super::{
    build_sentry_logger, clear_active_log_file, prune_archives, rotate_existing_log,
    set_sentry_log_forwarding_enabled, LogTimer, ACTIVE_LOG_FILE, SENTRY_LOG_FORWARDING_ENABLED,
};
use std::fs::OpenOptions;
use std::io::Write;
use std::sync::{Arc, Mutex};

// ── LogTimer tests ─────────────────────────────────────────────────────────

#[test]
fn log_timer_elapsed_ms_returns_non_zero_value() {
    let timer = LogTimer::new("module", "operation");
    assert!(timer.elapsed_ms() <= 1_000);
}

// ── clear_active_log_file tests ────────────────────────────────────────────

#[test]
fn clear_active_log_file_truncates_existing_content() {
    let dir = tempfile::tempdir().expect("create temp dir");
    let path = dir.path().join("openvcs.log");
    let mut file = OpenOptions::new()
        .create(true)
        .truncate(true)
        .read(true)
        .write(true)
        .open(&path)
        .expect("open log file");
    writeln!(file, "hello").expect("seed log file");
    let shared = Arc::new(Mutex::new(file));
    let _ = ACTIVE_LOG_FILE.set(shared);

    clear_active_log_file().expect("clear log file");
    let metadata = std::fs::metadata(&path).expect("stat log file");
    assert_eq!(metadata.len(), 0);
}

#[test]
fn clear_active_log_file_is_noop_when_not_initialized() {
    // When ACTIVE_LOG_FILE is not set, clear should succeed as a no-op.
    assert!(clear_active_log_file().is_ok());
}

// ── Sentry forwarding tests ────────────────────────────────────────────────

#[test]
fn sentry_forwarding_flag_can_be_toggled() {
    set_sentry_log_forwarding_enabled(true);
    assert!(SENTRY_LOG_FORWARDING_ENABLED.load(std::sync::atomic::Ordering::Relaxed));
    set_sentry_log_forwarding_enabled(false);
    assert!(!SENTRY_LOG_FORWARDING_ENABLED.load(std::sync::atomic::Ordering::Relaxed));
}

#[test]
fn build_sentry_logger_creates_logger_without_panicking() {
    // A minimal logger that discards records.
    struct NullLogger;
    impl log::Log for NullLogger {
        fn enabled(&self, _: &log::Metadata) -> bool {
            true
        }
        fn log(&self, _: &log::Record) {}
        fn flush(&self) {}
    }

    // build_sentry_logger should not panic for any forwarding state.
    set_sentry_log_forwarding_enabled(true);
    let _logger = build_sentry_logger(NullLogger);

    set_sentry_log_forwarding_enabled(false);
    let _logger = build_sentry_logger(NullLogger);
}

// ── prune_archives tests ───────────────────────────────────────────────────

#[test]
fn prune_archives_removes_excess_archives() {
    let dir = tempfile::tempdir().expect("create temp dir");

    // Create 5 archive-like files, keep only 2.
    for i in 0..5u8 {
        let name = format!("openvcs-2025-01-{:02}_10-00.zip", 10 + i);
        let path = dir.path().join(&name);
        let mut f = std::fs::File::create(&path).expect("create archive");
        writeln!(f, "test").expect("write archive content");
    }

    let before: Vec<_> = std::fs::read_dir(dir.path())
        .expect("read dir")
        .filter_map(|e| e.ok())
        .collect();
    assert_eq!(before.len(), 5);

    prune_archives(dir.path(), 2);

    let after: Vec<_> = std::fs::read_dir(dir.path())
        .expect("read dir")
        .filter_map(|e| e.ok())
        .collect();
    assert_eq!(after.len(), 2);
}

#[test]
fn prune_archives_noop_when_below_limit() {
    let dir = tempfile::tempdir().expect("create temp dir");

    for i in 0..2u8 {
        let name = format!("openvcs-2025-01-{:02}_10-00.zip", 10 + i);
        let path = dir.path().join(&name);
        let mut f = std::fs::File::create(&path).expect("create archive");
        writeln!(f, "test").expect("write archive content");
    }

    prune_archives(dir.path(), 5);

    let after: Vec<_> = std::fs::read_dir(dir.path())
        .expect("read dir")
        .filter_map(|e| e.ok())
        .collect();
    assert_eq!(after.len(), 2);
}

#[test]
fn prune_archives_ignores_non_archive_files() {
    let dir = tempfile::tempdir().expect("create temp dir");

    // Create valid archives
    for i in 0..4u8 {
        let name = format!("openvcs-2025-01-{:02}_10-00.zip", 10 + i);
        let path = dir.path().join(&name);
        let mut f = std::fs::File::create(&path).expect("create archive");
        writeln!(f, "test").expect("write archive content");
    }
    // Create a non-archive file that should be ignored
    let path = dir.path().join("not-an-archive.txt");
    let mut f = std::fs::File::create(&path).expect("create unrelated file");
    writeln!(f, "keep me").expect("write");

    prune_archives(dir.path(), 2);

    let after: Vec<_> = std::fs::read_dir(dir.path())
        .expect("read dir")
        .filter_map(|e| e.ok())
        .collect();
    // Should keep the unrelated file + 2 archives = 3 files
    assert_eq!(after.len(), 3);
}

#[test]
fn prune_archives_is_noop_for_empty_dirs() {
    let dir = tempfile::tempdir().expect("create temp dir");
    // Should not panic on empty directory
    prune_archives(dir.path(), 5);
}

// ── rotate_existing_log tests ──────────────────────────────────────────────

#[test]
fn rotate_existing_log_skips_missing_files() {
    let dir = tempfile::tempdir().expect("create temp dir");
    // Should not panic when there's no active log file
    rotate_existing_log(dir.path());
}

#[test]
fn rotate_existing_log_skips_empty_files() {
    let dir = tempfile::tempdir().expect("create temp dir");
    let active = dir.path().join("openvcs.log");
    {
        let _f = std::fs::File::create(&active).expect("create empty log");
    }
    rotate_existing_log(dir.path());
    // No archive should have been created for an empty file
    let entries: Vec<_> = std::fs::read_dir(dir.path())
        .expect("read dir")
        .filter_map(|e| e.ok())
        .collect();
    assert_eq!(entries.len(), 1); // Only the empty openvcs.log
}

#[test]
fn rotate_existing_log_creates_zip_archive() {
    let dir = tempfile::tempdir().expect("create temp dir");
    let active = dir.path().join("openvcs.log");
    {
        let mut f = std::fs::File::create(&active).expect("create log");
        writeln!(f, "this is a test log entry for rotation").expect("write content");
    }
    rotate_existing_log(dir.path());

    // The active log should now be removed (or the zip created)
    let entries: Vec<String> = std::fs::read_dir(dir.path())
        .expect("read dir")
        .filter_map(|e| e.ok())
        .map(|e| e.file_name().to_string_lossy().to_string())
        .collect();
    // Should have a zip archive
    assert!(
        entries.iter().any(|name| name.ends_with(".zip")),
        "expected a zip archive, got: {:?}",
        entries
    );
    // The original log should be removed after rotation
    assert!(
        !entries.iter().any(|name| name == "openvcs.log"),
        "active log should be removed after rotation, got: {:?}",
        entries
    );
}
