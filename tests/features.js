'use strict';
// Tests der v2-Funktionen: Einstellungen, Varianten, Vorräte, Auto-Würfeln/-Räuber, Auto-Modus, Übernahme, Statistik, Spieleverwaltung.
const assert = require('assert');
const Game = require('../server/game');
const { Hub } = require('../server/hub');
const ST = require('../server/settings');
const B = require('../server/board');
const G = require('../shared/geom');
const { rng } = require('./sim');
const { botAct } = require('../server/bot');

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ✓', name); } catch (e) { console.log('  ✗', name, '\n   ', e.stack.split('\n').filter((l) => /features.js|AssertionError|Error:/.test(l)).slice(0, 4).join('\n    ')); process.exitCode = 1; }
}
const throws = (fn, re) => { try { fn(); } catch (e) { if ((e instanceof Game.GameError || e instanceof ST.SettingsError) && (!re || re.test(e.message))) return; throw e; } assert.fail('Fehler erwartet' + (re ? ' ' + re : '')); };
const COL = ['rot', 'blau', 'orange', 'weiss', 'gruen', 'violett'];
function lobby(n, seed = 5) {
  const g = new Game({ rnd: rng(seed) });
  for (let i = 0; i < n; i++) g.join('P' + i, COL[i]);
  return g;
}
// Ruhiges Handbrett wie in rules.js
function mainBoard(n = 3, settings) {
  const g = lobby(n);
  if (settings) g.act(0, { type: 'set_settings', settings });
  g.act(0, { type: 'start' });
  const S = g.S;
  S.hexes = {}; S.harbors = {}; S.verts = {}; S.edges = {};
  const types = ['wald', 'huegel', 'weide', 'acker', 'gebirge'];
  for (let q = 0; q <= 4; q++) S.hexes[G.hk(q, 0)] = { t: types[q], n: [4, 5, 6, 8, 9][q] };
  for (let q = -3; q <= 7; q++) for (let r = -3; r <= 3; r++) { const k = G.hk(q, r); if (!S.hexes[k]) S.hexes[k] = { t: 'meer', n: null }; }
  S.robber = '9,9'; S.hexes['9,9'] = { t: 'wueste', n: null }; S.pirate = '-3,-3'; S.home = Object.keys(S.hexes).filter((k) => S.hexes[k].t !== 'meer');
  S.phase = 'main'; S.setup = null; S.order = [...Array(n).keys()];
  g.startTurn(0); S.ts.rolled = true;
  return g;
}
const V = (a, b, c) => G.vertKey(a, b, c);
const hand = (g, pid, o) => { Object.assign(g.pl(pid).hand, { holz: 0, lehm: 0, wolle: 0, getreide: 0, erz: 0 }, o); };

console.log('Funktionstests v2');

test('Einstellungen: Standardwerte = bisheriges Verhalten, Prüfung und Zugriffsschutz', () => {
  const g = lobby(2);
  const s = g.S.settings;
  assert.equal(s.winPoints, 14); assert.equal(s.handLimit, 7); assert.equal(s.bankRate, 4); assert.equal(s.limits.road, 15); assert.equal(s.limits.city, 4);
  assert.equal(s.limits.dev, 'standard'); assert.equal(s.dice, 'manuell'); assert.equal(s.limits.bank.holz, null);
  throws(() => g.act(1, { type: 'set_settings', settings: { winPoints: 10 } }), /Spielleiter/);
  throws(() => g.act(0, { type: 'set_settings', settings: { winPoints: 99 } }), /Siegpunkte/);
  throws(() => g.act(0, { type: 'set_settings', settings: { limits: { bank: { gold: 3 } } } }), /unbekannt/);
  throws(() => g.act(0, { type: 'set_settings', settings: { foo: 1 } }), /Unbekannte/);
  assert.equal(g.S.settings.winPoints, 14, 'Fehler ändert nichts');
  g.act(0, { type: 'set_settings', settings: { winPoints: 10, limits: { road: null, bank: { holz: 3 } }, handLimit: null } });
  assert.equal(g.S.settings.winPoints, 10); assert.equal(g.S.settings.limits.road, null); assert.equal(g.S.settings.limits.bank.holz, 3);
  assert.equal(g.S.settings.limits.ship, 15, 'andere Limits bleiben');
  // „Standard wiederherstellen“ im Client sendet alle Chip-Zahlen inkl. 7 – die 7 wird ignoriert statt abgelehnt
  const reset = { limits: { road: 15, ship: 15, settlement: 5, city: 4, dev: 'standard', bank: { holz: null }, fogTerrain: { wald: null }, fogChips: Object.fromEntries(Array.from({ length: 11 }, (_, i) => [String(i + 2), null])) } };
  g.act(0, { type: 'set_settings', settings: reset });
  assert.equal('7' in g.S.settings.limits.fogChips, false);
  g.act(0, { type: 'start' });
  throws(() => g.act(0, { type: 'set_settings', settings: { variant: 'nebel' } }), /Spielfeld/);
});

test('Lobby: Vorschau-Brett vorhanden, neu würfeln, Varianten und Spielerzahl wirken aufs Brett', () => {
  const g = lobby(3);
  const v = g.view(1);
  assert(v.hexes.length > 30 && v.harbors.length >= 4 && v.robber && v.pirate, 'Vorschau fehlt');
  const k1 = JSON.stringify(v.hexes);
  g.act(0, { type: 'regen_board' });
  assert.notEqual(JSON.stringify(g.view(0).hexes), k1, 'neues Brett');
  throws(() => g.act(1, { type: 'regen_board' }), /Spielleiter/);
  for (const variant of ['klassisch', 'nebel', 'inseln', 'archipel']) {
    g.act(0, { type: 'set_settings', settings: { variant } });
    const h = g.view(0).hexes;
    const land = h.filter((x) => x.t !== 'meer');
    assert(land.length >= 8, variant + ' zu wenig Land');
    assert(h.some((x) => x.t === 'wueste'), variant + ' ohne Wüste (Räuber)');
    assert(g.S.hexes[g.S.robber].t === 'wueste');
  }
  g.act(0, { type: 'set_settings', settings: { variant: 'nebel' } });
  const nebelLand = Object.values(g.S.hexes).filter((x) => x.t !== 'meer').length;
  g.act(0, { type: 'set_settings', settings: { variant: 'klassisch' } });
  assert(Object.values(g.S.hexes).filter((x) => x.t !== 'meer').length > nebelLand, 'klassisch hat mehr Land als Nebelinseln');
  // Inseln: je Spieler eine Heimatinsel; Aufbau nur dort
  g.act(0, { type: 'set_settings', settings: { variant: 'inseln', plannedPlayers: 4 } });
  const homeIslands = new Set();
  g.S.home.forEach((h) => homeIslands.add([...B.island(g.S, h)].sort()[0]));
  assert.equal(homeIslands.size, 4, 'vier Heimatinseln');
  g.join('P3', COL[3]);
  g.join('P4', COL[4]);
  assert.equal(g.S.settings.plannedPlayers, 5, 'Brett wächst mit der Spielerzahl');
  const homeIslands5 = new Set(); g.S.home.forEach((h) => homeIslands5.add([...B.island(g.S, h)].sort()[0]));
  assert.equal(homeIslands5.size, 5);
});

