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

Install the SDK in your plugin project:

```bash
npm install --save-dev @openvcs/sdk
```

Code plugins should expose a `build:plugin` npm script that compiles runtime
assets into `bin/plugin.js`. Plugins can also import `@openvcs/sdk/runtime` and
`@openvcs/sdk/types` to reuse the Node JSON-RPC transport, host notification
helpers, and delegate typings instead of implementing stdio framing manually.
Then use the SDK CLI in two steps:

```bash
# Build runtime assets from a plugin directory
npx openvcs build

# Package a bundle from a plugin directory
npx openvcs dist --plugin-dir . --out dist

# Or explicitly from anywhere
npx openvcs build --plugin-dir /path/to/plugin
npx openvcs dist --plugin-dir /path/to/plugin --out /path/to/dist
```

`openvcs dist` runs the build step automatically unless `--no-build` is passed.

Typical Node plugin author modules now look like:

```ts
import type { PluginModuleDefinition } from '@openvcs/sdk/runtime';

export const PluginDefinition: PluginModuleDefinition = {
  plugin: {
    async 'plugin.init'(_params, context) {
      context.host.info('Plugin started');
      return null;
    },
  },
};

export function OnPluginStart(): void {}
```

VCS backends can keep that same startup flow while using the SDK's class-based
delegate helper:

```ts
import {
  VcsDelegateBase,
  type PluginModuleDefinition,
} from '@openvcs/sdk/runtime';

class ExampleVcsDelegates extends VcsDelegateBase<{}> {
  override getCaps() {
    return {
      commits: true,
      branches: true,
      tags: false,
      staging: true,
      push_pull: true,
      fast_forward: true,
    };
  }
}

export const PluginDefinition: PluginModuleDefinition = {};

export function OnPluginStart(): void {
  PluginDefinition.vcs = new ExampleVcsDelegates({}).toDelegates();
}
```

`VcsDelegateBase` maps ordinary prototype methods such as `getCaps()` or
`commitIndex()` to exact JSON-RPC method names like `vcs.get_caps` and
`vcs.commit_index`.

`openvcs build` then generates `bin/<module.exec>` as the SDK-owned bootstrap.
Keep `module.exec` different from `plugin.js`; `plugin.js` is reserved for the
compiled author module that exports `PluginDefinition` and `OnPluginStart()`.

See `Client/docs/plugin architecture.md` for the runtime model and `SDK/README.md` for packager details.
