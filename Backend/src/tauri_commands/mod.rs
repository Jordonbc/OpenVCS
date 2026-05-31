// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later
//! Aggregates the backend's Tauri command modules.
//!
//! Each submodule defines command handlers grouped by feature area, and this
//! module re-exports them so the crate can build a single invoke handler.

mod backends;
mod branches;
mod commit;
mod conflicts;
mod general;
mod monitoring;
mod output_log;
mod plugins;
mod remotes;
mod repo_files;
mod settings;
mod shared;
mod snapshot;
mod ssh;
mod stash;
mod status;
mod themes;
mod updater;

pub use backends::*;
pub use branches::*;
pub use commit::*;
pub use conflicts::*;
pub use general::*;
pub use monitoring::*;
pub use output_log::*;
pub use plugins::*;
pub use remotes::*;
pub use repo_files::*;
pub use settings::*;
pub use snapshot::*;
pub use ssh::*;
pub use stash::*;
pub use status::*;
pub use themes::*;
pub use updater::*;

/// Internal helpers shared across command modules.
pub(crate) use shared::{ProgressPayload, current_repo_or_err, progress_bridge, run_repo_task};
