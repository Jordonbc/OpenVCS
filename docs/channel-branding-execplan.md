# Implement channel-aware desktop branding

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This document must be maintained in accordance with `PLANS.md` from the repository root.

## Purpose / Big Picture

OpenVCS desktop builds should clearly identify whether they are stable, beta, or nightly, and prerelease builds should be able to live alongside stable without sharing configuration or plugin state. After this change, stable desktop bundles still look and behave like the existing app, while beta and nightly bundles show distinct names, use distinct bundle identifiers, and persist settings in separate directories. Flatpak remains a stable-only package that continues to present itself as plain `OpenVCS`.

## Progress

- [x] (2026-03-24 17:45Z) Confirmed channel inputs already come from CI via `OPENVCS_UPDATE_CHANNEL` and documented the compatibility rule: stable keeps legacy identity and paths; beta/nightly get separate branding and persistence.
- [x] (2026-03-24 17:46Z) Identified implementation surfaces: `Backend/build.rs`, backend persistence helpers, `install.sh`, GitHub workflows, README, and Flatpak notes.
- [x] (2026-03-24 17:54Z) Centralized desktop channel metadata in `Backend/build.rs`, exported `OPENVCS_APP_CHANNEL`, and removed the unused `Backend/tauri.stable.conf.json`, `Backend/tauri.beta.conf.json`, and `Backend/tauri.nightly.conf.json` files.
- [x] (2026-03-24 17:55Z) Added `Backend/src/app_identity.rs` and moved all backend config/data/plugin persistence call sites onto channel-aware `ProjectDirs` resolution.
- [x] (2026-03-24 17:57Z) Updated `install.sh`, `.github/workflows/nightly.yml`, `README.md`, and `packaging/flatpak/README.md` for side-by-side prerelease installs and stable-only Flatpak packaging.
- [x] (2026-03-24 17:59Z) Ran `cargo fmt --all`, `npm exec tsc -- -p tsconfig.json --noEmit` in `Frontend/`, and `cargo check --package openvcs --lib` for stable, beta, and nightly.
- [x] (2026-03-24 18:00Z) Ran `cargo test --package openvcs --lib` for stable, beta, and nightly; all three runs compiled the new channel-aware code and failed only in existing plugin runtime tests that require an unavailable bundled Node runtime.

## Surprises & Discoveries

- Observation: The repository already contains `Backend/tauri.stable.conf.json`, `Backend/tauri.beta.conf.json`, and `Backend/tauri.nightly.conf.json`, but no build step merges them into Tauri config.
  Evidence: `Backend/build.rs` only rewrites updater endpoints and version strings before exporting `TAURI_CONFIG`.
- Observation: Desktop coexistence is blocked by runtime persistence paths as much as by bundle metadata.
  Evidence: `Backend/src/settings.rs`, `Backend/src/state.rs`, `Backend/src/plugin_paths.rs`, and `Backend/src/plugin_runtime/settings_store.rs` all hardcode `ProjectDirs::from("dev", "OpenVCS", "OpenVCS")`.
- Observation: The installer script currently always writes `~/Applications/openvcs.AppImage` and `~/.local/share/applications/openvcs.desktop`, so prerelease installs overwrite stable regardless of bundle metadata.
  Evidence: `install.sh` constants `TARGET_BASENAME="openvcs.AppImage"` and `DESKTOP_PATH="${DESKTOP_DIR}/openvcs.desktop"`.
- Observation: Backend library tests are currently not fully hermetic because several plugin runtime tests expect an app-bundled Node runtime to exist in the test environment.
  Evidence: `cargo test --package openvcs --lib` failed in `plugin_runtime::manager::{start_and_stop_are_idempotent,sync_ignores_plugins_without_module_component,sync_tracks_enabled_state}` with `bundled node runtime is unavailable; plugin execution requires app-bundled node`.

## Decision Log

- Decision: Stable desktop builds preserve the legacy `OpenVCS` product name, bundle identifier, and existing config/data/plugin directories.
  Rationale: This avoids migrating or stranding existing stable users.
  Date/Author: 2026-03-24 / OpenCode
- Decision: Beta and nightly desktop builds derive branding and identifiers from a centralized channel map in `Backend/build.rs` instead of separate Tauri config files.
  Rationale: One source of truth keeps updater endpoints, branding, and generated config aligned.
  Date/Author: 2026-03-24 / OpenCode
- Decision: Flatpak remains stable-only and visually plain `OpenVCS`.
  Rationale: User explicitly narrowed the scope to desktop/Tauri variants while leaving Flatpak unchanged.
  Date/Author: 2026-03-24 / OpenCode

## Outcomes & Retrospective

Implemented the planned desktop channel split. Stable retains the historical identity and persistence roots, beta and nightly now derive distinct Tauri branding plus separate config/data/plugin directories from one shared channel map, prerelease AppImage installs no longer overwrite stable, and nightly CI no longer publishes Flatpak artifacts. Validation succeeded for formatting, frontend type-checking, and stable/beta/nightly backend compilation; existing plugin runtime tests still fail because the test environment lacks the bundled Node runtime they expect.

## Context and Orientation

