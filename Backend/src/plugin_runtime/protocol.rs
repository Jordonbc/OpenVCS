// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later
//! JSON-RPC protocol primitives for Node-based plugins.
//!
//! The Node plugin runtime uses JSON-RPC 2.0 messages framed with an
//! LSP-style `Content-Length` header over stdio.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::io::{BufRead, Write};

#[cfg(test)]
mod tests {
    include!("../../tests/plugin_runtime/protocol.rs");
}

/// Protocol version used by host and plugin at initialization.
pub const PROTOCOL_VERSION: u32 = 1;

/// Host-to-plugin request method names.
pub struct Methods;

#[allow(dead_code)]
impl Methods {
    /// Performs runtime handshake and capability discovery.
    pub const PLUGIN_INITIALIZE: &'static str = "plugin.initialize";
    /// Starts plugin lifecycle state.
    pub const PLUGIN_INIT: &'static str = "plugin.init";
    /// Stops plugin lifecycle state.
    pub const PLUGIN_DEINIT: &'static str = "plugin.deinit";
    /// Requests plugin-contributed menus.
    pub const PLUGIN_GET_MENUS: &'static str = "plugin.get_menus";
    /// Invokes a plugin action by id.
    pub const PLUGIN_HANDLE_ACTION: &'static str = "plugin.handle_action";
    /// Requests plugin settings defaults.
    pub const PLUGIN_SETTINGS_DEFAULTS: &'static str = "plugin.settings.defaults";
    /// Invokes settings on-load callback.
    pub const PLUGIN_SETTINGS_ON_LOAD: &'static str = "plugin.settings.on_load";
    /// Invokes settings on-apply callback.
    pub const PLUGIN_SETTINGS_ON_APPLY: &'static str = "plugin.settings.on_apply";
    /// Invokes settings on-save callback.
    pub const PLUGIN_SETTINGS_ON_SAVE: &'static str = "plugin.settings.on_save";
    /// Invokes settings on-reset callback.
    pub const PLUGIN_SETTINGS_ON_RESET: &'static str = "plugin.settings.on_reset";

