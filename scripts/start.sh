#!/usr/bin/env bash
# Startet den Rust-Server (Release). Umgebung wie beim Binary: PORT, DATA_DIR, HTTPS_PORT, TLS_HOSTS …
set -euo pipefail
cd "$(dirname "$0")/.."
cargo build --release --locked --manifest-path rust/Cargo.toml
exec ./rust/target/release/handelsinseln
