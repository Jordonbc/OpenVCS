// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

//! General plugin UI contribution models.

use serde::{Deserialize, Serialize};

/// Menu descriptor contributed by a plugin.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Menu {
    /// Stable plugin-local menu id.
    pub id: String,
    /// User-visible menu label.
    pub label: String,
    /// Optional display ordering hint.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub order: Option<u32>,
    /// Renderable UI elements under the menu.
    pub elements: Vec<UiElement>,
}

/// Renderable plugin UI element.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum UiElement {
    /// Static text content.
    Text(UiText),
    /// Clickable action button.
    Button(UiButton),
}

/// Static text contribution.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UiText {
    /// Stable plugin-local element id.
    pub id: String,
    /// User-visible content.
    pub content: String,
}

/// Action button contribution.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UiButton {
    /// Stable plugin-local action id.
    pub id: String,
    /// User-visible button label.
    pub label: String,
}
