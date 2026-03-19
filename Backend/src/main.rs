// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

/// Binary entrypoint that launches the backend runtime.
///
/// # Returns
/// - `()`.
fn main() {
    openvcs_lib::run()
}
