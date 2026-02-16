// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later
use crate::plugin_runtime::host_api::{
    host_emit_event, host_process_exec_git, host_runtime_info, host_subscribe_event,
    host_ui_notify, host_workspace_read_file, host_workspace_write_file,
};
use crate::plugin_runtime::instance::PluginRuntimeInstance;
use crate::plugin_runtime::spawn::SpawnConfig;
use parking_lot::Mutex;
use serde::de::DeserializeOwned;
use serde::Serialize;
use serde_json::Value;
use wasmtime::component::{Component, Linker, ResourceTable};
use wasmtime::{Engine, Store};
use wasmtime_wasi::{WasiCtx, WasiCtxView, WasiView};

mod bindings {
    wasmtime::component::bindgen!({
        path: "../../Core/wit",
        world: "vcs",
        additional_derives: [serde::Serialize, serde::Deserialize],
    });
}

use bindings::exports::openvcs::plugin::vcs_api;

/// Live component instance plus generated bindings handle.
struct ComponentRuntime {
    /// Wasmtime store containing component state and host context.
    store: Store<ComponentHostState>,
    /// Generated typed binding entrypoints for the plugin world.
    bindings: bindings::Vcs,
}

/// Host state stored inside the Wasmtime store for host imports.
struct ComponentHostState {
    /// Spawn-time plugin metadata and capability context.
    spawn: SpawnConfig,
    /// Component resource table used by WASI/component model.
    table: ResourceTable,
    /// WASI context exposed to the component.
    wasi: WasiCtx,
}

impl ComponentHostState {
    /// Converts core host errors into generated WIT host error type.
    fn map_host_error(
        err: openvcs_core::app_api::PluginError,
    ) -> bindings::openvcs::plugin::host_api::HostError {
        bindings::openvcs::plugin::host_api::HostError {
            code: err.code,
            message: err.message,
        }
    }
}

impl WasiView for ComponentHostState {
    /// Returns mutable WASI context and resource table view.
    fn ctx(&mut self) -> WasiCtxView<'_> {
        WasiCtxView {
            ctx: &mut self.wasi,
            table: &mut self.table,
        }
    }
}

impl bindings::openvcs::plugin::host_api::Host for ComponentHostState {
    /// Returns runtime metadata for the current host process.
    fn get_runtime_info(
        &mut self,
    ) -> Result<
        bindings::openvcs::plugin::host_api::RuntimeInfo,
        bindings::openvcs::plugin::host_api::HostError,
    > {
        let value = host_runtime_info();
        Ok(bindings::openvcs::plugin::host_api::RuntimeInfo {
            os: value.os,
            arch: value.arch,
            container: value.container,
        })
    }

    /// Registers an event subscription for this plugin.
    fn subscribe_event(
        &mut self,
        event_name: String,
    ) -> Result<(), bindings::openvcs::plugin::host_api::HostError> {
        host_subscribe_event(&self.spawn, &event_name).map_err(ComponentHostState::map_host_error)
    }

    /// Emits a plugin-originated event through the host event bus.
    fn emit_event(
        &mut self,
        event_name: String,
        payload: Vec<u8>,
    ) -> Result<(), bindings::openvcs::plugin::host_api::HostError> {
        host_emit_event(&self.spawn, &event_name, &payload)
            .map_err(ComponentHostState::map_host_error)
    }

    /// Forwards plugin notifications to host-side UI notification handling.
    fn ui_notify(
        &mut self,
        message: String,
    ) -> Result<(), bindings::openvcs::plugin::host_api::HostError> {
        host_ui_notify(&self.spawn, &message).map_err(ComponentHostState::map_host_error)
    }

    /// Reads a workspace file under capability and path constraints.
    fn workspace_read_file(
        &mut self,
        path: String,
    ) -> Result<Vec<u8>, bindings::openvcs::plugin::host_api::HostError> {
        host_workspace_read_file(&self.spawn, &path).map_err(ComponentHostState::map_host_error)
    }

