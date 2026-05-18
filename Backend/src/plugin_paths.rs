// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later
//! Path resolution helpers for installed and built-in plugins.

use log::{info, warn};
use std::{
    env,
    path::{Path, PathBuf},
    sync::{
        OnceLock,
        atomic::{AtomicBool, Ordering},
    },
};

/// File name expected for plugin package manifests.
pub const PLUGIN_PACKAGE_NAME: &str = "package.json";
/// Directory name used for built-in plugin bundles.
pub const BUILT_IN_PLUGINS_DIR_NAME: &str = "built-in-plugins";
/// Directory name used for the bundled Node runtime.
pub const NODE_RUNTIME_DIR_NAME: &str = "node-runtime";
/// Known Linux package directory names owned by OpenVCS.
#[cfg(target_os = "linux")]
const LINUX_PACKAGE_APP_DIR_NAMES: [&str; 2] = ["OpenVCS", "openvcs"];

// If the Tauri runtime resolves a resource directory at startup, we store
// it here so plugin discovery can include resources embedded in the
// application bundle.
static RESOURCE_DIR: OnceLock<PathBuf> = OnceLock::new();
static NODE_RUNTIME_RESOURCE_DIR: OnceLock<PathBuf> = OnceLock::new();
static NODE_EXECUTABLE: OnceLock<PathBuf> = OnceLock::new();
static LOGGED_BUILTIN_DIRS: AtomicBool = AtomicBool::new(false);

/// Returns the user-writable plugin installation directory.
///
/// # Returns
/// - The absolute config-directory path used to store installed plugins.
pub fn plugins_dir() -> PathBuf {
    if let Some(pd) = crate::app_identity::project_dirs() {
        pd.config_dir().join("plugins")
    } else {
        PathBuf::from("plugins")
    }
}

/// Creates a directory path recursively and logs failures.
///
/// # Parameters
/// - `path`: Directory path to create if missing.
///
/// # Returns
/// - `()`.
pub fn ensure_dir(path: &Path) {
    if let Err(err) = std::fs::create_dir_all(path) {
        warn!("plugins: failed to create {}: {}", path.display(), err);
    }
}

/// Appends a path when it has not already been recorded.
///
/// # Parameters
/// - `paths`: Candidate path list.
/// - `path`: Candidate to append.
///
/// # Returns
/// - `()`.
fn push_unique_path(paths: &mut Vec<PathBuf>, path: PathBuf) {
    if !paths.iter().any(|existing| existing == &path) {
        paths.push(path);
    }
}

/// Returns whether a Linux package app directory name belongs to OpenVCS.
///
/// # Parameters
/// - `app_dir`: Candidate packaged app directory.
///
/// # Returns
/// - `true` when the directory name matches an OpenVCS-owned package layout.
#[cfg(target_os = "linux")]
fn is_known_linux_package_app_dir(app_dir: &Path) -> bool {
    app_dir
        .file_name()
        .and_then(|name| name.to_str())
        .is_some_and(|name| LINUX_PACKAGE_APP_DIR_NAMES.contains(&name))
}

/// Adds Linux package resource roots installed under sibling `lib` directories.
///
/// Only OpenVCS-owned app directories are accepted so resource lookup does not
/// wander into unrelated package trees that happen to contain the same
/// subdirectory names.
///
/// # Parameters
/// - `paths`: Candidate base directory list.
/// - `exe_dir`: Directory containing the executable.
/// - `resource_dir_name`: Resource subdirectory to check for.
///
/// # Returns
/// - `()`.
#[cfg(target_os = "linux")]
fn push_linux_package_resource_bases(
    paths: &mut Vec<PathBuf>,
    exe_dir: &Path,
    resource_dir_name: &str,
) {
    let Some(prefix_dir) = exe_dir.parent() else {
        return;
    };

    for lib_dir_name in ["lib", "lib64"] {
        let lib_dir = prefix_dir.join(lib_dir_name);
        let entries = match std::fs::read_dir(&lib_dir) {
            Ok(entries) => entries,
            Err(err) => {
                log::trace!(
                    "plugins: skipping Linux package resource root {}: {}",
                    lib_dir.display(),
                    err
                );
                continue;
            }
        };
        for entry in entries.flatten() {
            let app_dir = entry.path();
            if !app_dir.is_dir() {
                continue;
            }
            if !is_known_linux_package_app_dir(&app_dir) {
                log::trace!(
                    "plugins: skipping non-OpenVCS Linux package dir {}",
                    app_dir.display()
                );
                continue;
            }
            if app_dir.join(resource_dir_name).is_dir() {
                push_unique_path(paths, app_dir);
            }
        }
    }
}

