# Plugins

OpenVCS plugins are local extensions installed as `.ovcsp` bundles.

Plugins may include themes, a Node.js module, or both.

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
    <module>.mjs|.js|.cjs
    ...other runtime files
  node_modules/         (optional; pre-bundled npm dependencies)
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
  "module": { "exec": "example-plugin.mjs" }
}
```

Notes:

- `module.exec` must end with `.js`, `.mjs`, or `.cjs`.
- The runtime loads only Node entry files from `bin/`.
- If `themes/` exists, it is packaged and discovered automatically.
- Dependency installation is a packaging concern (SDK), not an app install concern.
- OpenVCS does not run npm during plugin installation or updates.

## Plugin UI menus and settings

- Plugins can contribute typed menus/elements (text and buttons today) that the client renders.
- Enabling/disabling a plugin from the Settings > Plugins pane refreshes plugin-contributed menus.
- Plugin list checkboxes are tri-state in the UI: disabled, enabled (green check), and enabling (animated pending indicator).
- If plugin runtime startup fails, the plugin list shows a persistent red `!` marker for that plugin until retry.
- Plugin menus are fetched only from plugins with a currently running module runtime.
- If enabling a plugin fails during runtime startup, the host keeps that plugin disabled and returns an error to the UI.
- Plugin settings persistence is automatic in the host under:
  - `plugin-data/<plugin-id>/settings.json`

## Security model

Plugins are trust-model based and do not use per-capability permission prompts.
Plugins run with full system access in their own Node process.

Before a plugin module can start, the installed version must be marked
`approved` in plugin installation metadata.

Plugin modules run only with the app-bundled Node runtime; OpenVCS does not
fall back to `node` from system PATH.

Install only plugins you trust.

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
