#!/usr/bin/env bash
# Vergleicht Node- und Rust-Server: dieselbe Aktionsfolge, dieselben Sichten.
# Voraussetzung: Node >= 20 und eine Rust-Toolchain (cargo).
set -euo pipefail
cd "$(dirname "$0")/.."

cargo build --release --manifest-path rust/Cargo.toml
export TRACECHECK="$PWD/rust/target/release/tracecheck"
export RUST_SERVER="$PWD/rust/target/release/handelsinseln"

echo "== Spiellogik und Sichten =="
node tests/diff/logic.js --n=4 --seed=1 --max=1200
node tests/diff/logic.js --n=6 --seed=2 --variant=nebel --max=800
node tests/diff/logic.js --n=4 --seed=3 --settings='{"dice":"auto","robber":"auto"}' --max=600

echo "== Bots (autonome Partie, gleiche Persönlichkeiten und Zufallszahlen) =="
node tests/diff/logic.js --n=4 --seed=4 --bot=play --max=2000
node tests/diff/logic.js --n=3 --seed=5 --variant=inseln --bot=play --max=2500

echo "== HTTP/SSE =="
node tests/diff/http.js --n=4 --seed=6 --max=400
node tests/diff/http.js --n=5 --seed=7 --max=300

echo "== Spieltisch, Controller-Ansicht, Kontrollübergabe =="
node tests/diff/table.js --seed=8

echo "== Signalweg, Kick, Verlassen =="
node tests/diff/api.js --seed=9

echo "Alle Differenztests bestanden."
