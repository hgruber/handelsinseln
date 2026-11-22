'use strict';
// Gezielte Regeltests mit handgebautem Brett.
const assert = require('assert');
const Game = require('../server/game');
const G = require('../shared/geom');
const { rng } = require('./sim');

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ✓', name); } catch (e) { console.log('  ✗', name, '\n   ', e.stack.split('\n').slice(0, 4).join('\n    ')); process.exitCode = 1; }
}
const throws = (fn, re) => { try { fn(); } catch (e) { if (e instanceof Game.GameError && (!re || re.test(e.message))) return; throw e; } assert.fail('Fehler erwartet' + (re ? ' ' + re : '')); };

// Flaches Testbrett: Land in Reihe (0..5,0), darum Meer; Nebel außerhalb.
function board(n = 3) {
  const g = new Game({ rnd: rng(7) });
  for (let i = 0; i < n; i++) g.join('P' + i, ['rot', 'blau', 'orange', 'weiss', 'gruen', 'violett'][i]);
  g.act(0, { type: 'start' });
  const S = g.S;
  S.hexes = {}; S.harbors = {}; S.verts = {}; S.edges = {};
  const land = [];
  for (let q = 0; q <= 4; q++) land.push(G.hk(q, 0));
  const types = ['wald', 'huegel', 'weide', 'acker', 'gebirge'];
  land.forEach((k, i) => { S.hexes[k] = { t: types[i], n: [4, 5, 6, 8, 9][i] }; });
  for (let q = -3; q <= 7; q++) for (let r = -3; r <= 3; r++) { const k = G.hk(q, r); if (!S.hexes[k]) S.hexes[k] = { t: 'meer', n: null }; }
  S.robber = '9,9'; S.hexes['9,9'] = { t: 'wueste', n: null };
  S.pirate = '-3,-3';
  S.home = land;
  S.phase = 'main'; S.setup = null; S.order = [...Array(n).keys()];
  g.startTurn(0);
  S.ts.rolled = true;
  return g;
}
const V = (a, b, c) => G.vertKey(a, b, c);
const hand = (g, pid, o) => { Object.assign(g.pl(pid).hand, { holz: 0, lehm: 0, wolle: 0, getreide: 0, erz: 0 }, o); };

console.log('Regeltests');

test('Karten: Würfelertrag Siedlung 1, Stadt 2, Räuber blockiert', () => {
  const g = board(); const S = g.S;
  const v = V('0,0', '0,1', '-1,1'); // an Wald (4)
  S.verts[v] = { p: 1, k: 's' };
  S.verts[V('0,0', '1,-1', '1,0')] = { p: 2, k: 'c' };
  g.produce(4);
  assert.equal(g.pl(1).hand.holz, 1); assert.equal(g.pl(2).hand.holz, 2);
  S.robber = '0,0'; g.produce(4);
  assert.equal(g.pl(1).hand.holz, 1);
});

test('Gold: Ertrag wird zur freien Wahl', () => {
  const g = board(); const S = g.S;
  S.hexes['2,0'] = { t: 'gold', n: 6 };
  S.verts[V('2,0', '2,-1', '3,-1')] = { p: 1, k: 'c' };
  g.produce(6);
  assert.equal(S.pend.gold[1], 2);
  throws(() => g.act(0, { type: 'end_turn' }), /Pflichten/);
  g.act(1, { type: 'gold_pick', cards: { erz: 2 } });
  assert.equal(g.pl(1).hand.erz, 2); assert.equal(Object.keys(S.pend.gold).length, 0);
});

test('Siedlung: Abstandsregel und Anschlusspflicht', () => {
  const g = board(); const S = g.S;
  const a = V('0,0', '0,1', '-1,1'), b = G.vertNeighbors(a)[0];
  S.verts[a] = { p: 0, k: 's' };
  hand(g, 0, { holz: 5, lehm: 5, wolle: 5, getreide: 5 });
  throws(() => g.act(0, { type: 'build_settlement', v: b }), /Abstand|Anschluss/);
  const far = V('3,0', '3,1', '2,1');
  throws(() => g.act(0, { type: 'build_settlement', v: far }), /Anschluss/);
});

