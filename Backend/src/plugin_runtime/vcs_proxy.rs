use crate::plugin_bundles::ApprovalState;
use crate::plugin_runtime::stdio_rpc::{RpcConfig, RpcError, SpawnConfig, StdioRpcProcess};
use crate::settings::AppConfig;
use openvcs_core::models::{
    Capabilities, ConflictDetails, ConflictSide, FetchOptions, LogQuery, StashItem, StatusPayload,
    StatusSummary, VcsEvent,
};
use openvcs_core::{BackendId, OnEvent, Result as VcsResult, Vcs, VcsError};
use serde::de::DeserializeOwned;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::sync::Arc;

pub struct PluginVcsProxy {
    backend_id: BackendId,
    workdir: PathBuf,
    rpc: StdioRpcProcess,
}

impl PluginVcsProxy {
    /// Opens a repository through a plugin module process and returns a VCS trait object.
    ///
    /// # Parameters
    /// - `plugin_id`: Owning plugin identifier.
    /// - `backend_id`: Backend id exposed by the plugin.
    /// - `exec_path`: Path to the plugin wasm/module executable.
    /// - `approval`: Capability approval state for the plugin version.
    /// - `requested_capabilities`: Capabilities requested by the plugin.
    /// - `repo_path`: Repository working-tree path to open.
    ///
    /// # Returns
    /// - `Ok(Arc<dyn Vcs>)` when the plugin backend is opened successfully.
    /// - `Err(VcsError)` when startup or open RPC fails.
    pub fn open_with_process(
        plugin_id: String,
        backend_id: BackendId,
        exec_path: PathBuf,
        approval: ApprovalState,
        requested_capabilities: Vec<String>,
        repo_path: &Path,
    ) -> Result<Arc<dyn Vcs>, VcsError> {
        let workdir = repo_path.to_path_buf();
        let cfg = AppConfig::load_or_default();
        let cfg = serde_json::to_value(cfg).map_err(|e| VcsError::Backend {
            backend: backend_id.clone(),
            msg: format!("serialize config: {e}"),
        })?;
        let spawn = SpawnConfig {
            plugin_id,
            component_label: format!("vcs-backend-{}", backend_id.as_ref()),
            exec_path,
            args: vec!["--backend".into(), backend_id.as_ref().to_string()],
            requested_capabilities,
            approval,
            allowed_workspace_root: Some(workdir.clone()),
        };
        let rpc = StdioRpcProcess::new(spawn, RpcConfig::default());
        let p = PluginVcsProxy {
            backend_id,
            workdir,
            rpc,
        };
        p.rpc
            .call(
                "open",
                json!({ "path": path_to_utf8(repo_path)?, "config": cfg }),
            )
            .map_err(map_rpc_err)?;
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
        self.rpc.call(method, params).map_err(map_rpc_err)
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
        let v = self.call_value(method, params)?;
        serde_json::from_value(v).map_err(|e| VcsError::Backend {
            backend: self.backend_id.clone(),
            msg: format!("invalid plugin response for {method}: {e}"),
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
        let sink: Option<Arc<dyn Fn(VcsEvent) + Send + Sync + 'static>> =
            on.map(|cb| Arc::new(move |evt| cb(evt)) as _);
        self.rpc.set_event_sink(sink);
        let res = f();
        self.rpc.set_event_sink(None);
        res
    }
}

impl Vcs for PluginVcsProxy {
    /// Returns the backend identifier for this proxy.
    ///
    /// # Returns
    /// - Backend id value.
    fn id(&self) -> BackendId {
        self.backend_id.clone()
    }

    /// Returns capability flags reported by the plugin.
    ///
    /// # Returns
    /// - Capability set; defaults on decode failure.
    fn caps(&self) -> Capabilities {
        self.call_json("caps", Value::Null).unwrap_or_default()
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
        &self.workdir
    }

    /// Returns current local branch if attached.
    ///
    /// # Returns
    /// - `Ok(Some(String))` branch name.
    /// - `Ok(None)` on detached HEAD.
    /// - `Err(VcsError)` on backend failure.
    fn current_branch(&self) -> VcsResult<Option<String>> {
        self.call_json("current_branch", Value::Null)
    }

    /// Returns local/remote branch records.
    ///
    /// # Returns
    /// - `Ok(Vec<BranchItem>)` branch list.
    /// - `Err(VcsError)` on backend failure.
    fn branches(&self) -> VcsResult<Vec<openvcs_core::models::BranchItem>> {
        self.call_json("branches", Value::Null)
    }

    /// Returns local branch names.
    ///
    /// # Returns
    /// - `Ok(Vec<String>)` local branch names.
    /// - `Err(VcsError)` on backend failure.
    fn local_branches(&self) -> VcsResult<Vec<String>> {
        self.call_json("local_branches", Value::Null)
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
        self.call_unit(
            "create_branch",
            json!({ "name": name, "checkout": checkout }),
        )
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
        self.call_unit("checkout_branch", json!({ "name": name }))
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
        self.call_unit("ensure_remote", json!({ "name": name, "url": url }))
    }

    /// Lists configured remotes.
    ///
    /// # Returns
    /// - `Ok(Vec<(String, String)>)` name/url pairs.
    /// - `Err(VcsError)` on backend failure.
    fn list_remotes(&self) -> VcsResult<Vec<(String, String)>> {
        self.call_json("list_remotes", Value::Null)
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
        self.call_unit("remove_remote", json!({ "name": name }))
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
        self.with_events(on, || {
            self.call_unit("fetch", json!({ "remote": remote, "refspec": refspec }))
        })
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
        self.with_events(on, || {
            self.call_unit(
                "fetch_with_options",
                json!({ "remote": remote, "refspec": refspec, "opts": opts }),
            )
        })
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
        self.with_events(on, || {
            self.call_unit("push", json!({ "remote": remote, "refspec": refspec }))
        })
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
        self.with_events(on, || {
            self.call_unit(
                "pull_ff_only",
                json!({ "remote": remote, "branch": branch }),
            )
        })
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
        let paths: Vec<String> = paths
            .iter()
            .map(|p| p.to_string_lossy().to_string())
            .collect();
        self.call_json(
            "commit",
            json!({ "message": message, "name": name, "email": email, "paths": paths }),
        )
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
        self.call_json(
            "commit_index",
            json!({ "message": message, "name": name, "email": email }),
        )
    }

    /// Returns summarized status information.
    ///
    /// # Returns
    /// - `Ok(StatusSummary)` summary payload.
    /// - `Err(VcsError)` on backend failure.
    fn status_summary(&self) -> VcsResult<StatusSummary> {
        self.call_json("status_summary", Value::Null)
    }

    /// Returns full status payload.
    ///
    /// # Returns
    /// - `Ok(StatusPayload)` status payload.
    /// - `Err(VcsError)` on backend failure.
    fn status_payload(&self) -> VcsResult<StatusPayload> {
        self.call_json("status_payload", Value::Null)
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
        self.call_json("log_commits", json!({ "query": query }))
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
        self.call_json("diff_file", json!({ "path": path_to_utf8(path)? }))
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
        self.call_json("diff_commit", json!({ "rev": rev }))
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
        self.call_json("conflict_details", json!({ "path": path_to_utf8(path)? }))
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
        self.call_unit(
            "checkout_conflict_side",
            json!({ "path": path_to_utf8(path)?, "side": side }),
        )
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
        let content = String::from_utf8_lossy(content).to_string();
        self.call_unit(
            "write_merge_result",
            json!({ "path": path_to_utf8(path)?, "content": content }),
        )
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
        self.call_unit("stage_patch", json!({ "patch": patch }))
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
        let paths: Vec<String> = paths
            .iter()
            .map(|p| p.to_string_lossy().to_string())
            .collect();
        self.call_unit("discard_paths", json!({ "paths": paths }))
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
        self.call_unit("apply_reverse_patch", json!({ "patch": patch }))
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
        self.call_unit("delete_branch", json!({ "name": name, "force": force }))
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
        self.call_unit("rename_branch", json!({ "old": old, "new": new }))
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
        self.call_unit("merge_into_current", json!({ "name": name }))
    }

    /// Aborts an in-progress merge.
    ///
    /// # Returns
    /// - `Ok(())` on success.
    /// - `Err(VcsError)` on backend failure.
    fn merge_abort(&self) -> VcsResult<()> {
        self.call_unit("merge_abort", Value::Null)
    }

    /// Continues an in-progress merge.
    ///
    /// # Returns
    /// - `Ok(())` on success.
    /// - `Err(VcsError)` on backend failure.
    fn merge_continue(&self) -> VcsResult<()> {
        self.call_unit("merge_continue", Value::Null)
    }

    /// Returns whether a merge is currently in progress.
    ///
    /// # Returns
    /// - `Ok(bool)` merge state.
    /// - `Err(VcsError)` on backend failure.
    fn merge_in_progress(&self) -> VcsResult<bool> {
        self.call_json("merge_in_progress", Value::Null)
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
        self.call_unit(
            "set_branch_upstream",
            json!({ "branch": branch, "upstream": upstream }),
        )
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
        self.call_json("branch_upstream", json!({ "branch": branch }))
    }

    /// Performs a hard reset of HEAD/worktree.
    ///
    /// # Returns
    /// - `Ok(())` on success.
    /// - `Err(VcsError)` on backend failure.
    fn hard_reset_head(&self) -> VcsResult<()> {
        self.call_unit("hard_reset_head", Value::Null)
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
        self.call_unit("reset_soft_to", json!({ "rev": rev }))
    }

    /// Returns configured repository identity if available.
    ///
    /// # Returns
    /// - `Ok(Some((String, String)))` name/email pair.
    /// - `Ok(None)` when unset.
    /// - `Err(VcsError)` on backend failure.
    fn get_identity(&self) -> VcsResult<Option<(String, String)>> {
        self.call_json("get_identity", Value::Null)
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
        self.call_unit(
            "set_identity_local",
            json!({ "name": name, "email": email }),
        )
    }

    /// Returns stash entries.
    ///
    /// # Returns
    /// - `Ok(Vec<StashItem>)` stash list.
    /// - `Err(VcsError)` on backend failure.
    fn stash_list(&self) -> VcsResult<Vec<StashItem>> {
        self.call_json("stash_list", Value::Null)
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
        let paths: Vec<String> = paths
            .iter()
            .map(|p| p.to_string_lossy().to_string())
            .collect();
        self.call_unit(
            "stash_push",
            json!({ "message": message, "include_untracked": include_untracked, "paths": paths }),
        )
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
        self.call_unit("stash_apply", json!({ "selector": selector }))
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
        self.call_unit("stash_pop", json!({ "selector": selector }))
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
        self.call_unit("stash_drop", json!({ "selector": selector }))
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
        self.call_json("stash_show", json!({ "selector": selector }))
    }
}

/// Converts an RPC error into a backend-scoped [`VcsError`].
///
/// # Parameters
/// - `err`: RPC error payload.
///
/// # Returns
/// - Converted backend error.
fn map_rpc_err(err: RpcError) -> VcsError {
    VcsError::Backend {
        backend: BackendId::from("plugin"),
        msg: format!("{}: {}", err.code, err.message),
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
    path.to_str()
        .map(|s| s.to_string())
        .ok_or_else(|| VcsError::Backend {
            backend: BackendId::from("plugin"),
            msg: "non-utf8 path".into(),
        })
}
