// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

use super::diff_configs;
use crate::settings::AppConfig;

#[test]
fn reports_changed_sections() {
    let old_cfg = AppConfig::default();
    let mut new_cfg = old_cfg.clone();
    new_cfg.general.theme = crate::settings::Theme::Dark;
    new_cfg.logging.retain_archives = 99;

    assert_eq!(diff_configs(&old_cfg, &old_cfg), Vec::<String>::new());
    assert_eq!(diff_configs(&old_cfg, &new_cfg), vec!["general".to_string(), "logging".to_string()]);
}
