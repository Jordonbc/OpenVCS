// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

use super::persistence_name;

#[test]
/// Verifies the app identity keeps legacy persistence name.
fn exposes_persistence_names() {
    assert_eq!(persistence_name(), "OpenVCS");
}