test('Varianten: Brett ist über viele Seeds gültig (Abstände, Insel-Lücken, Zahlen, Häfen)', () => {
  for (const variant of ['klassisch', 'nebel', 'inseln', 'archipel']) for (let n = 2; n <= 6; n++) for (let seed = 1; seed <= 6; seed++) {
    const g = new Game({ rnd: rng(seed * 31 + n) });
    for (let i = 0; i < n; i++) g.join('P' + i, COL[i]);
    g.act(0, { type: 'set_settings', settings: { variant } });
    const S = g.S;
    for (const k in S.hexes) { const h = S.hexes[k]; if (h.t !== 'meer' && h.t !== 'wueste') assert(h.n >= 2 && h.n <= 12 && h.n !== 7, 'Zahl'); }
    // verschiedene Inseln haben mind. ein Meerfeld Abstand
    const land = Object.keys(S.hexes).filter((k) => S.hexes[k].t !== 'meer');
    const comp = new Map();
    land.forEach((k) => { const c = [...B.island(S, k)].sort()[0]; comp.set(k, c); });
    for (const a of land) for (const b of G.neighbors(a)) if (comp.has(b)) assert.equal(comp.get(a), comp.get(b), 'Inseln berühren sich');
    assert(S.home.length >= 5, 'Heimatland');
    for (const e in S.harbors) { const [a, b] = G.edgeHexes(e); assert(S.hexes[a] && S.hexes[b] && (S.hexes[a].t === 'meer') !== (S.hexes[b].t === 'meer'), 'Hafen an Küste'); }
    // Nebel beginnt außerhalb: Randhexe ohne bekannte Nachbarn gibt es nicht im Brett
    assert(B.fog(S).length > 0);
  }
});

test('Vorräte: Figurenlimits (Zahl, unbegrenzt) in der Sicht und beim Bauen', () => {
  const g = mainBoard(3, { limits: { road: 2, settlement: null } });
  const a = V('0,0', '0,-1', '1,-1'); g.S.verts[a] = { p: 0, k: 's' };
  hand(g, 0, { holz: 9, lehm: 9, wolle: 9, getreide: 9 });
  assert.equal(g.view(0).players[0].left.road, 2); assert.equal(g.view(0).players[0].left.settlement, 999);
  const r1 = G.vertEdges(a).find((e) => g.edgeFor(e, 'r'));
  g.act(0, { type: 'build_road', e: r1 });
  const next = G.edgeVerts(r1).find((v) => v !== a);
  g.act(0, { type: 'build_road', e: G.vertEdges(next).find((e) => !g.S.edges[e] && g.edgeFor(e, 'r')) });
  throws(() => g.act(0, { type: 'build_road', e: g.pathSpots(0, 'r')[0] }), /keine Straßen mehr/);
});

test('Vorräte: Bank-Vorrat begrenzt Erträge, Tausch, Erfindung, Gold', () => {
  const g = mainBoard(3, { limits: { bank: { holz: 3 } } });
  const S = g.S;
  // zwei Empfänger, Vorrat 3 < 4 geschuldet → niemand
  S.verts[V('0,0', '0,1', '-1,1')] = { p: 1, k: 'c' };
  S.verts[V('0,0', '1,-1', '1,0')] = { p: 2, k: 'c' };
  g.produce(4);
  assert.equal(g.pl(1).hand.holz + g.pl(2).hand.holz, 0, 'niemand bekommt Holz bei Knappheit');
  // ein Empfänger bekommt den Rest
  delete S.verts[V('0,0', '1,-1', '1,0')];
  hand(g, 1, {}); g.produce(4);
  assert.equal(g.pl(1).hand.holz, 2);
  hand(g, 1, { holz: 1 }); // 1 im Umlauf (+ Spieler 0 unten) → Vorrat 2
  hand(g, 0, { erz: 4 });
  g.act(0, { type: 'bank_trade', give: 'erz', get: 'holz' });
  assert.equal(g.stock('holz'), 1);
  hand(g, 0, { erz: 12 });
  throws(() => g.act(0, { type: 'bank_trade', give: 'erz', get: 'holz', n: 3 }), /nur noch/);
  hand(g, 1, { holz: 2 }); g.pl(0).dev.push({ id: 1, type: 'erfindung', bought: 0 }); g.S.turnNo = 5;
  throws(() => g.act(0, { type: 'play_yop', a: 'holz', b: 'holz' }), /nicht genug/);
  assert(g.pl(0).dev.length === 1, 'Karte bleibt erhalten');
  hand(g, 1, {}); g.act(0, { type: 'play_yop', a: 'holz', b: 'lehm' });
  // Gold bei erschöpfter Bank
  hand(g, 2, { holz: 3 }); g.pl(0).hand.holz = 0; g.S.pend.gold[1] = 1; hand(g, 1, {});
  throws(() => g.act(1, { type: 'gold_pick', cards: { holz: 1 } }), /nur noch|genau|keine/);
  g.act(1, { type: 'gold_pick', cards: { erz: 1 } });
});

test('Vorräte: Entwicklungskarten Standard / Zahl / unbegrenzt', () => {
  let g = lobby(3); g.act(0, { type: 'start' });
  assert.equal(g.S.deck.length, 25);
  g = lobby(5); g.act(0, { type: 'start' }); assert.equal(g.S.deck.length, 34);
  g = lobby(3); g.act(0, { type: 'set_settings', settings: { limits: { dev: 7 } } }); g.act(0, { type: 'start' });
  assert.equal(g.S.deck.length, 7);
  g = lobby(3); g.act(0, { type: 'set_settings', settings: { limits: { dev: null } } }); g.act(0, { type: 'start' });
  assert.equal(g.devLeft(), 999);
  const g2 = mainBoard(3, { limits: { dev: null } });
  hand(g2, 0, { erz: 50, wolle: 50, getreide: 50 });
  g2.S.deckUnlimited = true;
  for (let i = 0; i < 40; i++) g2.act(0, { type: 'buy_dev' });
  assert.equal(g2.pl(0).dev.length, 40);
  const g3 = mainBoard(3, { limits: { dev: 2 } });
  hand(g3, 0, { erz: 5, wolle: 5, getreide: 5 });
  g3.act(0, { type: 'buy_dev' }); g3.act(0, { type: 'buy_dev' });
  throws(() => g3.act(0, { type: 'buy_dev' }), /leer/);
});

test('Vorräte: Nebel-Felder und Wertechips begrenzt, danach nur noch Meer', () => {
  const S = { hexes: { '0,0': { t: 'wald', n: 5 } }, harbors: {}, harborKinds: [], supply: { terrain: { wald: 2, meer: 0, huegel: 0, weide: 0, acker: 0, gebirge: 0, gold: 0, wueste: 0 }, chips: { 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 8: 0, 9: 0, 10: 0, 11: 3, 12: 0 } }, fogGold: 1 };
  const rnd = rng(9);
  const out = [];
  for (let i = 1; i <= 8; i++) out.push(B.discover(S, G.hk(i, 0), rnd));
  const forests = out.filter((h) => h.t === 'wald');
  assert.equal(forests.length, 2, 'höchstens 2 Wälder');
  assert(forests.every((h) => h.n === 11), 'nur Chip 11 verfügbar');
  assert(out.filter((h) => h.t !== 'wald').every((h) => h.t === 'meer'), 'Rest Meer');
  // Chips alle: kein Landfeld mehr möglich
  const S2 = { hexes: { '0,0': { t: 'wald', n: 5 } }, harbors: {}, harborKinds: [], supply: { terrain: { wald: null, huegel: null, weide: null, acker: null, gebirge: null, gold: null, wueste: 0, meer: null }, chips: { 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 8: 0, 9: 0, 10: 0, 11: 1, 12: 0 } }, fogGold: 1 };
  const lands = []; for (let i = 1; i <= 30; i++) lands.push(B.discover(S2, G.hk(i, 0), rng(i)));
  assert.equal(lands.filter((h) => h.t !== 'meer').length, 1, 'genau ein Chip → genau ein Landfeld');
});

