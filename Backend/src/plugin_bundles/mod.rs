// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later
//! Installed plugin indexing, synchronization, and component discovery.

pub mod store;
pub mod types;

pub use store::*;
pub use types::*;

#[cfg(test)]
mod tests {
    include!("../../tests/modules/plugin_bundles.rs");
}
