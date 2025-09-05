use std::{path::PathBuf, sync::Arc};

use log::{debug, info};
use parking_lot::RwLock;

use openvcs_core::Repo;

/// Central application state.
/// Keeps track of the currently open repo and MRU recents.
/// Backend choice is tied to each repo (via `Repo::id()`), not stored globally.
#[derive(Default)]
pub struct AppState {
    /// Currently open repository
    current_repo: RwLock<Option<Arc<Repo>>>,

    /// MRU list for “Recents”
    recents: RwLock<Vec<PathBuf>>,
}

impl AppState {
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
