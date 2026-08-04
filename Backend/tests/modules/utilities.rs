// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later
use super::*;

#[test]
/// Confirms About UI metadata is sourced from compile-time package info.
fn gather_about_info_populates_expected_metadata() {
    let about = AboutInfo::gather();

    assert_eq!(about.name, env!("CARGO_PKG_NAME"));
    assert_eq!(about.version, env!("OPENVCS_VERSION"));
    assert_eq!(about.build, env!("OPENVCS_BUILD"));
    assert_eq!(about.os, std::env::consts::OS);
    assert_eq!(about.arch, std::env::consts::ARCH);
    assert_eq!(about.description, option_env!("CARGO_PKG_DESCRIPTION").unwrap_or(""));
    assert_eq!(about.homepage, option_env!("CARGO_PKG_HOMEPAGE").unwrap_or(""));
    assert_eq!(about.repository, option_env!("CARGO_PKG_REPOSITORY").unwrap_or(""));
    assert_eq!(about.authors, option_env!("CARGO_PKG_AUTHORS").unwrap_or(""));
}

#[test]
/// Confirms poisoned-lock recovery returns the held value.
fn recover_poisoned_recovers_value_from_poisoned_lock() {
    let mutex = std::sync::Mutex::new(7u32);
    // Poison the mutex by panicking while holding its guard.
    let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let _guard = mutex.lock().expect("lock");
        panic!("simulate lock holder panic");
    }));
    let poisoned = mutex.lock().expect_err("mutex should be poisoned");
    assert_eq!(*recover_poisoned(poisoned), 7);
}
