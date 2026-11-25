// Erzeugt die Mock-Views (*.json) neben dieser Datei:  node tests/mock/gen.js
const fs = require('fs'), path = require('path');
const G = require('../../shared/geom.js');

// ---- Karte -------------------------------------------------------------------------------
const land = new Map(); // key -> {t,n}
const terr = ['wald', 'wald', 'huegel', 'weide', 'acker', 'gebirge', 'acker', 'weide', 'wald', 'huegel', 'gebirge', 'wueste', 'weide', 'acker', 'wald', 'huegel', 'gebirge', 'weide', 'acker'];
const nums = [5, 2, 6, 3, 8, 10, 9, 12, 11, 4, 8, 10, 9, 4, 5, 6, 3, 11];
let ti = 0, ni = 0;
for (let r = -2; r <= 2; r++) for (let q = -2; q <= 2; q++) {
  if (Math.abs(q + r) > 2) continue;
  const t = terr[ti++ % terr.length];
  land.set(G.hk(q, r), { t, n: t === 'wueste' ? null : nums[ni++ % nums.length] });
}
// zweite Insel (Gold)
[['4,-2', 'gold', 6], ['5,-3', 'wald', 9], ['5,-2', 'gold', 8], ['4,-3', 'huegel', 5], ['3,-3', 'weide', 4]].forEach(([k, t, n]) => land.set(k, { t, n }));
const known = new Map(land);
const seaKeys = new Set();
for (const k of land.keys()) for (const n of G.neighbors(k)) if (!land.has(n)) seaKeys.add(n);
for (let r = -4; r <= 4; r++) for (let q = -4; q <= 4; q++) if (Math.abs(q + r) <= 3 && !land.has(G.hk(q, r))) seaKeys.add(G.hk(q, r));
// Meer rechts aufweiten
[['3,-1'], ['3,0'], ['4,-1'], ['2,-3'], ['2,-4'], ['6,-3'], ['6,-4'], ['5,-4'], ['4,-4'], ['6,-2'], ['5,-1']].forEach(([k]) => { if (!land.has(k)) seaKeys.add(k); });
for (const k of seaKeys) known.set(k, { t: 'meer', n: null });
const fogSet = new Set();
for (const k of known.keys()) for (const n of G.neighbors(k)) if (!known.has(n)) fogSet.add(n);
// ein Teil des Randes bleibt ohne Nebel -> weniger monoton
const fog = [...fogSet].filter((k, i) => i % 5 !== 3);

const hexes = [...known.entries()].map(([k, h]) => ({ k, t: h.t, n: h.n }));
const isLand = (k) => land.has(k);

// Haefen: Kuestenkanten
const coast = [];
for (const lk of land.keys()) for (const nk of G.neighbors(lk)) if (known.has(nk) && !isLand(nk)) coast.push({ e: G.edgeKey(lk, nk), land: lk, sea: nk });
coast.sort((a, b) => (a.e < b.e ? -1 : 1));
const kinds = ['any', 'holz', 'any', 'lehm', 'wolle', 'any', 'getreide', 'erz', 'any'];
const harbors = [];
for (let i = 0, j = 0; i < coast.length && j < kinds.length; i += 4, j++) harbors.push({ e: coast[i].e, kind: kinds[j], land: coast[i].land, sea: coast[i].sea });

