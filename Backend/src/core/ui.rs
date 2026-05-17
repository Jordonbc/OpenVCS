// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

//! General plugin UI contribution models.

use serde::{Deserialize, Serialize};

#[cfg(test)]
mod tests {
    use super::{Menu, MenuSurface, UiButton, UiElement, UiText};

    #[test]
    /// Verifies menu surface tags serialize with kebab-case names.
    fn serializes_menu_surface_names() {
        assert_eq!(serde_json::to_value(MenuSurface::Menubar).expect("serialize menubar"), serde_json::json!("menubar"));
        assert_eq!(serde_json::to_value(MenuSurface::Settings).expect("serialize settings"), serde_json::json!("settings"));
    }

    #[test]
    /// Verifies UI menus round-trip through JSON with nested elements.
    fn serializes_and_deserializes_menu_definitions() {
        let menu = Menu {
            id: "main".into(),
            label: "Main".into(),
            order: Some(3),
            surface: MenuSurface::Menubar,
            elements: vec![
                UiElement::Text(UiText {
                    id: "welcome".into(),
                    content: "Hello".into(),
                }),
                UiElement::Button(UiButton {
                    id: "refresh".into(),
                    label: "Refresh".into(),
                }),
            ],
        };

        let json = serde_json::to_value(&menu).expect("serialize menu");
        let decoded: Menu = serde_json::from_value(json).expect("deserialize menu");
        assert_eq!(decoded.id, "main");
        assert_eq!(decoded.label, "Main");
        assert_eq!(decoded.order, Some(3));
        assert!(matches!(decoded.surface, MenuSurface::Menubar));
        assert_eq!(decoded.elements.len(), 2);
    }
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
