'use strict';
// Echte Partien (Bots) je Variante spielen und die Sicht von Anna (Platz 0) als Mock-Views für die README-Screenshots speichern:
//   node tests/mock/readme.js [seed]   -> tests/mock/readme_*.json   (danach: python3 tests/mock/readme_shots.py)
const fs = require('fs'), path = require('path');
const Game = require('../../server/game');
const { botAct } = require('../../server/bot');
const { botPlay } = require('../../server/botplay');

function rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const COL = ['rot', 'blau', 'orange', 'weiss'];
const seed0 = +process.argv[2] || 7;

// Bewertet einen Moment: viele Bauten, volle Hand, Entwicklungskarten, hohe Punktestände.
function score(v) {
  const hand = Object.values(v.me.hand).reduce((a, b) => a + b, 0);
  const dev = (v.me.dev || []).length;
  const built = Object.keys(v.verts).length * 2 + Object.keys(v.edges).length;
  return built + hand * 1.5 + dev * 4 + v.players.reduce((a, p) => a + (p.vp || 0), 0) * 2;
}

// Spielt mehrere Partien und merkt sich den ansehnlichsten Moment (Anna am Zug); ended = Spielende (für die Statistik).
function scene(variant, seed, ended) {
  let best = null, bestS = -1;
  for (let k = 0; k < 6; k++) {
    const rnd = rng(seed * 100 + k);
    const g = new Game({ rnd, meta: { id: 'g1', name: 'Käpt\'n Annas Runde' } });
    g.join('Anna', COL[0]); ['baumeister', 'haendler', 'ritter'].forEach((kind) => g.addBot(0, kind)); // Anna (Testspieler) + die drei Bots
    g.setSettings(0, { variant, plannedPlayers: 4 });
    g.act(0, { type: 'start' });
    for (let steps = 0; steps < 30000 && g.S.phase !== 'ended' && g.S.turnNo < 150; steps++) {
      if (!ended && g.S.phase === 'main' && g.S.turn === 0 && g.stepOf() === 'main') {
        const v = g.view(0), sc = score(v);
        if (sc > bestS) { bestS = sc; best = JSON.parse(JSON.stringify(v)); }
      }
      for (let pid = 0; pid < 4 && g.S.phase !== 'ended'; pid++) { if (g.S.players[pid].bot) botPlay(g, pid, { rnd }); else botAct(g, pid, { rnd }); }
    }
    if (ended && g.S.phase === 'ended') return g.view(0);
  }
  return best;
}

const out = {
  readme_klassisch: scene('klassisch', seed0),
  readme_nebel: scene('nebel', seed0 + 1),
  readme_inseln: scene('inseln', seed0 + 2),
  readme_archipel: scene('archipel', seed0 + 3),
  readme_ende: scene('klassisch', seed0 + 4, true),
};
for (const [n, v] of Object.entries(out)) {
  fs.writeFileSync(path.join(__dirname, n + '.json'), JSON.stringify(v));
  console.log(n, v.phase, v.step, 'Felder', v.hexes.length, 'Punkte', v.players.map((p) => p.vp).join('/'), 'Hand', JSON.stringify(v.me.hand), 'Entw.', (v.me.dev || []).length);
}
