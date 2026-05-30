// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later
use super::*;
use serde::Deserialize;
use serde_json::json;
use std::{fs, path::Path};
use tempfile::tempdir;

#[derive(Debug, Deserialize)]
struct StringOrVecHarness {
    #[serde(deserialize_with = "string_or_vec")]
    values: Vec<String>,
}

fn write_file(path: impl AsRef<Path>, contents: &str) {
    fs::write(path, contents).expect("write test file");
}

#[test]
/// Confirms built-in theme defaults stay stable.
fn default_theme_values_match_builtin_theme() {
    let summary = default_theme_summary();
    let payload = default_theme_payload();

    assert_eq!(summary.id, DEFAULT_THEME_ID);
    assert_eq!(summary.name, "Default");
    assert!(matches!(summary.source, ThemeSource::BuiltIn));
    assert_eq!(payload.summary.id, DEFAULT_THEME_ID);
    assert!(payload.styles.is_none());
    assert!(payload.markup.head.is_none());
    assert!(payload.markup.body.is_none());
    assert!(payload.scripts.is_empty());
}

#[test]
/// Confirms theme metadata helpers trim and namespace ids consistently.
fn metadata_helpers_normalize_theme_values() {
    assert_eq!(clean_opt(Some("  hello  ".to_string())), Some("hello".to_string()));
    assert_eq!(clean_opt(Some("   ".to_string())), None);
    assert_eq!(clean_mode(Some(" DARK ".to_string())), Some("dark".to_string()));
    assert_eq!(clean_mode(Some("sepia".to_string())), None);
    assert_eq!(namespaced_plugin_theme_id(" plugin ", " theme "), "plugin.theme");
    assert_eq!(namespaced_plugin_paired_with("plugin", ""), "");
    assert_eq!(namespaced_plugin_paired_with("plugin", "dark"), "plugin.dark");
    assert_eq!(namespaced_plugin_paired_with("plugin", "other.dark"), "other.dark");
    assert!(markup_is_empty(&ThemeMarkup::default()));
    assert!(!markup_is_empty(&ThemeMarkup {
        head: Some("<meta />".to_string()),
        body: None,
    }));
}

#[test]
/// Confirms serde helper accepts both scalar and list inputs.
fn string_or_vec_accepts_string_or_sequence() {
    let scalar: StringOrVecHarness = serde_json::from_value(json!({"values": "alpha"}))
        .expect("deserialize scalar");
    let sequence: StringOrVecHarness = serde_json::from_value(json!({"values": ["alpha", "beta"]}))
        .expect("deserialize sequence");

    assert_eq!(scalar.values, vec!["alpha".to_string()]);
    assert_eq!(sequence.values, vec!["alpha".to_string(), "beta".to_string()]);
}

#[test]
/// Confirms manifest loading fails cleanly when theme metadata is missing.
fn manifest_reading_reports_missing_manifest() {
    let dir = tempdir().expect("create temp dir");

    let err = read_manifest_from_directory(dir.path()).expect_err("missing manifest");

    assert!(err.contains("missing theme.json"));
}

#[test]
/// Confirms theme payload loading trims metadata and preserves asset order.
fn build_theme_payload_from_directory_loads_assets() {
    let dir = tempdir().expect("create temp dir");
    write_file(
        dir.path().join("theme.json"),
        &serde_json::to_string(&json!({
            "id": "solar",
            "name": " Solarized ",
            "description": "  Bright colors  ",
            "version": " 1.2.3 ",
            "author": "  OpenVCS  ",
            "appearance": " DARK ",
            "paired_with": "night",
            "styles": ["base.css"],
            "markup": {
                "head": ["head.html"],
                "body": ["body.html"]
            },
            "scripts": ["script.js"]
        }))
        .expect("serialize manifest"),
    );
    write_file(dir.path().join("base.css"), "body { color: red; }\n");
    write_file(dir.path().join("head.html"), "<meta name=\"x\">\n");
    write_file(dir.path().join("body.html"), "<div id=\"theme\"></div>\n");
    write_file(dir.path().join("script.js"), "console.log('theme');\n");

    let manifest = read_manifest_from_directory(dir.path()).expect("read manifest");
    let payload = build_theme_payload_from_directory(
        dir.path(),
        manifest,
        ThemeSource::Plugin,
        Some("plug".to_string()),
    )
    .expect("build payload");

    assert_eq!(payload.summary.id, "plug.solar");
    assert_eq!(payload.summary.name, "Solarized");
    assert_eq!(payload.summary.description.as_deref(), Some("Bright colors"));
    assert_eq!(payload.summary.version.as_deref(), Some("1.2.3"));
    assert_eq!(payload.summary.author.as_deref(), Some("OpenVCS"));
    assert_eq!(payload.summary.appearance.as_deref(), Some("dark"));
    assert_eq!(payload.summary.paired_with.as_deref(), Some("plug.night"));
    assert!(matches!(payload.summary.source, ThemeSource::Plugin));
    assert_eq!(payload.summary.plugin_id.as_deref(), Some("plug"));
    assert_eq!(payload.styles.as_deref(), Some("body { color: red; }\n"));
    assert_eq!(payload.markup.head.as_deref(), Some("<meta name=\"x\">\n"));
    assert_eq!(payload.markup.body.as_deref(), Some("<div id=\"theme\"></div>\n"));
    assert_eq!(payload.scripts, vec!["console.log('theme');\n".to_string()]);
}

#[test]
fn build_theme_payload_from_directory_keeps_builtin_ids() {
    let dir = tempdir().expect("create temp dir");
    write_file(
        dir.path().join("theme.json"),
        &serde_json::to_string(&json!({
            "id": "forest",
            "name": "Forest",
            "paired_with": "night",
            "styles": ["base.css"]
        }))
        .expect("serialize manifest"),
    );
    write_file(dir.path().join("base.css"), "body { color: green; }\n");

    let manifest = read_manifest_from_directory(dir.path()).expect("read manifest");
    let payload = build_theme_payload_from_directory(
        dir.path(),
        manifest,
        ThemeSource::BuiltIn,
        None,
    )
    .expect("build payload");

    assert_eq!(payload.summary.id, "forest");
    assert_eq!(payload.summary.paired_with.as_deref(), Some("night"));
    assert!(matches!(payload.summary.source, ThemeSource::BuiltIn));
    assert!(payload.summary.plugin_id.is_none());
    assert_eq!(payload.styles.as_deref(), Some("body { color: green; }\n"));
}
