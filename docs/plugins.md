# Plugins

OpenVCS plugins are declared by config and synchronized into a local installed
plugin store.

The plugin runtime still executes local files from the writable `plugins/`
directory under the app config directory.

## Source Of Truth

OpenVCS reads two plugin source lists:

- Built-in plugins: `Client/openvcs.plugins.json` (channel-first)
- User plugins: the top-level `plugin = [...]` array in `openvcs.conf`

## Channel-Based Built-in Config

Built-in plugins use a channel-first schema that maps release channels to plugin
specifier arrays:

```json
{
  "stable": ["@openvcs/git-plugin@latest", "@openvcs/official-themes@latest"],
  "beta": ["@openvcs/git-plugin@beta", "@openvcs/official-themes@beta"],
  "dev": ["@openvcs/git-plugin@edge", "@openvcs/official-themes@nightly"]
}
```

The active channel is determined by the `OPENVCS_UPDATE_CHANNEL` environment
variable:

- `stable` - production releases
- `beta` - beta builds  
- `dev` - development builds
- `nightly` - alias for `dev`
- unset/unknown values default to `stable`

### Local Override

For local development, create `openvcs.plugins.local.json` in the Client directory
with the same shape to override the channel-specific plugin list. This is useful
for testing different plugin versions without modifying the main config.

If the local file defines the active channel key, that channel list fully
replaces the committed list, including an empty array.

The local override file is ignored by git (see `.gitignore`).

## User Plugin Config

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
- Plugin modals can nest `horizontal-box`, `vertical-box`, and `grid` content
  items so plugin authors can keep related controls on the same row or in the
  same multi-column section.
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
