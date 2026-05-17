// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

//! Channel-aware desktop identity and persistence paths.

use directories::ProjectDirs;

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
/// # Returns
/// - `Some(ProjectDirs)` when the platform exposes standard app directories.
/// - `None` when no platform-specific directories are available.
pub fn project_dirs() -> Option<ProjectDirs> {
    ProjectDirs::from("dev", "OpenVCS", persistence_name())
}

#[cfg(test)]
mod tests {
    include!("../tests/modules/app_identity.rs");
}
