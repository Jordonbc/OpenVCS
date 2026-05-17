// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

use super::normalize_log_limit;

#[test]
/// Verifies the default history limit remains 100 commits.
fn normalize_log_limit_defaults_to_100() {
    assert_eq!(normalize_log_limit(None), Some(100));
}

#[test]
/// Verifies a zero limit requests the full history.
fn normalize_log_limit_treats_zero_as_unlimited() {
    assert_eq!(normalize_log_limit(Some(0)), None);
}

#[test]
/// Verifies large limits are clamped to the backend cap.
fn normalize_log_limit_clamps_large_values() {
    assert_eq!(normalize_log_limit(Some(2_000)), Some(1_000));
}
