//! Global application configuration types and persistence helpers.

use directories::ProjectDirs;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::{fs, io};

/// Serde helper default for `true`.
///
/// # Returns
/// - `true`.
fn default_true() -> bool {
    true
}

/// Root global settings document persisted as TOML.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppConfig {
    pub schema_version: u32,
    #[serde(default)]
    pub general: General,
    #[serde(default)]
    pub git: Git,
    #[serde(default)]
    pub credentials: Credentials,
    #[serde(default)]
    pub diff: Diff,
    #[serde(default)]
    pub lfs: Lfs,
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
            general: Default::default(),
            git: Default::default(),
            credentials: Default::default(),
            diff: Default::default(),
            lfs: Default::default(),
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
#[derive(Debug, Clone, Serialize, Deserialize)]
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
    #[serde(default)]
    pub reopen_last_repos: bool,
    #[serde(default)]
    pub checks_on_launch: bool,
    #[serde(default)]
    pub telemetry: bool,
    #[serde(default)]
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
            default_backend: "git".into(),
            update_channel: UpdateChannel::Stable,
            reopen_last_repos: true,
            checks_on_launch: true,
            telemetry: false,
            crash_reports: false,
        }
    }
}

/// Returns the default theme pack id.
///
/// # Returns
/// - Default theme pack string.
fn default_theme_pack() -> String {
    "default".to_string()
}

/// Settings that control Git backend behavior.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Git {
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
    pub prune_on_fetch: bool,
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
impl Default for Git {
    /// Returns default Git settings values.
    ///
    /// # Returns
    /// - Default [`Git`].
    fn default() -> Self {
        Self {
            backend: String::new(),
            default_branch: "main".into(),
            ssh_binary: GitSshBinary::Auto,
            ssh_path: String::new(),
            prune_on_fetch: true,
            fetch_on_focus: true,
            allow_hooks: HookPolicy::Ask,
            respect_core_autocrlf: true,
            merge_commit_message_template: "Merged branch '{branch:source}' into '{branch:target}'"
                .into(),
        }
    }
}

/// Settings for authentication and signing tools.
#[derive(Debug, Clone, Serialize, Deserialize)]
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
#[derive(Debug, Clone, Serialize, Deserialize)]
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

/// Git LFS behavior settings.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Lfs {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub concurrency: u8,
    #[serde(default)]
    pub require_lock_before_edit: bool,
    #[serde(default)]
    pub background_fetch_on_checkout: bool,
}
impl Default for Lfs {
    /// Returns default LFS settings values.
    ///
    /// # Returns
    /// - Default [`Lfs`].
    fn default() -> Self {
        Self {
            enabled: true,
            concurrency: 4,
            require_lock_before_edit: false,
            background_fetch_on_checkout: true,
        }
    }
}

