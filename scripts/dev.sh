#!/usr/bin/env bash
# Entwicklungsstart: Port 8090, nur http, Spielstand in /tmp/handelsinseln-dev.
# Änderungen in public/ wirken nach Neuladen; Rust-Änderungen brauchen einen Neustart.
set -euo pipefail
cd "$(dirname "$0")/.."
cargo build --release --locked --manifest-path rust/Cargo.toml
export DATA_DIR="${DATA_DIR:-/tmp/handelsinseln-dev}" PORT="${PORT:-8090}" HTTPS_PORT="${HTTPS_PORT:-0}"
exec ./rust/target/release/handelsinseln
