# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Projekt

„Die Handelsinseln“ – Mehrspieler-Brettspiel im Browser (brettspielartig, Schiffe/Nebel/Gold). Der Server ist ein statisch
gelinktes Rust-Binary (`rust/`), der Client ist Vanilla-JS ohne Build-Schritt und ohne Framework. Zur Laufzeit gibt es keine
externen Dienste; Node ≥ 20 wird nur für die Testskripte und ESLint gebraucht. Alle Texte, Bezeichner im Spiel und
Commit-Messages sind deutsch. Details zu Funktionen/Einstellungen: `README.md`; Wire-Protokoll: `PROTOKOLL.md`;
Änderungshistorie: `CHANGELOG.md`; offene Ideen: `BACKLOG.md`.

## Befehle

```bash
npm run dev                  # Rust, Port 8090, nur http, Spielstand /tmp/handelsinseln-dev; Rust-Änderung = Neustart
npm start                    # Rust, PORT 8080, TLS 8443 (selbstsigniert; TLS_HOSTS für die Namen)
cargo build --release --locked --manifest-path rust/Cargo.toml
cargo test --release --locked --manifest-path rust/Cargo.toml --test rules   # 34 Rust-Regeltests (rund 0,05 s)
node tests/api.js            # HTTP/SSE: Spiele, Lobby, Rechte, Signalweg, Auto-Modus, ganze Partien
node tests/tls.js            # HTTPS, Zertifikats-SANs, SSE über TLS
python3 tests/browser_*.py   # echte Browser; einmalig: pip install -r requirements.txt && python3 -m playwright install chromium
bash tests/run_all.sh        # volle Suite parallel (JOBS=n, PLAY_SECS=n); Logs/Screenshots je Test in $SHOTS
npm run test:schnell         # Rust-Regeltests, API und TLS (ohne Browser) – nach jeder Änderung; baut den Rust-Server
podman build -f Containerfile.pi -t localhost/handelsinseln:latest .   # Raspberry Pi 64-bit (aarch64)
node scripts/rohstoffe.js <Name>   # Testhilfe: Spieler bekommt je 20 Rohstoffe (beendet den Server mit DATA_DIR)
```

CI: `.github/workflows/tests.yml` (Rust bauen, schnell → voll mit Playwright; nachts `PLAY_SECS=120`);
`.github/workflows/image.yml` baut bei Push auf `master`/Tags das Multi-Arch-Image nach GHCR (`latest` für master),
das die Quadlet-Vorlage mit `AutoUpdate=registry` nutzt.

Linter: `npm run lint` (ESLint, nur Fehlerklassen wie undefinierte/ungenutzte Namen, keine Stilregeln; einmalig `npm install`).
Einzelne Tests: das jeweilige Skript direkt aufrufen (kein Test-Runner, kein Filter). Browser-Tests holen sich freie Ports und
können parallel laufen.

## Release

`npm run release -- X.Y.Z [--build] [--schnell]` (= `scripts/release.sh`): nur auf `master`, sauberer Baum, verlangt Eintrag
unter „Unveröffentlicht“ in `CHANGELOG.md`, baut den Rust-Server, führt `tests/run_all.sh` aus, setzt Version in
`package.json`, committet „Release X.Y.Z“ + Tag (das gepushte Tag wird per `.github/workflows/release.yml` zum
GitHub-Release). Pusht nie. Deploy der eigenen Installation ist betreiberspezifisch und liegt bewusst außerhalb des Repos
(keine Hostnamen, IPs oder Netzdetails ins Repo). Neue Funktionen = Minor, Fixes = Patch.

## Architektur

**Server ist maßgeblich**; der Client rendert nur den vom Server gelieferten Zustand.

- `rust/src/game*.rs` – Spiellogik (Zustand, Aufbau, Würfeln/Erträge, Bauen, Karten, Räuber, Zugablauf, Auszeichnungen) in
  der `Game`-Klasse, verteilt auf `game.rs` (Kern), `game_lobby.rs`, `game_trade.rs`, `game_build.rs`, `game_auto.rs`
  (Auto-Modus, Übernahme), `game_actions.rs` (Aktionen/Zug), `game_awards.rs`; `view.rs` baut Sichten, `legal` und `prompt`.
  Der Zustand `S` ist serde-JSON (speicherbar). Aktionen laufen über `act(pid, {type, …})`; Regelverstöße sind `GameError`
  mit deutschem Text (der Client zeigt ihn als Toast, der Zustand bleibt unverändert). `view(pid)` liefert keine fremden
  Handkarten; es gibt eine öffentliche Zuschauer-Sicht.
- `rust/src/board.rs` – Kartengenerierung (klassisch/nebel/inseln/archipel, unbegrenzt entdeckbarer Nebel). Die
  Hex-Geometrie (axial, pointy-top; Schlüssel Hex `"q,r"`, Kante `"h|h"`, Ecke `"h|h|h"`) liegt in `rust/src/geom.rs` und
  `shared/geom.js`; `shared/` wird vom Server an den Browser ausgeliefert.
