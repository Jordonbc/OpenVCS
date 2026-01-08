# Plugins (WIP)

OpenVCS plugins are local, user-installed extensions that can:

- Register one or more themes (using the existing `theme.json` theme-pack format)
- Run JavaScript/TypeScript-authored code in the UI
- Hook into app actions like commit/push/branch switch
- Add basic UI contributions (menu items + titlebar buttons)
- Add context menu items (right-click actions) in lists like files/commits/branches

## Plugin Location

Plugins are discovered from:

- User plugins directory: OpenVCS config `plugins/` folder
- Built-in plugins directory (for packaged/bundled plugins): `built-in-plugins/`

## Plugin Format

A plugin is a folder containing:

- `openvcs.plugin.json` (manifest)
- An optional JavaScript ESM entry file (referenced by `entry`)
- An optional `themes/` folder containing one or more theme packs (each containing a `theme.json`)

### `openvcs.plugin.json`

Minimal example:

```json
{
  "id": "example.hello",
  "name": "Hello Plugin",
  "category": "Examples",
  "tags": ["example", "demo"],
  "version": "0.1.0",
  "author": "You",
  "description": "Demonstrates OpenVCS plugins.",
  "entry": "entry.js"
}
```

Fields:

- `id` (string, required): stable unique plugin id
- `name` (string, required): display name
- `category` (string, optional): broad grouping for UI (e.g. `Themes`, `Integrations`, `Examples`)
- `tags` (string[], optional): searchable keywords (e.g. `["git", "theme", "hooks"]`)
- `entry` (string, optional): relative path to a JS ESM module to run
- Theme packs are auto-detected under `themes/` within the plugin folder (no manifest field required)
  - Theme ids are namespaced at runtime as `<plugin id>.<theme id>` to avoid collisions

## Running Code (TypeScript / JavaScript)

Plugins run as JavaScript ESM modules in the UI.

- Author in TypeScript if you want, but compile to a single `.js` file for `entry`.
- Keep it single-file for now; inline modules can’t reliably `import` sibling files by relative path.

## Plugin API (UI Runtime)

Plugin entry code can call the global `window.OpenVCS` API:

- `window.OpenVCS.registerPlugin({ ... })`
- `window.OpenVCS.registerAction(id, handler)`
- `window.OpenVCS.addMenuItem({ label, action })`
- `window.OpenVCS.addTitlebarButton({ label, action })`
- `window.OpenVCS.notify(message)`
- `window.OpenVCS.invoke(cmd, args)` / `window.OpenVCS.listen(event, cb)`

Menu items appear under the `Plugins` menu. Titlebar buttons appear next to `Push`.

### Context menus

Plugins can add items to existing right-click menus by including `contextMenus` in `registerPlugin(...)`.

```js
window.OpenVCS?.registerPlugin({
  contextMenus: {
    files: [{ label: 'Copy selected paths', action: 'my.plugin:copyPaths' }],
    commits: [{ label: 'Copy commit hash', action: 'my.plugin:copyHash' }],
    branches: [{ label: 'Copy branch name', action: 'my.plugin:copyBranch' }],
  },
});
```

When the user clicks one of these items, OpenVCS runs the referenced action with a payload that describes the clicked object (e.g. `payload.paths` / `payload.commit` / `payload.branch`).

### Calling plugin module RPC from the console

Plugin modules register RPC methods (e.g. `example.notify.ping`) via `openvcs_core::plugin_runtime::register_delegate`, and you can hit those endpoints from the dev console using the new `window.callPluginMethod` helper (it wraps `call_plugin_module_method` so you don’t have to go through `window.OpenVCS.invoke` manually). Example:

```js
await window.callPluginMethod(
  'example.notify',
  'example.notify.ping',
  { message: 'hello from the console' },
);
```

The helper spawns the plugin’s module process, passes the JSON-RPC request, waits for the response, and enforces any requested capabilities (you must have approved them in Settings → Plugins). There’s also a matching API on `window.OpenVCS` (`window.OpenVCS.callPlugin(...)`) if you breezily interact through that object. If you prefer a named shortcut, register a simple global after loading the plugin:

```js
window.example = window.example || {};
window.example.notify = (message) =>
  window.callPluginMethod('example.notify', 'example.notify.ping', { message });
```

After that you can call `example.notify('hi')` in the console, and the helper will forward the call to the module.

## Logging from plugin modules (Rust/WASI)

Plugin modules should write logs to **stderr** (never stdout) so they don’t interfere with the JSON message protocol.

To keep plugin crates lightweight, `openvcs-core` provides logging macros so you don’t need to add a logging crate dependency:

```rs
openvcs_core::trace!("trace details");
openvcs_core::debug!("debug details");
openvcs_core::info!("hello from a plugin");
openvcs_core::warn!("something looks off");
openvcs_core::error!("something failed");
```

If you prefer calling them without a prefix, import the macros you use:

```rs
use openvcs_core::{debug, info, trace};

info!("hello");
debug!("details");
trace!("very verbose");
```

## Hooks

Plugins can register hook handlers via `registerPlugin({ hooks: { ... } })`.

Supported hook names:

- `preCommit` / `onCommit` / `postCommit`
- `prePush` / `onPush` / `postPush`
- `preSwitchBranch` / `onSwitchBranch` / `postSwitchBranch`
- `preBranchCreate` / `onBranchCreate` / `postBranchCreate`
- `preBranchDelete` / `onBranchDelete` / `postBranchDelete`

Pre-hooks can cancel the operation:

- Call `ctx.cancel("reason")`, or
- Throw an error (the error message becomes the reason)

Hook `ctx.data` is a plain object describing the operation (e.g. commit summary/description, branch names). For `preCommit`, mutating `ctx.data.summary` / `ctx.data.description` updates what gets sent to the backend.

## Example Plugin

See `docs/examples/hello-plugin/` for a minimal plugin with:

- A menu item
- A titlebar button
- A `preCommit` hook that blocks commits starting with `WIP`

## Managing Plugins

Open **Settings → Plugins** to view installed plugins and enable/disable them.
