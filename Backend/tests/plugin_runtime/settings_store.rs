// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

use super::{
    clear_test_plugin_data_root, load_settings, reset_settings, save_settings,
    set_test_plugin_data_root,
};
use serde_json::json;
use std::sync::{Mutex, OnceLock};
use std::fs;
use tempfile::tempdir;

fn test_lock() -> std::sync::MutexGuard<'static, ()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(())).lock().expect("lock")
}

#[test]
fn saves_loads_and_resets_plugin_settings() {
    let _guard = test_lock();
    let temp = tempdir().expect("tempdir");
    set_test_plugin_data_root(temp.path().join("plugin-data"));

    let mut settings = serde_json::Map::new();
    settings.insert("theme".into(), json!("dark"));
    settings.insert("count".into(), json!(3));

    save_settings("OpenVCS.Git", &settings).expect("save settings");

    let path = temp
        .path()
        .join("plugin-data")
        .join("openvcs.git")
        .join("settings.json");
    assert!(path.is_file());

    let loaded = load_settings("openvcs.git").expect("load settings");
    assert_eq!(loaded.get("theme"), Some(&json!("dark")));
    assert_eq!(loaded.get("count"), Some(&json!(3)));

    reset_settings("openvcs.git").expect("reset settings");
    assert!(!path.is_file());

    clear_test_plugin_data_root();
}

#[test]
fn loads_empty_map_when_settings_file_is_missing() {
    let _guard = test_lock();
    let temp = tempdir().expect("tempdir");
    set_test_plugin_data_root(temp.path().join("plugin-data"));

    let loaded = load_settings("missing.plugin").expect("load missing settings");
    assert!(loaded.is_empty());

    clear_test_plugin_data_root();
}

#[test]
fn reset_settings_is_a_noop_for_missing_files() {
    let _guard = test_lock();
    let temp = tempdir().expect("tempdir");
    set_test_plugin_data_root(temp.path().join("plugin-data"));

    reset_settings("missing.plugin").expect("reset missing settings");
    assert!(!temp.path().join("plugin-data").exists() || fs::read_dir(temp.path().join("plugin-data")).expect("dir").next().is_none());

    clear_test_plugin_data_root();
}

#[test]
fn load_settings_propagates_error_for_invalid_json() {
    let _guard = test_lock();
    let temp = tempdir().expect("tempdir");
    set_test_plugin_data_root(temp.path().join("plugin-data"));

    let settings_path = temp
        .path()
        .join("plugin-data")
        .join("broken.plugin")
        .join("settings.json");
    fs::create_dir_all(settings_path.parent().unwrap()).unwrap();
    fs::write(&settings_path, "not valid json at all").unwrap();

    let err = load_settings("broken.plugin").expect_err("expected parse error");
    assert!(err.contains("parse"), "unexpected error: {err}");

    clear_test_plugin_data_root();
}

#[test]
fn load_settings_returns_empty_map_for_non_object_json() {
    let _guard = test_lock();
    let temp = tempdir().expect("tempdir");
    set_test_plugin_data_root(temp.path().join("plugin-data"));

    let settings_path = temp
        .path()
        .join("plugin-data")
        .join("string.plugin")
        .join("settings.json");
    fs::create_dir_all(settings_path.parent().unwrap()).unwrap();

    // Write a JSON string (valid JSON, but not an object)
    fs::write(&settings_path, "\"just a string\"").unwrap();

    let loaded = load_settings("string.plugin").expect("load non-object settings");
    assert!(loaded.is_empty());

    // Write a JSON array (valid JSON, but not an object)
    fs::write(&settings_path, "[1, 2, 3]").unwrap();

    let loaded = load_settings("string.plugin").expect("load array settings");
    assert!(loaded.is_empty());

    clear_test_plugin_data_root();
}

#[test]
fn save_settings_overwrites_existing_file() {
    let _guard = test_lock();
    let temp = tempdir().expect("tempdir");
    set_test_plugin_data_root(temp.path().join("plugin-data"));

    let mut settings = serde_json::Map::new();
    settings.insert("key".into(), json!("first"));

    save_settings("overwrite.test", &settings).expect("first save");

    let mut settings2 = serde_json::Map::new();
    settings2.insert("key".into(), json!("second"));

    save_settings("overwrite.test", &settings2).expect("second save");

    let loaded = load_settings("overwrite.test").expect("load overwritten");
    assert_eq!(loaded.get("key"), Some(&json!("second")));

    clear_test_plugin_data_root();
}
