// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

use super::{decode_repo_text, normalize_gitignore_entry, safe_relative_path};

#[test]
fn validates_repo_relative_paths() {
    assert_eq!(safe_relative_path("src/lib.rs").unwrap(), std::path::PathBuf::from("src/lib.rs"));
    assert!(safe_relative_path("").is_err());
    assert!(safe_relative_path("../secret").is_err());
    assert!(safe_relative_path("/absolute").is_err());
}

#[test]
fn normalizes_gitignore_entries() {
    assert_eq!(normalize_gitignore_entry("foo\\bar").unwrap(), "/foo/bar");
    assert_eq!(normalize_gitignore_entry("./baz").unwrap(), "/baz");
    assert!(normalize_gitignore_entry("bad\npath").is_err());
}

#[test]
fn decodes_text_bytes() {
    assert_eq!(decode_repo_text(b"hello"), "hello");

    let utf16le: Vec<u8> = vec![0xFF, 0xFE, b'h', 0, b'i', 0];
    assert_eq!(decode_repo_text(&utf16le), "hi");

    let utf16be: Vec<u8> = vec![0xFE, 0xFF, 0, b'h', 0, b'i'];
    assert_eq!(decode_repo_text(&utf16be), "hi");
}

#[test]
fn safe_relative_path_rejects_invalid_inputs() {
    assert!(safe_relative_path(".").is_ok());
    assert!(safe_relative_path("./src/lib.rs").is_ok());
    assert!(safe_relative_path("..").is_err());
    assert!(safe_relative_path("a/../../b").is_err());
}

#[test]
fn normalize_gitignore_entry_prepends_slash() {
    assert_eq!(normalize_gitignore_entry("foo").unwrap(), "/foo");
    assert_eq!(normalize_gitignore_entry("foo/bar").unwrap(), "/foo/bar");
}

#[test]
fn normalize_gitignore_entry_handles_backslash_and_crlf() {
    assert_eq!(normalize_gitignore_entry("a\\b\\c").unwrap(), "/a/b/c");
    assert!(normalize_gitignore_entry("bad\rpath").is_err());
}

#[test]
fn normalize_gitignore_entry_strips_dot_slash_prefix() {
    assert_eq!(normalize_gitignore_entry("./dir/file").unwrap(), "/dir/file");
    assert_eq!(normalize_gitignore_entry("./").unwrap(), "/");
}

#[test]
fn decodes_empty_and_bom_only_bytes() {
    assert_eq!(decode_repo_text(b""), "");
    let utf8_bom: Vec<u8> = vec![0xEF, 0xBB, 0xBF];
    assert_eq!(decode_repo_text(&utf8_bom), "\u{feff}");
}

#[test]
fn decodes_lossy_text_bytes() {
    let invalid: Vec<u8> = vec![0xFF, 0xFE, 0xFF, 0xFE, 0x00];
    let decoded = decode_repo_text(&invalid);
    assert!(!decoded.is_empty(), "should not panic on invalid encoding");
}
