use openvcs_core::{BackendId, Vcs};
use std::sync::Arc;

#[derive(Clone)]
pub struct Repo {
    inner: Arc<dyn Vcs>,
}

impl Repo {
    pub fn new(inner: Arc<dyn Vcs>) -> Self {
        Self { inner }
    }

    pub fn inner(&self) -> &dyn Vcs {
        self.inner.as_ref()
    }

    pub fn id(&self) -> BackendId {
        self.inner.id()
    }
}

