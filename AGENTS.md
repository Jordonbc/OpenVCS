# Repository Guidelines

## Project structure & module organization
- `Backend/`: Rust + Tauri backend (`src/`), commands (`src/tauri_commands/`), plugin runtime (`src/plugin_runtime/`), and bundled plugin support (`src/plugin_runtime`, `scripts/`).
- `Backend/built-in-plugins/`: local copies of bundled plugins (do not edit their code unless explicitly requested; update submodule pointers instead).
- `Frontend/`: TypeScript + Vite UI code (`src/scripts/`, `src/styles/`, `src/modals/`), with Vitest tests colocated as `*.test.ts` files.
- `docs/`: UX docs, plugin architecture notes, and plugin/theme packaging guides referenced by contributors.
- `packaging/flatpak/`: Flatpak manifests and Flatpak-specific build notes.
- Supporting files at the repo root include the workspace `Cargo.toml`, `Justfile`, `README.md`, `ARCHITECTURE.md`, `SECURITY.md`, and installer scripts.

## Build, test, and development commands
- `just build` (or `just build client|plugins`): builds the backend, frontend, and plugin bundles from the workspace Justfile.
- `just test`: runs workspace Rust tests plus frontend type-check + Vitest via the Justfile.
- `just fix`: formatter/lint quick fixes (runs `cargo fmt`, `cargo clippy --fix`, frontend type-check, and bundle verification).
- `cargo tauri dev`: run the desktop app in dev mode (`Backend/` directory).
- `npm --prefix Frontend run dev`: run the frontend-only Vite dev server; use `npm --prefix Frontend exec tsc -- -p tsconfig.json --noEmit` for TS checks and `npm --prefix Frontend test` for Vitest when needed.
- `just tauri-build`: production Tauri build wrapper (AppImage/Flatpak). `git submodule update --init --recursive` is required before building bundled plugins.

## Plugin runtime & host expectations
- Plugin components live under `Backend/built-in-plugins/` and follow the manifest format in `openvcs.plugin.json`. Built-in bundles ship with the AppImage/Flatpak and are also built by the SDK (`cargo openvcs dist`).
- The backend loads plugin modules as Wasmtime component-model `*.wasm` files via `Backend/src/plugin_runtime/component_instance.rs`. The canonical host/plugin contract is defined in `Core/wit/openvcs-core.wit` (see `openvcs_core::app_api`).
- When changing host APIs, capability strings, or runtime behavior, update `Core/wit/openvcs-core.wit`, the generated bindings, and the runtime logic in `Backend/src/plugin_runtime`.
- JavaScript-based plugin UI contributions (e.g., `entry.js`) are deprecated: route new UI work through the host/app APIs rather than embedding JS so bundles remain Wasm-only.

## Coding style & conventions
- Rust: run `cargo fmt --all`, keep `cargo clippy --all-targets -- -D warnings` clean, prefer `snake_case` for modules/functions and `PascalCase` for structs/enums.
- TypeScript: 2-space indentation, ES modules, small feature-focused files under `Frontend/src/scripts/features/`. Tests should be alongside the code (`*.test.ts`).
- Keep plugin UI contributions (e.g., `Backend/built-in-plugins/Git/entry.js`) concise and prefer host APIs (`OpenVCS.invoke`, settings/actions) documented in `docs/`.

## ExecPlans
- For multi-component features or refactors, create/update an ExecPlan (`Client/PLANS.md`). Outline design, component impacts, and how the plugin runtime is exercised.

## Testing guidelines
- Run `just test` before PRs; frontend-only work should at least cover `npm --prefix Frontend exec tsc -- -p tsconfig.json --noEmit` and `npm --prefix Frontend test`.
- Use `cargo tauri dev` to verify runtime plugin interactions (especially when touching `Backend/src/plugin_runtime/`), and make sure `docs/plugin architecture.md` stays aligned with behavior.

## Commit & PR guidelines
- Use short, imperative commit subjects (optionally scoped, e.g., `backend: refresh plugin runtime config`). Keep changelist focused; avoid mixing UI and backend refactors unless necessary.
- PRs should target the `Dev` branch, include a summary, issue links, commands/tests run, and highlight architecture implications (host API changes, plugin capability updates, security decisions).
- Do not modify plugin code inside submodules unless explicitly asked; treat submodule updates as pointer bumps after upstream changes.
- Keep this AGENTS (and other module-level copies you rely on) current whenever workflows, tooling, or responsibilities change so future contributors can find accurate guidance.

## Security & configuration notes
- Review `SECURITY.md` before making plugin, plugin-install, or network-related changes.
- Keep secrets out of the repo; use `.env.tauri.local` for local overrides and do not check them in. If new config flags are introduced, document them in `docs/` and update relevant settings screens/logs.
