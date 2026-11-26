# Identität und Kopplung

Beschreibt, wie eine Person ihre Partien wiederfindet, ohne Konto, Passwort oder E-Mail,
und wie ein Gerät an einem Spieltisch Zugang zu einem Platz bekommt. Sie hat die frühere
Kontrollübergabe mit Nummernvergleich ersetzt.

**Stand:** Alle vier Stufen sind umgesetzt (Kopplung per Nonce, QR im Client, Spielerpass,
„Meine Partien“, Kontrollübergabe entfernt).

Abweichungen vom ursprünglichen Entwurf, die beim Bauen sinnvoll waren:

- Das gekoppelte Gerät erhält **denselben Raum-Token**; getrennte Tokens pro Gerät (für ein
  gezieltes „Gerät abmelden“) sind noch nicht umgesetzt, weil `Player.token` genau einen
  Token je Platz vorsieht.
- Es gibt **keine `personen/<id>.json`**: Die Zuordnung liegt am Platz (`Player.personId`)
  und im Abschlussbericht `partien.jsonl`, also an den Stellen, die es ohnehin gibt.
- Der Pass sind vier Wörter aus einer 256er-Liste (32 Bit, `shared/woerter.js`); die
  Personen-ID wird im Browser per WebCrypto berechnet (HTTPS oder localhost), mit
  Mengenbegrenzung auf die Einlösung.
- Der QR-Encoder ist selbst geschrieben (`public/qr.js`, Byte-Modus, Fehlerkorrektur M,
  Versionen 1–6) und wurde gegen `zxing` geprüft. Einen abtippbaren Kurzcode gibt es nicht; die
  Kopplung läuft ausschließlich über den QR-Code.

Leitgedanke: Die bestehende Einfachheit bleibt. Kein Login beim Start, keine externen
Dienste, kein neuer Speicher für laufende Partien. Wer nichts davon will, spielt wie
heute.

## Glossar

### Begriffe

| Ebene | Begriff | Was es ist | Wo es lebt | Lebensdauer |
|---|---|---|---|---|
| Spiel | **Partie** (Raum, `Room`, `rid`) | ein Spielbrett mit Zustand `S`; mehrere parallel im `Hub` | `state.json` | bis zum Aufräumen |
| Spiel | **Platz** (`pid`) | ein Sitz in genau einer Partie; Index in `S.players` | in der Partie | solange die Partie läuft |
| Spiel | **Spieler** (`Player`) | Datensatz des Platzes: Name, Farbe, Avatar, `token`, `left`, `vanished` | `S.players[pid]` | wie der Platz |
| Spiel | **Raum-Token** (Sitzungstoken, `p.token`) | 32 Hex-Zeichen; das Geheimnis für **einen Platz** | `S.players[pid].token` und `localStorage` des Geräts | bis zur Verdrängung |
| Spiel | **Gerät** (`Client`) | eine SSE-Verbindung; pro Token eine Liste | `Clients` (Speicher) | bis die Verbindung endet |
| Spiel | **Zuschauer** (`Watcher`) | Sicht ohne Platz, mit eigenem Zuschauer-Token | `Room.watchers`, nicht in `S` | bis zum Verlassen |
| Spiel | **Tischgerät** | das Gerät, das die Tisch-Anzeige zeigt (heute Host mit Tisch-Stream) | wie ein Gerät | wie ein Gerät |
| Spiel | **Host / Spielleiter** | der Platz, der die Lobby leitet (`S.host`) | in der Partie | wie der Platz |
| Spiel | **Bot** (Autopilot) | Platz ohne Token (`token: None`), gesteuert von `bot.rs` | in der Partie | wie der Platz |
| Person | **Person** | derselbe Mensch über Partien und Server hinweg | nirgends gespeichert, nur gedacht | – |
| Person | **Spielerpass** | vier Wörter; der Schlüssel zum Schließfach | auf dem Gerät | bis der Nutzer ihn ersetzt |
| Person | **Personen-ID** (`personId`) | `HMAC-SHA256(pass, serverId)`; das Pseudonym, das der Server sieht | auf dem Gerät berechnet, an den Server gesendet | pro Server neu |
| Person | **serverId** | stabile Zufallskennung der Installation | `DATA_DIR/server.json`, öffentlich | Installation |
| Person | **`personen/<id>.json`** | Zuordnung Personen-ID → Raum-Token/Partien | `DATA_DIR` | bis zum Aufräumen |
| Kopplung | **Nonce** (`Pairing`) | 128 bit, an einen Raum gebunden, einmalig einlösbar | `Room.pairs`, nicht in `S` | 60 s |
| Kopplung | **QR / `#k=<nonce>`** | Anzeige des Nonce auf dem zeigenden Gerät | URL-Fragment, flüchtig | wie der Nonce |
| Kopplung | **Verdrängung** (`replaced`) | Ersetzen eines Tokens auf Ansage („Gerät abmelden“, „Platz übernehmen“) | Ereignis an das alte Gerät | einmalig |
| Speicher | **`state.json`** | laufende Partien inklusive Tokens | `DATA_DIR` | bis Partie endet |
| Speicher | **`partien.jsonl`** | Abschlussberichte (Namen, VP, Runden, `history`) | `DATA_DIR` | dauerhaft |

