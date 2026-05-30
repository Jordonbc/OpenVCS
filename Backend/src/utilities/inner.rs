// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize)]
pub struct AboutInfo {
    pub name: String,
    pub version: String,
    pub build: String,
    pub description: String,
    pub homepage: String,
    pub repository: String,
    pub authors: String,
    pub os: String,
    pub arch: String,
}

impl AboutInfo {
    /// Gathers application and target-platform metadata for About UI.
    ///
    /// # Returns
    /// - A populated [`AboutInfo`] record.
    pub fn gather() -> Self {
        // Compile-time package metadata from Cargo
        let name = env!("CARGO_PKG_NAME").to_string();
        let version = env!("OPENVCS_VERSION").to_string();
        let description = option_env!("CARGO_PKG_DESCRIPTION")
            .unwrap_or("")
            .to_string();
        let homepage = option_env!("CARGO_PKG_HOMEPAGE").unwrap_or("").to_string();
        let repository = option_env!("CARGO_PKG_REPOSITORY")
            .unwrap_or("")
            .to_string();
        let authors = option_env!("CARGO_PKG_AUTHORS").unwrap_or("").to_string();
        // Build id set in build.rs (falls back to "unknown@nogit" there)
        let build = env!("OPENVCS_BUILD").to_string();
        // Target platform (of the binary)
        let os = std::env::consts::OS.to_string();
        let arch = std::env::consts::ARCH.to_string();

        Self {
            name,
            version,
            build,
            description,
            homepage,
            repository,
            authors,
            os,
            arch,
        }
    }
}

/// Opens a native folder picker and returns the selected directory path.
///
/// # Parameters
/// - `app`: Tauri app handle.
/// - `title`: Dialog title string.
///
/// # Returns
/// - `Some(String)` selected directory path.
/// - `None` when canceled.
pub async fn browse_directory_async<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    title: &str,
) -> Option<String> {
    let dialog = tauri_plugin_dialog::DialogExt::dialog(&app).clone(); // OWNED Dialog<R>

    let (tx, rx) = tokio::sync::oneshot::channel::<Option<String>>();
    tauri_plugin_dialog::FileDialogBuilder::new(dialog)
        .set_title(title)
        .pick_folder(move |res| {
            let _ = tx.send(res.map(|p| p.to_string()));
        });

    rx.await.unwrap_or(None)
}

/// Opens a native file picker and returns the selected file path.
///
/// # Parameters
/// - `app`: Tauri app handle.
/// - `title`: Dialog title string.
/// - `extensions`: Optional extension filter list.
///
/// # Returns
/// - `Some(String)` selected file path.
/// - `None` when canceled.
pub async fn browse_file_async<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    title: &str,
    extensions: &[&str],
) -> Option<String> {
    let dialog = tauri_plugin_dialog::DialogExt::dialog(&app).clone();

    let (tx, rx) = tokio::sync::oneshot::channel::<Option<String>>();
    let mut builder = tauri_plugin_dialog::FileDialogBuilder::new(dialog).set_title(title);
    if !extensions.is_empty() {
        builder = builder.add_filter("Files", extensions);
    }
    builder.pick_file(move |res| {
        let _ = tx.send(res.map(|p| p.to_string()));
    });

    rx.await.unwrap_or(None)
}

#[cfg(test)]
mod tests {
    include!("../../tests/modules/utilities.rs");
}
