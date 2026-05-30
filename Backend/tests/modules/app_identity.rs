// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

use super::{clear_test_app_dirs, persistence_name, project_dirs, set_test_app_dirs, AppDirs};

#[test]
fn exposes_persistence_names() {
    assert_eq!(persistence_name(), "OpenVCS");
}

#[test]
fn test_app_dirs_override_redirects_paths() {
    let real_dirs = project_dirs().expect("real project dirs");

    let dir = tempfile::tempdir().expect("temp dir for testing override");
    let temp_config = dir.path().join("config");
    let temp_data = dir.path().join("data");
    std::fs::create_dir_all(&temp_config).expect("create temp config dir");
    std::fs::create_dir_all(&temp_data).expect("create temp data dir");

    let override_dirs = AppDirs::new(temp_config.clone(), temp_data.clone());
    set_test_app_dirs(override_dirs);

    let during = project_dirs().expect("project dirs during override");
    assert_eq!(during.config_dir(), temp_config);
    assert_eq!(during.data_dir(), temp_data);

    clear_test_app_dirs();

    let after = project_dirs().expect("project dirs after clear");
    assert_eq!(after.config_dir(), real_dirs.config_dir());
    assert_eq!(after.data_dir(), real_dirs.data_dir());
}