### Beziehungen

| Von | Beziehung | Nach | Bedeutung |
|---|---|---|---|
| Partie | 1 — n | Platz | eine Partie hat mehrere Sitze |
| Platz | 1 — 1 | Raum-Token | ein Platz, ein Token; der Token ist der Sitzungsschlüssel |
| Raum-Token | 1 — n | Gerät | derselbe Token darf auf mehreren Geräten offen sein (`Clients` ist eine Liste) |
| Zuschauer | 1 — 1 | Zuschauer-Token | Zuschauer haben keinen Platz und keinen Raum-Token |
| Person | 1 — 1 | Spielerpass | gedacht eins zu eins; technisch mehrere möglich |
| Spielerpass | 1 — 1 | Personen-ID **je Server** | gleicher Pass, anderer `serverId` → andere ID → nicht serverübergreifend verknüpfbar |
| Personen-ID | n — n | Raum-Token | vermittelt durch `personen/<id>.json`: die Liste der Tokens dieser Person |
| Nonce | n — 1 | Partie | das Angebot hängt an einem Raum |
| Nonce | 0..1 — 1 | Platz | erst offen, dann durch das einlösende Gerät bestimmt |
| Gerät | löst ein | Nonce | bekommt einen eigenen Raum-Token für den Platz |

### Die Kette

```
Person ──hat──▶ Spielerpass ──HMAC(pass, serverId)──▶ Personen-ID ──öffnet──▶ personen/<id>.json
                                                                                    │
                                                                                    ▼
                                                                          Raum-Token (mehrere)
                                                                                    │
                                                                                    ▼
                                                                              Platz in Partie
```

Der **Raum-Token** ist das Spielgeheimnis (wer ihn hat, spielt den Platz). Der
**Spielerpass** ist das Schließfachgeheimnis (wer ihn hat, bekommt die Raum-Tokens). Die
**Personen-ID** ist der Name des Schließfachs, den der Server sieht — nie der Pass selbst.

## Ausgangslage im Code

- Der Raum-Token ist bereits die gesamte Sitzung; `Clients = HashMap<String, Vec<Client>>`
  (`rust/src/server.rs:44`) erlaubt mehrere Verbindungen pro Token.
- `DATA_DIR/state.json` hält laufende Partien inklusive Tokens; `partien.jsonl` den
  Abschlussbericht (Namen, VP, Runden, `history`) ohne Personenbezug.

## Grundsätze

1. **Platz und Person sind getrennt.** Am Tisch und in einer Partie existiert nur der
   Raum-Token. Der Spielerpass wird nie an einen Server geschickt und nie in einem Raum
   verwendet. Wer einen Raum-Token erbeutet, gewinnt einen Platz in einer Partie — nicht
   die Identität, nicht die Historie, nicht andere Partien.
2. **Ein Geber, ein Empfänger.** Der QR-Code wird immer auf dem PC bzw. Tischgerät
   angezeigt, das Handy scannt immer. Der PC braucht nie eine Kamera.
3. **Der Token steht nie im QR-Code.** Im Code steht ein Nonce, das ein Gerät mit Sitzung
   einlöst. Ein abfotografierter Code ist nach Ablauf und nach einmaliger Einlösung wertlos.
4. **Personenbezug ist Opt-in pro Server.** Ohne Zustimmung bleibt es bei Namen und
   Statistik wie heute.

## Baustein A – Gerätekopplung per Nonce

Ein Gerät mit Sitzung löst ein Nonce ein, das andere Gerät zeigt es an und bekommt
daraufhin einen eigenen Raum-Token für denselben Platz.

| Sitzung liegt auf | QR auf | scannt | Ergebnis |
| --- | --- | --- | --- |
| PC | PC | Handy | Handy bekommt einen Token für denselben Platz |
| Handy | PC | Handy | PC bekommt einen Token für denselben Platz |