test('Siegpunkte, Handlimit, Bankkurs, Minima, Spielerhandel aus Einstellungen', () => {
  const g = mainBoard(3, { winPoints: 5, handLimit: 3, bankRate: 2, armyMin: 2, longestMin: 3, playerTrade: false });
  hand(g, 1, { holz: 4 });
  g.S.ts.rolled = false; g.rnd = (() => { const seq = [0.5, 0.2]; let i = 0; return () => seq[i++ % 2]; })(); // 4 + 2 = 6? -> erzwinge 7 direkt
  g.S.dice = [3, 4];
  // direkt eine 7 simulieren
  g.S.ts.rolled = true; g.S.ts.sub = 'robber';
  const sz = g.handSize(1);
  assert.equal(g.ratesFor(0).holz, 2);
  throws(() => g.act(0, { type: 'trade_offer', give: { holz: 1 }, want: { erz: 1 } }), /Robber|Räuber|nur der Handel|Zuerst/);
  g.S.ts.sub = null;
  hand(g, 0, { holz: 1 });
  throws(() => g.act(0, { type: 'trade_offer', give: { holz: 1 }, want: { erz: 1 } }), /nur der Handel mit der Bank/);
  g.pl(0).knights = 2; g.updateAwards(); assert.equal(g.S.largest, 0);
  for (let i = 0; i < 3; i++) g.S.verts[V(String(i * 20) + ',0', String(i * 20) + ',1', String(i * 20 - 1) + ',1')] = { p: 0, k: 'c' };
  g.checkWin();
  assert.equal(g.S.phase, 'ended'); assert.equal(g.S.winner, 0);
  // Handlimit: Würfeln mit 7 und handLimit 3
  const g2 = mainBoard(3, { handLimit: 3 });
  g2.S.ts.rolled = false; hand(g2, 1, { holz: 4 }); hand(g2, 2, { holz: 3 });
  g2.rnd = () => 0.5; // 4+4=8 – darum 7 direkt über roll-Pfad erzwingen:
  g2.rnd = (() => { const seq = [0.5 /*4*/, 0.34 /*3*/]; let i = 0; return () => seq[i++ % 2]; })();
  g2.act(0, { type: 'roll' });
  assert.equal(g2.S.dice[0] + g2.S.dice[1], 7);
  assert.equal(g2.S.pend.discard[1], 2); assert.equal(g2.S.pend.discard[2], undefined, '3 Karten sind nicht mehr als das Limit');
  const g3 = mainBoard(3, { handLimit: null });
  g3.S.ts.rolled = false; hand(g3, 1, { holz: 20 });
  g3.rnd = (() => { const seq = [0.5, 0.34]; let i = 0; return () => seq[i++ % 2]; })();
  g3.act(0, { type: 'roll' });
  assert.deepEqual(g3.S.pend.discard, {}, 'unbegrenzt: niemand wirft ab');
});

test('Manueller Ablauf: Reihenfolge wird ausgewürfelt (Gleichstand würfelt neu), Auto: sofort; Reihenfolge wird allen angezeigt', () => {
  const g = lobby(3, 21);
  g.act(0, { type: 'start' });
  assert.equal(g.S.setup.stage, 'order'); assert.equal(g.view(0).step, 'setup_order');
  throws(() => g.act(g.S.turn, { type: 'place_settlement', v: '0' }), /ausgewürfelt/);
  let guard = 0;
  while (g.S.setup.stage === 'order' && guard++ < 60) g.act(g.S.turn, { type: 'roll' });
  assert.equal(g.S.setup.stage, 'settlement'); assert.equal([...g.S.order].sort().join(), '0,1,2');
  assert.deepEqual(g.view(1).orderShown.order, g.S.order); assert.equal(g.S.turn, g.S.order[0]);
  const a = lobby(2, 22); a.act(0, { type: 'set_settings', settings: { dice: 'auto' } }); a.act(0, { type: 'start' });
  assert.equal(a.S.setup.stage, 'settlement'); assert(a.view(0).orderShown, 'Auto zeigt die Reihenfolge ebenfalls');
});

test('Spiel ändern: im laufenden Spiel nur vom Spielleiter, alles außer dem Spielfeld', () => {
  const g = mainBoard(3);
  g.S.ts.rolled = false;
  throws(() => g.act(1, { type: 'set_settings', settings: { dice: 'auto' } }), /Spielleiter/);
  throws(() => g.act(0, { type: 'set_settings', settings: { dense: false } }), /Spielfeld/);
  throws(() => g.act(0, { type: 'set_settings', settings: { plannedPlayers: 5 } }), /Spielfeld/);
  throws(() => g.act(0, { type: 'set_settings', settings: { winPoints: 1 } }), /Siegpunkte|ganze Zahlen/);
  g.act(0, { type: 'set_settings', settings: { winPoints: 20, bankRate: 3, limits: { road: 7, fogChips: { 6: 1 } } } });
  assert.equal(g.S.settings.winPoints, 20); assert.equal(g.S.settings.bankRate, 3); assert.equal(g.S.settings.limits.road, 7);
  assert(g.S.log.some((l) => /einstellungen geändert/.test(l.text)));
  g.act(0, { type: 'set_settings', settings: { dice: 'auto' } });
  assert.equal(g.S.settings.dice, 'auto'); assert(g.S.ts.rolled, 'ausstehender Wurf wird sofort ausgeführt');
});

test('Auto-Würfeln: Zug beginnt mit Wurf; manuelles Würfeln wird abgelehnt', () => {
  const g = lobby(2, 11);
  g.act(0, { type: 'set_settings', settings: { dice: 'auto', robber: 'auto' } });
  g.act(0, { type: 'start' });
  let guard = 0;
  while (g.S.phase === 'setup' && guard++ < 50) { const pid = g.S.turn; const L = g.legal(pid); if (L.settlement.length) g.act(pid, { type: 'place_settlement', v: L.settlement[0] }); else { const e = L.road[0] || L.ship[0]; g.act(pid, { type: L.road[0] ? 'place_road' : 'place_ship', e }); } while (Object.keys(g.S.pend.gold).length) { const p = +Object.keys(g.S.pend.gold)[0]; g.act(p, { type: 'gold_pick', cards: { holz: g.S.pend.gold[p] } }); } }
  assert.equal(g.S.phase, 'main');
  // Aufbau fertig → Auto-Würfeln ist bereits passiert
  assert(g.S.ts.rolled && g.S.dice, 'automatisch gewürfelt');
  throws(() => g.act(g.S.turn, { type: 'roll' }), /automatisch|schon gewürfelt/);
  const t0 = g.S.turnNo;
  g.act(g.S.turn, { type: 'end_turn' });
  assert.equal(g.S.turnNo, t0 + 1); assert(g.S.ts.rolled, 'nächster Zug würfelt ebenfalls automatisch');
});

