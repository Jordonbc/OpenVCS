// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

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
