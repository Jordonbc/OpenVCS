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

