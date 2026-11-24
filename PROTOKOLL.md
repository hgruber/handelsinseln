# Protokoll Client ⇄ Server

Server: `node server/server.js` (Port 8080, keine npm-Abhängigkeiten). Statische Dateien aus `public/`
(`/shared/geom.js` wird ebenfalls ausgeliefert). Ein einziges Spiel pro Server.

## Transport
- `GET  /api/lobby` → `{phase, players:[{name,color}], takenColors:[..], maxPlayers:6}` (ohne Anmeldung)
- `POST /api/join` `{name, color, token?}` → `{token, pid}` oder `{error}` (HTTP 400). Mit bekanntem `token`
  wird die Sitzung wieder aufgenommen (Reconnect). Token im `localStorage` speichern.
- `GET  /api/events?token=T[&table=1]` → Server-Sent-Events (mit `table=1` und `settings.table`, nur Spielleiter: zusätzlich Event `table` {views:[View je Spieler]}; `act` darf dann `as:<Spieler>` mitsenden = Handeln im Namen eines Mitspielers). Event `state` (JSON = View, siehe unten) bei jeder Änderung,
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

---
# Erweiterung v2 (mehrere Spiele, Einstellungen, Statistik, Auto-Modus, Sprachchat)

## Mehrere parallele Spiele
Der Server verwaltet beliebig viele Spiele („Räume“). Ein Spieler ist genau einem Spiel zugeordnet (über seinen Token).
- `GET /api/games` → `{games:[{id, name, host:'Name', phase, closed, joinable, variant, players:[{name,color}], plannedPlayers, maxPlayers:6}]}`.
  `joinable` = Lobby-Phase, nicht voll, nicht `closed`. Der Client zeigt dem Neuankömmling alle `joinable`-Spiele zur Auswahl
  (+ Schaltfläche „Neues Spiel eröffnen“). Gibt es keins, eröffnet er automatisch ein neues. Die Farbwahl ist pro Spiel
  (belegte Farben aus `players` des gewählten Spiels ausgrauen). Alle 2–3 s neu abfragen, solange der Anmeldebildschirm offen ist.
- `POST /api/join {name, color, game?:id, create?:true, token?}` → `{token, pid, game}`.
  Ohne `game` und ohne `create`: genau ein joinbares Spiel → beitreten, keins → neues anlegen, mehrere → Fehler
  `{error, games:[…]}` (Client zeigt Auswahl). Mit `create:true` wird immer ein neues Spiel angelegt (Beitretender = Spielleiter).
  Mit `token` (Reconnect) werden die übrigen Felder ignoriert.
- **Zuschauer:** `GET /api/games` liefert zusätzlich `watchable` (Phase `setup`/`main`). `POST /api/watch {game}` → `{token, game, watch:true}` oder
  `{error}` (Lobby/beendet/unbekannt, höchstens 8 Zuschauer je Spiel). Mit dem Zuschauer-Token verbindet `GET /api/events?token=T` und liefert Ereignis
  `state` mit der **öffentlichen Sicht** (`watch:true`, `you:-1`, `host:-1`, `me:{hand:{},dev:[],hiddenVp:0}`, `chat:[]`, `legal` leer, `fx` nur öffentlich,
  `players[].seat` immer gesetzt: ohne feste Sitzordnung reihum verteilt). `POST /api/act` und `/api/signal` mit Zuschauer-Token → 403; `POST /api/leave` beendet das
  Zuschauen. Ein getrennter Zuschauer-Token verfällt nach 60 s; ein Zuschauer hält kein Spiel am Leben. Wird das Spiel gelöscht: Ereignis `closed`; kehrt es in die Lobby
  zurück, beendet der Client das Zuschauen.
- `GET /api/config` → `{stun: null|'stun:…'}` (für WebRTC; meist null → nur lokale Kandidaten).
- `POST /api/leave {token}` = Menüpunkt „Spiel verlassen“: In der Lobby wird der Spieler entfernt; im laufenden Spiel übernimmt für ihn
  der Auto-Modus (siehe unten) und sein Token wird ungültig (Client → Anmeldebildschirm). Das Spiel endet vollständig (wird gelöscht),
  sobald der letzte Mensch es verlässt oder seinen Tab schließt (≈ 20 s Kulanz für Neuladen). Das Schließen des Tabs allein macht den Spieler
  zunächst nur „getrennt“; nach 60 s Abwesenheit spielt der Auto-Modus für ihn, bei Rückkehr (gleicher Token) übernimmt er wieder.
