// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later
//! Global application configuration types, enums, and default values.

use serde::{Deserialize, Serialize};

/// Ships-with default backend, overridable by config.
pub const DEFAULT_BACKEND_ID: &str = "git";

/// Serde helper default for `true`.
///
/// # Returns
/// - `true`.
fn default_true() -> bool {
    true
}

/// Root global settings document persisted as TOML.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AppConfig {
    pub schema_version: u32,
    /// Opencode-style plugin source entries resolved from npm specs or local paths.
    #[serde(default)]
    pub plugin: Vec<String>,
    #[serde(default)]
    pub general: General,
    #[serde(default)]
    pub vcs: Vcs,
    #[serde(default)]
    pub commit: Commit,
    #[serde(default)]
    pub credentials: Credentials,
    #[serde(default)]
    pub diff: Diff,
    #[serde(default)]
    pub performance: Performance,
    #[serde(default)]
    pub integrations: Integrations,
    #[serde(default)]
    pub plugins: Plugins,
    #[serde(default)]
    pub ux: Ux,
    #[serde(default)]
    pub advanced: Advanced,
    #[serde(default)]
    pub experimental: Experimental,
    #[serde(default)]
    pub logging: Logging,
}

impl Default for AppConfig {
    /// Returns default global configuration values.
    ///
    /// # Returns
    /// - Default [`AppConfig`].
    fn default() -> Self {
        Self {
            schema_version: 1,
            plugin: Default::default(),
            general: Default::default(),
            vcs: Default::default(),
            commit: Default::default(),
            credentials: Default::default(),
            diff: Default::default(),
            performance: Default::default(),
            integrations: Default::default(),
            plugins: Default::default(),
            ux: Default::default(),
            advanced: Default::default(),
            experimental: Default::default(),
            logging: Default::default(),
        }
    }
}

/// Settings for app-wide behavior and startup UX.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct General {
    #[serde(default)]
    pub theme: Theme,
    #[serde(default = "default_theme_pack")]
    pub theme_pack: String,
    #[serde(default)]
    pub language: Language,
    #[serde(default)]
    pub default_backend: String,
    #[serde(default)]
    pub update_channel: UpdateChannel,
    #[serde(default = "default_true")]
    pub reopen_last_repos: bool,
    #[serde(default = "default_true")]
    pub checks_on_launch: bool,
    #[serde(default)]
    pub telemetry: bool,
    #[serde(default = "default_true")]
    pub crash_reports: bool,
}
impl Default for General {
    /// Returns default general settings values.
    ///
    /// # Returns
    /// - Default [`General`].
    fn default() -> Self {
        Self {
            theme: Theme::System,
            theme_pack: default_theme_pack(),
            language: Language::System,
            default_backend: DEFAULT_BACKEND_ID.into(),
            update_channel: UpdateChannel::Stable,
            reopen_last_repos: true,
            checks_on_launch: true,
            telemetry: false,
            crash_reports: true,
        }
    }
}

/// Returns the default theme pack id.
///
/// # Returns
/// - Default theme pack string.
pub(crate) fn default_theme_pack() -> String {
    "default".to_string()
}

/// Settings that control VCS backend behavior.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Vcs {
    #[serde(default)]
    pub backend: String,
    /// Default branch name used when creating new repos or inferring defaults
    #[serde(default)]
    pub default_branch: String,
    /// Which SSH binary to use for the system-git backend.
    ///
    /// On Linux AppImage, the bundled `ssh` can be older than the host and may fail to parse
    /// distro crypto-policy configuration. `Auto` prefers the host OpenSSH if present.
    #[serde(default)]
    pub ssh_binary: GitSshBinary,
    /// Used when `ssh_binary = "custom"`.
    #[serde(default)]
    pub ssh_path: String,
    #[serde(default)]
    pub fetch_on_focus: bool,
    #[serde(default)]
    pub allow_hooks: HookPolicy,
    #[serde(default)]
    pub respect_core_autocrlf: bool,
    /// Commit message template used for automatic merge commits.
    ///
    /// If empty, Git's default merge message is used.
    /// Supported placeholders: {branch:source}, {branch:target}, {repo:name}, {repo:username}
    #[serde(default)]
    pub merge_commit_message_template: String,
}
impl Default for Vcs {
    /// Returns default VCS settings values.
    ///
    /// # Returns
    /// - Default [`Vcs`].
    fn default() -> Self {
        Self {
            backend: DEFAULT_BACKEND_ID.into(),
            default_branch: "main".into(),
            ssh_binary: GitSshBinary::Auto,
            ssh_path: String::new(),
            fetch_on_focus: true,
            allow_hooks: HookPolicy::Ask,
            respect_core_autocrlf: true,
            merge_commit_message_template: "Merged branch '{branch:source}' into '{branch:target}'"
                .into(),
        }
    }
}

