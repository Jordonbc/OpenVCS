// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later
//! Plugin runtime subsystem modules.
//!
//! These modules provide plugin process lifecycle management,
//! host API bridging, and backend proxy adapters.
/// In-memory plugin event subscription registry.
pub mod events;
/// Host functions exposed to plugin modules.
pub mod host_api;
/// Runtime instance trait used by the manager.
pub mod instance;
/// Long-lived plugin runtime lifecycle manager.
pub mod manager;
/// Node.js runtime implementation and JSON-RPC client.
pub mod node_instance;
/// JSON-RPC protocol constants and framing helpers.
pub mod protocol;
/// Runtime transport selection and factory helpers.
pub mod runtime_select;
/// Plugin settings persistence helpers.
pub mod settings_store;
/// Runtime spawn configuration types.
pub mod spawn;
/// `Vcs` trait adapter backed by plugin runtime RPC.
pub mod vcs_proxy;

/// Re-exported runtime manager type used by application state.
pub use manager::PluginRuntimeManager;
