// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later
use std::sync::OnceLock;

use crate::plugin_runtime::host_api::{
    host_emit_event, host_get_status, host_process_exec_git, host_runtime_info, host_set_status,
    host_subscribe_event, host_ui_notify, host_workspace_read_file, host_workspace_write_file,
};
use crate::plugin_runtime::instance::PluginRuntimeInstance;
use crate::plugin_runtime::settings_store;
use crate::plugin_runtime::spawn::SpawnConfig;
use openvcs_core::settings::{SettingKv, SettingValue};
use openvcs_core::ui::{Menu, UiButton, UiElement, UiText};
use parking_lot::Mutex;
use serde::de::DeserializeOwned;
use serde::Serialize;
use serde_json::Value;
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

mod bindings_plugin_v1_1 {
    wasmtime::component::bindgen!({
        path: "../../Core/wit",
        world: "plugin-v1-1",
        additional_derives: [serde::Serialize, serde::Deserialize],
    });
}

use bindings_plugin_v1_1::exports::openvcs::plugin::plugin_api_v1_1;
use bindings_vcs::exports::openvcs::plugin::vcs_api;

/// Typed bindings handle selected for the running plugin world.
enum ComponentBindings {
    /// Bindings for plugins exporting the `vcs` world.
    Vcs(bindings_vcs::Vcs),
    /// Bindings for plugins exporting the base `plugin` world.
    Plugin(bindings_plugin::Plugin),
    /// Bindings for plugins exporting the `plugin-v1-1` world.
    PluginV11(bindings_plugin_v1_1::PluginV11),
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
            ComponentBindings::Vcs(bindings) => bindings
                .openvcs_plugin_plugin_api()
                .call_init(&mut self.store)
                .map_err(|e| format!("component init trap for {}: {e}", plugin_id))?
                .map_err(|e| format!("component init failed for {}: {}", plugin_id, e.message)),
            ComponentBindings::Plugin(bindings) => bindings
                .openvcs_plugin_plugin_api()
                .call_init(&mut self.store)
                .map_err(|e| format!("component init trap for {}: {e}", plugin_id))?
                .map_err(|e| format!("component init failed for {}: {}", plugin_id, e.message)),
            ComponentBindings::PluginV11(bindings) => bindings
                .openvcs_plugin_plugin_api_v1_1()
                .call_init(&mut self.store)
                .map_err(|e| format!("component init trap for {}: {e}", plugin_id))?
                .map_err(|e| format!("component init failed for {}: {}", plugin_id, e.message)),
        }
    }

    /// Calls plugin `deinit` for whichever world is currently loaded.
    fn call_deinit(&mut self) {
        match &self.bindings {
            ComponentBindings::Vcs(bindings) => {
                let _ = bindings
                    .openvcs_plugin_plugin_api()
                    .call_deinit(&mut self.store);
            }
            ComponentBindings::Plugin(bindings) => {
                let _ = bindings
                    .openvcs_plugin_plugin_api()
                    .call_deinit(&mut self.store);
            }
            ComponentBindings::PluginV11(bindings) => {
                let _ = bindings
                    .openvcs_plugin_plugin_api_v1_1()
                    .call_deinit(&mut self.store);
            }
        }
    }

    /// Returns plugin-contributed menus for v1.1 plugins.
    fn call_get_menus(&mut self, plugin_id: &str) -> Result<Vec<Menu>, String> {
        let bindings = match &self.bindings {
            ComponentBindings::PluginV11(bindings) => bindings,
            _ => return Ok(Vec::new()),
        };
        let menus = bindings
            .openvcs_plugin_plugin_api_v1_1()
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
            ComponentBindings::PluginV11(bindings) => bindings,
            _ => return Ok(()),
        };
        bindings
            .openvcs_plugin_plugin_api_v1_1()
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
        let bindings = match &self.bindings {
            ComponentBindings::PluginV11(bindings) => bindings,
            _ => return Ok(Vec::new()),
        };
        let values = bindings
            .openvcs_plugin_plugin_api_v1_1()
            .call_settings_defaults(&mut self.store)
            .map_err(|e| format!("component settings-defaults trap for {}: {e}", plugin_id))?
            .map_err(|e| {
                format!(
                    "component settings-defaults failed for {}: {}",
                    plugin_id, e.message
                )
            })?;
        Ok(values.into_iter().map(map_setting_from_wit).collect())
    }

    /// Calls plugin settings-on-load hook for v1.1 plugins.
    fn call_settings_on_load(
        &mut self,
        plugin_id: &str,
        values: Vec<SettingKv>,
    ) -> Result<Vec<SettingKv>, String> {
        let bindings = match &self.bindings {
            ComponentBindings::PluginV11(bindings) => bindings,
            _ => return Ok(values),
        };
        let values = values
            .into_iter()
            .map(map_setting_to_wit)
            .collect::<Vec<_>>();
        let out = bindings
            .openvcs_plugin_plugin_api_v1_1()
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

    /// Calls plugin settings-on-apply hook for v1.1 plugins.
    fn call_settings_on_apply(
        &mut self,
        plugin_id: &str,
        values: Vec<SettingKv>,
    ) -> Result<(), String> {
        let bindings = match &self.bindings {
            ComponentBindings::PluginV11(bindings) => bindings,
            _ => return Ok(()),
        };
        let values = values
            .into_iter()
            .map(map_setting_to_wit)
            .collect::<Vec<_>>();
        bindings
            .openvcs_plugin_plugin_api_v1_1()
            .call_settings_on_apply(&mut self.store, &values)
            .map_err(|e| format!("component settings-on-apply trap for {}: {e}", plugin_id))?
            .map_err(|e| {
                format!(
                    "component settings-on-apply failed for {}: {}",
                    plugin_id, e.message
                )
            })
    }

    /// Calls plugin settings-on-save hook for v1.1 plugins.
    fn call_settings_on_save(
        &mut self,
        plugin_id: &str,
        values: Vec<SettingKv>,
    ) -> Result<Vec<SettingKv>, String> {
        let bindings = match &self.bindings {
            ComponentBindings::PluginV11(bindings) => bindings,
            _ => return Ok(values),
        };
        let values = values
            .into_iter()
            .map(map_setting_to_wit)
            .collect::<Vec<_>>();
        let out = bindings
            .openvcs_plugin_plugin_api_v1_1()
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

    /// Calls plugin settings-on-reset hook for v1.1 plugins.
    fn call_settings_on_reset(&mut self, plugin_id: &str) -> Result<(), String> {
        let bindings = match &self.bindings {
            ComponentBindings::PluginV11(bindings) => bindings,
            _ => return Ok(()),
        };
        bindings
            .openvcs_plugin_plugin_api_v1_1()
            .call_settings_on_reset(&mut self.store)
            .map_err(|e| format!("component settings-on-reset trap for {}: {e}", plugin_id))?
            .map_err(|e| {
                format!(
                    "component settings-on-reset failed for {}: {}",
                    plugin_id, e.message
                )
            })
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

impl WasiView for ComponentHostState {
    /// Returns mutable WASI context and resource table view.
    fn ctx(&mut self) -> WasiCtxView<'_> {
        WasiCtxView {
            ctx: &mut self.wasi,
            table: &mut self.table,
        }
    }
}

impl bindings_vcs::openvcs::plugin::host_api::Host for ComponentHostState {
    /// Returns runtime metadata for the current host process.
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

    /// Registers an event subscription for this plugin.
    fn subscribe_event(
        &mut self,
        event_name: String,
    ) -> Result<(), bindings_vcs::openvcs::plugin::host_api::HostError> {
        host_subscribe_event(&self.spawn, &event_name)
            .map_err(ComponentHostState::map_host_error_vcs)
    }

    /// Emits a plugin-originated event through the host event bus.
    fn emit_event(
        &mut self,
        event_name: String,
        payload: Vec<u8>,
    ) -> Result<(), bindings_vcs::openvcs::plugin::host_api::HostError> {
        host_emit_event(&self.spawn, &event_name, &payload)
            .map_err(ComponentHostState::map_host_error_vcs)
    }

    /// Forwards plugin notifications to host-side UI notification handling.
    fn ui_notify(
        &mut self,
        message: String,
    ) -> Result<(), bindings_vcs::openvcs::plugin::host_api::HostError> {
        host_ui_notify(&self.spawn, &message).map_err(ComponentHostState::map_host_error_vcs)
    }

    /// Sets footer status text through the host status API.
    fn set_status(
        &mut self,
        message: String,
    ) -> Result<(), bindings_vcs::openvcs::plugin::host_api::HostError> {
        host_set_status(&self.spawn, &message).map_err(ComponentHostState::map_host_error_vcs)
    }

    /// Reads current footer status text through the host status API.
    fn get_status(&mut self) -> Result<String, bindings_vcs::openvcs::plugin::host_api::HostError> {
        host_get_status(&self.spawn).map_err(ComponentHostState::map_host_error_vcs)
    }

    /// Reads a workspace file under capability and path constraints.
    fn workspace_read_file(
        &mut self,
        path: String,
    ) -> Result<Vec<u8>, bindings_vcs::openvcs::plugin::host_api::HostError> {
        host_workspace_read_file(&self.spawn, &path).map_err(ComponentHostState::map_host_error_vcs)
    }

    /// Writes a workspace file under capability and path constraints.
    fn workspace_write_file(
        &mut self,
        path: String,
        content: Vec<u8>,
    ) -> Result<(), bindings_vcs::openvcs::plugin::host_api::HostError> {
        host_workspace_write_file(&self.spawn, &path, &content)
            .map_err(ComponentHostState::map_host_error_vcs)
    }

    /// Executes `git` in a constrained host environment.
    fn process_exec_git(
        &mut self,
        cwd: Option<String>,
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
        let value =
            host_process_exec_git(&self.spawn, cwd.as_deref(), &args, &env, stdin.as_deref())
                .map_err(ComponentHostState::map_host_error_vcs)?;
        Ok(bindings_vcs::openvcs::plugin::host_api::ProcessExecOutput {
            success: value.success,
            status: value.status,
            stdout: value.stdout,
            stderr: value.stderr,
        })
    }

    /// Logs plugin-emitted messages through the host logger.
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
    /// Returns runtime metadata for the current host process.
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

    /// Registers an event subscription for this plugin.
    fn subscribe_event(
        &mut self,
        event_name: String,
    ) -> Result<(), bindings_plugin::openvcs::plugin::host_api::HostError> {
        host_subscribe_event(&self.spawn, &event_name)
            .map_err(ComponentHostState::map_host_error_plugin)
    }

    /// Emits a plugin-originated event through the host event bus.
    fn emit_event(
        &mut self,
        event_name: String,
        payload: Vec<u8>,
    ) -> Result<(), bindings_plugin::openvcs::plugin::host_api::HostError> {
        host_emit_event(&self.spawn, &event_name, &payload)
            .map_err(ComponentHostState::map_host_error_plugin)
    }

    /// Forwards plugin notifications to host-side UI notification handling.
    fn ui_notify(
        &mut self,
        message: String,
    ) -> Result<(), bindings_plugin::openvcs::plugin::host_api::HostError> {
        host_ui_notify(&self.spawn, &message).map_err(ComponentHostState::map_host_error_plugin)
    }

    /// Sets footer status text through the host status API.
    fn set_status(
        &mut self,
        message: String,
    ) -> Result<(), bindings_plugin::openvcs::plugin::host_api::HostError> {
        host_set_status(&self.spawn, &message).map_err(ComponentHostState::map_host_error_plugin)
    }

    /// Reads current footer status text through the host status API.
    fn get_status(
        &mut self,
    ) -> Result<String, bindings_plugin::openvcs::plugin::host_api::HostError> {
        host_get_status(&self.spawn).map_err(ComponentHostState::map_host_error_plugin)
    }

    /// Reads a workspace file under capability and path constraints.
    fn workspace_read_file(
        &mut self,
        path: String,
    ) -> Result<Vec<u8>, bindings_plugin::openvcs::plugin::host_api::HostError> {
        host_workspace_read_file(&self.spawn, &path)
            .map_err(ComponentHostState::map_host_error_plugin)
    }

    /// Writes a workspace file under capability and path constraints.
    fn workspace_write_file(
        &mut self,
        path: String,
        content: Vec<u8>,
    ) -> Result<(), bindings_plugin::openvcs::plugin::host_api::HostError> {
        host_workspace_write_file(&self.spawn, &path, &content)
            .map_err(ComponentHostState::map_host_error_plugin)
    }

    /// Executes `git` in a constrained host environment.
    fn process_exec_git(
        &mut self,
        cwd: Option<String>,
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
        let value =
            host_process_exec_git(&self.spawn, cwd.as_deref(), &args, &env, stdin.as_deref())
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

    /// Logs plugin-emitted messages through the host logger.
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

impl bindings_plugin_v1_1::openvcs::plugin::host_api::Host for ComponentHostState {
    /// Returns runtime metadata for the current host process.
    fn get_runtime_info(
        &mut self,
    ) -> Result<
        bindings_plugin_v1_1::openvcs::plugin::host_api::RuntimeInfo,
        bindings_plugin_v1_1::openvcs::plugin::host_api::HostError,
    > {
        let value = host_runtime_info();
        Ok(
            bindings_plugin_v1_1::openvcs::plugin::host_api::RuntimeInfo {
                os: value.os,
                arch: value.arch,
                container: value.container,
            },
        )
    }

    /// Registers an event subscription for this plugin.
    fn subscribe_event(
        &mut self,
        event_name: String,
    ) -> Result<(), bindings_plugin_v1_1::openvcs::plugin::host_api::HostError> {
        host_subscribe_event(&self.spawn, &event_name).map_err(|err| {
            bindings_plugin_v1_1::openvcs::plugin::host_api::HostError {
                code: err.code,
                message: err.message,
            }
        })
    }

    /// Emits a plugin-originated event through the host event bus.
    fn emit_event(
        &mut self,
        event_name: String,
        payload: Vec<u8>,
    ) -> Result<(), bindings_plugin_v1_1::openvcs::plugin::host_api::HostError> {
        host_emit_event(&self.spawn, &event_name, &payload).map_err(|err| {
            bindings_plugin_v1_1::openvcs::plugin::host_api::HostError {
                code: err.code,
                message: err.message,
            }
        })
    }

    /// Forwards plugin notifications to host-side UI notification handling.
    fn ui_notify(
        &mut self,
        message: String,
    ) -> Result<(), bindings_plugin_v1_1::openvcs::plugin::host_api::HostError> {
        host_ui_notify(&self.spawn, &message).map_err(|err| {
            bindings_plugin_v1_1::openvcs::plugin::host_api::HostError {
                code: err.code,
                message: err.message,
            }
        })
    }

    /// Sets footer status text through the host status API.
    fn set_status(
        &mut self,
        message: String,
    ) -> Result<(), bindings_plugin_v1_1::openvcs::plugin::host_api::HostError> {
        host_set_status(&self.spawn, &message).map_err(|err| {
            bindings_plugin_v1_1::openvcs::plugin::host_api::HostError {
                code: err.code,
                message: err.message,
            }
        })
    }

    /// Reads current footer status text through the host status API.
    fn get_status(
        &mut self,
    ) -> Result<String, bindings_plugin_v1_1::openvcs::plugin::host_api::HostError> {
        host_get_status(&self.spawn).map_err(|err| {
            bindings_plugin_v1_1::openvcs::plugin::host_api::HostError {
                code: err.code,
                message: err.message,
            }
        })
    }

    /// Reads a workspace file under capability and path constraints.
    fn workspace_read_file(
        &mut self,
        path: String,
    ) -> Result<Vec<u8>, bindings_plugin_v1_1::openvcs::plugin::host_api::HostError> {
        host_workspace_read_file(&self.spawn, &path).map_err(|err| {
            bindings_plugin_v1_1::openvcs::plugin::host_api::HostError {
                code: err.code,
                message: err.message,
            }
        })
    }

    /// Writes a workspace file under capability and path constraints.
    fn workspace_write_file(
        &mut self,
        path: String,
        content: Vec<u8>,
    ) -> Result<(), bindings_plugin_v1_1::openvcs::plugin::host_api::HostError> {
        host_workspace_write_file(&self.spawn, &path, &content).map_err(|err| {
            bindings_plugin_v1_1::openvcs::plugin::host_api::HostError {
                code: err.code,
                message: err.message,
            }
        })
    }

    /// Executes `git` in a constrained host environment.
    fn process_exec_git(
        &mut self,
        cwd: Option<String>,
        args: Vec<String>,
        env: Vec<bindings_plugin_v1_1::openvcs::plugin::host_api::EnvVar>,
        stdin: Option<String>,
    ) -> Result<
        bindings_plugin_v1_1::openvcs::plugin::host_api::ProcessExecOutput,
        bindings_plugin_v1_1::openvcs::plugin::host_api::HostError,
    > {
        let env = env
            .into_iter()
            .map(|var| (var.key, var.value))
            .collect::<Vec<_>>();
        let value =
            host_process_exec_git(&self.spawn, cwd.as_deref(), &args, &env, stdin.as_deref())
                .map_err(
                    |err| bindings_plugin_v1_1::openvcs::plugin::host_api::HostError {
                        code: err.code,
                        message: err.message,
                    },
                )?;
        Ok(
            bindings_plugin_v1_1::openvcs::plugin::host_api::ProcessExecOutput {
                success: value.success,
                status: value.status,
                stdout: value.stdout,
                stderr: value.stderr,
            },
        )
    }

    /// Logs plugin-emitted messages through the host logger.
    fn host_log(
        &mut self,
        level: bindings_plugin_v1_1::openvcs::plugin::host_api::LogLevel,
        target: String,
        message: String,
    ) {
        let target = if target.trim().is_empty() {
            format!("plugin.{}", self.spawn.plugin_id)
        } else {
            format!("plugin.{}.{}", self.spawn.plugin_id, target)
        };

        match level {
            bindings_plugin_v1_1::openvcs::plugin::host_api::LogLevel::Trace => {
                log::trace!(target: &target, "{message}")
            }
            bindings_plugin_v1_1::openvcs::plugin::host_api::LogLevel::Debug => {
                log::debug!(target: &target, "{message}")
            }
            bindings_plugin_v1_1::openvcs::plugin::host_api::LogLevel::Info => {
                log::info!(target: &target, "{message}")
            }
            bindings_plugin_v1_1::openvcs::plugin::host_api::LogLevel::Warn => {
                log::warn!(target: &target, "{message}")
            }
            bindings_plugin_v1_1::openvcs::plugin::host_api::LogLevel::Error => {
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
        let bindings = if self.spawn.is_vcs_backend {
            bindings_vcs::Vcs::add_to_linker::<
                ComponentHostState,
                wasmtime::component::HasSelf<ComponentHostState>,
            >(&mut linker, |state| state)
            .map_err(|e| format!("link host imports: {e}"))?;

            ComponentBindings::Vcs(
                bindings_vcs::Vcs::instantiate(&mut store, &component, &linker)
                    .map_err(|e| format!("instantiate component {}: {e}", self.spawn.plugin_id))?,
            )
        } else {
            bindings_plugin_v1_1::PluginV11::add_to_linker::<
                ComponentHostState,
                wasmtime::component::HasSelf<ComponentHostState>,
            >(&mut linker, |state| state)
            .map_err(|e| format!("link host imports: {e}"))?;

            match bindings_plugin_v1_1::PluginV11::instantiate(&mut store, &component, &linker) {
                Ok(v11) => ComponentBindings::PluginV11(v11),
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
        if !matches!(runtime.bindings, ComponentBindings::PluginV11(_)) {
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
}

/// Converts a v1.1 WIT menu into the shared core menu model.
fn map_menu_from_wit(menu: plugin_api_v1_1::Menu) -> Menu {
    let elements = menu
        .elements
        .into_iter()
        .map(|element| match element {
            plugin_api_v1_1::UiElement::Text(text) => UiElement::Text(UiText {
                id: text.id,
                content: text.content,
            }),
            plugin_api_v1_1::UiElement::Button(button) => UiElement::Button(UiButton {
                id: button.id,
                label: button.label,
            }),
        })
        .collect::<Vec<_>>();
    Menu {
        id: menu.id,
        label: menu.label,
        elements,
    }
}

/// Converts a v1.1 WIT setting entry into the shared core setting model.
fn map_setting_from_wit(setting: plugin_api_v1_1::SettingKv) -> SettingKv {
    SettingKv {
        id: setting.id,
        value: match setting.value {
            plugin_api_v1_1::SettingValue::Boolean(v) => SettingValue::Bool(v),
            plugin_api_v1_1::SettingValue::Signed32(v) => SettingValue::S32(v),
            plugin_api_v1_1::SettingValue::Unsigned32(v) => SettingValue::U32(v),
            plugin_api_v1_1::SettingValue::Float64(v) => SettingValue::F64(v),
            plugin_api_v1_1::SettingValue::Text(v) => SettingValue::String(v),
        },
    }
}

/// Converts a shared core setting entry into a v1.1 WIT setting model.
fn map_setting_to_wit(setting: SettingKv) -> plugin_api_v1_1::SettingKv {
    let value = match setting.value {
        SettingValue::Bool(v) => plugin_api_v1_1::SettingValue::Boolean(v),
        SettingValue::S32(v) => plugin_api_v1_1::SettingValue::Signed32(v),
        SettingValue::U32(v) => plugin_api_v1_1::SettingValue::Unsigned32(v),
        SettingValue::F64(v) => plugin_api_v1_1::SettingValue::Float64(v),
        SettingValue::String(v) => plugin_api_v1_1::SettingValue::Text(v),
    };
    plugin_api_v1_1::SettingKv {
        id: setting.id,
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
    /// Invokes a v1 VCS ABI method exported by the plugin component.
    ///
    /// Non-VCS plugins only expose lifecycle hooks (`init`/`deinit`) and return
    /// an error for VCS RPC method calls.
    fn call(&self, method: &str, params: Value) -> Result<Value, String> {
        self.with_runtime(|runtime| {
            let bindings = match &runtime.bindings {
                ComponentBindings::Vcs(bindings) => bindings,
                ComponentBindings::Plugin(_) => {
                    return Err(format!(
                        "component method `{method}` requires VCS backend exports for plugin `{}`",
                        self.spawn.plugin_id
                    ));
                }
                ComponentBindings::PluginV11(_) => {
                    return Err(format!(
                        "component method `{method}` requires VCS backend exports for plugin `{}`",
                        self.spawn.plugin_id
                    ));
                }
            };

            macro_rules! invoke {
                ($method_name:literal, $call:ident $(, $arg:expr )* ) => {
                    bindings
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
