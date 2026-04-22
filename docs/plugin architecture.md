# OpenVCS Plugin Architecture

OpenVCS plugins run as long-lived Node.js processes and are authored in
TypeScript.

## Architecture

```text
Client (Frontend) -> Client (Backend host) <-> Plugin (Node.js process)
```

- The frontend talks to the backend via Tauri commands and events.
- The backend starts each plugin module as a persistent Node.js process.
- Host and plugin communicate through JSON-RPC 2.0 over stdio with
  `Content-Length` framing.
- Plugin authors can mirror that contract through `@openvcs/sdk/runtime` and
  `@openvcs/sdk/types`.

## Runtime Contract

- Method names and framing live in `Client/Backend/src/plugin_runtime/protocol.rs`.
- Runtime process implementation lives in:
  - `Client/Backend/src/plugin_runtime/node_instance.rs`
  - `Client/Backend/src/plugin_runtime/runtime_select.rs`
- Plugin modules contribute `plugin.*`, `vcs.*`, and runtime options through the
  exported `PluginDefinition` object consumed by the generated bootstrap.

Core host-to-plugin method groups:

- `plugin.*`: lifecycle, menus, and settings hooks
- `vcs.*`: backend operations for repository workflows

`plugin.handle_action` requests carry the selected action as `action_id` and an
optional `payload` object. Plugin handlers may return a modal definition object
to reopen a plugin modal after the action completes.

Plugin modal definitions support nested layout containers as content items:

- `horizontal-box`
- `vertical-box`
- `grid`

The host renders these containers recursively, so plugin authors can group fields
and buttons into horizontal rows, vertical stacks, and multi-column grids.

When a plugin runtime is active, plugin-contributed menu definitions whose ids
match built-in top-level menus such as `repository` are projected into the main
menubar. For VCS backend plugins, these items therefore appear only after the
repository-scoped runtime has started.

Menu surfaces can be explicitly targeted using the `surface` option:

- `getOrCreateMenu('repository', 'Repository', { surface: 'menubar' })` - renders in the top menubar
- `getOrCreateMenu('my-settings', 'My Settings', { surface: 'settings' })` - renders in the Settings modal

The `surface` option is required. Plugin authors must explicitly specify where their menus should appear.

Core plugin-to-host notifications:

- `host.log`
- `host.ui_notify`
- `host.status_set`
- `host.event_emit`
- `vcs.event`

Plugin runtime requires the app-bundled Node binary; there is no fallback to a
system `node` executable.

## Source Resolution Model

Instead, OpenVCS resolves config-declared plugin sources into the writable local
plugin store before discovery runs:

- Built-in source list: `Client/openvcs.plugins.json`
- User source list: top-level `plugin = [...]` in `openvcs.conf`

The resolver accepts:

- npm package specifiers such as `@scope/name` or `name@version`
- local paths to npm plugin folders such as `../Git`

For source resolution, OpenVCS uses `npm pack` to materialize the plugin package
contents and then installs runtime dependencies into the local plugin root when
needed. Local path plugins therefore behave like npm packages and should define
their published files and `prepack` behavior accordingly.

## Installed Plugin Layout

After sync, the backend operates only on local installed plugin directories:

```text
plugins/
  <plugin-id>/
    package.json
    source.json
    index.json
    current.json
    bin/
    themes/
    node_modules/
```

Built-in plugins are first materialized into the app resource directory under
`built-in-plugins/<plugin-id>/` during the client build. On startup, the backend
synchronizes those built-in directories into the same writable installed store
used for user plugins.

## Manifest

The host currently consumes these manifest fields from `package.json.openvcs`:

- `id` (required)
- `name`, `version` (optional but recommended)
- `default_enabled` (optional)
- `module.exec` (optional Node entry filename under `bin/`)
- `module.vcs_backends` (optional VCS backend ids the module provides)

`module.exec` must resolve to a `.js`, `.mjs`, or `.cjs` file inside `bin/`.

## Runtime Lifecycle

- Configured plugin sources are synchronized on startup.
- `openvcs.conf` changes are watched and re-synchronized while the app is running.
- The Settings > Plugins pane can also reload config and re-run source sync.
- Non-VCS module runtimes are started and stopped according to enabled state.
- VCS backend plugin runtimes are repo-scoped and start when opening a
  repository through that backend.
- Closing the main window tears down config watchers and active plugin
  runtimes so `cargo tauri dev` exits promptly instead of leaving the backend
  process alive.

## Security Model

- No per-capability permission prompts.
- Plugins have full system access within their own Node process.
- Config-managed plugins are auto-approved because declaring them in config is
  the trust action.

Install only plugins from authors you trust.
