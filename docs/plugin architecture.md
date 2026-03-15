# OpenVCS Plugin Architecture

OpenVCS plugins run as long-lived Node.js processes and are authored in TypeScript.

## Architecture

```text
Client (Frontend) -> Client (Backend host) <-> Plugin (Node.js process)
```

- The frontend talks to the backend via Tauri commands/events.
- The backend starts each plugin module as a persistent Node.js process.
- Host and plugin communicate through JSON-RPC 2.0 over stdio with `Content-Length` framing.

## Runtime contract

- Method names and framing live in `Client/Backend/src/plugin_runtime/protocol.rs`.
- Runtime process implementation lives in:
  - `Client/Backend/src/plugin_runtime/node_instance.rs`
  - `Client/Backend/src/plugin_runtime/runtime_select.rs`

Core groups of host->plugin methods:

- `plugin.*`: lifecycle, menus, and settings hooks
- `vcs.*`: backend operations for repository workflows

Core plugin->host notifications:

- `host.log`
- `host.ui_notify`
- `host.status_set`
- `host.event_emit`
- `vcs.event`
- Plugin runtime requires the app-bundled Node binary (`node-runtime/node` or `node.exe`); no system `node` fallback. In dev runs, the backend also probes the generated bundled path under `target/openvcs/node-runtime/`.

## Plugin types

- Theme pack plugin
  - Ships `themes/` assets only.

- Module plugin (lifecycle + optional settings/UI hooks)
  - Exposes `plugin.*` methods over JSON-RPC.

- VCS backend plugin
  - Exposes both `plugin.*` and `vcs.*` methods.

## Bundle format (`.ovcsp`)

Plugins are installed from `.ovcsp` tar.xz archives. Layout:

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
