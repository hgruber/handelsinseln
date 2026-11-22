# Changelog

Format nach [Keep a Changelog](https://keepachangelog.com/de/1.1.0/).

## [Unveröffentlicht]

### Hinzugefügt
- **Depot:** Dezenter Warnhinweis „⚠ n/Limit“, wenn man mehr Karten auf der Hand hat als erlaubt (Standard 7).

### Geändert
- Für eigene Aktionen gibt es keine Hinweisfenster mehr.
- Die Seitenleiste ist im Spiel standardmäßig geschlossen.
- Die Rohstoffzähler im eigenen Depot zählen erst hoch, wenn die Kartenanimation gelandet ist.
- Der Abstand eines Schiffs zur eigenen angrenzenden Siedlung ist etwas größer.
- Die Kartenanimation im Auto-Ablauf ist dieselbe wie im manuellen (wachsende Karte), nur etwas schneller.

## [1.2.0] - 2026-11-22

### Hinzugefügt
- **Avatare:** 8 neue Menschen-Typen (Kapitän, Piratin, Matrose, Forscherin, Händler, Navigatorin, Fischer, Schiffsjunge), mit Flux gemalt – insgesamt 16 wählbare Avatare.
- **Regeln-Reiter:** Unter den abweichenden Einstellungen stehen jetzt die ausführlichen, bebilderten Spielregeln (Ziel, Aufbau, Zug, Gelände, Kosten, Handel, Räuber/Pirat, Entwicklungskarten, Handelsinseln).
- **Spielreihenfolge:** Im manuellen Ablauf wird die Startreihenfolge ausgewürfelt (Gleichstand würfelt neu); die feststehende Reihenfolge wird in beiden Modi allen als Info-Fenster gezeigt.

### Geändert
- **Auto Ablauf:** „Würfeln“ heißt jetzt „Auto Ablauf“ und steuert mehr. Auto: sofort nach Zugende gewürfelt, Hinweise und Ereignisfenster (Entwicklungskarte, Spielreihenfolge) blenden sich selbst aus, Karten fliegen wie bisher. Manuell: Spieler löst den Wurf aus, Hinweise und Ereignisfenster werden weggeklickt, Karten fliegen deutlich langsamer und wachsen im Flug auf doppelte Größe. Der Spielleiter kann den Schalter als einzigen im laufenden Spiel über das Spielmenü umstellen.
- Spielmenü (Hamburger) sitzt jetzt rechts, links neben dem Protokoll/Chat/Regeln-Fenster.
- Info- und Ereignisfenster in der Bildschirmmitte machen den Hintergrund nicht mehr unscharf.
- Lobby: Der gestrichelte Rahmen um das Inselbrett entfällt.

## [1.1.4] - 2026-11-22

### Geändert
- Handy: Die sechs Farben auf der Startseite stehen immer in einer Reihe (schrumpfen bei Bedarf, kein Umbruch mehr).
- Handy: Die Lobby lässt sich am Griff oben an der Spalte stufenlos nach unten ziehen (und wieder hoch), damit das Spielfeld mehr Platz bekommt.

## [1.1.3] - 2026-11-22

### Geändert
- **Räuber:** Der Mantel schwingt nicht mehr (Animation `sway` entfernt); der Räuber steht ruhig.

## [1.1.2] - 2026-11-22

### Geändert
- **Schiff:** Das eigene Schiff ist jetzt ein mit Flux gemalter Stein (Segler, in Spielerfarbe eingefärbt, 50 % größer, `public/img/stein-schiff.webp`) statt der Vektorzeichnung.

## [1.1.1] - 2026-11-22

### Geändert
- **Spielsteine:** Siedlung gedrungener und breiter, Straße als Holzbalken mit Flux neu gemalt (beide in Spielerfarbe eingefärbt). Siedlung, Stadt, Straße, Räuber und See-Räuber sind 50 % größer.
- **Räuber:** neu als Gauner mit Hut, Beutesack und wehendem Mantel; der Mantel schwingt sanft (CSS-Animation `sway`).

## [1.1.0] - 2026-11-22

### Geändert
- **Spielsteine mit Flux:** Siedlungen, Städte, Räuber und See-Räuber (Piratenschiff) sind jetzt gemalte, freigestellte Flux-Bilder (`public/img/stein-*.webp`). Siedlung und Stadt sind neutral gemalt und werden per SVG-Filter in der Spielerfarbe eingefärbt.
- **Handelshäfen** sind Holzstege (`public/img/steg.webp`), parallel zur Küstenkante ausgerichtet und über zwei kurze Stege mit dem Ufer verbunden. Mittig tragen sie, etwas abgesetzt, den Kreis mit Symbol und Tauschverhältnis.
- **Lobby:** Die Zeile „Spielfeld · Variante · Neues Spielfeld würfeln“ entfällt; „neu“ (Spielfeld neu würfeln) steht neben „Lobby“, „Lobby verlassen“ ist ein „✕“. Der Sprachchat steht unterhalb des Chats. Die Zahlenfelder der Spieleinstellungen sind vertikal bündig ausgerichtet.

## [1.0.1] - 2026-11-22

### Geändert
- Handy: In der unteren Leiste passen jetzt alle Bauknöpfe und alle fünf Rohstoffkarten ohne Scrollen; die Bauknöpfe teilen sich die Breite. Würfel und Hauptknopf („Würfeln“ / „Zug beenden“) sitzen untereinander rechts neben den Handkarten (Querformat: in einer Zeile). Nur Entwicklungskarten bleiben wischbar. Kurze Beschriftungen („Karte“, „Fahren“).

## [1.0.0] - 2026-11-22

### Behoben
- Handy: Protokoll, Chat und Regeln ließen sich nach dem Ausklappen nicht mehr einklappen, weil der Pfeil außerhalb des Bildschirms lag. Der Pfeil sitzt jetzt immer am Rand der Schublade.
- Lobby: Das Spielfeld ließ sich dort nicht zoomen oder verschieben (Mausrad, Ziehen, Pinch), weil Brett und Vollbild-Lobby alle Zeigerereignisse abfingen.
- Handelsangebot: Der Knopf „Gegenangebot“ lief auf schmalen Handys rechts aus dem Fenster.
- Handel: Bots boten dasselbe, gerade abgelehnte Angebot im selben Zug sofort erneut an, sodass es nach dem Wegklicken kurz wieder auftauchte. Ein Bot wiederholt ein Angebot (gleiche Karten) jetzt nicht mehr im selben Zug.
- Verzögerte Mausklicks: Die funkelnden Sterne auf dem Brett (Opacity-Animation je Stern) ließen den Browser das ganze Brett ununterbrochen neu zeichnen und belegten den Hauptthread fast dauernd (Messung: ca. 14 s von 15 s Last, Klicks bis 200 ms verspätet). Die Sterne sind jetzt statisch; die Last sinkt auf etwa 2–4 s von 15 s.
- Neuladen des Browser-Tabs loggt nicht mehr aus: Der beim Entladen abgebrochene Ereignisstrom wurde als Sitzungsende gewertet und löschte den Token.
- Figurenlimit: Ein Stadtausbau gibt die Siedlung wieder frei. Man kann jetzt gleichzeitig bis zu 5 Siedlungen und 4 Städte besitzen (bisher zählten Städte gegen das Siedlungslimit).

### Hinzugefügt
- **Release-Prozess:** `package.json` führt die Version (aktuell 0.9.0); `scripts/release.sh 1.0.0 [--build] [--skip-tests]` prüft master und Arbeitsbaum, lässt alle Tests laufen, macht aus „Unveröffentlicht“ den Versionsabschnitt, committet „Release X“ und setzt das Tag `vX` (nie automatisch pushen). Die Version steht in `/api/config` und unten auf der Anmeldeseite. Ablauf in der README.
- **Töne:** dezente, synthetisierte Töne für neue Chatnachrichten (auch in der Lobby), den eigenen Zug, Würfeln, Bauen, Diebstahl, eingehende Handelsangebote, neue Mitspieler in der Lobby und Spielende. Im Spielmenü „Töne ein-/ausschalten“ (wird gemerkt). Beim Neuladen bleibt es still.
- **App installieren:** Web-App-Manifest (`manifest.webmanifest`), Icons (192/512, maskierbar, Apple-Touch-Icon), minimaler Service-Worker und Meta-Tags; der Link lässt sich auf Android/iOS als eigenständige App ohne Adressleiste installieren.
- **Handelsinseln-Icon im Browser:** Favicon und Tab-Symbol aus dem Logo (`public/icon/`).
- Anmeldung: Laufende, beendete oder volle Spiele erscheinen ausgegraut (nicht wählbar) unter den offenen Spielen.
- Spielmenü: „Brett zentrieren“ und „Töne ein-/ausschalten“; Doppeltippen auf das Brett zentriert auch am Handy.
- Test `tests/browser_mobile.py` (Handy hoch/klein/quer, Desktop: Anordnung, Überlappungen, Schublade, Lobby-Zoom, Manifest).
- Handel: Ein Angebot, für das dir ein verlangter Rohstoff fehlt, wird nach 2 Sekunden automatisch abgelehnt (nicht, solange du ein Gegenangebot zusammenstellst).
- Bauen: Die Bauknöpfe sind auch freigeschaltet, wenn die Rohstoffe per Bank-Tausch (4:1, 3:1, 2:1 je Hafen, Bank-Vorrat berücksichtigt) zusammenkommen. Beim Klick wird vorher automatisch getauscht; der Tooltip nennt den Tausch.
- Eine gespielte Entwicklungskarte erscheint für alle Spieler 2 Sekunden groß in der Bildschirmmitte, mit dem Namen des Spielers.
- Quadlet-Vorlage `deploy/handelsinseln.container` für den Dauerbetrieb hinter einem Reverse-Proxy.
- **Kartenanimation:** Rohstoffkarten fliegen bei Erträgen (vom Feld), Bank- und Spielerhandel, Bauen, Abwerfen, Gold, Erfindung, Monopol und Diebstahl von der Quelle zum Ziel, jede leicht versetzt. Eigene Karten sind groß, golden umrandet und mit Gesicht; öffentliche Bewegungen anderer klein mit Gesicht; gestohlene und abgeworfene Karten unter anderen nur als Kartenrücken. Der Server liefert dafür `view.fx` (nur Beteiligte erfahren, welche Karte gestohlen wurde); beim Verbinden wird nichts nachgespielt; `prefers-reduced-motion` schaltet es ab.
- **Bots mit Strategie:** Der Spielleiter kann in der Lobby (Aufklapp-Liste „Bots hinzufügen“ unter den Spielern, standardmäßig zugeklappt; bereits hinzugefügte Bots verschwinden aus der Liste) bis zu drei Computerspieler hinzufügen – Bruno Biber (Baumeister), Polly Profit (Händler) und Sir Quakalot (Ritter) – mit festen, lustigen Avataren. Sie bewerten Startecken, Bauplätze, Räuber, Handel und Entwicklungskarten nach unterschiedlichen Gewichten und ziehen im Takt (`BOT_MS`).
- **Avatare:** 8 mit Flux/Forge gemalte Tierporträts zur Auswahl beim Beitritt; zufälliger Vorschlag, im Spiel vergebene sind gesperrt, der Server vergibt nie doppelt. Bot-Avatare sind für Menschen nicht wählbar. Die Avatare erscheinen in Spielerkarten, Lobby, Handel und Statistik.
- Tests: `tests/bots.js` (Bot-Turnier), `tests/browser_bots.py` (Avatare und Bots im Browser), neue Funktionstests.

### Geändert
- **Kompakte Ansicht für Handys** (Breite ≤ 900 px oder Höhe ≤ 520 px): Hamburger-Menü links oben in der Ecke; Mitspieler nur als kleine Logos untereinander (Antippen zeigt Werte, Tippen daneben blendet sie aus); Rohstoff-/Entwicklungskarten und Bauknöpfe in schmalen, wischbaren Leisten; Würfel und „Zug beenden“ kompakt daneben (Querformat: alles in einer Zeile); Protokoll/Chat/Regeln als Schublade, bei offenem Handel hat der Handel Vorrang.
- **Alle Schaltflächen außer dem Hamburger-Menü entfallen** (auch am Desktop): Zoomen per Mausrad/Pinch, Zentrieren per Doppelklick/Doppeltippen oder Menü, Hilfe und Mikrofon-Stummschaltung über das Menü (Leertaste bleibt Push-to-talk). Das Spielmenü öffnet links unter dem Knopf.
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
