default:
  @just --list

build target="all":
  @just {{ if target == "plugins" { "_build_plugins" } else if target == "client" { "_build_client" } else if target == "all" { "_build_all" } else { "_build_usage" } }}

_build_all: _build_client

_build_plugins:
  cargo openvcs dist --all --plugin-dir Backend/built-in-plugins --out target/openvcs/built-in-plugins

_build_client: _build_plugins
  npm --prefix Frontend run build
  cargo build

_build_usage:
  @echo "Unknown build target. Use: just build, just build plugins, or just build client"
  @exit 2

test:
  cargo test --workspace || true
  cd Frontend && npm exec tsc -- -p tsconfig.json --noEmit || true
  cd Frontend && npx vitest run || true

tauri-build:
  node scripts/tauri-build.js

fix:
  cargo fmt --all
  cargo clippy --fix --all-targets --all-features --allow-dirty --allow-staged
  cd Frontend && npm exec tsc -- -p tsconfig.json --noEmit || true
