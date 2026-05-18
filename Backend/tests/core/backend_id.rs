// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

use super::*;
use serde_json::json;

#[test]
/// Verifies `BackendId` conversion helpers preserve string values.
fn from_string_and_str_produce_expected_values() {
    let owned = BackendId::from(String::from("git"));
    let borrowed = BackendId::from("git");

    assert_eq!(owned.as_str(), "git");
    assert_eq!(borrowed.as_str(), "git");
    assert!(borrowed == "git");
}

#[test]
/// Verifies display formatting uses the identifier text.
fn displays_inner_string() {
    let id = BackendId::from("libgit2");
    assert_eq!(id.to_string(), "libgit2");
}

#[test]
/// Verifies JSON strings deserialize into backend identifiers.
fn serde_deserialises_from_json_string() {
    let id: BackendId = serde_json::from_value(json!("git")).expect("deserialise backend id");
    assert_eq!(id.as_str(), "git");
}
