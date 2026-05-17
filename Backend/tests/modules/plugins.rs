// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

use super::{
    clean_opt, clean_tags, discover_theme_dirs, encode_base64, icon_mime_for_path,
    manifest_to_summary, percent_encode_uri_component, read_manifest_from_directory,
    resolve_plugin_dir, PluginOrigin, RawPluginManifest,
};
use std::fs;

#[test]
/// Verifies optional strings are trimmed and empty values dropped.
fn cleans_optional_strings() {
    assert_eq!(clean_opt(Some("  hello  ".into())), Some("hello".into()));
    assert_eq!(clean_opt(Some("   ".into())), None);
    assert_eq!(clean_opt(None), None);
}

#[test]
/// Verifies tags are trimmed and deduplicated case-insensitively.
fn cleans_and_deduplicates_tags() {
    let tags = clean_tags(vec![" One ".into(), "one".into(), "".into(), "Two".into()]);
    assert_eq!(tags, vec!["One".to_string(), "Two".to_string()]);
}

#[test]
/// Verifies encoding helpers produce stable icon payload encodings.
fn encodes_binary_and_svg_payloads() {
    assert_eq!(encode_base64(b""), "");
    assert_eq!(encode_base64(b"f"), "Zg==");
    assert_eq!(encode_base64(b"fo"), "Zm8=");
    assert_eq!(encode_base64(b"foo"), "Zm9v");
    assert_eq!(percent_encode_uri_component("hi there!"), "hi%20there%21");
}

#[test]
/// Verifies icon MIME lookup is based on extension.
fn maps_icon_extensions_to_mime_types() {
    assert_eq!(icon_mime_for_path(std::path::Path::new("icon.PNG")), Some("image/png"));
    assert_eq!(icon_mime_for_path(std::path::Path::new("icon.svg")), Some("image/svg+xml"));
    assert_eq!(icon_mime_for_path(std::path::Path::new("icon.txt")), None);
}

#[test]
/// Verifies versioned plugin directories resolve through current.json.
fn resolves_versioned_plugin_directories() {
    let dir = tempfile::tempdir().expect("create temp dir");
    let version_dir = dir.path().join("1.0.0");
    fs::create_dir_all(&version_dir).expect("create version dir");
    fs::write(
        dir.path().join("current.json"),
        r#"{"version":"1.0.0"}"#,
    )
    .expect("write current pointer");
    fs::write(
        version_dir.join("package.json"),
        r#"{"openvcs":{"id":"demo","name":"Demo"}}"#,
    )
    .expect("write package manifest");

    assert_eq!(resolve_plugin_dir(dir.path()), Some(version_dir));
}

#[test]
/// Verifies manifest loading rejects empty identifiers and names.
fn rejects_empty_manifest_fields() {
    let dir = tempfile::tempdir().expect("create temp dir");
    fs::write(
        dir.path().join("package.json"),
        r#"{"openvcs":{"id":"","name":"Demo"}}"#,
    )
    .expect("write invalid package manifest");
    assert!(read_manifest_from_directory(dir.path()).is_err());

    fs::write(
        dir.path().join("package.json"),
        r#"{"openvcs":{"id":"demo","name":""}}"#,
    )
    .expect("write invalid package manifest");
    assert!(read_manifest_from_directory(dir.path()).is_err());
}

#[test]
/// Verifies summary generation includes icon and theme metadata.
fn builds_plugin_summary_from_manifest() {
    let dir = tempfile::tempdir().expect("create temp dir");
    let theme_dir = dir.path().join("themes/default");
    fs::create_dir_all(&theme_dir).expect("create theme dir");
    fs::write(theme_dir.join("theme.json"), "{}").expect("write theme manifest");
    fs::write(dir.path().join("icon.png"), b"foo").expect("write icon file");

    let manifest = RawPluginManifest {
        id: " demo ".into(),
        name: " Demo Plugin ".into(),
        description: Some("  Example plugin  ".into()),
        category: Some("  utilities  ".into()),
        tags: vec!["One".into(), "one".into(), "Two".into()],
        version: Some(" 1.2.3 ".into()),
        author: Some(" Alice ".into()),
        entry: Some(" index.js ".into()),
        default_enabled: true,
    };

    let summary = manifest_to_summary(dir.path(), manifest, PluginOrigin::User, None);
    assert_eq!(summary.id, "demo");
    assert_eq!(summary.name, "Demo Plugin");
    assert_eq!(summary.description.as_deref(), Some("Example plugin"));
    assert_eq!(summary.category.as_deref(), Some("utilities"));
    assert_eq!(summary.tags, vec!["One".to_string(), "Two".to_string()]);
    assert_eq!(summary.version.as_deref(), Some("1.2.3"));
    assert_eq!(summary.author.as_deref(), Some("Alice"));
    assert_eq!(summary.entry.as_deref(), Some("index.js"));
    assert_eq!(summary.theme_dirs, 1);
    assert_eq!(summary.icon_data_url.as_deref(), Some("data:image/png;base64,Zm9v"));
    assert_eq!(summary.source, "user");
}

#[test]
/// Verifies theme discovery finds nested theme.json directories.
fn discovers_theme_directories() {
    let dir = tempfile::tempdir().expect("create temp dir");
    let theme_dir = dir.path().join("themes/pack/light");
    fs::create_dir_all(&theme_dir).expect("create theme dir");
    fs::write(theme_dir.join("theme.json"), "{}").expect("write theme manifest");

    let themes = discover_theme_dirs(dir.path());
    assert_eq!(themes, vec![theme_dir]);
}
