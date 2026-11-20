#!/usr/bin/env bash
# Führt alle Tests nacheinander aus und fasst das Ergebnis zusammen (Browser-Tests brauchen Playwright + Chromium).
cd "$(dirname "$0")/.." || exit 1
export SHOTS="${SHOTS:-/tmp/handelsinseln-tests}"; mkdir -p "$SHOTS"
fail=0
run() { local name="$1"; shift; if "$@" >"$SHOTS/$(echo "$name" | tr ' /' '__').log" 2>&1; then echo "OK      $name"; else echo "FEHLER  $name  (Log: $SHOTS/$(echo "$name" | tr ' /' '__').log)"; fail=1; fi; }
run "Regeltests"            node tests/rules.js
run "Funktionstests"        node tests/features.js
run "Simulation 2"          node tests/sim.js "${SIM_SEEDS:-2}"
run "E2E HTTP"              node tests/e2e.js
run "Browser Lobby"         python3 tests/browser_lobby.py
run "Browser Vorschau"      python3 tests/browser_lobby_preview.py
run "Browser Spielen"       python3 tests/browser_play.py 4 90
run "Browser Spielen auto"  python3 tests/browser_play.py 3 90 auto
run "Browser Dauerlauf 6"   python3 tests/browser_soak.py 6 80
run "Browser Sprachchat"    python3 tests/browser_voice.py
run "Browser https+Mikro"   python3 tests/browser_https_voice.py
run "Browser Übernahme"     python3 tests/browser_takeover.py
exit $fail
