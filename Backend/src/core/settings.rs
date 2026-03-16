// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

//! Plugin settings data models.

use serde::{Deserialize, Serialize};

/// A key/value entry in plugin settings.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SettingKv {
    /// Stable plugin-local setting identifier.
    pub id: String,
    /// Optional user-facing label for display in UI.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    /// Setting value payload.
    pub value: SettingValue,
}

/// Supported plugin setting value types.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", content = "value", rename_all = "kebab-case")]
pub enum SettingValue {
    /// Boolean setting.
    Bool(bool),
    /// Signed 32-bit integer setting.
    S32(i32),
    /// Unsigned 32-bit integer setting.
    U32(u32),
    /// 64-bit floating point setting.
    F64(f64),
    /// UTF-8 string setting.
    String(String),
}
