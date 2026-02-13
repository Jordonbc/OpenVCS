use openvcs_core::plugin_protocol::PluginMessage;
use openvcs_core::plugin_protocol::RpcRequest;
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::io::Write;
use std::sync::{Arc, Mutex, OnceLock};

pub type PluginStdin = Arc<Mutex<Option<std::io::LineWriter<Box<dyn Write + Send>>>>>;

#[derive(Clone)]
pub struct PluginIoHandle {
    pub stdin: PluginStdin,
}

struct Registry {
    next_id: HashMap<String, u64>,
    io: HashMap<String, PluginIoHandle>,
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
            next_id: HashMap::new(),
            io: HashMap::new(),
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
        lock.io.remove(plugin_id);
        lock.subs.remove(plugin_id);
        lock.next_id.remove(plugin_id);
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
    // For now this just fans out to other plugin subscribers.
    // Host-side internal listeners can be added later.
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
    let targets: Vec<(String, PluginIoHandle, u64)> = {
        let Ok(mut lock) = registry().lock() else {
            return;
        };

        let matching: Vec<String> = lock
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

        let mut out = Vec::new();
        for plugin_id in matching {
            let Some(io) = lock.io.get(&plugin_id).cloned() else {
                continue;
            };
            let id = lock.next_id.entry(plugin_id.clone()).or_insert(1);
            let req_id = *id;
            *id = id.saturating_add(1);
            out.push((plugin_id, io, req_id));
        }
        out
    };

    for (_plugin_id, io, req_id) in targets {
        if let Ok(mut lock) = io.stdin.lock() {
            if let Some(stdin) = lock.as_mut() {
                let req = RpcRequest {
                    id: req_id,
                    method: "event.dispatch".to_string(),
                    params: serde_json::json!({ "name": name, "payload": payload }),
                };
                if let Ok(line) = serde_json::to_string(&PluginMessage::Request(req)) {
                    let _ = writeln!(stdin, "{line}");
                    let _ = stdin.flush();
                }
            }
        }
    }
}
