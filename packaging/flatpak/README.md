# Flatpak (local builds)

This repo includes a starter Flatpak manifest for local development builds:

- `packaging/flatpak/io.github.jordonbc.OpenVCS.yml`

## Build + run

From the repo root:

```bash
flatpak install -y flathub org.freedesktop.Platform//25.08 org.freedesktop.Sdk//25.08 \
  org.freedesktop.Sdk.Extension.rust-stable//25.08 org.freedesktop.Sdk.Extension.node20//25.08

flatpak-builder --force-clean --user --install build-flatpak packaging/flatpak/io.github.jordonbc.OpenVCS.yml
flatpak run io.github.jordonbc.OpenVCS
```

## Notes

- The manifest builds the frontend (`Frontend/`) and then compiles the Tauri binary (`Backend/`).
- It exports `OPENVCS_FLATPAK=1` so `Backend/build.rs` disables the in-app updater (Flatpak apps update via Flatpak).
- For Flathub, you should pin sources (tag/commit) and vendor/pin npm + Cargo dependencies (no network during builds).