    /// Returns backend capability flags.
    pub const VCS_GET_CAPS: &'static str = "vcs.get_caps";
    /// Opens a repository and creates a VCS session.
    pub const VCS_OPEN: &'static str = "vcs.open";
    /// Closes a VCS session.
    pub const VCS_CLOSE: &'static str = "vcs.close";
    /// Clones a repository.
    pub const VCS_CLONE_REPO: &'static str = "vcs.clone_repo";
    /// Returns session workdir.
    pub const VCS_GET_WORKDIR: &'static str = "vcs.get_workdir";
    /// Returns current branch.
    pub const VCS_GET_CURRENT_BRANCH: &'static str = "vcs.get_current_branch";
    /// Lists branches.
    pub const VCS_LIST_BRANCHES: &'static str = "vcs.list_branches";
    /// Lists local branch names.
    pub const VCS_LIST_LOCAL_BRANCHES: &'static str = "vcs.list_local_branches";
    /// Creates a branch.
    pub const VCS_CREATE_BRANCH: &'static str = "vcs.create_branch";
    /// Checks out a branch.
    pub const VCS_CHECKOUT_BRANCH: &'static str = "vcs.checkout_branch";
    /// Creates or updates a remote.
    pub const VCS_ENSURE_REMOTE: &'static str = "vcs.ensure_remote";
    /// Lists remotes.
    pub const VCS_LIST_REMOTES: &'static str = "vcs.list_remotes";
    /// Removes a remote.
    pub const VCS_REMOVE_REMOTE: &'static str = "vcs.remove_remote";
    /// Performs fetch.
    pub const VCS_FETCH: &'static str = "vcs.fetch";
    /// Performs fetch with options.
    pub const VCS_FETCH_WITH_OPTIONS: &'static str = "vcs.fetch_with_options";
    /// Performs push.
    pub const VCS_PUSH: &'static str = "vcs.push";
    /// Performs fast-forward-only pull.
    pub const VCS_PULL_FF_ONLY: &'static str = "vcs.pull_ff_only";
    /// Creates commit from selected paths.
    pub const VCS_COMMIT: &'static str = "vcs.commit";
    /// Creates commit from index.
    pub const VCS_COMMIT_INDEX: &'static str = "vcs.commit_index";
    /// Returns status summary.
    pub const VCS_GET_STATUS_SUMMARY: &'static str = "vcs.get_status_summary";
    /// Returns status payload.
    pub const VCS_GET_STATUS_PAYLOAD: &'static str = "vcs.get_status_payload";
    /// Lists commits by query.
    pub const VCS_LIST_COMMITS: &'static str = "vcs.list_commits";
    /// Diffs a file.
    pub const VCS_DIFF_FILE: &'static str = "vcs.diff_file";
    /// Diffs a commit.
    pub const VCS_DIFF_COMMIT: &'static str = "vcs.diff_commit";
    /// Returns conflict details.
    pub const VCS_GET_CONFLICT_DETAILS: &'static str = "vcs.get_conflict_details";
    /// Checks out one side of a conflict.
    pub const VCS_CHECKOUT_CONFLICT_SIDE: &'static str = "vcs.checkout_conflict_side";
    /// Writes merge conflict resolution content.
    pub const VCS_WRITE_MERGE_RESULT: &'static str = "vcs.write_merge_result";
    /// Stages a text patch.
    pub const VCS_STAGE_PATCH: &'static str = "vcs.stage_patch";
    /// Stages structured hunk/line selections (VCS-agnostic).
    pub const VCS_STAGE_SELECTIONS: &'static str = "vcs.stage_selections";
    /// Stages explicit paths to the index.
    pub const VCS_STAGE_PATHS: &'static str = "vcs.stage_paths";
    /// Discards path changes.
    pub const VCS_DISCARD_PATHS: &'static str = "vcs.discard_paths";
    /// Applies reverse patch.
    pub const VCS_APPLY_REVERSE_PATCH: &'static str = "vcs.apply_reverse_patch";
    /// Deletes a branch.
    pub const VCS_DELETE_BRANCH: &'static str = "vcs.delete_branch";
    /// Renames a branch.
    pub const VCS_RENAME_BRANCH: &'static str = "vcs.rename_branch";
    /// Merges a branch into current.
    pub const VCS_MERGE_INTO_CURRENT: &'static str = "vcs.merge_into_current";
    /// Aborts merge.
    pub const VCS_MERGE_ABORT: &'static str = "vcs.merge_abort";
    /// Continues merge.
    pub const VCS_MERGE_CONTINUE: &'static str = "vcs.merge_continue";
    /// Returns whether a merge is in progress.
    pub const VCS_IS_MERGE_IN_PROGRESS: &'static str = "vcs.is_merge_in_progress";
    /// Sets branch upstream.
    pub const VCS_SET_BRANCH_UPSTREAM: &'static str = "vcs.set_branch_upstream";
    /// Gets branch upstream.
    pub const VCS_GET_BRANCH_UPSTREAM: &'static str = "vcs.get_branch_upstream";
    /// Hard resets HEAD.
    pub const VCS_HARD_RESET_HEAD: &'static str = "vcs.hard_reset_head";
    /// Soft resets to revision.
    pub const VCS_RESET_SOFT_TO: &'static str = "vcs.reset_soft_to";
    /// Returns configured identity.
    pub const VCS_GET_IDENTITY: &'static str = "vcs.get_identity";
    /// Sets configured identity.
    pub const VCS_SET_IDENTITY_LOCAL: &'static str = "vcs.set_identity_local";
    /// Lists stashes.
    pub const VCS_LIST_STASHES: &'static str = "vcs.list_stashes";
    /// Pushes stash with optional message, include-untracked flag, and path filters.
    pub const VCS_STASH_PUSH: &'static str = "vcs.stash_push";
    /// Applies stash.
    pub const VCS_STASH_APPLY: &'static str = "vcs.stash_apply";
    /// Pops stash.
    pub const VCS_STASH_POP: &'static str = "vcs.stash_pop";
    /// Drops stash.
    pub const VCS_STASH_DROP: &'static str = "vcs.stash_drop";
    /// Shows stash diff.
    pub const VCS_STASH_SHOW: &'static str = "vcs.stash_show";
    /// Cherry-picks commit.
    pub const VCS_CHERRY_PICK: &'static str = "vcs.cherry_pick";
    /// Reverts commit.
    pub const VCS_REVERT_COMMIT: &'static str = "vcs.revert_commit";
}

