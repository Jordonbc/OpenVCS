use std::{fs, io};
use std::{path::PathBuf, sync::Arc};

use log::{debug, info};
use parking_lot::RwLock;

use openvcs_core::Repo;
use crate::settings::AppConfig;
use crate::repo_settings::RepoConfig;
use directories::ProjectDirs;
use serde::{Deserialize, Serialize};

// Default MRU size used as a fallback when settings are missing/invalid
pub const MAX_RECENTS: usize = 10;

/// Central application state.
/// Keeps track of the currently open repo and MRU recents.
/// Backend choice is tied to each repo (via `Repo::id()`), not stored globally.
#[derive(Default)]
pub struct AppState {
    /// Global settings (loaded on startup), thread-safe.
    config: RwLock<AppConfig>,

    /// Repository-specific settings (in-memory for now)
    repo_config: RwLock<RepoConfig>,

    /// Currently open repository
    current_repo: RwLock<Option<Arc<Repo>>>,

    /// MRU list for “Recents”
    recents: RwLock<Vec<PathBuf>>,
}

impl AppState {
    pub fn new_with_config() -> Self {
        let cfg = AppConfig::load_or_default(); // reads ~/.config/openvcs/openvcs.conf
        let mut s = Self {
            config: RwLock::new(cfg),
            repo_config: RwLock::new(RepoConfig::default()),
            ..Default::default()
        };
        // Attempt to load recents from app data (not config dir)
        if let Ok(list) = load_recents_from_disk() {
            *s.recents.write() = list;
        }
        s
    }

    /// Persist current config to disk.
    pub fn save_config(&self) -> Result<(), String> {
        let cfg = self.config.read().clone();
        cfg.save().map_err(|e| e.to_string())
    }

    /* -------- config access -------- */

    /// Snapshot of current config (cheap clone; sections are small).
    pub fn config(&self) -> AppConfig {
        self.config.read().clone()
    }

    /// Read-only closure access (avoid cloning if you’re just reading).
    pub fn with_config<F, R>(&self, f: F) -> R
    where
        F: FnOnce(&AppConfig) -> R
    {
        let cfg = self.config.read();
        f(&cfg)
    }

    /// Replace whole config: validate → save → swap (readers never see an unsaved state).
    pub fn set_config(&self, mut next: AppConfig) -> Result<(), String> {
        next.migrate();
        next.validate();
        next.save().map_err(|e| e.to_string())?;
        *self.config.write() = next;
        self.enforce_recents_limit_and_persist();
        Ok(())
    }

    /* -------- repo config -------- */

    pub fn repo_config(&self) -> RepoConfig {
        self.repo_config.read().clone()
    }

    pub fn set_repo_config(&self, cfg: RepoConfig) -> Result<(), String> {
        *self.repo_config.write() = cfg;
        Ok(())
    }

    /// Transactional edit: clone → mutate → validate → save → swap.
    /// Keep the closure FAST (no blocking/async in here).
    pub fn edit_config<F>(&self, f: F) -> Result<(), String>
    where
        F: FnOnce(&mut AppConfig),
    {
        let cur = self.config.read().clone();
        let mut next = cur.clone();
        f(&mut next);
        next.migrate();
        next.validate();
        next.save().map_err(|e| e.to_string())?;
        *self.config.write() = next;
        self.enforce_recents_limit_and_persist();
        Ok(())
    }

    /* -------- repo lifecycle -------- */

    pub fn has_repo(&self) -> bool {
        self.current_repo.read().is_some()
    }

    pub fn set_current_repo(&self, repo: Arc<Repo>) {
        let path = repo.inner().workdir().to_path_buf();

        info!(
            "AppState: set current repo (backend={}, path={})",
            repo.id(),
            path.display()
        );

        *self.current_repo.write() = Some(repo);

        // Update recents (front insert, unique, cap N from settings)
        let mut r = self.recents.write();
        r.retain(|p| p != &path);
        r.insert(0, path.clone());
        let limit = self.config.read().ux.recents_limit as usize;
        let max_items = if limit == 0 { MAX_RECENTS } else { limit };
        if r.len() > max_items { r.truncate(max_items); }

        debug!(
            "AppState: recents -> [{}]",
            r.iter()
                .map(|p| p.display().to_string())
                .collect::<Vec<_>>()
                .join(", ")
        );

        // Persist recents; ignore failures but log
        if let Err(e) = save_recents_to_disk(&r.clone()) { // clone small vec
            log::warn!("AppState: failed to persist recents: {}", e);
        }
    }

    pub fn clear_current_repo(&self) {
        *self.current_repo.write() = None;
        info!("AppState: cleared current repository");
    }

    /* -------- getters -------- */

    pub fn current_repo(&self) -> Option<Arc<Repo>> {
        self.current_repo.read().clone()
    }

    pub fn recents(&self) -> Vec<PathBuf> {
        self.recents.read().clone()
    }
}

// ──────────────────────────────────────────────────────────────────────────────
// Recents persistence (outside config dir)
// File format: JSON array of objects { "path": "..." } for forward compatibility.
// ──────────────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
struct RecentFileEntry { path: String }

fn recents_file_path() -> PathBuf {
    if let Some(pd) = ProjectDirs::from("dev", "OpenVCS", "OpenVCS") {
        pd.data_dir().join("recents.json")
    } else {
        PathBuf::from("recents.json")
    }
}

fn load_recents_from_disk() -> Result<Vec<PathBuf>, String> {
    let p = recents_file_path();
    let data = match fs::read_to_string(&p) {
        Ok(s) => s,
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(vec![]),
        Err(e) => return Err(format!("read recents: {}", e)),
    };

    // Accept: [ { path }, ... ] or ["/path", ...]
    let mut out: Vec<PathBuf> = Vec::new();
    match serde_json::from_str::<serde_json::Value>(&data) {
        Ok(serde_json::Value::Array(items)) => {
            for it in items {
                match it {
                    serde_json::Value::String(s) => {
                        if !s.trim().is_empty() { out.push(PathBuf::from(s)); }
                    }
                    serde_json::Value::Object(map) => {
                        if let Some(serde_json::Value::String(s)) = map.get("path") {
                            if !s.trim().is_empty() { out.push(PathBuf::from(s)); }
                        }
                    }
                    _ => {}
                }
            }
        }
        _ => {}
    }
    Ok(out)
}

fn save_recents_to_disk(list: &Vec<PathBuf>) -> Result<(), String> {
    let p = recents_file_path();
    if let Some(parent) = p.parent() { fs::create_dir_all(parent).map_err(|e| e.to_string())?; }
    let entries: Vec<RecentFileEntry> = list
        .iter()
        .map(|pb| RecentFileEntry { path: pb.to_string_lossy().to_string() })
        .collect();
    let json = serde_json::to_string_pretty(&entries).map_err(|e| e.to_string())?;
    fs::write(&p, json).map_err(|e| e.to_string())
}

impl AppState {
    fn enforce_recents_limit_and_persist(&self) {
        let limit = self.config.read().ux.recents_limit as usize;
        let max_items = if limit == 0 { MAX_RECENTS } else { limit };
        let mut r = self.recents.write();
        if r.len() > max_items { r.truncate(max_items); }
        if let Err(e) = save_recents_to_disk(&r.clone()) {
            log::warn!("AppState: failed to persist recents after settings change: {}", e);
        }
    }
}