/// Returns candidate resource base directories derived from the executable path.
///
/// # Parameters
/// - `resource_dir_name`: Resource directory that should exist under packaged roots.
///
/// # Returns
/// - Candidate base directories that may contain the requested resource.
fn bundled_resource_base_dirs(resource_dir_name: &str) -> Vec<PathBuf> {
    let mut candidates: Vec<PathBuf> = Vec::new();
    #[cfg(not(target_os = "linux"))]
    let _ = resource_dir_name;

    if let Ok(exe) = env::current_exe()
        && let Some(dir) = exe.parent()
    {
        push_unique_path(&mut candidates, dir.join("resources"));
        push_unique_path(&mut candidates, dir.to_path_buf());
        if let Some(target_dir) = dir.parent() {
            push_unique_path(&mut candidates, target_dir.join("openvcs"));
            #[cfg(target_os = "macos")]
            push_unique_path(&mut candidates, target_dir.join("Resources"));
        }
        #[cfg(target_os = "linux")]
        push_linux_package_resource_bases(&mut candidates, dir, resource_dir_name);
        push_unique_path(
            &mut candidates,
            dir.join("_up_").join("target").join("openvcs"),
        );
    }

    if let Some(resource_dir) = RESOURCE_DIR.get() {
        push_unique_path(&mut candidates, resource_dir.clone());
    }

    candidates
}

/// Returns discovered built-in plugin directories that currently exist.
///
/// # Returns
/// - Existing built-in plugin directories containing `package.json`.
pub fn built_in_plugin_dirs() -> Vec<PathBuf> {
    let mut roots: Vec<PathBuf> = Vec::new();

    for base_dir in bundled_resource_base_dirs(BUILT_IN_PLUGINS_DIR_NAME) {
        push_unique_path(&mut roots, base_dir.join(BUILT_IN_PLUGINS_DIR_NAME));
    }

    // On Windows installers the per-user AppData Local folder is commonly
    // used for application data. If present, include
    // %LOCALAPPDATA%/OpenVCS/built-in-plugins as a candidate so built-in
    // plugins shipped by the installer are discovered.
    #[cfg(target_os = "windows")]
    if let Ok(local_appdata) = env::var("LOCALAPPDATA") {
        push_unique_path(
            &mut roots,
            PathBuf::from(local_appdata)
                .join("OpenVCS")
                .join(BUILT_IN_PLUGINS_DIR_NAME),
        );
    }

    let mut seen = std::collections::HashSet::new();
    let result: Vec<PathBuf> = roots
        .into_iter()
        .filter(|root| root.is_dir())
        .flat_map(|root| {
            let entries = match std::fs::read_dir(&root) {
                Ok(entries) => entries,
                Err(err) => {
                    log::trace!(
                        "plugins: skipping built-in plugin root {}: {}",
                        root.display(),
                        err
                    );
                    return Vec::new();
                }
            };
            entries
                .flatten()
                .map(|entry| entry.path())
                .filter(|path| path.is_dir() && path.join(PLUGIN_PACKAGE_NAME).is_file())
                .collect::<Vec<_>>()
        })
        .filter_map(|path| {
            if seen.insert(path.clone()) {
                Some(path)
            } else {
                None
            }
        })
        .collect();

    if LOGGED_BUILTIN_DIRS
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_ok()
    {
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
    }

    result
}

/// Returns candidate bundled Node executable paths.
///
/// # Returns
/// - Ordered candidate paths for the bundled Node binary.
pub fn bundled_node_candidate_paths() -> Vec<PathBuf> {
    let node_name = if cfg!(windows) { "node.exe" } else { "node" };
    let mut candidates = Vec::new();
    if let Some(node_runtime_dir) = NODE_RUNTIME_RESOURCE_DIR.get() {
        push_unique_path(&mut candidates, node_runtime_dir.join(node_name));
    }
    for base_dir in bundled_resource_base_dirs(NODE_RUNTIME_DIR_NAME) {
        push_unique_path(
            &mut candidates,
            base_dir.join(NODE_RUNTIME_DIR_NAME).join(node_name),
        );
    }
    candidates
}

/// Set the resolved Tauri resource directory so the plugin discovery can
/// include resources embedded inside the application bundle. Call this from
/// the Tauri `setup` callback with `app.path().resolve("built-in-plugins", BaseDirectory::Resource)`.
///
/// # Parameters
/// - `path`: Resource directory path resolved by Tauri at runtime.
///
/// # Returns
/// - `()`.
pub fn set_resource_dir(path: PathBuf) {
    // it's fine if this fails to set more than once; first set wins.
    let _ = RESOURCE_DIR.set(path);
}

/// Sets the exact `node-runtime` resource directory resolved by Tauri.
///
/// This is tracked separately from the generic resource base because packaged
/// builds may resolve built-in plugin bundles and `node-runtime` from different
/// roots. Callers should provide the resolved `node-runtime` directory itself.
///
/// # Parameters
/// - `path`: Exact runtime directory path resolved by Tauri at runtime.
///
/// # Returns
/// - `()`.
pub fn set_node_runtime_resource_dir(path: PathBuf) {
    let _ = NODE_RUNTIME_RESOURCE_DIR.set(path);
}

/// Sets the resolved bundled Node executable path used by plugin runtime.
///
/// # Parameters
/// - `path`: Absolute path to the bundled Node binary.
///
/// # Returns
/// - `()`.
pub fn set_node_executable_path(path: PathBuf) {
    let _ = NODE_EXECUTABLE.set(path);
}

/// Returns the bundled Node executable path when configured.
///
/// # Returns
/// - `Some(PathBuf)` when a bundled runtime was resolved.
/// - `None` when no bundled runtime has been resolved yet.
pub fn node_executable_path() -> Option<PathBuf> {
    NODE_EXECUTABLE.get().cloned()
}

#[cfg(test)]
mod tests {
    include!("../tests/modules/plugin_paths.rs");
}
