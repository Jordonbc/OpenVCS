# OpenVCS Plugin Architecture

This document describes OpenVCS's plugin system.

## Architecture

```
Client <---> Core <---> Plugin
```

No translation layers. Just **WIT and Rust**.

- **Core** is the glue - provides WIT bindings, host implementation, plugin runtime
- **Plugins** are pure WASM components with no boilerplate
- **Client** loads and communicates with plugins via WIT

## Plugin Types

| Type           | Code | Required Functions                   |
| -------------- | ---- | ------------------------------------ |
| **Theme**      | No   | None                                 |
| **Code**       | Yes  | `init`, `deinit`                     |
| **Code + VCS** | Yes  | `init`, `deinit` + all VCS functions |

VCS is optional - plugins can implement it if they provide a VCS backend.

## Plugin Structure

### Theme Plugin

```
<pluginId>/
  openvcs.plugin.json
  themes/
    <themeName>/
      theme.json
      theme.css
      ...
```

No Rust code. Theme plugins ship UI assets only.

### Code Plugin

```
<pluginId>/
  openvcs.plugin.json
  src/
    lib.rs      # Rust library with #[openvcs_plugin] marked functions
  Cargo.toml
```

Plugin author writes:

```rust
// src/lib.rs
use openvcs_core::plugin_api::*;

#[openvcs_plugin]
pub fn init() -> Result<(), PluginError> { Ok(()) }

#[openvcs_plugin]
pub fn deinit() -> Result<(), PluginError> { Ok(()) }
```

### VCS Plugin

Same as Code Plugin, but implements VCS functions:

```rust
// src/lib.rs
use openvcs_core::vcs_api::*;

#[openvcs_plugin]
pub fn init() -> Result<(), PluginError> { Ok(()) }

#[openvcs_plugin]
pub fn deinit() -> Result<(), PluginError> { Ok(()) }

#[openvcs_plugin]
pub fn get_caps() -> Result<Capabilities, PluginError> { ... }

#[openvcs_plugin]
pub fn list_branches() -> Result<Vec<BranchItem>, PluginError> { ... }
// ... all VCS functions required
```

## WIT Interfaces

### plugin-api (Required)

Required for all code plugins:

```wit
interface plugin-api {
  init: func() -> result<_, plugin-error>
  deinit: func() -> result<_, plugin-error>
}
```

### vcs-api (Optional)

For VCS backend plugins:

```wit
interface vcs-api {
  get-caps: func() -> result<capabilities, plugin-error>
  open: func(path: string, config: list<u8>) -> result<_, plugin-error>
  list-branches: func() -> result list<branch-item>
  commit: func(message: string, name: string, email: string, paths: list<string>) -> result<string>
  // ... all VCS functions
}
```

### Custom WIT (Optional)

Plugins can define their own WIT interfaces for **plugin-to-plugin** communication.

Example: A GitHub plugin exports a `github-api` interface that other plugins can call.

## Plugin Dependencies

Plugins can declare dependencies on other plugins:

```json
{
  "id": "my-plugin",
  "dependencies": {
    "openvcs.github": {
      "required": false
    },
    "openvcs.ai": {
      "required": true
    }
  }
}
```

- Required dependencies: plugin fails to load if missing
- Optional dependencies: plugin loads without them (can check at runtime)

## The `#[openvcs_plugin]` Macro

Every ABI function must be marked with `#[openvcs_plugin]`:

```rust
use openvcs_core::vcs_api::*;

#[openvcs_plugin]
pub fn init() -> Result<(), PluginError> { ... }

#[openvcs_plugin]
pub fn get_caps() -> Result<Capabilities, PluginError> { ... }
```

The macro:

1. Marks functions as WIT exports
2. Generates the WIT Guest impl
3. Handles error conversion

## Building Plugins

SDK builds plugins with:

```bash
cargo build --lib --target wasm32-wasip1
```

No shim generation. No code generation. Just compile the library to WASM.

## Bundle Format (.ovcsp)

An `.ovcsp` is a tar.xz archive:

```
<pluginId>/
  openvcs.plugin.json
  bin/
    <plugin>.wasm
  assets/...      (optional)
  themes/...      (optional, theme plugins only)
```

## Manifest (`openvcs.plugin.json`)

```json
{
  "id": "openvcs.git",
  "name": "Git",
  "version": "0.1.0",
  "author": "OpenVCS Team",
  "description": "Git VCS backend",
  "default_enabled": true,
  "dependencies": {}
}
```

## Security

- Plugins run **out-of-process** in WebAssembly
- Client never loads third-party dynamic libraries
- No native code execution from plugins
- Capabilities declared in manifest, approved by user
- Process isolation + resource limits
