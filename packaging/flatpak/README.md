# Flatpak (local builds)

This repo includes a starter Flatpak manifest for local development builds:

- `packaging/flatpak/io.github.jordonbc.OpenVCS.yml`

## Build + run

From the repo root:

```bash
flatpak install -y flathub org.gnome.Platform//49 org.gnome.Sdk//49
flatpak install -y flathub org.freedesktop.Sdk.Extension.rust-stable//49
flatpak install -y flathub org.freedesktop.Sdk.Extension.node20//23.08

cd Frontend && npm ci && npm run build && cd ..

flatpak-builder --force-clean --user --install build-flatpak packaging/flatpak/io.github.jordonbc.OpenVCS.yml
flatpak run io.github.jordonbc.OpenVCS
```

## Notes

- The manifest expects the frontend to already be built at `Frontend/dist`.
- It exports `OPENVCS_FLATPAK=1` so `Backend/build.rs` disables the in-app updater (Flatpak apps update via Flatpak).
- It uses `org.freedesktop.Sdk.Extension.rust-stable` for `cargo`/`rustc` and `org.freedesktop.Sdk.Extension.node20` for `npm` inside the Flatpak build environment.
- The manifest's build-commands run `ensure-built-in-plugins.js` to bundle built-in plugins and the Node runtime, then install them into the Flatpak.
- For Flathub, you should pin sources (tag/commit) and vendor/pin dependencies so builds don't require network access.