test('Auto-Räuber: nach 7 setzt der Server Räuber und stiehlt selbst', () => {
  const g = mainBoard(3, { robber: 'auto' });
  const S = g.S;
  S.verts[V('1,0', '1,-1', '0,0')] = { p: 2, k: 's' };
  hand(g, 2, { erz: 3 });
  S.ts.rolled = false;
  g.rnd = (() => { const seq = [0.5, 0.34, 0.9, 0.2]; let i = 0; return () => seq[i++ % seq.length]; })();
  g.act(0, { type: 'roll' });
  assert.equal(g.S.dice[0] + g.S.dice[1], 7);
  assert.equal(S.ts.sub, null, 'Räuber bereits versetzt');
  assert.notEqual(S.robber, '9,9');
  // Ritter: Auto-Räuber greift auch
  g.pl(0).dev.push({ id: 7, type: 'ritter', bought: 0 }); S.turnNo = 9; S.ts.devPlayed = false;
  g.act(0, { type: 'play_knight' });
  assert.equal(S.ts.sub, null);
});

test('Auto-Modus: Abwesender spielt weiter (Ertrag, 1:1-Angebote, Räuber, Zug) und kehrt zurück', () => {
  const g = mainBoard(3);
  const S = g.S;
  g.setAbsentAuto(1, true);
  assert.equal(g.view(0).players[1].auto, true);
  S.verts[V('0,0', '0,1', '-1,1')] = { p: 1, k: 's' };
  g.produce(4); assert.equal(g.pl(1).hand.holz, 1, 'Ertrag trotz Auto');
  hand(g, 0, { holz: 2 }); hand(g, 1, { erz: 2, holz: 1 });
  g.act(0, { type: 'trade_offer', give: { holz: 2 }, want: { erz: 1 } });
  assert.equal(S.trade.responses[1], undefined, '2:1 wird nicht automatisch angenommen');
  g.act(0, { type: 'trade_cancel' });
  g.act(0, { type: 'trade_offer', give: { holz: 1 }, want: { erz: 1 } });
  assert.equal(S.trade.responses[1].s, 'accept', '1:1 automatisch angenommen');
  g.act(0, { type: 'trade_confirm', with: 1 });
  assert.equal(g.pl(1).hand.erz, 1);
  // Zug des Auto-Spielers wird selbst gespielt
  S.ts.rolled = true; g.act(0, { type: 'end_turn' });
  assert.notEqual(S.turn, 1, 'Zug des Auto-Spielers ist schon vorbei');
  assert.equal(S.turn, 2);
  // Auto-Spieler wirft zufällig ab und stellt den Räuber
  hand(g, 1, { holz: 9 });
  S.ts.rolled = true; g.act(2, { type: 'end_turn' }); // zurück zu Spieler 0
  S.ts.rolled = false; g.rnd = (() => { const seq = [0.5, 0.34]; let i = 0; return () => seq[i++ % 2]; })();
  g.act(0, { type: 'roll' });
  assert.equal(g.handSize(1) <= 7 + 0, true, 'Auto-Spieler hat abgeworfen'); assert.deepEqual(S.pend.discard, {});
  // Rückkehr
  g.setConnected(1, true); // war nicht verbunden → true setzt auto zurück
  assert.equal(g.pl(1).auto, false);
});

test('Verlassen im Spiel: Auto-Modus, Token ungültig, Übernahme der Infrastruktur', () => {
  const g = mainBoard(3);
  const S = g.S;
  const a = V('0,0', '0,1', '-1,1'), b = V('3,0', '3,1', '2,1');
  S.verts[a] = { p: 1, k: 's' }; S.verts[b] = { p: 0, k: 's' };
  const ea = G.vertEdges(a).find((e) => g.edgeFor(e, 'r')); S.edges[ea] = { p: 1, k: 'r', t: 0 };
  // Spieler 0 baut eine Straße, die an die Straße von 1 grenzt
  const end = G.edgeVerts(ea).find((v) => v !== a);
  const tok = g.pl(1).token;
  assert.equal(g.leave(tok), true);
  assert.equal(g.pl(1).left, true); assert.equal(g.pl(1).auto, true); assert.equal(g.pl(1).token, null);
  assert.equal(g.view(0).players[1].gone, true);
  // keine Anschlussstelle: nichts übernehmbar
  assert.deepEqual(g.takeoverSpots(0), { edges: [], verts: [] });
  // eigene Straße am Endpunkt → angrenzend
  const mine = G.vertEdges(end).find((e) => e !== ea && g.edgeFor(e, 'r'));
  S.edges[mine] = { p: 0, k: 'r', t: 0 };
  const sp = g.takeoverSpots(0);
  assert(sp.edges.includes(ea), 'Straße übernehmbar');
  assert.deepEqual(g.view(0).legal.takeover.edges, sp.edges);
  throws(() => g.act(0, { type: 'take_over', kind: 'vert', key: b }), /nicht übernehmen/);
  g.act(0, { type: 'take_over', kind: 'edge', key: ea });
  assert.equal(S.edges[ea].p, 0);
  throws(() => g.act(0, { type: 'take_over', kind: 'edge', key: ea }), /schon|nicht/);
  assert.equal(S.ts.movedShip, true, 'belegt den Schiffsversetzen-Zug');
  // Siedlung übernehmen: eigene Straße/Gebäude muss anliegen
  S.ts.movedShip = false;
  S.edges[G.vertEdges(a).find((e) => e !== ea && g.edgeFor(e, 'r'))] = { p: 0, k: 'r', t: 0 };
  assert(g.takeoverSpots(0).verts.includes(a));
  g.act(0, { type: 'take_over', kind: 'vert', key: a });
  assert.equal(S.verts[a].p, 0);
  // „Verschwinden“-Modus
  const h = mainBoard(3, { leaver: 'verschwinden', vanishRounds: 2 });
  h.S.verts[V('0,0', '0,1', '-1,1')] = { p: 1, k: 's' };
  const t1 = h.pl(1).token; h.leave(t1);
  assert.deepEqual(h.takeoverSpots(0), { edges: [], verts: [] }, 'keine Übernahme im Verschwinden-Modus');
  hand(h, 1, { holz: 5 });
  for (let i = 0; i < 12 && Object.keys(h.S.verts).length; i++) { h.S.ts.rolled = true; h.act(h.S.turn, { type: 'end_turn' }); }
  assert.equal(Object.keys(h.S.verts).length, 0, 'Infrastruktur nach 2 Runden verschwunden');
  assert.equal(h.handSize(1), 0);
});

test('Spieler-Verlassen: Spiel läuft mit Auto-Spieler bis zum Ende, wenn die Letzten übrig sind', () => {
  const rnd = rng(77);
  const g = new Game({ rnd });
  for (let i = 0; i < 3; i++) g.join('P' + i, COL[i]);
  g.act(0, { type: 'start' });
  const tok = g.pl(2).token;
  g.leave(tok); // Spieler 2 verlässt direkt zu Beginn
  let steps = 0;
  while (g.S.phase !== 'ended' && steps < 30000 && g.S.turnNo < 800) {
    let acted = false;
    for (const pid of [0, 1]) if (botAct(g, pid, { rnd })) { acted = true; steps++; }
    if (!acted) break;
  }
  assert(g.S.turnNo > 20, 'Spiel kam voran: ' + g.S.turnNo + ' Züge');
  assert(g.pl(2).left);
});

