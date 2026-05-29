// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later
//! VCS operation methods for `NodePluginRuntimeInstance`.
//!
//! Each method sends a JSON-RPC request to the Node.js plugin process using
//! the session-scoped params built by `session_params()`.

use super::NodePluginRuntimeInstance;
use crate::core::models::{
    BranchItem, CommitItem, ConflictDetails, ConflictSide, LogQuery, StashItem, StatusPayload,
};
use crate::plugin_runtime::protocol::Methods;
use base64::Engine;
use serde::Deserialize;
use serde_json::{Value, json};

/// Parsed session-open response payload.
#[derive(Debug, Deserialize)]
struct OpenSessionResponse {
    /// Stable plugin-owned session id.
    session_id: String,
}

/// Parsed identity response payload.
#[derive(Debug, Deserialize)]
struct IdentityResponse {
    /// User name.
    name: String,
    /// User email.
    email: String,
}

/// Parsed remote descriptor response payload.
#[derive(Debug, Deserialize)]
struct RemoteEntry {
    /// Remote name.
    name: String,
    /// Remote URL.
    url: String,
}

impl NodePluginRuntimeInstance {
    /// Calls `vcs.open` and stores active session id.
    ///
    /// # Parameters
    /// - `path`: Repository workdir path.
    /// - `config`: Serialized open config JSON bytes.
    pub fn vcs_open(&self, path: &str, config: &[u8]) -> Result<(), String> {
        let config_value = if config.is_empty() {
            Value::Object(serde_json::Map::new())
        } else {
            serde_json::from_slice(config).unwrap_or_else(|_| Value::Object(serde_json::Map::new()))
        };
        let result: OpenSessionResponse = self.rpc_call(
            Methods::VCS_OPEN,
            json!({
                "path": path,
                "config": config_value,
            }),
        )?;
        *self.vcs_session_id.lock() = Some(result.session_id);
        Ok(())
    }

    /// Calls `vcs.clone_repo` without requiring an opened session.
    pub fn vcs_clone_repo(&self, url: &str, dest: &str) -> Result<(), String> {
        self.rpc_call_unit(Methods::VCS_CLONE_REPO, json!({ "url": url, "dest": dest }))
    }

    /// Calls `vcs.get-current-branch`.
    pub fn vcs_get_current_branch(&self) -> Result<Option<String>, String> {
        let params = self.session_params(Value::Object(serde_json::Map::new()))?;
        self.rpc_call(Methods::VCS_GET_CURRENT_BRANCH, params)
    }

    /// Calls `vcs.list-branches`.
    pub fn vcs_list_branches(&self) -> Result<Vec<BranchItem>, String> {
        let params = self.session_params(Value::Object(serde_json::Map::new()))?;
        self.rpc_call(Methods::VCS_LIST_BRANCHES, params)
    }

    /// Calls `vcs.create-branch`.
    pub fn vcs_create_branch(&self, name: &str, checkout: bool) -> Result<(), String> {
        let params = self.session_params(json!({ "name": name, "checkout": checkout }))?;
        self.rpc_call_unit(Methods::VCS_CREATE_BRANCH, params)
    }

    /// Calls `vcs.checkout-branch`.
    pub fn vcs_checkout_branch(&self, name: &str) -> Result<(), String> {
        let params = self.session_params(json!({ "name": name }))?;
        self.rpc_call_unit(Methods::VCS_CHECKOUT_BRANCH, params)
    }

    /// Calls `vcs.ensure-remote`.
    pub fn vcs_ensure_remote(&self, name: &str, url: &str) -> Result<(), String> {
        let params = self.session_params(json!({ "name": name, "url": url }))?;
        self.rpc_call_unit(Methods::VCS_ENSURE_REMOTE, params)
    }

