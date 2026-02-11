use tauri::{Emitter, Manager, Runtime, Window};

use tauri_plugin_updater::UpdaterExt;

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
    let app = window.app_handle();
    let updater = app.updater().map_err(|e| e.to_string())?;
    match updater.check().await.map_err(|e| e.to_string())? {
        Some(update) => {
            let app2 = app.clone();
            update
                .download_and_install(
                    |received, total| {
                        let payload = serde_json::json!({
                            "kind": "progress",
                            "received": received,
                            "total": total
                        });
                        let _ = app2.emit("update:progress", payload);
                    },
                    || {
                        let _ = app2.emit(
                            "update:progress",
                            serde_json::json!({ "kind": "downloaded" }),
                        );
                    },
                )
                .await
                .map_err(|e| e.to_string())?;
            Ok(())
        }
        None => Ok(()),
    }
}
