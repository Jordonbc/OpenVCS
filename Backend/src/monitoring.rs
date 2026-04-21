// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later
//! Sentry-based crash reporting for the desktop backend.

use std::borrow::Cow;
use std::sync::Mutex;

use sentry::protocol::{Breadcrumb, Event, Exception, Frame, Map, Stacktrace, Value};
use serde::Deserialize;

use crate::settings::AppConfig;

/// Environment variable containing the backend Sentry DSN.
const BACKEND_SENTRY_DSN_ENV: &str = "OPENVCS_SENTRY_DSN";
/// Environment variable overriding the backend Sentry environment name.
const BACKEND_SENTRY_ENVIRONMENT_ENV: &str = "OPENVCS_SENTRY_ENVIRONMENT";
/// Build-time fallback Sentry DSN embedded during CI/local builds.
const BACKEND_SENTRY_DSN_BUILT: Option<&str> = option_env!("OPENVCS_SENTRY_DSN_BUILT");
/// Build-time fallback Sentry environment embedded during CI/local builds.
const BACKEND_SENTRY_ENVIRONMENT_BUILT: Option<&str> =
    option_env!("OPENVCS_SENTRY_ENVIRONMENT_BUILT");
/// Keeps the active backend Sentry guard alive for as long as reporting is enabled.
static BACKEND_MONITORING_GUARD: Mutex<Option<sentry::ClientInitGuard>> = Mutex::new(None);

/// Represents a relayed frontend breadcrumb forwarded to the backend.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FrontendBreadcrumb {
    /// Unix timestamp in milliseconds when the breadcrumb was recorded.
    pub timestamp_ms: i64,
    /// Severity level of the breadcrumb.
    pub level: String,
    /// Human-readable breadcrumb message.
    pub message: String,
}

/// Represents a normalized frontend error report captured in the webview.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FrontendErrorReport {
    /// Logical frontend error kind.
    pub kind: String,
    /// Primary error message.
    pub message: String,
    /// Optional JavaScript stack string.
    pub stack: Option<String>,
    /// Optional script source URL or path.
    pub source: Option<String>,
    /// Optional line number.
    pub line: Option<u32>,
    /// Optional column number.
    pub column: Option<u32>,
    /// Current window URL.
    pub url: Option<String>,
    /// Current browser/webview user agent.
    pub user_agent: Option<String>,
    /// Frontend release string from the build.
    pub release: Option<String>,
    /// Frontend environment string from the build.
    pub environment: Option<String>,
    /// Recent frontend breadcrumbs recorded before the error.
    #[serde(default)]
    pub breadcrumbs: Vec<FrontendBreadcrumb>,
}

/// Trims a string-like value and normalizes empty strings to `None`.
fn normalize_env_value(value: Option<String>) -> Option<String> {
    value.and_then(|value| {
        let normalized = value.trim().to_string();
        if normalized.is_empty() {
            None
        } else {
            Some(normalized)
        }
    })
}

/// Returns whether backend crash reporting is allowed by current settings.
fn backend_monitoring_allowed(cfg: &AppConfig) -> bool {
    cfg.general.crash_reports
}

/// Builds a backend Sentry guard when configuration and environment permit it.
fn build_backend_monitoring_guard(cfg: &AppConfig) -> Option<sentry::ClientInitGuard> {
    if !backend_monitoring_allowed(cfg) {
        log::info!("monitoring: backend Sentry disabled by configuration");
        return None;
    }

    let dsn = normalize_env_value(std::env::var(BACKEND_SENTRY_DSN_ENV).ok())
        .or_else(|| normalize_env_value(BACKEND_SENTRY_DSN_BUILT.map(str::to_string)));
    let Some(dsn) = dsn else {
        log::info!(
            "monitoring: backend Sentry disabled because {BACKEND_SENTRY_DSN_ENV} is unset and no build-time fallback was embedded"
        );
        return None;
    };

    let environment = normalize_env_value(std::env::var(BACKEND_SENTRY_ENVIRONMENT_ENV).ok())
        .or_else(|| normalize_env_value(BACKEND_SENTRY_ENVIRONMENT_BUILT.map(str::to_string)))
        .unwrap_or_else(|| "desktop".to_string());
    let release = format!("openvcs-client@{}", env!("OPENVCS_VERSION"));

    let guard = sentry::init((
        dsn,
        sentry::ClientOptions {
            release: Some(Cow::Owned(release)),
            environment: Some(Cow::Owned(environment)),
            attach_stacktrace: true,
            enable_logs: true,
            ..Default::default()
        },
    ));

    sentry::configure_scope(|scope| {
        scope.set_tag("component", "backend");
        scope.set_tag("channel", env!("OPENVCS_APP_CHANNEL"));
        scope.set_tag("version", env!("OPENVCS_VERSION"));
    });

    log::info!("monitoring: backend Sentry enabled");
    Some(guard)
}

