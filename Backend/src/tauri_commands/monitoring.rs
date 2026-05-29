// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

use crate::monitoring::FrontendErrorReport;

#[tauri::command]
/// Reports a frontend error payload to the backend-owned monitoring pipeline.
///
/// # Parameters
/// - `payload`: Normalized frontend error report from the Tauri webview.
///
/// # Returns
/// - `Ok(())` after the payload has been offered to the monitoring backend.
pub fn report_frontend_error(payload: FrontendErrorReport) -> Result<(), String> {
    crate::monitoring::capture_frontend_error(payload);
    Ok(())
}

#[cfg(test)]
mod tests {
    include!("../../tests/tauri_commands/monitoring.rs");
}