    /// Writes a workspace file under capability and path constraints.
    fn workspace_write_file(
        &mut self,
        path: String,
        content: Vec<u8>,
    ) -> Result<(), bindings::openvcs::plugin::host_api::HostError> {
        host_workspace_write_file(&self.spawn, &path, &content)
            .map_err(ComponentHostState::map_host_error)
    }

    /// Executes `git` in a constrained host environment.
    fn process_exec_git(
        &mut self,
        cwd: Option<String>,
        args: Vec<String>,
        env: Vec<bindings::openvcs::plugin::host_api::EnvVar>,
        stdin: Option<String>,
    ) -> Result<
        bindings::openvcs::plugin::host_api::ProcessExecOutput,
        bindings::openvcs::plugin::host_api::HostError,
    > {
        let env = env
            .into_iter()
            .map(|var| (var.key, var.value))
            .collect::<Vec<_>>();
        let value =
            host_process_exec_git(&self.spawn, cwd.as_deref(), &args, &env, stdin.as_deref())
                .map_err(ComponentHostState::map_host_error)?;
        Ok(bindings::openvcs::plugin::host_api::ProcessExecOutput {
            success: value.success,
            status: value.status,
            stdout: value.stdout,
            stderr: value.stderr,
        })
    }

    /// Logs plugin-emitted messages through the host logger.
    fn host_log(
        &mut self,
        level: bindings::openvcs::plugin::host_api::LogLevel,
        target: String,
        message: String,
    ) {
        let target = if target.trim().is_empty() {
            format!("plugin.{}", self.spawn.plugin_id)
        } else {
            format!("plugin.{}.{}", self.spawn.plugin_id, target)
        };

        match level {
            bindings::openvcs::plugin::host_api::LogLevel::Trace => {
                log::trace!(target: &target, "{message}")
            }
            bindings::openvcs::plugin::host_api::LogLevel::Debug => {
                log::debug!(target: &target, "{message}")
            }
            bindings::openvcs::plugin::host_api::LogLevel::Info => {
                log::info!(target: &target, "{message}")
            }
            bindings::openvcs::plugin::host_api::LogLevel::Warn => {
                log::warn!(target: &target, "{message}")
            }
            bindings::openvcs::plugin::host_api::LogLevel::Error => {
                log::error!(target: &target, "{message}")
            }
        };
    }
}

/// Component-model runtime instance.
pub struct ComponentPluginRuntimeInstance {
    /// Spawn configuration used to instantiate and identify the component.
    spawn: SpawnConfig,
    /// Lazily initialized runtime state.
    runtime: Mutex<Option<ComponentRuntime>>,
}

impl ComponentPluginRuntimeInstance {
    /// Creates a new component runtime instance.
    pub fn new(spawn: SpawnConfig) -> Self {
        Self {
            spawn,
            runtime: Mutex::new(None),
        }
    }

    /// Instantiates the component runtime and executes plugin initialization.
    fn instantiate_runtime(&self) -> Result<ComponentRuntime, String> {
        let engine = Engine::default();
        let component = Component::from_file(&engine, &self.spawn.exec_path)
            .map_err(|e| format!("load component {}: {e}", self.spawn.exec_path.display()))?;
        let mut linker = Linker::new(&engine);
        wasmtime_wasi::p2::add_to_linker_sync(&mut linker)
            .map_err(|e| format!("link wasi imports: {e}"))?;
        bindings::Vcs::add_to_linker::<
            ComponentHostState,
            wasmtime::component::HasSelf<ComponentHostState>,
        >(&mut linker, |state| state)
        .map_err(|e| format!("link host imports: {e}"))?;
        let mut store = Store::new(
            &engine,
            ComponentHostState {
                spawn: self.spawn.clone(),
                table: ResourceTable::new(),
                wasi: WasiCtx::builder().build(),
            },
        );
        let bindings = bindings::Vcs::instantiate(&mut store, &component, &linker)
            .map_err(|e| format!("instantiate component {}: {e}", self.spawn.plugin_id))?;

        bindings
            .openvcs_plugin_plugin_api()
            .call_init(&mut store)
            .map_err(|e| format!("component init trap for {}: {e}", self.spawn.plugin_id))?
            .map_err(|e| {
                format!(
                    "component init failed for {}: {}",
                    self.spawn.plugin_id, e.message
                )
            })?;

        Ok(ComponentRuntime { store, bindings })
    }

