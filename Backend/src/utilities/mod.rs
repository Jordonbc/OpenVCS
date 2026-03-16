// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later
//! Utility helpers exposed by the backend crate.

/// Internal utility helper module.
pub mod inner;
/// Back-compat re-export of utility helper module.
pub use inner as utilities;
