// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later
use tauri::{Manager, Runtime, WebviewUrl, WebviewWindowBuilder, Window};

use crate::output_log::OutputLogEntry;
use crate::state::AppState;

/// Reads up to the last `max_lines` lines from a log file efficiently.
///
/// # Parameters
/// - `path`: Log file path.
/// - `max_lines`: Maximum lines to return.
///
/// # Returns
/// - `Ok(Vec<String>)` log lines.
/// - `Err(std::io::Error)` on file IO failure.
fn read_last_lines(path: &std::path::Path, max_lines: usize) -> std::io::Result<Vec<String>> {
    use std::io::{Read, Seek};

    let mut file = std::fs::File::open(path)?;
    let file_len = file.metadata()?.len();
    if file_len == 0 {
        return Ok(vec![]);
    }

    let mut chunks: Vec<Vec<u8>> = Vec::new();
    let mut newline_count: usize = 0;
    let mut pos = file_len;
    let chunk_size: u64 = 8 * 1024;

    while pos > 0 && newline_count <= max_lines {
        let start = pos.saturating_sub(chunk_size);
        let read_len = (pos - start) as usize;

        file.seek(std::io::SeekFrom::Start(start))?;
        let mut buf = vec![0u8; read_len];
        file.read_exact(&mut buf)?;

        newline_count += buf.iter().filter(|&&b| b == b'\n').count();
        chunks.push(buf);

        pos = start;
    }

    let total_len: usize = chunks.iter().map(|c| c.len()).sum();
    let mut data = Vec::with_capacity(total_len);
    for chunk in chunks.into_iter().rev() {
        data.extend_from_slice(&chunk);
    }

    let text = String::from_utf8_lossy(&data);
    Ok(text.lines().map(|s| s.to_string()).collect())
}

#[tauri::command]
/// Returns the current in-memory VCS/output log.
///
/// # Parameters
/// - `state`: Shared application state.
///
/// # Returns
/// - A cloned list of output log entries.
pub fn get_output_log(state: tauri::State<'_, AppState>) -> Vec<OutputLogEntry> {
    state.output_log()
}

#[tauri::command]
/// Clears the in-memory VCS/output log.
///
/// # Parameters
/// - `state`: Shared application state.
///
/// # Returns
/// - `()`.
pub fn clear_output_log(state: tauri::State<'_, AppState>) {
    state.clear_output_log();
}

#[tauri::command]
/// Reads and returns recent lines from `logs/openvcs.log`.
///
/// # Parameters
/// - `max_lines`: Optional number of lines to return (clamped).
///
/// # Returns
/// - Parsed log lines converted to [`OutputLogEntry`] values.
pub fn tail_app_log(max_lines: Option<usize>) -> Vec<OutputLogEntry> {
    use crate::output_log::{OutputLevel, OutputLogEntry};

    let max_lines = max_lines.unwrap_or(1500).clamp(1, 10_000);
    let path = std::path::Path::new("logs").join("openvcs.log");

    let Ok(lines) = read_last_lines(&path, max_lines) else {
        return vec![];
    };

    let start = lines.len().saturating_sub(max_lines);
    lines[start..]
        .iter()
        .map(|line| OutputLogEntry::new(0, OutputLevel::Info, "app", line.clone()))
        .collect()
}

#[tauri::command]
/// Truncates the active application log file.
///
/// # Returns
/// - `Ok(())` when clear succeeds.
/// - `Err(String)` when truncation fails.
pub fn clear_app_log() -> Result<(), String> {
    crate::logging::clear_active_log_file()
}

#[tauri::command]
/// Opens or focuses the dedicated output log window.
///
/// # Parameters
/// - `window`: Calling window handle.
///
/// # Returns
/// - `Ok(())` when a window is focused or created.
/// - `Err(String)` when window creation fails.
pub fn open_output_log_window<R: Runtime>(window: Window<R>) -> Result<(), String> {
    let app = window.app_handle().clone();
    if let Some(existing) = app.get_webview_window("output-log") {
        let _ = existing.show();
        let _ = existing.set_focus();
        return Ok(());
    }

    WebviewWindowBuilder::new(
        &app,
        "output-log",
        WebviewUrl::App("index.html?view=output-log".into()),
    )
    .title("Output Log")
    .inner_size(900.0, 600.0)
    .resizable(true)
    .build()
    .map_err(|e| e.to_string())?;

    Ok(())
}
