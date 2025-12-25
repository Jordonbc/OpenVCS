use tauri::{Manager, Runtime, Window, WebviewUrl, WebviewWindowBuilder};

use crate::output_log::OutputLogEntry;
use crate::state::AppState;

#[tauri::command]
pub fn get_output_log(state: tauri::State<'_, AppState>) -> Vec<OutputLogEntry> {
    state.output_log()
}

#[tauri::command]
pub fn clear_output_log(state: tauri::State<'_, AppState>) {
    state.clear_output_log();
}

#[tauri::command]
pub fn tail_app_log(max_lines: Option<usize>) -> Vec<OutputLogEntry> {
    use crate::output_log::{OutputLevel, OutputLogEntry};

    let max_lines = max_lines.unwrap_or(1500).clamp(1, 10_000);
    let path = std::path::Path::new("logs").join("openvcs.log");
    let Ok(data) = std::fs::read_to_string(path) else { return vec![]; };

    let lines: Vec<&str> = data.lines().collect();
    let start = lines.len().saturating_sub(max_lines);
    lines[start..]
        .iter()
        .map(|line| OutputLogEntry::new(0, OutputLevel::Info, "app", line.to_string()))
        .collect()
}

#[tauri::command]
pub fn clear_app_log() -> Result<(), String> {
    crate::logging::clear_active_log_file()
}

#[tauri::command]
pub fn open_output_log_window<R: Runtime>(window: Window<R>) -> Result<(), String> {
    let app = window.app_handle().clone();
    if let Some(existing) = app.get_webview_window("output-log") {
        let _ = existing.show();
        let _ = existing.set_focus();
        return Ok(());
    }

    WebviewWindowBuilder::new(&app, "output-log", WebviewUrl::App("index.html?view=output-log".into()))
        .title("Output Log")
        .inner_size(900.0, 600.0)
        .resizable(true)
        .build()
        .map_err(|e| e.to_string())?;

    Ok(())
}
