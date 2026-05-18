// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

//! General plugin UI contribution models.

use serde::{Deserialize, Serialize};

#[cfg(test)]
mod tests {
    include!("../../tests/core/ui.rs");
}

/// Menu surface target for rendering.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum MenuSurface {
    /// Menu appears in the main menubar.
    Menubar,
    /// Menu appears in the settings modal.
    Settings,
}

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
    /// Required render target surface ('menubar' or 'settings').
    pub surface: MenuSurface,
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
