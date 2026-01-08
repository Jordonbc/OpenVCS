use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum OutputLevel {
    Info,
    Warn,
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OutputLogEntry {
    pub ts_ms: i64,
    pub level: OutputLevel,
    pub source: String,
    pub message: String,
}

impl OutputLogEntry {
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