test('Spielende: Spielleiter setzt mit neuem Siegpunktziel fort', () => {
  const g = new Game({ rnd: rng(5) });
  for (let i = 0; i < 3; i++) g.join('P' + i, COL[i]);
  g.act(0, { type: 'start' });
  throws(() => g.act(0, { type: 'resume_game', winPoints: 20 }), /noch nicht beendet/);
  g.act(0, { type: 'end_game' });
  throws(() => g.act(1, { type: 'resume_game', winPoints: 20 }), /Spielleiter/);
  throws(() => g.act(0, { type: 'resume_game', winPoints: 99 }), /Siegpunkte/);
  g.act(0, { type: 'resume_game', winPoints: 20 });
  assert.equal(g.view(0).phase, 'setup'); assert.equal(g.view(0).winPoints, 20); assert.equal(g.view(0).stats, null);
});

test('Statistik: Sieg und Abbruch liefern vollständige Statistik', () => {
  const rnd = rng(5);
  const g = new Game({ rnd });
  for (let i = 0; i < 3; i++) g.join('P' + i, COL[i]);
  throws(() => g.act(0, { type: 'end_game' }), /läuft nicht/);
  g.act(0, { type: 'start' });
  let steps = 0;
  while (g.S.turnNo < 40 && steps++ < 5000) for (let p = 0; p < 3; p++) botAct(g, p, { rnd });
  throws(() => g.act(1, { type: 'end_game' }), /Spielleiter/);
  g.act(0, { type: 'end_game' });
  const v = g.view(2);
  assert.equal(v.phase, 'ended'); assert.equal(v.endedBy, 'host'); assert.equal(v.winner, null);
  const st = v.stats;
  assert(st && st.aborted && st.players.length === 3 && st.turns >= 40);
  assert.equal(Object.values(st.rolls).reduce((a, b) => a + b, 0) > 20, true);
  assert(st.history.length >= 5 && st.history[0].vp.length === 3);
  const p0 = st.players[0];
  assert(p0.built.settlement >= 0 && 'total' in p0.produced && 'maxRoute' in p0);
  assert(st.players.reduce((a, p) => a + p.produced.total, 0) > 0, 'Erträge gezählt');
  assert(st.durationSec >= 0);
});

test('Lobby: Plätze schließen, Spieler entfernen, Host-Übergabe, Neustart mit Einstellungen', () => {
  const g = lobby(3);
  g.act(0, { type: 'close_seats', closed: true });
  throws(() => g.join('X', 'violett'), /besetzt/);
  g.act(0, { type: 'close_seats', closed: false });
  g.join('X', 'violett');
  throws(() => g.act(1, { type: 'kick', pid: 2 }), /Spielleiter/);
  throws(() => g.act(0, { type: 'kick', pid: 0 }), /selbst/);
  g.act(0, { type: 'kick', pid: 2 });
  assert.equal(g.lastKicked !== undefined, true);
  assert.deepEqual(g.S.players.map((p) => p.name), ['P0', 'P1', 'X']);
  assert.deepEqual(g.S.players.map((p) => p.id), [0, 1, 2]);
  // Host verlässt: nächster wird Host
  g.leave(g.S.players[0].token);
  assert.equal(g.S.players[g.S.host].name, 'P1');
  g.act(g.S.host, { type: 'set_settings', settings: { winPoints: 9 } });
  g.act(g.S.host, { type: 'start' });
  g.act(g.S.host, { type: 'end_game' });
  g.act(g.S.host, { type: 'new_game' });
  assert.equal(g.S.phase, 'lobby'); assert.equal(g.S.settings.winPoints, 9); assert.equal(g.S.players.length, 2);
  assert(g.view(0).hexes.length > 20, 'neue Vorschau');
});

test('Hub: parallele Spiele, Auswahl, Farben pro Spiel, Auto-Anlage, Aufräumen', () => {
  let now = 1000;
  const hub = new Hub({ rnd: rng(3), now: () => now, graceMs: 20000, absentMs: 60000 });
  const a = hub.join({ name: 'Anna', color: 'rot' });
  assert.equal(hub.rooms.size, 1); assert.equal(hub.list()[0].joinable, true);
  // ohne Angabe: genau ein offenes Spiel → beitreten, Farbe pro Spiel
  const b = hub.join({ name: 'Ben', color: 'blau' });
  assert.equal(b.game, a.game);
  throws(() => hub.join({ name: 'Cleo', color: 'rot' }), /Farbe/);
  // neues paralleles Spiel mit gleicher Farbe möglich
  const c = hub.join({ name: 'Cleo', color: 'rot', create: true });
  assert.notEqual(c.game, a.game); assert.equal(hub.rooms.size, 2);
  // mehrere offene Spiele → Auswahl nötig
  try { hub.join({ name: 'Dora', color: 'gruen' }); assert.fail('Auswahl erwartet'); } catch (e) { assert(e.games && e.games.length === 2, 'Spieleliste'); }
  hub.join({ name: 'Dora', color: 'gruen', game: c.game });
  assert.equal(hub.rooms.get(c.game).game.S.players.length, 2);
  // ungültiger Name legt kein leeres Spiel an
  const before = hub.rooms.size;
  throws(() => hub.join({ name: '', color: 'gruen', create: true }), /Namen/);
  assert.equal(hub.rooms.size, before);
  // Plätze schließen → nicht mehr joinable
  const ra = hub.rooms.get(a.game);
  ra.game.act(0, { type: 'close_seats', closed: true });
  assert(!hub.list().find((g) => g.id === a.game).joinable);
  throws(() => hub.join({ name: 'Emil', color: 'violett', game: a.game }), /besetzt/);
  // Reconnect über Token
  assert.equal(hub.join({ token: a.token }).pid, 0);
  // Verbindungslogik: alle getrennt → nach Kulanzzeit gelöscht, vorher nicht
  for (const room of hub.rooms.values()) room.game.S.players.forEach((p) => hub.disconnected(room, p));
  now += 19000; assert.equal(hub.tick().removed.length, 0);
  hub.connected(hub.rooms.get(a.game), hub.rooms.get(a.game).game.S.players[0]); // Tab neu geladen
  now += 19000;
  const r = hub.tick();
  assert.equal(r.removed.length, 1, 'nur das verlassene Spiel verschwindet'); assert(hub.rooms.has(a.game));
  now += 100000; hub.tick();
  hub.disconnected(hub.rooms.get(a.game), hub.rooms.get(a.game).game.S.players[0]);
  now += 21000; hub.tick(); assert.equal(hub.rooms.size, 0, 'letzter Spieler weg → Spiel beendet');
});

test('Hub: Abwesenheit → Auto-Modus nach Wartezeit; Spiel mit nur Verlassenen wird entfernt', () => {
  let now = 0;
  const hub = new Hub({ rnd: rng(4), now: () => now, graceMs: 20000, absentMs: 60000 });
  const a = hub.join({ name: 'A', color: 'rot' }), b = hub.join({ name: 'B', color: 'blau' });
  const room = hub.rooms.get(a.game);
  hub.connected(room, room.game.S.players[0]); hub.connected(room, room.game.S.players[1]);
  room.game.act(0, { type: 'start' });
  hub.disconnected(room, room.game.S.players[1]);
  now += 59000; assert.equal(hub.tick().changed.length, 0);
  now += 2000; const t = hub.tick();
  assert.equal(room.game.S.players[1].auto, true); assert(t.changed.includes(room));
  hub.connected(room, room.game.S.players[1]);
  assert.equal(room.game.S.players[1].auto, false, 'Rückkehr beendet Auto-Modus');
  // beide verlassen
  room.game.leave(room.game.S.players[0].token); room.game.leave(room.game.S.players[1].token);
  assert.equal(hub.tick().removed.length, 1);
});

