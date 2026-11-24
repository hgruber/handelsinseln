# Backlog

Ideen und Vorhaben, die noch nicht umgesetzt sind.

- **Aktionen rückgängig machen:** Eine gerade ausgeführte Aktion (Bauen, Räuber setzen, …) zurücknehmen können, vor allem nach einem Fehltipp am Spieltisch bzw. in der Controller-Ansicht. Offen: Welche Aktionen sind umkehrbar (nicht nach Würfeln, Karte ziehen, Handel), wer darf zurücknehmen (nur der Spieler am Zug, am Tisch evtl. mit Zustimmung), wie lange gilt es (bis zum nächsten Zug/Würfelwurf), und Anzeige im Protokoll.
- **Ereignisstrom als Deltas:** Statt bei jedem Update den ganzen Zustand (gzip-komprimiert) zu senden, Log und Chat nur als neue Einträge schicken (ursprünglicher Katalogpunkt 13; in 1.7.0 stattdessen gzip). Lohnt erst, wenn das Datenvolumen trotz gzip auffällt.
- **gzip-Strom hinter dem Reverse-Proxy prüfen:** Mit einem Handy im Mobilfunk eine echte Partie über den Proxy spielen und prüfen, dass der komprimierte Ereignisstrom ohne Verzögerung (Pufferung) ankommt.
- **Vor dem ersten Push auf GitHub:** Autor-Adresse aller Commits durch die GitHub-noreply-Adresse ersetzen, falls die private Adresse nicht sichtbar sein soll. Tags in kleinen Gruppen (≤ 3) pushen, sonst löst GitHub für sie keine Workflows aus und die 27 alten Tags würden still hochgeladen; vorher entscheiden, ob alte Tags überhaupt Releases werden sollen.
- **Formatter (optional):** Prettier o. Ä. nur als eigener, reiner Formatierungs-Commit einführen (ändert das ganze Repo, `git blame` dann mit `--ignore-rev`).
