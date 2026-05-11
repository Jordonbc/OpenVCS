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
