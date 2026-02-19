# Plugins

OpenVCS plugins are local extensions installed as `.ovcsp` bundles.

Plugins may include themes, a Wasm module, or both.

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
