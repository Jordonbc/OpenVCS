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
    use super::{RemoteConfig, RepoConfig};

    #[test]
    /// Verifies repository config round-trips and omits empty option fields.
    fn serializes_repo_config_with_optional_fields() {
        let config = RepoConfig::default();
        let json = serde_json::to_value(&config).expect("serialize repo config");
        assert_eq!(json, serde_json::json!({}));

        let populated = RepoConfig {
            user_name: Some("Alice".into()),
            user_email: Some("alice@example.com".into()),
            origin_url: Some("https://example.com/repo.git".into()),
            remotes: Some(vec![RemoteConfig {
                name: "origin".into(),
                url: "https://example.com/repo.git".into(),
            }]),
        };
        let decoded: RepoConfig = serde_json::from_value(
            serde_json::to_value(&populated).expect("serialize populated repo config"),
        )
        .expect("deserialize repo config");
        assert_eq!(decoded.user_name.as_deref(), Some("Alice"));
        assert_eq!(decoded.remotes.as_ref().expect("remotes")[0].name, "origin");
    }
}