test('Hub: Speichern und Laden übersteht Neustart', () => {
  const hub = new Hub({ rnd: rng(8) });
  const a = hub.join({ name: 'A', color: 'rot' });
  hub.rooms.get(a.game).game.act(0, { type: 'set_settings', settings: { winPoints: 11 } });
  const hub2 = new Hub({ rnd: rng(9) });
  hub2.load(JSON.parse(JSON.stringify(hub.toJSON())), 300000);
  assert.equal(hub2.rooms.size, 1);
  assert.equal(hub2.rooms.get(a.game).game.S.settings.winPoints, 11);
  assert.equal(hub2.join({ token: a.token }).pid, 0);
  assert.equal(hub2.rooms.get(a.game).graceMs, 300000);
});

test('Simulation: komplette Partien mit Auto-Würfeln/-Räuber, harten Limits und Varianten', () => {
  const combos = [
    { variant: 'nebel', dice: 'auto', robber: 'auto' },
    { variant: 'inseln', winPoints: 8, handLimit: 5, limits: { dev: 10, bank: { holz: 12, lehm: 12, wolle: 12, getreide: 12, erz: 12 } } },
    { variant: 'klassisch', limits: { road: 8, ship: 6, settlement: 4, city: 3, fogTerrain: { gold: 0, wueste: 0 }, fogChips: { 6: 1, 8: 1 } }, winPoints: 9 },
    { variant: 'nebel', limits: { dev: null, road: null, ship: null }, playerTrade: false, winPoints: 12 },
    { variant: 'archipel', winPoints: 10, dice: 'auto', robber: 'auto' },
  ];
  let k = 0;
  for (const set of combos) for (const n of [2, 4, 6]) {
    const rnd = rng(1000 + ++k);
    const g = new Game({ rnd });
    for (let i = 0; i < n; i++) g.join('P' + i, COL[i]);
    g.act(0, { type: 'set_settings', settings: set });
    g.act(0, { type: 'start' });
    let steps = 0, stuck = 0;
    while (g.S.phase !== 'ended' && g.S.turnNo < 600 && steps < 40000) {
      let acted = false;
      for (let pid = 0; pid < n; pid++) { if (botAct(g, pid, { rnd })) { acted = true; steps++; } }
      for (let i = 0; i < n; i++) g.view(i);
      for (const r of ['holz', 'lehm', 'wolle', 'getreide', 'erz']) { const lim = g.S.settings.limits.bank[r]; if (lim !== null) assert(g.S.players.reduce((a, p) => a + p.hand[r], 0) <= lim, 'Bank-Vorrat überschritten: ' + r); }
      for (const p of g.S.players) { const L = g.left(p.id); for (const kk in L) assert(L[kk] >= 0); }
      if (!acted) { if (++stuck > 3) throw new Error(`hängt (${JSON.stringify(set)}, n=${n}) step=${g.stepOf()} turn=${g.S.turn}`); } else stuck = 0;
    }
    if (g.S.phase === 'ended') assert(g.vp(g.S.winner) + g.hiddenVp(g.S.winner) >= g.S.settings.winPoints);
    JSON.stringify(g.S);
  }
});

test('Brett: Startecken sind ausgeglichen (Würfelauswahl ist besser als zufällige Karten, Streuung begrenzt)', () => {
  for (const variant of ['klassisch', 'nebel', 'inseln', 'archipel']) {
    const rnd = rng(11); let neu = 0, alt = 0; const N = 25;
    for (let i = 0; i < N; i++) {
      const a = { supply: {} }, b = { supply: {} };
      B.generateOnce(a, 4, rnd, { variant }); B.generate(b, 4, rnd, { variant });
      alt += B.startImbalance(a, 4, variant, B.homeIslands(a, new Set(a.home)));
      const c = B.startImbalance(b, 4, variant, B.homeIslands(b, new Set(b.home)));
      neu += c; assert(c < 1e8, 'Startplätze reichen nicht für alle (' + variant + ')');
    }
    assert(neu < alt, `${variant}: Bewertung bringt keine Verbesserung (${(neu / N).toFixed(1)} statt ${(alt / N).toFixed(1)})`);
    assert(neu / N <= 4, `${variant}: Ø Unausgewogenheit zu hoch (${(neu / N).toFixed(1)})`);
  }
});

test('Avatare: zufällig, nie doppelt, Wunsch nur wenn frei, Bot-Avatare nicht wählbar', () => {
  const AV = require('../shared/avatars');
  const g = lobby(0);
  const wish = AV.HUMAN_IDS[2];
  g.join('A', 'rot', undefined, wish);
  assert.strictEqual(g.S.players[0].avatar, wish, 'Wunsch wird erfüllt');
  g.join('B', 'blau', undefined, wish);
  assert.notStrictEqual(g.S.players[1].avatar, wish, 'vergebener Wunsch wird ersetzt');
  g.join('C', 'orange', undefined, 'biber');
  assert(AV.HUMAN_IDS.includes(g.S.players[2].avatar), 'Bot-Avatar ist nicht wählbar');
  g.join('D', 'weiss', undefined, 'gibtsnicht');
  assert(AV.HUMAN_IDS.includes(g.S.players[3].avatar), 'ungültiger Avatar wird ersetzt');
  g.join('E', 'gruen'); g.join('F', 'violett');
  assert.strictEqual(new Set(g.S.players.map((p) => p.avatar)).size, 6, 'sechs Spieler, sechs verschiedene Avatare');
  for (let seed = 1; seed < 30; seed++) { // ohne Wunsch: immer verschieden, auch in vielen Spielen
    const h = new Game({ rnd: rng(seed) }); for (let i = 0; i < 6; i++) h.join('S' + i, COL[i]);
    assert.strictEqual(new Set(h.S.players.map((p) => p.avatar)).size, 6);
  }
  assert.strictEqual(g.view(0).players[0].avatar, wish, 'die Sicht enthält den Avatar');
});

