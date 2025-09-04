use serde::Serialize;

#[derive(Serialize)]
pub struct AboutInfo {
  pub name:        String,
  pub version:     String,
  pub build:       String,
  pub description: String,
  pub homepage:    String,
  pub repository:  String,
  pub authors:     String,
  pub os:          String,
  pub arch:        String,
}

impl AboutInfo {
  pub fn gather() -> Self {
    // Compile-time package metadata from Cargo
    let name        = env!("CARGO_PKG_NAME").to_string();
    let version     = env!("CARGO_PKG_VERSION").to_string();
    let description = option_env!("CARGO_PKG_DESCRIPTION").unwrap_or("").to_string();
    let homepage    = option_env!("CARGO_PKG_HOMEPAGE").unwrap_or("").to_string();
    let repository  = option_env!("CARGO_PKG_REPOSITORY").unwrap_or("").to_string();
    let authors     = option_env!("CARGO_PKG_AUTHORS").unwrap_or("").to_string();
    // Build id set in build.rs (falls back to "dev" there)
    let build       = env!("GIT_DESCRIBE").to_string();
    // Target platform (of the binary)
    let os          = std::env::consts::OS.to_string();
    let arch        = std::env::consts::ARCH.to_string();

    Self { name, version, build, description, homepage, repository, authors, os, arch }
  }
}

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