use std::fs::{self, OpenOptions};
use std::io::Write;
use std::sync::Mutex;
use time::{OffsetDateTime, UtcOffset};
use crate::settings::{AppConfig, LogLevel};
use zip::{write::FileOptions, CompressionMethod, ZipWriter};

/// Initialize logging: console (env_logger) + append to `./logs/openvcs.log`.
/// Respects `RUST_LOG` for filtering; sets a sensible default if missing.
pub fn init() {
    // Load persisted settings early (does not require AppState) for logging configuration
    let cfg = AppConfig::load_or_default();

    struct DualLogger {
        console: env_logger::Logger,
        file: Mutex<std::fs::File>,
    }
    impl log::Log for DualLogger {
        fn enabled(&self, m: &log::Metadata) -> bool {
            // Delegate filtering to env_logger
            self.console.enabled(m)
        }
        fn log(&self, r: &log::Record) {
            if self.enabled(r.metadata()) {
                self.console.log(r);
                if let Ok(mut f) = self.file.lock() {
                    let _ = writeln!(f, "{} [{}] {}", r.level(), r.target(), r.args());
                }
            }
        }
        fn flush(&self) {
            self.console.flush();
            if let Ok(mut f) = self.file.lock() {
                let _ = f.flush();
            }
        }
    }

    // Build console logger (with timestamps) and then mirror to a file if possible.
    let mut builder = env_logger::Builder::from_default_env();
    builder.format_timestamp_millis();
    // If RUST_LOG is unset, apply level from settings
    if std::env::var_os("RUST_LOG").is_none() {
        let level = match cfg.logging.level {
            LogLevel::Trace => log::LevelFilter::Trace,
            LogLevel::Debug => log::LevelFilter::Debug,
            LogLevel::Info  => log::LevelFilter::Info,
            LogLevel::Warn  => log::LevelFilter::Warn,
            LogLevel::Error => log::LevelFilter::Error,
        };
        builder.filter_level(level);
    }
    let console_logger = builder.build();

    // Ensure ./logs exists and rotate existing openvcs.log into a timestamped .zip archive
    let logfile = (|| -> Option<std::fs::File> {
        let dir = std::path::Path::new("logs");
        let _ = fs::create_dir_all(dir); // best effort

        rotate_existing_log(dir);
        prune_archives(dir, cfg.logging.retain_archives as usize);

        // Open (truncate) the active log file for this session
        let active = dir.join("openvcs.log");
        OpenOptions::new().create(true).write(true).truncate(true).open(active).ok()
    })();

    if let Some(file) = logfile {
        let dual = DualLogger { console: console_logger, file: Mutex::new(file) };
        let _ = log::set_boxed_logger(Box::new(dual));
        log::set_max_level(log::LevelFilter::Trace);
    } else {
        // Fallback to console-only
        let _ = log::set_boxed_logger(Box::new(console_logger));
        log::set_max_level(log::LevelFilter::Trace);
    }
}

fn rotate_existing_log(dir: &std::path::Path) {
    let active = dir.join("openvcs.log");
    let Ok(mut src) = std::fs::File::open(&active) else { return; };
    // Skip empty files
    let meta = match src.metadata() { Ok(m) => m, Err(_) => return };
    if meta.len() == 0 { return; }

    // Use the file's creation time if available; otherwise fall back to last modification time.
    let created_sys = meta.created().or_else(|_| meta.modified()).unwrap_or(std::time::SystemTime::UNIX_EPOCH);

    // Convert to OffsetDateTime and then to local time.
    let created_utc = OffsetDateTime::from(created_sys);
    let local_offset = UtcOffset::current_local_offset().unwrap_or(UtcOffset::UTC);
    let created_local = created_utc.to_offset(local_offset);

    let base_name = format!(
        "openvcs-{:04}-{:02}-{:02}_{:02}-{:02}",
        created_local.year(), u8::from(created_local.month()), created_local.day(), created_local.hour(), created_local.minute()
    );

    // Choose a unique archive name, prefer base.zip then -2.zip etc.
    let pick_name = |idx: u32| -> String {
        if idx <= 1 { format!("{base_name}.zip") } else { format!("{base_name}-{idx}.zip") }
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

fn prune_archives(dir: &std::path::Path, keep: usize) {
    use std::path::PathBuf;
    let Ok(read) = fs::read_dir(dir) else { return; };
    let mut entries: Vec<(PathBuf, std::time::SystemTime)> = Vec::new();
    for e in read.flatten() {
        let path = e.path();
        if !path.is_file() { continue; }
        if let Some(name) = path.file_name().and_then(|s| s.to_str()) {
            if !(name.starts_with("openvcs-") && name.ends_with(".zip")) { continue; }
        } else { continue; }
        let mtime = e.metadata().and_then(|m| m.modified()).unwrap_or(std::time::SystemTime::UNIX_EPOCH);
        entries.push((path, mtime));
    }

    if entries.len() <= keep { return; }
    entries.sort_by_key(|(_, t)| *t);
    let to_delete = entries.len().saturating_sub(keep);
    for (path, _) in entries.into_iter().take(to_delete) {
        let _ = fs::remove_file(path);
    }
}
