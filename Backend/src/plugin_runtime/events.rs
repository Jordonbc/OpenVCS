// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::sync::{Mutex, OnceLock};

#[cfg(test)]
/// Inserts a plugin-event subscription for tests.
fn test_subscribe(plugin_id: &str, event: &str) {
    if let Ok(mut lock) = registry().lock() {
        lock.subs.entry(plugin_id.to_string()).or_default().insert(event.to_string());
    }
}

#[cfg(test)]
/// Returns subscribed event names for tests.
fn test_subscribers(plugin_id: &str) -> Vec<String> {
    registry()
        .lock()
        .ok()
        .and_then(|lock| lock.subs.get(plugin_id).cloned())
        .map(|set| set.into_iter().collect())
        .unwrap_or_default()
}

/// In-memory mapping of plugin subscriptions by plugin id.
struct Registry {
    /// Event names subscribed by each plugin id.
    subs: HashMap<String, HashSet<String>>, // plugin_id -> event names
}

static REGISTRY: OnceLock<Mutex<Registry>> = OnceLock::new();

/// Returns global plugin-event registry singleton.
///
/// # Returns
/// - Shared registry mutex reference.
fn registry() -> &'static Mutex<Registry> {
    REGISTRY.get_or_init(|| {
        Mutex::new(Registry {
            subs: HashMap::new(),
        })
    })
}

#[allow(dead_code)]
/// Removes a plugin from the runtime event registry.
///
/// # Parameters
/// - `plugin_id`: Plugin id to remove.
///
/// # Returns
/// - `()`.
pub fn unregister_plugin(plugin_id: &str) {
    if let Ok(mut lock) = registry().lock() {
        lock.subs.remove(plugin_id);
    }
}

/// Emits an event originating from a plugin to other subscribers.
///
/// # Parameters
/// - `plugin_id`: Originating plugin id.
/// - `name`: Event name.
/// - `payload`: JSON event payload.
///
/// # Returns
/// - `()`.
pub fn emit_from_plugin(plugin_id: &str, name: &str, payload: Value) {
    // Current component runtime transport is in-process only.
    // Keep the subscription graph updated, but there is no cross-plugin delivery channel yet.
    emit_to_plugins(Some(plugin_id), name, payload);
}

/// Broadcasts an event to subscribed plugins, optionally excluding the origin.
///
/// # Parameters
/// - `origin_plugin_id`: Optional plugin id to exclude from delivery.
/// - `name`: Event name.
/// - `payload`: JSON event payload.
///
/// # Returns
/// - `()`.
pub fn emit_to_plugins(origin_plugin_id: Option<&str>, name: &str, payload: Value) {
    let _ = payload;
    if let Ok(lock) = registry().lock() {
        let _ = lock
            .subs
            .iter()
            .filter_map(|(plugin_id, events)| {
                if Some(plugin_id.as_str()) == origin_plugin_id {
                    return None;
                }
                if !events.contains(name) {
                    return None;
                }
                Some(plugin_id.clone())
            })
            .collect::<Vec<_>>();
    }
}

#[cfg(test)]
mod tests {
    include!("../../tests/plugin_runtime/events.rs");
}
