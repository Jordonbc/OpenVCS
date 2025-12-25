# Flatpak (local builds)

This repo includes a starter Flatpak manifest for local development builds:

- `packaging/flatpak/io.github.jordonbc.OpenVCS.yml`

## Build + run

From the repo root:

```bash
flatpak install -y flathub org.gnome.Platform//48 org.gnome.Sdk//48
flatpak install -y flathub org.freedesktop.Sdk.Extension.rust-stable

cd Frontend && npm ci && npm run build && cd ..

flatpak-builder --force-clean --user --install build-flatpak packaging/flatpak/io.github.jordonbc.OpenVCS.yml
flatpak run io.github.jordonbc.OpenVCS
```

## Notes

- The manifest expects the frontend to already be built at `Frontend/dist`.
- It exports `OPENVCS_FLATPAK=1` so `Backend/build.rs` disables the in-app updater (Flatpak apps update via Flatpak).
- It uses `org.freedesktop.Sdk.Extension.rust-stable` for `cargo`/`rustc` inside the Flatpak build environment.
- For Flathub, you should pin sources (tag/commit) and vendor/pin dependencies so builds don’t require network access.
