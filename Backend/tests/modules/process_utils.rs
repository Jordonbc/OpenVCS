// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

use super::hidden_command;
use std::ffi::OsStr;

#[test]
fn builds_command_with_requested_program() {
    let command = hidden_command("git");
    assert_eq!(command.get_program(), OsStr::new("git"));
}
