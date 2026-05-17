// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later
//! Global application configuration — re-exports types, defaults, and persistence.

pub mod types;
pub mod persistence;

pub use types::*;

#[cfg(test)]
mod tests {
    include!("../../tests/modules/settings.rs");
}
