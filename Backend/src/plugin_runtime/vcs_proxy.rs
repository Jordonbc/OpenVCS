// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

use crate::core::models::{
    BranchItem, CommitItem, ConflictDetails, ConflictSide, LogQuery, StashItem, StatusPayload,
    VcsEvent,
};
use crate::core::{BackendId, OnEvent, Result as VcsResult, Vcs, VcsError};
use crate::logging::LogTimer;
use crate::plugin_runtime::instance::PluginRuntimeInstance;
use crate::plugin_runtime::node_instance::NodePluginRuntimeInstance;
use log::{debug, error, info};
use std::path::{Path, PathBuf};
use std::sync::Arc;

const MODULE: &str = "vcs_proxy";

/// [`Vcs`] implementation that forwards operations to typed plugin runtime calls.
pub struct PluginVcsProxy {
    /// Backend identifier represented by this proxy instance.
    backend_id: BackendId,
    /// Repository worktree path associated with this backend session.
    workdir: PathBuf,
    /// Started plugin runtime used for JSON-RPC calls.
    runtime: Arc<NodePluginRuntimeInstance>,
}

impl PluginVcsProxy {
    /// Opens a repository through a previously started plugin module runtime.
    pub fn open_with_process(
        backend_id: BackendId,
        runtime: Arc<NodePluginRuntimeInstance>,
        repo_path: &Path,
        cfg: serde_json::Value,
    ) -> Result<Arc<dyn Vcs>, VcsError> {
        let _timer = LogTimer::new(MODULE, "open_with_process");
        let path_str = repo_path.to_string_lossy();
        info!(
            "open_with_process: backend={}, path={}",
            backend_id, path_str
        );

        let p = PluginVcsProxy {
            backend_id: backend_id.clone(),
            workdir: repo_path.to_path_buf(),
            runtime,
        };

        p.runtime.ensure_running().map_err(|e| VcsError::Backend {
            backend: p.backend_id.clone(),
            msg: e,
        })?;

        let config = serde_json::to_vec(&cfg).map_err(|e| VcsError::Backend {
            backend: p.backend_id.clone(),
            msg: format!("serialize open config: {e}"),
        })?;
        p.runtime
            .vcs_open(path_to_utf8(repo_path)?.as_str(), &config)
            .map_err(|e| {
                error!("open_with_process: open call failed: {}", e);
                VcsError::Backend {
                    backend: p.backend_id.clone(),
                    msg: e,
                }
            })?;

        info!(
            "open_with_process: opened backend {} for {}",
            backend_id, path_str
        );
        Ok(Arc::new(p))
    }

    /// Runs an operation while temporarily installing an event callback sink.
    fn with_events<F, R>(&self, on: Option<OnEvent>, f: F) -> Result<R, VcsError>
    where
        F: FnOnce() -> Result<R, VcsError>,
    {
        let sink: Option<Arc<dyn Fn(VcsEvent) + Send + Sync + 'static>> =
            on.map(|cb| Arc::new(move |evt| cb(evt)) as _);
        self.runtime.set_event_sink(sink);
        let res = f();
        self.runtime.set_event_sink(None);
        res
    }

    /// Maps string runtime errors into backend-scoped VCS errors.
    fn map_runtime_error(&self, err: String) -> VcsError {
        if err == "no upstream configured" {
            return VcsError::NoUpstream;
        }

        VcsError::Backend {
            backend: self.backend_id.clone(),
            msg: err,
        }
    }
}

impl Vcs for PluginVcsProxy {
    fn id(&self) -> BackendId {
        self.backend_id.clone()
    }

    fn workdir(&self) -> &Path {
        &self.workdir
    }

    fn current_branch(&self) -> VcsResult<Option<String>> {
        self.runtime
            .vcs_get_current_branch()
            .map_err(|e| self.map_runtime_error(e))
    }

    fn branches(&self) -> VcsResult<Vec<BranchItem>> {
        self.runtime
            .vcs_list_branches()
            .map_err(|e| self.map_runtime_error(e))
    }

    fn create_branch(&self, name: &str, checkout: bool) -> VcsResult<()> {
        self.runtime
            .vcs_create_branch(name, checkout)
            .map_err(|e| self.map_runtime_error(e))
    }

    fn checkout_branch(&self, name: &str) -> VcsResult<()> {
        self.runtime
            .vcs_checkout_branch(name)
            .map_err(|e| self.map_runtime_error(e))
    }

    fn ensure_remote(&self, name: &str, url: &str) -> VcsResult<()> {
        self.runtime
            .vcs_ensure_remote(name, url)
            .map_err(|e| self.map_runtime_error(e))
    }