/// Synchronizes backend Sentry reporting with the latest persisted configuration.
///
/// # Parameters
/// - `cfg`: Current application configuration used for crash-report consent.
///
/// # Returns
/// - `()`.
pub fn sync_backend_monitoring(cfg: &AppConfig) {
    let mut active_guard = match BACKEND_MONITORING_GUARD.lock() {
        Ok(guard) => guard,
        Err(poisoned) => {
            log::warn!("monitoring: recovering from poisoned backend monitoring mutex");
            poisoned.into_inner()
        }
    };
    *active_guard = build_backend_monitoring_guard(cfg);
    crate::logging::set_sentry_log_forwarding_enabled(active_guard.is_some());
}

/// Captures a startup-time backend error with operation-specific tags.
///
/// # Parameters
/// - `operation`: Short name of the failing startup step.
/// - `error`: Error description to attach to the captured event.
///
/// # Returns
/// - `()`.
pub fn capture_startup_error(operation: &str, error: &str) {
    if sentry::Hub::current().client().is_none() {
        return;
    }

    sentry::with_scope(
        |scope| {
            scope.set_tag("component", "backend");
            scope.set_tag("phase", "startup");
            scope.set_tag("operation", operation.to_string());
        },
        || {
            sentry::capture_message(
                &format!("startup {operation} failed: {error}"),
                sentry::Level::Error,
            );
        },
    );
}

/// Captures a normalized frontend error through the backend-owned Sentry client.
///
/// # Parameters
/// - `payload`: Normalized frontend error report from the webview.
///
/// # Returns
/// - `()`.
pub fn capture_frontend_error(payload: FrontendErrorReport) {
    if sentry::Hub::current().client().is_none() {
        return;
    }

    let level = sentry::Level::Error;
    let stack = payload.stack.clone();
    let message = payload.message.clone();
    let breadcrumbs = payload
        .breadcrumbs
        .iter()
        .map(build_frontend_breadcrumb)
        .collect::<Vec<_>>();

    let mut extra = Map::new();
    insert_extra(&mut extra, "source", payload.source.clone());
    insert_extra(&mut extra, "url", payload.url.clone());
    insert_extra(&mut extra, "user_agent", payload.user_agent.clone());
    insert_extra(&mut extra, "release", payload.release.clone());
    insert_extra(&mut extra, "environment", payload.environment.clone());
    insert_extra(&mut extra, "stack", stack);
    if let Some(line) = payload.line {
        extra.insert("line".into(), Value::from(line));
    }
    if let Some(column) = payload.column {
        extra.insert("column".into(), Value::from(column));
    }

    let event = Event {
        level,
        message: Some(message),
        logger: Some("frontend".into()),
        release: payload.release.map(Cow::Owned),
        environment: payload.environment.map(Cow::Owned),
        exception: vec![Exception {
            ty: payload.kind.clone(),
            value: Some(payload.message),
            stacktrace: parse_frontend_stacktrace(payload.stack.as_deref()),
            ..Default::default()
        }]
        .into(),
        breadcrumbs: breadcrumbs.into(),
        extra,
        ..Default::default()
    };

    sentry::with_scope(
        |scope| {
            scope.set_tag("component", "frontend");
            scope.set_tag("runtime", "tauri-webview");
            scope.set_tag("frontend_kind", payload.kind.clone());
        },
        || {
            sentry::capture_event(event);
        },
    );
}

/// Parses a JavaScript stack string into a Sentry stacktrace when possible.
fn parse_frontend_stacktrace(stack: Option<&str>) -> Option<Stacktrace> {
    let stack = stack?.trim();
    if stack.is_empty() {
        return None;
    }

    let mut frames = stack
        .lines()
        .filter_map(parse_frontend_stack_frame)
        .collect::<Vec<_>>();
    if frames.is_empty() {
        return None;
    }

    frames.reverse();
    Some(Stacktrace {
        frames,
        ..Default::default()
    })
}

