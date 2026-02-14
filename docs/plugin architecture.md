# OpenVCS Plugin Bundles (.ovcsp) — Architecture

This document describes OpenVCS’s **secure, out-of-process** plugin system for distributing plugins as **`.ovcsp`** bundles.

## Goals (non-negotiables)

- The OpenVCS-Client process **never loads third-party dynamic libraries** and **never runs third-party plugin code in-process**.
- Every plugin component executes **out-of-process** and communicates over the **component-model WIT ABI**.
- Plugins are **installed (unpacked) before execution**; nothing executes directly from inside a tar.xz archive.
- The bundle manifest uses the existing `openvcs.plugin.json` format and extends it minimally.

## Bundle format

An `.ovcsp` is a tar.xz archive containing exactly one top-level plugin folder named by plugin id:

```
<pluginId>/
  openvcs.plugin.json
  bin/
    <entrypoint>.wasm
  assets/...               (optional)
  themes/...               (optional; existing `theme.json` packs)
```

Notes:

- Bundles are **WASM-only**; OpenVCS will reject native binaries.
- Bundle entry paths must be relative and use `/` separators (the installer normalizes and validates).

## Manifest (`openvcs.plugin.json`)

Existing fields like `id`, `name`, `version`, etc. remain unchanged.

This system uses the `module` section (used by `OpenVCS-Plugin-Git`) and adds:

- `capabilities`: string array of requested capabilities.
- `functions`: optional function component descriptor.

Example:

```json
{
  "id": "openvcs.git",
  "name": "Git",
  "version": "0.1.0",
  "capabilities": ["workspace.read", "vcs.read", "vcs.write"],
  "module": {
    "exec": "openvcs-git-plugin.wasm",
    "vcs_backends": [
      { "id": "git", "name": "Git" }
    ]
  },
  "functions": {
    "exec": "openvcs-hello-functions.wasm"
  }
}
```

### Component types

- **Module component** (`module`): a plugin-executed WASI module. It is spawned with:
  - module: `bin/<module.exec>` (must end in `.wasm`)
  - arguments: `--backend <backendId>` for each id in `module.vcs_backends`
  - protocol: component-model host/plugin interfaces from `Core/wit/openvcs-core.wit`
- **Function component** (`functions`): a WASI module exposing callable functions/hooks/commands over the same component-model transport.

## Installation locations and layout

OpenVCS installs bundles into the user config directory (via `directories::ProjectDirs`):

- Config root:
  - Linux: `$XDG_CONFIG_HOME/OpenVCS` (or `~/.config/OpenVCS`)
  - Windows: `%APPDATA%\\OpenVCS`
  - macOS: `~/Library/Application Support/OpenVCS`

Installed bundle layout:

```
plugins/
  <pluginId>/
    index.json              (metadata, including SHA-256 + approvals)
    current.json            (pointer: {"version": "..."}; used instead of symlinks)
    <version>/
      openvcs.plugin.json
      bin/...
      ...
```

The runtime discovers plugins **only** from this installed directory and resolves `<pluginId>/current.json` to a concrete version folder.

## Security model

### Secure ZIP extraction (install-time)

The installer enforces:

- **ZipSlip/path traversal prevention**
  - reject absolute paths and Windows drive prefixes
  - normalize separators and reject any `..` components
  - canonicalize and ensure every extracted path stays within the install directory
- **Symlink rejection**
  - reject any archive entries that are symlinks (Unix mode `0120000`)
- **Resource limits**
  - cap total uncompressed size per bundle
  - cap per-file size
  - cap file count
  - reject suspicious compression ratios (zip-bomb heuristics)
- **Required file validation**
  - `openvcs.plugin.json` must exist at `<pluginId>/openvcs.plugin.json`
  - declared component entrypoints must exist under `bin/` after extraction and be valid `.wasm` modules
- **Integrity**
  - compute and store SHA-256 of the `.ovcsp` bundle in `<pluginId>/index.json`

### Trust + capabilities

Plugins are **untrusted by default**.

- Capabilities are declared in the manifest (`capabilities`).
- Capabilities must be **approved by the user** at install-time (or on first run).
- The host enforces capabilities for **plugin → host** JSON-RPC calls; denied calls return structured errors.

Capability strings:

- `workspace.read`, `workspace.write`
- `vcs.read`, `vcs.write`
- `network.http`
- `credentials.request`
- `ui.commands`, `ui.notifications`

### Process isolation (best-effort)

Each plugin component is spawned with:

- sanitized environment (allowlist)
- controlled working directory
- restricted `PATH` and no implicit shell execution

Runtime hardening:

- per-request timeouts and cancellation best-effort
- stdout/stderr captured into per-plugin logs (rotation + size limits)
- crash restart with exponential backoff; auto-disable after repeated crashes

OS-level sandboxing is optional and best-effort:

- Linux: supports wrappers (e.g. `bwrap`) if configured; otherwise runs unprivileged.
- Windows/macOS: no large dependencies; relies on install validation + capability gating + process isolation.
