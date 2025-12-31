use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RemoteConfig {
    pub name: String,
    pub url: String,
}

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
