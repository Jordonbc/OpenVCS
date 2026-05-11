# Flatpak (local builds)

This repo includes a starter Flatpak manifest for local development builds:

- `packaging/flatpak/io.github.jordonbc.OpenVCS.yml`

## Build + run

From the repo root:

```bash
flatpak install -y flathub org.gnome.Platform//49 org.gnome.Sdk//49
flatpak install -y flathub org.freedesktop.Sdk.Extension.rust-stable//25.08
flatpak install -y flathub org.freedesktop.Sdk.Extension.rust-stable//24.08
flatpak install -y flathub org.freedesktop.Sdk.Extension.node24//25.08

cd Frontend && npm ci && npm run build && cd ..

flatpak-builder --force-clean --user --install build-flatpak packaging/flatpak/io.github.jordonbc.OpenVCS.yml
flatpak run io.github.jordonbc.OpenVCS
```

## Notes

- Flatpak packaging remains stable-only and intentionally keeps the plain `OpenVCS` app identity.
- The manifest expects the frontend to already be built at `Frontend/dist`.
- It exports `OPENVCS_FLATPAK=1` so `Backend/build.rs` disables the in-app updater (Flatpak apps update via Flatpak).
- It uses `org.freedesktop.Sdk.Extension.rust-stable` for `cargo`/`rustc` and `org.freedesktop.Sdk.Extension.node24` for `npm` inside the Flatpak build environment. On Flathub, `node24` is currently published for the `24.08` and `25.08` branches.
- The manifest's build-commands run `ensure-built-in-plugins.js` to materialize built-in plugin directories from `openvcs.plugins.json` and bundle the Node runtime, then install them into the Flatpak.
- For Flathub, you should pin sources (tag/commit) and vendor/pin dependencies so builds don't require network access.
