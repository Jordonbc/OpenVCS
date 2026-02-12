# Client Architecture

This document describes the architecture of the OpenVCS client application in `Client/`.

See umbrella context in `../ARCHITECTURE.md`.

## Bird's Eye View

`Client/` is the running desktop application:
- `Frontend/` is the TypeScript/Vite UI.
- `Backend/` is the Tauri/Rust host runtime.
- The backend exposes command handlers to frontend and delegates VCS work to plugin-provided backends.

Primary flow:
1. UI calls Tauri commands.
2. Backend command handlers resolve current repo/backend.
3. Backend uses plugin runtime proxies for VCS operations.
4. Backend emits UI events/log updates.

## Code Map

Frontend:
- `Frontend/src/scripts/main.ts`: UI bootstrap and feature wiring.
- `Frontend/src/scripts/lib/tauri.ts`: minimal bridge wrapper for `invoke`/`listen`.
- `Frontend/src/scripts/plugins.ts`: UI plugin runtime and plugin-contributed UI hooks.
- `Frontend/src/scripts/features/`: feature modules grouped by domain.
- `Frontend/src/styles/`: tokens, layout, modal, and component styles.

Backend:
- `Backend/src/lib.rs`: app startup, plugin sync, command registration.
- `Backend/src/tauri_commands/`: backend command surface grouped by feature area.
- `Backend/src/state.rs`: app config, repo state, recents, output log.
- `Backend/src/repo.rs`: repository handle wrapper around `Arc<dyn Vcs>`.
- `Backend/src/plugin_vcs_backends.rs`: backend discovery and open logic.
- `Backend/src/plugin_bundles.rs`: `.ovcsp` install/index/component resolution.
- `Backend/src/plugin_runtime/stdio_rpc.rs`: plugin process spawn, RPC transport, restarts/timeouts.
- `Backend/src/plugin_runtime/vcs_proxy.rs`: `Vcs` trait proxy over plugin RPC.
- `Backend/src/plugins.rs`: plugin discovery/manifest summarization for UI.

## Boundaries

- Frontend/backend boundary:
  Frontend never directly runs VCS operations; it calls backend commands.
- Command boundary:
  Feature-facing backend API lives under `Backend/src/tauri_commands/`.
- Backend/plugin boundary:
  Backend communicates with plugin components over stdio JSON-RPC, not in-process APIs.
- Settings boundary:
  Backend persists/loads app configuration and mediates environment application.

## Architecture Invariants

- Active repo backend is treated as dynamic availability; stale handles are rejected when backend disappears.
- Plugin components that request capabilities require approval before execution.
- Frontend plugin scripts can extend UI, but repository operations still route through backend commands.
- Output/log/progress signaling is centralized through backend event emission.

## Cross-Cutting Concerns

- State lifecycle:
  Startup config load, optional reopen-last-repo, runtime config updates.
- Plugin lifecycle:
  Built-in/user plugin discovery, install/uninstall, capability approvals.
- Reliability:
  RPC timeout handling, respawn backoff, and auto-disable after repeated crashes.
- UX:
  Theme management, modal/system prompts, command palette, keyboard flows.

## Common Contributor Tasks

- Add a new backend command:
  Add handler in `Backend/src/tauri_commands/` and wire in `Backend/src/lib.rs`.
- Add UI feature:
  Add module under `Frontend/src/scripts/features/` and wire from `main.ts`.
- Add plugin RPC method usage:
  Update backend plugin command path in `Backend/src/tauri_commands/plugins.rs`.
