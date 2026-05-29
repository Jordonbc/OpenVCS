// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

use crate::monitoring::{FrontendBreadcrumb, FrontendErrorReport};

use super::report_frontend_error;

#[test]
fn accepts_frontend_error_payloads_without_an_active_sentry_client() {
    let payload = FrontendErrorReport {
        kind: "error".into(),
        message: "boom".into(),
        stack: Some("Error: boom".into()),
        source: Some("app://index.js".into()),
        line: Some(12),
        column: Some(34),
        url: Some("app://openvcs".into()),
        user_agent: Some("OpenVCS Test".into()),
        release: Some("test-release".into()),
        environment: Some("test".into()),
        breadcrumbs: vec![FrontendBreadcrumb {
            timestamp_ms: 1,
            level: "info".into(),
            message: "before failure".into(),
        }],
    };

    assert!(report_frontend_error(payload).is_ok());
}
