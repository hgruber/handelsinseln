# Rust-Server

`rust/` ist eine vollständige Portierung des Servers aus `server/` nach Rust. Beide sprechen dasselbe
Protokoll (siehe `PROTOKOLL.md`) und liefern dieselben Sichten; der Browser merkt keinen Unterschied.
Der Node-Server bleibt als Referenz und für die bestehenden Tests erhalten.

## Bauen und starten

```bash
cargo build --manifest-path rust/Cargo.toml --release
./rust/target/release/handelsinseln      # PORT=8080, DATA_DIR=<repo>/data
```

Gleiche Umgebungsvariablen wie beim Node-Server, soweit sie den Kern betreffen: `PORT`, `LISTEN`,
`DATA_DIR`, `APP_VERSION`, `LOG_LEVEL`, `STUN_URL`, `MAX_GAMES`, `BOT_MS`, `TICK_MS`, `GRACE_MS`,
`ABSENT_MS`, `HANDOVER_MS`, `RNG_SEED`, zusätzlich `ROOT_DIR` (Verzeichnis mit `public/` und `shared/`;
sonst wird es neben bzw. oberhalb des Programms gesucht) und `NO_SAVE=1` für Tests.

Das Programm kennt `--health`: Es fragt `GET /api/lobby` auf `127.0.0.1:$PORT` ab und endet mit 0 bei
HTTP 200 (für Container-Healthchecks; es wird kein zusätzliches Werkzeug gebraucht).

## Aufbau

| Datei | Inhalt |
| --- | --- |
| `rng.rs` | mulberry32, bitgleich zu `server/rng.js` |
| `geom.rs`, `rules.rs` | gemeinsame Geometrie und Konstanten (Vorlage: `shared/`) |
| `settings.rs`, `model.rs` | Einstellungen samt Prüfung, Zustand (serde) |
| `board.rs` | Kartengenerierung inkl. Nebel-Nachwuchs |
| `game*.rs`, `view.rs` | Spiellogik, Sichten, Handel, Auto-Modus, Auszeichnungen |
| `bot.rs`, `botplay.rs`, `bots.rs` | Autopilot und die drei Bot-Persönlichkeiten |
| `hub.rs`, `arm.rs`, `handover.rs` | Räume, Controller-Ansicht, Kontrollübergabe |
| `http.rs`, `server.rs`, `log.rs` | HTTP/SSE, statische Dateien, API, Persistenz, Betriebslog |

Der Zustand wird wie bisher als JSON in `DATA_DIR/state.json` gespeichert (entprellt, atomar über
`.tmp` und `rename`); Abschlussberichte gehen als Zeilen an `DATA_DIR/partien.jsonl`. SIGTERM/SIGINT
speichern den Zustand und beenden den Prozess sofort.

## Gleichheit prüfen

Der Node-Server kann mit `RNG_SEED=<zahl>` einen festen Zufallsstrom verwenden (mulberry32); ohne die
Variable bleibt es bei `Math.random`. Der Rust-Server versteht dieselbe Variable und dieselbe Folge.
Damit lassen sich beide Server mit identischen Brettern, Würfen, Diebstählen und Kartenstapeln
betreiben.

```bash
bash scripts/diff.sh      # oder: npm run test:diff
```

`scripts/diff.sh` baut die Rust-Binaries im Release-Profil; damit ist die Suite insgesamt rund drei Mal schneller als mit dem Debug-Build (der HTTP-Vergleich rund fünf Mal). Die Skripte unter `tests/diff/` starten beide Server getrennt (eigene Ports und Datenverzeichnisse):

- `logic.js` – spielt eine Partie im Node-Server, zeichnet die Aktionen auf, lässt den Rust-Server
  dieselben Aktionen nachspielen und vergleicht nach jedem Schritt die Sichten aller Spieler und der
  Zuschauer (kanonisch, ohne Zeit- und Zufallsschlüssel). Mit `--bot=play` spielen beide Seiten
  stattdessen autonom mit denselben Bot-Persönlichkeiten und demselben Bot-Zufall; verglichen werden
  die Sichten nach jeder Bot-Aktion.
- `http.js` – dasselbe über echtes HTTP/SSE: Beitritt, Einstellungen, Start, Zuschauer, Aktionsfolge;
  nach jeder Aktion werden alle Sichten verglichen.
- `table.js` – Tisch-Partie: Tischspieler, Platzwahl, Handeln „als“, Controller-Ansicht (`arm`/`pick`),
  Kontrollübergabe an ein Handy und Rückgabe.
