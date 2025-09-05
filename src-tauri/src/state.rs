use std::path::PathBuf;
use std::sync::{Arc, RwLock};

use log::{debug, info};
use openvcs_core::{Repo as CoreRepo, Vcs};

#[derive(Default)]
pub struct AppState {
    // Selected backend (string id; e.g., "git-libgit2" or "git-system")
    backend_id: RwLock<String>,

    // Active repo path (what your UI shows)
    current_repo: RwLock<Option<PathBuf>>,

    // Active backend instance for the current repo
    repo_handle: RwLock<Option<Arc<dyn Vcs>>>,

    // MRU list for “Recents”
    recents: RwLock<Vec<PathBuf>>,
}

impl AppState {
    /* -------- backend selection -------- */

    
    pub fn set_backend_id(&self, id: String) {
        info!("Changing active backend to: {}", id);
        *self.backend_id.write().unwrap() = id;
    }
    
    pub fn backend_id(&self) -> String {
        let id = self.backend_id.read().unwrap().clone();
        debug!("Queried active backend: {}", id);
        id
    }

    /* -------- current repo path -------- */

    pub fn set_current_repo(&self, path: PathBuf) {
        {
            let mut cur = self.current_repo.write().unwrap();
            *cur = Some(path.clone());
        }

        // Update recents (front insert, unique, cap N)
        let mut r = self.recents.write().unwrap();
        r.retain(|p| p != &path);
        r.insert(0, path.clone());
        const MAX_RECENTS: usize = 10;
        if r.len() > MAX_RECENTS {
            r.truncate(MAX_RECENTS);
        }

        info!("Set current repo: {}", path.display());
        debug!(
            "Recents updated: [{}]",
            r.iter().map(|p| p.display().to_string()).collect::<Vec<_>>().join(", ")
        );
    }

    pub fn clear_current_repo(&self) {
        *self.current_repo.write().unwrap() = None;
        *self.repo_handle.write().unwrap() = None;

        info!("Cleared current repository and repo handle");
    }

    pub fn current_repo(&self) -> Option<PathBuf> {
        self.current_repo.read().unwrap().clone()
    }

    pub fn recents(&self) -> Vec<PathBuf> {
        self.recents.read().unwrap().clone()
    }

    /* -------- backend handle (Arc<dyn Vcs>) -------- */

    /// Set the active backend instance for the current repo.
    pub fn set_current_repo_handle(&self, handle: Arc<dyn Vcs>) {
        info!("Setting current repo handle (backend: {})", handle.id());
        *self.repo_handle.write().unwrap() = Some(handle);
    }

    /// Clear the backend instance (e.g., when closing the repo).
    pub fn clear_current_repo_handle(&self) {
        info!("Clearing current repo handle");
        *self.repo_handle.write().unwrap() = None;
    }

    /// Get a **cloned** Repo wrapper for callers (cheap clone of Arc).
    /// Returns `None` if no repo is open.
    pub fn current_repo_handle(&self) -> Option<CoreRepo> {
        self.repo_handle
            .read()
            .unwrap()
            .as_ref()
            .map(|arc| CoreRepo::new(arc.clone()))
    }
}