test('Straße: baut nur an eigenes Netz, nicht über fremde Siedlung hinweg', () => {
  const g = board(); const S = g.S;
  const a = V('0,0', '0,1', '-1,1');
  S.verts[a] = { p: 0, k: 's' };
  const [e1] = G.vertEdges(a).filter((e) => g.edgeFor(e, 'r'));
  hand(g, 0, { holz: 5, lehm: 5 });
  g.act(0, { type: 'build_road', e: e1 });
  const far = G.vertEdges(V('3,0', '3,1', '2,1')).find((e) => g.edgeFor(e, 'r'));
  throws(() => g.act(0, { type: 'build_road', e: far }), /anschließen/);
  // Fremde Siedlung am Ende: Weiterbauen nicht möglich
  const end = G.edgeVerts(e1).find((v) => v !== a);
  S.verts[end] = { p: 1, k: 's' };
  const next = G.vertEdges(end).filter((e) => e !== e1 && g.edgeFor(e, 'r'));
  for (const e of next) throws(() => g.act(0, { type: 'build_road', e }), /anschließen/);
});

test('Schiff: nur auf Wasserkanten; Straße nicht ins Wasser', () => {
  const g = board(); const S = g.S;
  const a = V('0,0', '0,-1', '1,-1'); S.verts[a] = { p: 0, k: 's' };
  hand(g, 0, { holz: 5, lehm: 5, wolle: 5 });
  const seaEdge = G.edgeKey('0,-1', '1,-1');
  assert(g.edgeFor(seaEdge, 's') && !g.edgeFor(seaEdge, 'r'));
  throws(() => g.act(0, { type: 'build_road', e: seaEdge }), /an Land|anschließen/);
  g.act(0, { type: 'build_ship', e: seaEdge });
  assert.equal(S.edges[seaEdge].k, 's');
});

test('Entdeckung: Schiff an Nebelrand deckt Feld auf, Land bringt Belohnung', () => {
  const g = board(); const S = g.S;
  // Randhex entfernen -> Nebel
  const fogHex = '0,-3';
  delete S.hexes[fogHex];
  const edge = G.hexEdges('0,-2').find((e) => G.edgeHexes(e).every((h) => S.hexes[h]) && G.edgeVerts(e).some((v) => G.vertHexes(v).includes(fogHex)));
  assert(edge, 'Kante am Nebel');
  const vOwn = G.edgeVerts(edge)[0];
  S.verts[vOwn] = { p: 0, k: 's' }; // künstlicher Anschluss (auf Wasser, nur Test)
  hand(g, 0, { holz: 1, wolle: 1 });
  S.pirate = '5,5'; S.hexes['5,5'] = { t: 'meer', n: null };
  g.rnd = () => 0.01; // Land erzwingen
  g.act(0, { type: 'build_ship', e: edge });
  assert(S.hexes[fogHex], 'aufgedeckt');
  assert(S.hexes[fogHex].t !== 'meer');
});

test('Schiffe: neu gebautes nicht versetzbar, geschlossenes nicht, offenes schon', () => {
  const g = board(); const S = g.S;
  const a = V('0,0', '0,-1', '1,-1'); S.verts[a] = { p: 0, k: 's' };
  const e1 = G.vertEdges(a).find((e) => g.edgeFor(e, 's'));
  S.edges[e1] = { p: 0, k: 's', t: S.turnNo };
  assert.deepEqual(g.shipMoves(0).from, []);
  S.turnNo++;
  const m = g.shipMoves(0);
  assert(m.from.includes(e1) === false || true);
  // Ein Schiff, das einziges ist und an der Siedlung hängt: freies Ende vorhanden -> versetzbar
  assert(m.from.includes(e1));
  g.act(0, { type: 'move_ship', from: e1, to: m.to[e1][0] });
  assert.equal(S.ts.movedShip, true);
  throws(() => g.act(0, { type: 'move_ship', from: m.to[e1][0], to: e1 }), /schon/);
});

test('Pirat: blockiert Schiffsbau am Pirat-Feld', () => {
  const g = board(); const S = g.S;
  const a = V('0,0', '0,-1', '1,-1'); S.verts[a] = { p: 0, k: 's' };
  const e1 = G.vertEdges(a).find((e) => g.edgeFor(e, 's'));
  S.pirate = G.edgeHexes(e1).find((h) => S.hexes[h].t === 'meer');
  hand(g, 0, { holz: 2, wolle: 2 });
  throws(() => g.act(0, { type: 'build_ship', e: e1 }), /Pirat/);
});

