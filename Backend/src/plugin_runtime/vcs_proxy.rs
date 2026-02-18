// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later
use crate::logging::LogTimer;
use crate::plugin_runtime::instance::PluginRuntimeInstance;
use log::{debug, error, info, trace, warn};
use openvcs_core::models::{
    Capabilities, ConflictDetails, ConflictSide, FetchOptions, LogQuery, StashItem, StatusPayload,
    StatusSummary, VcsEvent,
};
use openvcs_core::{BackendId, OnEvent, Result as VcsResult, Vcs, VcsError};
use serde::de::DeserializeOwned;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::sync::Arc;

const MODULE: &str = "vcs_proxy";

/// [`Vcs`] implementation that forwards operations to a plugin runtime.
pub struct PluginVcsProxy {
    /// Backend identifier represented by this proxy instance.
    backend_id: BackendId,
    /// Repository worktree path associated with this backend session.
    workdir: PathBuf,
    /// Started plugin runtime used for RPC calls.
    runtime: Arc<dyn PluginRuntimeInstance>,
}

impl PluginVcsProxy {
    /// Opens a repository through a previously started plugin module runtime.
    ///
    /// # Parameters
    /// - `backend_id`: Backend id exposed by the plugin.
    /// - `runtime`: Persistent plugin runtime instance.
    /// - `repo_path`: Repository working-tree path to open.
    /// - `cfg`: Serialized config payload forwarded to the plugin.
    ///
    /// # Returns
    /// - `Ok(Arc<dyn Vcs>)` when the plugin backend is opened successfully.
    /// - `Err(VcsError)` when startup or open RPC fails.
    pub fn open_with_process(
        backend_id: BackendId,
        runtime: Arc<dyn PluginRuntimeInstance>,
        repo_path: &Path,
        cfg: serde_json::Value,
    ) -> Result<Arc<dyn Vcs>, VcsError> {
        let _timer = LogTimer::new(MODULE, "open_with_process");
        let path_str = repo_path.to_string_lossy();
        info!(
            "open_with_process: backend={}, path={}", backend_id, path_str
        );
        debug!(
            "open_with_process: config keys={:?}",
            cfg.as_object().map(|o| o.keys().collect::<Vec<_>>())
        );

        let workdir = repo_path.to_path_buf();
        let p = PluginVcsProxy {
            backend_id: backend_id.clone(),
            workdir: workdir.clone(),
            runtime,
        };

        trace!(
            "open_with_process: ensuring runtime is running",
        );
        p.runtime.ensure_running().map_err(|e| {
            error!(
                "open_with_process: failed to ensure runtime running: {}", e
            );
            VcsError::Backend {
                backend: p.backend_id.clone(),
                msg: e,
            }
        })?;
        debug!("open_with_process: runtime confirmed running");

        let params = json!({ "path": path_to_utf8(repo_path)?, "config": cfg });
        trace!("open_with_process: calling open RPC");
        p.call_unit("open", params.clone()).map_err(|e| {
            error!("open_with_process: open RPC failed: {}", e);
            e
        })?;

        info!(
            "open_with_process: opened backend {} for {}", backend_id, path_str
        );
        Ok(Arc::new(p))
    }

    /// Calls a plugin RPC method and maps transport errors to [`VcsError`].
    ///
    /// # Parameters
    /// - `method`: RPC method name.
    /// - `params`: JSON method parameters.
    ///
    /// # Returns
    /// - `Ok(Value)` RPC result payload.
    /// - `Err(VcsError)` on RPC failure.
    fn call_value(&self, method: &str, params: Value) -> Result<Value, VcsError> {
        trace!(
            "call_value: method={}, params_len={}",
            method,
            params.to_string().len()
        );
        let result = self.runtime.call(method, params).map_err(|e| {
            error!(
                "call_value: RPC call '{}' failed: {}", method, e
            );
            VcsError::Backend {
                backend: self.backend_id.clone(),
                msg: e,
            }
        });
        if let Ok(ref v) = result {
            trace!(
                "call_value: method={} returned {} bytes",
                method,
                v.to_string().len()
            );
        }
        result
    }

    /// Calls a plugin RPC method and deserializes its JSON result.
    ///
    /// # Parameters
    /// - `method`: RPC method name.
    /// - `params`: JSON method parameters.
    ///
    /// # Returns
    /// - `Ok(T)` deserialized result.
    /// - `Err(VcsError)` on RPC or decode failure.
    fn call_json<T: DeserializeOwned>(&self, method: &str, params: Value) -> Result<T, VcsError> {
        trace!("call_json: method={}", method);
        let v = self.call_value(method, params)?;
        serde_json::from_value(v).map_err(|e| {
            error!(
                "call_json: failed to deserialize response for '{}': {}", method, e
            );
            VcsError::Backend {
                backend: self.backend_id.clone(),
                msg: format!("invalid plugin response for {method}: {e}"),
            }
        })
    }

    /// Calls a plugin RPC method that returns no meaningful value.
    ///
    /// # Parameters
    /// - `method`: RPC method name.
    /// - `params`: JSON method parameters.
    ///
    /// # Returns
    /// - `Ok(())` on success.
    /// - `Err(VcsError)` on RPC failure.
    fn call_unit(&self, method: &str, params: Value) -> Result<(), VcsError> {
        trace!("call_unit: method={}", method);
        let _ = self.call_value(method, params)?;
        Ok(())
    }

