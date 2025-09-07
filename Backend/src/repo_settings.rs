use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RepoConfig {
    #[serde(default)]
    pub default_branch: String,
}

impl Default for RepoConfig {
    fn default() -> Self {
        Self { default_branch: "main".into() }
    }
}
