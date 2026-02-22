// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later
use std::sync::OnceLock;

use crate::plugin_runtime::host_api::{
    host_emit_event, host_get_status, host_process_exec, host_runtime_info, host_set_status,
    host_subscribe_event, host_ui_notify, host_workspace_read_file, host_workspace_write_file,
};
use crate::plugin_runtime::instance::PluginRuntimeInstance;
use crate::plugin_runtime::settings_store;
use crate::plugin_runtime::spawn::SpawnConfig;
use openvcs_core::models::{
    BranchItem, BranchKind, Capabilities, CommitItem, ConflictDetails, ConflictSide, FetchOptions,
    LogQuery, StashItem, StatusPayload, StatusSummary,
};
use openvcs_core::settings::{SettingKv, SettingValue};
use openvcs_core::ui::{Menu, UiButton, UiElement, UiText};
use parking_lot::Mutex;
use wasmtime::component::{Component, Linker, ResourceTable};
use wasmtime::{Cache, CacheConfig, Config, Engine, Store};
use wasmtime_wasi::{WasiCtx, WasiCtxView, WasiView};

static WASMTIME_ENGINE: OnceLock<Engine> = OnceLock::new();

fn get_wasmtime_engine() -> &'static Engine {
    WASMTIME_ENGINE.get_or_init(|| {
        let cache_config = CacheConfig::new();
        let cache = Cache::new(cache_config).expect("create wasmtime cache");
        let mut config = Config::default();
        config.cache(Some(cache));
        Engine::new(&config).expect("create wasmtime engine")
    })
}

mod bindings_vcs {
    wasmtime::component::bindgen!({
        path: "../../Core/wit",
        world: "vcs",
        additional_derives: [serde::Serialize, serde::Deserialize],
    });
}

mod bindings_plugin {
    wasmtime::component::bindgen!({
        path: "../../Core/wit",
        world: "plugin",
        additional_derives: [serde::Serialize, serde::Deserialize],
    });
}

use bindings_plugin::exports::openvcs::plugin::plugin_api;
use bindings_plugin::exports::openvcs::plugin::plugin_api as vcs_settings_api;
use bindings_vcs::exports::openvcs::plugin::vcs_api;

/// Typed bindings handle selected for the running plugin world.
enum ComponentBindings {
    /// Bindings for plugins exporting the `plugin` world.
    Plugin(bindings_plugin::Plugin),
}

/// Live component instance plus generated bindings handle.
struct ComponentRuntime {
    /// Wasmtime store containing component state and host context.
    store: Store<ComponentHostState>,
    /// Generated typed binding entrypoints for the plugin world.
    bindings: ComponentBindings,
}

impl ComponentRuntime {
    /// Calls plugin `init` for whichever world is currently loaded.
    fn call_init(&mut self, plugin_id: &str) -> Result<(), String> {
        match &self.bindings {
            ComponentBindings::Plugin(bindings) => bindings
                .openvcs_plugin_plugin_api()
                .call_init(&mut self.store)
                .map_err(|e| format!("component init trap for {}: {e}", plugin_id))?
                .map_err(|e| format!("component init failed for {}: {}", plugin_id, e.message)),
        }
    }

    /// Calls plugin `deinit` for whichever world is currently loaded.
    fn call_deinit(&mut self) {
        match &self.bindings {
            ComponentBindings::Plugin(bindings) => {
                let _ = bindings
                    .openvcs_plugin_plugin_api()
                    .call_deinit(&mut self.store);
            }
        }
    }

    /// Returns plugin-contributed menus for v1.1 plugins.
    fn call_get_menus(&mut self, plugin_id: &str) -> Result<Vec<Menu>, String> {
        let bindings = match &self.bindings {
            ComponentBindings::Plugin(bindings) => bindings,
            _ => return Ok(Vec::new()),
        };
        let menus = bindings
            .openvcs_plugin_plugin_api()
            .call_get_menus(&mut self.store)
            .map_err(|e| format!("component get-menus trap for {}: {e}", plugin_id))?
            .map_err(|e| {
                format!(
                    "component get-menus failed for {}: {}",
                    plugin_id, e.message
                )
            })?;
        Ok(menus.into_iter().map(map_menu_from_wit).collect())
    }

    /// Invokes a plugin action for v1.1 plugins.
    fn call_handle_action(&mut self, plugin_id: &str, id: &str) -> Result<(), String> {
        let bindings = match &self.bindings {
            ComponentBindings::Plugin(bindings) => bindings,
            _ => return Ok(()),
        };
        bindings
            .openvcs_plugin_plugin_api()
            .call_handle_action(&mut self.store, id)
            .map_err(|e| format!("component handle-action trap for {}: {e}", plugin_id))?
            .map_err(|e| {
                format!(
                    "component handle-action failed for {}: {}",
                    plugin_id, e.message
                )
            })
    }

    /// Returns plugin settings defaults for v1.1 plugins.
    fn call_settings_defaults(&mut self, plugin_id: &str) -> Result<Vec<SettingKv>, String> {
        match &self.bindings {
            ComponentBindings::Plugin(bindings) => {
                let values = bindings
                    .openvcs_plugin_plugin_api()
                    .call_settings_defaults(&mut self.store)
                    .map_err(|e| {
                        format!("component settings-defaults trap for {}: {e}", plugin_id)
                    })?
                    .map_err(|e| {
                        format!(
                            "component settings-defaults failed for {}: {}",
                            plugin_id, e.message
                        )
                    })?;
                Ok(values.into_iter().map(map_setting_from_wit).collect())
            }
        }
    }

    /// Calls plugin settings-on-load hook for v1.1 plugins.
    fn call_settings_on_load(
        &mut self,
        plugin_id: &str,
        values: Vec<SettingKv>,
    ) -> Result<Vec<SettingKv>, String> {
        match &self.bindings {
            ComponentBindings::Plugin(bindings) => {
                let values = values
                    .into_iter()
                    .map(map_setting_to_wit)
                    .collect::<Vec<_>>();
                let out = bindings
                    .openvcs_plugin_plugin_api()
                    .call_settings_on_load(&mut self.store, &values)
                    .map_err(|e| format!("component settings-on-load trap for {}: {e}", plugin_id))?
                    .map_err(|e| {
                        format!(
                            "component settings-on-load failed for {}: {}",
                            plugin_id, e.message
                        )
                    })?;
                Ok(out.into_iter().map(map_setting_from_wit).collect())
            }
        }
    }

