// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later
//! AppConfig persistence and validation methods.

use crate::app_identity;
use std::path::PathBuf;
use std::{fs, io};

use super::{AppConfig, DEFAULT_BACKEND_ID, SshBinary, default_theme_pack};

impl AppConfig {
    /// ~/.config/openvcs/openvcs.conf (XDG/macOS/Windows aware)
    ///
    /// # Returns
    /// - Filesystem path to the global OpenVCS config file.
    pub fn path() -> PathBuf {
        if let Some(pd) = app_identity::project_dirs() {
            pd.config_dir().join("openvcs.conf")
        } else {
            PathBuf::from("openvcs.conf")
        }
    }

    /// Load from disk or fall back to defaults; then validate.
    ///
    /// # Returns
    /// - A valid [`AppConfig`] loaded from disk or synthesized from defaults.
    pub fn load_or_default() -> Self {
        let p = Self::path();
        let mut cfg = match fs::read_to_string(&p) {
            Ok(s) => toml::from_str::<AppConfig>(&s).unwrap_or_default(),
            Err(_) => AppConfig::default(),
        };
        cfg.validate();
        cfg
    }

    /// Pretty TOML write with atomic-ish replace.
    ///
    /// # Returns
    /// - `Ok(())` when the config file was written successfully.
    /// - `Err(io::Error)` when writing or renaming fails.
    pub fn save(&self) -> io::Result<()> {
        #[cfg(test)]
        crate::app_identity::assert_test_isolation();
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


    /// Clamp and normalize values so hand edits can't break the app.
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
            self.general.default_backend = DEFAULT_BACKEND_ID.into();
        }

        // Vcs
        self.vcs.backend = self.vcs.backend.trim().to_string();
        if self.vcs.default_branch.trim().is_empty() {
            self.vcs.default_branch = "main".into();
        }
        if self.vcs.ssh_path.trim().is_empty() && self.vcs.ssh_binary == SshBinary::Custom {
            self.vcs.ssh_binary = SshBinary::Auto;
        }

        // Diff
        self.diff.tab_width = self.diff.tab_width.clamp(1, 16);
        self.diff.max_file_size_mb = self.diff.max_file_size_mb.clamp(1, 1024);

        // Performance

        // Plugin source list
        {
            let mut seen = std::collections::HashSet::new();
            self.plugin = self
                .plugin
                .iter()
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .filter(|s| seen.insert(s.clone()))
                .collect();
        }

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

#[cfg(test)]
mod tests {
    include!("../../tests/modules/settings_persistence.rs");
}
