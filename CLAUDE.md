# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Projekt

„Die Handelsinseln“ – Mehrspieler-Brettspiel im Browser (brettspielartig, Schiffe/Nebel/Gold). Node ≥ 20, **keine Laufzeit-Abhängigkeiten** (nur ESLint als Dev-Abhängigkeit), Vanilla-JS im Client (kein Build-Schritt, kein Framework). Alle Texte, Bezeichner im Spiel und Commit-Messages sind deutsch. Details zu Funktionen/Einstellungen: `README.md`; Wire-Protokoll: `PROTOKOLL.md`; Änderungshistorie: `CHANGELOG.md`; offene Ideen: `BACKLOG.md`.

## Befehle

```bash
npm run dev                  # Port 8090, nur http, Spielstand in /tmp/handelsinseln-dev, Server-Neustart bei Änderungen (public/ nur Neuladen, ggf. Service Worker umgehen)
npm start                    # node server/server.js (PORT 8080, HTTPS_PORT 8443 mit selbstsigniertem Zertifikat)
node tests/rules.js          # Regeltests (handgebautes Brett, schnell) – eine einzelne Testdatei = ein Skript
node tests/features.js       # Einstellungen, Varianten, Auto-Modi, Übernahme, Statistik
node tests/sim.js 6          # Bot-Partien mit Invarianten-Prüfung
node tests/e2e.js            # echtes HTTP/SSE
python3 tests/browser_*.py   # echte Browser; einmalig: pip install -r requirements.txt && python3 -m playwright install chromium
bash tests/run_all.sh        # volle Suite parallel (~4 Min auf 4 Kernen, JOBS=n, PLAY_SECS=n); Logs/Screenshots je Test in $SHOTS
npm run test:schnell         # nur Regel-, Funktions- und E2E-Tests ohne Browser (< 1 Min) – nach jeder Änderung
node scripts/rohstoffe.js <Name>   # Testhilfe: Spieler bekommt je 20 Rohstoffe (beendet vorher den Server mit DATA_DIR, Standard /tmp/handelsinseln-dev)
```

CI: `.github/workflows/tests.yml` (schnell → voll mit Playwright; nachts `PLAY_SECS=120`).

Linter: `npm run lint` (ESLint, nur Fehlerklassen wie undefinierte/ungenutzte Namen, keine Stilregeln; einmalig `npm install` für die Dev-Abhängigkeiten – zur Laufzeit gibt es weiterhin keine). Einzelne Tests: das jeweilige Skript direkt aufrufen (kein Test-Runner, kein Filter; `rules.js`/`features.js` zählen intern `✓`/`✗`). Browser-Tests holen sich freie Ports und können parallel laufen.

## Release

`npm run release -- X.Y.Z [--build] [--schnell]` (= `scripts/release.sh`): nur auf `master`, sauberer Baum, verlangt Eintrag unter „Unveröffentlicht“ in `CHANGELOG.md`, führt `tests/run_all.sh` aus, setzt Version in `package.json`, committet „Release X.Y.Z“ + Tag (das gepushte Tag wird per `.github/workflows/release.yml` zum GitHub-Release). Pusht nie. Deploy der eigenen Installation ist betreiberspezifisch und liegt bewusst außerhalb des Repos (keine Hostnamen, IPs oder Netzdetails ins Repo). Neue Funktionen = Minor, Fixes = Patch.

## Architektur

**Server ist maßgeblich**; der Client rendert nur den vom Server gelieferten Zustand.