    /// Runs an operation while temporarily installing an event callback sink.
    ///
    /// # Parameters
    /// - `on`: Optional event callback.
    /// - `f`: Operation to execute while the callback is installed.
    ///
    /// # Returns
    /// - `Ok(R)` operation result.
    /// - `Err(VcsError)` operation error.
    fn with_events<F, R>(&self, on: Option<OnEvent>, f: F) -> Result<R, VcsError>
    where
        F: FnOnce() -> Result<R, VcsError>,
    {
        if on.is_some() {
            debug!("with_events: installing event callback");
        }
        let sink: Option<Arc<dyn Fn(VcsEvent) + Send + Sync + 'static>> =
            on.map(|cb| Arc::new(move |evt| cb(evt)) as _);
        self.runtime.set_event_sink(sink);
        let res = f();
        self.runtime.set_event_sink(None);
        if res.is_err() {
            warn!("with_events: operation failed");
        }
        res
    }
}

impl Vcs for PluginVcsProxy {
    /// Returns the backend identifier for this proxy.
    ///
    /// # Returns
    /// - Backend id value.
    fn id(&self) -> BackendId {
        trace!("id: returning backend_id={}", self.backend_id);
        self.backend_id.clone()
    }

    /// Returns capability flags reported by the plugin.
    ///
    /// # Returns
    /// - Capability set; defaults on decode failure.
    fn caps(&self) -> Capabilities {
        trace!("caps: querying plugin capabilities");
        let result = self.call_json("caps", Value::Null);
        match result {
            Ok(caps) => {
                debug!("caps: received capabilities from plugin");
                caps
            }
            Err(e) => {
                warn!(
                    "caps: failed to get capabilities, using defaults: {}", e
                );
                Capabilities::default()
            }
        }
    }

    /// Unsupported direct constructor for this proxy.
    ///
    /// # Parameters
    /// - `_path`: Ignored path argument.
    ///
    /// # Returns
    /// - Always `Err(VcsError)`.
    fn open(_path: &Path) -> VcsResult<Self>
    where
        Self: Sized,
    {
        warn!(
            "open: direct constructor not supported, use host runtime",
        );
        Err(VcsError::Backend {
            backend: BackendId::from("plugin"),
            msg: "PluginVcsProxy::open must be constructed via the host runtime".into(),
        })
    }

    /// Unsupported direct clone constructor for this proxy.
    ///
    /// # Parameters
    /// - `_url`: Ignored URL argument.
    /// - `_dest`: Ignored destination argument.
    /// - `_on`: Ignored event callback.
    ///
    /// # Returns
    /// - Always `Err(VcsError)`.
    fn clone(_url: &str, _dest: &Path, _on: Option<OnEvent>) -> VcsResult<Self>
    where
        Self: Sized,
    {
        warn!(
            "clone: direct constructor not supported, use host runtime",
        );
        Err(VcsError::Backend {
            backend: BackendId::from("plugin"),
            msg: "PluginVcsProxy::clone must be constructed via the host runtime".into(),
        })
    }

    /// Returns repository workdir associated with this proxy.
    ///
    /// # Returns
    /// - Workdir path reference.
    fn workdir(&self) -> &Path {
        trace!("workdir: returning {}", self.workdir.display());
        &self.workdir
    }

    /// Returns current local branch if attached.
    ///
    /// # Returns
    /// - `Ok(Some(String))` branch name.
    /// - `Ok(None)` on detached HEAD.
    /// - `Err(VcsError)` on backend failure.
    fn current_branch(&self) -> VcsResult<Option<String>> {
        let _timer = LogTimer::new(MODULE, "current_branch");
        trace!("current_branch: querying current branch");
        let result = self.call_json("current_branch", Value::Null);
        match &result {
            Ok(Some(branch)) => {
                debug!("current_branch: on branch '{}'", branch);
            }
            Ok(None) => {
                debug!("current_branch: detached HEAD");
            }
            Err(e) => {
                error!("current_branch: failed: {}", e);
            }
        }
        result
    }

    /// Returns local/remote branch records.
    ///
    /// # Returns
    /// - `Ok(Vec<BranchItem>)` branch list.
    /// - `Err(VcsError)` on backend failure.
    fn branches(&self) -> VcsResult<Vec<openvcs_core::models::BranchItem>> {
        let _timer = LogTimer::new(MODULE, "branches");
        trace!("branches: querying all branches");
        let result: VcsResult<Vec<openvcs_core::models::BranchItem>> =
            self.call_json("branches", Value::Null);
        match &result {
            Ok(branches) => {
                debug!("branches: found {} branches", branches.len());
            }
            Err(e) => {
                error!("branches: failed: {}", e);
            }
        }
        result
    }

    /// Returns local branch names.
    ///
    /// # Returns
    /// - `Ok(Vec<String>)` local branch names.
    /// - `Err(VcsError)` on backend failure.
    fn local_branches(&self) -> VcsResult<Vec<String>> {
        let _timer = LogTimer::new(MODULE, "local_branches");
        trace!("local_branches: querying local branches");
        let result: VcsResult<Vec<String>> = self.call_json("local_branches", Value::Null);
        match &result {
            Ok(branches) => {
                debug!(
                    "local_branches: found {} local branches",
                    branches.len()
                );
            }
            Err(e) => {
                error!("local_branches: failed: {}", e);
            }
        }
        result
    }