/// Commit settings for commit-message prefill behavior.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Commit {
    /// Enables commit summary prefill when one full file is selected.
    #[serde(default = "default_true")]
    pub commit_message_template_enabled: bool,
    /// When enabled, commit hooks may not rewrite the user-entered commit summary.
    #[serde(default = "default_true")]
    pub restrict_commit_summary: bool,
    /// Commit summary templates used for single-file prefill.
    #[serde(default)]
    pub commit_templates: CommitTemplates,
}
impl Default for Commit {
    /// Returns default commit template settings values.
    fn default() -> Self {
        Self {
            commit_message_template_enabled: true,
            restrict_commit_summary: true,
            commit_templates: Default::default(),
        }
    }
}

/// Commit template strings used for single-file prefill.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CommitTemplates {
    /// Commit summary template used for single new-file prefill.
    #[serde(default = "default_commit_message_create_template")]
    pub commit_message_template_create: String,
    /// Commit summary template used for single modified-file prefill.
    #[serde(default = "default_commit_message_update_template")]
    pub commit_message_template_update: String,
    /// Commit summary template used for single deleted-file prefill.
    #[serde(default = "default_commit_message_delete_template")]
    pub commit_message_template_delete: String,
}
impl Default for CommitTemplates {
    /// Returns default commit template strings.
    fn default() -> Self {
        Self {
            commit_message_template_create: default_commit_message_create_template(),
            commit_message_template_update: default_commit_message_update_template(),
            commit_message_template_delete: default_commit_message_delete_template(),
        }
    }
}

/// Returns the default template used for creating a commit from one new file.
fn default_commit_message_create_template() -> String {
    "Create {file:name}".to_string()
}

/// Returns the default template used for updating a commit from one modified file.
fn default_commit_message_update_template() -> String {
    "Update {file:name}".to_string()
}

/// Returns the default template used for deleting a commit from one deleted file.
fn default_commit_message_delete_template() -> String {
    "Delete {file:name}".to_string()
}

/// Settings for authentication and signing tools.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Credentials {
    #[serde(default)]
    pub helper: CredentialHelper,
    #[serde(default)]
    pub ssh_agent: SshAgent,
    /// Preferred keys to try; tilde expansion is handled at runtime.
    #[serde(default)]
    pub ssh_key_paths: Vec<String>,
    #[serde(default)]
    pub gpg_program: String,
    #[serde(default)]
    pub sign_commits: bool,
    #[serde(default)]
    pub signing_key: String,
}
impl Default for Credentials {
    /// Returns default credential settings values.
    ///
    /// # Returns
    /// - Default [`Credentials`].
    fn default() -> Self {
        Self {
            helper: CredentialHelper::OsKeychain,
            ssh_agent: SshAgent::Env,
            ssh_key_paths: vec!["~/.ssh/id_ed25519".into(), "~/.ssh/id_rsa".into()],
            gpg_program: "gpg".into(),
            sign_commits: false,
            signing_key: String::new(),
        }
    }
}

/// Settings that control diff rendering and external tools.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Diff {
    #[serde(default)]
    pub tab_width: u8,
    #[serde(default)]
    pub ignore_whitespace: WhitespaceMode,
    #[serde(default)]
    pub max_file_size_mb: u32,
    #[serde(default)]
    pub intraline: bool,
    #[serde(default)]
    pub show_binary_placeholders: bool,
    #[serde(default)]
    pub external_diff: ExternalTool,
    #[serde(default)]
    pub external_merge: ExternalTool,
    /// Extensions (without dot) treated as binary if not in .gitattributes
    #[serde(default)]
    pub binary_exts: Vec<String>,
}
impl Default for Diff {
    /// Returns default diff settings values.
    ///
    /// # Returns
    /// - Default [`Diff`].
    fn default() -> Self {
        Self {
            tab_width: 4,
            ignore_whitespace: WhitespaceMode::None,
            max_file_size_mb: 10,
            intraline: true,
            show_binary_placeholders: true,
            external_diff: ExternalTool::disabled(),
            external_merge: ExternalTool::disabled(),
            binary_exts: vec!["png".into(), "jpg".into(), "dds".into(), "uasset".into()],
        }
    }
}

