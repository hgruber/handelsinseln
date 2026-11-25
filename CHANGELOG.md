# Changelog

Format nach [Keep a Changelog](https://keepachangelog.com/de/1.1.0/).

## [Unveröffentlicht]

### Hinzugefügt
- **GHCR-Image mit Auto-Update:** `.github/workflows/image.yml` baut bei jedem Push auf `master` und bei Versionstags ein Multi-Arch-Image (amd64/arm64) nach `ghcr.io/hgruber/handelsinseln`; `master` erzeugt `latest`, Tags erzeugen die Versions-Tags. Die Quadlet-Vorlage nutzt `ghcr.io/hgruber/handelsinseln:latest` mit `AutoUpdate=registry`. Das GitHub-Paket ist standardmäßig privat: öffentlich machen oder auf dem Server `podman login ghcr.io` (PAT mit `read:packages`).

## [1.0.0] - 2026-11-26

Erster öffentlicher Release. Die früheren 1.x-Versionen waren interne Entwicklungsstände; ihre Einträge stehen im [Changelog-Archiv](docs/CHANGELOG-archiv.md).

### Hinzugefügt
- **Rust-Server:** `rust/` ist die vollständige Server-Implementierung – Spiellogik, Kartengenerierung, Sichten, Handel, Auto-Modus, Auszeichnungen, Bots, Räume, Ereignisstrom, Controller-Ansicht, Kontrollübergabe und TLS. Er spricht dasselbe Protokoll und liefert dieselben Sichten wie der bisherige Node-Server; der Browser merkt keinen Unterschied. Statischer Container (`Containerfile`, Laufzeit `scratch`): rund 4,8 MB, eigenes `--health` für den Container-Healthcheck, Zustand speichern und beenden bei SIGTERM/SIGINT. TLS auf Port 8443 mit selbstsigniertem Zertifikat (Namen aus `TLS_HOSTS`, `TLS_CERT`/`TLS_KEY` möglich; hinter einem Proxy `HTTPS_PORT=0`) – damit funktioniert der Sprachchat auch im LAN ohne Reverse-Proxy. Offen bleibt nur gzip für den Ereignisstrom; Details in `docs/rust-server.md`.
- **Deterministischer Zufall:** `RNG_SEED=<zahl>` setzt den Zufallsstrom des Rust-Servers fest (mulberry32); ohne die Variable bleibt es zufällig. Grundlage für reproduzierbare Partien und Tests.
- **Tests über den Rust-Server:** `tests/api.js` (HTTP/SSE: Spiele, Lobby, Rechte, Signalweg, Kick, Verlassen, Auto-Modus, ganze Partien) und `tests/tls.js` (HTTPS, Zertifikats-SANs aus `TLS_HOSTS`, SSE über TLS); die Browser-Tests starten ebenfalls den Rust-Server. Aufruf: `bash tests/run_all.sh [schnell]` bzw. `npm run test:schnell`.
- **Rust-Regeltests:** `rust/tests/rules.rs` prüft 26 gezielte Regeln auf handgebauten Brettern – Erträge, Gold, Siedlungsabstand, Straßen/Schiffe, Entdeckung, Schiffversetzen, Pirat, Räuber mit Abwerfen/Stehlen, Längster Handelsweg, Schutzmacht, Inselbonus, Bank- und Spielerhandel, Entwicklungskarten, Straßenbau, Sieg, Sonderbau, Lobby, Aufbau, JSON-Roundtrip, Einstellungen und alle vier Varianten. Laufzeit rund 0,05 s; die schnelle Stufe von `tests/run_all.sh` führt sie mit aus.
- **README als Werbeseite:** Neuer Einstieg mit aktuellen Screenshots (Partie, Lobby, Spieltisch, Handy, Statistik), kompakte Spielbeschreibung, Startanleitungen für Container und Raspberry Pi, Technik- und Testabschnitt; die Node-Startanleitung und die veralteten Bildverweise sind entfallen.
- **Raspberry Pi 64-bit:** `Containerfile.pi` baut dasselbe statische Image für aarch64 – nativ auf dem Pi oder auf x86_64 mit qemu-user-static (`podman build --platform linux/arm64`).

### Geändert
- **CI-Stabilität:** Die Browser-Tests für Zuschauer und Bots warten nach einem Neuladen länger, damit die parallele CI-Last keine falschen Timeouts erzeugt.
- **Log ohne doppelten Zeitstempel:** `LOG_TIMESTAMP=0` (oder `off`) schaltet den Zeitstempel im Server-Log ab; unter systemd/journald schreibt journald ihn selbst. Die Quadlet-Vorlage `deploy/handelsinseln.container` setzt die Variable.
- **Nur noch ein Server:** `npm start`/`npm run dev`, `tests/run_all.sh` und der Container bauen und starten den Rust-Server. `Containerfile` baut jetzt das statische Rust-Image; das Node-Image und `Containerfile.rust` entfallen. Die Testskripte (`tests/drive.js`, `tests/lib.py`) treiben den Rust-Server ausschließlich über die API an.

### Entfernt
- Node-Server (`server/`), die Node-internen Tests (`rules.js`, `features.js`, `sim.js`, `bots.js`, `e2e.js`), die Differenztests gegen den Node-Server, der Browser-Test der Übernahme samt Node-Vorbereitungsserver sowie der Node-Screenshot-Generator (`tests/mock/readme.js` samt `readme_shots.py`). Regel- und Funktionstests dafür werden in Rust neu aufgebaut (siehe `BACKLOG.md`).

### Behoben
- **Neuladen:** Schließt der Browser beim Neuladen die Ereignisverbindung, bevor `pagehide` feuert, löschte die App den Token und zeigte wieder die Anmeldung. Sie wartet jetzt kurz und prüft, ob die Seite wirklich verlassen wird, bevor sie die Sitzung beendet.

## Frühere interne Entwicklungsstände

Die Entwicklung vor dem ersten öffentlichen Release (1.0.0) ist im [Changelog-Archiv](docs/CHANGELOG-archiv.md) dokumentiert.
