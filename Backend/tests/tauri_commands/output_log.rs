// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

use super::read_last_lines;
use std::fs;

#[test]
fn reads_last_lines_from_file() {
    let dir = tempfile::tempdir().expect("tempdir");
    let path = dir.path().join("log.txt");
    fs::write(&path, "one\ntwo\nthree\n").expect("write log");

    assert_eq!(
        read_last_lines(&path, 2).expect("read lines"),
        vec!["one".to_string(), "two".to_string(), "three".to_string()]
    );
}

#[test]
fn reads_empty_files_as_empty_lists() {
    let dir = tempfile::tempdir().expect("tempdir");
    let path = dir.path().join("empty.log");
    fs::write(&path, "").expect("write empty log");

    assert!(read_last_lines(&path, 10).expect("read empty").is_empty());
}
