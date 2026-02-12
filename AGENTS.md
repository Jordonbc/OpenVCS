# Repository Guidelines

## Project Structure & Module Organization
- `Backend/`: Rust + Tauri application code (`src/`), commands (`src/tauri_commands/`), and plugin runtime.
- `Backend/built-in-plugins/`: git submodules for bundled plugins; initialize/update with `git submodule update --init --recursive`.
- `Frontend/`: TypeScript + Vite UI (`src/scripts/`, `src/styles/`, `src/modals/`), with Vitest tests colocated as `*.test.ts`.
- `docs/`: architecture and plugin docs plus UI assets.
- `packaging/flatpak/`: Flatpak manifests and packaging notes.
- Root files: workspace `Cargo.toml`, `Justfile`, and project docs (`README.md`, `ARCHITECTURE.md`, `SECURITY.md`).

## Build, Test, and Development Commands
- `just build` (or `just build client|plugins`): build frontend, backend, and plugin bundles.
- `git submodule update --init --recursive`: fetch submodule content (required before plugin builds/tests).
- `just test`: workspace Rust tests + frontend TypeScript check + Vitest run.
- `just fix`: run `cargo fmt`, `cargo clippy --fix`, and frontend typecheck.
- `cargo tauri dev`: run the desktop app in development mode.
- `npm --prefix Frontend run dev`: run frontend-only Vite dev server.
- `just tauri-build`: production Tauri build wrapper.

## Coding Style & Naming Conventions
- Rust: format with `cargo fmt --all`; keep clippy-clean (`cargo clippy --all-targets -- -D warnings`).
- TypeScript: 2-space indentation, ES modules, and small feature-focused files under `Frontend/src/scripts/features/`.
- Tests: name frontend tests `*.test.ts` near the implementation (example: `Frontend/src/scripts/lib/dom.test.ts`).
- Naming: use `snake_case` for Rust modules/functions and `camelCase` for TypeScript variables/functions.

# ExecPlans

When writing complex features or significant refactors, use an ExecPlan (as described in .agent/PLANS.md) from design to implementation.

## Testing Guidelines
- Run full checks before opening a PR: `just test`.
- For frontend-only work, run `cd Frontend && npm test` and `npm exec tsc -- -p tsconfig.json --noEmit`.
- Add or update tests for behavior changes; prefer focused unit tests over broad snapshots.

## Commit & Pull Request Guidelines
- Follow existing commit style: short imperative subject, optional scope prefix (examples: `backend: fix tauri precommands`, `ci: add wasm32-wasip1 target`, `chore(deps): bump @types/node`).
- Keep commits logically scoped; avoid mixing frontend/backend refactors unless required.
- Do not directly modify plugin code under `Backend/built-in-plugins/`; only update submodule pointers in this repository when explicitly requested.
- PRs should include: summary of behavior changes, linked issue(s), test evidence (command output), and screenshots for UI changes.
- Target the `Dev` branch for normal development work.

## Security & Configuration Tips
- Review `SECURITY.md` before changing update, plugin, or network-related code paths.
- Do not commit secrets; keep local overrides in files like `.env.tauri.local`.
- Do not directly edit code inside git submodules (including `Backend/built-in-plugins/*`) unless the task explicitly requires a submodule update; treat submodule changes as pointer-only updates in this repo.