    /// Calls `vcs.list-remotes`.
    pub fn vcs_list_remotes(&self) -> Result<Vec<(String, String)>, String> {
        let params = self.session_params(Value::Object(serde_json::Map::new()))?;
        let entries: Vec<RemoteEntry> = self.rpc_call(Methods::VCS_LIST_REMOTES, params)?;
        Ok(entries
            .into_iter()
            .map(|entry| (entry.name, entry.url))
            .collect())
    }

    /// Calls `vcs.remove-remote`.
    pub fn vcs_remove_remote(&self, name: &str) -> Result<(), String> {
        let params = self.session_params(json!({ "name": name }))?;
        self.rpc_call_unit(Methods::VCS_REMOVE_REMOTE, params)
    }

    /// Calls `vcs.fetch`.
    pub fn vcs_fetch(&self, remote: &str, refspec: &str) -> Result<(), String> {
        let params = self.session_params(json!({ "remote": remote, "refspec": refspec }))?;
        self.rpc_call_unit(Methods::VCS_FETCH, params)
    }

    /// Calls `vcs.push`.
    pub fn vcs_push(&self, remote: &str, refspec: &str) -> Result<(), String> {
        let params = self.session_params(json!({ "remote": remote, "refspec": refspec }))?;
        self.rpc_call_unit(Methods::VCS_PUSH, params)
    }

    /// Calls `vcs.pull-ff-only`.
    pub fn vcs_pull_ff_only(&self, remote: &str, branch: &str) -> Result<(), String> {
        let params = self.session_params(json!({ "remote": remote, "branch": branch }))?;
        self.rpc_call_unit(Methods::VCS_PULL_FF_ONLY, params)
    }

    /// Calls `vcs.commit`.
    pub fn vcs_commit(
        &self,
        message: &str,
        name: &str,
        email: &str,
        paths: &[String],
    ) -> Result<String, String> {
        let params = self.session_params(json!({
            "message": message,
            "name": name,
            "email": email,
            "paths": paths,
        }))?;
        self.rpc_call(Methods::VCS_COMMIT, params)
    }

    /// Calls `vcs.commit-index`.
    pub fn vcs_commit_index(
        &self,
        message: &str,
        name: &str,
        email: &str,
    ) -> Result<String, String> {
        let params = self.session_params(json!({
            "message": message,
            "name": name,
            "email": email,
        }))?;
        self.rpc_call(Methods::VCS_COMMIT_INDEX, params)
    }

    /// Calls `vcs.get-status-payload`.
    pub fn vcs_get_status_payload(&self) -> Result<StatusPayload, String> {
        let params = self.session_params(Value::Object(serde_json::Map::new()))?;
        self.rpc_call(Methods::VCS_GET_STATUS_PAYLOAD, params)
    }

    /// Calls `vcs.list-commits`.
    pub fn vcs_list_commits(&self, query: &LogQuery) -> Result<Vec<CommitItem>, String> {
        let params = self.session_params(json!({ "query": query }))?;
        self.rpc_call(Methods::VCS_LIST_COMMITS, params)
    }

    /// Calls `vcs.diff-file`.
    pub fn vcs_diff_file(&self, path: &str) -> Result<Vec<String>, String> {
        let params = self.session_params(json!({ "path": path }))?;
        self.rpc_call(Methods::VCS_DIFF_FILE, params)
    }

    /// Calls `vcs.diff-commit`.
    pub fn vcs_diff_commit(&self, rev: &str) -> Result<Vec<String>, String> {
        let params = self.session_params(json!({ "rev": rev }))?;
        self.rpc_call(Methods::VCS_DIFF_COMMIT, params)
    }

    /// Calls `vcs.get-conflict-details`.
    pub fn vcs_get_conflict_details(&self, path: &str) -> Result<ConflictDetails, String> {
        let params = self.session_params(json!({ "path": path }))?;
        self.rpc_call(Methods::VCS_GET_CONFLICT_DETAILS, params)
    }

    /// Calls `vcs.checkout-conflict-side`.
    pub fn vcs_checkout_conflict_side(&self, path: &str, side: ConflictSide) -> Result<(), String> {
        let params = self.session_params(json!({ "path": path, "side": side }))?;
        self.rpc_call_unit(Methods::VCS_CHECKOUT_CONFLICT_SIDE, params)
    }