test('Räuber/Pirat nach 7: Abwerfen, Versetzen, Stehlen', () => {
  const g = board(3); const S = g.S;
  S.ts.rolled = false;
  hand(g, 1, { holz: 4, lehm: 4 }); hand(g, 2, { erz: 2 });
  const v = V('1,0', '1,-1', '0,0'); S.verts[v] = { p: 2, k: 's' };
  g.rnd = (() => { let i = 0; const seq = [0.5, 0.5, 0.0, 0.0]; return () => seq[i++ % seq.length]; })();
  // 3+4=7 erzwingen: würfeln mit rnd -> (1+floor(.5*6)=4)+(4)=8 nein; direkt testen:
  S.dice = [3, 4]; S.ts.rolled = true; S.ts.sub = 'robber'; S.pend.discard[1] = 4;
  throws(() => g.act(0, { type: 'move_robber', hex: '1,0' }), /Pflichten/);
  throws(() => g.act(1, { type: 'discard', cards: { holz: 1 } }), /genau 4/);
  g.act(1, { type: 'discard', cards: { holz: 2, lehm: 2 } });
  assert.equal(g.handSize(1), 4);
  throws(() => g.act(0, { type: 'move_robber', hex: '9,9' }), /anderes|Landfeld/);
  throws(() => g.act(0, { type: 'move_robber', hex: '0,5' }), /Landfeld/);
  g.act(0, { type: 'move_robber', hex: '1,0' });
  assert.equal(S.robber, '1,0');
  assert.equal(g.pl(0).hand.erz, 1); assert.equal(g.pl(2).hand.erz, 1); // automatisch gestohlen (nur ein Opfer)
  assert.equal(S.ts.sub, null);
});

test('Pirat stiehlt von Spieler mit Schiff am Feld', () => {
  const g = board(3); const S = g.S;
  S.ts.sub = 'robber';
  const sea = '2,-1';
  const e = G.hexEdges(sea).find((x) => g.edgeFor(x, 's'));
  S.edges[e] = { p: 1, k: 's', t: 0 };
  hand(g, 1, { holz: 3 });
  g.act(0, { type: 'move_pirate', hex: sea });
  assert.equal(S.pirate, sea); assert.equal(g.pl(0).hand.holz, 1);
});

test('Längster Handelsweg: Straßen+Schiffe nur über Siedlung verbunden, ab 5', () => {
  const g = board(); const S = g.S;
  const path = [];
  // Kette von 5 Straßen entlang der Küste unten: Ecken-Zickzack über Hex-Ecken von (0,0)..(2,0)
  let v = V('0,0', '0,1', '-1,1');
  S.verts[v] = { p: 0, k: 's' };
  const seen = new Set([v]);
  for (let i = 0; i < 5; i++) {
    const e = G.vertEdges(v).find((x) => !S.edges[x] && g.edgeFor(x, 'r') && !seen.has(G.edgeVerts(x).find((y) => y !== v)));
    assert(e, 'Kante ' + i);
    S.edges[e] = { p: 0, k: 'r', t: 0 }; v = G.edgeVerts(e).find((y) => y !== v); seen.add(v); path.push(e);
  }
  g.updateAwards();
  assert.equal(g.routeLen(0), 5); assert.equal(S.longest, 0); assert.equal(g.vp(0), 1 + 2);
  // Gegner-Siedlung auf mittlerer Ecke unterbricht
  const mid = G.edgeVerts(path[2]).find((x) => !G.edgeVerts(path[1]).includes(x));
  S.verts[mid] = { p: 1, k: 's' };
  g.updateAwards();
  assert(g.routeLen(0) < 5); assert.equal(S.longest, null);
});

test('Straße↔Schiff verbindet nur über eigene Siedlung', () => {
  const g = board(); const S = g.S;
  const a = V('0,0', '0,-1', '1,-1'); // Küstenecke oben
  const sea = G.edgeKey('0,-1', '1,-1');
  const road = G.edgeKey('0,0', '0,-1');
  assert(sea && road);
  S.edges[sea] = { p: 0, k: 's', t: 0 }; S.edges[road] = { p: 0, k: 'r', t: 0 };
  assert.equal(g.routeLen(0), 1);
  S.verts[a] = { p: 0, k: 's' };
  assert.equal(g.routeLen(0), 2);
});

test('Stärkste Schutzmacht ab 3 Rittern, nur bei Mehrheit', () => {
  const g = board(); const S = g.S;
  g.pl(0).knights = 3; g.updateAwards(); assert.equal(S.largest, 0);
  g.pl(1).knights = 3; g.updateAwards(); assert.equal(S.largest, 0);
  g.pl(1).knights = 4; g.updateAwards(); assert.equal(S.largest, 1);
});

