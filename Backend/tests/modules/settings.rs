// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

use super::*;

#[test]
/// Verifies default config values stay aligned with startup expectations.
fn default_config_populates_expected_values() {
    let cfg = AppConfig::default();
    assert_eq!(cfg.schema_version, 1);
    assert!(cfg.plugin.is_empty());
    assert_eq!(cfg.general.theme, Theme::System);
    assert_eq!(cfg.general.theme_pack, "default");
    assert_eq!(cfg.general.language, Language::System);
    assert_eq!(cfg.general.default_backend, "git");
    assert_eq!(cfg.general.update_channel, UpdateChannel::Stable);
    assert!(cfg.general.reopen_last_repos);
    assert!(cfg.general.checks_on_launch);
    assert!(!cfg.general.telemetry);
    assert!(cfg.general.crash_reports);
    assert_eq!(cfg.credentials.helper, CredentialHelper::OsKeychain);
    assert_eq!(cfg.credentials.ssh_agent, SshAgent::Env);
    assert_eq!(cfg.credentials.ssh_key_paths, vec!["~/.ssh/id_ed25519", "~/.ssh/id_rsa"]);
    assert_eq!(cfg.diff.external_diff, ExternalTool::disabled());
    assert_eq!(cfg.advanced.proxy, Proxy::system());
    assert_eq!(cfg.ux.recents_limit, 10);
    assert_eq!(cfg.logging.retain_archives, 10);
}

#[test]
/// Verifies settings enums serialize with kebab-case names.
fn serializes_settings_enums_with_kebab_case_names() {
    assert_eq!(serde_json::to_value(Theme::Dark).expect("theme"), serde_json::json!("dark"));
    assert_eq!(serde_json::to_value(Language::EN).expect("language"), serde_json::json!("e-n"));
    assert_eq!(serde_json::to_value(UpdateChannel::Nightly).expect("channel"), serde_json::json!("nightly"));
    assert_eq!(serde_json::to_value(GitSshBinary::Custom).expect("ssh binary"), serde_json::json!("custom"));
    assert_eq!(serde_json::to_value(HookPolicy::Allow).expect("hook policy"), serde_json::json!("allow"));
    assert_eq!(serde_json::to_value(CredentialHelper::None).expect("helper"), serde_json::json!("none"));
    assert_eq!(serde_json::to_value(SshAgent::OnePassword).expect("ssh agent"), serde_json::json!("one-password"));
    assert_eq!(serde_json::to_value(WhitespaceMode::Eol).expect("whitespace"), serde_json::json!("eol"));
    assert_eq!(serde_json::to_value(EditorChoice::Clion).expect("editor"), serde_json::json!("clion"));
    assert_eq!(serde_json::to_value(IssueProvider::Forgejo).expect("provider"), serde_json::json!("forgejo"));
    assert_eq!(serde_json::to_value(ColorBlindMode::Deuteranopia).expect("color blind"), serde_json::json!("deuteranopia"));
    assert_eq!(serde_json::to_value(ForcePushPolicy::TrackedRemotes).expect("force push"), serde_json::json!("tracked-remotes"));
    assert_eq!(serde_json::to_value(ProxyMode::Manual).expect("proxy mode"), serde_json::json!("manual"));
}

#[test]
/// Verifies helper constructors return disabled/system defaults.
fn helper_constructors_return_disabled_defaults() {
    let external = ExternalTool::disabled();
    assert!(!external.enabled);
    assert!(external.path.is_empty());
    assert!(external.args.is_empty());

    let proxy = Proxy::system();
    assert_eq!(proxy.mode, ProxyMode::System);
    assert!(proxy.url.is_empty());
}