- `server/game.js` – Spiellogik in der Klasse `Game` (Kern: Zustand, Aufbau, Würfeln/Erträge, Bauen, Karten, Räuber, Zugablauf, Auszeichnungen). Weitere Teilbereiche als Klassen in `server/game_lobby.js`, `game_trade.js`, `game_auto.js` (Auto-Modus, Übernahme), `game_view.js` (Sichten, `legal`, `prompt`); ihre Methoden hängt `game.js` an `Game.prototype` (doppelte Namen werfen beim Laden). Gemeinsame Hilfen/Konstanten: `game_common.js`. Zustand `g.S` ist reines JSON (speicherbar). Aktionen laufen über `act(pid, {type, …})` – phasenunabhängige in der Tabelle `ANYTIME`, sonst `setupAct`/`mainAct`; Regelverstöße werfen `GameError` mit deutschem Text (der Client zeigt ihn als Toast, der Zustand bleibt unverändert). `view(pid)` baut die spielerspezifische Sicht (keine fremden Handkarten); es gibt außerdem eine öffentliche Zuschauer-Sicht.
- `server/board.js` + `shared/geom.js` – Kartengenerierung (Varianten klassisch/nebel/inseln/archipel, unbegrenzt entdeckbarer Nebel) und Hex-Geometrie (axial, pointy-top; Schlüssel Hex `"q,r"`, Kante `"h|h"`, Ecke `"h|h|h"`). `shared/` wird vom Server auch an den Browser ausgeliefert, damit beide dieselbe Geometrie nutzen.
- `server/settings.js` – Standardwerte (= Originalregeln) und Validierung von Einstellungs-Patches; neue Einstellung muss hier, in `game.js` (`setSettings`/`changeSettings`) und in der Lobby-UI (`public/lobby.js`, Seitenleiste „Regeln“ listet Abweichungen) berücksichtigt werden.
- `server/hub.js` – verwaltet mehrere parallele Spiele („Räume“, `room.game`), Beitritt, Aufräumen, Abwesenheit → Auto-Modus, Bot-Takt (`BOT_MS`).
- `server/log.js` – Betriebslog auf stdout (`log.info(ereignis, felder, debugFelder)`; Tokens/IPs nur als `debugFelder`, `LOG_LEVEL`, eingebettet in Tests nur `warn`). Aufrufe nur in `hub.js`/`server.js`, nicht in der Spiellogik; Partie-Start/-Ende erkennt `broadcast()` am Phasenwechsel und schreibt dann den Abschlussbericht nach `DATA_DIR/partien.jsonl`.
- `server/server.js` – HTTP(S), statische Dateien aus `public/` und `/shared`, SSE-Zustandsstrom (`/api/events`), `POST /api/act`, Signalweg für WebRTC-Sprachchat, Persistenz nach `DATA_DIR` (entprellt via `save()`).
- `server/bot.js` (Autopilot für Abwesende, Testspieler) und `server/botplay.js` (Bots mit Persönlichkeit: Baumeister/Händler/Ritter) – nutzen nur öffentliche Informationen. `botAct`/`botPlay` führen je Aufruf höchstens **eine** Aktion aus.
- `server/arm.js` und `server/handover.js` – Controller-Ansicht („arm/pick“-Freigabe am Handy, Ziel am Tisch antippen) und Kontrollübergabe an ein Handy. Ihr Zustand liegt am **Raum** (`room.arm`, `room.handovers`), nicht in `g.S`, und wird nicht gespeichert.

Client (`public/`, klassische Skripte ohne Module, über `window` verbunden): `app.js` ist der Kern (Zustand, SSE, SVG-Brett mit Diff-Rendering, HUD); `lobby.js`, `table.js` (Digitaler Spieltisch/Zuschauer-Anzeige, Sicht aller Spieler über SSE-Event `table`), `trade.js`, `menu.js`, `voice.js` (WebRTC), `fx.js` (Kartenanimation), `art.js` (Grafikbezeichner), `background.js` (vier wählbare Hintergründe für `#sea` aus den Gelände-Tiles, lokal in `localStorage`), `sw.js` (Service Worker/PWA). Die Modi Spieler / Tischspieler / Zuschauer / Controller-Ansicht teilen sich dieselbe View; Verhalten hängt am Server-gelieferten Zustand.

Spielkonstanten (Rohstoffe `holz lehm wolle getreide erz`, Gelände, Wertechips, Farben, Entwicklungskarten, Baukosten) stehen einmal in `shared/rules.js` – Server per `require`, Browser als `window.Rules` (in `index.html` vor den übrigen Skripten). Nicht erneut kopieren. Spieler-ID `pid` = Index in `players`.

## Tests

`tests/mock/` enthält Mock-Zustände (`*.json`) und `serve.js`, mit dem sich Oberfläche ohne laufende Partie ansehen lässt (`?mock=<name>`); `readme.js`/`readme_shots.py` erzeugen die README-Screenshots neu. `tests/drive.js` treibt Spieler eines laufenden Servers per Bot-Logik an (für Browser-Tests). Gemeinsamer Rahmen der Browser-Tests: `tests/lib.py` (`start_server(**env)` mit freiem Port und eigenem Datenverzeichnis, `poster`, `sse_event`, `check`, `finish`) – neue Browser-Tests darauf aufbauen.

## Projektregeln

- Fachbegriffe exakt verwenden (Spielleiter, Tischspieler, Zuschauer, Controller-Ansicht, Kontrolle übergeben …) wie in README/CHANGELOG.
- Jede benutzerrelevante Änderung: Eintrag in `CHANGELOG.md` unter „Unveröffentlicht“ (Keep a Changelog, deutsch) + ggf. README/`PROTOKOLL.md`; Commit auf `master`; nie ungefragt pushen.
