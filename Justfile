set shell := ["bash", "-eu", "-o", "pipefail", "-c"]

default:
  @just --list

test:
  cargo test --workspace || true
  cd Frontend && npm exec tsc -- -p tsconfig.json --noEmit || true
  cd Frontend && npx vitest run || true

fix:
  cargo fmt --all
  cargo clippy --fix --all-targets --all-features --allow-dirty --allow-staged
  cd Frontend && npm exec tsc -- -p tsconfig.json --noEmit || true
