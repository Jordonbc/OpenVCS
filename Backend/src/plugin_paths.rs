use directories::ProjectDirs;
use log::warn;
use std::{
    env,
    path::{Path, PathBuf},
};

pub const PLUGIN_MANIFEST_NAME: &str = "openvcs.plugin.json";
pub const BUILT_IN_PLUGINS_DIR_NAME: &str = "built-in-plugins";

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

    if let Ok(current_dir) = env::current_dir() {
        candidates.push(current_dir.join(BUILT_IN_PLUGINS_DIR_NAME));
    }

    if let Ok(exe) = env::current_exe() {
        if let Some(dir) = exe.parent() {
            candidates.push(dir.join(BUILT_IN_PLUGINS_DIR_NAME));
            candidates.push(dir.join("resources").join(BUILT_IN_PLUGINS_DIR_NAME));
            #[cfg(target_os = "macos")]
            if let Some(parent) = dir.parent() {
                candidates.push(parent.join("Resources").join(BUILT_IN_PLUGINS_DIR_NAME));
            }
        }
    }

    candidates.push(PathBuf::from("Backend").join(BUILT_IN_PLUGINS_DIR_NAME));
    candidates.push(PathBuf::from(BUILT_IN_PLUGINS_DIR_NAME));
    candidates.push(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(BUILT_IN_PLUGINS_DIR_NAME));

    let mut seen = std::collections::HashSet::new();
    candidates
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
        .collect()
}
