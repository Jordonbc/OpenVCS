// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

/// Binary entrypoint that launches the backend runtime.
///
/// # Returns
/// - `()`.
fn main() {
    openvcs_lib::run()
}
