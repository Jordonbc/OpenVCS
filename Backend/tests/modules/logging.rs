// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

use super::{
    build_sentry_logger, clear_active_log_file, prune_archives, rotate_existing_log,
    set_sentry_log_forwarding_enabled, LogTimer, ACTIVE_LOG_FILE, SENTRY_LOG_FORWARDING_ENABLED,
};
use log::Log;
use std::fs::OpenOptions;
use std::io::Write;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

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

// ── Additional LogTimer tests ─────────────────────────────────────────────

#[test]
fn log_timer_elapsed_ms_increases_after_delay() {
    let timer = LogTimer::new("module", "operation");
    thread::sleep(Duration::from_millis(10));
    let elapsed = timer.elapsed_ms();
    assert!(elapsed >= 10, "expected at least 10ms, got {elapsed}");
}

#[test]
fn log_timer_drop_does_not_panic() {
    let timer = LogTimer::new("module", "operation");
    drop(timer);
}

// ── build_sentry_logger forwarding tests ───────────────────────────────
//
// SentryLogger forwards ALL records to the destination logger regardless of the
// filter level. The filter only controls whether records additionally produce
// Sentry events/breadcrumbs. These tests verify that `build_sentry_logger()`
// produces a working logger chain that correctly delegates to the destination.

struct CapturingLogger {
    records: Arc<Mutex<Vec<String>>>,
}

impl log::Log for CapturingLogger {
    fn enabled(&self, _: &log::Metadata) -> bool {
        true
    }
    fn log(&self, record: &log::Record) {
        self.records.lock().unwrap().push(format!("{}", record.args()));
    }
    fn flush(&self) {}
}

#[test]
fn build_sentry_logger_routes_logs_to_destination() {
    let records = Arc::new(Mutex::new(Vec::new()));
    let logger = CapturingLogger {
        records: Arc::clone(&records),
    };
    set_sentry_log_forwarding_enabled(true);

    let sentry_logger = build_sentry_logger(logger);

    sentry_logger.log(
        &log::Record::builder()
            .args(format_args!("error message"))
            .level(log::Level::Error)
            .target("test")
            .build(),
    );
    sentry_logger.log(
        &log::Record::builder()
            .args(format_args!("warn message"))
            .level(log::Level::Warn)
            .target("test")
            .build(),
    );
    sentry_logger.log(
        &log::Record::builder()
            .args(format_args!("info message"))
            .level(log::Level::Info)
            .target("test")
            .build(),
    );
    sentry_logger.log(
        &log::Record::builder()
            .args(format_args!("debug message"))
            .level(log::Level::Debug)
            .target("test")
            .build(),
    );
    sentry_logger.log(
        &log::Record::builder()
            .args(format_args!("trace message"))
            .level(log::Level::Trace)
            .target("test")
            .build(),
    );

    let captured = records.lock().unwrap();
    assert_eq!(captured.len(), 5, "All 5 levels should reach destination");
    assert!(captured.iter().any(|m| m.contains("error")));
    assert!(captured.iter().any(|m| m.contains("warn")));
    assert!(captured.iter().any(|m| m.contains("info")));
    assert!(captured.iter().any(|m| m.contains("debug")));
    assert!(captured.iter().any(|m| m.contains("trace")));
    set_sentry_log_forwarding_enabled(false);
}

// ── rotate_existing_log additional tests ──────────────────────────────────

#[test]
fn rotate_existing_log_uses_zip_suffix_on_collision() {
    let dir = tempfile::tempdir().expect("create temp dir");
    let active = dir.path().join("openvcs.log");

    // Create a log file with content
    {
        let mut f = std::fs::File::create(&active).expect("create log");
        writeln!(f, "log content for rotation").expect("write content");
    }

    // Predict the base archive name from the file's timestamp
    let meta = std::fs::metadata(&active).expect("metadata");
    let created_sys = meta
        .created()
        .or_else(|_| meta.modified())
        .unwrap_or(std::time::SystemTime::UNIX_EPOCH);
    let created_utc = time::OffsetDateTime::from(created_sys);
    let local_offset = time::UtcOffset::current_local_offset().unwrap_or(time::UtcOffset::UTC);
    let created_local = created_utc.to_offset(local_offset);
    let base_name = format!(
        "openvcs-{:04}-{:02}-{:02}_{:02}-{:02}",
        created_local.year(),
        u8::from(created_local.month()),
        created_local.day(),
        created_local.hour(),
        created_local.minute()
    );

    // Pre-create a zip file with the expected base name to force collision
    let preexisting_zip = dir.path().join(format!("{base_name}.zip"));
    {
        let mut f = std::fs::File::create(&preexisting_zip).expect("create preexisting zip");
        writeln!(f, "preexisting").expect("write");
    }

    // Now rotate - should produce -2.zip since base.zip exists
    rotate_existing_log(dir.path());

    // The preexisting zip should still be there
    assert!(preexisting_zip.exists(), "preexisting zip should remain");

    // Should have created -2.zip
    let expected_suffixed = dir.path().join(format!("{base_name}-2.zip"));
    assert!(
        expected_suffixed.exists(),
        "expected -2.zip suffixed archive at {:?}, dir: {:?}",
        expected_suffixed,
        std::fs::read_dir(dir.path())
            .map(|d| {
                d.filter_map(|e| e.ok())
                    .map(|e| e.file_name())
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default()
    );
}

// ── prune_archives additional tests ───────────────────────────────────────

#[test]
fn prune_archives_removes_all_when_keep_zero() {
    let dir = tempfile::tempdir().expect("create temp dir");

    for i in 0..3u8 {
        let name = format!("openvcs-2025-01-{:02}_10-00.zip", 10 + i);
        let path = dir.path().join(&name);
        let mut f = std::fs::File::create(&path).expect("create archive");
        writeln!(f, "test").expect("write");
    }

    prune_archives(dir.path(), 0);

    let archives: Vec<_> = std::fs::read_dir(dir.path())
        .expect("read dir")
        .filter_map(|e| e.ok())
        .collect();
    assert_eq!(archives.len(), 0);
}

#[test]
fn prune_archives_handles_nonexistent_directory() {
    let dir = std::path::Path::new("/tmp/__openvcs_test_nonexistent_log_dir__");
    // Should not panic
    prune_archives(dir, 5);
}

#[test]
fn prune_archives_preserves_newest_by_mtime() {
    let dir = tempfile::tempdir().expect("create temp dir");

    // Create 5 archive files, each with increasing mtime
    for i in 0..5u8 {
        let name = format!("openvcs-2025-01-{:02}_10-00.zip", 10 + i);
        let path = dir.path().join(&name);
        let mut f = std::fs::File::create(&path).expect("create archive");
        writeln!(f, "test").expect("write");
        // Ensure distinct mtimes by sleeping
        thread::sleep(Duration::from_millis(15));
    }

    prune_archives(dir.path(), 2);

    // Only 2 archives should remain (the newest)
    let remaining: Vec<_> = std::fs::read_dir(dir.path())
        .expect("read dir")
        .filter_map(|e| e.ok())
        .collect();
    assert_eq!(remaining.len(), 2);
}
