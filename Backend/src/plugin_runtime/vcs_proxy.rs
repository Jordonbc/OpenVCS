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

    fn call_value(&self, method: &str, params: Value) -> Result<Value, VcsError> {
        self.rpc.call(method, params).map_err(map_rpc_err)
    }

    fn call_json<T: DeserializeOwned>(&self, method: &str, params: Value) -> Result<T, VcsError> {
        let v = self.call_value(method, params)?;
        serde_json::from_value(v).map_err(|e| VcsError::Backend {
            backend: self.backend_id.clone(),
            msg: format!("invalid plugin response for {method}: {e}"),
        })
    }

    fn call_unit(&self, method: &str, params: Value) -> Result<(), VcsError> {
        let _ = self.call_value(method, params)?;
        Ok(())
    }

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
    fn id(&self) -> BackendId {
        self.backend_id.clone()
    }

    fn caps(&self) -> Capabilities {
        self.call_json("caps", Value::Null).unwrap_or_default()
    }

    fn open(_path: &Path) -> VcsResult<Self>
    where
        Self: Sized,
    {
        Err(VcsError::Backend {
            backend: BackendId::from("plugin"),
            msg: "PluginVcsProxy::open must be constructed via the host runtime".into(),
        })
    }

    fn clone(_url: &str, _dest: &Path, _on: Option<OnEvent>) -> VcsResult<Self>
    where
        Self: Sized,
    {
        Err(VcsError::Backend {
            backend: BackendId::from("plugin"),
            msg: "PluginVcsProxy::clone must be constructed via the host runtime".into(),
        })
    }

    fn workdir(&self) -> &Path {
        &self.workdir
    }

    fn current_branch(&self) -> VcsResult<Option<String>> {
        self.call_json("current_branch", Value::Null)
    }

    fn branches(&self) -> VcsResult<Vec<openvcs_core::models::BranchItem>> {
        self.call_json("branches", Value::Null)
    }

    fn local_branches(&self) -> VcsResult<Vec<String>> {
        self.call_json("local_branches", Value::Null)
    }

    fn create_branch(&self, name: &str, checkout: bool) -> VcsResult<()> {
        self.call_unit(
            "create_branch",
            json!({ "name": name, "checkout": checkout }),
        )
    }

    fn checkout_branch(&self, name: &str) -> VcsResult<()> {
        self.call_unit("checkout_branch", json!({ "name": name }))
    }

    fn ensure_remote(&self, name: &str, url: &str) -> VcsResult<()> {
        self.call_unit("ensure_remote", json!({ "name": name, "url": url }))
    }

    fn list_remotes(&self) -> VcsResult<Vec<(String, String)>> {
        self.call_json("list_remotes", Value::Null)
    }

    fn remove_remote(&self, name: &str) -> VcsResult<()> {
        self.call_unit("remove_remote", json!({ "name": name }))
    }

    fn fetch(&self, remote: &str, refspec: &str, on: Option<OnEvent>) -> VcsResult<()> {
        self.with_events(on, || {
            self.call_unit("fetch", json!({ "remote": remote, "refspec": refspec }))
        })
    }

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

    fn push(&self, remote: &str, refspec: &str, on: Option<OnEvent>) -> VcsResult<()> {
        self.with_events(on, || {
            self.call_unit("push", json!({ "remote": remote, "refspec": refspec }))
        })
    }

    fn pull_ff_only(&self, remote: &str, branch: &str, on: Option<OnEvent>) -> VcsResult<()> {
        self.with_events(on, || {
            self.call_unit(
                "pull_ff_only",
                json!({ "remote": remote, "branch": branch }),
            )
        })
    }

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

    fn commit_index(&self, message: &str, name: &str, email: &str) -> VcsResult<String> {
        self.call_json(
            "commit_index",
            json!({ "message": message, "name": name, "email": email }),
        )
    }

    fn status_summary(&self) -> VcsResult<StatusSummary> {
        self.call_json("status_summary", Value::Null)
    }

    fn status_payload(&self) -> VcsResult<StatusPayload> {
        self.call_json("status_payload", Value::Null)
    }

    fn log_commits(&self, query: &LogQuery) -> VcsResult<Vec<openvcs_core::models::CommitItem>> {
        self.call_json("log_commits", json!({ "query": query }))
    }

    fn diff_file(&self, path: &Path) -> VcsResult<Vec<String>> {
        self.call_json("diff_file", json!({ "path": path_to_utf8(path)? }))
    }

    fn diff_commit(&self, rev: &str) -> VcsResult<Vec<String>> {
        self.call_json("diff_commit", json!({ "rev": rev }))
    }

    fn conflict_details(&self, path: &Path) -> VcsResult<ConflictDetails> {
        self.call_json("conflict_details", json!({ "path": path_to_utf8(path)? }))
    }

    fn checkout_conflict_side(&self, path: &Path, side: ConflictSide) -> VcsResult<()> {
        self.call_unit(
            "checkout_conflict_side",
            json!({ "path": path_to_utf8(path)?, "side": side }),
        )
    }

    fn write_merge_result(&self, path: &Path, content: &[u8]) -> VcsResult<()> {
        let content = String::from_utf8_lossy(content).to_string();
        self.call_unit(
            "write_merge_result",
            json!({ "path": path_to_utf8(path)?, "content": content }),
        )
    }

    fn stage_patch(&self, patch: &str) -> VcsResult<()> {
        self.call_unit("stage_patch", json!({ "patch": patch }))
    }

    fn discard_paths(&self, paths: &[PathBuf]) -> VcsResult<()> {
        let paths: Vec<String> = paths
            .iter()
            .map(|p| p.to_string_lossy().to_string())
            .collect();
        self.call_unit("discard_paths", json!({ "paths": paths }))
    }

    fn apply_reverse_patch(&self, patch: &str) -> VcsResult<()> {
        self.call_unit("apply_reverse_patch", json!({ "patch": patch }))
    }

    fn delete_branch(&self, name: &str, force: bool) -> VcsResult<()> {
        self.call_unit("delete_branch", json!({ "name": name, "force": force }))
    }

    fn rename_branch(&self, old: &str, new: &str) -> VcsResult<()> {
        self.call_unit("rename_branch", json!({ "old": old, "new": new }))
    }

    fn merge_into_current(&self, name: &str) -> VcsResult<()> {
        self.call_unit("merge_into_current", json!({ "name": name }))
    }

    fn merge_abort(&self) -> VcsResult<()> {
        self.call_unit("merge_abort", Value::Null)
    }

    fn merge_continue(&self) -> VcsResult<()> {
        self.call_unit("merge_continue", Value::Null)
    }

    fn merge_in_progress(&self) -> VcsResult<bool> {
        self.call_json("merge_in_progress", Value::Null)
    }

    fn set_branch_upstream(&self, branch: &str, upstream: &str) -> VcsResult<()> {
        self.call_unit(
            "set_branch_upstream",
            json!({ "branch": branch, "upstream": upstream }),
        )
    }

    fn branch_upstream(&self, branch: &str) -> VcsResult<Option<String>> {
        self.call_json("branch_upstream", json!({ "branch": branch }))
    }

    fn hard_reset_head(&self) -> VcsResult<()> {
        self.call_unit("hard_reset_head", Value::Null)
    }

    fn reset_soft_to(&self, rev: &str) -> VcsResult<()> {
        self.call_unit("reset_soft_to", json!({ "rev": rev }))
    }

    fn get_identity(&self) -> VcsResult<Option<(String, String)>> {
        self.call_json("get_identity", Value::Null)
    }

    fn set_identity_local(&self, name: &str, email: &str) -> VcsResult<()> {
        self.call_unit(
            "set_identity_local",
            json!({ "name": name, "email": email }),
        )
    }

    fn stash_list(&self) -> VcsResult<Vec<StashItem>> {
        self.call_json("stash_list", Value::Null)
    }

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

    fn stash_apply(&self, selector: &str) -> VcsResult<()> {
        self.call_unit("stash_apply", json!({ "selector": selector }))
    }

    fn stash_pop(&self, selector: &str) -> VcsResult<()> {
        self.call_unit("stash_pop", json!({ "selector": selector }))
    }

    fn stash_drop(&self, selector: &str) -> VcsResult<()> {
        self.call_unit("stash_drop", json!({ "selector": selector }))
    }

    fn stash_show(&self, selector: &str) -> VcsResult<Vec<String>> {
        self.call_json("stash_show", json!({ "selector": selector }))
    }
}

fn map_rpc_err(err: RpcError) -> VcsError {
    VcsError::Backend {
        backend: BackendId::from("plugin"),
        msg: format!("{}: {}", err.code, err.message),
    }
}

fn path_to_utf8(path: &Path) -> Result<String, VcsError> {
    path.to_str()
        .map(|s| s.to_string())
        .ok_or_else(|| VcsError::Backend {
            backend: BackendId::from("plugin"),
            msg: "non-utf8 path".into(),
        })
}
