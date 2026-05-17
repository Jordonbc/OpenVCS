// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

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
