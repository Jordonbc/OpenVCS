// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later
use log::{debug, error, info, trace};
use tauri::{Emitter, Manager, Runtime, Window};

use tauri_plugin_updater::UpdaterExt;

const MODULE: &str = "updater";

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
    info!("[{}] updater_install_now: starting update check", MODULE);
    
    let app = window.app_handle();
    let updater = app.updater().map_err(|e| {
        error!("[{}] updater_install_now: failed to get updater: {}", MODULE, e);
        e.to_string()
    })?;
    
    debug!("[{}] updater_install_now: checking for updates", MODULE);
    let check_result = updater.check().await.map_err(|e| {
        error!("[{}] updater_install_now: update check failed: {}", MODULE, e);
        e.to_string()
    })?;
    
    match check_result {
        Some(update) => {
            let version = &update.version;
            let current_version = &update.current_version;
            info!(
                "[{}] updater_install_now: update available: {} -> {}",
                MODULE, current_version, version
            );
            debug!(
                "[{}] updater_install_now: update date={:?}, body_len={}",
                MODULE,
                update.date,
                update.body.as_ref().map(|b| b.len()).unwrap_or(0)
            );
            
            let app2 = app.clone();
            let download_start = std::time::Instant::now();
            
            update
                .download_and_install(
                    |received, total| {
                        let total_val = total.unwrap_or(0);
                        let percent = if total_val > 0 {
                            (received as f64 / total_val as f64 * 100.0) as u32
                        } else {
                            0
                        };
                        trace!(
                            "[{}] updater_install_now: download progress {}/{} bytes ({}%)",
                            MODULE, received, total_val, percent
                        );
                        let payload = serde_json::json!({
                            "kind": "progress",
                            "received": received,
                            "total": total_val
                        });
                        let _ = app2.emit("update:progress", payload);
                    },
                    || {
                        let download_elapsed = download_start.elapsed();
                        info!(
                            "[{}] updater_install_now: download completed in {:?}",
                            MODULE, download_elapsed
                        );
                        let _ = app2.emit(
                            "update:progress",
                            serde_json::json!({ "kind": "downloaded" }),
                        );
                    },
                )
                .await
                .map_err(|e| {
                    error!("[{}] updater_install_now: download/install failed: {}", MODULE, e);
                    e.to_string()
                })?;
            
            let elapsed = start.elapsed();
            info!(
                "[{}] updater_install_now: update installed successfully in {:?}",
                MODULE, elapsed
            );
            Ok(())
        }
        None => {
            let elapsed = start.elapsed();
            debug!(
                "[{}] updater_install_now: no update available (checked in {:?})",
                MODULE, elapsed
            );
            Ok(())
        }
    }
}
