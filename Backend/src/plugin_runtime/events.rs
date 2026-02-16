// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::sync::{Mutex, OnceLock};

struct Registry {
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

/// Subscribes a plugin to a named host/plugin event channel.
///
/// # Parameters
/// - `plugin_id`: Subscriber plugin id.
/// - `event`: Event name to subscribe to.
///
/// # Returns
/// - `()`.
pub fn subscribe(plugin_id: &str, event: &str) {
    if let Ok(mut lock) = registry().lock() {
        lock.subs
            .entry(plugin_id.to_string())
            .or_default()
            .insert(event.to_string());
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
        let _targets: Vec<String> = lock
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
            .collect();
    }
}
