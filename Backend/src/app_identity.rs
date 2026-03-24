// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

//! Channel-aware desktop identity and persistence paths.

use directories::ProjectDirs;

/// Known desktop release channels.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AppChannel {
    /// Stable desktop builds that preserve the legacy app identity.
    Stable,
    /// Beta desktop builds that use separate branding and persistence.
    Beta,
    /// Nightly desktop builds that use separate branding and persistence.
    Nightly,
}

impl AppChannel {
    /// Parses the compile-time channel slug emitted by `build.rs`.
    ///
    /// # Parameters
    /// - `raw`: Raw channel string.
    ///
    /// # Returns
    /// - [`AppChannel::Stable`] for missing or unknown values.
    /// - The matching prerelease channel for known values.
    pub fn from_build_channel(raw: &str) -> Self {
        match raw.trim().to_ascii_lowercase().as_str() {
            "beta" => Self::Beta,
            "nightly" => Self::Nightly,
            _ => Self::Stable,
        }
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
}

/// Returns the current desktop release channel compiled into the binary.
///
/// # Returns
/// - Current build channel, defaulting to stable when unspecified.
pub fn current_channel() -> AppChannel {
    AppChannel::from_build_channel(option_env!("OPENVCS_APP_CHANNEL").unwrap_or("stable"))
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
    ProjectDirs::from("dev", "OpenVCS", AppChannel::persistence_name())
}

#[cfg(test)]
mod tests {
    use super::AppChannel;

    /// Verifies unknown channel strings fall back to stable.
    #[test]
    fn defaults_unknown_channels_to_stable() {
        assert_eq!(AppChannel::from_build_channel(""), AppChannel::Stable);
        assert_eq!(
            AppChannel::from_build_channel("preview"),
            AppChannel::Stable
        );
    }

    /// Verifies known prerelease channels parse successfully.
    #[test]
    fn parses_known_prerelease_channels() {
        assert_eq!(AppChannel::from_build_channel("beta"), AppChannel::Beta);
        assert_eq!(
            AppChannel::from_build_channel("nightly"),
            AppChannel::Nightly
        );
        assert_eq!(AppChannel::from_build_channel("BETA"), AppChannel::Beta);
    }

    /// Verifies all channels keep the shared legacy persistence root.
    #[test]
    fn exposes_persistence_names() {
        assert_eq!(AppChannel::persistence_name(), "OpenVCS");
    }
}