// Ecken/Kanten
const allV = new Set(), allE = new Set();
for (const k of known.keys()) { G.hexCorners(k).forEach((v) => { if (G.vertHexes(v).every((h) => known.has(h))) allV.add(v); }); G.hexEdges(k).forEach((e) => { if (G.edgeHexes(e).every((h) => known.has(h))) allE.add(e); }); }
const landV = [...allV].filter((v) => G.vertHexes(v).some(isLand)).sort();
const vNeighborsTaken = new Set();
function pickVerts(n, seedOff) {
  const out = [];
  const arr = landV.filter((v) => G.vertHexes(v).filter(isLand).length >= 2);
  for (let i = seedOff; out.length < n && i < arr.length * 7; i += 7) {
    const v = arr[i % arr.length];
    if (vNeighborsTaken.has(v) || out.includes(v)) continue;
    out.push(v); vNeighborsTaken.add(v); G.vertNeighbors(v).forEach((x) => vNeighborsTaken.add(x));
  }
  return out;
}
const sets = [pickVerts(3, 3), pickVerts(3, 11), pickVerts(2, 17), pickVerts(2, 29)];
const verts = {};
sets.forEach((s, p) => s.forEach((v, i) => { verts[v] = { p, k: i === 0 && p < 3 ? 'c' : 's' }; }));
const edges = {};
function incident(v) { return G.vertEdges(v).filter((e) => allE.has(e) && G.edgeHexes(e).some(isLand)); }
sets.forEach((s, p) => s.forEach((v, i) => { const es = incident(v).filter((e) => !edges[e]); if (es[0]) edges[es[0]] = { p, k: 'r' }; if (i === 0 && es[1]) edges[es[1]] = { p, k: 'r' }; }));
// Schiffe: Kanten im Meer neben Kueste
const seaEdges = [...allE].filter((e) => G.edgeHexes(e).some((h) => !isLand(h)) && G.edgeHexes(e).some(isLand)).sort();
const ships = [];
for (let i = 5; ships.length < 3 && i < seaEdges.length; i += 6) if (!edges[seaEdges[i]]) { edges[seaEdges[i]] = { p: 0, k: 's' }; ships.push(seaEdges[i]); }
for (let i = 9; ships.length < 5 && i < seaEdges.length; i += 8) if (!edges[seaEdges[i]]) { edges[seaEdges[i]] = { p: 1, k: 's' }; ships.push(seaEdges[i]); }
// laengere Strasse fuer Spieler 0
const myV = sets[0][0];
let cur = myV;
for (let step = 0; step < 4; step++) {
  const es = incident(cur).filter((e) => !edges[e]);
  if (!es.length) break;
  edges[es[0]] = { p: 0, k: 'r' }; cur = G.edgeVerts(es[0]).find((x) => x !== cur);
}

const fallbackPlayers = (you) => [
  { id: 0, name: 'Anna', color: 'rot', connected: true, vp: 7, svp: 1, resCount: 12, devCount: 4, knightsPlayed: 3, longestRoute: 6, hasLongest: true, hasLargest: true, left: { road: 9, ship: 12, settlement: 2, city: 3 } },
  { id: 1, name: 'Bernd <b>Fett</b>', color: 'blau', connected: true, vp: 5, svp: 0, resCount: 6, devCount: 1, knightsPlayed: 1, longestRoute: 3, hasLongest: false, hasLargest: false, left: { road: 11, ship: 14, settlement: 3, city: 4 } },
  { id: 2, name: 'Clara', color: 'orange', connected: false, vp: 4, svp: 0, resCount: 9, devCount: 0, knightsPlayed: 0, longestRoute: 2, hasLongest: false, hasLargest: false, left: { road: 12, ship: 15, settlement: 4, city: 4 } },
  { id: 3, name: 'Dirk', color: 'gruen', connected: true, vp: 3, svp: 0, resCount: 4, devCount: 2, knightsPlayed: 0, longestRoute: 1, hasLongest: false, hasLargest: false, left: { road: 13, ship: 15, settlement: 4, city: 4 } },
].map((p) => p);