    /// Creates a branch and optionally checks it out.
    ///
    /// # Parameters
    /// - `name`: Branch name.
    /// - `checkout`: Whether to checkout the new branch.
    ///
    /// # Returns
    /// - `Ok(())` on success.
    /// - `Err(VcsError)` on backend failure.
    fn create_branch(&self, name: &str, checkout: bool) -> VcsResult<()> {
        let _timer = LogTimer::new(MODULE, "create_branch");
        info!(
            "create_branch: name={}, checkout={}", name, checkout
        );
        let result = self.call_unit(
            "create_branch",
            json!({ "name": name, "checkout": checkout }),
        );
        match &result {
            Ok(()) => {
                debug!("create_branch: branch '{}' created", name);
            }
            Err(e) => {
                error!(
                    "create_branch: failed to create '{}': {}", name, e
                );
            }
        }
        result
    }

    /// Checks out an existing branch.
    ///
    /// # Parameters
    /// - `name`: Branch name.
    ///
    /// # Returns
    /// - `Ok(())` on success.
    /// - `Err(VcsError)` on backend failure.
    fn checkout_branch(&self, name: &str) -> VcsResult<()> {
        let _timer = LogTimer::new(MODULE, "checkout_branch");
        info!("checkout_branch: name={}", name);
        let result = self.call_unit("checkout_branch", json!({ "name": name }));
        match &result {
            Ok(()) => {
                debug!("checkout_branch: switched to '{}'", name);
            }
            Err(e) => {
                error!(
                    "checkout_branch: failed to switch to '{}': {}", name, e
                );
            }
        }
        result
    }

    /// Creates or updates a remote URL.
    ///
    /// # Parameters
    /// - `name`: Remote name.
    /// - `url`: Remote URL.
    ///
    /// # Returns
    /// - `Ok(())` on success.
    /// - `Err(VcsError)` on backend failure.
    fn ensure_remote(&self, name: &str, url: &str) -> VcsResult<()> {
        let _timer = LogTimer::new(MODULE, "ensure_remote");
        info!("ensure_remote: name={}, url={}", name, url);
        let result = self.call_unit("ensure_remote", json!({ "name": name, "url": url }));
        match &result {
            Ok(()) => {
                debug!("ensure_remote: remote '{}' configured", name);
            }
            Err(e) => {
                error!("ensure_remote: failed for '{}': {}", name, e);
            }
        }
        result
    }

    /// Lists configured remotes.
    ///
    /// # Returns
    /// - `Ok(Vec<(String, String)>)` name/url pairs.
    /// - `Err(VcsError)` on backend failure.
    fn list_remotes(&self) -> VcsResult<Vec<(String, String)>> {
        let _timer = LogTimer::new(MODULE, "list_remotes");
        trace!("list_remotes: querying remotes");
        let result: VcsResult<Vec<(String, String)>> = self.call_json("list_remotes", Value::Null);
        match &result {
            Ok(remotes) => {
                debug!("list_remotes: found {} remotes", remotes.len());
                for (name, url) in remotes {
                    trace!("list_remotes: remote '{}' -> '{}'", name, url);
                }
            }
            Err(e) => {
                error!("list_remotes: failed: {}", e);
            }
        }
        result
    }

    /// Removes a configured remote.
    ///
    /// # Parameters
    /// - `name`: Remote name.
    ///
    /// # Returns
    /// - `Ok(())` on success.
    /// - `Err(VcsError)` on backend failure.
    fn remove_remote(&self, name: &str) -> VcsResult<()> {
        let _timer = LogTimer::new(MODULE, "remove_remote");
        info!("remove_remote: name={}", name);
        let result = self.call_unit("remove_remote", json!({ "name": name }));
        match &result {
            Ok(()) => {
                debug!("remove_remote: remote '{}' removed", name);
            }
            Err(e) => {
                error!(
                    "remove_remote: failed to remove '{}': {}", name, e
                );
            }
        }
        result
    }

    /// Fetches a refspec from a remote.
    ///
    /// # Parameters
    /// - `remote`: Remote name.
    /// - `refspec`: Refspec expression.
    /// - `on`: Optional progress callback.
    ///
    /// # Returns
    /// - `Ok(())` on success.
    /// - `Err(VcsError)` on backend failure.
    fn fetch(&self, remote: &str, refspec: &str, on: Option<OnEvent>) -> VcsResult<()> {
        let _timer = LogTimer::new(MODULE, "fetch");
        info!("fetch: remote={}, refspec={}", remote, refspec);
        let result = self.with_events(on, || {
            self.call_unit("fetch", json!({ "remote": remote, "refspec": refspec }))
        });
        match &result {
            Ok(()) => {
                debug!("fetch: completed successfully");
            }
            Err(e) => {
                error!("fetch: failed: {}", e);
            }
        }
        result
    }

    /// Fetches using explicit options payload.
    ///
    /// # Parameters
    /// - `remote`: Remote name.
    /// - `refspec`: Refspec expression.
    /// - `opts`: Fetch option flags.
    /// - `on`: Optional progress callback.
    ///
    /// # Returns
    /// - `Ok(())` on success.
    /// - `Err(VcsError)` on backend failure.
    fn fetch_with_options(
        &self,
        remote: &str,
        refspec: &str,
        opts: FetchOptions,
        on: Option<OnEvent>,
    ) -> VcsResult<()> {
        let _timer = LogTimer::new(MODULE, "fetch_with_options");
        info!(
            "fetch_with_options: remote={}, refspec={}, opts={:?}", remote, refspec, opts
        );
        let result = self.with_events(on, || {
            self.call_unit(
                "fetch_with_options",
                json!({ "remote": remote, "refspec": refspec, "opts": opts }),
            )
        });
        match &result {
            Ok(()) => {
                debug!("fetch_with_options: completed successfully");
            }
            Err(e) => {
                error!("fetch_with_options: failed: {}", e);
            }
        }
        result
    }