test('Bots: Spielleiter setzt Bots (je Sorte einmal), feste Namen/Avatare, Regeln für Platz und Namen', () => {
  const AV = require('../shared/avatars');
  const g = lobby(2);
  throws(() => g.act(1, { type: 'add_bot', kind: 'ritter' }), /Spielleiter/);
  g.act(0, { type: 'add_bot', kind: 'ritter' });
  const r = g.S.players[2];
  assert.strictEqual(r.bot, 'ritter'); assert.strictEqual(r.avatar, 'ente'); assert.strictEqual(r.name, AV.BOTS.ritter.name);
  assert(r.connected && !r.token, 'Bot ist immer verbunden und hat keinen Token');
  throws(() => g.act(0, { type: 'add_bot', kind: 'ritter' }), /schon dabei/);
  throws(() => g.act(0, { type: 'add_bot', kind: 'zauberer' }), /gibt es nicht/);
  throws(() => g.join('polly profit', 'gruen'), /Bot/);
  assert.notStrictEqual(g.S.players[0].color, r.color, 'Bot bekommt eine freie Farbe');
  g.act(0, { type: 'add_bot', kind: 'haendler' }); g.act(0, { type: 'add_bot', kind: 'baumeister' });
  assert.strictEqual(g.S.players.length, 5);
  assert.strictEqual(g.humans().length, 2, 'humans() zählt keine Bots');
  assert.strictEqual(g.S.settings.plannedPlayers, 5, 'Spielfeld wächst mit den Bots');
  assert.strictEqual(new Set(g.S.players.map((p) => p.avatar)).size, 5);
  g.join('H', COL.find((c) => !g.S.players.some((p) => p.color === c))); throws(() => g.act(0, { type: 'add_bot', kind: 'ritter' }));
  const v = g.view(0); assert.strictEqual(v.players[3].bot, 'haendler');
  const tok = g.act(0, { type: 'kick', pid: 2 }); // Bot entfernen (Token null)
  assert.strictEqual(g.S.players.some((p) => p.bot === 'ritter'), false, 'Spielleiter kann Bots entfernen');
  g.act(0, { type: 'close_seats', closed: true });
  throws(() => g.act(0, { type: 'add_bot', kind: 'ritter' }), /besetzt/);
  // Hub: Bots zählen nicht als anwesende Menschen
  const hub = new Hub({ rnd: rng(3) });
  const a = hub.join({ name: 'Hanna', color: 'rot', create: true });
  a.room.game.act(0, { type: 'add_bot', kind: 'baumeister' });
  assert.strictEqual(hub.summary(a.room).players.find((p) => p.bot).avatar, 'biber');
  hub.connected(a.room, a.room.game.S.players[0]);
  a.room.game.leave(a.token);
  assert(!a.room.game.humans().length); hub.tick(); assert.strictEqual(hub.rooms.size, 0, 'Raum ohne Menschen verschwindet trotz Bot');
});

test('Bots: spielen im Hub selbstständig bis zum Ziel (Aufbau, Würfeln, Bauen, Handel mit Auto-Mensch)', () => {
  for (const variant of ['klassisch', 'nebel', 'inseln', 'archipel']) {
    const hub = new Hub({ rnd: rng(9) });
    const a = hub.join({ name: 'Hanna', color: 'rot', create: true }), g = a.room.game;
    g.act(0, { type: 'set_settings', settings: { variant } });
    for (const k of ['baumeister', 'haendler', 'ritter']) g.act(0, { type: 'add_bot', kind: k });
    g.act(0, { type: 'start' });
    g.setAbsentAuto(0, true); // der Mensch ist abwesend: Auto-Modus
    let n = 0;
    while (g.S.phase !== 'ended' && n++ < 60000 && g.S.turnNo < 400) hub.botStep(a.room);
    assert(g.S.turnNo > 20, `Bots kommen voran (${variant})`);
    JSON.stringify(g.S);
    const botVerts = Object.values(g.S.verts).filter((x) => g.S.players[x.p].bot).length;
    assert(botVerts >= 6, `Bots haben gebaut (${variant}: ${botVerts})`);
    const json = JSON.stringify(hub.toJSON()); const h2 = new Hub({ rnd: rng(1) }); h2.load(JSON.parse(json));
    assert(h2.rooms.size === 1 && [...h2.rooms.values()][0].game.S.players.filter((p) => p.bot).every((p) => p.connected), 'Bots bleiben nach Laden verbunden');
  }
});

test('Figurenlimit: Stadtausbau gibt die Siedlung zurück (5 Siedlungen + 4 Städte gleichzeitig möglich)', () => {
  const g = mainBoard(2); const S = g.S;
  const vs = [V('0,0', '0,-1', '1,-1'), V('1,0', '1,-1', '2,-1'), V('2,0', '2,-1', '3,-1'), V('3,0', '3,-1', '4,-1'), V('4,0', '4,-1', '5,-1')];
  vs.forEach((v) => { S.verts[v] = { p: 0, k: 's' }; });
  assert.strictEqual(g.left(0).settlement, 0, 'fünf Siedlungen: keine weitere');
  assert.strictEqual(g.left(0).city, 4);
  hand(g, 0, { holz: 1, lehm: 1, wolle: 1, getreide: 4, erz: 3 });
  throws(() => g.act(0, { type: 'build_settlement', v: V('0,0', '0,1', '-1,1') }), /keine Siedlungen mehr/);
  g.act(0, { type: 'build_city', v: vs[0] });
  assert.strictEqual(g.left(0).settlement, 1, 'durch die Stadt ist wieder eine Siedlung frei');
  assert.strictEqual(g.left(0).city, 3);
  [1, 2, 3].forEach((i) => { S.verts[vs[i]].k = 'c'; });
  assert.strictEqual(g.left(0).settlement, 4, 'mit 4 Städten und 1 Siedlung sind noch 4 Siedlungen möglich'); assert.strictEqual(g.left(0).city, 0, 'vier Städte gebaut');
  assert.strictEqual(Object.values(S.verts).filter((x) => x.p === 0 && x.k === 'c').length, 4);
});

test('Karten-Ereignisse (fx): Quelle, Ziel, Sichtbarkeit je Spieler', () => {
  const g = mainBoard(3); const S = g.S;
  const fxOf = (pid) => g.view(pid).fx;
  // Würfelertrag: Feld -> Spieler, öffentlich
  S.verts[V('0,0', '0,-1', '1,-1')] = { p: 1, k: 's' }; S.verts[V('0,0', '0,-1', '-1,0')] = { p: 2, k: 'c' };
  g.produce(4);
  let ev = fxOf(0).filter((e) => e.why === 'roll');
  assert.strictEqual(ev.length, 2); assert(ev.every((e) => e.f === 'h:0,0' && e.pub && e.c.holz > 0), 'Ertrag kommt vom Feld, mit sichtbaren Karten für alle');
  assert.deepStrictEqual(ev.map((e) => [e.t, e.n]).sort(), [['p:1', 1], ['p:2', 2]]);
  // Bankhandel: Spieler <-> Bank
  hand(g, 0, { holz: 4 });
  g.act(0, { type: 'bank_trade', give: 'holz', get: 'erz' });
  ev = fxOf(2).filter((e) => e.why === 'bank');
  assert.deepStrictEqual(ev.map((e) => [e.f, e.t, e.n]), [['p:0', 'bank', 4], ['bank', 'p:0', 1]]);
  // Bauen: Kosten gehen an die Bank
  hand(g, 0, { holz: 1, lehm: 1 }); S.verts[V('0,0', '0,1', '-1,1')] = { p: 0, k: 's' };
  const road = g.pathSpots(0, 'r')[0];
  g.act(0, { type: 'build_road', e: road });
  assert(fxOf(1).some((e) => e.why === 'build' && e.f === 'p:0' && e.t === 'bank' && e.c.holz === 1 && e.c.lehm === 1));
  // Stehlen: nur Beteiligte sehen die Karte, Dritte nur die Anzahl
  S.ts.sub = 'robber'; hand(g, 1, { erz: 1 }); hand(g, 2, {});
  S.verts[V('1,0', '1,-1', '0,0')] = { p: 1, k: 's' };
  g.act(0, { type: 'move_robber', hex: '1,0' });
  const st = (pid) => fxOf(pid).find((e) => e.why === 'steal');
  assert(st(0) && st(0).c && st(0).f === 'p:1' && st(0).t === 'p:0' && st(0).c.erz === 1, 'Dieb sieht die Karte');
  assert(st(1) && st(1).c, 'Opfer sieht die Karte');
  assert(st(2) && !st(2).c && st(2).n === 1 && st(2).pub === false, 'Unbeteiligte sehen nur einen Kartenrücken');
  // Ids steigen, Liste bleibt begrenzt
  const ids = fxOf(0).map((e) => e.id); assert.deepStrictEqual(ids, [...ids].sort((a, b) => a - b));
  for (let i = 0; i < 80; i++) g.fx('bank', 'p:0', { holz: 1 }, true, 'x');
  assert(fxOf(0).length <= 40);
  JSON.stringify(g.S);
});

