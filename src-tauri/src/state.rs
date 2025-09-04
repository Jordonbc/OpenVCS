use std::path::PathBuf;
use std::sync::RwLock;

#[derive(Default)]
pub struct AppState {
    // For now: single active repo
    current_repo: RwLock<Option<PathBuf>>,

    // Optional: keep a small MRU list for your “Recents”
    recents: RwLock<Vec<PathBuf>>,
}

impl AppState {
    pub fn set_current_repo(&self, path: PathBuf) {
        {
            let mut cur = self.current_repo.write().unwrap();
            *cur = Some(path.clone());
        }
        // Update recents (front insert, unique, cap N)
        let mut r = self.recents.write().unwrap();
        r.retain(|p| p != &path);
        r.insert(0, path);
        const MAX_RECENTS: usize = 10;
        if r.len() > MAX_RECENTS { r.truncate(MAX_RECENTS); }
    }

    pub fn clear_current_repo(&self) {
        *self.current_repo.write().unwrap() = None;
    }

    pub fn current_repo(&self) -> Option<PathBuf> {
        self.current_repo.read().unwrap().clone()
    }

    pub fn recents(&self) -> Vec<PathBuf> {
        self.recents.read().unwrap().clone()
    }
}
