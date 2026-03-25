default:
  @just --list

build target="stable":
  @case "{{target}}" in \
    plugins) just _build_plugins ;; \
    client|stable|beta|nightly) just _build_client "{{target}}" ;; \
    all) just _build_all stable ;; \
    *) just _build_usage ;; \
  esac

_build_all channel="stable":
  @just _build_client {{channel}}

_build_client channel="stable":
  npm --prefix Frontend run build
  FRONTEND_SKIP_BUILD=1 NO_STRIP=true OPENVCS_UPDATE_CHANNEL={{channel}} node scripts/tauri-build.js

_build_plugins:
  @echo "Plugin-only builds are not currently implemented by this Justfile"

_build_usage:
  @echo "Unknown build target. Use: just build, just build stable, just build beta, just build nightly, just build client, or just build plugins"
  @exit 2

test:
  cargo test --workspace || true
  cd Frontend && npm exec tsc -- -p tsconfig.json --noEmit || true
  cd Frontend && npx vitest run || true

tauri-build channel="stable":
  FRONTEND_SKIP_BUILD=1 NO_STRIP=true OPENVCS_UPDATE_CHANNEL={{channel}} node scripts/tauri-build.js

build-flatpak install="":
  @if [ "{{install}}" = "-i" ]; then \
    flatpak-builder --force-clean --user --install build-flatpak packaging/flatpak/io.github.jordonbc.OpenVCS.yml; \
  elif [ -n "{{install}}" ]; then \
    echo "Usage: just build-flatpak [-i]"; \
    exit 2; \
  else \
    flatpak-builder --force-clean --user build-flatpak packaging/flatpak/io.github.jordonbc.OpenVCS.yml; \
  fi

fix:
  cargo fmt --all
  cargo clippy --fix --all-targets --all-features --allow-dirty --allow-staged
  cd Frontend && npm exec tsc -- -p tsconfig.json --noEmit || true
