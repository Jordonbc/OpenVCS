use std::{path::PathBuf, sync::Arc};

use log::{debug, info};
use parking_lot::RwLock;

use openvcs_core::Repo;
use crate::settings::AppConfig;
use crate::repo_settings::RepoConfig;

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
        Self {
            config: RwLock::new(cfg),
            repo_config: RwLock::new(RepoConfig::default()),
            ..Default::default()
        }
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

        // Update recents (front insert, unique, cap N)
        let mut r = self.recents.write();
        r.retain(|p| p != &path);
        r.insert(0, path.clone());
        const MAX_RECENTS: usize = 10;
        if r.len() > MAX_RECENTS {
            r.truncate(MAX_RECENTS);
        }

        debug!(
            "AppState: recents -> [{}]",
            r.iter()
                .map(|p| p.display().to_string())
                .collect::<Vec<_>>()
                .join(", ")
        );
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
