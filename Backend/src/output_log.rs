// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later
//! Shared output log types used by backend command execution and UI display.

use serde::{Deserialize, Serialize};

/// Severity level associated with an output log entry.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum OutputLevel {
    Info,
    Warn,
    Error,
}

/// Structured entry in the backend output log.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OutputLogEntry {
    /// Unix timestamp in milliseconds.
    pub ts_ms: i64,
    /// Severity of the entry.
    pub level: OutputLevel,
    /// Source subsystem for the log entry.
    pub source: String,
    /// Human-readable log message.
    pub message: String,
}

impl OutputLogEntry {
    /// Creates a new output log entry.
    ///
    /// # Parameters
    /// - `ts_ms`: Event timestamp in Unix milliseconds.
    /// - `level`: Severity level for the entry.
    /// - `source`: Subsystem/source label.
    /// - `message`: Human-readable message text.
    ///
    /// # Returns
    /// - A populated [`OutputLogEntry`].
    pub fn new(
        ts_ms: i64,
        level: OutputLevel,
        source: impl Into<String>,
        message: impl Into<String>,
    ) -> Self {
        Self {
            ts_ms,
            level,
            source: source.into(),
            message: message.into(),
        }
    }
}

#[cfg(test)]
mod tests {
    include!("../tests/modules/output_log.rs");
}