/// Performance and animation tuning options.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Performance {
    #[serde(default)]
    pub progressive_render: bool,
    #[serde(default)]
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
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Integrations {
    #[serde(default)]
    pub default_editor: EditorChoice,
    #[serde(default)]
    pub issue_provider: IssueProvider,
    /// “Remote host → provider” mapping; e.g. "gitlab.myco.com" = "gitlab"
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

/// Plugin enable/disable overrides.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
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
#[derive(Debug, Clone, Serialize, Deserialize)]
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
#[derive(Debug, Clone, Serialize, Deserialize)]
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
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Experimental {
    #[serde(default)]
    pub parallel_history_scan: bool,
    #[serde(default)]
    pub background_blame_index: bool,
    #[serde(default)]
    pub sparse_checkout_ui: bool,
}

/// Logging verbosity and retention options.
#[derive(Debug, Clone, Serialize, Deserialize)]
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
#[derive(Debug, Clone, Serialize, Deserialize)]
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
#[derive(Debug, Clone, Serialize, Deserialize)]
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

//
impl AppConfig {
    /// ~/.config/openvcs/openvcs.conf (XDG/macOS/Windows aware)
    ///
    /// # Returns
    /// - Filesystem path to the global OpenVCS config file.
    pub fn path() -> PathBuf {
        if let Some(pd) = ProjectDirs::from("dev", "OpenVCS", "OpenVCS") {
            pd.config_dir().join("openvcs.conf")
        } else {
            PathBuf::from("openvcs.conf")
        }
    }

    /// Load from disk or fall back to defaults; then migrate+validate.
    ///
    /// # Returns
    /// - A valid [`AppConfig`] loaded from disk or synthesized from defaults.
    pub fn load_or_default() -> Self {
        let p = Self::path();
        let mut cfg = match fs::read_to_string(&p) {
            Ok(s) => toml::from_str::<AppConfig>(&s).unwrap_or_default(),
            Err(_) => AppConfig::default(),
        };
        cfg.migrate();
        cfg.validate();
        cfg
    }

    /// Pretty TOML write with atomic-ish replace.
    ///
    /// # Returns
    /// - `Ok(())` when the config file was written successfully.
    /// - `Err(io::Error)` when writing or renaming fails.
    pub fn save(&self) -> io::Result<()> {
        let p = Self::path();
        if let Some(parent) = p.parent() {
            fs::create_dir_all(parent)?;
        }
        let data = toml::to_string_pretty(self).expect("serialize config");
        let tmp = p.with_extension("conf.tmp");
        fs::write(&tmp, data)?;
        fs::rename(tmp, p)
    }

    /// Returns whether a plugin should be considered enabled by current settings.
    ///
    /// # Parameters
    /// - `plugin_id`: Plugin id to evaluate.
    /// - `default_enabled`: Manifest-provided default enabled flag.
    ///
    /// # Returns
    /// - `true` when plugin should be active.
    /// - `false` otherwise.
    pub fn is_plugin_enabled(&self, plugin_id: &str, default_enabled: bool) -> bool {
        let plugin_id = plugin_id.trim().to_ascii_lowercase();
        if plugin_id.is_empty() {
            return false;
        }
        if self
            .plugins
            .disabled
            .iter()
            .any(|id| id.trim().eq_ignore_ascii_case(&plugin_id))
        {
            return false;
        }
        default_enabled
            || self
                .plugins
                .enabled
                .iter()
                .any(|id| id.trim().eq_ignore_ascii_case(&plugin_id))
    }

    /// Future-proof migrations between schema versions.
    ///
    /// # Returns
    /// - `()`.
    pub fn migrate(&mut self) {
        match self.schema_version {
            0 => { /* never shipped */ }
            1 => { /* current */ }
            _ => { /* future: add stepwise migrations */ }
        }
        // no-op
    }

    /// Clamp and normalize values so hand edits can’t break the app.
    ///
    /// # Returns
    /// - `()`.
    pub fn validate(&mut self) {
        // General: nothing to clamp right now.
        if self.general.theme_pack.trim().is_empty() {
            self.general.theme_pack = default_theme_pack();
        }
        self.general.default_backend = self.general.default_backend.trim().to_string();
        if self.general.default_backend.is_empty() {
            self.general.default_backend = "git".into();
        }

        // Git
        self.git.backend = self.git.backend.trim().to_string();
        if self.git.default_branch.trim().is_empty() {
            self.git.default_branch = "main".into();
        }
        if self.git.ssh_path.trim().is_empty() && self.git.ssh_binary == GitSshBinary::Custom {
            self.git.ssh_binary = GitSshBinary::Auto;
        }

        // Diff
        self.diff.tab_width = self.diff.tab_width.clamp(1, 16);
        self.diff.max_file_size_mb = self.diff.max_file_size_mb.clamp(1, 1024);

        // LFS
        self.lfs.concurrency = self.lfs.concurrency.clamp(1, 16);

        // Performance

        // Plugins
        {
            let mut seen = std::collections::HashSet::new();
            self.plugins.disabled = self
                .plugins
                .disabled
                .iter()
                .map(|s| s.trim().to_ascii_lowercase())
                .filter(|s| !s.is_empty())
                .filter(|s| seen.insert(s.clone()))
                .collect();
        }
        {
            let mut seen = std::collections::HashSet::new();
            self.plugins.enabled = self
                .plugins
                .enabled
                .iter()
                .map(|s| s.trim().to_ascii_lowercase())
                .filter(|s| !s.is_empty())
                .filter(|s| seen.insert(s.clone()))
                .collect();
        }
        // If a plugin is in both lists, treat it as disabled.
        if !self.plugins.disabled.is_empty() && !self.plugins.enabled.is_empty() {
            let disabled: std::collections::HashSet<&str> =
                self.plugins.disabled.iter().map(|s| s.as_str()).collect();
            self.plugins
                .enabled
                .retain(|id| !disabled.contains(id.as_str()));
        }

        // UX
        self.ux.recents_limit = self.ux.recents_limit.clamp(1, 100);

        // Logging
        if self.logging.retain_archives == 0 {
            self.logging.retain_archives = 1;
        }
        self.logging.retain_archives = self.logging.retain_archives.clamp(1, 100);
    }
}