    /// Ensures a runtime exists and executes a closure with mutable access.
    fn with_runtime<T>(
        &self,
        f: impl FnOnce(&mut ComponentRuntime) -> Result<T, String>,
    ) -> Result<T, String> {
        self.ensure_running()?;
        let mut lock = self.runtime.lock();
        let runtime = lock.as_mut().ok_or_else(|| {
            format!(
                "component runtime not running for `{}`",
                self.spawn.plugin_id
            )
        })?;
        f(runtime)
    }
}

/// Deserializes JSON RPC parameters for a named method.
fn parse_method_params<T: DeserializeOwned>(method: &str, params: Value) -> Result<T, String> {
    serde_json::from_value(params).map_err(|e| format!("invalid params for `{method}`: {e}"))
}

/// Serializes a method result to JSON with contextual error reporting.
fn encode_method_result<T: Serialize>(
    plugin_id: &str,
    method: &str,
    value: T,
) -> Result<Value, String> {
    serde_json::to_value(value).map_err(|e| {
        format!(
            "serialize component result for `{}` method `{}`: {e}",
            plugin_id, method
        )
    })
}

impl PluginRuntimeInstance for ComponentPluginRuntimeInstance {
    /// Starts the component runtime when not already running.
    fn ensure_running(&self) -> Result<(), String> {
        let mut lock = self.runtime.lock();
        if lock.is_some() {
            return Ok(());
        }
        let runtime = self.instantiate_runtime()?;
        *lock = Some(runtime);
        Ok(())
    }

