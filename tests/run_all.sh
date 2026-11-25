#!/usr/bin/env bash
# Führt die Tests parallel aus und fasst das Ergebnis zusammen.
#   tests/run_all.sh          volle Suite (Rust-Regeltests, API, TLS und Browser-Tests; Browser brauchen Playwright + Chromium)
#   tests/run_all.sh schnell  Rust-Regeltests, API und TLS (keine Browser, unter einer Minute)
# JOBS=n begrenzt die Parallelität (Standard: Zahl der CPU-Kerne), PLAY_SECS die Dauer der Spiel-Dauerläufe (Standard 50 s).
# Logs und Screenshots je Test unter $SHOTS/<test>/.
cd "$(dirname "$0")/.." || exit 1
export SHOTS_ROOT="${SHOTS:-/tmp/handelsinseln-tests}"; mkdir -p "$SHOTS_ROOT"
JOBS="${JOBS:-$(nproc 2>/dev/null || echo 4)}"
STUFE="${1:-voll}"
case "$STUFE" in schnell|voll) ;; *) echo "Aufruf: $0 [schnell|voll]" >&2; exit 2 ;; esac

echo "== Rust-Server bauen =="
cargo build --release --locked --manifest-path rust/Cargo.toml || exit 1

# Name|Befehl – die längsten zuerst, damit sich die Jobs gut verteilen
ALLE=(
  "Browser Spielen|python3 tests/browser_play.py 4 ${PLAY_SECS:-50}"
  "Browser Spielen auto|python3 tests/browser_play.py 3 $(( ${PLAY_SECS:-50} * 4 / 5 )) auto"
  "Browser Dauerlauf 6|python3 tests/browser_soak.py 6 $(( ${PLAY_SECS:-50} * 9 / 10 ))"
  "Rust Unit|cargo test --release --locked --manifest-path rust/Cargo.toml --test rules"
  "API|node tests/api.js"
  "Browser Lobby|python3 tests/browser_lobby.py"
  "Browser Spieltisch|python3 tests/browser_table.py"
  "Browser Übergabe|python3 tests/browser_handover.py"
  "Browser Vorschau|python3 tests/browser_lobby_preview.py"
  "Browser Zuschauer|python3 tests/browser_watch.py"
  "Browser Mobil+Lobbyzoom|python3 tests/browser_mobile.py"
  "Browser Controller|python3 tests/browser_controller.py"
  "Browser Gemischt|python3 tests/browser_mixed.py"
  "Browser Sprachchat|python3 tests/browser_voice.py"
  "Browser Bots+Avatare|python3 tests/browser_bots.py"
  "Browser Kartenanimation|python3 tests/browser_fx.py"
  "Browser https+Mikro|python3 tests/browser_https_voice.py"
  "TLS|node tests/tls.js"
)
SCHNELL='^(API|TLS|Rust Unit)\|'
TESTS=()
for t in "${ALLE[@]}"; do [[ "$STUFE" == voll || "$t" =~ $SCHNELL ]] && TESTS+=("$t"); done

run() {
  local name="${1%%|*}" cmd="${1#*|}" slug t0=$SECONDS
  slug=$(echo "$name" | tr ' /+' '___')
  mkdir -p "$SHOTS_ROOT/$slug"
  if SHOTS="$SHOTS_ROOT/$slug" bash -c "$cmd" >"$SHOTS_ROOT/$slug.log" 2>&1; then
    printf 'OK      %-26s %4ss\n' "$name" $((SECONDS - t0))
  else
    printf 'FEHLER  %-26s %4ss  (Log: %s)\n' "$name" $((SECONDS - t0)) "$SHOTS_ROOT/$slug.log"
  fi
}
export -f run

T0=$SECONDS
res="$SHOTS_ROOT/ergebnis.txt"
printf '%s\n' "${TESTS[@]}" | xargs -d '\n' -P "$JOBS" -I{} bash -c 'run "$1"' _ {} | tee "$res"
echo "Gesamt ($STUFE) $((SECONDS - T0)) s mit $JOBS parallelen Jobs"
! grep -q '^FEHLER' "$res"