/// Performance and animation tuning options.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Performance {
    #[serde(default)]
    pub progressive_render: bool,
    #[serde(default = "default_true")]
    pub gpu_accel: bool,
    #[serde(default = "default_true")]
    pub animations: bool,
}
impl Default for Performance {
    /// Returns default performance settings values.
    ///
    /// # Returns
    /// - Default [`Performance`].
    fn default() -> Self {
        Self {
            progressive_render: true,
            gpu_accel: true,
            animations: true,
        }
    }
}

/// Integrations with editors and issue providers.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Integrations {
    #[serde(default)]
    pub default_editor: EditorChoice,
    #[serde(default)]
    pub issue_provider: IssueProvider,
    /// "Remote host → provider" mapping; e.g. "gitlab.myco.com" = "gitlab"
    #[serde(default)]
    pub host_overrides: std::collections::BTreeMap<String, IssueProvider>,
}
impl Default for Integrations {
    /// Returns default integration settings values.
    ///
    /// # Returns
    /// - Default [`Integrations`].
    fn default() -> Self {
        Self {
            default_editor: EditorChoice::System,
            issue_provider: IssueProvider::Auto,
            host_overrides: Default::default(),
        }
    }
}

/// Plugin source and enable/disable settings.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
pub struct Plugins {
    /// Plugin ids that are installed but disabled.
    ///
    /// IDs are matched case-insensitively.
    #[serde(default)]
    pub disabled: Vec<String>,
    /// Plugin ids that are installed and explicitly enabled.
    ///
    /// IDs are matched case-insensitively.
    #[serde(default)]
    pub enabled: Vec<String>,
}

/// User interface and accessibility options.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Ux {
    #[serde(default)]
    pub ui_scale: f32,
    #[serde(default)]
    pub font_mono: String,
    #[serde(default)]
    pub vim_nav: bool,
    #[serde(default)]
    pub color_blind_mode: ColorBlindMode,
    /// Max number of recent repositories to keep in MRU list
    #[serde(default)]
    pub recents_limit: u32,
}
impl Default for Ux {
    /// Returns default UX settings values.
    ///
    /// # Returns
    /// - Default [`Ux`].
    fn default() -> Self {
        Self {
            ui_scale: 1.0,
            font_mono: "monospace".into(),
            vim_nav: false,
            color_blind_mode: ColorBlindMode::None,
            recents_limit: 10,
        }
    }
}

/// Advanced networking and force-push safety options.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Advanced {
    #[serde(default)]
    pub confirm_force_push: ForcePushPolicy,
    #[serde(default)]
    pub ssl_verify: bool,
    #[serde(default)]
    pub proxy: Proxy,
}
impl Default for Advanced {
    /// Returns default advanced settings values.
    ///
    /// # Returns
    /// - Default [`Advanced`].
    fn default() -> Self {
        Self {
            confirm_force_push: ForcePushPolicy::Always,
            ssl_verify: true,
            proxy: Proxy::system(),
        }
    }
}

/// Experimental features that may change between releases.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
pub struct Experimental {
    #[serde(default)]
    pub parallel_history_scan: bool,
    #[serde(default)]
    pub background_blame_index: bool,
    #[serde(default)]
    pub sparse_checkout_ui: bool,
}

/// Logging verbosity and retention options.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Logging {
    #[serde(default)]
    pub level: LogLevel,
    /// When true, show a live diagnostics pane in-app.
    #[serde(default)]
    pub live_viewer: bool,
    /// How many archived logs to keep after rotation.
    /// Use a serde default of 10 when the field is omitted in existing configs.
    #[serde(default = "default_retain_archives")]
    pub retain_archives: u32,
}
impl Default for Logging {
    /// Returns default logging settings values.
    ///
    /// # Returns
    /// - Default [`Logging`].
    fn default() -> Self {
        Self {
            level: LogLevel::Info,
            live_viewer: false,
            retain_archives: 10,
        }
    }
}