In beiden Fällen zeigt der PC, das Handy scannt; die Richtung entscheidet nur, wer danach
den Token bekommt.

### Ablauf

1. Das Gerät, das den QR zeigt, fordert ein Angebot an: `POST /api/pair` mit `{game, pid?}`
   → `{nonce, url, bis}`. Hat der Aufrufer eine Sitzung, ist der Platz sein eigener; das
   Tischgerät (Host) darf `pid` für einen Platz angeben. Ohne Sitzung bleibt `pid` offen —
   den Platz bestimmt dann das einlösende Gerät.
2. Der Client zeichnet `https://…/#k=<nonce>` als QR-Code und zeigt den Nonce zusätzlich
   als Text (falls die Kamera nicht will).
3. Das Handy öffnet die URL, der Client liest den Nonce aus dem Fragment und ruft
   `POST /api/pair/claim` mit `{nonce}`. Hat das Handy eine Sitzung im selben Raum, wird
   das Angebot an seinen Platz gebunden (Handy → PC). War am Angebot bereits ein Platz
   gebunden, gibt der Server dem Handy sofort einen eigenen Token für diesen Platz
   (PC → Handy). Ist keins von beidem der Fall, lehnt der Server ab.
4. Der PC pollt `POST /api/pair/check` mit `{nonce}` (oder per SSE) und erhält den Token,
   sobald das Angebot eingelöst ist.

### Zustand

Am `Room` (wie `arm`), nicht in `S`, nicht gespeichert:

```
Pairing { nonce: String (128 bit hex), game: String, pid: Option<usize>, bis: i64, eingelöst: bool }
```

- TTL 60 s (`PAIR_MS`), einmalige Einlösung, Aufräumen wie bei den übrigen Raum-Angeboten; der Nonce ist
  raumweit eindeutig, deshalb findet der Server den Raum über ihn.
- Koppeln verdrängt nicht: Beide Geräte behalten gültige Tokens für denselben Platz
  (`Clients` ist pro Token eine Liste). Eine Verdrängung gibt es nur auf Ansage, z. B.
  „Gerät abmelden“ oder „Platz übernehmen“ am Tisch; das alte Gerät erhält dann ein
  `pairing`-Ereignis (`replaced`).
- Nonce im URL-Fragment: landet nicht in Serverlogs.

### Am Spieltisch

- Das Tischgerät zeigt „Platz 3: Handy verbinden“; Angebote werden pro **Platz** erzeugt,
  nicht pro Person. Ein Angebot erzeugen darf das Tischgerät (Host) oder der Inhaber des
  Platzes selbst — nicht ein beliebiger Zuschauer.
- Kurze TTL und einmalige Einlösung sind der Schutz gegen „zuerst scannen“. Optional
  bestätigt der Host nach dem Scan („Platz 3 verbunden“); physische Anwesenheit bleibt die
  eigentliche Autorisierung, dagegen hilft keine Kryptografie.
- Ein Platz ist rückholbar: Der rechtmäßige Spieler wählt „Platz übernehmen“, der fremde
  Token wird verdrängt.

## Baustein B – Spielerpass

Der Spielerpass findet die eigenen Partien auf einem neuen oder verlorenen Gerät.

- Sechs Wörter aus einer 2048er-Liste (≈ 66 bit), Anzeige nur einmal vollständig,
  danach maskiert.
- **Die Personen-ID wird lokal berechnet:** `personId = HMAC-SHA256(pass, serverId)`,
  wobei `serverId` der Server in `/api/info` veröffentlicht. Der Pass selbst geht nie an
  einen Server, nur die abgeleitete ID.
- Folge: Dieselbe Person hat auf jedem Server eine andere ID. Ein fremder Server kann
  Partien nicht über Server hinweg verknüpfen.
- Wegen der hohen Entropie reicht SHA-256 als Ableitung, keine KDF-Dependency.
- Server-seitig: `DATA_DIR/personen/<personId>.json` mit den zugehörigen Raum-Tokens und
  Partie-Kennungen. `POST /api/person` mit der ID liefert die Partien; laufende kommen aus
  `state.json`, beendete aus `partien.jsonl`.
- Code-Rotation (neuer Pass = neue ID) löst die Zuordnung; offen, ob dabei auch die alten
  Raum-Tokens verdrängt werden sollen („alle Geräte abmelden“).
