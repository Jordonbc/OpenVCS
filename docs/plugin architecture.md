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
    lib.rs      # Rust library
  Cargo.toml
```

Plugin author writes:

```rust
// src/lib.rs
use openvcs_core::plugin_api::*;

// Internal helpers - NOT ABI
fn helper() -> ... { ... }

// Plugin ABI - functions in mod plugin are exported
#[openvcs_plugin]
mod plugin {
    use super::*;
    
    pub fn init() -> Result<(), PluginError> { Ok(()) }
    pub fn deinit() -> Result<(), PluginError> { Ok(()) }
}

// Generate WIT Guest impl
openvcs_core::export_plugin!(plugin);
```

### VCS Plugin

Same as Code Plugin, but implements VCS functions:

```rust
// src/lib.rs
use openvcs_core::vcs_api::*;

// Internal helpers - NOT ABI
fn helper() -> ... { ... }

// Plugin ABI - functions in mod plugin are exported
#[openvcs_plugin]
mod plugin {
    use super::*;
    
    pub fn init() -> Result<(), PluginError> { Ok(()) }
    pub fn deinit() -> Result<(), PluginError> { Ok(()) }
    pub fn get_caps() -> Result<Capabilities, PluginError> { ... }
    pub fn list_branches() -> Result<Vec<BranchItem>, PluginError> { ... }
    // ... all VCS functions required
}

// Generate WIT Guest impl
openvcs_core::export_plugin!(plugin);
```

## Why This Structure?

The `mod plugin` approach provides clear separation:

- **Outside `mod plugin`** - Internal helpers, not exported to WIT
- **Inside `mod plugin`** - ABI functions, exported to WIT

This is more explicit than marking every function, while keeping the plugin code organized.

## WIT Interfaces

### plugin.wit (Required)

Required for all code plugins:

```wit
interface plugin-api {
  init: func() -> result<_, plugin-error>
  deinit: func() -> result<_, plugin-error>
}

world plugin {
  import host-api;
  export plugin-api;
}
```

### vcs.wit (Optional)

For VCS backend plugins:

```wit
interface vcs-api {
  get-caps: func() -> result<capabilities, plugin-error>
  open: func(path: string, config: list<u8>) -> result<_, plugin-error>
  list-branches: func() -> result list<branch-item>
  commit: func(message: string, name: string, email: string, paths: list<string>) -> result<string>
  // ... all VCS functions
}

world vcs {
  import host-api;
  export vcs-api;
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

## The Macros

### `#[openvcs_plugin]`

Marks a module as containing plugin ABI functions:

```rust
#[openvcs_plugin]
mod plugin {
    pub fn init() -> ... { }
    pub fn deinit() -> ... { }
}
```

### `export_plugin!`

Generates the WIT Guest impl:

```rust
openvcs_core::export_plugin!(plugin);
```

This must be called after the `#[openvcs_plugin]` mod is defined.

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