    /// Pushes a refspec to a remote.
    ///
    /// # Parameters
    /// - `remote`: Remote name.
    /// - `refspec`: Refspec expression.
    /// - `on`: Optional progress callback.
    ///
    /// # Returns
    /// - `Ok(())` on success.
    /// - `Err(VcsError)` on backend failure.
    fn push(&self, remote: &str, refspec: &str, on: Option<OnEvent>) -> VcsResult<()> {
        let _timer = LogTimer::new(MODULE, "push");
        info!("push: remote={}, refspec={}", remote, refspec);
        let result = self.with_events(on, || {
            self.call_unit("push", json!({ "remote": remote, "refspec": refspec }))
        });
        match &result {
            Ok(()) => {
                debug!("push: completed successfully");
            }
            Err(e) => {
                error!("push: failed: {}", e);
            }
        }
        result
    }

    /// Pulls from upstream using fast-forward-only strategy.
    ///
    /// # Parameters
    /// - `remote`: Remote name.
    /// - `branch`: Branch name.
    /// - `on`: Optional progress callback.
    ///
    /// # Returns
    /// - `Ok(())` on success.
    /// - `Err(VcsError)` on backend failure.
    fn pull_ff_only(&self, remote: &str, branch: &str, on: Option<OnEvent>) -> VcsResult<()> {
        let _timer = LogTimer::new(MODULE, "pull_ff_only");
        info!(
            "pull_ff_only: remote={}, branch={}", remote, branch
        );
        let result = self.with_events(on, || {
            self.call_unit(
                "pull_ff_only",
                json!({ "remote": remote, "branch": branch }),
            )
        });
        match &result {
            Ok(()) => {
                debug!("pull_ff_only: completed successfully");
            }
            Err(e) => {
                error!("pull_ff_only: failed: {}", e);
            }
        }
        result
    }

    /// Creates a commit from selected paths.
    ///
    /// # Parameters
    /// - `message`: Commit message.
    /// - `name`: Author name.
    /// - `email`: Author email.
    /// - `paths`: Paths to include.
    ///
    /// # Returns
    /// - `Ok(String)` created commit id.
    /// - `Err(VcsError)` on backend failure.
    fn commit(
        &self,
        message: &str,
        name: &str,
        email: &str,
        paths: &[PathBuf],
    ) -> VcsResult<String> {
        let _timer = LogTimer::new(MODULE, "commit");
        let paths: Vec<String> = paths
            .iter()
            .map(|p| p.to_string_lossy().to_string())
            .collect();
        info!(
            "commit: author={} <{}>, paths={}, message_len={}",
            name,
            email,
            paths.len(),
            message.len()
        );
        debug!(
            "commit: message='{}'",
            message.lines().next().unwrap_or("")
        );
        trace!("commit: paths={:?}", paths);
        let result = self.call_json(
            "commit",
            json!({ "message": message, "name": name, "email": email, "paths": paths }),
        );
        match &result {
            Ok(commit_id) => {
                debug!("commit: created commit {}", commit_id);
            }
            Err(e) => {
                error!("commit: failed: {}", e);
            }
        }
        result
    }

    /// Creates a commit from the index.
    ///
    /// # Parameters
    /// - `message`: Commit message.
    /// - `name`: Author name.
    /// - `email`: Author email.
    ///
    /// # Returns
    /// - `Ok(String)` commit id.
    /// - `Err(VcsError)` on backend failure.
    fn commit_index(&self, message: &str, name: &str, email: &str) -> VcsResult<String> {
        let _timer = LogTimer::new(MODULE, "commit_index");
        info!(
            "commit_index: author={} <{}>, message_len={}",
            name,
            email,
            message.len()
        );
        debug!(
            "commit_index: message='{}'",
            message.lines().next().unwrap_or("")
        );
        let result = self.call_json(
            "commit_index",
            json!({ "message": message, "name": name, "email": email }),
        );
        match &result {
            Ok(commit_id) => {
                debug!("commit_index: created commit {}", commit_id);
            }
            Err(e) => {
                error!("commit_index: failed: {}", e);
            }
        }
        result
    }

    /// Returns summarized status information.
    ///
    /// # Returns
    /// - `Ok(StatusSummary)` summary payload.
    /// - `Err(VcsError)` on backend failure.
    fn status_summary(&self) -> VcsResult<StatusSummary> {
        let _timer = LogTimer::new(MODULE, "status_summary");
        trace!("status_summary: querying status summary");
        let result: VcsResult<StatusSummary> = self.call_json("status_summary", Value::Null);
        match &result {
            Ok(summary) => {
                debug!(
                    "status_summary: {} staged, {} modified, {} untracked, {} conflicted", summary.staged, summary.modified, summary.untracked, summary.conflicted
                );
            }
            Err(e) => {
                error!("status_summary: failed: {}", e);
            }
        }
        result
    }

    /// Returns full status payload.
    ///
    /// # Returns
    /// - `Ok(StatusPayload)` status payload.
    /// - `Err(VcsError)` on backend failure.
    fn status_payload(&self) -> VcsResult<StatusPayload> {
        let _timer = LogTimer::new(MODULE, "status_payload");
        trace!("status_payload: querying full status");
        let result: VcsResult<StatusPayload> = self.call_json("status_payload", Value::Null);
        match &result {
            Ok(payload) => {
                debug!(
                    "status_payload: {} files, {} ahead, {} behind",
                    payload.files.len(),
                    payload.ahead,
                    payload.behind
                );
            }
            Err(e) => {
                error!("status_payload: failed: {}", e);
            }
        }
        result
    }