function base(over) {
  const legalSettle = landV.filter((v) => !vNeighborsTaken.has(v) && !verts[v]).slice(0, 7);
  const v = {
    v: 42, phase: 'main', you: 0, host: 0, minPlayers: 2, maxPlayers: 6, winPoints: 14,
    players: fallbackPlayers(), order: [0, 1, 2, 3], turn: 0, step: 'main', dice: [4, 3], diceSeq: 5,
    hexes, fog, harbors, verts, edges, robber: '1,-1', pirate: seaKeys.has('3,-1') ? '3,-1' : [...seaKeys][0],
    me: { hand: { holz: 3, lehm: 2, wolle: 1, getreide: 4, erz: 3 }, hiddenVp: 1, dev: [
      { id: 'a1', type: 'ritter', playable: true, fresh: false }, { id: 'a2', type: 'monopol', playable: false, fresh: true },
      { id: 'a3', type: 'siegpunkt', playable: false, fresh: false }, { id: 'a4', type: 'erfindung', playable: true, fresh: false }, { id: 'a5', type: 'strassenbau', playable: true, fresh: false }] },
    afford: { road: true, ship: true, settlement: false, city: true, dev: true },
    legal: { settlement: [], city: Object.keys(verts).filter((k) => verts[k].p === 0 && verts[k].k === 's'), road: [], ship: seaEdges.filter((e) => !edges[e]).slice(0, 6), shipFrom: ships.slice(0, 2), shipTo: {}, robber: [], pirate: [], steal: [] },
    rates: { holz: 2, lehm: 3, wolle: 3, getreide: 3, erz: 4 },
    trade: null, prompt: 'Du bist am Zug: baue, handle oder beende deinen Zug.', pending: { discard: {}, gold: {} },
    log: [
      { id: 1, p: null, text: 'Das Spiel beginnt. Viel Erfolg!', kind: 'sys' }, { id: 2, p: 1, text: 'Bernd <b>Fett</b> würfelt eine 8.', kind: 'roll' },
      { id: 3, p: 0, text: 'Anna baut eine Siedlung.', kind: 'build' }, { id: 4, p: 2, text: 'Clara tauscht 4 Holz gegen 1 Erz mit der Bank.', kind: 'trade' },
      { id: 5, p: 3, text: 'Dirk stiehlt Anna eine Karte.', kind: 'steal' }, { id: 6, p: 0, text: 'Anna erhält den Längsten Handelsweg.', kind: 'award' }, { id: 7, p: 0, text: 'Anna würfelt eine 7.', kind: 'roll' }],
    chat: [{ id: 1, p: 1, text: 'Hallo zusammen! <script>alert(1)</script>' }, { id: 2, p: 0, text: 'Viel Glück!' }],
    winner: null, bank: { dev: 17 }, longestHolder: 0, largestHolder: 0, sbp: false,
  };
  // plausible Ziele
  const roadCand = [...allE].filter((e) => !edges[e] && G.edgeHexes(e).some(isLand) && G.edgeVerts(e).some((x) => verts[x] && verts[x].p === 0)).slice(0, 6);
  v.legal.road = roadCand; v.legal.settlement = legalSettle;
  ships.slice(0, 2).forEach((s) => { v.legal.shipTo[s] = seaEdges.filter((e) => !edges[e]).slice(2, 5); });
  return Object.assign(v, over || {});
}

const out = {};
// Einstellungen (Standardwerte laut PROTOKOLL.md, v2)
const RESN = ['holz', 'lehm', 'wolle', 'getreide', 'erz'];
const nul = (keys) => Object.fromEntries(keys.map((k) => [k, null]));
const DEVN = ['ritter', 'siegpunkt', 'strassenbau', 'erfindung', 'monopol', 'stadtmauer'];
const devStd = (over) => Object.assign(Object.fromEntries(DEVN.map((k) => [k, k === 'stadtmauer' ? 0 : 'standard'])), over || {});
const defSettings = (over) => Object.assign({
  variant: 'klassisch', plannedPlayers: 4, dice: 'manuell', robber: 'manuell', winPoints: 14, handLimit: 7, bankRate: 4, playerTrade: true,
  islandBonus: 2, islandBonusMax: 2, longestMin: 5, armyMin: 3, leaver: 'uebernahme', vanishRounds: 5, devReturn: false,
  limits: { road: 15, ship: 15, settlement: 5, city: 4, dev: devStd(), bank: nul(RESN), fogTerrain: nul(['wald', 'huegel', 'weide', 'acker', 'gebirge', 'gold', 'wueste', 'meer']), fogChips: nul([2, 3, 4, 5, 6, 8, 9, 10, 11, 12]) },
}, over || {});
// Anmeldung: /api/games-Mock
const gamesMock = { games: [
  { id: 'g1', name: 'Käpt\'n Annas Runde', host: 'Anna', phase: 'lobby', closed: false, joinable: true, variant: 'klassisch', players: [{ name: 'Anna', color: 'rot' }, { name: 'Bernd <b>Fett</b>', color: 'blau' }], plannedPlayers: 4, maxPlayers: 6 },
  { id: 'g2', name: 'Nebelfahrt', host: 'Clara', phase: 'lobby', closed: false, joinable: true, variant: 'nebel', players: [{ name: 'Clara', color: 'orange' }], plannedPlayers: 3, maxPlayers: 6 },
  { id: 'g3', name: 'Vier Inseln', host: 'Dirk', phase: 'lobby', closed: false, joinable: true, variant: 'inseln', players: [{ name: 'Dirk', color: 'gruen' }, { name: 'Eva', color: 'violett' }, { name: 'Frank', color: 'weiss' }], plannedPlayers: 4, maxPlayers: 6 },
  { id: 'g4', name: 'Läuft schon', host: 'Gerd', phase: 'main', closed: true, joinable: false, variant: 'klassisch', players: [{ name: 'Gerd', color: 'rot' }, { name: 'Hans', color: 'blau' }], plannedPlayers: 2, maxPlayers: 6 },
] };
fs.writeFileSync(path.join(__dirname, 'games.json'), JSON.stringify(gamesMock));
fs.writeFileSync(path.join(__dirname, 'games_leer.json'), JSON.stringify({ games: [] }));
fs.writeFileSync(path.join(__dirname, 'games_eins.json'), JSON.stringify({ games: gamesMock.games.slice(0, 1) }));
// Lobby (Vorschau = Spielfeld wie im Spiel, aber ohne Figuren)
const lobbyBase = (you, over) => Object.assign({ v: 3, phase: 'lobby', step: 'lobby', gameId: 'g1', gameName: 'Käpt\'n Annas Runde', closed: false, you, host: 0, minPlayers: 2, maxPlayers: 6, winPoints: 14,
  players: fallbackPlayers().slice(0, 3).map((p, i) => ({ id: p.id, name: p.name, color: p.color, connected: p.connected, auto: false })),
  log: [], chat: [{ id: 1, p: 0, text: 'Hallo zusammen!' }, { id: 2, p: 1, text: 'Moin <script>alert(1)</script>' }],
  hexes, fog, harbors, verts: {}, edges: {}, robber: '1,-1', pirate: null, settings: defSettings({ plannedPlayers: 3 }) }, over || {});
