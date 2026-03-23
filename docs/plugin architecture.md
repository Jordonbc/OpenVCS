# OpenVCS Plugin Architecture

OpenVCS plugins run as long-lived Node.js processes and are authored in TypeScript.

## Architecture

```text
Client (Frontend) -> Client (Backend host) <-> Plugin (Node.js process)
```

- The frontend talks to the backend via Tauri commands/events.
- The backend starts each plugin module as a persistent Node.js process.
- Host and plugin communicate through JSON-RPC 2.0 over stdio with `Content-Length` framing.
- Plugin authors can mirror that host contract through `@openvcs/sdk/runtime` and `@openvcs/sdk/types`, which provide a Node-only delegate runtime over the same transport.
- Code plugins now export declarative runtime metadata plus `OnPluginStart()` from their compiled `bin/plugin.js` module; the SDK generates `bin/<module.exec>` as the `_start`-style bootstrap that imports that module, applies the exported runtime definition, invokes `OnPluginStart()`, and then starts the runtime loop.
- VCS backend authors can use `VcsDelegateBase` from `@openvcs/sdk/runtime` to implement ordinary camelCase class methods and register them as exact `vcs.*` JSON-RPC delegates during `OnPluginStart()`.

## Runtime contract

- Method names and framing live in `Client/Backend/src/plugin_runtime/protocol.rs`.
- The SDK mirrors that contract for plugin authors under `SDK/src/lib/runtime/` and `SDK/src/lib/types/`.
- Backend-owned shared Rust contracts for VCS backends and plugin-facing payloads live in `Client/Backend/src/core/`.
- Runtime process implementation lives in:
  - `Client/Backend/src/plugin_runtime/node_instance.rs`
  - `Client/Backend/src/plugin_runtime/runtime_select.rs`
- Plugin modules contribute `plugin.*`, `vcs.*`, and runtime options through the exported `PluginDefinition` object consumed by the generated bootstrap.

Core groups of host->plugin methods:

- `plugin.*`: lifecycle, menus, and settings hooks
- `vcs.*`: backend operations for repository workflows

The SDK runtime exposes exact host-method delegates such as `'plugin.init'`,
`'plugin.settings.on_load'`, and `'vcs.get_status_payload'`, so plugins can
register handlers without implementing their own method switch or stdio parser.
`VcsDelegateBase.toDelegates()` provides the class-based path for `vcs.*`
handlers by mapping methods like `getCaps()` to `vcs.get_caps`.

Core plugin->host notifications:

- `host.log`
- `host.ui_notify`
- `host.status_set`
- `host.event_emit`
- `vcs.event`
- Plugin runtime requires the app-bundled Node binary (`node-runtime/node` or `node.exe`); no system `node` fallback.
- The backend resolves bundled Node from the exact Tauri `node-runtime` resource first, then probes packaged filesystem layouts including executable-adjacent `node-runtime/` and OpenVCS-owned Linux `lib/<AppName>/node-runtime/` directories, and finally the generated dev path under `target/openvcs/node-runtime/`.

## Plugin types

- Theme pack plugin
  - Ships `themes/` assets only.

- Module plugin (lifecycle + optional settings/UI hooks)
  - Exposes `plugin.*` methods over JSON-RPC.

- VCS backend plugin
  - Exposes both `plugin.*` and `vcs.*` methods.

## Bundle format (`.ovcsp`)

Plugins are installed from `.ovcsp` tar.gz archives. Layout:

```text
<plugin-id>/
  openvcs.plugin.json
  icon.<ext>            (optional)
  themes/               (optional; may coexist with a module)
  bin/
    <module>.mjs|.js|.cjs
    ...other runtime files
  node_modules/         (optional; pre-bundled npm dependencies)
```

Built-in plugins ship in the bundled `built-in-plugins/` resource directory as
`.ovcsp` archives too. On startup, the backend synchronizes those built-in
bundles into the writable installed plugin store before plugin, theme, and VCS
backend discovery runs. VCS backend discovery also performs a best-effort
re-sync before listing installed backends so packaged built-ins still appear if
startup sync previously failed. Linux package targets may place those resources
under OpenVCS-owned `lib/<AppName>/built-in-plugins/` directories instead of
next to the executable.

## Manifest (`openvcs.plugin.json`)

The host currently consumes:

- `id` (required)
- `name`, `version` (optional but recommended)
- `default_enabled` (optional)
- `module.exec` (optional Node entry filename under `bin/`)
- `module.vcs_backends` (optional VCS backend ids the module provides)

Dependency notes:

- Plugin dependencies are expected to be pre-bundled in `.ovcsp`.
- The host does not run npm/yarn/pnpm during plugin install/update.
- SDK packaging is a two-step npm flow: `openvcs build` creates runtime assets,
  then `openvcs dist` validates and bundles them into `.ovcsp`.

## Security model

Plugins are trust-model based:

- No per-capability permission prompts.
- Plugins have full system access within their own Node process.
- Plugin module startup is gated by installed-version approval state.
- Install only plugins from authors you trust.

## Runtime lifecycle

- Module runtimes are started/stopped by lifecycle operations (startup sync and plugin enable/disable toggles).
- VCS backend plugin runtimes are repo-scoped and started when opening a repository through that backend.
- Backend plugin command calls do not implicitly start stopped plugin runtimes.

## Plugin settings persistence

- Plugin settings are persisted by the host in the user config directory under:
  - `plugin-data/<plugin-id>/settings.json`
