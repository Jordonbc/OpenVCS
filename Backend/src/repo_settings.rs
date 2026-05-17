// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later
//! Repository-local settings payloads exchanged with the frontend.

use serde::{Deserialize, Serialize};

/// Name/URL pair for a configured Git remote.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RemoteConfig {
    /// Remote name (for example `origin`).
    pub name: String,
    /// Remote fetch/push URL.
    pub url: String,
}

/// Repository-specific settings that can override global defaults.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct RepoConfig {
    /// Repository-local user.name (if set)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user_name: Option<String>,
    /// Repository-local user.email (if set)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user_email: Option<String>,
    /// Convenience: the URL for the 'origin' remote (if present)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub origin_url: Option<String>,
    /// Desired configured remotes (name + url). When provided, `set_repo_settings` will
    /// ensure these exist and remove any others.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub remotes: Option<Vec<RemoteConfig>>,
}

#[cfg(test)]
mod tests {
    include!("../tests/modules/repo_settings.rs");
}