    /// Returns commit log entries for a query.
    ///
    /// # Parameters
    /// - `query`: Log query payload.
    ///
    /// # Returns
    /// - `Ok(Vec<CommitItem>)` commit entries.
    /// - `Err(VcsError)` on backend failure.
    fn log_commits(&self, query: &LogQuery) -> VcsResult<Vec<openvcs_core::models::CommitItem>> {
        let _timer = LogTimer::new(MODULE, "log_commits");
        trace!(
            "log_commits: querying commits (limit={:?}, skip={:?})",
            query.limit,
            query.skip
        );
        let result: VcsResult<Vec<openvcs_core::models::CommitItem>> =
            self.call_json("log_commits", json!({ "query": query }));
        match &result {
            Ok(commits) => {
                debug!(
                    "log_commits: {} commits returned",
                    commits.len()
                );
            }
            Err(e) => {
                error!("log_commits: failed: {}", e);
            }
        }
        result
    }

    /// Returns diff lines for a file path.
    ///
    /// # Parameters
    /// - `path`: Repository-relative path.
    ///
    /// # Returns
    /// - `Ok(Vec<String>)` diff lines.
    /// - `Err(VcsError)` on backend failure.
    fn diff_file(&self, path: &Path) -> VcsResult<Vec<String>> {
        let _timer = LogTimer::new(MODULE, "diff_file");
        let path_str = path_to_utf8(path)?;
        trace!("diff_file: path={}", path_str);
        let result: VcsResult<Vec<String>> =
            self.call_json("diff_file", json!({ "path": path_str.clone() }));
        match &result {
            Ok(lines) => {
                debug!(
                    "diff_file: {} lines for {}",
                    lines.len(),
                    path_str
                );
            }
            Err(e) => {
                error!("diff_file: failed for '{}': {}", path_str, e);
            }
        }
        result
    }

    /// Returns diff lines for a commit/revision.
    ///
    /// # Parameters
    /// - `rev`: Revision selector.
    ///
    /// # Returns
    /// - `Ok(Vec<String>)` diff lines.
    /// - `Err(VcsError)` on backend failure.
    fn diff_commit(&self, rev: &str) -> VcsResult<Vec<String>> {
        let _timer = LogTimer::new(MODULE, "diff_commit");
        trace!("diff_commit: rev={}", rev);
        let result: VcsResult<Vec<String>> = self.call_json("diff_commit", json!({ "rev": rev }));
        match &result {
            Ok(lines) => {
                debug!(
                    "diff_commit: {} lines for {}",
                    lines.len(),
                    rev
                );
            }
            Err(e) => {
                error!("diff_commit: failed for '{}': {}", rev, e);
            }
        }
        result
    }

    /// Returns merge-conflict details for a file.
    ///
    /// # Parameters
    /// - `path`: Conflict file path.
    ///
    /// # Returns
    /// - `Ok(ConflictDetails)` conflict payload.
    /// - `Err(VcsError)` on backend failure.
    fn conflict_details(&self, path: &Path) -> VcsResult<ConflictDetails> {
        let _timer = LogTimer::new(MODULE, "conflict_details");
        let path_str = path_to_utf8(path)?;
        info!("conflict_details: path={}", path_str);
        let result: VcsResult<ConflictDetails> =
            self.call_json("conflict_details", json!({ "path": path_str.clone() }));
        match &result {
            Ok(details) => {
                debug!(
                    "conflict_details: got details for {} (binary={})", path_str, details.binary
                );
            }
            Err(e) => {
                error!(
                    "conflict_details: failed for '{}': {}", path_str, e
                );
            }
        }
        result
    }

    /// Checks out a specific conflict side for a file.
    ///
    /// # Parameters
    /// - `path`: Conflict file path.
    /// - `side`: Conflict side selector.
    ///
    /// # Returns
    /// - `Ok(())` on success.
    /// - `Err(VcsError)` on backend failure.
    fn checkout_conflict_side(&self, path: &Path, side: ConflictSide) -> VcsResult<()> {
        let _timer = LogTimer::new(MODULE, "checkout_conflict_side");
        let path_str = path_to_utf8(path)?;
        info!(
            "checkout_conflict_side: path={}, side={:?}", path_str, side
        );
        let result = self.call_unit(
            "checkout_conflict_side",
            json!({ "path": path_str.clone(), "side": side }),
        );
        match &result {
            Ok(()) => {
                debug!(
                    "checkout_conflict_side: resolved {} with {:?}", path_str, side
                );
            }
            Err(e) => {
                error!(
                    "checkout_conflict_side: failed for '{}': {}", path_str, e
                );
            }
        }
        result
    }

    /// Writes merged file content for a conflict path.
    ///
    /// # Parameters
    /// - `path`: Conflict file path.
    /// - `content`: Resolved bytes.
    ///
    /// # Returns
    /// - `Ok(())` on success.
    /// - `Err(VcsError)` on backend failure.
    fn write_merge_result(&self, path: &Path, content: &[u8]) -> VcsResult<()> {
        let _timer = LogTimer::new(MODULE, "write_merge_result");
        let path_str = path_to_utf8(path)?;
        let content_str = String::from_utf8_lossy(content).to_string();
        info!(
            "write_merge_result: path={}, content_len={}",
            path_str,
            content_str.len()
        );
        let result = self.call_unit(
            "write_merge_result",
            json!({ "path": path_str.clone(), "content": content_str }),
        );
        match &result {
            Ok(()) => {
                debug!(
                    "write_merge_result: wrote resolved content to {}", path_str
                );
            }
            Err(e) => {
                error!(
                    "write_merge_result: failed for '{}': {}", path_str, e
                );
            }
        }
        result
    }