- SSE-Event `kicked` (Daten leer): Spielleiter hat dich entfernt → Token verwerfen, Hinweis „Du wurdest vom Spielleiter entfernt“, zurück zum Anmeldebildschirm.

## Neue View-Felder (zusätzlich zu v1)
```
gameId, gameName,
closed: bool,                 // Spielleiter hat die Plätze als „fertig besetzt“ erklärt (nur Lobby)
settings: {                   // gilt in Lobby und im Spiel; änderbar durch den Spielleiter (im Spiel alles außer variant/plannedPlayers/dense)
  variant: 'klassisch'|'nebel'|'inseln',   // klassisch: Hauptinsel + Inseln + Nebel; nebel: kleine Startinsel in dichtem Nebel; inseln: jeder Spieler eigene Heimatinsel
  dense: true,                 // true (Standard): Inseln dicht beieinander, false: „Weiter“ größere Abstände (nur inseln/archipel), ändert das Brett → nur in der Lobby
  plannedPlayers: 2..6,        // Spielerzahl, für die das Brett erzeugt wird (wächst automatisch, wenn mehr beitreten)
  dice: 'manuell'|'auto',      // auto: Server würfelt am Zugbeginn selbst
  robber: 'manuell'|'auto',    // auto: Räuber/Pirat und Opfer werden zufällig/sinnvoll vom Server gewählt
  winPoints: 14,               // 3..30
  handLimit: 7|null,           // null = unbegrenzt (bei einer 7 wirft ab, wer MEHR als handLimit Karten hat; Hälfte)
  bankRate: 4,                 // 2..6 Standard-Bankkurs
  playerTrade: true,           // false: nur Handel mit der Bank
  islandBonus: 2, islandBonusMax: 2,   // Sonderpunkte je neuer Insel / für höchstens so viele Inseln pro Spieler
  longestMin: 5, armyMin: 3,
  leaver: 'uebernahme'|'verschwinden', vanishRounds: 5,   // Verhalten bei verlassenem Spiel (siehe Auto-Modus)
  limits: {
    road:15, ship:15, settlement:5, city:4,   // Zahl 1..99 oder null = unbegrenzt
    dev: 'standard'|Zahl 1..99|null,          // Entwicklungskarten: Standardstapel (25, ab 5 Spielern 34) / Stapelgröße / unbegrenzt (Ziehen mit Zurücklegen)
    bank: {holz:null, lehm:null, wolle:null, getreide:null, erz:null},   // Rohstoff-Vorrat der Bank je Sorte: Zahl 1..99 oder null=unbegrenzt
    fogTerrain: {wald:null, huegel:null, weide:null, acker:null, gebirge:null, gold:null, wueste:null, meer:null},  // Vorrat an aufdeckbaren Feldern je Sorte (null = unbegrenzt)
    fogChips: {"2":null,"3":null,…,"12":null}   // Vorrat an Wertechips je Zahl für aufgedeckte Felder (null = unbegrenzt)
  }
}
players[].auto: bool          // Auto-Modus aktiv (verlassen oder länger abwesend)
players[].gone: bool          // hat das Spiel verlassen (endgültig)   (ACHTUNG: `players[].left` bleibt der Figurenzähler {road,ship,settlement,city})
unbegrenzte Limits erscheinen als 999 in `players[].left:{road,…}` – im Client als „∞“ anzeigen
bank: { dev: Zahl (999 = unbegrenzt), stock: {holz:n,…} }   // Bank-Vorrat je Rohstoff (999 = unbegrenzt)
phase 'lobby': hexes/fog/harbors/robber/pirate enthalten die VORSCHAU des Spielfelds (gleiche Struktur wie im Spiel) → Brett darstellen.
stats: null | { durationSec, turns, aborted: bool, rolls:{"2":n,…,"12":n}, history:[{round, vp:[pid-Reihenfolge…]}],
  players:[{id,name,color,vp,svp,built:{road,ship,settlement,city,dev},produced:{holz,lehm,wolle,getreide,erz,total},
            tradesPlayer,tradesBank,stolenFrom,stolenBy,discarded,knights,maxRoute,discovered,robberMoves,sevens}] }   // nur phase 'ended'
legal.takeover: {edges:[Kante…], verts:[Ecke…]}    // übernehmbare Infrastruktur verlassener Spieler (nur wenn du am Zug im Schritt 'main' bist und noch nichts versetzt/übernommen hast)
```
`winner` ist bei vom Spielleiter beendetem Spiel `null` (`stats.aborted:true`); `view.endedBy`: `'win'|'host'|null`.
`step` in der Lobby = `'lobby'`; `prompt` wie bisher.

