// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later
//! Minimal host-side plugin runtime APIs.

use parking_lot::RwLock;
use std::sync::{Arc, OnceLock};

/// Callback type for status text updates from plugins to frontend.
type StatusEventEmitter = Arc<dyn Fn(&str) + Send + Sync + 'static>;

/// Global status emitter callback used by backend->frontend bridge.
static STATUS_EVENT_EMITTER: OnceLock<RwLock<Option<StatusEventEmitter>>> = OnceLock::new();
/// Shared in-memory status text for plugin updates.
static STATUS_TEXT: OnceLock<RwLock<String>> = OnceLock::new();

/// Returns global status emitter storage.
fn status_event_emitter_store() -> &'static RwLock<Option<StatusEventEmitter>> {
    STATUS_EVENT_EMITTER.get_or_init(|| RwLock::new(None))
}

/// Returns global status storage singleton.
fn status_text_store() -> &'static RwLock<String> {
    STATUS_TEXT.get_or_init(|| RwLock::new(String::new()))
}

/// Emits a status text event through the configured backend emitter.
fn emit_status_event(message: &str) {
    if let Some(emitter) = status_event_emitter_store().read().clone() {
        emitter(message);
    }
}

/// Installs status event emitter callback for plugin-originated status updates.
///
/// # Parameters
/// - `emitter`: Callback invoked with status text updates.
///
/// # Returns
/// - `()`.
pub fn set_status_event_emitter<F>(emitter: F)
where
    F: Fn(&str) + Send + Sync + 'static,
{
    *status_event_emitter_store().write() = Some(Arc::new(emitter));
}

/// Resets host API state between tests.
#[cfg(test)]
pub fn reset_host_api_state_for_tests() {
    *status_event_emitter_store().write() = None;
    status_text_store().write().clear();
}

/// Sets status text without permission checks.
///
/// This is used by the Node plugin runtime where plugin trust is explicit and
/// capability gates are disabled.
///
/// # Parameters
/// - `message`: New status text.
///
/// # Returns
/// - `()`.
pub fn set_status_text_unchecked(message: &str) {
    let trimmed = message.trim();
    if trimmed.is_empty() {
        return;
    }
    *status_text_store().write() = trimmed.to_string();
    emit_status_event(trimmed);
}

#[cfg(test)]
mod tests {
    include!("../../tests/plugin_runtime/host_api.rs");
}
