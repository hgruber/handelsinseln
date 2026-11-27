# Rust-Server

`rust/` ist eine vollständige Portierung des Servers aus `server/` nach Rust. Beide sprechen dasselbe
Protokoll (siehe `PROTOKOLL.md`) und liefern dieselben Sichten; der Browser merkt keinen Unterschied.
Die frühere Node-Portierung diente beim Vergleich als Referenz und ist inzwischen entfernt.

## Bauen und starten

```bash
cargo build --manifest-path rust/Cargo.toml --release
./rust/target/release/handelsinseln      # PORT=8080, DATA_DIR=<repo>/data
```

Umgebungsvariablen: `PORT`, `LISTEN`,
`DATA_DIR`, `APP_VERSION`, `LOG_LEVEL`, `STUN_URL`, `MAX_GAMES`, `BOT_MS`, `TICK_MS`, `GRACE_MS`,
`ABSENT_MS`, `HANDOVER_MS`, `PAUSE_MS`, `PASS_MS`, `PASS_MIN_MS`, `RNG_SEED`, `LOG_TIMESTAMP` (`0`/`off` = ohne Zeitstempel im Log), `HTTPS_PORT` (Standard 8443, `0` = aus), `TLS_HOSTS`, `TLS_CERT`/`TLS_KEY`,
zusätzlich `ROOT_DIR` (Verzeichnis mit `public/` und `shared/`;
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
| `hub.rs`, `arm.rs`, `pair.rs`, `table_offer.rs` | Räume, Controller-Ansicht, Gerätekopplung, Spieltisch-Angebot |
| `http.rs`, `server.rs`, `log.rs` | HTTP/SSE, statische Dateien, API, Persistenz, Betriebslog |

Der Zustand wird wie bisher als JSON in `DATA_DIR/state.json` gespeichert (entprellt, atomar über
`.tmp` und `rename`); Abschlussberichte gehen als Zeilen an `DATA_DIR/partien.jsonl`. SIGTERM/SIGINT
speichern den Zustand und beenden den Prozess sofort.

## Tests

Der Rust-Server wird über die API und im Browser geprüft:

- `cargo test --release --locked --manifest-path rust/Cargo.toml --test rules` – 31 gezielte Regeltests auf
  handgebauten Brettern (Erträge, Bauen, Handel, Räuber, Karten, Punkte, Lobby, Aufbau, Einstellungen, Varianten,
  JSON-Roundtrip); Laufzeit rund 0,05 s.
- `node tests/api.js` – HTTP/SSE: statische Dateien/ETag, Spiele, Lobby und Rechte, Signalweg, Kick, Verlassen,
  Auto-Modus, ganze Partien (Aktionen aus der Sicht gewählt).
- `node tests/tls.js` – HTTPS, `/api/config`, Zertifikats-SANs aus `TLS_HOSTS`, SSE über TLS, HTTP parallel.
- `tests/browser_*.py` – echte Browser (Playwright) über `tests/lib.py`; `tests/drive.js` treibt Mitspieler über die API.
- `bash tests/run_all.sh [schnell]` – baut den Release-Server und führt die Suite parallel aus.

Während der Portierung liefen zusätzlich Differenztests gegen den damaligen Node-Server (gleiche Aktionen, gleiche Sichten,
Bots, Tisch, Signalweg). Mit dessen Entfernung sind sie entfallen. `RNG_SEED=<zahl>` macht Partien reproduzierbar.

## Container

```bash
podman build -t handelsinseln .
```

Mehrstufiger Bau: `rust:1-alpine` kompiliert mit musl und `-C target-feature=+crt-static` (nur für das
Endprogramm, damit die proc-macros der Abhängigkeiten baubar bleiben). Das Laufzeit-Image ist `scratch`:
ein statisch gelinktes Binary (rund 2,0 MB inkl. TLS), `public/` und `shared/`, ein leeres `/data` für den
Benutzer 10001. Ergebnis: rund 4,8 MB, keine Shell, keine Bibliotheken. Der Healthcheck nutzt
`handelsinseln --health`. Podman ignoriert `HEALTHCHECK` im OCI-Format; mit `--format docker` bauen,
wenn der Healthcheck im Image stehen soll.

Für Raspberry Pi 64-bit (aarch64) baut `Containerfile.pi` dasselbe statische Image. Nativ auf dem Pi:

```bash
podman build -f Containerfile.pi -t localhost/handelsinseln:latest .
```

Auf x86_64 mit qemu-user-static (langsamer, gleiches Ergebnis):

```bash
podman build --platform linux/arm64 -f Containerfile.pi -t localhost/handelsinseln:pi .
```

## GHCR-Image

`.github/workflows/image.yml` baut bei jedem Push auf `master` und bei Tags ein Multi-Arch-Image
(`linux/amd64`, `linux/arm64`) nach `ghcr.io/hgruber/handelsinseln`. `latest` folgt `master`, ein Tag
`vX.Y.Z` erzeugt `X.Y.Z` und `vX.Y.Z`. Das Paket ist standardmäßig privat; für `AutoUpdate=registry`
entweder in den Paketeinstellungen öffentlich machen oder auf dem Zielsystem `podman login ghcr.io`
mit einem PAT (`read:packages`) ausführen.

## TLS (8443)

Der Server spricht zusätzlich HTTPS auf `HTTPS_PORT` (Standard 8443, `0` schaltet ab). Er erzeugt beim
ersten Start ein selbstsigniertes Zertifikat und legt es in `DATA_DIR/tls/tls.json` ab (PEM, Rechte
0600); vorhandene Zertifikate werden wiederverwendet, solange alle gewünschten Namen enthalten sind.
Eigene Zertifikate: `TLS_CERT=/pfad/cert.pem TLS_KEY=/pfad/key.pem`.

Die Namen im Zertifikat sind `localhost`, `127.0.0.1`, `::1`, der Hostname und alles aus
`TLS_HOSTS` (kommagetrennt, Namen und IP-Adressen). Im Container ist die automatische
Interface-Erkennung wertlos (Container-IP), deshalb dort die LAN-Adresse bzw. den Namen setzen:

```bash
podman run -p 8080:8080 -p 8443:8443 -e HTTPS_PORT=8443 \
  -e TLS_HOSTS=handelsinseln.lan,<LAN-Adresse> handelsinseln
```

Der Browser zeigt beim ersten Aufruf die Warnung für das selbstsignierte Zertifikat; danach bleibt sie
weg, solange dasselbe Zertifikat verwendet wird (also `DATA_DIR` bleibt). Sprachchat funktioniert damit
im LAN ohne Reverse-Proxy. Hinter einem TLS-Proxy `HTTPS_PORT=0` setzen; der Container lauscht dann nur
auf 8080. `/api/config` meldet den aktiven HTTPS-Port; die Lobby verweist automatisch darauf.

## Betriebshinweise

- **Kein gzip für den Ereignisstrom.** Der Client versteht beide Varianten; ohne gzip sind die
  SSE-Nachrichten größer. (Komprimierung ließe sich mit `flate2` nachrüsten, kostet Binary-Größe.)
- **Log ohne IP-Adressen.** Ereignisse und Feldnamen sind wie gehabt; Tokens/IPs werden nicht protokolliert.
- **Zeitstempel unter systemd:** Mit `LOG_TIMESTAMP=0` beginnt jede Zeile mit der Stufe (`INFO  start …`); den Zeitstempel schreibt journald. Die Quadlet-Vorlage setzt die Variable.
- **`--health`** als eigener Modus (siehe oben).
- Persistenz: `state.json` (ganzer Hub, entprellt) und `partien.jsonl` (eine Zeile je Partie).

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