- `rust/src/settings.rs` – Standardwerte (= Originalregeln) und Validierung von Einstellungs-Patches. Eine neue Einstellung
  muss hier, in `game_lobby.rs` (`set_settings`/`change_settings`) und in der Lobby-UI (`public/lobby.js`, Seitenleiste
  „Regeln“) berücksichtigt werden.
- `rust/src/hub.rs` – mehrere parallele Spiele („Räume“), Beitritt, Aufräumen, Abwesenheit → Auto-Modus, Bot-Takt
  (`BOT_MS`). `rust/src/server.rs`/`http.rs` – HTTP/HTTPS, statische Dateien aus `public/` und `/shared`, SSE
  (`/api/events`), `POST /api/act`, Signalweg, Persistenz (`DATA_DIR/state.json`, `partien.jsonl`). `rust/src/tls.rs` –
  selbstsigniertes Zertifikat (oder `TLS_CERT`/`TLS_KEY`) in `DATA_DIR/tls`.
- `rust/src/bot.rs` (Autopilot für Abwesende) und `botplay.rs` (Baumeister/Händler/Ritter) – nutzen nur öffentliche
  Informationen und führen je Aufruf höchstens **eine** Aktion aus.
- `rust/src/arm.rs` – Controller-Ansicht („arm/pick”); ihr Zustand liegt am **Raum** (`room.arm`), nicht in `S`, und wird
  nicht gespeichert.
- `rust/src/pair.rs` – Gerätekopplung per Nonce (QR-Code); Angebote liegen an `room.pairs`, nicht in `S`, und werden
  nicht gespeichert. Der Spielerpass hinterlässt nur eine servergebundene Personen-ID am Platz (`player.personId`) und im
  Abschlussbericht; der Pass selbst bleibt im Browser. Eine laufende Partie pausiert beim Verlassen, wenn alle
  menschlichen Plätze einen Pass haben (`hub::darf_pausieren`, `PAUSE_MS`, Standard 7 Tage); sonst wird sie abgeräumt.
  `POST /api/person/resume` holt den Platz samt neuem Token zurück. Konzept: `IDENTITAET.md`.

Client (`public/`, klassische Skripte ohne Module, über `window` verbunden): `app.js` ist der Kern (Zustand, SSE, SVG-Brett
mit Diff-Rendering, HUD); `lobby.js`, `table.js` (Digitaler Spieltisch/Zuschauer-Anzeige, SSE-Event `table`), `trade.js`,
`menu.js`, `voice.js` (WebRTC), `fx.js`, `art.js`, `background.js`, `sw.js` (Service Worker/PWA), `pair.js`
(Gerätekopplung), `person.js` (Spielerpass), `qr.js` (eigener QR-Encoder). Die Modi Spieler /
Tischspieler / Zuschauer / Controller-Ansicht teilen sich dieselbe View.

**Doppelte Konstanten:** `shared/rules.js` (Browser: `window.Rules`) und `rust/src/rules.rs` müssen dieselben Werte haben;
ebenso `shared/geom.js` und `rust/src/geom.rs` (Schlüssel/Reihenfolge) und `shared/avatars.js` zu `rust/src/avatars.rs`.
Der Server liefert `shared/` aus, damit der Browser dieselbe Geometrie nutzt. Spieler-ID `pid` = Index in `players`.

## Tests

`rust/tests/rules.rs` enthält gezielte Regeltests gegen die öffentliche `Game`-API auf handgebauten Brettern (Erträge, Bauen, Handel, Räuber, Karten, Punkte, Lobby, Aufbau, Einstellungen, Varianten, JSON-Roundtrip).
`tests/api.js` und `tests/tls.js` prüfen den Rust-Server direkt (HTTP/SSE/TLS, ganze Partien). Die Browser-Tests nutzen
`tests/lib.py` (`start_server(**env)` startet das Release-Binary mit freiem Port und eigenem Datenverzeichnis, `poster`,
`sse_event`, `check`, `finish`); `tests/drive.js` treibt Spieler über die API an, indem es Aktionen aus der jeweiligen Sicht
wählt. `tests/mock/` enthält Mock-Zustände (`gen.js` erzeugt sie, `serve.js` zeigt sie unter `?mock=<name>`), unabhängig
vom Server. Neue Browser-Tests auf `lib.py` aufbauen.

## Projektregeln

- Fachbegriffe exakt verwenden (Spielleiter, Tischspieler, Zuschauer, Controller-Ansicht, Kontrolle übergeben …) wie in
  README/CHANGELOG.
- Jede benutzerrelevante Änderung: Eintrag in `CHANGELOG.md` unter „Unveröffentlicht“ (Keep a Changelog, deutsch) + ggf.
  README/`PROTOKOLL.md`; bei neuen Regeln zuerst die Rust-Seite und die JS-Konstanten abgleichen.
- Commit auf `master` nur auf ausdrückliche Ansage; nie ungefragt pushen.
