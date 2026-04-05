# OpenVCS Client Design

This document describes the design of the OpenVCS application in this module and is intended for contributors making behavior changes.

For a concise architecture map, see `ARCHITECTURE.md`.
For plugin packaging/runtime details, see `docs/plugin architecture.md` and `docs/plugins.md`.

## Purpose

This module contains the running application:

- `Frontend/`: TypeScript + Vite UI and interaction logic.
- `Backend/`: Rust + Tauri host runtime.

This design doc focuses on behavioral boundaries, runtime flows, and contributor guardrails.

## Design Goals

- Keep the UI responsive while running potentially long VCS operations.
- Keep VCS, filesystem, and process operations in backend command handlers.
- Support multiple VCS implementations through plugin-provided backends.
- Keep third-party/plugin execution isolated from the host process.

## System Context

OpenVCS client is split into three main runtime concerns:

1. UI layer (`Frontend/src/scripts/`): renders state and invokes backend commands.
2. Host layer (`Backend/src/`): owns app state, command handling, and orchestration.
3. Plugin modules (config-synchronized npm or local packages): out-of-process Node.js modules used by backend/plugin runtime.

Primary request flow:

1. UI calls `TAURI.invoke(...)` via `Frontend/src/scripts/lib/tauri.ts`.
2. Tauri routes to handlers registered in `Backend/src/lib.rs`.
3. Handler resolves state/current repo and runs backend operation.
4. Backend emits events/logs to UI as needed.

## Core Design Principles

### 1) Frontend does not execute VCS operations directly

UI code under `Frontend/src/scripts/features/` delegates repository operations to backend commands.

### 2) Backend owns mutable app and repo state

`Backend/src/state.rs` and command modules under `Backend/src/tauri_commands/` are the source of truth for active repo, recents, settings, and output log.

### 3) Backend to plugin communication is process-isolated

Plugin backend/function modules communicate over JSON-RPC over stdio (`Backend/src/plugin_runtime/node_instance.rs` and `Backend/src/plugin_runtime/vcs_proxy.rs`), not in-process calls.

### 4) Safety checks are centralized

Current repo/backend validity checks and progress forwarding are centralized in shared command helpers (`Backend/src/tauri_commands/shared.rs`).

## Runtime Flows

## Startup

- Backend starts in `Backend/src/lib.rs::run`.
- Built-in plugin bundles are synchronized (`plugin_bundles`).
- Optional reopen-last-repo behavior executes.
- Optional update check can emit `ui:update-available`.

## Repository Selection and Activation

- User actions like clone/open/add repo invoke commands in `Backend/src/tauri_commands/general.rs`.
- Backend resolves and opens the repository through plugin VCS backend resolution (`Backend/src/plugin_vcs_backends.rs`).
- On successful selection, backend emits `repo:selected`.

## Repository Operation Execution

- Feature commands (status, branch, commit, remotes, stash, conflicts, repo files) run through dedicated modules in `Backend/src/tauri_commands/`.
- Long-running operations use blocking-task wrappers (`run_repo_task`) and emit progress/log events.

## Plugin Lifecycle

- Plugin discovery, load, installation, uninstall, approval gating, and function invocation are handled in `Backend/src/tauri_commands/plugins.rs` plus plugin store/runtime modules.

## State Model

OpenVCS keeps a clear split between:

- Global settings (`get_global_settings` / `set_global_settings`).
- Repo-scoped settings (`get_repo_settings` / `set_repo_settings`).
- Active repository handle in backend state (validated before use).
- Recent repositories list and output-log buffers.

If a selected backend disappears (for example plugin disabled/uninstalled), backend rejects stale operations and clears active repo selection.

## Eventing Model

Backend emits events for reactive UI updates and progress feedback, including:

- `repo:selected`
- `git-progress`
- `vcs:log`
- SSH/auth prompt events from remote operations
- updater-related events (`ui:update-available`, `update:progress`, completion/failure events)

Event producers are primarily in:

- `Backend/src/tauri_commands/shared.rs`
- `Backend/src/tauri_commands/remotes.rs`
- `Backend/src/tauri_commands/updater.rs`
- `Backend/src/tauri_commands/plugins.rs`
- `Backend/src/tauri_commands/general.rs`

Frontend listeners are attached through `TAURI.listen(...)` in feature modules.

## Reliability and Safety

- Command handlers return stringified errors at the Tauri boundary for predictable UI handling.
- Plugin module execution has timeout/restart/backoff behavior in runtime helpers.
- Bundle install/runtime path and approval checks are enforced in backend plugin subsystems.
- Output logging is centralized so operations can be inspected in the output-log UI.

## Contributor Guidance

When adding or changing behavior:

1. Add backend command handlers under the relevant file in `Backend/src/tauri_commands/`.
2. Register commands in `Backend/src/lib.rs` invoke handler.
3. Call them from `Frontend/src/scripts/features/...` via `TAURI.invoke`.
4. Emit/consume events only when asynchronous feedback is needed.
5. Keep repo/VCS logic in backend; keep frontend focused on presentation and interaction.
6. Update docs when architectural boundaries, plugin behavior, or user-visible flows change.

## References

- `ARCHITECTURE.md`
- `Backend/src/lib.rs`
- `Backend/src/tauri_commands/mod.rs`
- `Backend/src/tauri_commands/shared.rs`
- `Backend/src/plugin_runtime/node_instance.rs`
- `Backend/src/plugin_runtime/vcs_proxy.rs`
- `Backend/src/plugin_vcs_backends.rs`
- `Frontend/src/scripts/lib/tauri.ts`
- `Frontend/src/scripts/main.ts`
- `docs/plugin architecture.md`
- `docs/plugins.md`
