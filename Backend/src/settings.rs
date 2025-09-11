use std::{fs, io};
use std::path::PathBuf;
use std::time::Duration;
use directories::ProjectDirs;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppConfig {
    pub schema_version: u32,
    #[serde(default)] pub general: General,
    #[serde(default)] pub git: Git,
    #[serde(default)] pub credentials: Credentials,
    #[serde(default)] pub diff: Diff,
    #[serde(default)] pub lfs: Lfs,
    #[serde(default)] pub performance: Performance,
    #[serde(default)] pub integrations: Integrations,
    #[serde(default)] pub ux: Ux,
    #[serde(default)] pub advanced: Advanced,
    #[serde(default)] pub experimental: Experimental,
    #[serde(default)] pub logging: Logging,
    #[serde(default)] pub network: Network,
}

impl Default for AppConfig {
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
            ux: Default::default(),
            advanced: Default::default(),
            experimental: Default::default(),
            logging: Default::default(),
            network: Default::default(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct General {
    #[serde(default)] pub theme: Theme,
    #[serde(default)] pub language: Language,
    #[serde(default)] pub default_backend: DefaultBackend,
    #[serde(default)] pub update_channel: UpdateChannel,
    #[serde(default)] pub reopen_last_repos: bool,
    #[serde(default)] pub checks_on_launch: bool,
    #[serde(default)] pub telemetry: bool,
    #[serde(default)] pub crash_reports: bool,
}
impl Default for General {
    fn default() -> Self {
        Self {
            theme: Theme::System,
            language: Language::System,
            default_backend: DefaultBackend::Git,
            update_channel: UpdateChannel::Stable,
            reopen_last_repos: true,
            checks_on_launch: true,
            telemetry: false,
            crash_reports: false,
            }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Git {
    #[serde(default)] pub backend: GitBackend,
    /// Default branch name used when creating new repos or inferring defaults
    #[serde(default)] pub default_branch: String,
    #[serde(default)] pub prune_on_fetch: bool,
    #[serde(default)] pub allow_hooks: HookPolicy,
    #[serde(default)] pub respect_core_autocrlf: bool,
}
impl Default for Git {
    fn default() -> Self {
        Self {
            backend: GitBackend::System,
            default_branch: "main".into(),
            prune_on_fetch: true,
            allow_hooks: HookPolicy::Ask,
            respect_core_autocrlf: true,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Credentials {
    #[serde(default)] pub helper: CredentialHelper,
    #[serde(default)] pub ssh_agent: SshAgent,
    /// Preferred keys to try; tilde expansion is handled at runtime.
    #[serde(default)] pub ssh_key_paths: Vec<String>,
    #[serde(default)] pub gpg_program: String,
    #[serde(default)] pub sign_commits: bool,
    #[serde(default)] pub signing_key: String,
}
impl Default for Credentials {
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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Diff {
    #[serde(default)] pub tab_width: u8,
    #[serde(default)] pub ignore_whitespace: WhitespaceMode,
    #[serde(default)] pub max_file_size_mb: u32,
    #[serde(default)] pub intraline: bool,
    #[serde(default)] pub show_binary_placeholders: bool,
    #[serde(default)] pub external_diff: ExternalTool,
    #[serde(default)] pub external_merge: ExternalTool,
    /// Extensions (without dot) treated as binary if not in .gitattributes
    #[serde(default)] pub binary_exts: Vec<String>,
}
impl Default for Diff {
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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Lfs {
    #[serde(default)] pub enabled: bool,
    #[serde(default)] pub concurrency: u8,
    #[serde(default)] pub require_lock_before_edit: bool,
    #[serde(default)] pub background_fetch_on_checkout: bool,
}
impl Default for Lfs {
    fn default() -> Self {
        Self {
            enabled: true,
            concurrency: 4,
            require_lock_before_edit: false,
            background_fetch_on_checkout: true,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Performance {
    #[serde(default)] pub progressive_render: bool,
    #[serde(default)] pub gpu_accel: bool,
    
}
impl Default for Performance {
    fn default() -> Self {
        Self {
            progressive_render: true,
            gpu_accel: true,
            
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Integrations {
    #[serde(default)] pub default_editor: EditorChoice,
    #[serde(default)] pub issue_provider: IssueProvider,
    /// “Remote host → provider” mapping; e.g. "gitlab.myco.com" = "gitlab"
    #[serde(default)] pub host_overrides: std::collections::BTreeMap<String, IssueProvider>,
}
impl Default for Integrations {
    fn default() -> Self {
        Self {
            default_editor: EditorChoice::System,
            issue_provider: IssueProvider::Auto,
            host_overrides: Default::default(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Ux {
    #[serde(default)] pub ui_scale: f32,
    #[serde(default)] pub font_mono: String,
    #[serde(default)] pub vim_nav: bool,
    #[serde(default)] pub color_blind_mode: ColorBlindMode,
    /// Max number of recent repositories to keep in MRU list
    #[serde(default)] pub recents_limit: u32,
}
impl Default for Ux {
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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Advanced {
    #[serde(default)] pub confirm_force_push: ForcePushPolicy,
    #[serde(default)] pub ssl_verify: bool,
    #[serde(default)] pub proxy: Proxy,
}
impl Default for Advanced {
    fn default() -> Self {
        Self {
            confirm_force_push: ForcePushPolicy::Always,
            ssl_verify: true,
            proxy: Proxy::system(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Experimental {
    #[serde(default)] pub parallel_history_scan: bool,
    #[serde(default)] pub background_blame_index: bool,
    #[serde(default)] pub sparse_checkout_ui: bool,
}
impl Default for Experimental {
    fn default() -> Self {
        Self {
            parallel_history_scan: false,
            background_blame_index: false,
            sparse_checkout_ui: false,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Logging {
    #[serde(default)] pub level: LogLevel,
    /// When true, show a live diagnostics pane in-app.
    #[serde(default)] pub live_viewer: bool,
    /// How many archived logs to keep after rotation.
    /// Use a serde default of 10 when the field is omitted in existing configs.
    #[serde(default = "default_retain_archives")] pub retain_archives: u32,
}
impl Default for Logging {
    fn default() -> Self {
        Self {
            level: LogLevel::Info,
            live_viewer: false,
            retain_archives: 10,
        }
    }
}

fn default_retain_archives() -> u32 { 10 }

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Network {
    #[serde(default)] pub http_low_speed_time_secs: u64,
    #[serde(default)] pub http_low_speed_limit: u32, // bytes/sec
    #[serde(default)] pub extra_ssl_roots: Vec<PathBuf>,
}
impl Default for Network {
    fn default() -> Self {
        Self {
            http_low_speed_time_secs: 30,
            http_low_speed_limit: 1024,
            extra_ssl_roots: vec![],
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum Theme { Light, Dark, System }
impl Default for Theme { fn default() -> Self { Theme::System } }

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum Language { System, EN }
impl Default for Language { fn default() -> Self { Language::System } }

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum UpdateChannel { Stable, Beta, Nightly }
impl Default for UpdateChannel { fn default() -> Self { UpdateChannel::Stable } }

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum GitBackend { System, Libgit2 }
impl Default for GitBackend { fn default() -> Self { GitBackend::System } }

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum DefaultBackend { Git }
impl Default for DefaultBackend { fn default() -> Self { DefaultBackend::Git } }

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum HookPolicy { Deny, Ask, Allow }
impl Default for HookPolicy { fn default() -> Self { HookPolicy::Ask } }

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum CredentialHelper { OsKeychain, None }
impl Default for CredentialHelper { fn default() -> Self { CredentialHelper::OsKeychain } }

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum SshAgent { Env, OnePassword, Pageant, None }
impl Default for SshAgent { fn default() -> Self { SshAgent::Env } }

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum WhitespaceMode { None, Eol, All }
impl Default for WhitespaceMode { fn default() -> Self { WhitespaceMode::None } }

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExternalTool {
    #[serde(default)] pub enabled: bool,
    #[serde(default)] pub path: String,
    #[serde(default)] pub args: String,
}
impl ExternalTool {
    pub fn disabled() -> Self { Self { enabled: false, path: String::new(), args: String::new() } }
}
impl Default for ExternalTool { fn default() -> Self { Self::disabled() } }

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum EditorChoice { System, Code, Clion, Rider, Neovim, Custom }
impl Default for EditorChoice { fn default() -> Self { EditorChoice::System } }

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum IssueProvider { Auto, Github, Gitlab, Forgejo }
impl Default for IssueProvider { fn default() -> Self { IssueProvider::Auto } }

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum ColorBlindMode { None, Protanopia, Deuteranopia, Tritanopia }
impl Default for ColorBlindMode { fn default() -> Self { ColorBlindMode::None } }

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum ForcePushPolicy { Always, TrackedRemotes, Never }
impl Default for ForcePushPolicy { fn default() -> Self { ForcePushPolicy::Always } }

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Proxy {
    #[serde(default)] pub mode: ProxyMode,
    #[serde(default)] pub url: String,
}
impl Proxy {
    pub fn system() -> Self { Self { mode: ProxyMode::System, url: String::new() } }
}
impl Default for Proxy { fn default() -> Self { Proxy::system() } }

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum ProxyMode { System, Manual, Off }
impl Default for ProxyMode { fn default() -> Self { ProxyMode::System } }

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum LogLevel { Trace, Debug, Info, Warn, Error }
impl Default for LogLevel { fn default() -> Self { LogLevel::Info } }

//
// ──────────────────────────────────────────────────────────────────────────────
// Convenience
// ──────────────────────────────────────────────────────────────────────────────
impl Network {
    pub fn http_low_speed_time(&self) -> Duration {
        Duration::from_secs(self.http_low_speed_time_secs)
    }
}

impl AppConfig {
    /// ~/.config/openvcs/openvcs.conf (XDG/macOS/Windows aware)
    pub fn path() -> PathBuf {
        if let Some(pd) = ProjectDirs::from("dev", "OpenVCS", "OpenVCS") {
            pd.config_dir().join("openvcs.conf")
        } else {
            PathBuf::from("openvcs.conf")
        }
    }

    /// Load from disk or fall back to defaults; then migrate+validate.
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

    /// Future-proof migrations between schema versions.
    pub fn migrate(&mut self) {
        match self.schema_version {
            0 => { /* never shipped */ }
            1 => { /* current */ }
            _ => { /* future: add stepwise migrations */ }
        }
        // no-op
    }

    /// Clamp and normalize values so hand edits can’t break the app.
    pub fn validate(&mut self) {
        // General: nothing to clamp right now.

        // Git

        // Diff
        self.diff.tab_width = self.diff.tab_width.clamp(1, 16);
        self.diff.max_file_size_mb = self.diff.max_file_size_mb.clamp(1, 1024);

        // LFS
        self.lfs.concurrency = self.lfs.concurrency.clamp(1, 16);

        // Performance

        // Network
        self.network.http_low_speed_time_secs =
            self.network.http_low_speed_time_secs.clamp(1, 600);
        self.network.http_low_speed_limit =
            self.network.http_low_speed_limit.clamp(128, 10_000_000);

        // UX
        self.ux.recents_limit = self.ux.recents_limit.clamp(1, 100);

        // Logging
        if self.logging.retain_archives == 0 { self.logging.retain_archives = 1; }
        self.logging.retain_archives = self.logging.retain_archives.clamp(1, 100);
    }
}
