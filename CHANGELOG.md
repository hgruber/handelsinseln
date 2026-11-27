# Changelog

Format nach [Keep a Changelog](https://keepachangelog.com/de/1.1.0/).

## [Unveröffentlicht]

### Hinzugefügt
- **Eigener Spielname:** Der Spielleiter kann den Namen der Partie im Lobby-Kopf antippen und ändern; er erscheint sofort in der Spieleliste auf der Anmeldung. Ein leer gelassener Name stellt „Spiel N“ wieder her, unbenannte Spiele zeigen in der Liste weiterhin „Spiel von …“.

### Geändert
- **Bauen am Spieltisch mit Banktausch:** Fehlende Rohstoffe werden auch am digitalen Spieltisch vor dem Bauen automatisch mit der Bank getauscht (bisher kam trotz möglichem Tausch „Dir fehlen Rohstoffe …“).
- **Hintergrundwahl in der Lobby nur noch im Menü:** Das Palettensymbol unten links erscheint in der Lobby nicht mehr; die Wahl liegt dort inzwischen im Hamburger-Menü („Hintergrund …“). Auf der Anmeldung und in der Statistik bleibt das Symbol.
- **Kopf und Reiter für alles rund um den Pass:** Sobald der Pass mit dem ersten Spiel gebunden ist, steht auf der Anmeldung und in beiden Passansichten oben ein Kopf mit großem Avatar, Farbring, Name und „Spielerpass aktiv“ als Link zum Pass (dahinter die Farbe). Darunter führen die Reiter „Meine Partien“ und „Mein Spielerpass“ weiter. Auf der Anmeldung entfällt die Farbpalette und erscheint nur wieder, wenn ein anderer Mensch die Farbe belegt.
- **Name und Avatar bleiben fest:** Beim ersten erfolgreichen Beitritt werden Name und Avatar gespeichert und mit dem Pass verbunden; danach sind sie auf der Anmeldung gesperrt. Die gespeicherte Farbe ist der Standard, lässt sich aber ändern, wenn ein anderer Mensch sie in der gewählten Partie belegt. Bei einer Farbkollision weicht zuerst ein Bot auf eine freie Farbe aus, bevor ein Mensch wechseln muss.
- **Spielerpass unsichtbar, bis ein Spiel beginnt:** Der Pass aus vier Wörtern liegt im Hintergrund bereit; Name, Avatar und Farbe werden erst beim ersten Beitritt mit ihm verbunden. Vorher zeigt die Anmeldung nur den Link „Ich habe einen Spielerpass“ zum Eingeben eines vorhandenen Passes und sonst keinen Hinweis auf Pass oder Partien. Wird der Pass gelöscht, werden Name, Avatar und Farbe wieder frei wählbar; ein neuer Pass entsteht beim nächsten Spiel. Die Rückfrage beim Verlassen einer laufenden Partie weist darauf hin, den Pass zu notieren und dass die Partie nach spätestens 30 Tagen ohne Zugriff gelöscht wird.
- **Aufbewahrung:** Der Server merkt sich je Personen-ID Erstanlage und letzten Zugriff (`DATA_DIR/personen.json`). Nach 30 Tagen ohne Zugriff (`PASS_MS`) und mindestens 24 h nach Erstanlage (`PASS_MIN_MS`) wird der Pass samt seinen pausierten Partien abgeräumt und die Personen-ID aus den Abschlussberichten entfernt; laufende Partien der Mitspieler bleiben bestehen. Pausierte Partien bleiben jetzt bis zu 30 Tage liegen (`PAUSE_MS`, vorher 7 Tage).

## [1.1.0] - 2026-11-26

### Hinzugefügt
- **Gerätekopplung ohne Passwort:** Ein Gerät zeigt in der Lobby oder am Spieltisch einen QR-Code (`POST /api/pair`); ein zweites Gerät scannt ihn (`#k=…`) und bekommt die Sitzung für denselben Platz. Eingelöst wird ein einmaliges Nonce mit kurzer Gültigkeit (`PAIR_MS`, Standard 60 s), nie der Token im QR-Code; ein geheimes `secret` schützt die Statusabfrage (`/api/pair/check`). Das gilt in beide Richtungen (PC → Handy und Handy → PC). Der QR-Encoder ist klein und ohne Fremdcode in `public/qr.js` (Byte-Modus, Fehlerkorrektur M, Versionen 1–6) und wurde gegen `zxing` geprüft.
- **Spielerpass:** Vier Wörter aus einer 256er-Liste (32 Bit, `shared/woerter.js`) finden die eigenen Partien auf einem anderen Gerät oder nach dem Löschen der Browserdaten wieder. `/api/person` und `/api/person/resume` sind auf 300 Anfragen pro Minute begrenzt, damit die Personen-ID nicht als Orakel für den Pass dient. Der Pass bleibt auf dem Gerät; an den Server geht nur `HMAC-SHA256(pass, serverId)` als Personen-ID. `POST /api/person/link` verknüpft eine laufende Partie, `POST /api/person` liefert laufende (mit Token) und beendete Partien; der Abschlussbericht speichert die Personen-ID, aber nur wenn der Spieler den Pass verknüpft hat. Die `serverId` dieser Installation steht in `DATA_DIR/server.json` und in `/api/config`.
- **„Meine Partien“:** Einstieg auf der Anmeldung und im Menü; laufende Partien lassen sich mit einem Klick fortsetzen.
- **Zwölf neue Menschen-Avatare:** Schiffsarzt, Zimmermann, Kartograf, Poet, strickende Oma, Mädchen mit Papierboot, Ingenieurin, Bademeister, Funkerin, Wahrsagerin, Steward und Matrosin – mit Flux gemalt (`public/img/av/`), insgesamt 28 wählbare Porträts.
- **README neu bebildert:** Alle Aufnahmen stammen aus frischen Partien gegen den Rust-Server – die vier Kartenwelten, Lobby mit Bots, Spieltisch, Platzwahl, Statistik, iPhone-Ansichten und eine Nahaufnahme der gemalten Felder (`tests/browser_welten.py` erzeugt die Weltaufnahmen). Die Servergröße steht jetzt prominent im Kopf: ein einziges Binary unter 5 MB.
- **Rückblick auf beendete Partien:** Ein Klick auf eine beendete Partie in „Meine Partien“ zeigt den Endstand aller Plätze (der eigene markiert), den Punkteverlauf als kleine Kurve, Dauer und Runden sowie die vom Standard abweichenden Regeln dieser Partie. Die Daten stammen aus dem Abschlussbericht (`partien.jsonl`); `/api/person` liefert dafür jetzt alle Plätze, den Verlauf und die Einstellungen mit.
- **Pausieren mit Spielerpass:** Verlässt der letzte Mensch eine laufende Partie und haben **alle** menschlichen Plätze einen Spielerpass, bleibt die Partie als Pause liegen (Standard 7 Tage, `PAUSE_MS`). Auto-Modus und Bot-Takt ruhen, die Partie steht nicht in der Spieleliste und lässt sich unter „Meine Partien“ fortsetzen (`POST /api/person/resume` gibt einen neuen Sitzungstoken aus). Fehlt auch nur einem Menschen der Pass, wird wie bisher abgeräumt; den Pass kann man in der Lobby und im Spiel-Menü anlegen.
- **Tests:** `tests/browser_pair.py` prüft Kopplung per Code und das Wiederfinden mit dem Spielerpass in echten Browsern; `tests/api.js` deckt beide Endpunktgruppen ab, inklusive der Übernahme eines Bot-Platzes.
- **Versionszusatz:** Liegen seit dem letzten Tag Commits vor, zeigt die Version `+Anzahl.Hash` (z. B. `1.0.0+5.11661da`, bei uncommitteten Änderungen ` (geändert)`). Die Git-Angabe wird beim Bau per `build.rs` ins Binary gebacken; im Container kommt sie über `APP_VERSION` aus dem Image-Workflow (`git describe`). Ohne Git-Information (Tarball, Image ohne Build-Arg) bleibt es bei der `package.json`-Version.
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
- **Anmeldung:** Der Link zum Spielerpass heißt ohne angelegten Pass „Spielerpass“ und mit Pass „Meine Partien“; die Beschriftung wechselt sofort beim Anlegen oder Entfernen.
- **CI-Stabilität:** Die Browser-Tests für Zuschauer und Bots warten nach einem Neuladen länger, damit die parallele CI-Last keine falschen Timeouts erzeugt.
- **Log ohne doppelten Zeitstempel:** `LOG_TIMESTAMP=0` (oder `off`) schaltet den Zeitstempel im Server-Log ab; unter systemd/journald schreibt journald ihn selbst. Die Quadlet-Vorlage `deploy/handelsinseln.container` setzt die Variable.
- **Nur noch ein Server:** `npm start`/`npm run dev`, `tests/run_all.sh` und der Container bauen und starten den Rust-Server. `Containerfile` baut jetzt das statische Rust-Image; das Node-Image und `Containerfile.rust` entfallen. Die Testskripte (`tests/drive.js`, `tests/lib.py`) treiben den Rust-Server ausschließlich über die API an.

### Entfernt
- **Kontrollübergabe:** Die Gerätekopplung löst den bisherigen Weg ab. `rust/src/handover.rs`, `/api/handover`, die Aktionen `handover_answer` und `handback`, die Felder `players[].handover` und `players[].phone`, die Ereignisse `handover`, `control` und `control_end`, das Nummernfenster am Handy und die Rückfragepanels am Tisch entfallen. Die Controller-Ansicht bleibt; ein gekoppeltes Handy ist ein normales Gerät des Platzes.
- Node-Server (`server/`), die Node-internen Tests (`rules.js`, `features.js`, `sim.js`, `bots.js`, `e2e.js`), die Differenztests gegen den Node-Server, der Browser-Test der Übernahme samt Node-Vorbereitungsserver sowie der Node-Screenshot-Generator (`tests/mock/readme.js` samt `readme_shots.py`). Regel- und Funktionstests dafür werden in Rust neu aufgebaut (siehe `BACKLOG.md`).

### Behoben
- **Meine Partien:** Die eigene laufende Partie zeigt „Du spielst gerade“ statt eines Fortsetzen-Knopfs, der nur den bereits vorhandenen Token setzte. Der eigene Name steht nicht mehr doppelt (Titel und Spielerliste); Mitspieler erscheinen im Untertitel. Beendete Partien sind mit „Beendet am …“ gekennzeichnet und kommen ausschließlich aus dem Archiv – ein noch offener Raum liefert sie nicht zusätzlich.
- **Lobby-Menü:** Der Eintrag heißt mit angelegtem Pass „Meine Partien“ und öffnet die Liste direkt; ohne Pass heißt er „Spielerpass“.
- **Neuladen:** Schließt der Browser beim Neuladen die Ereignisverbindung, bevor `pagehide` feuert, löschte die App den Token und zeigte wieder die Anmeldung. Sie wartet jetzt kurz und prüft, ob die Seite wirklich verlassen wird, bevor sie die Sitzung beendet.

## Frühere interne Entwicklungsstände

Die Entwicklung vor dem ersten öffentlichen Release (1.0.0) ist im [Changelog-Archiv](docs/CHANGELOG-archiv.md) dokumentiert.