out.lobby = lobbyBase(0);
out.lobby_gast = lobbyBase(1, { closed: true, settings: defSettings({ plannedPlayers: 3, variant: 'inseln', dice: 'auto', playerTrade: false, handLimit: null, limits: Object.assign(defSettings().limits, { road: null, dev: devStd({ ritter: 20, stadtmauer: 3 }), bank: { holz: 19, lehm: 19, wolle: null, getreide: 19, erz: 19 } }) }) });
out.lobby_leer = lobbyBase(0, { players: [{ id: 0, name: 'Anna', color: 'rot', connected: true, auto: false }], hexes: [], fog: [], harbors: [], chat: [], settings: defSettings({ plannedPlayers: 2 }) });
// Aufbau
const empty = { verts: {}, edges: {} };
out.aufbau = base({ phase: 'setup', step: 'setup_settlement', dice: null, diceSeq: 0, verts: { [sets[1][0]]: { p: 1, k: 's' } }, edges: {}, robber: null, pirate: null,
  prompt: 'Setze deine erste Siedlung auf eine markierte Ecke.', me: { hand: { holz: 0, lehm: 0, wolle: 0, getreide: 0, erz: 0 }, hiddenVp: 0, dev: [] }, afford: { road: false, ship: false, settlement: false, city: false, dev: false },
  players: fallbackPlayers().map((p) => Object.assign({}, p, { vp: 0, svp: 0, resCount: 0, devCount: 0, knightsPlayed: 0, longestRoute: 0, hasLongest: false, hasLargest: false })), log: [{ id: 1, p: null, text: 'Aufbau: Reihenfolge Anna, Bernd, Clara, Dirk.', kind: 'sys' }], chat: [], longestHolder: null, largestHolder: null,
  legal: { settlement: landV.filter((v) => !G.vertNeighbors(v).includes(sets[1][0]) && v !== sets[1][0]).slice(0, 30), city: [], road: [], ship: [], shipFrom: [], shipTo: {}, robber: [], pirate: [], steal: [] }, rates: { holz: 4, lehm: 4, wolle: 4, getreide: 4, erz: 4 } });
