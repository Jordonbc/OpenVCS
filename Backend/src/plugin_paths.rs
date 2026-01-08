use directories::ProjectDirs;
use log::{info, warn};
use std::{
    env,
    path::{Path, PathBuf},
    sync::OnceLock,
};

pub const PLUGIN_MANIFEST_NAME: &str = "openvcs.plugin.json";
pub const BUILT_IN_PLUGINS_DIR_NAME: &str = "built-in-plugins";

// If the Tauri runtime resolves a resource directory at startup, we store
// it here so plugin discovery can include resources embedded in the
// application bundle.
static RESOURCE_DIR: OnceLock<PathBuf> = OnceLock::new();

pub fn plugins_dir() -> PathBuf {
    if let Some(pd) = ProjectDirs::from("dev", "OpenVCS", "OpenVCS") {
        pd.config_dir().join("plugins")
    } else {
        PathBuf::from("plugins")
    }
}

pub fn ensure_dir(path: &Path) {
    if let Err(err) = std::fs::create_dir_all(path) {
        warn!("plugins: failed to create {}: {}", path.display(), err);
    }
}

pub fn built_in_plugin_dirs() -> Vec<PathBuf> {
    let mut candidates: Vec<PathBuf> = Vec::new();

    if let Ok(exe) = env::current_exe() {
        if let Some(dir) = exe.parent() {
            // Some installers place resources next to the executable, either
            // in a `resources` subdirectory or directly alongside the exe.
            candidates.push(dir.join("resources").join(BUILT_IN_PLUGINS_DIR_NAME));
            candidates.push(dir.join(BUILT_IN_PLUGINS_DIR_NAME));
            #[cfg(target_os = "macos")]
            if let Some(parent) = dir.parent() {
                candidates.push(parent.join("Resources").join(BUILT_IN_PLUGINS_DIR_NAME));
            }
        }
    }

    // If the Tauri runtime resolved a resource directory at startup, include
    // its built-in-plugins subdirectory as a candidate. This is set by the
    // application during `tauri::Builder::setup` via `set_resource_dir`.
    if let Some(rp) = RESOURCE_DIR.get() {
        candidates.push(rp.join(BUILT_IN_PLUGINS_DIR_NAME));
    }

    // On Windows installers the per-user AppData Local folder is commonly
    // used for application data. If present, include
    // %LOCALAPPDATA%/OpenVCS/built-in-plugins as a candidate so built-in
    // plugins shipped by the installer are discovered.
    #[cfg(target_os = "windows")]
    if let Ok(local_appdata) = env::var("LOCALAPPDATA") {
        candidates.push(
            PathBuf::from(local_appdata)
                .join("OpenVCS")
                .join(BUILT_IN_PLUGINS_DIR_NAME),
        );
    }

    let mut seen = std::collections::HashSet::new();
    let result: Vec<PathBuf> = candidates
        .into_iter()
        .filter_map(|path| {
            if !seen.insert(path.clone()) {
                return None;
            }
            if path.is_dir() {
                Some(path)
            } else {
                None
            }
        })
        .collect();

    if result.is_empty() {
        info!("plugins: no built-in plugin directories found");
    } else {
        let joined = result
            .iter()
            .map(|p| p.display().to_string())
            .collect::<Vec<_>>()
            .join(", ");
        info!("plugins: checked built-in plugin directories: {}", joined);
    }

    result
}

/// Set the resolved Tauri resource directory so the plugin discovery can
/// include resources embedded inside the application bundle. Call this from
/// the Tauri `setup` callback with `app.path().resolve("built-in-plugins", BaseDirectory::Resource)`.
pub fn set_resource_dir(path: PathBuf) {
    // it's fine if this fails to set more than once; first set wins.
    let _ = RESOURCE_DIR.set(path);
}