    /// Stages a patch in the index.
    ///
    /// # Parameters
    /// - `patch`: Unified patch text.
    ///
    /// # Returns
    /// - `Ok(())` on success.
    /// - `Err(VcsError)` on backend failure.
    fn stage_patch(&self, patch: &str) -> VcsResult<()> {
        let _timer = LogTimer::new(MODULE, "stage_patch");
        info!("stage_patch: patch_len={}", patch.len());
        let result = self.call_unit("stage_patch", json!({ "patch": patch }));
        match &result {
            Ok(()) => {
                debug!("stage_patch: patch staged successfully");
            }
            Err(e) => {
                error!("stage_patch: failed: {}", e);
            }
        }
        result
    }

    /// Discards changes for explicit paths.
    ///
    /// # Parameters
    /// - `paths`: Paths to discard.
    ///
    /// # Returns
    /// - `Ok(())` on success.
    /// - `Err(VcsError)` on backend failure.
    fn discard_paths(&self, paths: &[PathBuf]) -> VcsResult<()> {
        let _timer = LogTimer::new(MODULE, "discard_paths");
        let paths: Vec<String> = paths
            .iter()
            .map(|p| p.to_string_lossy().to_string())
            .collect();
        info!("discard_paths: count={}", paths.len());
        trace!("discard_paths: paths={:?}", paths);
        let result = self.call_unit("discard_paths", json!({ "paths": paths }));
        match &result {
            Ok(()) => {
                debug!("discard_paths: changes discarded");
            }
            Err(e) => {
                error!("discard_paths: failed: {}", e);
            }
        }
        result
    }

    /// Applies a patch in reverse to discard hunks.
    ///
    /// # Parameters
    /// - `patch`: Unified patch text.
    ///
    /// # Returns
    /// - `Ok(())` on success.
    /// - `Err(VcsError)` on backend failure.
    fn apply_reverse_patch(&self, patch: &str) -> VcsResult<()> {
        let _timer = LogTimer::new(MODULE, "apply_reverse_patch");
        info!(
            "apply_reverse_patch: patch_len={}",
            patch.len()
        );
        let result = self.call_unit("apply_reverse_patch", json!({ "patch": patch }));
        match &result {
            Ok(()) => {
                debug!("apply_reverse_patch: patch applied in reverse");
            }
            Err(e) => {
                error!("apply_reverse_patch: failed: {}", e);
            }
        }
        result
    }

    /// Deletes a branch.
    ///
    /// # Parameters
    /// - `name`: Branch name.
    /// - `force`: Force-delete flag.
    ///
    /// # Returns
    /// - `Ok(())` on success.
    /// - `Err(VcsError)` on backend failure.
    fn delete_branch(&self, name: &str, force: bool) -> VcsResult<()> {
        let _timer = LogTimer::new(MODULE, "delete_branch");
        info!("delete_branch: name={}, force={}", name, force);
        let result = self.call_unit("delete_branch", json!({ "name": name, "force": force }));
        match &result {
            Ok(()) => {
                debug!("delete_branch: branch '{}' deleted", name);
            }
            Err(e) => {
                error!(
                    "delete_branch: failed to delete '{}': {}", name, e
                );
            }
        }
        result
    }

    /// Renames a branch.
    ///
    /// # Parameters
    /// - `old`: Existing branch name.
    /// - `new`: New branch name.
    ///
    /// # Returns
    /// - `Ok(())` on success.
    /// - `Err(VcsError)` on backend failure.
    fn rename_branch(&self, old: &str, new: &str) -> VcsResult<()> {
        let _timer = LogTimer::new(MODULE, "rename_branch");
        info!("rename_branch: old='{}' -> new='{}'", old, new);
        let result = self.call_unit("rename_branch", json!({ "old": old, "new": new }));
        match &result {
            Ok(()) => {
                debug!("rename_branch: branch renamed");
            }
            Err(e) => {
                error!("rename_branch: failed: {}", e);
            }
        }
        result
    }

    /// Merges a branch into the current branch.
    ///
    /// # Parameters
    /// - `name`: Source branch name.
    ///
    /// # Returns
    /// - `Ok(())` on success.
    /// - `Err(VcsError)` on backend failure.
    fn merge_into_current(&self, name: &str) -> VcsResult<()> {
        let _timer = LogTimer::new(MODULE, "merge_into_current");
        info!("merge_into_current: source='{}'", name);
        let result = self.call_unit("merge_into_current", json!({ "name": name }));
        match &result {
            Ok(()) => {
                debug!("merge_into_current: merge completed");
            }
            Err(e) => {
                warn!(
                    "merge_into_current: merge may have conflicts: {}", e
                );
            }
        }
        result
    }

    /// Aborts an in-progress merge.
    ///
    /// # Returns
    /// - `Ok(())` on success.
    /// - `Err(VcsError)` on backend failure.
    fn merge_abort(&self) -> VcsResult<()> {
        let _timer = LogTimer::new(MODULE, "merge_abort");
        info!("merge_abort: aborting merge");
        let result = self.call_unit("merge_abort", Value::Null);
        match &result {
            Ok(()) => {
                debug!("merge_abort: merge aborted");
            }
            Err(e) => {
                error!("merge_abort: failed: {}", e);
            }
        }
        result
    }