void empty;
// Mittelspiel mit laufendem Handelsangebot (Anbieter = du)
const tradeMine = { id: 7, from: 0, give: { holz: 1, getreide: 1 }, want: { erz: 1 }, responses: { 1: { s: 'accept' }, 2: { s: 'counter', give: { holz: 2 }, want: { erz: 1 } }, 3: { s: 'decline' } } };
out.mittelspiel = base({ trade: tradeMine });
out.mittel_frei = base();
out.mittel_wurf = base({ step: 'roll', dice: null, diceSeq: 5, prompt: 'Du bist am Zug: würfle!' });
out.mittel_modus = base({ legal: Object.assign({}, base().legal) });
// Handel: du bist Mitspieler
out.handel = base({ you: 1, turn: 0, step: 'main', prompt: 'Anna handelt – du kannst auf das Angebot antworten.', me: { hand: { holz: 2, lehm: 0, wolle: 3, getreide: 1, erz: 0 }, hiddenVp: 0, dev: [] },
  trade: { id: 8, from: 0, give: { erz: 1, wolle: 1 }, want: { holz: 1, getreide: 1 }, responses: { 2: { s: 'decline' } } }, legal: { settlement: [], city: [], road: [], ship: [], shipFrom: [], shipTo: {}, robber: [], pirate: [], steal: [] },
  afford: { road: false, ship: false, settlement: false, city: false, dev: false }, rates: { holz: 4, lehm: 4, wolle: 4, getreide: 4, erz: 4 } });
// Raeuber
const robHex = [...land.keys()].filter((k) => k !== '1,-1');
out.raeuber = base({ step: 'robber', prompt: 'Setze den Räuber auf ein Landfeld oder den Pirat auf ein Meerfeld.', dice: [3, 4], legal: { settlement: [], city: [], road: [], ship: [], shipFrom: [], shipTo: {}, robber: robHex, pirate: [...seaKeys].slice(0, 12), steal: [] } });
out.stehlen = base({ step: 'steal', prompt: 'Wen möchtest du bestehlen?', legal: { settlement: [], city: [], road: [], ship: [], shipFrom: [], shipTo: {}, robber: [], pirate: [], steal: [1, 2, 3] } });
out.abwerfen = base({ step: 'discard', turn: 3, you: 0, prompt: 'Du musst 5 Karten abwerfen.', me: { hand: { holz: 4, lehm: 3, wolle: 2, getreide: 1, erz: 2 }, hiddenVp: 1, dev: [] }, pending: { discard: { 0: 5, 2: 3 }, gold: {} }, legal: { settlement: [], city: [], road: [], ship: [], shipFrom: [], shipTo: {}, robber: [], pirate: [], steal: [] },
  players: fallbackPlayers().map((p, i) => (i === 0 ? Object.assign({}, p, { discarding: 5, resCount: 12 }) : i === 2 ? Object.assign({}, p, { discarding: 3 }) : p)) });
out.gold = base({ step: 'gold', turn: 1, prompt: 'Goldfluss! Wähle 2 Rohstoffe.', pending: { discard: {}, gold: { 0: 2 } }, legal: { settlement: [], city: [], road: [], ship: [], shipFrom: [], shipTo: {}, robber: [], pirate: [], steal: [] } });
out.sbp = base({ step: 'sbp', turn: 0, sbp: true, prompt: 'Sonderbauphase: baue oder klicke „Fertig“.', dice: [2, 5] });
out.strassenbau = base({ step: 'road_building', prompt: 'Straßenbau: noch 2 Wege kostenlos bauen.', legal: Object.assign({}, base().legal, { settlement: [], city: [] }) });
out.sieger = base({ phase: 'ended', step: 'ended', winner: 0, prompt: null, players: fallbackPlayers().map((p, i) => (i === 0 ? Object.assign({}, p, { vp: 13 }) : p)) });

// Spiel mit Auto-Spieler (Dirk), Verlassenem (Clara) und Uebernahme-Angebot
const claraE = Object.keys(edges).filter((e) => edges[e].p === 2), claraV = Object.keys(verts).filter((k) => verts[k].p === 2);
out.auto = base({ gameId: 'g1', gameName: 'Käpt\'n Annas Runde', settings: defSettings({ dice: 'auto', robber: 'auto', playerTrade: false, bankRate: 3 }),
  players: fallbackPlayers().map((p, i) => (i === 2 ? Object.assign({}, p, { connected: false, gone: true, auto: true }) : i === 3 ? Object.assign({}, p, { auto: true, connected: false }) : p)),
  prompt: 'Du bist am Zug: baue, handle oder beende deinen Zug.',
  legal: Object.assign({}, base().legal, { takeover: { edges: claraE.slice(0, 3), verts: claraV.slice(0, 2) } }) });