    /// Calls plugin settings-on-apply hook for v1.1 plugins.
    fn call_settings_on_apply(
        &mut self,
        plugin_id: &str,
        values: Vec<SettingKv>,
    ) -> Result<(), String> {
        match &self.bindings {
            ComponentBindings::Plugin(bindings) => {
                let values = values
                    .into_iter()
                    .map(map_setting_to_wit)
                    .collect::<Vec<_>>();
                bindings
                    .openvcs_plugin_plugin_api()
                    .call_settings_on_apply(&mut self.store, &values)
                    .map_err(|e| {
                        format!("component settings-on-apply trap for {}: {e}", plugin_id)
                    })?
                    .map_err(|e| {
                        format!(
                            "component settings-on-apply failed for {}: {}",
                            plugin_id, e.message
                        )
                    })
            }
        }
    }

    /// Calls plugin settings-on-save hook for v1.1 plugins.
    fn call_settings_on_save(
        &mut self,
        plugin_id: &str,
        values: Vec<SettingKv>,
    ) -> Result<Vec<SettingKv>, String> {
        match &self.bindings {
            ComponentBindings::Plugin(bindings) => {
                let values = values
                    .into_iter()
                    .map(map_setting_to_wit)
                    .collect::<Vec<_>>();
                let out = bindings
                    .openvcs_plugin_plugin_api()
                    .call_settings_on_save(&mut self.store, &values)
                    .map_err(|e| format!("component settings-on-save trap for {}: {e}", plugin_id))?
                    .map_err(|e| {
                        format!(
                            "component settings-on-save failed for {}: {}",
                            plugin_id, e.message
                        )
                    })?;
                Ok(out.into_iter().map(map_setting_from_wit).collect())
            }
        }
    }

    /// Calls plugin settings-on-reset hook for v1.1 plugins.
    fn call_settings_on_reset(&mut self, plugin_id: &str) -> Result<(), String> {
        match &self.bindings {
            ComponentBindings::Plugin(bindings) => bindings
                .openvcs_plugin_plugin_api()
                .call_settings_on_reset(&mut self.store)
                .map_err(|e| format!("component settings-on-reset trap for {}: {e}", plugin_id))?
                .map_err(|e| {
                    format!(
                        "component settings-on-reset failed for {}: {}",
                        plugin_id, e.message
                    )
                }),
        }
    }
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
    fn map_host_error_vcs(
        err: openvcs_core::app_api::PluginError,
    ) -> bindings_vcs::openvcs::plugin::host_api::HostError {
        bindings_vcs::openvcs::plugin::host_api::HostError {
            code: err.code,
            message: err.message,
        }
    }

    /// Converts core host errors into generated WIT host error type.
    fn map_host_error_plugin(
        err: openvcs_core::app_api::PluginError,
    ) -> bindings_plugin::openvcs::plugin::host_api::HostError {
        bindings_plugin::openvcs::plugin::host_api::HostError {
            code: err.code,
            message: err.message,
        }
    }
}

impl bindings_vcs::openvcs::plugin::host_api::Host for ComponentHostState {
    fn get_runtime_info(
        &mut self,
    ) -> Result<
        bindings_vcs::openvcs::plugin::host_api::RuntimeInfo,
        bindings_vcs::openvcs::plugin::host_api::HostError,
    > {
        let value = host_runtime_info();
        Ok(bindings_vcs::openvcs::plugin::host_api::RuntimeInfo {
            os: value.os,
            arch: value.arch,
            container: value.container,
        })
    }

    fn subscribe_event(
        &mut self,
        event_name: String,
    ) -> Result<(), bindings_vcs::openvcs::plugin::host_api::HostError> {
        host_subscribe_event(&self.spawn, &event_name)
            .map_err(ComponentHostState::map_host_error_vcs)
    }

    fn emit_event(
        &mut self,
        event_name: String,
        payload: Vec<u8>,
    ) -> Result<(), bindings_vcs::openvcs::plugin::host_api::HostError> {
        host_emit_event(&self.spawn, &event_name, &payload)
            .map_err(ComponentHostState::map_host_error_vcs)
    }

    fn ui_notify(
        &mut self,
        message: String,
    ) -> Result<(), bindings_vcs::openvcs::plugin::host_api::HostError> {
        host_ui_notify(&self.spawn, &message).map_err(ComponentHostState::map_host_error_vcs)
    }

    fn set_status(
        &mut self,
        message: String,
    ) -> Result<(), bindings_vcs::openvcs::plugin::host_api::HostError> {
        host_set_status(&self.spawn, &message).map_err(ComponentHostState::map_host_error_vcs)
    }

    fn get_status(&mut self) -> Result<String, bindings_vcs::openvcs::plugin::host_api::HostError> {
        host_get_status(&self.spawn).map_err(ComponentHostState::map_host_error_vcs)
    }

    fn workspace_read_file(
        &mut self,
        path: String,
    ) -> Result<Vec<u8>, bindings_vcs::openvcs::plugin::host_api::HostError> {
        host_workspace_read_file(&self.spawn, &path).map_err(ComponentHostState::map_host_error_vcs)
    }

    fn workspace_write_file(
        &mut self,
        path: String,
        content: Vec<u8>,
    ) -> Result<(), bindings_vcs::openvcs::plugin::host_api::HostError> {
        host_workspace_write_file(&self.spawn, &path, &content)
            .map_err(ComponentHostState::map_host_error_vcs)
    }

    fn process_exec(
        &mut self,
        cwd: Option<String>,
        program: String,
        args: Vec<String>,
        env: Vec<bindings_vcs::openvcs::plugin::host_api::EnvVar>,
        stdin: Option<String>,
    ) -> Result<
        bindings_vcs::openvcs::plugin::host_api::ProcessExecOutput,
        bindings_vcs::openvcs::plugin::host_api::HostError,
    > {
        let env = env
            .into_iter()
            .map(|var| (var.key, var.value))
            .collect::<Vec<_>>();
        let value = host_process_exec(
            &self.spawn,
            cwd.as_deref(),
            &program,
            &args,
            &env,
            stdin.as_deref(),
        )
        .map_err(ComponentHostState::map_host_error_vcs)?;
        Ok(bindings_vcs::openvcs::plugin::host_api::ProcessExecOutput {
            success: value.success,
            status: value.status,
            stdout: value.stdout,
            stderr: value.stderr,
        })
    }