    /// Continues an in-progress merge.
    ///
    /// # Returns
    /// - `Ok(())` on success.
    /// - `Err(VcsError)` on backend failure.
    fn merge_continue(&self) -> VcsResult<()> {
        let _timer = LogTimer::new(MODULE, "merge_continue");
        info!("merge_continue: continuing merge");
        let result = self.call_unit("merge_continue", Value::Null);
        match &result {
            Ok(()) => {
                debug!("merge_continue: merge continued");
            }
            Err(e) => {
                error!("merge_continue: failed: {}", e);
            }
        }
        result
    }

    /// Returns whether a merge is currently in progress.
    ///
    /// # Returns
    /// - `Ok(bool)` merge state.
    /// - `Err(VcsError)` on backend failure.
    fn merge_in_progress(&self) -> VcsResult<bool> {
        let _timer = LogTimer::new(MODULE, "merge_in_progress");
        trace!("merge_in_progress: checking merge state");
        let result = self.call_json("merge_in_progress", Value::Null);
        match &result {
            Ok(true) => {
                debug!("merge_in_progress: merge is in progress");
            }
            Ok(false) => {
                debug!("merge_in_progress: no merge in progress");
            }
            Err(e) => {
                error!("merge_in_progress: failed: {}", e);
            }
        }
        result
    }

    /// Sets upstream tracking branch for a local branch.
    ///
    /// # Parameters
    /// - `branch`: Local branch name.
    /// - `upstream`: Upstream ref name.
    ///
    /// # Returns
    /// - `Ok(())` on success.
    /// - `Err(VcsError)` on backend failure.
    fn set_branch_upstream(&self, branch: &str, upstream: &str) -> VcsResult<()> {
        let _timer = LogTimer::new(MODULE, "set_branch_upstream");
        info!(
            "set_branch_upstream: branch='{}' -> upstream='{}'", branch, upstream
        );
        let result = self.call_unit(
            "set_branch_upstream",
            json!({ "branch": branch, "upstream": upstream }),
        );
        match &result {
            Ok(()) => {
                debug!("set_branch_upstream: upstream set");
            }
            Err(e) => {
                error!("set_branch_upstream: failed: {}", e);
            }
        }
        result
    }

    /// Returns upstream ref for a local branch.
    ///
    /// # Parameters
    /// - `branch`: Local branch name.
    ///
    /// # Returns
    /// - `Ok(Some(String))` upstream ref.
    /// - `Ok(None)` when unset.
    /// - `Err(VcsError)` on backend failure.
    fn branch_upstream(&self, branch: &str) -> VcsResult<Option<String>> {
        let _timer = LogTimer::new(MODULE, "branch_upstream");
        trace!("branch_upstream: branch='{}'", branch);
        let result = self.call_json("branch_upstream", json!({ "branch": branch }));
        match &result {
            Ok(Some(upstream)) => {
                debug!(
                    "branch_upstream: '{}' tracks '{}'", branch, upstream
                );
            }
            Ok(None) => {
                debug!("branch_upstream: '{}' has no upstream", branch);
            }
            Err(e) => {
                error!("branch_upstream: failed: {}", e);
            }
        }
        result
    }

    /// Performs a hard reset of HEAD/worktree.
    ///
    /// # Returns
    /// - `Ok(())` on success.
    /// - `Err(VcsError)` on backend failure.
    fn hard_reset_head(&self) -> VcsResult<()> {
        let _timer = LogTimer::new(MODULE, "hard_reset_head");
        warn!("hard_reset_head: performing hard reset");
        let result = self.call_unit("hard_reset_head", Value::Null);
        match &result {
            Ok(()) => {
                debug!("hard_reset_head: reset completed");
            }
            Err(e) => {
                error!("hard_reset_head: failed: {}", e);
            }
        }
        result
    }

    /// Performs a soft reset to a revision.
    ///
    /// # Parameters
    /// - `rev`: Target revision.
    ///
    /// # Returns
    /// - `Ok(())` on success.
    /// - `Err(VcsError)` on backend failure.
    fn reset_soft_to(&self, rev: &str) -> VcsResult<()> {
        let _timer = LogTimer::new(MODULE, "reset_soft_to");
        info!("reset_soft_to: rev={}", rev);
        let result = self.call_unit("reset_soft_to", json!({ "rev": rev }));
        match &result {
            Ok(()) => {
                debug!("reset_soft_to: reset to '{}'", rev);
            }
            Err(e) => {
                error!("reset_soft_to: failed: {}", e);
            }
        }
        result
    }

    /// Returns configured repository identity if available.
    ///
    /// # Returns
    /// - `Ok(Some((String, String)))` name/email pair.
    /// - `Ok(None)` when unset.
    /// - `Err(VcsError)` on backend failure.
    fn get_identity(&self) -> VcsResult<Option<(String, String)>> {
        let _timer = LogTimer::new(MODULE, "get_identity");
        trace!("get_identity: querying repository identity");
        let result = self.call_json("get_identity", Value::Null);
        match &result {
            Ok(Some((name, email))) => {
                debug!("get_identity: {} <{}>", name, email);
            }
            Ok(None) => {
                debug!("get_identity: no identity configured");
            }
            Err(e) => {
                error!("get_identity: failed: {}", e);
            }
        }
        result
    }

    /// Sets repository-local identity.
    ///
    /// # Parameters
    /// - `name`: Author name.
    /// - `email`: Author email.
    ///
    /// # Returns
    /// - `Ok(())` on success.
    /// - `Err(VcsError)` on backend failure.
    fn set_identity_local(&self, name: &str, email: &str) -> VcsResult<()> {
        let _timer = LogTimer::new(MODULE, "set_identity_local");
        info!("set_identity_local: {} <{}>", name, email);
        let result = self.call_unit(
            "set_identity_local",
            json!({ "name": name, "email": email }),
        );
        match &result {
            Ok(()) => {
                debug!("set_identity_local: identity set");
            }
            Err(e) => {
                error!("set_identity_local: failed: {}", e);
            }
        }
        result
    }

