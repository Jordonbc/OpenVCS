// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later
use std::sync::Arc;

use crate::core::models::VcsEvent;
use crate::core::settings::SettingKv;
use crate::core::ui::Menu;

/// Runtime instance abstraction used by the plugin runtime manager.
pub trait PluginRuntimeInstance: Send + Sync {
    /// Ensures the underlying runtime instance is started.
    fn ensure_running(&self) -> Result<(), String>;

    /// Returns plugin-contributed UI menus.
    fn get_menus(&self) -> Result<Vec<Menu>, String> {
        Ok(Vec::new())
    }

    /// Invokes a plugin action by id.
    fn handle_action(&self, _id: &str) -> Result<(), String> {
        Ok(())
    }

    /// Returns plugin settings defaults.
    fn settings_defaults(&self) -> Result<Vec<SettingKv>, String> {
        Ok(Vec::new())
    }

    /// Applies plugin settings values after host load.
    #[allow(dead_code)]
    fn settings_on_load(&self, values: Vec<SettingKv>) -> Result<Vec<SettingKv>, String> {
        Ok(values)
    }

    /// Applies effective plugin settings values at runtime.
    fn settings_on_apply(&self, _values: Vec<SettingKv>) -> Result<(), String> {
        Ok(())
    }

    /// Validates and normalizes plugin settings before host save.
    fn settings_on_save(&self, values: Vec<SettingKv>) -> Result<Vec<SettingKv>, String> {
        Ok(values)
    }

    /// Handles plugin settings reset callbacks.
    fn settings_on_reset(&self) -> Result<(), String> {
        Ok(())
    }

    /// Installs an optional event sink for runtime-emitted events.
    fn set_event_sink(&self, _sink: Option<Arc<dyn Fn(VcsEvent) + Send + Sync + 'static>>) {}

    /// Stops the runtime instance.
    fn stop(&self);
}