    /// Calls `vcs.write-merge-result`.
    pub fn vcs_write_merge_result(&self, path: &str, content: &[u8]) -> Result<(), String> {
        let content_b64 = base64::engine::general_purpose::STANDARD.encode(content);
        let params = self.session_params(json!({
            "path": path,
            "content_b64": content_b64,
        }))?;
        self.rpc_call_unit(Methods::VCS_WRITE_MERGE_RESULT, params)
    }

    /// Calls `vcs.stage-patch`.
    pub fn vcs_stage_patch(&self, patch: &str) -> Result<(), String> {
        let params = self.session_params(json!({ "patch": patch }))?;
        self.rpc_call_unit(Methods::VCS_STAGE_PATCH, params)
    }

    /// Calls `vcs.stage-paths`.
    pub fn vcs_stage_paths(&self, paths: &[String]) -> Result<(), String> {
        let params = self.session_params(json!({ "paths": paths }))?;
        self.rpc_call_unit(Methods::VCS_STAGE_PATHS, params)
    }

    /// Calls `vcs.discard-paths`.
    pub fn vcs_discard_paths(&self, paths: &[String]) -> Result<(), String> {
        let params = self.session_params(json!({ "paths": paths }))?;
        self.rpc_call_unit(Methods::VCS_DISCARD_PATHS, params)
    }

    /// Calls `vcs.apply-reverse-patch`.
    pub fn vcs_apply_reverse_patch(&self, patch: &str) -> Result<(), String> {
        let params = self.session_params(json!({ "patch": patch }))?;
        self.rpc_call_unit(Methods::VCS_APPLY_REVERSE_PATCH, params)
    }

    /// Calls `vcs.delete-branch`.
    pub fn vcs_delete_branch(&self, name: &str, force: bool) -> Result<(), String> {
        let params = self.session_params(json!({ "name": name, "force": force }))?;
        self.rpc_call_unit(Methods::VCS_DELETE_BRANCH, params)
    }

    /// Calls `vcs.rename-branch`.
    pub fn vcs_rename_branch(&self, old: &str, new: &str) -> Result<(), String> {
        let params = self.session_params(json!({ "old": old, "new": new }))?;
        self.rpc_call_unit(Methods::VCS_RENAME_BRANCH, params)
    }

    /// Calls `vcs.merge-into-current`.
    pub fn vcs_merge_into_current(&self, name: &str, message: Option<&str>) -> Result<(), String> {
        let params = self.session_params(json!({ "name": name, "message": message }))?;
        self.rpc_call_unit(Methods::VCS_MERGE_INTO_CURRENT, params)
    }

    /// Calls `vcs.merge-abort`.
    pub fn vcs_merge_abort(&self) -> Result<(), String> {
        let params = self.session_params(Value::Object(serde_json::Map::new()))?;
        self.rpc_call_unit(Methods::VCS_MERGE_ABORT, params)
    }

    /// Calls `vcs.merge-continue`.
    pub fn vcs_merge_continue(&self) -> Result<(), String> {
        let params = self.session_params(Value::Object(serde_json::Map::new()))?;
        self.rpc_call_unit(Methods::VCS_MERGE_CONTINUE, params)
    }

    /// Calls `vcs.is-merge-in-progress`.
    pub fn vcs_is_merge_in_progress(&self) -> Result<bool, String> {
        let params = self.session_params(Value::Object(serde_json::Map::new()))?;
        self.rpc_call(Methods::VCS_IS_MERGE_IN_PROGRESS, params)
    }

    /// Calls `vcs.set-branch-upstream`.
    pub fn vcs_set_branch_upstream(&self, branch: &str, upstream: &str) -> Result<(), String> {
        let params = self.session_params(json!({ "branch": branch, "upstream": upstream }))?;
        self.rpc_call_unit(Methods::VCS_SET_BRANCH_UPSTREAM, params)
    }

