// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later
//! Thin wrapper around an opened backend repository handle.

use openvcs_core::{BackendId, Vcs};
use std::sync::Arc;

/// Shared repository handle stored in application state.
#[derive(Clone)]
pub struct Repo {
    inner: Arc<dyn Vcs>,
}

impl Repo {
    /// Creates a new repository wrapper from a backend implementation.
    ///
    /// # Parameters
    /// - `inner`: Shared backend implementation for repository operations.
    ///
    /// # Returns
    /// - A new [`Repo`] wrapper around the provided backend handle.
    pub fn new(inner: Arc<dyn Vcs>) -> Self {
        Self { inner }
    }

    /// Returns the underlying backend repository interface.
    ///
    /// # Returns
    /// - A shared trait object reference for issuing backend repository operations.
    pub fn inner(&self) -> &dyn Vcs {
        self.inner.as_ref()
    }

    /// Returns the backend identifier that owns this repository instance.
    ///
    /// # Returns
    /// - The [`BackendId`] reported by the underlying VCS backend.
    pub fn id(&self) -> BackendId {
        self.inner.id()
    }
}
