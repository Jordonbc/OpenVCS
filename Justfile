default:
  @just --list

build target:
  @case "{{target}}" in \
    plugins) just _build_plugins ;; \
    stable|beta|nightly) just _build_client "{{target}}" ;; \
    *) just _build_usage ;; \
  esac

_build_client channel="stable":
  npm --prefix Frontend run build
  FRONTEND_SKIP_BUILD=1 NO_STRIP=true OPENVCS_UPDATE_CHANNEL={{channel}} node scripts/tauri-build.js

_build_plugins:
  @echo "Plugin-only builds are not currently implemented by this Justfile"

_build_usage:
  @echo "Unknown build target. Use: just build stable, just build beta, just build nightly, or just build plugins"
  @exit 2

test:
   cargo test --workspace
   cd Frontend && npm exec tsc -- -p tsconfig.json --noEmit
   cd Frontend && npx vitest run

tauri-build channel="stable":
  FRONTEND_SKIP_BUILD=1 NO_STRIP=true OPENVCS_UPDATE_CHANNEL={{channel}} node scripts/tauri-build.js

flatpak-sources:
  # flatpak-node-generator is incomplete on npm lockfile v3; regen temp v2 lockfile first.
  set -euo pipefail; python3 -m pip install --user flatpak-cargo-generator flatpak-node-generator; TMPDIR="$(mktemp -d)"; trap 'rm -rf "$TMPDIR"' EXIT; cp Frontend/package.json Frontend/package-lock.json "$TMPDIR"/; (cd "$TMPDIR" && npm install --package-lock-only --lockfile-version 2 --ignore-scripts --no-audit --no-fund >/dev/null); CARGO_GEN="$(python3 -c 'import flatpak_cargo_generator.script; print(flatpak_cargo_generator.script.__file__)')"; python3 "$CARGO_GEN" Cargo.lock -o ../flathub/cargo-sources.json; python3 -m flatpak_node_generator npm "$TMPDIR/package-lock.json" -o ../flathub/npm-sources-frontend.json

# Requires Open-VCS/flathub cloned as a sibling directory: git clone git@github.com:Open-VCS/flathub.git ../flathub
build-flatpak install="":
  just flatpak-sources
  @if [ "{{install}}" = "-i" ]; then \
    flatpak-builder --force-clean --user --install build-flatpak ../flathub/app.openvcs.OpenVCS.yml; \
  elif [ -n "{{install}}" ]; then \
    echo "Usage: just build-flatpak [-i]"; \
    exit 2; \
  else \
    flatpak-builder --force-clean --user build-flatpak ../flathub/app.openvcs.OpenVCS.yml; \
  fi

fix:
  cargo fmt --all
  cargo clippy --fix --all-targets --all-features --allow-dirty --allow-staged
  cd Frontend && npm exec tsc -- -p tsconfig.json --noEmit || true