    /// Returns stash entries.
    ///
    /// # Returns
    /// - `Ok(Vec<StashItem>)` stash list.
    /// - `Err(VcsError)` on backend failure.
    fn stash_list(&self) -> VcsResult<Vec<StashItem>> {
        let _timer = LogTimer::new(MODULE, "stash_list");
        trace!("stash_list: querying stash entries");
        let result: VcsResult<Vec<StashItem>> = self.call_json("stash_list", Value::Null);
        match &result {
            Ok(stashes) => {
                debug!("stash_list: {} stash entries", stashes.len());
            }
            Err(e) => {
                error!("stash_list: failed: {}", e);
            }
        }
        result
    }

    /// Creates a stash entry.
    ///
    /// # Parameters
    /// - `message`: Stash message.
    /// - `include_untracked`: Whether to include untracked files.
    /// - `paths`: Optional path subset.
    ///
    /// # Returns
    /// - `Ok(())` on success.
    /// - `Err(VcsError)` on backend failure.
    fn stash_push(
        &self,
        message: &str,
        include_untracked: bool,
        paths: &[PathBuf],
    ) -> VcsResult<()> {
        let _timer = LogTimer::new(MODULE, "stash_push");
        let paths: Vec<String> = paths
            .iter()
            .map(|p| p.to_string_lossy().to_string())
            .collect();
        info!(
            "stash_push: message='{}', include_untracked={}, paths={}",
            message.lines().next().unwrap_or(""),
            include_untracked,
            paths.len()
        );
        let result = self.call_unit(
            "stash_push",
            json!({ "message": message, "include_untracked": include_untracked, "paths": paths }),
        );
        match &result {
            Ok(()) => {
                debug!("stash_push: stash created");
            }
            Err(e) => {
                error!("stash_push: failed: {}", e);
            }
        }
        result
    }

    /// Applies a stash entry.
    ///
    /// # Parameters
    /// - `selector`: Stash selector.
    ///
    /// # Returns
    /// - `Ok(())` on success.
    /// - `Err(VcsError)` on backend failure.
    fn stash_apply(&self, selector: &str) -> VcsResult<()> {
        let _timer = LogTimer::new(MODULE, "stash_apply");
        info!("stash_apply: selector={}", selector);
        let result = self.call_unit("stash_apply", json!({ "selector": selector }));
        match &result {
            Ok(()) => {
                debug!("stash_apply: stash applied");
            }
            Err(e) => {
                error!("stash_apply: failed: {}", e);
            }
        }
        result
    }

    /// Pops a stash entry.
    ///
    /// # Parameters
    /// - `selector`: Stash selector.
    ///
    /// # Returns
    /// - `Ok(())` on success.
    /// - `Err(VcsError)` on backend failure.
    fn stash_pop(&self, selector: &str) -> VcsResult<()> {
        let _timer = LogTimer::new(MODULE, "stash_pop");
        info!("stash_pop: selector={}", selector);
        let result = self.call_unit("stash_pop", json!({ "selector": selector }));
        match &result {
            Ok(()) => {
                debug!("stash_pop: stash popped");
            }
            Err(e) => {
                error!("stash_pop: failed: {}", e);
            }
        }
        result
    }

    /// Drops a stash entry.
    ///
    /// # Parameters
    /// - `selector`: Stash selector.
    ///
    /// # Returns
    /// - `Ok(())` on success.
    /// - `Err(VcsError)` on backend failure.
    fn stash_drop(&self, selector: &str) -> VcsResult<()> {
        let _timer = LogTimer::new(MODULE, "stash_drop");
        info!("stash_drop: selector={}", selector);
        let result = self.call_unit("stash_drop", json!({ "selector": selector }));
        match &result {
            Ok(()) => {
                debug!("stash_drop: stash dropped");
            }
            Err(e) => {
                error!("stash_drop: failed: {}", e);
            }
        }
        result
    }

    /// Returns patch lines for a stash entry.
    ///
    /// # Parameters
    /// - `selector`: Stash selector.
    ///
    /// # Returns
    /// - `Ok(Vec<String>)` stash diff lines.
    /// - `Err(VcsError)` on backend failure.
    fn stash_show(&self, selector: &str) -> VcsResult<Vec<String>> {
        let _timer = LogTimer::new(MODULE, "stash_show");
        trace!("stash_show: selector={}", selector);
        let result: VcsResult<Vec<String>> =
            self.call_json("stash_show", json!({ "selector": selector }));
        match &result {
            Ok(lines) => {
                debug!(
                    "stash_show: {} lines for {}",
                    lines.len(),
                    selector
                );
            }
            Err(e) => {
                error!("stash_show: failed: {}", e);
            }
        }
        result
    }
}

/// Converts a filesystem path to UTF-8 text for JSON RPC transport.
///
/// # Parameters
/// - `path`: Filesystem path.
///
/// # Returns
/// - `Ok(String)` UTF-8 path.
/// - `Err(VcsError)` when path is non-UTF8.
fn path_to_utf8(path: &Path) -> Result<String, VcsError> {
    path.to_str().map(|s| s.to_string()).ok_or_else(|| {
        warn!(
            "path_to_utf8: non-UTF8 path: {}",
            path.display()
        );
        VcsError::Backend {
            backend: BackendId::from("plugin"),
            msg: "non-utf8 path".into(),
        }
    })
}