/// Parses a single JavaScript stack frame line into a Sentry frame.
fn parse_frontend_stack_frame(line: &str) -> Option<Frame> {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return None;
    }

    let without_at = trimmed.strip_prefix("at ").unwrap_or(trimmed);
    let (function, location) = if let Some(open_paren) = without_at.rfind(" (") {
        let function = without_at[..open_paren].trim();
        let location = without_at
            .get(open_paren + 2..without_at.len().saturating_sub(1))?
            .trim();
        (normalize_stack_part(function), location)
    } else if let Some((function, location)) = without_at.rsplit_once('@') {
        (normalize_stack_part(function), location.trim())
    } else {
        (None, without_at)
    };

    let (filename, lineno, colno) = parse_frontend_location(location)?;
    Some(Frame {
        function,
        filename: Some(filename),
        lineno,
        colno,
        ..Default::default()
    })
}

/// Normalizes an optional function name from a JavaScript stack frame.
fn normalize_stack_part(value: &str) -> Option<String> {
    let value = value.trim();
    (!value.is_empty()).then(|| value.to_string())
}

/// Parses a `url:line:column` location suffix from a JavaScript stack frame.
fn parse_frontend_location(location: &str) -> Option<(String, Option<u64>, Option<u64>)> {
    let (prefix, colno_raw) = location.rsplit_once(':')?;
    let (filename_raw, lineno_raw) = prefix.rsplit_once(':')?;
    let filename = filename_raw.trim().to_string();
    if filename.is_empty() {
        return None;
    }

    let lineno = lineno_raw.trim().parse::<u64>().ok();
    let colno = colno_raw.trim().parse::<u64>().ok();
    Some((filename, lineno, colno))
}

/// Builds a Sentry breadcrumb from a relayed frontend breadcrumb payload.
fn build_frontend_breadcrumb(breadcrumb: &FrontendBreadcrumb) -> Breadcrumb {
    Breadcrumb {
        ty: "default".into(),
        category: Some("console".into()),
        level: parse_frontend_level(&breadcrumb.level),
        message: Some(breadcrumb.message.clone()),
        timestamp: std::time::UNIX_EPOCH
            + std::time::Duration::from_millis(breadcrumb.timestamp_ms.max(0) as u64),
        ..Default::default()
    }
}

/// Maps relayed frontend levels to Sentry levels.
fn parse_frontend_level(level: &str) -> sentry::Level {
    match level {
        "fatal" => sentry::Level::Fatal,
        "error" => sentry::Level::Error,
        "warning" | "warn" => sentry::Level::Warning,
        "info" => sentry::Level::Info,
        _ => sentry::Level::Debug,
    }
}

/// Inserts an optional string into a Sentry event extra map.
fn insert_extra(extra: &mut Map<String, Value>, key: &str, value: Option<String>) {
    if let Some(value) = value {
        extra.insert(key.into(), Value::String(value));
    }
}

#[cfg(test)]
mod tests {
    use super::{parse_frontend_level, parse_frontend_location, parse_frontend_stacktrace};

    #[test]
    fn parses_frontend_location_suffix() {
        let parsed = parse_frontend_location("app://index.js:12:34");
        assert_eq!(parsed, Some(("app://index.js".into(), Some(12), Some(34))));
    }

    #[test]
    fn parses_frontend_stacktrace_frames() {
        let stacktrace = parse_frontend_stacktrace(Some(
            "Error: boom\n    at alpha (app://index.js:2:3)\n    at beta (app://index.js:4:5)",
        ))
        .expect("stacktrace expected");

        assert_eq!(stacktrace.frames.len(), 2);
        assert_eq!(stacktrace.frames[0].function.as_deref(), Some("beta"));
        assert_eq!(stacktrace.frames[0].lineno, Some(4));
        assert_eq!(stacktrace.frames[1].function.as_deref(), Some("alpha"));
        assert_eq!(stacktrace.frames[1].colno, Some(3));
    }

    #[test]
    fn maps_frontend_levels_to_sentry_levels() {
        assert_eq!(parse_frontend_level("warning"), sentry::Level::Warning);
        assert_eq!(parse_frontend_level("error"), sentry::Level::Error);
        assert_eq!(parse_frontend_level("other"), sentry::Level::Debug);
    }
}
