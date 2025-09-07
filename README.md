# OpenVCS

**The open‑source, fully customisable VCS client.**

OpenVCS is a new and upcoming cross‑platform version control client built with [Tauri](https://tauri.app/), [Rust](https://www.rust-lang.org/), and a modern [TypeScript](https://www.typescriptlang.org/) + [Vite](https://vitejs.dev/) frontend. It aims to be the **all‑in‑one solution** for version control: clean, fast, and extensible. Features are actively being explored and are **not yet finalised**.

> **Scope note:** The first main release focuses on **Git** to keep the scope tight. The long‑term vision is to support **all major VCS systems** through a backend/plugin architecture (e.g., Mercurial, SVN, Perforce, Fossil, etc.).

---

## Key Goals

- 🧩 **Fully customisable** - themes, layout, and extensibility at the core.
- 🗂 **Multi‑VCS architecture** - designed to support many backends beyond Git.
- ⚡ **Lightweight & fast** - native shell via Tauri + Rust.
- 🧰 **Developer‑first UX** - frictionless flows for common VCS tasks.
- 🧱 **Local‑first** - avoids heavyweight runtimes and keeps resource use low.

## Platform Targets

- 🐧 **Linux‑first** (primary target)
- 🪟 **Windows** builds supported
- 🍏 **macOS** planned/experimental (community interest welcome)

## Features (Planned & In‑Progress)

- 🔗 **Git backend** (initial) with common operations (clone, add, commit, branch, push/pull, fetch, stash).
- 🔌 **Backend abstraction** to enable additional VCS (Mercurial/SVN/Perforce/Fossil) in future releases.
- 🎨 **Theming** (planned): custom themes and a potential **Theme Store**.
- 🧩 **Plugins** (planned): plugin API with a potential **Plugin Store**.
- 🖼 **Modern UI** focused on clarity and speed; keyboard‑first workflows.
- 📁 **Multi‑repo** quality‑of‑life features (recents, quick switch, project workspaces).

> This roadmap is exploratory; priorities may shift as we collect community feedback.

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

Run in development mode from the workspace root:

```bash
cargo tauri dev
```

Build a release binary:

```bash
cargo tauri build
```

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

> See `CONTRIBUTING.md` (coming soon). Until then, feel free to open an issue or a discussion to propose changes.

### Proposed Roadmap (High‑level)

- **MVP:** Stable Git workflows; Linux and Windows builds; core UI.
- **Theming:** Planned for later; will likely begin with simple theme packs (e.g. zip files in a directory) before exploring an initial gallery or store.
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
