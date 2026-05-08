# Repository Guidelines

## Project structure & module organization

- `Backend/`: Rust + Tauri backend (`src/`), commands (`src/tauri_commands/`), plugin runtime (`src/plugin_runtime/`), and config-driven plugin sync support (`scripts/`).
- `openvcs.plugins.json`: built-in plugin source list used to materialize shipped plugins during client builds.
- `Frontend/`: TypeScript + Vite UI code (`src/scripts/`, `src/styles/`, `src/modals/`), with Vitest tests colocated as `*.test.ts` files.
- OpenVCS is desktop-only: there is no web app, no standalone browser mode, and no supported web browser/WebView deployment target.
- `docs/`: UX docs, plugin architecture notes, and plugin/theme packaging guides referenced by contributors.
- `packaging/flatpak/`: Flatpak manifests and Flatpak-specific build notes.
- Supporting files at the repo root include the workspace `Cargo.toml`, `Justfile`, `README.md`, `ARCHITECTURE.md`, `SECURITY.md`, and installer scripts.

## Build, test, and development commands

### Full builds
- `just build` (or `just build client|plugins`): builds the backend, frontend, and materialized built-in plugins from the workspace Justfile.
- `just tauri-build`: production Tauri build wrapper (AppImage/Flatpak).

### Running tests

**All tests:**
- `just test`: runs workspace Rust tests plus frontend type-check + Vitest via the Justfile; it now fails fast if any step fails.

**Frontend (Vitest):**
- `npm --prefix Frontend test`: run all tests
- `npm --prefix Frontend test run`: run tests once (non-watch mode)
- `npm --prefix Frontend test -- --run`: explicit non-watch mode
- `npm --prefix Frontend test -- src/scripts/lib/dom.test.ts`: run single test file
- `npm --prefix Frontend test -- --run -t "qs and qsa"`: run single test by name pattern
- `npm --prefix Frontend test -- --watch`: watch mode for development

**Backend (Rust):**
- `cargo test --workspace`: run all Rust tests
- `cargo test`: run tests for current crate
- `cargo test --package openvcs_lib`: test specific crate
- `cargo test --lib`: run only library tests (not integration tests)
- `cargo test --lib -- branch`: run tests matching "branch" in name
- `cargo test --lib -- --test-threads=1`: run tests sequentially (for flaky tests)

### Linting and formatting

- `just fix`: formatter/lint quick fixes (runs `cargo fmt`, `cargo clippy --fix`, and frontend type-check).
- `cargo fmt --all`: format Rust code
- `cargo clippy --all-targets -- -D warnings`: check Rust for issues
- `cargo clippy --fix --all-targets --allow-dirty`: auto-fix clippy issues
- `npm --prefix Frontend exec tsc -- -p tsconfig.json --noEmit`: TypeScript type-check

### Development servers

- `cargo tauri dev`: run the desktop app in dev mode (`Backend/` directory).
- `npm --prefix Frontend run dev`: run the frontend-only Vite dev server for desktop UI development only; it is not a web app/browser deployment.

## Plugin runtime & host expectations

- Plugin components are ordinary npm packages declared by config. Built-ins are listed in `openvcs.plugins.json` and materialized into `target/openvcs/built-in-plugins/<plugin-id>/` before packaging.
- The backend loads plugin modules as Node.js runtime scripts (`*.mjs|*.js|*.cjs`) via `Backend/src/plugin_runtime/node_instance.rs`.
- The canonical host/plugin contract is JSON-RPC over stdio with method names in `Backend/src/plugin_runtime/protocol.rs`.
- When changing host APIs or runtime behavior, update protocol constants and runtime logic in `Backend/src/plugin_runtime`.

## Coding style & conventions

### Rust

**Formatting:**
- Run `cargo fmt --all` before committing
- Use default Rust formatting (4-space indentation, etc.)
- Keep lines under ~100 characters when reasonable

**Naming:**
- `snake_case` for modules, functions, and variables
- `PascalCase` for structs, enums, and trait names
- Prefix private fields with underscore (e.g., `self._field`)
- Use descriptive names; avoid single letters except in tight loops

**Imports:**
- Group imports: std library first, then external crates, then local modules
- Use `use` statements for frequently used items
- Prefer absolute paths from crate root (`crate::module::Item`)

**Error handling:**
- Use `Result<T, E>` for fallible operations; avoid `panic!` in library code
- Use `?` operator for propagating errors
- Include context in error messages: `some_func().context("failed to load config")?`
- Log warnings for recoverable errors with `log::warn`
- Use `anyhow` for application code (commands, main) when context is needed

