# Changelog

Format nach [Keep a Changelog](https://keepachangelog.com/de/1.1.0/).

## [Unveröffentlicht]

### Behoben
- Neuladen des Browser-Tabs loggt nicht mehr aus: Der beim Entladen abgebrochene Ereignisstrom wurde als Sitzungsende gewertet und löschte den Token.
- Figurenlimit: Ein Stadtausbau gibt die Siedlung wieder frei. Man kann jetzt gleichzeitig bis zu 5 Siedlungen und 4 Städte besitzen (bisher zählten Städte gegen das Siedlungslimit).

### Hinzugefügt
- Quadlet-Vorlage `deploy/handelsinseln.container` für den Dauerbetrieb hinter einem Reverse-Proxy.
- **Kartenanimation:** Rohstoffkarten fliegen bei Erträgen (vom Feld), Bank- und Spielerhandel, Bauen, Abwerfen, Gold, Erfindung, Monopol und Diebstahl von der Quelle zum Ziel, jede leicht versetzt. Eigene Karten sind groß, golden umrandet und mit Gesicht; öffentliche Bewegungen anderer klein mit Gesicht; gestohlene und abgeworfene Karten unter anderen nur als Kartenrücken. Der Server liefert dafür `view.fx` (nur Beteiligte erfahren, welche Karte gestohlen wurde); beim Verbinden wird nichts nachgespielt; `prefers-reduced-motion` schaltet es ab.
- **Bots mit Strategie:** Der Spielleiter kann in der Lobby (Aufklapp-Liste „Bots hinzufügen“ unter den Spielern, standardmäßig zugeklappt; bereits hinzugefügte Bots verschwinden aus der Liste) bis zu drei Computerspieler hinzufügen – Bruno Biber (Baumeister), Polly Profit (Händler) und Sir Quakalot (Ritter) – mit festen, lustigen Avataren. Sie bewerten Startecken, Bauplätze, Räuber, Handel und Entwicklungskarten nach unterschiedlichen Gewichten und ziehen im Takt (`BOT_MS`).
- **Avatare:** 8 mit Flux/Forge gemalte Tierporträts zur Auswahl beim Beitritt; zufälliger Vorschlag, im Spiel vergebene sind gesperrt, der Server vergibt nie doppelt. Bot-Avatare sind für Menschen nicht wählbar. Die Avatare erscheinen in Spielerkarten, Lobby, Handel und Statistik.
- Tests: `tests/bots.js` (Bot-Turnier), `tests/browser_bots.py` (Avatare und Bots im Browser), neue Funktionstests.

### Geändert
- Ausgeglichene Startecken: Beim Erzeugen eines Spielfelds werden bis zu 40 Karten gewürfelt und der Aufbau (Schlangenreihenfolge, beste freie Ecke zuerst) simuliert; genommen wird die Karte mit der geringsten Streuung der Wahrscheinlichkeitspunkte, mit ausreichender Rohstoffvielfalt je Spieler und – bei „Vier Heimatinseln“ – ähnlich ertragreichen Inseln.
- Das Spiel heißt nur noch „Die Handelsinseln“ (README, Quelltext-Kommentar, Changelog).
- Ereigniskarten (Ritter, Siegpunkt, Straßenbau, Erfindung, Monopol) mit Flux/Forge neu gemalt (`public/img/dev-*.webp`).
- README mit Screenshots aus echten Bot-Partien (`docs/screenshots`, erzeugt mit `tests/mock/readme.js` und `readme_shots.py`).
- Mit Flux/Forge neu erzeugt: ruhigere Meeres-Hexagone, Rohstoffkarten-Bilder (Holz, Lehm, Wolle, Getreide, Erz) und ein dezenter Meereshintergrund ohne Animations-Overlay (die Wellen-Ebenen und ihr Parallax entfallen).
- Zahlenchips: Cursor ist jetzt ein Zeiger statt Fragezeichen; ein Klick öffnet ein Hilfefenster mit Wahrscheinlichkeit und Ertrag.
- Performance: Beim Verschieben und Zoomen pausieren die Ambient-Animationen und das Glas verzichtet auf den Blur; Wellen-Pulse und treibender Schaum pro Feld sind statisch; die Wellen im Meer-Hintergrund laufen über `translate` statt `background-position`.
- Es laufen höchstens 3 Spiele gleichzeitig (`MAX_GAMES`); ein viertes neues Spiel wird mit Hinweis abgelehnt.
- Neue Umgebungsvariable `LISTEN` (`Adresse:Port`) für den http-Listener, z. B. `127.0.0.1:8080` hinter einem Reverse-Proxy.
- Das Spiel heißt jetzt „Die Handelsinseln“ (Titel, Anmeldeseite, README).
- Neues Logo (Sechseck mit Segelschiff, mit Flux/Forge erzeugt) auf der Anmeldeseite.

### Hinzugefügt
- Vierte Variante „Archipel“ (viele kleine Inseln, viel Gold, viele Häfen).
- Seitenleiste „Regeln“ mit allen vom Standard abweichenden Einstellungen (Lobby und Spiel).
- https auf Port 8443 mit automatisch erzeugtem Zertifikat, damit das Mikrofon im LAN funktioniert; Lobby verweist bei `http://` darauf.
- Kanten, an denen ein Nebelfeld aufgedeckt wird, sind mit „?“ markiert.

### Behoben
- Nebelfelder waren beim Spielstart nicht mehr sichtbar (Kamera zeigte nur das Land); die Lobby-Vorschau lieferte keinen Nebelring.
- Die Lobby-Vorschau passt die Kamera nach Variantenwechsel und „Neu würfeln“ neu ein.
- „Standard wiederherstellen“ meldete „unbekannter Eintrag 7“ (es gibt keinen Wertechip 7).

### Hinzugefügt (frühere Einträge)
- Mehrere parallele Spiele: Neuankömmlinge sehen alle beitretbaren Spiele oder eröffnen ein neues; Spielleiter kann Spieler entfernen und Plätze schließen.
- Lobby mit Spielfeld-Vorschau (neu würfeln), drei Varianten (Klassisch, Nebelinseln, Vier Heimatinseln) und Einstellungen: Würfeln/Räuber automatisch, Siegpunkte,
  Handkarten-Limit, Bankkurs, Spielerhandel, Inselpunkte sowie Vorräte (Figuren, Entwicklungskarten, Bank, aufdeckbare Felder und Wertechips).
- Spielleiter kann das Spiel beenden; alle erhalten eine Statistik. Das Spiel endet, wenn der letzte Spieler geht.
- Auto-Modus für Verlassene/Abwesende (Erträge, 1:1-Angebote, Räuber, Zug) mit Übernahme der Infrastruktur oder Verschwinden nach n Runden.
- Sprachchat per Mikrofon (WebRTC) mit Stummschaltung; optionales https (`TLS_CERT`/`TLS_KEY`).
- Gemalte Geländetexturen (Flux/Forge) statt rein vektorieller Felder.
- Erstes lauffähiges Spiel: Die Handelsinseln (Brettspiel) für 2–6 Spieler im Browser (Podman-Container, 14 Siegpunkte).
- Zufälliges, unbegrenzt entdeckbares Spielfeld (Schiffe/Straßen decken Land- und Meerfelder auf).
- Lobby mit Namen und Farbwahl; der erste Spieler startet das Spiel.
- Handelsdialog mit Bank-Tausch, Angeboten an alle und Gegenangeboten.
- Sonderbauphase für 5–6 Spieler, Pirat, Goldfelder, Sonderpunkte für neue Inseln.
