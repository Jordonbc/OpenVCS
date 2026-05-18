<!-- Copyright © 2025-2026 OpenVCS Contributors -->
<!-- SPDX-License-Identifier: GPL-3.0-or-later -->

# Contributing to OpenVCS

Thanks for helping improve the OpenVCS desktop client. Contributions are welcome
across code, tests, documentation, design feedback, packaging, and plugin/runtime
work.

This guide applies to the main OpenVCS repository: the Rust backend, TypeScript
frontend, plugin host, and documentation. Plugin-specific work may belong in the
plugin repositories instead.

## Before you start

- Changes to OpenVCS itself belong here. Plugin-specific changes may belong in the
  relevant plugin repository instead.
- OpenVCS should stay VCS-agnostic. Git support comes from the built-in
  `openvcs.git` plugin, not from Git-specific application architecture.
- Large behavior, architecture, plugin/runtime, packaging, or UX changes should
  start with an issue or discussion before implementation.
- Security vulnerabilities must be reported privately. See [Security](#security).

## Project layout

```text
.
├── Backend/              # Rust + Tauri backend and plugin runtime
├── Frontend/             # TypeScript + Vite desktop UI
├── docs/                 # UX, plugin, architecture, and packaging docs
├── scripts/              # Build and plugin-materialization helpers
├── openvcs.plugins.json  # Built-in plugin source list
├── Cargo.toml            # Rust workspace manifest
└── Justfile              # Common build, test, and fix commands
```

Useful references:

- [`README.md`](README.md): overview, setup, roadmap, and quality commands.
- [`ARCHITECTURE.md`](ARCHITECTURE.md): frontend/backend/plugin boundaries.
- [`DESIGN.md`](DESIGN.md): design direction and contributor flow.
- [`docs/plugins.md`](docs/plugins.md): plugin config and sync behavior.
- [`docs/plugin architecture.md`](docs/plugin%20architecture.md): plugin runtime and JSON-RPC host contract.
- [`SECURITY.md`](SECURITY.md): supported security reporting process.

## Development setup

Install these first:

- [Rust](https://www.rust-lang.org/tools/install) and Cargo
- [Node.js](https://nodejs.org/) and npm
- [Git](https://git-scm.com/)
- [just](https://github.com/casey/just)

From the repository root, install frontend dependencies:

```bash
cd Frontend
npm install
```

Run the desktop app in development mode:

```bash
cd Backend
cargo tauri dev
```

## Common commands

These are the normal commands used while working on the client.

| Command | Purpose |
| --- | --- |
| `just fix` | Run `cargo fmt`, Clippy fixes, and frontend type-check. |
| `just test` | Run the main client test/check flow. |
| `cargo tauri dev` | Run the desktop app from `Backend/`. |
| `npm install` | Install frontend dependencies from `Frontend/`. |
| `npm run test` | Run frontend tests from `Frontend/`. |

Frontend-only changes should at least pass from `Frontend/`:

```bash
npm run test
```

Changes touching plugin runtime behavior should also be tested in the running app
with `cargo tauri dev`.

## What to work on

Good contributions include:

- Bug fixes with clear reproduction steps.
- Tests for backend commands, frontend behavior, plugin sync, and UI helpers.
- Documentation updates for commands, paths, plugin behavior, and architecture.
- UX improvements that keep keyboard-first and desktop workflows in mind.
- Plugin runtime improvements that preserve the JSON-RPC host contract.
- Packaging fixes for AppImage, Windows, or Flatpak-related build paths.

When unsure, open an issue first and describe the problem, proposed direction,
and any tradeoffs.

## Bug reports

Use public issues for normal bugs. Include:

- OpenVCS version or build channel.
- Operating system and architecture.
- Steps to reproduce.
- Expected behavior and actual behavior.
- Relevant logs, screenshots, or terminal output.
- Whether custom plugins or `openvcs.plugins.local.json` are involved.

Do not report security vulnerabilities in public issues.

## Pull requests

Pull requests should target the `Dev` branch.

Before opening a PR:

1. Keep the change focused on one concern.
2. Add or update tests when behavior changes.
3. Update docs in the same PR when behavior, commands, paths, config,
   packaging, plugin/runtime expectations, or user-visible workflows change.
4. Run the relevant commands from [Common commands](#common-commands).
5. Check that no secrets, local overrides, generated build output, or temporary
   files are included.

PR descriptions should include:

- Summary of the change.
- Linked issue or discussion, when relevant.
- Commands/tests run.
- Screenshots or screen recordings for visible UI changes.
- Architecture, plugin protocol, packaging, or security implications.

Use short, imperative commit subjects. Optional scopes are welcome, for example:

```text
backend: refresh plugin runtime config
frontend: improve repository list empty state
docs: clarify plugin sync flow
```

## Code style

- Follow the style of the files you are changing.
- Keep changes focused and avoid unrelated rewrites.
- Run `just fix` before submitting when your change touches code.
- Run `just test` before submitting when your change touches behavior.
- Add or update nearby tests when behavior changes.

## Documentation

- Document all new functions, structs, enums, traits, interfaces, classes, and
  types.
- Include examples for complex behavior.
- Keep README and docs aligned with code changes.
- Add SPDX/copyright headers to new source files.

## Architecture boundaries

Respect existing ownership boundaries:

- Frontend code calls Tauri commands; it does not run VCS operations directly.
- Backend command handlers live under `Backend/src/tauri_commands/` and are wired
  in `Backend/src/lib.rs`.
- VCS-specific behavior belongs in plugins where possible.
- Backend/plugin communication uses JSON-RPC over stdio.
- Host API or runtime changes must update both producer and consumer sides.

Common flows:

- Add a backend command: add the handler in `Backend/src/tauri_commands/`, wire it
  in `Backend/src/lib.rs`, then call it from frontend code.
- Add a UI feature: add a focused module under `Frontend/src/scripts/features/`
  and wire it from `Frontend/src/scripts/main.ts`.
- Add plugin RPC usage: update the backend plugin command path and keep
  `docs/plugin architecture.md` current.

## Plugin and configuration changes

- Built-in plugin sources live in `openvcs.plugins.json`.
- Local development can use `openvcs.plugins.local.json`; do not commit local
  override files.
- Built-in plugins are materialized into
  `target/openvcs/built-in-plugins/<plugin-id>/` during client builds.
- Plugin packages are ordinary npm packages with an `openvcs` object in
  `package.json`, compiled runtime files under `bin/`, and optional `themes/`.
- Plugins run as full-trust Node.js processes, so config and install UX changes
  have security implications.

## Generated files and local state

Do not edit or commit generated output directly, including:

- `target/`
- `dist/`
- `bin/`
- materialized built-in plugin output
- local config overrides such as `openvcs.plugins.local.json`
- local secret files such as `.env.tauri.local`

If generated files need to change, update the source inputs and document the
generation command.

## Security

Report security vulnerabilities through GitHub private security advisories for
this repository. Do not open public issues for vulnerabilities.

Review [`SECURITY.md`](SECURITY.md) before changing plugin execution, plugin
installation, network behavior, filesystem access, updater logic, crash reporting,
or configuration handling.

## License

By contributing, you agree that your contributions are licensed under the same
license as OpenVCS: [GPL-3.0-or-later](LICENSE).