- Der Pass bleibt freiwillig: kein Login beim Start, nur ein Menüpunkt „Mein Spielerpass“.
- Pause: Verlässt der letzte Mensch eine laufende Partie, bleibt sie nur stehen, wenn **alle**
  menschlichen Plätze einen Pass haben; `POST /api/person/resume` holt den Platz samt neuem
  Raum-Token zurück (Standard 7 Tage, `PAUSE_MS`). Ohne Pass für alle wird wie bisher abgeräumt.
- WebCrypto (`crypto.subtle`) braucht HTTPS oder localhost. Über http im LAN ist der
  Personenbezug nicht verfügbar (nur die Platz-Ebene); alternativ SHA-256 in
  `shared/` selbst implementieren.

## Baustein C – Personenbezug im Archiv

- `partien.jsonl` erhält je Spieler eine `personId`, aber nur wenn der Client sie
  mitgeschickt hat (Opt-in pro Server, z. B. „Diesem Server vertrauen“).
- Damit speisen sich „Meine Partien“ und eine Auswertung aus dem vorhandenen
  Abschlussbericht (VP-Verlauf, Runden, Dauer, Sieger). Namen allein sind nicht eindeutig.
- Aufbewahrung: Die `personen`-Dateien wachsen mit den Partien; Obergrenze oder
  Aufräumen beim Serverstart vorsehen.

## Sicherheit

Geschützt: Identität über Partien und Server hinweg; der Pass verlässt das Gerät nie; ein
Nonce ist einmalig und kurzlebig; der Raum-Token steht nie im QR-Code.

Nicht geschützt und bewusst so: Wer physisch am Tisch sitzt, kann einen Platz übernehmen,
denn Anwesenheit ist die Autorisierung. Ein Gastgeber, der seinen eigenen Server
manipuliert, kann alles sehen, was dieser Server sieht — davor schützt nur, den Personenbezug
gar nicht erst zu senden.

Regeln: Nonce und Personen-ID nur per POST, nie in Query oder Log; Rate-Limit auf
`/api/pair` und `/api/person`; keine Identität über Cookies oder Browser-Fingerprint.

## Abgelöste Kontrollübergabe

Die frühere Kontrollübergabe (`rust/src/handover.rs`, `/api/handover`, Nummernvergleich,
`players[].handover`, `players[].phone`, Ereignisse `handover`/`control`/`control_end`,
Aktionen `handover_answer`/`handback`) ist entfernt. Neu ist nicht „ein Gerät übergibt die
Kontrolle“, sondern **ein Platz bekommt ein zweites Gerät**: Der Tisch bietet an, das Handy
löst ein, der Platz-Token wird übertragen. Ein Platz ohne Sitzung (Bot) bekommt dabei einen
eigenen Token und hört auf, Bot zu sein. `rust/src/arm.rs` (Zielauswahl des Tisches) bleibt
unverändert, weil es eine andere Funktion ist.

## Auswirkungen auf den Code

- `rust/src/pair.rs` (neu): Angebot, Einlösung, Aufräumen.
- `rust/src/hub.rs`: `Room { pairs: IndexMap<String, Pairing>, … }`.
- `rust/src/server.rs`: `/api/pair`, `/api/pair/claim`, `/api/pair/check`,
  `/api/person`; `/api/info` um `serverId` erweitern; `/api/handover` ist entfernt.
- `rust/src/view.rs`: Angebote und Kopplungsstatus im Tisch-Ereignis.
- `rust/src/model.rs`: optionales `person_id` je Spieler für den Abschlussbericht.
- `public/table.js`: „Platz N: Handy verbinden“, QR und Textcode anzeigen.
- `public/app.js`: Fragment `#k=` lesen, `claim`/`check`, Spielerpass im Menü.
- `public/qr.js` (neu): QR-Encoder, vendored oder selbst geschrieben.
- `DATA_DIR/server.json`: `serverId` beim ersten Start erzeugen, stabil halten.

## Umsetzung in Stufen

1. Nonce-Kopplung mit Textcode — Server und Tisch-UI, kein QR, keine Personen-ID.
2. QR-Anzeige im Client.
3. Spielerpass, `personId` per HMAC, „Meine Partien“ und Auswertung.
4. Kontrollübergabe entfernen (erledigt).

## Offene Entscheidungen

- QR-Encoder: kleine Library vendoren oder selbst schreiben (kein Build-Schritt)?
- Spielerpass nur für die Historie oder auch für laufende Partien?
- Soll Code-Rotation die alten Raum-Tokens verdrängen („alle Geräte abmelden“)?
- Wie fragt der Client „Diesem Server vertrauen“ ab, ohne beim ersten Spiel zur Hürde zu werden?
- Aufbewahrung und Obergrenze für `DATA_DIR/personen/`.