/// Plugin-to-host notification method names.
pub struct NotificationMethods;

impl NotificationMethods {
    /// Emits plugin log records to host logging.
    pub const HOST_LOG: &'static str = "host.log";
    /// Requests a host UI notification.
    pub const HOST_UI_NOTIFY: &'static str = "host.ui_notify";
    /// Requests setting host status text.
    pub const HOST_STATUS_SET: &'static str = "host.status_set";
    /// Emits plugin-scoped events.
    pub const HOST_EVENT_EMIT: &'static str = "host.event_emit";
    /// Emits VCS operation progress events.
    pub const VCS_EVENT: &'static str = "vcs.event";
}

/// JSON-RPC error object.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RpcError {
    /// Numeric error code.
    pub code: i32,
    /// Human-readable message.
    pub message: String,
    /// Optional extra error payload.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub data: Option<Value>,
}

/// JSON-RPC request object.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RpcRequest {
    /// JSON-RPC protocol version string.
    pub jsonrpc: String,
    /// Request id.
    pub id: u64,
    /// Request method name.
    pub method: String,
    /// Request params payload.
    pub params: Value,
}

/// JSON-RPC response object.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RpcResponse {
    /// JSON-RPC protocol version string.
    pub jsonrpc: String,
    /// Response id.
    pub id: u64,
    /// Optional success payload.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub result: Option<Value>,
    /// Optional error payload.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<RpcError>,
}

/// Writes one framed JSON message to a plugin stdio stream.
///
/// # Parameters
/// - `writer`: Target stream.
/// - `value`: JSON value to encode.
///
/// # Returns
/// - `Ok(())` when write succeeds.
/// - `Err(String)` when serialization or IO fails.
pub fn write_framed_message(writer: &mut impl Write, value: &Value) -> Result<(), String> {
    let payload = serde_json::to_vec(value).map_err(|e| format!("serialize rpc payload: {e}"))?;
    let header = format!("Content-Length: {}\r\n\r\n", payload.len());
    writer
        .write_all(header.as_bytes())
        .map_err(|e| format!("write rpc header: {e}"))?;
    writer
        .write_all(&payload)
        .map_err(|e| format!("write rpc payload: {e}"))?;
    writer.flush().map_err(|e| format!("flush rpc stream: {e}"))
}

/// Reads one framed JSON message from a plugin stdio stream.
///
/// # Parameters
/// - `reader`: Source stream.
///
/// # Returns
/// - `Ok(Value)` decoded JSON message.
/// - `Err(String)` when framing, decode, or IO fails.
pub fn read_framed_message(reader: &mut impl BufRead) -> Result<Value, String> {
    let mut content_length: Option<usize> = None;

    loop {
        let mut line = String::new();
        let read = reader
            .read_line(&mut line)
            .map_err(|e| format!("read rpc header: {e}"))?;
        if read == 0 {
            return Err("plugin rpc stream closed".to_string());
        }

        let trimmed = line.trim_end_matches(['\r', '\n']);
        if trimmed.is_empty() {
            break;
        }

        let Some((name, value)) = trimmed.split_once(':') else {
            return Err(format!("invalid rpc header line: {trimmed}"));
        };
        if name.eq_ignore_ascii_case("content-length") {
            let parsed = value
                .trim()
                .parse::<usize>()
                .map_err(|e| format!("invalid Content-Length '{value}': {e}"))?;
            content_length = Some(parsed);
        }
    }

    let length = content_length.ok_or_else(|| "missing Content-Length header".to_string())?;
    let mut payload = vec![0u8; length];
    reader
        .read_exact(&mut payload)
        .map_err(|e| format!("read rpc payload: {e}"))?;
    serde_json::from_slice(&payload).map_err(|e| format!("parse rpc payload: {e}"))
}
