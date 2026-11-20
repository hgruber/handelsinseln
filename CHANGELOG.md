# Changelog

Format nach [Keep a Changelog](https://keepachangelog.com/de/1.1.0/).

## [Unveröffentlicht]

### Geändert
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
- Erstes lauffähiges Spiel: Die Handelsinseln für 2–6 Spieler im Browser (Podman-Container, 14 Siegpunkte).
- Zufälliges, unbegrenzt entdeckbares Spielfeld (Schiffe/Straßen decken Land- und Meerfelder auf).
- Lobby mit Namen und Farbwahl; der erste Spieler startet das Spiel.
- Handelsdialog mit Bank-Tausch, Angeboten an alle und Gegenangeboten.
- Sonderbauphase für 5–6 Spieler, Pirat, Goldfelder, Sonderpunkte für neue Inseln.