out.auto_wurf = Object.assign({}, out.auto, { step: 'roll', dice: null, prompt: 'Der Server würfelt automatisch …' });
// Unbegrenzte Limits (999)
out.unbegrenzt = base({ settings: defSettings({ limits: Object.assign(defSettings().limits, { road: null, ship: null, settlement: null, city: null }), handLimit: null, devReturn: true }), bank: { dev: 999 },
  players: fallbackPlayers().map((p) => Object.assign({}, p, { left: { road: 999, ship: 999, settlement: p.id === 1 ? 0 : 999, city: 999 } })) });
// Statistik
const histVp = []; for (let r = 1; r <= 24; r++) histVp.push({ round: r, vp: [Math.min(14, 2 + Math.floor(r * .5) + (r > 14 ? 1 : 0)), Math.min(11, 2 + Math.floor(r * .38)), Math.min(8, 2 + Math.floor(r * .25)), Math.min(7, 2 + Math.floor(r * .2))] });
const rolls = { 2: 1, 3: 3, 4: 5, 5: 8, 6: 9, 7: 14, 8: 10, 9: 7, 10: 5, 11: 3, 12: 2 };
const sp = (id, nm, col, vp, k) => ({ id, name: nm, color: col, vp, svp: id === 0 ? 1 : 0, built: { road: 9 - id, ship: 4 + id, settlement: 4, city: 3 - (id % 2), dev: 5 - id }, produced: { holz: 12 + k, lehm: 9, wolle: 11 - id, getreide: 14, erz: 8 + id, total: 54 + k - id }, tradesPlayer: 6 - id, tradesBank: 3 + id, stolenFrom: id, stolenBy: 3 - id, discarded: 2 * id, knights: 3 - id, maxRoute: 8 - id, discovered: 9 - 2 * id, robberMoves: 2, sevens: 3 + id });
out.statistik = base({ phase: 'ended', step: 'ended', winner: 0, endedBy: 'win', prompt: null, gameName: 'Käpt\'n Annas Runde', settings: defSettings(),
  players: fallbackPlayers().map((p, i) => (i === 0 ? Object.assign({}, p, { vp: 14 }) : p)),
  stats: { durationSec: 4520, turns: 24, aborted: false, rolls, history: histVp, players: [sp(0, 'Anna', 'rot', 14, 6), sp(1, 'Bernd <b>Fett</b>', 'blau', 11, 3), sp(2, 'Clara', 'orange', 8, 1), sp(3, 'Dirk', 'gruen', 7, 0)] } });
out.statistik_abbruch = Object.assign({}, out.statistik, { winner: null, endedBy: 'host', you: 1, stats: Object.assign({}, out.statistik.stats, { aborted: true }) });

// Archipel-Lobby (vierte Variante) und Schiffsbau am Nebelrand (Kanten mit Aufdeck-Badge)
out.lobby_archipel = lobbyBase(0, { settings: defSettings({ variant: 'archipel', plannedPlayers: 4, bankRate: 3, limits: Object.assign(defSettings().limits, { fogChips: Object.assign(nul([2, 3, 4, 5, 6, 8, 9, 10, 11, 12]), { 6: 1, 8: 1 }) }) }) });
const fogSetM = new Set(fog);
const discEdges = [...allE].filter((e) => !edges[e] && G.edgeHexes(e).some((h) => !isLand(h)) && G.edgeVerts(e).some((vk) => G.vertHexes(vk).some((h) => fogSetM.has(h)))).sort();
out.nebel_kante = base({ prompt: 'Baue ein Schiff: Mit „?“ markierte Kanten decken Nebel auf.',
  legal: Object.assign({}, base().legal, { ship: discEdges.slice(0, 12).concat(seaEdges.filter((e) => !edges[e]).slice(0, 4)), shipFrom: [] }) });
for (const [name, v] of Object.entries(out)) fs.writeFileSync(path.join(__dirname, name + '.json'), JSON.stringify(v));
console.log('geschrieben:', Object.keys(out).join(', '), '| Hexe:', hexes.length, 'Nebel:', fog.length, 'Haefen:', harbors.length, 'Siedl.:', Object.keys(verts).length, 'Kanten:', Object.keys(edges).length);
