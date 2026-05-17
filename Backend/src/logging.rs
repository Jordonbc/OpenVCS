// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later
use crate::settings::{AppConfig, LogLevel};
use sentry_log::{LogFilter, SentryLogger};
use std::fs::{self, OpenOptions};
use std::io::{Seek, SeekFrom, Write};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Instant;
use time::{OffsetDateTime, UtcOffset};
use zip::{CompressionMethod, ZipWriter, write::FileOptions};

static ACTIVE_LOG_FILE: OnceLock<Arc<Mutex<std::fs::File>>> = OnceLock::new();
static SENTRY_LOG_FORWARDING_ENABLED: AtomicBool = AtomicBool::new(false);

/// Updates whether backend log records should be forwarded into Sentry.
///
/// # Parameters
/// - `enabled`: `true` when a backend Sentry client is active and crash reporting is allowed.
///
/// # Returns
/// - `()`.
pub fn set_sentry_log_forwarding_enabled(enabled: bool) {
    SENTRY_LOG_FORWARDING_ENABLED.store(enabled, Ordering::Relaxed);
}

/// RAII timer that logs operation duration on drop.
///
/// Use this to measure and log timing for long-running operations.
/// The duration is logged at trace level when the timer goes out of scope.
pub struct LogTimer {
    start: Instant,
    operation: &'static str,
}

impl LogTimer {
    /// Creates a new timer for the given operation.
    ///
    /// # Parameters
    /// - `_module`: Module/component name (unused, kept for API compatibility).
    /// - `operation`: Operation name (e.g., "fetch", "push").
    ///
    /// # Returns
    /// - A new `LogTimer` instance.
    pub fn new(_module: &'static str, operation: &'static str) -> Self {
        Self {
            start: Instant::now(),
            operation,
        }
    }

    /// Returns elapsed time in milliseconds.
    ///
    /// # Returns
    /// - Elapsed time in milliseconds.
    #[allow(dead_code)]
    pub fn elapsed_ms(&self) -> u64 {
        self.start.elapsed().as_millis() as u64
    }
}

impl Drop for LogTimer {
    fn drop(&mut self) {
        let elapsed = self.start.elapsed();
        let ms = elapsed.as_millis();
        let us = elapsed.as_micros() - (ms * 1000);
        log::trace!("{} completed in {}.{:03}ms", self.operation, ms, us);
    }
}

/// Logs an operation entry at info level.
///
/// # Parameters
/// - `module`: Module/component name.
/// - `operation`: Operation name.
/// - `details`: Additional details string.
#[macro_export]
macro_rules! log_op_enter {
    ($module:expr, $operation:expr) => {
        log::info!("[{}] {}: starting", $module, $operation)
    };
    ($module:expr, $operation:expr, $($arg:tt)*) => {
        log::info!("[{}] {}: {}", $module, $operation, format!($($arg)*))
    };
}

/// Logs an operation exit at info level.
///
/// # Parameters
/// - `module`: Module/component name.
/// - `operation`: Operation name.
/// - `details`: Additional details string.
#[macro_export]
macro_rules! log_op_exit {
    ($module:expr, $operation:expr) => {
        log::info!("[{}] {}: completed", $module, $operation)
    };
    ($module:expr, $operation:expr, $($arg:tt)*) => {
        log::info!("[{}] {}: {}", $module, $operation, format!($($arg)*))
    };
}

/// Truncates the currently active `logs/openvcs.log` file in place.
///
/// # Returns
/// - `Ok(())` if the active log file is cleared or not yet initialized.
/// - `Err(String)` if file locking or truncation fails.
pub fn clear_active_log_file() -> Result<(), String> {
    let Some(file) = ACTIVE_LOG_FILE.get() else {
        return Ok(());
    };
    let mut f = file
        .lock()
        .map_err(|_| "log file lock poisoned".to_string())?;
    f.set_len(0).map_err(|e| e.to_string())?;
    f.seek(SeekFrom::Start(0)).map_err(|e| e.to_string())?;
    f.flush().map_err(|e| e.to_string())?;
    Ok(())
}