`Backend/build.rs` is the build script that reads `Backend/tauri.conf.json`, mutates it, and exports the final one-line JSON through the `TAURI_CONFIG` environment variable for Tauri to consume at compile time. Today it already knows the release channel through `OPENVCS_UPDATE_CHANNEL`, but it only uses that value to choose updater endpoints and prerelease version suffixes.

Runtime persistence currently bypasses Tauri path resolution and instead uses `directories::ProjectDirs`. The hardcoded application tuple appears in `Backend/src/settings.rs` for the global config file, `Backend/src/state.rs` for the recent-repositories file, `Backend/src/plugin_paths.rs` for installed plugins, and `Backend/src/plugin_runtime/settings_store.rs` for plugin-local settings. Those paths must stay unchanged for stable and diverge for beta/nightly.

`install.sh` installs AppImage releases for end users. It currently treats every install as plain `OpenVCS`, so prerelease installs overwrite the stable AppImage and desktop entry. GitHub workflow files in `.github/workflows/` drive stable, beta, nightly, and Flatpak packaging. Nightly currently still builds a Flatpak artifact even though Flatpak is meant to remain stable-only.

## Plan of Work

First, extend `Backend/build.rs` with a small channel metadata model that normalizes the channel string and exposes the product name, bundle identifier, window title, updater endpoint list, and version suffix behavior. Apply those values directly to the parsed `tauri.conf.json` object before emitting `TAURI_CONFIG`, and export the normalized channel as a Rust compile-time environment variable so runtime code can make matching persistence decisions. Once this mapping exists, delete the unused `Backend/tauri.stable.conf.json`, `Backend/tauri.beta.conf.json`, and `Backend/tauri.nightly.conf.json` files.

Next, add a new backend helper module that owns channel-aware identity and `ProjectDirs` resolution. It should parse the compile-time channel value, preserve the legacy stable directories, and return alternate application names for beta and nightly. Update the four current persistence call sites to use this helper instead of constructing `ProjectDirs` directly.

Then, update the AppImage installer so it chooses stable, beta, nightly, or generic prerelease install paths based on the selected release tag or asset name. The desktop entry name and executable path should follow the detected variant so stable and prerelease installs do not overwrite each other. Update nightly CI so it stops building and uploading Flatpak artifacts, leaving Flatpak only in the stable workflow.

Finally, refresh user-facing documentation in `README.md` and `packaging/flatpak/README.md` so channel behavior and Flatpak scope are explicit, then run formatting and validation commands.

## Concrete Steps

From `/projects/OpenVCS/Client`, perform these commands as the implementation progresses.

    cargo fmt --all
    cargo test --workspace
    OPENVCS_UPDATE_CHANNEL=stable cargo test --package openvcs_lib
    OPENVCS_UPDATE_CHANNEL=beta cargo test --package openvcs_lib
    OPENVCS_UPDATE_CHANNEL=nightly cargo test --package openvcs_lib

If a full workspace test run becomes too expensive during iteration, run `cargo test --package openvcs_lib` after backend changes and finish with the full workspace run before stopping.

## Validation and Acceptance

Acceptance is reached when these behaviors are observable:

Stable builds still present as `OpenVCS` and continue using the historical settings and plugin directories. Beta builds present as `OpenVCS Beta` with identifier `dev.jordon.openvcs.beta`, and nightly builds present as `OpenVCS Nightly` with identifier `dev.jordon.openvcs.nightly`. Backend tests or direct assertions must prove that beta and nightly compute different `ProjectDirs` roots than stable. The installer must no longer write prerelease installs to the same AppImage or desktop entry path as stable. Nightly CI configuration must no longer publish Flatpak artifacts.

## Idempotence and Recovery

The build-script and runtime-helper changes are additive and safe to rerun. Deleting the unused `tauri.*.conf.json` stubs is safe once the generated config path is in place because no workflow references them. Installer changes should remain idempotent by writing deterministic paths per variant. If a validation command fails, fix the code and rerun the same command; no manual cleanup beyond the usual build artifacts should be necessary.

## Artifacts and Notes

Important files in scope:

    Backend/build.rs
    Backend/tauri.conf.json
    Backend/src/settings.rs
    Backend/src/state.rs
    Backend/src/plugin_paths.rs
    Backend/src/plugin_runtime/settings_store.rs
    install.sh
    .github/workflows/nightly.yml
    README.md
    packaging/flatpak/README.md

## Interfaces and Dependencies

Add a small helper module under `Backend/src/` that exposes a stable Rust API for channel-aware identity and data directories. At minimum, the final code should provide functions equivalent to these signatures:

    pub enum AppChannel { Stable, Beta, Nightly }
    pub fn current_channel() -> AppChannel
    pub fn project_dirs() -> Option<directories::ProjectDirs>

`Backend/build.rs` should define an internal channel metadata structure that can mutate the generated Tauri config object without needing external config merge files. Runtime call sites should depend only on the shared helper module, not duplicate channel-specific strings.

Revision note (2026-03-24): Created this ExecPlan to guide implementation after the user approved the full desktop-variant scope, stable-compatibility behavior, and removal of unused Tauri channel config stubs.
