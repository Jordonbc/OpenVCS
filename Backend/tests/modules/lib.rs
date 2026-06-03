// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

use std::collections::BTreeMap;
use std::path::PathBuf;

use super::{
    first_existing_recent_repo, load_local_dotenv, local_dotenv_path, preferred_vcs_backend_id,
    resolve_preferred_backend_id,
};
use crate::core::BackendId;
use crate::plugin_vcs_backends::{
    invalidate_plugin_vcs_backend_cache, store_backends, PluginBackendDescriptor,
};
use crate::settings::AppConfig;

// ── local_dotenv_path tests ────────────────────────────────────────────────

#[test]
fn dotenv_path_resolves_to_backend_parent() {
    let path = local_dotenv_path();
    assert!(path.ends_with(PathBuf::from("../.env")));
}

// ── resolve_preferred_backend_id tests ──────────────────────────────────────

#[test]
fn prefers_configured_backend_when_available() {
    let available = vec![BackendId::from("openvcs.git"), BackendId::from("zeta")];
    let resolved = resolve_preferred_backend_id("openvcs.git", &available);
    assert_eq!(
        resolved.map(|backend| backend.as_ref().to_string()),
        Some("openvcs.git".into())
    );
}

#[test]
fn falls_back_to_sorted_backend_when_default_missing() {
    let available = vec![BackendId::from("zeta"), BackendId::from("alpha")];
    let resolved = resolve_preferred_backend_id("missing", &available);
    assert_eq!(
        resolved.map(|backend| backend.as_ref().to_string()),
        Some("alpha".into())
    );
}

#[test]
fn returns_none_when_no_backends_available() {
    let available: Vec<BackendId> = vec![];
    let resolved = resolve_preferred_backend_id("git", &available);
    assert!(resolved.is_none());
}

#[test]
fn returns_first_sorted_when_configured_default_is_empty() {
    let available = vec![BackendId::from("zeta"), BackendId::from("alpha")];
    let resolved = resolve_preferred_backend_id("", &available);
    assert_eq!(
        resolved.map(|backend| backend.as_ref().to_string()),
        Some("alpha".into())
    );
}

#[test]
fn returns_none_when_configured_default_is_empty_and_no_backends() {
    let available: Vec<BackendId> = vec![];
    let resolved = resolve_preferred_backend_id("", &available);
    assert!(resolved.is_none());
}

#[test]
fn preferred_backend_trims_whitespace_around_default() {
    let available = vec![BackendId::from("git"), BackendId::from("zeta")];
    let resolved = resolve_preferred_backend_id("  git  ", &available);
    assert_eq!(
        resolved.map(|backend| backend.as_ref().to_string()),
        Some("git".into())
    );
}

#[test]
fn preferred_backend_whitespace_only_treated_as_empty() {
    let available = vec![BackendId::from("zeta"), BackendId::from("alpha")];
    let resolved = resolve_preferred_backend_id("   ", &available);
    assert_eq!(
        resolved.map(|backend| backend.as_ref().to_string()),
        Some("alpha".into())
    );
}

#[test]
fn preferred_backend_mixed_case_does_not_match() {
    // BackendId comparison is case-sensitive; "Git" is not "git".
    let available = vec![BackendId::from("git")];
    let resolved = resolve_preferred_backend_id("Git", &available);
    assert_eq!(
        resolved.map(|backend| backend.as_ref().to_string()),
        // Falls back to sorted ["git"] => Some("git")
        Some("git".into())
    );
}

// ── first_existing_recent_repo tests ───────────────────────────────────────

#[test]
fn finds_first_existing_recent_repo() {
    let temp = tempfile::tempdir().expect("temp dir");
    let existing = temp.path().join("repo");
    std::fs::create_dir(&existing).expect("create repo dir");

    let selected = first_existing_recent_repo(&[
        temp.path().join("missing"),
        existing.clone(),
        temp.path().join("later"),
    ]);

    assert_eq!(selected, Some(existing));
}

#[test]
fn returns_none_for_empty_repo_list() {
    let selected = first_existing_recent_repo(&[]);
    assert!(selected.is_none());
}