/// Serde helper default for retained log archive count.
///
/// # Returns
/// - Archive count default.
fn default_retain_archives() -> u32 {
    10
}

/// Theme preference for application chrome.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
#[derive(Default)]
pub enum Theme {
    Light,
    Dark,
    #[default]
    System,
}

/// Preferred language for localized UI text.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
#[derive(Default)]
pub enum Language {
    #[default]
    System,
    EN,
}

/// Release channel used by update checks.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
#[derive(Default)]
pub enum UpdateChannel {
    #[default]
    Stable,
    Beta,
    Nightly,
}

/// SSH binary selection strategy for Git operations.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
#[derive(Default)]
pub enum GitSshBinary {
    #[default]
    Auto,
    Host,
    Bundled,
    Custom,
}

/// Policy used when Git hooks are encountered.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
#[derive(Default)]
pub enum HookPolicy {
    Deny,
    #[default]
    Ask,
    Allow,
}

/// Credential helper preference used for HTTPS authentication.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
#[derive(Default)]
pub enum CredentialHelper {
    #[default]
    OsKeychain,
    None,
}

/// SSH agent integration mode.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
#[derive(Default)]
pub enum SshAgent {
    #[default]
    Env,
    OnePassword,
    Pageant,
    None,
}

/// Whitespace filtering mode for diffs.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
#[derive(Default)]
pub enum WhitespaceMode {
    #[default]
    None,
    Eol,
    All,
}

/// Executable and arguments for an optional external diff/merge tool.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ExternalTool {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub path: String,
    #[serde(default)]
    pub args: String,
}
impl ExternalTool {
    /// Returns a disabled external tool configuration.
    ///
    /// # Returns
    /// - An [`ExternalTool`] with `enabled = false` and empty command fields.
    pub fn disabled() -> Self {
        Self {
            enabled: false,
            path: String::new(),
            args: String::new(),
        }
    }
}
impl Default for ExternalTool {
    /// Returns the disabled default external tool config.
    ///
    /// # Returns
    /// - Default [`ExternalTool`].
    fn default() -> Self {
        Self::disabled()
    }
}

/// Preferred editor integration target.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
#[derive(Default)]
pub enum EditorChoice {
    #[default]
    System,
    Code,
    Clion,
    Rider,
    Neovim,
    Custom,
}

/// Preferred issue provider mapping mode.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
#[derive(Default)]
pub enum IssueProvider {
    #[default]
    Auto,
    Github,
    Gitlab,
    Forgejo,
}

/// Color-vision accessibility mode for diff/UI accents.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
#[derive(Default)]
pub enum ColorBlindMode {
    #[default]
    None,
    Protanopia,
    Deuteranopia,
    Tritanopia,
}

/// Force-push confirmation policy.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
#[derive(Default)]
pub enum ForcePushPolicy {
    #[default]
    Always,
    TrackedRemotes,
    Never,
}

/// HTTP proxy configuration used for network operations.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Proxy {
    #[serde(default)]
    pub mode: ProxyMode,
    #[serde(default)]
    pub url: String,
}
impl Proxy {
    /// Returns the default proxy configuration that uses the system proxy settings.
    ///
    /// # Returns
    /// - A [`Proxy`] configured with [`ProxyMode::System`].
    pub fn system() -> Self {
        Self {
            mode: ProxyMode::System,
            url: String::new(),
        }
    }
}
impl Default for Proxy {
    /// Returns the default system-proxy configuration.
    ///
    /// # Returns
    /// - Default [`Proxy`].
    fn default() -> Self {
        Proxy::system()
    }
}

/// Proxy mode selection.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
#[derive(Default)]
pub enum ProxyMode {
    #[default]
    System,
    Manual,
    Off,
}

/// Application log verbosity.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
#[derive(Default)]
pub enum LogLevel {
    Trace,
    Debug,
    #[default]
    Info,
    Warn,
    Error,
}
