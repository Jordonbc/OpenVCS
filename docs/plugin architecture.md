# OpenVCS Plugin Architecture

This document describes the current plugin system used by the OpenVCS desktop client.

## Architecture

```text
Client (Frontend) -> Client (Backend host) <-> Plugin (Wasm component)
```

- The frontend talks to the backend via Tauri commands/events.
- The backend loads plugins as component-model WebAssembly modules and calls them via typed ABI bindings.

## Contracts (WIT)

The authoritative host/plugin contract lives under `Core/wit/`:

- `Core/wit/host.wit`: host imports plugins can call (workspace IO, status set/get, process exec, notifications, logging, events)
- `Core/wit/plugin.wit`: plugin world with lifecycle, UI, and settings support
- `Core/wit/vcs.wit`: VCS backend world (`vcs`)

The backend generates host bindings from these contracts and links them into a Wasmtime component runtime.

## Plugin types

- Theme pack plugin
  - Ships `themes/` assets.
  - A plugin may ship themes alone or alongside a module.

- Module plugin (lifecycle only)
  - Exports the `plugin` world from `Core/wit/plugin.wit`.
  - Must implement `plugin-api.init` and `plugin-api.deinit`.

- Module plugin (UI + settings lifecycle)
  - Exports the `plugin` world from `Core/wit/plugin.wit`.
  - Supports typed menu contributions (`get-menus` + `handle-action`) and settings hooks (`settings-defaults`, `settings-on-load`, `settings-on-apply`, `settings-on-save`, `settings-on-reset`).
  - Menu records include an optional `order` hint (`option<u32>`); host menu rendering sorts by `order` (ascending) then label.
  - Plugins can implement only the hooks they care about when using `#[openvcs_plugin]`; defaults are injected for omitted hooks.

- VCS backend plugin
  - Exports the `vcs` world from `Core/wit/vcs.wit`.
  - Must export both `plugin-api` (lifecycle) and `vcs-api` (backend operations).

## Runtime implementation

Key host code locations:

- `Client/Backend/src/plugin_runtime/runtime_select.rs`: enforces component-only runtime (non-component modules are rejected).
- `Client/Backend/src/plugin_runtime/component_instance.rs`: Wasmtime component instantiation + typed calls.
- `Client/Backend/src/plugin_bundles.rs`: `.ovcsp` installation, indexing, capability approvals, module discovery.

## Bundle format (`.ovcsp`)

Plugins are installed from `.ovcsp` tar.xz archives. Layout:

```text
<plugin-id>/
  openvcs.plugin.json
  icon.<ext>            (optional)
  themes/               (optional; may coexist with a module)
  bin/
    <module>.wasm       (optional; must be a component)
```

## Manifest (`openvcs.plugin.json`)

The host cares about:

- `id` (required)
- `name`, `version` (optional but recommended)
- `default_enabled` (optional)
- `capabilities` (optional list of strings)
- `module.exec` (optional `.wasm` filename under `bin/`)
- `module.vcs_backends` (optional VCS backend ids the module provides)

## Capabilities

Plugins request capabilities through the manifest `capabilities` array.
The host enforces capability approval before allowing privileged host API calls.

The Settings > Plugins details pane exposes a `Permissions` modal where users can
adjust approval choices for the currently installed plugin version and apply
changes immediately.

Status APIs use dedicated capabilities:

- `status.set`: allows plugins to call `set-status`.
- `status.get`: allows plugins to call `get-status`.
- `status.set` also implies `status.get`.

When a plugin calls status APIs without approved status capability, the host logs
a warning and ignores the status mutation/read request instead of failing plugin
startup.

## Security model

- Plugins run out-of-process in a Wasmtime component runtime.
- Host APIs are explicit via WIT imports.
- Workspace file access is mediated by the host and can be confined to a selected workspace root.

## Runtime lifecycle

- Module runtimes are started/stopped by lifecycle operations (startup sync and plugin enable/disable toggles).
- VCS backend plugin runtimes are repo-scoped and started only when opening a repository through that backend.
- Backend plugin command calls do not implicitly start stopped plugin runtimes.
- If a plugin is enabled but not currently running, module RPC/menu calls return a `not running` error until runtime is restored.

## Plugin settings persistence

- Plugin settings are persisted by the host (not by plugin code) in the user config directory under:
  - `plugin-data/<plugin-id>/settings.json`
- This keeps settings stable across plugin updates because installed plugin directories are replaced during installation.