/// Initialize logging: console (env_logger) + append to `./logs/openvcs.log`.
/// Respects `RUST_LOG` for filtering; sets a sensible default if missing.
///
/// # Returns
/// - `()`.
pub fn init() {
    // Load persisted settings early (does not require AppState) for logging configuration
    let cfg = AppConfig::load_or_default();

    struct DualLogger {
        console: env_logger::Logger,
        file: Arc<Mutex<std::fs::File>>,
    }
    impl log::Log for DualLogger {
        /// Delegates enable filtering to console logger.
        ///
        /// # Parameters
        /// - `m`: Log metadata.
        ///
        /// # Returns
        /// - `true` when record is enabled.
        /// - `false` otherwise.
        fn enabled(&self, m: &log::Metadata) -> bool {
            // Delegate filtering to env_logger
            self.console.enabled(m)
        }
        /// Writes log record to console and active log file.
        ///
        /// # Parameters
        /// - `r`: Log record.
        ///
        /// # Returns
        /// - `()`.
        fn log(&self, r: &log::Record) {
            if self.enabled(r.metadata()) {
                self.console.log(r);
                if let Ok(mut f) = self.file.lock() {
                    let _ = writeln!(f, "{} [{}] {}", r.level(), r.target(), r.args());
                }
            }
        }
        /// Flushes console and file logging outputs.
        ///
        /// # Returns
        /// - `()`.
        fn flush(&self) {
            self.console.flush();
            if let Ok(mut f) = self.file.lock() {
                let _ = f.flush();
            }
        }
    }

    // Build console logger with custom format
    let mut builder = env_logger::Builder::from_default_env();
    builder.format(|buf, record| {
        use std::io::Write;
        let ts = record.level();
        let target = record.target();
        let args = record.args();

        // Format: [YYYY-MM-DD] [HH:MM:SS] LEVEL [SOURCE]: message
        let now = time::OffsetDateTime::now_utc();
        let date = format!(
            "{:04}-{:02}-{:02}",
            now.year(),
            now.month() as u8,
            now.day()
        );
        let time = format!("{:02}:{:02}:{:02}", now.hour(), now.minute(), now.second());

        // Extract source from target (e.g., "openvcs_lib::tauri_commands::output_log" -> "output_log")
        let source = target.split("::").last().unwrap_or(target).to_uppercase();

        // For Debug/Trace level, try to pretty-print JSON-like content in messages
        let msg = args.to_string();

        let format_braced = |body: &str| {
            let mut out = String::with_capacity(body.len() + 64);
            let mut indent: usize = 0;
            let mut in_string = false;
            let mut escaped = false;

            for ch in body.chars() {
                if in_string {
                    out.push(ch);
                    if escaped {
                        escaped = false;
                    } else if ch == '\\' {
                        escaped = true;
                    } else if ch == '"' {
                        in_string = false;
                    }
                    continue;
                }

                match ch {
                    '"' => {
                        in_string = true;
                        out.push(ch);
                    }
                    '{' => {
                        out.push('{');
                        indent += 1;
                        out.push('\n');
                        out.push_str(&"  ".repeat(indent));
                    }
                    '}' => {
                        indent = indent.saturating_sub(1);
                        out.push('\n');
                        out.push_str(&"  ".repeat(indent));
                        out.push('}');
                    }
                    ',' => {
                        out.push(',');
                        out.push('\n');
                        out.push_str(&"  ".repeat(indent));
                    }
                    _ => out.push(ch),
                }
            }

            out
        };

        let clean_label = |prefix: &str| {
            let mut label = prefix.trim().trim_end_matches(':').trim().to_string();
            for suffix in ["Object", "RemoteRelease"] {
                if let Some(stripped) = label.strip_suffix(suffix) {
                    label = stripped.trim().to_string();
                }
            }
            if label.is_empty() {
                "payload".to_string()
            } else {
                label
            }
        };

        // Check if message contains JSON-like structure that can be extracted and formatted.
        if msg.len() > 100
            && (ts == log::Level::Debug || ts == log::Level::Trace)
            && let (Some(start), Some(end)) = (msg.find('{'), msg.rfind('}'))
        {
            let json_part = &msg[start..=end];

            let regex = regex::Regex::new(r#"String\("([^"]*)"\)"#).ok();

            // Strategy 1: strict conversion of common Rust debug wrappers.
            let mut attempts: Vec<String> = Vec::with_capacity(2);
            let mut cleaned = json_part.replace("Object ", "");
            if let Some(re) = &regex {
                cleaned = re.replace_all(&cleaned, r#""$1""#).to_string();
            }
            attempts.push(cleaned);

            // Strategy 2: aggressive conversion fallback for odd wrapper nesting.
            let aggressive = json_part
                .replace("Object ", "")
                .replace("String(\"", "\"")
                .replace("\")", "\"");
            attempts.push(aggressive);

            for json_clean in attempts {
                if let Ok(value) = serde_json::from_str::<serde_json::Value>(&json_clean)
                    && let Ok(pretty) = serde_json::to_string_pretty(&value)
                {
                    let label = clean_label(&msg[..start]);
                    let header = format!("[{}] [{}] {:5} [{}]: {} ", date, time, ts, source, label);
                    let lines: Vec<&str> = pretty.lines().collect();
                    return writeln!(
                        buf,
                        "{}{}",
                        header,
                        lines.join(&format!("\n{}", " ".repeat(header.len())))
                    );
                }
            }

            // Fallback: non-JSON Rust debug structs (e.g., RemoteRelease { ... })
            let label = clean_label(&msg[..start]);
            let pretty = format_braced(json_part);
            let header = format!("[{}] [{}] {:5} [{}]: {} ", date, time, ts, source, label);
            let lines: Vec<&str> = pretty.lines().collect();
            return writeln!(
                buf,
                "{}{}",
                header,
                lines.join(&format!("\n{}", " ".repeat(header.len())))
            );
        }

        writeln!(buf, "[{}] [{}] {:5} [{}]: {}", date, time, ts, source, msg)
    });

    // Cranelift can be extremely verbose at TRACE/DEBUG and drown out OpenVCS logs.
    // Keep these at WARN+ even if the user enables a global TRACE filter.
    builder.filter_module("cranelift", log::LevelFilter::Warn);
    builder.filter_module("cranelift_codegen", log::LevelFilter::Warn);
    builder.filter_module("cranelift_native", log::LevelFilter::Warn);

    // If RUST_LOG is unset, apply level from settings
    if std::env::var_os("RUST_LOG").is_none() {
        let level = match cfg.logging.level {
            LogLevel::Trace => log::LevelFilter::Trace,
            LogLevel::Debug => log::LevelFilter::Debug,
            LogLevel::Info => log::LevelFilter::Info,
            LogLevel::Warn => log::LevelFilter::Warn,
            LogLevel::Error => log::LevelFilter::Error,
        };
        builder.filter_level(level);
    }
    let console_logger = builder.build();

    // Ensure logs dir exists under platform data directory; fall back to CWD-relative if unavailable.
    let logfile = {
        let dir = crate::app_identity::project_dirs()
            .map(|pd| pd.data_dir().join("logs"))
            .unwrap_or_else(|| std::path::PathBuf::from("logs"));
        if let Err(e) = fs::create_dir_all(&dir) {
            log::warn!(
                "logging: failed to create log directory '{}': {e}",
                dir.display()
            );
        }

        rotate_existing_log(&dir);
        prune_archives(&dir, cfg.logging.retain_archives as usize);

        // Open (truncate) the active log file for this session
        let active = dir.join("openvcs.log");
        OpenOptions::new()
            .create(true)
            .write(true)
            .truncate(true)
            .open(active)
            .ok()
    };

    if let Some(file) = logfile {
        let file = Arc::new(Mutex::new(file));
        let _ = ACTIVE_LOG_FILE.set(Arc::clone(&file));
        let dual = DualLogger {
            console: console_logger,
            file,
        };
        let sentry_logger = build_sentry_logger(dual);
        let _ = log::set_boxed_logger(Box::new(sentry_logger));
        log::set_max_level(log::LevelFilter::Trace);
    } else {
        // Fallback to console-only
        let sentry_logger = build_sentry_logger(console_logger);
        let _ = log::set_boxed_logger(Box::new(sentry_logger));
        log::set_max_level(log::LevelFilter::Trace);
    }
}

/// Wraps an existing backend logger so selected records are also forwarded to Sentry.
///
/// Error-level records become Sentry events and logs, warn-level records become
/// breadcrumbs and logs, and info-level records become breadcrumbs. Local
/// console/file logging always continues through the wrapped destination logger.
///
/// # Parameters
/// - `destination`: Existing logger that should continue receiving all records.
///
/// # Returns
/// - A `SentryLogger` forwarding selected records to Sentry.
fn build_sentry_logger<L>(destination: L) -> SentryLogger<L>
where
    L: log::Log + Send + Sync + 'static,
{
    SentryLogger::with_dest(destination).filter(|metadata| {
        if !SENTRY_LOG_FORWARDING_ENABLED.load(Ordering::Relaxed) {
            return LogFilter::Ignore;
        }

        match metadata.level() {
            log::Level::Error => LogFilter::Event | LogFilter::Log,
            log::Level::Warn => LogFilter::Breadcrumb | LogFilter::Log,
            log::Level::Info => LogFilter::Breadcrumb,
            log::Level::Debug | log::Level::Trace => LogFilter::Ignore,
        }
    })
}

/// Rotates existing active log into a timestamped zip archive.
///
/// # Parameters
/// - `dir`: Logs directory path.
///
/// # Returns
/// - `()`.
fn rotate_existing_log(dir: &std::path::Path) {
    let active = dir.join("openvcs.log");
    let Ok(mut src) = std::fs::File::open(&active) else {
        return;
    };
    // Skip empty files
    let meta = match src.metadata() {
        Ok(m) => m,
        Err(_) => return,
    };
    if meta.len() == 0 {
        return;
    }

    // Use the file's creation time if available; otherwise fall back to last modification time.
    let created_sys = meta
        .created()
        .or_else(|_| meta.modified())
        .unwrap_or(std::time::SystemTime::UNIX_EPOCH);

    // Convert to OffsetDateTime and then to local time.
    let created_utc = OffsetDateTime::from(created_sys);
    let local_offset = UtcOffset::current_local_offset().unwrap_or(UtcOffset::UTC);
    let created_local = created_utc.to_offset(local_offset);

    let base_name = format!(
        "openvcs-{:04}-{:02}-{:02}_{:02}-{:02}",
        created_local.year(),
        u8::from(created_local.month()),
        created_local.day(),
        created_local.hour(),
        created_local.minute()
    );

    // Choose a unique archive name, prefer base.zip then -2.zip etc.
    let pick_name = |idx: u32| -> String {
        if idx <= 1 {
            format!("{base_name}.zip")
        } else {
            format!("{base_name}-{idx}.zip")
        }
    };

    let mut zip_path = dir.join(pick_name(1));
    let mut idx = 2u32;
    while zip_path.exists() && idx < 100 {
        zip_path = dir.join(pick_name(idx));
        idx += 1;
    }

    if let Ok(zip_file) = std::fs::File::create(&zip_path) {
        let mut zip = ZipWriter::new(zip_file);
        let options: zip::write::FileOptions<'_, zip::write::ExtendedFileOptions> =
            FileOptions::default()
                .compression_method(CompressionMethod::Deflated)
                .unix_permissions(0o644);
        if zip.start_file("openvcs.log", options).is_ok() {
            let _ = std::io::copy(&mut src, &mut zip);
            let _ = zip.finish();
            // Remove the old active file only after successful zip
            let _ = fs::remove_file(&active);
        } else {
            // If starting the file fails, try to clean up the partial zip
            let _ = zip.finish();
            let _ = fs::remove_file(&zip_path);
        }
    }
}

/// Prunes old log archives, keeping only newest `keep` entries.
///
/// # Parameters
/// - `dir`: Logs directory path.
/// - `keep`: Number of archives to retain.
///
/// # Returns
/// - `()`.
fn prune_archives(dir: &std::path::Path, keep: usize) {
    use std::path::PathBuf;
    let Ok(read) = fs::read_dir(dir) else {
        return;
    };
    let mut entries: Vec<(PathBuf, std::time::SystemTime)> = Vec::new();
    for e in read.flatten() {
        let path = e.path();
        if !path.is_file() {
            continue;
        }
        if let Some(name) = path.file_name().and_then(|s| s.to_str()) {
            if !(name.starts_with("openvcs-") && name.ends_with(".zip")) {
                continue;
            }
        } else {
            continue;
        }
        let mtime = e
            .metadata()
            .and_then(|m| m.modified())
            .unwrap_or(std::time::SystemTime::UNIX_EPOCH);
        entries.push((path, mtime));
    }

    if entries.len() <= keep {
        return;
    }
    entries.sort_by_key(|(_, t)| *t);
    let to_delete = entries.len().saturating_sub(keep);
    for (path, _) in entries.into_iter().take(to_delete) {
        let _ = fs::remove_file(path);
    }
}

#[cfg(test)]
mod tests {
    include!("../tests/modules/logging.rs");
}
