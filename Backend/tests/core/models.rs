// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

use std::collections::HashMap;
use super::*;

#[test]
/// Verifies `LogQuery::head` sets only the limit field.
fn log_query_head_sets_limit_and_defaults_rest() {
    let query = LogQuery::head(25);
    assert_eq!(query.limit, Some(25));
    assert!(query.rev.is_none());
    assert!(query.path.is_none());
    assert_eq!(query.skip, 0);
    assert!(!query.topo_order);
}

#[test]
/// Verifies `BranchKind` serializes and deserializes correctly.
fn branch_kind_roundtrips_via_json() {
    let local = BranchKind::Local;
    let local_json = serde_json::to_value(&local).expect("serialize");
    let local_back: BranchKind = serde_json::from_value(local_json).expect("deserialize");
    assert_eq!(local_back, BranchKind::Local);

    let remote = BranchKind::Remote {
        remote: "origin".into(),
    };
    let remote_json = serde_json::to_value(&remote).expect("serialize");
    let remote_back: BranchKind = serde_json::from_value(remote_json).expect("deserialize");
    assert_eq!(remote_back, remote);
}

#[test]
/// Verifies conflict-side values use kebab-case JSON strings.
fn conflict_side_serializes_as_kebab_case_strings() {
    let ours = serde_json::to_value(ConflictSide::Ours).expect("serialize");
    let theirs = serde_json::to_value(ConflictSide::Theirs).expect("serialize");
    assert_eq!(ours, serde_json::Value::String("ours".into()));
    assert_eq!(theirs, serde_json::Value::String("theirs".into()));

    let ours_back: ConflictSide = serde_json::from_value(serde_json::json!("ours")).unwrap();
    let theirs_back: ConflictSide =
        serde_json::from_value(serde_json::json!("theirs")).unwrap();
    assert_eq!(ours_back, ConflictSide::Ours);
    assert_eq!(theirs_back, ConflictSide::Theirs);
}

#[test]
/// Verifies optional file entry fields deserialize with defaults.
fn file_entry_deserializes_optional_fields_with_defaults() {
    let v = serde_json::json!({
        "path": "a.txt",
        "status": "M",
        "hunks": []
    });

    let entry: FileEntry = serde_json::from_value(v).expect("deserialize");
    assert_eq!(entry.path, "a.txt");
    assert_eq!(entry.status, "M");
    assert!(entry.old_path.is_none());
    assert!(!entry.staged);
    assert!(!entry.resolved_conflict);
    assert!(entry.hunks.is_empty());
}

#[test]
/// Verifies all `VcsEvent` variants round-trip through JSON.
fn vcs_event_roundtrips_via_json() {
    let events = vec![
        VcsEvent::Info {
            msg: "hello".into(),
        },
        VcsEvent::Progress {
            phase: "fetch".into(),
            detail: "10/20".into(),
        },
        VcsEvent::Auth {
            method: "ssh".into(),
            detail: "key".into(),
        },
        VcsEvent::RemoteMessage {
            msg: "remote".into(),
        },
        VcsEvent::Warning { msg: "warn".into() },
        VcsEvent::Error { msg: "err".into() },
    ];

    for event in events {
        let value = serde_json::to_value(&event).expect("serialize");
        let back: VcsEvent = serde_json::from_value(value).expect("deserialize");
        assert_eq!(format!("{event:?}"), format!("{back:?}"));
    }
}

#[test]
fn hunk_selection_roundtrips_via_json() {
    let mut partial = HashMap::new();
    partial.insert(0usize, vec![1usize, 3usize]);
    partial.insert(2usize, vec![2usize]);

    let sel = HunkSelection {
        path: "src/lib.rs".into(),
        whole_hunks: vec![0, 1],
        partial_hunks: partial,
    };

    let value = serde_json::to_value(&sel).expect("serialize");
    assert_eq!(value["path"], "src/lib.rs");
    assert_eq!(value["whole_hunks"], serde_json::json!([0, 1]));
    assert_eq!(value["partial_hunks"]["0"], serde_json::json!([1, 3]));
    assert_eq!(value["partial_hunks"]["2"], serde_json::json!([2]));

    let back: HunkSelection = serde_json::from_value(value).expect("deserialize");
    assert_eq!(back.path, "src/lib.rs");
    assert_eq!(back.whole_hunks, vec![0, 1]);
    assert_eq!(back.partial_hunks.get(&0), Some(&vec![1, 3]));
    assert_eq!(back.partial_hunks.get(&2), Some(&vec![2]));
    assert!(back.partial_hunks.get(&1).is_none());
}

#[test]
fn hunk_selection_serializes_empty_partial_as_empty_object() {
    let sel = HunkSelection {
        path: "file.txt".into(),
        whole_hunks: vec![],
        partial_hunks: HashMap::new(),
    };
    let value = serde_json::to_value(&sel).expect("serialize");
    assert_eq!(value["partial_hunks"], serde_json::json!({}));
}
