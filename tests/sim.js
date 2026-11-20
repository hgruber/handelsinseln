'use strict';
// Simulation: Testspieler spielen komplette Partien über die echte Aktions-API; Invarianten werden laufend geprüft.
const assert = require('assert');
const Game = require('../server/game');
const { botAct } = require('../server/bot');
const G = require('../shared/geom');

function rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const COL = ['rot', 'blau', 'orange', 'weiss', 'gruen', 'violett'];

function invariants(g) {
  const S = g.S;
  for (const p of S.players) {
    for (const r in p.hand) assert(p.hand[r] >= 0 && Number.isInteger(p.hand[r]), `negative Karten ${p.name} ${r}`);
    const L = g.left(p.id);
    for (const k in L) assert(L[k] >= 0, `Figurenlimit ${k} überschritten bei ${p.name}`);
  }
  for (const v in S.verts) {
    assert(g.vertTouchesLand(v), 'Gebäude im Wasser');
    for (const n of G.vertNeighbors(v)) assert(!S.verts[n], 'Abstandsregel verletzt');
  }
  for (const e in S.edges) {
    const x = S.edges[e];
    assert(g.edgeHexesKnown(e), 'Weg an unentdecktem Feld');
    const hs = G.edgeHexes(e);
    if (x.k === 'r') assert(hs.some((h) => g.isLandHex(h)), 'Straße im Wasser');
    else assert(hs.some((h) => g.isSeaHex(h)), 'Schiff an Land');
  }
  assert(S.hexes[S.robber] && g.isLandHex(S.robber), 'Räuber nicht an Land');
  assert(g.isSeaHex(S.pirate), 'Pirat nicht im Meer');
  JSON.stringify(S);
}

function play(n, seed, maxSteps = 60000) {
  const rnd = rng(seed);
  const g = new Game({ rnd });
  for (let i = 0; i < n; i++) g.join('Spieler' + i, COL[i]);
  g.act(0, { type: 'start' });
  let steps = 0, stuck = 0;
  const start = Object.keys(g.S.hexes).length;
  let patt = false;
  while (g.S.phase !== 'ended' && steps < maxSteps) {
    if (g.S.turnNo > 1200) { patt = true; break; }
    let acted = false;
    for (let pid = 0; pid < n; pid++) {
      if (g.S.phase === 'ended') break;
      try { if (botAct(g, pid, { rnd })) { acted = true; steps++; } } catch (e) {
        if (e instanceof Game.GameError) throw new Error(`Bot-Aktion abgelehnt (${e.message}) bei Schritt ${g.stepOf()} Spieler ${pid}`);
        throw e;
      }
      if (steps % 25 === 0) invariants(g);
      for (let i = 0; i < n; i++) g.view(i);
    }
    if (!acted) { if (++stuck > 3) throw new Error('Spiel hängt in Schritt ' + g.stepOf() + ' turn=' + g.S.turn + ' trade=' + JSON.stringify(g.S.trade)); } else stuck = 0;
  }
  invariants(g);
  if (patt) { // Zufalls-Testspieler können in ein Patt laufen: dann muss wirklich nichts mehr baubar sein
    for (const p of g.S.players) {
      const L = g.left(p.id);
      assert(L.settlement === 0 || !g.settlementSpots(p.id).length, 'Patt, obwohl Siedlungen möglich');
      assert(L.city === 0 || !g.citySpots(p.id).length, 'Patt, obwohl Städte möglich');
    }
  }
  return { patt, ended: g.S.phase === 'ended', steps, turns: g.S.turnNo, winner: g.S.winner, hexes: Object.keys(g.S.hexes).length - start, vps: g.S.players.map((p) => g.vp(p.id) + g.hiddenVp(p.id)), svp: g.S.players.map((p) => p.svp) };
}

if (require.main === module) {
  const seeds = +process.argv[2] || 4;
  let bad = 0;
  for (const n of [2, 3, 4, 5, 6]) for (let s = 1; s <= seeds; s++) {
    try {
      const r = play(n, n * 1000 + s);
      console.log(`n=${n} seed=${s} ${r.ended ? 'Ende' : r.patt ? 'PATT(Bots ohne Bauplätze)' : 'KEIN ENDE'} Züge=${r.turns} Aktionen=${r.steps} entdeckt=${r.hexes} VP=${r.vps} SVP=${r.svp}`);
      if (!r.ended && !r.patt) bad++;
    } catch (e) { bad++; console.log(`n=${n} seed=${s} FEHLER: ${e.stack}`); }
  }
  process.exit(bad ? 1 : 0);
}
module.exports = { play, rng };
