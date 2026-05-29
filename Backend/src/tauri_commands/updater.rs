// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later
use log::{debug, error, info, trace};
use serde::Serialize;
use tauri::{Emitter, Manager, Runtime, Window};

use tauri_plugin_updater::UpdaterExt;

/// Response payload for update status check.
#[derive(Serialize)]
pub struct UpdateStatus {
    pub available: bool,
    pub version: Option<String>,
    pub current_version: Option<String>,
    pub body: Option<String>,
    pub date: Option<String>,
}

/// Builds an empty updater response when no update is available.
fn no_update_status() -> UpdateStatus {
    UpdateStatus {
        available: false,
        version: None,
        current_version: None,
        body: None,
        date: None,
    }
}

/// Builds a serializable updater payload from resolved update fields.
fn available_update_status(
    version: String,
    current_version: String,
    body: Option<String>,
    date: Option<String>,
) -> UpdateStatus {
    UpdateStatus {
        available: true,
        version: Some(version),
        current_version: Some(current_version),
        body,
        date,
    }
}

/// Calculates integer download progress percentages while guarding zero totals.
fn download_progress_percent(received: u64, total: u64) -> u32 {
    if total > 0 {
        (received as f64 / total as f64 * 100.0) as u32
    } else {
        0
    }
}

/// Builds the updater progress payload emitted to the frontend.
fn progress_payload(received: u64, total: u64) -> serde_json::Value {
    serde_json::json!({
        "kind": "progress",
        "received": received,
        "total": total,
    })
}

#[tauri::command]
/// Checks for available updates and returns detailed status.
///
/// # Parameters
/// - `window`: Calling window handle.
///
/// # Returns
/// - [`UpdateStatus`] with version info if update available, or {available: false}.
pub async fn get_update_status<R: Runtime>(window: Window<R>) -> Result<UpdateStatus, String> {
    let app = window.app_handle();
    let updater = app.updater().map_err(|e| {
        error!("get_update_status: failed to get updater: {}", e);
        e.to_string()
    })?;

    match updater.check().await {
        Ok(Some(update)) => {
            let date_str = update.date.map(|d| d.to_string());
            let status = available_update_status(
                update.version.clone(),
                update.current_version.clone(),
                update.body.clone(),
                date_str,
            );
            debug!(
                "get_update_status: update available: {} -> {}",
                update.current_version, update.version
            );
            Ok(status)
        }
        Ok(None) => Ok(no_update_status()),
        Err(e) => {
            error!("get_update_status: check failed: {}", e);
            Err(e.to_string())
        }
    }
}

#[tauri::command]
/// Downloads and installs an available application update.
///
/// # Parameters
/// - `window`: Calling window handle used for progress events.
///
/// # Returns
/// - `Ok(())` when no update exists or installation succeeds.
/// - `Err(String)` when updater operations fail.
pub async fn updater_install_now<R: Runtime>(window: Window<R>) -> Result<(), String> {
    let start = std::time::Instant::now();
    info!("updater_install_now: starting update check");

    let app = window.app_handle();
    let updater = app.updater().map_err(|e| {
        error!("updater_install_now: failed to get updater: {}", e);
        e.to_string()
    })?;

    debug!("updater_install_now: checking for updates");
    let check_result = updater.check().await.map_err(|e| {
        error!("updater_install_now: update check failed: {}", e);
        e.to_string()
    })?;

    match check_result {
        Some(update) => {
            let version = &update.version;
            let current_version = &update.current_version;
            info!(
                "updater_install_now: update available: {} -> {}",
                current_version, version
            );
            debug!(
                "updater_install_now: update date={:?}, body_len={}",
                update.date,
                update.body.as_ref().map(|b| b.len()).unwrap_or(0)
            );

            let app2 = app.clone();
            let download_start = std::time::Instant::now();

            update
                .download_and_install(
                    |received, total| {
                        let total_val = total.unwrap_or(0);
                        let percent = download_progress_percent(received as u64, total_val);
                        trace!(
                            "updater_install_now: download progress {}/{} bytes ({}%)",
                            received, total_val, percent
                        );
                        let payload = progress_payload(received as u64, total_val);
                        if let Err(e) = app2.emit("update:progress", payload) {
                            log::warn!("updater_install_now: failed to emit progress: {e}");
                        }
                    },
                    || {
                        let download_elapsed = download_start.elapsed();
                        info!(
                            "updater_install_now: download completed in {:?}",
                            download_elapsed
                        );
                        if let Err(e) = app2.emit(
                            "update:progress",
                            serde_json::json!({ "kind": "downloaded" }),
                        ) {
                            log::warn!("updater_install_now: failed to emit downloaded event: {e}");
                        }
                    },
                )
                .await
                .map_err(|e| {
                    error!("updater_install_now: download/install failed: {}", e);
                    e.to_string()
                })?;

            let elapsed = start.elapsed();
            info!(
                "updater_install_now: update installed successfully in {:?}",
                elapsed
            );
            Ok(())
        }
        None => {
            let elapsed = start.elapsed();
            debug!(
                "updater_install_now: no update available (checked in {:?})",
                elapsed
            );
            Ok(())
        }
    }
}

#[cfg(test)]
mod tests {
    include!("../../tests/tauri_commands/updater.rs");
}