    fn list_remotes(&self) -> VcsResult<Vec<(String, String)>> {
        self.runtime
            .vcs_list_remotes()
            .map_err(|e| self.map_runtime_error(e))
    }

    fn remove_remote(&self, name: &str) -> VcsResult<()> {
        self.runtime
            .vcs_remove_remote(name)
            .map_err(|e| self.map_runtime_error(e))
    }

    fn fetch(&self, remote: &str, refspec: &str, on: Option<OnEvent>) -> VcsResult<()> {
        self.with_events(on, || {
            self.runtime
                .vcs_fetch(remote, refspec)
                .map_err(|e| self.map_runtime_error(e))
        })
    }

    fn push(&self, remote: &str, refspec: &str, on: Option<OnEvent>) -> VcsResult<()> {
        self.with_events(on, || {
            self.runtime
                .vcs_push(remote, refspec)
                .map_err(|e| self.map_runtime_error(e))
        })
    }

    fn pull_ff_only(&self, remote: &str, branch: &str, on: Option<OnEvent>) -> VcsResult<()> {
        self.with_events(on, || {
            self.runtime
                .vcs_pull_ff_only(remote, branch)
                .map_err(|e| self.map_runtime_error(e))
        })
    }

    fn commit(
        &self,
        message: &str,
        name: &str,
        email: &str,
        paths: &[PathBuf],
    ) -> VcsResult<String> {
        let paths = paths
            .iter()
            .map(|p| p.to_string_lossy().to_string())
            .collect::<Vec<_>>();
        self.runtime
            .vcs_commit(message, name, email, &paths)
            .map_err(|e| self.map_runtime_error(e))
    }

    fn commit_index(&self, message: &str, name: &str, email: &str) -> VcsResult<String> {
        self.runtime
            .vcs_commit_index(message, name, email)
            .map_err(|e| self.map_runtime_error(e))
    }

    fn status_payload(&self) -> VcsResult<StatusPayload> {
        self.runtime
            .vcs_get_status_payload()
            .map_err(|e| self.map_runtime_error(e))
    }

    fn log_commits(&self, query: &LogQuery) -> VcsResult<Vec<CommitItem>> {
        self.runtime
            .vcs_list_commits(query)
            .map_err(|e| self.map_runtime_error(e))
    }

    fn diff_file(&self, path: &Path) -> VcsResult<Vec<String>> {
        self.runtime
            .vcs_diff_file(path_to_utf8(path)?.as_str())
            .map_err(|e| self.map_runtime_error(e))
    }

    fn diff_commit(&self, rev: &str) -> VcsResult<Vec<String>> {
        self.runtime
            .vcs_diff_commit(rev)
            .map_err(|e| self.map_runtime_error(e))
    }

    fn conflict_details(&self, path: &Path) -> VcsResult<ConflictDetails> {
        self.runtime
            .vcs_get_conflict_details(path_to_utf8(path)?.as_str())
            .map_err(|e| self.map_runtime_error(e))
    }

    fn checkout_conflict_side(&self, path: &Path, side: ConflictSide) -> VcsResult<()> {
        self.runtime
            .vcs_checkout_conflict_side(path_to_utf8(path)?.as_str(), side)
            .map_err(|e| self.map_runtime_error(e))
    }

    fn write_merge_result(&self, path: &Path, content: &[u8]) -> VcsResult<()> {
        self.runtime
            .vcs_write_merge_result(path_to_utf8(path)?.as_str(), content)
            .map_err(|e| self.map_runtime_error(e))
    }

    fn stage_patch(&self, patch: &str) -> VcsResult<()> {
        self.runtime
            .vcs_stage_patch(patch)
            .map_err(|e| self.map_runtime_error(e))
    }

    fn discard_paths(&self, paths: &[PathBuf]) -> VcsResult<()> {
        let paths = paths
            .iter()
            .map(|p| p.to_string_lossy().to_string())
            .collect::<Vec<_>>();
        self.runtime
            .vcs_discard_paths(&paths)
            .map_err(|e| self.map_runtime_error(e))
    }

    fn apply_reverse_patch(&self, patch: &str) -> VcsResult<()> {
        self.runtime
            .vcs_apply_reverse_patch(patch)
            .map_err(|e| self.map_runtime_error(e))
    }

    fn delete_branch(&self, name: &str, force: bool) -> VcsResult<()> {
        self.runtime
            .vcs_delete_branch(name, force)
            .map_err(|e| self.map_runtime_error(e))
    }

    fn rename_branch(&self, old: &str, new: &str) -> VcsResult<()> {
        self.runtime
            .vcs_rename_branch(old, new)
            .map_err(|e| self.map_runtime_error(e))
    }