console.log(`${passed} Funktionstests bestanden`);

test('Inseln dichter: kleinerer Spielfeldradius bei gleicher Landfläche', () => {
  const B = require('../server/board.js'), Geo = require('../shared/geom.js');
  let seed = 7; const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
  for (const variant of ['inseln', 'archipel']) {
    const r = { false: 0, true: 0 };
    for (const dense of [false, true]) {
      for (let i = 0; i < 20; i++) {
        const S = {}; B.generate(S, 4, rnd, { variant, dense });
        r[dense] += Math.max(...Object.keys(S.hexes).filter((k) => S.hexes[k].t !== 'meer').map((k) => { const c = Geo.hexCenter(k); return Math.hypot(c.x, c.y); }));
      }
    }
    assert(r.true < r.false, `${variant}: dichter ist kompakter (${r.true.toFixed(0)} < ${r.false.toFixed(0)})`);
  }
});

test('Spieltisch: Tischspieler nur über den Spielleiter, keine Bots/Online-Spieler, Tisch ein/aus', () => {
  const g = new Game({ rnd: rng(11) });
  g.join('Hanna', 'rot');
  g.act(0, { type: 'add_table_player', name: 'Bernd', color: 'blau' });
  assert.equal(g.S.settings.table, true, 'der erste Tischspieler schaltet den Tisch ein');
  g.act(0, { type: 'add_table_player', name: 'Carla', color: 'gruen' });
  throws(() => g.act(0, { type: 'add_table_player', name: 'Eva', color: 'blau' }), /Farbe/);
  throws(() => g.act(1, { type: 'add_table_player', name: 'Eva', color: 'violett' }), /Spielleiter/);
  throws(() => g.join('Online', 'violett'), /Spieltisch/);
  throws(() => g.act(0, { type: 'add_bot', kind: 'haendler' }), /Bots/);
  throws(() => g.act(0, { type: 'set_settings', settings: { table: false } }), /Unbekannte/);
  assert(g.S.players.every((p) => p.seat == null), 'in der Lobby gibt es noch keine Plätze');
  g.act(0, { type: 'kick', pid: 2 });
  assert.equal(g.S.settings.table, true);
  g.act(0, { type: 'kick', pid: 1 });
  assert.equal(g.S.settings.table, false, 'ohne Tischspieler ist der Tisch wieder aus');
  assert.doesNotThrow(() => g.join('Online', 'violett'));
});

test('Spieltisch: Platzwahl beim Start (Spielleiter zuerst), Reihenfolge im Uhrzeigersinn, Würfeln nur für den Beginner', () => {
  const mk = (dice) => {
    const g = new Game({ rnd: rng(4) });
    g.join('Hanna', 'rot');
    g.act(0, { type: 'add_table_player', name: 'Bernd', color: 'blau' });
    g.act(0, { type: 'add_table_player', name: 'Carla', color: 'gruen' });
    g.act(0, { type: 'add_table_player', name: 'Dora', color: 'orange' });
    if (dice) g.act(0, { type: 'set_settings', settings: { dice } });
    g.act(0, { type: 'start' });
    return g;
  };
  const g = mk();
  assert.equal(g.S.phase, 'setup'); assert.equal(g.S.setup.stage, 'seat'); assert.equal(g.S.turn, 0, 'der Spielleiter wird zuerst gefragt');
  assert.equal(g.view(0).step, 'setup_seat');
  throws(() => g.act(1, { type: 'place_seat', seat: 'b' }), /gerade/);
  throws(() => g.act(0, { type: 'place_seat', seat: 'x' }), /Platz/);
  throws(() => g.act(0, { type: 'roll' }), /Platz/);
  g.act(0, { type: 'place_seat', seat: 'tl' });
  assert.equal(g.S.turn, 1, 'danach der Reihe nach in Anlegereihenfolge');
  throws(() => g.act(1, { type: 'place_seat', seat: 'tl' }), /besetzt/);
  g.act(1, { type: 'place_seat', seat: 'br' }); g.act(2, { type: 'place_seat', seat: 'bl' });
  assert.equal(g.S.setup.stage, 'seat'); g.act(3, { type: 'place_seat', seat: 'tr' });
  assert.deepEqual(g.S.order, [1, 2, 0, 3], 'Sitzordnung im Uhrzeigersinn (br, bl, tl, tr)');
  assert.equal(g.S.setup.stage, 'order', 'danach wird gewürfelt, wer beginnt');
  for (let i = 0; i < 40 && g.S.setup.stage === 'order'; i++) g.act(g.S.turn, { type: 'roll' });
  assert.notEqual(g.S.setup.stage, 'order');
  const idx = g.S.order.map((p) => ['br', 'b', 'bl', 'l', 'tl', 't', 'tr', 'r'].indexOf(g.S.players[p].seat));
  let drops = 0; for (let i = 0; i < idx.length; i++) if (idx[(i + 1) % idx.length] < idx[i]) drops++;
  assert(drops <= 1, 'die Reihenfolge bleibt im Uhrzeigersinn, nur der Beginner ist ausgewürfelt');
  const a = mk('auto'); ['b', 'l', 't', 'r'].forEach((x, i) => a.act(i, { type: 'place_seat', seat: x }));
  assert.equal(a.S.setup.stage, 'settlement', 'automatisch: sofort Aufbau, Beginner ausgelost');
});

test('Kartenformat: breiter Bildschirm gibt eine breitere Karte', () => {
  const Bd = require('../server/board.js'), Geo = require('../shared/geom.js');
  let seed = 9; const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
  for (const variant of ['klassisch', 'inseln', 'archipel']) {
    const f = { std: 0, wide: 0 };
    for (const asp of ['std', 'wide']) for (let i = 0; i < 12; i++) {
      const S = {}; Bd.generate(S, 4, rnd, { variant, aspect: asp === 'wide' ? 1.78 : null });
      let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
      for (const k of Object.keys(S.hexes)) { if (S.hexes[k].t === 'meer') continue; const c = Geo.hexCenter(k); x0 = Math.min(x0, c.x); x1 = Math.max(x1, c.x); y0 = Math.min(y0, c.y); y1 = Math.max(y1, c.y); }
      f[asp] += (x1 - x0 + 1.7) / (y1 - y0 + 2);
    }
    assert(f.wide > f.std * 1.3, `${variant}: Format ${(f.wide / 12).toFixed(2)} statt ${(f.std / 12).toFixed(2)}`);
  }
  const g = new Game({ rnd: rng(2) }); g.join('A', 'rot');
  g.act(0, { type: 'set_settings', settings: { aspect: 1.78 } });
  assert.equal(g.S.settings.aspect, 1.78);
  throws(() => g.act(0, { type: 'set_settings', settings: { aspect: 9 } }), /Seitenverhältnis/);
  g.join('B', 'blau'); g.act(0, { type: 'start' });
  throws(() => g.act(0, { type: 'set_settings', settings: { aspect: 1 } }), /Spielfeld/);
});