    fn host_log(
        &mut self,
        level: bindings_vcs::openvcs::plugin::host_api::LogLevel,
        target: String,
        message: String,
    ) {
        let target = if target.trim().is_empty() {
            format!("plugin.{}", self.spawn.plugin_id)
        } else {
            format!("plugin.{}.{}", self.spawn.plugin_id, target)
        };

        match level {
            bindings_vcs::openvcs::plugin::host_api::LogLevel::Trace => {
                log::trace!(target: &target, "{message}")
            }
            bindings_vcs::openvcs::plugin::host_api::LogLevel::Debug => {
                log::debug!(target: &target, "{message}")
            }
            bindings_vcs::openvcs::plugin::host_api::LogLevel::Info => {
                log::info!(target: &target, "{message}")
            }
            bindings_vcs::openvcs::plugin::host_api::LogLevel::Warn => {
                log::warn!(target: &target, "{message}")
            }
            bindings_vcs::openvcs::plugin::host_api::LogLevel::Error => {
                log::error!(target: &target, "{message}")
            }
        };
    }
}

impl bindings_plugin::openvcs::plugin::host_api::Host for ComponentHostState {
    fn get_runtime_info(
        &mut self,
    ) -> Result<
        bindings_plugin::openvcs::plugin::host_api::RuntimeInfo,
        bindings_plugin::openvcs::plugin::host_api::HostError,
    > {
        let value = host_runtime_info();
        Ok(bindings_plugin::openvcs::plugin::host_api::RuntimeInfo {
            os: value.os,
            arch: value.arch,
            container: value.container,
        })
    }

    fn subscribe_event(
        &mut self,
        event_name: String,
    ) -> Result<(), bindings_plugin::openvcs::plugin::host_api::HostError> {
        host_subscribe_event(&self.spawn, &event_name)
            .map_err(ComponentHostState::map_host_error_plugin)
    }

    fn emit_event(
        &mut self,
        event_name: String,
        payload: Vec<u8>,
    ) -> Result<(), bindings_plugin::openvcs::plugin::host_api::HostError> {
        host_emit_event(&self.spawn, &event_name, &payload)
            .map_err(ComponentHostState::map_host_error_plugin)
    }

    fn ui_notify(
        &mut self,
        message: String,
    ) -> Result<(), bindings_plugin::openvcs::plugin::host_api::HostError> {
        host_ui_notify(&self.spawn, &message).map_err(ComponentHostState::map_host_error_plugin)
    }

    fn set_status(
        &mut self,
        message: String,
    ) -> Result<(), bindings_plugin::openvcs::plugin::host_api::HostError> {
        host_set_status(&self.spawn, &message).map_err(ComponentHostState::map_host_error_plugin)
    }

    fn get_status(
        &mut self,
    ) -> Result<String, bindings_plugin::openvcs::plugin::host_api::HostError> {
        host_get_status(&self.spawn).map_err(ComponentHostState::map_host_error_plugin)
    }

    fn workspace_read_file(
        &mut self,
        path: String,
    ) -> Result<Vec<u8>, bindings_plugin::openvcs::plugin::host_api::HostError> {
        host_workspace_read_file(&self.spawn, &path)
            .map_err(ComponentHostState::map_host_error_plugin)
    }

    fn workspace_write_file(
        &mut self,
        path: String,
        content: Vec<u8>,
    ) -> Result<(), bindings_plugin::openvcs::plugin::host_api::HostError> {
        host_workspace_write_file(&self.spawn, &path, &content)
            .map_err(ComponentHostState::map_host_error_plugin)
    }

    fn process_exec(
        &mut self,
        cwd: Option<String>,
        program: String,
        args: Vec<String>,
        env: Vec<bindings_plugin::openvcs::plugin::host_api::EnvVar>,
        stdin: Option<String>,
    ) -> Result<
        bindings_plugin::openvcs::plugin::host_api::ProcessExecOutput,
        bindings_plugin::openvcs::plugin::host_api::HostError,
    > {
        let env = env
            .into_iter()
            .map(|var| (var.key, var.value))
            .collect::<Vec<_>>();
        let value = host_process_exec(
            &self.spawn,
            cwd.as_deref(),
            &program,
            &args,
            &env,
            stdin.as_deref(),
        )
        .map_err(ComponentHostState::map_host_error_plugin)?;
        Ok(
            bindings_plugin::openvcs::plugin::host_api::ProcessExecOutput {
                success: value.success,
                status: value.status,
                stdout: value.stdout,
                stderr: value.stderr,
            },
        )
    }

    fn host_log(
        &mut self,
        level: bindings_plugin::openvcs::plugin::host_api::LogLevel,
        target: String,
        message: String,
    ) {
        let target = if target.trim().is_empty() {
            format!("plugin.{}", self.spawn.plugin_id)
        } else {
            format!("plugin.{}.{}", self.spawn.plugin_id, target)
        };

        match level {
            bindings_plugin::openvcs::plugin::host_api::LogLevel::Trace => {
                log::trace!(target: &target, "{message}")
            }
            bindings_plugin::openvcs::plugin::host_api::LogLevel::Debug => {
                log::debug!(target: &target, "{message}")
            }
            bindings_plugin::openvcs::plugin::host_api::LogLevel::Info => {
                log::info!(target: &target, "{message}")
            }
            bindings_plugin::openvcs::plugin::host_api::LogLevel::Warn => {
                log::warn!(target: &target, "{message}")
            }
            bindings_plugin::openvcs::plugin::host_api::LogLevel::Error => {
                log::error!(target: &target, "{message}")
            }
        };
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
        let engine = get_wasmtime_engine();
        let component = Component::from_file(engine, &self.spawn.exec_path)
            .map_err(|e| format!("load component {}: {e}", self.spawn.exec_path.display()))?;
        let mut linker = Linker::new(engine);
        wasmtime_wasi::p2::add_to_linker_sync(&mut linker)
            .map_err(|e| format!("link wasi imports: {e}"))?;
        let mut store = Store::new(
            engine,
            ComponentHostState {
                spawn: self.spawn.clone(),
                table: ResourceTable::new(),
                wasi: WasiCtx::builder().build(),
            },
        );
        let bindings = {
            bindings_plugin::Plugin::add_to_linker::<
                ComponentHostState,
                wasmtime::component::HasSelf<ComponentHostState>,
            >(&mut linker, |state| state)
            .map_err(|e| format!("link host imports: {e}"))?;

            match bindings_plugin::Plugin::instantiate(&mut store, &component, &linker) {
                Ok(v11) => ComponentBindings::Plugin(v11),
                Err(_) => {
                    let mut fallback_linker = Linker::new(engine);
                    wasmtime_wasi::p2::add_to_linker_sync(&mut fallback_linker)
                        .map_err(|e| format!("link wasi imports: {e}"))?;
                    bindings_plugin::Plugin::add_to_linker::<
                        ComponentHostState,
                        wasmtime::component::HasSelf<ComponentHostState>,
                    >(&mut fallback_linker, |state| state)
                    .map_err(|e| format!("link host imports: {e}"))?;
                    ComponentBindings::Plugin(
                        bindings_plugin::Plugin::instantiate(
                            &mut store,
                            &component,
                            &fallback_linker,
                        )
                        .map_err(|e| {
                            format!("instantiate component {}: {e}", self.spawn.plugin_id)
                        })?,
                    )
                }
            }
        };

        let mut runtime = ComponentRuntime { store, bindings };
        runtime.call_init(&self.spawn.plugin_id)?;
        self.apply_persisted_settings(&mut runtime)?;
        Ok(runtime)
    }