**Types & patterns:**
- Prefer `Arc<T>` for shared ownership across threads
- Use `tokio` async runtime for I/O-bound async operations
- Use `parking_lot` mutexes (faster than std)
- Derive `Clone`, `Debug`, `Serialize`, `Deserialize` as needed

### Documentation

- **ALL code must be documented**, not just public APIs. This includes:
  - Rust: Use doc comments (`///` for items, `//!` for modules) for all functions, structs, enums, traits, and fields.
  - TypeScript: Use JSDoc comments (`/** ... */`) for all functions, classes, interfaces, and types.
- All functions must include documentation comments.
- All code files MUST be no more than 1000 lines; split files before they exceed this limit.
- When you change behavior, workflows, commands, paths, config, or plugin/runtime expectations, ALWAYS update the relevant documentation in the same change, even if the user does not explicitly ask.
- Include usage examples for complex functions.
- Keep README files in sync with code changes.
- Document configuration options and environment variables.
- All new files must include the following copyright header:

```rust
// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later
```

```typescript
// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later
```

### TypeScript

**Formatting:**
- 2-space indentation (no tabs)
- Use ES modules (`import`/`export`)
- Keep lines under ~100 characters when reasonable
- Use semicolons at statement ends

**Naming:**
- `camelCase` for variables, functions, and methods
- `PascalCase` for classes, types, and interfaces
- Prefix private class members with underscore (e.g., `this._field`)
- Use descriptive names; avoid abbreviations except common ones (e.g., `btn`, `cfg`)

**Imports:**
- Use absolute imports from project root when possible
- Group imports: external libs, then relative `./` paths, then `../` paths
- Prefer named imports: `import { foo, bar } from './module'`
- Use type-only imports (`import type { Foo }`) when only using types

**Types:**
- Use explicit types for function parameters and return values
- Prefer interfaces for object shapes, types for unions/intersections
- Use `null` for "intentionally empty", `undefined` for "not yet set"
- Avoid `any`; use `unknown` when type is truly unknown

**Error handling:**
- Use try/catch for async operations; always handle or re-throw
- Use `Promise.catch(() => {})` for fire-and-forget async calls
- Show user-facing errors via `notify()` from `lib/notify`
- Log internal errors with console for debugging

**UI patterns:**
- Use `qs<T>('#id')` for single element queries from `lib/dom`
- Use `qsa('.class')` for multiple elements
- Use event delegation for list items
- Keep feature modules focused and small (<200 lines when possible)
- Colocate tests as `*.test.ts` next to the source file

### Testing

- Run `just test` before PRs
- Frontend-only work: run `npm --prefix Frontend exec tsc -- -p tsconfig.json --noEmit` and `npm --prefix Frontend test`
- Use Vitest's `describe`/`it`/`expect` for frontend tests
- Use descriptive test names: `it('finds elements by selector')`
- Use `beforeEach` to reset DOM state in DOM tests

## Testing guidelines

- Run `just test` before PRs; frontend-only work should at least cover `npm --prefix Frontend exec tsc -- -p tsconfig.json --noEmit` and `npm --prefix Frontend test`.
- Use `cargo tauri dev` to verify runtime plugin interactions (especially when touching `Backend/src/plugin_runtime/`), and make sure `docs/plugin architecture.md` stays aligned with behavior.
- The `opencode-review.yml` workflow must produce actual review findings or an explicit no-issues verdict; process summaries such as "I read X files" are not acceptable review output.

## Commit & PR guidelines

- Use short, imperative commit subjects (optionally scoped, e.g., `backend: refresh plugin runtime config`). Keep changelist focused; avoid mixing UI and backend refactors unless necessary.
- PRs should target the `Dev` branch, include a summary, issue links, commands/tests run, and highlight architecture implications (host API/protocol changes and security decisions).
- Keep built-in plugin source paths in `openvcs.plugins.json` aligned with the actual plugin packages that should ship with the client.
- Keep this AGENTS (and other module-level copies you rely on) current whenever workflows, tooling, or responsibilities change so future contributors can find accurate guidance.

## Security & configuration notes

- Review `SECURITY.md` before making plugin, plugin-install, or network-related changes.
- Keep secrets out of the repo; use `.env.tauri.local` for local overrides and do not check them in. If new config flags are introduced, document them in `docs/` and update relevant settings screens/logs.
