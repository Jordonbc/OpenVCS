use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
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
}

impl Default for RepoConfig {
    fn default() -> Self {
        Self { user_name: None, user_email: None, origin_url: None }
    }
}
