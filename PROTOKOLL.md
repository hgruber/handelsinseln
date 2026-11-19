# Protokoll Client ⇄ Server

Server: `node server/server.js` (Port 8080, keine npm-Abhängigkeiten). Statische Dateien aus `public/`
(`/shared/geom.js` wird ebenfalls ausgeliefert). Ein einziges Spiel pro Server.

## Transport
- `GET  /api/lobby` → `{phase, players:[{name,color}], takenColors:[..], maxPlayers:6}` (ohne Anmeldung)
- `POST /api/join` `{name, color, token?}` → `{token, pid}` oder `{error}` (HTTP 400). Mit bekanntem `token`
  wird die Sitzung wieder aufgenommen (Reconnect). Token im `localStorage` speichern.
- `GET  /api/events?token=T` → Server-Sent-Events. Event `state` (JSON = View, siehe unten) bei jeder Änderung,
  sofort nach Verbindungsaufbau einmal. Event `ping` alle 20 s. `EventSource` verbindet selbst neu.
  Ist der Token unbekannt (Server neu gestartet), antwortet der Server mit HTTP 401 → Client zurück zum Anmeldebildschirm.
- `POST /api/act` `{token, type, ...params}` → `{ok:true}` oder `{error:"deutscher Text"}` (HTTP 400, als Toast zeigen).
- `POST /api/leave` `{token}` → Spieler verlässt die Lobby (im laufenden Spiel nur "getrennt").

Bei jedem Fehlerfall ändert sich der Zustand nicht. Alle Texte sind deutsch.

## Bezeichner
- Ressourcen `RES = ['holz','lehm','wolle','getreide','erz']`. Gold ist keine Karte.
- Gelände: `wald`(Holz) `huegel`(Lehm) `weide`(Wolle) `acker`(Getreide) `gebirge`(Erz) `wueste` `gold` `meer`.
- Entwicklungskarten: `ritter`, `siegpunkt`, `strassenbau`, `erfindung`, `monopol`.
- Farben: `rot`, `blau`, `orange`, `weiss`, `gruen`, `violett`. Spieler-ID `pid` = Index 0..5 in `players`.
- Schlüssel: Hex `"q,r"`, Kante `"h|h"`, Ecke `"h|h|h"` — siehe `shared/geom.js` (Pixelposition/Nachbarn: dort).
  Der Client berechnet daraus Positionen selbst (`Geom.hexCenter/vertPos/edgePos`). Axial, pointy-top.

## View (Event `state`)
```
{
 v: Zahl,                          // steigt bei jeder Änderung
 phase: 'lobby'|'setup'|'main'|'ended',
 you: pid,                         // eigene ID
 host: pid,                        // darf starten
 minPlayers: 2, maxPlayers: 6, winPoints: 14,
 players: [{ id, name, color, connected, vp /*öffentliche Punkte*/, svp /*Sonderpunkte (Inseln)*/,
             resCount, devCount, knightsPlayed, longestRoute /*Länge*/,
             hasLongest: bool, hasLargest: bool,
             left: {road, ship, settlement, city},        // noch verfügbare Figuren
             discarding?: n,  pickingGold?: n }],          // offene Pflichten
 order: [pid...],                  // Spielreihenfolge
 turn: pid,                        // wer ist dran (im Aufbau: wer platziert; in der Sonderbauphase: wer baut)
 step: 'roll'|'main'|'robber'|'steal'|'sbp'|'setup_settlement'|'setup_road'|'road_building'|'discard'|'gold'|'ended',
 dice: [a,b]|null, diceSeq: Zahl,  // diceSeq steigt bei jedem Wurf (für Animation)
 hexes: [{k:'q,r', t:Gelände, n:Zahl|null}],     // alle aufgedeckten Hexe
 fog:   ['q,r',...],               // unentdeckte Hexe am Rand (Nebel); Entdeckung beim Anlegen eines Weges/Schiffs
 harbors: [{e:Kante, kind:'any'|RES, land:'q,r', sea:'q,r'}],
 verts: { Ecke: {p:pid, k:'s'|'c'} },            // Siedlung/Stadt
 edges: { Kante: {p:pid, k:'r'|'s'} },           // Straße/Schiff
 robber: 'q,r', pirate: 'q,r'|null,
 me: { hand:{holz:n,...}, dev:[{id, type, playable:bool, fresh:bool}], hiddenVp:n },   // nur eigene Daten
 afford: { road, ship, settlement, city, dev: bool },                                 // genug Rohstoffe (und Figuren übrig)
 legal: { settlement:[Ecke], city:[Ecke], road:[Kante], ship:[Kante],
          shipFrom:[Kante], shipTo:{Kante:[Kante]},   // verschiebbare Schiffe und deren Ziele
          robber:['q,r'], pirate:['q,r'], steal:[pid] },   // nur was JETZT erlaubt ist (leer sonst)
 rates: { holz:4|3|2, ... },       // eigene Bankkurse (so viele Karten pro erhaltener Karte)
 trade: null | { id, from:pid, give:{res:n}, want:{res:n},     // Sicht des Anbieters: er gibt `give`, erhält `want`
                 responses:{ pid:{s:'accept'|'decline'|'counter', give?, want?} } },
 prompt: 'Text, was der Spieler (you) jetzt tun soll' | null,   // fertig formulierter deutscher Hinweis
 pending: { discard:{pid:n}, gold:{pid:n} },                     // wer muss noch abwerfen / Gold wählen
 log: [{id, p:pid|null, text, kind:'info'|'roll'|'build'|'trade'|'steal'|'award'|'sys'}],   // letzte 100
 chat: [{id, p, text}],
 winner: pid|null,
 bank: { dev: Zahl },              // Restkarten im Entwicklungskartenstapel
 longestHolder: pid|null, largestHolder: pid|null,
 sbp: bool                         // 5–6 Spieler: Sonderbauphase aktiv
}
```
In der Lobby (`phase:'lobby'`) sind nur `players`, `host`, `you`, `minPlayers`, `maxPlayers`, `winPoints`, `log` sinnvoll gefüllt.
`legal` ist autoritativ: der Client hebt genau diese Ecken/Kanten/Hexe als klickbar hervor.
Gold-Wahl (`step:'gold'`) und Abwerfen (`step:'discard'`) gelten für alle Betroffenen gleichzeitig: `pending` zeigt, wer noch fehlt.

## Aktionen (`type` + Parameter)
Lobby: `start` (nur Host, ≥ 2 Spieler), `new_game` (Host, nach Spielende → zurück in die Lobby).
Aufbau: `place_settlement {v}`, `place_road {e}`, `place_ship {e}`.
Zug: `roll`, `build_settlement {v}`, `build_city {v}`, `build_road {e}`, `build_ship {e}`, `move_ship {from, to}`,
`buy_dev`, `play_knight`, `play_roadbuilding`, `play_yop {a,b}`, `play_monopoly {res}`, `end_turn`.
`build_road`/`build_ship` im Schritt `road_building` sind kostenlos; `skip_roadbuilding` beendet das vorzeitig.
Handel: `bank_trade {give:res, get:res}` (Kurs = `rates[give]`), `trade_offer {give:{}, want:{}}`,
`trade_respond {accept:true}|{accept:false}|{counter:{give:{},want:{}}}`, `trade_confirm {with:pid}`
(auch auf ein Gegenangebot: dann gelten dessen give/want), `trade_cancel`.
Pflichten: `discard {cards:{res:n}}`, `gold_pick {cards:{res:n}}`, `move_robber {hex}`, `move_pirate {hex}`, `steal {target}`.
Sonderbau: `sbp_done`. Sonstiges: `chat {text}`.
