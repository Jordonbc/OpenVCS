// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

//! Channel-aware desktop identity and persistence paths.

use directories::ProjectDirs;
use std::path::{Path, PathBuf};

/// Holds the resolved project directory paths used by OpenVCS.
///
/// This avoids depending on the `directories::ProjectDirs` type in public
/// signatures, allowing test code to inject temporary paths for isolation.
#[derive(Clone, Debug)]
pub struct AppDirs {
    config_dir: PathBuf,
    data_dir: PathBuf,
}

impl AppDirs {
    /// Returns the configuration directory path.
    ///
    /// # Returns
    /// - The config directory path.
    pub fn config_dir(&self) -> &Path {
        &self.config_dir
    }

    /// Returns the application data directory path.
    ///
    /// # Returns
    /// - The data directory path.
    pub fn data_dir(&self) -> &Path {
        &self.data_dir
    }
}

#[cfg(test)]
impl AppDirs {
    pub fn new(config_dir: PathBuf, data_dir: PathBuf) -> Self {
        Self {
            config_dir,
            data_dir,
        }
    }
}

// Thread-local per-test overrides; parallel tests do not conflict.
#[cfg(test)]
std::thread_local! {
    static TEST_APP_DIRS: std::cell::RefCell<Option<AppDirs>> = const { std::cell::RefCell::new(None) };
}

/// Sets the test override for project directories.
///
/// # Parameters
/// - `dirs`: The `AppDirs` to return from [`project_dirs()`] in test builds.
#[cfg(test)]
pub(crate) fn set_test_app_dirs(dirs: AppDirs) {
    TEST_APP_DIRS.with(|tls| *tls.borrow_mut() = Some(dirs));
}

/// Clears the test override for project directories.
///
/// After calling this, [`project_dirs()`] returns real paths again.
#[cfg(test)]
pub(crate) fn clear_test_app_dirs() {
    TEST_APP_DIRS.with(|tls| *tls.borrow_mut() = None);
}

/// Guards against accidental test writes to real config/recents.
///
/// Called from `AppConfig::save()` and `save_recents_to_disk()` in
/// test builds.  Panics with actionable guidance when no test override
/// is active so new tests cannot silently corrupt user data.
#[cfg(test)]
pub(crate) fn assert_test_isolation() {
    let has_override = TEST_APP_DIRS.with(|tls| tls.borrow().is_some());
    assert!(
        has_override,
        "test must use AppDirsGuard before writing to config/recents paths;\n\
         add `let _guard = AppDirsGuard::new();` at the start of this test"
    );
}

/// Installs temp directories as the app dirs override (leaked intentionally).
///
/// Call at the top of any `build_app*` helper whose `AppState` may
/// eventually trigger `set_config()` or `set_current_repo()`.
#[cfg(test)]
pub(crate) fn setup_test_isolation() {
    let dir = tempfile::tempdir().expect("temp dir for test isolation");
    let cfg_dir = dir.path().join("config");
    let data_dir = dir.path().join("data");
    // Drop dir immediately so no temp dir leaks.  save() and
    // save_recents_to_disk() both call create_dir_all before writing,
    // so they recreate the paths on first use.
    drop(dir);
    set_test_app_dirs(AppDirs::new(cfg_dir, data_dir));
}

/// Returns the filesystem app name used for persistence.
///
/// All desktop channels intentionally share the historical `OpenVCS`
/// directory so builds keep using the same config and plugin roots.
///
/// # Returns
/// - Application name for `ProjectDirs`.
pub fn persistence_name() -> &'static str {
    "OpenVCS"
}

/// Returns channel-aware project directories for app config and data.
///
/// All desktop channels preserve the legacy `OpenVCS` application name so
/// existing users keep the same config and data roots.
///
/// In test builds, returns the injected test paths when
/// [`set_test_app_dirs`] has been called.
///
/// # Returns
/// - `Some(AppDirs)` when the platform exposes standard app directories (or a test override is set).
/// - `None` when no platform-specific directories are available and no override is configured.
pub fn project_dirs() -> Option<AppDirs> {
    #[cfg(test)]
    if let Some(dirs) = TEST_APP_DIRS.with(|tls| tls.borrow().clone()) {
        return Some(dirs);
    }

    ProjectDirs::from("dev", "OpenVCS", persistence_name()).map(|pd| AppDirs {
        config_dir: pd.config_dir().to_path_buf(),
        data_dir: pd.data_dir().to_path_buf(),
    })
}

#[cfg(test)]
mod tests {
    include!("../tests/modules/app_identity.rs");
}
