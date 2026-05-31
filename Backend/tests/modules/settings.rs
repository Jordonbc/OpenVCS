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

#[test]
fn section_defaults_stay_aligned_with_schema() {
    let vcs = Vcs::default();
    assert!(vcs.backend.is_empty());
    assert_eq!(vcs.default_branch, "main");
    assert_eq!(vcs.ssh_binary, GitSshBinary::Auto);
    assert!(vcs.ssh_path.is_empty());
    assert!(vcs.prune_on_fetch);
    assert!(vcs.fetch_on_focus);
    assert_eq!(vcs.allow_hooks, HookPolicy::Ask);
    assert!(vcs.respect_core_autocrlf);
    assert_eq!(
        vcs.merge_commit_message_template,
        "Merged branch '{branch:source}' into '{branch:target}'"
    );

    let commit = Commit::default();
    assert!(commit.commit_message_template_enabled);
    assert!(commit.restrict_commit_summary);
    assert_eq!(commit.commit_templates, CommitTemplates::default());

    let templates = CommitTemplates::default();
    assert_eq!(templates.commit_message_template_create, "Create {file:name}");
    assert_eq!(templates.commit_message_template_update, "Update {file:name}");
    assert_eq!(templates.commit_message_template_delete, "Delete {file:name}");

    let credentials = Credentials::default();
    assert_eq!(credentials.helper, CredentialHelper::OsKeychain);
    assert_eq!(credentials.ssh_agent, SshAgent::Env);
    assert_eq!(
        credentials.ssh_key_paths,
        vec!["~/.ssh/id_ed25519", "~/.ssh/id_rsa"]
    );
    assert_eq!(credentials.gpg_program, "gpg");
    assert!(!credentials.sign_commits);
    assert!(credentials.signing_key.is_empty());

    let diff = Diff::default();
    assert_eq!(diff.tab_width, 4);
    assert_eq!(diff.ignore_whitespace, WhitespaceMode::None);
    assert_eq!(diff.max_file_size_mb, 10);
    assert!(diff.intraline);
    assert!(diff.show_binary_placeholders);
    assert_eq!(diff.external_diff, ExternalTool::disabled());
    assert_eq!(diff.external_merge, ExternalTool::disabled());
    assert_eq!(diff.binary_exts, vec!["png", "jpg", "dds", "uasset"]);

    let performance = Performance::default();
    assert!(performance.progressive_render);
    assert!(performance.gpu_accel);
    assert!(performance.animations);

    let integrations = Integrations::default();
    assert_eq!(integrations.default_editor, EditorChoice::System);
    assert_eq!(integrations.issue_provider, IssueProvider::Auto);
    assert!(integrations.host_overrides.is_empty());

    let plugins = Plugins::default();
    assert!(plugins.disabled.is_empty());
    assert!(plugins.enabled.is_empty());

    let ux = Ux::default();
    assert_eq!(ux.ui_scale, 1.0);
    assert_eq!(ux.font_mono, "monospace");
    assert!(!ux.vim_nav);
    assert_eq!(ux.color_blind_mode, ColorBlindMode::None);
    assert_eq!(ux.recents_limit, 10);

    let advanced = Advanced::default();
    assert_eq!(advanced.confirm_force_push, ForcePushPolicy::Always);
    assert!(advanced.ssl_verify);
    assert_eq!(advanced.proxy, Proxy::system());

    let experimental = Experimental::default();
    assert!(!experimental.parallel_history_scan);
    assert!(!experimental.background_blame_index);
    assert!(!experimental.sparse_checkout_ui);

    let logging = Logging::default();
    assert_eq!(logging.level, LogLevel::Info);
    assert!(!logging.live_viewer);
    assert_eq!(logging.retain_archives, 10);

}

#[test]
fn deserializes_partial_toml_with_field_defaults() {
    let cfg: AppConfig = toml::from_str(
        r#"
schema_version = 1

[general]
default_backend = "hg"

[plugins]
enabled = ["openvcs.git"]
"#,
    )
    .expect("parse config");

    assert_eq!(cfg.schema_version, 1);
    assert_eq!(cfg.general.default_backend, "hg");
    assert_eq!(cfg.general.theme_pack, "default");
    assert_eq!(cfg.vcs.default_branch, "main");
    assert_eq!(cfg.commit.commit_templates.commit_message_template_delete, "Delete {file:name}");
    assert_eq!(cfg.credentials.helper, CredentialHelper::OsKeychain);
    assert_eq!(cfg.diff.tab_width, 4);
    assert!(cfg.performance.animations);
    assert!(cfg.integrations.host_overrides.is_empty());
    assert_eq!(cfg.plugins.enabled, vec!["openvcs.git"]);
    assert_eq!(cfg.ux.recents_limit, 10);
    assert_eq!(cfg.logging.retain_archives, 10);
}

#[test]
fn round_trips_configuration_through_toml() {
    let mut cfg = AppConfig::default();
    cfg.general.default_backend = "hg".into();
    cfg.vcs.backend = "git".into();
    cfg.vcs.ssh_binary = GitSshBinary::Custom;
    cfg.vcs.ssh_path = "/usr/bin/ssh".into();
    cfg.commit.commit_templates.commit_message_template_update = "Update {file:name} now".into();
    cfg.credentials.sign_commits = true;
    cfg.diff.tab_width = 2;
    cfg.performance.gpu_accel = false;
    cfg.integrations.host_overrides.insert("example.com".into(), IssueProvider::Forgejo);
    cfg.plugins.disabled = vec!["openvcs.git".into()];
    cfg.ux.ui_scale = 1.25;
    cfg.advanced.confirm_force_push = ForcePushPolicy::TrackedRemotes;
    cfg.experimental.parallel_history_scan = true;
    cfg.logging.live_viewer = true;

    let toml = toml::to_string_pretty(&cfg).expect("serialize config");
    let parsed: AppConfig = toml::from_str(&toml).expect("deserialize config");

    assert_eq!(parsed, cfg);
}
