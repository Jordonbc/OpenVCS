/* ========================= Runtime backend registry =========================
   Backends contribute a `BackendDescriptor` into the distributed slice below.
   The app can enumerate and pick any registered backend at runtime.
=============================================================================*/
use crate::Vcs;
use crate::backend_id::BackendId;
use crate::models::{Capabilities, OnEvent};
use std::path::Path;
use std::sync::Arc;

/// Factory & metadata for a backend implementation.
pub struct BackendDescriptor {
    pub id: BackendId,
    pub name: &'static str,
    pub caps: fn() -> Capabilities,
    pub open: fn(&Path) -> crate::Result<Arc<dyn Vcs>>,
    pub clone_repo: fn(&str, &Path, Option<OnEvent>) -> crate::Result<Arc<dyn Vcs>>,
}

/// The global registry. Each backend crate declares exactly one `BackendDescriptor` here.
#[linkme::distributed_slice]
pub static BACKENDS: [BackendDescriptor] = [..];

/// Enumerate all registered backends (order is link-order; do not rely on it).
pub fn list_backends() -> impl Iterator<Item = &'static BackendDescriptor> {
    use log::{debug, trace};

    // Create the iterator first so we can both inspect and return it.
    let it = BACKENDS.iter();

    // Cheap to ask the length from the slice iterator.
    debug!("openvcs-core: {} backends registered", it.len());

    // Optionally enumerate each backend at trace level.
    for b in it.clone() {
        trace!("openvcs-core: backend loaded: {} ({})", b.id, b.name);
    }

    it
}

/// Lookup a backend descriptor by id.
pub fn get_backend(id: impl AsRef<str>) -> Option<&'static BackendDescriptor> {
    use log::{debug, warn};

    let id = id.as_ref();
    match BACKENDS.iter().find(|b| b.id.as_ref() == id) {
        Some(b) => {
            debug!(
                "openvcs-core: backend lookup succeeded → {} ({})",
                b.id, b.name
            );
            Some(b)
        }
        None => {
            warn!("openvcs-core: backend lookup failed for id='{}'", id);
            None
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_helpers::{dummy_caps, dummy_clone_repo, dummy_open};
    use std::path::Path;

    #[linkme::distributed_slice(crate::backend_descriptor::BACKENDS)]
    static TEST_BACKEND: BackendDescriptor = BackendDescriptor {
        id: crate::backend_id!("dummy-test"),
        name: "Dummy Backend",
        caps: dummy_caps,
        open: dummy_open,
        clone_repo: dummy_clone_repo,
    };

    #[test]
    fn list_backends_exposes_registered_backend() {
        let ids: Vec<_> = list_backends().map(|b| b.id.as_ref()).collect();
        assert!(ids.contains(&"dummy-test"));
    }

    #[test]
    fn get_backend_finds_registered_entry() {
        let backend = get_backend("dummy-test").expect("backend to exist");
        assert_eq!(backend.name, "Dummy Backend");
        assert!((backend.caps)().commits);

        let repo = (backend.open)(Path::new(".")).expect("backend open to succeed");
        assert_eq!(repo.id().as_ref(), "dummy-test");
    }

    #[test]
    fn missing_backend_returns_none() {
        assert!(get_backend("unknown").is_none());
    }
}
