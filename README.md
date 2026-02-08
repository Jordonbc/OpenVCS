<p align="center">
  <img src="docs/images/logos/OpenVCS-256.png" alt="OpenVCS logo" width="220">
</p>

<div align="center">

[![Nightly](https://github.com/Open-VCS/OpenVCS-Plugin-Git/actions/workflows/nightly.yml/badge.svg?branch=Dev)](https://github.com/Open-VCS/OpenVCS-Plugin-Git/actions/workflows/nightly.yml) [![Dev](https://github.com/Open-VCS/OpenVCS-Plugin-Git/actions/workflows/ci.yml/badge.svg?branch=Dev)](https://github.com/Open-VCS/OpenVCS-Plugin-Git/actions/workflows/ci.yml) [![Stable](https://github.com/Open-VCS/OpenVCS-Plugin-Git/actions/workflows/release.yml/badge.svg?branch=Stable)](https://github.com/Open-VCS/OpenVCS-Plugin-Git/actions/workflows/release.yml)

</div>

<div align="center">

**The open‑source, fully customisable VCS client.** 

</div>

OpenVCS is a new and upcoming cross‑platform version control client built with [Tauri](https://tauri.app/), [Rust](https://www.rust-lang.org/), and a modern [TypeScript](https://www.typescriptlang.org/) + [Vite](https://vitejs.dev/) frontend. It aims to be the **all‑in‑one solution** for version control: clean, fast, and extensible. Features are actively being explored and are **not yet finalised**.

> **Scope note:** The first main release focuses on **Git** to keep the scope tight. The long‑term vision is to support **all major VCS systems** through a backend/plugin architecture (e.g., Mercurial, SVN, Perforce, Fossil, etc.).

## Quick Install (AppImage)

OpenVCS provides a convenience script that fetches the latest AppImage, stores it at `~/Applications/openvcs.AppImage`, and creates a desktop entry so you can launch it from your app menu. Run:

```bash
curl -fsSL https://raw.githubusercontent.com/Jordonbc/OpenVCS/stable/install.sh | bash
```

The script targets Linux, leaves existing configuration untouched, and can be re-run to pull the newest release.

**Install pre-release (nightly):**

```bash
curl -fsSL https://raw.githubusercontent.com/Jordonbc/OpenVCS/stable/install.sh | bash -s -- --prerelease
```

**Uninstall:**

```bash
curl -fsSL https://raw.githubusercontent.com/Jordonbc/OpenVCS/stable/install.sh | bash -s -- --uninstall
```

Swap `stable` for `dev` in the URL if you want the bleeding-edge installer.

---

## Key Goals

- 🧩 **Fully customisable** - themes, layout, and extensibility at the core.
- 🗂 **Multi‑VCS architecture** - designed to support many backends beyond Git.
- ⚡ **Lightweight & fast** - native shell via Tauri + Rust.
- 🧰 **Developer‑first UX** - frictionless flows for common VCS tasks.

## Platform Targets

- 🐧 **Linux‑first** (primary target)
- 🪟 **Windows** builds supported
- 🍏 **macOS** not currently planned (community interest welcome)

## Features (Current)

- 🔗 **Git support** with a selectable backend (**system Git** by default; **libgit2** optional).
- 📁 **Repo workflows:** clone, open existing repos, recent repos list, optional reopen of last repo on launch.
- ✅ **Status & diffs:** working tree status, per-file diff, commit diff, discard changes.
- 🧩 **Staging & commits:** stage files, partial staging/commits via patch, commit from index.
- 🌿 **Branches:** list local/remote, create, checkout, rename, delete, set upstream tracking.
- 🔀 **Merge & conflicts:** merge branches, conflict details, checkout ours/theirs, save merged result, launch external merge tool, abort/continue merge.
- 🧳 **Stash:** list, push, apply, pop, drop, show.
- 🌐 **Sync & remotes:** set remote URL, fetch (single/all), pull (fast-forward only), push.
- 🗃 **Git LFS helpers:** fetch/pull/prune, track/untrack, inspect tracked paths.
- 🔐 **SSH helpers:** trust host keys, list/add SSH agent keys, key discovery.
- 🎨 **Themes:** built-in light/dark themes, plus plugin-provided themes (standalone theme `.zip` packs are not supported).
- 🧩 **Plugins (early):** local plugins with manifests, hooks/actions, and UI contributions (no store yet).
- 🔄 **Updater & logs:** update check/install, VCS output log window, app log tail/clear.

## Planned / Exploratory

- 🔌 **More VCS backends** via the existing backend abstraction.
- 🧩 **Plugin & theme store** (distribution/discovery UX).
- 🖼 **More UI workflows** and keyboard-first polish.

> Priorities may shift as we iterate on feedback and stabilize the core Git workflows.

---

## Repository Structure

```
.
├── Backend/              # Rust + Tauri backend (native logic, app entry)
├── Frontend/             # TypeScript + Vite frontend (UI layer)
├── crates/               # Rust crates for modular OpenVCS components
│   ├── openvcs-core      # Core traits and abstractions
│   ├── openvcs-git       # Git implementation
│   └── openvcs-git-libgit2 # Alternative Git backend (libgit2)
├── Cargo.toml            # Workspace manifest
├── LICENSE
└── README.md
```

---

## Getting Started

### Prerequisites

- [Rust](https://www.rust-lang.org/tools/install) (latest stable recommended)
- [Cargo](https://doc.rust-lang.org/cargo/) (ships with Rust)
- [Node.js](https://nodejs.org/) (for the frontend toolchain)
- [npm](https://www.npmjs.com/) (package manager)
- **Git** installation (system Git is currently required)

### Installation

For the automated installer, see [Quick Install (AppImage)](#quick-install-appimage).

#### Manual AppImage download

Prefer a portable setup? Download the latest AppImage from the GitHub releases page (e.g. https://github.com/Jordonbc/OpenVCS/releases/latest), make it executable, and run it directly:

```bash
chmod +x OpenVCS-*.AppImage
./OpenVCS-*.AppImage
```

Store the AppImage wherever you like; no installation step is required.

#### Flatpak (experimental)

A Flatpak manifest exists under `packaging/flatpak/`, but Flatpak support is currently **experimental** and may be broken even if the bundle builds successfully.

Known issues/limitations:

- The sandbox does not provide `git`, but OpenVCS currently defaults to the **system Git** backend; in Flatpak you may need to switch to the **libgit2** backend in settings.
- If the frontend assets are not included correctly, the app can show a blank window / “could not connect to localhost” (dev server) instead of loading `Frontend/dist`.

For local build notes see `packaging/flatpak/README.md`.

#### Build from source

Clone the repository:

```bash
git clone https://github.com/Jordonbc/OpenVCS.git
cd openvcs
```

Install frontend dependencies:

```bash
cd Frontend
npm install
```

**Run in development mode (dev server):**

```bash
cargo tauri dev
```

**Build a release bundle (production):**

```bash
just tauri-build
```

This wraps `cargo tauri build` with `NO_STRIP=true` to avoid AppImage
linuxdeploy strip failures on newer Linux toolchains.

### Optional: Rust‑only build

If you want to verify the Rust workspace compiles independently (without running Tauri):

```bash
cargo build
```

---

## Development Workflow

- **Frontend:** TypeScript + Vite for a fast iteration loop.
- **Backend:** Rust + Tauri commands for native operations.
- **Crates:** All modular logic (e.g., Git backend, core abstractions) lives under `crates/`.
- **Bridge:** Tauri `invoke` is used to call Rust from the UI; events are used for progress/streaming.

---

## Testing

- Use `just test` to run the full project test/check flow (runs `cargo test --workspace`, then frontend typecheck and tests).
- Use `just fix` to run formatting and quick fixes; it now also builds the frontend and typechecks (`npm run build` and `npm exec tsc -- -p tsconfig.json --noEmit`).
- Frontend-only commands (from `Frontend/`):
  - `npm exec tsc -- -p tsconfig.json --noEmit` — TypeScript typecheck for the frontend.
  - `npm test` — run Vitest unit tests (added to the frontend devDependencies).

Note: Some commands (installing Node deps, running Tauri dev/build) may require network access and native toolchain components.

Design principles:

1. **Separation of concerns** - UI logic stays in the frontend; VCS logic lives in backend crates.
2. **Backend abstraction** - a trait‑driven interface to enable multiple VCS backends over time.
3. **Extensibility** - theming and plugin hooks are planned as part of the long‑term architecture, but will follow after the core VCS features are complete.

---

## Contributing

OpenVCS is **open source** and community‑driven. Contributions of all kinds are welcome:

- Bug reports & feature proposals
- UX feedback and design mocks
- Backend adapters for other VCS
- Theme prototypes and early plugin experiments

Formatting requirement (Rust):
- Run `cargo fmt --all` before pushing.
- CI enforces `cargo fmt --all -- --check` and will fail if formatting is off.
- CI also runs `cargo clippy --all-targets -- -D warnings` and will fail on warnings.
Convenience (if you have `just` installed): `just fix`

> See `CONTRIBUTING.md` (coming soon). Until then, feel free to open an issue or a discussion to propose changes.

### Proposed Roadmap (High‑level)

- **MVP:** Stable Git workflows; Linux and Windows builds; core UI.
- **Theming:** Planned for later; starting with plugin-provided theme packs before exploring a gallery or store.
- **Plugins:** Planned for later; will likely begin as simple plugin bundles (e.g. zip files in a directory) before evolving toward a store with discovery UX.
- **Multi‑VCS:** Add at least one non‑Git backend to validate the abstraction.

---

## Recommended IDE Setup

- [Visual Studio Code](https://code.visualstudio.com/)
- Extensions:
  - [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode)
  - [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)
  - [TypeScript ESLint](https://marketplace.visualstudio.com/items?itemName=dbaeumer.vscode-eslint)

---

## Project Status

OpenVCS is in **early development**. Features and APIs are not yet finalised and may change frequently. Feedback will directly shape the roadmap.

## License

[GPL-3.0](LICENSE)

## Screenshots / Demos

The UI is actively evolving as core features take shape. Below is a small preview of the current design (subject to change):

![OpenVCS UI](docs/images/Main-UI-Preview.png)
![OpenVCS UI](docs/images/AddExisting-UI-Preview.png)
![OpenVCS UI](docs/images/Settings-UI-Preview.png)

More screenshots and demos will be shared once the design stabilises and a reliable build is ready.