## Neue Aktionen (`POST /api/act`)
Nur Spielleiter, nur Lobby: `add_table_player {name,color,avatar}` (der erste Tischspieler schaltet `settings.table` ein), Plätze am Tisch werden erst beim Start abgefragt: `step:'setup_seat'` (Spielleiter zuerst, dann Anlegereihenfolge), Aktion `place_seat {seat:'bl|b|br|tl|t|tr|l|r'}` (Spieltisch: `as`), danach ergibt sich `order` im Uhrzeigersinn; `players[].seat` in der View. `settings.aspect` (Seitenverhältnis des Spielleiter-Bildschirms, 0,5–3, nur Lobby) formt die Karte; Tischspieler werden mit `kick` entfernt, mit dem letzten ist der Tisch wieder aus. `settings.table` ist nicht per `set_settings` änderbar; Bots/Beitritt sind in Tisch-Partien gesperrt. `players[].seat` / `tableGuest` stehen in der View.
Nur Spielleiter: `set_settings {settings:{…}}` (im Spiel und nach Spielende ohne Spielfeld-Einstellungen `variant`, `plannedPlayers`, `dense`; Siegpunkte nur über dem höchsten Stand) (Teilobjekt, wird tief gemischt und serverseitig geprüft → bei Fehler `{error}`),
`regen_board` (neue Vorschau mit denselben Einstellungen), `kick {pid}`, `close_seats {closed:true|false}`.
Nur Spielleiter, im laufenden Spiel: `end_game` (beendet das Spiel sofort, alle bekommen `stats`).
Im Spiel: `take_over {kind:'edge'|'vert', key}` (Infrastruktur eines Verlassenen übernehmen, braucht Nachbarschaft zur eigenen Infrastruktur, belegt den „Schiff versetzen“-Zug).
`start` verlangt ≥ 2 Spieler. Nach `phase:'ended'` bringt `new_game` (Spielleiter) alle zurück in die Lobby (Einstellungen bleiben).

## Auto-Modus (Verlassene / Abwesende)
Spieler mit `auto:true` erhalten weiter Erträge, nehmen jedes Angebot an, das genau 1 Karte gegen 1 Karte tauscht (wenn sie die verlangte Karte haben),
werfen zufällig ab, wählen Gold zufällig, versetzen den Räuber auf ein Zufallsfeld, würfeln und beenden ihren Zug selbst; ihre Infrastruktur bleibt.
Bei `leaver:'uebernahme'` kann ein Mitspieler Teile der Infrastruktur eines **Verlassenen** (`gone`) übernehmen (`legal.takeover`), bei `'verschwinden'`
wird alle Infrastruktur und Hand eines Verlassenen nach `vanishRounds` seiner Züge entfernt.

## Sprachchat (WebRTC, Mesh über den Server-Signalweg)
- `POST /api/signal {token, to:pid|'all', data:{…}}` → Server leitet an die Mitspieler desselben Spiels als SSE-Event `signal` `{from:pid, data}` weiter (≤ 16 KB, Ratenbegrenzung).
  Genutzt für `hello`/`bye`, SDP `offer`/`answer` und ICE-Kandidaten. Ablauf-Vorschlag: wer den Sprachchat betritt, sendet `{t:'hello'}` an `'all'`;
  jeder Empfänger mit aktiver Sprache antwortet mit `{t:'hello'}` an den Absender; der mit der kleineren pid sendet das Offer.
- `getUserMedia` funktioniert nur in sicherem Kontext (https oder localhost). Der Server kann mit `TLS_CERT`/`TLS_KEY` selbst https sprechen.
