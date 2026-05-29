// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

use super::infer_repo_dir_from_url;

#[test]
fn infers_repo_directory_names() {
    assert_eq!(infer_repo_dir_from_url("https://example.com/org/repo.git"), "repo");
    assert_eq!(infer_repo_dir_from_url("git@example.com:org/repo"), "repo");
    assert_eq!(infer_repo_dir_from_url("https://example.com/org/repo/"), "repo");
}
