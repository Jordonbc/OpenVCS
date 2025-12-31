set shell := ["bash", "-eu", "-o", "pipefail", "-c"]

default:
  @just --list

fix:
  cargo fmt --all
  cargo clippy --fix --all-targets --all-features --allow-dirty --allow-staged