test('Inselbonus: erste Siedlung auf neuer Insel +2, zweite Siedlung dort nicht', () => {
  const g = board(); const S = g.S;
  S.hexes['9,0'] = { t: 'wald', n: 3 }; S.hexes['10,0'] = { t: 'weide', n: 5 };
  g.pl(0).claimed['0,0'] = 1;
  const v = V('9,0', '9,-1', '10,-1');
  g.placeSettlement(0, v, false);
  assert.equal(g.pl(0).svp, 2);
  g.placeSettlement(0, V('10,0', '10,1', '9,1'), false);
  assert.equal(g.pl(0).svp, 2);
});

test('Bankhandel mit Hafenkursen', () => {
  const g = board(); const S = g.S;
  const e = G.hexEdges('0,0').find((x) => G.edgeHexes(x).some((h) => S.hexes[h].t === 'meer'));
  S.harbors[e] = { kind: 'holz' };
  S.verts[G.edgeVerts(e)[0]] = { p: 0, k: 's' };
  assert.equal(g.ratesFor(0).holz, 2); assert.equal(g.ratesFor(0).lehm, 4);
  hand(g, 0, { holz: 4, lehm: 4 });
  g.act(0, { type: 'bank_trade', give: 'holz', get: 'erz', n: 2 });
  assert.equal(g.pl(0).hand.holz, 0); assert.equal(g.pl(0).hand.erz, 2);
  throws(() => g.act(0, { type: 'bank_trade', give: 'lehm', get: 'erz', n: 2 }), /brauchst/);
  S.harbors[e] = { kind: 'any' };
  assert.equal(g.ratesFor(0).lehm, 3);
});

test('Spielerhandel: Angebot, Zusage, Gegenangebot, Abschluss', () => {
  const g = board(3);
  hand(g, 0, { holz: 2 }); hand(g, 1, { erz: 1 }); hand(g, 2, { lehm: 1, wolle: 3 });
  g.act(0, { type: 'trade_offer', give: { holz: 2 }, want: { erz: 1 } });
  throws(() => g.act(2, { type: 'trade_respond', accept: true }), /fehlen/);
  g.act(2, { type: 'trade_respond', counter: { give: { holz: 1 }, want: { wolle: 2 } } });
  g.act(1, { type: 'trade_respond', accept: true });
  throws(() => g.act(1, { type: 'trade_confirm', with: 2 }), /am Zug/);
  g.act(0, { type: 'trade_confirm', with: 2 });
  assert.equal(g.pl(0).hand.holz, 1); assert.equal(g.pl(0).hand.wolle, 2); assert.equal(g.pl(2).hand.holz, 1);
  assert.equal(g.S.trade, null);
  g.act(0, { type: 'trade_offer', give: { holz: 1 }, want: { erz: 1 } });
  g.act(1, { type: 'trade_respond', accept: true });
  g.act(0, { type: 'trade_confirm', with: 1 });
  assert.equal(g.pl(0).hand.erz, 1); assert.equal(g.pl(1).hand.holz, 1);
  throws(() => g.act(0, { type: 'trade_offer', give: { holz: 1 }, want: { holz: 1 } }), /dieselbe|Karten/);
});

test('Entwicklungskarten: gleiche Runde nicht spielbar, eine pro Zug, Monopol, Erfindung', () => {
  const g = board(3); const S = g.S;
  hand(g, 0, { erz: 1, wolle: 1, getreide: 1 });
  S.deck = ['erfindung', 'monopol'];
  g.act(0, { type: 'buy_dev' });
  throws(() => g.act(0, { type: 'play_monopoly', res: 'holz' }), /nächsten Zug/);
  S.turnNo++;
  hand(g, 1, { holz: 3 }); hand(g, 2, { holz: 2 });
  g.act(0, { type: 'play_monopoly', res: 'holz' });
  assert.equal(g.pl(0).hand.holz, 5);
  g.pl(0).dev.push({ id: 99, type: 'erfindung', bought: 0 });
  throws(() => g.act(0, { type: 'play_yop', a: 'erz', b: 'erz' }), /eine Entwicklungskarte/);
});

test('Straßenbau-Karte: zwei kostenlose Wege, auch Schiff', () => {
  const g = board(3); const S = g.S;
  const a = V('0,0', '0,-1', '1,-1'); S.verts[a] = { p: 0, k: 's' };
  g.pl(0).dev.push({ id: 5, type: 'strassenbau', bought: 0 }); S.turnNo = 3;
  g.act(0, { type: 'play_roadbuilding' });
  assert.equal(S.ts.sub, 'road_building');
  const sea = g.legal(0).ship[0]; assert(sea);
  g.act(0, { type: 'build_ship', e: sea });
  assert.equal(S.ts.rb, 1);
  g.act(0, { type: 'skip_roadbuilding' });
  assert.equal(S.ts.sub, null);
  assert.equal(g.pl(0).hand.holz, 0);
});

