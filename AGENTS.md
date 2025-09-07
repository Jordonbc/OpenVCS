# AGENTS.md

*A concise brief for coding agents and automation tools working on ****OpenVCS****.*

> This file is machine‑friendly but readable. Keep it up‑to‑date as the project evolves.

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
- **Commits:** Conventional style, e.g., `backend:`, `frontend:`, `core:`, `git:`.
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

- No formal tests yet. Avoid adding test scaffolding without a maintainer proposal.

## Contribution Flow

- Small PRs with clear scope preferred.
- Larger changes: open an issue first and tag as `proposal`.

---

*Keep this file concise. For larger details, link out to docs in **`docs/`**.*

