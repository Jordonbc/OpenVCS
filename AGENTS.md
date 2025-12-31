# AGENTS.md

*A concise brief for coding agents and automation tools working on ****OpenVCS****.*

> This file is machine‑friendly but readable. Keep it up‑to‑date as the project evolves.

# Tooling Rules (MUST FOLLOW)

- All file edits MUST use the `apply_patch` tool, producing unified diffs first.
- DO NOT write files via shell commands (`sed -i`, `tee`, `cat >`, `python -c`, redirections, etc.).
- Assume direct shell writes will be blocked; do not attempt them.
- Commands are allowed for READ-ONLY work (search, list, diff, log, compile, run tests).
- If an edit is needed: generate a single `apply_patch` with complete diffs and a summary.
- After applying a patch, run only read-only verification commands unless explicitly approved.
- If a shell-write is ever proposed, replace it with `apply_patch` before proceeding.

- After applying a patch, run `just fix` (the project Justfile target) to auto-fix formatting, lint, and other small issues before committing.
- Commit changes locally with a clear, conventional commit message, but do NOT push to any remote; leave pushing/PR creation to a human maintainer.

**Sandbox note**: Running `just fix` and some `cargo` commands (for example `cargo build`, `cargo tauri dev`, or commands that fetch dependencies or build native binaries) may require network access or host-level tooling and therefore need to be run outside a restricted sandbox or container. If you are operating with sandboxing or restricted network access, request approval before executing these commands or run them on the host machine.


## Project Summary

- **Goal:** Open‑source, fully customisable VCS client. Git first; long‑term multi‑VCS via modular backends.
- **Targets:** Linux‑first; Windows builds supported; macOS experimental.
- **Status:** Early development. Core VCS comes first. UI, theming, and plugins come later.

## Repository Layout

```
.
├── Backend/              # Rust + Tauri app (native entry)
├── Frontend/             # TypeScript + Vite UI
├── crates/               # Rust crates (modular backends & core)
│   ├── openvcs-core      # Core traits & abstractions
│   ├── openvcs-git       # Git implementation (system git)
│   └── openvcs-git-libgit2 # Git via libgit2 (alt backend)
├── Cargo.toml            # Workspace manifest (root)
├── LICENSE               # GPL-3.0
└── README.md             # Human-facing overview
```

## Setup & Build Commands

Run commands from the **workspace root** unless stated otherwise.

- **Install frontend deps**:
  ```bash
  cd Frontend && npm install
  ```
- **Build frontend only**:
  ```bash
  cd Frontend && npm run build
  ```
- **Type-check frontend only**:
  ```bash
  cd Frontend && npm exec tsc -- -p tsconfig.json --noEmit
  ```
- **Dev run** (Tauri + Vite; from root):
  ```bash
  cargo tauri dev
  ```
- **Build app** (from root):
  ```bash
  cargo tauri build
  ```
- **Build workspace only**:
  ```bash
  cargo build
  ```

## Conventions

- **Rust:** Stable toolchain, idiomatic Rust, small crates with clear ownership boundaries.
- **TypeScript:** Strict TS in `Frontend/`.
- **Formatting:** Use default `rustfmt`; ESLint rules for TS (to be added; assume defaults).
- **Linting:** Keep `cargo clippy --all-targets -- -D warnings` clean (CI runs this after rustfmt).
- **Commits:** Conventional style, e.g., `backend:`, `frontend:`, `core:`, `git:`.
- Commit message format: agents must format commit messages with a short
  title of at most 72 characters, followed by a blank line and any
  additional explanatory text in the body.
- **License:** All contributions under **GPL‑3.0**.

## Architecture Notes

- **Core:** `openvcs-core` defines traits and abstractions.
- **Backends:** Initial focus on Git; other VCS backends follow after MVP.
- **Bridge:** Tauri `invoke` for request/response, events for progress.
- **Local‑first:** No telemetry or background tracking.

## Assets

- Screenshots may be tracked via **Git LFS**. GitHub renders LFS PNGs/JPEGs correctly in Markdown.
- Use repo‑relative paths (e.g., `docs/images/Main-UI-Preview.png`).

## Testing & CI

- CI runs `cargo fmt --all -- --check` followed by `cargo clippy --all-targets -- -D warnings`.
- Frontend unit tests are supported using Vitest. Small, focused tests are welcome for pure/UI‑independent logic (utilities, parsers, formatting helpers).
- Local test helpers:
  - `just test` — runs `cargo test --workspace`, then frontend typecheck and Vitest (`npm exec tsc -- -p tsconfig.json --noEmit` and `npm test`).
  - `just fix` — runs formatting/quick fixes and also builds and typechecks the frontend (`cd Frontend && npm run build` and `npm exec tsc -- -p tsconfig.json --noEmit`).

Note: Adding tests is fine for modules that are pure or have clear boundaries; avoid adding extensive UI integration tests without a maintainer proposal. Some commands (installing Node deps, running Tauri dev/build) may require network access and native toolchain components.

## Contribution Flow

- Small PRs with clear scope preferred.
- Larger changes: open an issue first and tag as `proposal`.
- Use apply_patch function to propose and make edits.

---

*Keep this file concise. For larger details, link out to docs in **`docs/`**.*
