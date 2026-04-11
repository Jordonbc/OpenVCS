# Plugins

OpenVCS plugins are declared by config and synchronized into a local installed
plugin store.

The plugin runtime still executes local files from the writable `plugins/`
directory under the app config directory.

## Source Of Truth

OpenVCS reads two plugin source lists with the same entry shape:

- Built-in plugins: `Client/openvcs.plugins.json`
- User plugins: the top-level `plugin = [...]` array in `openvcs.conf`

Example user config:

```toml
plugin = [
  "@openvcs/git-plugin",
  "@scope/example-plugin@latest",
  "../Git"
]
```

Entries can be:

- npm package specifiers such as `@scope/name` or `@scope/name@version`
- local paths to npm plugin folders such as `../Git`

Relative user paths are resolved from the directory that contains
`openvcs.conf`.

## Sync Flow

- Built-in plugin sources are materialized during client builds into
  `target/openvcs/built-in-plugins/<plugin-id>/`.
- Packaged apps ship those directories as the `built-in-plugins/` resource.
- On startup, the backend synchronizes built-in plugins and user-configured
  plugins into the writable installed plugin store.
- While the app is running, edits to `openvcs.conf` are watched and re-synced
  automatically.
- Plugin store writes are serialized so built-in sync, config reloads, and
  backend discovery do not race while replacing the same installed plugin.
- Plugin action payloads are forwarded back to the runtime, and any plugin
  modal returned by an action is re-rendered in the host UI.
- The Settings > Plugins pane can still reload config manually.

Config-managed plugins are auto-approved because adding them to config is the
trust action.

## Installed Layout

The installed plugin store still uses one directory per plugin id and keeps the
current selected version metadata:

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

`source.json` records whether the plugin came from a built-in config entry or a
user config entry and preserves the original specifier.

## Plugin Author Workflow

Plugin packages should be ordinary npm packages that include:

- `package.json` with an `openvcs` object
- compiled runtime files under `bin/`
- optional `themes/`
- any runtime dependencies installable from `dependencies`

The SDK build step still generates the Node bootstrap under `bin/<module.exec>`:

```bash
npx openvcs build --plugin-dir /path/to/plugin
```

For local path plugins used in config, `npm pack` is the packaging boundary used
by OpenVCS during sync, so package `files`, `prepack`, and published runtime
assets matter.

## Security Model

- Plugins run as full-trust Node.js processes.
- OpenVCS does not sandbox plugin filesystem or process access.
- Adding a plugin source to config means you trust that package or local folder.

Install only plugins you trust.
