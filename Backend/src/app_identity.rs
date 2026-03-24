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

    /// Returns the user-facing desktop product name for this channel.
    ///
    /// # Returns
    /// - Product name used by bundles and channel-specific docs.
    pub fn product_name(self) -> &'static str {
        match self {
            Self::Stable => "OpenVCS",
            Self::Beta => "OpenVCS Beta",
            Self::Nightly => "OpenVCS Nightly",
        }
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
/// Stable builds preserve the legacy `OpenVCS` application name so existing
/// users keep the same config and data roots. Beta and nightly use their
/// distinct product names so they can coexist with stable.
///
/// # Returns
/// - `Some(ProjectDirs)` when the platform exposes standard app directories.
/// - `None` when no platform-specific directories are available.
pub fn project_dirs() -> Option<ProjectDirs> {
    ProjectDirs::from("dev", "OpenVCS", current_channel().product_name())
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

    /// Verifies each channel exposes the expected desktop product name.
    #[test]
    fn exposes_product_names() {
        assert_eq!(AppChannel::Stable.product_name(), "OpenVCS");
        assert_eq!(AppChannel::Beta.product_name(), "OpenVCS Beta");
        assert_eq!(AppChannel::Nightly.product_name(), "OpenVCS Nightly");
    }
}