    /// Calls `vcs.get-branch-upstream`.
    pub fn vcs_get_branch_upstream(&self, branch: &str) -> Result<Option<String>, String> {
        let params = self.session_params(json!({ "branch": branch }))?;
        self.rpc_call(Methods::VCS_GET_BRANCH_UPSTREAM, params)
    }

    /// Calls `vcs.reset-soft-to`.
    pub fn vcs_reset_soft_to(&self, rev: &str) -> Result<(), String> {
        let params = self.session_params(json!({ "rev": rev }))?;
        self.rpc_call_unit(Methods::VCS_RESET_SOFT_TO, params)
    }

    /// Calls `vcs.get-identity`.
    pub fn vcs_get_identity(&self) -> Result<Option<(String, String)>, String> {
        let params = self.session_params(Value::Object(serde_json::Map::new()))?;
        let identity: Option<IdentityResponse> =
            self.rpc_call(Methods::VCS_GET_IDENTITY, params)?;
        Ok(identity.map(|value| (value.name, value.email)))
    }

    /// Calls `vcs.set-identity-local`.
    pub fn vcs_set_identity_local(&self, name: &str, email: &str) -> Result<(), String> {
        let params = self.session_params(json!({ "name": name, "email": email }))?;
        self.rpc_call_unit(Methods::VCS_SET_IDENTITY_LOCAL, params)
    }

    /// Calls `vcs.list-stashes`.
    pub fn vcs_list_stashes(&self) -> Result<Vec<StashItem>, String> {
        let params = self.session_params(Value::Object(serde_json::Map::new()))?;
        self.rpc_call(Methods::VCS_LIST_STASHES, params)
    }

    /// Calls `vcs.stash-push`.
    pub fn vcs_stash_push(
        &self,
        message: Option<&str>,
        include_untracked: bool,
    ) -> Result<String, String> {
        let params = self.session_params(json!({
            "message": message,
            "include_untracked": include_untracked,
        }))?;
        self.rpc_call(Methods::VCS_STASH_PUSH, params)
    }

    /// Calls `vcs.stash-apply`.
    pub fn vcs_stash_apply(&self, selector: &str) -> Result<(), String> {
        let params = self.session_params(json!({ "selector": selector }))?;
        self.rpc_call_unit(Methods::VCS_STASH_APPLY, params)
    }

    /// Calls `vcs.stash-pop`.
    pub fn vcs_stash_pop(&self, selector: &str) -> Result<(), String> {
        let params = self.session_params(json!({ "selector": selector }))?;
        self.rpc_call_unit(Methods::VCS_STASH_POP, params)
    }

    /// Calls `vcs.stash-drop`.
    pub fn vcs_stash_drop(&self, selector: &str) -> Result<(), String> {
        let params = self.session_params(json!({ "selector": selector }))?;
        self.rpc_call_unit(Methods::VCS_STASH_DROP, params)
    }

    /// Calls `vcs.stash-show`.
    pub fn vcs_stash_show(&self, selector: &str) -> Result<String, String> {
        let params = self.session_params(json!({ "selector": selector }))?;
        self.rpc_call(Methods::VCS_STASH_SHOW, params)
    }

    /// Calls `vcs.cherry-pick`.
    pub fn vcs_cherry_pick(&self, commit: &str) -> Result<(), String> {
        let params = self.session_params(json!({ "commit": commit }))?;
        self.rpc_call_unit(Methods::VCS_CHERRY_PICK, params)
    }

    /// Calls `vcs.revert-commit`.
    pub fn vcs_revert_commit(&self, commit: &str, no_edit: bool) -> Result<(), String> {
        let params = self.session_params(json!({ "commit": commit, "no_edit": no_edit }))?;
        self.rpc_call_unit(Methods::VCS_REVERT_COMMIT, params)
    }
}

#[cfg(test)]
mod tests {
    include!("../../../tests/plugin_runtime/node_instance/vcs.rs");
}
