# Changelog

Format nach [Keep a Changelog](https://keepachangelog.com/de/1.1.0/).

## [Unveröffentlicht]

### Hinzugefügt
- **Zuschauer (Phase 1 von 3):** Auf der Startseite ist ein laufendes Spiel farblich abgesetzt; wählt man es, wird aus „Beitreten“ der Knopf „Spiel ansehen“ (ohne Namen/Farbe). Der Browser zeigt die öffentliche Tisch-Anzeige – Plätze rund ums Brett, Punkte, Würfel, Handelsangebote und Meldungen – ohne Handkarten, Entwicklungskarten, Chat und Sprachchat und ohne Aktionen (Server liefert eine eigene öffentliche Sicht, Aktionen und Signale werden mit 403 abgelehnt). Bis zu 8 Zuschauer je Spiel, Menü „Zuschauen beenden“, Neuladen behält die Sitzung. Zuschauer-Fenster (Reihenfolge, gespielte Karte) schließen sich von selbst.

### Geändert
- **Goldfluss-Felder, Fairness:** Anfangssiedlungen dürfen nicht an ein Goldfluss-Feld grenzen (feste Regel; bei weniger Siedelplätzen als Mitspielern wäre Gold am Start ein unfairer Vorteil), und Goldfluss-Felder tragen nur noch die Zahlen 2, 3, 4, 10, 11 und 12 – auch wenn sie im Nebel entdeckt werden. Die Kartenerzeugung bewertet die Startecken ohne Goldfelder.

## [1.5.12] - 2026-11-24

### Geändert
- **Inselabstand umgedreht:** „Normal“ ist jetzt der dichte Abstand zwischen den Inseln (Heimatinsel, Archipel), die Alternative heißt „Weiter“ (die bisherigen größeren Abstände). Die Einstellung hieß „Inseln dichter“; bestehende Spiele behalten ihr Brett.
- **Lobby, „Tischspieler anlegen“** sitzt rechts neben der Überschrift „Spieler 1/6“.
- **Lobby auf Mobilgeräten:** Das Menü ist ein bündiges Bottom-Sheet über der Karte; „Spiel starten“ liegt in einer deckenden, vollbreiten Leiste dauerhaft am unteren Rand (wie auf dem Desktop), der Inhalt scrollt darüber.

### Behoben
- **Lobby auf Android (Chromium):** Die Karte lässt sich in der Lobby wieder verschieben und zoomen; das `pointer-events: auto` des Scroll-Containers gilt nur noch auf iOS.

## [1.5.11] - 2026-11-24

### Geändert
- **Lobby, Spieleinstellungen:** Das Panel „Spieleinstellungen“ ist standardmäßig zugeklappt.

### Behoben
- **Lobby auf Mobilgeräten (iOS Safari):** Das Menü scrollt über den ganzen Bildschirm und gleitet dabei über die Karte; „Spiel starten“ steht als Leiste am unteren Rand und überlagert die Varianten nicht mehr. Der Scroll-Container hat auf Mobil `pointer-events: auto` (iOS scrollt sonst nicht), die Vorschau ist dort nicht mehr per Touch verschiebbar. Geprüft mit WebKitGTK 2.54.

## [1.5.10] - 2026-11-24

### Behoben
- **Lobby auf iOS (Safari):** Das Menü scrollt wieder; auf schmalen Bildschirmen scrollt jetzt die Seitenspalte selbst (iOS scrollt keinen Container mit `pointer-events: none`).

## [1.5.9] - 2026-11-24

### Geändert
- **Räuber animiert:** Der Räuber hat einen neuen Look (ohne rote Augen) und sein Mantel flattert einseitig im Wind – eine mit Wan 2.2 erzeugte Animation (`public/img/stein-raeuber.webp`, animiertes WebP, 24 fps) ersetzt das Standbild.
- **Lobby, Spieleinstellungen:** Schalter und Zahlenfelder stehen in festen Spalten bündig untereinander (gleich breite Umschalter, „−“ links und „+“ rechts der Zahl, „Std“/„∞“ in eigener Spalte); für Mitspieler bleibt das Raster beim Ausblenden der Knöpfe erhalten.
- **Goldfluss-Felder seltener:** Auf Nebeninseln (klassisch, Inseln, Archipel) sind nur noch etwa 15 % der Felder Gold statt 40–55 %, im Archipel auf der Heimatinsel 10 % statt 25 %; im Nebel-Modus ist die Gold-Gewichtung von ×2,2 auf ×1,3 gesenkt.

## [1.5.8] - 2026-11-23

### Geändert
- **Spieltisch, Platzwahl beim Start:** Die Plätze werden nicht mehr in der Lobby festgelegt (die Tischverteilung aus 1.5.7 entfällt). Beim Spielstart wird jeder Spieler der Reihe nach – der Spielleiter zuerst, dann in der Reihenfolge des Anlegens – mit großem Avatar gefragt „Wo sitzt du, <Name>?“ und wählt per Knopf einen der acht Plätze (an den langen Seiten je drei, an den kurzen einer; belegte Plätze sind gesperrt). Danach ergibt sich die Reihenfolge aus den Plätzen im Uhrzeigersinn, gewürfelt wird nur, wer beginnt. Sitzen auf einer langen Seite Nachbarn nebeneinander, werden die Plätze verkleinert.

## [1.5.7] - 2026-11-23

### Geändert
- **Kartenformat:** Die Karte wird passend zum Seitenverhältnis des Spielleiter-Bildschirms erzeugt (z. B. 16:9): Heimatinseln, Archipel und die kleinen Inseln der klassischen Karte verteilen sich auf einer Ellipse, die Hauptinsel wird breiter. Die Landfläche bleibt gleich, nur die Form ändert sich; die Lobby gleicht das Format automatisch an (bei deutlicher Fenster­änderung wird die Vorschau neu erzeugt).
- **Tischverteilung (Spieltisch):** Die Plätze werden nicht mehr einzeln gewählt. Die Tischspieler setzen sich im Uhrzeigersinn in der Reihenfolge, wie sie angelegt werden, der Spielleiter zuerst. In der Lobby legt der Spielleiter fest, **wo er sitzt** und (bei weniger als sechs geplanten Spielern) **welche Plätze frei bleiben**; „Automatisch“ wählt sinnvolle freie Plätze (2 Spieler gegenüber, 4 in den Ecken, …). An den langen Bildschirmseiten sitzen höchstens zwei Spieler, an den kurzen einer; sitzt unten/oben nur einer, rückt er in die Mitte. Die Anzahl der geplanten Spieler bestimmt die Verteilung.

## [1.5.6] - 2026-11-23

### Geändert
- **Tischspieler anlegen (Lobby):** Die Avatar-Auswahl sieht jetzt aus wie auf der Startseite (Dropdown mit Vorschaubildern, gruppiert nach Menschen und Tieren).

## [1.5.5] - 2026-11-23

### Behoben
- **Spieltisch:** Die Würfel an den seitlichen Plätzen verschwinden nach der Animation nicht mehr: Im Ruhezustand wird eine flache Würfelseite statt des 3D-Würfels gezeigt.

## [1.5.4] - 2026-11-23

### Geändert
- **Spieltisch:** Die Punkteanzeige (Name, Punkte, öffentliche Daten) des Spielers am Zug sitzt mittig über seinem Aktionsbereich statt links neben dem geheimen Bereich.

## [1.5.3] - 2026-11-23

### Geändert
- **Spieltisch:** Die Punkteanzeige des Spielers am Zug blinkt langsam und deutlich in seiner Farbe und bleibt zweizeilig, wenn sie links vom geheimen Bereich sitzt. Karten zur Bank fliegen in die Ecke unten rechts. Beim Aufbau zeigt die öffentliche Zeile des Spielers, was er tun soll; Aktionen direkt auf dem Spielfeld (Bauen, Räuber, Schiffe) erzeugen keine Mitteilungen mehr.

### Behoben
- **Spieltisch:** Die Würfel an den seitlichen Plätzen verschwinden nicht mehr (der Wurfsprung wurde abgeschnitten).

## [1.5.2] - 2026-11-23

### Geändert
- **Spieltisch:** Die Knöpfe „Würfeln“/„Zug beenden“, Baukosten und Würfel passen jetzt in die öffentliche Zeile. In der Tischmitte erscheinen keine Meldungen mehr dazu, wer an der Reihe ist, was gewürfelt wurde und wer was erhält (alles ist am Tisch zu sehen).

## [1.5.1] - 2026-11-22

### Geändert
- **Spieltisch, neues Platz-Layout:** Würfel und Anweisungsmeldung verdecken das Spielfeld nicht mehr (keine „Du bist dran …“-Anweisung am Tisch). Jeder Platz besteht aus einem **geheimen Bereich** (eine Zeile fester Größe, immer sichtbar: Rohstoffstapel und bis zu 4 Entwicklungskarten) und einer **öffentlichen Zeile** darüber (gleiche Breite): nur am Zug mit Baukosten, Handeln, Würfeln/Zug beenden und den Würfeln, sonst Avatar, Name, Punkte und weitere öffentliche Daten. Am Zug rutscht das Namensfeld links neben den geheimen Bereich. Das Hamburger-Menü sitzt immer rechts vom geheimen Bereich des Spielleiters.
- **Spieltisch, Handeln:** Das Menü sperrt nichts und zeigt keine Kartenanzahlen. Wer einen Rohstoff anbietet, den er nicht hat, löst das Angebot trotzdem aus; sein Stapel im geheimen Bereich blinkt rot, die Mitspieler können annehmen, der Anbieter kann nur zurückziehen.
- **Spieltisch, Nachrichten:** Neue Spielmeldungen erscheinen für alle in der Tischmitte und verschwinden von selbst oder per Klick.
- **Online-Ansicht:** Die Hand (Rohstoffe + Entwicklungskarten) hat eine feste Breite für drei Entwicklungskarten; sonst unverändert.

## [1.5.0] - 2026-11-22

### Geändert
- **Digitaler Spieltisch neu gedacht:** Tischspieler gibt es nur am Tisch und werden in der Lobby über „Tischspieler anlegen …“ (Name, Farbe, Avatar, Platz am Tisch) vom Spielleiter angelegt; der Platz lässt sich dort jederzeit tauschen. Der erste Tischspieler schaltet den Tisch ein, der letzte aus – das Umschalten im Spielmenü entfällt. Bots und Online-Spieler sind in einer Tisch-Partie nicht erlaubt (Beitritt, Bots und die Liste „Spiele“ sind gesperrt/gekennzeichnet).
- Die Reihenfolge bestimmt der Tisch (Plätze im Uhrzeigersinn); gewürfelt wird nur noch, wer beginnt (bei Gleichstand würfeln die Höchsten neu).
- Die Leisten am Spielfeldrand sind dauerhaft und zeigen auch geheime Informationen (Rohstoffe, Entwicklungskarten, verdeckte Punkte); die Spieler decken sie selbst ab.
- Am Tisch wird das Spielfeld so groß gezogen, dass alle Nicht-Nebel-Felder gerade noch sichtbar sind.

## [1.4.0] - 2026-11-22

### Hinzugefügt
- **Digitaler Spieltisch** (Menü, nur Spielleiter, jederzeit im Spiel ein-/ausschaltbar): Der Browser des Spielleiters wird zur Tischplatte und handelt zusätzlich für alle Spieler. Das Spielfeld ist zentriert, Zoomen ist möglich, springt aber wieder zurück, sodass das ganze Feld sichtbar bleibt. Die Rohstoffleiste jedes Spielers sitzt je nach Spielerzahl verteilt am Bildschirmrand und ist zur Sitzposition gedreht (oben auf dem Kopf); Menü und Handel des Spielers am Zug erscheinen in seiner Leiste, bei einem Handelsangebot bekommt jeder Mitspieler ein eigenes Menü an seinem Platz (Annehmen, Ablehnen oder Gegenangebot). Stehlen und Abwerfen werden auf dem Tisch verdeckt animiert, Meldungen und Würfel bleiben in der Bildschirmmitte. Pflichten (Abwerfen, Gold) werden nacheinander je Spieler abgefragt; Entscheidungsfenster erscheinen in Blickrichtung des Spielers (unten/oben direkt an seinem Platz).
- **Spiel ändern:** Der Spielleiter kann im Menü (vor „Spiel beenden“) und in der Statistik alle Einstellungen im laufenden Spiel ändern – außer dem Spielfeld (Variante, Spielerzahl, Inselabstand). Änderungen gelten sofort für alle und werden im Spielverlauf vermerkt; Siegpunkte müssen über dem höchsten Stand liegen. Angepasste Vorräte (Entwicklungskarten, Nebel-Felder/-Chips) berücksichtigen schon Gezogenes bzw. Aufgedecktes nur näherungsweise.
- **Inseln dichter:** Neue Spielfeld-Einstellung für „Heimatinsel“ und „Archipel“, die die Abstände zwischen den Inseln verringert (gleiche Landfläche, kompakteres Brett).

### Behoben
- **Spielplan ansehen:** Das Spielfeld ist nicht mehr verschwommen und lässt sich wieder verschieben und zoomen.
- **„Statistik anzeigen“** hüpft nicht mehr, wenn man mit der Maus darüberfährt.

## [1.3.0] - 2026-11-22

### Hinzugefügt
- **Spielende:** Der Spielleiter kann über „Weiterspielen“ mit einem neuen (höheren) Siegpunktziel zurück ins Spiel; alle können über „Spiel nur ansehen“ das Spielfeld betrachten (Statistik per Knopf wieder abrufbar).
- **Depot:** Dezenter Warnhinweis „⚠ n/Limit“, wenn man mehr Karten auf der Hand hat als erlaubt (Standard 7).

### Geändert
- **Avatar-Auswahl** auf der Startseite ist jetzt ein Dropdown mit Vorschau, gruppiert nach „Menschen“ vor „Tiere“ (Tastatur: Pfeile, Esc).
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