#[test]
fn returns_none_when_no_repos_exist() {
    let temp = tempfile::tempdir().expect("temp dir");
    let selected = first_existing_recent_repo(&[
        temp.path().join("missing1"),
        temp.path().join("missing2"),
    ]);
    assert!(selected.is_none());
}

#[test]
fn first_existing_repo_skips_nonexistent_then_finds_match() {
    let temp = tempfile::tempdir().expect("temp dir");
    let existing = temp.path().join("real_repo");
    std::fs::create_dir(&existing).expect("create repo dir");

    let selected = first_existing_recent_repo(&[
        temp.path().join("ghost"),
        temp.path().join("phantom"),
        existing.clone(),
    ]);

    assert_eq!(selected, Some(existing));
}

// ── load_local_dotenv tests ─────────────────────────────────────────────────

#[test]
fn load_local_dotenv_silently_ignores_missing_file() {
    // The function should not panic when there is no .env file.
    // This tests the `NotFound` error handling path.
    load_local_dotenv();
}

// ── preferred_vcs_backend_id tests ──────────────────────────────────────────

#[test]
fn preferred_vcs_backend_id_returns_default_when_available() {
    invalidate_plugin_vcs_backend_cache();
    store_backends(vec![
        PluginBackendDescriptor {
            backend_id: BackendId::from("git"),
            backend_name: None,
            action_labels: BTreeMap::new(),
            plugin_id: "openvcs.git".to_string(),
            plugin_name: None,
        },
        PluginBackendDescriptor {
            backend_id: BackendId::from("hg"),
            backend_name: None,
            action_labels: BTreeMap::new(),
            plugin_id: "openvcs.hg".to_string(),
            plugin_name: None,
        },
    ]);

    let mut cfg = AppConfig::default();
    cfg.general.default_backend = "git".to_string();

    let result = preferred_vcs_backend_id(&cfg);
    assert_eq!(
        result.map(|b| b.as_ref().to_string()),
        Some("git".into())
    );
}

#[test]
fn preferred_vcs_backend_id_falls_back_to_first_sorted_when_default_missing() {
    invalidate_plugin_vcs_backend_cache();
    store_backends(vec![
        PluginBackendDescriptor {
            backend_id: BackendId::from("git"),
            backend_name: None,
            action_labels: BTreeMap::new(),
            plugin_id: "openvcs.git".to_string(),
            plugin_name: None,
        },
        PluginBackendDescriptor {
            backend_id: BackendId::from("hg"),
            backend_name: None,
            action_labels: BTreeMap::new(),
            plugin_id: "openvcs.hg".to_string(),
            plugin_name: None,
        },
    ]);

    let mut cfg = AppConfig::default();
    cfg.general.default_backend = "nonexistent".to_string();

    // "git" < "hg" in sorted order, so "git" should be returned
    let result = preferred_vcs_backend_id(&cfg);
    assert_eq!(
        result.map(|b| b.as_ref().to_string()),
        Some("git".into())
    );
}

#[test]
fn preferred_vcs_backend_id_returns_first_sorted_on_empty_default() {
    invalidate_plugin_vcs_backend_cache();
    store_backends(vec![
        PluginBackendDescriptor {
            backend_id: BackendId::from("zeta"),
            backend_name: None,
            action_labels: BTreeMap::new(),
            plugin_id: "openvcs.zeta".to_string(),
            plugin_name: None,
        },
        PluginBackendDescriptor {
            backend_id: BackendId::from("alpha"),
            backend_name: None,
            action_labels: BTreeMap::new(),
            plugin_id: "openvcs.alpha".to_string(),
            plugin_name: None,
        },
    ]);

    let mut cfg = AppConfig::default();
    cfg.general.default_backend = "".to_string();

    // "alpha" < "zeta" in sorted order
    let result = preferred_vcs_backend_id(&cfg);
    assert_eq!(
        result.map(|b| b.as_ref().to_string()),
        Some("alpha".into())
    );
}

#[test]
fn preferred_vcs_backend_id_runs_without_panicking() {
    // Smoke test: function should not panic when called with
    // whatever backends are currently available.
    let cfg = AppConfig::default();
    let _result = preferred_vcs_backend_id(&cfg);
}