    /// Loads and applies persisted plugin settings for v1.1 plugins.
    fn apply_persisted_settings(&self, runtime: &mut ComponentRuntime) -> Result<(), String> {
        if !matches!(runtime.bindings, ComponentBindings::Plugin(_)) {
            return Ok(());
        }

        let defaults = runtime.call_settings_defaults(&self.spawn.plugin_id)?;
        let mut values = defaults.clone();
        let loaded = settings_store::load_settings(&self.spawn.plugin_id)?;

        for entry in &mut values {
            if let Some(raw) = loaded.get(&entry.id) {
                if let Some(mapped) = setting_from_json_value(raw, &entry.value) {
                    entry.value = mapped;
                }
            }
        }

        let values = runtime.call_settings_on_load(&self.spawn.plugin_id, values)?;
        runtime.call_settings_on_apply(&self.spawn.plugin_id, values.clone())?;
        settings_store::save_settings(&self.spawn.plugin_id, &settings_to_json_map(&values))
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

    /// Runs a closure with VCS bindings for VCS backend plugins.
    /// NOTE: Currently VCS backends use plugin world, so this needs architectural changes.
    fn with_vcs_bindings<T>(
        &self,
        method: &str,
        _f: impl FnOnce(&bindings_vcs::Vcs, &mut Store<ComponentHostState>) -> Result<T, String>,
    ) -> Result<T, String> {
        Err(format!(
            "VCS operations not yet supported for plugin world-based VCS backends: {}",
            method
        ))
    }

    /// Converts nested trap/plugin results into backend error strings.
    fn map_vcs_result<T, E: std::fmt::Display>(
        &self,
        method: &str,
        out: Result<Result<T, vcs_api::PluginError>, E>,
    ) -> Result<T, String> {
        out.map_err(|e| {
            format!(
                "component call trap for {}.{}: {e}",
                self.spawn.plugin_id, method
            )
        })?
        .map_err(|e| {
            format!(
                "component call failed for {}.{}: {}: {}",
                self.spawn.plugin_id, method, e.code, e.message
            )
        })
    }

    /// Calls typed `get-caps`.
    pub fn vcs_get_caps(&self) -> Result<Capabilities, String> {
        self.with_vcs_bindings("caps", |bindings, store| {
            let out = self.map_vcs_result(
                "caps",
                bindings.openvcs_plugin_vcs_api().call_get_caps(store),
            )?;
            Ok(Capabilities {
                commits: out.commits,
                branches: out.branches,
                tags: out.tags,
                staging: out.staging,
                push_pull: out.push_pull,
                fast_forward: out.fast_forward,
            })
        })
    }

    /// Calls typed `open`.
    pub fn vcs_open(&self, path: &str, config: &[u8]) -> Result<(), String> {
        self.with_vcs_bindings("open", |bindings, store| {
            self.map_vcs_result(
                "open",
                bindings
                    .openvcs_plugin_vcs_api()
                    .call_open(store, path, config),
            )
        })
    }

    /// Calls typed `get-current-branch`.
    pub fn vcs_get_current_branch(&self) -> Result<Option<String>, String> {
        self.with_vcs_bindings("current_branch", |bindings, store| {
            self.map_vcs_result(
                "current_branch",
                bindings
                    .openvcs_plugin_vcs_api()
                    .call_get_current_branch(store),
            )
        })
    }

    /// Calls typed `list-branches`.
    pub fn vcs_list_branches(&self) -> Result<Vec<BranchItem>, String> {
        self.with_vcs_bindings("branches", |bindings, store| {
            let out = self.map_vcs_result(
                "branches",
                bindings.openvcs_plugin_vcs_api().call_list_branches(store),
            )?;
            Ok(out
                .into_iter()
                .map(|item| BranchItem {
                    name: item.name,
                    full_ref: item.full_ref,
                    kind: match item.kind {
                        vcs_api::BranchKind::Local => BranchKind::Local,
                        vcs_api::BranchKind::Remote(remote) => BranchKind::Remote { remote },
                        vcs_api::BranchKind::Unknown => BranchKind::Unknown,
                    },
                    current: item.current,
                })
                .collect())
        })
    }

    /// Calls typed `list-local-branches`.
    pub fn vcs_list_local_branches(&self) -> Result<Vec<String>, String> {
        self.with_vcs_bindings("local_branches", |bindings, store| {
            self.map_vcs_result(
                "local_branches",
                bindings
                    .openvcs_plugin_vcs_api()
                    .call_list_local_branches(store),
            )
        })
    }

    /// Calls typed `create-branch`.
    pub fn vcs_create_branch(&self, name: &str, checkout: bool) -> Result<(), String> {
        self.with_vcs_bindings("create_branch", |bindings, store| {
            self.map_vcs_result(
                "create_branch",
                bindings
                    .openvcs_plugin_vcs_api()
                    .call_create_branch(store, name, checkout),
            )
        })
    }

    /// Calls typed `checkout-branch`.
    pub fn vcs_checkout_branch(&self, name: &str) -> Result<(), String> {
        self.with_vcs_bindings("checkout_branch", |bindings, store| {
            self.map_vcs_result(
                "checkout_branch",
                bindings
                    .openvcs_plugin_vcs_api()
                    .call_checkout_branch(store, name),
            )
        })
    }

    /// Calls typed `ensure-remote`.
    pub fn vcs_ensure_remote(&self, name: &str, url: &str) -> Result<(), String> {
        self.with_vcs_bindings("ensure_remote", |bindings, store| {
            self.map_vcs_result(
                "ensure_remote",
                bindings
                    .openvcs_plugin_vcs_api()
                    .call_ensure_remote(store, name, url),
            )
        })
    }

    /// Calls typed `list-remotes`.
    pub fn vcs_list_remotes(&self) -> Result<Vec<(String, String)>, String> {
        self.with_vcs_bindings("list_remotes", |bindings, store| {
            let out = self.map_vcs_result(
                "list_remotes",
                bindings.openvcs_plugin_vcs_api().call_list_remotes(store),
            )?;
            Ok(out
                .into_iter()
                .map(|entry| (entry.name, entry.url))
                .collect())
        })
    }

    /// Calls typed `remove-remote`.
    pub fn vcs_remove_remote(&self, name: &str) -> Result<(), String> {
        self.with_vcs_bindings("remove_remote", |bindings, store| {
            self.map_vcs_result(
                "remove_remote",
                bindings
                    .openvcs_plugin_vcs_api()
                    .call_remove_remote(store, name),
            )
        })
    }

    /// Calls typed `fetch`.
    pub fn vcs_fetch(&self, remote: &str, refspec: &str) -> Result<(), String> {
        self.with_vcs_bindings("fetch", |bindings, store| {
            self.map_vcs_result(
                "fetch",
                bindings
                    .openvcs_plugin_vcs_api()
                    .call_fetch(store, remote, refspec),
            )
        })
    }

    /// Calls typed `fetch-with-options`.
    pub fn vcs_fetch_with_options(
        &self,
        remote: &str,
        refspec: &str,
        opts: FetchOptions,
    ) -> Result<(), String> {
        self.with_vcs_bindings("fetch_with_options", |bindings, store| {
            self.map_vcs_result(
                "fetch_with_options",
                bindings.openvcs_plugin_vcs_api().call_fetch_with_options(
                    store,
                    remote,
                    refspec,
                    vcs_api::FetchOptions { prune: opts.prune },
                ),
            )
        })
    }

    /// Calls typed `push`.
    pub fn vcs_push(&self, remote: &str, refspec: &str) -> Result<(), String> {
        self.with_vcs_bindings("push", |bindings, store| {
            self.map_vcs_result(
                "push",
                bindings
                    .openvcs_plugin_vcs_api()
                    .call_push(store, remote, refspec),
            )
        })
    }

    /// Calls typed `pull-ff-only`.
    pub fn vcs_pull_ff_only(&self, remote: &str, branch: &str) -> Result<(), String> {
        self.with_vcs_bindings("pull_ff_only", |bindings, store| {
            self.map_vcs_result(
                "pull_ff_only",
                bindings
                    .openvcs_plugin_vcs_api()
                    .call_pull_ff_only(store, remote, branch),
            )
        })
    }

    /// Calls typed `commit`.
    pub fn vcs_commit(
        &self,
        message: &str,
        name: &str,
        email: &str,
        paths: &[String],
    ) -> Result<String, String> {
        self.with_vcs_bindings("commit", |bindings, store| {
            self.map_vcs_result(
                "commit",
                bindings
                    .openvcs_plugin_vcs_api()
                    .call_commit(store, message, name, email, paths),
            )
        })
    }

    /// Calls typed `commit-index`.
    pub fn vcs_commit_index(
        &self,
        message: &str,
        name: &str,
        email: &str,
    ) -> Result<String, String> {
        self.with_vcs_bindings("commit_index", |bindings, store| {
            self.map_vcs_result(
                "commit_index",
                bindings
                    .openvcs_plugin_vcs_api()
                    .call_commit_index(store, message, name, email),
            )
        })
    }

    /// Calls typed `get-status-summary`.
    pub fn vcs_get_status_summary(&self) -> Result<StatusSummary, String> {
        self.with_vcs_bindings("status_summary", |bindings, store| {
            let out = self.map_vcs_result(
                "status_summary",
                bindings
                    .openvcs_plugin_vcs_api()
                    .call_get_status_summary(store),
            )?;
            Ok(StatusSummary {
                untracked: out.untracked as usize,
                modified: out.modified as usize,
                staged: out.staged as usize,
                conflicted: out.conflicted as usize,
            })
        })
    }

    /// Calls typed `get-status-payload`.
    pub fn vcs_get_status_payload(&self) -> Result<StatusPayload, String> {
        self.with_vcs_bindings("status_payload", |bindings, store| {
            let out = self.map_vcs_result(
                "status_payload",
                bindings
                    .openvcs_plugin_vcs_api()
                    .call_get_status_payload(store),
            )?;
            Ok(StatusPayload {
                files: out
                    .files
                    .into_iter()
                    .map(|file| openvcs_core::models::FileEntry {
                        path: file.path,
                        old_path: file.old_path,
                        status: file.status,
                        staged: file.staged,
                        resolved_conflict: file.resolved_conflict,
                        hunks: file.hunks,
                    })
                    .collect(),
                ahead: out.ahead,
                behind: out.behind,
            })
        })
    }

    /// Calls typed `list-commits`.
    pub fn vcs_list_commits(&self, query: &LogQuery) -> Result<Vec<CommitItem>, String> {
        self.with_vcs_bindings("log_commits", |bindings, store| {
            let query = vcs_api::LogQuery {
                rev: query.rev.clone(),
                path: query.path.clone(),
                since_utc: query.since_utc.clone(),
                until_utc: query.until_utc.clone(),
                author_contains: query.author_contains.clone(),
                skip: query.skip,
                limit: query.limit,
                topo_order: query.topo_order,
                include_merges: query.include_merges,
            };
            let out = self.map_vcs_result(
                "log_commits",
                bindings
                    .openvcs_plugin_vcs_api()
                    .call_list_commits(store, &query),
            )?;
            Ok(out
                .into_iter()
                .map(|commit| CommitItem {
                    id: commit.id,
                    msg: commit.msg,
                    meta: commit.meta,
                    author: commit.author,
                })
                .collect())
        })
    }

    /// Calls typed `diff-file`.
    pub fn vcs_diff_file(&self, path: &str) -> Result<Vec<String>, String> {
        self.with_vcs_bindings("diff_file", |bindings, store| {
            self.map_vcs_result(
                "diff_file",
                bindings
                    .openvcs_plugin_vcs_api()
                    .call_diff_file(store, path),
            )
        })
    }

    /// Calls typed `diff-commit`.
    pub fn vcs_diff_commit(&self, rev: &str) -> Result<Vec<String>, String> {
        self.with_vcs_bindings("diff_commit", |bindings, store| {
            self.map_vcs_result(
                "diff_commit",
                bindings
                    .openvcs_plugin_vcs_api()
                    .call_diff_commit(store, rev),
            )
        })
    }

    /// Calls typed `get-conflict-details`.
    pub fn vcs_get_conflict_details(&self, path: &str) -> Result<ConflictDetails, String> {
        self.with_vcs_bindings("conflict_details", |bindings, store| {
            let out = self.map_vcs_result(
                "conflict_details",
                bindings
                    .openvcs_plugin_vcs_api()
                    .call_get_conflict_details(store, path),
            )?;
            Ok(ConflictDetails {
                path: out.path,
                ours: out.ours,
                theirs: out.theirs,
                base: out.base,
                binary: out.binary,
                lfs_pointer: out.lfs_pointer,
            })
        })
    }

    /// Calls typed `checkout-conflict-side`.
    pub fn vcs_checkout_conflict_side(&self, path: &str, side: ConflictSide) -> Result<(), String> {
        self.with_vcs_bindings("checkout_conflict_side", |bindings, store| {
            let side = match side {
                ConflictSide::Ours => vcs_api::ConflictSide::Ours,
                ConflictSide::Theirs => vcs_api::ConflictSide::Theirs,
            };
            self.map_vcs_result(
                "checkout_conflict_side",
                bindings
                    .openvcs_plugin_vcs_api()
                    .call_checkout_conflict_side(store, path, side),
            )
        })
    }

    /// Calls typed `write-merge-result`.
    pub fn vcs_write_merge_result(&self, path: &str, content: &[u8]) -> Result<(), String> {
        self.with_vcs_bindings("write_merge_result", |bindings, store| {
            self.map_vcs_result(
                "write_merge_result",
                bindings
                    .openvcs_plugin_vcs_api()
                    .call_write_merge_result(store, path, content),
            )
        })
    }

    /// Calls typed `stage-patch`.
    pub fn vcs_stage_patch(&self, patch: &str) -> Result<(), String> {
        self.with_vcs_bindings("stage_patch", |bindings, store| {
            self.map_vcs_result(
                "stage_patch",
                bindings
                    .openvcs_plugin_vcs_api()
                    .call_stage_patch(store, patch),
            )
        })
    }

    /// Calls typed `discard-paths`.
    pub fn vcs_discard_paths(&self, paths: &[String]) -> Result<(), String> {
        self.with_vcs_bindings("discard_paths", |bindings, store| {
            self.map_vcs_result(
                "discard_paths",
                bindings
                    .openvcs_plugin_vcs_api()
                    .call_discard_paths(store, paths),
            )
        })
    }

    /// Calls typed `apply-reverse-patch`.
    pub fn vcs_apply_reverse_patch(&self, patch: &str) -> Result<(), String> {
        self.with_vcs_bindings("apply_reverse_patch", |bindings, store| {
            self.map_vcs_result(
                "apply_reverse_patch",
                bindings
                    .openvcs_plugin_vcs_api()
                    .call_apply_reverse_patch(store, patch),
            )
        })
    }

    /// Calls typed `delete-branch`.
    pub fn vcs_delete_branch(&self, name: &str, force: bool) -> Result<(), String> {
        self.with_vcs_bindings("delete_branch", |bindings, store| {
            self.map_vcs_result(
                "delete_branch",
                bindings
                    .openvcs_plugin_vcs_api()
                    .call_delete_branch(store, name, force),
            )
        })
    }

    /// Calls typed `rename-branch`.
    pub fn vcs_rename_branch(&self, old: &str, new: &str) -> Result<(), String> {
        self.with_vcs_bindings("rename_branch", |bindings, store| {
            self.map_vcs_result(
                "rename_branch",
                bindings
                    .openvcs_plugin_vcs_api()
                    .call_rename_branch(store, old, new),
            )
        })
    }

    /// Calls typed `merge-into-current`.
    pub fn vcs_merge_into_current(&self, name: &str, message: Option<&str>) -> Result<(), String> {
        self.with_vcs_bindings("merge_into_current", |bindings, store| {
            self.map_vcs_result(
                "merge_into_current",
                bindings
                    .openvcs_plugin_vcs_api()
                    .call_merge_into_current(store, name, message),
            )
        })
    }

    /// Calls typed `merge-abort`.
    pub fn vcs_merge_abort(&self) -> Result<(), String> {
        self.with_vcs_bindings("merge_abort", |bindings, store| {
            self.map_vcs_result(
                "merge_abort",
                bindings.openvcs_plugin_vcs_api().call_merge_abort(store),
            )
        })
    }

    /// Calls typed `merge-continue`.
    pub fn vcs_merge_continue(&self) -> Result<(), String> {
        self.with_vcs_bindings("merge_continue", |bindings, store| {
            self.map_vcs_result(
                "merge_continue",
                bindings.openvcs_plugin_vcs_api().call_merge_continue(store),
            )
        })
    }

    /// Calls typed `is-merge-in-progress`.
    pub fn vcs_is_merge_in_progress(&self) -> Result<bool, String> {
        self.with_vcs_bindings("merge_in_progress", |bindings, store| {
            self.map_vcs_result(
                "merge_in_progress",
                bindings
                    .openvcs_plugin_vcs_api()
                    .call_is_merge_in_progress(store),
            )
        })
    }

    /// Calls typed `set-branch-upstream`.
    pub fn vcs_set_branch_upstream(&self, branch: &str, upstream: &str) -> Result<(), String> {
        self.with_vcs_bindings("set_branch_upstream", |bindings, store| {
            self.map_vcs_result(
                "set_branch_upstream",
                bindings
                    .openvcs_plugin_vcs_api()
                    .call_set_branch_upstream(store, branch, upstream),
            )
        })
    }

    /// Calls typed `get-branch-upstream`.
    pub fn vcs_get_branch_upstream(&self, branch: &str) -> Result<Option<String>, String> {
        self.with_vcs_bindings("branch_upstream", |bindings, store| {
            self.map_vcs_result(
                "branch_upstream",
                bindings
                    .openvcs_plugin_vcs_api()
                    .call_get_branch_upstream(store, branch),
            )
        })
    }

    /// Calls typed `hard-reset-head`.
    pub fn vcs_hard_reset_head(&self) -> Result<(), String> {
        self.with_vcs_bindings("hard_reset_head", |bindings, store| {
            self.map_vcs_result(
                "hard_reset_head",
                bindings
                    .openvcs_plugin_vcs_api()
                    .call_hard_reset_head(store),
            )
        })
    }

    /// Calls typed `reset-soft-to`.
    pub fn vcs_reset_soft_to(&self, rev: &str) -> Result<(), String> {
        self.with_vcs_bindings("reset_soft_to", |bindings, store| {
            self.map_vcs_result(
                "reset_soft_to",
                bindings
                    .openvcs_plugin_vcs_api()
                    .call_reset_soft_to(store, rev),
            )
        })
    }

    /// Calls typed `get-identity`.
    pub fn vcs_get_identity(&self) -> Result<Option<(String, String)>, String> {
        self.with_vcs_bindings("get_identity", |bindings, store| {
            let out = self.map_vcs_result(
                "get_identity",
                bindings.openvcs_plugin_vcs_api().call_get_identity(store),
            )?;
            Ok(out.map(|id| (id.name, id.email)))
        })
    }

    /// Calls typed `set-identity-local`.
    pub fn vcs_set_identity_local(&self, name: &str, email: &str) -> Result<(), String> {
        self.with_vcs_bindings("set_identity_local", |bindings, store| {
            self.map_vcs_result(
                "set_identity_local",
                bindings
                    .openvcs_plugin_vcs_api()
                    .call_set_identity_local(store, name, email),
            )
        })
    }

    /// Calls typed `list-stashes`.
    pub fn vcs_list_stashes(&self) -> Result<Vec<StashItem>, String> {
        self.with_vcs_bindings("stash_list", |bindings, store| {
            let out = self.map_vcs_result(
                "stash_list",
                bindings.openvcs_plugin_vcs_api().call_list_stashes(store),
            )?;
            Ok(out
                .into_iter()
                .map(|stash| StashItem {
                    selector: stash.selector,
                    msg: stash.msg,
                    meta: stash.meta,
                })
                .collect())
        })
    }

    /// Calls typed `stash-push`.
    pub fn vcs_stash_push(
        &self,
        message: Option<&str>,
        include_untracked: bool,
    ) -> Result<String, String> {
        self.with_vcs_bindings("stash_push", |bindings, store| {
            self.map_vcs_result(
                "stash_push",
                bindings.openvcs_plugin_vcs_api().call_stash_push(
                    store,
                    message,
                    include_untracked,
                ),
            )
        })
    }

    /// Calls typed `stash-apply`.
    pub fn vcs_stash_apply(&self, selector: &str) -> Result<(), String> {
        self.with_vcs_bindings("stash_apply", |bindings, store| {
            self.map_vcs_result(
                "stash_apply",
                bindings
                    .openvcs_plugin_vcs_api()
                    .call_stash_apply(store, selector),
            )
        })
    }

    /// Calls typed `stash-pop`.
    pub fn vcs_stash_pop(&self, selector: &str) -> Result<(), String> {
        self.with_vcs_bindings("stash_pop", |bindings, store| {
            self.map_vcs_result(
                "stash_pop",
                bindings
                    .openvcs_plugin_vcs_api()
                    .call_stash_pop(store, selector),
            )
        })
    }

    /// Calls typed `stash-drop`.
    pub fn vcs_stash_drop(&self, selector: &str) -> Result<(), String> {
        self.with_vcs_bindings("stash_drop", |bindings, store| {
            self.map_vcs_result(
                "stash_drop",
                bindings
                    .openvcs_plugin_vcs_api()
                    .call_stash_drop(store, selector),
            )
        })
    }

    /// Calls typed `stash-show`.
    pub fn vcs_stash_show(&self, selector: &str) -> Result<Vec<String>, String> {
        self.with_vcs_bindings("stash_show", |bindings, store| {
            let out = self.map_vcs_result(
                "stash_show",
                bindings
                    .openvcs_plugin_vcs_api()
                    .call_stash_show(store, selector),
            )?;
            Ok(out.lines().map(str::to_string).collect())
        })
    }

    /// Calls typed `cherry-pick`.
    pub fn vcs_cherry_pick(&self, commit: &str) -> Result<(), String> {
        self.with_vcs_bindings("cherry_pick", |bindings, store| {
            self.map_vcs_result(
                "cherry_pick",
                bindings
                    .openvcs_plugin_vcs_api()
                    .call_cherry_pick(store, commit),
            )
        })
    }

    /// Calls typed `revert-commit`.
    pub fn vcs_revert_commit(&self, commit: &str, no_edit: bool) -> Result<(), String> {
        self.with_vcs_bindings("revert_commit", |bindings, store| {
            self.map_vcs_result(
                "revert_commit",
                bindings
                    .openvcs_plugin_vcs_api()
                    .call_revert_commit(store, commit, no_edit),
            )
        })
    }
}

/// Converts a plugin WIT menu into the shared core menu model.
fn map_menu_from_wit(menu: plugin_api::Menu) -> Menu {
    let elements = menu
        .elements
        .into_iter()
        .map(|element| match element {
            plugin_api::UiElement::Text(text) => UiElement::Text(UiText {
                id: text.id,
                content: text.content,
            }),
            plugin_api::UiElement::Button(button) => UiElement::Button(UiButton {
                id: button.id,
                label: button.label,
            }),
        })
        .collect::<Vec<_>>();
    Menu {
        id: menu.id,
        label: menu.label,
        order: menu.order,
        elements,
    }
}

/// Converts a plugin WIT setting entry into the shared core setting model.
fn map_setting_from_wit(setting: plugin_api::SettingKv) -> SettingKv {
    SettingKv {
        id: setting.id,
        label: setting.label,
        value: match setting.value {
            plugin_api::SettingValue::Boolean(v) => SettingValue::Bool(v),
            plugin_api::SettingValue::Signed32(v) => SettingValue::S32(v),
            plugin_api::SettingValue::Unsigned32(v) => SettingValue::U32(v),
            plugin_api::SettingValue::Float64(v) => SettingValue::F64(v),
            plugin_api::SettingValue::Text(v) => SettingValue::String(v),
        },
    }
}

/// Maps settings value from VCS settings interface into core settings model.
fn map_setting_from_vcs_wit(setting: vcs_settings_api::SettingKv) -> SettingKv {
    SettingKv {
        id: setting.id,
        label: setting.label,
        value: match setting.value {
            vcs_settings_api::SettingValue::Boolean(v) => SettingValue::Bool(v),
            vcs_settings_api::SettingValue::Signed32(v) => SettingValue::S32(v),
            vcs_settings_api::SettingValue::Unsigned32(v) => SettingValue::U32(v),
            vcs_settings_api::SettingValue::Float64(v) => SettingValue::F64(v),
            vcs_settings_api::SettingValue::Text(v) => SettingValue::String(v),
        },
    }
}

/// Converts a shared core setting entry into a plugin WIT setting model.
fn map_setting_to_wit(setting: SettingKv) -> plugin_api::SettingKv {
    let value = match setting.value {
        SettingValue::Bool(v) => plugin_api::SettingValue::Boolean(v),
        SettingValue::S32(v) => plugin_api::SettingValue::Signed32(v),
        SettingValue::U32(v) => plugin_api::SettingValue::Unsigned32(v),
        SettingValue::F64(v) => plugin_api::SettingValue::Float64(v),
        SettingValue::String(v) => plugin_api::SettingValue::Text(v),
    };
    plugin_api::SettingKv {
        id: setting.id,
        label: setting.label,
        value,
    }
}

/// Maps core settings model into VCS settings interface values.
fn map_setting_to_vcs_wit(setting: SettingKv) -> vcs_settings_api::SettingKv {
    let value = match setting.value {
        SettingValue::Bool(v) => vcs_settings_api::SettingValue::Boolean(v),
        SettingValue::S32(v) => vcs_settings_api::SettingValue::Signed32(v),
        SettingValue::U32(v) => vcs_settings_api::SettingValue::Unsigned32(v),
        SettingValue::F64(v) => vcs_settings_api::SettingValue::Float64(v),
        SettingValue::String(v) => vcs_settings_api::SettingValue::Text(v),
    };
    vcs_settings_api::SettingKv {
        id: setting.id,
        label: setting.label,
        value,
    }
}

/// Converts settings entries to a JSON map for persistence.
fn settings_to_json_map(values: &[SettingKv]) -> serde_json::Map<String, serde_json::Value> {
    let mut out = serde_json::Map::new();
    for entry in values {
        out.insert(entry.id.clone(), setting_to_json_value(&entry.value));
    }
    out
}

/// Converts one typed setting value into JSON.
fn setting_to_json_value(value: &SettingValue) -> serde_json::Value {
    match value {
        SettingValue::Bool(v) => serde_json::Value::Bool(*v),
        SettingValue::S32(v) => serde_json::Value::from(*v),
        SettingValue::U32(v) => serde_json::Value::from(*v),
        SettingValue::F64(v) => serde_json::Value::from(*v),
        SettingValue::String(v) => serde_json::Value::String(v.clone()),
    }
}

/// Converts persisted JSON to a typed value using an existing setting type.
fn setting_from_json_value(
    value: &serde_json::Value,
    current: &SettingValue,
) -> Option<SettingValue> {
    match current {
        SettingValue::Bool(_) => value.as_bool().map(SettingValue::Bool),
        SettingValue::S32(_) => value
            .as_i64()
            .and_then(|v| i32::try_from(v).ok())
            .map(SettingValue::S32),
        SettingValue::U32(_) => value
            .as_u64()
            .and_then(|v| u32::try_from(v).ok())
            .map(SettingValue::U32),
        SettingValue::F64(_) => value.as_f64().map(SettingValue::F64),
        SettingValue::String(_) => value.as_str().map(|v| SettingValue::String(v.to_string())),
    }
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

    /// Returns plugin-contributed UI menus.
    fn get_menus(&self) -> Result<Vec<Menu>, String> {
        self.with_runtime(|runtime| runtime.call_get_menus(&self.spawn.plugin_id))
    }

    /// Invokes a plugin action by id.
    fn handle_action(&self, id: &str) -> Result<(), String> {
        self.with_runtime(|runtime| runtime.call_handle_action(&self.spawn.plugin_id, id))
    }

    /// Returns plugin settings defaults.
    fn settings_defaults(&self) -> Result<Vec<SettingKv>, String> {
        self.with_runtime(|runtime| runtime.call_settings_defaults(&self.spawn.plugin_id))
    }

    /// Calls plugin settings-on-load hook.
    fn settings_on_load(&self, values: Vec<SettingKv>) -> Result<Vec<SettingKv>, String> {
        self.with_runtime(|runtime| runtime.call_settings_on_load(&self.spawn.plugin_id, values))
    }

    /// Calls plugin settings-on-apply hook.
    fn settings_on_apply(&self, values: Vec<SettingKv>) -> Result<(), String> {
        self.with_runtime(|runtime| runtime.call_settings_on_apply(&self.spawn.plugin_id, values))
    }

    /// Calls plugin settings-on-save hook.
    fn settings_on_save(&self, values: Vec<SettingKv>) -> Result<Vec<SettingKv>, String> {
        self.with_runtime(|runtime| runtime.call_settings_on_save(&self.spawn.plugin_id, values))
    }

    /// Calls plugin settings-on-reset hook.
    fn settings_on_reset(&self) -> Result<(), String> {
        self.with_runtime(|runtime| runtime.call_settings_on_reset(&self.spawn.plugin_id))
    }

    /// Deinitializes and drops the running component runtime.
    fn stop(&self) {
        let mut lock = self.runtime.lock();
        if let Some(runtime) = lock.as_mut() {
            runtime.call_deinit();
        }
        *lock = None;
    }
}
