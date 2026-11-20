# Die Handelsinseln – Brettspiel im Browser

Mehrspieler-Browserspiel (2–6 Spieler, 14 Siegpunkte). Die gesamte Spiellogik läuft im Server (Podman-Container);
die Mitspieler öffnen nur die Webseite, geben Namen + Farbe an und spielen. Der erste Spieler im leeren Spiel ist
Spielleiter und startet, wenn genug Mitspieler da sind.

## Starten

```bash
podman build -t handelsinseln -f Containerfile .
podman run -d --name handelsinseln -p 8080:8080 -v handelsinseln-data:/data handelsinseln
# Browser: http://<rechner>:8080
```

Lokal ohne Container: `node server/server.js` (Port per `PORT`, Spielstand-Ordner per `DATA_DIR`).
Der Spielstand wird laufend gespeichert und übersteht einen Neustart; Spieler kehren automatisch zurück.

## Tests

```bash
node tests/rules.js    # gezielte Regeltests
node tests/sim.js 6    # Testspieler spielen vollständige Partien (2–6 Spieler), Invarianten werden geprüft
node tests/e2e.js      # echte Partien über HTTP/SSE mit mehreren „Browsern“
python3 tests/browser_soak.py 6 90   # echter Browser (Playwright) sieht eine ganze Partie, prüft Konsolenfehler
python3 tests/browser_play.py 4 120  # Browser-Spieler klickt Aufbau, Würfeln, Bauen, Handeln selbst
```

## Regeln (Quellen: offizielle Regel 2015, 5-6-Spieler-Erweiterung)

Basisspiel wie gewohnt (Aufbau in Schlangenreihenfolge, Würfeln, Handel, Räuber, Entwicklungskarten,
Längster Handelsweg ab 5, Stärkste Schutzmacht ab 3 Rittern) plus:

- **Schiffe** (Wolle + Holz): nur auf Meer-/Küstenkanten, verbinden sich mit Straßen nur über eigene Siedlungen.
  Pro Zug darf ein *offenes* Schiff (mind. ein freies Ende, nicht in diesem Zug gebaut) versetzt werden.
- **Pirat**: bei einer 7 oder durch Ritter statt des Räubers aufs Meer; stiehlt von Schiffsbesitzern und sperrt Schiffsbau/-bewegung an seinem Feld.
- **Goldfelder**: Ertrag nach freier Wahl. **Häfen** 3:1 und 2:1.
- **Entdeckung**: Das Spielfeld ist zufällig und unbegrenzt. Wer mit Straße oder Schiff an ein unentdecktes Feld stößt, deckt es auf;
  Land bringt 1 Rohstoff Belohnung (Gold: freie Wahl), Meer nichts.
- **Neue Inseln**: Die erste Siedlung auf einer neuen Insel bringt 2 Sonderpunkte (höchstens für zwei Inseln pro Spieler).
- **Straßenbau-Karte** erlaubt Straßen und/oder Schiffe.
- Ab 5 Spielern: **Sonderbauphase** nach jedem Zug (bauen/kaufen, kein Handel mit Spielern); Spieler ohne Möglichkeit werden übersprungen.
- Vereinfachung: Die Bank hat unbegrenzt Rohstoffe.

Details zum Protokoll Client ⇄ Server: `PROTOKOLL.md`.