    #[allow(clippy::let_unit_value)]
    /// Invokes a v1 ABI method exported by the plugin component.
    fn call(&self, method: &str, params: Value) -> Result<Value, String> {
        self.with_runtime(|runtime| {
            macro_rules! invoke {
                ($method_name:literal, $call:ident $(, $arg:expr )* ) => {
                    runtime
                        .bindings
                        .openvcs_plugin_vcs_api()
                        .$call(&mut runtime.store $(, $arg )* )
                        .map_err(|e| {
                            format!(
                                "component call trap for {}.{}: {e}",
                                self.spawn.plugin_id, $method_name
                            )
                        })?
                        .map_err(|e| {
                            format!(
                                "component call failed for {}.{}: {}: {}",
                                self.spawn.plugin_id, $method_name, e.code, e.message
                            )
                        })
                };
            }

            match method {
                "caps" => {
                    let out = invoke!("caps", call_get_caps)?;
                    encode_method_result(&self.spawn.plugin_id, method, out)
                }
                "open" => {
                    #[derive(serde::Deserialize)]
                    struct Params {
                        path: String,
                        #[serde(default)]
                        config: Value,
                    }
                    let p: Params = parse_method_params(method, params)?;
                    let config = serde_json::to_vec(&p.config)
                        .map_err(|e| format!("serialize `open` config: {e}"))?;
                    let out = invoke!("open", call_open, &p.path, &config)?;
                    encode_method_result(&self.spawn.plugin_id, method, out)
                }
                "clone" => {
                    #[derive(serde::Deserialize)]
                    struct Params {
                        url: String,
                        dest: String,
                    }
                    let p: Params = parse_method_params(method, params)?;
                    let out = invoke!("clone", call_clone_repo, &p.url, &p.dest)?;
                    encode_method_result(&self.spawn.plugin_id, method, out)
                }
                "workdir" => {
                    let out = invoke!("workdir", call_get_workdir)?;
                    encode_method_result(&self.spawn.plugin_id, method, out)
                }
                "current_branch" => {
                    let out = invoke!("current_branch", call_get_current_branch)?;
                    encode_method_result(&self.spawn.plugin_id, method, out)
                }
                "branches" => {
                    let out = invoke!("branches", call_list_branches)?;
                    let normalized = out
                        .into_iter()
                        .map(|item| {
                            let kind = match item.kind {
                                vcs_api::BranchKind::Local => {
                                    serde_json::json!({ "type": "Local" })
                                }
                                vcs_api::BranchKind::Remote(remote) => {
                                    serde_json::json!({ "type": "Remote", "remote": remote })
                                }
                                vcs_api::BranchKind::Unknown => {
                                    serde_json::json!({ "type": "Unknown" })
                                }
                            };
                            serde_json::json!({
                                "name": item.name,
                                "full_ref": item.full_ref,
                                "kind": kind,
                                "current": item.current,
                            })
                        })
                        .collect::<Vec<_>>();
                    encode_method_result(&self.spawn.plugin_id, method, normalized)
                }
                "local_branches" => {
                    let out = invoke!("local_branches", call_list_local_branches)?;
                    encode_method_result(&self.spawn.plugin_id, method, out)
                }
                "create_branch" => {
                    #[derive(serde::Deserialize)]
                    struct Params {
                        name: String,
                        checkout: bool,
                    }
                    let p: Params = parse_method_params(method, params)?;
                    let out = invoke!("create_branch", call_create_branch, &p.name, p.checkout)?;
                    encode_method_result(&self.spawn.plugin_id, method, out)
                }
                "checkout_branch" => {
                    #[derive(serde::Deserialize)]
                    struct Params {
                        name: String,
                    }
                    let p: Params = parse_method_params(method, params)?;
                    let out = invoke!("checkout_branch", call_checkout_branch, &p.name)?;
                    encode_method_result(&self.spawn.plugin_id, method, out)
                }
                "ensure_remote" => {
                    #[derive(serde::Deserialize)]
                    struct Params {
                        name: String,
                        url: String,
                    }
                    let p: Params = parse_method_params(method, params)?;
                    let out = invoke!("ensure_remote", call_ensure_remote, &p.name, &p.url)?;
                    encode_method_result(&self.spawn.plugin_id, method, out)
                }
                "list_remotes" => {
                    let out = invoke!("list_remotes", call_list_remotes)?;
                    let remotes = out
                        .into_iter()
                        .map(|entry| (entry.name, entry.url))
                        .collect::<Vec<(String, String)>>();
                    encode_method_result(&self.spawn.plugin_id, method, remotes)
                }
                "remove_remote" => {
                    #[derive(serde::Deserialize)]
                    struct Params {
                        name: String,
                    }
                    let p: Params = parse_method_params(method, params)?;
                    let out = invoke!("remove_remote", call_remove_remote, &p.name)?;
                    encode_method_result(&self.spawn.plugin_id, method, out)
                }
                "fetch" => {
                    #[derive(serde::Deserialize)]
                    struct Params {
                        remote: String,
                        refspec: String,
                    }
                    let p: Params = parse_method_params(method, params)?;
                    let out = invoke!("fetch", call_fetch, &p.remote, &p.refspec)?;
                    encode_method_result(&self.spawn.plugin_id, method, out)
                }
                "fetch_with_options" => {
                    #[derive(serde::Deserialize)]
                    struct Params {
                        remote: String,
                        refspec: String,
                        opts: vcs_api::FetchOptions,
                    }
                    let p: Params = parse_method_params(method, params)?;
                    let out = invoke!(
                        "fetch_with_options",
                        call_fetch_with_options,
                        &p.remote,
                        &p.refspec,
                        p.opts
                    )?;
                    encode_method_result(&self.spawn.plugin_id, method, out)
                }
                "push" => {
                    #[derive(serde::Deserialize)]
                    struct Params {
                        remote: String,
                        refspec: String,
                    }
                    let p: Params = parse_method_params(method, params)?;
                    let out = invoke!("push", call_push, &p.remote, &p.refspec)?;
                    encode_method_result(&self.spawn.plugin_id, method, out)
                }
                "pull_ff_only" => {
                    #[derive(serde::Deserialize)]
                    struct Params {
                        remote: String,
                        branch: String,
                    }
                    let p: Params = parse_method_params(method, params)?;
                    let out = invoke!("pull_ff_only", call_pull_ff_only, &p.remote, &p.branch)?;
                    encode_method_result(&self.spawn.plugin_id, method, out)
                }
                "commit" => {
                    #[derive(serde::Deserialize)]
                    struct Params {
                        message: String,
                        name: String,
                        email: String,
                        paths: Vec<String>,
                    }
                    let p: Params = parse_method_params(method, params)?;
                    let out =
                        invoke!("commit", call_commit, &p.message, &p.name, &p.email, &p.paths)?;
                    encode_method_result(&self.spawn.plugin_id, method, out)
                }
                "commit_index" => {
                    #[derive(serde::Deserialize)]
                    struct Params {
                        message: String,
                        name: String,
                        email: String,
                    }
                    let p: Params = parse_method_params(method, params)?;
                    let out =
                        invoke!("commit_index", call_commit_index, &p.message, &p.name, &p.email)?;
                    encode_method_result(&self.spawn.plugin_id, method, out)
                }
                "status_summary" => {
                    let out = invoke!("status_summary", call_get_status_summary)?;
                    encode_method_result(&self.spawn.plugin_id, method, out)
                }
                "status_payload" => {
                    let out = invoke!("status_payload", call_get_status_payload)?;
                    encode_method_result(&self.spawn.plugin_id, method, out)
                }
                "log_commits" => {
                    #[derive(serde::Deserialize)]
                    struct Params {
                        query: vcs_api::LogQuery,
                    }
                    let p: Params = parse_method_params(method, params)?;
                    let out = invoke!("log_commits", call_list_commits, &p.query)?;
                    encode_method_result(&self.spawn.plugin_id, method, out)
                }
                "diff_file" => {
                    #[derive(serde::Deserialize)]
                    struct Params {
                        path: String,
                    }
                    let p: Params = parse_method_params(method, params)?;
                    let out = invoke!("diff_file", call_diff_file, &p.path)?;
                    encode_method_result(&self.spawn.plugin_id, method, out)
                }
                "diff_commit" => {
                    #[derive(serde::Deserialize)]
                    struct Params {
                        rev: String,
                    }
                    let p: Params = parse_method_params(method, params)?;
                    let out = invoke!("diff_commit", call_diff_commit, &p.rev)?;
                    encode_method_result(&self.spawn.plugin_id, method, out)
                }
                "conflict_details" => {
                    #[derive(serde::Deserialize)]
                    struct Params {
                        path: String,
                    }
                    let p: Params = parse_method_params(method, params)?;
                    let out = invoke!("conflict_details", call_get_conflict_details, &p.path)?;
                    encode_method_result(&self.spawn.plugin_id, method, out)
                }
                "checkout_conflict_side" => {
                    #[derive(serde::Deserialize)]
                    struct Params {
                        path: String,
                        side: vcs_api::ConflictSide,
                    }
                    let p: Params = parse_method_params(method, params)?;
                    let out = invoke!(
                        "checkout_conflict_side",
                        call_checkout_conflict_side,
                        &p.path,
                        p.side
                    )?;
                    encode_method_result(&self.spawn.plugin_id, method, out)
                }
                "write_merge_result" => {
                    #[derive(serde::Deserialize)]
                    struct Params {
                        path: String,
                        content: String,
                    }
                    let p: Params = parse_method_params(method, params)?;
                    let out = invoke!(
                        "write_merge_result",
                        call_write_merge_result,
                        &p.path,
                        p.content.as_bytes()
                    )?;
                    encode_method_result(&self.spawn.plugin_id, method, out)
                }
                "stage_patch" => {
                    #[derive(serde::Deserialize)]
                    struct Params {
                        patch: String,
                    }
                    let p: Params = parse_method_params(method, params)?;
                    let out = invoke!("stage_patch", call_stage_patch, &p.patch)?;
                    encode_method_result(&self.spawn.plugin_id, method, out)
                }
                "discard_paths" => {
                    #[derive(serde::Deserialize)]
                    struct Params {
                        paths: Vec<String>,
                    }
                    let p: Params = parse_method_params(method, params)?;
                    let out = invoke!("discard_paths", call_discard_paths, &p.paths)?;
                    encode_method_result(&self.spawn.plugin_id, method, out)
                }
                "apply_reverse_patch" => {
                    #[derive(serde::Deserialize)]
                    struct Params {
                        patch: String,
                    }
                    let p: Params = parse_method_params(method, params)?;
                    let out = invoke!("apply_reverse_patch", call_apply_reverse_patch, &p.patch)?;
                    encode_method_result(&self.spawn.plugin_id, method, out)
                }
                "delete_branch" => {
                    #[derive(serde::Deserialize)]
                    struct Params {
                        name: String,
                        force: bool,
                    }
                    let p: Params = parse_method_params(method, params)?;
                    let out = invoke!("delete_branch", call_delete_branch, &p.name, p.force)?;
                    encode_method_result(&self.spawn.plugin_id, method, out)
                }
                "rename_branch" => {
                    #[derive(serde::Deserialize)]
                    struct Params {
                        old: String,
                        new: String,
                    }
                    let p: Params = parse_method_params(method, params)?;
                    let out = invoke!("rename_branch", call_rename_branch, &p.old, &p.new)?;
                    encode_method_result(&self.spawn.plugin_id, method, out)
                }
                "merge_into_current" => {
                    #[derive(serde::Deserialize)]
                    struct Params {
                        name: String,
                        #[serde(default)]
                        message: Option<String>,
                    }
                    let p: Params = parse_method_params(method, params)?;
                    let out = invoke!(
                        "merge_into_current",
                        call_merge_into_current,
                        &p.name,
                        p.message.as_deref()
                    )?;
                    encode_method_result(&self.spawn.plugin_id, method, out)
                }
                "merge_abort" => {
                    let out = invoke!("merge_abort", call_merge_abort)?;
                    encode_method_result(&self.spawn.plugin_id, method, out)
                }
                "merge_continue" => {
                    let out = invoke!("merge_continue", call_merge_continue)?;
                    encode_method_result(&self.spawn.plugin_id, method, out)
                }
                "merge_in_progress" => {
                    let out = invoke!("merge_in_progress", call_is_merge_in_progress)?;
                    encode_method_result(&self.spawn.plugin_id, method, out)
                }
                "set_branch_upstream" => {
                    #[derive(serde::Deserialize)]
                    struct Params {
                        branch: String,
                        upstream: String,
                    }
                    let p: Params = parse_method_params(method, params)?;
                    let out = invoke!(
                        "set_branch_upstream",
                        call_set_branch_upstream,
                        &p.branch,
                        &p.upstream
                    )?;
                    encode_method_result(&self.spawn.plugin_id, method, out)
                }
                "branch_upstream" => {
                    #[derive(serde::Deserialize)]
                    struct Params {
                        branch: String,
                    }
                    let p: Params = parse_method_params(method, params)?;
                    let out = invoke!("branch_upstream", call_get_branch_upstream, &p.branch)?;
                    encode_method_result(&self.spawn.plugin_id, method, out)
                }
                "hard_reset_head" => {
                    let out = invoke!("hard_reset_head", call_hard_reset_head)?;
                    encode_method_result(&self.spawn.plugin_id, method, out)
                }
                "reset_soft_to" => {
                    #[derive(serde::Deserialize)]
                    struct Params {
                        rev: String,
                    }
                    let p: Params = parse_method_params(method, params)?;
                    let out = invoke!("reset_soft_to", call_reset_soft_to, &p.rev)?;
                    encode_method_result(&self.spawn.plugin_id, method, out)
                }
                "get_identity" => {
                    let out = invoke!("get_identity", call_get_identity)?;
                    let mapped = out.map(|identity| (identity.name, identity.email));
                    encode_method_result(&self.spawn.plugin_id, method, mapped)
                }
                "set_identity_local" => {
                    #[derive(serde::Deserialize)]
                    struct Params {
                        name: String,
                        email: String,
                    }
                    let p: Params = parse_method_params(method, params)?;
                    let out =
                        invoke!("set_identity_local", call_set_identity_local, &p.name, &p.email)?;
                    encode_method_result(&self.spawn.plugin_id, method, out)
                }
                "stash_list" => {
                    let out = invoke!("stash_list", call_list_stashes)?;
                    encode_method_result(&self.spawn.plugin_id, method, out)
                }
                "stash_push" => {
                    #[derive(serde::Deserialize)]
                    struct Params {
                        #[serde(default)]
                        message: Option<String>,
                        #[serde(default)]
                        include_untracked: bool,
                    }
                    let p: Params = parse_method_params(method, params)?;
                    let out = invoke!(
                        "stash_push",
                        call_stash_push,
                        p.message.as_deref(),
                        p.include_untracked
                    )?;
                    encode_method_result(&self.spawn.plugin_id, method, out)
                }
                "stash_apply" => {
                    #[derive(serde::Deserialize)]
                    struct Params {
                        selector: String,
                    }
                    let p: Params = parse_method_params(method, params)?;
                    let out = invoke!("stash_apply", call_stash_apply, &p.selector)?;
                    encode_method_result(&self.spawn.plugin_id, method, out)
                }
                "stash_pop" => {
                    #[derive(serde::Deserialize)]
                    struct Params {
                        selector: String,
                    }
                    let p: Params = parse_method_params(method, params)?;
                    let out = invoke!("stash_pop", call_stash_pop, &p.selector)?;
                    encode_method_result(&self.spawn.plugin_id, method, out)
                }
                "stash_drop" => {
                    #[derive(serde::Deserialize)]
                    struct Params {
                        selector: String,
                    }
                    let p: Params = parse_method_params(method, params)?;
                    let out = invoke!("stash_drop", call_stash_drop, &p.selector)?;
                    encode_method_result(&self.spawn.plugin_id, method, out)
                }
                "stash_show" => {
                    #[derive(serde::Deserialize)]
                    struct Params {
                        selector: String,
                    }
                    let p: Params = parse_method_params(method, params)?;
                    let out = invoke!("stash_show", call_stash_show, &p.selector)?;
                    encode_method_result(&self.spawn.plugin_id, method, out)
                }
                "cherry_pick" => {
                    #[derive(serde::Deserialize)]
                    struct Params {
                        #[serde(default)]
                        commit: Option<String>,
                        #[serde(default)]
                        rev: Option<String>,
                    }
                    let p: Params = parse_method_params(method, params)?;
                    let commit = p
                        .commit
                        .or(p.rev)
                        .ok_or_else(|| "missing `commit`/`rev`".to_string())?;
                    let out = invoke!("cherry_pick", call_cherry_pick, &commit)?;
                    encode_method_result(&self.spawn.plugin_id, method, out)
                }
                "revert_commit" => {
                    #[derive(serde::Deserialize)]
                    struct Params {
                        #[serde(default)]
                        commit: Option<String>,
                        #[serde(default)]
                        rev: Option<String>,
                        #[serde(default)]
                        no_edit: bool,
                    }
                    let p: Params = parse_method_params(method, params)?;
                    let commit = p
                        .commit
                        .or(p.rev)
                        .ok_or_else(|| "missing `commit`/`rev`".to_string())?;
                    let out = invoke!("revert_commit", call_revert_commit, &commit, p.no_edit)?;
                    encode_method_result(&self.spawn.plugin_id, method, out)
                }
                _ => Err(format!(
                    "component method `{method}` is not part of the v1 ABI contract for plugin `{}`",
                    self.spawn.plugin_id
                )),
            }
        })
    }

    /// Deinitializes and drops the running component runtime.
    fn stop(&self) {
        let mut lock = self.runtime.lock();
        if let Some(runtime) = lock.as_mut() {
            let _ = runtime
                .bindings
                .openvcs_plugin_plugin_api()
                .call_deinit(&mut runtime.store);
        }
        *lock = None;
    }
}