    fn merge_into_current(&self, name: &str) -> VcsResult<()> {
        self.runtime
            .vcs_merge_into_current(name, None)
            .map_err(|e| self.map_runtime_error(e))
    }

    fn merge_into_current_with_message(&self, name: &str, message: Option<&str>) -> VcsResult<()> {
        self.runtime
            .vcs_merge_into_current(name, message)
            .map_err(|e| self.map_runtime_error(e))
    }

    fn merge_abort(&self) -> VcsResult<()> {
        self.runtime
            .vcs_merge_abort()
            .map_err(|e| self.map_runtime_error(e))
    }

    fn merge_continue(&self) -> VcsResult<()> {
        self.runtime
            .vcs_merge_continue()
            .map_err(|e| self.map_runtime_error(e))
    }

    fn merge_in_progress(&self) -> VcsResult<bool> {
        self.runtime
            .vcs_is_merge_in_progress()
            .map_err(|e| self.map_runtime_error(e))
    }

    fn set_branch_upstream(&self, branch: &str, upstream: &str) -> VcsResult<()> {
        self.runtime
            .vcs_set_branch_upstream(branch, upstream)
            .map_err(|e| self.map_runtime_error(e))
    }

    fn branch_upstream(&self, branch: &str) -> VcsResult<Option<String>> {
        self.runtime
            .vcs_get_branch_upstream(branch)
            .map_err(|e| self.map_runtime_error(e))
    }

    fn reset_soft_to(&self, rev: &str) -> VcsResult<()> {
        self.runtime
            .vcs_reset_soft_to(rev)
            .map_err(|e| self.map_runtime_error(e))
    }

    fn get_identity(&self) -> VcsResult<Option<(String, String)>> {
        self.runtime
            .vcs_get_identity()
            .map_err(|e| self.map_runtime_error(e))
    }

    fn set_identity_local(&self, name: &str, email: &str) -> VcsResult<()> {
        self.runtime
            .vcs_set_identity_local(name, email)
            .map_err(|e| self.map_runtime_error(e))
    }

    fn stash_list(&self) -> VcsResult<Vec<StashItem>> {
        self.runtime
            .vcs_list_stashes()
            .map_err(|e| self.map_runtime_error(e))
    }

    fn stash_push(
        &self,
        message: &str,
        include_untracked: bool,
        _paths: &[PathBuf],
    ) -> VcsResult<()> {
        let message = if message.trim().is_empty() {
            None
        } else {
            Some(message)
        };
        let _ = self
            .runtime
            .vcs_stash_push(message, include_untracked)
            .map_err(|e| self.map_runtime_error(e))?;
        Ok(())
    }

    fn stash_apply(&self, selector: &str) -> VcsResult<()> {
        self.runtime
            .vcs_stash_apply(selector)
            .map_err(|e| self.map_runtime_error(e))
    }

    fn stash_pop(&self, selector: &str) -> VcsResult<()> {
        self.runtime
            .vcs_stash_pop(selector)
            .map_err(|e| self.map_runtime_error(e))
    }

    fn stash_drop(&self, selector: &str) -> VcsResult<()> {
        self.runtime
            .vcs_stash_drop(selector)
            .map_err(|e| self.map_runtime_error(e))
    }

    fn stash_show(&self, selector: &str) -> VcsResult<Vec<String>> {
        self.runtime
            .vcs_stash_show(selector)
            .map(|value| value.lines().map(|line| line.to_string()).collect())
            .map_err(|e| self.map_runtime_error(e))
    }

    fn cherry_pick(&self, rev: &str) -> VcsResult<()> {
        self.runtime
            .vcs_cherry_pick(rev)
            .map_err(|e| self.map_runtime_error(e))
    }

    fn revert_commit(&self, rev: &str, no_edit: bool) -> VcsResult<()> {
        self.runtime
            .vcs_revert_commit(rev, no_edit)
            .map_err(|e| self.map_runtime_error(e))
    }
}

impl Drop for PluginVcsProxy {
    /// Stops the underlying plugin runtime when the proxy is dropped.
    fn drop(&mut self) {
        debug!("drop: stopping VCS plugin runtime for {}", self.backend_id);
        self.runtime.stop();
    }
}

/// Converts a filesystem path to UTF-8 text.
fn path_to_utf8(path: &Path) -> Result<String, VcsError> {
    path.to_str()
        .map(str::to_string)
        .ok_or_else(|| VcsError::Backend {
            backend: BackendId::from("plugin"),
            msg: format!("non-utf8 path: {}", path.display()),
        })
}
