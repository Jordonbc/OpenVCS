# Plugins

OpenVCS plugins are local extensions installed as `.ovcsp` bundles.

Plugins may include themes, a Wasm module, or both.

Module plugins may optionally export UI menus and settings lifecycle hooks via the v1.1 plugin world (`plugin-v1-1`) in `Core/wit/plugin.wit`.

## Where plugins live

OpenVCS discovers plugins from two places:

- User plugins directory (in the OpenVCS config dir): `plugins/`
- Built-in plugins directory (bundled with the app): `built-in-plugins/`

## Bundle format (`.ovcsp`)

An `.ovcsp` is a tar.xz archive with this layout:

```text
<plugin-id>/
  openvcs.plugin.json
  icon.<ext>            (optional)
  themes/               (optional)
  bin/
    <module>.wasm       (optional; must be a component)
```

## Manifest (`openvcs.plugin.json`)

Minimal theme-only plugin:

```json
{
  "id": "example.theme-pack",
  "name": "Example Theme Pack",
  "version": "0.1.0"
}
```

Minimal module plugin:

```json
{
  "id": "example.plugin",
  "name": "Example Plugin",
  "version": "0.1.0",
  "capabilities": [],
  "module": { "exec": "example-plugin.wasm" }
}
```

Notes:

- `module.exec` must end with `.wasm`.
- The plugin runtime only loads component-model modules.
- If `themes/` exists, it is packaged and discovered automatically.
- If a plugin calls status APIs without approved status capability, the host logs a warning and ignores the action (the plugin still loads).

## Plugin UI menus and settings

- Plugins can contribute typed menus/elements (text and buttons today) that the client renders.
- Enabling/disabling a plugin from the Settings > Plugins pane refreshes plugin-contributed menus in the same open modal.
- Plugin list checkboxes are tri-state in the UI: disabled, enabled (green check), and enabling (animated pending indicator).
- If plugin runtime startup fails (including startup sync on app launch), the plugin list shows a persistent red `!` marker for that plugin until the next retry.
- Plugin menus are fetched only from plugins with a currently running module runtime; enabled plugins that are not running (for example after a crash) do not contribute menus until runtime is restored.
- If enabling a plugin fails during runtime startup, the host keeps that plugin disabled and returns an error to the UI.
- For `plugin-v1-1` menus, plugins can provide an optional `menu.order` (`u32`) hint; lower values render earlier, and menus without an order are sorted after ordered menus by label.
- Built-in plugin menus are shown as normal top-level Settings sections; third-party plugin menus are grouped under Settings > Plugins in the `Plugin Settings` subsection.
- Action buttons invoke plugin `handle-action` callbacks.
- The Plugins details pane includes a bottom-right `Permissions` button that opens a stacked modal titled `Permissions for <plugin name>`.
- The permissions modal lists only permissions requested by that plugin, shows segmented button choices (for example `Allow` / `Deny`, with richer choices for some permission groups), and includes an `Apply changes` button.
- When a plugin requests no capabilities, the modal shows: `The plugin does not request permissions`.
- Plugin settings persistence is automatic in the host under:
  - `plugin-data/<plugin-id>/settings.json`
- Settings save/load/reset/apply flow is driven by plugin hooks:
  - `settings-defaults`
  - `settings-on-load`
  - `settings-on-apply`
  - `settings-on-save`
  - `settings-on-reset`

## Building bundles

Install the SDK from crates.io:

```bash
cargo install openvcs-sdk
```

Then build plugin bundles with:

```bash
# From a plugin directory
cargo openvcs dist

# Or explicitly
cargo openvcs dist --plugin-dir /path/to/plugin --out /path/to/dist
```

See `Client/docs/plugin architecture.md` for the runtime model and `SDK/README.md` for packager details.