- `api.js` – Signalweg (Sprachchat), Kick und Verlassen samt Fehlerfällen (unbekannter Token, entfernter
  Spieler).

Die Tests decken 2–6 Spieler, alle Kartenvarianten, automatisches Würfeln/Räuberversetzen,
Bank- und Entwicklungskarten-Einstellungen sowie komplette Partien bis zum Spielende ab. Beim
Vergleich werden nur `gameId` (pro Raum zufällig) und `durationSec` (Uhrzeit) neutralisiert.

## Container

```bash
podman build -f Containerfile.rust -t handelsinseln-rust .
```

Mehrstufiger Bau: `rust:1-alpine` kompiliert mit musl und `-C target-feature=+crt-static` (nur für das
Endprogramm, damit die proc-macros der Abhängigkeiten baubar bleiben). Das Laufzeit-Image ist `scratch`:
ein statisch gelinktes Binary (rund 1,3 MB), `public/` und `shared/`, ein leeres `/data` für den
Benutzer 10001. Ergebnis: rund 3,9 MB, keine Shell, keine Bibliotheken. Der Healthcheck nutzt
`handelsinseln --health`. Podman ignoriert `HEALTHCHECK` im OCI-Format; mit `--format docker` bauen,
wenn der Healthcheck im Image stehen soll.

## Unterschiede zum Node-Server

- **Kein eigenes HTTPS.** Der Node-Server startet zusätzlich auf 8443 mit einem selbst erzeugten
  Zertifikat, damit das Mikrofon im Browser funktioniert. Der Rust-Server spricht nur HTTP; TLS gehört
  vor den Container (Reverse-Proxy). `/api/config` meldet `httpsPort: null`.
- **Kein gzip für den Ereignisstrom.** Der Client versteht beide Varianten; ohne gzip sind die
  SSE-Nachrichten größer. (Komprimierung ließe sich mit `flate2` nachrüsten, kostet Binary-Größe.)
- **Log ohne IP-Adressen.** Die Diagnosefelder des Node-Servers (`LOG_LEVEL=debug`: gekürzter Token,
  IP aus `X-Forwarded-For`) entfallen; Ereignisse und Feldnamen sind sonst gleich.
- **`--health`** als eigener Modus (siehe oben).
- Persistenzformat: `state.json` und `partien.jsonl` werden weiter geschrieben; sehr alte
  Node-Spielstände ohne einzelne Einstellungsfelder werden beim Laden nicht migriert.

## SQLite-Untersuchung

Gefragt war, ob Spieldaten in einer SQLite-Datei (pro Spiel?) schneller oder sicherer wären. Gemessen
wurde mit dem tatsächlichen Zustandsformat (4 Spieler, einige hundert Aktionen) und einem
SQLite-Vergleich (WAL, `synchronous=NORMAL`, ein `UPSERT` je geänderter Raum):

| Räume | Zustand als JSON | JSON schreiben (alle Räume) | SQLite (ein Raum je Transaktion) |
| --- | --- | --- | --- |
| 1 | 21 KiB | 0,07 ms | 0,03 ms |
| 3 | 62 KiB | 0,11 ms | 0,04 ms |
| 10 | 206 KiB | 0,27 ms | 0,10 ms |
| 50 | 1026 KiB | 1,29 ms | 0,34 ms |

Der Server schreibt entprellt (300 ms nach der letzten Änderung), also höchstens wenige Male je
Sekunde. Selbst bei 50 gleichzeitigen Spielen liegt der Unterschied im Bereich einer Millisekunde und
damit weit unter Netzwerk- und Spiellogik-Kosten. Sicherheit: Das Schreiben per `.tmp` + `rename` ist
bereits atomar; ein Absturz kostet höchstens die letzten 300 ms. SQLite würde pro Raum ACID bieten,
aber Räume nicht gemeinsam konsistent machen, und bringt eine C-Bibliothek (Größe, statisches Linken)
sowie Schema-/Migrationsaufwand mit. Eine Datenbank pro Spiel verschlechtert das (viele Dateien,
kein gemeinsamer Überblick).

**Empfehlung:** beim JSON-Spielstand bleiben. Für die Abschlussberichte ist `partien.jsonl`
(append-only, eine Zeile je Partie) robust und ohne Werkzeug lesbar; eine SQLite-Auswertung lohnt erst,
wenn Statistikabfragen über viele Partien hinzukommen. Dann wäre eine gemeinsame Datenbank (nicht eine
je Spiel) der richtige Ort – der Spielstand selbst bliebe JSON.