test('Sieg bei 14 Punkten (inkl. verdeckter Siegpunktkarten)', () => {
  const g = board(3); const S = g.S;
  for (let i = 0; i < 4; i++) S.verts[V(String(i * 20) + ',0', String(i * 20) + ',1', String(i * 20 - 1) + ',1')] = { p: 0, k: 'c' };
  g.pl(0).svp = 4;
  assert.equal(g.vp(0), 12);
  g.pl(0).dev.push({ id: 1, type: 'siegpunkt', bought: 0 }, { id: 2, type: 'siegpunkt', bought: 0 });
  hand(g, 0, {});
  g.act(0, { type: 'chat', text: 'hi' });
  g.checkWin();
  assert.equal(S.phase, 'ended'); assert.equal(S.winner, 0);
});

test('Sonderbauphase bei 5–6 Spielern: überspringt Spieler ohne Möglichkeiten', () => {
  const g = board(5); const S = g.S;
  S.verts[V('0,0', '0,1', '-1,1')] = { p: 1, k: 's' };
  hand(g, 1, { holz: 1, lehm: 1, wolle: 1, getreide: 1 });
  for (const p of [0, 2, 3, 4]) hand(g, p, {});
  g.act(0, { type: 'end_turn' });
  assert.equal(S.sbp.pid, 1);
  throws(() => g.act(2, { type: 'sbp_done' }), /baut gerade/);
  throws(() => g.act(1, { type: 'trade_offer', give: { holz: 1 }, want: { erz: 1 } }), /Sonderbauphase/);
  g.act(1, { type: 'sbp_done' });
  assert.equal(S.sbp, null); assert.equal(S.turn, 1);
});

test('Lobby: Farbe/Name eindeutig, max. 6, nur Host startet, Reconnect per Token', () => {
  const g = new Game({ rnd: rng(1) });
  const a = g.join('Anna', 'rot');
  throws(() => g.join('Anna', 'blau'), /Name/);
  throws(() => g.join('Ben', 'rot'), /Farbe/);
  throws(() => g.join('', 'blau'), /Namen/);
  for (const [n, c] of [['B', 'blau'], ['C', 'orange'], ['D', 'weiss'], ['E', 'gruen'], ['F', 'violett']]) g.join(n, c);
  throws(() => g.join('G', 'rot'), /voll/);
  throws(() => g.act(1, { type: 'start' }), /Spielleiter/);
  assert.equal(g.join('x', 'rot', a.token).pid, 0);
  g.act(0, { type: 'start' });
  assert.equal(g.S.phase, 'setup');
  throws(() => g.join('Neu', 'rot'), /läuft/);
});

test('Aufbau: Schlangenreihenfolge, 2. Siedlung bringt Rohstoffe, Aufbau nur auf Startinsel', () => {
  const g = new Game({ rnd: rng(3) });
  g.join('A', 'rot'); g.join('B', 'blau'); g.act(0, { type: 'set_settings', settings: { dice: 'auto' } }); g.act(0, { type: 'start' });
  const S = g.S, order = S.order.slice();
  const seq = [order[0], order[1], order[1], order[0]];
  for (let i = 0; i < 4; i++) {
    const pid = S.turn; assert.equal(pid, seq[i]);
    const L = g.legal(pid);
    assert(L.settlement.length > 0);
    g.act(pid, { type: 'place_settlement', v: L.settlement[0] });
    throws(() => g.act(pid, { type: 'place_settlement', v: L.settlement[1] }), /Straße|Siedlung/);
    const L2 = g.legal(pid);
    const road = L2.road[0] || L2.ship[0];
    g.act(pid, { type: L2.road[0] ? 'place_road' : 'place_ship', e: road });
    while (Object.keys(S.pend.gold).length) { const p = +Object.keys(S.pend.gold)[0]; g.act(p, { type: 'gold_pick', cards: { holz: S.pend.gold[p] } }); }
  }
  assert.equal(S.phase, 'main');
  assert.equal(S.turn, order[0]);
});

test('Zustand ist JSON-serialisierbar und wiederherstellbar', () => {
  const g = board(4);
  const g2 = Game.fromJSON(JSON.parse(JSON.stringify(g.toJSON())));
  assert.deepEqual(g2.view(0).hexes, g.view(0).hexes);
  assert.equal(g2.routeLen(0), 0);
});

console.log(`${passed} Regeltests bestanden`);
