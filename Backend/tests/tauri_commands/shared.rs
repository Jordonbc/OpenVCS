// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

use super::{
    backend_unavailable_message, format_task_failure, progress_message_for_event,
};
use crate::core::models::VcsEvent;
use crate::output_log::OutputLevel;

#[test]
fn formats_task_failure_messages() {
    assert_eq!(
        format_task_failure("hydrate", "join error"),
        "hydrate task failed: join error"
    );
}

#[test]
fn maps_progress_events_to_info_messages() {
    let (level, message) = progress_message_for_event(VcsEvent::Progress {
        phase: "fetch".into(),
        detail: "Fetching origin".into(),
    });
    assert!(matches!(level, OutputLevel::Info));
    assert_eq!(message, "Fetching origin");
}

#[test]
fn maps_auth_and_push_status_events() {
    let (auth_level, auth_message) = progress_message_for_event(VcsEvent::Auth {
        method: "ssh".into(),
        detail: "prompting".into(),
    });
    assert!(matches!(auth_level, OutputLevel::Info));
    assert_eq!(auth_message, "auth[ssh]: prompting");

    let (push_level, push_message) = progress_message_for_event(VcsEvent::PushStatus {
        refname: "refs/heads/main".into(),
        status: Some("updated".into()),
    });
    assert!(matches!(push_level, OutputLevel::Info));
    assert_eq!(push_message, "refs/heads/main → updated");
}

#[test]
fn maps_warning_and_error_events() {
    let (warn_level, warn_message) = progress_message_for_event(VcsEvent::Warning {
        msg: "be careful".into(),
    });
    assert!(matches!(warn_level, OutputLevel::Warn));
    assert_eq!(warn_message, "be careful");

    let (error_level, error_message) = progress_message_for_event(VcsEvent::Error {
        msg: "failed".into(),
    });
    assert!(matches!(error_level, OutputLevel::Error));
    assert_eq!(error_message, "failed");
}

#[test]
fn renders_backend_unavailable_message() {
    assert_eq!(
        backend_unavailable_message("openvcs.git"),
        "Backend `openvcs.git` is no longer available (plugin disabled?). Reopen the repository."
    );
}
